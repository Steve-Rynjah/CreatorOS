"use client";
import { useEffect, useRef, useState } from "react";
import { renderFrame, type Assets, type TextBox } from "@/lib/editor/render";
import { player } from "@/lib/editor/player";
import {
  checkpoint,
  playingStore,
  projectStore,
  select,
  timeStore,
  updateProject,
  useStore,
} from "@/lib/editor/store";
import { clipIndexAt, clipStart, formatTime, totalDuration } from "@/lib/editor/timing";

export function Preview({ assets }: { assets: Assets }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(false);

  // Maximize: the preview covers the whole screen (real full screen when the browser allows it).
  function toggleMax() {
    if (max) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setMax(false);
    } else {
      setMax(true);
      rootRef.current?.requestFullscreen?.().catch(() => {});
    }
  }
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setMax(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMax(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxesRef = useRef<TextBox[]>([]);
  const [size, setSize] = useState({ w: 640, h: 360 });

  // Fit a 16:9 canvas into the available area.
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(160, Math.min(r.width - 32, ((r.height - 32) * 16) / 9));
      setSize({ w: Math.floor(w), h: Math.floor((w * 9) / 16) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw whenever time, project or selection changes (coalesced to one per frame).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.min(1920, Math.round(size.w * dpr));
    const H = Math.round((W * 9) / 16);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const p = projectStore.get();
      if (!p) return;
      boxesRef.current = renderFrame(ctx, W, H, timeStore.get(), p, assets);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    draw();
    const unsubs = [timeStore.subscribe(schedule), projectStore.subscribe(schedule)];
    return () => {
      cancelAnimationFrame(raf);
      unsubs.forEach((u) => u());
    };
  }, [size, assets]);

  // Drag on-screen text to reposition it.
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sx;
    const hit = [...boxesRef.current].reverse().find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
    if (!hit) return;
    select("text", hit.id);
    const p = projectStore.get()!;
    const t = p.texts.find((x) => x.id === hit.id)!;
    const start = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    let moved = false;
    canvas.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / rect.width;
      const dy = (ev.clientY - start.y) / rect.height;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 0.003) return;
      if (!moved) checkpoint();
      moved = true;
      // Snap to horizontal / vertical center.
      let nx = Math.max(0, Math.min(1, start.tx + dx));
      let ny = Math.max(0, Math.min(1, start.ty + dy));
      if (Math.abs(nx - 0.5) < 0.015) nx = 0.5;
      if (Math.abs(ny - 0.5) < 0.015) ny = 0.5;
      updateProject(
        (s) => ({ ...s, texts: s.texts.map((x) => (x.id === hit.id ? { ...x, x: nx, y: ny } : x)) }),
        { record: false },
      );
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  }

  return (
    <div ref={rootRef} className={max ? "fixed inset-0 z-[80] flex flex-col bg-black" : "flex-1 min-w-0 flex flex-col bg-surface"}>
      <div ref={wrapRef} className="relative flex-1 min-h-0 grid place-items-center">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          style={{ width: size.w, height: size.h }}
          className={`bg-black ${max ? "" : "rounded-lg shadow-[0_0_0_1px_var(--line),0_20px_50px_-20px_rgba(0,0,0,0.8)]"}`}
        />
        <button
          type="button"
          onClick={toggleMax}
          aria-label={max ? "Minimize" : "Maximize"}
          title={max ? "Minimize (Esc)" : "Maximize"}
          className="absolute top-3 right-3 w-9 h-9 rounded-lg grid place-items-center bg-black/55 text-white/90 backdrop-blur hover:bg-black/75 hover:text-white transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {max ? (
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            ) : (
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            )}
          </svg>
        </button>
      </div>
      <Transport />
    </div>
  );
}

function Transport() {
  const time = useStore(timeStore, (t) => t);
  const playing = useStore(playingStore, (x) => x);
  const p = useStore(projectStore, (s) => s)!;
  const total = totalDuration(p);
  const idx = clipIndexAt(p, time);
  const current = idx < 0 ? (p.chapter ? p.chapter.title : "Intro") : p.images[idx]?.name;

  const jump = (dir: -1 | 1) => {
    const bounds = [0, ...p.images.map((_, i) => clipStart(p, i)), total];
    const t = timeStore.get();
    const target = dir < 0 ? [...bounds].reverse().find((b) => b < t - 0.05) : bounds.find((b) => b > t + 0.05);
    player.seek(target ?? (dir < 0 ? 0 : total));
  };

  return (
    <div className="shrink-0 border-t border-line">
      <Scrubber total={total} time={time} />
      <div className="h-12 flex items-center gap-3 px-4">
        <div className="font-mono text-sm tabular-nums w-28">{formatTime(time)}</div>
        <div className="flex-1 flex items-center justify-center gap-1">
          <IconBtn label="Back to start (Home)" onClick={() => player.seek(0)}>
            <path d="M11.5 6v12L3 12zM20.5 6v12L12 12z" />
          </IconBtn>
          <IconBtn label="Previous clip" onClick={() => jump(-1)}>
            <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
          </IconBtn>
          <button
            onClick={() => player.toggle()}
            className="w-10 h-10 mx-1 rounded-full bg-fg text-bg grid place-items-center hover:opacity-90"
            aria-label={playing ? "Pause" : "Play"}
            title="Play / pause (Space)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M7 4.5v15l12.5-7.5z" />}
            </svg>
          </button>
          <IconBtn label="Next clip" onClick={() => jump(1)}>
            <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
          </IconBtn>
          <span className="w-9" aria-hidden />
        </div>
        <div className="w-28 text-right text-xs text-muted">
          <span className="text-fg block truncate">{current}</span>
          <div className="font-mono tabular-nums">{formatTime(total)}</div>
        </div>
      </div>
    </div>
  );
}

/** Seek bar across the whole video, split into its sections (title card + one per shot). */
function Scrubber({ total, time }: { total: number; time: number }) {
  const p = useStore(projectStore, (s) => s)!;
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const sections: { start: number; end: number; label: string }[] = [];
  const first = p.images.length ? clipStart(p, 0) : 0;
  if (first > 0.05) sections.push({ start: 0, end: first, label: p.chapter ? p.chapter.title : "Intro" });
  p.images.forEach((c, i) => {
    const s0 = clipStart(p, i);
    sections.push({ start: s0, end: i + 1 < p.images.length ? clipStart(p, i + 1) : total, label: c.shot ? `Shot ${c.shot}` : c.name });
  });

  const at = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total;
  };
  function onDown(e: React.PointerEvent) {
    e.preventDefault();
    const el = barRef.current!;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    player.seek(at(e.clientX));
    const move = (ev: PointerEvent) => player.seek(at(ev.clientX));
    const up = () => {
      setDragging(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  const pct = (t: number) => `${(total ? t / total : 0) * 100}%`;
  const hoverSec = hover === null ? null : sections.find((s) => hover >= s.start && hover < s.end);

  return (
    <div className="px-4 pt-3">
      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={time}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={(e) => setHover(at(e.clientX))}
        onPointerLeave={() => setHover(null)}
        className="group relative h-4 flex items-center cursor-pointer select-none touch-none"
      >
        {/* Sections */}
        <div className="absolute inset-x-0 h-1.5 group-hover:h-2 transition-[height] flex gap-[2px]">
          {sections.map((s, i) => {
            const fill = Math.max(0, Math.min(1, (time - s.start) / Math.max(0.001, s.end - s.start)));
            const isCard = i === 0 && first > 0.05 && !!p.chapter;
            return (
              <div key={i} className="relative h-full rounded-full bg-hover overflow-hidden" style={{ width: pct(s.end - s.start) }}>
                <div className={`absolute inset-y-0 left-0 ${isCard ? "bg-[#FFD23F]" : "bg-accent"}`} style={{ width: `${fill * 100}%` }} />
              </div>
            );
          })}
        </div>
        {/* Hover marker + label */}
        {hover !== null && !dragging && (
          <div className="absolute -top-7 -translate-x-1/2 pointer-events-none whitespace-nowrap rounded-md bg-black/85 px-2 py-0.5 text-[11px] text-white" style={{ left: pct(hover) }}>
            {hoverSec?.label} · {formatTime(hover, false)}
          </div>
        )}
        {/* Thumb */}
        <div
          className={`absolute w-3.5 h-3.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(70,95,255,0.35)] transition-transform ${
            dragging ? "scale-110" : "scale-0 group-hover:scale-100"
          }`}
          style={{ left: pct(time) }}
        />
      </div>
    </div>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="w-9 h-9 rounded-full grid place-items-center hover:bg-chip">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        {children}
      </svg>
    </button>
  );
}
