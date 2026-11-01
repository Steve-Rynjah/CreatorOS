import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { fontVariables } from "@/lib/fonts";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "CreatorOS",
  description: "Image + voice-over video editor and part merger for YouTube creators",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="h-full flex flex-col bg-bg text-fg overflow-hidden">
        <header className="h-14 shrink-0 flex items-center gap-6 px-4 border-b border-line">
          <Link href="/editor" className="flex items-center gap-2 select-none">
            <span className="grid place-items-center w-8 h-[22px] rounded-md bg-accent">
              <svg width="10" height="12" viewBox="0 0 10 12" fill="white" aria-hidden>
                <path d="M0 0l10 6-10 6z" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight">CreatorOS</span>
          </Link>
          <Nav />
        </header>
        <main className="flex-1 min-h-0">{children}</main>
      </body>
    </html>
  );
}
