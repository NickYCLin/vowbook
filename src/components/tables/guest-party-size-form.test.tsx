import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  updateGuestAction: vi.fn(),
}));

vi.mock("@/actions/guests", () => actions);

import {
  EditGuestPartySizeForm,
  type UnassignedSeatingGuest,
} from "./guest-party-size-form";

const guest: UnassignedSeatingGuest = {
  id: "guest_internal",
  name: "林小美",
  category: "GUEST",
  seniority: "PEER",
  partySize: 2,
  version: 3,
  side: "PARTNER_A",
  attendanceStatus: "UNDECIDED",
  notes: "素食一位",
};

describe("EditGuestPartySizeForm", () => {
  beforeEach(() => {
    actions.updateGuestAction.mockReset();
  });

  it("carries the untouched guest fields and the CAS version without exposing ids", () => {
    const { container } = render(
      <EditGuestPartySizeForm workspaceId="workspace_internal" guest={guest} />,
    );

    expect(screen.getByLabelText("林小美的邀請人數（含本人）")).toHaveValue(2);
    expect(container.querySelector('[name="name"]')).toHaveValue("林小美");
    expect(container.querySelector('[name="category"]')).toHaveValue("GUEST");
    expect(container.querySelector('[name="seniority"]')).toHaveValue("PEER");
    expect(container.querySelector('[name="side"]')).toHaveValue("PARTNER_A");
    expect(container.querySelector('[name="attendanceStatus"]')).toHaveValue(
      "UNDECIDED",
    );
    expect(container.querySelector('[name="notes"]')).toHaveValue("素食一位");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue("3");
    expect(container.querySelector('[name="guestId"]')).toBeNull();
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container).not.toHaveTextContent("workspace_internal");
    expect(container).not.toHaveTextContent("guest_internal");
  });

  it("keeps the submit control visible but only enables it once the number changes", () => {
    render(
      <EditGuestPartySizeForm workspaceId="workspace_internal" guest={guest} />,
    );
    const input = screen.getByLabelText("林小美的邀請人數（含本人）");
    const submit = screen.getByRole("button", {
      name: "更新林小美的邀請人數",
    });

    // 按鈕一直在，整組控制項才看得出來是可以存檔的。
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "4" } });
    expect(submit).toBeEnabled();

    fireEvent.change(input, { target: { value: "2" } });
    expect(submit).toBeDisabled();
  });

  it("labels the number field on screen, not only for assistive technology", () => {
    render(
      <EditGuestPartySizeForm workspaceId="workspace_internal" guest={guest} />,
    );

    // 只有 sr-only 標籤時，畫面上就只是一個沒頭沒尾的數字框。
    expect(screen.getByText("邀請人數")).toBeInTheDocument();
    expect(screen.getByLabelText("林小美的邀請人數（含本人）")).toHaveValue(2);
  });

  it("bounds the invitation size to the same range as the guest page", () => {
    render(
      <EditGuestPartySizeForm workspaceId="workspace_internal" guest={guest} />,
    );
    const input = screen.getByLabelText("林小美的邀請人數（含本人）");

    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "20");
    expect(input).toBeRequired();
  });

  it("allows a family entry to include and adjust companions", () => {
    const { container } = render(
      <EditGuestPartySizeForm
        workspaceId="workspace_internal"
        guest={{ ...guest, category: "FAMILY", partySize: 4 }}
      />,
    );

    expect(screen.getByLabelText("林小美的邀請人數（含本人）")).toHaveValue(4);
    expect(container.querySelector('[name="category"]')).toHaveValue("FAMILY");
  });

  it("keeps a newlywed entry fixed at one person", () => {
    render(
      <EditGuestPartySizeForm
        workspaceId="workspace_internal"
        guest={{ ...guest, category: "COUPLE", partySize: 1 }}
      />,
    );

    expect(screen.queryByLabelText("林小美的邀請人數（含本人）")).toBeNull();
    expect(screen.getByText("名單人數 1 位・新人一人一筆"))
      .toBeInTheDocument();
  });

  it("keeps the full dirty submission snapshot until the user loads newer data", () => {
    const { container, rerender } = render(
      <EditGuestPartySizeForm workspaceId="workspace_internal" guest={guest} />,
    );

    fireEvent.change(screen.getByLabelText("林小美的邀請人數（含本人）"), {
      target: { value: "5" },
    });

    // 同一版本重新整理（例如別桌被移動）不該蓋掉還沒送出的數字。
    rerender(
      <EditGuestPartySizeForm
        workspaceId="workspace_internal"
        guest={{ ...guest, partySize: 2 }}
      />,
    );
    expect(screen.getByLabelText("林小美的邀請人數（含本人）")).toHaveValue(5);
    expect(screen.queryByRole("button", { name: "載入最新資料" })).toBeNull();

    rerender(
      <EditGuestPartySizeForm
        workspaceId="workspace_internal"
        guest={{
          ...guest,
          name: "林小美（新版）",
          category: "FAMILY",
          seniority: "ELDER",
          partySize: 6,
          version: 4,
          side: "SHARED",
          attendanceStatus: "ATTENDING",
          notes: "新版備註",
        }}
      />,
    );

    expect(screen.getByLabelText("林小美的邀請人數（含本人）")).toHaveValue(5);
    expect(container.querySelector('[name="name"]')).toHaveValue("林小美");
    expect(container.querySelector('[name="category"]')).toHaveValue("GUEST");
    expect(container.querySelector('[name="seniority"]')).toHaveValue("PEER");
    expect(container.querySelector('[name="side"]')).toHaveValue("PARTNER_A");
    expect(container.querySelector('[name="attendanceStatus"]')).toHaveValue(
      "UNDECIDED",
    );
    expect(container.querySelector('[name="notes"]')).toHaveValue("素食一位");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue("3");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "這筆賓客已有較新的資料，目前仍保留原本的人數草稿與版本。",
    );
    expect(
      screen.getByRole("button", { name: "更新林小美的邀請人數" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "載入最新資料" }));

    expect(
      screen.getByLabelText("林小美（新版）的邀請人數（含本人）"),
    ).toHaveValue(6);
    expect(container.querySelector('[name="name"]')).toHaveValue(
      "林小美（新版）",
    );
    expect(container.querySelector('[name="category"]')).toHaveValue("FAMILY");
    expect(container.querySelector('[name="seniority"]')).toHaveValue("ELDER");
    expect(container.querySelector('[name="side"]')).toHaveValue("SHARED");
    expect(container.querySelector('[name="attendanceStatus"]')).toHaveValue(
      "ATTENDING",
    );
    expect(container.querySelector('[name="notes"]')).toHaveValue("新版備註");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue("4");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces a stale-write refusal as an alert", async () => {
    actions.updateGuestAction.mockResolvedValueOnce({
      status: "error",
      message: "賓客資料已被更新或不存在，請重新整理後再試。",
    });
    render(
      <EditGuestPartySizeForm workspaceId="workspace_internal" guest={guest} />,
    );

    fireEvent.change(screen.getByLabelText("林小美的邀請人數（含本人）"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "更新林小美的邀請人數" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "賓客資料已被更新或不存在，請重新整理後再試。",
      ),
    );
  });

  it("hides the previous success while a repeated update is still pending", async () => {
    let finishRepeatedUpdate:
      | ((state: { status: "success"; message: string }) => void)
      | undefined;
    actions.updateGuestAction
      .mockResolvedValueOnce({ status: "success", message: "已更新賓客。" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRepeatedUpdate = resolve;
          }),
      );
    const { container } = render(
      <EditGuestPartySizeForm workspaceId="workspace_internal" guest={guest} />,
    );

    fireEvent.change(screen.getByLabelText("林小美的邀請人數（含本人）"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "更新林小美的邀請人數" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已更新賓客。"),
    );
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue("4");
    expect(
      screen.getByRole("button", { name: "更新林小美的邀請人數" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("林小美的邀請人數（含本人）"), {
      target: { value: "5" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "更新林小美的邀請人數" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "更新林小美的邀請人數" }),
      ).toHaveTextContent("更新中…"),
    );
    expect(screen.queryByRole("status")).toBeNull();
    const repeatedSubmission = actions.updateGuestAction.mock.calls[1]?.[3];
    expect(repeatedSubmission).toBeInstanceOf(FormData);
    expect((repeatedSubmission as FormData).get("expectedVersion")).toBe("4");
    expect((repeatedSubmission as FormData).get("partySize")).toBe("5");

    finishRepeatedUpdate?.({ status: "success", message: "已更新賓客。" });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已更新賓客。"),
    );
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue("5");
    expect(
      screen.getByRole("button", { name: "更新林小美的邀請人數" }),
    ).toBeDisabled();
  });

});
