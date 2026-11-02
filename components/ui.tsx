"use client";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const v = {
    primary: "bg-accent hover:bg-accent-hover text-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]",
    secondary: "bg-chip hover:bg-hover text-fg border border-line-strong",
    ghost: "hover:bg-chip text-fg",
    danger: "hover:bg-error/15 text-error",
  }[variant];
  const s = { sm: "h-7 px-2.5 text-xs", md: "h-9 px-4 text-sm", lg: "h-11 px-6 text-base" }[size];
  return (
    <button
      className={`${v} ${s} rounded-lg font-medium inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none ${className}`}
      {...rest}
    />
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-1.5">
      <span className="text-xs font-medium text-muted uppercase tracking-wide">{children}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export const inputCls =
  "w-full h-9 px-3 rounded-lg bg-bg border border-line-strong text-sm text-fg placeholder:text-subtle focus:outline-none focus:border-link";

/** Text field for a local folder path, with a native “Browse…” picker on macOS. */
export function PathField({
  value,
  onChange,
  placeholder,
  prompt,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prompt?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function browse() {
    setBusy(true);
    try {
      const r = await fetch("/api/pick-folder", { method: "POST", body: JSON.stringify({ prompt }) });
      const j = await r.json();
      if (j.path) onChange(j.path);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-2">
      <input
        className={`${inputCls} font-mono text-[13px]`}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onDrop={(e) => {
          const text = e.dataTransfer.getData("text/plain");
          if (text) {
            e.preventDefault();
            onChange(text);
          }
        }}
      />
      <Button type="button" onClick={browse} disabled={busy} className="shrink-0">
        {busy ? "Choosing…" : "Browse…"}
      </Button>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer select-none text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-accent" : "bg-hover"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </button>
      {label}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex bg-bg border border-line rounded-lg p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${
            value === o.value ? "bg-chip text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-full bg-hover rounded-full overflow-hidden">
      <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const t = {
    info: "border-link/30 bg-link/10",
    warn: "border-warning/30 bg-warning/10",
    error: "border-error/40 bg-error/10",
    ok: "border-success/40 bg-success/10",
  }[tone];
  return <div className={`text-sm rounded-lg border px-3 py-2 ${t}`}>{children}</div>;
}

/** Polls a server job until it finishes. */
export async function pollJob<T>(
  jobId: string,
  onUpdate: (j: { progress: number; stage: string }) => void,
): Promise<T> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    const r = await fetch(`/api/jobs/${jobId}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Job lost");
    onUpdate(j);
    if (j.status === "done") return j.result as T;
    if (j.status === "error") throw new Error(j.error);
  }
}
