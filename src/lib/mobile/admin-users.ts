import "server-only";
import type { User, UserAccessStatus } from "@prisma/client";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import {
  deleteSystemUser,
  listSystemUsersForAdmin,
  SystemAdminAccessDeniedError,
  SystemAdminConfigurationError,
  SystemAdminDeleteConfirmationError,
  SystemAdminProtectedUserError,
  SystemAdminStaleWriteError,
  updateSystemUserAccessStatus,
} from "@/lib/system-admin";
import { MobileRequestError } from "./protocol";

type Actor = Pick<User, "id" | "email" | "accessStatus">;

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const ACCESS_STATUSES = new Set<UserAccessStatus>(["ACTIVE", "SUSPENDED", "REMOVED"]);

const forbidden = () =>
  new MobileRequestError(403, "FORBIDDEN", "無法執行系統管理操作。");

/** 把系統管理的錯誤翻成手機端看得懂的狀態碼，其餘一律當成暫時無法使用。 */
function toMobileError(error: unknown): unknown {
  if (error instanceof SystemAdminDeleteConfirmationError) {
    return new MobileRequestError(400, "CONFIRMATION", error.message);
  }
  if (error instanceof SystemAdminProtectedUserError) {
    return new MobileRequestError(409, "PROTECTED", error.message);
  }
  if (error instanceof SystemAdminStaleWriteError) {
    return new MobileRequestError(409, "STALE", error.message);
  }
  if (error instanceof SerializationConflictError) {
    return new MobileRequestError(409, "CONFLICT", "資料剛剛有變動，請再試一次。");
  }
  if (
    error instanceof SystemAdminAccessDeniedError ||
    error instanceof SystemAdminConfigurationError
  ) {
    return forbidden();
  }
  return error;
}

export function requireUserId(value: string): string {
  if (!USER_ID_PATTERN.test(value)) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "帳號代碼有誤。");
  }
  return value;
}

function readObject(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

function readVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "版本資訊有誤，請重新整理後再試。");
  }
  return value;
}

export async function mobileSystemUsers(actor: Actor) {
  try {
    const users = await listSystemUsersForAdmin(actor);
    return { users };
  } catch (error) {
    throw toMobileError(error);
  }
}

export async function mobileUpdateSystemUserAccess(
  actor: Actor,
  targetUserId: string,
  body: unknown,
) {
  const fields = readObject(body, ["expectedVersion", "accessStatus"]);
  const expectedVersion = readVersion(fields.expectedVersion);
  const accessStatus = fields.accessStatus;
  if (typeof accessStatus !== "string" || !ACCESS_STATUSES.has(accessStatus as UserAccessStatus)) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "狀態有誤。");
  }

  try {
    await runSerializableTransaction((transaction) =>
      updateSystemUserAccessStatus(
        actor,
        requireUserId(targetUserId),
        expectedVersion,
        accessStatus as UserAccessStatus,
        transaction,
      ),
    );
  } catch (error) {
    throw toMobileError(error);
  }
  return { accessStatus };
}

export async function mobileDeleteSystemUser(
  actor: Actor,
  targetUserId: string,
  body: unknown,
) {
  const fields = readObject(body, ["expectedVersion", "confirmationEmail"]);
  const expectedVersion = readVersion(fields.expectedVersion);
  const confirmationEmail = fields.confirmationEmail;
  if (typeof confirmationEmail !== "string" || confirmationEmail.trim() === "" ||
      confirmationEmail.length > 320) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "請輸入要刪除的帳號 Email。");
  }

  try {
    await runSerializableTransaction((transaction) =>
      deleteSystemUser(
        actor,
        requireUserId(targetUserId),
        expectedVersion,
        confirmationEmail,
        transaction,
      ),
    );
  } catch (error) {
    throw toMobileError(error);
  }
  return { deleted: true };
}
