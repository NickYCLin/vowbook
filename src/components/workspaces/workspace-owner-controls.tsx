"use client";

import type { WeddingWorkspace } from "@prisma/client";
import {
  type ChangeEvent,
  type MouseEvent,
  useActionState,
  useId,
  useRef,
  useState,
} from "react";
import {
  deleteWorkspaceAction,
  type WorkspaceMutationState,
  updateWorkspaceAction,
} from "@/actions/workspaces";
import { containDialogFocus } from "@/lib/dialog-focus-containment";

const initialState: WorkspaceMutationState = { status: "idle" };
const fieldClassName =
  "mt-2 min-h-12 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink shadow-inner outline-none transition focus:border-clay disabled:cursor-wait disabled:bg-surface-sunken disabled:opacity-70";

type EditableWorkspace = Pick<
  WeddingWorkspace,
  "id" | "name" | "weddingDate" | "timezone" | "updatedAt"
>;

type EditSnapshot = {
  name: string;
  weddingDate: string;
  expectedUpdatedAt: string;
};

type DeleteSnapshot = {
  name: string;
  expectedUpdatedAt: string;
};

function toEditSnapshot(workspace: EditableWorkspace): EditSnapshot {
  return {
    name: workspace.name,
    weddingDate: workspace.weddingDate?.toISOString().slice(0, 10) ?? "",
    expectedUpdatedAt: workspace.updatedAt.toISOString(),
  };
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function closeOwningDialog(event: MouseEvent<HTMLButtonElement>): void {
  event.currentTarget.closest("dialog")?.close();
}

function ErrorFeedback({ state }: { state: WorkspaceMutationState }) {
  if (state.status !== "error") return null;

  return (
    <p
      role="alert"
      className="border-l-2 border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      {state.message}
    </p>
  );
}

function SuccessFeedback({ state }: { state: WorkspaceMutationState }) {
  if (state.status !== "success") return null;

  return (
    <p
      role="status"
      className="mt-4 border-l-2 border-sage bg-sage-soft px-4 py-3 text-sm text-sage"
    >
      {state.message}
    </p>
  );
}

export function WorkspaceOwnerControls({
  workspace,
}: {
  workspace: EditableWorkspace;
}) {
  const editTitleId = useId();
  const deleteTitleId = useId();
  const editNameId = useId();
  const editDateId = useId();
  const confirmationId = useId();
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const [editSnapshot, setEditSnapshot] = useState(() =>
    toEditSnapshot(workspace),
  );
  const [confirmationName, setConfirmationName] = useState("");
  const [deleteSnapshot, setDeleteSnapshot] = useState<DeleteSnapshot>(() => ({
    name: normalizedName(workspace.name),
    expectedUpdatedAt: workspace.updatedAt.toISOString(),
  }));
  const updateAction = updateWorkspaceAction.bind(null, workspace.id);
  const deleteAction = deleteWorkspaceAction.bind(null, workspace.id);

  const [editState, editFormAction, editPending] = useActionState(
    async (previousState: WorkspaceMutationState, formData: FormData) => {
      const nextState = await updateAction(previousState, formData);
      if (nextState.status === "success") {
        editDialogRef.current?.close();
      }
      return nextState;
    },
    initialState,
  );
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    deleteAction,
    initialState,
  );

  const currentName = deleteSnapshot.name;
  const confirmationMatches = normalizedName(confirmationName) === currentName;

  function openEditDialog(): void {
    const dialog = editDialogRef.current;
    if (!dialog) return;

    setEditSnapshot(toEditSnapshot(workspace));
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input[name=name]")?.focus();
  }

  function openDeleteDialog(): void {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;

    setConfirmationName("");
    setDeleteSnapshot({
      name: normalizedName(workspace.name),
      expectedUpdatedAt: workspace.updatedAt.toISOString(),
    });
    dialog.showModal();
    dialog
      .querySelector<HTMLInputElement>("input[name=confirmationName]")
      ?.focus();
  }

  function restoreFocus(trigger: HTMLButtonElement | null): void {
    if (trigger?.isConnected) trigger.focus();
  }

  function updateEditField(
    field: "name" | "weddingDate",
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    setEditSnapshot((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  }

  return (
    <div className="mt-5 border-t border-dashed border-line pt-5">
      <div className="flex min-w-0 flex-wrap gap-3">
        <button
          ref={editTriggerRef}
          type="button"
          aria-label={`編輯 ${workspace.name}`}
          onClick={openEditDialog}
          className="inline-flex min-h-11 max-w-full min-w-0 items-center rounded-full border border-line px-4 py-2 text-left text-sm font-semibold text-clay-strong hover:bg-clay-soft"
        >
          <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
            編輯工作區
          </span>
        </button>
        <button
          ref={deleteTriggerRef}
          type="button"
          aria-label={`永久刪除 ${workspace.name}`}
          onClick={openDeleteDialog}
          className="inline-flex min-h-11 max-w-full min-w-0 items-center rounded-full border border-danger/40 px-4 py-2 text-left text-sm font-semibold text-danger hover:bg-danger-soft"
        >
          <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
            永久刪除
          </span>
        </button>
      </div>

      <SuccessFeedback state={editState} />

      <dialog
        ref={editDialogRef}
        aria-labelledby={editTitleId}
        onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
        onCancel={(event) => {
          if (editPending) event.preventDefault();
        }}
        onClose={() => restoreFocus(editTriggerRef.current)}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-stone-950/35"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-5 sm:px-7">
          <h2
            id={editTitleId}
            className="min-w-0 break-words font-serif text-2xl font-semibold [overflow-wrap:anywhere]"
          >
            編輯婚宴工作區
          </h2>
          <button
            type="button"
            aria-label="關閉編輯婚宴"
            disabled={editPending}
            onClick={closeOwningDialog}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-line text-2xl disabled:cursor-wait disabled:opacity-50"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <form
          action={editFormAction}
          aria-busy={editPending}
          className="space-y-6 px-5 py-6 sm:px-7"
          noValidate
        >
          <input
            type="hidden"
            name="expectedUpdatedAt"
            value={editSnapshot.expectedUpdatedAt}
          />
          <input type="hidden" name="timezone" value="Asia/Taipei" />
          <div>
            <label htmlFor={editNameId} className="font-medium text-ink">
              婚宴名稱
            </label>
            <input
              id={editNameId}
              name="name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="off"
              value={editSnapshot.name}
              disabled={editPending}
              onChange={(event) => updateEditField("name", event)}
              className={fieldClassName}
            />
          </div>
          <div>
            <label htmlFor={editDateId} className="font-medium text-ink">
              婚宴日期
              <span className="ml-2 text-sm font-normal text-ink-faint">
                可以留白
              </span>
            </label>
            <input
              id={editDateId}
              name="weddingDate"
              type="date"
              value={editSnapshot.weddingDate}
              disabled={editPending}
              onChange={(event) => updateEditField("weddingDate", event)}
              className={fieldClassName}
            />
          </div>
          <ErrorFeedback state={editState} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={editPending}
              onClick={closeOwningDialog}
              className="min-h-11 rounded-full border border-line px-5 font-semibold disabled:cursor-wait disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={editPending}
              className="min-h-11 rounded-full bg-clay px-5 font-semibold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {editPending ? "正在儲存…" : "儲存工作區"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteDialogRef}
        aria-labelledby={deleteTitleId}
        onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
        onCancel={(event) => {
          if (deletePending) event.preventDefault();
        }}
        onClose={() => restoreFocus(deleteTriggerRef.current)}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-danger/40 bg-surface p-0 text-ink shadow-2xl backdrop:bg-stone-950/35"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-danger/30 bg-surface px-5 py-5 sm:px-7">
          <h2
            id={deleteTitleId}
            className="min-w-0 break-words font-serif text-2xl font-semibold text-red-950 [overflow-wrap:anywhere]"
          >
            永久刪除婚宴工作區
          </h2>
          <button
            type="button"
            aria-label="關閉永久刪除婚宴"
            disabled={deletePending}
            onClick={closeOwningDialog}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-line text-2xl disabled:cursor-wait disabled:opacity-50"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <form
          action={deleteFormAction}
          aria-busy={deletePending}
          className="space-y-6 px-5 py-6 sm:px-7"
          noValidate
        >
          <input
            type="hidden"
            name="expectedUpdatedAt"
            value={workspace.updatedAt.toISOString()}
          />
          <div className="border-l-2 border-danger bg-danger-soft px-4 py-4 text-red-950">
            <p className="font-semibold">此動作永久且無法復原。</p>
            <p className="mt-2 text-sm leading-6">
              賓客、桌次、任務、婚禮花費、工作人員、婚禮流程、分享與協作資料都會永久刪除。
            </p>
          </div>
          <div>
            <label
              htmlFor={confirmationId}
              className="min-w-0 break-words font-medium text-ink [overflow-wrap:anywhere]"
            >
              輸入「{currentName}」以確認永久刪除
            </label>
            <input
              id={confirmationId}
              name="confirmationName"
              required
              autoComplete="off"
              value={confirmationName}
              disabled={deletePending}
              onChange={(event) => setConfirmationName(event.target.value)}
              className={fieldClassName}
            />
          </div>
          <ErrorFeedback state={deleteState} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deletePending}
              onClick={closeOwningDialog}
              className="min-h-11 rounded-full border border-line px-5 font-semibold disabled:cursor-wait disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              aria-label={
                deletePending
                  ? "正在永久刪除…"
                  : `確認永久刪除 ${currentName}`
              }
              disabled={deletePending || !confirmationMatches}
              className="min-h-11 rounded-full bg-red-800 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletePending ? "正在永久刪除…" : "確認永久刪除"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
