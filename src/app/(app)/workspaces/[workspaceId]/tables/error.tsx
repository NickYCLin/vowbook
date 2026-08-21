"use client";

import Link from "next/link";

type TablesRouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function TablesRouteError({ reset }: TablesRouteErrorProps) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <section className="mx-auto max-w-3xl border-y border-line bg-surface/70 px-5 py-9 sm:px-8">
        <p className="text-sm font-semibold tracking-[0.14em] text-clay">
          暫時沒有讀到資料
        </p>
        <h1 className="mt-3 font-serif text-3xl font-semibold text-ink sm:text-4xl">
          桌次安排暫時無法開啟
        </h1>
        <p className="mt-4 leading-7 text-ink-soft">
          請稍後再試；若問題持續發生，可以先回到婚宴首頁。
        </p>
        <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 rounded-full border border-clay px-5 py-2 text-clay-strong transition hover:bg-clay-soft"
          >
            再試一次
          </button>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center text-ink-soft underline decoration-line-strong underline-offset-4"
          >
            回到我的婚宴
          </Link>
        </div>
      </section>
    </main>
  );
}
