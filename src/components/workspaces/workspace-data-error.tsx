import Link from "next/link";
import { Card } from "@/components/ui/card";

/**
 * 功能頁讀取失敗時的共用畫面。
 * 原本 guests / tables / tasks / budget / staff / timeline / members
 * 七個頁面各自複製一份幾乎相同的 JSX。
 */
export function WorkspaceDataError({
  sectionTitle,
  message,
  retryHref,
}: {
  sectionTitle: string;
  message: string;
  retryHref: string;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <Card className="mx-auto max-w-2xl">
        <div className="px-6 py-9 sm:px-8">
          <p className="text-eyebrow font-semibold text-clay uppercase">
            暫時沒有讀到資料
          </p>
          <h1 className="mt-2 font-serif text-2xl font-semibold text-ink sm:text-3xl">
            {sectionTitle}暫時無法開啟
          </h1>
          <p className="mt-4 text-caption leading-7 text-ink-soft sm:text-base">
            {message}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href={retryHref}
              className="inline-flex min-h-11 items-center justify-center rounded-control bg-clay px-4 text-sm font-semibold text-white transition hover:bg-clay-strong"
            >
              再試一次
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-clay-strong transition hover:border-clay hover:bg-clay-soft"
            >
              回到我的婚宴
            </Link>
          </div>
        </div>
      </Card>
    </main>
  );
}
