import type { Metadata } from "next";
import { PublicInformation } from "@/components/public-information";
import { privacySections } from "@/content/service-information";

export const metadata: Metadata = { title: "隱私政策", robots: { index: false, follow: false } };

export default function PrivacyPage() {
  return <PublicInformation title="隱私政策" sections={privacySections} />;
}
