"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, PathField } from "@/components/ui";
import { fileUrl } from "@/lib/editor/render";
import { toSrt } from "@/lib/editor/subtitles";
import { uid } from "@/lib/editor/timing";
import {
  DISCLAIMER,
  LIMITS,
  MAX_THUMBS,
  buildPrompt,
  chapterLines,
  parseSeo,
  stamp,
  tagsLength,
  type PublishKit as Kit,
  type ThumbPosition,
  type ThumbSpec,
} from "@/lib/publish/kit";
import { drawThumb, thumbJpeg } from "@/lib/publish/thumbnail";
import { downloadBlob } from "@/lib/publish/zip";
import { CopyButton, Counter, Section, areaCls, fieldCls } from "./bits";

type Props = {
  kit: Kit;
  onChange: (patch: Partial<Kit>) => void;
  thumbBlobs: Record<string, Blob>;
  onThumb: (id: string, blob: Blob) => void;
};

export function KitOutput({ kit, onChange, thumbBlobs, onThumb }: Props) {
  const srt = useMemo(() => toSrt(kit.cues.map((c, i) => ({ id: String(i), ...c }))), [kit.cues]);

  return (
    <div className="space-y-6">
      {/* Chapters + captions */}
      <Section
        title={
          <>
            Chapters <span className="text-muted font-normal">· {kit.chapters.length} found</span>
          </>
        }
        aside={<CopyButton text={chapterLines(kit.chapters)} label="Copy chapters" />}
      >
        <ol className="font-mono text-sm space-y-1">
          {kit.chapters.map((c) => (
            <li key={`${c.start}-${c.title}`} className="flex items-baseline gap-3">
              <span className="w-14 shrink-0 text-[#FFD23F] tabular-nums">{stamp(c.start)}</span>
              <span className="font-sans flex-1">{c.title}</span>
              {c.source !== "subtitles" && <span className="font-sans text-[11px] text-warning">{c.source}</span>}
            </li>
          ))}
        </ol>
        {kit.notes.length > 0 && (
          <div className="mt-4">
            <Alert tone="warn">
              <ul className="list-disc pl-4 space-y-1">
                {kit.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
      </Section>

      <Section
        title={
          <>
            Captions <span className="text-muted font-normal">· {kit.cues.length} lines · {captionSource(kit)}</span>
          </>
        }
        aside={
          <Button size="sm" onClick={() => downloadBlob(new Blob([srt], { type: "application/x-subrip" }), "captions.srt")}>
            Download .srt
          </Button>
        }
      >
        <pre className="max-h-56 overflow-auto rounded-xl bg-bg/70 border border-line-strong/60 p-3.5 text-xs leading-5 text-muted whitespace-pre-wrap">
          {srt.slice(0, 6000)}
          {srt.length > 6000 ? "\n…" : ""}
        </pre>
      </Section>

      <SeoPanel kit={kit} onChange={onChange} />

      {kit.seo && <SeoOutput kit={kit} onChange={onChange} />}

      <Thumbnails kit={kit} onChange={onChange} thumbBlobs={thumbBlobs} onThumb={onThumb} />
    </div>
  );
}

function captionSource(kit: Kit) {
  if (kit.source.captions === "project") return "from the Home subtitles";
  if (kit.source.captions === "srt") return "from your .srt";
  return "estimated timing";
}

// ───────────────────────── SEO prompt + paste ─────────────────────────

function SeoPanel({ kit, onChange }: { kit: Kit; onChange: (p: Partial<Kit>) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const prompt = buildPrompt(kit);

  function apply(text: string) {
    const r = parseSeo(text);
    if (!r.ok) {
      setError(r.error);
      setWarnings([]);
      return;
    }
    setError(null);
    setWarnings(r.warnings);
    const v = r.value;
    const first = v.titles.findIndex((t) => t.length <= LIMITS.titleMax);
    onChange({
      pasted: text,
      seo: v,
      titles: v.titles,
      chosenTitle: Math.max(0, first),
      description: v.description,
      tags: v.tags,
      hashtags: v.hashtags,
      pinned: v.pinned_comment,
      short: v.short_idea,
    });
  }

  return (
    <Section
      title="SEO text"
      aside={<span className="text-xs text-muted tabular-nums">{prompt.length.toLocaleString()} characters</span>}
    >
      <ol className="space-y-4 text-sm">
        <li className="flex flex-wrap items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-[#FFD23F] text-[#1B1B1B] grid place-items-center text-xs font-bold">1</span>
          <CopyButton text={prompt} label="Copy SEO prompt" />
          <span className="text-muted text-xs">Paste it into ChatGPT or Claude (any free plan works).</span>
        </li>
        <li className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-[#FFD23F] text-[#1B1B1B] grid place-items-center text-xs font-bold">2</span>
            <span className="text-muted text-xs">Paste the JSON answer here.</span>
          </div>
          <textarea
            rows={7}
            className={`${areaCls} font-mono text-xs`}
            value={kit.pasted}
            placeholder='{ "titles": [ … ], "description": "…", … }'
            onChange={(e) => onChange({ pasted: e.target.value })}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (text) setTimeout(() => apply(text), 0);
            }}
          />
          <div className="flex items-center gap-3">
            <Button variant="primary" disabled={!kit.pasted.trim()} onClick={() => apply(kit.pasted)}>
              Fill in the kit
            </Button>
            {kit.seo && !error && <span className="text-xs text-success">Filled from the pasted answer</span>}
          </div>
        </li>
      </ol>
      {error && (
        <div className="mt-4">
          <Alert tone="error">{error} Your pasted text is kept above.</Alert>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-4">
          <Alert tone="warn">{warnings.join(" ")}</Alert>
        </div>
      )}
    </Section>
  );
}

// ───────────────────────── Titles, description, tags … ─────────────────────────

function SeoOutput({ kit, onChange }: { kit: Kit; onChange: (p: Partial<Kit>) => void }) {
  const [tagDraft, setTagDraft] = useState("");
  const tagLen = tagsLength(kit.tags);
  const lines = kit.description.trim().split("\n").filter((l) => l.trim());
  const hasDisclaimer = lines[lines.length - 1]?.trim() === DISCLAIMER;

  function setTitle(i: number, text: string) {
    const titles = [...kit.titles];
    titles[i] = text;
    onChange({ titles });
  }

  /** Puts the built chapters into the description, replacing any chapter lines there. */
  function insertChapters() {
    const block = chapterLines(kit.chapters);
    const rows = kit.description.split("\n");
    const head = rows.findIndex((l) => /^\s*chapters\s*:?\s*$/i.test(l));
    if (head >= 0) {
      let end = head + 1;
      while (end < rows.length && /^\s*\d{1,2}:\d{2}/.test(rows[end])) end++;
      rows.splice(head + 1, end - head - 1, ...block.split("\n"));
      onChange({ description: rows.join("\n") });
    } else {
      onChange({ description: `${kit.description.trim()}\n\nChapters:\n${block}` });
    }
  }

  function addTag() {
    const t = tagDraft.replace(/,/g, " ").trim();
    if (t && !kit.tags.includes(t)) onChange({ tags: [...kit.tags, t] });
    setTagDraft("");
  }

  return (
    <>
      <Section title="Titles" aside={<span className="text-xs text-muted">Pick one · under 60 shows in full</span>}>
        <div className="grid gap-3">
          {kit.titles.map((t, i) => {
            const n = t.length;
            const blocked = n > LIMITS.titleMax;
            const chosen = kit.chosenTitle === i;
            return (
              <div
                key={i}
                onClick={() => !blocked && onChange({ chosenTitle: i })}
                className={`rounded-xl border p-3.5 flex items-center gap-3 cursor-pointer transition-colors ${
                  chosen
                    ? blocked
                      ? "border-error/60 bg-error/10"
                      : "border-accent/60 bg-accent/12"
                    : "border-line-strong/60 bg-bg/40 hover:border-line-strong"
                }`}
              >
                <span
                  className={`w-4 h-4 shrink-0 rounded-full border-2 grid place-items-center ${chosen ? "border-accent" : "border-line-strong"}`}
                  aria-hidden
                >
                  {chosen && <span className="w-2 h-2 rounded-full bg-accent" />}
                </span>
                <input
                  value={t}
                  onChange={(e) => setTitle(i, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Title option ${i + 1}`}
                  className="flex-1 min-w-0 bg-transparent text-[15px] font-medium focus:outline-none"
                />
                <span className="shrink-0 text-right">
                  <Counter n={n} max={LIMITS.titleMax} warn={LIMITS.titleWarn} />
                  {blocked ? (
                    <span className="block text-[11px] text-error">Over YouTube&apos;s 100 limit</span>
                  ) : n > LIMITS.titleWarn ? (
                    <span className="block text-[11px] text-warning">May be cut off</span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Description"
        aside={
          <>
            <Counter n={kit.description.length} max={LIMITS.description} />
            <Button size="sm" onClick={insertChapters}>
              Use built chapters
            </Button>
            {!hasDisclaimer && (
              <Button size="sm" onClick={() => onChange({ description: `${kit.description.trimEnd()}\n\n${DISCLAIMER}` })}>
                Add disclaimer
              </Button>
            )}
            <CopyButton text={kit.description} />
          </>
        }
      >
        <textarea rows={16} className={areaCls} value={kit.description} onChange={(e) => onChange({ description: e.target.value })} />
        {kit.description.length > LIMITS.description && <p className="mt-2 text-xs text-error">YouTube allows 5,000 characters.</p>}
      </Section>

      <Section
        title="Tags"
        aside={
          <>
            <Counter n={tagLen} max={LIMITS.tags} />
            <CopyButton text={kit.tags.join(", ")} />
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          {kit.tags.map((t) => (
            <span key={t} className="h-8 pl-3 pr-1.5 rounded-full border border-line-strong/60 bg-bg/50 text-xs inline-flex items-center gap-1.5">
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => onChange({ tags: kit.tags.filter((x) => x !== t) })}
                className="w-5 h-5 rounded-full grid place-items-center text-muted hover:text-error hover:bg-error/15"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === ",") && (e.preventDefault(), addTag())}
            onBlur={addTag}
            placeholder="Add a tag…"
            className="h-8 px-3 rounded-full bg-transparent border border-dashed border-line-strong text-xs focus:outline-none focus:border-link w-36"
          />
        </div>
        {tagLen >= LIMITS.tags && <p className="mt-2 text-xs text-error">Over 500 characters — remove the least specific tags.</p>}
      </Section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Section title="Hashtags" aside={<CopyButton text={kit.hashtags.join(" ")} />}>
          <input
            className={fieldCls}
            value={kit.hashtags.join(" ")}
            onChange={(e) => onChange({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })}
            onBlur={() => onChange({ hashtags: kit.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)) })}
          />
        </Section>
        <Section title="Pinned comment" aside={<CopyButton text={kit.pinned} />}>
          <textarea rows={2} className={areaCls} value={kit.pinned} onChange={(e) => onChange({ pinned: e.target.value })} />
        </Section>
      </div>

      <Section title="Short idea" aside={<CopyButton text={kit.short} />}>
        <textarea rows={4} className={areaCls} value={kit.short} onChange={(e) => onChange({ short: e.target.value })} />
      </Section>
    </>
  );
}

// ───────────────────────── Thumbnails ─────────────────────────

const POSITIONS: { value: ThumbPosition; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
];

function Thumbnails({ kit, onChange, thumbBlobs, onThumb }: Props) {
  const [active, setActive] = useState<string | null>(kit.thumbs[0]?.id ?? null);
  const [dir, setDir] = useState(kit.imagesDir ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = kit.thumbs.find((t) => t.id === active) ?? kit.thumbs[0] ?? null;
  const texts = kit.seo?.thumbnail_texts ?? [];

  function update(patch: Partial<ThumbSpec>) {
    if (!spec) return;
    onChange({ thumbs: kit.thumbs.map((t) => (t.id === spec.id ? { ...t, ...patch } : t)) });
  }

  function add() {
    if (kit.thumbs.length >= MAX_THUMBS || !kit.images.length) return;
    const base = spec ?? null;
    const t: ThumbSpec = {
      id: uid(),
      image: base?.image ?? kit.images[0].path,
      text: texts[kit.thumbs.length] ?? base?.text ?? "",
      color: base?.color ?? "#FFD23F",
      position: base?.position ?? "left",
      size: base?.size ?? 130,
      band: base?.band ?? true,
    };
    onChange({ thumbs: [...kit.thumbs, t] });
    setActive(t.id);
  }

  function remove(id: string) {
    const thumbs = kit.thumbs.filter((t) => t.id !== id);
    onChange({ thumbs });
    setActive(thumbs[0]?.id ?? null);
  }

  async function loadFolder() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/publish/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      onChange({ images: j.images, imagesDir: dir });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section
      title={
        <>
          Thumbnails <span className="text-muted font-normal">· 1280×720 JPG, up to {MAX_THUMBS} versions</span>
        </>
      }
      aside={
        <Button size="sm" variant="primary" onClick={add} disabled={kit.thumbs.length >= MAX_THUMBS || !kit.images.length}>
          + New version
        </Button>
      }
    >
      <div className="space-y-4">
        {(!kit.images.length || kit.source.mode === "upload") && (
          <div className="space-y-2">
            <span className="block text-xs font-medium text-muted">Shot images folder {kit.images.length ? `· ${kit.images.length} images` : ""}</span>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <PathField value={dir} onChange={setDir} placeholder="/Users/you/Videos/Part1/shots" prompt="Choose the folder with 001.png, 002.png…" />
              </div>
              <Button onClick={loadFolder} disabled={loading || !dir.trim()}>
                {loading ? "Loading…" : "Load"}
              </Button>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
          </div>
        )}

        {kit.thumbs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {kit.thumbs.map((t, i) => (
              <ThumbCard
                key={t.id}
                spec={t}
                index={i}
                active={spec?.id === t.id}
                blob={thumbBlobs[t.id]}
                onSelect={() => setActive(t.id)}
                onRemove={() => remove(t.id)}
                onRendered={(b) => onThumb(t.id, b)}
              />
            ))}
          </div>
        )}

        {!kit.thumbs.length && (
          <p className="text-sm text-muted">
            {kit.images.length ? "Click “New version” to make a thumbnail from one of the shots." : "Load the shot images folder to make thumbnails."}
          </p>
        )}

        {spec && (
          <div className="rounded-xl border border-line-strong/60 bg-bg/40 p-4 space-y-4">
            <div className="space-y-2">
              <span className="block text-xs font-medium text-muted">Text</span>
              <input className={fieldCls} value={spec.text} onChange={(e) => update({ text: e.target.value })} placeholder="3–5 punchy words" />
              {texts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {texts.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => update({ text: t })}
                      className={`h-8 px-3 rounded-full border text-xs transition-colors ${
                        spec.text === t ? "border-[#FFD23F]/60 bg-[#FFD23F]/12 text-[#FFD23F]" : "border-line-strong/60 text-muted hover:text-fg hover:border-line-strong"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="block text-xs font-medium text-muted">Position</span>
                <div className="grid grid-cols-4 bg-bg/70 border border-line-strong/60 rounded-xl p-1 gap-1">
                  {POSITIONS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => update({ position: p.value })}
                      className={`h-8 rounded-lg text-xs font-medium transition-all ${
                        spec.position === p.value ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg hover:bg-chip"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <span className="block text-xs font-medium text-muted">Colour and band</span>
                <div className="flex items-center gap-2">
                  {(["#FFD23F", "#FFFFFF"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => update({ color: c })}
                      aria-label={c === "#FFD23F" ? "Yellow" : "White"}
                      className={`w-9 h-9 rounded-lg border-2 transition-transform ${spec.color === c ? "border-link scale-105" : "border-line-strong"}`}
                      style={{ background: c }}
                    />
                  ))}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={spec.band}
                    onClick={() => update({ band: !spec.band })}
                    className={`ml-2 h-9 px-3 rounded-lg border text-xs font-medium transition-colors ${
                      spec.band ? "border-accent/50 bg-accent/15 text-fg" : "border-line-strong/60 text-muted hover:text-fg"
                    }`}
                  >
                    Dark band {spec.band ? "on" : "off"}
                  </button>
                </div>
              </div>
            </div>

            <label className="block space-y-2">
              <span className="flex justify-between text-xs font-medium text-muted">
                <span>Text size</span>
                <span className="tabular-nums">{spec.size}px</span>
              </span>
              <input type="range" min={60} max={220} step={2} value={spec.size} onChange={(e) => update({ size: Number(e.target.value) })} className="w-full" />
            </label>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-muted">Background shot</span>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {kit.images.map((img) => (
                  <button
                    key={img.path}
                    type="button"
                    onClick={() => update({ image: img.path })}
                    title={img.name}
                    className={`shrink-0 w-28 aspect-video rounded-lg overflow-hidden border-2 transition-colors ${
                      spec.image === img.path ? "border-[#FFD23F]" : "border-transparent hover:border-line-strong"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- local files streamed by /api/file */}
                    <img src={fileUrl(img.path)} alt={img.name} loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

/** Renders one version on a canvas (debounced), reports its JPEG, offers it for download. */
function ThumbCard({
  spec,
  index,
  active,
  blob,
  onSelect,
  onRemove,
  onRendered,
}: {
  spec: ThumbSpec;
  index: number;
  active: boolean;
  blob?: Blob;
  onSelect: () => void;
  onRemove: () => void;
  onRendered: (b: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const rendered = useRef(onRendered);
  useEffect(() => {
    rendered.current = onRendered;
  });
  const key = JSON.stringify(spec);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        await drawThumb(canvas, JSON.parse(key) as ThumbSpec);
        const b = await thumbJpeg(canvas);
        if (!cancelled) {
          setError(null);
          rendered.current(b);
        }
      } catch {
        if (!cancelled) setError("Could not load that image.");
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key]);

  const mb = blob ? blob.size / 1024 / 1024 : null;
  return (
    <div
      onClick={onSelect}
      className={`rounded-xl border p-2 space-y-2 cursor-pointer transition-colors ${active ? "border-[#FFD23F]/70 bg-[#FFD23F]/5" : "border-line-strong/60 hover:border-line-strong"}`}
    >
      <canvas ref={canvasRef} width={1280} height={720} className="w-full aspect-video rounded-lg bg-black" />
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">Version {index + 1}</span>
        {mb !== null && <span className={`tabular-nums ${mb < 2 ? "text-muted" : "text-error"}`}>{mb.toFixed(2)} MB</span>}
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            disabled={!blob}
            onClick={(e) => {
              e.stopPropagation();
              if (blob) downloadBlob(blob, `thumbnail_${index + 1}.jpg`);
            }}
            className="h-7 px-2.5 rounded-lg bg-chip hover:bg-hover border border-line-strong font-medium disabled:opacity-40"
          >
            Download
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="h-7 px-2 rounded-lg text-muted hover:text-error hover:bg-error/15"
            aria-label={`Remove version ${index + 1}`}
          >
            ×
          </button>
        </span>
      </div>
    </div>
  );
}
