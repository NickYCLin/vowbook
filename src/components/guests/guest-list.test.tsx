import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GuestManagedField } from "@prisma/client";
import { installModalDialogPolyfill } from "@/test/modal-dialog";

installModalDialogPolyfill();

vi.mock("@/components/guests/guest-forms", () => ({
  CreateGuestDialog: () => <button>新增賓客表單</button>,
  EditGuestForm: ({
    name,
    managedFields,
    details,
    onSuccess,
  }: {
    name: string;
    managedFields: GuestManagedField[];
    details: { contactPhone: string | null } | null;
    onSuccess?: (message: string) => void;
  }) => (
    <button
      data-managed-fields={managedFields.join(",")}
      data-contact-phone={details?.contactPhone ?? ""}
      onClick={() => onSuccess?.("已更新賓客。")}
    >
      編輯 {name}
    </button>
  ),
  DeleteGuestForm: ({
    name,
    hasManagedImportSource,
  }: {
    name: string;
    hasManagedImportSource: boolean;
  }) => (
    <button>
      刪除 {name}{" "}
      {hasManagedImportSource ? "匯入" : "一般"}
    </button>
  ),
}));

import { GuestList } from "./guest-list";

const guest = {
  category: "GUEST" as const,
  seniority: "ELDER" as const,
  id: "guest_1",
  version: 3,
  workspaceId: "workspace_1",
  name: "王小明",
  side: "PARTNER_A" as const,
  attendanceStatus: "ATTENDING" as const,
  partySize: 2,
  notes: "需要兒童椅",
  seatingTable: { number: 1, name: "主桌" },
  details: null,
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
          { ...guest, id: "mother", name: "陳媽媽一家", category: "FAMILY", partySize: 3 },
        ]}
        canEdit={false}
      />
    );

    expect(screen.getByRole("heading", { name: "新人與家人" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "一般賓客" })).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "陳新郎" }).closest("li")!).getByText("新郎")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "林新娘" }).closest("li")!).getByText("新娘")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "陳媽媽一家" }).closest("li")!).getByText("新郎家人")).toBeInTheDocument();
    expect(screen.getByText("一般賓客組數")).toBeInTheDocument();
    const hostStat = screen.getByText("新人與家人數").closest("div");
    expect(hostStat).not.toBeNull();
    expect(within(hostStat as HTMLElement).getByText("5")).toBeInTheDocument();
    expect(within(hostStat as HTMLElement).getByText("出席 5 位"))
      .toBeInTheDocument();
    const banquetStat = screen.getByText("宴席人數").closest("div");
    expect(banquetStat).not.toBeNull();
    expect(within(banquetStat as HTMLElement).getByText("7")).toBeInTheDocument();
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
    expect(card.getByText(/長輩/u)).toBeInTheDocument();
    expect(screen.getByText("需要兒童椅")).toBeInTheDocument();
    // 桌名可以重複，賓客要看的是幾號桌，桌名只是對照用的標籤。
    expect(screen.getByText(/桌次：1 號桌/u)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps editor actions on each record without an inline create disclosure", () => {
    const { container } = render(
      <GuestList workspaceId="workspace_1" guests={[guest]} canEdit />,
    );

    // 新增入口已移到頁面標題列；特殊需求可以展開，但清單內不再藏新增表單。
    expect(container.querySelector('details form[aria-label="新增名單成員表單"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: "新增賓客表單" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "編輯 王小明" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "刪除 王小明 一般" }),
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

  it("combines filters without exposing source-specific labels", () => {
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
    expect(screen.queryByText(/拍拍印/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/合成表單/u)).not.toBeInTheDocument();
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

  it("summarises child-seat and vegetarian needs with the people who need them", () => {
    const details = (childSeatCount: number, vegetarianCount: number) => ({
      relationshipLabel: null,
      contactPhone: null,
      contactEmail: null,
      ceremonyAttendance: null,
      childSeatCount,
      vegetarianCount,
      invitationDelivery: null,
      mailingAddress: null,
      guestMessage: null,
      attendanceReply: null,
      invitationReply: null,
    });

    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[
          {
            ...guest,
            id: "confirmed-parent",
            name: "已確認家庭",
            details: details(2, 1),
          },
          {
            ...guest,
            id: "confirmed-family",
            name: "新人家人",
            category: "FAMILY",
            partySize: 1,
            details: details(0, 2),
          },
          {
            ...guest,
            id: "pending-parent",
            name: "待確認家庭",
            attendanceStatus: "UNDECIDED",
            seatingTable: null,
            details: details(1, 1),
          },
          {
            ...guest,
            id: "declined-parent",
            name: "不出席家庭",
            attendanceStatus: "DECLINED",
            seatingTable: null,
            details: details(5, 6),
          },
        ]}
        canEdit
      />,
    );

    const requirements = screen.getByRole("region", {
      name: "宴席特殊需求",
    });
    expect(
      within(requirements).getByText(
        "總數包含已確認出席與尚未確認；不出席不計入。",
      ),
    ).toBeInTheDocument();

    const childSeats = within(requirements)
      .getByText("兒童座椅需求")
      .closest("details");
    expect(childSeats).not.toBeNull();
    expect(within(childSeats as HTMLElement).getByText("3 張")).toBeInTheDocument();
    expect(
      within(childSeats as HTMLElement).getByText(
        "已確認 2 張 · 待確認 1 張",
      ),
    ).toBeInTheDocument();
    expect(
      within(childSeats as HTMLElement).getByText("已確認家庭"),
    ).toBeInTheDocument();
    expect(
      within(childSeats as HTMLElement).getByText("待確認家庭"),
    ).toBeInTheDocument();
    expect(
      within(childSeats as HTMLElement).queryByText("不出席家庭"),
    ).not.toBeInTheDocument();

    const vegetarian = within(requirements)
      .getByText("素食餐需求")
      .closest("details");
    expect(vegetarian).not.toBeNull();
    expect(within(vegetarian as HTMLElement).getByText("4 位")).toBeInTheDocument();
    expect(
      within(vegetarian as HTMLElement).getByText(
        "已確認 3 位 · 待確認 1 位",
      ),
    ).toBeInTheDocument();
    expect(
      within(vegetarian as HTMLElement).getByText("已確認家庭"),
    ).toBeInTheDocument();
    expect(
      within(vegetarian as HTMLElement).getByText("新人家人"),
    ).toBeInTheDocument();
    expect(
      within(vegetarian as HTMLElement).getByText("待確認家庭"),
    ).toBeInTheDocument();
    expect(
      within(vegetarian as HTMLElement).queryByText("不出席家庭"),
    ).not.toBeInTheDocument();
  });

  it("summarises paper and digital invitations with their recipient lists", () => {
    const details = (
      invitationDelivery: "PAPER" | "DIGITAL" | "NONE" | "UNKNOWN" | null,
      contactPhone: string | null = null,
      mailingAddress: string | null = null,
    ) => ({
      relationshipLabel: null,
      contactPhone,
      contactEmail: null,
      ceremonyAttendance: null,
      childSeatCount: null,
      vegetarianCount: null,
      invitationDelivery,
      mailingAddress,
      guestMessage: null,
      attendanceReply: null,
      invitationReply: null,
    });

    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[
          {
            ...guest,
            id: "paper-attending",
            name: "紙本賓客",
            details: details(
              "PAPER",
              "0900-123-456",
              "台北市幸福路 1 號\n幸福大樓 2 樓",
            ),
          },
          {
            ...guest,
            id: "paper-declined",
            name: "不出席仍寄紙本",
            attendanceStatus: "DECLINED",
            seatingTable: null,
            details: details("PAPER"),
          },
          {
            ...guest,
            id: "digital-pending",
            name: "電子喜帖賓客",
            attendanceStatus: "UNDECIDED",
            seatingTable: null,
            details: details("DIGITAL"),
          },
          {
            ...guest,
            id: "no-invitation",
            name: "不需寄送賓客",
            details: details("NONE"),
          },
          {
            ...guest,
            id: "unknown-invitation",
            name: "尚未設定賓客",
            details: details(null),
          },
        ]}
        canEdit
      />,
    );

    const invitations = screen.getByRole("region", { name: "喜帖安排" });
    expect(
      within(invitations).getByText(
        "每筆名單依目前喜帖方式計 1 份，不受出席狀態影響。",
      ),
    ).toBeInTheDocument();
    expect(
      within(invitations).getByText("不需寄送 1 組 · 尚未設定 1 組"),
    ).toBeInTheDocument();

    const paper = within(invitations).getByText("紙本喜帖").closest("details");
    expect(paper).not.toBeNull();
    expect(within(paper as HTMLElement).getByText("2 份")).toBeInTheDocument();
    const paperRecipientTrigger = within(paper as HTMLElement).getByRole(
      "button",
      { name: "查看 紙本賓客 的紙本喜帖資訊" },
    );
    expect(
      screen.queryByRole("dialog", { name: "紙本賓客" }),
    ).not.toBeInTheDocument();
    fireEvent.click(paperRecipientTrigger);
    const paperRecipientDialog = screen.getByRole("dialog", {
      name: "紙本賓客",
    });
    expect(
      within(paperRecipientDialog).getByText("0900-123-456"),
    ).toBeInTheDocument();
    expect(paperRecipientDialog.textContent).toContain(
      "台北市幸福路 1 號\n幸福大樓 2 樓",
    );
    expect(
      within(paperRecipientDialog).getByText("姓名"),
    ).toBeInTheDocument();
    expect(
      within(paperRecipientDialog).getAllByText("紙本賓客"),
    ).toHaveLength(2);
    expect(
      within(paperRecipientDialog).getByText("寄送地址"),
    ).toBeInTheDocument();
    expect(
      within(paperRecipientDialog).getByText("聯絡電話"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(paperRecipientDialog).getByRole("button", {
        name: "關閉 紙本賓客 的紙本喜帖資訊",
      }),
    );

    fireEvent.click(
      within(paper as HTMLElement).getByRole("button", {
        name: "查看 不出席仍寄紙本 的紙本喜帖資訊",
      }),
    );
    const missingPaperRecipientDialog = screen.getByRole("dialog", {
      name: "不出席仍寄紙本",
    });
    expect(
      within(missingPaperRecipientDialog).getAllByText("未填寫"),
    ).toHaveLength(2);

    const digital = within(invitations)
      .getByText("電子喜帖")
      .closest("details");
    expect(digital).not.toBeNull();
    expect(within(digital as HTMLElement).getByText("1 份")).toBeInTheDocument();
    expect(
      within(digital as HTMLElement).getByText("電子喜帖賓客"),
    ).toBeInTheDocument();
    expect(
      within(digital as HTMLElement).queryByRole("button", {
        name: "查看 電子喜帖賓客 的紙本喜帖資訊",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(invitations).queryByText("不需寄送賓客"),
    ).not.toBeInTheDocument();
    expect(
      within(invitations).queryByText("尚未設定賓客"),
    ).not.toBeInTheDocument();
  });

  it("keeps planning summaries private for VIEWER", () => {
    render(
      <GuestList
        workspaceId="workspace_1"
        guests={[
          {
            ...guest,
            details: {
              relationshipLabel: null,
              contactPhone: null,
              contactEmail: null,
              ceremonyAttendance: null,
              childSeatCount: 2,
              vegetarianCount: 1,
              invitationDelivery: null,
              mailingAddress: null,
              guestMessage: null,
              attendanceReply: null,
              invitationReply: null,
            },
          },
        ]}
        canEdit={false}
      />,
    );

    expect(
      screen.queryByRole("region", { name: "宴席特殊需求" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "喜帖安排" }),
    ).not.toBeInTheDocument();
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

  it("hides contact and reply details from VIEWER guest cards", () => {
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

    expect(screen.queryByText(/拍拍印/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/合成表單/u)).not.toBeInTheDocument();
    expect(
      screen.queryByText("聯絡與回覆資料限可編輯成員查看"),
    ).not.toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
    expect(container).not.toHaveTextContent("PII_PHONE_SENTINEL");
    expect(container).not.toHaveTextContent("PII_EMAIL_SENTINEL");
    expect(container).not.toHaveTextContent("PII_ADDRESS_SENTINEL");
    expect(container).not.toHaveTextContent("PII_MESSAGE_SENTINEL");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides contact and reply details from the list while preserving them for editing", () => {
    const importedGuest = {
      ...guest,
      id: "guest_imported",
      details: {
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
      },
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

    expect(screen.queryByText("聯絡與回覆資料")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("不克出席，但仍希望收到喜餅");
    expect(container).not.toHaveTextContent("大學  同學\n同社團");
    expect(container).not.toHaveTextContent("0900-000-000");
    expect(container).not.toHaveTextContent("祝福新人");
    expect(screen.queryByText(/拍拍印/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/合成表單/u)).not.toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "編輯 王小明" });
    expect(editButton).toHaveAttribute(
      "data-managed-fields",
      "NAME,SIDE,ATTENDANCE_STATUS",
    );
    expect(editButton).toHaveAttribute("data-contact-phone", "0900-000-000");
    expect(
      screen.getByRole("button", { name: "刪除 王小明 匯入" }),
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
