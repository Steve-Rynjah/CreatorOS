"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Label, PathField, ProgressBar, Toggle, inputCls, pollJob } from "@/components/ui";
import { fileUrl } from "@/lib/editor/render";
import { formatTime } from "@/lib/editor/timing";

type Part = {
  name: string;
  path: string;
  index: number;
  info: {
    duration: number;
    video?: { codec: string; width: number; height: number; fps: number };
    audio?: { codec: string; sampleRate: number };
  };
};
type Scan = { dir: string; parts: Part[]; usedPrefix: boolean; canCopy: boolean; reason?: string };

const LAST_KEY = "creatoros:last-merge-folder";

export function Merge() {
  const [dir, setDir] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [outName, setOutName] = useState("MERGED");
  const [reencode, setReencode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ progress: number; stage: string } | null>(null);
  const [result, setResult] = useState<{ output: string; mode: string; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const last = localStorage.getItem(LAST_KEY);
    if (last) setDir(last); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/merge/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      localStorage.setItem(LAST_KEY, dir);
      setScan(j);
      setExcluded([]);
    } catch (err) {
      setScan(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!scan) return;
    setError(null);
    setResult(null);
    setJob({ progress: 0, stage: "Starting" });
    try {
      const r = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: scan.dir, exclude: excluded, outName, reencode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setResult(await pollJob(j.jobId, setJob));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJob(null);
    }
  }

  const included = scan?.parts.filter((p) => !excluded.includes(p.name)) ?? [];
  const total = included.reduce((s, p) => s + p.info.duration, 0);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Merge video parts</h1>
          <p className="text-muted text-sm mt-1">Joins VIDEO01, VIDEO02, VIDEO03 … in order into one high-quality video.</p>
        </div>

        <form onSubmit={load} className="bg-raised rounded-xl p-5 space-y-3">
          <Label hint="VIDEO01.mp4, VIDEO02.mp4 …">Edited videos folder</Label>
          <PathField value={dir} onChange={setDir} placeholder="/Users/you/Videos/Exports" prompt="Choose the folder with your video parts" />
          <Button disabled={busy || !dir.trim()}>{busy ? "Reading…" : "Load videos"}</Button>
        </form>

        {error && <Alert tone="error">{error}</Alert>}

        {scan && (
          <>
            {!scan.usedPrefix && <Alert tone="warn">No VIDEO01, VIDEO02… names found — using alphabetical order.</Alert>}
            <div className="bg-raised rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted uppercase tracking-wide">
                  <tr className="border-b border-line">
                    <th className="w-10 py-2.5" />
                    <th className="text-left font-medium py-2.5">Part</th>
                    <th className="text-left font-medium">Duration</th>
                    <th className="text-left font-medium">Video</th>
                    <th className="text-left font-medium pr-4">Audio</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.parts.map((p) => {
                    const on = !excluded.includes(p.name);
                    return (
                      <tr key={p.path} className={`border-b border-line last:border-0 ${on ? "" : "opacity-40"}`}>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setExcluded((x) => (on ? [...x, p.name] : x.filter((n) => n !== p.name)))}
                            className="accent-[var(--accent)]"
                          />
                        </td>
                        <td className="py-2.5 font-medium">{p.name}</td>
                        <td className="font-mono text-xs">{formatTime(p.info.duration)}</td>
                        <td className="text-xs text-muted">
                          {p.info.video ? `${p.info.video.width}×${p.info.video.height} · ${Math.round(p.info.video.fps * 100) / 100}fps · ${p.info.video.codec}` : "—"}
                        </td>
                        <td className="text-xs text-muted pr-4">
                          {p.info.audio ? `${p.info.audio.codec} ${p.info.audio.sampleRate / 1000}kHz` : "no audio"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-xs text-muted">
                    <td />
                    <td className="py-2.5">{included.length} parts</td>
                    <td className="font-mono text-fg">{formatTime(total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {scan.canCopy ? (
              <Alert tone="ok">All parts match — they&apos;ll be joined losslessly (no re-encode, original quality, very fast).</Alert>
            ) : (
              <Alert tone="warn">
                Parts have different formats ({scan.reason}). They&apos;ll be re-encoded to match the first part at high
                quality (H.264 CRF 16, AAC 320k). This takes longer.
              </Alert>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <div className="w-56">
                <Label>Output name</Label>
                <div className="flex items-center gap-2">
                  <input className={inputCls} value={outName} onChange={(e) => setOutName(e.target.value)} />
                  <span className="text-sm text-muted">.mp4</span>
                </div>
              </div>
              {scan.canCopy && <Toggle checked={reencode} onChange={setReencode} label={<span className="text-muted">Force re-encode</span>} />}
              <Button variant="primary" size="lg" className="ml-auto" disabled={!!job || included.length < 2 || !outName.trim()} onClick={merge}>
                {job ? "Merging…" : "Merge"}
              </Button>
            </div>

            {job && (
              <div className="space-y-1.5">
                <ProgressBar value={job.progress} />
                <div className="flex justify-between text-xs text-muted">
                  <span>{job.stage}</span>
                  <span>{Math.round(job.progress * 100)}%</span>
                </div>
              </div>
            )}

            {result && (
              <div className="bg-raised rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      Merged · {formatTime(result.duration)} · {result.mode === "copy" ? "lossless" : "re-encoded"}
                    </div>
                    <div className="font-mono text-xs text-muted break-all mt-1">{result.output}</div>
                  </div>
                  <a href={fileUrl(result.output, true)} className="shrink-0">
                    <Button variant="primary">Download</Button>
                  </a>
                </div>
                <video src={fileUrl(result.output)} controls className="w-full rounded-lg bg-black aspect-video" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
