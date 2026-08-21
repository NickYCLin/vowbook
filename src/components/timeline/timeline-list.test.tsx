import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./timeline-forms", () => ({
  CreateWeddingTimelineItemForm: () => <button>新增流程項目</button>,
  GeneralLunchTimelineTemplateForm: () => <button>建立詳細午宴流程範本</button>,
  EditWeddingTimelineItemForm: ({ title, triggerId }: { title: string; triggerId?: string }) => (
    <button id={triggerId}>編輯 {title}</button>
  ),
  DeleteWeddingTimelineItemForm: ({ title }: { title: string }) => (
    <button>刪除 {title}</button>
  ),
}));

import { WeddingTimelineList } from "./timeline-list";

const items = [
  {
    id: "item_1",
    startTime: "11:30",
    endTime: "12:00",
    phase: "迎賓",
    title: "賓客入場",
    location: "宴會廳外",
    details: "依序引導",
    mediaCue: "迎賓音樂\n開場影片",
    notes: "留意長輩",
    version: 2,
    assignedStaff: [
      { id: "staff_1", roleName: "招待", personName: "小安" },
    ],
  },
];

const staff = [
  { id: "staff_1", roleName: "招待", personName: "小安" },
];

describe("WeddingTimelineList", () => {
  it("renders media cues inside the existing content area on desktop and mobile", () => {
    const { container } = render(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={items}
        staff={staff}
        canEdit={false}
      />,
    );
    const desktop = container.querySelector('[data-timeline-layout="desktop"]');
    const mobile = container.querySelector('[data-timeline-layout="mobile"]');
    expect(desktop).toHaveClass("hidden", "md:block");
    expect(mobile).toHaveClass("md:hidden");
    for (const surface of [desktop, mobile]) {
      expect(surface).toHaveTextContent("11:30–12:00");
      expect(surface).toHaveTextContent("迎賓");
      expect(surface).toHaveTextContent("宴會廳外");
      expect(surface).toHaveTextContent("音樂／影片：迎賓音樂 開場影片");
      expect(surface).toHaveTextContent("招待・小安");
      expect(surface).toHaveTextContent("留意長輩");
    }
    expect(desktop?.querySelector(".grid")?.children).toHaveLength(4);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("wraps every unbroken timeline field on desktop and mobile", () => {
    const phase = "P".repeat(60);
    const title = "T".repeat(120);
    const location = "L".repeat(200);
    const details = "D".repeat(500);
    const mediaCue = "M".repeat(500);
    const notes = "N".repeat(500);
    const roleName = "R".repeat(60);
    const personName = "S".repeat(120);
    const { container } = render(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={[
          {
            ...items[0],
            phase,
            title,
            location,
            details,
            mediaCue,
            notes,
            assignedStaff: [{ ...staff[0], roleName, personName }],
          },
        ]}
        staff={[{ ...staff[0], roleName, personName }]}
        canEdit={false}
      />,
    );
    const expectWrapped = (element: HTMLElement | null) =>
      expect(element).toHaveClass(
        "min-w-0",
        "break-words",
        "[overflow-wrap:anywhere]",
      );

    for (const layout of ["desktop", "mobile"]) {
      const surface = container.querySelector<HTMLElement>(
        `[data-timeline-layout="${layout}"]`,
      )!;
      expectWrapped(within(surface).getByText(phase));
      expectWrapped(within(surface).getByRole("heading", { name: title }));
      expectWrapped(within(surface).getByText(location));
      expectWrapped(within(surface).getByText(details));
      expectWrapped(within(surface).getByText(`音樂／影片：${mediaCue}`));
      expectWrapped(within(surface).getByText(`備註：${notes}`));
      expectWrapped(
        within(surface).getByText(new RegExp(personName)).closest("p"),
      );
    }
  });

  it("shows editor CRUD for populated data and only the general template for an empty list", () => {
    const { rerender } = render(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={items}
        staff={staff}
        canEdit
      />,
    );
    // 有資料時新增入口在頁面標題列；編輯與刪除改為掛在每一列上，
    // 桌面與手機兩種排版各渲染一次。
    expect(
      screen.queryByRole("button", { name: "新增流程項目" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "編輯 賓客入場" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "刪除 賓客入場" }),
    ).toHaveLength(2);

    rerender(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={[]}
        staff={staff}
        canEdit
      />,
    );
    const empty = screen.getByRole("region", { name: "尚無婚禮總流程" });
    expect(
      within(empty).getByRole("button", { name: "建立詳細午宴流程範本" }),
    ).toBeInTheDocument();
    expect(empty).toHaveTextContent("建立後可自由編輯");
    expect(empty).not.toHaveTextContent("匯入");
  });

  it("keeps delete feedback and falls back to the list heading after the last row disappears", async () => {
    const { rerender } = render(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={items}
        staff={staff}
        canEdit
      />,
    );

    rerender(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={[]}
        staff={staff}
        canEdit
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("已刪除流程項目");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "尚未建立婚禮總流程" })).toHaveFocus(),
    );
  });

  it("keeps template feedback and focuses the first editable row after 0 to 9 items", async () => {
    const templateItems = Array.from({ length: 9 }, (_, index) => ({
      ...items[0],
      id: `template_${index + 1}`,
      title: `流程 ${index + 1}`,
    }));
    const { rerender } = render(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={[]}
        staff={staff}
        canEdit
      />,
    );

    rerender(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={templateItems}
        staff={staff}
        canEdit
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已建立詳細午宴流程範本",
    );
    await waitFor(() =>
      expect(
        document.getElementById("wedding-timeline-edit-template_1"),
      ).toHaveFocus(),
    );
  });
});
