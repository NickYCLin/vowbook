import type { Metadata } from "next";
import { GuestInvitationPortal } from "@/components/guests/guest-invitation-portal";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "賓客邀請", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() {
  return <main className="mx-auto max-w-3xl space-y-5 px-5 py-8"><h1 className="text-2xl font-semibold">賓客邀請</h1><GuestInvitationPortal /></main>;
}
