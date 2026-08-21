import { describe, expect, it } from "vitest";
import {
  INVITATION_TTL_MS,
  INVITABLE_WORKSPACE_ROLES,
  normalizeInvitationEmail,
  normalizeInvitationOperationKey,
  normalizeInvitationRole,
  normalizeInvitationVersion,
  WorkspaceInvitationValidationError,
} from "./workspace-invitation";

describe("workspace invitation domain contract", () => {
  it("only trims and lowercases a safe ASCII Google account email", () => {
    expect(
      normalizeInvitationEmail("  First.Last+Wedding@Example.COM  "),
    ).toBe("first.last+wedding@example.com");
    expect(normalizeInvitationEmail("first.last@gmail.com")).not.toBe(
      "firstlast@gmail.com",
    );
    expect(normalizeInvitationEmail("first+plan@gmail.com")).not.toBe(
      "first@gmail.com",
    );
  });

  it("accepts the maximum 254-character normalized email", () => {
    const email = "a".repeat(242) + "@example.com";
    expect(email).toHaveLength(254);
    expect(normalizeInvitationEmail(email)).toBe(email);
  });

  it.each([
    "",
    "not-an-email",
    "two@@example.com",
    ".leading@example.com",
    "double..dot@example.com",
    "trailing.@example.com",
    "space inside@example.com",
    "使用者@example.com",
    "user@例子.測試",
    "a@" + "b".repeat(250) + ".com",
    "user\u0000@example.com",
    "user\u200b@example.com",
  ])("rejects invalid, unsafe Unicode, or overlong email: %s", (email) => {
    expect(() => normalizeInvitationEmail(email)).toThrow(
      WorkspaceInvitationValidationError,
    );
  });

  it("only allows non-owner collaboration roles", () => {
    expect(INVITABLE_WORKSPACE_ROLES).toEqual([
      "PARTNER",
      "PLANNER",
      "VIEWER",
    ]);
    expect(normalizeInvitationRole("PARTNER")).toBe("PARTNER");
    expect(normalizeInvitationRole("PLANNER")).toBe("PLANNER");
    expect(normalizeInvitationRole("VIEWER")).toBe("VIEWER");
    expect(() => normalizeInvitationRole("OWNER")).toThrow(
      WorkspaceInvitationValidationError,
    );
    expect(() => normalizeInvitationRole("ADMIN")).toThrow(
      WorkspaceInvitationValidationError,
    );
  });

  it("uses one fixed seven-day invitation generation and positive CAS versions", () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(normalizeInvitationVersion("1")).toBe(1);
    expect(normalizeInvitationVersion(8)).toBe(8);
    for (const version of [undefined, "", "0", "1.5", "-1", "01", 0, 1.5]) {
      expect(() => normalizeInvitationVersion(version)).toThrow(
        WorkspaceInvitationValidationError,
      );
    }
  });

  it("accepts only canonical UUID operation keys", () => {
    expect(
      normalizeInvitationOperationKey("8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"),
    ).toBe("8d7fcdcf-2bea-4aa4-89b3-47158efcb40d");
    expect(
      normalizeInvitationOperationKey("8D7FCDCF-2BEA-4AA4-89B3-47158EFCB40D"),
    ).toBe("8d7fcdcf-2bea-4aa4-89b3-47158efcb40d");
    for (const operationKey of [
      undefined,
      "",
      "not-a-uuid",
      "8d7fcdcf-2bea-4aa4-89b3-47158efcb40",
      "8d7fcdcf2bea4aa489b347158efcb40d",
    ]) {
      expect(() => normalizeInvitationOperationKey(operationKey)).toThrow(
        WorkspaceInvitationValidationError,
      );
    }
  });
});
