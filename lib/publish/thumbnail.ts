import { fileUrl, loadImage } from "@/lib/editor/render";
import { fontFamily, preloadCanvasFonts } from "@/lib/fonts";
import { LIMITS, type ThumbSpec } from "./kit";

export const THUMB_W = 1280;
export const THUMB_H = 720;

const images = new Map<string, Promise<HTMLImageElement>>();
function image(path: string) {
  let p = images.get(path);
  if (!p) {
    p = loadImage(fileUrl(path));
    images.set(path, p);
    p.catch(() => images.delete(path));
  }
  return p;
}

/** Splits text into lines no wider than `max`, shrinking the font if one word alone is too wide. */
function layout(ctx: CanvasRenderingContext2D, text: string, size: number, max: number) {
  const family = fontFamily("montserrat");
  const wordsOf = text.toUpperCase().split(/\s+/).filter(Boolean);
  let s = size;
  for (;;) {
    ctx.font = `italic 900 ${s}px ${family}`;
    const widest = Math.max(0, ...wordsOf.map((w) => ctx.measureText(w).width));
    if (widest <= max || s <= 24) break;
    s -= 4;
  }
  const lines: string[] = [];
  let cur = "";
  for (const w of wordsOf) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > max) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return { lines, size: s };
}

/** Draws the thumbnail: the shot cropped to 16:9, bold outlined text, optional dark band. */
export async function drawThumb(canvas: HTMLCanvasElement, spec: ThumbSpec) {
  await preloadCanvasFonts();
  const img = await image(spec.image);
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  const s = Math.max(THUMB_W / img.naturalWidth, THUMB_H / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.drawImage(img, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);

  const text = spec.text.trim();
  if (!text) return;

  const side = spec.position === "left" || spec.position === "right";
  const pad = 48;
  const maxW = side ? THUMB_W * 0.5 - pad : THUMB_W - pad * 2;
  const { lines, size } = layout(ctx, text, spec.size, maxW);
  const lineH = size * 1.02;
  const blockH = lineH * lines.length;

  let x: number;
  let y: number; // top of the text block
  ctx.textAlign = spec.position === "right" ? "right" : spec.position === "left" ? "left" : "center";
  if (side) {
    x = spec.position === "left" ? pad : THUMB_W - pad;
    y = (THUMB_H - blockH) / 2;
  } else {
    x = THUMB_W / 2;
    y = spec.position === "top" ? pad : THUMB_H - pad - blockH;
  }

  if (spec.band) {
    ctx.save();
    if (side) {
      const g = ctx.createLinearGradient(spec.position === "left" ? 0 : THUMB_W, 0, THUMB_W / 2, 0);
      g.addColorStop(0, "rgba(0,0,0,0.78)");
      g.addColorStop(0.75, "rgba(0,0,0,0.5)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(spec.position === "left" ? 0 : THUMB_W / 2 - 80, 0, THUMB_W / 2 + 80, THUMB_H);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      ctx.fillRect(0, y - pad * 0.55, THUMB_W, blockH + pad * 1.1);
    }
    ctx.restore();
  }

  ctx.font = `italic 900 ${size}px ${fontFamily("montserrat")}`;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    const ly = y + i * lineH;
    // Hard drop shadow, then a thick black outline, then the fill.
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillText(line, x + size * 0.06, ly + size * 0.08);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = Math.max(8, size * 0.2);
    ctx.strokeText(line, x, ly);
    ctx.fillStyle = spec.color;
    ctx.fillText(line, x, ly);
  });
}

/** JPEG under YouTube's 2 MB limit: starts at high quality and steps down only if needed. */
export async function thumbJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  let q = 0.92;
  for (;;) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (!blob) throw new Error("Could not encode the thumbnail.");
    if (blob.size < LIMITS.thumbBytes || q <= 0.5) return blob;
    q -= 0.08;
  }
}

export async function renderThumb(spec: ThumbSpec): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await drawThumb(canvas, spec);
  return thumbJpeg(canvas);
}
