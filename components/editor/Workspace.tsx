"use client";
import { useEffect, useState } from "react";
import { Preview } from "./Preview";
import { TIMELINE_MIN_H, Timeline } from "./Timeline";
import { AnimationTab } from "./AnimationTab";
import { TextTab } from "./TextTab";
import { SubtitleTab } from "./SubtitleTab";
import { ExportDialog } from "./ExportDialog";
import { Button, Segmented, inputCls } from "@/components/ui";
import type { Assets } from "@/lib/editor/render";
import { player } from "@/lib/editor/player";
import {
  loadProject,
  projectStore,
  redo,
  selectionStore,
  timeStore,
  undo,
  updateProject,
  useStore,
} from "@/lib/editor/store";
import { autoOffset, formatTime, imagesTotal, offsetOf, parseTime } from "@/lib/editor/timing";

type Tab = "animation" | "text" | "subtitle";

const LAYOUT_KEY = "creatoros:layout";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function Workspace({ assets }: { assets: Assets }) {
  const p = useStore(projectStore, (s) => s)!;
  const [tab, setTab] = useState<Tab>("animation");
  const [exporting, setExporting] = useState(false);
  const [layout, setLayout] = useState({ timelineH: 340, inspectorW: 380 });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
      if (saved) setLayout(saved); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {}
  }, []);

  /** Drag handle: resizes the timeline (vertical) or the side panel (horizontal). */
  function startResize(e: React.PointerEvent, which: "timelineH" | "inspectorW") {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ...layout };
    const move = (ev: PointerEvent) => {
      const next =
        which === "timelineH"
          ? { ...layout, timelineH: clamp(start.timelineH - (ev.clientY - start.y), TIMELINE_MIN_H, window.innerHeight - 260) }
          : { ...layout, inspectorW: clamp(start.inspectorW - (ev.clientX - start.x), 300, window.innerWidth * 0.55) };
      setLayout(next);
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {}
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = which === "timelineH" ? "row-resize" : "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const sel = useStore(selectionStore, (s) => s);

  // Selecting a clip brings its tab forward.
  useEffect(() => {
    if (sel.kind === "image") setTab("animation"); // eslint-disable-line react-hooks/set-state-in-effect
    if (sel.kind === "text") setTab("text");
    if (sel.kind === "cue") setTab("subtitle");
  }, [sel.kind, sel.ids]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        player.seek(timeStore.get() + (e.key === "ArrowLeft" ? -step : step));
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const proj = projectStore.get();
        if (proj) selectionStore.set({ kind: "image", ids: proj.images.map((i) => i.id) });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const s = selectionStore.get();
        if (s.kind === "text")
          updateProject((proj) => ({ ...proj, texts: proj.texts.filter((t) => !s.ids.includes(t.id)) }));
        if (s.kind === "cue")
          updateProject((proj) => ({ ...proj, cues: proj.cues.filter((c) => !s.ids.includes(c.id)) }));
        if (s.kind === "text" || s.kind === "cue") selectionStore.set({ kind: null, ids: [] });
      } else if (e.key === "Home") {
        e.preventDefault();
        player.seek(0);
      } else if (e.key === "Escape") {
        selectionStore.set({ kind: null, ids: [] });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const offset = offsetOf(p);
  const imgTotal = imagesTotal(p);
  const auto = autoOffset(p.audioDuration, p.images.length, p.secondsPerImage);
  const tooLong = imgTotal > p.audioDuration + 0.01;
  const folder = p.imagesDir.split("/").filter(Boolean).slice(-2).join("/");

  return (
    <div className="h-full flex flex-col">
      {/* Project bar */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 border-b border-line bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
            <svg width="12" height="14" viewBox="0 0 10 12" fill="#ffffff" aria-hidden>
              <path d="M1 0.6l8.4 5.4L1 11.4z" />
            </svg>
          </span>
          <div className="min-w-0">
          <div className="text-sm font-semibold truncate max-w-[320px]" title={p.imagesDir}>
            {p.chapter ? `${p.chapter.label ? `${p.chapter.label} · ` : ""}${p.chapter.title}` : folder}
          </div>
          {p.script ? (
            <div className="text-xs text-muted tabular-nums">
              {p.images.length} shots · voice {p.script.voice} · {formatTime(p.audioDuration, false)}
            </div>
          ) : (
          <div className="text-xs text-muted tabular-nums">
              Voice-over {formatTime(p.audioDuration)} · {p.images.length} images × {p.secondsPerImage}s ={" "}
              {formatTime(imgTotal)} · first image at{" "}
              <span className="text-fg font-medium">{formatTime(offset)}</span>
            </div>
          )}
          </div>
        </div>

        {!p.script && (
          <>
        <div className="flex items-center gap-2 text-xs text-muted">
          Sec/image
          <input
            type="number"
            min={0.1}
            step={0.1}
            className={`${inputCls} !h-7 !w-20 !px-2 text-xs`}
            value={p.secondsPerImage}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value) * 10) / 10;
              if (v >= 0.1) updateProject((s) => ({ ...s, secondsPerImage: v }));
            }}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          Start
          <Segmented
            value={p.offsetOverride === null ? "auto" : "manual"}
            options={[
              { value: "auto", label: `Auto ${formatTime(auto, false)}` },
              { value: "manual", label: "Manual" },
            ]}
            onChange={(v) => updateProject((s) => ({ ...s, offsetOverride: v === "auto" ? null : offsetOf(s) }))}
          />
          {p.offsetOverride !== null && (
            <input
              key={p.offsetOverride}
              className={`${inputCls} !h-7 !w-24 !px-2 text-xs font-mono`}
              defaultValue={formatTime(p.offsetOverride, false)}
              onBlur={(e) => {
                const v = parseTime(e.target.value);
                if (v !== null && v >= 0) updateProject((s) => ({ ...s, offsetOverride: v }));
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          Before 1st image
          <Segmented
            value={p.introFill}
            options={[
              { value: "black", label: "Black" },
              { value: "first", label: "Hold first image" },
            ]}
            onChange={(v) => updateProject((s) => ({ ...s, introFill: v }))}
          />
        </div>
          </>
        )}
        <div className="flex items-center gap-2 text-xs text-muted">
          Image
          <Segmented
            value={p.fit}
            options={[
              { value: "cover", label: "Fill" },
              { value: "contain", label: "Fit + blur" },
            ]}
            onChange={(v) => updateProject((s) => ({ ...s, fit: v }))}
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <BarIcon label="Undo (⌘Z)" onClick={undo}>
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
          </BarIcon>
          <BarIcon label="Redo (⇧⌘Z)" onClick={redo}>
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
          </BarIcon>
          <Button variant="primary" onClick={() => setExporting(true)} className="ml-1.5 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
            </svg>
            Export
          </Button>
          <span className="mx-1.5 h-6 w-px bg-line-strong" />
          <BarIcon
            label="Close the editor"
            onClick={() => {
              player.pause();
              loadProject(null);
            }}
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </BarIcon>
        </div>
      </div>

      {(tooLong || p.warnings.length > 0) && (
        <div className="shrink-0 px-4 py-1.5 text-xs bg-warning/10 text-warning border-b border-line">
          {tooLong &&
            `Images (${formatTime(imgTotal, false)}) are longer than the voice-over (${formatTime(p.audioDuration, false)}) — the video will run past the narration. `}
          {p.warnings.join(" ")}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <Preview assets={assets} />
        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          onPointerDown={(e) => startResize(e, "inspectorW")}
          className="w-1.5 shrink-0 cursor-col-resize bg-line hover:bg-link transition-colors"
        />
        <aside className="shrink-0 flex flex-col min-h-0" style={{ width: layout.inspectorW }}>
          <div className="flex border-b border-line">
            {(
              [
                ["animation", "Animation"],
                ["text", "Text"],
                ["subtitle", "Subtitles"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 h-11 text-sm font-medium border-b-2 transition-colors ${
                  tab === k ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {tab === "animation" && <AnimationTab />}
            {tab === "text" && <TextTab />}
            {tab === "subtitle" && <SubtitleTab />}
          </div>
        </aside>
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize the timeline"
        onPointerDown={(e) => startResize(e, "timelineH")}
        className="h-1.5 shrink-0 cursor-row-resize bg-line hover:bg-link transition-colors"
      />
      <Timeline height={layout.timelineH} />
      {exporting && <ExportDialog assets={assets} onClose={() => setExporting(false)} />}
    </div>
  );
}

function BarIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-9 h-9 rounded-lg grid place-items-center text-muted hover:text-fg hover:bg-chip transition-colors"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
