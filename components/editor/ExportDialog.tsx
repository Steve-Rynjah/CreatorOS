"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Label, PathField, ProgressBar, Segmented, Toggle, inputCls } from "@/components/ui";
import { pickCodec, renderVideo } from "@/lib/editor/export";
import { fileUrl, type Assets } from "@/lib/editor/render";
import { player } from "@/lib/editor/player";
import { projectStore, updateProject, useStore } from "@/lib/editor/store";
import { toSrt } from "@/lib/editor/subtitles";
import { formatTime, totalDuration } from "@/lib/editor/timing";
import { downloadText } from "./SubtitleTab";

const RES = {
  "1080": { w: 1920, h: 1080, label: "1080p" },
  "1440": { w: 2560, h: 1440, label: "1440p" },
  "2160": { w: 3840, h: 2160, label: "4K" },
} as const;
type ResKey = keyof typeof RES;

const PREFS_KEY = "creatoros:export-prefs";

function parentDir(p: string) {
  const parts = p.replace(/\/+$/, "").split("/");
  parts.pop();
  return parts.join("/") || "/";
}

export function ExportDialog({ assets, onClose }: { assets: Assets; onClose: () => void }) {
  const p = useStore(projectStore, (s) => s)!;
  const [res, setRes] = useState<ResKey>("1080");
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState<"high" | "max">("high");
  const [name, setName] = useState("VIDEO01");
  const [outDir, setOutDir] = useState(() => parentDir(p.imagesDir) + "/Exports");
  const [status, setStatus] = useState<
    | { phase: "idle" }
    | { phase: "render"; progress: number; eta: string }
    | { phase: "save" }
    | { phase: "done"; output: string; seconds: number }
    | { phase: "error"; message: string }
  >({ phase: "idle" });
  const [supported, setSupported] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (prefs) {
        /* eslint-disable react-hooks/set-state-in-effect -- restore saved prefs after mount */
        if (prefs.res in RES) setRes(prefs.res);
        if (prefs.fps) setFps(prefs.fps);
        if (prefs.quality) setQuality(prefs.quality);
        if (prefs.outDir) setOutDir(prefs.outDir);
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {}
  }, []);

  const { w, h } = RES[res];
  const bitrate = Math.round(w * h * fps * (quality === "max" ? 0.4 : 0.26));

  useEffect(() => {
    let live = true;
    pickCodec({ width: w, height: h, fps, bitrate }).then((c) => live && setSupported(!!c));
    return () => {
      live = false;
    };
  }, [w, h, fps, bitrate]);

  const duration = totalDuration(p);
  const busy = status.phase === "render" || status.phase === "save";

  async function start() {
    player.pause();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ res, fps, quality, outDir }));
    const ac = new AbortController();
    abortRef.current = ac;
    const t0 = performance.now();
    setStatus({ phase: "render", progress: 0, eta: "" });
    try {
      const video = await renderVideo(
        p,
        assets,
        { width: w, height: h, fps, bitrate, subtitles: p.subtitle.enabled && p.cues.length > 0 },
        (progress) => {
          const el = (performance.now() - t0) / 1000;
          const eta = progress > 0.02 ? Math.max(0, el / progress - el) : 0;
          setStatus({ phase: "render", progress, eta: eta ? `${Math.ceil(eta)}s left` : "" });
        },
        ac.signal,
      );
      setStatus({ phase: "save" });
      const q = new URLSearchParams({ audio: p.audioMix, outDir, name, duration: String(duration) });
      const r = await fetch(`/api/export?${q}`, { method: "POST", body: video, signal: ac.signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setStatus({ phase: "done", output: j.output, seconds: (performance.now() - t0) / 1000 });
    } catch (e) {
      if ((e as Error).name === "AbortError") setStatus({ phase: "idle" });
      else setStatus({ phase: "error", message: (e as Error).message });
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-full max-w-lg bg-raised rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Export video</h2>
          <span className="text-sm text-muted font-mono">{formatTime(duration)}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Resolution</Label>
            <Segmented value={res} onChange={setRes} options={(Object.keys(RES) as ResKey[]).map((k) => ({ value: k, label: RES[k].label }))} />
          </div>
          <div>
            <Label>Frame rate</Label>
            <Segmented
              value={String(fps)}
              onChange={(v) => setFps(Number(v))}
              options={["24", "25", "30", "60"].map((v) => ({ value: v, label: v }))}
            />
          </div>
          <div>
            <Label hint={`${(bitrate / 1e6).toFixed(0)} Mbps`}>Quality</Label>
            <Segmented
              value={quality}
              onChange={setQuality}
              options={[
                { value: "high", label: "High" },
                { value: "max", label: "Maximum" },
              ]}
            />
          </div>
          <div>
            <Label>Subtitles</Label>
            <Toggle
              checked={p.subtitle.enabled}
              onChange={(v) => updateProject((s) => ({ ...s, subtitle: { ...s.subtitle, enabled: v } }))}
              label={<span className="text-sm">{p.cues.length ? "Burn into video" : "None yet"}</span>}
            />
          </div>
        </div>

        <div>
          <Label hint="Use VIDEO01, VIDEO02 … for merging later">File name</Label>
          <div className="flex items-center gap-2">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            <span className="text-sm text-muted">.mp4</span>
          </div>
        </div>
        <div>
          <Label>Save to folder</Label>
          <PathField value={outDir} onChange={setOutDir} prompt="Choose where to save the video" />
        </div>

        {supported === false && (
          <Alert tone="warn">
            This browser can&apos;t encode {RES[res].label} at {fps} fps. Use Chrome / Edge, or choose a lower setting.
          </Alert>
        )}

        {status.phase === "render" && (
          <div className="space-y-1.5">
            <ProgressBar value={status.progress} />
            <div className="flex justify-between text-xs text-muted">
              <span>Rendering frames… {Math.round(status.progress * 100)}%</span>
              <span>{status.eta}</span>
            </div>
          </div>
        )}
        {status.phase === "save" && <div className="text-sm text-muted">Adding voice-over and saving…</div>}
        {status.phase === "error" && <Alert tone="error">{status.message}</Alert>}
        {status.phase === "done" && (
          <Alert tone="ok">
            <div className="font-medium">Saved in {Math.round(status.seconds)}s</div>
            <div className="font-mono text-xs break-all mt-1 text-muted">{status.output}</div>
          </Alert>
        )}

        <div className="flex justify-end gap-2 pt-1">
          {status.phase === "done" ? (
            <>
              {p.cues.length > 0 && (
                <Button onClick={() => downloadText(`${name}.srt`, toSrt(p.cues))}>Download .srt</Button>
              )}
              <a href={fileUrl(status.output, true)}>
                <Button variant="primary">Download MP4</Button>
              </a>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : busy ? (
            <Button onClick={() => abortRef.current?.abort()}>Cancel</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={start} disabled={!supported || !name.trim() || !outDir.trim()}>
                Export {RES[res].label}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
