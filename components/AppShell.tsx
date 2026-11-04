"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

/** Sidebar tabs. Add a new entry here (plus its route) to add a tab. */
const NAV: { href: string; label: string; hint: string; icon: ReactNode }[] = [
  {
    href: "/",
    label: "Home",
    hint: "Script, voice-over and edit",
    icon: (
      <>
        <rect x="3.2" y="3.2" width="7" height="7" rx="2" />
        <rect x="13.8" y="3.2" width="7" height="7" rx="2" />
        <rect x="3.2" y="13.8" width="7" height="7" rx="2" />
        <rect x="13.8" y="13.8" width="7" height="7" rx="2" />
      </>
    ),
  },
  {
    href: "/merge",
    label: "Merge Videos",
    hint: "Join parts into one video",
    icon: (
      <>
        <rect x="2.8" y="5" width="8" height="14" rx="2" />
        <rect x="13.2" y="5" width="8" height="14" rx="2" opacity="0.55" />
      </>
    ),
  },
  {
    href: "/publish",
    label: "Publish Kit",
    hint: "Titles, chapters, captions and thumbnails",
    icon: (
      <>
        <rect x="2.8" y="4.5" width="18.4" height="15" rx="3" opacity="0.55" />
        <path d="M12 7.5l4.2 4.3h-2.7V16h-3v-4.2H7.8z" />
      </>
    ),
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // A drawer over the page on mobile, a column beside it on desktop.
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  function toggleSidebar() {
    if (window.matchMedia("(min-width: 1024px)").matches) setCollapsed((v) => !v);
    else setMenuOpen((v) => !v);
  }

  const current = NAV.find((n) => isActive(pathname, n.href)) ?? NAV[0];

  return (
    <div className="h-full">
      {menuOpen && (
        <button
          type="button"
          aria-label="Close the menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-bg/60 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[290px] flex-col border-r border-line bg-surface px-5 py-6 transition-transform duration-300 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:-translate-x-full" : "lg:translate-x-0"}`}
      >
        <Link href="/" className="flex items-center gap-3 px-2 select-none">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
            <svg width="14" height="16" viewBox="0 0 10 12" fill="#ffffff" aria-hidden>
              <path d="M1 0.6l8.4 5.4L1 11.4z" />
            </svg>
          </span>
          <span className="text-xl font-bold text-white">CreatorOS</span>
        </Link>

        <p className="mt-8 px-3 text-xs font-medium uppercase tracking-[0.12em] text-muted">Menu</p>

        <nav className="mt-3">
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      active ? "bg-accent/12 text-link" : "text-muted hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                      className={active ? "" : "text-muted"}
                    >
                      {item.icon}
                    </svg>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div
        className={`h-full flex flex-col transition-[margin] duration-300 ${
          collapsed ? "lg:ml-0" : "lg:ml-[290px]"
        }`}
      >
        <header className="shrink-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Toggle the menu"
              aria-expanded={menuOpen || !collapsed}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-white/5"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl leading-[30px] font-semibold text-white">{current.label}</h1>
              <p className="text-xs text-muted">{current.hint}</p>
            </div>
          </div>
        </header>

        <main key={pathname} className="animate-rise flex-1 min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}
