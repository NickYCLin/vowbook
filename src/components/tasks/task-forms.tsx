"use client";

import { useActionState, useId, useState } from "react";
import {
  changeWeddingTaskStatusAction,
  createWeddingTaskAction,
  deleteWeddingTaskAction,
  type WeddingTaskMutationState,
  updateWeddingTaskAction,
} from "@/actions/wedding-tasks";
import type { WeddingTaskStatusValue } from "@/domain/wedding-task";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";

const initialState: WeddingTaskMutationState = { status: "idle" };

type TaskFieldValues = {
  title: string;
  description: string;
  dueDate: string;
};

const emptyTaskFields: TaskFieldValues = {
  title: "",
  description: "",
  dueDate: "",
};

function TaskFields({
  idPrefix,
  values,
  onChange,
}: {
  idPrefix: string;
  values: TaskFieldValues;
  onChange: (field: keyof TaskFieldValues, value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <Field
        htmlFor={`${idPrefix}-title`}
        label="任務名稱"
        hint="最多 120 個字元；送出時會再次驗證。"
      >
        <Input
          id={`${idPrefix}-title`}
          name="title"
          type="text"
          required
          minLength={1}
          autoComplete="off"
          value={values.title}
          onChange={(event) => onChange("title", event.target.value)}
        />
      </Field>

      <Field
        htmlFor={`${idPrefix}-description`}
        label="任務說明"
        optional
        hint="最多 1000 個字元；送出時會再次驗證。"
      >
        <Textarea
          id={`${idPrefix}-description`}
          name="description"
          rows={4}
          value={values.description}
          onChange={(event) => onChange("description", event.target.value)}
        />
      </Field>

      <Field htmlFor={`${idPrefix}-due-date`} label="到期日" optional>
        <Input
          id={`${idPrefix}-due-date`}
          name="dueDate"
          type="date"
          value={values.dueDate}
          onChange={(event) => onChange("dueDate", event.target.value)}
          className="sm:max-w-56"
        />
      </Field>
    </div>
  );
}

export function CreateWeddingTaskForm({
  workspaceId,
  onSuccess,
}: {
  workspaceId: string;
  onSuccess?: () => void;
}) {
  const idPrefix = useId();
  const createAction = createWeddingTaskAction.bind(null, workspaceId);
  const [values, setValues] = useState<TaskFieldValues>(emptyTaskFields);
  const [state, formAction, isPending] = useActionState(
    async (previousState: WeddingTaskMutationState, formData: FormData) => {
      const nextState = await createAction(previousState, formData);
      if (nextState.status === "success") {
        setValues(emptyTaskFields);
        onSuccess?.();
      }
      return nextState;
    },
    initialState,
  );

  function updateField(field: keyof TaskFieldValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <form action={formAction} aria-label="新增任務表單" className="min-w-0">
      <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
        <TaskFields idPrefix={idPrefix} values={values} onChange={updateField} />
        <ActionFeedback state={state} />
      </div>
      <DialogFooter>
        <SubmitButton isPending={isPending} pendingLabel="正在新增…">
          新增任務
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

export function CreateWeddingTaskDialog({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();

  return (
    <>
      <Button ref={triggerRef} onClick={open}>
        新增任務
      </Button>
      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="新增一項"
        title="寫下下一件婚宴任務"
        closeLabel="關閉新增任務"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <CreateWeddingTaskForm workspaceId={workspaceId} onSuccess={close} />
      </Dialog>
    </>
  );
}

export function EditWeddingTaskForm({
  workspaceId,
  taskId,
  title,
  description,
  dueDate,
  expectedVersion,
}: {
  workspaceId: string;
  taskId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  expectedVersion: number;
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const updateAction = updateWeddingTaskAction.bind(null, workspaceId, taskId);
  const [state, formAction, isPending] = useActionState(
    updateAction,
    initialState,
  );
  // 刻意只在掛載時取初始值：伺服器端資料更新時保留使用者已輸入但尚未送出的內容，
  // 只把 expectedVersion 換成最新版本。
  const [values, setValues] = useState<TaskFieldValues>({
    title,
    description: description ?? "",
    dueDate: dueDate ?? "",
  });

  function updateField(field: keyof TaskFieldValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-control px-2.5 text-caption font-semibold break-words text-clay-strong transition hover:bg-clay-soft"
      >
        編輯 {title}
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="編輯任務"
        title={title}
        closeLabel="關閉編輯任務"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction} aria-label="編輯任務表單" className="min-w-0">
          <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
            <input
              type="hidden"
              name="expectedVersion"
              value={expectedVersion}
            />
            <TaskFields
              idPrefix={idPrefix}
              values={values}
              onChange={updateField}
            />
            <ActionFeedback state={state} />
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={isPending} onClick={close}>
              取消
            </Button>
            <SubmitButton isPending={isPending} pendingLabel="正在儲存…">
              儲存任務內容
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

export function ChangeWeddingTaskStatusForm({
  workspaceId,
  taskId,
  targetStatus,
  label,
  taskTitle,
  expectedVersion,
}: {
  workspaceId: string;
  taskId: string;
  targetStatus: WeddingTaskStatusValue;
  label: string;
  taskTitle: string;
  expectedVersion: number;
}) {
  const statusAction = changeWeddingTaskStatusAction.bind(
    null,
    workspaceId,
    taskId,
    targetStatus,
  );
  const [state, formAction, isPending] = useActionState(
    statusAction,
    initialState,
  );

  return (
    <form action={formAction} className="min-w-0">
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <button
        type="submit"
        disabled={isPending}
        aria-label={`${label}：${taskTitle}`}
        title={`${label}：${taskTitle}`}
        className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-3.5 text-caption font-semibold whitespace-nowrap text-clay-strong transition hover:border-clay hover:bg-clay-soft disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? "更新中…" : label}
      </button>
      <ActionFeedback state={state} className="mt-2" />
    </form>
  );
}

export function DeleteWeddingTaskForm({
  workspaceId,
  taskId,
  title,
  expectedVersion,
}: {
  workspaceId: string;
  taskId: string;
  title: string;
  expectedVersion: number;
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const deleteAction = deleteWeddingTaskAction.bind(null, workspaceId, taskId);
  const [state, formAction, isPending] = useActionState(
    deleteAction,
    initialState,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-control px-2.5 text-caption font-semibold break-words text-danger transition hover:bg-danger-soft"
      >
        刪除 {title}
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="刪除任務"
        title={title}
        closeLabel="關閉刪除任務"
        isPending={isPending}
        size="sm"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-4 px-5 py-6 sm:px-6">
            <input
              type="hidden"
              name="expectedVersion"
              value={expectedVersion}
            />
            <p className="text-sm font-semibold text-danger">
              此動作無法復原。
            </p>
            <p className="text-caption leading-6 text-ink-soft">
              只有在確認不再需要這項任務時才繼續。
            </p>
            <ActionFeedback state={state} />
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={isPending} onClick={close}>
              取消
            </Button>
            <SubmitButton
              isPending={isPending}
              pendingLabel="正在刪除…"
              variant="danger-solid"
              aria-label={`確認刪除 ${title}`}
            >
              確認刪除
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
