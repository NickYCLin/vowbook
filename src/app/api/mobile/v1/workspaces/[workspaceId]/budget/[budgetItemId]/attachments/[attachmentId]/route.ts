import {
  buildAttachmentContentDisposition,
} from "@/domain/budget-attachment";
import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON } from "@/lib/mobile/http";
import { mobileAttachmentError } from "@/lib/mobile/budget-attachments";
import {
  deleteBudgetAttachment,
  getBudgetAttachmentDownload,
} from "@/lib/budget-attachments";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ workspaceId: string; budgetItemId: string; attachmentId: string }>;
};

/** 下載原始檔。App 存到暫存檔後自己預覽，所以一律整份給，不做分段。 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, budgetItemId, attachmentId } = await context.params;
    const attachment = await getBudgetAttachmentDownload({
      workspaceId,
      budgetItemId,
      attachmentId,
      currentUserId: user.id,
    });
    return new Response(new Uint8Array(attachment.data), {
      headers: {
        "content-type": attachment.mediaType,
        "content-length": String(attachment.byteSize),
        "content-disposition": buildAttachmentContentDisposition(
          attachment.originalName,
          attachment.mediaType,
          "attachment",
        ),
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    return mobileError(mobileAttachmentError(error));
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, budgetItemId, attachmentId } = await context.params;
    await deleteBudgetAttachment({
      workspaceId,
      budgetItemId,
      attachmentId,
      currentUserId: user.id,
    });
    return mobileJSON({ deleted: true });
  } catch (error) {
    return mobileError(mobileAttachmentError(error));
  }
}
