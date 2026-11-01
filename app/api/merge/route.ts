import { normalizePath } from "@/lib/server/fsutil";
import { startJob } from "@/lib/server/jobs";
import { mergeParts, scanParts } from "@/lib/server/merge";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      dir: string;
      exclude?: string[];
      outName?: string;
      reencode?: boolean;
    };
    const dir = normalizePath(body.dir);
    const { parts } = await scanParts(dir);
    const selected = parts.filter((p) => !body.exclude?.includes(p.name));
    const job = startJob("merge", (update) =>
      mergeParts(selected, dir, body.outName || "MERGED", !!body.reencode, update),
    );
    return Response.json({ jobId: job.id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
