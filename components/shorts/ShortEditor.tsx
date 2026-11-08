"use client";
import { useMemo, useState } from "react";
import { Button, ProgressBar, Toggle } from "@/components/ui";
import { CopyButton, fieldCls } from "@/components/publish/bits";
import { Select } from "@/components/editor/Setup";
import { fileUrl } from "@/lib/editor/render";
import { measure } from "@/lib/shorts/draw";
import {
  HOOK,
  buildSpec,
  captionText,
  chunkWords,
  clipBounds,
  specLength,
  clipWords,
  hookWords,
  shortDescription,
  shortFileName,
  shortTitle,
  specHash,
} from "@/lib/shorts/layout";
import { alternatives, usable } from "@/lib/shorts/pick";
import { assignedImages, groupSpans, shotGroups } from "@/lib/shorts/shots";
import { SPEEDS, VOICES, type SpeedId, type VoiceId } from "@/lib/script";
import type { Candidate, ShortState, ShortsProject } from "@/lib/shorts/types";
import { ClipTimeline } from "./ClipTimeline";
import { ShortPreview } from "./ShortPreview";
import { ShotImages } from "./ShotImages";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export const SHORT_LABEL = { 1: "The hook", 2: "Short 2", 3: "Short 3" } as const;

/** Green 25–50 s, orange outside that, red past YouTube's 60 s. */
function durationTone(d: number) {
  if (d > 60) return "text-error border-error/40 bg-error/10";
  if (d > 50 || d < 25) return "text-warning border-warning/40 bg-warning/10";
  return "text-success border-success/40 bg-success/10";
}

export function ShortEditor({
  project,
  short,
  names,
  fontsReady,
  render,
  onClip,
  onChange,
  onRender,
  onCtaDone,
  onVoice,
}: {
  project: ShortsProject;
  short: ShortState;
  names: Set<string>;
  fontsReady: boolean;
  render: { progress: number } | null;
  onClip: (from: number, to: number, picked?: Candidate) => void;
  onChange: (patch: Partial<ShortState>) => void;
  onRender: () => void;
  /** The call-to-action was edited: speak it, so the preview and length are exact. */
  onCtaDone: () => void;
  onVoice: (patch: { voice?: VoiceId; rate?: SpeedId }) => void;
}) {
  const { sentences } = project;
  // Fonts must be loaded before text is measured, or the layout would be computed with a fallback font.
  const spec = useMemo(() => buildSpec(project, short, measure), [project, short, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const hash = specHash(spec);
  const upToDate = !!short.rendered && short.rendered.hash === hash;
  const { start, end } = clipBounds(sentences, short, project.video.duration);
  const groups = useMemo(() => shotGroups(sentences, short.from, short.to, project.shotMeta), [sentences, short.from, short.to, project.shotMeta]);
  const dur = specLength(spec);
  const others = project.shorts.filter((s) => s.n !== short.n).map((s) => ({ n: s.n, from: s.from, to: s.to }));
  const alts = useMemo(() => alternatives(sentences, project.shorts, short.n), [sentences, project.shorts, short.n]);
  const chunks = useMemo(() => chunkWords(clipWords(sentences, short)), [sentences, short]);
  const unusable = sentences.slice(short.from, short.to + 1).some((s) => !usable(s));
  const title = shortTitle(short, names);
  const description = shortDescription(project, short);
  const hookList = hookWords(short.hook);
  const top = short.reasons.filter((r) => r.points > 0).slice(0, 3);
  const penalties = short.reasons.filter((r) => r.points < 0);

  function nudge(edge: "from" | "to", d: number) {
    if (edge === "from") onClip(Math.min(short.to, Math.max(0, short.from + d)), short.to);
    else onClip(short.from, Math.max(short.from, Math.min(sentences.length - 1, short.to + d)));
  }

  return (
    <section id={`short-${short.n}`} className="rounded-2xl border border-line-strong/60 bg-raised/60 overflow-hidden scroll-mt-6">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-line-strong/40">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1B1B1B] px-2.5 py-1 text-[11px] font-bold tracking-wide text-white ring-1 ring-white/10">
            <span className="text-[#FFD23F]">0{short.n}</span>
            {SHORT_LABEL[short.n]}
          </span>
          <span className="text-xs text-muted tabular-nums">
            {clock(start)}–{clock(end)} · target {short.target}s · {sentences[short.from].partTitle}
            {sentences[short.from].partName ? ` – ${sentences[short.from].partName}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums ${durationTone(dur)}`}>{dur.toFixed(1)} s</span>
          <span className="rounded-full border border-line-strong/60 px-2.5 py-0.5 text-xs tabular-nums text-muted">score {short.score}</span>
        </div>
      </header>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-6">
        {/* Preview + render */}
        <div className="space-y-3">
          <ShortPreview spec={spec} rendered={upToDate ? short.rendered!.path : null} />
          <div className="space-y-2">
            <Button variant="primary" className="w-full rounded-xl" disabled={!!render || !fontsReady} onClick={onRender}>
              {render ? "Rendering…" : upToDate ? "Render again" : short.rendered ? "Re-render (changed)" : "Render"}
            </Button>
            {render && <ProgressBar value={render.progress} />}
            {short.rendered && !render && (
              <p className={`text-[11px] text-center ${upToDate ? "text-success" : "text-warning"}`}>
                {upToDate ? `Rendered ${new Date(short.rendered.at).toLocaleTimeString()} · up to date` : "Edited since the last render"}
              </p>
            )}
          </div>
        </div>

        {/* Editing */}
        <div className="space-y-5 min-w-0">
          {/* Why */}
          <div className="rounded-xl border border-line-strong/50 bg-bg/40 p-3.5">
            <div className="text-xs font-medium text-muted mb-2">Why this clip</div>
            <ul className="space-y-1">
              {top.map((r) => (
                <li key={r.label} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 rounded bg-[#FFD23F]/15 text-[#FFD23F] px-1.5 text-[11px] font-bold tabular-nums">+{r.points}</span>
                  {r.label}
                </li>
              ))}
              {short.n === 1 && !top.length && <li className="text-sm text-muted">The opening of the video, ending near 35 s.</li>}
              {penalties.map((r) => (
                <li key={r.label} className="flex items-baseline gap-2 text-xs text-muted">
                  <span className="shrink-0 rounded bg-error/15 text-error px-1.5 text-[11px] font-bold tabular-nums">{r.points}</span>
                  {r.label}
                </li>
              ))}
            </ul>
          </div>

          {/* Clip */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Clip (snaps to sentences)</span>
              <div className="flex items-center gap-1">
                <Button size="sm" onClick={() => nudge("from", -1)} disabled={short.from === 0} title="Start one sentence earlier">
                  ◀ start
                </Button>
                <Button size="sm" onClick={() => nudge("from", 1)} disabled={short.from >= short.to} title="Start one sentence later">
                  start ▶
                </Button>
                <span className="w-2" />
                <Button size="sm" onClick={() => nudge("to", -1)} disabled={short.to <= short.from} title="End one sentence earlier">
                  ◀ end
                </Button>
                <Button size="sm" onClick={() => nudge("to", 1)} disabled={short.to >= sentences.length - 1} title="End one sentence later">
                  end ▶
                </Button>
              </div>
            </div>
            <ClipTimeline sentences={sentences} from={short.from} to={short.to} others={others} onChange={(a, b) => onClip(a, b)} />
            {unusable && <p className="text-xs text-error">This clip now includes the video&apos;s ending or a subscribe/comment line.</p>}
            {others.some((o) => sentences[o.from].start < sentences[short.to].end && sentences[short.from].start < sentences[o.to].end) && (
              <p className="text-xs text-warning">This clip overlaps another Short.</p>
            )}
            <select
              value=""
              onChange={(e) => {
                const c = alts[+e.target.value];
                if (c) onClip(c.from, c.to, c);
              }}
              className="w-full h-11 pl-3.5 rounded-xl bg-bg/70 border border-line-strong/60 text-sm text-fg focus:outline-none focus:border-link"
            >
              <option value="">Pick a different clip…</option>
              {alts.map((c, i) => (
                <option key={`${c.from}-${c.to}`} value={i}>
                  Score {c.score} · {clock(c.start)}–{clock(c.end)} ({Math.round(c.end - c.start)}s) · “{sentences[c.from].text.slice(0, 60)}
                  {sentences[c.from].text.length > 60 ? "…" : ""}”
                </option>
              ))}
            </select>
          </div>

          {/* Hook title */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Hook title (max {HOOK.maxWords} words, tap a word to make it yellow)</span>
              <Toggle checked={short.showHook} onChange={(v) => onChange({ showHook: v })} label={<span className="text-xs text-muted">Show</span>} />
            </div>
            <input
              className={fieldCls}
              value={short.hook}
              disabled={!short.showHook}
              onChange={(e) => {
                const hook = e.target.value;
                const n = hook.trim().split(/\s+/).filter(Boolean).length;
                onChange({ hook, hookEdited: true, hookKey: Math.min(short.hookKey, Math.max(0, n - 1)) });
              }}
            />
            {short.showHook && (
              <div className="flex flex-wrap items-center gap-1.5">
                {hookList.map((w, i) => (
                  <button
                    key={`${w}-${i}`}
                    type="button"
                    onClick={() => onChange({ hookKey: i })}
                    className={`h-7 px-2 rounded-md text-xs font-bold tracking-wide transition-colors ${
                      i === short.hookKey ? "bg-[#FFD23F] text-[#1B1B1B]" : "bg-chip text-fg hover:bg-hover"
                    }`}
                  >
                    {w}
                  </button>
                ))}
                {short.hook.trim().split(/\s+/).length > HOOK.maxWords && <span className="text-xs text-warning">Only the first {HOOK.maxWords} words are shown.</span>}
              </div>
            )}
          </div>

          {/* Vertical images */}
          {!!short.images?.length && (
            <ShotImages short={short} groups={groups} assigned={assignedImages(short, groups)} spans={groupSpans(sentences, groups, start, end - start)} onChange={onChange} />
          )}

          {/* Spoken call-to-action */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Spoken call-to-action (leave empty for none)</span>
              <span className="text-xs text-muted tabular-nums">{spec.hold.toFixed(1)} s</span>
            </div>
            <input className={fieldCls} value={short.cta} maxLength={200} onChange={(e) => onChange({ cta: e.target.value })} onBlur={onCtaDone} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="shrink-0">Voice and speed, all three Shorts</span>
              <span className="w-36">
                <Select value={project.voice ?? ""} onChange={(v) => onVoice({ voice: v as VoiceId })}>
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </span>
              <span className="w-32">
                <Select value={project.rate ?? ""} onChange={(v) => onVoice({ rate: v as SpeedId })}>
                  {SPEEDS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </span>
            </div>
          </div>

          {/* Captions */}
          <Captions short={short} chunks={chunks} onChange={onChange} />

          {/* Look */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="flex justify-between text-xs font-medium text-muted mb-1.5">
                <span>Crop off the bottom (old subtitles)</span>
                <span className="tabular-nums text-fg">{Math.round(short.crop * 100)}%</span>
              </span>
              <input type="range" min={0} max={0.3} step={0.01} value={short.crop} onChange={(e) => onChange({ crop: +e.target.value })} className="w-full" />
            </label>
            <div className="flex items-end">
              <Toggle checked={short.showEndTag} onChange={(v) => onChange({ showEndTag: v })} label={<span className="text-sm">End tag “Watch the full story ↓”</span>} />
            </div>
          </div>

          {/* Upload text */}
          <div className="rounded-xl border border-line-strong/50 bg-bg/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">For the upload</span>
              {short.rendered && (
                <a href={fileUrl(short.rendered.path, true)}>
                  <Button size="sm" variant={upToDate ? "primary" : "secondary"}>
                    Download {shortFileName(short.n)}
                  </Button>
                </a>
              )}
            </div>
            <MetaLine label="Title" text={title} hint={`${title.length}/60`} />
            <MetaLine label="Description" text={description} />
          </div>
        </div>
      </div>
    </section>
  );
}

function MetaLine({ label, text, hint }: { label: string; text: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-20 shrink-0 text-xs text-muted pt-1">{label}</span>
      <p className="flex-1 min-w-0 text-sm leading-6 break-words">{text}</p>
      {hint && <span className="text-[11px] text-subtle tabular-nums pt-1.5">{hint}</span>}
      <CopyButton text={text} />
    </div>
  );
}

/** Every caption of the Short, editable. Fixing a caption fixes its words; empty hides them. */
function Captions({
  short,
  chunks,
  onChange,
}: {
  short: ShortState;
  chunks: ReturnType<typeof chunkWords>;
  onChange: (patch: Partial<ShortState>) => void;
}) {
  const [open, setOpen] = useState(false);
  const fixes = Object.keys(short.edits).length;

  function edit(chunk: (typeof chunks)[number], value: string) {
    const edits = { ...short.edits };
    const parts = value.trim().split(/\s+/).filter(Boolean);
    chunk.forEach((w, k) => {
      const next = parts.length === chunk.length ? parts[k] : k === 0 ? parts.join(" ") : "";
      if (next === w.original) delete edits[w.key];
      else edits[w.key] = next;
    });
    onChange({ edits });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-muted hover:text-fg inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
          Captions · {chunks.length} lines{fixes ? ` · ${fixes} word${fixes === 1 ? "" : "s"} fixed` : ""}
        </button>
        {fixes > 0 && (
          <button type="button" onClick={() => onChange({ edits: {} })} className="text-xs text-muted hover:text-error">
            Undo all fixes
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5 max-h-56 overflow-auto rounded-xl border border-line-strong/50 bg-bg/40 p-2.5">
          {chunks.map((c) => {
            const value = c.map((w) => w.text).join(" ");
            const fixed = c.some((w) => w.key in short.edits);
            return (
              <input
                key={`${c[0].key}|${value}`}
                defaultValue={value}
                onBlur={(e) => e.target.value !== value && edit(c, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                size={Math.max(4, value.length + 1)}
                title={captionText(value)}
                className={`h-8 px-2 rounded-md text-xs font-semibold uppercase tracking-wide bg-chip border focus:outline-none focus:border-link ${
                  fixed ? "border-[#FFD23F]/60 text-[#FFD23F]" : "border-line-strong/60 text-fg"
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
