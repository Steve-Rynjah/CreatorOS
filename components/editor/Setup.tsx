"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Label, PathField, ProgressBar, Segmented, Toggle, inputCls, pollJob } from "@/components/ui";
import { fileUrl } from "@/lib/editor/render";
import { formatTime, uid } from "@/lib/editor/timing";
import type { Cue, ImageClip, Motion, Project, TextClip } from "@/lib/editor/types";
import {
  DEFAULT_SPEED,
  DEFAULT_VOICE,
  SPEEDS,
  VOICES,
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

type BuildOptions = { subtitles: boolean; onScreen: boolean; motion: boolean };

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
        font: "oswald",
        color: "#ffffff",
        bold: true,
        background: true,
        bgColor: "#000000b3",
        fade: true,
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
    offsetOverride: 0,
    introFill: "first",
    fit: saved?.fit ?? "cover",
    zoomAmount: saved?.zoomAmount ?? 0.12,
    script: { file: meta.file, part: part.title, voice: meta.voice, shots: shots.length },
    images,
    texts: saved?.texts?.length ? saved.texts : texts,
    cues: saved?.cues?.length ? saved.cues : cues,
    subtitle: saved?.subtitle ?? { enabled: opts.subtitles, size: 46, position: "bottom", box: true },
  };
}

export function Setup({ onLoaded }: { onLoaded: (p: Project) => void }) {
  const [imagesDir, setImagesDir] = useState("");
  const [script, setScript] = useState<ParsedScript | null>(null);
  const [partKey, setPartKey] = useState<string>("");
  const [voice, setVoice] = useState<VoiceId>(DEFAULT_VOICE);
  const [rate, setRate] = useState<SpeedId>(DEFAULT_SPEED);
  const [opts, setOpts] = useState<BuildOptions>({ subtitles: true, onScreen: true, motion: true });
  const [narrations, setNarrations] = useState<Record<string, Narration>>({});
  const [job, setJob] = useState<{ progress: number; stage: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  // Playback position, tied to the recording it belongs to.
  const [clock, setClock] = useState({ key: "", t: 0 });

  // Restore the last session after hydration.
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
      const saved = JSON.parse(localStorage.getItem(SCRIPT_KEY) || "null") as ParsedScript | null;
      /* eslint-disable react-hooks/set-state-in-effect -- restore from localStorage after hydration */
      if (saved?.parts?.length) setScript(saved);
      if (last) {
        setImagesDir(last.imagesDir ?? "");
        if (last.partKey && saved?.parts.some((p) => p.key === last.partKey)) setPartKey(last.partKey);
        else if (saved?.parts.length) setPartKey(saved.parts[0].key);
        if (isVoice(last.voice)) setVoice(last.voice);
        if (isSpeed(last.rate)) setRate(last.rate);
        if (last.opts) setOpts((o) => ({ ...o, ...last.opts }));
      } else if (saved?.parts.length) setPartKey(saved.parts[0].key);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ imagesDir, partKey, voice, rate, opts }));
    } catch {}
  }, [imagesDir, partKey, voice, rate, opts]);

  const part = script?.parts.find((p) => p.key === partKey) ?? null;
  const narrationKey = part ? `${script?.file}|${part.key}|${voice}|${rate}` : "";
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
      try {
        localStorage.setItem(SCRIPT_KEY, JSON.stringify(parsed));
      } catch {}
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
        body: JSON.stringify({ shots: part.shots.map((s) => ({ n: s.n, narration: s.narration })), voice, rate }),
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
      <form onSubmit={build} className="max-w-3xl mx-auto px-6 py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">New video part</h1>
          <p className="text-muted text-sm mt-1">
            Point to the shot images, add the script PDF and pick a part. The narration is spoken shot by shot, so every image stays on
            screen exactly as long as its lines are read, and the subtitles use the script&apos;s own words.
          </p>
        </div>

        <div className="bg-raised rounded-xl p-5 space-y-5">
          <div>
            <Label hint="001.png, 002.png … (shot numbers)">1 · Shot images folder</Label>
            <PathField value={imagesDir} onChange={setImagesDir} placeholder="/Users/you/Videos/Part1/shots" prompt="Choose the shot images folder" />
          </div>

          <div>
            <Label hint={script ? `${script.parts.length} parts · ${totalShots} shots · ${script.pages} pages` : "PDF with NARRATION per shot"}>
              2 · Script
            </Label>
            <PdfDrop file={script?.file ?? null} reading={reading} onFile={readPdf} />
          </div>

          {script && (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
              <div>
                <Label>Part</Label>
                <select className={inputCls} value={partKey} onChange={(e) => setPartKey(e.target.value)} disabled={busy}>
                  {script.parts.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.title}
                      {p.name ? ` – ${p.name}` : ""}
                      {p.timing ? ` (${p.timing})` : ""} · {p.shots.length} shots
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Voice</Label>
                <select className={inputCls} value={voice} onChange={(e) => setVoice(e.target.value as VoiceId)} disabled={busy}>
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} — {v.hint}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Speed</Label>
                <Segmented value={rate} options={SPEEDS.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => !busy && setRate(v)} />
              </div>
            </div>
          )}

          {part && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                disabled={!!job || building}
                aria-label={playing ? "Pause" : "Play"}
                className="w-11 h-11 shrink-0 rounded-full bg-fg text-bg grid place-items-center hover:opacity-90 disabled:opacity-40"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                {job ? (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted">{job.stage}…</div>
                    <ProgressBar value={job.progress} />
                  </div>
                ) : narration ? (
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={narration.duration}
                      step={0.01}
                      value={Math.min(time, narration.duration)}
                      onChange={(e) => seek(Number(e.target.value))}
                      className="flex-1 accent-[var(--color-accent,#ff0033)]"
                    />
                    <span className="text-xs text-muted tabular-nums whitespace-nowrap">
                      {formatTime(time, false)} / {formatTime(narration.duration, false)}
                    </span>
                  </div>
                ) : (
                  <div className="text-sm text-muted">Press play to hear {part.title} read by {voiceLabel}.</div>
                )}
              </div>
              {narration && !job && (
                <a href={fileUrl(narration.audioPath, true)} className="text-xs text-link hover:underline whitespace-nowrap">
                  Download audio
                </a>
              )}
            </div>
          )}
        </div>

        {part && <NarrationBox part={part} narration={narration} time={time} playing={playing} onSeek={seek} />}

        {part && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle checked={opts.subtitles} onChange={(v) => setOpts((o) => ({ ...o, subtitles: v }))} label="Subtitles from the script" />
            <Toggle checked={opts.onScreen} onChange={(v) => setOpts((o) => ({ ...o, onScreen: v }))} label="On-screen text from the script" />
            <Toggle checked={opts.motion} onChange={(v) => setOpts((o) => ({ ...o, motion: v }))} label="Zoom motion from the script" />
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex items-center gap-4">
          <Button variant="primary" size="lg" disabled={busy || !imagesDir || !part}>
            {building ? (job ? "Making the narration…" : "Preparing timeline…") : "Build timeline"}
          </Button>
          <span className="text-xs text-muted">Each image runs from the start of its shot&apos;s narration to the start of the next.</span>
        </div>
      </form>
    </div>
  );
}

/** The selected part's narration, shot by shot, following the audio so you can check it matches the script. */
function NarrationBox({
  part,
  narration,
  time,
  playing,
  onSeek,
}: {
  part: ScriptPart;
  narration: Narration | null;
  time: number;
  playing: boolean;
  onSeek: (t: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const timed = useMemo(() => new Map(narration?.shots.map((s) => [s.n, s]) ?? []), [narration]);
  const active = narration?.shots.find((s) => time >= s.start && time < s.end)?.n ?? null;
  const activeCue = narration?.cues.find((c) => time >= c.start && time < c.end) ?? null;
  const words = part.shots.reduce((s, x) => s + spokenText(x.narration).split(" ").length, 0);

  // Keep the shot being read in view.
  useEffect(() => {
    if (!playing || active === null) return;
    const box = boxRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-shot="${active}"]`);
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: top - 12, behavior: "smooth" });
    }
  }, [active, playing]);

  return (
    <div>
      <Label hint={`${part.shots.length} shots · ${words} words${narration ? ` · ${formatTime(narration.duration, false)} spoken` : ""}`}>
        3 · Narration — {part.title}
        {part.name ? ` · ${part.name}` : ""}
      </Label>
      <div ref={boxRef} className="relative bg-raised rounded-xl max-h-[420px] overflow-auto divide-y divide-line">
        {part.shots.map((s) => {
          const t = timed.get(s.n);
          const isActive = active === s.n;
          return (
            <div
              key={s.n}
              data-shot={s.n}
              onClick={() => t && onSeek(t.start)}
              className={`px-4 py-3 flex gap-4 transition-colors ${t ? "cursor-pointer hover:bg-hover/50" : ""} ${
                isActive ? "bg-link/10 shadow-[inset_3px_0_0_var(--color-link,#3ea6ff)]" : ""
              }`}
            >
              <div className="w-20 shrink-0 text-xs tabular-nums">
                <div className={`font-semibold ${isActive ? "text-link" : ""}`}>SHOT {String(s.n).padStart(3, "0")}</div>
                <div className="text-muted">
                  {t ? `${formatTime(t.start, false).slice(0, -3)} · ${(t.end - t.start).toFixed(1)}s` : (s.time ?? "")}
                </div>
              </div>
              <div className="flex-1 min-w-0 text-sm leading-relaxed">
                {isActive && activeCue ? <Highlighted text={spokenText(s.narration)} cue={activeCue.text} /> : (
                  <div className="whitespace-pre-line">{s.narration}</div>
                )}
                {(s.visual || s.onScreen) && (
                  <div className="mt-1 text-xs text-muted line-clamp-2">
                    {s.onScreen && <span className="text-fg/80">“{s.onScreen}” · </span>}
                    {s.visual}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Highlighted({ text, cue }: { text: string; cue: string }) {
  const i = text.indexOf(cue);
  if (i < 0) return <div>{text}</div>;
  return (
    <div>
      <span className="text-muted">{text.slice(0, i)}</span>
      <mark className="bg-transparent text-fg font-semibold underline decoration-link decoration-2 underline-offset-4">{cue}</mark>
      <span>{text.slice(i + cue.length)}</span>
    </div>
  );
}

/** Drop or browse for the script PDF. */
function PdfDrop({ file, reading, onFile }: { file: string | null; reading: boolean; onFile: (f: File) => void }) {
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
      className={`rounded-lg border border-dashed px-4 py-4 flex items-center gap-3 transition-colors ${
        over ? "border-link bg-link/10" : "border-[#3f3f3f] bg-bg"
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="text-muted shrink-0" aria-hidden>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h8v2H8v-2z" />
      </svg>
      <div className="flex-1 min-w-0 text-sm">
        {reading ? (
          <span className="text-muted">Reading the script…</span>
        ) : file ? (
          <span className="font-medium truncate block">{file}</span>
        ) : (
          <span className="text-muted">Drop the script PDF here</span>
        )}
      </div>
      <Button type="button" size="sm" onClick={() => inputRef.current?.click()} disabled={reading}>
        {file ? "Replace…" : "Choose PDF…"}
      </Button>
    </div>
  );
}
