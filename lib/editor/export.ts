"use client";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { renderFrame, type Assets } from "./render";
import { totalDuration } from "./timing";
import type { Project } from "./types";

export type ExportSettings = {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  subtitles: boolean;
};

// H.264 High profile, from highest level down; the first one the browser accepts is used.
const AVC_CODECS = ["avc1.640034", "avc1.640033", "avc1.640032", "avc1.64002A", "avc1.640028"];

export async function pickCodec(s: Pick<ExportSettings, "width" | "height" | "fps" | "bitrate">) {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of AVC_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width: s.width,
      height: s.height,
      bitrate: s.bitrate,
      framerate: s.fps,
      avc: { format: "avc" },
    };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return config;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Renders every frame with the same renderer as the preview and encodes H.264 in the
 * browser (hardware accelerated where available). Returns a video-only MP4; the
 * server adds the voice-over.
 */
export async function renderVideo(
  project: Project,
  assets: Assets,
  s: ExportSettings,
  onProgress: (p: number, info: { frame: number; frames: number }) => void,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const config = await pickCodec(s);
  if (!config) {
    throw new Error(
      `This browser can't encode ${s.width}×${s.height} H.264. Use Chrome or Edge, or pick a lower resolution.`,
    );
  }
  const duration = totalDuration(project);
  const frames = Math.ceil(duration * s.fps);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: s.width, height: s.height, frameRate: s.fps },
    fastStart: "in-memory",
  });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e as Error),
  });
  encoder.configure({ ...config, latencyMode: "quality", bitrateMode: "variable" });

  const canvas = new OffscreenCanvas(s.width, s.height);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const keyEvery = s.fps * 2;

  try {
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
      if (failure) throw failure;
      renderFrame(ctx, s.width, s.height, i / s.fps, project, assets, { subtitles: s.subtitles });
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / s.fps),
        duration: Math.round(1e6 / s.fps),
      });
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      // Back-pressure: don't let the encoder queue grow unbounded.
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
      if (i % 10 === 0) {
        onProgress(i / frames, { frame: i, frames });
        await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
      }
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  muxer.finalize();
  onProgress(1, { frame: frames, frames });
  return muxer.target.buffer;
}
