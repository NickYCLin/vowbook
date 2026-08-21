import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installModalDialogPolyfill } from "@/test/modal-dialog";
import { Dialog, useModalDialog } from "./dialog";

installModalDialogPolyfill();

function DialogHarness() {
  const {
    dialogRef,
    triggerRef,
    open,
    close,
    closeWithoutRestoringFocus,
    restoreFocus,
  } = useModalDialog();

  return (
    <>
      <button ref={triggerRef} type="button" onClick={open}>
        開啟
      </button>
      <Dialog
        dialogRef={dialogRef}
        titleId="dialog-harness-title"
        title="測試對話框"
        closeLabel="關閉"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <button type="button" onClick={closeWithoutRestoringFocus}>
          成功關閉
        </button>
      </Dialog>
    </>
  );
}

describe("useModalDialog", () => {
  it("does not override a persistent success announcement focus, but still restores focus for ordinary close", () => {
    render(<DialogHarness />);

    const trigger = screen.getByRole("button", { name: "開啟" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "成功關閉" }));
    expect(trigger).not.toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(trigger).toHaveFocus();
  });
});
