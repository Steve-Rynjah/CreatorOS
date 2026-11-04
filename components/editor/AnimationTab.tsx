"use client";
import { useState } from "react";
import { Button, Label, Toggle } from "@/components/ui";
import { projectStore, selectionStore, updateProject, useStore } from "@/lib/editor/store";
import { MOTIONS, TRANSITIONS, type Motion, type Transition } from "@/lib/editor/types";
import { fileUrl } from "@/lib/editor/render";
import { DRAG_MIME, applyPreset, type PresetDrag } from "./Timeline";

export function AnimationTab() {
  const p = useStore(projectStore, (s) => s)!;
  const sel = useStore(selectionStore, (s) => s);
  const [dur, setDur] = useState(0.6);
  const ids = sel.kind === "image" ? sel.ids : [];
  const selected = p.images.filter((c) => ids.includes(c.id));
  const sample = selected[0] ?? p.images[0];
  const thumb = sample ? fileUrl(sample.path) : undefined;
  const same = <K extends "motion" | "transition">(k: K) =>
    selected.length && selected.every((c) => c[k] === selected[0][k]) ? selected[0][k] : null;
  const curMotion = same("motion") as Motion | null;
  const curTransition = same("transition") as Transition | null;

  const apply = (preset: PresetDrag) => {
    if (ids.length) applyPreset(ids, preset, dur);
  };

  return (
    <div className="p-4 space-y-6">
      <div className="text-sm">
        {ids.length ? (
          <span>
            <b>{ids.length}</b> clip{ids.length > 1 ? "s" : ""} selected
            {ids.length === 1 && <span className="text-muted"> · {selected[0]?.name}</span>}
          </span>
        ) : (
          <span className="text-muted">
            Select clips on the timeline (⇧ range, ⌘ add, ⌘A all), then click a preset — or drag a preset onto a
            clip.
          </span>
        )}
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => selectionStore.set({ kind: "image", ids: p.images.map((c) => c.id) })}>
            Select all clips
          </Button>
          {ids.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => selectionStore.set({ kind: null, ids: [] })}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <section>
        <Label>Motion</Label>
        <div className="grid grid-cols-3 gap-2">
          {MOTIONS.map((m) => (
            <Preset
              key={m.value}
              label={m.label}
              anim={m.value === "none" ? "" : `anim-${m.value}`}
              thumb={thumb}
              active={curMotion === m.value}
              disabled={!ids.length}
              drag={{ kind: "motion", value: m.value }}
              onClick={() => apply({ kind: "motion", value: m.value })}
            />
          ))}
        </div>
        <div className="mt-3">
          <Label hint={`${Math.round(p.zoomAmount * 100)}%`}>Zoom amount (all clips)</Label>
          <input
            type="range"
            min={0.03}
            max={0.4}
            step={0.01}
            value={p.zoomAmount}
            onChange={(e) => updateProject((s) => ({ ...s, zoomAmount: Number(e.target.value) }))}
            className="w-full"
          />
        </div>
      </section>

      <section>
        <Label>Transition into clip</Label>
        <div className="grid grid-cols-2 gap-2">
          {TRANSITIONS.map((t) => (
            <Preset
              key={t.value}
              label={t.label}
              anim={t.value === "none" ? "" : `anim-${t.value}`}
              thumb={thumb}
              layered={t.value !== "none"}
              active={curTransition === t.value}
              disabled={!ids.length}
              drag={{ kind: "transition", value: t.value }}
              onClick={() => apply({ kind: "transition", value: t.value })}
            />
          ))}
        </div>
        <div className="mt-3">
          <Label hint={`${dur.toFixed(1)}s`}>Transition length</Label>
          <input
            type="range"
            min={0.2}
            max={2}
            step={0.1}
            value={dur}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDur(v);
              if (ids.length)
                updateProject((s) => ({
                  ...s,
                  images: s.images.map((c) => (ids.includes(c.id) ? { ...c, transitionDur: v } : c)),
                }));
            }}
            className="w-full"
          />
        </div>
      </section>

      <section className="space-y-2">
        <Label hint={(p.outro ?? 0) > 0 ? `${(p.outro ?? 0).toFixed(1)}s` : undefined}>End of this part</Label>
        <Toggle
          checked={(p.outro ?? 0) > 0}
          onChange={(v) => updateProject((s) => ({ ...s, outro: v ? dur : 0 }))}
          label="Fade out to black — dissolves into the next part when merged"
        />
      </section>

      <section className="space-y-2">
        <Label>Quick apply to every clip</Label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() =>
              updateProject((s) => ({
                ...s,
                images: s.images.map((c, i) => ({ ...c, motion: i % 2 ? "zoom-out" : "zoom-in" })),
              }))
            }
          >
            Alternate zoom in/out
          </Button>
          <Button
            size="sm"
            onClick={() =>
              updateProject((s) => ({
                ...s,
                // Every cut, the fade-in of the first shot (unless the title card leads in) and the fade-out at the end.
                images: s.images.map((c, i) => (i === 0 && s.chapter ? c : { ...c, transition: "dissolve", transitionDur: dur })),
                outro: dur,
              }))
            }
          >
            Dissolve all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              updateProject((s) => ({
                ...s,
                images: s.images.map((c) => ({ ...c, motion: "none", transition: "none" })),
                outro: 0,
              }))
            }
          >
            Reset all
          </Button>
        </div>
      </section>
    </div>
  );
}

function Preset({
  label,
  anim,
  thumb,
  active,
  disabled,
  layered,
  drag,
  onClick,
}: {
  label: string;
  anim: string;
  thumb?: string;
  active: boolean;
  disabled: boolean;
  layered?: boolean;
  drag: PresetDrag;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(drag));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onClick}
      className={`preset group text-left rounded-lg p-1.5 transition-colors ${
        active ? "bg-hover ring-1 ring-fg" : "bg-chip hover:bg-hover"
      } ${disabled ? "cursor-grab" : ""}`}
      title={disabled ? "Drag onto a clip, or select clips first" : `Apply ${label}`}
    >
      <div className="relative aspect-video rounded overflow-hidden bg-chip">
        {layered && <div className="absolute inset-0 bg-hover" />}
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element -- local file served by our API
          <img src={thumb} alt="" draggable={false} className={`absolute inset-0 w-full h-full object-cover ${anim}`} />
        )}
      </div>
      <div className="text-xs font-medium mt-1.5 px-0.5">{label}</div>
    </button>
  );
}
