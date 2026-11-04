import { normalizePath } from "@/lib/server/fsutil";
import { startJob } from "@/lib/server/jobs";
import { mergeParts, probeFiles, scanParts } from "@/lib/server/merge";

/**
 * Joins videos into one. Either `files` (hand-picked, in order) with an `outDir`,
 * or a `dir` of VIDEO01, VIDEO02 … (the older folder flow).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      files?: string[];
      outDir?: string;
      dir?: string;
      exclude?: string[];
      outName?: string;
      reencode?: boolean;
    };
    let selected;
    let outDir: string;
    if (body.files?.length) {
      if (!body.outDir?.trim()) throw new Error("Choose where to save the merged video.");
      selected = await probeFiles(body.files.map(normalizePath));
      outDir = normalizePath(body.outDir);
    } else {
      if (!body.dir?.trim()) throw new Error("Add the videos to merge.");
      outDir = normalizePath(body.dir);
      const { parts } = await scanParts(outDir);
      selected = parts.filter((p) => !body.exclude?.includes(p.name));
    }
    const job = startJob("merge", (update) => mergeParts(selected, outDir, body.outName || "MERGED", !!body.reencode, update));
    return Response.json({ jobId: job.id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
