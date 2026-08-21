import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getWeddingStaffList } = vi.hoisted(() => ({
  getWeddingStaffList: vi.fn(),
}));
vi.mock("@/lib/wedding-staff-list", () => ({
  getWeddingStaffList,
  WeddingStaffDataError: class WeddingStaffDataError extends Error {},
}));
vi.mock("@/components/staff/staff-list", () => ({
  WeddingStaffList: ({ canEdit }: { canEdit: boolean }) => (
    <div>工作人員清單 {canEdit ? "可編輯" : "唯讀"}</div>
  ),
}));

import StaffPage from "./page";

describe("StaffPage", () => {
  it("renders the shared staff route and VIEWER notice", async () => {
    getWeddingStaffList.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      staff: [],
    });
    render(
      await StaffPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "合成婚宴・婚禮工作人員" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/唯讀成員/)).toBeInTheDocument();
    expect(screen.getByText("工作人員清單 唯讀")).toBeInTheDocument();
  });
});
