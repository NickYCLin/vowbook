import type { Metadata } from "next";
import { PublicInformation } from "@/components/public-information";
import { privacySections } from "@/content/service-information";

export const metadata: Metadata = { title: "資料使用說明（待維運確認）", robots: { index: false, follow: false } };

export default function PrivacyPage() {
  return <PublicInformation title="資料使用說明" sections={privacySections} />;
}
