import "server-only";
import os from "node:os";
import path from "node:path";
import { decodePcm } from "./ffmpeg";

export type Segment = { start: number; end: number; text: string };

type Transcriber = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;

const g = globalThis as unknown as { __whisper?: Map<string, Promise<Transcriber>> };
const cache = (g.__whisper ??= new Map());

async function loadModel(model: string): Promise<Transcriber> {
  let p = cache.get(model);
  if (!p) {
    p = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = path.join(os.homedir(), ".cache", "creatoros-models");
      const t = await pipeline("automatic-speech-recognition", model, { dtype: "q8" });
      return t as unknown as Transcriber;
    })();
    cache.set(model, p);
    p.catch(() => cache.delete(model));
  }
  return p;
}

/**
 * Speech-to-text fully on this machine with Whisper (no API key needed).
 * The model is downloaded once (~80–250 MB) and cached in ~/.cache/creatoros-models.
 */
export async function transcribe(
  audioFile: string,
  opts: { language: string; quality: "fast" | "accurate" },
  onStage: (stage: string, progress: number) => void,
): Promise<Segment[]> {
  const english = opts.language === "english";
  const size = opts.quality === "accurate" ? "small" : "base";
  const model = `Xenova/whisper-${size}${english ? ".en" : ""}`;

  onStage("Loading speech model (first run downloads it)", 0.05);
  const transcriber = await loadModel(model);

  onStage("Decoding audio", 0.15);
  const pcm = await decodePcm(audioFile, 16000);

  onStage("Transcribing", 0.25);
  const segments: Segment[] = [];
  // Feed the model ~5 min windows so we can report progress on long narrations.
  const windowSec = 300;
  const total = pcm.length / 16000;
  for (let start = 0; start < total; start += windowSec) {
    const slice = pcm.subarray(start * 16000, Math.min(pcm.length, (start + windowSec) * 16000));
    const out = await transcriber(slice, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      ...(english ? {} : opts.language === "auto" ? {} : { language: opts.language, task: "transcribe" }),
    });
    const sliceDur = slice.length / 16000;
    for (const c of out.chunks ?? []) {
      const text = c.text.trim();
      if (!text) continue;
      const s = start + (c.timestamp[0] ?? 0);
      const e = start + (c.timestamp[1] ?? sliceDur);
      segments.push({ start: s, end: Math.max(e, s + 0.3), text });
    }
    onStage("Transcribing", 0.25 + 0.75 * Math.min(1, (start + windowSec) / total));
  }
  return segments;
}

export type Word = { text: string; start: number; end: number };

/**
 * Every spoken word with its time, from the same local Whisper model (word
 * timestamps come from the model's cross-attention). Used by Shorts Maker to
 * time a finished video's script when no Home edit of it exists.
 */
export async function transcribeWords(
  mediaFile: string,
  onStage: (stage: string, progress: number) => void,
): Promise<Word[]> {
  onStage("Loading the speech model (the first run downloads it)", 0.03);
  const transcriber = await loadModel("Xenova/whisper-base.en");

  onStage("Reading the audio", 0.08);
  const pcm = await decodePcm(mediaFile, 16000);

  const words: Word[] = [];
  // ~2 min windows, cut in a quiet spot, so progress moves and no word is split.
  const rate = 16000;
  const total = pcm.length / rate;
  let start = 0;
  while (start < total - 0.05) {
    let end = Math.min(total, start + 120);
    if (end < total) end = quietestNear(pcm, rate, end, 4);
    const slice = pcm.subarray(Math.floor(start * rate), Math.floor(end * rate));
    const out = await transcriber(slice, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: "word" });
    for (const c of out.chunks ?? []) {
      const text = c.text.trim();
      if (!text) continue;
      const s = start + (c.timestamp[0] ?? 0);
      const e = start + (c.timestamp[1] ?? c.timestamp[0] ?? 0);
      words.push({ text, start: s, end: Math.max(e, s + 0.05) });
    }
    onStage(`Transcribing · ${Math.round(end / 60)} of ${Math.ceil(total / 60)} min`, 0.1 + 0.9 * (end / total));
    start = end;
  }
  return words;
}

/** The quietest 50 ms within ±`span` s of `t`, so a window boundary falls between words. */
function quietestNear(pcm: Float32Array, rate: number, t: number, span: number) {
  const step = Math.floor(rate * 0.05);
  let best = t;
  let bestE = Infinity;
  for (let x = Math.max(0, t - span); x < t + span; x += 0.05) {
    const a = Math.floor(x * rate);
    if (a + step > pcm.length) break;
    let e = 0;
    for (let i = a; i < a + step; i++) e += pcm[i] * pcm[i];
    if (e < bestE) {
      bestE = e;
      best = x;
    }
  }
  return best;
}
