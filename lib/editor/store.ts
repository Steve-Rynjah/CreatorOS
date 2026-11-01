"use client";
import { useSyncExternalStore } from "react";
import type { Project, Selection } from "./types";

type Listener = () => void;

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(next: T | ((s: T) => T)) {
      const v = typeof next === "function" ? (next as (s: T) => T)(state) : next;
      if (v === state) return;
      state = v;
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export function useStore<T, R>(store: ReturnType<typeof createStore<T>>, select: (s: T) => R): R {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}

// ---- project (with undo/redo) ----
export const projectStore = createStore<Project | null>(null);
const past: Project[] = [];
const future: Project[] = [];

/** Apply a change. Pass record:false for in-progress drags (record once at drag start). */
export function updateProject(fn: (p: Project) => Project, { record = true } = {}) {
  const cur = projectStore.get();
  if (!cur) return;
  const next = fn(cur);
  if (next === cur) return;
  if (record) {
    past.push(cur);
    if (past.length > 200) past.shift();
    future.length = 0;
  }
  projectStore.set(next);
}

/** Snapshot the current state into history (call at the start of a drag). */
export function checkpoint() {
  const cur = projectStore.get();
  if (!cur) return;
  past.push(cur);
  if (past.length > 200) past.shift();
  future.length = 0;
}

export function undo() {
  const cur = projectStore.get();
  const prev = past.pop();
  if (!cur || !prev) return;
  future.push(cur);
  projectStore.set(prev);
}

export function redo() {
  const cur = projectStore.get();
  const next = future.pop();
  if (!cur || !next) return;
  past.push(cur);
  projectStore.set(next);
}

export function loadProject(p: Project | null) {
  past.length = 0;
  future.length = 0;
  projectStore.set(p);
}

// ---- selection ----
export const selectionStore = createStore<Selection>({ kind: null, ids: [] });

export function select(kind: Selection["kind"], id: string | null, additive = false) {
  selectionStore.set((s) => {
    if (!id || !kind) return { kind: null, ids: [] };
    if (additive && s.kind === kind) {
      return s.ids.includes(id) ? { kind, ids: s.ids.filter((x) => x !== id) } : { kind, ids: [...s.ids, id] };
    }
    return { kind, ids: [id] };
  });
}

// ---- playback time (kept separate so 60fps updates don't re-render the whole editor) ----
export const timeStore = createStore(0);
export const playingStore = createStore(false);
