import { kitId } from "@/lib/publish/kit";
import type { ShortsProject } from "./types";

/** Shorts projects are saved in this browser under the video title, like Publish Kits. */
const KEY = "creatoros:shorts";

export const shortsId = (title: string) => kitId(title);

function readAll(): Record<string, ShortsProject> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, ShortsProject>;
  } catch {
    return {};
  }
}

export function loadShortsProjects(): ShortsProject[] {
  return Object.values(readAll()).sort((a, b) => b.savedAt - a.savedAt);
}

export function saveShortsProject(p: ShortsProject, previousId?: string) {
  try {
    const all = readAll();
    if (previousId && previousId !== p.id) delete all[previousId];
    all[p.id] = p;
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function deleteShortsProject(id: string) {
  try {
    const all = readAll();
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}
