import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BudgetList } from "@/components/budget/budget-list";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { BudgetItemDataError, getBudgetPageData } from "@/lib/budget-list";

export const metadata: Metadata = {
  title: "婚禮花費",
};

type BudgetPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function BudgetPage({ params }: BudgetPageProps) {
  const { workspaceId } = await params;

  let data;
  try {
    data = await getBudgetPageData(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      notFound();
    }

    if (error instanceof BudgetItemDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="婚禮花費"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/budget`}
        />
      );
    }

    throw error;
  }

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8">
      <WorkspacePageHeader
        workspaceId={workspaceId}
        workspaceName={data.workspaceName}
        sectionTitle="婚禮花費"
        description="以本項直接費用與含子項總計整理婚禮支出與付款狀態。"
        activeSection="budget"
        compactIntro
        readOnlyNotice={
          data.canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看花費，但不能新增、編輯、變更下訂付款狀態或移除。"
        }
      />

      <BudgetList
        workspaceId={workspaceId}
        workspaceName={data.workspaceName}
        items={data.items}
        summary={data.summary}
        canEdit={data.canEdit}
        canResetBudget={data.canResetBudget}
        resetSnapshot={data.resetSnapshot}
      />
    </main>
  );
}
