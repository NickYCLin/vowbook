"use client";

import Link from "next/link";

export default function MembersError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8">
      <h1 className="font-serif text-3xl font-semibold text-ink">
        暫時無法載入協作者
      </h1>
      <p className="mt-4 leading-7 text-ink-soft">
        目前無法載入協作者資料，請稍後再試。
      </p>
      <div className="mt-6 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={reset}
          className="min-h-11 rounded-full bg-clay px-5 py-2 font-semibold text-white"
        >
          重新嘗試
        </button>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center font-semibold text-clay-strong underline decoration-line-strong underline-offset-4"
        >
          返回我的婚宴
        </Link>
      </div>
    </main>
  );
}
