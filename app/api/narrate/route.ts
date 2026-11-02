import { startJob } from "@/lib/server/jobs";
import { narratePart } from "@/lib/server/tts";
import { isSpeed, isVoice } from "@/lib/script";

/** Speaks one script part, shot by shot. Returns a job; the result is a Narration. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const shots = Array.isArray(body?.shots) ? body.shots : [];
  const valid = shots.filter(
    (s: unknown): s is { n: number; narration: string } =>
      !!s && typeof (s as { n: unknown }).n === "number" && typeof (s as { narration: unknown }).narration === "string" && !!(s as { narration: string }).narration.trim(),
  );
  if (!valid.length) return Response.json({ error: "This part has no narration to speak." }, { status: 400 });
  if (!isVoice(body.voice)) return Response.json({ error: "That is not one of the voices on offer." }, { status: 400 });
  if (!isSpeed(body.rate)) return Response.json({ error: "That is not one of the speeds on offer." }, { status: 400 });

  const intro = typeof body.intro === "string" && body.intro.trim() ? body.intro.trim().slice(0, 200) : undefined;
  const job = startJob("narrate", (update) =>
    narratePart(valid, body.voice, body.rate, (stage, progress) => update({ stage, progress }), intro),
  );
  return Response.json({ jobId: job.id });
}
