"use client";
import { useRef, useState, type ReactNode } from "react";
import { CheckBadge, cardCls } from "@/components/editor/Setup";

/** Same look as the Home tab's selects. */
export const fieldCls =
  "w-full h-11 px-3.5 rounded-xl bg-bg/70 border border-line-strong/60 text-sm text-fg placeholder:text-subtle focus:outline-none focus:border-link transition-colors hover:border-line-strong";
export const areaCls =
  "w-full px-3.5 py-3 rounded-xl bg-bg/70 border border-line-strong/60 text-sm text-fg leading-6 placeholder:text-subtle focus:outline-none focus:border-link transition-colors hover:border-line-strong resize-y";

export function Section({
  title,
  aside,
  children,
  className = "",
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line-strong/60 bg-raised/60 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <div className="flex items-center gap-2">{aside}</div>}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

export function CopyButton({ text, label = "Copy", disabled }: { text: string | (() => string); label?: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={copy}
      disabled={disabled}
      className="h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 bg-chip hover:bg-hover border border-line-strong text-fg transition-colors disabled:opacity-40 disabled:pointer-events-none"
    >
      {done ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-success" aria-hidden>
          <path d="M5 12l5 5 9-10" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 012-2h10" />
        </svg>
      )}
      {done ? "Copied" : label}
    </button>
  );
}

/** "123 / 5,000" — amber past `warn`, red past `max`. */
export function Counter({ n, max, warn }: { n: number; max: number; warn?: number }) {
  const tone = n > max ? "text-error" : warn !== undefined && n > warn ? "text-warning" : "text-muted";
  return (
    <span className={`text-xs tabular-nums ${tone}`}>
      {n.toLocaleString()} / {(warn ?? max).toLocaleString()}
    </span>
  );
}

/** A dashed upload card like the Home tab's PDF card, for any file type. */
export function FileCard({
  title,
  hint,
  accept,
  file,
  meta,
  busy,
  icon,
  tint,
  onFile,
  onClear,
}: {
  title: string;
  hint: string;
  accept: string;
  file: string | null;
  meta?: string | null;
  busy?: boolean;
  icon: ReactNode;
  /** Tailwind classes for the icon tile. */
  tint: string;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
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
        if (f) onFile(f);
      }}
      className={`${cardCls} ${
        over ? "border-link bg-link/10" : file ? "border-line-strong/60 bg-raised/60" : "border-dashed border-line-strong bg-raised/30 hover:border-link/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {file && !busy && <CheckBadge />}
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="flex flex-col gap-4 text-left outline-none">
        <span className={`w-12 h-12 rounded-xl grid place-items-center ring-1 group-hover:scale-105 transition-transform ${tint}`}>{icon}</span>
        <span className="min-w-0">
          <span className="block font-semibold truncate">{busy ? "Reading…" : (file ?? title)}</span>
          <span className="block text-xs text-muted mt-0.5 truncate">{busy ? "This takes a moment" : (meta ?? hint)}</span>
        </span>
      </button>
      {file && !busy && (
        <div className="flex items-center gap-4 text-xs">
          <button type="button" onClick={() => inputRef.current?.click()} className="text-link hover:underline">
            Replace
          </button>
          <button type="button" onClick={onClear} className="text-muted hover:text-error transition-colors">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

export const STEPS = ["Reading script", "Building captions", "Building chapters", "Ready for SEO"] as const;

/** Progress through the build: done steps tick green, the current one pulses. */
export function Steps({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {STEPS.map((label, i) => {
        const done = i < step || (i === STEPS.length - 1 && step === STEPS.length - 1);
        const current = i === step && !done;
        return (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${
              done ? "border-success/40 bg-success/10 text-fg" : current ? "border-accent/50 bg-accent/15 text-fg" : "border-line-strong/60 text-muted"
            }`}
          >
            <span
              className={`w-5 h-5 shrink-0 rounded-full grid place-items-center text-[10px] ${
                done ? "bg-success text-white" : current ? "bg-accent text-white animate-pulse" : "border border-line-strong"
              }`}
            >
              {done ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12l5 5 9-10" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
