"use client";
import { useMemo, useState } from "react";
import { Button, ProgressBar, Segmented } from "@/components/ui";
import { Select } from "@/components/editor/Setup";
import { fileUrl } from "@/lib/editor/render";
import { clipSpan, hookWords } from "@/lib/shorts/layout";
import { partOptions } from "@/lib/shorts/pick";
import { cutShots, toVideoTime } from "@/lib/shorts/shots";
import type { Candidate, ShortState, ShortsProject } from "@/lib/shorts/types";
import { SHORT_LABEL } from "./ShortEditor";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
type N = 1 | 2 | 3;

/** Listen to each Short and read what it says; approve all three, or send one back for a different part. */
export function ReviewStage({
  project,
  renders,
  working,
  onApprove,
  onRegenerate,
  onRetry,
}: {
  project: ShortsProject;
  renders: Record<number, { progress: number }>;
  working: boolean;
  onApprove: () => void;
  onRegenerate: (n: N, clip: Candidate) => void;
  onRetry: (n: N) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const ready = project.shorts.every((s) => s.voicePreview);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {project.shorts.map((s) => (
          <ReviewCard key={s.n} project={project} short={s} render={renders[s.n] ?? null} working={working} onRetry={() => onRetry(s.n)} />
        ))}
      </div>
      <section className="rounded-2xl border border-line-strong/60 bg-raised/60 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Happy with all three?</h2>
            <p className="text-xs text-muted mt-0.5">Once approved, you add the images and the final videos are made.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setRejecting((r) => !r)} disabled={working}>
              Not approved
            </Button>
            <Button variant="primary" onClick={onApprove} disabled={working || !ready}>
              Approve all three
            </Button>
          </div>
        </div>
        {rejecting && <Regenerate project={project} working={working} onRegenerate={onRegenerate} />}
      </section>
    </div>
  );
}

function ReviewCard({
  project,
  short,
  render,
  working,
  onRetry,
}: {
  project: ShortsProject;
  short: ShortState;
  render: { progress: number } | null;
  working: boolean;
  onRetry: () => void;
}) {
  const [time, setTime] = useState(-1);
  const { sentences } = project;
  const span = clipSpan(sentences, short, project.video.duration);
  const { start, end } = span;
  const gone = cutShots(sentences, short);
  const clip = sentences.slice(short.from, short.to + 1).filter((s) => !gone.has(s.shot));
  const first = clip[0];
  const words = hookWords(short.hook);
  const playhead = toVideoTime(span, time);
  // The sentence being spoken: the last one that has started, while the clip itself is playing.
  const spoken = time < 0 || playhead > end ? -1 : clip.reduce((at, s) => (s.start <= playhead ? s.i : at), -1);

  return (
    <section id={`short-${short.n}`} className="rounded-2xl border border-line-strong/60 bg-raised/60 p-4 flex flex-col gap-3 min-w-0 scroll-mt-6">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1B1B1B] px-2.5 py-1 text-[11px] font-bold tracking-wide text-white ring-1 ring-white/10">
          <span className="text-[#FFD23F]">0{short.n}</span>
          {SHORT_LABEL[short.n]}
        </span>
        <span className="text-xs text-muted tabular-nums">
          {clock(start)}–{clock(end)}
        </span>
      </div>
      <p className="text-xs text-muted truncate">{first.partName ? `${first.partTitle} – ${first.partName}` : first.partTitle}</p>

      {short.voicePreview ? (
        <audio
          key={short.voicePreview.key}
          controls
          preload="metadata"
          src={fileUrl(short.voicePreview.path)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          className="w-full h-10"
          aria-label={`Voice of Short ${short.n}`}
        />
      ) : render ? (
        <div className="space-y-1.5">
          <div className="text-xs text-muted">Preparing the voice…</div>
          <ProgressBar value={render.progress} />
        </div>
      ) : (
        <Button size="sm" onClick={onRetry} disabled={working}>
          Prepare this voice
        </Button>
      )}

      <div className="rounded-xl border border-line-strong/50 bg-bg/40 p-3.5 space-y-2.5 flex-1">
        <div className="font-bold tracking-wide leading-tight">
          {words.map((w, i) => (
            <span key={`${w}-${i}`} className={i === short.hookKey ? "text-[#FFD23F]" : ""}>
              {w}{" "}
            </span>
          ))}
        </div>
        <p className="text-sm leading-6 text-muted">
          {clip.map((s) => (
            <span key={s.i} className={s.i === spoken ? "text-fg" : ""}>
              {s.text}{" "}
            </span>
          ))}
        </p>
        {short.cta.trim() && <p className="text-xs leading-5 text-subtle border-t border-line-strong/40 pt-2">Ends with: {short.cta.trim()}</p>}
      </div>
    </section>
  );
}

/** Which Short to redo, and which part of the script its new clip should come from. */
function Regenerate({ project, working, onRegenerate }: { project: ShortsProject; working: boolean; onRegenerate: (n: N, clip: Candidate) => void }) {
  const [n, setN] = useState<N>(1);
  const [partKey, setPartKey] = useState("");
  const options = useMemo(() => partOptions(project.sentences, project.shorts, n), [project.sentences, project.shorts, n]);
  const open = options.filter((o) => o.clip);
  const part = open.find((o) => o.key === partKey) ?? open.find((o) => !o.current) ?? open[0];
  const clip = part?.clip ?? null;

  return (
    <div className="rounded-xl border border-line-strong/50 bg-bg/40 p-4 space-y-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-4">
        <div>
          <span className="block text-xs font-medium text-muted mb-1.5">Which Short needs to change?</span>
          <Segmented<string>
            value={String(n)}
            options={project.shorts.map((s) => ({ value: String(s.n), label: `Short ${s.n}` }))}
            onChange={(v) => {
              setN(Number(v) as N);
              setPartKey("");
            }}
          />
        </div>
        <div className="min-w-0">
          <span className="block text-xs font-medium text-muted mb-1.5">Use which part of the script?</span>
          <Select value={part?.key ?? ""} onChange={setPartKey} disabled={!open.length}>
            {options.map((o) => (
              <option key={o.key} value={o.key} disabled={!o.clip}>
                {o.label} · {clock(o.start)}–{clock(o.end)}
                {o.current ? " (current)" : ""}
                {o.clip ? "" : " · no free clip"}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {clip ? (
        <p className="text-xs text-muted">
          New clip: {clock(clip.start)}–{clock(clip.end)} ({Math.round(clip.end - clip.start)} s), starting “{project.sentences[clip.from].text}”
        </p>
      ) : (
        <p className="text-xs text-warning">No part of the script has a clip that fits this Short without overlapping the other two.</p>
      )}
      <Button variant="primary" disabled={working || !clip} onClick={() => clip && onRegenerate(n, clip)}>
        Regenerate Short {n}
      </Button>
    </div>
  );
}
