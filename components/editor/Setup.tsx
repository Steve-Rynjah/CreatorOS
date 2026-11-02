"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, ProgressBar, pollJob } from "@/components/ui";
import { fileUrl } from "@/lib/editor/render";
import { formatTime, uid } from "@/lib/editor/timing";
import type { Cue, ImageClip, Motion, Project, TextClip } from "@/lib/editor/types";
import {
  DEFAULT_SPEED,
  DEFAULT_VOICE,
  SPEEDS,
  VOICES,
  chapterOf,
  chapterSpeech,
  isSpeed,
  isVoice,
  spokenText,
  type Narration,
  type ParsedScript,
  type ScriptPart,
  type SpeedId,
  type VoiceId,
} from "@/lib/script";

const LAST_KEY = "creatoros:last-setup";
const SCRIPT_KEY = "creatoros:script";

export type ScanResult = {
  imagesDir: string;
  audioDir: string;
  images: { name: string; path: string; index: number }[];
  audio: { name: string; path: string; start: number; duration: number }[];
  audioMix: string;
  duration: number;
  peaks: number[];
  peaksPerSec: number;
  warnings: string[];
};

export function savedKey(imagesDir: string, audioDir: string) {
  return `creatoros:project:${imagesDir}|${audioDir}`;
}

type BuildOptions = { subtitles: boolean; onScreen: boolean; motion: boolean; chapter: boolean };

function scriptMotion(text: string): Motion {
  if (/zoom\s*-?\s*in|push\s*in/i.test(text)) return "zoom-in";
  if (/zoom\s*-?\s*out|pull\s*(back|out)/i.test(text)) return "zoom-out";
  return "none";
}

/**
 * One image per script shot, on screen for exactly as long as that shot's narration
 * (cut lands where the next shot's voice begins). Images are matched to shots by number
 * (049.png ↔ SHOT 049) when the folder is numbered that way, otherwise in order.
 */
export function buildScriptProject(
  scan: ScanResult,
  part: ScriptPart,
  narration: Narration,
  meta: { file: string; voice: string },
  opts: BuildOptions,
): Project {
  let saved: Partial<Project> | null = null;
  try {
    const raw = localStorage.getItem(savedKey(scan.imagesDir, scan.audioDir));
    if (raw) saved = JSON.parse(raw);
  } catch {}
  const prevByName = new Map((saved?.images ?? []).map((c) => [c.name, c]));
  const warnings = scan.warnings.filter((w) => !/^No numbered names/.test(w));

  const imgs = scan.images;
  const shots = narration.shots;
  const byNumber = shots.every((s) => imgs.some((i) => i.index === s.n));
  const shotInfo = new Map(part.shots.map((s) => [s.n, s]));
  const chapterInfo = narration.intro ? chapterOf(part) : null;
  const chapter = chapterInfo && narration.intro ? { ...chapterInfo, duration: narration.intro.end } : undefined;

  const images: ImageClip[] = [];
  const texts: TextClip[] = [];
  const uncovered: number[] = [];
  shots.forEach((s, k) => {
    const end = k + 1 < shots.length ? shots[k + 1].start : Math.max(scan.duration, s.end);
    const dur = end - s.start;
    const info = shotInfo.get(s.n);
    const img = byNumber ? imgs.find((i) => i.index === s.n) : imgs[k];
    if (!img) {
      uncovered.push(s.n);
      if (images.length) images[images.length - 1].duration! += dur;
      return;
    }
    const prev = prevByName.get(img.name);
    images.push({
      id: uid(),
      name: img.name,
      path: img.path,
      motion: prev?.motion ?? (opts.motion && info ? scriptMotion(info.motion) : "none"),
      transition: prev?.transition ?? "none",
      transitionDur: prev?.transitionDur ?? 0.6,
      duration: dur,
      shot: s.n,
    });
    if (opts.onScreen && info?.onScreen) {
      texts.push({
        id: uid(),
        text: info.onScreen,
        start: s.start + 0.2,
        duration: Math.max(1.2, dur - 0.4),
        x: 0.5,
        y: 0.14,
        size: 72,
        font: "montserrat",
        color: "#FFFFFF",
        bold: true,
        background: true,
        bgColor: "#1B1B1B",
        fade: true,
        align: "center",
        anim: "pop",
        animDur: 0.3,
      });
    }
  });
  if (!images.length) throw new Error("None of the images in that folder match the shots of this part.");

  if (uncovered.length) {
    warnings.push(
      `No image for shot${uncovered.length > 1 ? "s" : ""} ${uncovered.map((n) => String(n).padStart(3, "0")).join(", ")} — the image before stays on screen.`,
    );
  }
  if (!byNumber) {
    const extra = imgs.length - shots.length;
    if (extra > 0) warnings.push(`${extra} more image${extra > 1 ? "s" : ""} than shots — the last ${extra} ${extra > 1 ? "are" : "is"} not used.`);
    warnings.push(`Image numbers don't match the shot numbers (${shots[0].n}–${shots[shots.length - 1].n}), so images were matched in order.`);
  }

  const cues: Cue[] = opts.subtitles ? narration.cues.map((c) => ({ id: uid(), ...c })) : [];

  return {
    imagesDir: scan.imagesDir,
    audioDir: scan.audioDir,
    audioMix: scan.audioMix,
    audio: scan.audio,
    audioDuration: scan.duration,
    peaks: scan.peaks,
    peaksPerSec: scan.peaksPerSec,
    warnings,
    secondsPerImage: 5,
    // The title card plays before the first shot.
    offsetOverride: chapter ? shots[0].start : 0,
    introFill: chapter ? "black" : "first",
    chapter,
    fit: saved?.fit ?? "cover",
    zoomAmount: saved?.zoomAmount ?? 0.12,
    script: { file: meta.file, part: part.title, voice: meta.voice, shots: shots.length },
    images,
    texts: saved?.texts?.length ? saved.texts : texts,
    cues: saved?.cues?.length && !!saved.chapter === !!chapter ? saved.cues : cues,
    subtitle: saved?.subtitle ?? { enabled: opts.subtitles, size: 64, position: "bottom", box: false, style: "modern", highlight: "#FFD23F" },
  };
}

export function Setup({ onLoaded }: { onLoaded: (p: Project) => void }) {
  const [imagesDir, setImagesDir] = useState("");
  const [script, setScript] = useState<ParsedScript | null>(null);
  const [partKey, setPartKey] = useState<string>("");
  const [voice, setVoice] = useState<VoiceId>(DEFAULT_VOICE);
  const [rate, setRate] = useState<SpeedId>(DEFAULT_SPEED);
  const [opts, setOpts] = useState<BuildOptions>({ subtitles: true, onScreen: true, motion: true, chapter: true });
  const [narrations, setNarrations] = useState<Record<string, Narration>>({});
  const [job, setJob] = useState<{ progress: number; stage: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  // Playback position, tied to the recording it belongs to.
  const [clock, setClock] = useState({ key: "", t: 0 });

  // Every visit starts with empty sources; only the voice, speed and switches are remembered.
  useEffect(() => {
    try {
      localStorage.removeItem(SCRIPT_KEY); // older versions kept the whole script here
      const last = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
      /* eslint-disable react-hooks/set-state-in-effect -- restore preferences from localStorage after hydration */
      if (last) {
        if (isVoice(last.voice)) setVoice(last.voice);
        if (isSpeed(last.rate)) setRate(last.rate);
        if (last.opts) setOpts((o) => ({ ...o, ...last.opts }));
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ voice, rate, opts }));
    } catch {}
  }, [voice, rate, opts]);

  function clearScript() {
    audioRef.current?.pause();
    setScript(null);
    setPartKey("");
    setNarrations({});
    setError(null);
  }

  const part = script?.parts.find((p) => p.key === partKey) ?? null;
  const chapter = part ? chapterOf(part) : null;
  const withCard = !!chapter && opts.chapter;
  const narrationKey = part ? `${script?.file}|${part.key}|${voice}|${rate}|${withCard ? "card" : ""}` : "";
  const narration = narrations[narrationKey] ?? null;
  const voiceLabel = VOICES.find((v) => v.id === voice)?.label ?? voice;
  const time = clock.key === narrationKey ? clock.t : 0;
  const setTime = (t: number) => setClock({ key: narrationKey, t });

  // A different part / voice / speed is a different recording: stop the old one.
  useEffect(() => {
    audioRef.current?.pause();
  }, [narrationKey]);

  async function readPdf(file: File) {
    setError(null);
    setReading(true);
    try {
      const r = await fetch(`/api/script?${new URLSearchParams({ name: file.name })}`, { method: "POST", body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const parsed = j as ParsedScript;
      setScript(parsed);
      setPartKey(parsed.parts[0].key);
      setNarrations({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function ensureNarration(): Promise<Narration | null> {
    if (!part) return null;
    if (narration) return narration;
    setError(null);
    setJob({ progress: 0, stage: "Starting" });
    try {
      const r = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shots: part.shots.map((s) => ({ n: s.n, narration: s.narration })),
          voice,
          rate,
          intro: withCard && chapter ? chapterSpeech(chapter) : undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const result = await pollJob<Narration>(j.jobId, setJob);
      setNarrations((m) => ({ ...m, [narrationKey]: result }));
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setJob(null);
    }
  }

  async function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      return;
    }
    const n = await ensureNarration();
    if (!n) return;
    const src = fileUrl(n.audioPath);
    if (!a.src.endsWith(src)) {
      a.src = src;
      a.currentTime = 0;
    }
    a.play().catch((e) => setError(`Could not play the audio: ${e.message}`));
  }

  function seek(t: number) {
    const a = audioRef.current;
    if (!a || !narration) return;
    const src = fileUrl(narration.audioPath);
    if (!a.src.endsWith(src)) a.src = src;
    a.currentTime = t;
    setTime(t);
  }

  async function build(e: React.FormEvent) {
    e.preventDefault();
    if (!part || !script) return;
    audioRef.current?.pause();
    setBuilding(true);
    setError(null);
    try {
      const n = await ensureNarration();
      if (!n) return;
      const r = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagesDir, audioFile: n.audioPath }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      onLoaded(buildScriptProject(j as ScanResult, part, n, { file: script.file, voice: voiceLabel }, opts));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  const totalShots = script?.parts.reduce((s, p) => s + p.shots.length, 0) ?? 0;
  const busy = !!job || building || reading;
  const progress = narration ? Math.min(time / narration.duration, 1) : 0;

  return (
    <div className="h-full overflow-auto">
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        hidden
      />
      <form onSubmit={build} className="max-w-3xl mx-auto px-6 py-12 space-y-8 animate-rise">
        <header>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#FFD23F]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFD23F]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FFD23F] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FFD23F]" />
            </span>
            Scene · Take 1
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">
            Lights. Script. <span className="text-[#FFD23F]">Action.</span>
          </h1>
          <p className="text-muted mt-2">Drop in your scenes and script. The voice, timing and subtitles are handled for you.</p>
        </header>

        {/* Sources */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FolderCard value={imagesDir} onChange={setImagesDir} onClear={() => setImagesDir("")} />
          <PdfCard
            file={script?.file ?? null}
            meta={script ? `${script.parts.length} parts · ${totalShots} shots · ${script.pages} pages` : null}
            reading={reading}
            onFile={readPdf}
            onClear={clearScript}
          />
        </div>

        {script && (
          <section className="rounded-2xl border border-line-strong/60 bg-raised/60 overflow-hidden">
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Part">
                <Select value={partKey} onChange={setPartKey} disabled={busy}>
                  {script.parts.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.title}
                      {p.name ? ` – ${p.name}` : ""} · {p.shots.length} shots
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Voice">
                <Select value={voice} onChange={(v) => setVoice(v as VoiceId)} disabled={busy}>
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} — {v.hint}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Speed" className="sm:col-span-2">
                <div className="grid grid-cols-3 bg-bg/70 border border-line-strong/60 rounded-xl p-1 gap-1">
                  {SPEEDS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => !busy && setRate(s.id)}
                      className={`h-8 rounded-lg text-sm font-medium transition-all ${
                        rate === s.id ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg hover:bg-chip"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {part && (
              <div className="border-t border-line-strong/50 bg-bg/40 px-5 py-4 flex items-center gap-4">
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!!job || building}
                  aria-label={playing ? "Pause" : "Play"}
                  className="w-12 h-12 shrink-0 rounded-full bg-accent text-white grid place-items-center shadow-[0_6px_20px_-6px_var(--accent)] hover:bg-accent-hover hover:scale-105 active:scale-95 transition disabled:opacity-40"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z" />}
                  </svg>
                </button>
                <div className="flex-1 min-w-0">
                  {job ? (
                    <div className="space-y-2">
                      <div className="text-xs text-muted">{job.stage}…</div>
                      <ProgressBar value={job.progress} />
                    </div>
                  ) : narration ? (
                    <div className="space-y-1.5">
                      <div className="relative h-1.5 rounded-full bg-hover">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
                        <input
                          type="range"
                          min={0}
                          max={narration.duration}
                          step={0.01}
                          value={Math.min(time, narration.duration)}
                          onChange={(e) => seek(Number(e.target.value))}
                          aria-label="Seek"
                          className="absolute inset-0 w-full opacity-0 cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-muted tabular-nums">
                        <span>{formatTime(time, false)}</span>
                        <span>{formatTime(narration.duration, false)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm">
                      <div className="font-medium">Preview the narration</div>
                      <div className="text-muted text-xs mt-0.5">
                        {part.title} · read by {voiceLabel}
                      </div>
                    </div>
                  )}
                </div>
                {narration && !job && (
                  <a
                    href={fileUrl(narration.audioPath, true)}
                    title="Download audio"
                    aria-label="Download audio"
                    className="w-9 h-9 shrink-0 rounded-lg grid place-items-center text-muted hover:text-fg hover:bg-chip transition-colors"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
                    </svg>
                  </a>
                )}
              </div>
            )}
          </section>
        )}

        {part && (
          <NarrationBox part={part} chapter={withCard ? chapter : null} narration={narration} time={time} playing={playing} onSeek={seek} />
        )}

        {part && (
          <div className="flex flex-wrap gap-2">
            {chapter && (
              <Chip checked={opts.chapter} onChange={(v) => setOpts((o) => ({ ...o, chapter: v }))} label="Chapter title card" />
            )}
            <Chip checked={opts.subtitles} onChange={(v) => setOpts((o) => ({ ...o, subtitles: v }))} label="Subtitles" />
            <Chip checked={opts.onScreen} onChange={(v) => setOpts((o) => ({ ...o, onScreen: v }))} label="On-screen text" />
            <Chip checked={opts.motion} onChange={(v) => setOpts((o) => ({ ...o, motion: v }))} label="Zoom motion" />
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        <Button variant="primary" size="lg" disabled={busy || !imagesDir || !part} className="w-full sm:w-auto rounded-xl">
          {building ? (job ? "Making the narration…" : "Preparing timeline…") : "Build timeline"}
          {!building && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14m-5-5l5 5-5 5" />
            </svg>
          )}
        </Button>
      </form>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-11 appearance-none pl-3.5 pr-9 rounded-xl bg-bg/70 border border-line-strong/60 text-sm text-fg truncate focus:outline-none focus:border-link transition-colors hover:border-line-strong disabled:opacity-50"
      >
        {children}
      </select>
    </div>
  );
}

function Chip({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`h-9 pl-2.5 pr-3.5 rounded-full border text-sm inline-flex items-center gap-2 transition-colors ${
        checked ? "border-accent/50 bg-accent/15 text-fg" : "border-line-strong/60 text-muted hover:text-fg hover:border-line-strong"
      }`}
    >
      <span className={`w-4 h-4 rounded-full grid place-items-center transition-colors ${checked ? "bg-accent" : "border border-line-strong"}`}>
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

/** The selected part's narration as plain prose, following the audio while it plays. */
function NarrationBox({
  part,
  chapter,
  narration,
  time,
  playing,
  onSeek,
}: {
  part: ScriptPart;
  chapter: { label: string | null; title: string } | null;
  narration: Narration | null;
  time: number;
  playing: boolean;
  onSeek: (t: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const timed = useMemo(() => new Map(narration?.shots.map((s) => [s.n, s]) ?? []), [narration]);
  const active = narration?.shots.find((s) => time >= s.start && time < s.end)?.n ?? null;
  const words = part.shots.reduce((s, x) => s + spokenText(x.narration).split(" ").length, 0);
  const following = playing || time > 0;

  // Keep the passage being read in view.
  useEffect(() => {
    if (!playing || active === null) return;
    const box = boxRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-shot="${active}"]`);
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: top - 24, behavior: "smooth" });
    }
  }, [active, playing]);

  return (
    <section className="rounded-2xl border border-line-strong/60 bg-raised/60">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="text-sm font-semibold">
          Narration
          <span className="text-muted font-normal">
            {" "}
            · {part.title}
            {part.name ? ` – ${part.name}` : ""}
          </span>
        </h2>
        <span className="text-xs text-muted tabular-nums whitespace-nowrap">
          {words} words{narration ? ` · ${formatTime(narration.duration, false)}` : ""}
        </span>
      </div>
      <div ref={boxRef} className="max-h-[360px] overflow-auto px-5 pb-5">
        {chapter && (
          <button
            type="button"
            onClick={() => narration?.intro && onSeek(0)}
            className={`mb-3 inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs transition-colors ${
              narration?.intro && time < narration.intro.end && following ? "bg-[#FFD23F] text-[#1B1B1B]" : "bg-[#FFD23F]/12 text-[#FFD23F]"
            }`}
          >
            <span className="font-semibold uppercase tracking-wider">{chapter.label ?? "Chapter"}</span>
            <span className="opacity-60">·</span>
            {chapter.title}
          </button>
        )}
        <p className="text-[15px] leading-8">
          {part.shots.map((s) => {
            const t = timed.get(s.n);
            const isActive = active === s.n;
            return (
              <span
                key={s.n}
                data-shot={s.n}
                onClick={() => t && onSeek(t.start)}
                className={`rounded px-0.5 -mx-0.5 transition-colors ${t ? "cursor-pointer hover:bg-hover/60" : ""} ${
                  isActive ? "bg-accent/20 text-fg" : following && narration ? "text-muted" : "text-fg/90"
                }`}
              >
                {spokenText(s.narration)}{" "}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}

const cardCls =
  "group relative rounded-2xl border p-5 flex flex-col gap-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(0,0,0,0.6)]";

function CheckBadge() {
  return (
    <span className="absolute top-4 right-4 w-5 h-5 rounded-full bg-success grid place-items-center">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12l5 5 9-10" />
      </svg>
    </span>
  );
}

/** Scene images folder — opens the native folder picker; the path can also be pasted. */
function FolderCard({ value, onChange, onClear }: { value: string; onChange: (v: string) => void; onClear: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const name = value.split("/").filter(Boolean).pop();

  async function browse() {
    setBusy(true);
    try {
      const r = await fetch("/api/pick-folder", { method: "POST", body: JSON.stringify({ prompt: "Choose the scene images folder" }) });
      const j = await r.json();
      if (j.path) onChange(j.path);
      else if (j.error) setEditing(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`${cardCls} ${value ? "border-line-strong/60 bg-raised/60" : "border-dashed border-line-strong bg-raised/30 hover:border-link/60"}`}
    >
      {value && <CheckBadge />}
      <button type="button" onClick={browse} disabled={busy} className="flex flex-col gap-4 text-left outline-none">
        <span className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400/25 to-accent/25 text-sky-300 grid place-items-center ring-1 ring-sky-400/20 group-hover:scale-105 transition-transform">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">{busy ? "Choosing…" : value ? name : "Scene images"}</span>
          <span className="block text-xs text-muted mt-0.5 truncate">{value || "Choose the folder with 001.png, 002.png…"}</span>
        </span>
      </button>
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setEditing(false))}
          placeholder="/Users/you/Videos/Part1/shots"
          spellCheck={false}
          className="w-full h-8 px-2.5 rounded-lg bg-bg border border-line-strong font-mono text-xs text-fg placeholder:text-subtle focus:outline-none focus:border-link"
        />
      ) : (
        <div className="flex items-center gap-4 text-xs">
          <button type="button" onClick={() => setEditing(true)} className="text-link hover:underline">
            {value ? "Edit path" : "or paste a path"}
          </button>
          {value && (
            <button type="button" onClick={onClear} className="text-muted hover:text-error transition-colors">
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Script PDF — click or drop to upload. */
function PdfCard({
  file,
  meta,
  reading,
  onFile,
  onClear,
}: {
  file: string | null;
  meta: string | null;
  reading: boolean;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={`${cardCls} ${
        over
          ? "border-link bg-link/10"
          : file
            ? "border-line-strong/60 bg-raised/60"
            : "border-dashed border-line-strong bg-raised/30 hover:border-link/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {file && !reading && <CheckBadge />}
      <button type="button" onClick={() => inputRef.current?.click()} disabled={reading} className="flex flex-col gap-4 text-left outline-none">
        <span className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-400/25 to-orange-400/20 text-rose-300 grid place-items-center ring-1 ring-rose-400/20 group-hover:scale-105 transition-transform">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
            <path d="M14 3v5h5" />
            <text x="12" y="17.5" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="currentColor" stroke="none">PDF</text>
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block font-semibold truncate">{reading ? "Reading the script…" : file ? file : "Script PDF"}</span>
          <span className="block text-xs text-muted mt-0.5 truncate">{reading ? "This takes a moment" : (meta ?? "Click to upload or drop it here")}</span>
        </span>
      </button>
      {file && !reading && (
        <div className="flex items-center gap-4 text-xs">
          <button type="button" onClick={() => inputRef.current?.click()} className="text-link hover:underline">
            Replace PDF
          </button>
          <button type="button" onClick={onClear} className="text-muted hover:text-error transition-colors">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
