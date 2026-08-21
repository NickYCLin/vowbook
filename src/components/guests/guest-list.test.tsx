import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GuestManagedField } from "@prisma/client";

vi.mock("@/components/guests/guest-forms", () => ({
  CreateGuestDialog: () => <button>新增賓客表單</button>,
  EditGuestForm: ({
    name,
    managedFields,
    onSuccess,
  }: {
    name: string;
    managedFields: GuestManagedField[];
    onSuccess?: (message: string) => void;
  }) => (
    <button
      data-managed-fields={managedFields.join(",")}
      onClick={() => onSuccess?.("已更新賓客。")}
    >
      編輯 {name}
    </button>
  ),
  DeleteGuestForm: ({
    name,
    importSources,
  }: {
    name: string;
    importSources: Array<{ sourceLabel: string; sourceManaged: boolean }>;
  }) => (
    <button>
      刪除 {name}{" "}
      {importSources.length > 0
        ? importSources.map((source) => source.sourceLabel).join("+")
        : "人工"}
    </button>
  ),
}));

import { GuestList } from "./guest-list";

const guest = {
  category: "GUEST" as const,
  id: "guest_1",
  version: 3,
  workspaceId: "workspace_1",
  name: "王小明",
  side: "PARTNER_A" as const,
  attendanceStatus: "ATTENDING" as const,
  partySize: 2,
  notes: "需要兒童椅",
  seatingTable: { number: 1, name: "主桌" },
  importRecords: [],
  createdAt: new Date("2026-07-22T00:00:00.000Z"),
  updatedAt: new Date("2026-07-22T00:00:00.000Z"),
};

describe("GuestList", () => {
  it("shows a real empty state", () => {
    render(
      <GuestList workspaceId="workspace_1" guests={[]} canEdit={false} />,
    );

    expect(screen.getByText("婚宴名單還是空白的。")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("搜尋賓客姓名")).not.toBeInTheDocument();
  });

  it("shows the create form directly as the single editor path when the source is empty", () => {
    const { container } = render(
      <GuestList workspaceId="workspace_1" guests={[]} canEdit />,
    );

    expect(screen.getByText("婚宴名單還是空白的。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新增賓客表單" }),
    ).toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("separates newlyweds and family from general guests while keeping banquet headcount", () => {
    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[
          guest,
          { ...guest, id: "groom", name: "陳新郎", category: "COUPLE", partySize: 1 },
          { ...guest, id: "bride", name: "林新娘", category: "COUPLE", side: "PARTNER_B", partySize: 1 },
          { ...guest, id: "mother", name: "陳媽媽", category: "FAMILY", partySize: 1 },
        ]}
        canEdit={false}
      />
    );

    expect(screen.getByRole("heading", { name: "新人與家人" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "一般賓客" })).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "陳新郎" }).closest("li")!).getByText("新郎")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "林新娘" }).closest("li")!).getByText("新娘")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "陳媽媽" }).closest("li")!).getByText("新郎家人")).toBeInTheDocument();
    expect(screen.getByText("一般賓客組數")).toBeInTheDocument();
    expect(screen.getByText("新人與家人數")).toBeInTheDocument();
    expect(screen.getByText("宴席人數")).toBeInTheDocument();
    expect(screen.getByText("顯示 4 / 4 筆")).toBeInTheDocument();
  });

  it("renders guest details without edit controls for VIEWER", () => {
    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[guest]}
        canEdit={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "王小明" })).toBeInTheDocument();
    // 「男方親友」「出席」同時出現在賓客卡片與篩選選單，斷言要限定在卡片內。
    expect(screen.getAllByText("男方親友")).toHaveLength(2);
    const card = within(
      screen.getByRole("heading", { name: "王小明" }).closest("li")!,
    );
    expect(card.getByText("出席")).toBeInTheDocument();
    expect(card.getByText("2 位")).toBeInTheDocument();
    expect(screen.getByText("需要兒童椅")).toBeInTheDocument();
    // 桌名可以重複，賓客要看的是幾號桌，桌名只是對照用的標籤。
    expect(screen.getByText(/桌次：1 號桌/u)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps editor actions on each record without an inline create disclosure", () => {
    const { container } = render(
      <GuestList workspaceId="workspace_1" guests={[guest]} canEdit />,
    );

    // 新增入口已移到頁面標題列，清單內不再有展開式表單。
    expect(container.querySelector("details")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "新增賓客表單" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "編輯 王小明" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "刪除 王小明 人工" }),
    ).toBeInTheDocument();
  });

  it("announces and refocuses every edit success after the dialog closes", () => {
    render(<GuestList workspaceId="workspace_1" guests={[guest]} canEdit />);

    const editButton = screen.getByRole("button", { name: "編輯 王小明" });
    fireEvent.click(editButton);

    const feedback = screen.getByRole("status");
    expect(feedback).toHaveTextContent("已更新賓客。");
    expect(feedback).toHaveFocus();

    editButton.focus();
    fireEvent.click(editButton);
    expect(feedback).toHaveFocus();
  });

  it("searches trimmed names case-insensitively, reports results, and resets", () => {
    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[
          { ...guest, id: "guest_alpha", name: "Synthetic ALPHA" },
          {
            ...guest,
            id: "guest_beta",
            name: "Synthetic Beta",
            side: "PARTNER_B",
            attendanceStatus: "DECLINED",
            seatingTable: null,
          },
          {
            ...guest,
            id: "guest_gamma",
            name: "Gamma",
            side: "SHARED",
            attendanceStatus: "UNDECIDED",
            seatingTable: null,
          },
        ]}
        canEdit={false}
      />,
    );

    expect(screen.getByText("顯示 3 / 3 筆")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜尋賓客姓名"), {
      target: { value: "  alpha  " },
    });

    expect(screen.getByRole("heading", { name: "Synthetic ALPHA" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Synthetic Beta" })).not.toBeInTheDocument();
    expect(screen.getByText("符合 1 / 3 筆")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    expect(screen.getByRole("heading", { name: "Synthetic Beta" })).toBeInTheDocument();
    expect(screen.getByLabelText("搜尋賓客姓名")).toHaveValue("");
    expect(screen.getByText("顯示 3 / 3 筆")).toBeInTheDocument();
  });

  it("combines filters without changing per-source canonical Guest totals", () => {
    const importedAttending = {
      ...guest,
      id: "guest_imported_attending",
      name: "合成甲",
      importRecords: [
        {
          provenanceKey: "attending-formstack",
          source: "FORMSTACK",
          sourceLabel: "合成表單",
          sourceManaged: false,
          managedFields: [],
          details: null,
        },
        {
          provenanceKey: "linein-after-formstack",
          source: "LINEIN",
          sourceLabel: "拍拍印",
          sourceManaged: true,
          managedFields: [
            "NAME",
            "SIDE",
            "ATTENDANCE_STATUS",
          ] as GuestManagedField[],
          details: null,
        },
      ],
    };
    const importedDeclined = {
      ...guest,
      id: "guest_imported_declined",
      name: "合成乙",
      side: "PARTNER_B" as const,
      attendanceStatus: "DECLINED" as const,
      partySize: 1,
      seatingTable: null,
      importRecords: [
        {
          provenanceKey: "declined-linein",
          source: "LINEIN",
          sourceLabel: "拍拍印",
          sourceManaged: true,
          managedFields: [
            "NAME",
            "SIDE",
            "ATTENDANCE_STATUS",
          ] as GuestManagedField[],
          details: null,
        },
      ],
    };

    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[importedAttending, importedDeclined]}
        canEdit={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("出席狀態篩選"), {
      target: { value: "DECLINED" },
    });
    fireEvent.change(screen.getByLabelText("關係篩選"), {
      target: { value: "PARTNER_B" },
    });
    fireEvent.change(screen.getByLabelText("座位狀態篩選"), {
      target: { value: "UNASSIGNED" },
    });

    expect(screen.getByRole("heading", { name: "合成乙" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "合成甲" })).not.toBeInTheDocument();
    expect(
      screen.getByText("拍拍印：2 組 · 出席 1 組／2 位 · 不出席 1 組"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("合成表單：1 組 · 出席 1 組／2 位 · 不出席 0 組"),
    ).toBeInTheDocument();
  });

  it("distinguishes no filter results from an empty source collection", () => {
    render(
      <GuestList workspaceId="workspace_1" guests={[guest]} canEdit={false} />,
    );

    fireEvent.change(screen.getByLabelText("搜尋賓客姓名"), {
      target: { value: "不存在的合成姓名" },
    });

    expect(screen.getByText("找不到符合條件的名單成員。")).toBeInTheDocument();
    expect(screen.queryByText("婚宴名單還是空白的。")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "清除篩選" })[0],
    ).toHaveClass("min-h-11");
  });

  it("summarises每位賓客的關係、人數與座位在同一張卡片上", () => {
    render(
      <GuestList workspaceId="workspace_1" guests={[guest]} canEdit={false} />,
    );

    const card = screen.getByRole("heading", { name: "王小明" }).closest("li");
    expect(card).not.toBeNull();
    const summary = within(card as HTMLElement);
    expect(summary.getByText("男方親友")).toBeInTheDocument();
    expect(summary.getByText("2 位")).toBeInTheDocument();
    expect(summary.getByText(/桌次：1 號桌/u)).toBeInTheDocument();
    expect(summary.getByText("出席")).toBeInTheDocument();
  });

  it("shows the workspace-wide guest totals above the list", () => {
    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[
          guest,
          {
            ...guest,
            id: "guest_undecided",
            name: "尚未回覆",
            attendanceStatus: "UNDECIDED",
            partySize: 4,
            seatingTable: null,
          },
        ]}
        canEdit={false}
      />,
    );

    expect(screen.getByText("一般賓客組數")).toBeInTheDocument();
    expect(screen.getByText("宴席人數")).toBeInTheDocument();
    // 只有王小明出席，共 2 位；尚未確認 1 組；已排座位 1/2。
    expect(
      screen.getByText("已回覆 1 組 · 尚未確認 1 組"),
    ).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("未安排 1 筆")).toBeInTheDocument();
  });

  it("shows a clear unassigned label when a guest has no table", () => {
    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[{ ...guest, seatingTable: null }]}
        canEdit={false}
      />,
    );

    expect(screen.getByText("桌次：尚未安排")).toBeInTheDocument();
  });

  it("shows VIEWER every source aggregate and marker but never receives PII details", () => {
    const importedGuest = {
      ...guest,
      id: "guest_imported",
      attendanceStatus: "DECLINED" as const,
      partySize: 1,
      importRecords: [
        {
          provenanceKey: "viewer-formstack",
          source: "FORMSTACK",
          sourceLabel: "合成表單",
          sourceManaged: false,
          managedFields: [],
          details: null,
        },
        {
          provenanceKey: "linein-after-formstack",
          source: "LINEIN",
          sourceLabel: "拍拍印",
          sourceManaged: true,
          managedFields: [
            "NAME",
            "SIDE",
            "ATTENDANCE_STATUS",
          ] as GuestManagedField[],
          details: null,
        },
      ],
    };
    const attendingGuest = {
      ...guest,
      id: "guest_attending",
      partySize: 3,
      importRecords: [
        {
          provenanceKey: "viewer-attending-linein",
          source: "LINEIN",
          sourceLabel: "拍拍印",
          sourceManaged: true,
          managedFields: [
            "NAME",
            "SIDE",
            "ATTENDANCE_STATUS",
          ] as GuestManagedField[],
          details: null,
        },
      ],
    };

    const { container } = render(
      <GuestList
        workspaceId="workspace_1"
        guests={[attendingGuest, importedGuest]}
        canEdit={false}
      />,
    );

    expect(
      screen.getByText("拍拍印：2 組 · 出席 1 組／3 位 · 不出席 1 組"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("合成表單：1 組 · 出席 0 組／0 位 · 不出席 1 組"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("拍拍印")).toHaveLength(2);
    expect(screen.getByText("合成表單")).toBeInTheDocument();
    expect(
      screen.getAllByText("聯絡與留言限可編輯成員查看"),
    ).toHaveLength(2);
    expect(container.querySelector("details")).toBeNull();
    expect(container).not.toHaveTextContent("PII_PHONE_SENTINEL");
    expect(container).not.toHaveTextContent("PII_EMAIL_SENTINEL");
    expect(container).not.toHaveTextContent("PII_ADDRESS_SENTINEL");
    expect(container).not.toHaveTextContent("PII_MESSAGE_SENTINEL");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows source-labelled editor details and passes exact managed fields to edit", () => {
    const importedGuest = {
      ...guest,
      id: "guest_imported",
      importRecords: [
        {
          provenanceKey: "editor-formstack",
          source: "FORMSTACK",
          sourceLabel: "合成表單",
          sourceManaged: false,
          managedFields: [],
          details: {
            sourcePartySize: null,
            relationshipLabel: null,
            contactPhone: null,
            contactEmail: null,
            ceremonyAttendance: null,
            childSeatCount: null,
            vegetarianCount: null,
            invitationDelivery: null,
            mailingAddress: null,
            guestMessage: null,
            attendanceReply: null,
            invitationReply: null,
            sourceSubmittedAt: null,
          },
        },
        {
          provenanceKey: "editor-linein",
          source: "LINEIN",
          sourceLabel: "拍拍印",
          sourceManaged: true,
          managedFields: [
            "NAME",
            "SIDE",
            "ATTENDANCE_STATUS",
          ] as GuestManagedField[],
          details: {
            sourcePartySize: 2,
            relationshipLabel: "大學  同學\n同社團",
            contactPhone: "0900-000-000",
            contactEmail: "guest@example.test",
            ceremonyAttendance: false,
            childSeatCount: 1,
            vegetarianCount: 0,
            invitationDelivery: "UNKNOWN" as const,
            mailingAddress: null,
            guestMessage: "祝福新人",
            attendanceReply: "不克出席，但仍希望收到喜餅",
            invitationReply: null,
            sourceSubmittedAt: new Date("2026-07-20T08:30:00.000Z"),
          },
        },
      ],
    };

    const { container } = render(
      <GuestList
        workspaceId="workspace_1"
        guests={[importedGuest]}
        canEdit
      />,
    );

    const details = screen.getByText("拍拍印匯入明細").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("拍拍印匯入明細")).toHaveClass("min-h-11");
    const importedDetails = within(details as HTMLElement);
    expect(
      importedDetails.getByText("不克出席，但仍希望收到喜餅"),
    ).toBeInTheDocument();
    expect((details as HTMLElement).textContent).toContain(
      "大學  同學\n同社團",
    );
    const relationshipValue = Array.from(
      (details as HTMLElement).querySelectorAll("dd"),
    ).find((element) => element.textContent === "大學  同學\n同社團");
    expect(relationshipValue).toHaveClass("whitespace-pre-wrap");
    expect(importedDetails.getByText("0900-000-000")).toBeInTheDocument();
    expect(importedDetails.getByText("來源邀請人數（含本人）")).toBeInTheDocument();
    expect(importedDetails.getByText("2 位")).toBeInTheDocument();
    expect(importedDetails.getByText("祝福新人")).toBeInTheDocument();
    expect(importedDetails.getByText("未填寫")).toBeInTheDocument();
    expect(
      within(
        screen.getByText("合成表單匯入明細").closest("details") as HTMLElement,
      ).getByText("此來源未提供可顯示的明細。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編輯 王小明" })).toHaveAttribute(
      "data-managed-fields",
      "NAME,SIDE,ATTENDANCE_STATUS",
    );
    expect(
      screen.getByRole("button", { name: "刪除 王小明 合成表單+拍拍印" }),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("externalId");
  });

  it("passes generic PARTY_SIZE ownership through to the edit form", () => {
    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[
          {
            ...guest,
            importRecords: [
              {
                provenanceKey: "future-party-size-owner",
                source: "FUTURE_RSVP",
                sourceLabel: "未來來源",
                sourceManaged: true,
                managedFields: ["PARTY_SIZE"],
                details: null,
              },
            ],
          },
        ]}
        canEdit
      />,
    );

    expect(screen.getByRole("button", { name: "編輯 王小明" })).toHaveAttribute(
      "data-managed-fields",
      "PARTY_SIZE",
    );
  });

  it("keeps edit UI for imported editable copies", () => {
    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[
          {
            ...guest,
            importRecords: [
              {
                provenanceKey: "editable-formstack",
                source: "FORMSTACK",
                sourceLabel: "合成表單",
                sourceManaged: false,
          managedFields: [],
                details: null,
              },
            ],
          },
        ]}
        canEdit
      />,
    );

    expect(
      screen.getByRole("button", { name: "編輯 王小明" }),
    ).toBeInTheDocument();
  });
});
