import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { installModalDialogPolyfill } from "@/test/modal-dialog";
import { PrintPreviewLink } from "./print-preview-link";

installModalDialogPolyfill();

it("opens the authorized print route in a local preview and unloads it on close", () => {
  render(<PrintPreviewLink href="/workspaces/w/tables/print">列印帶位名單</PrintPreviewLink>);
  expect(screen.queryByTitle("列印帶位名單預覽")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "列印帶位名單" }));
  const iframe = screen.getByTitle("列印帶位名單預覽") as HTMLIFrameElement;
  expect(iframe.getAttribute("src")).toContain("/workspaces/w/tables/print?preview=1");
  expect(screen.getByRole("button", { name: "列印／另存 PDF" })).toBeDisabled();
  const printDocument = document.implementation.createHTMLDocument();
  printDocument.body.innerHTML = '<section data-operations-print></section>';
  Object.defineProperty(iframe, "contentDocument", { value: printDocument });
  fireEvent.load(iframe);
  expect(screen.getByRole("button", { name: "列印／另存 PDF" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "關閉列印預覽" }));
  expect(screen.queryByTitle("列印帶位名單預覽")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "列印帶位名單" })).toHaveFocus();
});

it("does not enable printing when the route displays a sign-in or access error", () => {
  render(<PrintPreviewLink href="/workspaces/w/tables/print">列印帶位名單</PrintPreviewLink>);
  fireEvent.click(screen.getByRole("link", { name: "列印帶位名單" }));
  fireEvent.load(screen.getByTitle("列印帶位名單預覽"));
  expect(screen.getByRole("alert")).toHaveTextContent("確認登入與存取權限");
  expect(screen.getByRole("button", { name: "列印／另存 PDF" })).toBeDisabled();
});
