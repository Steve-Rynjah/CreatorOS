import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { decodePcm, probe, runFfmpeg } from "@/lib/server/ffmpeg";
import {
  AUDIO_EXT,
  CACHE_DIR,
  IMAGE_EXT,
  ensureDir,
  listNumbered,
  normalizePath,
} from "@/lib/server/fsutil";

const PEAKS_PER_SEC = 50;

/** Scans the image + audio folders and prepares one continuous voice-over track. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { imagesDir: string; audioDir?: string; audioFile?: string };
    if (!body.imagesDir?.trim() || !(body.audioDir?.trim() || body.audioFile?.trim())) {
      return Response.json({ error: "Images folder and a voice-over are required." }, { status: 400 });
    }
    const imagesDir = normalizePath(body.imagesDir);
    const audioFile = body.audioFile ? normalizePath(body.audioFile) : null;
    const audioDir = audioFile ?? normalizePath(body.audioDir!);
    const warnings: string[] = [];

    const imgs = await listNumbered(imagesDir, "(?:EP|SHOT|SCENE|IMG|IMAGE)?", IMAGE_EXT);
    if (!imgs.files.length) throw new Error(`No images found in ${imagesDir}`);
    if (!imgs.usedPrefix) warnings.push("No numbered names (01, 02, 03…) found — images are in alphabetical order.");

    let auds: Awaited<ReturnType<typeof listNumbered>>;
    if (audioFile) {
      const ok = await fs.stat(audioFile).then((s) => s.isFile(), () => false);
      if (!ok) throw new Error("The voice-over file is no longer available — please add it again.");
      auds = { files: [{ name: path.basename(audioFile).replace(/^[0-9a-f]{12}-/, ""), path: audioFile, index: 1 }], usedPrefix: true };
    } else {
      auds = await listNumbered(audioDir, "AU", AUDIO_EXT);
      if (!auds.files.length) throw new Error(`No audio files found in ${audioDir}`);
      if (!auds.usedPrefix) warnings.push("No AU01, AU02… names found — audio files are in alphabetical order.");
    }

    // Number gaps (03 missing etc.) are easy to miss, so call them out.
    for (const [label, list] of [["", imgs.files], ["AU", auds.files]] as const) {
      const nums = list.map((f) => f.index);
      const missing: number[] = [];
      for (let n = nums[0]; n < nums[nums.length - 1]; n++) if (!nums.includes(n)) missing.push(n);
      if (missing.length && missing.length < 50)
        warnings.push(`Missing ${missing.map((n) => label + String(n).padStart(2, "0")).join(", ")}.`);
    }

    // Per-file durations (for timeline labels).
    const audio = [] as { name: string; path: string; start: number; duration: number }[];
    let t = 0;
    for (const f of auds.files) {
      const info = await probe(f.path);
      audio.push({ name: f.name, path: f.path, start: t, duration: info.duration });
      t += info.duration;
    }

    // One continuous WAV for preview + export, cached by file identity.
    const stats = await Promise.all(auds.files.map((f) => fs.stat(f.path)));
    const key = createHash("sha1")
      .update(auds.files.map((f, i) => `${f.path}|${stats[i].size}|${stats[i].mtimeMs}`).join("\n"))
      .digest("hex")
      .slice(0, 16);
    await ensureDir(CACHE_DIR);
    const mixPath = path.join(CACHE_DIR, `voice-${key}.wav`);
    const exists = await fs.stat(mixPath).then(() => true, () => false);
    if (!exists) {
      const inputs = auds.files.flatMap((f) => ["-i", f.path]);
      const n = auds.files.length;
      const filter =
        auds.files.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(";") +
        ";" +
        auds.files.map((_, i) => `[a${i}]`).join("") +
        `concat=n=${n}:v=0:a=1[out]`;
      const tmp = mixPath + ".tmp.wav";
      await runFfmpeg(["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "pcm_s16le", tmp]);
      await fs.rename(tmp, mixPath);
    }
    const duration = (await probe(mixPath)).duration;

    // Waveform peaks for the timeline.
    const pcm = await decodePcm(mixPath, 8000);
    const block = Math.floor(8000 / PEAKS_PER_SEC);
    const peaks: number[] = [];
    for (let i = 0; i < pcm.length; i += block) {
      let m = 0;
      const end = Math.min(pcm.length, i + block);
      for (let j = i; j < end; j++) {
        const v = Math.abs(pcm[j]);
        if (v > m) m = v;
      }
      peaks.push(Math.round(m * 1000) / 1000);
    }

    return Response.json({
      imagesDir,
      audioDir,
      images: imgs.files,
      audio,
      audioMix: mixPath,
      duration,
      peaks,
      peaksPerSec: PEAKS_PER_SEC,
      warnings,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
