"use client";
import { useEffect, useRef, useState } from "react";
import { Setup, savedKey } from "./Setup";
import { Workspace } from "./Workspace";
import { loadProject, projectStore, selectionStore, timeStore, useStore } from "@/lib/editor/store";
import { fileUrl, loadImage, makeBlurred, type Assets } from "@/lib/editor/render";
import { player } from "@/lib/editor/player";
import { preloadCanvasFonts } from "@/lib/fonts";
import { ProgressBar } from "@/components/ui";
import type { Project } from "@/lib/editor/types";

export function Editor() {
  const project = useStore(projectStore, (p) => p);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const imagesKey = project?.images.map((i) => i.path).join("|");

  // Load (and decode) every image once per project.
  useEffect(() => {
    const p = projectStore.get();
    if (!p) return;
    let cancelled = false;
    (async () => {
      setAssets(null);
      setLoading(0);
      await preloadCanvasFonts();
      const a: Assets = { images: new Map(), blurred: new Map() };
      let done = 0;
      const queue = [...p.images];
      const worker = async () => {
        for (let clip = queue.shift(); clip; clip = queue.shift()) {
          try {
            const img = await loadImage(fileUrl(clip.path));
            a.images.set(clip.path, img);
            a.blurred.set(clip.path, makeBlurred(img));
          } catch {
            console.warn("Could not load", clip.path);
          }
          done++;
          if (!cancelled) setLoading(done / p.images.length);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (!cancelled) {
        setAssets(a);
        setLoading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imagesKey]);

  useEffect(() => {
    if (project) player.attach(project.audioMix);
  }, [project?.audioMix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave edits per folder pair.
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!project) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { peaks: _peaks, audio: _audio, warnings: _w, ...rest } = project;
      void _peaks; void _audio; void _w;
      try {
        localStorage.setItem(savedKey(project.imagesDir, project.audioDir), JSON.stringify(rest));
      } catch {}
    }, 500);
  }, [project]);

  useEffect(() => () => player.pause(), []);

  if (!project) {
    return (
      <Setup
        onLoaded={(p: Project) => {
          selectionStore.set({ kind: null, ids: [] });
          timeStore.set(0);
          loadProject(p);
        }}
      />
    );
  }
  if (!assets) {
    return (
      <div className="h-full grid place-items-center">
        <div className="w-72 space-y-3 text-center">
          <div className="text-sm text-muted">Loading {project.images.length} images…</div>
          <ProgressBar value={loading ?? 0} />
        </div>
      </div>
    );
  }
  return <Workspace assets={assets} />;
}
