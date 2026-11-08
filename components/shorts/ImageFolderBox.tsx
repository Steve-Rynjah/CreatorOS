"use client";
import { useEffect } from "react";
import { FolderCard } from "@/components/editor/Setup";
import type { ShortImage } from "@/lib/shorts/types";

export type ImageFolder = { dir: string; images?: ShortImage[]; error?: string };

/** One Short's folder of vertical images. Reads the folder shortly after it is chosen or typed. */
export function ImageFolderBox({
  n,
  folder,
  onDir,
  onScanned,
  onClear,
}: {
  n: 1 | 2 | 3;
  folder: ImageFolder;
  onDir: (dir: string) => void;
  onScanned: (dir: string, result: { images: ShortImage[] } | { error: string }) => void;
  onClear: () => void;
}) {
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

  const count = folder.images?.length ?? 0;
  return (
    <FolderCard
      value={folder.dir}
      onChange={onDir}
      onClear={onClear}
      title={`V${n} images (optional)`}
      prefix={`V${n}`}
      hint={`Folder for Short ${n}: 01.png, 02.png…`}
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
  );
}
