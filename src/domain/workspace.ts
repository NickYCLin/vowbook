export const WORKSPACE_ROLES = [
  "OWNER",
  "PARTNER",
  "PLANNER",
  "VIEWER",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type WorkspacePermission = "read" | "edit" | "manageMembers";

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}

export class WorkspaceAccessDeniedError extends Error {
  constructor() {
    super("無權存取此婚宴工作區。");
    this.name = "WorkspaceAccessDeniedError";
  }
}

export function normalizeWorkspaceName(input: string): string {
  const normalized = input.trim().replace(/\s+/gu, " ");

  if (normalized.length < 2 || normalized.length > 80) {
    throw new WorkspaceValidationError("婚宴名稱需為 2 到 80 個字元。");
  }

  return normalized;
}

export type NormalizedWorkspaceDetails = {
  name: string;
  weddingDate: Date | null;
  timezone: "Asia/Taipei";
};

function normalizeWeddingDate(value: unknown): Date | null {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new WorkspaceValidationError("請輸入有效的婚宴日期。");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new WorkspaceValidationError("請輸入有效的婚宴日期。");
  }

  return date;
}

function normalizeTimezone(value: unknown): "Asia/Taipei" {
  if (value === null || value === "") {
    return "Asia/Taipei";
  }

  if (value !== "Asia/Taipei") {
    throw new WorkspaceValidationError("目前僅支援台北時區。");
  }

  return value;
}

export function normalizeWorkspaceDetails(input: {
  name: unknown;
  weddingDate: unknown;
  timezone: unknown;
}): NormalizedWorkspaceDetails {
  return {
    name: normalizeWorkspaceName(
      typeof input.name === "string" ? input.name : "",
    ),
    weddingDate: normalizeWeddingDate(input.weddingDate),
    timezone: normalizeTimezone(input.timezone),
  };
}

export function normalizeWorkspaceUpdatedAt(value: unknown): Date {
  if (typeof value !== "string") {
    throw new WorkspaceValidationError(
      "版本資訊無效，請重新整理後再試。",
    );
  }

  const updatedAt = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(updatedAt.getTime()) ||
    updatedAt.toISOString() !== value
  ) {
    throw new WorkspaceValidationError(
      "版本資訊無效，請重新整理後再試。",
    );
  }

  return updatedAt;
}

export function normalizeWorkspaceDeletionConfirmation(value: unknown): string {
  if (typeof value !== "string") {
    throw new WorkspaceValidationError("請輸入目前婚宴名稱以確認刪除。");
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length < 2 || normalized.length > 80) {
    throw new WorkspaceValidationError("請輸入目前婚宴名稱以確認刪除。");
  }

  return normalized;
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (WORKSPACE_ROLES as readonly string[]).includes(value)
  );
}

export function getWorkspacePermissions(role: WorkspaceRole | null) {
  return {
    canRead: role !== null,
    canEdit: role === "OWNER" || role === "PARTNER" || role === "PLANNER",
    canManageMembers: role === "OWNER",
  };
}

export function assertWorkspacePermission(
  role: WorkspaceRole | null,
  permission: WorkspacePermission,
): void {
  const permissions = getWorkspacePermissions(role);
  const isAllowed =
    permission === "read"
      ? permissions.canRead
      : permission === "edit"
        ? permissions.canEdit
        : permissions.canManageMembers;

  if (!isAllowed) {
    throw new WorkspaceAccessDeniedError();
  }
}
