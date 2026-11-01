"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { player } from "@/lib/editor/player";
import { fileUrl } from "@/lib/editor/render";
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
import { clipDur, clipStart, formatRuler, imagesEnd, offsetOf, totalDuration } from "@/lib/editor/timing";
import { TRANSITIONS, type Motion, type Project, type Transition } from "@/lib/editor/types";
import { newText } from "./TextTab";

const LABEL_W = 96;
const RULER_H = 26;
const HEADER_H = 36;
const FIXED_TRACKS_H = 34 + 34 + 52;
const tracksFor = (imageH: number) =>
  [
    { key: "text", label: "Text", h: 34 },
    { key: "image", label: "Images", h: imageH },
    { key: "cue", label: "Subtitles", h: 34 },
    { key: "audio", label: "Voice-over", h: 52 },
  ] as const;
export const TIMELINE_MIN_H = HEADER_H + RULER_H + FIXED_TRACKS_H + 56;

const TRANSITION_LABEL = Object.fromEntries(TRANSITIONS.map((t) => [t.value, t.label])) as Record<Transition, string>;

export const DRAG_MIME = "application/x-creatoros-preset";
export type PresetDrag = { kind: "motion"; value: Motion } | { kind: "transition"; value: Transition };

export function applyPreset(ids: string[], preset: PresetDrag, transitionDur?: number) {
  updateProject((p) => ({
    ...p,
    images: p.images.map((c) =>
      ids.includes(c.id)
        ? preset.kind === "motion"
          ? { ...c, motion: preset.value }
          : { ...c, transition: preset.value, transitionDur: transitionDur ?? c.transitionDur }
        : c,
    ),
  }));
}

export function Timeline({ height }: { height: number }) {
  const imageH = Math.max(56, height - HEADER_H - RULER_H - FIXED_TRACKS_H);
  const TRACKS = tracksFor(imageH);
  const clipH = imageH - 8;
  const [cutMenu, setCutMenu] = useState<number | null>(null);
  const [dropCut, setDropCut] = useState<number | null>(null);
  const [lastDur, setLastDur] = useState(0.6);
  const p = useStore(projectStore, (s) => s)!;
  const sel = useStore(selectionStore, (s) => s);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pps, setPps] = useState<number | null>(null); // pixels per second
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const total = totalDuration(p);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fitPps = Math.max(2, (viewW - 40) / Math.max(1, total));
  const scale = pps ?? fitPps;
  const contentW = Math.max(viewW, total * scale + 120);

  // Keep the playhead in view while playing.
  useEffect(() => {
    return timeStore.subscribe(() => {
      if (!playingStore.get()) return;
      const el = scrollRef.current;
      if (!el) return;
      const x = timeStore.get() * scale;
      if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 60);
    });
  }, [scale]);

  function zoom(factor: number) {
    const el = scrollRef.current!;
    const center = (el.scrollLeft + el.clientWidth / 2) / scale;
    const next = Math.max(2, Math.min(400, scale * factor));
    setPps(next);
    requestAnimationFrame(() => (el.scrollLeft = center * next - el.clientWidth / 2));
  }

  function timeAt(clientX: number) {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return (clientX - r.left + el.scrollLeft) / scale;
  }

  function scrub(e: React.PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    player.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => player.seek(timeAt(ev.clientX));
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  /** Move / trim a text or subtitle clip, snapping to image cuts, the playhead and other clips. */
  function dragClip(e: React.PointerEvent, kind: "text" | "cue", id: string, mode: "move" | "l" | "r") {
    e.stopPropagation();
    if (e.button !== 0) return;
    select(kind, id, e.shiftKey || e.metaKey);
    const proj = projectStore.get()!;
    const get = (s: Project) =>
      kind === "text"
        ? s.texts.find((t) => t.id === id)!
        : (() => {
            const c = s.cues.find((x) => x.id === id)!;
            return { start: c.start, duration: c.end - c.start };
          })();
    const orig = get(proj);
    const startX = e.clientX;
    const snaps = [
      0,
      timeStore.get(),
      ...proj.images.map((_, i) => clipStart(proj, i)),
      imagesEnd(proj),
      ...proj.texts.filter((t) => t.id !== id).flatMap((t) => [t.start, t.start + t.duration]),
      ...proj.cues.filter((c) => c.id !== id).flatMap((c) => [c.start, c.end]),
    ];
    const snap = (t: number) => {
      const th = 7 / scale;
      let best = t;
      let bd = th;
      for (const s of snaps) {
        if (Math.abs(s - t) < bd) {
          bd = Math.abs(s - t);
          best = s;
        }
      }
      return best;
    };
    let started = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / scale;
      if (!started && Math.abs(ev.clientX - startX) < 3) return;
      if (!started) checkpoint();
      started = true;
      let start = orig.start;
      let dur = orig.duration;
      if (mode === "move") {
        start = Math.max(0, orig.start + dt);
        const s1 = snap(start);
        const s2 = snap(start + dur) - dur;
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2;
      } else if (mode === "l") {
        const end = orig.start + orig.duration;
        start = Math.min(end - 0.2, Math.max(0, snap(orig.start + dt)));
        dur = end - start;
      } else {
        dur = Math.max(0.2, snap(orig.start + orig.duration + dt) - orig.start);
      }
      updateProject(
        (s) =>
          kind === "text"
            ? { ...s, texts: s.texts.map((t) => (t.id === id ? { ...t, start, duration: dur } : t)) }
            : { ...s, cues: s.cues.map((c) => (c.id === id ? { ...c, start, end: start + dur } : c)) },
        { record: false },
      );
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      if (!started) player.seek(timeAt(startX));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  const visStart = scrollLeft / scale - 1;
  const visEnd = (scrollLeft + viewW) / scale + 1;
  const visible = (s: number, e: number) => e >= visStart && s <= visEnd;
  const offset = offsetOf(p);

  // Ruler tick spacing: smallest "nice" step that's at least ~70px apart.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((s) => s * scale >= 70) ?? 3600;
  const ticks: number[] = [];
  for (let t = Math.max(0, Math.floor(visStart / step) * step); t <= Math.min(total + step, visEnd); t += step) ticks.push(t);

  let y = RULER_H;
  const top: Record<string, number> = {};
  for (const tr of TRACKS) {
    top[tr.key] = y;
    y += tr.h;
  }
  const contentH = y;

  return (
    <div className="relative shrink-0 bg-bg select-none" style={{ height: contentH + HEADER_H }}>
      <div className="h-9 flex items-center gap-2 px-3 border-b border-line text-xs text-muted">
        <span>Timeline</span>
        <span className="text-[#717171]">· click/shift-click clips · click a cut between clips to add a transition · double-click Text track to add text</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="w-7 h-7 rounded-full hover:bg-chip text-base" onClick={() => zoom(1 / 1.5)} title="Zoom out">−</button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((Math.log(scale / 2) / Math.log(200)) * 100)}
            onChange={(e) => setPps(2 * Math.pow(200, Number(e.target.value) / 100))}
            className="w-28"
            aria-label="Timeline zoom"
          />
          <button className="w-7 h-7 rounded-full hover:bg-chip text-base" onClick={() => zoom(1.5)} title="Zoom in">+</button>
          <button className="h-7 px-2 rounded-full hover:bg-chip" onClick={() => setPps(null)}>Fit</button>
        </div>
      </div>
      <div className="flex" style={{ height: contentH }}>
        {/* Track labels */}
        <div className="shrink-0 border-r border-line" style={{ width: LABEL_W }}>
          <div style={{ height: RULER_H }} />
          {TRACKS.map((t) => (
            <div key={t.key} style={{ height: t.h }} className="px-3 flex items-center text-xs text-muted border-t border-line">
              {t.label}
              {t.key === "cue" && !p.subtitle.enabled && <span className="ml-1 text-[10px] text-[#717171]">(off)</span>}
            </div>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
            }
          }}
        >
          <div className="relative" style={{ width: contentW, height: contentH }}>
            {/* Ruler */}
            <div className="absolute inset-x-0 top-0 cursor-text" style={{ height: RULER_H }} onPointerDown={scrub}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-[#3f3f3f]" style={{ left: t * scale }}>
                  <span className="absolute left-1 top-1 text-[10px] text-muted tabular-nums">{formatRuler(t)}</span>
                </div>
              ))}
            </div>

            {/* Track backgrounds (click to seek / deselect) */}
            {TRACKS.map((t) => (
              <div
                key={t.key}
                className="absolute inset-x-0 border-t border-line"
                style={{ top: top[t.key], height: t.h }}
                onPointerDown={(e) => {
                  selectionStore.set({ kind: null, ids: [] });
                  scrub(e);
                }}
                onDoubleClick={(e) => {
                  if (t.key !== "text") return;
                  const tt = newText(timeAt(e.clientX));
                  updateProject((s) => ({ ...s, texts: [...s.texts, tt] }));
                  select("text", tt.id);
                }}
              />
            ))}

            {/* Intro region before the first image */}
            {offset > 0 && (
              <div
                className="absolute rounded-md border border-dashed border-[#3f3f3f] text-[10px] text-[#717171] flex items-center justify-center overflow-hidden pointer-events-none"
                style={{ top: top.image + 4, height: clipH, left: 0, width: offset * scale - 2 }}
              >
                {offset * scale > 50 && `Intro ${offset.toFixed(2)}s`}
              </div>
            )}

            {/* Image clips */}
            {p.images.map((c, i) => {
              const s = clipStart(p, i);
              const d = clipDur(p, i);
              if (!visible(s, s + d)) return null;
              const w = d * scale;
              const selected = sel.kind === "image" && sel.ids.includes(c.id);
              return (
                <div
                  key={c.id}
                  className={`absolute rounded-md overflow-hidden cursor-pointer bg-chip bg-cover bg-center ${
                    selected ? "ring-2 ring-fg z-10" : dropTarget === c.id ? "ring-2 ring-link z-10" : "ring-1 ring-black/60"
                  }`}
                  style={{
                    top: top.image + 4,
                    height: clipH,
                    left: s * scale + 1,
                    width: Math.max(2, w - 2),
                    backgroundImage: w > 24 ? `url("${fileUrl(c.path)}")` : undefined,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey && sel.kind === "image" && sel.ids.length) {
                      // range select
                      const ids = p.images.map((x) => x.id);
                      const a = ids.indexOf(sel.ids[sel.ids.length - 1]);
                      const range = ids.slice(Math.min(a, i), Math.max(a, i) + 1);
                      selectionStore.set({ kind: "image", ids: Array.from(new Set([...sel.ids, ...range])) });
                    } else select("image", c.id, e.metaKey || e.ctrlKey);
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(DRAG_MIME)) {
                      e.preventDefault();
                      setDropTarget(c.id);
                    }
                  }}
                  onDragLeave={() => setDropTarget((d) => (d === c.id ? null : d))}
                  onDrop={(e) => {
                    setDropTarget(null);
                    const raw = e.dataTransfer.getData(DRAG_MIME);
                    if (!raw) return;
                    // Dropping on a selected clip applies to the whole selection.
                    const ids = selected ? sel.ids : [c.id];
                    applyPreset(ids, JSON.parse(raw) as PresetDrag);
                  }}
                  title={`${c.shot ? `Shot ${c.shot} · ` : ""}${c.name} · ${clipDur(p, i).toFixed(2)}s · ${c.motion} · ${c.transition}`}
                >
                  <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-gradient-to-t from-black/85 to-transparent text-[10px] leading-tight text-white truncate flex items-center gap-1">
                    {w > 40 && <span className="truncate">{c.name.replace(/\.[^.]+$/, "")}</span>}
                    {c.motion !== "none" && <span className="ml-auto text-[9px] px-1 rounded bg-white/20">{c.motion === "zoom-in" ? "Z+" : "Z−"}</span>}
                  </div>
                </div>
              );
            })}

            {/* Cut points between clips (like DaVinci): click to pick a transition, or drop one here */}
            {p.images.map((c, i) => {
              if (i === 0) return null;
              const x = clipStart(p, i) * scale;
              if (x < scrollLeft - 200 || x > scrollLeft + viewW + 200) return null;
              const has = c.transition !== "none";
              const w = has ? Math.max(20, Math.min(clipDur(p, i) * scale, c.transitionDur * scale)) : 26;
              const active = cutMenu === i || dropCut === i;
              return (
                <button
                  key={`cut-${c.id}`}
                  type="button"
                  className={`group absolute z-20 flex items-center justify-center ${
                    has ? `rounded-md border-2 bg-black/25 ${active ? "border-link" : "border-white/80 hover:border-link"}` : ""
                  }`}
                  style={{ top: top.image + 4, height: clipH, left: x - w / 2, width: w }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setCutMenu(cutMenu === i ? null : i)}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(DRAG_MIME)) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropCut(i);
                    }
                  }}
                  onDragLeave={() => setDropCut((d) => (d === i ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropCut(null);
                    const raw = e.dataTransfer.getData(DRAG_MIME);
                    if (!raw) return;
                    const preset = JSON.parse(raw) as PresetDrag;
                    if (preset.kind === "transition") applyPreset([c.id], preset, has ? c.transitionDur : lastDur);
                  }}
                  title={
                    has
                      ? `${TRANSITION_LABEL[c.transition]} ${c.transitionDur.toFixed(1)}s — click to change`
                      : `Add a transition between ${p.images[i - 1].name} and ${c.name}`
                  }
                >
                  {has ? (
                    <>
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                        <path d="M0 0 L50 50 L0 100 Z M100 0 L50 50 L100 100 Z" fill="rgba(255,255,255,0.38)" />
                        <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(62,166,255,0.9)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                      </svg>
                      {w > 70 && clipH > 50 && (
                        <span className="relative mt-auto mb-1 text-[10px] font-medium px-1 rounded bg-black/70 text-white">
                          {TRANSITION_LABEL[c.transition]}
                        </span>
                      )}
                    </>
                  ) : (
                    <span
                      className={`w-5 h-5 rounded-full grid place-items-center text-sm leading-none font-bold shadow transition-opacity ${
                        active ? "bg-link text-white opacity-100" : "bg-fg text-bg opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      +
                    </span>
                  )}
                </button>
              );
            })}

            {/* Text clips */}
            {p.texts.map((t) => {
              if (!visible(t.start, t.start + t.duration)) return null;
              const selected = sel.kind === "text" && sel.ids.includes(t.id);
              return (
                <ClipBlock
                  key={t.id}
                  top={top.text + 4}
                  h={26}
                  left={t.start * scale}
                  width={t.duration * scale}
                  selected={selected}
                  color="bg-[#7b4dff]"
                  label={t.text || "Text"}
                  onDrag={(e, mode) => dragClip(e, "text", t.id, mode)}
                />
              );
            })}

            {/* Subtitle cues */}
            {p.cues.map((c) => {
              if (!visible(c.start, c.end)) return null;
              const selected = sel.kind === "cue" && sel.ids.includes(c.id);
              return (
                <ClipBlock
                  key={c.id}
                  top={top.cue + 4}
                  h={26}
                  left={c.start * scale}
                  width={(c.end - c.start) * scale}
                  selected={selected}
                  color={p.subtitle.enabled ? "bg-[#2ba640]" : "bg-[#2ba640]/40"}
                  label={c.text}
                  onDrag={(e, mode) => dragClip(e, "cue", c.id, mode)}
                />
              );
            })}

            {/* Voice-over */}
            {p.audio.map((a) => (
              <div
                key={a.path}
                className="absolute rounded-md bg-[#1e3a5f] border border-[#2c5282] pointer-events-none"
                style={{ top: top.audio + 4, height: 44, left: a.start * scale, width: Math.max(2, a.duration * scale - 1) }}
              >
                <span className="absolute left-1 top-0.5 text-[10px] text-[#9cc3ff] z-10">{a.name}</span>
              </div>
            ))}
            <Waveform p={p} scale={scale} scrollLeft={scrollLeft} width={viewW} top={top.audio + 4} />

            <Playhead scale={scale} height={contentH} />
          </div>
        </div>
      </div>
      {cutMenu !== null && p.images[cutMenu] && (
        <CutMenu
          index={cutMenu}
          left={LABEL_W + clipStart(p, cutMenu) * scale - scrollLeft}
          bottom={contentH + HEADER_H - top.image - 4}
          onDur={setLastDur}
          lastDur={lastDur}
          onClose={() => setCutMenu(null)}
        />
      )}
    </div>
  );
}

function ClipBlock({
  top,
  h,
  left,
  width,
  selected,
  color,
  label,
  onDrag,
}: {
  top: number;
  h: number;
  left: number;
  width: number;
  selected: boolean;
  color: string;
  label: string;
  onDrag: (e: React.PointerEvent, mode: "move" | "l" | "r") => void;
}) {
  return (
    <div
      className={`absolute rounded-md ${color} text-[11px] text-white overflow-hidden cursor-grab active:cursor-grabbing ${
        selected ? "ring-2 ring-fg z-10" : ""
      }`}
      style={{ top, height: h, left, width: Math.max(4, width) }}
      onPointerDown={(e) => onDrag(e, "move")}
      title={label}
    >
      <div className="px-2 leading-[26px] truncate pointer-events-none">{label}</div>
      <div className="absolute left-0 top-0 w-1.5 h-full cursor-ew-resize hover:bg-white/40" onPointerDown={(e) => onDrag(e, "l")} />
      <div className="absolute right-0 top-0 w-1.5 h-full cursor-ew-resize hover:bg-white/40" onPointerDown={(e) => onDrag(e, "r")} />
    </div>
  );
}

function Playhead({ scale, height }: { scale: number; height: number }) {
  const t = useStore(timeStore, (x) => x);
  return (
    <div className="absolute top-0 pointer-events-none z-20" style={{ left: t * scale, height }}>
      <div className="absolute -left-[5px] top-0 w-[11px] h-3 bg-accent rounded-b-sm" />
      <div className="absolute left-0 top-0 w-px h-full bg-accent" />
    </div>
  );
}

/** Waveform drawn only for the visible window (canvas width limits). */
function Waveform({ p, scale, scrollLeft, width, top }: { p: Project; scale: number; scrollLeft: number; width: number; top: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = 44 * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, 44);
    ctx.fillStyle = "#5b9dff";
    const mid = 24;
    for (let x = 0; x < width; x++) {
      const t0 = (scrollLeft + x) / scale;
      const t1 = (scrollLeft + x + 1) / scale;
      if (t0 > p.audioDuration) break;
      const i0 = Math.floor(t0 * p.peaksPerSec);
      const i1 = Math.max(i0 + 1, Math.floor(t1 * p.peaksPerSec));
      let m = 0;
      for (let i = i0; i < i1 && i < p.peaks.length; i++) m = Math.max(m, p.peaks[i]);
      const hgt = Math.max(0.5, Math.min(1, m * 1.4) * 17);
      ctx.fillRect(x, mid - hgt, 1, hgt * 2);
    }
  }, [p.peaks, p.peaksPerSec, p.audioDuration, scale, scrollLeft, width]);
  return (
    <canvas ref={ref} className="absolute pointer-events-none" style={{ left: scrollLeft, top, width, height: 44 }} />
  );
}

/** Transition picker for the cut between clip index-1 and clip index. */
function CutMenu({
  index,
  left,
  bottom,
  lastDur,
  onDur,
  onClose,
}: {
  index: number;
  left: number;
  bottom: number;
  lastDur: number;
  onDur: (d: number) => void;
  onClose: () => void;
}) {
  const p = useStore(projectStore, (s) => s)!;
  const ref = useRef<HTMLDivElement>(null);
  const clip = p.images[index];
  const prev = p.images[index - 1];
  const has = clip.transition !== "none";
  const dur = has ? clip.transitionDur : lastDur;

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = setTimeout(() => document.addEventListener("pointerdown", down), 0);
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const set = (transition: Transition, transitionDur = dur) =>
    updateProject((s) => ({
      ...s,
      images: s.images.map((c) => (c.id === clip.id ? { ...c, transition, transitionDur } : c)),
    }));
  const strip = (n: string) => n.replace(/\.[^.]+$/, "");
  const W = 248;

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-raised border border-line rounded-xl shadow-2xl p-3 space-y-3"
      style={{ width: W, bottom: bottom + 8, left: Math.max(8, left - W / 2) }}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">
          Transition <b className="text-fg">{strip(prev.name)}</b> → <b className="text-fg">{strip(clip.name)}</b>
        </span>
        <button className="text-muted hover:text-fg px-1" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {TRANSITIONS.map((t) => (
          <button
            key={t.value}
            onClick={() => set(t.value)}
            className={`h-8 rounded-lg text-xs font-medium transition-colors ${
              clip.transition === t.value ? "bg-fg text-bg" : "bg-chip hover:bg-hover"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>
        <div className="flex justify-between text-[11px] text-muted mb-1">
          <span>Length</span>
          <span className="tabular-nums">{dur.toFixed(1)}s</span>
        </div>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={dur}
          onChange={(e) => {
            const v = Number(e.target.value);
            onDur(v);
            if (has) set(clip.transition, v);
          }}
          className="w-full"
        />
      </div>
      {has && (
        <button
          className="w-full h-7 rounded-lg text-xs bg-chip hover:bg-hover"
          onClick={() =>
            updateProject((s) => ({
              ...s,
              images: s.images.map((c, i) =>
                i === 0 ? c : { ...c, transition: clip.transition, transitionDur: clip.transitionDur },
              ),
            }))
          }
        >
          Use on every cut
        </button>
      )}
    </div>
  );
}
