import type { Metadata } from "next";
import { Editor } from "@/components/editor/Editor";

export const metadata: Metadata = { title: "Home · CreatorOS" };

export default function Home() {
  return <Editor />;
}
