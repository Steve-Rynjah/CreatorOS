import { normalizePath } from "@/lib/server/fsutil";
import { startJob } from "@/lib/server/jobs";
import { videoWords } from "@/lib/server/shorts";

/** Every spoken word of a video with its time, from local Whisper. Returns a job. */
export async function POST(req: Request) {
  const { path } = (await req.json().catch(() => ({}))) as { path?: string };
  if (!path) return Response.json({ error: "Add the video first." }, { status: 400 });
  const file = normalizePath(path);
  const job = startJob("shorts-words", (update) => videoWords(file, (stage, progress) => update({ stage, progress })));
  return Response.json({ jobId: job.id });
}
