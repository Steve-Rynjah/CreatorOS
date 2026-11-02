import { fontFamily } from "@/lib/fonts";
import { clipDur, clipIndexAt, clipStart } from "./timing";
import { BRAND, textAnim, type Chapter, type Cue, type ImageClip, type Project, type TextClip } from "./types";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Drawable = HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

export type Assets = {
  /** keyed by image path */
  images: Map<string, Drawable>;
  /** tiny pre-blurred copies used as the background in "fit" mode */
  blurred: Map<string, Drawable>;
};

export type TextBox = { id: string; x: number; y: number; w: number; h: number };

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

function setSpacing(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${px}px`;
}

function dims(img: Drawable) {
  if ("naturalWidth" in img) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: img.width, h: img.height };
}

/** Makes a blurred thumbnail by drawing tiny and letting the browser upscale it smoothly. */
export function makeBlurred(img: Drawable): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 27;
  const x = c.getContext("2d")!;
  const { w, h } = dims(img);
  const s = Math.max(48 / w, 27 / h);
  x.drawImage(img, (48 - w * s) / 2, (27 - h * s) / 2, w * s, h * s);
  return c;
}

function drawClipImage(
  ctx: Ctx,
  p: Project,
  assets: Assets,
  clip: ImageClip,
  W: number,
  H: number,
  motionProgress: number,
  dx: number,
  alpha: number,
) {
  const img = assets.images.get(clip.path);
  if (!img) return;
  const { w, h } = dims(img);
  if (!w || !h) return;
  const z = p.zoomAmount;
  let scale = 1;
  if (clip.motion === "zoom-in") scale = 1 + z * motionProgress;
  else if (clip.motion === "zoom-out") scale = 1 + z * (1 - motionProgress);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.rect(dx, 0, W, H);
  ctx.clip();

  if (p.fit === "contain") {
    const bg = assets.blurred.get(clip.path);
    if (bg) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bg, dx - W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(dx, 0, W, H);
    }
  }
  const base = p.fit === "cover" ? Math.max(W / w, H / h) : Math.min(W / w, H / h);
  const dw = w * base * scale;
  const dh = h * base * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, dx + (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.restore();
}

function wrapLines(ctx: Ctx, text: string, maxWidth: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = words[0];
    for (const w of words.slice(1)) {
      const test = `${line} ${w}`;
      if (ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function drawText(ctx: Ctx, t: TextClip, W: number, H: number, time: number): TextBox | null {
  const k = H / 1080;
  const size = t.size * k;
  const anim = textAnim(t);
  // Legacy fade clips scaled their fade to the clip; new clips use the chosen duration.
  const d = Math.max(0.05, Math.min(t.animDur ?? Math.min(0.4, t.duration / 3), t.duration / 2));
  const inP = anim === "none" ? 1 : clamp01((time - t.start) / d);
  const outP = anim === "none" ? 1 : clamp01((t.start + t.duration - time) / d);
  const align = t.align ?? "center";

  ctx.save();
  ctx.font = `${t.bold ? 700 : 400} ${size}px ${fontFamily(t.font)}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, t.text || " ", W * 0.86);
  const lh = size * 1.2;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(...widths, size);
  const bh = lh * lines.length;
  const ax = t.x * W;
  const cy = t.y * H;
  const padX = size * 0.45;
  const padY = size * 0.25;
  const left = align === "left" ? ax : align === "right" ? ax - bw : ax - bw / 2;
  const box = { id: t.id, x: left - padX, y: cy - bh / 2 - padY, w: bw + padX * 2, h: bh + padY * 2 };

  // In-animation (out is always a fade unless "none").
  let alpha = Math.min(inP, outP);
  let dx = 0;
  let dy = 0;
  let scale = 1;
  let reveal = 1;
  const e = easeOut(inP);
  if (anim === "pop") scale = 0.6 + 0.4 * easeOutBack(inP);
  else if (anim === "slide-up") dy = (1 - e) * size * 0.9;
  else if (anim === "slide-down") dy = -(1 - e) * size * 0.9;
  else if (anim === "slide-in") dx = (align === "right" ? 1 : -1) * (1 - e) * W * 0.06;
  else if (anim === "typewriter") {
    reveal = inP;
    alpha = outP;
  }
  ctx.globalAlpha = alpha;
  const cx = box.x + box.w / 2;
  ctx.translate(cx + dx, cy + dy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  if (t.background) {
    ctx.fillStyle = t.bgColor;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, size * 0.18);
    ctx.fill();
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = size * 0.18;
    ctx.shadowOffsetY = size * 0.04;
  }
  ctx.fillStyle = t.color;
  const total = lines.reduce((n, l) => n + l.length, 0);
  let budget = Math.ceil(total * reveal);
  lines.forEach((l, i) => {
    if (budget <= 0) return;
    const shown = l.slice(0, budget);
    budget -= l.length;
    // Typewriter keeps the line's final position: draw the prefix from the line's start edge.
    const lx = align === "center" && shown.length < l.length ? ax - widths[i] / 2 : ax;
    if (align === "center" && shown.length < l.length) ctx.textAlign = "left";
    ctx.fillText(shown, lx, cy - bh / 2 + lh * (i + 0.5));
    ctx.textAlign = align;
  });
  ctx.restore();
  return box;
}

/** Start time of each word: the voice's own timings when they still fit the text, else shared out by length. */
function wordTimes(cue: Cue, words: string[]) {
  const w = cue.words;
  if (w && w.length === words.length && w[0] >= cue.start - 0.05 && w[w.length - 1] <= cue.end) return w;
  const weights = words.map((x) => x.length + 2);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [];
  let t = cue.start;
  for (const x of weights) {
    out.push(t);
    t += ((cue.end - cue.start) * x) / sum;
  }
  return out;
}

/**
 * Splits a caption into short "pages" shown one after another: first at punctuation,
 * then each phrase into evenly sized chunks (so no page is a lone trailing word).
 */
function pages(words: string[], maxChars = 22, maxWords = 4) {
  const phrases: [number, number][] = [];
  let a = 0;
  words.forEach((w, i) => {
    if (/[.!?,;:—]$/.test(w) || i === words.length - 1) {
      phrases.push([a, i + 1]);
      a = i + 1;
    }
  });
  const out: [number, number][] = [];
  for (const [s, e] of phrases) {
    const len = words.slice(s, e).join(" ").length;
    const n = Math.max(1, Math.ceil(len / maxChars), Math.ceil((e - s) / maxWords));
    const target = len / n;
    let start = s;
    let cur = 0;
    let made = 0;
    for (let i = s; i < e; i++) {
      const wl = words[i].length + (cur ? 1 : 0);
      if (cur && made < n - 1 && (cur + wl / 2 > target || i - start >= maxWords)) {
        out.push([start, i]);
        made++;
        start = i;
        cur = words[i].length;
      } else cur += wl;
    }
    out.push([start, e]);
  }
  return out;
}

/** Bold upper-case captions, a few words at a time, the spoken word lit in the brand yellow. */
function drawModernSubtitle(ctx: Ctx, p: Project, cue: Cue, W: number, H: number, time: number) {
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const starts = wordTimes(cue, words);
  let active = 0;
  for (let i = 0; i < words.length; i++) if (starts[i] <= time) active = i;
  const pg = pages(words).find(([a, b]) => active >= a && active < b) ?? [0, words.length];
  const shown = words.slice(pg[0], pg[1]).map((w) => w.toUpperCase());
  const pageStart = starts[pg[0]];

  const k = H / 1080;
  const size = p.subtitle.size * k;
  ctx.save();
  ctx.font = `800 ${size}px ${fontFamily("montserrat")}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const space = ctx.measureText(" ").width * 1.1;
  const widths = shown.map((w) => ctx.measureText(w).width);

  // Lay out on up to two lines.
  const maxW = W * 0.86;
  const lines: number[][] = [[]];
  let lw = 0;
  shown.forEach((_, i) => {
    const add = (lines[lines.length - 1].length ? space : 0) + widths[i];
    if (lw + add > maxW && lines[lines.length - 1].length) {
      lines.push([i]);
      lw = widths[i];
    } else {
      lines[lines.length - 1].push(i);
      lw += add;
    }
  });
  const lh = size * 1.18;
  const blockH = lh * lines.length;
  const cy = p.subtitle.position === "bottom" ? H * 0.86 - blockH / 2 : H * 0.12 + blockH / 2;
  const enter = easeOut(clamp01((time - pageStart) / 0.14));
  ctx.globalAlpha = enter;
  const rise = (1 - enter) * size * 0.25;

  lines.forEach((line, li) => {
    const total = line.reduce((s, i, j) => s + widths[i] + (j ? space : 0), 0);
    let x = W / 2 - total / 2;
    const y = cy - blockH / 2 + lh * (li + 0.5) + rise;
    if (p.subtitle.box) {
      ctx.fillStyle = `${BRAND.black}d9`;
      ctx.beginPath();
      ctx.roundRect(x - size * 0.35, y - lh / 2, total + size * 0.7, lh, size * 0.2);
      ctx.fill();
    }
    for (const i of line) {
      const gi = pg[0] + i;
      const on = gi === active;
      const pop = on ? 1 + 0.1 * (1 - easeOut(clamp01((time - starts[gi]) / 0.16))) : 1;
      const wx = x + widths[i] / 2;
      ctx.save();
      ctx.translate(wx, y);
      ctx.scale(pop, pop);
      if (!p.subtitle.box) {
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = size * 0.25;
        ctx.shadowOffsetY = size * 0.06;
        ctx.lineJoin = "round";
        ctx.lineWidth = size * 0.2;
        ctx.strokeStyle = BRAND.black;
        ctx.strokeText(shown[i], -widths[i] / 2, 0);
        ctx.shadowColor = "transparent";
      }
      ctx.fillStyle = on ? (p.subtitle.highlight ?? BRAND.yellow) : BRAND.white;
      ctx.fillText(shown[i], -widths[i] / 2, 0);
      ctx.restore();
      x += widths[i] + space;
    }
  });
  ctx.restore();
}

/** Seconds the title card takes to dissolve into the first shot (centred on the cut). */
export const CHAPTER_FADE = 0.9;

/** Movie-style chapter card: letterboxed, the first shot blurred behind, label + title animating in. */
function drawChapter(ctx: Ctx, ch: Chapter, first: ImageClip | undefined, assets: Assets, W: number, H: number, time: number) {
  const D = ch.duration;
  const k = H / 1080;
  ctx.save();
  ctx.fillStyle = BRAND.black;
  ctx.fillRect(0, 0, W, H);

  // Blurred first shot, slowly pushing in.
  const bg = first && assets.blurred.get(first.path);
  if (bg) {
    const z = 1.12 + 0.06 * clamp01(time / Math.max(1, D));
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bg, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
    ctx.globalAlpha = 1;
  }
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.7);
  vg.addColorStop(0, "rgba(27,27,27,0.55)");
  vg.addColorStop(1, "rgba(10,10,10,0.95)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Letterbox bars slide in.
  const bar = H * 0.1 * easeOut(clamp01(time / 0.9));
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const titleSize = 150 * k;
  ctx.font = `400 ${titleSize}px ${fontFamily("bebas")}`;
  // Fixed spacing: animating it re-wrapped and shifted the title while it came in.
  setSpacing(ctx, titleSize * 0.03);
  const tIn = easeOut(clamp01((time - 0.3) / 0.9));
  const lines = wrapLines(ctx, ch.title.toUpperCase(), W * 0.8);
  const lh = titleSize * 1.02;
  const blockH = lh * lines.length;
  const labelSize = 34 * k;
  const gapY = 44 * k;
  const top = H / 2 - (blockH + (ch.label ? labelSize + gapY : 0)) / 2;

  if (ch.label) {
    const lIn = easeOut(clamp01((time - 0.1) / 0.6));
    ctx.save();
    ctx.globalAlpha = lIn;
    ctx.font = `800 ${labelSize}px ${fontFamily("montserrat")}`;
    setSpacing(ctx, labelSize * 0.45);
    ctx.fillStyle = BRAND.yellow;
    ctx.fillText(ch.label.toUpperCase(), W / 2 + labelSize * 0.22, top + labelSize / 2 + (1 - lIn) * 12 * k);
    ctx.restore();
    // Rule under the label grows from the centre.
    const rw = 120 * k * easeOut(clamp01((time - 0.25) / 0.7));
    ctx.fillStyle = BRAND.yellow;
    ctx.fillRect(W / 2 - rw / 2, top + labelSize + gapY / 2 - 2 * k, rw, 4 * k);
  }

  ctx.globalAlpha = tIn;
  ctx.fillStyle = BRAND.white;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 30 * k;
  ctx.textAlign = "left";
  const ty = top + (ch.label ? labelSize + gapY : 0);
  const sc = 1.05 - 0.05 * tIn;
  ctx.translate(W / 2, ty + blockH / 2);
  ctx.scale(sc, sc);
  lines.forEach((l, i) => {
    // Centre on the glyphs, not the trailing letter-space.
    const w = ctx.measureText(l).width - titleSize * 0.03;
    ctx.fillText(l, -w / 2, -blockH / 2 + lh * (i + 0.5) + (1 - tIn) * 14 * k);
  });
  ctx.restore();
}

function drawSubtitle(ctx: Ctx, p: Project, W: number, H: number, time: number) {
  const cue = p.cues.find((c) => time >= c.start && time < c.end);
  if (!cue) return;
  if ((p.subtitle.style ?? "modern") === "modern") return drawModernSubtitle(ctx, p, cue, W, H, time);
  const k = H / 1080;
  const size = p.subtitle.size * k;
  ctx.save();
  ctx.font = `500 ${size}px ${fontFamily("roboto")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, cue.text, W * 0.8);
  const lh = size * 1.35;
  const blockH = lh * lines.length;
  const y0 = p.subtitle.position === "bottom" ? H * 0.92 - blockH : H * 0.08;
  lines.forEach((l, i) => {
    const y = y0 + lh * (i + 0.5);
    if (p.subtitle.box) {
      const w = ctx.measureText(l).width + size * 0.6;
      ctx.fillStyle = "rgba(8,8,8,0.75)";
      ctx.fillRect(W / 2 - w / 2, y - lh / 2, w, lh);
    } else {
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineJoin = "round";
      ctx.strokeText(l, W / 2, y);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(l, W / 2, y);
  });
  ctx.restore();
}

/**
 * Draws one frame at `time`. Shared by the preview and the exporter so what you see is
 * exactly what gets rendered. Returns text boxes (canvas px) for hit-testing drags.
 */
export function renderFrame(
  ctx: Ctx,
  W: number,
  H: number,
  time: number,
  p: Project,
  assets: Assets,
  opts: { subtitles?: boolean } = {},
): TextBox[] {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const n = p.images.length;
  if (n) {
    const trDur = (i: number) =>
      i < n && i >= 0 && p.images[i].transition !== "none" ? Math.min(p.images[i].transitionDur, clipDur(p, i)) : 0;
    // Each clip's visible span includes half of its in/out transitions; motion spans all of it.
    const motion = (i: number) => {
      const s = clipStart(p, i) - trDur(i) / 2;
      const e = clipStart(p, i) + clipDur(p, i) + trDur(i + 1) / 2;
      return clamp01((time - s) / (e - s));
    };

    const idx = clipIndexAt(p, time);

    // Are we inside the transition window around boundary b (start of clip b)?
    let handled = false;
    for (const b of [idx, idx + 1]) {
      if (b < 0 || b >= n) continue;
      const T = trDur(b);
      if (!T) continue;
      const s = clipStart(p, b);
      if (time < s - T / 2 || time >= s + T / 2) continue;
      if (b === 0 && p.introFill === "first") break;
      const a = clamp01((time - (s - T / 2)) / T);
      const clip = p.images[b];
      const drawPrev = (dx: number) => {
        if (b > 0) drawClipImage(ctx, p, assets, p.images[b - 1], W, H, motion(b - 1), dx, 1);
      };
      if (clip.transition === "dissolve") {
        drawPrev(0);
        drawClipImage(ctx, p, assets, clip, W, H, motion(b), 0, a);
      } else {
        const e = easeInOut(a);
        const dir = clip.transition === "slide-left" ? -1 : 1;
        drawPrev(dir * e * W);
        drawClipImage(ctx, p, assets, clip, W, H, motion(b), -dir * (1 - e) * W, 1);
      }
      handled = true;
      break;
    }

    if (!handled) {
      if (idx < 0) {
        if (p.introFill === "first") drawClipImage(ctx, p, assets, p.images[0], W, H, 0, 0, 1);
      } else {
        drawClipImage(ctx, p, assets, p.images[idx], W, H, motion(idx), 0, 1);
      }
    }
  }

  // Chapter title card, dissolving into the first shot around the cut.
  const ch = p.chapter;
  if (ch && time < ch.duration + CHAPTER_FADE / 2) {
    const a = clamp01((time - (ch.duration - CHAPTER_FADE / 2)) / CHAPTER_FADE);
    if (a > 0 && time < ch.duration && p.images[0]) drawClipImage(ctx, p, assets, p.images[0], W, H, 0, 0, 1);
    ctx.save();
    ctx.globalAlpha = 1 - easeInOut(a);
    drawChapter(ctx, ch, p.images[0], assets, W, H, time);
    ctx.restore();
  }

  const boxes: TextBox[] = [];
  for (const t of p.texts) {
    if (time >= t.start && time < t.start + t.duration) {
      const b = drawText(ctx, t, W, H, time);
      if (b) boxes.push(b);
    }
  }
  if (opts.subtitles ?? p.subtitle.enabled) drawSubtitle(ctx, p, W, H, time);
  ctx.restore();
  return boxes;
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

export function fileUrl(path: string, download = false) {
  return `/api/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}
