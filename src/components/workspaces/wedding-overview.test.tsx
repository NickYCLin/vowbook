import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeddingOverview } from "./wedding-overview";

const data = {
  guests: {
    generalGroupTotal: 10,
    respondedGroupTotal: 8,
    attendingGroupTotal: 7,
    declinedGroupTotal: 1,
    undecidedGroupTotal: 2,
    attendingHeadcount: 20,
    assignedAttendingHeadcount: 15,
    unassignedAttendingHeadcount: 5,
    childSeatCount: 3,
    vegetarianCount: 4,
    bySide: {
      PARTNER_A: {
        groupTotal: 4,
        attendingGroupTotal: 3,
        attendingHeadcount: 8,
      },
      PARTNER_B: {
        groupTotal: 4,
        attendingGroupTotal: 3,
        attendingHeadcount: 9,
      },
      SHARED: {
        groupTotal: 2,
        attendingGroupTotal: 1,
        attendingHeadcount: 3,
      },
    },
    invitations: { PAPER: 3, DIGITAL: 4, NONE: 1, UNKNOWN: 2, UNSET: 5 },
    gifts: {
      recordedCount: 8,
      unrecordedGeneralGroupCount: 2,
      totalAmount: "126000",
    },
  },
  seating: {
    tableTotal: 3,
    capacityTotal: 30,
    assignedHeadcount: 15,
    remainingCapacity: 15,
  },
  tasks: { total: 6, todo: 2, inProgress: 2, done: 2, overdue: 1 },
  budget: {
    itemCount: 5,
    planningCount: 2,
    balanceDueCount: 2,
    overdueBalanceDueCount: 1,
    paidCount: 1,
    plannedTotal: "500000",
    actualTotal: "340000",
    balanceDueTotal: "120000",
    selfProvidedCount: 2,
    notPlannedCount: 1,
  },
  operations: {
    staffTotal: 4,
    timelineItemTotal: 8,
    memberTotal: 3,
  },
} as const;

describe("WeddingOverview", () => {
  it("renders linked preparation progress and distinguishes groups from headcount", () => {
    render(<WeddingOverview workspaceId="workspace_1" data={data} />);

    expect(screen.getByRole("heading", { name: "籌備進度" })).toBeInTheDocument();
    expect(screen.getByText("一般賓客回覆")).toBeInTheDocument();
    expect(screen.getByText("8/10 組")).toBeInTheDocument();
    expect(screen.getByText("確認出席人數")).toBeInTheDocument();
    expect(screen.getByText("20 人")).toBeInTheDocument();
    expect(screen.getByText(/規劃中 2 項/u)).toHaveTextContent(
      "待付尾款 2 項／NT$120,000",
    );
    expect(screen.getByText(/已有／自備 2 項/u)).toHaveTextContent(
      "不準備 1 項",
    );
    expect(
      screen.getByRole("progressbar", { name: "一般賓客回覆進度" }),
    ).toHaveAttribute("aria-valuenow", "80");
    expect(
      screen.getByRole("progressbar", { name: "確認出席者入席進度" }),
    ).toHaveAttribute("aria-valuenow", "75");

    expect(screen.getByRole("link", { name: /查看賓客名單/u })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/guests",
    );
    expect(screen.getByRole("link", { name: /查看桌次安排/u })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/tables",
    );
    expect(screen.getByRole("link", { name: /查看婚宴任務/u })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/tasks",
    );
    expect(screen.getByRole("link", { name: /查看婚禮花費/u })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/budget",
    );
  });

  it("shows side, invitation, requirement, and operations summaries without PII", () => {
    render(<WeddingOverview workspaceId="workspace_1" data={data} />);

    const guestRegion = screen.getByRole("region", { name: "賓客與宴席摘要" });
    expect(within(guestRegion).getByText("男方親友")).toBeInTheDocument();
    expect(within(guestRegion).getByText("女方親友")).toBeInTheDocument();
    expect(within(guestRegion).getByText("共同親友")).toBeInTheDocument();
    expect(within(guestRegion).getByText("紙本 3 組")).toBeInTheDocument();
    expect(within(guestRegion).getByText("數位 4 組")).toBeInTheDocument();
    expect(within(guestRegion).getByText("尚未確認 2 組")).toBeInTheDocument();
    expect(within(guestRegion).getByText("尚未填寫 5 組")).toBeInTheDocument();
    expect(within(guestRegion).getByText("兒童椅 3 張")).toBeInTheDocument();
    expect(within(guestRegion).getByText("素食 4 人")).toBeInTheDocument();
    expect(within(guestRegion).getByText("已登記 8 筆")).toBeInTheDocument();
    expect(within(guestRegion).getByText("合計 NT$126,000")).toBeInTheDocument();
    expect(
      within(guestRegion).getByText("一般賓客未有紀錄 2 組"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "查看禮金簿" }),
    ).toHaveAttribute("href", "/workspaces/workspace_1/gifts");

    const operations = screen.getByRole("region", { name: "婚宴執行摘要" });
    expect(within(operations).getByText("4 位工作人員")).toBeInTheDocument();
    expect(within(operations).getByText("8 個流程項目")).toBeInTheDocument();
    expect(within(operations).getByText("3 位協作者")).toBeInTheDocument();
    expect(screen.getByText(/逾期尾款 1 項/u)).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "婚禮花費付清進度" })
        .firstElementChild,
    ).toHaveClass("bg-danger");
    expect(screen.queryByRole("link", { name: "查看儀式安排" })).toBeNull();
    expect(screen.queryByText(/@/u)).not.toBeInTheDocument();
  });

  it("shows over-capacity seating as a danger instead of available zero", () => {
    render(
      <WeddingOverview
        workspaceId="workspace_1"
        data={{
          ...data,
          seating: {
            tableTotal: 1,
            capacityTotal: 10,
            assignedHeadcount: 12,
            remainingCapacity: -2,
          },
        }}
      />,
    );

    const guestRegion = screen.getByRole("region", { name: "賓客與宴席摘要" });
    expect(within(guestRegion).getByText(/已超出 2 席/u)).toHaveClass(
      "text-danger",
    );
    expect(within(guestRegion).queryByText(/尚有 0 席/u)).toBeNull();
    expect(
      screen.getByRole("progressbar", { name: "確認出席者入席進度" })
        .firstElementChild,
    ).toHaveClass("bg-danger");
  });

  it("uses caution until tasks and tracked expenses are actually complete", () => {
    render(
      <WeddingOverview
        workspaceId="workspace_1"
        data={{
          ...data,
          tasks: { total: 6, todo: 4, inProgress: 0, done: 2, overdue: 0 },
          budget: {
            ...data.budget,
            itemCount: 5,
            planningCount: 4,
            balanceDueCount: 0,
            overdueBalanceDueCount: 0,
            paidCount: 1,
          },
        }}
      />,
    );

    expect(
      screen.getByRole("progressbar", { name: "婚宴任務完成進度" })
        .firstElementChild,
    ).toHaveClass("bg-caution");
    expect(
      screen.getByRole("progressbar", { name: "婚禮花費付清進度" })
        .firstElementChild,
    ).toHaveClass("bg-caution");
  });

  it("renders a stable empty overview without NaN or Infinity", () => {
    render(
      <WeddingOverview
        workspaceId="workspace_empty"
        data={{
          guests: {
            generalGroupTotal: 0,
            respondedGroupTotal: 0,
            attendingGroupTotal: 0,
            declinedGroupTotal: 0,
            undecidedGroupTotal: 0,
            attendingHeadcount: 0,
            assignedAttendingHeadcount: 0,
            unassignedAttendingHeadcount: 0,
            childSeatCount: 0,
            vegetarianCount: 0,
            bySide: {
              PARTNER_A: {
                groupTotal: 0,
                attendingGroupTotal: 0,
                attendingHeadcount: 0,
              },
              PARTNER_B: {
                groupTotal: 0,
                attendingGroupTotal: 0,
                attendingHeadcount: 0,
              },
              SHARED: {
                groupTotal: 0,
                attendingGroupTotal: 0,
                attendingHeadcount: 0,
              },
            },
            invitations: {
              PAPER: 0,
              DIGITAL: 0,
              NONE: 0,
              UNKNOWN: 0,
              UNSET: 0,
            },
            gifts: {
              recordedCount: 0,
              unrecordedGeneralGroupCount: 0,
              totalAmount: "0",
            },
          },
          seating: {
            tableTotal: 0,
            capacityTotal: 0,
            assignedHeadcount: 0,
            remainingCapacity: 0,
          },
          tasks: { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 },
          budget: {
            itemCount: 0,
            planningCount: 0,
            balanceDueCount: 0,
            overdueBalanceDueCount: 0,
            paidCount: 0,
            plannedTotal: "0",
            actualTotal: "0",
            balanceDueTotal: "0",
            selfProvidedCount: 0,
            notPlannedCount: 0,
          },
          operations: {
            staffTotal: 0,
            timelineItemTotal: 0,
            memberTotal: 1,
          },
        }}
      />,
    );

    for (const progress of screen.getAllByRole("progressbar")) {
      expect(progress).toHaveAttribute("aria-valuenow", "0");
    }
    expect(
      screen.getByRole("progressbar", { name: "婚宴任務完成進度" })
        .firstElementChild,
    ).toHaveClass("bg-line-strong");
    expect(
      screen.getByRole("progressbar", { name: "婚禮花費付清進度" })
        .firstElementChild,
    ).toHaveClass("bg-line-strong");
    expect(
      screen.getByRole("progressbar", { name: "確認出席者入席進度" })
        .firstElementChild,
    ).toHaveClass("bg-line-strong");
    expect(document.body).not.toHaveTextContent(/NaN|Infinity/u);
  });
});
