import Link from "next/link";
import { SignInButton } from "@/components/auth/sign-in-button";
import { Wordmark } from "@/components/brand/wordmark";
import { normalizeCallbackUrl } from "@/lib/base-path";

type SignInPageProps = {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
  }>;
};

const OAUTH_ERROR_CODES = new Set([
  "OAuth",
  "OAuthSignin",
  "OAuthCallback",
  "OAuthCallbackError",
  "OAuthCreateAccount",
  "OAuthAccountNotLinked",
  "Callback",
]);

const GENERIC_ERROR_CODES = new Set([
  "Default",
  "EmailCreateAccount",
  "EmailSignin",
  "CredentialsSignin",
  "Verification",
]);

function getAuthenticationErrorMessage(
  value: string | string[] | undefined,
) {
  const code = Array.isArray(value) ? value[0] : value;

  if (!code) {
    return null;
  }

  if (OAUTH_ERROR_CODES.has(code)) {
    return "Google 登入未能完成，請稍後再試。";
  }

  if (code === "AccessDenied") {
    return "此帳號目前無法登入誓約簿，請確認授權後再試。";
  }

  if (code === "Configuration") {
    return "登入服務目前無法使用，請稍後再試。";
  }

  if (code === "SessionRequired") {
    return "請先使用 Google 帳號登入，再繼續使用誓約簿。";
  }

  if (GENERIC_ERROR_CODES.has(code)) {
    return "登入未能完成，請稍後再試。";
  }

  return "登入未能完成，請稍後再試。";
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const callbackUrl = normalizeCallbackUrl(params.callbackUrl);
  const authenticationError = getAuthenticationErrorMessage(params.error);

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-lg border-y border-line bg-surface/85 px-6 py-12 text-center shadow-[0_18px_50px_rgba(75,55,42,0.08)] sm:px-12">
        <Wordmark />
        <p className="mt-10 text-sm font-semibold tracking-[0.18em] text-clay">
          歡迎回來
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold text-ink">
          從同一頁，繼續準備。
        </h1>
        <p className="mx-auto mt-5 max-w-sm leading-7 text-ink-soft">
          使用 Google 帳號登入。誓約簿只會以登入識別與基本資料建立你的帳號。
        </p>
        {authenticationError ? (
          <p
            role="alert"
            className="mx-auto mt-5 max-w-sm rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm leading-6 text-danger"
          >
            {authenticationError}
          </p>
        ) : null}
        <SignInButton
          callbackUrl={callbackUrl}
          label="使用 Google 登入"
          className="mx-auto mt-9 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-clay px-6 py-3 font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-70"
        />
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center text-sm text-ink-faint underline underline-offset-4 hover:text-ink"
        >
          返回首頁
        </Link>
      </section>
    </main>
  );
}
