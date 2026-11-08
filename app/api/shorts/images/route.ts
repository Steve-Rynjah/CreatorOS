import { normalizePath } from "@/lib/server/fsutil";
import { scanShortImages } from "@/lib/server/shortImages";

/** Lists the vertical images in one Short's folder. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { dir?: string } | null;
  if (!body?.dir?.trim()) return Response.json({ error: "No folder given." }, { status: 400 });
  try {
    return Response.json(await scanShortImages(normalizePath(body.dir)));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
