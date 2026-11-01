import type { Project } from "./types";

/** Seconds image i is on screen: its own (script-timed) length, or the fixed seconds per image. */
export function clipDur(p: Pick<Project, "images" | "secondsPerImage">, i: number) {
  return p.images[i]?.duration ?? p.secondsPerImage;
}

export function imagesTotal(p: Pick<Project, "images" | "secondsPerImage">) {
  let t = 0;
  for (let i = 0; i < p.images.length; i++) t += clipDur(p, i);
  return t;
}

/**
 * Fixed-length mode: images are laid back-to-back and END together with the narration,
 * so the first image starts at (voice-over − images total).
 * e.g. 125.18s voice-over, 24 images × 5s = 120s → first image at 5.18s.
 * Script mode sets offsetOverride = 0 and each image's duration to its shot's narration.
 */
export function autoOffset(audioDuration: number, imageCount: number, secondsPerImage: number) {
  return Math.max(0, audioDuration - imageCount * secondsPerImage);
}

export function offsetOf(p: Pick<Project, "audioDuration" | "images" | "secondsPerImage" | "offsetOverride">) {
  return p.offsetOverride ?? Math.max(0, p.audioDuration - imagesTotal(p));
}

export function imagesEnd(p: Project) {
  return offsetOf(p) + imagesTotal(p);
}

export function totalDuration(p: Project) {
  const textEnd = p.texts.reduce((m, t) => Math.max(m, t.start + t.duration), 0);
  return Math.max(p.audioDuration, imagesEnd(p), textEnd);
}

export function clipStart(p: Pick<Project, "audioDuration" | "images" | "secondsPerImage" | "offsetOverride">, i: number) {
  let t = offsetOf(p);
  for (let k = 0; k < i; k++) t += clipDur(p, k);
  return t;
}

/** Index of the image on screen at `time`: -1 before the first, the last one after the end. */
export function clipIndexAt(p: Project, time: number) {
  let t = offsetOf(p);
  if (time < t) return -1;
  for (let i = 0; i < p.images.length; i++) {
    t += clipDur(p, i);
    if (time < t) return i;
  }
  return p.images.length - 1;
}

/** "00:02:05.18" — hours:minutes:seconds.hundredths */
export function formatTime(t: number, withHours = true) {
  const neg = t < 0;
  t = Math.abs(t);
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const pad = (n: number) => String(n).padStart(2, "0");
  const body = withHours || h ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(c)}` : `${pad(m)}:${pad(s)}.${pad(c)}`;
  return (neg ? "-" : "") + body;
}

/** Short ruler label: 0:05, 1:30, 1:02:00 */
export function formatRuler(t: number) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const frac = t % 1 ? `.${Math.round((t % 1) * 10)}` : "";
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}${frac}`;
}

/** Parses "1:05.18", "65.18", "00:01:05.18", "00:01:05,180" → seconds. */
export function parseTime(s: string): number | null {
  const str = s.trim().replace(",", ".");
  if (!str) return null;
  const parts = str.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
