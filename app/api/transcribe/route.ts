import { startJob } from "@/lib/server/jobs";
import { normalizePath } from "@/lib/server/fsutil";
import { transcribe } from "@/lib/server/transcribe";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    audioPath: string;
    language?: string;
    quality?: "fast" | "accurate";
  };
  if (!body.audioPath) return Response.json({ error: "Missing audioPath" }, { status: 400 });
  const job = startJob("transcribe", (update) =>
    transcribe(
      normalizePath(body.audioPath),
      { language: body.language ?? "english", quality: body.quality ?? "fast" },
      (stage, progress) => update({ stage, progress }),
    ),
  );
  return Response.json({ jobId: job.id });
}
