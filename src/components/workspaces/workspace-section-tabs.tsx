import Link from "next/link";

export function WorkspaceSectionTabs({ label, items }: {
  label: string;
  items: { label: string; href: string; active: boolean }[];
}) {
  return <nav aria-label={label} className="workspace-section-tabs mb-6 flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-line p-1 print:hidden">
    {items.map(item => <Link key={item.href} href={item.href} scroll={false} aria-current={item.active ? "page" : undefined} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm text-ink-soft hover:text-clay-strong aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-clay-strong aria-[current=page]:shadow-card">{item.label}</Link>)}
  </nav>;
}
