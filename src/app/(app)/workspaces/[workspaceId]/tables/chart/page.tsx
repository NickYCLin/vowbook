import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatSeatingChartDate, SeatingChart } from "@/components/tables/seating-chart";
import { SeatingChartStage } from "@/components/tables/seating-chart-stage";
import { SeatingChartPrintButton } from "@/components/tables/seating-chart-print-button";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { getSeatingPlan, SeatingPlanDataError } from "@/lib/seating-plan";

export const metadata: Metadata = {
  title: "婚宴桌圖",
};

type TablesChartPageProps = {
  params: Promise<{ workspaceId: string }>;
};

const formatWeddingDate = formatSeatingChartDate;

export default async function TablesChartPage({ params }: TablesChartPageProps) {
  const { workspaceId } = await params;

  let data;
  try {
    data = await getSeatingPlan(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      notFound();
    }

    if (error instanceof SeatingPlanDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="婚宴桌圖"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/tables/chart`}
        />
      );
    }

    throw error;
  }

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12 print:m-0 print:max-w-none print:p-0">
      {/* 列印時只留海報本體，導覽與說明都不上紙。 */}
      <div className="print:hidden">
        <WorkspacePageHeader
          workspaceId={workspaceId}
          workspaceName={data.workspace.name}
          sectionTitle="婚宴桌圖"
          description="9:16 直式桌圖，和場地圖用同一份配置；列印或另存 PDF 後即可交給婚宴會館輸出。"
          activeSection="tables"
          actions={data.tables.length > 0 ? <SeatingChartPrintButton /> : null}
        />
      </div>

      {data.tables.length > 0 ? (
        <SeatingChartStage>
          <SeatingChart
            workspaceId={workspaceId}
            workspaceName={data.workspace.name}
            weddingDateLabel={formatWeddingDate(
              data.workspace.weddingDate,
              data.workspace.timezone,
            )}
            tables={data.tables}
          />
        </SeatingChartStage>
      ) : (
        <SeatingChart
          workspaceId={workspaceId}
          workspaceName={data.workspace.name}
          weddingDateLabel={formatWeddingDate(
            data.workspace.weddingDate,
            data.workspace.timezone,
          )}
          tables={data.tables}
        />
      )}
    </main>
  );
}
