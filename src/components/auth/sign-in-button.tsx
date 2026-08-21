"use client";

import { signIn } from "next-auth/react";
import { useId, useState } from "react";
import { normalizeCallbackUrl } from "@/lib/base-path";

type SignInButtonProps = {
  callbackUrl?: string;
  className?: string;
  label?: string;
};

export function SignInButton({
  callbackUrl = "/dashboard",
  className = "",
  label = "使用 Google 開始規劃",
}: SignInButtonProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const errorMessageId = useId();

  async function handleSignIn() {
    setIsStarting(true);
    setErrorMessage(null);

    try {
      await signIn(
        "google",
        {
          callbackUrl: normalizeCallbackUrl(callbackUrl),
        },
        {
          prompt: "select_account",
        },
      );
    } catch {
      setIsStarting(false);
      setErrorMessage("無法開始 Google 登入，請再試一次。");
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={isStarting}
        aria-describedby={errorMessage ? errorMessageId : undefined}
        className={className}
        onClick={handleSignIn}
      >
        <span
          aria-hidden="true"
          className="grid size-6 place-items-center rounded-full bg-surface text-sm font-bold text-clay-strong"
        >
          G
        </span>
        {isStarting ? "正在前往 Google…" : label}
      </button>
      {errorMessage ? (
        <p
          id={errorMessageId}
          role="alert"
          aria-live="polite"
          className="mt-3 text-sm leading-6 text-danger"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
