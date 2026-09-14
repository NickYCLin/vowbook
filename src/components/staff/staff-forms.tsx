"use client";

import { useActionState, useId, useRef, useState } from "react";
import {
  createWeddingStaffAction,
  deleteWeddingStaffAction,
  type WeddingStaffMutationState,
  updateWeddingStaffAction,
} from "@/actions/wedding-staff";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  MAX_WEDDING_STAFF_MEAL_COUNT,
  MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT,
  normalizeWeddingStaffDetails,
} from "@/domain/wedding-staff";

const initialState: WeddingStaffMutationState = { status: "idle" };

type StaffFieldValues = {
  roleName: string;
  personName: string;
  contactPhone: string;
  notes: string;
  /** 以 checkbox 的 "on"／"" 表示，讓所有欄位共用同一組字串狀態。 */
  needsMeal: string;
  mealCount: string;
  vegetarianMealCount: string;
  redEnvelopeAmount: string;
};

type EditWeddingStaffFormProps = {
  workspaceId: string;
  staffId: string;
  roleName: string;
  personName: string;
  contactPhone: string | null;
  notes: string | null;
  mealCount: number | null;
  vegetarianMealCount: number | null;
  redEnvelopeAmount: number | null;
  expectedVersion: number;
  triggerId?: string;
};

type EditWeddingStaffSnapshot = {
  workspaceId: string;
  staffId: string;
  expectedVersion: number;
  values: StaffFieldValues;
};

function createEditWeddingStaffSnapshot(
  props: EditWeddingStaffFormProps,
): EditWeddingStaffSnapshot {
  return {
    workspaceId: props.workspaceId,
    staffId: props.staffId,
    expectedVersion: props.expectedVersion,
    values: {
      roleName: props.roleName,
      personName: props.personName,
      contactPhone: props.contactPhone ?? "",
      notes: props.notes ?? "",
      needsMeal: props.mealCount === null ? "" : "on",
      mealCount: props.mealCount === null ? "1" : String(props.mealCount),
      vegetarianMealCount:
        props.vegetarianMealCount === null
          ? "0"
          : String(props.vegetarianMealCount),
      redEnvelopeAmount:
        props.redEnvelopeAmount === null
          ? ""
          : String(props.redEnvelopeAmount),
    },
  };
}

function isSameEditWeddingStaffSnapshot(
  current: EditWeddingStaffSnapshot,
  latest: EditWeddingStaffSnapshot,
): boolean {
  return (
    current.workspaceId === latest.workspaceId &&
    current.staffId === latest.staffId &&
    current.expectedVersion === latest.expectedVersion &&
    current.values.roleName === latest.values.roleName &&
    current.values.personName === latest.values.personName &&
    current.values.contactPhone === latest.values.contactPhone &&
    current.values.notes === latest.values.notes &&
    current.values.needsMeal === latest.values.needsMeal &&
    current.values.mealCount === latest.values.mealCount &&
    current.values.vegetarianMealCount === latest.values.vegetarianMealCount &&
    current.values.redEnvelopeAmount === latest.values.redEnvelopeAmount
  );
}

function isEditWeddingStaffSnapshotOutdated(
  current: EditWeddingStaffSnapshot,
  latest: EditWeddingStaffSnapshot,
): boolean {
  if (
    current.workspaceId !== latest.workspaceId ||
    current.staffId !== latest.staffId
  ) {
    return true;
  }
  if (latest.expectedVersion !== current.expectedVersion) {
    return latest.expectedVersion > current.expectedVersion;
  }
  return !isSameEditWeddingStaffSnapshot(current, latest);
}

function successfulEditWeddingStaffSnapshot(
  current: EditWeddingStaffSnapshot,
  formData: FormData,
): EditWeddingStaffSnapshot {
  const details = normalizeWeddingStaffDetails({
    roleName: formData.get("roleName"),
    personName: formData.get("personName"),
    contactPhone: formData.get("contactPhone"),
    notes: formData.get("notes"),
    needsMeal: formData.get("needsMeal"),
    mealCount: formData.get("mealCount"),
    vegetarianMealCount: formData.get("vegetarianMealCount"),
    redEnvelopeAmount: formData.get("redEnvelopeAmount"),
  });
  const submittedVersion = Number(formData.get("expectedVersion"));

  return {
    ...current,
    expectedVersion: submittedVersion + 1,
    values: {
      roleName: details.roleName,
      personName: details.personName,
      contactPhone: details.contactPhone ?? "",
      notes: details.notes ?? "",
      needsMeal: details.mealCount === null ? "" : "on",
      mealCount:
        details.mealCount === null ? "1" : String(details.mealCount),
      vegetarianMealCount:
        details.vegetarianMealCount === null
          ? "0"
          : String(details.vegetarianMealCount),
      redEnvelopeAmount:
        details.redEnvelopeAmount === null
          ? ""
          : String(details.redEnvelopeAmount),
    },
  };
}

const roleSuggestions = [
  "總招待",
  "招待",
  "收禮金",
  "發餅",
  "花童",
  "主持人",
  "攝影",
  "新娘秘書",
  "拍拍印",
];

function StaffFields({
  idPrefix,
  values,
  onFieldChange,
}: {
  idPrefix: string;
  values: StaffFieldValues;
  onFieldChange?: (field: keyof StaffFieldValues, value: string) => void;
}) {
  /** 未受控時用 defaultValue，受控時才綁 value/onChange。 */
  const bind = (field: keyof StaffFieldValues) =>
    onFieldChange
      ? {
          value: values[field],
          onChange: (
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
          ) => onFieldChange(field, event.target.value),
        }
      : { defaultValue: values[field] };
  // 未受控的新增表單沒有外部狀態可讀，但份數欄位要跟著勾選即時出現，
  // 所以這裡自己記一份；送出成功後由 key 重新掛載歸零。
  const [uncontrolledNeedsMeal, setUncontrolledNeedsMeal] = useState(
    values.needsMeal === "on",
  );
  const needsMeal = onFieldChange
    ? values.needsMeal === "on"
    : uncontrolledNeedsMeal;

  return (
    <div className="min-w-0 space-y-5">
      <Field
        htmlFor={`${idPrefix}-role`}
        label="職務"
        hint="最多 60 個字元；可直接從常見職務挑選。"
      >
        <Input
          id={`${idPrefix}-role`}
          name="roleName"
          list={`${idPrefix}-role-suggestions`}
          required
          minLength={1}
          maxLength={60}
          {...bind("roleName")}
        />
        <datalist id={`${idPrefix}-role-suggestions`}>
          {roleSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </Field>

      <Field
        htmlFor={`${idPrefix}-name`}
        label="姓名"
        hint="最多 120 個字元。"
      >
        <Input
          id={`${idPrefix}-name`}
          name="personName"
          required
          minLength={1}
          maxLength={120}
          {...bind("personName")}
        />
      </Field>

      <Field htmlFor={`${idPrefix}-phone`} label="聯絡電話" optional>
        <Input
          id={`${idPrefix}-phone`}
          name="contactPhone"
          type="tel"
          maxLength={40}
          className="sm:max-w-64"
          {...bind("contactPhone")}
        />
      </Field>

      <fieldset className="min-w-0 space-y-4 border-0 p-0">
        <legend className="text-sm font-semibold text-ink">婚宴當天便當</legend>
        <label className="flex min-h-11 min-w-0 items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="needsMeal"
            className="size-4.5 shrink-0 accent-clay"
            checked={needsMeal}
            onChange={(event) => {
              if (onFieldChange) {
                onFieldChange("needsMeal", event.target.checked ? "on" : "");
                return;
              }
              setUncontrolledNeedsMeal(event.target.checked);
            }}
          />
          <span>需要便當</span>
        </label>
        {needsMeal ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field
              htmlFor={`${idPrefix}-meal-count`}
              label="便當份數"
              hint={`個人填 1；廠商團隊請填實際人數，最多 ${MAX_WEDDING_STAFF_MEAL_COUNT} 份。`}
            >
              <Input
                id={`${idPrefix}-meal-count`}
                name="mealCount"
                type="number"
                min={1}
                max={MAX_WEDDING_STAFF_MEAL_COUNT}
                step={1}
                inputMode="numeric"
                required
                {...bind("mealCount")}
              />
            </Field>
            <Field
              htmlFor={`${idPrefix}-vegetarian-meal-count`}
              label="其中素食份數"
              hint="含在便當份數內；葷食份數會自動相減得出。"
            >
              <Input
                id={`${idPrefix}-vegetarian-meal-count`}
                name="vegetarianMealCount"
                type="number"
                min={0}
                max={MAX_WEDDING_STAFF_MEAL_COUNT}
                step={1}
                inputMode="numeric"
                required
                {...bind("vegetarianMealCount")}
              />
            </Field>
          </div>
        ) : null}
      </fieldset>

      <Field
        htmlFor={`${idPrefix}-red-envelope`}
        label="紅包金額"
        optional
        hint="婚宴結束時要發的紅包；不包紅包請留空。發放與否在名單上逐一標記。"
      >
        <Input
          id={`${idPrefix}-red-envelope`}
          name="redEnvelopeAmount"
          type="number"
          min={1}
          max={MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT}
          step={1}
          inputMode="numeric"
          className="sm:max-w-48"
          {...bind("redEnvelopeAmount")}
        />
      </Field>

      <Field
        htmlFor={`${idPrefix}-notes`}
        label="備註"
        optional
        hint="最多 500 個字元。"
      >
        <Textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={4}
          maxLength={500}
          {...bind("notes")}
        />
      </Field>
    </div>
  );
}

export function CreateWeddingStaffForm({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const idPrefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [formGeneration, setFormGeneration] = useState(0);
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const action = createWeddingStaffAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(
    async (previousState: WeddingStaffMutationState, formData: FormData) => {
      const nextState = await action(previousState, formData);
      if (nextState.status === "success") {
        formRef.current?.reset();
        // form.reset() 清不掉便當勾選的本地狀態，重新掛載才是真的回到空白。
        setFormGeneration((generation) => generation + 1);
        close();
      }
      return nextState;
    },
    initialState,
  );

  return (
    <>
      <Button ref={triggerRef} onClick={open}>
        新增工作人員
      </Button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        title="新增婚禮工作人員"
        closeLabel="關閉新增婚禮工作人員"
        isPending={pending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form ref={formRef} action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
            <StaffFields
              key={formGeneration}
              idPrefix={idPrefix}
              values={{
                roleName: "",
                personName: "",
                contactPhone: "",
                notes: "",
                needsMeal: "",
                mealCount: "1",
                vegetarianMealCount: "0",
                redEnvelopeAmount: "",
              }}
            />
            {state.status === "success" ? null : (
              <ActionFeedback state={state} />
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={close}>
              取消
            </Button>
            <SubmitButton isPending={pending} pendingLabel="新增中…">
              新增工作人員
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* 成功訊息留在對話框外，關閉後仍看得到。 */}
      {state.status === "success" ? (
        <ActionFeedback state={state} className="mt-3" />
      ) : null}
    </>
  );
}

export function EditWeddingStaffForm(props: EditWeddingStaffFormProps) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const latestSnapshot = createEditWeddingStaffSnapshot(props);
  const [snapshot, setSnapshot] = useState(() => latestSnapshot);
  const [fieldState, setFieldState] = useState<StaffFieldValues>(
    () => snapshot.values,
  );
  const [hideActionFeedback, setHideActionFeedback] = useState(false);
  const snapshotIsOutdated = isEditWeddingStaffSnapshotOutdated(
    snapshot,
    latestSnapshot,
  );
  const action = updateWeddingStaffAction.bind(
    null,
    snapshot.workspaceId,
    snapshot.staffId,
  );
  const [state, formAction, pending] = useActionState(
    async (previousState: WeddingStaffMutationState, formData: FormData) => {
      setHideActionFeedback(false);
      const nextState = await action(previousState, formData);
      if (nextState.status === "success") {
        const committedSnapshot = successfulEditWeddingStaffSnapshot(
          snapshot,
          formData,
        );
        setSnapshot(committedSnapshot);
        setFieldState(committedSnapshot.values);
        close();
      }
      return nextState;
    },
    initialState,
  );

  function loadLatestSnapshot() {
    setSnapshot(latestSnapshot);
    setFieldState(latestSnapshot.values);
    setHideActionFeedback(true);
  }

  return (
    <>
      <button
        id={props.triggerId}
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label={`編輯 ${props.personName}`}
        className="inline-flex min-h-11 max-w-full min-w-0 items-center rounded-control px-2.5 text-caption font-semibold text-clay-strong transition hover:bg-clay-soft"
      >
        編輯
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        title="編輯婚禮工作人員"
        closeLabel="關閉編輯婚禮工作人員"
        isPending={pending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        {snapshotIsOutdated ? (
          <div className="mx-5 mt-5 rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption leading-6 text-caution sm:mx-6">
            <p>
              這位工作人員已有較新的資料，目前表單仍保留原本的草稿與版本。
            </p>
            <button
              type="button"
              onClick={loadLatestSnapshot}
              className="mt-3 inline-flex min-h-11 items-center rounded-control border border-caution/40 px-4 font-semibold transition hover:bg-caution/10"
            >
              載入最新資料
            </button>
          </div>
        ) : null}
        <form action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
            <input
              type="hidden"
              name="expectedVersion"
              value={snapshot.expectedVersion}
            />
            <StaffFields
              idPrefix={idPrefix}
              values={fieldState}
              onFieldChange={(field, value) =>
                setFieldState((current) => ({ ...current, [field]: value }))
              }
            />
            {hideActionFeedback || pending || state.status === "success" ? null : (
              <ActionFeedback state={state} />
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={close}>
              取消
            </Button>
            <SubmitButton isPending={pending} pendingLabel="儲存中…">
              儲存工作人員
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {state.status === "success" && !hideActionFeedback && !pending ? (
        <ActionFeedback state={state} className="mt-3" />
      ) : null}
    </>
  );
}

export function DeleteWeddingStaffForm({
  workspaceId,
  staffId,
  personName,
  expectedVersion,
  timelineAssignmentFingerprint,
}: {
  workspaceId: string;
  staffId: string;
  personName: string;
  expectedVersion: number;
  timelineAssignmentFingerprint: string;
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const [snapshot, setSnapshot] = useState(() => ({
    personName,
    expectedVersion,
    timelineAssignmentFingerprint,
  }));
  const action = deleteWeddingStaffAction.bind(null, workspaceId, staffId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const snapshotIsOutdated =
    snapshot.personName !== personName ||
    snapshot.expectedVersion !== expectedVersion ||
    snapshot.timelineAssignmentFingerprint !== timelineAssignmentFingerprint;

  function openWithCurrentSnapshot() {
    setSnapshot({
      personName,
      expectedVersion,
      timelineAssignmentFingerprint,
    });
    open();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openWithCurrentSnapshot}
        aria-label={`移除 ${personName}`}
        className="inline-flex min-h-11 max-w-full min-w-0 items-center rounded-control px-2.5 text-caption font-semibold text-danger transition hover:bg-danger-soft"
      >
        移除
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="移除工作人員"
        title={snapshot.personName}
        closeLabel="關閉移除婚禮工作人員"
        isPending={pending}
        size="sm"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-3 px-5 py-6 sm:px-6">
            <input
              type="hidden"
              name="expectedVersion"
              value={snapshot.expectedVersion}
            />
            <input
              type="hidden"
              name="expectedTimelineAssignmentFingerprint"
              value={snapshot.timelineAssignmentFingerprint}
            />
            {snapshotIsOutdated ? (
              <p className="rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption font-semibold leading-6 text-caution">
                這位工作人員或流程指派已有較新的資料。請先關閉視窗，再重新確認最新內容。
              </p>
            ) : null}
            <p className="text-sm font-semibold text-danger">
              此動作無法復原。
            </p>
            <p className="text-caption leading-6 text-ink-soft">
              此人員也會從已指派的流程項目中移除。
            </p>
            <ActionFeedback state={state} />
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={close}>
              取消
            </Button>
            <SubmitButton
              isPending={pending}
              pendingLabel="移除中…"
              variant="danger-solid"
              aria-label={`確認移除：${snapshot.personName}`}
              disabled={snapshotIsOutdated}
            >
              確認移除
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
