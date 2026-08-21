import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withBasePath } from "@/lib/base-path";
import {
  BudgetAttachmentTargetError,
  getBudgetAttachmentMetadata,
} from "@/lib/budget-attachments";
import { requireCurrentUser } from "@/lib/current-user";

export const metadata: Metadata = {
  title: "附件預覽",
};
export const dynamic = "force-dynamic";

type AttachmentPreviewPageProps = {
  params: Promise<{
    workspaceId: string;
    budgetItemId: string;
    attachmentId: string;
  }>;
};

function attachmentApiPath(
  workspaceId: string,
  budgetItemId: string,
  attachmentId: string,
): string {
  return withBasePath(
    "/api/workspaces/" +
      encodeURIComponent(workspaceId) +
      "/budget/" +
      encodeURIComponent(budgetItemId) +
      "/attachments/" +
      encodeURIComponent(attachmentId),
  );
}

export default async function AttachmentPreviewPage({
  params,
}: AttachmentPreviewPageProps) {
  const { workspaceId, budgetItemId, attachmentId } = await params;
  const currentUser = await requireCurrentUser();

  let attachment;
  try {
    attachment = await getBudgetAttachmentMetadata({
      workspaceId,
      budgetItemId,
      attachmentId,
      currentUserId: currentUser.id,
    });
  } catch (error) {
    if (error instanceof BudgetAttachmentTargetError) {
      notFound();
    }
    throw error;
  }

  const downloadPath = attachmentApiPath(
    workspaceId,
    budgetItemId,
    attachmentId,
  );
  const inlinePath = downloadPath + "?disposition=inline";

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-10">
      <Link
        href={`/workspaces/${workspaceId}/budget`}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-clay-strong underline decoration-line-strong underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9d7356]"
      >
        返回婚禮花費
      </Link>

      <header className="mt-3 min-w-0 border-y border-line bg-surface/75 px-4 py-5 sm:px-6">
        <p className="text-sm font-semibold tracking-[0.14em] text-clay">
          {attachment.workspaceName}
        </p>
        <h1 className="mt-2 break-words font-serif text-3xl font-semibold text-ink sm:text-4xl">
          VowBook 安全附件預覽
        </h1>
        <p className="mt-3 break-all text-sm leading-6 text-ink">
          {attachment.originalName}
        </p>
        <a
          href={downloadPath}
          download
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong px-5 py-2 text-sm font-semibold text-clay-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9d7356]"
        >
          下載原始檔
        </a>
      </header>

      <section
        aria-label="附件內容"
        className="mt-5 min-h-[55dvh] min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
      >
        <iframe
          src={inlinePath}
          title={`${attachment.originalName} 的安全預覽`}
          referrerPolicy="no-referrer"
          className="block h-[70dvh] min-h-[32rem] w-full max-w-full"
        />
      </section>
    </main>
  );
}
