import { chapterOf, type ParsedScript } from "@/lib/script";
import type { Sentence } from "./types";

/** Phrases that belong to the ending, never to a Short. */
const BANNED = /subscribe|hit like|\bcomments?\b|thanks for watching/i;
/** Words that end in a period without ending the sentence. */
const ABBREV = /^(mr|mrs|ms|dr|st|vs|inc|ltd|co|corp|jr|sr|u\.s|e\.g|i\.e|etc|no)\.$/i;

/** On-screen text: no writer's flags, no "..." pauses. */
export function cleanForScreen(text: string) {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s*(?:\.{2,}|…)\s*/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits one shot's narration into sentences; each knows whether it carried a [VERIFY] tag. */
export function splitSentences(text: string): { text: string; verify: boolean }[] {
  const tokens = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: { raw: string[]; verify: boolean }[] = [];
  let cur: { raw: string[]; verify: boolean } = { raw: [], verify: false };
  const flush = () => {
    if (cur.raw.length) out.push(cur);
    cur = { raw: [], verify: false };
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (/^\[\s*verify\s*\]$/i.test(t)) {
      // A tag right after a sentence ends flags that sentence; anywhere else it flags the one it is in.
      if (!cur.raw.length && out.length) out[out.length - 1].verify = true;
      else cur.verify = true;
      continue;
    }
    if (/\[\s*verify\s*\]/i.test(t)) cur.verify = true;
    cur.raw.push(t);
    const bare = t.replace(/\[[^\]]*\]/g, "");
    const next = tokens.slice(k + 1).find((x) => !/^\[[^\]]*\]$/.test(x));
    const ends = /[.!?…]["'”’)\]]*$/.test(bare) && !ABBREV.test(bare.replace(/["'”’)]+$/, ""));
    // "Then... it was gone" is one sentence: an ending needs a capital (or nothing) after it.
    if (ends && (!next || /^["'“‘(]?[A-Z0-9$]/.test(next))) flush();
  }
  flush();
  return out
    .map((s) => ({ text: cleanForScreen(s.raw.join(" ")), verify: s.verify }))
    .filter((s) => /[a-z0-9]/i.test(s.text));
}

/** Every narrated sentence of the script, in order, with what the picking rules need to know. Untimed. */
export function scriptSentences(script: ParsedScript): Sentence[] {
  const shots = script.parts.flatMap((p, pi) =>
    p.shots.map((s, si) => ({ part: p, pi, si, shot: s, partLen: p.shots.length })),
  );
  const out: Sentence[] = [];
  shots.forEach(({ part, pi, si, shot, partLen }, shotIdx) => {
    const numbered = /^\d+$/.test(part.key);
    const chapter = chapterOf(part);
    const partEnd = pi < script.parts.length - 1 && si >= partLen - 6;
    const outro = shotIdx >= shots.length - 4;
    for (const s of splitSentences(shot.verifyMarked ?? shot.narration)) {
      out.push({
        i: out.length,
        text: s.text,
        words: s.text.split(" ").map((text) => ({ text, start: 0, end: 0 })),
        start: 0,
        end: 0,
        shot: shot.n,
        shotIdx,
        partKey: part.key,
        partTitle: numbered ? part.title : "Hook",
        partName: part.name ?? chapter?.title ?? null,
        verify: s.verify,
        onScreen: !!cleanForScreen(shot.onScreen),
        partEnd,
        outro,
        banned: BANNED.test(s.text),
      });
    }
  });
  return out;
}

/** Normalised form of a word for matching speech to script: "$20," → "20", "Hwang’s" → "hwangs". */
export function norm(word: string) {
  return word
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
