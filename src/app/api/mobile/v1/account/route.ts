import {
  AccountDeletionBlockedError,
  AccountDeletionConfirmationError,
  AccountDeletionMissingError,
  AccountDeletionReauthenticationError,
  deleteOwnAccount,
  previewAccountDeletion,
} from "@/lib/account-deletion";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { requireMobileUser } from "@/lib/mobile/session";
import { SerializationConflictError } from "@/lib/serializable-transaction";
import { deleteAppleAccount, prepareAppleAccountDeletion } from "@/lib/mobile/apple-account-deletion";

export const runtime = "nodejs";

/** 刪除帳號前先讓使用者看到哪些婚宴會刪掉、哪些只是退出。 */
export async function GET(request: Request) {
  try {
    const user = await requireMobileUser(request);
    return mobileJSON({ ...await previewAccountDeletion(user.id), provider: user.appleSubject ? "APPLE" : "GOOGLE" });
  } catch (error) {
    return mobileError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireMobileUser(request);
    return mobileJSON(await prepareAppleAccountDeletion(user.id));
  } catch (error) { return mobileError(error); }
}

/** 只能刪自己：帳號一律看登入憑證，body 只收確認用的 Email。 */
export async function DELETE(request: Request) {
  try {
    const user = await requireMobileUser(request);
    const body = await readMobileJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["confirmationEmail", "identityToken", "authorizationCode", "nonce"].includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
    }
    const input = body as { confirmationEmail?: unknown; identityToken?: unknown; authorizationCode?: unknown; nonce?: unknown };
    if (!user.appleSubject && Object.keys(body).some((key) => key !== "confirmationEmail")) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
    }
    const result = await (user.appleSubject ? deleteAppleAccount(user.id, input) : deleteOwnAccount(user.id, input.confirmationEmail))
      .catch((error: unknown) => {
        if (error instanceof AccountDeletionConfirmationError) {
          throw new MobileRequestError(400, "CONFIRMATION", error.message);
        }
        if (error instanceof AccountDeletionBlockedError) throw new MobileRequestError(409, "BLOCKED", error.message);
        if (error instanceof AccountDeletionMissingError) throw new MobileRequestError(404, "NOT_FOUND", error.message);
        if (error instanceof AccountDeletionReauthenticationError) throw new MobileRequestError(401, "REAUTHENTICATE", error.message);
        if (error instanceof SerializationConflictError) {
          throw new MobileRequestError(409, "CONFLICT", "資料剛剛有變動，請再試一次。");
        }
        throw error;
      });
    return mobileJSON({ deleted: true, ...result });
  } catch (error) {
    return mobileError(error);
  }
}
