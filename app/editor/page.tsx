import type { Metadata } from "next";
import { Editor } from "@/components/editor/Editor";

export const metadata: Metadata = { title: "Video Editor · CreatorOS" };

export default function EditorPage() {
  return <Editor />;
}
