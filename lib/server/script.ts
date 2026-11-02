import "server-only";
import type { ScriptChapter, ScriptPart, ScriptShot } from "@/lib/script";

/**
 * Reads a video script (text pulled from a PDF) into parts and shots.
 *
 * Expected shape (anything missing is tolerated):
 *
 *   PART 3A (4:00–5:00)
 *   SHOT 049–060
 *   [SHOT 049] [04:00]
 *   NARRATION:
 *   For a while, the climb just kept going.
 *   VISUAL:
 *   …
 *   MOTION:
 *   Zoom out.
 *   ON-SCREEN TEXT:
 *   …
 *
 * Lettered halves (3A, 3B) belong to their number, so they read as one Part 3.
 * A script without [SHOT] markers gets one shot per NARRATION block; one
 * without PART headings is a single part.
 */

/** "PART 1 (0:00–2:00)", "## Part 2 – The Rise". Title-case "Part 2: …" inside on-screen text is NOT a heading. */
const PART_RE = /^[\s#*_>-]*(part)\s*(\d+)\s*([a-z])?(?![a-z0-9])[\s*_]*(?:\(([^)]*)\))?[\s*_]*(?:[:.\-–—][\s*_]*(.*?))?[\s*_]*$/i;
/** "[SHOT 001] [00:00]", "SHOT 12", "Shot 7 – 01:05". */
const SHOT_RE = /^[\s#*_>-]*\[?\s*shot\s*#?\s*(\d+)\s*\]?\s*(?:[\[(–—-]\s*([\d:.]+)\s*[\])]?)?\s*$/i;
/** "SHOT 001–024": a range summary under a part heading. */
const SHOT_RANGE_RE = /^\s*shots?\s*\d+\s*[–—-]\s*\d+\s*$/i;
/** An upper-case label: "NARRATION:", "ON-SCREEN TEXT:", "VISUAL (B-ROLL): text". */
const LABEL_RE = /^[\s#*_>-]*([A-Z][A-Z0-9 &/\-]{1,30}?)(?:\s*\([^)]*\))?[\s*_]*:[\s*_]*(.*)$/;

/** "YouTube chapters" / "Chapters:" heading, followed by "0:25 Part 1: Before the Billions" lines. */
const CHAPTERS_HEAD_RE = /^[\s#*_>-]*(?:youtube\s+)?chapters\s*:?[\s*_]*$/i;
const CHAPTER_LINE_RE = /^[\s*_-]*(\d{1,2}:\d{2}(?::\d{2})?)\s*[–—-]?\s*(.+?)\s*$/;
/** "Part 1: Before the Billions" inside a chapter line. */
const CHAPTER_PART_RE = /^part\s*(\d+)\s*[a-z]?\s*[:.\-–—]\s*(.+)$/i;

type Field = "narration" | "visual" | "motion" | "onScreen" | null;

function fieldFor(label: string): Field {
  const l = label.toLowerCase().replace(/[\s-]+/g, " ").trim();
  if (/^(narration|voice ?over|vo|narrator)$/.test(l)) return "narration";
  if (/^visuals?$/.test(l)) return "visual";
  if (/^(motion|camera|animation)$/.test(l)) return "motion";
  if (/^(on ?screen text|text overlay|overlay|title card)$/.test(l)) return "onScreen";
  return null;
}

type Bucket = { key: string; title: string; name: string | null; times: string[]; shots: Draft[] };
type Draft = { n: number; time: string | null; lines: Record<Exclude<Field, null>, string[]> };

const newDraft = (n: number, time: string | null): Draft => ({
  n,
  time,
  lines: { narration: [], visual: [], motion: [], onScreen: [] },
});

function isPartHeading(m: RegExpMatchArray) {
  // Upper-case "PART", or a timing in brackets — never the title-case on-screen "Part 2: The Invisible Empire".
  return m[1] === "PART" || !!m[4];
}

export function parseScript(source: string): ScriptPart[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const buckets: Bucket[] = [];
  let bucket: Bucket | null = null;
  let shot: Draft | null = null;
  let field: Field = null;
  let autoN = 0;
  let inChapters = false;
  const chapters: { part: string | null; title: string }[] = [];

  const openBucket = (key: string, title: string) => {
    let b = buckets.find((x) => x.key === key);
    if (!b) {
      b = { key, title, name: null, times: [], shots: [] };
      buckets.push(b);
    }
    return b;
  };
  const curBucket = () => (bucket ??= openBucket("script", "Script"));

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (CHAPTERS_HEAD_RE.test(line)) {
      inChapters = true;
      field = null;
      continue;
    }
    if (inChapters) {
      const c = line.match(CHAPTER_LINE_RE);
      if (c) {
        const pm = c[2].match(CHAPTER_PART_RE);
        chapters.push(pm ? { part: String(Number(pm[1])), title: pm[2].trim() } : { part: null, title: c[2].trim() });
        continue;
      }
      inChapters = false;
    }

    const part = line.match(PART_RE);
    if (part && isPartHeading(part)) {
      bucket = openBucket(part[2], `Part ${Number(part[2])}`);
      if (part[4]) bucket.times.push(part[4].trim());
      if (part[5]?.trim() && !bucket.name) bucket.name = part[5].trim();
      shot = null;
      field = null;
      continue;
    }
    if (SHOT_RANGE_RE.test(line)) continue;

    const s = line.match(SHOT_RE);
    if (s) {
      shot = newDraft(Number(s[1]), s[2] ?? null);
      autoN = Math.max(autoN, shot.n);
      curBucket().shots.push(shot);
      field = null;
      continue;
    }

    const label = line.match(LABEL_RE);
    if (label) {
      const f = fieldFor(label[1]);
      field = f;
      if (f === "narration" && (!shot || shot.lines.narration.length)) {
        // No [SHOT] markers: every NARRATION block is its own shot.
        shot = newDraft(++autoN, null);
        curBucket().shots.push(shot);
      }
      if (f && shot && label[2].trim()) shot.lines[f].push(label[2].trim());
      continue;
    }

    if (field && shot) shot.lines[field].push(line);
  }

  const parts = buckets
    .map((b) => ({
      key: b.key,
      title: b.title,
      name: b.name,
      timing: span(b.times),
      shots: b.shots.map(finish).filter((x) => x.narration),
    }))
    .filter((b) => b.shots.length > 0);
  return attachChapters(parts, chapters);
}

/**
 * Gives every part its title card. "Part N: …" chapters go to part N; unnumbered
 * ones (the hook, "The $20 Billion Mystery") go, in order, to the parts without a
 * number. Parts no chapter names fall back to their own heading.
 */
function attachChapters(parts: ScriptPart[], chapters: { part: string | null; title: string }[]): ScriptPart[] {
  const loose = chapters.filter((c) => !c.part);
  return parts.map((p) => {
    let chapter: ScriptChapter | null = null;
    const numbered = /^\d+$/.test(p.key);
    const hit = numbered ? chapters.find((c) => c.part === p.key) : null;
    if (hit) chapter = { label: p.title, title: hit.title };
    else if (!numbered && loose.length) chapter = { label: null, title: loose.shift()!.title };
    else if (p.name) chapter = { label: p.title, title: p.name };
    return { ...p, chapter };
  });
}

function finish(d: Draft): ScriptShot {
  const narration = d.lines.narration
    // Notes for the writer — [VERIFY], [PAUSE], [music swells] — are never spoken.
    .map((l) => l.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim())
    // Quotes wrapping a whole line are presentation, not speech.
    .map((l) => l.replace(/^["“](.*)["”]$/, "$1"))
    .filter(Boolean)
    .join("\n");
  return {
    n: d.n,
    time: d.time,
    narration,
    visual: d.lines.visual.join(" ").replace(/\s+/g, " ").trim(),
    motion: d.lines.motion.join(" ").trim(),
    onScreen: d.lines.onScreen.join(" ").replace(/\s+/g, " ").trim(),
  };
}

/** ["4:00–5:00", "5:00–6:00"] → "4:00–6:00" */
function span(times: string[]): string | null {
  if (!times.length) return null;
  const a = times[0].split(/\s*[–—-]\s*/);
  const b = times[times.length - 1].split(/\s*[–—-]\s*/);
  if (a.length !== 2 || b.length !== 2) return times.join(", ");
  return `${a[0]}–${b[1]}`;
}
