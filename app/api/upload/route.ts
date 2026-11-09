import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AUDIO_EXT, CACHE_DIR, IMAGE_EXT, VIDEO_EXT, ensureDir } from "@/lib/server/fsutil";

/**
 * Stores a voice-over (or, with ?kind=video, a video part) dropped/pasted in the browser. The stored path is stable for the
 * same file (name + size + modified time), so saved edits are restored when it's added again.
 * With ?kind=image&folder=a/b, images keep their own names inside that folder, so their number order survives.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const name = path.basename(url.searchParams.get("name") || "");
  const size = url.searchParams.get("size") || "";
  const modified = url.searchParams.get("modified") || "";
  const ext = path.extname(name).toLowerCase();
  const kind = url.searchParams.get("kind") === "video" ? "video" : url.searchParams.get("kind") === "image" ? "image" : "audio";
  const allowed = { video: VIDEO_EXT, image: IMAGE_EXT, audio: AUDIO_EXT }[kind];
  if (!name || !allowed.includes(ext)) {
    return Response.json({ error: `Unsupported ${kind} file. Use ${allowed.join(", ")}` }, { status: 400 });
  }
  if (!req.body) return Response.json({ error: "Empty upload" }, { status: 400 });

  // Dots are replaced too, so no segment can climb out of the uploads folder.
  const folder = kind === "image" ? (url.searchParams.get("folder") || "").split("/").map((s) => s.replace(/[^\w\- ]/g, "_")).filter((s) => s.trim()) : [];
  const dir = path.join(CACHE_DIR, "uploads", ...folder);
  await ensureDir(dir);
  const key = createHash("sha1").update(`${name}|${size}|${modified}`).digest("hex").slice(0, 12);
  const safe = name.replace(/[^\w.\- ]/g, "_");
  const dest = path.join(dir, folder.length ? safe : `${key}-${safe}`);
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(req.body as never), fs.createWriteStream(tmp));
    await fs.promises.rename(tmp, dest);
    return Response.json({ path: dest, name, dir });
  } catch (e) {
    fs.promises.unlink(tmp).catch(() => {});
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
