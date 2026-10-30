import Link from "next/link";
import { informationStatus, type InformationSection } from "@/content/service-information";

export function PublicInformation({ title, sections, status = informationStatus }: {
  title: string;
  sections: InformationSection[];
  status?: string;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 text-ink sm:px-8">
      <nav aria-label="公開說明導覽" className="mb-8 flex flex-wrap gap-5 text-sm text-clay">
        <Link href="/" className="inline-flex min-h-11 items-center rounded px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay">誓約簿首頁</Link>
        <Link href="/privacy" className="inline-flex min-h-11 items-center rounded px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay">資料使用說明</Link>
        <Link href="/support" className="inline-flex min-h-11 items-center rounded px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay">使用說明與支援</Link>
      </nav>
      <h1 className="font-serif text-3xl font-semibold leading-snug">{title}</h1>
      <p role="note" className="my-6 rounded-xl border border-line bg-paper-deep p-4 leading-7">{status}</p>
      <div className="space-y-8">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="mb-3 font-serif text-xl font-semibold">{section.title}</h2>
            <p className="break-words leading-8 text-ink-soft">{section.text}</p>
            {section.link ? (
              <a href={section.link.href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center break-all rounded px-2 text-clay underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay">
                {section.link.label}（{section.link.href}）
              </a>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}
