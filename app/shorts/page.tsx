import type { Metadata } from "next";
import { ShortsMaker } from "@/components/shorts/ShortsMaker";

export const metadata: Metadata = { title: "Shorts Maker · CreatorOS" };

export default function ShortsPage() {
  return <ShortsMaker />;
}
