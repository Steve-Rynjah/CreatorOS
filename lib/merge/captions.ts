import { segmentsToCues } from "@/lib/editor/subtitles";
import type { Cue } from "@/lib/editor/types";

type Span = [number, number];

/** Sentences and "…" breaks — where a narrator (and the TTS voice) pauses. */
function phrases(shots: string[]): string[] {
  const out: string[] = [];
  for (const shot of shots) {
    for (const m of shot.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g)) {
      const p = m[0].trim();
      if (p) out.push(p);
    }
  }
  return out;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * Roughly how many letters a sentence takes to say: numbers and symbols are read
 * out ("2012" → "twenty twelve", "$44" → "forty-four dollars", "%" → "percent").
 */
function spokenLength(text: string) {
  const out = text
    .replace(/\$/g, " dollars ")
    .replace(/%/g, " percent ")
    .replace(/&/g, " and ")
    .replace(/\b(1[5-9]|20)(\d\d)\b/g, " twenty twelve ") // years
    .replace(/\d+(?:[.,]\d+)*/g, (num) =>
      num
        .replace(/[.,]/g, "")
        .split("")
        .map((d, i, a) => (a.length - i === 3 ? `${ONES[+d]} hundred ` : `${ONES[+d]}ty `))
        .join(""),
    )
    .replace(/[^a-z ]/gi, "")
    .replace(/\s+/g, " ");
  return Math.max(1, out.trim().length);
}

const spokenIn = (speech: Span[], a: number, b: number) =>
  speech.reduce((s, [x, y]) => s + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0);

/** Real time at `t` seconds of speech after `from` (pauses skipped). */
function warp(speech: Span[], from: number, t: number, isEnd: boolean) {
  let acc = 0;
  for (const [x0, y] of speech) {
    const x = Math.max(x0, from);
    if (y <= x) continue;
    const len = y - x;
    if (t < acc + len || (isEnd && t <= acc + len)) return x + Math.max(0, t - acc);
    acc += len;
  }
  return speech[speech.length - 1]?.[1] ?? from;
}

/**
 * Times a part's narration to its video without transcription.
 *
 * The voice pauses between sentences and shots, and ffmpeg finds those pauses.
 * Each sentence start is matched, in order, to the pause that best fits the
 * length of the sentence before it, so timing resets at every sentence instead of
 * drifting. Within a sentence, captions follow the speech in proportion to length.
 */
export function alignToSpeech(shots: string[], speech: Span[], title?: string): Cue[] {
  const plain = align(phrases(shots), speech);
  if (!title?.trim()) return plain.cues;
  // A hook may open with its spoken title card. Try both and keep whichever fits the audio better.
  const titled = align([title.trim(), ...phrases(shots)], speech);
  return titled.cost < plain.cost ? titled.cues : plain.cues;
}

function align(list: string[], speech: Span[]): { cues: Cue[]; cost: number } {
  const spoken = speech.reduce((s, [a, b]) => s + (b - a), 0);
  if (!list.length || spoken <= 0) return { cues: [], cost: Infinity };

  const weights = list.map(spokenLength);
  const total = weights.reduce((s, w) => s + w, 0);
  const start = speech[0][0];
  const end = speech[speech.length - 1][1];
  const rate = spoken / total; // seconds of speech per (spoken) character

  // Anchor points: the part's start, every pause end, the part's end.
  const pts = [start, ...speech.slice(1).map((s) => s[0]), end];
  const P = pts.length;
  const n = list.length;
  // Speaking time between two anchor points, and expected speaking time of sentences [i, k).
  const between = (j1: number, j2: number) => spokenIn(speech, pts[j1], pts[j2]);
  const cumW = [0];
  for (const w of weights) cumW.push(cumW[cumW.length - 1] + w);
  const expect = (i: number, k: number) => (cumW[k] - cumW[i]) * rate;

  // Best path of sentence starts through the pauses (dynamic programming): sentence 0
  // starts at the start, the end closes sentence n; a hop from (i, j1) to (k, j2) costs how
  // far the speech between those points is from what sentences i..k-1 should take, plus a
  // penalty for each sentence in between that gets no pause of its own. Unused pauses
  // (commas, breaths) are free. The whole path is scored, so one odd sentence can't shift the rest.
  const MISS = 0.9;
  const MAX_SKIP = 4;
  const key = (i: number, j: number) => i * P + j;
  const best = new Float64Array((n + 1) * P).fill(Infinity);
  const from = new Int32Array((n + 1) * P).fill(-1);
  best[key(0, 0)] = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < P; j++) {
      const here = best[key(i, j)];
      if (here === Infinity) continue;
      for (let k = i + 1; k <= Math.min(n, i + 1 + MAX_SKIP); k++) {
        const want = expect(i, k);
        const lastK = k === n;
        for (let j2 = j + 1; j2 < P; j2++) {
          if (lastK && j2 !== P - 1) continue;
          if (!lastK && j2 === P - 1) break;
          const got = between(j, j2);
          if (got > want * 2.5 + 2) break;
          const c = here + Math.abs(got - want) + MISS * (k - i - 1);
          if (c < best[key(k, j2)]) {
            best[key(k, j2)] = c;
            from[key(k, j2)] = key(i, j);
          }
        }
      }
    }
  }

  const cost = best[key(n, P - 1)];
  const starts: (number | null)[] = new Array(n).fill(null);
  starts[0] = start;
  if (cost !== Infinity) {
    for (let at = from[key(n, P - 1)]; at > 0; at = from[at]) {
      const i = Math.floor(at / P);
      starts[i] = pts[at % P];
    }
  }

  // Sentences that found no pause share the speech between their neighbours by length.
  for (let i = 1; i < starts.length; ) {
    if (starts[i] !== null) {
      i++;
      continue;
    }
    let k = i;
    while (k < starts.length && starts[k] === null) k++;
    const a = starts[i - 1]!;
    const b = k < starts.length ? starts[k]! : end;
    const chars = list.slice(i - 1, k).reduce((s, p) => s + p.length, 0);
    const room = spokenIn(speech, a, b);
    let c = 0;
    for (let x = i; x < k; x++) {
      c += list[x - 1].length;
      starts[x] = warp(speech, a, (c / chars) * room, false);
    }
    i = k;
  }

  const cues: Cue[] = [];
  list.forEach((text, i) => {
    const a = starts[i]!;
    const b = Math.max(i + 1 < starts.length ? starts[i + 1]! : end, a + 0.3);
    const room = spokenIn(speech, a, b) || b - a;
    for (const c of segmentsToCues([{ start: 0, end: room, text }])) {
      const s = warp(speech, a, c.start, false);
      const e = Math.min(b, warp(speech, a, c.end, true));
      cues.push({ ...c, start: s, end: Math.max(e, s + 0.3) });
    }
  });
  return { cues, cost };
}
