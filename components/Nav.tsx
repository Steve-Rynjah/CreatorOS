"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/editor", label: "Video Editor" },
  { href: "/merge", label: "Merge Videos" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-2">
      {LINKS.map((l) => {
        const active = pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`h-8 px-3 rounded-lg text-sm font-medium flex items-center transition-colors ${
              active ? "bg-fg text-bg" : "bg-chip text-fg hover:bg-hover"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
