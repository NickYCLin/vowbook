import type { Metadata } from "next";
import type { WeddingWorkspace } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { WorkspaceOwnerControls } from "@/components/workspaces/workspace-owner-controls";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export const metadata: Metadata = { title: "婚宴設定" };

export default async function SettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  let access;
  try { access = await requireWorkspaceAccess<WeddingWorkspace>(workspaceId, user.id, "read"); }
  catch (error) { if (error instanceof WorkspaceAccessDeniedError) notFound(); throw error; }
  const { workspace, role } = access;
  const editable = { id: workspace.id, name: workspace.name, weddingDate: workspace.weddingDate, timezone: workspace.timezone, updatedAt: workspace.updatedAt };
  return <main className="mx-auto w-full min-w-0 max-w-6xl px-5 py-6 sm:px-8 sm:py-12">
    <WorkspacePageHeader workspaceId={workspaceId} workspaceName={workspace.name} sectionTitle="婚宴設定" description="婚宴名稱、日期與共同籌備的成員。" activeSection="settings"/>
    <section className="rounded-card border border-line bg-surface p-5 sm:p-6" aria-label="婚宴基本資料">
      <h2 className="font-serif text-title font-semibold">基本資料</h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-caption text-ink-soft">婚宴名稱</dt><dd className="mt-1 break-words">{workspace.name}</dd></div><div><dt className="text-caption text-ink-soft">婚宴日期</dt><dd className="mt-1">{workspace.weddingDate ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeZone: workspace.timezone }).format(workspace.weddingDate) : "尚未決定"}</dd></div></dl>
      {role === "OWNER" ? <WorkspaceOwnerControls workspace={editable}/> : <p className="mt-5 text-caption text-ink-soft">婚宴名稱與日期由擁有者管理。</p>}
    </section>
    <Link href={`/workspaces/${workspaceId}/members`} className="mt-5 flex min-h-20 items-center justify-between gap-4 rounded-card border border-line bg-surface p-5 hover:bg-clay-soft"><span>分享與協作<span className="mt-1 block text-caption text-ink-soft">{role === "OWNER" ? "邀請伴侶、婚顧與親友一起籌備。" : "查看一起籌備這場婚宴的成員。"}</span></span><span aria-hidden="true">→</span></Link>
  </main>;
}
