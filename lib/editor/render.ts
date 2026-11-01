import { fontFamily } from "@/lib/fonts";
import { clipDur, clipIndexAt, clipStart } from "./timing";
import type { ImageClip, Project, TextClip } from "./types";

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
  ctx.save();
  let alpha = 1;
  if (t.fade) {
    const f = Math.min(0.4, t.duration / 3);
    alpha = Math.min(clamp01((time - t.start) / f), clamp01((t.start + t.duration - time) / f));
  }
  ctx.globalAlpha = alpha;
  ctx.font = `${t.bold ? 700 : 400} ${size}px ${fontFamily(t.font)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, t.text || " ", W * 0.86);
  const lh = size * 1.2;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(...widths, size);
  const bh = lh * lines.length;
  const cx = t.x * W;
  const cy = t.y * H;
  const padX = size * 0.45;
  const padY = size * 0.25;
  if (t.background) {
    ctx.fillStyle = t.bgColor;
    const r = size * 0.18;
    ctx.beginPath();
    ctx.roundRect(cx - bw / 2 - padX, cy - bh / 2 - padY, bw + padX * 2, bh + padY * 2, r);
    ctx.fill();
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = size * 0.18;
    ctx.shadowOffsetY = size * 0.04;
  }
  ctx.fillStyle = t.color;
  lines.forEach((l, i) => ctx.fillText(l, cx, cy - bh / 2 + lh * (i + 0.5)));
  ctx.restore();
  return { id: t.id, x: cx - bw / 2 - padX, y: cy - bh / 2 - padY, w: bw + padX * 2, h: bh + padY * 2 };
}

function drawSubtitle(ctx: Ctx, p: Project, W: number, H: number, time: number) {
  const cue = p.cues.find((c) => time >= c.start && time < c.end);
  if (!cue) return;
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
