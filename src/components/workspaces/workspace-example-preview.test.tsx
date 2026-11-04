import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installModalDialogPolyfill } from "@/test/modal-dialog";
import { workspaceSections } from "./workspace-sections";
import { WorkspaceExamplePreview } from "./workspace-example-preview";

installModalDialogPolyfill();
describe("完成範例", () => {
  it.each(workspaceSections)("$label 提供唯讀範例，不含可提交表單或真實連結", section => {
    const { container } = render(<WorkspaceExamplePreview section={section.key} sectionTitle={section.label} />);
    const trigger = screen.getByRole("button", { name: "看完成範例" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/以下皆為虛構資料/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector("form, input, a, textarea")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "關閉範例" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it("發餅子頁使用家庭與盒數，而非賓客回覆範例", () => {
    render(<WorkspaceExamplePreview section="guests" sectionTitle="發餅名單" />);
    fireEvent.click(screen.getByRole("button", { name: "看完成範例" }));
    expect(screen.getByText("發餅名單，按家庭整理")).toBeInTheDocument();
    expect(screen.getByText("預計 5 盒")).toBeInTheDocument();
  });
});
