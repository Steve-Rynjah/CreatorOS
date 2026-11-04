import { normalizePath } from "@/lib/server/fsutil";
import { speechSpans } from "@/lib/server/merge";

/** Speaking spans of a video (pauses removed), used to time script captions. */
export async function POST(req: Request) {
  try {
    const { path } = (await req.json()) as { path?: string };
    if (!path) throw new Error("Missing path");
    return Response.json(await speechSpans(normalizePath(path)));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
