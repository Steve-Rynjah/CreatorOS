import { MONEY, TENSION, isQuestion, needsContext } from "./pick";
import { assignedImages, clipGroups, clipLength, cutShots, groupSpans, toShortTime, toVideoTime } from "./shots";
import type { ClipSpan, CtaAudio, ImageMotion, RenderSpec, Sentence, ShortState, ShortsProject } from "./types";

/**
 * The look of a Short, on the 1080×1920 frame. The preview canvas and the
 * ffmpeg/libass render both read these numbers, so they match.
 *
 * Safe zone: YouTube's buttons sit in the right 15% and its title in the bottom
 * 20%, so all text stays left of x = 918 and above y = 1536.
 */
export const FRAME = { w: 1080, h: 1920, fps: 30 } as const;
export const SAFE = { left: 54, right: 918, bottom: 1536 } as const;
export const CENTER_X = (SAFE.left + SAFE.right) / 2;
export const BRAND = { yellow: "#FFD23F", black: "#1B1B1B", white: "#FFFFFF" } as const;

/**
 * Vertical metrics of the bundled fonts, in em (OS/2 usWinAscent and usWinAscent + usWinDescent).
 * libass sizes text by that full height, not by the em, so `\fs` = em size ÷ height; and an
 * \an5 line is centred on that box, so its baseline sits at y − height/2 + ascent.
 */
export const FONT_METRICS = {
  anton: { ascent: 2876 / 2048, height: (2876 + 674) / 2048 },
  montserrat: { ascent: 1109 / 1000, height: (1109 + 453) / 1000 },
} as const;
export const assFontSize = (em: number, font: keyof typeof FONT_METRICS) => Math.round((em * FONT_METRICS[font].height) * 10) / 10;
export const baselineFor = (centerY: number, em: number, font: keyof typeof FONT_METRICS) =>
  centerY - (FONT_METRICS[font].height * em) / 2 + FONT_METRICS[font].ascent * em;

/**
 * The main video: a 4:5 centre crop of the 16:9 frame (after the old subtitles are cut off
 * the bottom), 1080×1350, a little above centre. The hook title sits in the band above it.
 */
export const VIDEO = { w: 1080, h: 1350, top: 250, aspect: 4 / 5 } as const;

/** Sizes are em px, like CSS / canvas. */
export const HOOK = { size: 90, min: 60, maxWidth: 840, lineHeight: 1.08, centerY: 128, outline: 9, maxWords: 6 } as const;
/** Captions sit about 72% down the frame, on the lower part of the video. */
export const CAPTION = { size: 80, maxWidth: 780, centerY: 1382, outline: 7, shadow: 5, pop: 1.1, maxWords: 3, maxChars: 14 } as const;
/**
 * Centred on the frame at every size, so unlike the other text it can reach under YouTube's side buttons when enlarged.
 * By default it sits just above the bottom safe zone (outline included). `gap` is from the pill's bottom edge to the
 * bottom of the frame; `margin` is the least space kept at each side of the frame.
 */
export const END_TAG = { text: "WATCH THE FULL STORY", arrow: "↓", x: FRAME.w / 2, size: 42, gap: 399, maxGap: 900, margin: 30, padX: 34, height: 86, outline: 6 } as const;
export const DEFAULT_CROP = 0.15;
/** A very short fade-in, so the first word isn't muffled; the fade-out is after the last word; `end` closes the Short. */
export const AUDIO_FADE = { in: 0.03, out: 0.25, end: 0.5 } as const;
export const CTA_DEFAULT = "Want to know what happened next? Watch the full story on my channel.";
/** Slow push on full-screen images: this much bigger over the shot. */
export const IMAGE_ZOOM = 0.09;
/** Scale of an image at `p` (0..1) through its shot. */
export const imageScale = (motion: "zoom-in" | "zoom-out", p: number) => (motion === "zoom-in" ? 1 + IMAGE_ZOOM * p : 1 + IMAGE_ZOOM * (1 - p));

/** Dark gradients over full-screen images, as [y, opacity] stops: behind the hook title and behind the captions. */
export const GRADIENT = {
  top: [[0, 0.55], [260, 0.4], [470, 0]],
  bottom: [[1130, 0], [1330, 0.42], [1560, 0.6], [1920, 0.6]],
} as const;

function stopsAt(y: number, stops: readonly (readonly [number, number])[]) {
  for (let i = 1; i < stops.length; i++) {
    const [y0, a0] = stops[i - 1];
    const [y1, a1] = stops[i];
    if (y >= y0 && y <= y1) return a0 + ((a1 - a0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}
/** Opacity of the gradients at height `y`; the top one only when a hook title is shown. */
export const gradientAlpha = (y: number, hook: boolean) => Math.max(hook ? stopsAt(y, GRADIENT.top) : 0, stopsAt(y, GRADIENT.bottom));

/** Width of `text` at `size` px in a font: canvas measureText in the browser. */
export type Measure = (text: string, font: "anton" | "montserrat", size: number) => number;

/** Width of the end tag's pill with its text at `size`. */
function endTagWidth(size: number, measure: Measure) {
  return Math.ceil(measure(`${END_TAG.text} `, "montserrat", size) + measure(END_TAG.arrow, "montserrat", size * 1.5)) + Math.round((2 * END_TAG.padX * size) / END_TAG.size);
}

/** The largest text size whose pill still fits on the frame on one line. */
export function endTagMaxSize(measure: Measure) {
  const room = FRAME.w - 2 * (END_TAG.margin + END_TAG.outline);
  return Math.max(END_TAG.size, Math.floor((END_TAG.size * room) / endTagWidth(END_TAG.size, measure)));
}

/** Text size, pill height and centre line of an end tag; the pill grows with its text, upward from the gap. */
export function endTagBox(tag: { size?: number; gap?: number }) {
  const size = tag.size ?? END_TAG.size;
  const height = Math.round((END_TAG.height * size) / END_TAG.size);
  return { size, height, centerY: FRAME.h - (tag.gap ?? END_TAG.gap) - height / 2 };
}

/** Where sentences [from..to] sit in the long video, with no sound of their neighbours. */
function runBounds(sentences: Sentence[], from: number, to: number, duration: number) {
  const first = sentences[from];
  const last = sentences[to];
  const before = sentences[from - 1];
  const after = sentences[to + 1];
  const start = Math.max(before ? before.end : 0, first.start - 0.05, 0);
  const end = Math.min(after ? Math.max(last.end, after.start - 0.05) : duration, last.end + 0.35, duration);
  return { start, end };
}

/**
 * Clip in/out in the long video. It opens on the first spoken word (never on the long
 * video's title card or black frames before it) and ends a beat after the last word,
 * never running into a neighbouring sentence.
 */
export function clipBounds(sentences: Sentence[], short: Pick<ShortState, "from" | "to">, duration: number) {
  const { start, end } = runBounds(sentences, short.from, short.to, duration);
  return { start, end: Math.max(end, start + 1) };
}

/** What a Short plays of the long video: its clip, with any deleted shots taken out. */
export function clipSpan(sentences: Sentence[], short: Pick<ShortState, "from" | "to" | "removedShots">, duration: number): ClipSpan {
  const gone = cutShots(sentences, short);
  const runs: { from: number; to: number }[] = [];
  for (let i = short.from; i <= short.to; i++) {
    if (gone.has(sentences[i].shot)) continue;
    const run = runs[runs.length - 1];
    if (run && run.to === i - 1) run.to = i;
    else runs.push({ from: i, to: i });
  }
  if (runs.length === 1) return clipBounds(sentences, runs[0], duration);
  const keep = runs.map((r) => runBounds(sentences, r.from, r.to, duration));
  return { start: keep[0].start, end: keep[keep.length - 1].end, keep };
}

// ───────────────────────── Hook title ─────────────────────────

const strip = (t: string) => t.replace(/[.,;:—–-]+$/, "").trim();

/** How much a sentence grabs: money and tension words, questions, brevity. */
function striking(s: Sentence) {
  return (MONEY.test(s.text) ? 3 : 0) + (TENSION.test(s.text) ? 2 : 0) + (isQuestion(s) ? 1 : 0) - (needsContext(s) ? 2 : 0) - (s.verify ? 3 : 0);
}

/**
 * The title over the Short: its most striking sentence of 6 words or fewer, or
 * the part's title. Falls back to the first 6 words of the strongest sentence.
 */
export function chooseHook(sentences: Sentence[], from: number, to: number, n?: 1 | 2 | 3, gone?: Set<number>, taken?: Set<string>): { hook: string; sentence: number | null } {
  const list = sentences.slice(from, to + 1).filter((s) => !gone?.has(s.shot));
  const ranked = [...list].sort((a, b) => striking(b) - striking(a));
  const brief = ranked.filter((s) => s.words.length <= HOOK.maxWords);
  const whole = (s: Sentence) => ({ hook: strip(s.text), sentence: s.i });
  const name = list[0].partName?.trim();
  const part = name && name.split(/\s+/).length <= HOOK.maxWords ? [{ hook: name, sentence: null }] : [];
  // Best first. The hook Short leads with its part's title ("The $20 Billion Mystery").
  const options = [
    ...(n === 1 ? part : []),
    ...brief.filter((s) => striking(s) >= 2).map(whole),
    ...part,
    ...brief.filter((s) => striking(s) < 2).map(whole),
    ...ranked.map((s) => ({ hook: strip(s.words.slice(0, HOOK.maxWords).map((w) => w.text).join(" ")), sentence: s.i })),
  ].filter((o) => o.hook);
  return options.find((o) => !taken?.has(titleId(o.hook))) ?? { ...options[0], hook: `${options[0].hook}, part ${n ?? 2}` };
}

/** Two titles count as the same if only their capitals or punctuation differ. */
const titleId = (t: string) => t.toLowerCase().replace(/[^a-z0-9$% ]/g, "").replace(/\s+/g, " ").trim();

/** No two Shorts share a title: a later Short gives way to an earlier one, and titles typed by hand are never changed. */
export function distinctHooks(sentences: Sentence[], shorts: ShortState[]): ShortState[] {
  const taken = new Set(shorts.filter((s) => s.hookEdited).map((s) => titleId(s.hook)));
  return shorts.map((s) => {
    if (s.hookEdited) return s;
    if (!taken.has(titleId(s.hook))) {
      taken.add(titleId(s.hook));
      return s;
    }
    const { hook, sentence } = chooseHook(sentences, s.from, s.to, s.n, cutShots(sentences, s), taken);
    taken.add(titleId(hook));
    return { ...s, hook, hookKey: keyWord(hook), hookSentence: sentence };
  });
}

/** The word to paint yellow: a money figure, else a tension word, else the longest. */
export function keyWord(hook: string) {
  const words = hook.split(/\s+/).filter(Boolean);
  let k = words.findIndex((w) => MONEY.test(w) || /\d/.test(w));
  if (k < 0) k = words.findIndex((w) => TENSION.test(w));
  if (k < 0) k = words.reduce((best, w, i) => (w.replace(/\W/g, "").length > words[best].replace(/\W/g, "").length ? i : best), 0);
  return Math.max(0, k);
}

export const hookWords = (hook: string) => hook.trim().toUpperCase().split(/\s+/).filter(Boolean).slice(0, HOOK.maxWords);

/** Hook title broken into at most two lines that fit the safe zone, shrinking the font if needed. */
export function layoutHook(hook: string, key: number, measure: Measure): RenderSpec["hook"] {
  const words = hookWords(hook);
  if (!words.length) return null;
  for (let size: number = HOOK.size; size >= HOOK.min; size -= 4) {
    const space = measure(" ", "anton", size);
    const lines: { text: string; key: boolean }[][] = [[]];
    let width = 0;
    let ok = true;
    words.forEach((w, i) => {
      const ww = measure(w, "anton", size);
      if (ww > HOOK.maxWidth) ok = false;
      const line = lines[lines.length - 1];
      if (line.length && width + space + ww > HOOK.maxWidth) {
        lines.push([]);
        width = 0;
      }
      lines[lines.length - 1].push({ text: w, key: i === key });
      width += (lines[lines.length - 1].length > 1 ? space : 0) + ww;
    });
    if (ok && lines.length <= 2) return { size, lines };
  }
  // Very long words: keep the smallest size, at most two lines.
  const half = Math.ceil(words.length / 2);
  return {
    size: HOOK.min,
    lines: [words.slice(0, half), words.slice(half)].filter((l) => l.length).map((l, li) => l.map((w, i) => ({ text: w, key: li * half + i === key }))),
  };
}

// ───────────────────────── Captions ─────────────────────────

export type CaptionWord = { key: string; text: string; original: string; start: number; end: number; sentence: number };

/** The Short's words with the user's fixes applied; a word fixed to "" is dropped. */
export function clipWords(sentences: Sentence[], short: ShortState): CaptionWord[] {
  const out: CaptionWord[] = [];
  const gone = cutShots(sentences, short);
  for (let i = short.from; i <= short.to; i++) {
    if (gone.has(sentences[i].shot)) continue;
    sentences[i].words.forEach((w, k) => {
      const key = `${i}:${k}`;
      const text = (short.edits[key] ?? w.text).trim();
      out.push({ key, text, original: w.text, start: w.start, end: w.end, sentence: i });
    });
  }
  return out;
}

/** Shown in captions: upper case, no "..." or stray quotes; sentence-ending punctuation kept only for ? and !. */
export const captionText = (t: string) =>
  t
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\.{2,}|…/g, "")
    .replace(/["“”]/g, "")
    .replace(/[.,;:]+$/, "")
    .toUpperCase()
    .trim();

/** Groups words into captions of 1–3 words, breaking at sentence ends and after commas. */
export function chunkWords(words: CaptionWord[]): CaptionWord[][] {
  const chunks: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (cur.length) chunks.push(cur);
    cur = [];
  };
  words.forEach((w, i) => {
    if (!captionText(w.text)) return;
    const len = cur.reduce((s, x) => s + captionText(x.text).length + 1, 0) + captionText(w.text).length;
    if (cur.length && (cur.length >= CAPTION.maxWords || len > CAPTION.maxChars || cur[0].sentence !== w.sentence)) flush();
    cur.push(w);
    const next = words[i + 1];
    if (/[,;:—?!.]["'”’)]*$/.test(w.text) || !next || next.sentence !== w.sentence) flush();
  });
  flush();
  return chunks;
}

// ───────────────────────── Render spec ─────────────────────────

export function shortFileName(n: 1 | 2 | 3) {
  return n === 1 ? "short_1_hook.mp4" : `short_${n}.mp4`;
}

/** The generated call-to-action, if it still matches the text, voice and speed. */
export function currentCta(project: Pick<ShortsProject, "voice" | "rate">, short: Pick<ShortState, "cta" | "ctaAudio">): CtaAudio | null {
  const a = short.ctaAudio;
  return a && a.text === short.cta.trim() && a.voice === project.voice && a.rate === project.rate ? a : null;
}

/** Until the line is generated, its length is estimated from its words. */
const estimateCta = (text: string) => Math.round((text.split(/\s+/).length * 0.38 + 0.8) * 10) / 10;

/** Length of the finished Short: the clip plus the call-to-action. */
export const specLength = (spec: RenderSpec) => clipLength(spec) + spec.hold;

/** Everything ffmpeg needs for one Short; also what the preview draws. Caption times are from the clip's start. */
export function buildSpec(project: ShortsProject, short: ShortState, measure: Measure): RenderSpec {
  const span = clipSpan(project.sentences, short, project.video.duration);
  const { start, end } = span;
  const dur = clipLength(span);
  const ctaText = short.cta.trim();
  const ctaAudio = currentCta(project, short);
  const hold = ctaText ? round(ctaAudio?.duration ?? estimateCta(ctaText)) : 0;
  const tagSize = Math.min(project.endTag?.size ?? END_TAG.size, endTagMaxSize(measure));
  const tagGap = project.endTag?.gap ?? END_TAG.gap;
  const chunks = chunkWords(clipWords(project.sentences, short));
  const captions: RenderSpec["captions"] = chunks.map((c, i) => {
    const text = c.map((w) => captionText(w.text)).join(" ");
    const width = measure(text, "montserrat", CAPTION.size);
    const size = Math.max(48, Math.floor(CAPTION.size * Math.min(1, CAPTION.maxWidth / Math.max(1, width))));
    const next = chunks[i + 1];
    const a = Math.max(0, toShortTime(span, c[0].start));
    const last = toShortTime(span, c[c.length - 1].end) + 0.5;
    const b = Math.min(dur, next ? Math.min(toShortTime(span, next[0].start), last) : last);
    return {
      start: round(a),
      end: round(Math.max(a + 0.1, b)),
      size,
      words: c.map((w) => ({ text: captionText(w.text), start: round(Math.max(a, toShortTime(span, w.start))) })),
    };
  });
  return {
    projectId: project.id,
    video: project.video.path,
    file: shortFileName(short.n),
    start: round(start),
    end: round(end),
    keep: span.keep?.map((p) => ({ start: round(p.start), end: round(p.end) })),
    hold,
    crop: short.crop,
    hook: short.showHook ? layoutHook(short.hook, short.hookKey, measure) : null,
    captions,
    shots: fullScreenShots(project, short, span, hold),
    cta: ctaText ? { audio: ctaAudio?.path ?? null } : null,
    // The tag belongs to the spoken line; captions end with the clip, so the two never overlap.
    endTag:
      short.showEndTag && ctaText
        ? {
            width: endTagWidth(tagSize, measure),
            at: round(dur),
            x: END_TAG.x,
            ...(tagSize !== END_TAG.size && { size: tagSize }),
            ...(tagGap !== END_TAG.gap && { gap: tagGap }),
          }
        : null,
  };
}

/**
 * The Short's image timeline. Neighbouring shots on the same image are one continuous zoom, and
 * the last image stays on under the call-to-action, with its zoom running through both.
 */
function fullScreenShots(project: ShortsProject, short: ShortState, span: ClipSpan, hold: number): RenderSpec["shots"] {
  const dur = clipLength(span);
  const groups = clipGroups(project.sentences, short, project.shotMeta);
  const spans = groupSpans(project.sentences, groups, span);
  const images = assignedImages(short, groups);
  const out: RenderSpec["shots"] = [];
  groups.forEach((g, i) => {
    const image = images[i];
    if (!image || spans[i].to <= spans[i].from) return;
    const prev = out[out.length - 1];
    if (prev && prev.image === image && prev.to === spans[i].from) prev.to = spans[i].to;
    else out.push({ from: spans[i].from, to: spans[i].to, image, motion: g.motion });
  });
  const last = out[out.length - 1];
  if (hold > 0 && last) {
    if (last.to === dur) last.to = dur + hold;
    else out.push({ from: dur, to: dur + hold, image: last.image, motion: last.motion });
  }
  return out.map((s) => ({ ...s, from: round(s.from), to: round(s.to) }));
}

const round = (t: number) => Math.round(t * 1000) / 1000;

/** What a voice preview depends on: when it no longer matches, the preview is built again. */
export const voiceKey = (spec: RenderSpec) => [spec.start, spec.end, spec.hold, spec.cta?.audio ?? "", ...(spec.keep ?? []).flatMap((p) => [p.start, p.end])].join("|");

/** One vertical image a Short needs: the file it should be, and where in the video and script it goes. */
export type ImageRequest = {
  file: string;
  shots: number[];
  part: string;
  /** Seconds in the long video. */
  from: number;
  to: number;
  motion: ImageMotion;
  visual: string;
  /** What is on this shot right now, if anything. */
  image: string | null;
};

export function imageRequests(project: ShortsProject, short: ShortState): ImageRequest[] {
  const span = clipSpan(project.sentences, short, project.video.duration);
  const groups = clipGroups(project.sentences, short, project.shotMeta);
  const spans = groupSpans(project.sentences, groups, span);
  const images = assignedImages(short, groups);
  return groups.map((g, i) => {
    const s = project.sentences[g.sentence];
    return {
      file: `${String(i + 1).padStart(2, "0")}.png`,
      shots: g.shots,
      part: s.partName ? `${s.partTitle} – ${s.partName}` : s.partTitle,
      from: toVideoTime(span, spans[i].from),
      // A hair before its end, so a shot ending at a cut reads as ending there, not after the cut.
      to: toVideoTime(span, spans[i].to - 0.001),
      motion: g.motion,
      visual: project.shotMeta?.[g.key]?.visual ?? "",
      image: images[i],
    };
  });
}

/** Stable fingerprint of a spec, to know when a Short needs rendering again. */
export function specHash(spec: RenderSpec) {
  const s = JSON.stringify(spec);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ───────────────────────── Upload text ─────────────────────────

/** Words written with a capital mid-sentence somewhere in the script: names, places, companies. */
export function properNouns(sentences: Sentence[]): Set<string> {
  const set = new Set<string>();
  for (const s of sentences) {
    s.words.forEach((w, k) => {
      const bare = w.text.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9%]+$/g, "");
      if (k > 0 && /^[A-Z]/.test(bare)) set.add(bare.toLowerCase());
    });
  }
  return set;
}

/** "THE MARGIN CALL Begins" → "The margin call begins", keeping names and acronyms. */
export function sentenceCase(text: string, names: Set<string>) {
  // In an all-caps title every word looks like an acronym, so only the script's names keep capitals.
  const shouting = text === text.toUpperCase();
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const bare = w.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9%]+$/g, "");
      if (!shouting && /^[A-Z]{2,5}s?$/.test(bare)) return w; // FTX, SEC, CEOs
      if (names.has(bare.toLowerCase())) return cap(w);
      return i === 0 ? cap(w) : w.toLowerCase();
    })
    .join(" ");
}

/**
 * The video's main subject for the hashtag: the name said most often. A surname said on
 * its own counts toward the full name ("Hwang" → "Bill Hwang"); a capitalised word at the
 * start of a sentence only counts if the script also capitalises it mid-sentence.
 */
export function mainSubject(sentences: Sentence[], title?: string | null): string {
  const names = properNouns(sentences);
  const skip = /^(i|part|the|a|an|and|but|so|if|in|on|of|at|by|for|to|it|this|that|he|she|they|we|you|his|her|their|our|my|now|then|when|what|why|how|or|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
  const counts = new Map<string, number>();
  for (const s of sentences) {
    let run: string[] = [];
    const flush = () => {
      if (run.length) counts.set(run.join(" "), (counts.get(run.join(" ")) ?? 0) + 1);
      run = [];
    };
    s.words.forEach((w) => {
      const bare = w.text.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").replace(/[’']s$/, "");
      if (/^[A-Z][A-Za-z]+$/.test(bare) && !skip.test(bare) && names.has(bare.toLowerCase())) run.push(bare);
      else flush();
      if (/[,.!?;:]["'”’)]*$/.test(w.text)) flush();
    });
    flush();
  }
  const total = new Map(counts);
  for (const [name, c] of counts) {
    if (name.includes(" ")) continue;
    // Credit the single word to the full name it belongs to, if there is one.
    const full = [...counts.keys()].filter((k) => k.includes(" ") && k.split(" ").includes(name)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
    if (full && full !== name) {
      total.set(full, (total.get(full) ?? 0) + c);
      total.delete(name);
    }
  }
  let best = "";
  let n = 0;
  for (const [name, c] of total) if (c > n || (c === n && name.length > best.length)) [best, n] = [name, c];
  if (!best && title) best = title.split(/\s+/).filter((w) => /^[A-Z][a-z]/.test(w) && !skip.test(w)).slice(0, 2).join(" ");
  return best.replace(/[^A-Za-z0-9]/g, "");
}

/** Upload title: the hook title in sentence case, under 60 characters. */
export function shortTitle(short: ShortState, names: Set<string>) {
  let t = sentenceCase(short.hook.replace(/\s+/g, " ").trim(), names);
  while (t.length >= 60 && t.includes(" ")) t = t.slice(0, t.lastIndexOf(" "));
  return t.slice(0, 59);
}

/** Each Short's opening line for its description: its hook sentence, or another of its own lines if a Short before it already uses that one. */
function descriptionLines(project: ShortsProject) {
  const taken = new Set<string>();
  const lines: Record<number, string> = {};
  for (const s of project.shorts) {
    const gone = cutShots(project.sentences, s);
    const own = project.sentences.slice(s.from, s.to + 1).filter((x) => !gone.has(x.shot));
    const lead = project.sentences[s.hookSentence ?? s.from];
    const options = [...(lead && !gone.has(lead.shot) ? [lead] : []), ...own].map((x) => x.text.trim());
    const line = options.find((o) => !taken.has(titleId(o))) ?? `Part ${s.n}: ${options[0]}`;
    taken.add(titleId(line));
    lines[s.n] = line;
  }
  return lines;
}

/** "[Hook sentence] Full story on the channel. #shorts #finance #Subject" */
export function shortDescription(project: ShortsProject, short: ShortState) {
  let line = descriptionLines(project)[short.n];
  if (!/[.!?]["'”’)]*$/.test(line)) line += ".";
  const tag = project.subject.replace(/[^A-Za-z0-9]/g, "");
  return `${line} Full story on the channel. #shorts #finance${tag ? ` #${tag}` : ""}`;
}
