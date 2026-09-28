import { describe, expect, it } from "vitest";
import { recentWorkspaceValue, workspaceEntryId, workspaceEntryPath } from "./workspace-entry";

describe("workspace entry", () => {
  it("enters the only accessible workspace without a preference", () => {
    expect(workspaceEntryId("u", ["a"])).toBe("a");
    expect(workspaceEntryId("u", [])).toBeNull();
  });
  it("restores only a currently authorized workspace for the same account", () => {
    expect(workspaceEntryId("u", ["a", "b"], recentWorkspaceValue("u", "b"))).toBe("b");
    expect(workspaceEntryId("u", ["a", "b"], encodeURIComponent(recentWorkspaceValue("u", "a")))).toBe("a");
    expect(workspaceEntryId("other", ["a", "b"], recentWorkspaceValue("u", "b"))).toBeNull();
    expect(workspaceEntryId("u", ["a", "b"], recentWorkspaceValue("u", "removed"))).toBeNull();
  });
  it.each([undefined, "null", "{}", "%invalid", "[]", '"string"', "x".repeat(1025)])("ignores malformed or absent preferences", value => {
    expect(workspaceEntryId("u", ["a", "b"], value)).toBeNull();
  });
  it("sends the brand link to a workspace instead of a page that bounces back", () => {
    expect(workspaceEntryPath("u", [])).toBe("/dashboard");
    expect(workspaceEntryPath("u", ["a"])).toBe("/workspaces/a/overview");
    expect(workspaceEntryPath("u", ["a", "b"], recentWorkspaceValue("u", "b"))).toBe("/workspaces/b/overview");
    expect(workspaceEntryPath("u", ["a", "b"])).toBe("/dashboard?view=all");
    expect(workspaceEntryPath("u", ["a", "b"], recentWorkspaceValue("u", "removed"))).toBe("/dashboard?view=all");
  });
});
