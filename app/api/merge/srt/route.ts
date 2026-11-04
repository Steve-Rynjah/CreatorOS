import fs from "node:fs/promises";
import path from "node:path";
import { VIDEO_EXT, normalizePath } from "@/lib/server/fsutil";

/** Saves the merged video's captions beside it: MERGED.mp4 → MERGED.srt. */
export async function POST(req: Request) {
  try {
    const { output, srt } = (await req.json()) as { output?: string; srt?: string };
    if (!output || typeof srt !== "string" || !srt.trim()) throw new Error("Nothing to save.");
    const video = normalizePath(output);
    if (!VIDEO_EXT.includes(path.extname(video).toLowerCase())) throw new Error("Not a video path.");
    const ok = await fs.stat(video).then((s) => s.isFile(), () => false);
    if (!ok) throw new Error("The merged video is no longer there.");
    const file = video.slice(0, -path.extname(video).length) + ".srt";
    await fs.writeFile(file, srt, "utf8");
    return Response.json({ path: file });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
