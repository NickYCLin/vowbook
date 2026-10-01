import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  addBudgetPaymentAction,
  deleteBudgetPaymentAction,
  updateBudgetPaymentAction,
} = vi.hoisted(() => ({
  addBudgetPaymentAction: vi.fn(),
  deleteBudgetPaymentAction: vi.fn(),
  updateBudgetPaymentAction: vi.fn(),
}));
vi.mock("@/actions/budget-items", () => ({
  addBudgetPaymentAction,
  deleteBudgetPaymentAction,
  updateBudgetPaymentAction,
}));

import { BudgetPayments } from "./budget-payments";

const baseProps = {
  workspaceId: "workspace_1",
  itemId: "item_1",
  itemName: "宴客場地",
  expectedVersion: 3,
  bookingStatus: "BOOKED_BALANCE_DUE" as const,
  balanceAmount: 300000,
  additionalAmount: 20000,
  balancePaymentMethod: "BANK_TRANSFER" as const,
  payments: [
    { id: "p1", amount: 100000, paidOn: "2026-10-01", method: "BANK_TRANSFER" as const, notes: "末五碼 12345" },
    { id: "p2", amount: 50000, paidOn: "2026-10-05", method: null, notes: null },
  ],
  canEdit: true,
  today: "2026-10-06",
};

describe("BudgetPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("顯示尾款含加購、已先付與還要付的金額，以及每一筆付款", () => {
    render(<BudgetPayments {...baseProps} />);
    const section = screen.getByRole("region", { name: "尾款分批付款" });
    expect(within(section).getByText("NT$320,000")).toBeTruthy();
    expect(within(section).getByText("NT$150,000")).toBeTruthy();
    expect(within(section).getByText("（2 筆）")).toBeTruthy();
    expect(section.querySelector("[data-budget-payment-remaining]")?.textContent).toBe(
      "NT$170,000",
    );
    expect(within(section).getByText("末五碼 12345")).toBeTruthy();
    expect(screen.getByLabelText("付款日期")).toHaveProperty("value", "2026-10-06");
    expect(screen.getByLabelText("付款方式")).toHaveProperty("value", "BANK_TRANSFER");
  });

  it("送出付款表單時帶項目版本", async () => {
    addBudgetPaymentAction.mockResolvedValue({ status: "success", message: "已記錄這筆付款。" });
    render(<BudgetPayments {...baseProps} />);
    fireEvent.change(screen.getByLabelText("這次付款金額"), { target: { value: "70000" } });
    fireEvent.click(screen.getByRole("button", { name: "記錄這筆付款" }));
    await waitFor(() => expect(addBudgetPaymentAction).toHaveBeenCalled());
    const [workspaceId, itemId, , formData] = addBudgetPaymentAction.mock.calls[0];
    expect([workspaceId, itemId]).toEqual(["workspace_1", "item_1"]);
    expect((formData as FormData).get("amount")).toBe("70000");
    expect((formData as FormData).get("expectedVersion")).toBe("3");
    expect(await screen.findByText("已記錄這筆付款。")).toBeTruthy();
  });

  it("檢視者看得到紀錄但不能新增或刪除；規劃中又沒紀錄時整塊不顯示", () => {
    const { rerender } = render(<BudgetPayments {...baseProps} canEdit={false} />);
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button", { name: /刪除/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /編輯/u })).toBeNull();
    rerender(
      <BudgetPayments {...baseProps} bookingStatus="PLANNING" payments={[]} />,
    );
    expect(screen.queryByRole("region", { name: "尾款分批付款" })).toBeNull();
  });

  it("付清後顯示已付清", () => {
    render(
      <BudgetPayments
        {...baseProps}
        bookingStatus="PAID"
        payments={[{ id: "p1", amount: 320000, paidOn: "2026-10-01", method: null, notes: null }]}
      />,
    );
    expect(screen.getByText("已付清")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "記錄這筆付款" })).toBeNull();
  });

  it("可以編輯既有付款，帶原本的值與項目版本送出", async () => {
    updateBudgetPaymentAction.mockResolvedValue({
      status: "success",
      message: "已更新這筆付款紀錄。",
    });
    render(<BudgetPayments {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 2026-10-01 的付款紀錄" }),
    );
    const form = screen.getByRole("form", { name: "編輯付款：2026-10-01" });
    expect(within(form).getByLabelText("金額")).toHaveProperty("value", "100000");
    expect(within(form).getByLabelText("日期")).toHaveProperty("value", "2026-10-01");
    expect(within(form).getByLabelText("方式")).toHaveProperty("value", "BANK_TRANSFER");
    expect(within(form).getByLabelText("備註")).toHaveProperty("value", "末五碼 12345");
    fireEvent.change(within(form).getByLabelText("金額"), {
      target: { value: "110000" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(updateBudgetPaymentAction).toHaveBeenCalled());
    const [workspaceId, itemId, paymentId, , formData] =
      updateBudgetPaymentAction.mock.calls[0];
    expect([workspaceId, itemId, paymentId]).toEqual(["workspace_1", "item_1", "p1"]);
    expect((formData as FormData).get("amount")).toBe("110000");
    expect((formData as FormData).get("expectedVersion")).toBe("3");
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "編輯付款：2026-10-01" })).toBeNull(),
    );
    expect(await screen.findByText("已更新這筆付款紀錄。")).toBeTruthy();
  });

  it("取消編輯會回到原本的付款列", () => {
    render(<BudgetPayments {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 2026-10-05 的付款紀錄" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("form", { name: "編輯付款：2026-10-05" })).toBeNull();
    expect(updateBudgetPaymentAction).not.toHaveBeenCalled();
  });
});
