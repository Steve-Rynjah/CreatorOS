import { normalizePath } from "@/lib/server/fsutil";
import { startJob } from "@/lib/server/jobs";
import { renderShort, renderShortVoice } from "@/lib/server/shortRender";
import type { RenderSpec } from "@/lib/shorts/types";

/** Renders one Short with ffmpeg (with ?voice=1, only its sound). Returns a job; the result is the file's path. */
export async function POST(req: Request) {
  const spec = (await req.json().catch(() => null)) as RenderSpec | null;
  if (!spec?.video || !Array.isArray(spec.captions) || !Array.isArray(spec.shots) || !(spec.end > spec.start)) {
    return Response.json({ error: "Nothing to render." }, { status: 400 });
  }
  if (spec.cta && !spec.cta.audio) return Response.json({ error: "The call-to-action hasn't been spoken yet." }, { status: 400 });
  const clean: RenderSpec = {
    ...spec,
    video: normalizePath(spec.video),
    shots: spec.shots.map((s) => ({ ...s, image: normalizePath(s.image) })),
    cta: spec.cta ? { audio: normalizePath(spec.cta.audio!) } : null,
  };
  const render = new URL(req.url).searchParams.get("voice") ? renderShortVoice : renderShort;
  const job = startJob("shorts-render", (update) => render(clean, (progress) => update({ progress, stage: "Rendering" })));
  return Response.json({ jobId: job.id });
}
