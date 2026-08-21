import type { MembershipRole } from "@prisma/client";

export const INVITABLE_WORKSPACE_ROLES = [
  "PARTNER",
  "PLANNER",
  "VIEWER",
] as const satisfies readonly MembershipRole[];

export type InvitableWorkspaceRole =
  (typeof INVITABLE_WORKSPACE_ROLES)[number];

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INVITATION_EMAIL_HTML_PATTERN =
  "[A-Za-z0-9!#$%&'*+\\/=?^_`\\{\\|\\}~\\-]+(\\.[A-Za-z0-9!#$%&'*+\\/=?^_`\\{\\|\\}~\\-]+)*@[A-Za-z0-9]([A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?)+";

const invitationEmailPattern = new RegExp(
  `^${INVITATION_EMAIL_HTML_PATTERN}$`,
  "u",
);
const invitationOperationKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class WorkspaceInvitationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceInvitationValidationError";
  }
}

export function normalizeInvitationEmail(input: unknown): string {
  if (typeof input !== "string") {
    throw new WorkspaceInvitationValidationError(
      "請輸入有效的 Google 帳號 Email。",
    );
  }

  const email = input.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    !invitationEmailPattern.test(email)
  ) {
    throw new WorkspaceInvitationValidationError(
      "請輸入有效的 Google 帳號 Email，最多 254 個 ASCII 字元。",
    );
  }

  return email;
}

export function normalizeInvitationRole(
  input: unknown,
): InvitableWorkspaceRole {
  if (
    typeof input !== "string" ||
    !(INVITABLE_WORKSPACE_ROLES as readonly string[]).includes(input)
  ) {
    throw new WorkspaceInvitationValidationError(
      "請選擇伴侶、婚顧或檢視者角色。",
    );
  }

  return input as InvitableWorkspaceRole;
}

export function normalizeInvitationOperationKey(input: unknown): string {
  if (
    typeof input !== "string" ||
    !invitationOperationKeyPattern.test(input)
  ) {
    throw new WorkspaceInvitationValidationError(
      "邀請操作識別碼無效，請重新整理後再試。",
    );
  }

  return input.toLowerCase();
}

export function normalizeInvitationVersion(input: unknown): number {
  const version =
    typeof input === "string" && /^[1-9]\d*$/u.test(input)
      ? Number(input)
      : input;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 2_147_483_647
  ) {
    throw new WorkspaceInvitationValidationError(
      "邀請版本無效，請重新整理後再試。",
    );
  }
  return version;
}
