import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { AUDIO_FADE, BRAND, CAPTION, CENTER_X, END_TAG, FRAME, HOOK, IMAGE_ZOOM, VIDEO, assFontSize, gradientAlpha, specLength } from "@/lib/shorts/layout";
import type { RenderSpec } from "@/lib/shorts/types";
import { probe, runFfmpeg } from "./ffmpeg";
import { CACHE_DIR, ensureDir } from "./fsutil";

export const SHORTS_DIR = path.join(CACHE_DIR, "shorts");
/** Anton + Montserrat Black, bundled with the app (Google Fonts, OFL). */
const FONTS_SRC = path.join(process.cwd(), "assets", "fonts");
const FILES = new Set(["short_1_hook.mp4", "short_2.mp4", "short_3.mp4"]);

// ───────────────────────── ASS subtitles (libass) ─────────────────────────

/** "#FFD23F" → "&H3FD2FF&" (ASS is blue-green-red). */
const assColor = (hex: string) => `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase();
const YELLOW = assColor(BRAND.yellow);
const WHITE = assColor(BRAND.white);

function assTime(t: number) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** User text can't open override blocks or line breaks. */
const assText = (t: string) => t.replace(/[{}\\]/g, "").replace(/\s+/g, " ");

/** Pill outline as an ASS vector drawing, w×h with its top-left at 0,0. */
function pill(w: number, h: number) {
  const r = h / 2;
  const k = 0.5523 * r;
  const f = (n: number) => Math.round(n * 10) / 10;
  return [
    `m ${f(r)} 0`,
    `l ${f(w - r)} 0`,
    `b ${f(w - r + k)} 0 ${f(w)} ${f(r - k)} ${f(w)} ${f(r)}`,
    `b ${f(w)} ${f(r + k)} ${f(w - r + k)} ${f(h)} ${f(w - r)} ${f(h)}`,
    `l ${f(r)} ${f(h)}`,
    `b ${f(r - k)} ${f(h)} 0 ${f(r + k)} 0 ${f(r)}`,
    `b 0 ${f(r - k)} ${f(r - k)} 0 ${f(r)} 0`,
  ].join(" ");
}

export function buildAss(spec: RenderSpec): string {
  const dur = specLength(spec);
  const ev: string[] = [];
  const line = (layer: number, a: number, b: number, style: string, text: string) =>
    ev.push(`Dialogue: ${layer},${assTime(a)},${assTime(b)},${style},,0,0,0,,${text}`);

  // Hook title: one event per line so the line spacing matches the preview exactly.
  if (spec.hook) {
    const { size, lines } = spec.hook;
    lines.forEach((words, i) => {
      const y = HOOK.centerY + (i - (lines.length - 1) / 2) * size * HOOK.lineHeight;
      const text = words.map((w) => (w.key ? `{\\1c${YELLOW}}${assText(w.text)}{\\1c${WHITE}}` : assText(w.text))).join(" ");
      line(2, 0, dur, "Hook", `{\\an5\\pos(${CENTER_X},${Math.round(y)})\\fs${assFontSize(size, "anton")}}${text}`);
    });
  }

  // Captions: one event per spoken word; that word is yellow and pops 100% → 110% → 100%.
  for (const c of spec.captions) {
    c.words.forEach((w, k) => {
      const a = k === 0 ? c.start : w.start;
      const b = k + 1 < c.words.length ? c.words[k + 1].start : c.end;
      if (b - a < 0.01) return;
      const text = c.words
        .map((x, j) =>
          j === k
            ? `{\\1c${YELLOW}\\t(0,70,\\fscx${CAPTION.pop * 100}\\fscy${CAPTION.pop * 100})\\t(70,150,\\fscx100\\fscy100)}${assText(x.text)}{\\1c${WHITE}\\fscx100\\fscy100}`
            : assText(x.text),
        )
        .join(" ");
      line(1, a, b, "Caption", `{\\an5\\pos(${CENTER_X},${CAPTION.centerY})\\fs${assFontSize(c.size, "montserrat")}}${text}`);
    });
  }

  // End tag: a yellow-outlined pill for as long as the call-to-action is spoken.
  if (spec.endTag) {
    const a = spec.endTag.at;
    const w = spec.endTag.width;
    const x = Math.round(CENTER_X - w / 2);
    const y = Math.round(END_TAG.centerY - END_TAG.height / 2);
    line(3, a, dur, "Tag", `{\\an7\\pos(${x},${y})\\p1\\1c${assColor(BRAND.black)}\\1a&H30&\\3c${YELLOW}\\bord${END_TAG.outline}\\shad0\\fad(150,0)}${pill(w, END_TAG.height)}{\\p0}`);
    line(4, a, dur, "Tag", `{\\an5\\pos(${CENTER_X},${END_TAG.centerY})\\fad(150,0)}${END_TAG.text} {\\fscx150\\fscy150}${END_TAG.arrow}`);
  }

  const fmt =
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${FRAME.w}`,
    `PlayResY: ${FRAME.h}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    fmt,
    `Style: Hook,Anton,${assFontSize(HOOK.size, "anton")},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,${HOOK.outline},3,5,0,0,0,1`,
    `Style: Caption,Montserrat Black,${assFontSize(CAPTION.size, "montserrat")},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${CAPTION.outline},${CAPTION.shadow},5,0,0,0,1`,
    `Style: Tag,Montserrat Black,${assFontSize(END_TAG.size, "montserrat")},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...ev,
    "",
  ].join("\n");
}

// ───────────────────────── Render ─────────────────────────

/** Copies the bundled fonts next to the renders, so ffmpeg can find them by a short relative path. */
async function ensureFonts() {
  const dest = path.join(SHORTS_DIR, "fonts");
  await ensureDir(dest);
  for (const name of await fs.readdir(FONTS_SRC)) {
    if (!/\.(ttf|otf)$/i.test(name)) continue;
    const a = await fs.stat(path.join(FONTS_SRC, name));
    const b = await fs.stat(path.join(dest, name)).catch(() => null);
    if (!b || b.size !== a.size) await fs.copyFile(path.join(FONTS_SRC, name), path.join(dest, name));
  }
}

/** The dark gradients as a transparent 1080×1920 PNG, cached next to the renders. */
async function ensureGradient(hook: boolean) {
  const out = path.join(SHORTS_DIR, `gradient-${hook ? "both" : "bottom"}-v1.png`);
  if (await fs.stat(out).catch(() => null)) return out;
  // One column of black with the alpha ramp (luma, alpha pairs), stretched to the frame's width.
  const column = Buffer.alloc(FRAME.h * 2);
  for (let y = 0; y < FRAME.h; y++) column[y * 2 + 1] = Math.round(gradientAlpha(y, hook) * 255);
  const raw = `${out}.raw`;
  await fs.writeFile(raw, column);
  try {
    await runFfmpeg(["-y", "-f", "rawvideo", "-pix_fmt", "ya8", "-s", `1x${FRAME.h}`, "-i", raw, "-vf", `scale=${FRAME.w}:${FRAME.h}:flags=neighbor`, "-frames:v", "1", out]);
  } finally {
    fs.unlink(raw).catch(() => {});
  }
  return out;
}

/** Gated loudness in LUFS of an input (given as ffmpeg input arguments), or null if it can't be read. */
async function loudness(input: string[]) {
  const { stderr } = await runFfmpeg(["-nostats", ...input, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
  const hits = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)];
  const v = Number(hits[hits.length - 1]?.[1]);
  return Number.isFinite(v) && v > -70 ? v : null;
}

/** Internal resolution of the zoom, so its slow movement doesn't step from pixel to pixel. */
const ZOOM_SCALE = 3;

/** A full-screen image for N frames: covers the frame, then zooms about its centre by IMAGE_ZOOM. */
function imageFilter(input: number, frames: number, motion: RenderSpec["shots"][number]["motion"], label: string) {
  const w = FRAME.w * ZOOM_SCALE;
  const h = FRAME.h * ZOOM_SCALE;
  const p = `on/${Math.max(1, frames - 1)}`;
  const z = motion === "zoom-in" ? `1+${IMAGE_ZOOM}*${p}` : `1+${IMAGE_ZOOM}*(1-${p})`;
  return (
    `[${input}:v]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1,` +
    `zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${FRAME.w}x${FRAME.h}:fps=${FRAME.fps},` +
    `format=yuv420p,setsar=1,setpts=PTS-STARTPTS[${label}]`
  );
}

/**
 * One Short, 1080×1920 at 30 fps, H.264 + AAC. Shots with a vertical image are full-screen with a
 * slow zoom; the rest are the bottom of the source cropped off (old subtitles), a 4:5 centre crop
 * at 1080×1350 over a blurred, 40%-darkened fill. The call-to-action follows the clip's last
 * sentence. Hook title, captions and end tag are burned in by libass.
 */
export async function renderShort(spec: RenderSpec, onProgress: (p: number) => void): Promise<{ path: string; duration: number }> {
  if (!/^[a-z0-9-]{1,80}$/.test(spec.projectId)) throw new Error("Bad project id.");
  if (!FILES.has(spec.file)) throw new Error("Bad output name.");
  const dur = spec.end - spec.start;
  if (!(dur > 1 && dur < 180)) throw new Error("A Short must be between 1 s and 3 min long.");
  const hold = Math.min(20, Math.max(0, Number(spec.hold) || 0));
  const total = dur + hold;
  const crop = Math.min(0.4, Math.max(0, spec.crop));
  const info = await probe(spec.video);
  if (!info.video) throw new Error("That file has no video stream.");
  for (const s of spec.shots) {
    if (!(await fs.stat(s.image).catch(() => null))?.isFile()) throw new Error(`The image ${path.basename(s.image)} is no longer there. Choose the Shorts folder again.`);
  }
  if (spec.cta && !(await fs.stat(spec.cta.audio!).catch(() => null))?.isFile()) throw new Error("The call-to-action audio is missing. Render again.");

  await ensureFonts();
  const dir = path.join(SHORTS_DIR, spec.projectId);
  await ensureDir(dir);
  const assName = spec.file.replace(/\.mp4$/, ".ass");
  await fs.writeFile(path.join(dir, assName), buildAss(spec), "utf8");
  const out = path.join(dir, spec.file);
  const tmp = path.join(dir, `.${spec.file}.tmp.mp4`);

  // ── Inputs: 0 is always the long video. ──
  const seek = ["-ss", spec.start.toFixed(3), "-t", dur.toFixed(3), "-i", spec.video];
  const inputs = [...seek];
  let next = 1;
  const addInput = (...args: string[]) => {
    inputs.push(...args);
    return next++;
  };

  // ── Picture: the Short cut into frame-exact pieces, each an image or the 4:5 layout. ──
  const frameAt = (t: number) => Math.round(t * FRAME.fps);
  const totalFrames = Math.max(1, frameAt(total));
  type Piece = { a: number; b: number; shot?: RenderSpec["shots"][number] };
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const shot of spec.shots) {
    const a = Math.max(cursor, frameAt(shot.from));
    const b = Math.min(totalFrames, frameAt(shot.to));
    if (b <= a) continue;
    if (a > cursor) pieces.push({ a: cursor, b: a });
    pieces.push({ a, b, shot });
    cursor = b;
  }
  if (cursor < totalFrames) pieces.push({ a: cursor, b: totalFrames });

  const layoutPieces = pieces.filter((p) => !p.shot);
  const video: string[] = [];
  if (layoutPieces.length) {
    const keep = (1 - crop).toFixed(4);
    const freeze = hold > 0 ? `,tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}` : "";
    const outs = layoutPieces.map((_, k) => `[lay${k}]`).join("");
    video.push(
      // Cut the old subtitles off the bottom first, so neither layer shows them; freeze the last frame under the call-to-action.
      `[0:v]setpts=PTS-STARTPTS,fps=${FRAME.fps},setsar=1,crop=iw:trunc(ih*${keep}/2)*2:0:0${freeze},split=2[bgsrc][fgsrc]`,
      // Blur a small copy (fast), scale it back up, darken it 40%.
      `[bgsrc]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=14,scale=${FRAME.w}:${FRAME.h},drawbox=x=0:y=0:w=iw:h=ih:color=black@0.4:t=fill[bg]`,
      // Main video: 4:5 centre crop, 1080×1350.
      `[fgsrc]crop=trunc(min(iw\\,ih*${VIDEO.aspect})/2)*2:ih:(iw-ow)/2:0,scale=${VIDEO.w}:${VIDEO.h}[fg]`,
      `[bg][fg]overlay=x=0:y=${VIDEO.top},format=yuv420p,setsar=1,split=${layoutPieces.length}${outs}`,
    );
  }
  let laid = 0;
  pieces.forEach((p, k) => {
    if (p.shot) video.push(imageFilter(addInput("-i", p.shot.image), p.b - p.a, p.shot.motion, `p${k}`));
    else video.push(`[lay${laid++}]trim=start_frame=${p.a}:end_frame=${p.b},setpts=PTS-STARTPTS[p${k}]`);
  });
  video.push(`${pieces.map((_, k) => `[p${k}]`).join("")}concat=n=${pieces.length}:v=1:a=0[joined]`);

  // The gradients sit only on the full-screen images, under the text.
  let base = "joined";
  const imagePieces = pieces.filter((p) => p.shot);
  if (imagePieces.length) {
    const g = addInput("-i", await ensureGradient(!!spec.hook));
    const on = imagePieces.map((p) => `between(n,${p.a},${p.b - 1})`).join("+");
    video.push(`[${g}:v]format=rgba[grad]`, `[joined][grad]overlay=enable='${on}':eof_action=repeat[shaded]`);
    base = "shaded";
  }
  video.push(`[${base}]ass=filename=${spec.projectId}/${assName}:fontsdir=fonts,setsar=1,format=yuv420p[v]`);

  // ── Sound: the clip's own audio, then the spoken line at the voice's level, then the closing fade. ──
  const audioIn = info.audio ? "[0:a]" : `[${addInput("-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo")}:a]`;
  const stereo = "aresample=48000,aformat=channel_layouts=stereo";
  const clipAudio = `${audioIn}asetpts=PTS-STARTPTS,${stereo},afade=t=in:st=0:d=${AUDIO_FADE.in},afade=t=out:st=${(dur - AUDIO_FADE.out).toFixed(3)}:d=${AUDIO_FADE.out},apad=whole_dur=${dur.toFixed(3)},atrim=0:${dur.toFixed(3)}`;
  const audio: string[] = [];
  if (spec.cta) {
    const [clipLevel, lineLevel] = await Promise.all([info.audio ? loudness(seek) : null, loudness(["-i", spec.cta.audio!])]);
    const gain = clipLevel !== null && lineLevel !== null ? Math.max(-10, Math.min(10, clipLevel - lineLevel)) : 0;
    const line = addInput("-i", spec.cta.audio!);
    audio.push(
      `${clipAudio}[clip]`,
      `[${line}:a]asetpts=PTS-STARTPTS,${stereo},volume=${gain.toFixed(2)}dB[line]`,
      `[clip][line]concat=n=2:v=0:a=1,afade=t=out:st=${Math.max(0, total - AUDIO_FADE.end).toFixed(3)}:d=${AUDIO_FADE.end},apad=whole_dur=${total.toFixed(3)}[a]`,
    );
  } else {
    audio.push(`${clipAudio},apad=whole_dur=${total.toFixed(3)}[a]`);
  }

  try {
    await runFfmpeg(
      [
        "-y",
        ...inputs,
        "-filter_complex", [...video, ...audio].join(";"),
        "-map", "[v]",
        "-map", "[a]",
        "-t", total.toFixed(3),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "19",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-r", String(FRAME.fps),
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        tmp,
      ],
      { duration: total, onProgress, cwd: SHORTS_DIR },
    );
    await fs.rename(tmp, out);
  } catch (e) {
    fs.unlink(tmp).catch(() => {});
    throw e;
  }
  return { path: out, duration: total };
}
