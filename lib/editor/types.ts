export type Motion = "none" | "zoom-in" | "zoom-out";
export type Transition = "none" | "dissolve" | "slide-left" | "slide-right";

export type ImageClip = {
  id: string;
  name: string;
  path: string;
  motion: Motion;
  /** Transition INTO this clip from the previous one (or from the intro for the first clip). */
  transition: Transition;
  transitionDur: number;
  /** Seconds on screen. Set when timed to a script shot; otherwise the project's secondsPerImage. */
  duration?: number;
  /** Script shot this image illustrates. */
  shot?: number;
};

export type TextAnim = "none" | "fade" | "pop" | "slide-up" | "slide-down" | "slide-in" | "typewriter";

export type TextClip = {
  id: string;
  text: string;
  start: number;
  duration: number;
  /** Anchor position as a fraction of the frame (0..1); x is the left/center/right edge per `align`. */
  x: number;
  y: number;
  /** Font size in px at 1080p; scaled for other resolutions. */
  size: number;
  font: string;
  color: string;
  bold: boolean;
  background: boolean;
  bgColor: string;
  /** Legacy on/off fade; `anim` wins when set. */
  fade: boolean;
  align?: "left" | "center" | "right";
  anim?: TextAnim;
  /** Seconds the in/out animation takes. */
  animDur?: number;
};

/** `words`: start time of each word of `text` (from the voice), used to highlight the word being spoken. */
export type Cue = { id: string; start: number; end: number; text: string; words?: number[] };

export type SubtitleStyle = {
  enabled: boolean;
  size: number;
  position: "bottom" | "top";
  box: boolean;
  /** "modern": bold upper-case words, the spoken word highlighted. "classic": plain sentence captions. */
  style?: "modern" | "classic";
  /** Highlight colour for the spoken word (modern style). */
  highlight?: string;
};

/** Movie-style title card at the start of a part, voiced, fading into the first shot. */
export type Chapter = { label: string | null; title: string; duration: number };

export type AudioPart = { name: string; path: string; start: number; duration: number };

export type Project = {
  imagesDir: string;
  audioDir: string;
  audioMix: string;
  audio: AudioPart[];
  audioDuration: number;
  peaks: number[];
  peaksPerSec: number;
  warnings: string[];

  secondsPerImage: number;
  /** null = automatic: voice-over length − (images × seconds per image). */
  offsetOverride: number | null;
  introFill: "black" | "first";
  fit: "cover" | "contain";
  zoomAmount: number;

  /** Present when the video is built from a script PDF: images are timed to the narration of each shot. */
  script?: { file: string; part: string; voice: string; shots: number };
  chapter?: Chapter;

  images: ImageClip[];
  texts: TextClip[];
  cues: Cue[];
  subtitle: SubtitleStyle;
};

export type Selection = { kind: "image" | "text" | "cue" | null; ids: string[] };

export const MOTIONS: { value: Motion; label: string }[] = [
  { value: "none", label: "None" },
  { value: "zoom-in", label: "Zoom In" },
  { value: "zoom-out", label: "Zoom Out" },
];

export const TEXT_ANIMS: { value: TextAnim; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-down", label: "Slide down" },
  { value: "slide-in", label: "Slide in" },
  { value: "typewriter", label: "Typewriter" },
];

/** Brand palette. */
export const BRAND = { yellow: "#FFD23F", black: "#1B1B1B", white: "#FFFFFF" } as const;

export const textAnim = (t: TextClip): TextAnim => t.anim ?? (t.fade ? "fade" : "none");

export const TRANSITIONS: { value: Transition; label: string }[] = [
  { value: "none", label: "Cut" },
  { value: "dissolve", label: "Dissolve" },
  { value: "slide-left", label: "Slide Left" },
  { value: "slide-right", label: "Slide Right" },
];
