import "server-only";
import path from "node:path";
import type { ShortImage } from "@/lib/shorts/types";
import { IMAGE_EXT, listNumbered } from "./fsutil";

/** One Short's folder of vertical images, in number order (01.png, 02.png…). */
export async function scanShortImages(dir: string): Promise<{ dir: string; images: ShortImage[] }> {
  const { files } = await listNumbered(dir, "", IMAGE_EXT);
  if (!files.length) throw new Error(`No images in ${path.basename(dir)}. Choose the folder with this Short's 01.png, 02.png…`);
  return { dir, images: files.map((f) => ({ name: f.name, path: f.path })) };
}
