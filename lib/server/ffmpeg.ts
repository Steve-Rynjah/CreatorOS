import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import ffmpegStatic from "ffmpeg-static";

/** Resolve the ffmpeg binary: FFMPEG_PATH env > bundled ffmpeg-static > system ffmpeg. */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  return "ffmpeg";
}

export type RunOptions = {
  /** Total expected output duration (s), used to compute progress 0..1. */
  duration?: number;
  onProgress?: (p: number) => void;
  /** Collect raw stdout bytes (e.g. PCM decode). */
  captureStdout?: boolean;
  /** Working directory, so filter arguments can use short relative paths. */
  cwd?: string;
};

export function runFfmpeg(
  args: string[],
  opts: RunOptions = {},
): Promise<{ stderr: string; stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ["-hide_banner", ...args], opts.cwd ? { cwd: opts.cwd } : undefined);
    let stderr = "";
    const out: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => {
      if (opts.captureStdout) out.push(d);
    });
    proc.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      if (opts.duration && opts.onProgress) {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
        if (m) {
          const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
          opts.onProgress(Math.min(1, t / opts.duration));
        }
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stderr, stdout: Buffer.concat(out) });
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

export type MediaInfo = {
  duration: number;
  video?: { codec: string; width: number; height: number; fps: number; pixFmt: string };
  audio?: { codec: string; sampleRate: number; channels: string };
};

/** Probe a media file by parsing `ffmpeg -i` output (avoids needing ffprobe). */
export async function probe(file: string): Promise<MediaInfo> {
  let stderr = "";
  try {
    // ffmpeg -i with no output always exits 1; we only need its stderr.
    await runFfmpeg(["-i", file]);
  } catch (e) {
    stderr = String((e as Error).message);
  }
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!d) throw new Error(`Could not read media file: ${file}`);
  const info: MediaInfo = { duration: +d[1] * 3600 + +d[2] * 60 + +d[3] };
  const v = /Stream #\d+:\d+.*?: Video: (\w+)[^,]*,\s*(\w+)[^,]*?(?:\([^)]*\))?,\s*(\d+)x(\d+)[^\n]*?(?:,\s*([\d.]+)\s*fps)?/.exec(stderr);
  if (v) {
    const fps = /,\s*([\d.]+)\s*fps/.exec(v[0]);
    info.video = {
      codec: v[1],
      pixFmt: v[2],
      width: +v[3],
      height: +v[4],
      fps: fps ? +fps[1] : 30,
    };
  }
  const a = /Stream #\d+:\d+.*?: Audio: (\w+)[^,]*,\s*(\d+) Hz,\s*([\w.]+)/.exec(stderr);
  if (a) info.audio = { codec: a[1], sampleRate: +a[2], channels: a[3] };
  return info;
}

/** Decode audio to mono PCM float32 at the given sample rate. */
export async function decodePcm(file: string, sampleRate: number): Promise<Float32Array> {
  const { stdout } = await runFfmpeg(
    ["-i", file, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "pipe:1"],
    { captureStdout: true },
  );
  const copy = new Uint8Array(stdout.byteLength);
  copy.set(stdout);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}
