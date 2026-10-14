import type { Metadata } from "next";
import { PublicInformation } from "@/components/public-information";
import { supportSections } from "@/content/service-information";

export const metadata: Metadata = { title: "使用說明與支援（待維運確認）", robots: { index: false, follow: false } };

export default function SupportPage() {
  return <PublicInformation title="使用說明與支援狀態" sections={supportSections} />;
}
