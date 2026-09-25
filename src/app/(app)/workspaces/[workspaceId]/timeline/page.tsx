import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlowerTulip, HandHeart, Printer } from "@phosphor-icons/react/dist/ssr";
import { buttonClassName } from "@/components/ui/button";
import { WeddingGameParticipantLists } from "@/components/timeline/game-participants";
import { CreateWeddingTimelineItemForm } from "@/components/timeline/timeline-forms";
import { WeddingTimelineList } from "@/components/timeline/timeline-list";
import { WeddingSpeechCards } from "@/components/timeline/wedding-speeches";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { getWeddingTimelinePageData } from "@/lib/wedding-timeline-list";

export const metadata: Metadata = { title: "婚禮總流程" };

export default async function TimelinePage({
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
  const canEdit = getWorkspacePermissions(data.role).canEdit;
  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
      <WorkspacePageHeader
        workspaceId={workspaceId}
        workspaceName={data.workspace.name}
        sectionTitle="婚禮總流程"
        description="依時間掌握當日流程、音樂／影片、地點、細節與負責工作人員。"
        activeSection="timeline"
        readOnlyNotice={
          canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看總流程，但不能新增、編輯或刪除。"
        }
        actions={
          <>
            <a
              href="#wedding-games"
              className={buttonClassName({ variant: "secondary" })}
            >
              <FlowerTulip aria-hidden="true" className="size-5" />
              遊戲名單
              <span className="font-normal text-ink-soft">
                捧花 {data.games.BOUQUET.length}・花椰菜 {data.games.BROCCOLI.length}
              </span>
            </a>
            <a
              href="#wedding-speeches"
              className={buttonClassName({ variant: "secondary" })}
            >
              <HandHeart aria-hidden="true" className="size-5" />
              謝親恩
            </a>
            <Link
              href={`/workspaces/${workspaceId}/timeline/print`}
              className={buttonClassName({ variant: "secondary" })}
            >
              <Printer aria-hidden="true" className="size-5" />
              主持人流程
            </Link>
            {canEdit && data.items.length > 0 ? (
              <CreateWeddingTimelineItemForm
                workspaceId={workspaceId}
                staff={data.staff}
              />
            ) : null}
          </>
        }
      />
      <WeddingTimelineList
        workspaceId={workspaceId}
        items={data.items}
        staff={data.staff}
        canEdit={canEdit}
      />
      <WeddingSpeechCards
        workspaceId={workspaceId}
        speeches={data.speeches}
        canEdit={canEdit}
      />
      <WeddingGameParticipantLists
        workspaceId={workspaceId}
        games={data.games}
        canEdit={canEdit}
      />
    </main>
  );
}
