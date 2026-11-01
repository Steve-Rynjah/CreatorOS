import { normalizePath } from "@/lib/server/fsutil";
import { scanParts } from "@/lib/server/merge";

export async function POST(req: Request) {
  try {
    const { dir } = (await req.json()) as { dir: string };
    if (!dir?.trim()) return Response.json({ error: "Folder path is required." }, { status: 400 });
    const folder = normalizePath(dir);
    const result = await scanParts(folder);
    if (!result.parts.length) throw new Error(`No videos found in ${folder}`);
    return Response.json({ dir: folder, ...result });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
