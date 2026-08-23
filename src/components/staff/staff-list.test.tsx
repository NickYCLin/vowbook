import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./staff-forms", () => ({
  CreateWeddingStaffForm: () => <button>新增工作人員</button>,
  EditWeddingStaffForm: ({ personName, triggerId }: { personName: string; triggerId?: string }) => (
    <button id={triggerId}>編輯 {personName}</button>
  ),
  DeleteWeddingStaffForm: ({ personName }: { personName: string }) => (
    <button>移除 {personName}</button>
  ),
}));

import { WeddingStaffList } from "./staff-list";

const staff = [
  {
    id: "staff_1",
    roleName: "招待",
    personName: "小安",
    contactPhone: "0912 345 678",
    notes: "負責 A 區",
    version: 1,
  },
  {
    id: "staff_2",
    roleName: "招待",
    personName: "小美",
    contactPhone: null,
    notes: null,
    version: 0,
  },
  {
    id: "staff_3",
    roleName: "主持",
    personName: "小安",
    contactPhone: null,
    notes: "同人多職務",
    version: 2,
  },
];

describe("WeddingStaffList", () => {
  it("groups same-role people while allowing the same person in another role", () => {
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit={false}
      />,
    );
    const reception = screen.getByRole("region", { name: "招待" });
    expect(within(reception).getByText("小安")).toBeInTheDocument();
    expect(within(reception).getByText("小美")).toBeInTheDocument();
    expect(screen.getAllByText("小安")).toHaveLength(2);
    expect(screen.getByText("0912 345 678")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("places the lead reception group before every other role", () => {
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={[
          ...staff,
          {
            ...staff[0],
            id: "staff_lead_reception",
            roleName: "總招待",
            personName: "總召",
          },
        ]}
        canEdit={false}
      />,
    );

    expect(
      screen
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label")),
    ).toEqual(["總招待", "招待", "主持"]);
  });

  it("shows editor controls without exposing IDs", () => {
    const { container } = render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit
      />,
    );
    // 有資料時新增入口在頁面標題列，清單本身只保留逐筆的編輯與移除。
    expect(
      screen.queryByRole("button", { name: "新增工作人員" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "編輯 小安" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "移除 小美" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent("workspace_internal");
    expect(container).not.toHaveTextContent("staff_1");
  });

  it("wraps unbroken role and person text without widening the list", () => {
    const roleName = "R".repeat(60);
    const personName = "P".repeat(120);
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={[{ ...staff[0], roleName, personName }]}
        canEdit={false}
      />,
    );
    expect(screen.getByRole("heading", { name: roleName })).toHaveClass(
      "min-w-0",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
    expect(screen.getByRole("heading", { name: personName })).toHaveClass(
      "break-words",
      "[overflow-wrap:anywhere]",
    );
  });

  it("announces removal and focuses the next surviving edit trigger", async () => {
    const { rerender } = render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit
      />,
    );

    rerender(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={[staff[0], staff[2]]}
        canEdit
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已移除婚禮工作人員",
    );
    await waitFor(() =>
      expect(document.getElementById("wedding-staff-edit-staff_3")).toHaveFocus(),
    );
  });

  it("keeps feedback and focus when an edited person moves to another role group", async () => {
    const { rerender } = render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit
      />,
    );

    rerender(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff.map((person) =>
          person.id === "staff_1" ? { ...person, roleName: "總招待" } : person,
        )}
        canEdit
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已更新婚禮工作人員與職務分組",
    );
    await waitFor(() =>
      expect(document.getElementById("wedding-staff-edit-staff_1")).toHaveFocus(),
    );
  });
});
