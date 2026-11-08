"use client";
import { useState, type DragEvent } from "react";
import { Alert } from "@/components/ui";
import { fileUrl } from "@/lib/editor/render";
import type { ShotGroup } from "@/lib/shorts/shots";
import type { ImageMotion, ShortState } from "@/lib/shorts/types";

const pad = (n: number) => String(n).padStart(3, "0");
const MOTION: Record<ImageMotion, string> = { "zoom-in": "Zoom in", "zoom-out": "Zoom out" };
const thumbCls = "w-full aspect-[9/16] rounded-lg object-cover bg-black";

type Payload = { path: string; slot: number | null };

/** The Short's images on its shots. Drag from the tray to place a copy; drag between shots to swap them. */
export function ShotImages({
  short,
  groups,
  assigned,
  spans,
  onChange,
}: {
  short: ShortState;
  groups: ShotGroup[];
  assigned: (string | null)[];
  spans: { from: number; to: number }[];
  onChange: (patch: Partial<ShortState>) => void;
}) {
  const [over, setOver] = useState<number | null>(null);
  const images = short.images ?? [];
  const nameOf = (p: string) => images.find((i) => i.path === p)?.name ?? p.split("/").pop() ?? p;
  const used = new Set(assigned.filter(Boolean));
  const empty = groups.filter((_, i) => !assigned[i]);
  const mismatch = images.length !== groups.length;

  function commit(next: (string | null)[]) {
    onChange({ mapping: Object.fromEntries(groups.map((g, i) => [g.key, next[i]])) });
  }

  function start(e: DragEvent, payload: Payload) {
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copyMove";
  }

  function drop(e: DragEvent, slot: number) {
    e.preventDefault();
    setOver(null);
    let p: Payload;
    try {
      p = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return;
    }
    if (!p?.path) return;
    const next = [...assigned];
    if (p.slot !== null) next[p.slot] = next[slot];
    next[slot] = p.path;
    commit(next);
  }

  function clear(slot: number) {
    const next = [...assigned];
    next[slot] = null;
    commit(next);
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Images on shots (drag to change)</span>
        {short.mapping && (
          <button type="button" onClick={() => onChange({ mapping: undefined })} className="text-xs text-muted hover:text-fg">
            Reset to folder order
          </button>
        )}
      </div>
      {mismatch && (
        <Alert tone="warn">
          This Short has {groups.length} shot{groups.length === 1 ? "" : "s"} and {images.length} image{images.length === 1 ? "" : "s"}. Drag images onto shots to fix the mapping.
        </Alert>
      )}
      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
        {groups.map((g, i) => {
          const path = assigned[i];
          return (
            <div
              key={g.key}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => drop(e, i)}
              className={`relative rounded-xl border p-1 transition-colors ${over === i ? "border-link bg-link/10" : "border-line-strong/50 bg-bg/40"}`}
            >
              {path ? (
                /* eslint-disable-next-line @next/next/no-img-element -- local files served by the app */
                <img src={fileUrl(path)} alt={nameOf(path)} title={nameOf(path)} draggable onDragStart={(e) => start(e, { path, slot: i })} className={`${thumbCls} cursor-grab`} />
              ) : (
                <div className={`${thumbCls} grid place-items-center border border-dashed border-line-strong text-[10px] text-center text-muted px-1`}>Current layout</div>
              )}
              {path && (
                <button
                  type="button"
                  onClick={() => clear(i)}
                  aria-label={`Remove the image from shot ${pad(g.key)}`}
                  className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-xs leading-none grid place-items-center hover:bg-error"
                >
                  ×
                </button>
              )}
              <div className="mt-1 px-0.5 text-[10px] leading-tight tabular-nums">
                <div className="font-semibold">
                  {pad(g.key)}
                  {g.shots.length > 1 ? `+${g.shots.length - 1}` : ""}
                </div>
                <div className="text-muted">
                  {(spans[i].to - spans[i].from).toFixed(1)} s · {MOTION[g.motion]}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line-strong/50 bg-bg/40 p-2">
        <span className="text-[11px] text-muted mr-1">Folder:</span>
        {images.map((img) => (
          /* eslint-disable-next-line @next/next/no-img-element -- local files served by the app */
          <img
            key={img.path}
            src={fileUrl(img.path)}
            alt={img.name}
            title={`${img.name}${used.has(img.path) ? "" : " (not used)"}`}
            draggable
            onDragStart={(e) => start(e, { path: img.path, slot: null })}
            className={`w-9 aspect-[9/16] rounded object-cover cursor-grab ring-1 ${used.has(img.path) ? "ring-line-strong/60 opacity-70" : "ring-[#FFD23F]"}`}
          />
        ))}
      </div>
      {empty.length > 0 && <p className="text-xs text-muted">Shot{empty.length === 1 ? "" : "s"} {empty.map((g) => pad(g.key)).join(", ")} will use the current layout.</p>}
    </div>
  );
}
