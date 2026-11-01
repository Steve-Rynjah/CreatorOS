import type { Cue } from "./types";
import { uid } from "./timing";

function srtTime(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(cues: Cue[]) {
  return [...cues]
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join("\n");
}

export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  const re = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/;
  for (const b of blocks) {
    const lines = b.trim().split("\n");
    const idx = lines.findIndex((l) => re.test(l));
    if (idx < 0) continue;
    const m = re.exec(lines[idx])!;
    const t = (h: string, mi: string, s: string, ms: string) => +h * 3600 + +mi * 60 + +s + +ms.padEnd(3, "0").slice(0, 3) / 1000;
    const body = lines.slice(idx + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (!body) continue;
    cues.push({ id: uid(), start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: body });
  }
  return cues;
}

/**
 * Whisper returns sentence-sized segments; split them into readable captions
 * (≤ maxChars, ≤ 2 lines) and share the time proportionally to text length.
 */
export function segmentsToCues(segments: { start: number; end: number; text: string }[], maxChars = 42): Cue[] {
  const cues: Cue[] = [];
  for (const seg of segments) {
    const words = seg.text.replace(/\s+/g, " ").trim().split(" ");
    const groups: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      // Prefer to break after punctuation once a caption is reasonably long.
      if (next.length > maxChars && cur) {
        groups.push(cur);
        cur = w;
      } else if (/[.!?,;:]$/.test(w) && next.length > maxChars * 0.6) {
        groups.push(next);
        cur = "";
      } else cur = next;
    }
    if (cur) groups.push(cur);
    const totalChars = groups.reduce((s, g) => s + g.length, 0) || 1;
    let t = seg.start;
    const dur = seg.end - seg.start;
    for (const g of groups) {
      const d = (dur * g.length) / totalChars;
      cues.push({ id: uid(), start: t, end: t + d, text: g });
      t += d;
    }
  }
  return cues;
}
