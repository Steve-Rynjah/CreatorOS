import { normalizePath } from "@/lib/server/fsutil";
import { compatibility, probeFiles, type PartInfo } from "@/lib/server/merge";

/**
 * Length and format of the videos in the slots, and whether they can be joined
 * losslessly. Each file is reported on its own, so one missing file doesn't hide the rest.
 */
export async function POST(req: Request) {
  const { paths } = (await req.json().catch(() => ({}))) as { paths?: string[] };
  if (!paths?.length) return Response.json({ files: [], canCopy: true });
  const results = await Promise.allSettled(paths.map((p) => probeFiles([normalizePath(p)]).then((r) => r[0])));
  const ok: PartInfo[] = [];
  const files = results.map((r, i) => {
    if (r.status === "fulfilled") {
      ok.push(r.value);
      return { path: paths[i], name: r.value.name, info: r.value.info };
    }
    return { path: paths[i], error: (r.reason as Error).message };
  });
  return Response.json({ files, ...compatibility(ok) });
}
