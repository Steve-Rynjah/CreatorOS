/**
 * Shared (client + server) shapes for script-driven videos: a PDF script is
 * cut into parts, each part into shots, and each shot is one image on screen
 * for exactly as long as its narration is spoken.
 */

export type ScriptShot = {
  /** Shot number from the script ("[SHOT 049]" → 49). Matches the image number. */
  n: number;
  /** The script's planned timestamp ("04:00"), for display only. */
  time: string | null;
  /** Spoken text, one script line per line, stage notes like [VERIFY] removed. */
  narration: string;
  visual: string;
  /** "Zoom in." / "Zoom out." as written in the script. */
  motion: string;
  onScreen: string;
  /** The narration with its [VERIFY] flags still in place; only set when the shot has one. */
  verifyMarked?: string;
};

export type ScriptPart = {
  /** "1", "2" … — lettered halves (3A, 3B) are merged into one part. */
  key: string;
  title: string;
  name: string | null;
  timing: string | null;
  shots: ScriptShot[];
  /** Title card for this part, from the script's "YouTube chapters" list (or the part heading). */
  chapter?: ScriptChapter | null;
};

/** "Part 1" + "Before the Billions"; label is null for an unnumbered chapter like the hook. */
export type ScriptChapter = { label: string | null; title: string };

export type ParsedScript = { file: string; pages: number; parts: ScriptPart[]; /** The video title from the first page, when one was found. */ title?: string | null };

export type NarratedShot = { n: number; start: number; end: number };
export type NarrationCue = { start: number; end: number; text: string; words?: number[] };

/** One part spoken: a single WAV plus where every shot and every subtitle line falls in it. */
export type Narration = {
  audioPath: string;
  duration: number;
  shots: NarratedShot[];
  cues: NarrationCue[];
  /** Spoken chapter title before the first shot: 0 → `end` (the first shot starts at `end`). */
  intro?: { end: number };
};

export const VOICES = [
  { id: "en-US-AndrewNeural", label: "Andrew", hint: "Warm, confident storyteller" },
  { id: "en-US-BrianNeural", label: "Brian", hint: "Casual, friendly" },
  { id: "en-US-ChristopherNeural", label: "Christopher", hint: "Steady, authoritative" },
  { id: "en-US-AvaNeural", label: "Ava", hint: "Expressive, caring" },
  { id: "en-US-EmmaNeural", label: "Emma", hint: "Cheerful, clear" },
] as const;
export type VoiceId = (typeof VOICES)[number]["id"];
export const DEFAULT_VOICE: VoiceId = VOICES[0].id;

export const SPEEDS = [
  { id: "-10%", label: "Slower" },
  { id: "+0%", label: "Natural" },
  { id: "+10%", label: "Faster" },
] as const;
export type SpeedId = (typeof SPEEDS)[number]["id"];
export const DEFAULT_SPEED: SpeedId = "+0%";

export const isVoice = (v: unknown): v is VoiceId => VOICES.some((x) => x.id === v);
export const isSpeed = (v: unknown): v is SpeedId => SPEEDS.some((x) => x.id === v);

/** The text that is actually spoken / shown as subtitles: script lines joined into prose. */
export function spokenText(narration: string) {
  return narration.replace(/\s+/g, " ").trim();
}

/** The part's title card: the parsed chapter, else its own heading name. */
export function chapterOf(part: ScriptPart): ScriptChapter | null {
  if (part.chapter !== undefined) return part.chapter;
  return part.name ? { label: part.title, title: part.name } : null;
}

/** What the voice says over the title card. */
export function chapterSpeech(c: ScriptChapter) {
  return c.label ? `${c.label}. ${c.title}.` : `${c.title}.`;
}
