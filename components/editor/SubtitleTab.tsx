"use client";
import { useRef, useState } from "react";
import { Alert, Button, Label, ProgressBar, Segmented, Toggle, inputCls, pollJob } from "@/components/ui";
import { player } from "@/lib/editor/player";
import { projectStore, select, selectionStore, timeStore, updateProject, useStore } from "@/lib/editor/store";
import { parseSrt, segmentsToCues, toSrt } from "@/lib/editor/subtitles";
import { formatTime, uid } from "@/lib/editor/timing";
import type { Cue } from "@/lib/editor/types";
import { Swatches, TimeField } from "./TextTab";

const LANGUAGES = [
  ["english", "English"],
  ["hindi", "Hindi"],
  ["spanish", "Spanish"],
  ["portuguese", "Portuguese"],
  ["french", "French"],
  ["german", "German"],
  ["auto", "Auto-detect"],
] as const;

export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-subrip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function SubtitleTab() {
  const p = useStore(projectStore, (s) => s)!;
  const sel = useStore(selectionStore, (s) => s);
  const [language, setLanguage] = useState("english");
  const [quality, setQuality] = useState<"fast" | "accurate">("fast");
  const [job, setJob] = useState<{ progress: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sub = p.subtitle;
  const setStyle = (patch: Partial<typeof sub>) => updateProject((s) => ({ ...s, subtitle: { ...s.subtitle, ...patch } }));
  const setCue = (id: string, patch: Partial<Cue>) =>
    updateProject((s) => ({ ...s, cues: s.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const selectedCue = sel.kind === "cue" ? p.cues.find((c) => c.id === sel.ids[0]) : undefined;

  async function generate() {
    if (p.cues.length && !confirmReplace()) return;
    setError(null);
    setJob({ progress: 0, stage: "Starting" });
    try {
      const r = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioPath: p.audioMix, language, quality }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const segments = await pollJob<{ start: number; end: number; text: string }[]>(j.jobId, setJob);
      const cues = segmentsToCues(segments);
      if (!cues.length) throw new Error("No speech was detected in the voice-over.");
      updateProject((s) => ({ ...s, cues, subtitle: { ...s.subtitle, enabled: true } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJob(null);
    }
  }

  // Inline confirmation instead of a blocking browser dialog.
  const [confirming, setConfirming] = useState(false);
  function confirmReplace() {
    if (confirming) {
      setConfirming(false);
      return true;
    }
    setConfirming(true);
    return false;
  }

  async function importSrt(file: File) {
    const cues = parseSrt(await file.text());
    if (!cues.length) return setError("No subtitles found in that file.");
    updateProject((s) => ({ ...s, cues, subtitle: { ...s.subtitle, enabled: true } }));
  }

  const sorted = [...p.cues].sort((a, b) => a.start - b.start);

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between bg-raised rounded-lg px-3 py-2.5">
        <Toggle
          checked={sub.enabled}
          onChange={(v) => {
            setStyle({ enabled: v });
            // Nothing to show yet → create them from the voice-over right away.
            if (v && !p.cues.length && !job) generate();
          }}
          label={<b>Show subtitles</b>}
        />
        <span className="text-xs text-muted">
          {!sub.enabled ? "Off" : job ? "Generating…" : p.cues.length ? "On · in preview & export" : "On · none yet"}
        </span>
      </div>

      <section className="space-y-2">
        <Label hint="runs on this computer">Generate from voice-over</Label>
        <div className="grid grid-cols-2 gap-2">
          <select className={inputCls} value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!job}>
            {LANGUAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <Segmented
            value={quality}
            onChange={setQuality}
            options={[
              { value: "fast", label: "Fast" },
              { value: "accurate", label: "Accurate" },
            ]}
          />
        </div>
        {job ? (
          <div className="space-y-1.5">
            <ProgressBar value={job.progress} />
            <div className="text-xs text-muted">{job.stage}…</div>
          </div>
        ) : (
          <Button variant={confirming ? "primary" : "secondary"} className="w-full" onClick={generate}>
            {confirming ? "Replace existing subtitles? Click to confirm" : "Generate subtitles"}
          </Button>
        )}
        <p className="text-xs text-muted">
          First run downloads the speech model once (Fast ≈ 80 MB, Accurate ≈ 250 MB). Review the text afterwards —
          names and spellings may need fixing.
        </p>
        {error && <Alert tone="error">{error}</Alert>}
      </section>

      <section className="flex gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".srt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importSrt(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          Import .srt
        </Button>
        <Button size="sm" disabled={!p.cues.length} onClick={() => downloadText("subtitles.srt", toSrt(p.cues))}>
          Download .srt
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const t = timeStore.get();
            const c = { id: uid(), start: t, end: t + 2.5, text: "New subtitle" };
            updateProject((s) => ({ ...s, cues: [...s.cues, c] }));
            select("cue", c.id);
          }}
        >
          + Add
        </Button>
      </section>

      <section className="space-y-3">
        <Label>Style</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["modern", "Modern"],
              ["classic", "Classic"],
            ] as const
          ).map(([v, label]) => {
            const on = (sub.style ?? "modern") === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setStyle({ style: v, size: v === "modern" ? Math.max(sub.size, 56) : Math.min(sub.size, 52) })}
                className={`h-16 rounded-xl border grid place-items-center transition-colors ${
                  on ? "border-link bg-link/10" : "border-line-strong/60 hover:border-line-strong"
                } bg-[#1B1B1B]`}
              >
                {v === "modern" ? (
                  <span className="font-[family-name:var(--font-montserrat)] font-extrabold text-sm tracking-wide [text-shadow:0_2px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000]">
                    <span style={{ color: sub.highlight ?? "#FFD23F" }}>IN</span> <span className="text-white">A T-SHIRT</span>
                  </span>
                ) : (
                  <span className="text-xs text-white bg-black/80 px-1.5 py-0.5">In a t-shirt</span>
                )}
                <span className="sr-only">{label}</span>
              </button>
            );
          })}
        </div>
        {(sub.style ?? "modern") === "modern" && (
          <div>
            <Label hint="the word being spoken">Highlight</Label>
            <Swatches value={sub.highlight ?? "#FFD23F"} onChange={(v) => v && setStyle({ highlight: v })} />
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <Segmented
            value={sub.position}
            onChange={(v) => setStyle({ position: v })}
            options={[
              { value: "bottom", label: "Bottom" },
              { value: "top", label: "Top" },
            ]}
          />
          <Toggle checked={sub.box} onChange={(v) => setStyle({ box: v })} label="Dark box" />
        </div>
        <div>
          <Label hint={`${sub.size}px`}>Size</Label>
          <input type="range" min={24} max={110} value={sub.size} onChange={(e) => setStyle({ size: Number(e.target.value) })} className="w-full" />
        </div>
      </section>

      {selectedCue && (
        <section className="space-y-3 bg-raised rounded-lg p-3">
          <Label>Selected subtitle</Label>
          <textarea
            className={`${inputCls} !h-auto py-2 min-h-[60px]`}
            value={selectedCue.text}
            onChange={(e) => setCue(selectedCue.id, { text: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <TimeField label="Start" value={selectedCue.start} onChange={(v) => setCue(selectedCue.id, { start: Math.max(0, v) })} />
            <TimeField label="End" value={selectedCue.end} onChange={(v) => setCue(selectedCue.id, { end: Math.max(selectedCue.start + 0.1, v) })} />
          </div>
        </section>
      )}

      {sorted.length > 0 && (
        <section>
          <Label hint={`${sorted.length} lines`}>Subtitles</Label>
          <div className="space-y-0.5 -mx-1">
            {sorted.map((c) => (
              <div
                key={c.id}
                className={`group flex gap-2 items-start px-1 py-1 rounded-md ${selectedCue?.id === c.id ? "bg-hover" : "hover:bg-chip"}`}
              >
                <button
                  className="font-mono text-[11px] text-link pt-1.5 shrink-0"
                  onClick={() => {
                    select("cue", c.id);
                    player.seek(c.start + 0.01);
                  }}
                >
                  {formatTime(c.start, false)}
                </button>
                <input
                  className="flex-1 bg-transparent text-sm py-1 px-1 rounded focus:outline-none focus:bg-bg"
                  value={c.text}
                  onFocus={() => select("cue", c.id)}
                  onChange={(e) => setCue(c.id, { text: e.target.value })}
                />
                <button
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-fg px-1 pt-1"
                  title="Delete"
                  onClick={() => updateProject((s) => ({ ...s, cues: s.cues.filter((x) => x.id !== c.id) }))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
