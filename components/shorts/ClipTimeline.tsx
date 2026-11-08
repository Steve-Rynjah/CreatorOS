"use client";
import { useRef, useState } from "react";
import { usable } from "@/lib/shorts/pick";
import type { Sentence } from "@/lib/shorts/types";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const PAD = 14;

/**
 * The Short's stretch of the long video, sentence by sentence. Drag the yellow
 * handles: the start snaps to sentence starts, the end to sentence ends. Other
 * Shorts and the unusable ending/subscribe lines are shaded.
 */
export function ClipTimeline({
  sentences,
  from,
  to,
  others,
  onChange,
}: {
  sentences: Sentence[];
  from: number;
  to: number;
  others: { n: number; from: number; to: number }[];
  onChange: (from: number, to: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ edge: "from" | "to"; win: [number, number] } | null>(null);

  const live: [number, number] = [Math.max(0, sentences[from].start - PAD), Math.min(sentences[sentences.length - 1].end, sentences[to].end + PAD)];
  // Hold the window still while dragging, so the handle stays under the pointer.
  const [w0, w1] = drag?.win ?? live;
  const span = Math.max(1, w1 - w0);
  const pct = (t: number) => `${((Math.min(w1, Math.max(w0, t)) - w0) / span) * 100}%`;
  const visible = sentences.filter((s) => s.end > w0 && s.start < w1);

  function timeAt(clientX: number) {
    const r = barRef.current!.getBoundingClientRect();
    return w0 + ((clientX - r.left) / r.width) * span;
  }

  function move(clientX: number, edge: "from" | "to") {
    const t = timeAt(clientX);
    if (edge === "from") {
      let best = from;
      for (let i = 0; i <= to; i++) if (Math.abs(sentences[i].start - t) < Math.abs(sentences[best].start - t)) best = i;
      if (best !== from) onChange(best, to);
    } else {
      let best = to;
      for (let j = from; j < sentences.length; j++) if (Math.abs(sentences[j].end - t) < Math.abs(sentences[best].end - t)) best = j;
      if (best !== to) onChange(from, best);
    }
  }

  const handle = (edge: "from" | "to") => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={edge === "from" ? "Clip start" : "Clip end"}
      aria-valuenow={edge === "from" ? sentences[from].start : sentences[to].end}
      aria-valuetext={clock(edge === "from" ? sentences[from].start : sentences[to].end)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ edge, win: [w0, w1] });
      }}
      onPointerMove={(e) => drag?.edge === edge && move(e.clientX, edge)}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        if (!d) return;
        e.preventDefault();
        if (edge === "from") onChange(Math.min(to, Math.max(0, from + d)), to);
        else onChange(from, Math.max(from, Math.min(sentences.length - 1, to + d)));
      }}
      className="absolute -top-1.5 -bottom-1.5 w-3 -ml-1.5 cursor-ew-resize z-20 grid place-items-center outline-none group"
      style={{ left: pct(edge === "from" ? sentences[from].start : sentences[to].end) }}
    >
      <span className="w-2 h-full rounded-full bg-[#FFD23F] ring-2 ring-[#1B1B1B] group-focus-visible:ring-link" />
    </div>
  );

  return (
    <div className="space-y-1.5 select-none">
      <div ref={barRef} className="relative h-14 rounded-xl bg-bg/70 border border-line-strong/60">
        {visible.map((s) => (
          <div
            key={s.i}
            title={`${clock(s.start)} · ${s.text}`}
            className={`absolute top-2 bottom-2 rounded-[3px] border-r border-bg ${
              !usable(s) ? "bg-error/25 [background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgba(240,68,56,0.35)_4px_6px)]" : s.i % 2 ? "bg-hover/70" : "bg-hover/45"
            }`}
            style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }}
          />
        ))}
        {others.map((o) => (
          <div
            key={o.n}
            className="absolute top-0 bottom-0 bg-link/15 border-x border-link/40 text-[10px] text-link px-1 pt-0.5 overflow-hidden pointer-events-none"
            style={{ left: pct(sentences[o.from].start), width: `calc(${pct(sentences[o.to].end)} - ${pct(sentences[o.from].start)})` }}
          >
            Short {o.n}
          </div>
        ))}
        <div
          className="absolute top-0 bottom-0 bg-[#FFD23F]/15 border-y-2 border-[#FFD23F]/70 pointer-events-none z-10"
          style={{ left: pct(sentences[from].start), width: `calc(${pct(sentences[to].end)} - ${pct(sentences[from].start)})` }}
        />
        {handle("from")}
        {handle("to")}
      </div>
      <div className="flex justify-between text-[10px] font-mono text-subtle tabular-nums">
        <span>{clock(w0)}</span>
        <span>{clock(w1)}</span>
      </div>
    </div>
  );
}
