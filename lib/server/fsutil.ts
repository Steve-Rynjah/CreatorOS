import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"];
export const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aiff", ".aif"];
export const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".mkv", ".webm"];

export const CACHE_DIR = path.join(os.tmpdir(), "creatoros");

/** Accepts paths pasted from Finder/Terminal: quotes, escaped spaces, ~ */
export function normalizePath(input: string): string {
  let p = input.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }
  p = p.replace(/\\ /g, " ");
  if (p.startsWith("file://")) p = decodeURIComponent(p.slice(7));
  if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

export type NumberedFile = { name: string; path: string; index: number };

/**
 * Lists files in `dir` with one of `exts`, ordered by the number after `prefix`
 * (01, 2, 010 … or EP01 …). If no file uses the prefix, falls back to all files of
 * that type in natural order, and reports that via `usedPrefix: false`.
 */
export async function listNumbered(
  dir: string,
  prefix: string,
  exts: string[],
): Promise<{ files: NumberedFile[]; usedPrefix: boolean }> {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat) throw new Error(`Folder not found: ${dir}`);
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${dir}`);
  const entries = (await fs.readdir(dir)).filter(
    (n) => !n.startsWith(".") && exts.includes(path.extname(n).toLowerCase()),
  );
  const re = new RegExp(`^${prefix}[\\s_-]*(\\d+)`, "i");
  const matched = entries
    .map((name) => ({ name, m: re.exec(name) }))
    .filter((x) => x.m)
    .map((x) => ({ name: x.name, path: path.join(dir, x.name), index: parseInt(x.m![1], 10) }))
    .sort((a, b) => a.index - b.index || a.name.localeCompare(b.name));
  if (matched.length) return { files: matched, usedPrefix: true };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const all = entries
    .sort(collator.compare)
    .map((name, i) => ({ name, path: path.join(dir, name), index: i + 1 }));
  return { files: all, usedPrefix: false };
}

export function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".srt": "application/x-subrip",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/** Picks `base.ext`, or `base (2).ext` etc. if that already exists. */
export async function uniquePath(file: string): Promise<string> {
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  let candidate = file;
  for (let i = 2; ; i++) {
    const exists = await fs.stat(candidate).then(() => true, () => false);
    if (!exists) return candidate;
    candidate = `${base} (${i})${ext}`;
  }
}
