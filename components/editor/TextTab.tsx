"use client";
import { Button, Label, Toggle, inputCls } from "@/components/ui";
import { TEXT_FONTS } from "@/lib/fonts";
import { player } from "@/lib/editor/player";
import { projectStore, select, selectionStore, timeStore, updateProject, useStore } from "@/lib/editor/store";
import { formatTime, parseTime, uid } from "@/lib/editor/timing";
import { BRAND, TEXT_ANIMS, textAnim, type TextAnim, type TextClip } from "@/lib/editor/types";

export function newText(start: number, partial: Partial<TextClip> = {}): TextClip {
  return {
    id: uid(),
    text: "Your text",
    start: Math.max(0, start),
    duration: 3,
    x: 0.5,
    y: 0.5,
    size: 84,
    font: "montserrat",
    color: BRAND.white,
    bold: true,
    background: false,
    bgColor: BRAND.black,
    fade: true,
    align: "center",
    anim: "pop",
    animDur: 0.3,
    ...partial,
  };
}

const PRESETS: { label: string; make: (t: number) => Partial<TextClip> }[] = [
  { label: "Title", make: () => ({ text: "Title", size: 128, y: 0.45, font: "bebas" }) },
  { label: "Lower third", make: () => ({ text: "Name / place", size: 48, x: 0.06, y: 0.88, align: "left", background: true, anim: "slide-in" }) },
  { label: "Highlight", make: () => ({ text: "Key point", size: 64, y: 0.12, color: BRAND.black, background: true, bgColor: BRAND.yellow }) },
];

const COLS = [
  { key: "left", x: 0.06 },
  { key: "center", x: 0.5 },
  { key: "right", x: 0.94 },
] as const;
const ROWS = [
  { key: "top", y: 0.12 },
  { key: "middle", y: 0.5 },
  { key: "bottom", y: 0.88 },
] as const;

const SIZES = [32, 40, 48, 56, 64, 72, 84, 96, 110, 128, 150, 180];
const ANIM_DURS = [0.1, 0.2, 0.3, 0.4, 0.5];
const SWATCHES = [
  { value: BRAND.yellow, label: "Yellow" },
  { value: BRAND.black, label: "Black" },
  { value: BRAND.white, label: "White" },
];

export function TextTab() {
  const p = useStore(projectStore, (s) => s)!;
  const sel = useStore(selectionStore, (s) => s);
  const current = sel.kind === "text" ? p.texts.find((t) => t.id === sel.ids[0]) : undefined;
  const set = (patch: Partial<TextClip>) =>
    current && updateProject((s) => ({ ...s, texts: s.texts.map((t) => (t.id === current.id ? { ...t, ...patch } : t)) }));

  const add = (partial: Partial<TextClip> = {}) => {
    const t = newText(timeStore.get(), partial);
    updateProject((s) => ({ ...s, texts: [...s.texts, t] }));
    select("text", t.id);
  };

  const anim = current ? textAnim(current) : "none";
  const animDur = current?.animDur ?? 0.3;

  return (
    <div className="p-4 space-y-5">
      <div className="space-y-2">
        <Button variant="primary" className="w-full rounded-xl" onClick={() => add()}>
          + Add text at playhead
        </Button>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((pr) => (
            <Button key={pr.label} size="sm" className="rounded-lg" onClick={() => add(pr.make(timeStore.get()))}>
              {pr.label}
            </Button>
          ))}
        </div>
      </div>

      {current ? (
        <div className="space-y-4">
          <div>
            <Label>Text</Label>
            <textarea
              className={`${inputCls} !h-auto py-2 min-h-[72px] resize-y rounded-xl`}
              value={current.text}
              onChange={(e) => set({ text: e.target.value })}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TimeField label="Start" value={current.start} onChange={(v) => set({ start: Math.max(0, v) })} />
            <TimeField label="On screen for" value={current.duration} onChange={(v) => set({ duration: Math.max(0.2, v) })} />
          </div>

          <div>
            <Label hint="or drag it on the preview">Position</Label>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-bg/60 border border-line-strong/60 p-1.5 w-full">
              {ROWS.map((r) =>
                COLS.map((c) => {
                  const on = Math.abs(current.x - c.x) < 0.01 && Math.abs(current.y - r.y) < 0.01;
                  const name = `${r.key === "middle" ? "Middle" : r.key[0].toUpperCase() + r.key.slice(1)} ${c.key}`;
                  return (
                    <button
                      key={r.key + c.key}
                      type="button"
                      title={name}
                      aria-label={name}
                      onClick={() => set({ x: c.x, y: r.y, align: c.key })}
                      className={`h-9 rounded-lg flex px-2.5 py-2 transition-colors ${on ? "bg-accent" : "bg-chip/60 hover:bg-hover"} ${
                        c.key === "left" ? "justify-start" : c.key === "right" ? "justify-end" : "justify-center"
                      } ${r.key === "top" ? "items-start" : r.key === "bottom" ? "items-end" : "items-center"}`}
                    >
                      <span className={`block h-1 rounded-full ${on ? "w-5 bg-white" : "w-4 bg-muted/60"}`} />
                    </button>
                  );
                }),
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Font</Label>
              <select className={`${inputCls} rounded-xl`} value={current.font} onChange={(e) => set({ font: e.target.value })}>
                {TEXT_FONTS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Size</Label>
              <select className={`${inputCls} rounded-xl`} value={current.size} onChange={(e) => set({ size: Number(e.target.value) })}>
                {(SIZES.includes(current.size) ? SIZES : [...SIZES, current.size].sort((a, b) => a - b)).map((v) => (
                  <option key={v} value={v}>
                    {v}px
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>Text colour</Label>
            <Swatches value={current.color} onChange={(v) => v && set({ color: v })} />
          </div>
          <div>
            <Label>Background</Label>
            <Swatches
              value={current.background ? current.bgColor : null}
              allowNone
              onChange={(v) => (v ? set({ background: true, bgColor: v }) : set({ background: false }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Animation</Label>
              <select
                className={`${inputCls} rounded-xl`}
                value={anim}
                onChange={(e) => set({ anim: e.target.value as TextAnim, fade: e.target.value !== "none", animDur })}
              >
                {TEXT_ANIMS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Animation speed</Label>
              <select
                className={`${inputCls} rounded-xl`}
                value={animDur}
                disabled={anim === "none"}
                onChange={(e) => set({ animDur: Number(e.target.value), anim })}
              >
                {(ANIM_DURS.includes(animDur) ? ANIM_DURS : [...ANIM_DURS, animDur].sort((a, b) => a - b)).map((v) => (
                  <option key={v} value={v}>
                    {v}s
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Toggle checked={current.bold} onChange={(v) => set({ bold: v })} label="Bold" />
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                updateProject((s) => ({ ...s, texts: s.texts.filter((t) => t.id !== current.id) }));
                selectionStore.set({ kind: null, ids: [] });
              }}
            >
              Delete text
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Select a text clip on the timeline or preview to edit it.</p>
      )}

      {p.texts.length > 0 && (
        <div>
          <Label>All text ({p.texts.length})</Label>
          <div className="space-y-1">
            {[...p.texts]
              .sort((a, b) => a.start - b.start)
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    select("text", t.id);
                    player.seek(t.start + 0.01);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-sm flex gap-2 ${
                    current?.id === t.id ? "bg-hover" : "hover:bg-chip"
                  }`}
                >
                  <span className="font-mono text-xs text-muted pt-0.5">{formatTime(t.start, false)}</span>
                  <span className="truncate">{t.text || "(empty)"}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Brand colour swatches + a custom colour; `allowNone` adds a "None" choice (null). */
export function Swatches({
  value,
  onChange,
  allowNone,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
}) {
  const norm = (c: string) => c.slice(0, 7).toLowerCase();
  const isBrand = value !== null && SWATCHES.some((s) => norm(s.value) === norm(value));
  const ring = (on: boolean) => (on ? "ring-2 ring-link ring-offset-2 ring-offset-surface" : "ring-1 ring-line-strong hover:ring-muted");
  return (
    <div className="flex items-center gap-2.5">
      {allowNone && (
        <button
          type="button"
          title="None"
          aria-label="None"
          onClick={() => onChange(null)}
          className={`relative w-8 h-8 rounded-full bg-bg overflow-hidden transition ${ring(value === null)}`}
        >
          <span className="absolute left-1/2 top-1/2 h-[2px] w-9 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-error" />
        </button>
      )}
      {SWATCHES.map((s) => (
        <button
          key={s.value}
          type="button"
          title={s.label}
          aria-label={s.label}
          onClick={() => onChange(s.value)}
          style={{ background: s.value }}
          className={`w-8 h-8 rounded-full transition ${ring(value !== null && norm(value) === norm(s.value))}`}
        />
      ))}
      <label
        title="Custom colour"
        className={`relative w-8 h-8 rounded-full cursor-pointer overflow-hidden transition ${ring(value !== null && !isBrand)}`}
        style={{
          background: value !== null && !isBrand ? value : "conic-gradient(#f04438, #f79009, #FFD23F, #12b76a, #465fff, #a855f7, #f04438)",
        }}
      >
        <input
          type="color"
          value={value ? norm(value) : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
      {value !== null && <span className="text-xs text-muted font-mono uppercase">{norm(value)}</span>}
    </div>
  );
}

export function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        key={value}
        className={`${inputCls} font-mono`}
        defaultValue={formatTime(value, false)}
        onBlur={(e) => {
          const v = parseTime(e.target.value);
          if (v !== null) onChange(v);
          else e.target.value = formatTime(value, false);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}
