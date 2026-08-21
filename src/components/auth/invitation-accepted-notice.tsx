"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";

type InvitationNotice = {
  id: string;
  count: number;
};

type InvitationAcceptedNoticeProps = {
  notice: InvitationNotice;
};

export function InvitationAcceptedNotice({
  notice,
}: InvitationAcceptedNoticeProps) {
  const { update } = useSession();
  const [isVisible, setIsVisible] = useState(true);
  const [isDismissing, setIsDismissing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isVisible) return null;

  async function dismiss() {
    setIsDismissing(true);
    setErrorMessage(null);
    try {
      const updatedSession = await update({
        dismissedInvitationNoticeId: notice.id,
      });
      if (!updatedSession || updatedSession.invitationNotice) {
        throw new Error("Invitation notice was not cleared.");
      }
      setIsVisible(false);
    } catch {
      setIsDismissing(false);
      setErrorMessage("暫時無法關閉通知，請再試一次。");
    }
  }

  return (
    <div className="mt-6 flex min-w-0 flex-col gap-3 rounded-card border border-positive/30 bg-positive-soft px-4 py-3.5 text-caption leading-6 text-positive sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
      <p role="status" className="min-w-0 font-medium">
        {notice.count === 1
          ? "協作邀請已接受，婚宴已加入下方清單。"
          : `已接受 ${notice.count} 個協作邀請，婚宴已加入下方清單。`}
      </p>
      <button
        type="button"
        disabled={isDismissing}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-control border border-positive/40 px-4 font-semibold transition hover:bg-positive/10 disabled:cursor-wait disabled:opacity-60"
        onClick={dismiss}
      >
        {isDismissing ? "關閉中…" : "知道了"}
      </button>
      {errorMessage ? (
        <p role="alert" className="font-medium text-danger">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
