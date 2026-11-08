import type { ParsedScript } from "@/lib/script";
import type { ImageMotion, Sentence, ShortState, ShotMeta } from "./types";

/**
 * Which script shots a Short uses, and which vertical image goes on each.
 * Shots in a row that use the same picture count as one image (a "group").
 */

export type ShotGroup = {
  /** The group's first shot number: what the image is made for, and the key of a hand mapping. */
  key: number;
  shots: number[];
  /** Index of the group's first sentence: its image comes on when this sentence starts. */
  sentence: number;
  motion: ImageMotion;
};

const REUSE = /\bre-?us(?:e|es|ed|ing)\b/i;
/** Share of shared words above which two VISUAL descriptions are the same picture. */
const NEAR_IDENTICAL = 0.85;

const motionOf = (text = ""): ImageMotion => (/zoom\s*-?\s*out|pull\s*(?:back|out)/i.test(text) ? "zoom-out" : "zoom-in");

export function shotMeta(script: ParsedScript): Record<number, ShotMeta> {
  return Object.fromEntries(script.parts.flatMap((p) => p.shots.map((s) => [s.n, { visual: s.visual, motion: s.motion }])));
}

function words(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function similarity(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (x.size < 3 || y.size < 3) return 0;
  let shared = 0;
  x.forEach((w) => y.has(w) && shared++);
  return (2 * shared) / (x.size + y.size);
}

/** "Reuse" joins the shots before it unless it names some other shot ("Reuse shot 3"). */
function continuesGroup(group: number[], prev: ShotMeta | undefined, cur: ShotMeta | undefined) {
  if (!prev || !cur) return false;
  if (REUSE.test(cur.visual)) {
    const named = /shot\s*#?\s*(\d+)/i.exec(cur.visual);
    return !named || group.includes(Number(named[1]));
  }
  return similarity(prev.visual, cur.visual) >= NEAR_IDENTICAL;
}

/** The image groups of sentences [from..to], in order. Without script details every shot is its own image. */
export function shotGroups(sentences: Sentence[], from: number, to: number, meta: Record<number, ShotMeta> = {}): ShotGroup[] {
  const groups: ShotGroup[] = [];
  let last: number | null = null;
  for (let i = from; i <= to; i++) {
    const n = sentences[i].shot;
    if (n === last) continue;
    const group = groups[groups.length - 1];
    if (group && last !== null && continuesGroup(group.shots, meta[last], meta[n])) group.shots.push(n);
    else groups.push({ key: n, shots: [n], sentence: i, motion: motionOf(meta[n]?.motion) });
    last = n;
  }
  return groups;
}

const pad = (n: number) => String(n).padStart(3, "0");

/** "Short 2: shots 007, 008, 009, 011" */
export function shotListLine(n: number, groups: ShotGroup[]) {
  return `Short ${n}: shot${groups.length === 1 ? "" : "s"} ${groups.map((g) => pad(g.key)).join(", ")}`;
}

/** "010 reuses 009" for every shot folded into the image before it. */
export function reusedShots(groups: ShotGroup[]) {
  return groups.flatMap((g) => g.shots.slice(1).map((s) => `${pad(s)} reuses ${pad(g.key)}`));
}

/** Image path for each group: the hand mapping if there is one, otherwise 01.png → first group and so on. */
export function assignedImages(short: Pick<ShortState, "images" | "mapping">, groups: ShotGroup[]): (string | null)[] {
  if (short.mapping) return groups.map((g) => short.mapping![g.key] ?? null);
  return groups.map((_, i) => short.images?.[i]?.path ?? null);
}

/**
 * Seconds from the Short's start that each group is on screen: from when its first sentence
 * starts to when the next group's does. The first opens the clip; the last closes it.
 */
export function groupSpans(sentences: Sentence[], groups: ShotGroup[], clipStart: number, clipLength: number) {
  const starts = groups.map((g, i) => (i === 0 ? 0 : Math.min(clipLength, Math.max(0, sentences[g.sentence].start - clipStart))));
  return groups.map((_, i) => ({ from: starts[i], to: i + 1 < groups.length ? starts[i + 1] : clipLength }));
}
