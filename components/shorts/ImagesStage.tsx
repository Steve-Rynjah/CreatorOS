"use client";
import { Button, ProgressBar } from "@/components/ui";
import { CopyButton } from "@/components/publish/bits";
import { fileUrl } from "@/lib/editor/render";
import { imageRequests, type ImageRequest } from "@/lib/shorts/layout";
import type { ShortImage, ShortState, ShortsProject } from "@/lib/shorts/types";
import { ImageFolderBox, type ImageFolder } from "./ImageFolderBox";
import { SHORT_LABEL } from "./ShortEditor";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const pad = (n: number) => String(n).padStart(3, "0");
const shotLabel = (r: ImageRequest) => `Shot${r.shots.length === 1 ? "" : "s"} ${r.shots.map(pad).join(", ")}`;

function copyText(short: ShortState, requests: ImageRequest[]) {
  const lines = requests.map((r) => `${r.file} | ${r.part} | ${shotLabel(r)} | ${clock(r.from)}–${clock(r.to)}${r.visual ? `\n    ${r.visual}` : ""}`);
  return [`Short ${short.n} images`, ...lines].join("\n");
}

type BoxHandlers = {
  onDir: (n: 1 | 2 | 3, dir: string) => void;
  onScanned: (n: 1 | 2 | 3, dir: string, result: { images: ShortImage[] } | { error: string }) => void;
  onClear: (n: 1 | 2 | 3) => void;
  onCopying: (n: 1 | 2 | 3, copying: boolean) => void;
  onRemovedShots: (n: 1 | 2 | 3, shots: number[]) => void;
};

/** One box per Short: drop its images here, with the part and shots each image is for. */
export function ImagesStage({
  project,
  folders,
  renders,
  working,
  onBack,
  onGenerate,
  ...handlers
}: {
  project: ShortsProject;
  folders: Partial<Record<1 | 2 | 3, ImageFolder>>;
  renders: Record<number, { progress: number }>;
  working: boolean;
  onBack: () => void;
  onGenerate: () => void;
} & BoxHandlers) {
  const loading = project.shorts.some((s) => {
    const f = folders[s.n];
    return f?.copying || (f?.dir && !f.images && !f.error);
  });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {project.shorts.map((s) => (
          <ImageBox key={s.n} project={project} short={s} folder={folders[s.n] ?? { dir: "" }} render={renders[s.n] ?? null} {...handlers} />
        ))}
      </div>
      <section className="rounded-2xl border border-line-strong/60 bg-raised/60 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Make the final videos</h2>
          <p className="text-xs text-muted mt-0.5">Any shot without an image uses the cropped video instead. A deleted shot is cut out of the Short, along with what it says.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onBack} disabled={working}>
            Back to the voices
          </Button>
          <Button variant="primary" onClick={onGenerate} disabled={working || !!loading}>
            {working ? "Generating…" : "Generate final Shorts"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ImageBox({
  project,
  short,
  folder,
  render,
  onDir,
  onScanned,
  onClear,
  onCopying,
  onRemovedShots,
}: { project: ShortsProject; short: ShortState; folder: ImageFolder; render: { progress: number } | null } & BoxHandlers) {
  const n = short.n;
  const requests = imageRequests(project, short);
  const have = folder.images?.length;
  const removed = short.removedShots ?? [];
  const inClip = new Set(project.sentences.slice(short.from, short.to + 1).map((s) => s.shot));
  const deleted = removed.filter((s) => inClip.has(s));
  return (
    <section className="rounded-2xl border border-line-strong/60 bg-raised/60 p-4 space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Short {n}
          {n === 1 && <span className="font-normal text-muted"> · {SHORT_LABEL[n]}</span>}
        </h2>
        <CopyButton text={copyText(short, requests)} label="Copy list" />
      </div>

      <ImageFolderBox n={n} folder={folder} onDir={(d) => onDir(n, d)} onScanned={(d, r) => onScanned(n, d, r)} onClear={() => onClear(n)} onCopying={(c) => onCopying(n, c)} />

      {have !== undefined && have !== requests.length && (
        <p className="text-xs text-warning">
          This Short needs {requests.length} image{requests.length === 1 ? "" : "s"}, and the folder has {have}.
        </p>
      )}
      {render && <ProgressBar value={render.progress} />}

      <div>
        <div className="text-xs font-medium text-muted mb-1.5">
          {requests.length} image{requests.length === 1 ? "" : "s"} needed, in this order
        </div>
        <ol className="space-y-2 max-h-[28rem] overflow-auto pr-1">
          {requests.map((r) => (
            <li key={r.file} className="relative flex gap-2.5 rounded-xl border border-line-strong/50 bg-bg/40 p-2.5">
              {r.image ? (
                /* eslint-disable-next-line @next/next/no-img-element -- local files served by the app */
                <img src={fileUrl(r.image)} alt={r.file} className="w-9 aspect-[9/16] rounded object-cover shrink-0 self-start" />
              ) : (
                <span className="w-9 aspect-[9/16] rounded border border-dashed border-line-strong shrink-0 self-start" aria-hidden />
              )}
              <div className="min-w-0 flex-1 text-xs leading-5">
                <div className="font-semibold tabular-nums pr-7">
                  {r.file} <span className="text-[#FFD23F]">{shotLabel(r)}</span>
                </div>
                <div className="text-muted">
                  {r.part} · <span className="tabular-nums">{clock(r.from)}–{clock(r.to)}</span> in the video
                </div>
                {r.visual && <p className="text-subtle mt-1 break-words">{r.visual}</p>}
              </div>
              {requests.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemovedShots(n, [...removed, ...r.shots])}
                  disabled={!!render}
                  aria-label={`Delete ${shotLabel(r)} from Short ${n}`}
                  title="Delete this shot from the Short"
                  className="absolute top-2 right-2 w-7 h-7 rounded-lg grid place-items-center bg-raised border border-line-strong text-fg hover:text-error hover:border-error/60 hover:bg-error/10 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 7h16M9 7V4h6v3m3 0l-1 13H7L6 7m4 4v5m4-5v5" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ol>
        {deleted.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>Deleted:</span>
            {deleted.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onRemovedShots(n, removed.filter((x) => x !== s))}
                disabled={!!render}
                title="Put this shot back"
                className="rounded-full border border-line-strong/60 px-2 py-0.5 tabular-nums hover:text-fg disabled:opacity-40 transition-colors"
              >
                Shot {pad(s)} ↺
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
