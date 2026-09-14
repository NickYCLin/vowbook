import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setWeddingStaffRedEnvelopeSentAction } = vi.hoisted(() => ({
  setWeddingStaffRedEnvelopeSentAction: vi.fn(),
}));

vi.mock("@/actions/wedding-staff", () => ({
  setWeddingStaffRedEnvelopeSentAction,
}));

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

const timelineAssignmentFingerprint =
  `vowbook-staff-timeline-v1:${"0".repeat(64)}`;

const staff = [
  {
    id: "staff_1",
    roleName: "招待",
    personName: "小安",
    contactPhone: "0912 345 678",
    notes: "負責 A 區",
    mealCount: 1,
    vegetarianMealCount: 0,
    redEnvelopeAmount: 2000,
    redEnvelopeSentAt: null,
    version: 1,
    timelineAssignmentFingerprint,
  },
  {
    id: "staff_2",
    roleName: "招待",
    personName: "小美",
    contactPhone: null,
    notes: null,
    mealCount: null,
    vegetarianMealCount: null,
    redEnvelopeAmount: null,
    redEnvelopeSentAt: null,
    version: 0,
    timelineAssignmentFingerprint,
  },
  {
    id: "staff_3",
    roleName: "主持",
    personName: "小安",
    contactPhone: null,
    notes: "同人多職務",
    mealCount: 6,
    vegetarianMealCount: 2,
    redEnvelopeAmount: 3600,
    redEnvelopeSentAt: new Date("2026-09-01T02:00:00.000Z"),
    version: 2,
    timelineAssignmentFingerprint,
  },
];

describe("WeddingStaffList", () => {
  beforeEach(() => setWeddingStaffRedEnvelopeSentAction.mockReset());

  it("separates planned red envelopes from the ones already handed out", () => {
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit={false}
      />,
    );

    expect(screen.getByText("紅包總額").nextSibling).toHaveTextContent(
      "NT$ 5,600",
    );
    expect(screen.getByText("2 位要包紅包")).toBeInTheDocument();
    expect(screen.getByText("已發放").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("尚未發放").nextSibling).toHaveTextContent("1");

    expect(screen.getByText("紅包 NT$ 3,600・已發放")).toBeInTheDocument();
    expect(
      screen.getAllByText("紅包 NT$ 2,000・尚未發放").length,
    ).toBeGreaterThan(0);
  });

  it("gives a viewer no red-envelope controls", () => {
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "標記已發放" })).toBeNull();
    expect(screen.queryByRole("button", { name: "改回未發放" })).toBeNull();
  });

  it("marks a red envelope as handed out with the staff CAS token", async () => {
    setWeddingStaffRedEnvelopeSentAction.mockResolvedValue({
      status: "success",
      message: "已標記紅包為已發放。",
    });
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit
      />,
    );

    const form = screen.getByRole("form", { name: "標記 小安 已發放紅包表單" });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(setWeddingStaffRedEnvelopeSentAction).toHaveBeenCalledOnce(),
    );
    expect(setWeddingStaffRedEnvelopeSentAction.mock.calls[0]?.[0]).toBe(
      "workspace_internal",
    );
    expect(setWeddingStaffRedEnvelopeSentAction.mock.calls[0]?.[1]).toBe(
      "staff_1",
    );
    const formData = setWeddingStaffRedEnvelopeSentAction.mock
      .calls[0]?.[3] as FormData;
    expect(formData.get("expectedVersion")).toBe("1");
    expect(formData.get("redEnvelopeSent")).toBe("on");
    // 發放時間一律由 server 決定，表單不得夾帶。
    expect(formData.get("redEnvelopeSentAt")).toBeNull();
  });

  it("offers to undo a red envelope that was already handed out", async () => {
    setWeddingStaffRedEnvelopeSentAction.mockResolvedValue({
      status: "success",
      message: "已改回尚未發放紅包。",
    });
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit
      />,
    );

    fireEvent.submit(
      screen.getByRole("form", { name: "改回 小安 尚未發放紅包表單" }),
    );

    await waitFor(() =>
      expect(setWeddingStaffRedEnvelopeSentAction).toHaveBeenCalledOnce(),
    );
    const formData = setWeddingStaffRedEnvelopeSentAction.mock
      .calls[0]?.[3] as FormData;
    expect(formData.get("redEnvelopeSent")).toBeNull();
  });

  it("shows no red-envelope line for someone who does not get one", () => {
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit
      />,
    );

    const noEnvelope = screen
      .getByRole("heading", { name: "小美" })
      .closest("li")!;
    expect(within(noEnvelope).queryByText(/紅包/u)).toBeNull();
    expect(
      within(noEnvelope).queryByRole("button", { name: "標記已發放" }),
    ).toBeNull();
  });

  it("summarizes meals and shows each person's own vegetarian split", () => {
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={staff}
        canEdit={false}
      />,
    );

    expect(screen.getByText("便當份數").nextSibling).toHaveTextContent("7");
    expect(screen.getByText("2 筆需要便當")).toBeInTheDocument();
    expect(screen.getByText("葷素分配").nextSibling).toHaveTextContent(
      "葷 5／素 2",
    );

    const reception = screen.getByRole("region", { name: "招待" });
    expect(within(reception).getByText("便當 1 份（全葷食）")).toBeInTheDocument();
    expect(within(reception).getByText("不需要便當")).toBeInTheDocument();

    const host = screen.getByRole("region", { name: "主持" });
    expect(
      within(host).getByText("便當 6 份（葷 4／素 2）"),
    ).toBeInTheDocument();
  });

  it("names an all-vegetarian team without printing a zero", () => {
    render(
      <WeddingStaffList
        workspaceId="workspace_internal"
        staff={[
          {
            ...staff[0],
            id: "staff_vegetarian",
            roleName: "花藝",
            mealCount: 3,
            vegetarianMealCount: 3,
          },
        ]}
        canEdit={false}
      />,
    );

    expect(screen.getByText("便當 3 份（全素食）")).toBeInTheDocument();
    expect(screen.getByText("葷素分配").nextSibling).toHaveTextContent(
      "葷 0／素 3",
    );
  });

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
