"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, PathField, ProgressBar, Toggle, pollJob } from "@/components/ui";
import { Field, PdfCard } from "@/components/editor/Setup";
import { fileUrl } from "@/lib/editor/render";
import { toSrt } from "@/lib/editor/subtitles";
import { formatTime } from "@/lib/editor/timing";
import type { Cue } from "@/lib/editor/types";
import { alignToSpeech } from "@/lib/merge/captions";
import { listSavedScripts, type SavedPart, type SavedScript } from "@/lib/publish/kit";
import { chapterOf, chapterSpeech, spokenText, type ParsedScript, type ScriptPart } from "@/lib/script";

type Info = {
  duration: number;
  video?: { codec: string; width: number; height: number; fps: number };
  audio?: { codec: string; sampleRate: number };
};
type Probed = { path: string; name?: string; info?: Info; error?: string };

/** The six parts of a video, in the order they are joined. `part` is the Home part number they take subtitles from. */
const SLOTS = [
  { id: "hook", label: "Hook", hint: "Cold open", part: null, tint: "from-[#FFD23F]/30 to-amber-500/15 text-[#FFD23F] ring-[#FFD23F]/25" },
  { id: "v1", label: "V1", hint: "Part 1", part: 1, tint: "from-sky-400/25 to-accent/25 text-sky-300 ring-sky-400/20" },
  { id: "v2", label: "V2", hint: "Part 2", part: 2, tint: "from-violet-400/25 to-accent/20 text-violet-300 ring-violet-400/20" },
  { id: "v3", label: "V3", hint: "Part 3", part: 3, tint: "from-emerald-400/25 to-teal-500/15 text-emerald-300 ring-emerald-400/20" },
  { id: "v4", label: "V4", hint: "Part 4", part: 4, tint: "from-rose-400/25 to-orange-400/20 text-rose-300 ring-rose-400/20" },
  { id: "v5", label: "V5", hint: "Part 5", part: 5, tint: "from-orange-400/25 to-[#FFD23F]/15 text-orange-300 ring-orange-400/20" },
] as const;
type SlotId = (typeof SLOTS)[number]["id"];
type Slots = Record<SlotId, string | null>;
const EMPTY_SLOTS: Slots = { hook: null, v1: null, v2: null, v3: null, v4: null, v5: null };

const STATE_KEY = "creatoros:merge";
/** Files dropped in the browser are copied here by /api/upload. */
const isUploaded = (p: string) => /\/creatoros\/uploads\//.test(p);
const dirOf = (p: string) => p.replace(/\/[^/]*$/, "");
const clock = (t: number) => formatTime(t, false).replace(/\.\d+$/, "");

/** Hook ↔ the script's unnumbered opening part, V1 ↔ Part 1 … */
function scriptPartFor(script: ParsedScript | null, slot: (typeof SLOTS)[number]): ScriptPart | null {
  return script?.parts.find((p) => (slot.part === null ? !/^\d+$/.test(p.key) : p.key === String(slot.part))) ?? null;
}

/**
 * How a slot gets its captions:
 * - "exact": the part was built on Home from this script, so its burned-in subtitles are reused as they are;
 * - "script": the part's narration is timed to the video's own speech (pauses detected with ffmpeg);
 * - "none": the script has no part for this slot.
 */
type CaptionPlan = { kind: "exact"; home: SavedPart } | { kind: "script"; shots: string[]; title?: string } | { kind: "none" };

function planFor(script: ParsedScript | null, homes: SavedScript[], slot: (typeof SLOTS)[number], duration?: number): CaptionPlan {
  const part = scriptPartFor(script, slot);
  if (!part) return { kind: "none" };
  const home = homes
    .find((g) => g.file === script!.file)
    ?.parts.find((p) => p.project.script?.part === part.title && p.project.cues?.length);
  // Only trust the Home subtitles if that edit is as long as this video (otherwise it was changed since).
  if (home && (duration === undefined || Math.abs(home.duration - duration) <= 1.5)) return { kind: "exact", home };
  // The hook may open with its spoken title card (Home adds one by default).
  const card = slot.part === null ? chapterOf(part) : null;
  return { kind: "script", shots: part.shots.map((s) => spokenText(s.narration)), title: card ? chapterSpeech(card) : undefined };
}

export function Merge() {
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  const [probed, setProbed] = useState<Record<string, Probed>>({});
  const [compat, setCompat] = useState<{ canCopy: boolean; reason?: string }>({ canCopy: true });
  const [copying, setCopying] = useState<SlotId | null>(null);

  const [homes, setHomes] = useState<SavedScript[]>([]);
  const [script, setScript] = useState<ParsedScript | null>(null);
  const [reading, setReading] = useState(false);

  const [outName, setOutName] = useState("MERGED");
  const [outDir, setOutDir] = useState("");
  const outDirTouched = useRef(false);
  const [reencode, setReencode] = useState(false);

  const [job, setJob] = useState<{ progress: number; stage: string } | null>(null);
  const [result, setResult] = useState<{ output: string; mode: string; duration: number } | null>(null);
  const [srt, setSrt] = useState<{ text: string; lines: number; saved: string | null; missing: string[]; synced: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  // Restore the last session. Home edits made from the same script give exact captions.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- read localStorage after hydration */
    setHomes(listSavedScripts());
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
      if (s) {
        setSlots({ ...EMPTY_SLOTS, ...s.slots });
        if (s.outName) setOutName(s.outName);
        if (s.outDir) {
          setOutDir(s.outDir);
          outDirTouched.current = true;
        }
      }
    } catch {}
    restored.current = true;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ slots, outName, outDir: outDirTouched.current ? outDir : "" }));
    } catch {}
  }, [slots, outName, outDir]);

  async function readPdf(file: File) {
    setError(null);
    setReading(true);
    try {
      const r = await fetch(`/api/script?${new URLSearchParams({ name: file.name })}`, { method: "POST", body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setScript(j as ParsedScript);
      setSrt(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  const filled = SLOTS.filter((s) => slots[s.id]);
  const pathsKey = filled.map((s) => slots[s.id]).join("\n");

  // Probe whatever is in the slots: length, format, lossless compatibility.
  useEffect(() => {
    const paths = pathsKey ? pathsKey.split("\n") : [];
    if (!paths.length) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to probe */
      setCompat({ canCopy: true });
      return;
    }
    let live = true;
    fetch("/api/merge/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) })
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        setProbed(Object.fromEntries((j.files as Probed[]).map((f) => [f.path, f])));
        setCompat({ canCopy: j.canCopy, reason: j.reason });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathsKey]);

  // Save next to the first video picked from disk, unless a folder was chosen.
  useEffect(() => {
    if (outDirTouched.current) return;
    const first = filled.map((s) => slots[s.id]!).find((p) => !isUploaded(p));
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- derived default, until the user picks a folder */
    if (first) setOutDir(dirOf(first));
  }, [pathsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const plans = Object.fromEntries(
    SLOTS.map((s) => [s.id, planFor(script, homes, s, slots[s.id] ? probed[slots[s.id]!]?.info?.duration : undefined)]),
  ) as Record<SlotId, CaptionPlan>;

  function put(id: SlotId, path: string | null) {
    setSlots((s) => ({ ...s, [id]: path }));
    setResult(null);
    setSrt(null);
  }

  async function pick(id: SlotId, label: string) {
    setError(null);
    const r = await fetch("/api/pick-file", { method: "POST", body: JSON.stringify({ prompt: `Choose the ${label} video` }) });
    const j = await r.json();
    if (j.path) put(id, j.path);
    else if (j.error) setError(j.error);
  }

  async function upload(id: SlotId, file: File) {
    setError(null);
    setCopying(id);
    try {
      const q = new URLSearchParams({ kind: "video", name: file.name, size: String(file.size), modified: String(file.lastModified) });
      const r = await fetch(`/api/upload?${q}`, { method: "POST", body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      put(id, j.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCopying(null);
    }
  }

  function swap(a: SlotId, b: SlotId) {
    if (a === b) return;
    setSlots((s) => ({ ...s, [a]: s[b], [b]: s[a] }));
    setResult(null);
    setSrt(null);
  }

  const infos = filled.map((s) => probed[slots[s.id]!]);
  const ready = infos.every((p) => p?.info);
  const total = infos.reduce((t, p) => t + (p?.info?.duration ?? 0), 0);
  const captioned = filled.filter((s) => plans[s.id].kind !== "none").length;

  /**
   * One caption track for the merged video: each part's captions (exact from Home, or
   * the script timed to its speech), shifted by the real length of the videos before it.
   */
  async function buildCaptions(): Promise<{ cues: Cue[]; missing: string[]; synced: string[] }> {
    const cues: Cue[] = [];
    const missing: string[] = [];
    const synced: string[] = [];
    let offset = 0;
    for (const s of filled) {
      const path = slots[s.id]!;
      const dur = probed[path]?.info?.duration ?? 0;
      const plan = plans[s.id];
      let own: Cue[] = [];
      if (plan.kind === "exact") own = [...(plan.home.project.cues as Cue[])].sort((a, b) => a.start - b.start);
      else if (plan.kind === "script") {
        const r = await fetch("/api/merge/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const j = await r.json();
        if (!r.ok) throw new Error(`Could not read the speech in ${s.label}: ${j.error}`);
        own = alignToSpeech(plan.shots, j.speech, plan.title);
        synced.push(s.label);
      } else missing.push(s.label);
      for (const c of own) {
        if (dur && c.start >= dur) continue;
        cues.push({ ...c, start: c.start + offset, end: Math.min(c.end, dur || c.end) + offset, words: c.words?.map((w) => w + offset) });
      }
      offset += dur;
    }
    return { cues, missing, synced };
  }

  async function merge() {
    setError(null);
    setResult(null);
    setSrt(null);
    setJob({ progress: 0, stage: "Starting" });
    try {
      const r = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: filled.map((s) => slots[s.id]), outDir, outName, reencode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const done = await pollJob<{ output: string; mode: string; duration: number }>(j.jobId, setJob);
      setResult(done);

      if (script) {
        setJob({ progress: 1, stage: "Writing the captions" });
        const captions = await buildCaptions();
        if (!captions.cues.length) throw new Error("The video merged, but none of the parts matched the script, so there are no captions.");
        const text = toSrt(captions.cues);
        let saved: string | null = null;
        const s = await fetch("/api/merge/srt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ output: done.output, srt: text }),
        }).then((x) => x.json(), () => null);
        if (s?.path) saved = s.path;
        setSrt({ text, lines: captions.cues.length, saved, missing: captions.missing, synced: captions.synced });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJob(null);
    }
  }

  const blocked = !!job || !!copying || filled.length < 2 || !ready || !outName.trim() || !outDir.trim();

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-8 animate-rise">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#FFD23F]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFD23F]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FFD23F] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FFD23F]" />
              </span>
              Final cut · Merge
            </div>
            <h1 className="mt-4 text-4xl font-bold tracking-tight">
              Hook. Parts. <span className="text-[#FFD23F]">One video.</span>
            </h1>
            <p className="text-muted mt-2">Add the hook, V1–V5 and the polished script. You get one video plus a matching .srt for YouTube.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted tabular-nums">
            <span className="rounded-full border border-line-strong/60 px-3 py-1">{filled.length} / 6 parts</span>
            <span className="rounded-full border border-line-strong/60 px-3 py-1">{clock(total)} total</span>
            <span className="rounded-full border border-line-strong/60 px-3 py-1">{script ? `Captions ${captioned}/${filled.length}` : "No script yet"}</span>
          </div>
        </header>

        {/* The script: the text of every caption */}
        <PdfCard
          file={script?.file ?? null}
          meta={
            script
              ? `${script.parts.length} parts · ${script.pages} pages${homes.some((g) => g.file === script.file) ? " · your Home edits found — exact captions" : ""}`
              : "The polished script the videos were made from — it becomes the .srt"
          }
          reading={reading}
          onFile={readPdf}
          onClear={() => {
            setScript(null);
            setSrt(null);
          }}
        />

        {/* The six slots */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {SLOTS.map((s, i) => (
            <SlotCard
              key={s.id}
              slot={s}
              order={i + 1}
              path={slots[s.id]}
              probe={slots[s.id] ? probed[slots[s.id]!] : undefined}
              copying={copying === s.id}
              plan={script ? plans[s.id] : null}
              onPick={() => pick(s.id, s.label)}
              onFile={(f) => upload(s.id, f)}
              onClear={() => put(s.id, null)}
              onSwap={(from) => swap(from as SlotId, s.id)}
              disabled={!!job}
            />
          ))}
        </div>

        {/* Output settings */}
        <section className="rounded-2xl border border-line-strong/60 bg-raised/60 overflow-hidden">
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Output name">
              <div className="flex items-center gap-2">
                <input
                  className="w-full h-11 px-3.5 rounded-xl bg-bg/70 border border-line-strong/60 text-sm text-fg focus:outline-none focus:border-link"
                  value={outName}
                  onChange={(e) => setOutName(e.target.value)}
                />
                <span className="text-sm text-muted">.mp4 + .srt</span>
              </div>
            </Field>
            <div className="sm:col-span-2">
              <span className="block text-xs font-medium text-muted mb-1.5">Save to folder</span>
              <PathField
                value={outDir}
                onChange={(v) => {
                  outDirTouched.current = true;
                  setOutDir(v);
                }}
                placeholder="/Users/you/Videos/Exports"
                prompt="Choose where to save the merged video"
              />
            </div>
          </div>

          <div className="border-t border-line-strong/50 bg-bg/40 px-5 py-4 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px] text-xs">
              {filled.length < 2 ? (
                <span className="text-muted">Add at least two parts to merge.</span>
              ) : !script ? (
                <span className="text-warning">Add the polished script to get the .srt — without it only the video is merged.</span>
              ) : !ready ? (
                <span className="text-muted">Checking the videos…</span>
              ) : compat.canCopy ? (
                <span className="text-success">All parts match — joined losslessly, original quality, very fast.</span>
              ) : (
                <span className="text-warning">Formats differ ({compat.reason}) — re-encoded at H.264 CRF 16, AAC 320k.</span>
              )}
            </div>
            {compat.canCopy && filled.length > 1 && (
              <Toggle checked={reencode} onChange={setReencode} label={<span className="text-xs text-muted">Force re-encode</span>} />
            )}
            <Button variant="primary" size="lg" className="rounded-xl" disabled={blocked} onClick={merge}>
              {job ? "Merging…" : `Merge ${filled.length || ""} parts`.replace("  ", " ")}
              {!job && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14m-5-5l5 5-5 5" />
                </svg>
              )}
            </Button>
          </div>

          {job && (
            <div className="px-5 pb-4 space-y-1.5 bg-bg/40">
              <ProgressBar value={job.progress} />
              <div className="flex justify-between text-xs text-muted">
                <span>{job.stage}</span>
                <span>{Math.round(job.progress * 100)}%</span>
              </div>
            </div>
          )}
        </section>

        {error && <Alert tone="error">{error}</Alert>}

        {result && (
          <section className="rounded-2xl border border-success/40 bg-raised/60 overflow-hidden">
            <div className="p-5 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-success grid place-items-center">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  </span>
                  Merged · {clock(result.duration)} · {result.mode === "copy" ? "lossless" : "re-encoded"}
                </div>
                <div className="font-mono text-xs text-muted break-all mt-1">{result.output}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <a href={fileUrl(result.output, true)}>
                  <Button variant="primary">Download MP4</Button>
                </a>
                {srt && (
                  <Button onClick={() => downloadText(`${baseName(result.output)}.srt`, srt.text)}>Download .srt</Button>
                )}
              </div>
            </div>
            <div className="px-5 pb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <video src={fileUrl(result.output)} controls className="w-full rounded-xl bg-black aspect-video" />
              <div className="rounded-xl border border-line-strong/60 bg-bg/50 flex flex-col min-h-0">
                <div className="px-4 py-3 border-b border-line-strong/50 text-sm font-medium flex items-center justify-between gap-2">
                  <span>
                    Captions for YouTube <span className="text-muted font-normal">· {srt ? `${srt.lines} lines` : "none"}</span>
                  </span>
                  {srt?.saved && <span className="text-[11px] text-success truncate">Saved beside the video</span>}
                </div>
                {srt ? (
                  <pre className="flex-1 max-h-64 overflow-auto p-4 text-xs leading-5 text-muted whitespace-pre-wrap">{srt.text.slice(0, 5000)}</pre>
                ) : (
                  <p className="p-4 text-sm text-muted">
                    No script was added, so there is no .srt. Add the polished script above and merge again.
                  </p>
                )}
                {srt && srt.missing.length > 0 && (
                  <p className="px-4 pb-3 text-xs text-warning">{srt.missing.join(", ")} isn&apos;t in the script — that stretch has no captions.</p>
                )}
                {srt && srt.synced.length > 0 && (
                  <p className="px-4 pb-3 text-xs text-muted">
                    {srt.synced.join(", ")}: timed from the script to the voice&apos;s pauses — check a few lines in YouTube Studio&apos;s caption editor.
                  </p>
                )}
              </div>
            </div>
            {srt && (
              <div className="px-5 pb-5 text-xs text-muted">
                Next: open{" "}
                <Link href="/publish" className="text-link hover:underline">
                  Publish Kit
                </Link>{" "}
                → Upload video, then add this merged MP4 and its .srt for chapters, titles and tags.
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function SlotCard({
  slot,
  order,
  path,
  probe,
  copying,
  plan,
  onPick,
  onFile,
  onClear,
  onSwap,
  disabled,
}: {
  slot: (typeof SLOTS)[number];
  order: number;
  path: string | null;
  probe?: Probed;
  copying: boolean;
  plan: CaptionPlan | null;
  onPick: () => void;
  onFile: (f: File) => void;
  onClear: () => void;
  onSwap: (from: string) => void;
  disabled: boolean;
}) {
  const [over, setOver] = useState(false);
  const info = probe?.info;

  return (
    <div
      draggable={!!path && !disabled}
      onDragStart={(e) => e.dataTransfer.setData("text/x-slot", slot.id)}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const from = e.dataTransfer.getData("text/x-slot");
        if (from) return onSwap(from);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={`group relative rounded-2xl border p-3 flex flex-col gap-3 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(0,0,0,0.6)] ${
        over
          ? "border-link bg-link/10"
          : path
            ? probe?.error
              ? "border-error/50 bg-error/5"
              : "border-line-strong/60 bg-raised/60 cursor-grab active:cursor-grabbing"
            : "border-dashed border-line-strong bg-raised/30 hover:border-link/60"
      }`}
    >
      <span className="absolute top-5 left-5 z-10 inline-flex items-center gap-1.5 rounded-full bg-[#1B1B1B]/85 backdrop-blur px-2.5 py-1 text-[11px] font-bold tracking-wide text-white ring-1 ring-white/10">
        <span className="text-[#FFD23F]">{String(order).padStart(2, "0")}</span>
        {slot.label}
      </span>

      <button
        type="button"
        onClick={onPick}
        disabled={disabled || copying}
        className="relative aspect-video w-full rounded-xl overflow-hidden bg-bg/60 outline-none"
        aria-label={path ? `Replace the ${slot.label} video` : `Add the ${slot.label} video`}
      >
        {path && !probe?.error ? (
          <>
            <video src={`${fileUrl(path)}#t=1`} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
            {info && (
              <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-mono text-white">{clock(info.duration)}</span>
            )}
          </>
        ) : (
          <span className="absolute inset-0 grid place-items-center">
            <span className="flex flex-col items-center gap-2">
              <span
                className={`w-12 h-12 rounded-xl bg-gradient-to-br ring-1 grid place-items-center group-hover:scale-110 transition-transform ${slot.tint}`}
              >
                {copying ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" aria-hidden>
                    <path d="M12 3a9 9 0 019 9" strokeLinecap="round" />
                  </svg>
                ) : slot.part === null ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="5" width="14" height="14" rx="2.5" />
                    <path d="M17 10l4-2.5v9L17 14" />
                  </svg>
                )}
              </span>
              <span className="text-xs text-muted">{copying ? "Copying…" : "Click or drop a video"}</span>
            </span>
          </span>
        )}
      </button>

      <div className="px-1 min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{probe?.name ?? (path ? path.split("/").pop() : slot.hint)}</div>
            <div className="text-[11px] text-muted truncate">
              {probe?.error
                ? <span className="text-error">{probe.error}</span>
                : info?.video
                  ? `${info.video.width}×${info.video.height} · ${Math.round(info.video.fps * 100) / 100} fps${info.audio ? "" : " · no audio"}`
                  : path
                    ? "Reading…"
                    : slot.part === null
                      ? "The opening before Part 1"
                      : `Exported ${slot.hint}`}
            </div>
          </div>
          {path && (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              aria-label={`Remove the ${slot.label} video`}
              className="w-7 h-7 shrink-0 rounded-lg grid place-items-center text-muted hover:text-error hover:bg-error/15 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        {plan && (
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${
                plan.kind === "exact" ? "bg-[#FFD23F] text-[#1B1B1B]" : plan.kind === "script" ? "bg-accent/25 text-link" : "bg-hover text-muted"
              }`}
            >
              CC
            </span>
            <span className="text-muted truncate">
              {plan.kind === "exact"
                ? "Exact — your burned-in subtitles"
                : plan.kind === "script"
                  ? "From the script, timed to the voice"
                  : "This part isn't in the script"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function baseName(p: string) {
  return (p.split("/").pop() ?? "MERGED").replace(/\.[^.]+$/, "");
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-subrip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
