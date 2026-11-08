/**
 * Shorts Maker: three vertical YouTube Shorts cut from the finished long video,
 * picked by fixed rules from the polished script, timed to the real voice.
 */
import type { SpeedId, VoiceId } from "@/lib/script";

/** One spoken word of the script with when it is said in the long video. */
export type TimedWord = { text: string; start: number; end: number };

export type Sentence = {
  i: number;
  /** As shown on screen: [VERIFY] tags and "..." removed. */
  text: string;
  words: TimedWord[];
  start: number;
  end: number;
  /** Script shot number ([SHOT 049] → 49) and its index in the whole script. */
  shot: number;
  shotIdx: number;
  partKey: string;
  /** "Part 3" (or "Hook" for the unnumbered opening). */
  partTitle: string;
  /** "The Margin Call Begins". */
  partName: string | null;
  /** The sentence had a [VERIFY] tag. */
  verify: boolean;
  /** Its shot has ON-SCREEN TEXT. */
  onScreen: boolean;
  /** Its shot is one of the last 6 before the next PART heading (a cliffhanger). */
  partEnd: boolean;
  /** One of the last 4 shots of the video (gallery, goodbye, like/subscribe). */
  outro: boolean;
  /** Asks to subscribe / like / comment — never used in a Short. */
  banned: boolean;
};

export type TimingSource = "home" | "whisper" | "pauses";

export type Reason = { label: string; points: number };

export type Candidate = {
  /** First and last sentence (inclusive). */
  from: number;
  to: number;
  start: number;
  end: number;
  score: number;
  reasons: Reason[];
};

export type ImageMotion = "zoom-in" | "zoom-out";
/** What the script says about a shot's picture. */
export type ShotMeta = { visual: string; motion: string };
export type ShortImage = { name: string; path: string };
/** The spoken call-to-action as generated; only valid while text, voice and speed still match. */
export type CtaAudio = { text: string; voice: VoiceId; rate: SpeedId; path: string; duration: number };

/** One Short as edited. Times are seconds in the long video. */
export type ShortState = {
  n: 1 | 2 | 3;
  target: number;
  from: number;
  to: number;
  score: number;
  reasons: Reason[];
  hook: string;
  /** Word of the hook title drawn in yellow (index into its words). */
  hookKey: number;
  /** Typed by hand: keep it when the clip moves (otherwise it is re-chosen). */
  hookEdited?: boolean;
  /** The sentence the hook title came from (for the description), or null for a part title. */
  hookSentence: number | null;
  showHook: boolean;
  showEndTag: boolean;
  /** Fraction of the frame height cut off the bottom (old burned-in subtitles). */
  crop: number;
  /** Caption word fixes: "sentence:word" → replacement ("" hides the word). */
  edits: Record<string, string>;
  /** This Short's folder of vertical images and what is in it, in order. */
  imagesDir?: string;
  images?: ShortImage[];
  /** Set once images are dragged by hand: first shot of a group → image path (null: no image). */
  mapping?: Record<number, string | null>;
  /** Spoken after the clip's last sentence; empty means no spoken ending and no end tag. */
  cta: string;
  ctaAudio?: CtaAudio | null;
  rendered?: { path: string; hash: string; at: number } | null;
};

export type ShortsProject = {
  id: string;
  title: string;
  savedAt: number;
  video: { path: string; name: string; duration: number };
  scriptFile: string;
  timing: TimingSource;
  timingNote?: string;
  /** Sentence edges were moved onto the voice (see snapToSpeech). */
  speechSnapped?: boolean;
  subject: string;
  sentences: Sentence[];
  shorts: ShortState[];
  /** Script VISUAL and MOTION per shot number; projects saved earlier get it when the PDF is added. */
  shotMeta?: Record<number, ShotMeta>;
  /** Voice and speed of the call-to-action: those of the long video. */
  voice?: VoiceId;
  rate?: SpeedId;
};

/** What the browser sends to be rendered. All positions are on the 1080×1920 frame. */
export type RenderSpec = {
  projectId: string;
  video: string;
  file: string;
  start: number;
  end: number;
  /** Seconds after `end`: the spoken call-to-action, over the last image. */
  hold: number;
  crop: number;
  hook: { size: number; lines: { text: string; key: boolean }[][] } | null;
  captions: { start: number; end: number; size: number; words: { text: string; start: number }[] }[];
  /** Full-screen images, seconds from the Short's start, in order; any time not covered uses the 4:5 layout. */
  shots: { from: number; to: number; image: string; motion: ImageMotion }[];
  /** `audio` is null until the line has been generated. */
  cta: { audio: string | null } | null;
  /** `at`: seconds from the Short's start when the tag appears; it stays to the end. */
  endTag: { width: number; at: number } | null;
};
