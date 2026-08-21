"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, useModalDialog } from "@/components/ui/dialog";
import { CreateWorkspaceForm } from "./create-workspace-form";

/**
 * 「新增婚宴」入口。
 * 原本用 <details> 展開，會把下方的婚宴清單整個推出畫面；
 * 改成 modal 之後清單位置不動，建立流程也更聚焦。
 */
export function CreateWorkspaceDialog({
  triggerLabel = "新增婚宴",
  triggerVariant = "primary",
}: {
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary";
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();

  return (
    <>
      <Button ref={triggerRef} variant={triggerVariant} onClick={open}>
        {triggerLabel}
      </Button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="建立新的婚宴"
        title="建立另一個婚宴工作區"
        description="新工作區的資料與協作者，會和你現有的婚宴完全分開。"
        closeLabel="關閉新增婚宴"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <div className="px-5 py-6 sm:px-6">
          <CreateWorkspaceForm className="min-w-0 space-y-6" />
        </div>
      </Dialog>
    </>
  );
}
