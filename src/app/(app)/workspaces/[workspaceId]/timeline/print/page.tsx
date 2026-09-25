import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HouseholdPrintButton } from "@/components/guests/household-print-button";
import { OperationsPrintSheet } from "@/components/print/operations-print-sheet";
import { WEDDING_GAME_LABELS, WEDDING_GAMES } from "@/domain/wedding-game";
import { hostTimelinePrintData } from "@/domain/timeline-print";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { getWeddingTimelinePageData } from "@/lib/wedding-timeline-list";

export const metadata: Metadata = { title: "主持人流程" };

export default async function TimelinePrintPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  let data;
  try {
    data = await getWeddingTimelinePageData(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) notFound();
    throw error;
  }
  return (
    <main className="mx-auto w-full min-w-0 max-w-7xl px-5 py-6 sm:px-8 print:m-0 print:max-w-none print:p-0">
      <div className="print:hidden">
        <Link
          href={`/workspaces/${workspaceId}/timeline`}
          className="inline-flex min-h-11 items-center text-sm text-clay-strong"
        >
          返回婚禮總流程
        </Link>
        <h1 className="my-4 font-serif text-2xl font-semibold">主持人流程</h1>
        <HouseholdPrintButton label="列印主持人流程／另存 PDF" />
      </div>
      <OperationsPrintSheet
        workspaceName={data.workspace.name}
        title="主持人流程"
        instructions="依時間排列當天流程；遊戲名單的介紹詞可直接照念。"
        data={hostTimelinePrintData(data.items)}
      />
      <section aria-label="遊戲名單" className="mt-8 grid gap-6 md:grid-cols-2 print:mt-6 print:break-inside-avoid">
        {WEDDING_GAMES.map((game) => (
          <div key={game} className="min-w-0">
            <h2 className="font-serif text-lg font-semibold">
              {WEDDING_GAME_LABELS[game]}（{data.games[game].length} 位）
            </h2>
            {data.games[game].length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">尚未填寫名單</p>
            ) : (
              <ol className="mt-2 space-y-2 text-sm">
                {data.games[game].map((participant, index) => (
                  <li key={participant.id} className="break-inside-avoid break-words">
                    <span className="font-semibold">
                      {index + 1}. {participant.name}
                    </span>
                    {participant.note ? (
                      <span className="block pl-5 text-ink-soft">
                        「{participant.note}」
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
