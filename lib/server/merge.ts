import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MediaInfo, probe, runFfmpeg } from "./ffmpeg";
import { CACHE_DIR, VIDEO_EXT, ensureDir, listNumbered, uniquePath } from "./fsutil";

export type PartInfo = { name: string; path: string; index: number; info: MediaInfo };

export async function scanParts(dir: string) {
  const { files, usedPrefix } = await listNumbered(dir, "VIDEO", VIDEO_EXT);
  // Don't re-merge an earlier merge output.
  const parts = files.filter((f) => !/^MERGED/i.test(f.name));
  const out: PartInfo[] = [];
  for (const f of parts) out.push({ ...f, info: await probe(f.path) });
  return { parts: out, usedPrefix, ...compatibility(out) };
}

/** Parts can be joined losslessly (stream copy) only if every stream matches. */
export function compatibility(parts: PartInfo[]): { canCopy: boolean; reason?: string } {
  if (parts.length < 2) return { canCopy: true };
  const sig = (p: PartInfo) => {
    const v = p.info.video;
    const a = p.info.audio;
    return [
      v ? `${v.codec} ${v.width}x${v.height} ${v.pixFmt} ${Math.round(v.fps * 100) / 100}fps` : "no video",
      a ? `${a.codec} ${a.sampleRate}Hz ${a.channels}` : "no audio",
    ].join(", ");
  };
  const first = sig(parts[0]);
  const diff = parts.find((p) => sig(p) !== first);
  if (diff) return { canCopy: false, reason: `${diff.name} (${sig(diff)}) differs from ${parts[0].name} (${first})` };
  return { canCopy: true };
}

export async function mergeParts(
  parts: PartInfo[],
  outDir: string,
  outName: string,
  forceReencode: boolean,
  update: (patch: { stage?: string; progress?: number }) => void,
): Promise<{ output: string; mode: "copy" | "reencode"; duration: number }> {
  if (parts.length < 2) throw new Error("Need at least 2 videos to merge.");
  await ensureDir(outDir);
  const output = await uniquePath(
    path.join(outDir, `${outName.replace(/[\\/:*?"<>|]/g, "_").replace(/\.mp4$/i, "")}.mp4`),
  );
  const total = parts.reduce((s, p) => s + p.info.duration, 0);
  const { canCopy } = compatibility(parts);

  if (canCopy && !forceReencode) {
    update({ stage: "Joining (lossless, no re-encode)" });
    await ensureDir(CACHE_DIR);
    const list = path.join(CACHE_DIR, `concat-${randomUUID()}.txt`);
    await fs.writeFile(list, parts.map((p) => `file '${p.path.replace(/'/g, "'\\''")}'`).join("\n"));
    try {
      await runFfmpeg(
        ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output],
        { duration: total, onProgress: (progress) => update({ progress }) },
      );
    } finally {
      fs.unlink(list).catch(() => {});
    }
    return { output, mode: "copy", duration: total };
  }

  // Re-encode everything to the first part's resolution/fps at high quality.
  update({ stage: "Re-encoding to a common format (high quality)" });
  const v0 = parts.find((p) => p.info.video)?.info.video;
  const W = v0?.width ?? 1920;
  const H = v0?.height ?? 1080;
  const fps = v0?.fps && v0.fps > 0 ? v0.fps : 30;
  const inputs: string[] = [];
  const filters: string[] = [];
  let idx = 0;
  const labels: string[] = [];
  for (const p of parts) {
    inputs.push("-i", p.path);
    const vi = idx++;
    let audioLabel: string;
    if (p.info.audio) {
      audioLabel = `${vi}:a`;
    } else {
      inputs.push("-f", "lavfi", "-t", p.info.duration.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
      audioLabel = `${idx++}:a`;
    }
    filters.push(
      `[${vi}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${vi}]`,
      `[${audioLabel}]aresample=48000,aformat=channel_layouts=stereo[a${vi}]`,
    );
    labels.push(`[v${vi}][a${vi}]`);
  }
  filters.push(`${labels.join("")}concat=n=${parts.length}:v=1:a=1[v][a]`);
  await runFfmpeg(
    [
      "-y",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "16",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "320k",
      "-movflags", "+faststart",
      output,
    ],
    { duration: total, onProgress: (progress) => update({ progress }) },
  );
  return { output, mode: "reencode", duration: total };
}
