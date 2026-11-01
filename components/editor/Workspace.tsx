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
      <div className="shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 border-b border-line">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate max-w-[260px]" title={p.imagesDir}>
            {folder}
          </div>
          {p.script ? (
            <div className="text-xs text-muted tabular-nums">
              {p.script.part} · {p.images.length} images timed to {p.script.shots} shots · voice {p.script.voice} ·{" "}
              {formatTime(p.audioDuration)}
            </div>
          ) : (
          <div className="text-xs text-muted tabular-nums">
              Voice-over {formatTime(p.audioDuration)} · {p.images.length} images × {p.secondsPerImage}s ={" "}
              {formatTime(imgTotal)} · first image at{" "}
              <span className="text-fg font-medium">{formatTime(offset)}</span>
            </div>
          )}
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

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={undo} title="Undo (⌘Z)">
            Undo
          </Button>
          <Button variant="ghost" size="sm" onClick={redo} title="Redo (⇧⌘Z)">
            Redo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              player.pause();
              loadProject(null);
            }}
          >
            Change folders
          </Button>
          <Button variant="primary" onClick={() => setExporting(true)} className="ml-2">
            Export
          </Button>
        </div>
      </div>

      {(tooLong || p.warnings.length > 0) && (
        <div className="shrink-0 px-4 py-1.5 text-xs bg-[#f9a825]/10 text-[#f9d27a] border-b border-line">
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
