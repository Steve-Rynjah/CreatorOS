"use client";
import { useEffect, useState, type DragEvent } from "react";
import { FolderCard } from "@/components/editor/Setup";
import type { ShortImage } from "@/lib/shorts/types";

export type ImageFolder = { dir: string; images?: ShortImage[]; error?: string; copying?: boolean };

const IS_IMAGE = /^[^.].*\.(jpe?g|png|webp|bmp|gif)$/i;

function readDirectory(dir: FileSystemDirectoryEntry) {
  return new Promise<FileSystemEntry[]>((resolve, reject) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    // readEntries hands the folder over in batches, and an empty batch means the end.
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

const entryFile = (e: FileSystemFileEntry) => new Promise<File>((resolve, reject) => e.file(resolve, reject));

/** The images in what was dropped: the contents of a folder, or loose image files. */
async function droppedImages(entries: FileSystemEntry[]) {
  const listed = await Promise.all(entries.map((e) => (e.isDirectory ? readDirectory(e as FileSystemDirectoryEntry) : [e])));
  const files = listed.flat().filter((e): e is FileSystemFileEntry => e.isFile && IS_IMAGE.test(e.name));
  return Promise.all(files.map(entryFile));
}

/** One Short's folder of vertical images: drop it here, click to choose it, or paste its path. */
export function ImageFolderBox({
  n,
  folder,
  onDir,
  onScanned,
  onClear,
  onCopying,
}: {
  n: 1 | 2 | 3;
  folder: ImageFolder;
  onDir: (dir: string) => void;
  onScanned: (dir: string, result: { images: ShortImage[] } | { error: string }) => void;
  onClear: () => void;
  onCopying: (copying: boolean) => void;
}) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    const dir = folder.dir.trim();
    if (!dir) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/shorts/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        if (live) onScanned(j.dir, { images: j.images });
      } catch (e) {
        if (live) onScanned(dir, { error: (e as Error).message });
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [folder.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  async function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (folder.copying) return;
    // The drop's items are only readable during the event, so take the entries before any await.
    const entries = Array.from(e.dataTransfer.items)
      .map((i) => i.webkitGetAsEntry())
      .filter((x): x is FileSystemEntry => !!x);
    const name = entries.find((x) => x.isDirectory)?.name ?? "Dropped images";
    onCopying(true);
    try {
      const files = await droppedImages(entries);
      if (!files.length) throw new Error("There are no images in what you dropped.");
      const target = `shorts-images/${Date.now()}-${n}/${name}`;
      let dir = "";
      for (const file of files) {
        const r = await fetch(`/api/upload?${new URLSearchParams({ kind: "image", name: file.name, folder: target })}`, { method: "POST", body: file });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        dir = j.dir;
      }
      onDir(dir);
    } catch (err) {
      onScanned("", { error: (err as Error).message });
    } finally {
      onCopying(false);
    }
  }

  const count = folder.images?.length ?? 0;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`rounded-2xl transition-shadow ${over ? "ring-2 ring-link" : ""}`}
    >
      <FolderCard
        value={folder.dir}
        onChange={onDir}
        onClear={onClear}
        title={folder.copying ? "Copying images…" : `Drop Short ${n}'s folder here`}
        prefix={`V${n}`}
        hint="Or click to choose it: 01.png, 02.png…"
        prompt={`Choose the images folder for Short ${n}`}
        ok={!!folder.images}
        summary={
          folder.error ? (
            <p className="text-xs text-error break-words">{folder.error}</p>
          ) : folder.images ? (
            <p className="text-xs text-success tabular-nums">
              {count} image{count === 1 ? "" : "s"}
            </p>
          ) : null
        }
      />
    </div>
  );
}
