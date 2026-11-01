import fs from "node:fs";
import path from "node:path";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, contentType, normalizePath } from "@/lib/server/fsutil";

/**
 * fs stream → web stream that tolerates the browser cancelling mid-way (audio/video seeking
 * does this constantly). Readable.toWeb can throw "Controller is already closed" then.
 */
function fileStream(file: string, opts?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const node = fs.createReadStream(file, opts);
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
          if ((controller.desiredSize ?? 1) <= 0) node.pause();
        } catch {
          closed = true;
          node.destroy();
        }
      });
      node.on("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      });
      node.on("error", (err) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {}
      });
    },
    pull() {
      node.resume();
    },
    cancel() {
      closed = true;
      node.destroy();
    },
  });
}

const ALLOWED = new Set([...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT, ".srt"]);

/**
 * Streams a local media file to the browser (with Range support so audio/video seeking works).
 * Restricted to media extensions; this app is meant to run on your own machine only.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("path");
  if (!raw) return new Response("Missing path", { status: 400 });
  const file = normalizePath(raw);
  if (!ALLOWED.has(path.extname(file).toLowerCase())) {
    return new Response("File type not allowed", { status: 403 });
  }
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": contentType(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (url.searchParams.get("download")) {
    headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(path.basename(file))}"`;
  }

  const range = req.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    const stream = fileStream(file, { start, end });
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  const stream = fileStream(file);
  return new Response(stream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
