"use client";
import { Button, Label, Segmented, Toggle, inputCls } from "@/components/ui";
import { TEXT_FONTS } from "@/lib/fonts";
import { player } from "@/lib/editor/player";
import { projectStore, select, selectionStore, timeStore, updateProject, useStore } from "@/lib/editor/store";
import { formatTime, parseTime, uid } from "@/lib/editor/timing";
import type { TextClip } from "@/lib/editor/types";

export function newText(start: number, partial: Partial<TextClip> = {}): TextClip {
  return {
    id: uid(),
    text: "Your text",
    start: Math.max(0, start),
    duration: 3,
    x: 0.5,
    y: 0.5,
    size: 84,
    font: "oswald",
    color: "#ffffff",
    bold: true,
    background: false,
    bgColor: "#000000b3",
    fade: true,
    ...partial,
  };
}

const PRESETS: { label: string; make: (t: number) => Partial<TextClip> }[] = [
  { label: "Title", make: () => ({ text: "Title", size: 110, y: 0.45, font: "oswald" }) },
  { label: "Lower third", make: () => ({ text: "Name / place", size: 52, x: 0.5, y: 0.82, background: true, font: "roboto" }) },
  { label: "Caption", make: () => ({ text: "Caption", size: 46, y: 0.12, font: "roboto", bold: false, background: true }) },
];

const POSITIONS = [
  { label: "Top", y: 0.14 },
  { label: "Center", y: 0.5 },
  { label: "Bottom", y: 0.84 },
];

export function TextTab() {
  const p = useStore(projectStore, (s) => s)!;
  const sel = useStore(selectionStore, (s) => s);
  const current = sel.kind === "text" ? p.texts.find((t) => t.id === sel.ids[0]) : undefined;
  const set = (patch: Partial<TextClip>) =>
    current && updateProject((s) => ({ ...s, texts: s.texts.map((t) => (t.id === current.id ? { ...t, ...patch } : t)) }));

  const add = (partial: Partial<TextClip> = {}) => {
    const t = newText(timeStore.get(), partial);
    updateProject((s) => ({ ...s, texts: [...s.texts, t] }));
    select("text", t.id);
  };

  return (
    <div className="p-4 space-y-5">
      <div className="space-y-2">
        <Button variant="primary" className="w-full" onClick={() => add()}>
          + Add text at playhead
        </Button>
        <div className="flex gap-2">
          {PRESETS.map((pr) => (
            <Button key={pr.label} size="sm" className="flex-1" onClick={() => add(pr.make(timeStore.get()))}>
              {pr.label}
            </Button>
          ))}
        </div>
      </div>

      {current ? (
        <div className="space-y-4">
          <div>
            <Label>Text</Label>
            <textarea
              className={`${inputCls} !h-auto py-2 min-h-[72px] resize-y`}
              value={current.text}
              onChange={(e) => set({ text: e.target.value })}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TimeField label="Start" value={current.start} onChange={(v) => set({ start: Math.max(0, v) })} />
            <TimeField label="Duration" value={current.duration} onChange={(v) => set({ duration: Math.max(0.2, v) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Font</Label>
              <select className={inputCls} value={current.font} onChange={(e) => set({ font: e.target.value })}>
                {TEXT_FONTS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label hint={`${current.size}px`}>Size</Label>
              <input
                type="range"
                min={20}
                max={220}
                value={current.size}
                onChange={(e) => set({ size: Number(e.target.value) })}
                className="w-full mt-2"
              />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input type="color" value={current.color} onChange={(e) => set({ color: e.target.value })} className="w-7 h-7" />
              Color
            </label>
            <Toggle checked={current.bold} onChange={(v) => set({ bold: v })} label="Bold" />
            <Toggle checked={current.fade} onChange={(v) => set({ fade: v })} label="Fade" />
          </div>
          <div className="flex items-center gap-3">
            <Toggle checked={current.background} onChange={(v) => set({ background: v })} label="Background box" />
            {current.background && (
              <input
                type="color"
                value={current.bgColor.slice(0, 7)}
                onChange={(e) => set({ bgColor: e.target.value + "b3" })}
                className="w-7 h-7"
              />
            )}
          </div>
          <div>
            <Label hint="or drag the text on the preview">Position</Label>
            <Segmented
              value={POSITIONS.find((x) => Math.abs(x.y - current.y) < 0.01 && Math.abs(current.x - 0.5) < 0.01)?.label ?? ""}
              options={POSITIONS.map((x) => ({ value: x.label, label: x.label }))}
              onChange={(v) => set({ x: 0.5, y: POSITIONS.find((x) => x.label === v)!.y })}
            />
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              updateProject((s) => ({ ...s, texts: s.texts.filter((t) => t.id !== current.id) }));
              selectionStore.set({ kind: null, ids: [] });
            }}
          >
            Delete text
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Select a text clip on the timeline or preview to edit it.</p>
      )}

      {p.texts.length > 0 && (
        <div>
          <Label>All text ({p.texts.length})</Label>
          <div className="space-y-1">
            {[...p.texts]
              .sort((a, b) => a.start - b.start)
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    select("text", t.id);
                    player.seek(t.start + 0.01);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-sm flex gap-2 ${
                    current?.id === t.id ? "bg-hover" : "hover:bg-chip"
                  }`}
                >
                  <span className="font-mono text-xs text-muted pt-0.5">{formatTime(t.start, false)}</span>
                  <span className="truncate">{t.text || "(empty)"}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        key={value}
        className={`${inputCls} font-mono`}
        defaultValue={formatTime(value, false)}
        onBlur={(e) => {
          const v = parseTime(e.target.value);
          if (v !== null) onChange(v);
          else e.target.value = formatTime(value, false);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}
