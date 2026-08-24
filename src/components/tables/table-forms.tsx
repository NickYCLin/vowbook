"use client";

import { UserMinus } from "@phosphor-icons/react";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  adjustSeatingTablesAction,
  assignGuestToTableAction,
  createSeatingTableAction,
  deleteSeatingTableAction,
  type SeatingTableMutationState,
  type SeatingTableAdjustmentConfirmation as SeatingTableAdjustmentConfirmationData,
  unassignGuestFromTableAction,
  updateSeatingTableAction,
} from "@/actions/seating-tables";
import { Button, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Eyebrow } from "@/components/ui/card";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/class-names";

const initialState: SeatingTableMutationState = { status: "idle" };

/**
 * <summary> 觸發鈕的外觀。
 * 不共用 buttonClassName 是因為 base 帶了 whitespace-nowrap，
 * 而桌名可能很長，這裡必須讓它換行。
 */
const disclosureTriggerClassName =
  "inline-flex min-h-11 w-fit max-w-full cursor-pointer items-center rounded-control border px-3.5 py-2 text-sm font-semibold break-words transition [&::-webkit-details-marker]:hidden";

export function SeatingTableActionFeedback({
  state,
}: {
  state: SeatingTableMutationState;
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

  const isAlert =
    state.status === "error" ||
    (state.status === "confirmation" && state.stale);
  const isConfirmation = state.status === "confirmation";

  return (
    <p
      ref={feedbackRef}
      tabIndex={-1}
      role={isAlert ? "alert" : "status"}
      className={cn(
        "min-w-0 rounded-control border px-3.5 py-2.5 text-caption leading-6 break-words outline-none",
        isAlert
          ? "border-danger/30 bg-danger-soft text-danger"
          : isConfirmation
            ? "border-caution/35 bg-caution-soft text-caution"
            : "border-positive/30 bg-positive-soft text-positive",
      )}
    >
      {state.message}
    </p>
  );
}

export function SeatingTableAdjustmentConfirmation({
  confirmation,
  onCancel,
  pending = false,
}: {
  confirmation: SeatingTableAdjustmentConfirmationData;
  onCancel: () => void;
  pending?: boolean;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-card border border-caution/35 bg-caution-soft px-4 py-4 text-caution sm:px-5"
    >
      <h3 id={headingId} className="font-serif text-title font-semibold">
        {confirmation.operation === "adjust-table-count"
          ? "確認縮減桌數"
          : "確認刪除桌次"}
      </h3>
      <p className="mt-1.5 text-caption leading-6">
        {confirmation.operation === "adjust-table-count"
          ? `將移除名單中的 ${confirmation.removedTableCount} 桌。`
          : "將永久移除以下桌次。"}
      </p>
      <ul className="mt-4 min-w-0 space-y-3">
        {confirmation.tables.map((table) => (
          <li
            key={`${table.name}:${table.capacity}`}
            className="min-w-0 rounded-control border border-caution/25 bg-surface/70 px-4 py-3"
          >
            <h4 className="font-semibold break-words text-caution">
              {table.name}
            </h4>
            <p className="mt-1 text-caption leading-6">
              容量 {table.capacity} 位
            </p>
            <p className="mt-1 text-caption leading-6 break-words whitespace-pre-wrap">
              {table.notes ? `備註：${table.notes}` : "無備註"}
            </p>
            <p className="mt-1 text-caption font-semibold leading-6">
              受影響 {table.affectedGuestGroupCount} 組、
              {table.affectedGuestPartySize} 位
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-caption font-semibold leading-6">
        合計受影響 {confirmation.affectedGuestGroupCount} 組、
        {confirmation.affectedGuestPartySize} 位賓客。
      </p>
      {confirmation.canConfirm ? (
        <p className="mt-2 text-caption leading-6">
          所列桌次目前都是空桌；確認後才會永久移除。
        </p>
      ) : (
        <p
          role="alert"
          className="mt-2 rounded-control border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-caption font-semibold leading-6 text-danger"
        >
          仍有賓客的桌次不能移除，請先移動賓客。
        </p>
      )}
      <input
        type="hidden"
        name="snapshotFingerprint"
        value={confirmation.fingerprint}
      />
      <Button
        variant="secondary"
        size="sm"
        className="mt-4"
        onClick={onCancel}
        disabled={pending}
      >
        取消並放棄確認
      </Button>
    </section>
  );
}

export function AdjustSeatingTablesForm({
  workspaceId,
  currentTableCount,
}: AdjustSeatingTablesFormProps) {
  return (
    <AdjustSeatingTablesFormState
      workspaceId={workspaceId}
      currentTableCount={currentTableCount}
    />
  );
}

type AdjustSeatingTablesFormProps = {
  workspaceId: string;
  currentTableCount: number;
};

function AdjustSeatingTablesFormState({
  workspaceId,
  currentTableCount,
}: AdjustSeatingTablesFormProps) {
  const countId = useId();
  const capacityId = useId();
  const adjustAction = adjustSeatingTablesAction.bind(null, workspaceId);
  const [state, formAction, isPending] = useActionState(adjustAction, initialState);
  const [targetTableCount, setTargetTableCount] = useState(
    String(currentTableCount),
  );
  const [dismissedFingerprint, setDismissedFingerprint] = useState<
    string | null
  >(null);
  const previousTableCountRef = useRef(currentTableCount);
  const confirmationIsCurrent =
    state.status === "confirmation" &&
    targetTableCount.trim() === String(state.confirmation.targetTableCount) &&
    dismissedFingerprint !== state.confirmation.fingerprint;
  const isDestructiveConfirm =
    confirmationIsCurrent &&
    state.status === "confirmation" &&
    state.confirmation.canConfirm;
  const isBlockedConfirm =
    confirmationIsCurrent &&
    state.status === "confirmation" &&
    !state.confirmation.canConfirm;

  useEffect(() => {
    if (previousTableCountRef.current === currentTableCount) {
      return;
    }
    previousTableCountRef.current = currentTableCount;
    setTargetTableCount(String(currentTableCount));
    setDismissedFingerprint(null);
  }, [currentTableCount]);

  return (
    <Card
      as="section"
      aria-labelledby="table-count-settings-heading"
      className="mb-6 min-w-0"
    >
      <CardHeader>
        <Eyebrow>先設定規模，再微調每桌</Eyebrow>
        <h2
          id="table-count-settings-heading"
          className="mt-1 font-serif text-title font-semibold text-ink"
        >
          桌數設定
        </h2>
      </CardHeader>
      <CardBody>
        <form
          action={formAction}
          aria-busy={isPending}
          className="min-w-0 space-y-5"
          onSubmit={() => setDismissedFingerprint(null)}
        >
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <Field htmlFor={countId} label="總桌數" hint="可設定 0～200 桌。">
              <Input
                id={countId}
                name="totalTableCount"
                type="number"
                required
                min={0}
                max={200}
                step={1}
                inputMode="numeric"
                value={targetTableCount}
                disabled={isPending}
                onChange={(event) => {
                  setTargetTableCount(event.target.value);
                  setDismissedFingerprint(null);
                }}
                className="tabular-nums sm:max-w-40"
              />
            </Field>
            <Field htmlFor={capacityId} label="新增桌的預設容量">
              <Input
                id={capacityId}
                name="defaultCapacity"
                type="number"
                required
                min={1}
                max={100}
                step={1}
                inputMode="numeric"
                defaultValue={10}
                disabled={isPending}
                className="tabular-nums sm:max-w-40"
              />
            </Field>
          </div>
          <p className="text-caption leading-6 text-ink-soft">
            既有桌次的桌名、容量與賓客安排不會在增加桌數時被覆寫。
          </p>
          <div data-action-feedback="seating-table-adjustment">
            <SeatingTableActionFeedback state={state} />
          </div>
          {confirmationIsCurrent && state.status === "confirmation" && (
            <SeatingTableAdjustmentConfirmation
              confirmation={state.confirmation}
              pending={isPending}
              onCancel={() =>
                setDismissedFingerprint(state.confirmation.fingerprint)
              }
            />
          )}
          <SubmitButton
            isPending={isPending}
            pendingLabel="正在套用…"
            variant={isDestructiveConfirm ? "danger-solid" : "primary"}
            disabled={isBlockedConfirm}
            className="w-full sm:w-auto"
          >
            {isDestructiveConfirm && state.status === "confirmation"
              ? `確認移除 ${state.confirmation.removedTableCount} 桌空桌`
              : isBlockedConfirm
                ? "請先移動待移除桌次的賓客"
                : "套用桌數設定"}
          </SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}

type TableFieldsProps = {
  idPrefix: string;
  initialValues?: {
    name: string;
    capacity: number;
    notes: string | null;
  };
};

function TableFields({ idPrefix, initialValues }: TableFieldsProps) {
  return (
    <div className="min-w-0 space-y-5">
      <Field htmlFor={`${idPrefix}-name`} label="桌名">
        <Input
          id={`${idPrefix}-name`}
          name="name"
          type="text"
          required
          minLength={1}
          autoComplete="off"
          defaultValue={initialValues?.name}
        />
      </Field>

      <Field
        htmlFor={`${idPrefix}-capacity`}
        label="容量"
        hint="以每筆賓客的「邀請人數（含本人）」合計。"
      >
        <Input
          id={`${idPrefix}-capacity`}
          name="capacity"
          type="number"
          required
          min={1}
          max={100}
          step={1}
          inputMode="numeric"
          defaultValue={initialValues?.capacity ?? 10}
          className="tabular-nums sm:max-w-40"
        />
      </Field>

      <Field htmlFor={`${idPrefix}-notes`} label="備註" optional>
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

export function CreateSeatingTableForm({ workspaceId }: { workspaceId: string }) {
  const idPrefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const successFeedbackRef = useRef<HTMLDivElement>(null);
  const {
    dialogRef,
    triggerRef,
    open,
    close,
    closeWithoutRestoringFocus,
    restoreFocus,
  } = useModalDialog();
  const createAction = createSeatingTableAction.bind(null, workspaceId);
  const [state, formAction, isPending] = useActionState(
    async (previousState: SeatingTableMutationState, formData: FormData) => {
      const nextState = await createAction(previousState, formData);
      if (nextState.status === "success") {
        formRef.current?.reset();
        closeWithoutRestoringFocus();
      }
      return nextState;
    },
    initialState,
  );

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }
    // 原生 dialog 關閉後才會完成瀏覽器自己的焦點收尾；下一幀再聚焦，
    // 才不會讓成功訊息被 trigger 的還原焦點覆蓋。
    const frame = requestAnimationFrame(() => {
      successFeedbackRef.current
        ?.querySelector<HTMLParagraphElement>('[role="status"]')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);

  return (
    <>
      <Button ref={triggerRef} onClick={open}>
        新增桌次
      </Button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        title="新增桌次"
        eyebrow="寫下桌名與容量"
        closeLabel="關閉新增桌次"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form ref={formRef} action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
            <TableFields idPrefix={idPrefix} />
            {state.status === "success" ? null : (
              <div data-action-feedback="seating-table-create">
                <SeatingTableActionFeedback state={state} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={isPending} onClick={close}>
              取消
            </Button>
            <SubmitButton isPending={isPending} pendingLabel="正在新增…">
              新增桌次
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* 成功訊息留在對話框外，關閉後仍看得到。 */}
      {state.status === "success" ? (
        <div
          ref={successFeedbackRef}
          data-action-feedback="seating-table-create"
          className="mt-3"
        >
          <SeatingTableActionFeedback state={state} />
        </div>
      ) : null}
    </>
  );
}

export function EditSeatingTableForm({
  workspaceId,
  tableId,
  tableLabel,
  name,
  capacity,
  notes,
  version,
}: {
  workspaceId: string;
  tableId: string;
  /** 帶桌號的說法，例如「5 號桌 男方同事」。桌名會重複，只有它認得出是哪一桌。 */
  tableLabel: string;
  name: string;
  capacity: number;
  notes: string | null;
  version: number;
}) {
  const idPrefix = useId();
  const successFeedbackRef = useRef<HTMLDivElement>(null);
  const {
    dialogRef,
    triggerRef,
    open,
    close,
    closeWithoutRestoringFocus,
    restoreFocus,
  } = useModalDialog();
  const updateAction = updateSeatingTableAction.bind(null, workspaceId, tableId);
  const [state, formAction, isPending] = useActionState(updateAction, initialState);
  const [formSnapshot, setFormSnapshot] = useState(() => ({
    name,
    capacity,
    notes,
    version,
  }));
  const [dirty, setDirty] = useState(false);
  const handledSuccessStateRef = useRef<SeatingTableMutationState | null>(null);

  useEffect(() => {
    const actionJustSucceeded =
      state.status === "success" && handledSuccessStateRef.current !== state;
    if (actionJustSucceeded) {
      handledSuccessStateRef.current = state;
      closeWithoutRestoringFocus();
    }
    if (dirty && !actionJustSucceeded) {
      return;
    }

    setFormSnapshot((current) => {
      if (
        current.name === name &&
        current.capacity === capacity &&
        current.notes === notes &&
        current.version === version
      ) {
        return current;
      }
      return { name, capacity, notes, version };
    });
    if (actionJustSucceeded) {
      setDirty(false);
    }
  }, [
    capacity,
    closeWithoutRestoringFocus,
    dirty,
    name,
    notes,
    state,
    version,
  ]);

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }
    const frame = requestAnimationFrame(() => {
      successFeedbackRef.current
        ?.querySelector<HTMLParagraphElement>('[role="status"]')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        // 桌號＋桌名留在無障礙名稱裡：印在鈕上會被長桌名撐開換行，而這顆鈕
        // 本來就在那一桌的卡片裡。
        aria-label={`編輯 ${tableLabel}`}
        className={cn(
          disclosureTriggerClassName,
          "border-line-strong bg-surface text-clay-strong hover:border-clay hover:bg-clay-soft",
        )}
      >
        編輯
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        title="編輯桌次"
        description={tableLabel}
        closeLabel={`關閉編輯 ${tableLabel}`}
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form
          action={formAction}
          className="min-w-0"
          onChange={() => setDirty(true)}
        >
          <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
            <TableFields
              key={formSnapshot.version}
              idPrefix={idPrefix}
              initialValues={formSnapshot}
            />
            <input
              type="hidden"
              name="expectedVersion"
              value={formSnapshot.version}
            />
            {state.status === "success" ? null : (
              <div data-action-feedback="seating-table-edit">
                <SeatingTableActionFeedback state={state} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={isPending} onClick={close}>
              取消
            </Button>
            <SubmitButton isPending={isPending} pendingLabel="正在儲存…">
              儲存桌次
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* 成功訊息留在對話框外，關閉後仍看得到。 */}
      {state.status === "success" ? (
        <div
          ref={successFeedbackRef}
          data-action-feedback="seating-table-edit"
          className="mt-3 w-full"
        >
          <SeatingTableActionFeedback state={state} />
        </div>
      ) : null}
    </>
  );
}

export function DeleteSeatingTableForm({
  workspaceId,
  tableId,
  tableLabel,
  onDeleteIntent,
  onIntentRejected,
}: {
  workspaceId: string;
  tableId: string;
  /** 帶桌號的說法。刪錯桌是不可逆的，提示一定要指得出是哪一桌。 */
  tableLabel: string;
  onDeleteIntent?: (intent: DeleteSeatingTableIntent) => void;
  onIntentRejected?: (intent: DeleteSeatingTableIntentRejection) => void;
}) {
  const deleteAction = deleteSeatingTableAction.bind(null, workspaceId, tableId);
  const [state, formAction, isPending] = useActionState(deleteAction, initialState);
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const [dismissedFingerprint, setDismissedFingerprint] = useState<
    string | null
  >(null);
  const confirmationVisible =
    state.status === "confirmation" &&
    dismissedFingerprint !== state.confirmation.fingerprint;

  useEffect(() => {
    if (
      state.status === "error" ||
      (state.status === "confirmation" && state.stale)
    ) {
      onIntentRejected?.({ tableId });
    }
  }, [onIntentRejected, state, tableId]);

  useEffect(() => {
    if (isPending && disclosureRef.current) {
      disclosureRef.current.open = true;
    }
  }, [isPending]);

  return (
    <details
      ref={disclosureRef}
      aria-busy={isPending}
      // 展開後佔滿整列，確認面板才有足夠寬度；收合時和「編輯」並排。
      className="group min-w-0 [&[open]]:w-full"
      onToggle={(event) => {
        if (isPending && !event.currentTarget.open) {
          event.currentTarget.open = true;
        }
      }}
    >
      <summary
        aria-disabled={isPending || undefined}
        onClick={(event) => {
          if (isPending) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          if (isPending && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
          }
        }}
        aria-label={`刪除 ${tableLabel}`}
        className={cn(
          disclosureTriggerClassName,
          "border-danger/40 bg-surface text-danger hover:border-danger hover:bg-danger-soft",
        )}
      >
        刪除
      </summary>
      <div className="mt-3 min-w-0 rounded-card border border-danger/30 bg-danger-soft px-4 py-4 sm:px-5">
        <p className="text-caption font-semibold text-danger">
          刪除前會先檢查最新桌次與賓客安排。
        </p>
        <p className="mt-1 text-caption leading-6 text-danger">
          只有空桌可以刪除；有賓客時請先移動賓客。
        </p>
        <form
          action={formAction}
          className="mt-4 min-w-0 space-y-3"
          onSubmit={() => {
            setDismissedFingerprint(null);
            if (
              confirmationVisible &&
              state.status === "confirmation" &&
              state.confirmation.canConfirm
            ) {
              // 帶桌號的說法：好幾桌同名時，「已刪除空桌 主桌」講不清楚
              // 到底刪掉了哪一桌。
              onDeleteIntent?.({ tableId, tableName: tableLabel });
            }
          }}
        >
          <div data-action-feedback="seating-table-delete">
            <SeatingTableActionFeedback state={state} />
          </div>
          {confirmationVisible && state.status === "confirmation" && (
            <SeatingTableAdjustmentConfirmation
              confirmation={state.confirmation}
              pending={isPending}
              onCancel={() =>
                setDismissedFingerprint(state.confirmation.fingerprint)
              }
            />
          )}
          <SubmitButton
            isPending={isPending}
            pendingLabel="正在檢查…"
            variant={
              confirmationVisible &&
              state.status === "confirmation" &&
              state.confirmation.canConfirm
                ? "danger-solid"
                : "danger"
            }
            disabled={
              confirmationVisible &&
              state.status === "confirmation" &&
              !state.confirmation.canConfirm
            }
            aria-label={
              confirmationVisible &&
              state.status === "confirmation" &&
              state.confirmation.canConfirm
                ? `確認刪除空桌 ${tableLabel}`
                : confirmationVisible
                  ? `${tableLabel} 尚有賓客，無法刪除`
                  : `預覽刪除 ${tableLabel}`
            }
          >
            {confirmationVisible
              ? state.status === "confirmation" &&
                state.confirmation.canConfirm
                ? "確認刪除空桌"
                : "請先移動此桌賓客"
              : "預覽刪除桌次"}
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}

export type DeleteSeatingTableIntent = {
  tableId: string;
  tableName: string;
};

export type DeleteSeatingTableIntentRejection = {
  tableId: string;
};

export function AssignGuestForm({
  workspaceId,
  guestId,
  guestName,
  guestPartySize,
  tables,
  onAssignIntent,
  onIntentRejected,
}: {
  workspaceId: string;
  guestId: string;
  guestName: string;
  guestPartySize: number;
  tables: { id: string; name: string; remainingCapacity: number }[];
  onAssignIntent?: (intent: AssignGuestIntent) => void;
  onIntentRejected?: (intent: SeatingGuestIntentRejection) => void;
}) {
  const selectId = useId();
  const assignAction = assignGuestToTableAction.bind(null, workspaceId, guestId);
  const [state, formAction, isPending] = useActionState(assignAction, initialState);
  const hasAvailableTable = tables.some(
    (table) => table.remainingCapacity >= guestPartySize,
  );

  useEffect(() => {
    if (
      state.status === "error" ||
      (state.status === "confirmation" && state.stale)
    ) {
      onIntentRejected?.({ operation: "assign", guestId });
    }
  }, [guestId, onIntentRejected, state]);

  return (
    <form
      action={formAction}
      className="mt-2.5 min-w-0 space-y-2"
      onSubmit={(event) => {
        const selectedTableId = new FormData(event.currentTarget).get("tableId");
        const selectedTable = tables.find(
          (table) => table.id === selectedTableId,
        );
        if (selectedTable) {
          onAssignIntent?.({
            guestId,
            guestName,
            tableId: selectedTable.id,
            tableName: selectedTable.name,
          });
        }
      }}
    >
      {/* 桌名就在上一行，標籤只留給輔助技術。 */}
      <label htmlFor={selectId} className="sr-only">
        為{guestName}選擇桌次
      </label>
      {/*
        依「未安排賓客欄」的實際寬度換行，不是視窗寬度：
        lg 版面下這一欄只有 ~300px，用 sm: 會讓選單被壓成一個箭頭。
      */}
      <div className="flex min-w-0 flex-col gap-2 @sm:flex-row">
        <Select
          id={selectId}
          name="tableId"
          required
          defaultValue=""
          disabled={!hasAvailableTable}
          className="flex-1 text-caption"
        >
          <option value="" disabled>
            請選擇桌次
          </option>
          {tables.map((table) => (
            <option
              key={table.id}
              value={table.id}
              disabled={table.remainingCapacity < guestPartySize}
            >
              {table.name}（剩餘 {Math.max(0, table.remainingCapacity)} 位）
            </option>
          ))}
        </Select>
        <SubmitButton
          isPending={isPending}
          pendingLabel="安排中…"
          variant="secondary"
          disabled={!hasAvailableTable}
          aria-label={`安排${guestName}`}
          className="shrink-0"
        >
          安排入席
        </SubmitButton>
      </div>
      {!hasAvailableTable && (
        <p className="text-caption leading-6 text-ink-soft">
          目前沒有足夠座位容納這筆賓客，請先調整桌次容量。
        </p>
      )}
      <div data-action-feedback="seating-table-assignment">
        <SeatingTableActionFeedback
          state={state.status === "success" ? initialState : state}
        />
      </div>
    </form>
  );
}

export type AssignGuestIntent = {
  guestId: string;
  guestName: string;
  tableId: string;
  tableName: string;
};

export type UnassignGuestIntent = {
  guestId: string;
  guestName: string;
};

export type SeatingGuestIntentRejection = {
  operation: "assign" | "unassign";
  guestId: string;
};

export function UnassignGuestForm({
  workspaceId,
  guestId,
  guestName,
  onUnassignIntent,
  onIntentRejected,
}: {
  workspaceId: string;
  guestId: string;
  guestName: string;
  onUnassignIntent?: (intent: UnassignGuestIntent) => void;
  onIntentRejected?: (intent: SeatingGuestIntentRejection) => void;
}) {
  const unassignAction = unassignGuestFromTableAction.bind(
    null,
    workspaceId,
    guestId,
  );
  const [state, formAction, isPending] = useActionState(
    unassignAction,
    initialState,
  );

  useEffect(() => {
    if (
      state.status === "error" ||
      (state.status === "confirmation" && state.stale)
    ) {
      onIntentRejected?.({ operation: "unassign", guestId });
    }
  }, [guestId, onIntentRejected, state]);

  return (
    <form
      action={formAction}
      className="mt-1.5 flex min-w-0 flex-col items-end gap-2"
      onSubmit={() => onUnassignIntent?.({ guestId, guestName })}
    >
      <SubmitButton
        isPending={isPending}
        pendingLabel="移出中…"
        variant="danger"
        size="sm"
        aria-label={`將${guestName}移出桌次`}
        className="min-h-11 sm:min-h-9"
      >
        <UserMinus
          aria-hidden="true"
          data-testid="unassign-guest-icon"
          size={16}
          weight="bold"
        />
        移出此桌
      </SubmitButton>
      <div
        className="w-full"
        data-action-feedback="seating-table-unassignment"
      >
        <SeatingTableActionFeedback
          state={state.status === "success" ? initialState : state}
        />
      </div>
    </form>
  );
}
