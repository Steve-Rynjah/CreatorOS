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
