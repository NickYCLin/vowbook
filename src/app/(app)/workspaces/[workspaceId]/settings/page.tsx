import type { Metadata } from "next";
import type { WeddingWorkspace } from "@prisma/client";
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
    <WorkspacePageHeader workspaceId={workspaceId} workspaceName={workspace.name} sectionTitle="婚宴設定" description="婚宴名稱與日期。" activeSection="settings"/>
    <section className="rounded-card border border-line bg-surface p-5 sm:p-6" aria-label="婚宴基本資料">
      <h2 className="font-serif text-title font-semibold">基本資料</h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-caption text-ink-soft">婚宴名稱</dt><dd className="mt-1 break-words">{workspace.name}</dd></div><div><dt className="text-caption text-ink-soft">婚宴日期</dt><dd className="mt-1">{workspace.weddingDate ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeZone: workspace.timezone }).format(workspace.weddingDate) : "尚未決定"}</dd></div></dl>
      {role === "OWNER" ? <WorkspaceOwnerControls workspace={editable}/> : <p className="mt-5 text-caption text-ink-soft">婚宴名稱與日期由擁有者管理。</p>}
    </section>
  </main>;
}
