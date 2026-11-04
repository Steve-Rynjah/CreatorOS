import type { Metadata } from "next";
import { PublishKit } from "@/components/publish/PublishKit";

export const metadata: Metadata = { title: "Publish Kit · CreatorOS" };

export default function PublishPage() {
  return <PublishKit />;
}
