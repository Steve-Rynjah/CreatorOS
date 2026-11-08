"use client";
import { useEffect, useRef, useState } from "react";
import { fileUrl } from "@/lib/editor/render";
import { drawShort, loadShortFonts } from "@/lib/shorts/draw";
import { AUDIO_FADE, FRAME, SAFE, specLength } from "@/lib/shorts/layout";
import type { RenderSpec } from "@/lib/shorts/types";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Vertical preview: the long video drawn into the Short's layout live, so edits
 * show at once. Once rendered (and unchanged), the real MP4 can be played instead.
 */
export function ShortPreview({ spec, rendered }: { spec: RenderSpec; rendered: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ctaRef = useRef<HTMLAudioElement>(null);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const specRef = useRef(spec);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [guides, setGuides] = useState(false);
  const [mode, setMode] = useState<"live" | "file">("live");
  /** Time into the call-to-action after the clip, or null while the video itself plays. */
  const holdRef = useRef<number | null>(null);
  const dur = specLength(spec);
  const showFile = mode === "file" && !!rendered;

  useEffect(() => {
    specRef.current = spec;
    draw();
  });

  function draw() {
    const c = canvasRef.current;
    const v = videoRef.current;
    const ctx = c?.getContext("2d");
    if (!ctx || !v) return;
    const s = specRef.current;
    const local = holdRef.current ?? Math.max(0, v.currentTime - s.start);
    drawShort(ctx, s, local, v.readyState >= 2 ? v : null, imagesRef.current);
  }

  // Full-screen images load on the side and appear as soon as they are ready.
  const imageList = [...new Set(spec.shots.map((x) => x.image))].join("\n");
  useEffect(() => {
    for (const path of imageList.split("\n").filter(Boolean)) {
      if (imagesRef.current.has(path)) continue;
      const img = new Image();
      img.onload = () => draw();
      img.src = fileUrl(path);
      imagesRef.current.set(path, img);
    }
  }, [imageList]);

  // Fonts first, then a frame at the clip's start.
  useEffect(() => {
    loadShortFonts().then(draw);
  }, []);

  // Jump to the clip's start whenever the clip moves.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setPlaying(false);
    setT(0);
    holdRef.current = null;
    if (v.readyState >= 1) v.currentTime = spec.start;
  }, [spec.start, spec.end, spec.video]);

  // Playback loop: draw every frame, fade the audio like the render, hold the last frame, stop at the end.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let holdFrom = 0;
    const stop = () => {
      const v = videoRef.current;
      holdRef.current = null;
      ctaRef.current?.pause();
      if (v) {
        v.pause();
        v.currentTime = specRef.current.start;
      }
      setPlaying(false);
      setT(0);
      draw();
    };
    const tick = (now: number) => {
      const v = videoRef.current;
      const s = specRef.current;
      if (!v) return;
      const d = s.end - s.start;
      let local: number;
      if (holdRef.current !== null) {
        local = d + (now - holdFrom) / 1000;
      } else {
        local = v.currentTime - s.start;
        if (local >= d || v.ended) {
          // The clip is over: hold the last picture under the call-to-action.
          v.pause();
          if (!s.hold) return stop();
          holdFrom = now;
          local = d;
          const a = ctaRef.current;
          if (a && s.cta?.audio) {
            a.currentTime = 0;
            a.volume = 1;
            a.play().catch(() => {});
          }
        } else {
          v.volume = Math.max(0, Math.min(1, local / AUDIO_FADE.in, (d - local) / AUDIO_FADE.out));
        }
      }
      if (local >= specLength(s)) return stop();
      if (ctaRef.current && local >= d) ctaRef.current.volume = Math.max(0, Math.min(1, (specLength(s) - local) / AUDIO_FADE.end));
      if (holdRef.current !== null || local >= d) holdRef.current = local;
      setT(Math.max(0, local));
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      ctaRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (holdRef.current !== null || v.currentTime < spec.start || v.currentTime >= spec.end - 0.05) {
      holdRef.current = null;
      v.currentTime = spec.start;
    }
    v.play().then(() => setPlaying(true), () => setPlaying(false));
  }

  function seek(local: number) {
    const v = videoRef.current;
    if (!v) return;
    const clip = spec.end - spec.start;
    // Past the clip's end is the frozen last frame.
    holdRef.current = local > clip ? local : null;
    v.currentTime = spec.start + Math.min(local, clip - 0.04);
    setT(local);
    draw();
  }

  return (
    <div className="space-y-2.5">
      <div className="relative mx-auto w-full max-w-[300px] aspect-[9/16] rounded-2xl overflow-hidden bg-black ring-1 ring-line-strong/60 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]">
        <video
          ref={videoRef}
          src={fileUrl(spec.video)}
          preload="auto"
          playsInline
          className="hidden"
          onLoadedMetadata={(e) => (e.currentTarget.currentTime = specRef.current.start)}
          onSeeked={draw}
          onLoadedData={draw}
        />
        {spec.cta?.audio && <audio ref={ctaRef} src={fileUrl(spec.cta.audio)} preload="auto" hidden />}
        <canvas ref={canvasRef} width={FRAME.w / 2} height={FRAME.h / 2} className={`w-full h-full ${showFile ? "hidden" : ""}`} onClick={toggle} />
        {showFile && <video key={rendered} src={fileUrl(rendered!)} controls playsInline className="absolute inset-0 w-full h-full bg-black" />}
        {guides && !showFile && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute top-0 bottom-0 bg-error/20 border-l border-error/60" style={{ left: `${(SAFE.right / FRAME.w) * 100}%`, right: 0 }} />
            <div className="absolute left-0 right-0 bottom-0 bg-error/20 border-t border-error/60" style={{ top: `${(SAFE.bottom / FRAME.h) * 100}%` }} />
          </div>
        )}
        {!playing && !showFile && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Play the preview"
            className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-[#1B1B1B]/70 backdrop-blur grid place-items-center ring-1 ring-white/15 hover:scale-105 transition-transform"
          >
            <svg width="20" height="22" viewBox="0 0 10 12" fill="#FFD23F" aria-hidden>
              <path d="M1 0.6l8.4 5.4L1 11.4z" />
            </svg>
          </button>
        )}
      </div>

      {!showFile && (
        <div className="flex items-center gap-2 max-w-[300px] mx-auto">
          <button type="button" onClick={toggle} className="w-8 h-8 shrink-0 rounded-lg bg-chip hover:bg-hover border border-line-strong grid place-items-center" aria-label={playing ? "Pause" : "Play"}>
            {playing ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                <rect x="2" y="1" width="3" height="10" rx="1" />
                <rect x="7" y="1" width="3" height="10" rx="1" />
              </svg>
            ) : (
              <svg width="11" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden>
                <path d="M1 0.6l8.4 5.4L1 11.4z" />
              </svg>
            )}
          </button>
          <input type="range" min={0} max={dur} step={0.05} value={Math.min(t, dur)} onChange={(e) => seek(+e.target.value)} className="flex-1" aria-label="Preview position" />
          <span className="text-[11px] font-mono text-muted tabular-nums w-[70px] text-right">
            {clock(t)} / {clock(dur)}
          </span>
        </div>
      )}
      <div className="flex items-center justify-center gap-3 text-[11px]">
        <button type="button" onClick={() => setGuides((g) => !g)} className={guides ? "text-link" : "text-muted hover:text-fg"}>
          {guides ? "Hide" : "Show"} safe zone
        </button>
        {rendered && (
          <>
            <span className="text-subtle">·</span>
            <button type="button" onClick={() => setMode((m) => (m === "live" ? "file" : "live"))} className="text-link hover:underline">
              {showFile ? "Back to live preview" : "Play rendered MP4"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
