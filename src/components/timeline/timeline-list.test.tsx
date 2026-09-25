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
  it("renders one responsive timeline with summary, staff chips, steps, cues and notes", () => {
    const { container } = render(
      <WeddingTimelineList
        workspaceId="workspace_internal"
        items={[
          ...items,
          {
            ...items[0],
            id: "item_2",
            startTime: "12:00",
            endTime: "12:20",
            title: "第一次進場",
            details: "小花童進場\n新人進場\n\n舉杯",
            mediaCue: null,
            notes: null,
            assignedStaff: [],
          },
        ]}
        staff={staff}
        canEdit={false}
      />,
    );
    const timeline = container.querySelector<HTMLElement>(
      '[data-timeline-layout="timeline"]',
    )!;
    expect(container.querySelectorAll("[data-timeline-layout]")).toHaveLength(1);
    expect(timeline.querySelectorAll("[data-timeline-item]")).toHaveLength(2);

    const summary = container.querySelector<HTMLElement>("[data-timeline-summary]")!;
    expect(summary).toHaveTextContent("11:30–12:20");
    expect(summary).toHaveTextContent("2 段");
    expect(summary).toHaveTextContent("1 段");

    const [first, second] = Array.from(
      timeline.querySelectorAll<HTMLElement>("[data-timeline-item]"),
    );
    expect(first).toHaveTextContent("11:30–12:00");
    expect(first).toHaveTextContent("迎賓");
    expect(first).toHaveTextContent("宴會廳外");
    expect(within(first).getByText("迎賓音樂")).toBeInTheDocument();
    expect(within(first).getByText("開場影片")).toBeInTheDocument();
    expect(first.querySelector("[data-staff-chip]")).toHaveTextContent("招待・小安");
    expect(first).toHaveTextContent("備註留意長輩");

    expect(second).toHaveTextContent("尚未指派負責人");
    const steps = within(second).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "1小花童進場",
      "2新人進場",
      "3舉杯",
    ]);
    expect(second).not.toHaveTextContent("音樂／影片");
    expect(second).not.toHaveTextContent("備註");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("wraps every unbroken timeline field", () => {
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

    const surface = container.querySelector<HTMLElement>(
      '[data-timeline-layout="timeline"]',
    )!;
    expectWrapped(within(surface).getByText(phase));
    expectWrapped(within(surface).getByRole("heading", { name: title }));
    expectWrapped(within(surface).getByText(location));
    expectWrapped(within(surface).getByText(details));
    expectWrapped(within(surface).getByText(mediaCue));
    expectWrapped(within(surface).getByText(notes));
    expectWrapped(surface.querySelector("[data-staff-chip]"));
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
    // 有資料時新增入口在頁面標題列；編輯與刪除掛在每一列標題旁。
    expect(
      screen.queryByRole("button", { name: "新增流程項目" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "編輯 賓客入場" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "刪除 賓客入場" }),
    ).toHaveLength(1);

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
    expect(empty).toHaveTextContent("套用時可明確選擇是否加入西式證婚流程");
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
