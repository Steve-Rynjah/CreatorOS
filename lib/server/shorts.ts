import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { probe } from "./ffmpeg";
import { ensureDir } from "./fsutil";
import { SHORTS_DIR } from "./shortRender";
import { transcribeWords, type Word } from "./transcribe";

/** Whisper words for a video, cached by file identity so reopening a project is instant. */
export async function videoWords(file: string, onStage: (stage: string, progress: number) => void): Promise<{ words: Word[]; duration: number }> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new Error("The video is no longer there. Add it again.");
  const key = createHash("sha1").update(`v1|${file}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 16);
  await ensureDir(SHORTS_DIR);
  const cache = path.join(SHORTS_DIR, `words-${key}.json`);
  const hit = await fs.readFile(cache, "utf8").then(JSON.parse, () => null);
  if (hit?.words?.length) return hit;
  const { duration } = await probe(file);
  const words = await transcribeWords(file, onStage);
  if (!words.length) throw new Error("Whisper heard no speech in this video.");
  const result = { words, duration };
  await fs.writeFile(cache, JSON.stringify(result));
  return result;
}
