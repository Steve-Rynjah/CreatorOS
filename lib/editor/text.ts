import { fontFamily } from "@/lib/fonts";
import { BRAND, textAnim, textRotation, textStyle, type TextAnim, type TextClip } from "./types";

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Where a text clip was drawn, in canvas px: an unrotated box turned `rot` radians about its centre. */
export type TextBox = { id: string; x: number; y: number; w: number; h: number; rot: number };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

export function setSpacing(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${px}px`;
}

export function wrapLines(ctx: Ctx, text: string, maxWidth: number) {
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

/** Wraps `text`, shrinking the font until it fits in `maxLines` lines no wider than `maxW`. */
function fitLines(ctx: Ctx, text: string, size0: number, font: (s: number) => string, maxW: number, maxLines: number, spacing = 0) {
  let size = size0;
  let lines: string[] = [];
  for (let k = 0; k < 12; k++) {
    ctx.font = font(size);
    setSpacing(ctx, size * spacing);
    lines = wrapLines(ctx, text || " ", maxW);
    if ((lines.length <= maxLines && Math.max(...lines.map((l) => ctx.measureText(l).width)) <= maxW) || size < 20) break;
    size *= 0.9;
  }
  // Even the lines out (no lone last word): narrowest width that still wraps to the same count.
  if (lines.length > 1 && !text.includes("\n")) {
    let lo = 0;
    let hi = maxW;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (wrapLines(ctx, text, mid).length > lines.length) lo = mid;
      else hi = mid;
    }
    lines = wrapLines(ctx, text, hi);
  }
  return { size, lines };
}

/** Small deterministic PRNG so hand-made wobble stays put from frame to frame. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Revealed prefix of each line for the typewriter animation. */
function revealLines(lines: string[], reveal: number) {
  let budget = Math.ceil(lines.reduce((n, l) => n + l.length, 0) * reveal);
  return lines.map((l) => {
    const shown = l.slice(0, Math.max(0, budget));
    budget -= l.length;
    return shown;
  });
}

/** Box of size w×h anchored at the clip's position (x per `align`, y centred). */
function anchorBox(t: TextClip, W: number, H: number, w: number, h: number, rot: number): TextBox {
  const ax = t.x * W;
  const align = t.align ?? "center";
  const x = align === "left" ? ax : align === "right" ? ax - w : ax - w / 2;
  return { id: t.id, x, y: t.y * H - h / 2, w, h, rot };
}

type Motion = { anim: TextAnim; inP: number; outP: number };

/**
 * Applies the in/out animation and the rotation about the box centre.
 * Returns the typewriter reveal fraction (1 = all text shown).
 */
function applyMotion(ctx: Ctx, t: TextClip, box: TextBox, m: Motion, size: number, W: number, slam = false) {
  const { anim, inP, outP } = m;
  let alpha = Math.min(inP, outP);
  let dx = 0;
  let dy = 0;
  let scale = 1;
  let reveal = 1;
  const e = easeOut(inP);
  if (anim === "pop") scale = slam ? 1 + 0.7 * Math.pow(1 - inP, 2) : 0.6 + 0.4 * easeOutBack(inP);
  else if (anim === "slide-up") dy = (1 - e) * size * 0.9;
  else if (anim === "slide-down") dy = -(1 - e) * size * 0.9;
  else if (anim === "slide-in") dx = ((t.align ?? "center") === "right" ? 1 : -1) * (1 - e) * W * 0.06;
  else if (anim === "typewriter") {
    reveal = inP;
    alpha = outP;
  }
  ctx.globalAlpha = alpha;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.translate(cx + dx, cy + dy);
  ctx.rotate(box.rot);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  return reveal;
}

function dropShadow(ctx: Ctx, size: number, strength = 0.5) {
  ctx.shadowColor = `rgba(0,0,0,${strength})`;
  ctx.shadowBlur = size * 0.25;
  ctx.shadowOffsetX = size * 0.04;
  ctx.shadowOffsetY = size * 0.1;
}
function noShadow(ctx: Ctx) {
  ctx.shadowColor = "transparent";
}

/* ───────────────────────────── Plain ───────────────────────────── */

function drawPlain(ctx: Ctx, t: TextClip, W: number, H: number, size: number, m: Motion, rot: number): TextBox {
  const align = t.align ?? "center";
  ctx.font = `${t.bold ? 700 : 400} ${size}px ${fontFamily(t.font)}`;
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, t.text || " ", W * 0.86);
  const lh = size * 1.2;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(...widths, size);
  const bh = lh * lines.length;
  const padX = size * 0.45;
  const padY = size * 0.25;
  const box = anchorBox(t, W, H, bw + padX * 2, bh + padY * 2, rot);
  const reveal = applyMotion(ctx, t, box, m, size, W);

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
  ctx.textAlign = "left";
  const shown = revealLines(lines, reveal);
  const top = box.y + padY;
  lines.forEach((_, i) => {
    // Lines keep their final position while typing: always draw from the line's start edge.
    const x = align === "left" ? box.x + padX : align === "right" ? box.x + box.w - padX - widths[i] : box.x + (box.w - widths[i]) / 2;
    ctx.fillText(shown[i], x, top + lh * (i + 0.5));
  });
  return box;
}

/* ───────────────────────────── Badge ───────────────────────────── */

/** Splits words into two lines whose widths are as even as possible. */
function balance(ctx: Ctx, words: string[]): [string, string] {
  let best: [string, string] = [words.join(" "), ""];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (w < bestW) {
      bestW = w;
      best = [a, b];
    }
  }
  return best;
}

/** Three short rays bursting from a corner, growing in with `p`. */
function drawBurst(ctx: Ctx, x: number, y: number, size: number, p: number) {
  if (p <= 0) return;
  ctx.save();
  ctx.strokeStyle = BRAND.yellow;
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.13;
  for (const deg of [-98, -58, -22]) {
    const a = (deg * Math.PI) / 180;
    const r0 = size * 0.25;
    const r1 = r0 + size * 0.48 * p;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Brand callout, like a sticker:
 * one line  → black pill with a yellow rim, the last word on a yellow end-cap;
 * two lines → black pill on top, a yellow pill tucked under it, plus an underline swoosh.
 */
function drawBadge(ctx: Ctx, t: TextClip, W: number, H: number, size0: number, m: Motion, rot: number): TextBox {
  const fam = fontFamily(t.font);
  const maxW = W * 0.78;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // Fit on one line, else two balanced lines, shrinking the font if even that's too wide.
  let size = size0;
  let lines: string[] = [];
  for (let k = 0; k < 10; k++) {
    ctx.font = `italic 900 ${size}px ${fam}`;
    setSpacing(ctx, -size * 0.035);
    const text = (t.text || " ").replace(/\s+/g, " ").trim() || " ";
    const words = text.split(" ");
    const padX = size * 0.5;
    if (ctx.measureText(text).width + padX * 2 <= maxW || words.length < 2) lines = [text];
    else lines = balance(ctx, words);
    if (Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2 <= maxW || size < 24) break;
    size *= 0.9;
  }

  const padX = size * 0.5;
  const pillH = size * 1.4;
  const rim = size * 0.1;
  const r = pillH * 0.32;

  // Layout in local coordinates around (0, 0).
  type Part = { x: number; y: number; w: number; h: number };
  let pill1: Part;
  let pill2: Part | undefined;
  let split: { x: number; head: string; tail: string } | undefined;
  if (lines.length === 1) {
    const words = lines[0].split(" ");
    const head = words.length > 1 ? words.slice(0, -1).join(" ") : lines[0];
    const tail = words.length > 1 ? words[words.length - 1] : "";
    const hw = ctx.measureText(head).width;
    const tw = tail ? ctx.measureText(tail).width : 0;
    const gap = size * 0.28;
    const w = padX + hw + (tail ? gap + gap + tw : 0) + padX;
    pill1 = { x: -w / 2, y: -pillH / 2, w, h: pillH };
    if (tail) split = { x: pill1.x + padX + hw + gap, head, tail };
  } else {
    const w1 = ctx.measureText(lines[0]).width + padX * 2;
    const w2 = ctx.measureText(lines[1]).width + padX * 2;
    const off = size * 0.35;
    // The top pill runs on below its text so the yellow pill can tuck over its lower edge.
    const tuck = pillH * 0.4;
    const gap = size * 0.1;
    const totalH = pillH + gap + pillH;
    const left = -Math.max(w1, off + w2) / 2;
    pill1 = { x: left, y: -totalH / 2, w: w1, h: pillH + tuck };
    pill2 = { x: left + off, y: -totalH / 2 + pillH + gap, w: w2, h: pillH };
  }
  const minX = Math.min(pill1.x, pill2 ? pill2.x : Infinity) - rim;
  const maxX = Math.max(pill1.x + pill1.w, pill2 ? pill2.x + pill2.w : -Infinity) + rim + size * 0.55;
  const minY = pill1.y - rim - size * 0.6;
  const maxY = (pill2 ? pill2.y + pill2.h + size * 0.35 : pill1.y + pill1.h) + rim;

  const box = anchorBox(t, W, H, maxX - minX, maxY - minY, rot);
  const reveal = applyMotion(ctx, t, box, m, size, W);
  ctx.translate(box.x - minX, box.y - minY);

  const pill = (q: Part, grow = 0, rad = r) => {
    ctx.beginPath();
    ctx.roundRect(q.x - grow, q.y - grow, q.w + grow * 2, q.h + grow * 2, rad + grow);
  };

  // Top pill: yellow rim, black body.
  dropShadow(ctx, size);
  ctx.fillStyle = BRAND.yellow;
  pill(pill1, rim);
  ctx.fill();
  noShadow(ctx);
  ctx.fillStyle = BRAND.black;
  pill(pill1);
  ctx.fill();

  const shown = revealLines(split ? [split.head, split.tail] : lines, reveal);
  const ty = pill1.y + pillH / 2 + size * 0.02;
  ctx.fillStyle = BRAND.white;
  ctx.fillText(shown[0], pill1.x + padX, ty);
  if (split) {
    // Yellow end-cap for the last word.
    ctx.save();
    pill(pill1);
    ctx.clip();
    ctx.fillStyle = BRAND.yellow;
    ctx.beginPath();
    ctx.roundRect(split.x, pill1.y - 1, pill1.x + pill1.w - split.x + r, pill1.h + 2, r);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = BRAND.black;
    ctx.fillText(shown[1], split.x + size * 0.28, ty);
  }

  if (pill2) {
    // Underline swoosh, tapering to the right.
    const sx = pill2.x - size * 0.15;
    const sy = pill2.y + pill2.h + size * 0.12;
    const sw = pill2.w * 0.6 * easeOut(m.inP);
    if (sw > 1) {
      ctx.fillStyle = BRAND.yellow;
      ctx.beginPath();
      ctx.moveTo(sx, sy + size * 0.06);
      ctx.quadraticCurveTo(sx + sw * 0.45, sy - size * 0.08, sx + sw, sy - size * 0.06);
      ctx.quadraticCurveTo(sx + sw * 0.5, sy + size * 0.06, sx, sy + size * 0.26);
      ctx.closePath();
      ctx.fill();
    }
    // Yellow pill, slightly slanted, with black text.
    ctx.save();
    const cx2 = pill2.x + pill2.w / 2;
    const cy2 = pill2.y + pill2.h / 2;
    ctx.translate(cx2, cy2);
    ctx.transform(1, 0, -0.12, 1, 0, 0);
    ctx.translate(-cx2, -cy2);
    dropShadow(ctx, size);
    ctx.fillStyle = BRAND.yellow;
    pill(pill2, 0, pill2.h * 0.22);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = BRAND.black;
    ctx.fillText(shown[1], pill2.x + padX, cy2 + size * 0.02);
  }

  drawBurst(ctx, pill1.x + pill1.w + rim + size * 0.05, pill1.y - rim, size, easeOut(clamp01((m.inP - 0.35) / 0.65)));
  return box;
}

/* ───────────────────────────── 3D Pop ───────────────────────────── */

/** Thumbnail-style block capitals: white face, thick black outline, yellow extrusion; last word in yellow. */
function drawPop3D(ctx: Ctx, t: TextClip, W: number, H: number, size0: number, m: Motion, rot: number): TextBox {
  const fam = fontFamily(t.font);
  const text = (t.text || " ").toUpperCase();
  const { size, lines } = fitLines(ctx, text, size0 * 1.1, (s) => `900 ${s}px ${fam}`, W * 0.8, 3, -0.01);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const lh = size * 1.02;
  const depth = size * 0.14;
  const stroke = size * 0.17;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(...widths) + stroke + depth;
  const bh = lh * lines.length + stroke + depth;
  const box = anchorBox(t, W, H, bw, bh, rot);
  const reveal = applyMotion(ctx, t, box, m, size, W);
  const shown = revealLines(lines, reveal);
  const space = ctx.measureText(" ").width;
  const lastLine = lines.length - 1;
  const cx = box.x + (box.w - depth) / 2;
  const top = box.y + stroke / 2;
  ctx.lineJoin = "round";

  shown.forEach((l, i) => {
    const x0 = cx - widths[i] / 2;
    const y = top + lh * (i + 0.5);
    // Extrusion: stacked copies stepping down-right, outlined in black at the back.
    dropShadow(ctx, size, 0.55);
    ctx.lineWidth = stroke;
    ctx.strokeStyle = BRAND.black;
    ctx.strokeText(l, x0 + depth, y + depth);
    noShadow(ctx);
    const steps = 10;
    for (let k = steps; k >= 1; k--) {
      const d = (depth * k) / steps;
      ctx.fillStyle = "#C99A00";
      ctx.fillText(l, x0 + d, y + d);
    }
    // Face.
    ctx.lineWidth = stroke * 0.75;
    ctx.strokeText(l, x0, y);
    const words = l.split(" ");
    let x = x0;
    words.forEach((w, j) => {
      const isLast = i === lastLine && j === words.length - 1 && words.length + lastLine > 1;
      ctx.fillStyle = isLast ? BRAND.yellow : BRAND.white;
      ctx.fillText(w, x, y);
      x += ctx.measureText(w).width + space;
    });
  });
  return box;
}

/* ───────────────────────────── Marker ───────────────────────────── */

/** Bold black words on hand-drawn highlighter strokes that wipe in line by line. */
function drawMarker(ctx: Ctx, t: TextClip, W: number, H: number, size0: number, m: Motion, rot: number): TextBox {
  const fam = fontFamily(t.font);
  const { size, lines } = fitLines(ctx, t.text || " ", size0, (s) => `800 ${s}px ${fam}`, W * 0.76, 3, -0.01);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const lh = size * 1.28;
  const padX = size * 0.35;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(...widths) + padX * 2;
  const bh = lh * lines.length + size * 0.2;
  const box = anchorBox(t, W, H, bw, bh, rot);
  const reveal = applyMotion(ctx, t, box, m, size, W);
  const shown = revealLines(lines, reveal);
  const align = t.align ?? "center";
  const n = lines.length;

  lines.forEach((_, i) => {
    const rand = rng(`${t.id}:${i}:${lines[i]}`);
    const w = widths[i] + padX * 2;
    const x0 = align === "left" ? box.x : align === "right" ? box.x + box.w - w : box.x + (box.w - w) / 2;
    const y = box.y + size * 0.1 + lh * (i + 0.5);
    // Staggered left-to-right wipe.
    const p = m.anim === "none" ? 1 : easeOut(clamp01(m.inP * (1 + 0.5 * (n - 1)) - 0.5 * i));
    if (p <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 - size, y - lh, (w + size * 1.2) * p + size * 0.2, lh * 2);
    ctx.clip();

    // Stroke body with wobbly edges and slanted, ragged ends.
    const hh = size * 0.56;
    const seg = 6;
    const jag = () => (rand() - 0.5) * size * 0.08;
    ctx.beginPath();
    ctx.moveTo(x0 + size * 0.06, y - hh + jag());
    for (let k = 1; k <= seg; k++) ctx.lineTo(x0 + (w * k) / seg, y - hh + jag() - (k / seg) * size * 0.04);
    ctx.lineTo(x0 + w + size * 0.08, y + hh * 0.2);
    for (let k = seg; k >= 0; k--) ctx.lineTo(x0 + (w * k) / seg - size * 0.06, y + hh + jag() - (k / seg) * size * 0.04);
    ctx.closePath();
    ctx.save();
    ctx.fillStyle = BRAND.yellow;
    ctx.globalAlpha *= 0.95;
    ctx.fill();
    // Streaks where the marker ran dry.
    ctx.globalAlpha *= 0.35;
    ctx.fillStyle = "#FFF3B0";
    for (let k = 0; k < 3; k++) {
      const sy = y - hh * 0.6 + rand() * hh * 1.2;
      ctx.fillRect(x0 + w * (0.1 + rand() * 0.3), sy, w * (0.3 + rand() * 0.5), size * 0.025);
    }
    ctx.restore();

    ctx.fillStyle = BRAND.black;
    ctx.fillText(shown[i], x0 + padX, y + size * 0.03);
    ctx.restore();
  });
  return box;
}

/* ───────────────────────────── Stamp ───────────────────────────── */

const stampCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Inked rubber stamp: condensed capitals in a double frame, worn by speckles; slams in on "Pop". */
function drawStamp(ctx: Ctx, t: TextClip, W: number, H: number, size0: number, m: Motion, rot: number): TextBox {
  const text = (t.text || " ").toUpperCase();
  const font = (s: number) => `400 ${s}px ${fontFamily("bebas")}`;
  const { size, lines } = fitLines(ctx, text, size0 * 1.15, font, W * 0.6, 3, 0.06);
  const lh = size * 0.95;
  const widths = lines.map((l) => ctx.measureText(l).width - size * 0.06);
  const border = size * 0.09;
  const pad = size * 0.38;
  const bw = Math.max(...widths) + pad * 2 + border * 2;
  const bh = lh * lines.length + pad * 1.4 + border * 2;
  const box = anchorBox(t, W, H, bw, bh, rot);

  const key = `${t.id}|${text}|${Math.round(size)}|${lines.join("/")}`;
  let art = stampCache.get(key);
  if (!art) {
    const cw = Math.ceil(bw) + 4;
    const ch = Math.ceil(bh) + 4;
    art = makeCanvas(cw, ch);
    const g = art.getContext("2d") as Ctx;
    g.translate(2, 2);
    g.strokeStyle = BRAND.yellow;
    g.fillStyle = BRAND.yellow;
    g.lineWidth = border;
    g.beginPath();
    g.roundRect(border / 2, border / 2, bw - border, bh - border, size * 0.12);
    g.stroke();
    g.lineWidth = border * 0.4;
    const inset = border * 2;
    g.beginPath();
    g.roundRect(inset, inset, bw - inset * 2, bh - inset * 2, size * 0.06);
    g.stroke();
    g.font = font(size);
    setSpacing(g, size * 0.06);
    g.textBaseline = "middle";
    g.textAlign = "left";
    lines.forEach((l, i) => g.fillText(l, (bw - widths[i]) / 2, border + pad * 0.7 + lh * (i + 0.5) + size * 0.04));
    // Wear: knock out speckles and a couple of scuffs.
    const rand = rng(key);
    g.globalCompositeOperation = "destination-out";
    const count = Math.round((bw * bh) / (size * size) * 40);
    for (let k = 0; k < count; k++) {
      g.globalAlpha = 0.4 + rand() * 0.6;
      g.beginPath();
      g.arc(rand() * bw, rand() * bh, size * (0.006 + rand() * rand() * 0.04), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.5;
    g.lineWidth = size * 0.02;
    g.lineCap = "round";
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      const sx = rand() * bw;
      const sy = rand() * bh;
      g.moveTo(sx, sy);
      g.lineTo(sx + (rand() - 0.3) * bw * 0.4, sy + (rand() - 0.5) * size * 0.3);
      g.stroke();
    }
    if (stampCache.size > 40) stampCache.delete(stampCache.keys().next().value!);
    stampCache.set(key, art);
  }

  applyMotion(ctx, t, box, m, size, W, true);
  ctx.globalAlpha *= 0.92;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = size * 0.15;
  ctx.drawImage(art, box.x - 2, box.y - 2);
  return box;
}

/* ───────────────────────────── Neon ───────────────────────────── */

/** On/off pattern of a neon tube striking up. */
function flicker(p: number) {
  if (p >= 1) return 1;
  const steps: [number, number][] = [
    [0.12, 0.15],
    [0.2, 0.9],
    [0.28, 0.2],
    [0.42, 1],
    [0.5, 0.45],
  ];
  for (const [until, v] of steps) if (p < until) return v;
  return 1;
}

/** Glowing sign: white-hot letters in a yellow tube frame, flickering on as it appears. */
function drawNeon(ctx: Ctx, t: TextClip, W: number, H: number, size0: number, m: Motion, rot: number): TextBox {
  const fam = fontFamily(t.font);
  const { size, lines } = fitLines(ctx, t.text || " ", size0, (s) => `600 ${s}px ${fam}`, W * 0.72, 3, 0.02);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const lh = size * 1.25;
  const pad = size * 0.55;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(...widths) + pad * 2;
  const bh = lh * lines.length + pad * 1.2;
  const box = anchorBox(t, W, H, bw, bh, rot);
  const reveal = applyMotion(ctx, t, box, m, size, W);
  if (m.anim !== "none") ctx.globalAlpha *= flicker(m.inP);
  const shown = revealLines(lines, reveal);
  const cx = box.x + box.w / 2;
  const top = box.y + pad * 0.6;
  const glow = BRAND.yellow;
  const r = size * 0.4;

  // Dark backplate so the glow reads over bright shots.
  ctx.fillStyle = "rgba(10,10,10,0.55)";
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, r);
  ctx.fill();

  const tube = (draw: () => void) => {
    ctx.shadowColor = glow;
    ctx.strokeStyle = glow;
    ctx.shadowBlur = size * 0.6;
    ctx.lineWidth = size * 0.07;
    draw();
    ctx.shadowBlur = size * 0.2;
    draw();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#FFF7D1";
    ctx.lineWidth = size * 0.025;
    draw();
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  tube(() => {
    ctx.beginPath();
    ctx.roundRect(box.x + size * 0.12, box.y + size * 0.12, box.w - size * 0.24, box.h - size * 0.24, r * 0.75);
    ctx.stroke();
  });
  // Letters: glow, then a white-hot core.
  shown.forEach((l, i) => {
    const y = top + lh * (i + 0.5);
    ctx.shadowColor = glow;
    ctx.shadowBlur = size * 0.5;
    ctx.fillStyle = glow;
    ctx.fillText(l, cx, y);
    ctx.shadowBlur = size * 0.15;
    ctx.fillStyle = "#FFF7D1";
    ctx.fillText(l, cx, y);
  });
  return box;
}

/* ───────────────────────────── Entry ───────────────────────────── */

const DRAW = { plain: drawPlain, badge: drawBadge, pop3d: drawPop3D, marker: drawMarker, stamp: drawStamp, neon: drawNeon };

/** Draws a text clip at `time` (must be within the clip) and returns its box for hit-testing. */
export function drawText(ctx: Ctx, t: TextClip, W: number, H: number, time: number): TextBox {
  const size = t.size * (H / 1080);
  const anim = textAnim(t);
  // Legacy fade clips scaled their fade to the clip; new clips use the chosen duration.
  // Typing may take most of the clip; it then fades out quickly instead of over the typing time.
  const typing = anim === "typewriter";
  const d = Math.max(0.05, Math.min(t.animDur ?? Math.min(0.4, t.duration / 3), t.duration * (typing ? 0.85 : 0.5)));
  const dOut = typing ? Math.min(0.3, t.duration * 0.15) : d;
  const m: Motion = {
    anim,
    inP: anim === "none" ? 1 : clamp01((time - t.start) / d),
    outP: anim === "none" ? 1 : clamp01((t.start + t.duration - time) / dOut),
  };
  const rot = (textRotation(t) * Math.PI) / 180;
  ctx.save();
  const box = DRAW[textStyle(t)](ctx, t, W, H, size, m, rot);
  ctx.restore();
  return box;
}
