import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AUDIO_EXT, CACHE_DIR, ensureDir } from "@/lib/server/fsutil";

/**
 * Stores a voice-over file dropped/pasted in the browser. The stored path is stable for the
 * same file (name + size + modified time), so saved edits are restored when it's added again.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const name = path.basename(url.searchParams.get("name") || "");
  const size = url.searchParams.get("size") || "";
  const modified = url.searchParams.get("modified") || "";
  const ext = path.extname(name).toLowerCase();
  if (!name || !AUDIO_EXT.includes(ext)) {
    return Response.json({ error: `Unsupported audio file. Use ${AUDIO_EXT.join(", ")}` }, { status: 400 });
  }
  if (!req.body) return Response.json({ error: "Empty upload" }, { status: 400 });

  const dir = path.join(CACHE_DIR, "uploads");
  await ensureDir(dir);
  const key = createHash("sha1").update(`${name}|${size}|${modified}`).digest("hex").slice(0, 12);
  const dest = path.join(dir, `${key}-${name.replace(/[^\w.\- ]/g, "_")}`);
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(req.body as never), fs.createWriteStream(tmp));
    await fs.promises.rename(tmp, dest);
    return Response.json({ path: dest, name });
  } catch (e) {
    fs.promises.unlink(tmp).catch(() => {});
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
