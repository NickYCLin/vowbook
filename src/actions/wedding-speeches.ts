"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import {
  normalizeWeddingSpeechContent,
  parseWeddingSpeech,
  WeddingSpeechValidationError,
} from "@/domain/wedding-speech";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WeddingSpeechMutationState = {
  status: "idle" | "success" | "error";
  code?: "VALIDATION" | "FORBIDDEN" | "STALE" | "UNAVAILABLE";
  message?: string;
  /** 失敗時把剛打的內容還給表單，免得整段稿子不見。 */
  draft?: string;
};

class SpeechStaleError extends Error {}

/** 空字串代表畫面上還沒有稿子；否則必須是目前的 version。 */
function expectedVersion(formData: FormData): number | null {
  const raw = formData.get("expectedVersion");
  if (raw === "") return null;
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) {
    throw new WeddingSpeechValidationError("版本資訊無效，請重新整理後再試。");
  }
  return Number(raw);
}

function failure(error: unknown, draft: string): WeddingSpeechMutationState {
  if (error instanceof WorkspaceAccessDeniedError) {
    return { status: "error", code: "FORBIDDEN", message: error.message, draft };
  }
  if (error instanceof WeddingSpeechValidationError) {
    return { status: "error", code: "VALIDATION", message: error.message, draft };
  }
  if (
    error instanceof SpeechStaleError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
  ) {
    return {
      status: "error",
      code: "STALE",
      message: "致詞稿已被其他人更新，請先複製你的內容，重新整理後再改。",
      draft,
    };
  }
  return {
    status: "error",
    code: "UNAVAILABLE",
    message: "目前無法儲存致詞稿，請稍後再試。",
    draft,
  };
}

export async function saveWeddingSpeechAction(
  workspaceId: string,
  _previousState: WeddingSpeechMutationState,
  formData: FormData,
): Promise<WeddingSpeechMutationState> {
  const draft = String(formData.get("content") ?? "");
  const currentUser = await requireCurrentUser();
  try {
    await requireWorkspaceAccess(workspaceId, currentUser.id, "edit");
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return failure(error, draft);
    return failure(null, draft);
  }

  let kind: ReturnType<typeof parseWeddingSpeech>;
  let content: string | null;
  let version: number | null;
  try {
    kind = parseWeddingSpeech(formData.get("kind"));
    content = normalizeWeddingSpeechContent(formData.get("content"));
    version = expectedVersion(formData);
  } catch (error) {
    return failure(error, draft);
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUser.id,
        "edit",
        transaction,
      );
      if (version === null) {
        if (content === null) return;
        await transaction.weddingSpeech.create({
          data: { workspaceId, kind, content },
        });
        return;
      }
      const where = { workspaceId, kind, version };
      const result =
        content === null
          ? await transaction.weddingSpeech.deleteMany({ where })
          : await transaction.weddingSpeech.updateMany({
              where,
              data: { content, version: { increment: 1 } },
            });
      if (result.count === 0) throw new SpeechStaleError();
    });
  } catch (error) {
    return failure(error, draft);
  }

  const message = content === null ? "已清空致詞稿。" : "已儲存致詞稿。";
  try {
    await revalidatePath(`/workspaces/${workspaceId}/timeline`);
    return { status: "success", message };
  } catch {
    console.error("致詞稿頁面重新驗證失敗。");
    return {
      status: "success",
      message: `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`,
    };
  }
}
