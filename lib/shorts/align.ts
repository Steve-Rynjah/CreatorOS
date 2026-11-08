import type { Cue } from "@/lib/editor/types";
import type { SavedScript } from "@/lib/publish/kit";
import type { ParsedScript } from "@/lib/script";
import { norm } from "./sentences";
import type { Sentence, TimedWord } from "./types";

/**
 * Puts real times on the script's sentences from any stream of timed words:
 * Home's subtitle words, local Whisper, or pause-matched captions.
 *
 * The heard words are aligned to the script's words with a global sequence
 * alignment (Needleman–Wunsch, free gaps at both ends of the heard stream), so
 * misheard names ("Archie goes" for "Archegos"), spoken title cards and missing
 * words don't shift the rest. Script words that matched nothing get times
 * interpolated between their neighbours.
 */
export function timeSentences(sentences: Sentence[], heard: TimedWord[], duration: number): { sentences: Sentence[]; matched: number } {
  const script = sentences.flatMap((s) => s.words.map((w) => norm(w.text)));
  const said = heard.map((w) => norm(w.text));
  const n = script.length;
  const m = said.length;
  const times: ([number, number] | null)[] = new Array(n).fill(null);

  if (n && m) {
    const GAP = -1;
    const W = m + 1;
    // 0 = diagonal, 1 = up (script word unheard), 2 = left (extra heard word)
    const back = new Uint8Array((n + 1) * W);
    let prev = new Float32Array(W); // row 0: leading heard words are free
    let cur = new Float32Array(W);
    for (let j = 1; j <= m; j++) back[j] = 2;
    for (let i = 1; i <= n; i++) {
      cur[0] = prev[0] + GAP;
      back[i * W] = 1;
      const a = script[i - 1];
      for (let j = 1; j <= m; j++) {
        const d = prev[j - 1] + similarity(a, said[j - 1]);
        const u = prev[j] + GAP;
        const l = cur[j - 1] + GAP;
        if (d >= u && d >= l) {
          cur[j] = d;
          back[i * W + j] = 0;
        } else if (u >= l) {
          cur[j] = u;
          back[i * W + j] = 1;
        } else {
          cur[j] = l;
          back[i * W + j] = 2;
        }
      }
      [prev, cur] = [cur, prev];
    }
    // Trailing heard words are free too: end at the best cell of the last row.
    let j = 0;
    for (let k = 1; k <= m; k++) if (prev[k] > prev[j]) j = k;
    let i = n;
    while (i > 0 && j > 0) {
      const b = back[i * W + j];
      if (b === 0) {
        if (similarity(script[i - 1], said[j - 1]) > 0) times[i - 1] = [heard[j - 1].start, heard[j - 1].end];
        i--;
        j--;
      } else if (b === 1) i--;
      else j--;
    }
  }

  const matched = n ? times.filter(Boolean).length / n : 0;
  if (!matched) throw new Error("None of the script's words were heard in this video. Is it the right video for this script?");

  // Unmatched words share the time between their matched neighbours.
  for (let i = 0; i < n; ) {
    if (times[i]) {
      i++;
      continue;
    }
    let k = i;
    while (k < n && !times[k]) k++;
    const from = i > 0 ? times[i - 1]![1] : 0;
    const to = k < n ? times[k]![0] : Math.max(from, duration);
    const step = (to - from) / (k - i);
    for (let x = i; x < k; x++) times[x] = [from + step * (x - i), from + step * (x - i + 1)];
    i = k;
  }

  let w = 0;
  let floor = 0;
  const timed = sentences.map((s) => {
    const words = s.words.map((word) => {
      const [a, b] = times[w++]!;
      const start = Math.max(floor, a);
      floor = start;
      return { text: word.text, start, end: Math.max(start + 0.05, b) };
    });
    return { ...s, words, start: words[0].start, end: words[words.length - 1].end };
  });
  return { sentences: timed, matched };
}

/** +2 same word, +1 near miss ("hwangs"/"hwang", "archie"/"archegos"), −1 different. */
function similarity(a: string, b: string) {
  if (!a || !b) return -1;
  if (a === b) return 2;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 1;
  if (a.length >= 4 && b.length >= 4 && editDistance(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 4))) return 1;
  return -1;
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Caption cues → timed words, each word getting a share of its cue by length (or its own start when known). */
export function cuesToWords(cues: { start: number; end: number; text: string; words?: number[] }[], offset = 0): TimedWord[] {
  const out: TimedWord[] = [];
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    const tokens = c.text.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const chars = tokens.reduce((s, t) => s + t.length + 1, 0);
    let acc = 0;
    tokens.forEach((t, k) => {
      const known = c.words?.[k];
      const start = known !== undefined ? known : c.start + ((c.end - c.start) * acc) / chars;
      acc += t.length + 1;
      const nextKnown = c.words?.[k + 1];
      const end = k + 1 < tokens.length ? (nextKnown !== undefined ? nextKnown : c.start + ((c.end - c.start) * acc) / chars) : c.end;
      out.push({ text: t, start: start + offset, end: Math.max(start, end) + offset });
    });
  }
  return out;
}

const wordsOf = (s: string) => s.split(/\s+/).map(norm).filter(Boolean);

/** Share of `a`'s words that also occur in `b`. */
function textMatch(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  return a.filter((w) => set.has(w)).length / a.length;
}

/**
 * Tier 1: the long video was made in CreatorOS. Every script part has a Home
 * edit whose subtitles say the same words, and together they are as long as the
 * video — so those subtitle words, chained part after part, are the real timing.
 */
export function homeWords(
  script: ParsedScript,
  homes: SavedScript[],
  duration: number,
): { words: TimedWord[]; note: string } | null {
  const scriptWords = script.parts.map((p) => wordsOf(p.shots.map((s) => s.narration).join(" ")));
  let best: { words: TimedWord[]; note: string; diff: number } | null = null;
  for (const group of homes) {
    const chosen = script.parts.map((part, pi) => {
      const options = group.parts.filter((sp) => sp.project.script?.part === part.title && sp.project.cues?.length);
      let pick: (typeof options)[number] | null = null;
      let score = 0;
      for (const o of options) {
        const s = textMatch(scriptWords[pi], wordsOf((o.project.cues ?? []).map((c) => c.text).join(" ")));
        if (s > score) {
          score = s;
          pick = o;
        }
      }
      return score >= 0.85 ? pick : null;
    });
    if (chosen.some((c) => !c)) continue;
    const total = chosen.reduce((s, c) => s + c!.duration, 0);
    const diff = Math.abs(total - duration);
    if (diff > 1.5 * chosen.length) continue;
    const words: TimedWord[] = [];
    let offset = 0;
    for (const c of chosen) {
      words.push(...cuesToWords((c!.project.cues ?? []) as Cue[], offset));
      offset += c!.duration;
    }
    if (!best || diff < best.diff) {
      best = { words, diff, note: `Matched your Home edits of “${group.file}” (${chosen.length} parts, within ${diff.toFixed(1)} s of the video).` };
    }
  }
  return best && { words: best.words, note: best.note };
}

/**
 * Moves sentence edges that fall in a pause onto the voice: Whisper often starts a word
 * that follows a silence a second early (in the pause, or over a title card). A start in
 * a pause moves to where speech resumes; an end in a pause moves back to where it stopped.
 * `speech` is the video's speaking spans from silence detection.
 */
export function snapToSpeech(sentences: Sentence[], speech: [number, number][]): Sentence[] {
  if (speech.length < 2) return sentences; // no pauses found (music bed, or silence detection failed)
  const inSpeech = (t: number) => speech.some(([a, b]) => t >= a - 0.02 && t <= b + 0.02);
  return sentences.map((s) => {
    if (!s.words.length) return s;
    const words = s.words.map((w) => ({ ...w }));
    const first = words[0];
    const last = words[words.length - 1];
    if (!inSpeech(first.start)) {
      const next = speech.find(([a]) => a > first.start);
      if (next && next[0] < first.end) first.start = next[0];
    }
    if (!inSpeech(last.end)) {
      const prev = [...speech].reverse().find(([, b]) => b < last.end);
      if (prev && prev[1] > last.start) last.end = prev[1];
    }
    return { ...s, words, start: first.start, end: last.end };
  });
}
