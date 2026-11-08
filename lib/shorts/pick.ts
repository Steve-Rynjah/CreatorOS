import type { Candidate, Reason, Sentence, ShortState } from "./types";

/**
 * Picks the three Shorts with fixed rules — no AI. Every clip starts at the
 * start of a sentence and ends at the end of one.
 */

export const TARGETS = [35, 45, 30] as const;
export const SLACK = 5;

export const MONEY = /\$|\bbillions?\b|\bmillions?\b|\btrillions?\b|%|\bpercent\b|\ba year\b|\b(?:1[89]|20)\d\d\b|\b\d{1,3}(?:,\d{3})+\b/i;
export const TENSION =
  /\b(?:refused|collaps\w*|gone|lost|mistakes?|panic\w*|never|nobody|secrets?|crash\w*|wrong|suddenly|billions?|fraud\w*|frantic\w*|disappeared|warnings?)\b/i;
const CONTEXT_START = /^["“‘']?(?:and|so|that|this|it|meanwhile|then|because|he|she|they)\b/i;

const wordCount = (s: Sentence) => s.words.length;
export const isQuestion = (s: Sentence) => /\?["'”’)]*$/.test(s.text);
export const needsContext = (s: Sentence) => CONTEXT_START.test(s.text);

/** A sentence may go in a Short: not the standard ending, not a call to subscribe. */
export const usable = (s: Sentence) => !s.outro && !s.banned;

export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

/** Points for a clip of sentences [from..to], with the reasons behind them. */
export function scoreClip(sentences: Sentence[], from: number, to: number): { score: number; reasons: Reason[] } {
  const list = sentences.slice(from, to + 1);
  const reasons: Reason[] = [];
  const add = (label: string, points: number) => points && reasons.push({ label, points });
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const money = list.filter((s) => MONEY.test(s.text)).length;
  add(plural(money, "sentence with a money figure or big number", "sentences with money figures or big numbers"), 3 * money);
  if (list.some((s) => s.partEnd)) add("Includes the end of a part (cliffhanger)", 3);
  const last = list[list.length - 1];
  if (isQuestion(last)) add("Ends on a question", 3);
  else if (wordCount(last) <= 5) add("Ends on a short, tense line", 3);
  const tense = list.filter((s) => TENSION.test(s.text)).length;
  add(plural(tense, "sentence with tension words", "sentences with tension words"), 2 * tense);
  if (list.some((s) => s.onScreen)) add("Has on-screen text", 2);
  const punchy = list.filter((s) => wordCount(s) <= 6).length;
  add(plural(punchy, "punchy sentence (6 words or fewer)", "punchy sentences (6 words or fewer)"), punchy);
  if (needsContext(list[0])) add(`Opens with “${list[0].text.split(" ")[0]}…”, which needs earlier context`, -4);
  const verify = list.filter((s) => s.verify).length;
  add(plural(verify, "claim still marked [VERIFY]", "claims still marked [VERIFY]"), -3 * verify);

  return { score: reasons.reduce((s, r) => s + r.points, 0), reasons: reasons.sort((a, b) => b.points - a.points) };
}

/** Every clip of usable, consecutive sentences within ±5 s of `target`. */
export function candidates(sentences: Sentence[], target: number): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < sentences.length; i++) {
    if (!usable(sentences[i])) continue;
    for (let j = i; j < sentences.length && usable(sentences[j]); j++) {
      const d = sentences[j].end - sentences[i].start;
      if (d > target + SLACK) break;
      if (d < target - SLACK) continue;
      out.push({ from: i, to: j, start: sentences[i].start, end: sentences[j].end, ...scoreClip(sentences, i, j) });
    }
  }
  return out.sort((a, b) => b.score - a.score || Math.abs(a.end - a.start - target) - Math.abs(b.end - b.start - target));
}

/** The hook's question may land anywhere in this many seconds from the first word. */
export const HOOK_RANGE = { min: 15, max: 50 } as const;

/**
 * Short 1, the hook: from the first spoken word to the end of a question ("Who was the
 * man behind it?"), the question nearest 35 s. Without one, the sentence end nearest 35 s.
 * Questions come first in the list, then the other endings by distance from the target.
 */
export function hookCandidates(sentences: Sentence[], target: number = TARGETS[0]): Candidate[] {
  const ends: Candidate[] = [];
  const t0 = sentences[0]?.start ?? 0;
  for (let j = 0; j < sentences.length && usable(sentences[j]); j++) {
    if (sentences[j].end - t0 > HOOK_RANGE.max) break;
    ends.push({ from: 0, to: j, start: t0, end: sentences[j].end, ...scoreClip(sentences, 0, j) });
  }
  const near = (c: Candidate) => Math.abs(c.end - c.start - target);
  const question = (c: Candidate) => isQuestion(sentences[c.to]) && c.end - c.start >= HOOK_RANGE.min;
  return ends.sort((a, b) => Number(question(b)) - Number(question(a)) || near(a) - near(b));
}

export const SAME_PART: Reason = { label: "Same part of the video as Short 2", points: -2 };

/**
 * The three picks. Short 2 (45 s) and Short 3 (30 s) are the best-scoring pair
 * that overlap neither each other nor the hook, −2 when they share a part.
 */
export function pickShorts(sentences: Sentence[]): { picks: [Candidate, Candidate, Candidate]; notes: string[] } {
  const notes: string[] = [];
  const hook = hookCandidates(sentences)[0];
  if (!hook) throw new Error("The script's first sentences couldn't be timed, so there is no hook Short.");
  const free = (c: Candidate) => !overlaps(c, hook);
  const two = candidates(sentences, TARGETS[1]).filter(free).slice(0, 120);
  const three = candidates(sentences, TARGETS[2]).filter(free).slice(0, 120);
  let best: { a: Candidate; b: Candidate; total: number } | null = null;
  for (const a of two) {
    if (best && a.score + (three[0]?.score ?? 0) <= best.total) break;
    for (const b of three) {
      if (best && a.score + b.score <= best.total) break;
      if (overlaps(a, b)) continue;
      const total = a.score + b.score + (samePart(sentences, a, b) ? SAME_PART.points : 0);
      if (!best || total > best.total) best = { a, b, total };
    }
  }
  if (!best) throw new Error("Couldn't find two more clips of 40–50 s and 25–35 s that don't overlap. Is the video long enough?");
  const b = samePart(sentences, best.a, best.b)
    ? { ...best.b, score: best.b.score + SAME_PART.points, reasons: [...best.b.reasons, SAME_PART] }
    : best.b;
  if (best.a.score <= 0 || b.score <= 0) notes.push("The best clips scored low. Check them in the editor.");
  return { picks: [hook, best.a, b], notes };
}

export function samePart(sentences: Sentence[], a: { from: number }, b: { from: number }) {
  return sentences[a.from].partKey === sentences[b.from].partKey;
}

/**
 * The next best clips for one Short: same target length, clear of the other two
 * Shorts, and each one a different stretch of the video (not the same clip shifted
 * by a sentence).
 */
export function alternatives(sentences: Sentence[], shorts: ShortState[], n: 1 | 2 | 3, count = 5): Candidate[] {
  const me = shorts.find((s) => s.n === n)!;
  const others = shorts.filter((s) => s.n !== n).map((s) => ({ start: sentences[s.from].start, end: sentences[s.to].end }));
  const pool = n === 1 ? hookCandidates(sentences, me.target) : candidates(sentences, me.target);
  const mine = { start: sentences[me.from].start, end: sentences[me.to].end };
  const shared = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) / Math.min(a.end - a.start, b.end - b.start);
  const out: Candidate[] = [];
  for (const c of pool) {
    if (c.from === me.from && c.to === me.to) continue;
    if (n !== 1 && others.some((o) => overlaps(o, c))) continue;
    if (n !== 1 && shared(c, mine) > 0.5) continue;
    if (n !== 1 && out.some((o) => shared(o, c) > 0.5)) continue;
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}
