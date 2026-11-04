import { IMAGE_EXT, listNumbered, normalizePath } from "@/lib/server/fsutil";

/** Lists a folder's shot images (001.png, 002.png …) for the thumbnail maker. */
export async function POST(req: Request) {
  try {
    const { dir } = (await req.json()) as { dir?: string };
    if (!dir?.trim()) return Response.json({ error: "Choose the shot images folder." }, { status: 400 });
    const { files } = await listNumbered(normalizePath(dir), "(?:EP|SHOT|SCENE|IMG|IMAGE)?", IMAGE_EXT);
    if (!files.length) throw new Error("No images found in that folder.");
    return Response.json({ images: files.map((f) => ({ name: f.name, path: f.path })) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
