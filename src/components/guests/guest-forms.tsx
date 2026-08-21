"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { GuestManagedField } from "@prisma/client";
import {
  createGuestAction,
  deleteGuestAction,
  type GuestMutationState,
  updateGuestAction,
} from "@/actions/guests";
import {
  GUEST_CATEGORIES,
  GUEST_CATEGORY_LABELS,
  GUEST_SIDES,
  guestIdentityLabel,
  type GuestAttendanceStatusValue,
  type GuestCategoryValue,
  type GuestSideValue,
} from "@/domain/guest";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/class-names";

const initialState: GuestMutationState = { status: "idle" };

const SIDE_FIELD_LABELS = {
  GUEST: "與新人的關係",
  COUPLE: "新人角色",
  FAMILY: "家人所屬",
} as const satisfies Record<GuestCategoryValue, string>;

type GuestFieldsProps = {
  idPrefix: string;
  managedFields?: readonly GuestManagedField[];
  initialValues?: {
    name: string;
    category: GuestCategoryValue;
    side: GuestSideValue;
    attendanceStatus: GuestAttendanceStatusValue;
    partySize: number;
    notes: string | null;
  };
};

function GuestFields({
  idPrefix,
  initialValues,
  managedFields = [],
}: GuestFieldsProps) {
  const [category, setCategory] = useState<GuestCategoryValue>(
    initialValues?.category ?? "GUEST",
  );
  const [side, setSide] = useState<GuestSideValue>(
    initialValues?.side ?? "SHARED",
  );
  const sideOptions = category === "GUEST" ? GUEST_SIDES : GUEST_SIDES.slice(0, 2);
  const managed = new Set(managedFields);
  const managedHint = (field: GuestManagedField) =>
    managed.has(field) ? (
      <p
        id={`${idPrefix}-${field.toLowerCase()}-managed-hint`}
        className="mt-1.5 text-caption text-ink-faint"
      >
        此欄位由匯入來源維護。
      </p>
    ) : null;

  return (
    <div className="min-w-0 space-y-5">
      <div className="min-w-0">
        <Field htmlFor={`${idPrefix}-name`} label="姓名或稱呼">
          <Input
            id={`${idPrefix}-name`}
            name="name"
            type="text"
            required
            minLength={1}
            autoComplete="off"
            defaultValue={initialValues?.name}
            readOnly={managed.has("NAME")}
            aria-describedby={
              managed.has("NAME") ? `${idPrefix}-name-managed-hint` : undefined
            }
          />
        </Field>
        {managedHint("NAME")}
      </div>

      <div className="min-w-0">
        <Field
          htmlFor={`${idPrefix}-category`}
          label="名單身份"
          hint="一般賓客會計入賓客統計；新人與家人會另外呈現。"
        >
          <Select
            id={`${idPrefix}-category`}
            name="category"
            required
            value={category}
            onChange={(event) => {
              const nextCategory = event.target.value as GuestCategoryValue;
              setCategory(nextCategory);
              if (nextCategory !== "GUEST" && side === "SHARED") {
                setSide("PARTNER_A");
              }
            }}
          >
            {GUEST_CATEGORIES.map((value) => (
              <option
                key={value}
                value={value}
                disabled={
                  value !== "GUEST" &&
                  managed.has("SIDE") &&
                  initialValues?.side === "SHARED"
                }
              >
                {GUEST_CATEGORY_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="min-w-0 grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <Field htmlFor={idPrefix + "-side"} label={SIDE_FIELD_LABELS[category]}>
            <Select
              id={`${idPrefix}-side`}
              name="side"
              required
              disabled={managed.has("SIDE")}
              aria-describedby={
                managed.has("SIDE") ? `${idPrefix}-side-managed-hint` : undefined
              }
              value={side}
              onChange={(event) => setSide(event.target.value as GuestSideValue)}
            >
              {sideOptions.map((optionSide) => (
                <option key={optionSide} value={optionSide}>
                  {guestIdentityLabel(category, optionSide)}
                </option>
              ))}
            </Select>
          </Field>
          {managed.has("SIDE") && initialValues ? (
            <input type="hidden" name="side" value={side} />
          ) : null}
          {managedHint("SIDE")}
        </div>

        <div className="min-w-0">
          <Field htmlFor={`${idPrefix}-attendance`} label="出席狀態">
            <Select
              id={`${idPrefix}-attendance`}
              name="attendanceStatus"
              required
              disabled={managed.has("ATTENDANCE_STATUS")}
              aria-describedby={
                managed.has("ATTENDANCE_STATUS")
                  ? `${idPrefix}-attendance_status-managed-hint`
                  : undefined
              }
              defaultValue={initialValues?.attendanceStatus ?? "UNDECIDED"}
            >
              <option value="UNDECIDED">尚未確認</option>
              <option value="ATTENDING">出席</option>
              <option value="DECLINED">不出席</option>
            </Select>
          </Field>
          {managed.has("ATTENDANCE_STATUS") && initialValues ? (
            <input
              type="hidden"
              name="attendanceStatus"
              value={initialValues.attendanceStatus}
            />
          ) : null}
          {managedHint("ATTENDANCE_STATUS")}
        </div>
      </div>

      {category === "GUEST" ? (
        <div className="min-w-0">
          <Field
            htmlFor={idPrefix + "-party-size"}
            label="邀請人數（含本人）"
            hint="包含賓客本人，最多 20 位。"
          >
            <Input
              id={idPrefix + "-party-size"}
              name="partySize"
              type="number"
              required
              min={1}
              max={20}
              step={1}
              inputMode="numeric"
              defaultValue={initialValues?.partySize ?? 1}
              readOnly={managed.has("PARTY_SIZE")}
              aria-describedby={
                managed.has("PARTY_SIZE")
                  ? idPrefix + "-party_size-managed-hint"
                  : undefined
              }
              className="sm:max-w-40"
            />
          </Field>
          {managedHint("PARTY_SIZE")}
        </div>
      ) : (
        <div className="rounded-control border border-line bg-surface-sunken px-4 py-3">
          <p className="text-sm font-semibold text-ink">名單人數：1 位</p>
          <p className="mt-1 text-caption leading-6 text-ink-soft">
            新人與家人請一人建立一筆名單。
          </p>
          <input type="hidden" name="partySize" value="1" />
        </div>
      )}

      <Field htmlFor={idPrefix + "-notes"} label="備註" optional>
        <Textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={3}
          defaultValue={initialValues?.notes ?? ""}
        />
      </Field>
    </div>
  );
}

/**
 * 賓客表單的回饋訊息會主動取得焦點，讓讀螢幕的人立刻聽到結果。
 */
function ActionFeedback({
  state,
  className,
}: {
  state: GuestMutationState;
  className?: string;
}) {
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.status !== "idle") {
      feedbackRef.current?.focus();
    }
  }, [state]);

  if (state.status === "idle") {
    return null;
  }

  const isError = state.status === "error";

  return (
    <p
      ref={feedbackRef}
      tabIndex={-1}
      role={isError ? "alert" : "status"}
      className={cn(
        "min-w-0 rounded-control border px-3.5 py-2.5 text-caption leading-6 break-words outline-none",
        isError
          ? "border-danger/30 bg-danger-soft text-danger"
          : "border-positive/30 bg-positive-soft text-positive",
        className,
      )}
    >
      {state.message}
    </p>
  );
}

export function CreateGuestForm({
  workspaceId,
  onSuccess,
}: {
  workspaceId: string;
  onSuccess?: () => void;
}) {
  const createAction = createGuestAction.bind(null, workspaceId);
  const [state, formAction, isPending] = useActionState(
    async (previousState: GuestMutationState, formData: FormData) => {
      const nextState = await createAction(previousState, formData);
      if (nextState.status === "success") {
        onSuccess?.();
      }
      return nextState;
    },
    initialState,
  );

  return (
    <form action={formAction} aria-label="新增名單成員表單" className="min-w-0">
      <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
        <GuestFields idPrefix="new-guest" />
        <ActionFeedback state={state} />
      </div>
      <DialogFooter>
        <SubmitButton isPending={isPending} pendingLabel="正在新增…">
          加入名單
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

export function CreateGuestDialog({ workspaceId }: { workspaceId: string }) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();

  return (
    <>
      <Button ref={triggerRef} onClick={open}>
        新增名單成員
      </Button>
      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="新增名單成員"
        title="加入賓客、新人或家人"
        closeLabel="關閉新增名單成員"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <CreateGuestForm workspaceId={workspaceId} onSuccess={close} />
      </Dialog>
    </>
  );
}

type EditGuestFormProps = NonNullable<GuestFieldsProps["initialValues"]> & {
  workspaceId: string;
  guestId: string;
  expectedVersion: number;
  managedFields: GuestManagedField[];
};

type EditGuestSnapshot = EditGuestFormProps & {
  managedFieldsSignature: string;
};

function managedFieldsSignature(fields: readonly GuestManagedField[]) {
  return Array.from(new Set(fields)).sort().join("|");
}

function createEditGuestSnapshot(
  props: EditGuestFormProps,
): EditGuestSnapshot {
  const normalizedManagedFields = Array.from(new Set(props.managedFields)).sort();
  return {
    ...props,
    managedFields: normalizedManagedFields,
    managedFieldsSignature: managedFieldsSignature(normalizedManagedFields),
  };
}

function isSameEditGuestSnapshot(
  current: EditGuestSnapshot,
  latest: EditGuestSnapshot,
) {
  return (
    current.workspaceId === latest.workspaceId &&
    current.guestId === latest.guestId &&
    current.expectedVersion === latest.expectedVersion &&
    current.name === latest.name &&
    current.category === latest.category &&
    current.side === latest.side &&
    current.attendanceStatus === latest.attendanceStatus &&
    current.partySize === latest.partySize &&
    current.notes === latest.notes &&
    current.managedFieldsSignature === latest.managedFieldsSignature
  );
}

function EditGuestActionForm({
  snapshot,
  onClose,
  onSuccess,
}: {
  snapshot: EditGuestSnapshot;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const updateAction = updateGuestAction.bind(
    null,
    snapshot.workspaceId,
    snapshot.guestId,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: GuestMutationState, formData: FormData) => {
      const nextState = await updateAction(previousState, formData);
      if (nextState.status === "success") {
        onSuccess(nextState.message ?? "已更新賓客。");
      }
      return nextState;
    },
    initialState,
  );

  return (
    <form action={formAction} aria-label="編輯賓客表單" className="min-w-0">
      <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
        <input
          type="hidden"
          name="expectedVersion"
          value={snapshot.expectedVersion}
        />
        <GuestFields
          idPrefix={`edit-${snapshot.guestId}`}
          initialValues={{
            name: snapshot.name,
            category: snapshot.category,
            side: snapshot.side,
            attendanceStatus: snapshot.attendanceStatus,
            partySize: snapshot.partySize,
            notes: snapshot.notes,
          }}
          managedFields={snapshot.managedFields}
        />
        <ActionFeedback state={state} />
      </div>
      <DialogFooter>
        <Button variant="secondary" disabled={isPending} onClick={onClose}>
          取消
        </Button>
        <SubmitButton isPending={isPending} pendingLabel="正在儲存…">
          儲存變更
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

export function EditGuestForm(
  props: EditGuestFormProps & { onSuccess?: (message: string) => void },
) {
  const idPrefix = useId();
  const {
    dialogRef,
    triggerRef,
    open,
    close,
    closeWithoutRestoringFocus,
    restoreFocus,
  } = useModalDialog();
  const latestSnapshot = createEditGuestSnapshot(props);
  const [snapshot, setSnapshot] = useState(() => latestSnapshot);
  const [formGeneration, setFormGeneration] = useState(0);
  const snapshotIsOutdated = !isSameEditGuestSnapshot(snapshot, latestSnapshot);

  function loadLatestSnapshot() {
    setSnapshot(latestSnapshot);
    setFormGeneration((current) => current + 1);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        // 姓名只留在無障礙名稱裡：寫在按鈕上會讓長名字把整列撐開、換行成兩行，
        // 而畫面上這顆鈕就在那位賓客那一列，看得見的人不需要再讀一次名字。
        aria-label={`編輯 ${props.name}`}
        className="inline-flex min-h-11 max-w-full items-center rounded-control px-2.5 text-caption font-semibold text-clay-strong transition hover:bg-clay-soft"
      >
        編輯
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="編輯賓客"
        title={props.name}
        closeLabel="關閉編輯賓客"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        {snapshotIsOutdated ? (
          <div className="mx-5 mt-5 rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption leading-6 text-caution sm:mx-6">
            <p>這筆賓客已有較新的資料，目前表單仍保留原本的草稿與版本。</p>
            <button
              type="button"
              onClick={loadLatestSnapshot}
              className="mt-3 inline-flex min-h-11 items-center rounded-control border border-caution/40 px-4 font-semibold transition hover:bg-caution/10"
            >
              載入最新資料
            </button>
          </div>
        ) : null}
        <EditGuestActionForm
          key={formGeneration}
          snapshot={snapshot}
          onClose={close}
          onSuccess={(message) => {
            closeWithoutRestoringFocus();
            props.onSuccess?.(message);
          }}
        />
      </Dialog>
    </>
  );
}

export function DeleteGuestForm({
  workspaceId,
  guestId,
  expectedVersion,
  name,
  importSources,
}: {
  workspaceId: string;
  guestId: string;
  expectedVersion: number;
  name: string;
  importSources: Array<{ sourceLabel: string; sourceManaged: boolean }>;
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const deleteAction = deleteGuestAction.bind(null, workspaceId, guestId);
  const [state, formAction, isPending] = useActionState(
    deleteAction,
    initialState,
  );
  const managedSourceLabels = Array.from(
    new Set(
      importSources
        .filter((source) => source.sourceManaged)
        .map((source) => source.sourceLabel),
    ),
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label={`刪除 ${name}`}
        className="inline-flex min-h-11 max-w-full items-center rounded-control px-2.5 text-caption font-semibold text-danger transition hover:bg-danger-soft"
      >
        刪除
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="刪除賓客"
        title={name}
        closeLabel="關閉刪除賓客"
        isPending={isPending}
        size="sm"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-3 px-5 py-6 sm:px-6">
            <input
              type="hidden"
              name="expectedVersion"
              value={expectedVersion}
            />
            {managedSourceLabels.length > 0 ? (
              <>
                <p className="text-sm font-semibold text-danger">
                  這筆資料由 {managedSourceLabels.join("、")} 來源維護。
                </p>
                <p className="text-caption leading-6 text-ink-soft">
                  日後再次匯入這些來源時，這筆賓客可能會依來源資料重新建立。
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-danger">
                  此動作無法復原。
                </p>
                <p className="text-caption leading-6 text-ink-soft">
                  只有在確認不再需要這筆賓客資料時才繼續。
                </p>
              </>
            )}
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
              aria-label={`確認刪除 ${name}`}
            >
              確認刪除
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
