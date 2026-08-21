"use client";

import Link from "next/link";

export default function TimelineRouteError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
      <section className="mx-auto max-w-3xl border-y border-line bg-surface/70 px-5 py-9">
        <h1 className="font-serif text-3xl font-semibold">婚禮總流程暫時無法開啟</h1>
        <p className="mt-4 text-ink-soft">請稍後再試；若問題持續發生，可以先回到婚宴首頁。</p>
        <div className="mt-7 flex gap-4">
          <button type="button" onClick={reset} className="min-h-11 rounded-full border border-clay px-5 font-semibold text-clay-strong">再試一次</button>
          <Link href="/dashboard" className="inline-flex min-h-11 items-center font-semibold text-ink-soft underline">回到我的婚宴</Link>
        </div>
      </section>
    </main>
  );
}
