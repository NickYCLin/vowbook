import { describe, expect, it } from "vitest";
import {
  assertWorkspacePermission,
  getWorkspacePermissions,
  isWorkspaceRole,
  normalizeWorkspaceDeletionConfirmation,
  normalizeWorkspaceDetails,
  normalizeWorkspaceName,
  normalizeWorkspaceUpdatedAt,
  WorkspaceAccessDeniedError,
} from "./workspace";

describe("workspace domain contract", () => {
  it("trims and collapses whitespace in a workspace name", () => {
    expect(normalizeWorkspaceName("  小林   與小陳的婚宴  ")).toBe(
      "小林 與小陳的婚宴",
    );
  });

  it.each(["", "A", "a".repeat(81)])(
    "rejects an invalid workspace name: %s",
    (name) => {
      expect(() => normalizeWorkspaceName(name)).toThrowError();
    },
  );

  it("normalizes the complete editable workspace snapshot", () => {
    expect(
      normalizeWorkspaceDetails({
        name: "  小林   與小陳的婚宴  ",
        weddingDate: "2028-02-29",
        timezone: "Asia/Taipei",
      }),
    ).toEqual({
      name: "小林 與小陳的婚宴",
      weddingDate: new Date("2028-02-29T00:00:00.000Z"),
      timezone: "Asia/Taipei",
    });

    expect(
      normalizeWorkspaceDetails({
        name: "我們的婚宴",
        weddingDate: "",
        timezone: "",
      }),
    ).toEqual({
      name: "我們的婚宴",
      weddingDate: null,
      timezone: "Asia/Taipei",
    });
  });

  it.each([
    ["2027-02-29", "Asia/Taipei"],
    ["2028-02-29T00:00:00.000Z", "Asia/Taipei"],
    ["2028-02-29", "Europe/London"],
  ])("rejects an invalid editable workspace snapshot", (weddingDate, timezone) => {
    expect(() =>
      normalizeWorkspaceDetails({
        name: "我們的婚宴",
        weddingDate,
        timezone,
      }),
    ).toThrowError();
  });

  it("accepts only a canonical optimistic concurrency timestamp", () => {
    expect(normalizeWorkspaceUpdatedAt("2026-07-29T01:02:03.456Z")).toEqual(
      new Date("2026-07-29T01:02:03.456Z"),
    );
    expect(() => normalizeWorkspaceUpdatedAt("2026-07-29")).toThrowError(
      "版本資訊無效，請重新整理後再試。",
    );
    expect(() => normalizeWorkspaceUpdatedAt("not-a-date")).toThrowError(
      "版本資訊無效，請重新整理後再試。",
    );
  });

  it("normalizes the typed deletion confirmation like the current workspace name", () => {
    expect(
      normalizeWorkspaceDeletionConfirmation("  小林   與小陳的婚宴  "),
    ).toBe("小林 與小陳的婚宴");
    expect(() => normalizeWorkspaceDeletionConfirmation(null)).toThrowError(
      "請輸入目前婚宴名稱以確認刪除。",
    );
  });

  it("only accepts defined workspace roles", () => {
    expect(isWorkspaceRole("OWNER")).toBe(true);
    expect(isWorkspaceRole("VIEWER")).toBe(true);
    expect(isWorkspaceRole("ADMIN")).toBe(false);
  });

  it.each([
    ["OWNER", true, true, true],
    ["PARTNER", true, true, false],
    ["PLANNER", true, true, false],
    ["VIEWER", true, false, false],
    [null, false, false, false],
  ] as const)(
    "maps %s to least-privilege permissions",
    (role, canRead, canEdit, canManageMembers) => {
      expect(getWorkspacePermissions(role)).toEqual({
        canRead,
        canEdit,
        canManageMembers,
      });
    },
  );

  it("rejects non-members and insufficient roles", () => {
    expect(() => assertWorkspacePermission(null, "read")).toThrow(
      WorkspaceAccessDeniedError,
    );
    expect(() => assertWorkspacePermission("VIEWER", "edit")).toThrow(
      WorkspaceAccessDeniedError,
    );
    expect(() => assertWorkspacePermission("PARTNER", "manageMembers")).toThrow(
      WorkspaceAccessDeniedError,
    );
  });
});
