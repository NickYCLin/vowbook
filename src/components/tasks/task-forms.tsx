"use client";

import { useActionState, useId, useState } from "react";
import {
  changeWeddingTaskStatusAction,
  createWeddingTaskAction,
  deleteWeddingTaskAction,
  type WeddingTaskMutationState,
  updateWeddingTaskAction,
} from "@/actions/wedding-tasks";
import {
  normalizeWeddingTaskDetails,
  normalizeWeddingTaskSide,
  WEDDING_TASK_SIDES,
  WEDDING_TASK_SIDE_LABELS,
  type WeddingTaskSideValue,
  type WeddingTaskStatusValue,
} from "@/domain/wedding-task";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

const initialState: WeddingTaskMutationState = { status: "idle" };

type TaskFieldValues = {
  title: string;
  description: string;
  dueDate: string;
  side: WeddingTaskSideValue;
};

const emptyTaskFields: TaskFieldValues = {
  title: "",
  description: "",
  dueDate: "",
  side: "SHARED",
};

type EditWeddingTaskFormProps = {
  workspaceId: string;
  taskId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  side: WeddingTaskSideValue;
  expectedVersion: number;
};

type EditWeddingTaskSnapshot = {
  workspaceId: string;
  taskId: string;
  expectedVersion: number;
  values: TaskFieldValues;
};

function createEditWeddingTaskSnapshot(
  props: EditWeddingTaskFormProps,
): EditWeddingTaskSnapshot {
  return {
    workspaceId: props.workspaceId,
    taskId: props.taskId,
    expectedVersion: props.expectedVersion,
    values: {
      title: props.title,
      description: props.description ?? "",
      dueDate: props.dueDate ?? "",
      side: props.side,
    },
  };
}

function isSameEditWeddingTaskSnapshot(
  current: EditWeddingTaskSnapshot,
  latest: EditWeddingTaskSnapshot,
) {
  return (
    current.workspaceId === latest.workspaceId &&
    current.taskId === latest.taskId &&
    current.expectedVersion === latest.expectedVersion &&
    current.values.title === latest.values.title &&
    current.values.description === latest.values.description &&
    current.values.dueDate === latest.values.dueDate &&
    current.values.side === latest.values.side
  );
}

function isEditWeddingTaskSnapshotOutdated(
  current: EditWeddingTaskSnapshot,
  latest: EditWeddingTaskSnapshot,
) {
  if (
    current.workspaceId !== latest.workspaceId ||
    current.taskId !== latest.taskId
  ) {
    return true;
  }
  if (latest.expectedVersion !== current.expectedVersion) {
    // 自己剛成功寫入時，本地版本會暫時領先尚未刷新的 RSC props；那不是
    // 伺服器有新資料。只有伺服器 token 真正前進時才提示重新載入。
    return latest.expectedVersion > current.expectedVersion;
  }
  return !isSameEditWeddingTaskSnapshot(current, latest);
}

function successfulEditWeddingTaskSnapshot(
  current: EditWeddingTaskSnapshot,
  formData: FormData,
): EditWeddingTaskSnapshot {
  const details = normalizeWeddingTaskDetails({
    title: formData.get("title"),
    description: formData.get("description"),
    dueDate: formData.get("dueDate"),
  });
  const submittedVersion = Number(formData.get("expectedVersion"));

  return {
    ...current,
    expectedVersion: submittedVersion + 1,
    values: {
      title: details.title,
      description: details.description ?? "",
      dueDate: details.dueDate?.toISOString().slice(0, 10) ?? "",
      side: normalizeWeddingTaskSide(formData.get("side")),
    },
  };
}

function TaskFields({
  idPrefix,
  values,
  onChange,
}: {
  idPrefix: string;
  values: TaskFieldValues;
  onChange: <FieldName extends keyof TaskFieldValues>(
    field: FieldName,
    value: TaskFieldValues[FieldName],
  ) => void;
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

      <Field htmlFor={`${idPrefix}-side`} label="任務歸屬">
        <Select
          key={values.side}
          id={`${idPrefix}-side`}
          name="side"
          required
          defaultValue={values.side}
          onChange={(event) =>
            onChange("side", event.target.value as WeddingTaskSideValue)
          }
          className="sm:max-w-56"
        >
          {WEDDING_TASK_SIDES.map((side) => (
            <option key={side} value={side}>
              {WEDDING_TASK_SIDE_LABELS[side]}
            </option>
          ))}
        </Select>
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

  function updateField<FieldName extends keyof TaskFieldValues>(
    field: FieldName,
    value: TaskFieldValues[FieldName],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <form
      action={formAction}
      aria-label="新增任務表單"
      className="min-w-0"
    >
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

export function EditWeddingTaskForm(props: EditWeddingTaskFormProps) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const latestSnapshot = createEditWeddingTaskSnapshot(props);
  // 草稿和樂觀鎖版本必須來自同一份快照；若伺服器資料更新，先保留舊快照，
  // 避免把尚未合併的舊草稿誤綁到新版本後覆寫協作者的變更。
  const [snapshot, setSnapshot] = useState(() => latestSnapshot);
  const [values, setValues] = useState<TaskFieldValues>(() => snapshot.values);
  const [hideActionFeedback, setHideActionFeedback] = useState(false);
  const snapshotIsOutdated = isEditWeddingTaskSnapshotOutdated(
    snapshot,
    latestSnapshot,
  );
  const updateAction = updateWeddingTaskAction.bind(
    null,
    snapshot.workspaceId,
    snapshot.taskId,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: WeddingTaskMutationState, formData: FormData) => {
      setHideActionFeedback(false);
      const nextState = await updateAction(previousState, formData);
      if (nextState.status === "success") {
        const committedSnapshot = successfulEditWeddingTaskSnapshot(
          snapshot,
          formData,
        );
        setSnapshot(committedSnapshot);
        setValues(committedSnapshot.values);
      }
      return nextState;
    },
    initialState,
  );

  function updateField<FieldName extends keyof TaskFieldValues>(
    field: FieldName,
    value: TaskFieldValues[FieldName],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function loadLatestSnapshot() {
    setSnapshot(latestSnapshot);
    setValues(latestSnapshot.values);
    setHideActionFeedback(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label={`編輯 ${props.title}`}
        className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-control px-2.5 text-caption font-semibold break-words text-clay-strong transition hover:bg-clay-soft"
      >
        編輯
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="編輯任務"
        title={props.title}
        closeLabel="關閉編輯任務"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        {snapshotIsOutdated ? (
          <div className="mx-5 mt-5 rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption leading-6 text-caution sm:mx-6">
            <p>這筆任務已有較新的資料，目前表單仍保留原本的草稿與版本。</p>
            <button
              type="button"
              onClick={loadLatestSnapshot}
              className="mt-3 inline-flex min-h-11 items-center rounded-control border border-caution/40 px-4 font-semibold transition hover:bg-caution/10"
            >
              載入最新資料
            </button>
          </div>
        ) : null}
        <form
          action={formAction}
          aria-label="編輯任務表單"
          className="min-w-0"
        >
          <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
            <input
              type="hidden"
              name="expectedVersion"
              value={snapshot.expectedVersion}
            />
            <TaskFields
              idPrefix={idPrefix}
              values={values}
              onChange={updateField}
            />
            {hideActionFeedback || isPending ? null : (
              <ActionFeedback state={state} />
            )}
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

type DeleteWeddingTaskSnapshot = {
  workspaceId: string;
  taskId: string;
  title: string;
  expectedVersion: number;
};

function isSameDeleteWeddingTaskSnapshot(
  current: DeleteWeddingTaskSnapshot,
  latest: DeleteWeddingTaskSnapshot,
): boolean {
  return (
    current.workspaceId === latest.workspaceId &&
    current.taskId === latest.taskId &&
    current.title === latest.title &&
    current.expectedVersion === latest.expectedVersion
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
  const latestSnapshot: DeleteWeddingTaskSnapshot = {
    workspaceId,
    taskId,
    title,
    expectedVersion,
  };
  const [snapshot, setSnapshot] = useState(() => latestSnapshot);
  const snapshotIsOutdated = !isSameDeleteWeddingTaskSnapshot(
    snapshot,
    latestSnapshot,
  );
  const deleteAction = deleteWeddingTaskAction.bind(
    null,
    snapshot.workspaceId,
    snapshot.taskId,
  );
  const [state, formAction, isPending] = useActionState(
    deleteAction,
    initialState,
  );

  function openLatestSnapshot() {
    setSnapshot(latestSnapshot);
    open();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openLatestSnapshot}
        aria-label={`刪除 ${title}`}
        className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-control px-2.5 text-caption font-semibold break-words text-danger transition hover:bg-danger-soft"
      >
        刪除
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="刪除任務"
        title={snapshot.title}
        closeLabel="關閉刪除任務"
        isPending={isPending}
        size="sm"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form
          action={formAction}
          className="min-w-0"
          onSubmit={(event) => {
            if (snapshotIsOutdated) event.preventDefault();
          }}
        >
          <div className="min-w-0 space-y-4 px-5 py-6 sm:px-6">
            <input
              type="hidden"
              name="expectedVersion"
              value={snapshot.expectedVersion}
            />
            {snapshotIsOutdated ? (
              <div
                role="alert"
                className="rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption leading-6 text-caution"
              >
                這筆任務已有較新的資料，請關閉後重新確認刪除。
              </div>
            ) : null}
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
              aria-label={`確認刪除 ${snapshot.title}`}
              disabled={snapshotIsOutdated}
            >
              確認刪除
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
