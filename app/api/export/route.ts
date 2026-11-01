import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { runFfmpeg } from "@/lib/server/ffmpeg";
import { CACHE_DIR, ensureDir, normalizePath, uniquePath } from "@/lib/server/fsutil";

/**
 * Receives the browser-rendered (video-only) MP4, adds the voice-over and
 * writes the final file. Video is stream-copied, so no quality is lost here.
 *
 * Query: audio, outDir, name, duration, srt? (optional SRT text is sent separately)
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const audio = url.searchParams.get("audio");
  const outDirRaw = url.searchParams.get("outDir");
  const nameRaw = url.searchParams.get("name") || "VIDEO01";
  const duration = parseFloat(url.searchParams.get("duration") || "0");
  if (!audio || !outDirRaw || !req.body) {
    return Response.json({ error: "Missing audio, outDir or video body." }, { status: 400 });
  }
  const tmpVideo = path.join(CACHE_DIR, `render-${randomUUID()}.mp4`);
  try {
    await ensureDir(CACHE_DIR);
    await pipeline(Readable.fromWeb(req.body as never), fs.createWriteStream(tmpVideo));

    const outDir = normalizePath(outDirRaw);
    await ensureDir(outDir);
    const safeName = nameRaw.replace(/[\\/:*?"<>|]/g, "_").replace(/\.mp4$/i, "");
    const output = await uniquePath(path.join(outDir, `${safeName}.mp4`));

    await runFfmpeg([
      "-y",
      "-i", tmpVideo,
      "-i", normalizePath(audio),
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "320k",
      "-ar", "48000",
      "-ac", "2",
      ...(duration > 0 ? ["-t", duration.toFixed(3)] : []),
      "-movflags", "+faststart",
      output,
    ]);
    return Response.json({ output });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    fs.promises.unlink(tmpVideo).catch(() => {});
  }
}
