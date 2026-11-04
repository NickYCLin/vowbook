import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { feedbackCategories, feedbackSections } from "@/domain/product-feedback";
import { listProductFeedback } from "@/lib/product-feedback";
import { SystemAdminAccessDeniedError } from "@/lib/system-admin";

export const metadata: Metadata = { title: "意見回饋管理", robots: { index: false, follow: false } };

export default async function FeedbackAdminPage({ searchParams }: { searchParams: Promise<{ before?: string; id?: string }> }) {
  const { before, id } = await searchParams;
  const date = before ? new Date(before) : undefined;
  if (before && (!date || Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/iu.test(id))) notFound();
  let feedback;
  try { feedback = await listProductFeedback(date && id ? { date, id } : undefined); }
  catch (error) { if (error instanceof SystemAdminAccessDeniedError) notFound(); throw error; }
  const visible = feedback.slice(0, 50);
  return <main className="mx-auto max-w-4xl space-y-6 px-5 py-8">
    <Link href="/admin/users" className="inline-flex min-h-11 items-center text-clay-strong">返回使用者管理</Link>
    <h1 className="font-serif text-3xl font-semibold">意見回饋管理</h1>
    <p className="text-sm text-ink-soft">僅系統管理者可查看。內容由使用者提供，請避免轉貼聯絡資訊或其他個資。</p>
    {visible.length === 0 && <p>目前沒有回饋。</p>}
    {visible.map(item => <article key={item.id} className="space-y-3 rounded-card border border-line bg-surface p-5">
      <h2 className="font-semibold">{feedbackSections[item.section as keyof typeof feedbackSections] ?? "其他功能"}・{feedbackCategories[item.category as keyof typeof feedbackCategories] ?? "其他"}</h2>
      <time className="text-sm text-ink-soft" dateTime={item.createdAt.toISOString()}>{item.createdAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</time>
      <p className="whitespace-pre-wrap break-words text-sm leading-7">{item.message}</p>
      {item.contact && <p className="break-all text-sm">回覆電子郵件：{item.contact}</p>}
      <p className="break-all text-xs text-ink-soft">回饋編號：{item.id}</p>
    </article>)}
    {feedback.length > 50 && <Link className="inline-flex min-h-11 items-center text-clay-strong" href={`/admin/feedback?before=${encodeURIComponent(visible[49].createdAt.toISOString())}&id=${visible[49].id}`}>較早的回饋</Link>}
  </main>;
}
