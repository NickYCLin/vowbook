"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { withBasePath } from "@/lib/base-path";
import { beginGoogleLink } from "./actions";

export function GoogleLinkButton({ nonce }: { nonce: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function begin() {
    setBusy(true); setError(false);
    try {
      await beginGoogleLink(nonce);
      await signIn("google", { callbackUrl: withBasePath("/mobile/link/google/complete") }, { prompt: "select_account" });
    } catch { setError(true); setBusy(false); }
  }
  return <>
    <button type="button" disabled={busy} onClick={begin} className="my-6 min-h-12 rounded-xl bg-clay px-5 py-3 text-white">
      {busy ? "正在前往 Google…" : "選擇要連結的 Google 帳號"}
    </button>
    {error && <p role="alert">連結要求已失效或服務暫時無法使用，請關閉視窗並從 App 設定重新開始。</p>}
  </>;
}
