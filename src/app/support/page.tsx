import type { Metadata } from "next";
import { PublicInformation } from "@/components/public-information";
import { supportSections, supportStatus } from "@/content/service-information";

export const metadata: Metadata = { title: "使用說明與支援", robots: { index: false, follow: false } };

export default function SupportPage() {
  return <PublicInformation title="使用說明與支援" sections={supportSections} status={supportStatus} />;
}
