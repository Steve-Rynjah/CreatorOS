import { segmentsToCues } from "@/lib/editor/subtitles";
import { totalDuration } from "@/lib/editor/timing";
import type { Project } from "@/lib/editor/types";
import { chapterOf, spokenText, type ParsedScript, type ScriptPart } from "@/lib/script";

/**
 * Publish Kit: everything for a YouTube upload, built without any paid API.
 * Captions and chapters come from the subtitle cues the Home tab already made
 * (timed by the voice's own word boundaries); the SEO text is written by
 * whichever chatbot you paste the prompt into.
 */

export const DISCLAIMER = "For educational and entertainment purposes only. Not financial, investment, tax, or legal advice.";
export const LIMITS = { titleWarn: 60, titleMax: 100, description: 5000, tags: 500, thumbBytes: 2 * 1024 * 1024 } as const;
export const MAX_THUMBS = 3;

export type KitCue = { start: number; end: number; text: string; words?: number[] };
export type KitChapter = { start: number; title: string; source: "subtitles" | "script timing" };
export type KitPart = { title: string; chapter: string; text: string };

export type SeoResult = {
  titles: string[];
  description: string;
  tags: string[];
  hashtags: string[];
  thumbnail_texts: string[];
  pinned_comment: string;
  short_idea: string;
};

export type ThumbPosition = "left" | "right" | "top" | "bottom";
export type ThumbSpec = {
  id: string;
  /** Local path of the shot image used as the background. */
  image: string;
  text: string;
  color: "#FFD23F" | "#FFFFFF";
  position: ThumbPosition;
  /** Font size in px on the 1280×720 frame. */
  size: number;
  band: boolean;
};

export type CaptionSource = "project" | "srt" | "estimate";

export type PublishKit = {
  id: string;
  savedAt: number;
  title: string;
  source: {
    /** "project": kits made before Publish Kit took only the merged video. */
    mode: "project" | "upload";
    scriptFile: string;
    video?: string;
    captions: CaptionSource;
  };
  duration: number;
  primary: string;
  secondary: string;
  nextTitle: string;
  parts: KitPart[];
  cues: KitCue[];
  chapters: KitChapter[];
  notes: string[];
  images: { name: string; path: string }[];
  imagesDir?: string;
  pasted: string;
  seo: SeoResult | null;
  titles: string[];
  chosenTitle: number;
  description: string;
  tags: string[];
  hashtags: string[];
  pinned: string;
  short: string;
  thumbs: ThumbSpec[];
};

// ───────────────────────── Saved kits ─────────────────────────

const KITS_KEY = "creatoros:publish-kits";

export function kitId(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "untitled"
  );
}

export function loadKits(): PublishKit[] {
  try {
    const all = JSON.parse(localStorage.getItem(KITS_KEY) || "{}") as Record<string, PublishKit>;
    return Object.values(all).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export function saveKit(kit: PublishKit, previousId?: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KITS_KEY) || "{}") as Record<string, PublishKit>;
    if (previousId && previousId !== kit.id) delete all[previousId];
    all[kit.id] = kit;
    localStorage.setItem(KITS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function deleteKit(id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KITS_KEY) || "{}") as Record<string, PublishKit>;
    delete all[id];
    localStorage.setItem(KITS_KEY, JSON.stringify(all));
  } catch {}
}

// ───────────────────── Home projects (subtitles) ─────────────────────

const PROJECT_PREFIX = "creatoros:project:";
/** What the Home editor autosaves for each part. */
export type StoredProject = Omit<Project, "peaks" | "audio" | "warnings">;
export type SavedPart = { key: string; project: StoredProject; duration: number };
export type SavedScript = { file: string; parts: SavedPart[] };

/** Every script-built Home project in this browser, grouped by script PDF. */
export function listSavedScripts(): SavedScript[] {
  const groups = new Map<string, SavedPart[]>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PROJECT_PREFIX)) continue;
      try {
        const project = JSON.parse(localStorage.getItem(key) || "null") as StoredProject | null;
        if (!project?.script?.file || !Array.isArray(project.images)) continue;
        const duration = totalDuration({ ...project, peaks: [], audio: [], warnings: [], texts: project.texts ?? [] } as Project);
        const list = groups.get(project.script.file) ?? [];
        list.push({ key, project, duration });
        groups.set(project.script.file, list);
      } catch {}
    }
  } catch {}
  return [...groups.entries()]
    .map(([file, parts]) => ({ file, parts: parts.sort((a, b) => partRank(a.project.script!.part) - partRank(b.project.script!.part)) }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** The hook ("Script") first, then Part 1, Part 2 … */
function partRank(title: string) {
  const m = title.match(/(\d+)/);
  return m ? Number(m[1]) : -1;
}

/**
 * No .srt added: spread the script's narration over the video by word count.
 * Rough — the .srt that Merge Videos saves next to the merged video is exact.
 */
export function estimateCues(script: ParsedScript, duration: number): KitCue[] {
  const shots = script.parts.flatMap((p) => p.shots).map((s) => spokenText(s.narration)).filter(Boolean);
  const counts = shots.map((s) => s.split(" ").length);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  const segments = shots.map((text, i) => {
    const d = (duration * counts[i]) / total;
    const seg = { start: t, end: t + d, text };
    t += d;
    return seg;
  });
  return segmentsToCues(segments).map(({ start, end, text }) => ({ start, end, text }));
}

export function kitParts(script: ParsedScript): KitPart[] {
  return script.parts.map((p) => ({
    title: p.title,
    chapter: chapterTitle(p),
    text: p.shots.map((s) => spokenText(s.narration)).join(" "),
  }));
}

function chapterTitle(p: ScriptPart) {
  return chapterOf(p)?.title ?? p.name ?? p.title;
}

// ───────────────────────── Chapters ─────────────────────────

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9$%]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Every spoken word of the captions with the moment it is said. */
function wordStream(cues: KitCue[]) {
  const out: { w: string; t: number }[] = [];
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    const tokens = c.text.split(/\s+/).filter(Boolean);
    const timed = c.words && c.words.length === tokens.length;
    tokens.forEach((tok, j) => {
      const t = timed ? c.words![j] : c.start + ((c.end - c.start) * j) / tokens.length;
      for (const w of words(tok)) out.push({ w, t });
    });
  }
  return out;
}

/** Where the first words of `line` are spoken, searching from word `from`. */
function findLine(stream: { w: string; t: number }[], line: string, from: number): number {
  const key = words(line).slice(0, 8);
  if (!key.length) return -1;
  let best = -1;
  let bestScore = 0;
  for (let i = from; i <= stream.length - key.length; i++) {
    if (stream[i].w !== key[0]) continue;
    let score = 0;
    for (let k = 0; k < key.length; k++) if (stream[i + k].w === key[k]) score++;
    if (score === key.length) return i;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= Math.ceil(key.length * 0.6) ? best : -1;
}

/** "0:25–2:00" → 25 */
function plannedStart(timing: string | null): number | null {
  const m = timing?.match(/^\s*(\d+):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}

/**
 * Real start of each part: the moment its first narration line is spoken in the
 * subtitles (falling back to the script's planned timing), then made YouTube-valid:
 * first chapter at 0:00, every chapter at least 10 s long, at least 3 chapters.
 */
export function buildChapters(script: ParsedScript, cues: KitCue[], duration: number): { chapters: KitChapter[]; notes: string[] } {
  const stream = wordStream(cues);
  const notes: string[] = [];
  const found: KitChapter[] = [];
  let from = 0;
  for (const part of script.parts) {
    const title = chapterTitle(part);
    const first = part.shots[0]?.narration.split("\n").find((l) => l.trim()) ?? "";
    const i = findLine(stream, first, from);
    if (i >= 0) {
      found.push({ start: stream[i].t, title, source: "subtitles" });
      from = i + 1;
      continue;
    }
    // "PART 1: Before the Billions (0:25–2:00)" keeps its timing inside the name.
    const planned = plannedStart(part.timing ?? part.name?.match(/\(([^)]*)\)\s*$/)?.[1] ?? null);
    if (planned !== null) {
      found.push({ start: planned, title, source: "script timing" });
      notes.push(`“${title}”: its first line wasn't found in the subtitles, so the script's planned time is used.`);
    } else {
      notes.push(`“${title}”: its first line wasn't found in the subtitles and the script has no time for it, so it was left out.`);
    }
  }

  const list = found
    .map((c) => ({ ...c, start: Math.floor(c.start) }))
    .sort((a, b) => a.start - b.start)
    .filter((c, i, a) => i === 0 || c.title !== a[i - 1].title);

  if (list.length && list[0].start !== 0) {
    if (list[0].start > 0) notes.push(`“${list[0].title}” moved to 0:00 — YouTube needs the first chapter at 0:00.`);
    list[0].start = 0;
  }
  const end = Math.floor(duration);
  for (let i = 0; i < list.length; ) {
    const next = i + 1 < list.length ? list[i + 1].start : end;
    if (next - list[i].start >= 10 || list.length === 1) {
      i++;
      continue;
    }
    if (i === 0) {
      notes.push(`“${list[0].title}” is under 10 seconds, so it was merged into “${list[1].title}”, which now starts at 0:00.`);
      list.splice(0, 1);
      list[0].start = 0;
    } else {
      notes.push(`“${list[i].title}” is under 10 seconds, so it was merged into the chapter before it.`);
      list.splice(i, 1);
    }
  }
  if (list.length < 3) notes.push(`Only ${list.length} chapter${list.length === 1 ? "" : "s"} — YouTube needs at least 3 to show chapters.`);
  return { chapters: list, notes };
}

export function stamp(t: number) {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const chapterLines = (chapters: KitChapter[]) => chapters.map((c) => `${stamp(c.start)} ${c.title}`).join("\n");

// ───────────────────────── SEO prompt ─────────────────────────

export const SEO_INSTRUCTIONS = `You create YouTube SEO packages for "Finance with Naz", an illustrated finance storytelling channel for US viewers aged 15+, Gen-Z leaning. Tone: cinematic, curious, punchy, never clickbait the video doesn't deliver. Use only facts from the script. Never invent numbers, names or quotes.
Return ONLY valid JSON in this exact shape:
{
 "titles": ["3 options, each under 60 characters, curiosity-driven, primary keyword in at least 2"],
 "description": "A 2-sentence hook with the primary keyword in the first sentence. A blank line. 2–3 short sentences about the story using the secondary keywords naturally. A blank line. 'Chapters:' then the chapters exactly as given, one per line. A blank line. 3 hashtags. Last line exactly: 'For educational and entertainment purposes only. Not financial, investment, tax, or legal advice.'",
 "tags": ["15 tags, most specific first, total under 450 characters"],
 "hashtags": ["3 hashtags starting with #"],
 "thumbnail_texts": ["3 options, each 3–5 words, punchy and readable"],
 "pinned_comment": "a short question that invites comments",
 "short_idea": "the best 30–60 second moment for a YouTube Short, with its first and last narration lines"
}`;

export function buildPrompt(kit: Pick<PublishKit, "title" | "chapters" | "primary" | "secondary" | "nextTitle" | "parts">) {
  const narration = kit.parts.map((p) => `[${p.title} — ${p.chapter}]\n${p.text}`).join("\n\n");
  return [
    SEO_INSTRUCTIONS,
    "",
    `VIDEO TITLE: ${kit.title}`,
    "",
    "CHAPTERS:",
    chapterLines(kit.chapters),
    "",
    `PRIMARY KEYWORD: ${kit.primary.trim() || "(none given)"}`,
    `SECONDARY KEYWORDS: ${splitKeywords(kit.secondary).join(", ") || "(none given)"}`,
    `NEXT VIDEO TITLE: ${kit.nextTitle.trim() || "(none)"}`,
    "",
    "FULL SCRIPT NARRATION:",
    narration,
  ].join("\n");
}

export const splitKeywords = (s: string) =>
  s
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);

// ───────────────────────── Pasted result ─────────────────────────

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Reads the chatbot's answer. Tolerates ```json fences and text around the JSON. */
export function parseSeo(text: string): { ok: true; value: SeoResult; warnings: string[] } | { ok: false; error: string } {
  const raw = text.trim();
  if (!raw) return { ok: false, error: "Paste the JSON answer first." };
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return { ok: false, error: "No JSON object found — the answer should start with { and end with }." };
  const body = raw.slice(a, b + 1);
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body);
  } catch (e) {
    // Some chat apps turn the JSON's quotes into “smart” quotes when copied.
    try {
      j = JSON.parse(body.replace(/[“”]/g, '"'));
    } catch {
      return { ok: false, error: `That isn't valid JSON (${(e as Error).message}). Ask the chatbot to "return only valid JSON" and paste again.` };
    }
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, error: "The JSON must be an object with titles, description, tags …" };

  const errors: string[] = [];
  const warnings: string[] = [];
  const list = (k: string, required: boolean) => {
    const v = j[k];
    if (v === undefined) {
      (required ? errors : warnings).push(`“${k}” is missing.`);
      return [];
    }
    if (!isStrings(v)) {
      errors.push(`“${k}” must be a list of text.`);
      return [];
    }
    return v.map((s) => s.trim()).filter(Boolean);
  };
  const str = (k: string, required: boolean) => {
    const v = j[k];
    if (v === undefined) {
      (required ? errors : warnings).push(`“${k}” is missing.`);
      return "";
    }
    if (typeof v !== "string") {
      errors.push(`“${k}” must be text.`);
      return "";
    }
    return v.trim();
  };
  const value: SeoResult = {
    titles: list("titles", true),
    description: str("description", true),
    tags: list("tags", true),
    hashtags: list("hashtags", false).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")),
    thumbnail_texts: list("thumbnail_texts", false),
    pinned_comment: str("pinned_comment", false),
    short_idea: str("short_idea", false),
  };
  if (!errors.length && !value.titles.length) errors.push("“titles” is empty.");
  if (errors.length) return { ok: false, error: errors.join(" ") };
  return { ok: true, value, warnings };
}

// ───────────────────────── Checklist ─────────────────────────

/** YouTube's count: characters + commas between tags + quotes around tags with spaces. */
export function tagsLength(tags: string[]) {
  if (!tags.length) return 0;
  return tags.reduce((s, t) => s + t.length + (/\s/.test(t) ? 2 : 0), 0) + (tags.length - 1);
}

export function firstSentence(text: string) {
  const t = text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : t.split("\n")[0]).trim();
}

/** Chapter lines YouTube will read from the description. */
export function descriptionChapters(description: string): number[] {
  return description
    .split("\n")
    .map((l) => l.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+\S/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => (m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]));
}

const has = (hay: string, needle: string) => !!needle.trim() && hay.toLowerCase().includes(needle.trim().toLowerCase());

export type Check = { label: string; ok: boolean; detail?: string };

export function checklist(kit: PublishKit, thumbBytes: number[]): Check[] {
  const title = kit.titles[kit.chosenTitle] ?? "";
  const stamps = descriptionChapters(kit.description);
  const lines = kit.description.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const tagLen = tagsLength(kit.tags);
  return [
    { label: "Keyword in the chosen title", ok: has(title, kit.primary), detail: kit.primary.trim() ? undefined : "Enter a primary keyword" },
    { label: "Keyword in the description's first sentence", ok: has(firstSentence(kit.description), kit.primary) },
    { label: "Chapters start at 0:00", ok: stamps[0] === 0 },
    { label: "At least 3 chapters", ok: stamps.length >= 3, detail: `${stamps.length} in the description` },
    { label: "Tags under 500 characters", ok: kit.tags.length > 0 && tagLen < LIMITS.tags, detail: `${tagLen} / ${LIMITS.tags}` },
    {
      label: "Thumbnail under 2 MB",
      ok: thumbBytes.length > 0 && thumbBytes.every((b) => b > 0 && b < LIMITS.thumbBytes),
      detail: thumbBytes.length ? thumbBytes.map((b) => `${(b / 1024 / 1024).toFixed(2)} MB`).join(" · ") : "No thumbnail yet",
    },
    { label: "Disclaimer present", ok: lines[lines.length - 1] === DISCLAIMER },
  ];
}

export function metadataText(kit: PublishKit) {
  return [
    "TITLE",
    kit.titles[kit.chosenTitle] ?? kit.title,
    "",
    "DESCRIPTION",
    kit.description,
    "",
    "TAGS",
    kit.tags.join(", "),
    "",
    "HASHTAGS",
    kit.hashtags.join(" "),
    "",
    "PINNED COMMENT",
    kit.pinned,
    "",
  ].join("\n");
}
