"use client";
import { shortsAnton, shortsMontserrat } from "@/lib/fonts";
import { BRAND, CAPTION, CENTER_X, END_TAG, FRAME, GRADIENT, HOOK, VIDEO, baselineFor, imageScale, specLength, type Measure } from "./layout";
import type { RenderSpec } from "./types";

/**
 * Draws a Short on a canvas exactly as ffmpeg/libass will render it, from the
 * same RenderSpec and the same font files.
 */

const FAMILY = { anton: shortsAnton.style.fontFamily, montserrat: shortsMontserrat.style.fontFamily } as const;
const fontCss = (font: keyof typeof FAMILY, size: number) => `${font === "montserrat" ? 900 : 400} ${size}px ${FAMILY[font]}`;

let fontsReady: Promise<void> | null = null;
export function loadShortFonts() {
  fontsReady ??= Promise.all([document.fonts.load(fontCss("anton", 40)), document.fonts.load(fontCss("montserrat", 40))]).then(() => {});
  return fontsReady;
}

let mctx: CanvasRenderingContext2D | null = null;
export const measure: Measure = (text, font, size) => {
  mctx ??= document.createElement("canvas").getContext("2d");
  if (!mctx) return text.length * size * 0.6;
  mctx.font = fontCss(font, size);
  return mctx.measureText(text).width;
};

/** 100% → 110% over 70 ms, back to 100% by 150 ms (the libass \t pair). */
function popScale(since: number) {
  if (since < 0) return 1;
  if (since < 0.07) return 1 + (CAPTION.pop - 1) * (since / 0.07);
  if (since < 0.15) return CAPTION.pop - (CAPTION.pop - 1) * ((since - 0.07) / 0.08);
  return 1;
}

function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, outline: number, fill: string) {
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = outline * 2;
  ctx.strokeStyle = "#000";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawGradient(ctx: CanvasRenderingContext2D, stops: readonly (readonly [number, number])[]) {
  const y0 = stops[0][0];
  const y1 = stops[stops.length - 1][0];
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [y, a] of stops) g.addColorStop((y - y0) / (y1 - y0), `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, FRAME.w, y1 - y0);
}

/** One frame of the Short. `t` is seconds from the Short's start; `video` may be null (layout only). */
export function drawShort(
  ctx: CanvasRenderingContext2D,
  spec: RenderSpec,
  t: number,
  video: HTMLVideoElement | null,
  images: Map<string, HTMLImageElement> = new Map(),
) {
  const { w: W, h: H } = FRAME;
  const s = ctx.canvas.width / W;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const vw = video?.videoWidth ?? 0;
  const vh = video?.videoHeight ?? 0;
  const shot = spec.shots.find((x) => t >= x.from && t < x.to);
  const image = shot && images.get(shot.image);
  if (shot && image?.naturalWidth) {
    // Full-screen image, covering the frame, zooming about its centre.
    const scale = imageScale(shot.motion, (t - shot.from) / (shot.to - shot.from));
    const cover = Math.max(W / image.naturalWidth, H / image.naturalHeight) * scale;
    const dw = image.naturalWidth * cover;
    const dh = image.naturalHeight * cover;
    ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
    if (spec.hook) drawGradient(ctx, GRADIENT.top);
    drawGradient(ctx, GRADIENT.bottom);
  } else if (video && vw && vh) {
    // The old subtitles are cut off the bottom of the source before anything is drawn.
    const sh = vh * (1 - spec.crop);
    // Background: the cropped clip filling the frame, blurred and 40% darker.
    const cover = Math.max(W / vw, H / sh);
    ctx.filter = `blur(${56 * s}px) brightness(0.6)`;
    ctx.drawImage(video, 0, 0, vw, sh, (W - vw * cover) / 2, (H - sh * cover) / 2, vw * cover, sh * cover);
    ctx.filter = "none";
    // Main video: a 4:5 centre crop, 1080×1350.
    const sw = Math.min(vw, sh * VIDEO.aspect);
    ctx.drawImage(video, (vw - sw) / 2, 0, sw, sh, 0, VIDEO.top, VIDEO.w, VIDEO.h);
  } else {
    ctx.fillStyle = "#1d2939";
    ctx.fillRect(0, VIDEO.top, VIDEO.w, VIDEO.h);
  }

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Hook title.
  if (spec.hook) {
    const { size, lines } = spec.hook;
    ctx.font = fontCss("anton", size);
    const space = ctx.measureText(" ").width;
    lines.forEach((words, i) => {
      const cy = HOOK.centerY + (i - (lines.length - 1) / 2) * size * HOOK.lineHeight;
      const y = baselineFor(cy, size, "anton");
      const widths = words.map((w) => ctx.measureText(w.text).width);
      let x = CENTER_X - (widths.reduce((p, c) => p + c, 0) + space * (words.length - 1)) / 2;
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowOffsetX = ctx.shadowOffsetY = 3 * s;
      words.forEach((w, k) => {
        outlinedText(ctx, w.text, x, y, HOOK.outline, w.key ? BRAND.yellow : BRAND.white);
        x += widths[k] + space;
      });
      ctx.shadowColor = "transparent";
    });
  }

  // Captions: the word being spoken is yellow and pops.
  const cap = spec.captions.find((c) => t >= c.start && t < c.end);
  if (cap) {
    let active = 0;
    cap.words.forEach((w, k) => {
      if (t >= (k === 0 ? cap.start : w.start)) active = k;
    });
    const since = t - (active === 0 ? cap.start : cap.words[active].start);
    const pop = popScale(since);
    ctx.font = fontCss("montserrat", cap.size);
    const space = ctx.measureText(" ").width;
    const widths = cap.words.map((w, k) => ctx.measureText(w.text).width * (k === active ? pop : 1));
    let x = CENTER_X - (widths.reduce((p, c) => p + c, 0) + space * (cap.words.length - 1)) / 2;
    const y = baselineFor(CAPTION.centerY, cap.size, "montserrat");
    cap.words.forEach((w, k) => {
      ctx.save();
      const sc = k === active ? pop : 1;
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 6 * s;
      ctx.shadowOffsetX = ctx.shadowOffsetY = CAPTION.shadow * s;
      ctx.lineJoin = "round";
      ctx.lineWidth = CAPTION.outline * 2;
      ctx.strokeStyle = "#000";
      ctx.strokeText(w.text, 0, 0);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = k === active ? BRAND.yellow : BRAND.white;
      ctx.fillText(w.text, 0, 0);
      ctx.restore();
      x += widths[k] + space;
    });
  }

  // End tag.
  if (spec.endTag && t >= spec.endTag.at && t < specLength(spec)) {
    ctx.globalAlpha = Math.min(1, (t - spec.endTag.at) / 0.15);
    const w = spec.endTag.width;
    const h = END_TAG.height;
    const x = CENTER_X - w / 2;
    const y = END_TAG.centerY - h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = "rgba(27,27,27,0.81)";
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x - END_TAG.outline / 2, y - END_TAG.outline / 2, w + END_TAG.outline, h + END_TAG.outline, (h + END_TAG.outline) / 2);
    ctx.lineWidth = END_TAG.outline;
    ctx.strokeStyle = BRAND.yellow;
    ctx.stroke();
    ctx.font = fontCss("montserrat", END_TAG.size);
    const text = `${END_TAG.text} `;
    const tw = ctx.measureText(text).width;
    ctx.font = fontCss("montserrat", END_TAG.size * 1.5);
    const aw = ctx.measureText(END_TAG.arrow).width;
    const bx = CENTER_X - (tw + aw) / 2;
    const by = baselineFor(END_TAG.centerY, END_TAG.size, "montserrat");
    ctx.fillStyle = BRAND.white;
    ctx.font = fontCss("montserrat", END_TAG.size);
    ctx.fillText(text, bx, by);
    ctx.font = fontCss("montserrat", END_TAG.size * 1.5);
    ctx.fillText(END_TAG.arrow, bx + tw, by);
    ctx.globalAlpha = 1;
  }

  // Safe-zone guides are drawn by the preview component, not here (they are not in the render).
  ctx.restore();
}
