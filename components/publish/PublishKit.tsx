"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { Field, PdfCard } from "@/components/editor/Setup";
import { parseSrt, toSrt } from "@/lib/editor/subtitles";
import { formatTime } from "@/lib/editor/timing";
import type { Cue } from "@/lib/editor/types";
import type { ParsedScript } from "@/lib/script";
import {
  LIMITS,
  buildChapters,
  checklist,
  deleteKit,
  estimateCues,
  kitId,
  kitParts,
  loadKits,
  metadataText,
  saveKit,
  splitKeywords,
  type KitCue,
  type PublishKit as Kit,
} from "@/lib/publish/kit";
import { renderThumb } from "@/lib/publish/thumbnail";
import { downloadBlob, makeZip } from "@/lib/publish/zip";
import { FileCard, Section, Steps, areaCls, fieldCls } from "./bits";
import { KitOutput } from "./KitOutput";

type Form = { title: string; primary: string; secondary: string; nextTitle: string };
const EMPTY_FORM: Form = { title: "", primary: "", secondary: "", nextTitle: "" };
const tick = () => new Promise((r) => setTimeout(r, 220));

export function PublishKit() {
  const [kits, setKits] = useState<Kit[]>([]);

  const [script, setScript] = useState<ParsedScript | null>(null);
  const [reading, setReading] = useState(false);
  const [video, setVideo] = useState<{ name: string; duration: number } | null>(null);
  const [srt, setSrt] = useState<{ name: string; cues: Cue[] } | null>(null);

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [kit, setKit] = useState<Kit | null>(null);
  const savedId = useRef<string | null>(null);
  const [step, setStep] = useState(-1);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbBlobs, setThumbBlobs] = useState<Record<string, Blob>>({});
  const [zipping, setZipping] = useState(false);

  // Saved kits live in this browser's storage.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- read localStorage after hydration */
    setKits(loadKits());
  }, []);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const patchKit = useCallback((patch: Partial<Kit>) => setKit((k) => (k ? { ...k, ...patch } : k)), []);

  /** What is shown, checked and saved: the kit with the latest form fields. */
  const view = useMemo<Kit | null>(() => (kit ? { ...kit, ...form, id: kitId(form.title) } : null), [kit, form]);

  // Autosave the kit under its video title.
  useEffect(() => {
    if (!view || !view.title.trim()) return;
    const t = setTimeout(() => {
      const ok = saveKit({ ...view, savedAt: Date.now() }, savedId.current ?? undefined);
      if (ok) {
        savedId.current = view.id;
        setKits(loadKits());
      }
    }, 600);
    return () => clearTimeout(t);
  }, [view]);

  async function readPdf(file: File) {
    setError(null);
    setReading(true);
    try {
      const r = await fetch(`/api/script?${new URLSearchParams({ name: file.name })}`, { method: "POST", body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const parsed = j as ParsedScript;
      setScript(parsed);
      if (parsed.title && !form.title.trim()) set({ title: parsed.title });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  function readVideo(file: File) {
    setError(null);
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      setVideo({ name: file.name, duration: el.duration });
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      setError("Could not read that video. Use an MP4 exported from this app or your editor.");
      URL.revokeObjectURL(url);
    };
    el.src = url;
  }

  async function readSrt(file: File) {
    setError(null);
    const cues = parseSrt(await file.text());
    if (!cues.length) setError("No captions found in that .srt file.");
    else setSrt({ name: file.name, cues });
  }

  const canBuild = !!script && !!form.title.trim() && !!video && !building;

  async function build() {
    if (!script) return;
    setError(null);
    setBuilding(true);
    try {
      setStep(0);
      await tick();
      const narration = kitParts(script);

      setStep(1);
      await tick();
      const notes: string[] = [];
      let cues: KitCue[];
      let captions: Kit["source"]["captions"];
      const duration = video!.duration;
      if (srt) {
        cues = srt.cues.map(({ start, end, text, words }) => ({ start, end, text, words }));
        captions = "srt";
      } else {
        cues = estimateCues(script, duration);
        captions = "estimate";
        notes.push("No .srt added, so caption timings are estimated from word counts. Add the .srt that Merge Videos saved next to the merged video for exact timings.");
      }
      if (!cues.length) throw new Error("There are no captions to build from — check the .srt file.");

      setStep(2);
      await tick();
      const ch = buildChapters(script, cues, duration);

      const images = kit?.images ?? [];

      setStep(3);
      // Rebuilding keeps the SEO text and thumbnails already made for this video.
      const prev = kit && kitId(kit.title) === kitId(form.title) ? kit : (kits.find((k) => k.id === kitId(form.title)) ?? null);
      setKit({
        id: kitId(form.title),
        savedAt: Date.now(),
        ...form,
        source: {
          mode: "upload",
          scriptFile: script.file,
          video: video?.name,
          captions,
        },
        duration,
        parts: narration,
        cues,
        chapters: ch.chapters,
        notes: [...notes, ...ch.notes],
        images: images.length ? images : (prev?.images ?? []),
        imagesDir: prev?.imagesDir,
        pasted: prev?.pasted ?? "",
        seo: prev?.seo ?? null,
        titles: prev?.titles ?? [],
        chosenTitle: prev?.chosenTitle ?? 0,
        description: prev?.description ?? "",
        tags: prev?.tags ?? [],
        hashtags: prev?.hashtags ?? [],
        pinned: prev?.pinned ?? "",
        short: prev?.short ?? "",
        thumbs: prev?.thumbs ?? [],
      });
      if (!savedId.current && prev) savedId.current = prev.id;
    } catch (e) {
      setError((e as Error).message);
      setStep(-1);
    } finally {
      setBuilding(false);
    }
  }

  function openKit(k: Kit) {
    setKit(k);
    setForm({ title: k.title, primary: k.primary, secondary: k.secondary, nextTitle: k.nextTitle });
    savedId.current = k.id;
    setThumbBlobs({});
    setStep(3);
    setError(null);
    window.scrollTo?.({ top: 0 });
  }

  function newKit() {
    setKit(null);
    setForm(EMPTY_FORM);
    savedId.current = null;
    setThumbBlobs({});
    setStep(-1);
    setScript(null);
    setVideo(null);
    setSrt(null);
  }

  function removeKit(id: string) {
    deleteKit(id);
    setKits(loadKits());
    if (savedId.current === id) newKit();
  }

  const thumbBytes = (view?.thumbs ?? []).map((t) => thumbBlobs[t.id]?.size ?? 0);
  const checks = view ? checklist(view, thumbBytes) : null;
  const chosen = view?.titles[view.chosenTitle] ?? "";
  const zipBlocked = !view ? "Build the kit first" : chosen.length > LIMITS.titleMax ? "The chosen title is over 100 characters" : null;

  async function downloadAll() {
    if (!view) return;
    setZipping(true);
    setError(null);
    try {
      const files: { name: string; data: Blob | string }[] = [];
      for (const [i, t] of view.thumbs.entries()) {
        files.push({ name: `thumbnail_${i + 1}.jpg`, data: thumbBlobs[t.id] ?? (await renderThumb(t)) });
      }
      files.push({ name: "captions.srt", data: toSrt(view.cues.map((c, i) => ({ id: String(i), ...c }))) });
      files.push({ name: "metadata.txt", data: metadataText(view) });
      downloadBlob(await makeZip(files), `${view.id}-publish-kit.zip`);
    } catch (e) {
      setError(`Could not make the zip: ${(e as Error).message}`);
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto px-6 py-12 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8 animate-rise">
        <div className="space-y-8 min-w-0">
          <header>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#FFD23F]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFD23F]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FFD23F] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FFD23F]" />
              </span>
              Final cut · Publish
            </div>
            <h1 className="mt-4 text-4xl font-bold tracking-tight">
              Cut. Package. <span className="text-[#FFD23F]">Publish.</span>
            </h1>
            <p className="text-muted mt-2">Titles, description, chapters, captions and thumbnails for YouTube, without paid APIs or keys.</p>
          </header>

          {kits.length > 0 && (
            <Section title="Saved kits" aside={kit && <Button size="sm" onClick={newKit}>New kit</Button>}>
              <ul className="flex flex-col divide-y divide-line-strong/40">
                {kits.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium truncate ${k.id === view?.id ? "text-link" : ""}`}>{k.title}</div>
                      <div className="text-xs text-muted">
                        {new Date(k.savedAt).toLocaleString()} · {k.chapters.length} chapters · {k.seo ? "SEO filled" : "awaiting SEO"} · {k.thumbs.length} thumbnail
                        {k.thumbs.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => openKit(k)} disabled={k.id === view?.id}>
                      {k.id === view?.id ? "Open" : "Reopen"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => removeKit(k.id)}>
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Source */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                <FileCard
                  title="Merged video"
                  hint="The final MP4 from Merge Videos"
                  accept="video/mp4,video/*,.mp4,.mov,.m4v"
                  file={video?.name ?? null}
                  meta={video ? `${formatTime(video.duration, false)} long · read in the browser, not uploaded` : null}
                  onFile={readVideo}
                  onClear={() => setVideo(null)}
                  tint="bg-gradient-to-br from-violet-400/25 to-accent/25 text-violet-300 ring-violet-400/20"
                  icon={
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="3" y="5" width="14" height="14" rx="2.5" />
                      <path d="M17 10l4-2.5v9L17 14" />
                    </svg>
                  }
                />
              <PdfCard
                file={script?.file ?? null}
                meta={script ? `${script.parts.length} parts · ${script.pages} pages${script.title ? ` · “${script.title}”` : ""}` : null}
                reading={reading}
                onFile={readPdf}
                onClear={() => setScript(null)}
              />
                <FileCard
                  title="Captions (.srt)"
                  hint="Saved next to the merged video by Merge Videos"
                  accept=".srt,application/x-subrip,text/plain"
                  file={srt?.name ?? null}
                  meta={srt ? `${srt.cues.length} captions` : null}
                  onFile={readSrt}
                  onClear={() => setSrt(null)}
                  tint="bg-gradient-to-br from-amber-300/25 to-orange-400/20 text-amber-200 ring-amber-300/20"
                  icon={
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="3" y="5" width="18" height="14" rx="2.5" />
                      <path d="M7 13h4M13 13h4M7 16h7" />
                    </svg>
                  }
                />
            </div>
          </div>

          {/* Keywords */}
          <section className="rounded-2xl border border-line-strong/60 bg-raised/60 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Video title (from the script's first page)" className="sm:col-span-2">
              <input className={fieldCls} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="The $20 Billion Mystery" />
            </Field>
            <Field label="Primary keyword">
              <input className={fieldCls} value={form.primary} onChange={(e) => set({ primary: e.target.value })} placeholder="e.g. how billionaires lose money" />
            </Field>
            <Field label="Next video title (optional)">
              <input className={fieldCls} value={form.nextTitle} onChange={(e) => set({ nextTitle: e.target.value })} placeholder="Shown as a teaser in the prompt" />
            </Field>
            <Field label="Secondary keywords (comma-separated, from vidIQ)" className="sm:col-span-2">
              <textarea rows={3} className={areaCls} value={form.secondary} onChange={(e) => set({ secondary: e.target.value })} placeholder="keyword one, keyword two, keyword three" />
            </Field>
            <Suggestions
              className="sm:col-span-2"
              defaultSubject={form.primary || form.title}
              secondary={form.secondary}
              onAdd={(s) => {
                const list = splitKeywords(form.secondary);
                if (!list.some((k) => k.toLowerCase() === s.toLowerCase())) set({ secondary: [...list, s].join(", ") });
              }}
            />
          </section>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="space-y-4">
            <Button variant="primary" size="lg" disabled={!canBuild} onClick={build} className="w-full sm:w-auto rounded-xl">
              {building ? "Building…" : kit ? "Rebuild Publish Kit" : "Build Publish Kit"}
              {!building && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14m-5-5l5 5-5 5" />
                </svg>
              )}
            </Button>
            {!canBuild && !building && (
              <p className="text-xs text-muted">
                {!script
                  ? "Add the polished script PDF to start."
                  : !form.title.trim()
                    ? "Enter the video title."
                    : "Add the merged video."}
              </p>
            )}
            {step >= 0 && <Steps step={step} />}
          </div>

          {view && (
            <KitOutput
              key={view.savedAt}
              kit={view}
              onChange={patchKit}
              thumbBlobs={thumbBlobs}
              onThumb={(id, blob) => setThumbBlobs((m) => ({ ...m, [id]: blob }))}
            />
          )}
        </div>

        {/* Checklist */}
        <aside className="mt-8 lg:mt-0">
          <div className="lg:sticky lg:top-6 space-y-4">
            <section className="rounded-2xl border border-line-strong/60 bg-raised/60 p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Upload checklist</h2>
                {checks && (
                  <span className="text-xs text-muted tabular-nums">
                    {checks.filter((c) => c.ok).length}/{checks.length}
                  </span>
                )}
              </div>
              <ul className="mt-3 space-y-2">
                {(checks ?? checklist(placeholderKit, [])).map((c) => (
                  <li key={c.label} className="flex items-start gap-2.5 text-sm">
                    <span
                      className={`mt-0.5 w-4 h-4 shrink-0 rounded-full grid place-items-center transition-colors ${
                        checks && c.ok ? "bg-success" : "border border-line-strong"
                      }`}
                    >
                      {checks && c.ok && (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={checks && c.ok ? "text-fg" : "text-muted"}>{c.label}</span>
                      {checks && c.detail && <span className="block text-[11px] text-subtle">{c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <Button variant="primary" size="lg" className="w-full rounded-xl" disabled={!!zipBlocked || zipping} onClick={downloadAll}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
              </svg>
              {zipping ? "Packing…" : "Download all (.zip)"}
            </Button>
            {zipBlocked && view && <p className="text-xs text-error">{zipBlocked}</p>}
            {view && (
              <p className="text-[11px] text-subtle">
                {view.thumbs.length} thumbnail{view.thumbs.length === 1 ? "" : "s"} · captions.srt · metadata.txt — saved as “{view.title}”
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Keeps the checklist's labels visible before a kit exists. */
const placeholderKit: Kit = {
  id: "",
  savedAt: 0,
  title: "",
  source: { mode: "upload", scriptFile: "", captions: "estimate" },
  duration: 0,
  primary: "",
  secondary: "",
  nextTitle: "",
  parts: [],
  cues: [],
  chapters: [],
  notes: [],
  images: [],
  pasted: "",
  seo: null,
  titles: [],
  chosenTitle: 0,
  description: "",
  tags: [],
  hashtags: [],
  pinned: "",
  short: "",
  thumbs: [],
};

/** YouTube autocomplete ideas; a click adds one to the secondary keywords. */
function Suggestions({
  defaultSubject,
  secondary,
  onAdd,
  className = "",
}: {
  defaultSubject: string;
  secondary: string;
  onAdd: (s: string) => void;
  className?: string;
}) {
  const [subject, setSubject] = useState<string | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = subject ?? defaultSubject;
  const have = new Set(splitKeywords(secondary).map((k) => k.toLowerCase()));

  async function fetchIdeas() {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/publish/suggest?${new URLSearchParams({ q })}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setList(j.suggestions);
      if (!j.suggestions.length) setError("YouTube had no suggestions for that — try a shorter subject.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <span className="block text-xs font-medium text-muted">YouTube search suggestions</span>
      <div className="flex gap-2">
        <input
          className={fieldCls}
          value={q}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), fetchIdeas())}
          placeholder="Main subject, e.g. FTX collapse"
        />
        <Button type="button" onClick={fetchIdeas} disabled={busy || !q.trim()} className="h-11 rounded-xl shrink-0">
          {busy ? "Looking…" : "Suggest"}
        </Button>
      </div>
      {error && <p className="text-xs text-warning">{error}</p>}
      {list.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.map((s) => {
            const added = have.has(s.toLowerCase());
            return (
              <button
                key={s}
                type="button"
                onClick={() => onAdd(s)}
                disabled={added}
                className={`h-8 px-3 rounded-full border text-xs inline-flex items-center gap-1.5 transition-colors ${
                  added ? "border-success/40 bg-success/10 text-fg" : "border-line-strong/60 text-muted hover:text-fg hover:border-link/60"
                }`}
              >
                {added ? "✓" : "+"} {s}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
