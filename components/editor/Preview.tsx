"use client";
import { useEffect, useRef, useState } from "react";
import { renderFrame, type Assets, type TextBox } from "@/lib/editor/render";
import { player } from "@/lib/editor/player";
import {
  checkpoint,
  playingStore,
  projectStore,
  select,
  selectionStore,
  timeStore,
  updateProject,
  useStore,
} from "@/lib/editor/store";
import { clipIndexAt, clipStart, formatTime, totalDuration } from "@/lib/editor/timing";

export function Preview({ assets }: { assets: Assets }) {
  const wrapRef = useRef<HTMLDivElement>(null);
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
      const sel = selectionStore.get();
      if (sel.kind === "text") {
        ctx.save();
        ctx.strokeStyle = "#3ea6ff";
        ctx.lineWidth = Math.max(1.5, H / 400);
        ctx.setLineDash([H / 90, H / 140]);
        for (const b of boxesRef.current) if (sel.ids.includes(b.id)) ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.restore();
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    draw();
    const unsubs = [timeStore.subscribe(schedule), projectStore.subscribe(schedule), selectionStore.subscribe(schedule)];
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
    <div className="flex-1 min-w-0 flex flex-col bg-surface">
      <div ref={wrapRef} className="flex-1 min-h-0 grid place-items-center">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          style={{ width: size.w, height: size.h }}
          className="bg-black rounded-md shadow-[0_0_0_1px_var(--line)]"
        />
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
  const current = idx < 0 ? "Intro" : p.images[idx]?.name;

  const jump = (dir: -1 | 1) => {
    const bounds = [0, ...p.images.map((_, i) => clipStart(p, i)), total];
    const t = timeStore.get();
    const target = dir < 0 ? [...bounds].reverse().find((b) => b < t - 0.05) : bounds.find((b) => b > t + 0.05);
    player.seek(target ?? (dir < 0 ? 0 : total));
  };

  return (
    <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-t border-line">
      <div className="font-mono text-sm tabular-nums w-28">{formatTime(time)}</div>
      <div className="flex-1 flex items-center justify-center gap-1">
        <IconBtn label="Previous clip" onClick={() => jump(-1)}>
          <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
        </IconBtn>
        <button
          onClick={() => player.toggle()}
          className="w-10 h-10 rounded-full bg-fg text-bg grid place-items-center hover:opacity-90"
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
      </div>
      <div className="w-28 text-right text-xs text-muted">
        <span className="text-fg">{current}</span>
        <div className="font-mono tabular-nums">{formatTime(total)}</div>
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
