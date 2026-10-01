import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
const mocks = vi.hoisted(() => ({ access: vi.fn(), user: vi.fn().mockResolvedValue({ id: "u" }) }));
vi.mock("@/lib/current-user", () => ({ requireCurrentUser: mocks.user }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/workspaces/workspace-owner-controls", () => ({ WorkspaceOwnerControls: () => <button>編輯婚宴</button> }));
import SettingsPage from "./page";
const params = Promise.resolve({ workspaceId: "w" });
beforeEach(() => { mocks.access.mockResolvedValue({ role: "VIEWER", workspace: { id: "w", name: "合成婚宴", weddingDate: null, timezone: "Asia/Taipei", updatedAt: new Date() } }); });
it("checks Membership before rendering and hides owner controls for viewers", async () => {
  render(await SettingsPage({ params }));
  expect(mocks.access).toHaveBeenCalledWith("w", "u", "read");
  expect(screen.queryByRole("button", { name: "編輯婚宴" })).toBeNull();
  expect(screen.queryByRole("link", { name: /分享與協作/ })).toBeNull();
  expect(screen.queryByText(/共同籌備的成員/)).toBeNull();
});
it("fails closed for inaccessible workspaces", async () => {
  mocks.access.mockRejectedValueOnce(new WorkspaceAccessDeniedError());
  await expect(SettingsPage({ params })).rejects.toThrow("NOT_FOUND");
});
