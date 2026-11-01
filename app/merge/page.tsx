import type { Metadata } from "next";
import { Merge } from "@/components/merge/Merge";

export const metadata: Metadata = { title: "Merge Videos · CreatorOS" };

export default function MergePage() {
  return <Merge />;
}
