import type { Metadata } from "next";
import "./globals.css";
import { fontVariables } from "@/lib/fonts";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "CreatorOS",
  description: "Image + voice-over video editor and part merger for YouTube creators",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="h-full bg-bg text-fg overflow-hidden font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
