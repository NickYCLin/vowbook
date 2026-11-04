import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installModalDialogPolyfill } from "@/test/modal-dialog";

const submit = vi.hoisted(() => vi.fn());
vi.mock("@/actions/product-feedback", () => ({ submitProductFeedbackAction: submit }));
import { ProductFeedbackDialog } from "./product-feedback-dialog";

installModalDialogPolyfill();
beforeEach(() => submit.mockReset());
function open() {
  render(<ProductFeedbackDialog workspaceId="synthetic-workspace" section="timeline" />);
  fireEvent.click(screen.getByRole("button", { name: "意見回饋" }));
  fireEvent.change(screen.getByRole("textbox", { name: "回饋內容" }), { target: { value: "希望能記住我常用的流程排序方式。" } });
}
describe("回饋表單", () => {
  it("預選目前功能，失敗保留內容與重送編號", async () => {
    submit.mockResolvedValue({ status: "error", message: "暫時無法保存" });
    open();
    expect(screen.getByRole("combobox", { name: "相關功能" })).toHaveValue("timeline");
    fireEvent.click(screen.getByRole("button", { name: "送出回饋" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "回饋內容" })).toHaveValue("希望能記住我常用的流程排序方式。");
    const firstId = submit.mock.calls[0][2].get("requestId");
    fireEvent.click(screen.getByRole("button", { name: "送出回饋" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][2].get("requestId")).toBe(firstId);
  });
  it("收到保存結果才顯示編號，並可另寫一則", async () => {
    submit.mockResolvedValue({ status: "success", reference: "synthetic-reference" });
    open();
    fireEvent.click(screen.getByRole("button", { name: "送出回饋" }));
    expect(await screen.findByRole("status")).toHaveTextContent("synthetic-reference");
    fireEvent.click(screen.getByRole("button", { name: "再寫一則回饋" }));
    expect(screen.getByRole("textbox", { name: "回饋內容" })).toHaveValue("");
  });
  it("暫時關閉後重開仍保留草稿", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "暫時關閉，保留內容" }));
    fireEvent.click(screen.getByRole("button", { name: "意見回饋" }));
    expect(screen.getByRole("textbox", { name: "回饋內容" })).toHaveValue("希望能記住我常用的流程排序方式。");
  });
});
