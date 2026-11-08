import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { decodePcm } from "./ffmpeg";
import { CACHE_DIR, ensureDir } from "./fsutil";
import { spokenText, type Narration, type NarrationCue, type SpeedId, type VoiceId } from "@/lib/script";

/**
 * Narration through Microsoft Edge's Read Aloud voices (free, keyless — same
 * approach as the trade-journal TTS tab).
 *
 * Every SHOT is spoken as its own request and the pieces are laid end to end,
 * so the exact moment each shot starts in the final audio is known to the
 * sample. That is what lets each image sit precisely under its narration.
 * Word-boundary events from the voice service time the subtitles, whose text
 * is the script's own wording.
 */

const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3;
const SAMPLE_RATE = 48000;
/** Breath between shots, so a cut never lands mid-word. */
const SHOT_GAP = 0.3;
const CONCURRENCY = 6;
const TIMEOUT_MS = 90_000;
/** Bump when the audio/timing layout changes so stale caches are not reused. */
const CACHE_VERSION = 3;
/** Silence held on the title card after its line is spoken, before the first shot. */
const INTRO_HOLD = 1.1;

type Word = { start: number; end: number; text: string };

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function speakOnce(text: string, voice: VoiceId, rate: SpeedId): Promise<{ mp3: Buffer; words: Word[] }> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, FORMAT, { wordBoundaryEnabled: true });
    const { audioStream, metadataStream } = tts.toStream(escapeXml(text), { rate });
    const parts: Buffer[] = [];
    const words: Word[] = [];
    metadataStream?.on("data", (d: Buffer) => {
      try {
        const j = JSON.parse(d.toString());
        for (const m of j.Metadata ?? []) {
          if (m.Type !== "WordBoundary") continue;
          const start = m.Data.Offset / 1e7;
          words.push({ start, end: start + m.Data.Duration / 1e7, text: m.Data.text?.Text ?? "" });
        }
      } catch {}
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        audioStream.destroy();
        reject(new Error("The voice service stopped answering."));
      }, TIMEOUT_MS);
    });
    try {
      await Promise.race([
        (async () => {
          for await (const c of audioStream) parts.push(c as Buffer);
        })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
    const mp3 = Buffer.concat(parts);
    if (!mp3.length) throw new Error("The voice service returned no audio.");
    return { mp3, words: words.sort((a, b) => a.start - b.start) };
  } finally {
    tts.close();
  }
}

async function speak(text: string, voice: VoiceId, rate: SpeedId) {
  try {
    return await speakOnce(text, voice, rate);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return speakOnce(text, voice, rate);
  }
}

/** Readable caption groups (≤ maxChars), breaking at sentence ends first, then commas, then words. */
function captionRanges(text: string, maxChars = 42): [number, number][] {
  const out: [number, number][] = [];
  const sentenceRe = /[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g;
  for (const m of text.matchAll(sentenceRe)) {
    const s = m[0];
    if (!s.trim()) continue;
    const base = m.index!;
    const tokens = [...s.matchAll(/\S+/g)];
    let groupStart = -1;
    let groupEnd = -1;
    for (const t of tokens) {
      const a = base + t.index!;
      const b = a + t[0].length;
      if (groupStart < 0) {
        groupStart = a;
        groupEnd = b;
        continue;
      }
      if (b - groupStart > maxChars) {
        out.push([groupStart, groupEnd]);
        groupStart = a;
        groupEnd = b;
        continue;
      }
      groupEnd = b;
      if (/[,;:—]$/.test(t[0]) && b - groupStart > maxChars * 0.6) {
        out.push([groupStart, groupEnd]);
        groupStart = -1;
      }
    }
    if (groupStart >= 0) out.push([groupStart, groupEnd]);
  }
  return out;
}

/** Subtitle cues for one shot: the script's words, timed by the voice's word boundaries. */
function shotCues(text: string, words: Word[], offset: number, speechEnd: number): NarrationCue[] {
  // Where each spoken word sits in the script text.
  const lower = text.toLowerCase();
  let cursor = 0;
  const placed: (Word & { pos: number })[] = [];
  for (const w of words) {
    const needle = w.text.toLowerCase().trim();
    if (!needle) continue;
    const pos = lower.indexOf(needle, cursor);
    if (pos < 0) continue;
    placed.push({ ...w, pos });
    cursor = pos + needle.length;
  }

  const ranges = captionRanges(text);
  const cues: (NarrationCue & { tokens: (number | null)[] })[] = ranges.map(([a, b]) => {
    const inside = placed.filter((w) => w.pos >= a && w.pos < b);
    // Start time of every whitespace-separated word of the caption, where the voice reported one.
    const tokens = [...text.slice(a, b).matchAll(/\S+/g)].map((m) => {
      const ta = a + m.index!;
      const tb = ta + m[0].length;
      return placed.find((w) => w.pos >= ta && w.pos < tb)?.start ?? null;
    });
    return {
      text: text.slice(a, b),
      start: inside.length ? inside[0].start : NaN,
      end: inside.length ? inside[inside.length - 1].end : NaN,
      tokens,
    };
  });

  // Groups the voice gave no boundary for (rare) share the gap around them by length.
  for (let i = 0; i < cues.length; i++) {
    if (!Number.isNaN(cues[i].start)) continue;
    let j = i;
    while (j < cues.length && Number.isNaN(cues[j].start)) j++;
    const from = i > 0 ? cues[i - 1].end : 0;
    const to = j < cues.length ? cues[j].start : speechEnd;
    const len = cues.slice(i, j).reduce((s, c) => s + c.text.length, 0) || 1;
    let t = from;
    for (let k = i; k < j; k++) {
      const d = ((to - from) * cues[k].text.length) / len;
      cues[k].start = t;
      cues[k].end = t + d;
      t += d;
    }
    i = j - 1;
  }

  // Hold each caption until the next one (or the end of the shot's speech), so text doesn't flicker.
  for (let i = 0; i < cues.length; i++) {
    const next = i + 1 < cues.length ? cues[i + 1].start : speechEnd;
    cues[i].end = Math.max(cues[i].end, next - 0.02);
  }
  return cues
    .filter((c) => c.end > c.start)
    .map((c) => ({ text: c.text, start: offset + c.start, end: offset + c.end, words: wordStarts(c.tokens, c.start, c.end, offset) }));
}

/** Fills words the voice gave no boundary for (numbers, symbols) between their neighbours. */
function wordStarts(tokens: (number | null)[], start: number, end: number, offset: number): number[] {
  const out = tokens.slice();
  if (out[0] === null) out[0] = start;
  for (let i = 1; i < out.length; i++) {
    if (out[i] !== null && out[i]! >= out[i - 1]!) continue;
    let j = i;
    while (j < out.length && (out[j] === null || out[j]! < out[i - 1]!)) j++;
    const to = j < out.length ? out[j]! : end;
    const from = out[i - 1]!;
    for (let k = i; k < j; k++) out[k] = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    i = j - 1;
  }
  return out.map((t) => Math.round((offset + t!) * 1000) / 1000);
}

function wavFile(pcm: Float32Array, rate: number): Buffer {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    data.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Kept after the call-to-action's last word: the Short's audio fades out over this. */
const LINE_TAIL = 0.5;

/** One line spoken on its own as a WAV (the Shorts' call-to-action), cut to end just after its last word. Cached. */
export async function speakLine(line: string, voice: VoiceId, rate: SpeedId): Promise<{ path: string; duration: number }> {
  const text = spokenText(line);
  const key = createHash("sha1").update(JSON.stringify({ v: 2, voice, rate, text, tail: LINE_TAIL })).digest("hex").slice(0, 16);
  const dir = path.join(CACHE_DIR, "narration");
  await ensureDir(dir);
  const wavPath = path.join(dir, `line-${key}.wav`);
  const samples = SAMPLE_RATE;
  const done = await fs.stat(wavPath).catch(() => null);
  if (done) return { path: wavPath, duration: (done.size - 44) / 2 / samples };

  const spoken = await speak(text, voice, rate);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "creatoros-tts-"));
  try {
    const mp3 = path.join(tmp, "line.mp3");
    await fs.writeFile(mp3, spoken.mp3);
    const pcm = await decodePcm(mp3, samples);
    const lastWord = spoken.words[spoken.words.length - 1]?.end;
    const speechEnd = lastWord && lastWord * samples < pcm.length ? lastWord : pcm.length / samples;
    const out = new Float32Array(Math.round((speechEnd + LINE_TAIL) * samples));
    out.set(pcm.subarray(0, out.length)); // the voice's own decay runs into the closing fade
    await fs.writeFile(wavPath + ".tmp", wavFile(out, samples));
    await fs.rename(wavPath + ".tmp", wavPath);
    return { path: wavPath, duration: out.length / samples };
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Speaks every shot of a part and lays them out into one WAV with exact shot + subtitle timings. Cached. */
export async function narratePart(
  shots: { n: number; narration: string }[],
  voice: VoiceId,
  rate: SpeedId,
  onProgress: (stage: string, progress: number) => void,
  /** Chapter title spoken over the title card, before the first shot. */
  intro?: string,
): Promise<Narration> {
  const texts = shots.map((s) => spokenText(s.narration));
  const introText = intro ? spokenText(intro) : "";
  const key = createHash("sha1")
    .update(JSON.stringify({ v: CACHE_VERSION, voice, rate, gap: SHOT_GAP, intro: introText, hold: INTRO_HOLD, shots: shots.map((s, i) => [s.n, texts[i]]) }))
    .digest("hex")
    .slice(0, 16);
  const dir = path.join(CACHE_DIR, "narration");
  await ensureDir(dir);
  const wavPath = path.join(dir, `narration-${key}.wav`);
  const jsonPath = path.join(dir, `narration-${key}.json`);
  const cached = await fs.readFile(jsonPath, "utf8").then(JSON.parse, () => null);
  if (cached && (await fs.stat(wavPath).then(() => true, () => false))) return cached as Narration;

  // Speak the title (if any) and the shots in parallel; index 0 is the title.
  const allTexts = introText ? [introText, ...texts] : texts;
  const spokenAll: { mp3: Buffer; words: Word[] }[] = new Array(allTexts.length);
  let next = 0;
  let done = 0;
  onProgress(`Speaking shot 1 of ${shots.length}`, 0.02);
  const worker = async () => {
    while (next < allTexts.length) {
      const i = next++;
      spokenAll[i] = await speak(allTexts[i], voice, rate);
      done++;
      onProgress(`Spoke ${done} of ${allTexts.length} lines`, 0.02 + 0.85 * (done / allTexts.length));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, allTexts.length) }, worker));
  const introSpoken = introText ? spokenAll[0] : null;
  const spoken = introText ? spokenAll.slice(1) : spokenAll;

  // Decode each shot to PCM and lay them end to end.
  onProgress("Joining the shots", 0.9);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "creatoros-tts-"));
  try {
    const pcms: Float32Array[] = [];
    for (let i = 0; i < shots.length; i++) {
      const f = path.join(tmp, `${i}.mp3`);
      await fs.writeFile(f, spoken[i].mp3);
      pcms.push(await decodePcm(f, SAMPLE_RATE));
    }
    let introPcm: Float32Array | null = null;
    if (introSpoken) {
      const f = path.join(tmp, "intro.mp3");
      await fs.writeFile(f, introSpoken.mp3);
      introPcm = await decodePcm(f, SAMPLE_RATE);
    }
    // The title is spoken after a short beat of the card, then held before the first shot.
    const introLead = Math.round(0.5 * SAMPLE_RATE);
    const introLen = introPcm ? introLead + introPcm.length + Math.round(INTRO_HOLD * SAMPLE_RATE) : 0;
    const gap = Math.round(SHOT_GAP * SAMPLE_RATE);
    const total = introLen + pcms.reduce((s, p) => s + p.length + gap, 0);
    const all = new Float32Array(total);
    if (introPcm) all.set(introPcm, introLead);
    const timed: Narration["shots"] = [];
    const cues: NarrationCue[] = [];
    let pos = introLen;
    for (let i = 0; i < shots.length; i++) {
      all.set(pcms[i], pos);
      const start = pos / SAMPLE_RATE;
      const speechLen = pcms[i].length / SAMPLE_RATE;
      pos += pcms[i].length + gap;
      timed.push({ n: shots[i].n, start, end: pos / SAMPLE_RATE });
      cues.push(...shotCues(texts[i], spoken[i].words, start, speechLen));
    }
    const result: Narration = {
      audioPath: wavPath,
      duration: total / SAMPLE_RATE,
      shots: timed,
      cues,
      ...(introLen ? { intro: { end: introLen / SAMPLE_RATE } } : {}),
    };
    await fs.writeFile(wavPath + ".tmp", wavFile(all, SAMPLE_RATE));
    await fs.rename(wavPath + ".tmp", wavPath);
    await fs.writeFile(jsonPath, JSON.stringify(result));
    return result;
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
