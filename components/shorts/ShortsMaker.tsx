"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, ProgressBar, pollJob } from "@/components/ui";
import { CheckBadge, LAST_KEY, PdfCard, cardCls } from "@/components/editor/Setup";
import { Section, Steps, fieldCls } from "@/components/publish/bits";
import { fileUrl } from "@/lib/editor/render";
import { alignToSpeech } from "@/lib/merge/captions";
import { listSavedScripts } from "@/lib/publish/kit";
import { downloadBlob, makeZip } from "@/lib/publish/zip";
import { DEFAULT_SPEED, DEFAULT_VOICE, VOICES, isSpeed, isVoice, spokenText, type ParsedScript, type SpeedId, type VoiceId } from "@/lib/script";
import { cuesToWords, homeWords, snapToSpeech, timeSentences } from "@/lib/shorts/align";
import { loadShortFonts, measure } from "@/lib/shorts/draw";
import {
  CTA_DEFAULT,
  DEFAULT_CROP,
  END_TAG,
  buildSpec,
  chooseHook,
  distinctHooks,
  endTagMaxSize,
  keyWord,
  mainSubject,
  properNouns,
  shortDescription,
  shortFileName,
  shortTitle,
  specHash,
  specLength,
  voiceKey,
} from "@/lib/shorts/layout";
import { SAME_PART, TARGETS, hookCandidates, isQuestion, pickShorts, samePart, scoreClip } from "@/lib/shorts/pick";
import { scriptSentences } from "@/lib/shorts/sentences";
import { cutShots, shotMeta } from "@/lib/shorts/shots";
import { deleteShortsProject, loadShortsProjects, saveShortsProject, shortsId } from "@/lib/shorts/store";
import type { Candidate, Sentence, ShortImage, ShortState, ShortsProject, ShortsStage, TimedWord, TimingSource } from "@/lib/shorts/types";
import type { ImageFolder } from "./ImageFolderBox";
import { ImagesStage } from "./ImagesStage";
import { ReviewStage } from "./ReviewStage";
import { SHORT_LABEL, ShortEditor } from "./ShortEditor";

const STEP_LABELS = ["Reading script", "Matching timings", "Picking clips", "Voice of Short 1", "Voice of Short 2", "Voice of Short 3"] as const;
const STAGE_LABELS = ["Upload", "Review the voices", "Add images", "Final Shorts"] as const;
const STAGE_INDEX = { review: 1, images: 2, final: 3 } as const;
const STAGE_NOTE = { review: "Waiting for approval", images: "Waiting for images" } as const;
const TIMING_LABEL: Record<TimingSource, string> = { home: "Home edit timings", whisper: "Local Whisper", pauses: "Voice pauses" };
const TINTS = { 1: "bg-[#FFD23F]", 2: "bg-sky-400", 3: "bg-emerald-400" } as const;
const tick = () => new Promise((r) => setTimeout(r, 200));
/** Timestamps for saves and renders (event handlers only). */
const now = () => Date.now();
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

type Video = { path: string; name: string; duration: number };

/** Sentence edges moved onto the voice; unchanged if the pauses can't be read. */
async function snapSentences(sentences: Sentence[], path: string): Promise<{ sentences: Sentence[]; ok: boolean }> {
  try {
    const r = await fetch("/api/merge/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j.speech)) return { sentences, ok: false };
    return { sentences: snapToSpeech(sentences, j.speech), ok: true };
  } catch {
    return { sentences, ok: false };
  }
}

/** The voice the long video was narrated with: its Home edit's, else the last one chosen on Home. */
function videoVoice(scriptFile: string): { voice: VoiceId; rate: SpeedId } {
  let voice: VoiceId | undefined;
  let rate: SpeedId = DEFAULT_SPEED;
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
    if (isVoice(last?.voice)) voice = last.voice;
    if (isSpeed(last?.rate)) rate = last.rate;
  } catch {}
  const label = listSavedScripts().find((g) => g.file === scriptFile)?.parts[0]?.project.script?.voice;
  return { voice: VOICES.find((v) => v.label === label)?.id ?? voice ?? DEFAULT_VOICE, rate };
}

/** The default ending before it was reworded: saved projects still on it get the new one. */
const OLD_CTA_DEFAULT = "So what happened next? Watch the full story on my channel.";
const SHORT_NUMBERS = [1, 2, 3] as const;
const NO_FOLDER: ImageFolder = { dir: "" };

function newShort(sentences: Sentence[], c: Candidate, n: 1 | 2 | 3): ShortState {
  const { hook, sentence } = chooseHook(sentences, c.from, c.to, n);
  return {
    n,
    target: TARGETS[n - 1],
    from: c.from,
    to: c.to,
    score: c.score,
    reasons: c.reasons,
    hook,
    hookKey: keyWord(hook),
    hookSentence: sentence,
    showHook: false,
    showEndTag: true,
    crop: DEFAULT_CROP,
    edits: {},
    images: [],
    cta: CTA_DEFAULT,
    rendered: null,
  };
}

/**
 * Brings a project saved before the current hook rules up to date: the hook Short ends on
 * its question, and an untouched hook title becomes the part's title.
 */
function upgradeHook(sentences: Sentence[], shorts: ShortState[]): ShortState[] {
  const next = shorts.map((s) => {
    // A Short 1 regenerated at review came from a part the user chose: it stays there.
    if (s.n !== 1 || s.rejected?.length) return s;
    let clip = { from: s.from, to: s.to };
    if (!isQuestion(sentences[s.to])) {
      const best = hookCandidates(sentences, s.target)[0];
      if (best && isQuestion(sentences[best.to])) clip = { from: best.from, to: best.to };
    }
    if (s.hookEdited) return { ...s, ...clip };
    const { hook, sentence } = chooseHook(sentences, clip.from, clip.to, 1, cutShots(sentences, { ...s, ...clip }));
    return { ...s, ...clip, hook, hookKey: keyWord(hook), hookSentence: sentence };
  });
  return distinctHooks(sentences, rescore(sentences, next));
}

/** Scores follow the clips; Short 3 loses 2 points when it shares a part with Short 2. */
function rescore(sentences: Sentence[], shorts: ShortState[]): ShortState[] {
  const two = shorts.find((s) => s.n === 2)!;
  return shorts.map((s) => {
    const base = scoreClip(sentences, s.from, s.to);
    if (s.n === 3 && samePart(sentences, s, two)) return { ...s, score: base.score + SAME_PART.points, reasons: [...base.reasons, SAME_PART] };
    return { ...s, ...base };
  });
}

export function ShortsMaker() {
  const [saved, setSaved] = useState<ShortsProject[]>([]);
  const [script, setScript] = useState<ParsedScript | null>(null);
  const [reading, setReading] = useState(false);
  const [video, setVideo] = useState<Video | null>(null);
  const [copying, setCopying] = useState(false);
  const [folders, setFolders] = useState<Partial<Record<1 | 2 | 3, ImageFolder>>>({});

  const [project, setProject] = useState<ShortsProject | null>(null);
  const projectRef = useRef<ShortsProject | null>(null);
  const savedId = useRef<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  const [step, setStep] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ progress: number; stage: string } | null>(null);
  const [renders, setRenders] = useState<Record<number, { progress: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [zipping, setZipping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stage = project ? (project.stage ?? "final") : null;

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [stage]);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- read localStorage after hydration */
    setSaved(loadShortsProjects());
    loadShortFonts().then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // Autosave under the video title.
  useEffect(() => {
    if (!project) return;
    const t = setTimeout(() => {
      if (saveShortsProject({ ...project, savedAt: Date.now() }, savedId.current ?? undefined)) {
        savedId.current = project.id;
        setSaved(loadShortsProjects());
      }
    }, 600);
    return () => clearTimeout(t);
  }, [project]);

  function patchShortImages(n: 1 | 2 | 3, dir: string | undefined, images: ShortImage[]) {
    // A different folder starts this Short's mapping over; the same folder only refreshes its list.
    setProject((p) => (p ? { ...p, shorts: p.shorts.map((s) => (s.n === n ? { ...s, imagesDir: dir, images, mapping: s.imagesDir === dir ? s.mapping : undefined } : s)) } : p));
  }

  function setStage(next: ShortsStage) {
    projectRef.current = projectRef.current && { ...projectRef.current, stage: next };
    setProject((p) => (p ? { ...p, stage: next } : p));
  }

  function folderCopying(n: 1 | 2 | 3, copying: boolean) {
    setFolders((f) => ({ ...f, [n]: { ...(f[n] ?? NO_FOLDER), copying } }));
  }

  function folderScanned(n: 1 | 2 | 3, dir: string, result: { images: ShortImage[] } | { error: string }) {
    setFolders((f) => ({ ...f, [n]: { dir: f[n]?.dir ?? dir, ...result } }));
    if ("images" in result) patchShortImages(n, dir, result.images);
  }

  function clearFolder(n: 1 | 2 | 3) {
    setFolders((f) => ({ ...f, [n]: NO_FOLDER }));
    patchShortImages(n, undefined, []);
  }

  const names = useMemo(() => (project ? properNouns(project.sentences) : new Set<string>()), [project?.sentences]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───────────── Inputs ─────────────

  async function readPdf(file: File) {
    setError(null);
    setReading(true);
    try {
      const r = await fetch(`/api/script?${new URLSearchParams({ name: file.name })}`, { method: "POST", body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setScript(j as ParsedScript);
      // A project saved before shot details were kept gets them from its script.
      setProject((p) => (p && !p.shotMeta ? { ...p, shotMeta: shotMeta(j as ParsedScript) } : p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function applyVideo(path: string) {
    const r = await fetch("/api/merge/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: [path] }) });
    const j = await r.json();
    const f = j.files?.[0];
    if (!f || f.error) throw new Error(f?.error ?? "Could not read that video.");
    if (!f.info?.video) throw new Error("That file has no video in it.");
    setVideo({ path, name: f.name, duration: f.info.duration });
  }

  async function pickVideo() {
    setError(null);
    try {
      const r = await fetch("/api/pick-file", { method: "POST", body: JSON.stringify({ prompt: "Choose the final long video" }) });
      const j = await r.json();
      if (j.path) await applyVideo(j.path);
      else if (j.error) document.getElementById("shorts-video-input")?.click();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function uploadVideo(file: File) {
    setError(null);
    setCopying(true);
    try {
      const q = new URLSearchParams({ kind: "video", name: file.name, size: String(file.size), modified: String(file.lastModified) });
      const r = await fetch(`/api/upload?${q}`, { method: "POST", body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await applyVideo(j.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCopying(false);
    }
  }

  // ───────────── Make Shorts ─────────────

  /** Real start/end of every sentence: Home edits, else local Whisper, else the voice's pauses. */
  async function matchTimings(base: Sentence[], s: ParsedScript, v: Video): Promise<{ sentences: Sentence[]; timing: TimingSource; note: string }> {
    const home = homeWords(s, listSavedScripts(), v.duration);
    if (home) {
      const r = timeSentences(base, home.words, v.duration);
      if (r.matched >= 0.8) return { sentences: r.sentences, timing: "home", note: home.note };
    }
    try {
      setJob({ progress: 0, stage: "Starting local Whisper" });
      const r = await fetch("/api/shorts/words", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: v.path }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const res = await pollJob<{ words: TimedWord[] }>(j.jobId, setJob);
      const t = timeSentences(base, res.words, v.duration);
      const pct = Math.round(t.matched * 100);
      return {
        sentences: t.sentences,
        timing: "whisper",
        note:
          t.matched < 0.6
            ? `Only ${pct}% of the script's words were heard in the video. Check that this is the right video, and check the clip edges.`
            : `Timed with local Whisper: ${pct}% of the script's words matched what was said.`,
      };
    } catch (e) {
      setJob({ progress: 0.5, stage: "Timing from the voice's pauses" });
      const r = await fetch("/api/merge/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: v.path }) });
      const j = await r.json();
      if (!r.ok) throw new Error(`Couldn't time the script: ${j.error}`);
      const cues = alignToSpeech(s.parts.flatMap((p) => p.shots.map((x) => spokenText(x.narration))), j.speech);
      const t = timeSentences(base, cuesToWords(cues), v.duration);
      return {
        sentences: t.sentences,
        timing: "pauses",
        note: `Local Whisper failed (${(e as Error).message.split("\n")[0]}), so sentences were timed from the voice's pauses. Check each clip's edges before rendering.`,
      };
    } finally {
      setJob(null);
    }
  }

  async function makeShorts() {
    if (!script || !video) return;
    setError(null);
    setNotes([]);
    setFolders({});
    setBusy(true);
    try {
      setStep(0);
      await tick();
      const base = scriptSentences(script);
      if (base.length < 6) throw new Error("The script has too few narration sentences to cut three Shorts from.");

      setStep(1);
      const matched = await matchTimings(base, script, video);
      const snapped = await snapSentences(matched.sentences, video.path);
      const timed = { ...matched, sentences: snapped.sentences };

      setStep(2);
      await tick();
      const { picks, notes: pickNotes } = pickShorts(timed.sentences);
      const title = script.title?.trim() || video.name.replace(/\.[^.]+$/, "");
      const p: ShortsProject = {
        id: shortsId(title),
        title,
        savedAt: now(),
        stage: "review",
        video,
        scriptFile: script.file,
        timing: timed.timing,
        timingNote: timed.note,
        speechSnapped: snapped.ok,
        subject: mainSubject(timed.sentences, script.title),
        sentences: timed.sentences,
        shorts: distinctHooks(timed.sentences, picks.map((c, k) => newShort(timed.sentences, c, (k + 1) as 1 | 2 | 3))),
        shotMeta: shotMeta(script),
        ...videoVoice(script.file),
      };
      // A new build is saved under its own title; it never replaces a different saved project.
      savedId.current = p.id;
      projectRef.current = p;
      setProject(p);
      setNotes(pickNotes);

      await loadShortFonts();
      for (const n of SHORT_NUMBERS) {
        setStep(2 + n);
        await renderOne(n, true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep(-1);
      setBusy(false);
    }
  }

  // ───────────── Review ─────────────

  /** Builds any voice preview that is missing or no longer matches its clip. */
  async function refreshVoices() {
    setError(null);
    setBusy(true);
    try {
      await loadShortFonts();
      for (const n of SHORT_NUMBERS) {
        const p = projectRef.current!;
        const s = p.shorts.find((x) => x.n === n)!;
        if (s.voicePreview?.key !== voiceKey(buildSpec(p, s, measure))) await renderOne(n, true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Swaps a Short for a new clip from the chosen part and prepares its voice. */
  async function regenerate(n: 1 | 2 | 3, c: Candidate) {
    const p = projectRef.current;
    const old = p?.shorts.find((s) => s.n === n);
    if (!p || !old) return;
    const { hook, sentence } = chooseHook(p.sentences, c.from, c.to, n);
    const fresh: ShortState = {
      ...old,
      from: c.from,
      to: c.to,
      hook,
      hookKey: keyWord(hook),
      hookEdited: false,
      hookSentence: sentence,
      edits: {},
      mapping: undefined,
      removedShots: undefined,
      voicePreview: null,
      rendered: null,
      rejected: [...(old.rejected ?? []), { from: old.from, to: old.to }],
    };
    const next = { ...p, shorts: distinctHooks(p.sentences, rescore(p.sentences, p.shorts.map((s) => (s.n === n ? fresh : s)))) };
    projectRef.current = next;
    setProject(next);
    setError(null);
    try {
      await renderOne(n, true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function backToReview() {
    setStage("review");
    refreshVoices();
  }

  // ───────────── Final videos ─────────────

  async function generateFinal() {
    setError(null);
    setBusy(true);
    try {
      for (const n of stale) await renderOne(n);
      setStage("final");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ───────────── Editing ─────────────

  function patchShort(n: number, patch: Partial<ShortState>) {
    setProject((p) => (p ? { ...p, shorts: p.shorts.map((s) => (s.n === n ? { ...s, ...patch } : s)) } : p));
  }

  function setClip(n: number, from: number, to: number) {
    setProject((p) => {
      if (!p) return p;
      const shorts = p.shorts.map((s) => {
        if (s.n !== n) return s;
        const next = { ...s, from, to };
        if (s.hookEdited) return next;
        const { hook, sentence } = chooseHook(p.sentences, from, to, s.n, cutShots(p.sentences, next));
        return { ...next, hook, hookKey: keyWord(hook), hookSentence: sentence };
      });
      return { ...p, shorts: distinctHooks(p.sentences, rescore(p.sentences, shorts)) };
    });
  }

  /** Sets which shots are deleted from a Short. A hook title taken from a deleted line is chosen again. */
  function setRemovedShots(n: 1 | 2 | 3, shots: number[]) {
    setProject((p) => {
      if (!p) return p;
      const updated = p.shorts.map((s) => {
        if (s.n !== n) return s;
        const next = { ...s, removedShots: shots.length ? shots : undefined };
        const gone = cutShots(p.sentences, next);
        if (s.hookEdited || s.hookSentence === null || !gone.has(p.sentences[s.hookSentence].shot)) return next;
        const { hook, sentence } = chooseHook(p.sentences, s.from, s.to, s.n, gone);
        return { ...next, hook, hookKey: keyWord(hook), hookSentence: sentence };
      });
      return { ...p, shorts: distinctHooks(p.sentences, updated) };
    });
  }

  /** Speaks the Short's call-to-action (cached by the server), so its real length is known. */
  async function speakCta(n: 1 | 2 | 3) {
    const p = projectRef.current;
    const short = p?.shorts.find((s) => s.n === n);
    const text = short?.cta.trim();
    if (!p || !text) return;
    const { voice = DEFAULT_VOICE, rate = DEFAULT_SPEED } = p;
    const r = await fetch("/api/shorts/cta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice, rate }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    const ctaAudio = { text, voice, rate, path: j.path as string, duration: j.duration as number };
    projectRef.current = { ...projectRef.current!, voice, rate, shorts: projectRef.current!.shorts.map((s) => (s.n === n ? { ...s, ctaAudio } : s)) };
    setProject((x) => (x ? { ...x, voice, rate, shorts: x.shorts.map((s) => (s.n === n ? { ...s, ctaAudio } : s)) } : x));
  }

  async function speakEdited(n: 1 | 2 | 3) {
    setError(null);
    try {
      await speakCta(n);
    } catch (e) {
      setError(`The call-to-action couldn't be spoken: ${(e as Error).message}`);
    }
  }

  /** Renders one Short from the latest edits (or only its voice); the others are left alone. */
  async function renderOne(n: 1 | 2 | 3, voiceOnly = false) {
    try {
      await speakCta(n);
    } catch (e) {
      throw new Error(`Short ${n}'s call-to-action couldn't be spoken: ${(e as Error).message}`);
    }
    const p = projectRef.current;
    const short = p?.shorts.find((s) => s.n === n);
    if (!p || !short) return;
    const spec = buildSpec(p, short, measure);
    setRenders((r) => ({ ...r, [n]: { progress: 0 } }));
    try {
      const r = await fetch(`/api/shorts/render${voiceOnly ? "?voice=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const done = await pollJob<{ path: string }>(j.jobId, (u) => setRenders((x) => ({ ...x, [n]: { progress: u.progress } })));
      const result: Partial<ShortState> = voiceOnly ? { voicePreview: { path: done.path, key: voiceKey(spec) } } : { rendered: { path: done.path, hash: specHash(spec), at: now() } };
      projectRef.current = { ...projectRef.current!, shorts: projectRef.current!.shorts.map((s) => (s.n === n ? { ...s, ...result } : s)) };
      patchShort(n, result);
    } catch (e) {
      throw new Error(`Short ${n}'s ${voiceOnly ? "voice preview" : "video"} didn't render: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      setRenders(({ [n]: _, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
    }
  }

  async function renderSingle(n: 1 | 2 | 3, voiceOnly = false) {
    setError(null);
    try {
      await renderOne(n, voiceOnly);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const stale = project
    ? project.shorts.filter((s) => !s.rendered || s.rendered.hash !== specHash(buildSpec(project, s, measure))).map((s) => s.n)
    : [];

  async function renderChanged() {
    setError(null);
    try {
      for (const n of stale) await renderOne(n);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ───────────── Saved projects ─────────────

  async function openProject(p: ShortsProject) {
    setError(null);
    setNotes([]);
    setStep(-1);
    savedId.current = p.id;
    setVideo(p.video);
    setScript(null);
    // Renders live in a temp folder; drop the ones that are gone.
    const paths = [p.video.path, ...p.shorts.flatMap((s) => [s.rendered?.path, s.voicePreview?.path].filter((x): x is string => !!x))];
    const r = await fetch("/api/merge/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) })
      .then((x) => x.json())
      .catch(() => null);
    const missing = new Set<string>((r?.files ?? []).filter((f: { error?: string }) => f.error).map((f: { path: string }) => f.path));
    // Projects saved before sentence edges were snapped to the voice get it once.
    let sentences = p.sentences;
    let speechSnapped = p.speechSnapped;
    if (!speechSnapped && !missing.has(p.video.path)) {
      const snapped = await snapSentences(p.sentences, p.video.path);
      sentences = snapped.sentences;
      speechSnapped = snapped.ok;
    }
    const shorts = upgradeHook(
      sentences,
      p.shorts.map((s) => ({
        ...s,
        rendered: s.rendered && missing.has(s.rendered.path) ? null : s.rendered,
        voicePreview: s.voicePreview && missing.has(s.voicePreview.path) ? null : s.voicePreview,
        cta: s.cta === undefined || s.cta === OLD_CTA_DEFAULT ? CTA_DEFAULT : s.cta,
      })),
    );
    const next = { ...p, ...(p.voice ? {} : videoVoice(p.scriptFile)), sentences, speechSnapped, shorts };
    // Each Short's images reload from its own folder when its box is next shown, in case they changed on disk.
    setFolders(Object.fromEntries(shorts.map((s) => [s.n, { dir: s.imagesDir ?? "" }])));
    projectRef.current = next;
    setProject(next);
    if (missing.has(p.video.path)) setError("The long video has moved or was deleted. Click New, then add it again to rebuild.");
    else if (next.stage === "review") refreshVoices();
    scroller.current?.scrollTo({ top: 0 });
  }

  function newProject() {
    setProject(null);
    projectRef.current = null;
    savedId.current = null;
    setScript(null);
    setVideo(null);
    setFolders({});
    setNotes([]);
    setError(null);
  }

  function removeProject(id: string) {
    deleteShortsProject(id);
    setSaved(loadShortsProjects());
    if (project?.id === id) newProject();
  }

  // ───────────── Export ─────────────

  /** Saves one Short, rendering it first if it was edited, so the file always matches what's on screen. */
  async function downloadShort(n: 1 | 2 | 3) {
    setError(null);
    try {
      if (stale.includes(n)) await renderOne(n);
      const path = projectRef.current?.shorts.find((s) => s.n === n)?.rendered?.path;
      if (!path) return;
      const link = document.createElement("a");
      link.href = fileUrl(path, true);
      link.download = shortFileName(n);
      link.click();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function downloadAll() {
    if (!project) return;
    setZipping(true);
    setError(null);
    try {
      for (const n of stale) await renderOne(n);
      const files: { name: string; data: Blob | string }[] = [];
      const text: string[] = [];
      for (const s of projectRef.current!.shorts) {
        if (!s.rendered) continue;
        const r = await fetch(fileUrl(s.rendered.path));
        if (!r.ok) throw new Error(`${shortFileName(s.n)} is missing. Render it again.`);
        files.push({ name: shortFileName(s.n), data: await r.blob() });
        text.push(`${shortFileName(s.n)}\nTitle: ${shortTitle(s, names)}\nDescription: ${shortDescription(project, s)}\nRelated video: ${project.title}\n`);
      }
      files.push({ name: "upload-text.txt", data: text.join("\n") });
      downloadBlob(await makeZip(files), `${project.id}-shorts.zip`);
    } catch (e) {
      setError(`Could not make the zip: ${(e as Error).message}`);
    } finally {
      setZipping(false);
    }
  }

  const canMake = !!script && !!video && !busy && !reading && !copying;
  const allRendered = !!project && project.shorts.every((s) => s.rendered);
  const anyRendering = Object.keys(renders).length > 0;
  const showInputs = !stage || stage === "final";

  return (
    <div ref={scroller} className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto px-6 py-12 space-y-8 animate-rise">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#FFD23F]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFD23F]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FFD23F] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FFD23F]" />
              </span>
              Final cut · Shorts
            </div>
            <h1 className="mt-4 text-4xl font-bold tracking-tight">
              One video. <span className="text-[#FFD23F]">Three Shorts.</span>
            </h1>
            <p className="text-muted mt-2">Drop in the final video and its polished script. Listen to three Shorts of about 35, 45 and 30 s, approve them, then add images. Free and on your own computer.</p>
          </div>
          {project && (
            <div className="flex items-center gap-2 text-xs text-muted tabular-nums">
              <span className="rounded-full border border-line-strong/60 px-3 py-1">{project.sentences.length} sentences</span>
              <span className="rounded-full border border-line-strong/60 px-3 py-1">{TIMING_LABEL[project.timing]}</span>
              <span className="rounded-full border border-line-strong/60 px-3 py-1">{project.shorts.filter((s) => s.rendered).length}/3 rendered</span>
            </div>
          )}
        </header>

        <Steps step={stage ? STAGE_INDEX[stage] : 0} labels={STAGE_LABELS} className="grid-cols-2 sm:grid-cols-4" />

        {saved.length > 0 && (
          <Section title="Saved Shorts projects" aside={project && <Button size="sm" onClick={newProject}>New</Button>}>
            <ul className="flex flex-col divide-y divide-line-strong/40">
              {saved.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium truncate ${p.id === project?.id ? "text-link" : ""}`}>{p.title}</div>
                    <div className="text-xs text-muted">
                      {new Date(p.savedAt).toLocaleString()} · {p.stage && p.stage !== "final" ? STAGE_NOTE[p.stage] : `${p.shorts.filter((s) => s.rendered).length}/3 rendered`} · {TIMING_LABEL[p.timing]}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => openProject(p)} disabled={p.id === project?.id || busy}>
                    {p.id === project?.id ? "Open" : "Reopen"}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => removeProject(p.id)} disabled={busy}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Inputs */}
        {showInputs && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <VideoCard video={video} copying={copying} onPick={pickVideo} onFile={uploadVideo} onClear={() => setVideo(null)} disabled={busy} />
              <PdfCard
                file={script?.file ?? null}
                meta={script ? `${script.parts.length} parts · ${script.parts.reduce((s, p) => s + p.shots.length, 0)} shots${script.title ? ` · “${script.title}”` : ""}` : "The polished script the video was made from"}
                reading={reading}
                onFile={readPdf}
                onClear={() => setScript(null)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button variant="primary" size="lg" className="rounded-xl" disabled={!canMake} onClick={makeShorts}>
                {busy ? "Preparing…" : project ? "Prepare Shorts again" : "Prepare Shorts"}
                {!busy && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14m-5-5l5 5-5 5" />
                  </svg>
                )}
              </Button>
              {!canMake && !busy && (
                <span className="text-xs text-muted">
                  {!video ? "Add the final video." : !script ? (project ? "Add the script PDF again to rebuild from scratch. Edits below still work." : "Add the polished script PDF.") : ""}
                </span>
              )}
              {project && project.id && !busy && (
                <span className="text-xs text-subtle">Rebuilding replaces the picks and edits of “{project.title}”.</span>
              )}
            </div>
          </>
        )}

        <div className="space-y-4">
          {step >= 0 && <Steps step={step} labels={STEP_LABELS} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />}
          {job && (
            <div className="space-y-1.5">
              <ProgressBar value={job.progress} />
              <div className="flex justify-between text-xs text-muted">
                <span>{job.stage}</span>
                <span>{Math.round(job.progress * 100)}%</span>
              </div>
            </div>
          )}
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {project?.timingNote && <Alert tone={project.timing === "pauses" || /Only \d+%/.test(project.timingNote) ? "warn" : "info"}>{project.timingNote}</Alert>}
        {notes.map((n) => (
          <Alert key={n} tone="warn">
            {n}
          </Alert>
        ))}

        {project && stage === "review" && (
          <>
            <Overview project={project} />
            <ReviewStage
              project={project}
              renders={renders}
              working={busy || anyRendering}
              onApprove={() => setStage("images")}
              onRegenerate={regenerate}
              onRetry={(n) => renderSingle(n, true)}
            />
          </>
        )}

        {project && stage === "images" && (
          <ImagesStage
            project={project}
            folders={folders}
            renders={renders}
            working={busy || anyRendering}
            onBack={backToReview}
            onGenerate={generateFinal}
            onDir={(n, dir) => setFolders((f) => ({ ...f, [n]: { dir } }))}
            onScanned={folderScanned}
            onClear={clearFolder}
            onCopying={folderCopying}
            onRemovedShots={setRemovedShots}
          />
        )}

        {project && stage === "final" && (
          <>
            <Overview project={project} />
            <EndTagSetting project={project} onChange={(endTag) => setProject((p) => (p ? { ...p, endTag } : p))} />

            {project.shorts.map((s) => (
              <ShortEditor
                key={s.n}
                project={project}
                short={s}
                names={names}
                fontsReady={fontsReady}
                render={renders[s.n] ?? null}
                onClip={(from, to) => setClip(s.n, from, to)}
                onChange={(patch) => patchShort(s.n, patch)}
                onRender={() => renderSingle(s.n)}
                onDownload={() => downloadShort(s.n)}
                onCtaDone={() => speakEdited(s.n)}
                onVoice={(patch) => setProject((p) => (p ? { ...p, ...patch } : p))}
              />
            ))}

            {/* Export */}
            <section className="rounded-2xl border border-line-strong/60 bg-raised/60 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Export</h2>
                  <p className="text-xs text-muted mt-0.5">1080×1920 · 30 fps · H.264 + AAC · saved as “{project.title}”</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setStage("images")} disabled={anyRendering || busy}>
                    Change images
                  </Button>
                  <Button onClick={renderChanged} disabled={!stale.length || anyRendering || busy}>
                    {stale.length ? `Render changed (${stale.map((n) => `Short ${n}`).join(", ")})` : "All up to date"}
                  </Button>
                  <Button variant="primary" onClick={downloadAll} disabled={!allRendered || zipping || anyRendering}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
                    </svg>
                    {zipping ? "Packing…" : stale.length ? "Render & download all (.zip)" : "Download all (.zip)"}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {project.shorts.map((s) => (
                  <div key={s.n} className="rounded-xl border border-line-strong/50 bg-bg/40 px-3.5 py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{shortFileName(s.n)}</div>
                      <div className="text-[11px] text-muted">
                        {SHORT_LABEL[s.n]} · {specLength(buildSpec(project, s, measure)).toFixed(1)} s
                      </div>
                    </div>
                    {s.rendered ? (
                      <Button size="sm" onClick={() => downloadShort(s.n)} disabled={anyRendering || busy || zipping}>
                        {stale.includes(s.n) ? "Render & download" : "Download"}
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted">Not rendered</span>
                    )}
                  </div>
                ))}
              </div>
              <label className="block max-w-sm">
                <span className="block text-xs font-medium text-muted mb-1.5">Main subject (for the #hashtag in descriptions)</span>
                <input className={fieldCls} value={project.subject} onChange={(e) => setProject((p) => (p ? { ...p, subject: e.target.value.replace(/\s+/g, "") } : p))} />
              </label>
              <Alert tone="info">
                <span className="font-semibold">When you upload each Short:</span> in YouTube Studio, set <span className="font-semibold">Related video</span> to the full video “{project.title}” so viewers can tap through to the whole story.
              </Alert>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/** The whole video with where each Short sits; click one to jump to its editor. */
function Overview({ project }: { project: ShortsProject }) {
  const { sentences, video } = project;
  const total = Math.max(video.duration, sentences[sentences.length - 1]?.end ?? 0, 1);
  const pct = (t: number) => `${(t / total) * 100}%`;
  const partStarts = sentences.filter((s, i) => i > 0 && s.partKey !== sentences[i - 1].partKey);
  const outroStart = sentences.find((s) => s.outro)?.start;
  return (
    <section className="rounded-2xl border border-line-strong/60 bg-raised/60 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Where the Shorts come from</h2>
        <span className="text-xs text-muted tabular-nums">{clock(video.duration)} · {video.name}</span>
      </div>
      <div className="relative h-10 rounded-xl bg-bg/70 border border-line-strong/60 overflow-hidden">
        {outroStart !== undefined && (
          <div
            className="absolute top-0 bottom-0 right-0 [background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgba(240,68,56,0.3)_4px_6px)]"
            style={{ left: pct(outroStart) }}
            title="The ending: never used"
          />
        )}
        {partStarts.map((s) => (
          <div key={s.i} className="absolute top-0 bottom-0 w-px bg-line-strong" style={{ left: pct(s.start) }}>
            <span className="absolute top-0.5 left-1 text-[9px] text-subtle whitespace-nowrap">{s.partTitle}</span>
          </div>
        ))}
        {project.shorts.map((s) => {
          const a = sentences[s.from].start;
          const b = sentences[s.to].end;
          return (
            <a
              key={s.n}
              href={`#short-${s.n}`}
              className={`absolute top-3 bottom-1.5 rounded-md ${TINTS[s.n]} opacity-85 hover:opacity-100 grid place-items-center text-[10px] font-bold text-[#1B1B1B]`}
              style={{ left: pct(a), width: `max(14px, ${pct(b - a)})` }}
              title={`Short ${s.n}: ${clock(a)}–${clock(b)}`}
            >
              {s.n}
            </a>
          );
        })}
      </div>
    </section>
  );
}

/** The look of the "Watch the full story" tag: one setting, used by all three Shorts. */
function EndTagSetting({ project, onChange }: { project: ShortsProject; onChange: (endTag: ShortsProject["endTag"]) => void }) {
  const max = endTagMaxSize(measure);
  const size = Math.min(project.endTag?.size ?? END_TAG.size, max);
  const gap = project.endTag?.gap ?? END_TAG.gap;
  return (
    <section className="rounded-2xl border border-line-strong/60 bg-raised/60 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">“Watch the full story” tag</h2>
          <p className="text-xs text-muted mt-0.5">Applies to all three Shorts. Drag a preview to its end to see the tag.</p>
        </div>
        {project.endTag && (
          <Button size="sm" onClick={() => onChange(undefined)}>
            Reset
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="flex justify-between text-xs font-medium text-muted mb-1.5">
            <span>Text size</span>
            <span className="tabular-nums text-fg">{Math.round((size / END_TAG.size) * 100)}%</span>
          </span>
          <input type="range" min={END_TAG.size} max={max} step={1} value={size} onChange={(e) => onChange({ size: +e.target.value, gap })} className="w-full" />
        </label>
        <label className="block">
          <span className="flex justify-between text-xs font-medium text-muted mb-1.5">
            <span>Gap from the bottom</span>
            <span className="tabular-nums text-fg">{gap} px</span>
          </span>
          <input type="range" min={END_TAG.gap} max={END_TAG.maxGap} step={1} value={gap} onChange={(e) => onChange({ size, gap: +e.target.value })} className="w-full" />
        </label>
      </div>
    </section>
  );
}

/** The long video: click to choose it (it stays where it is), or drop it to copy it in. */
function VideoCard({
  video,
  copying,
  onPick,
  onFile,
  onClear,
  disabled,
}: {
  video: Video | null;
  copying: boolean;
  onPick: () => void;
  onFile: (f: File) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
      className={`${cardCls} ${
        over ? "border-link bg-link/10" : video ? "border-line-strong/60 bg-raised/60" : "border-dashed border-line-strong bg-raised/30 hover:border-link/60"
      }`}
    >
      <input
        id="shorts-video-input"
        type="file"
        accept="video/mp4,video/*,.mp4,.mov,.m4v"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {video && !copying && <CheckBadge />}
      <button type="button" onClick={onPick} disabled={copying || disabled} className="flex flex-col gap-4 text-left outline-none">
        <span className="w-12 h-12 rounded-xl grid place-items-center ring-1 group-hover:scale-105 transition-transform bg-gradient-to-br from-[#FFD23F]/30 to-amber-500/15 text-[#FFD23F] ring-[#FFD23F]/25">
          {copying ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" aria-hidden>
              <path d="M12 3a9 9 0 019 9" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="5" width="14" height="14" rx="2.5" />
              <path d="M17 10l4-2.5v9L17 14" />
            </svg>
          )}
        </span>
        <span className="min-w-0">
          <span className="block font-semibold truncate">{copying ? "Copying the video…" : (video?.name ?? "Final video (.mp4)")}</span>
          <span className="block text-xs text-muted mt-0.5 truncate">
            {copying ? "Large files take a moment" : video ? `${clock(video.duration)} long · 16:9 with burned-in subtitles` : "Click to choose it, or drop it here"}
          </span>
        </span>
      </button>
      {video && !copying && (
        <div className="flex items-center gap-4 text-xs">
          <button type="button" onClick={onPick} disabled={disabled} className="text-link hover:underline">
            Replace
          </button>
          <button type="button" onClick={onClear} disabled={disabled} className="text-muted hover:text-error transition-colors">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
