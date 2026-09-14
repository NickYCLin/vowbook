"use client";

import { RelationshipCombobox } from "./relationship-combobox";

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
  GUEST_SENIORITIES,
  GUEST_SENIORITY_LABELS,
  GUEST_SIDES,
  guestIdentityLabel,
  normalizeGuestInput,
  normalizeGuestVersion,
  type GuestAttendanceStatusValue,
  type GuestCategoryValue,
  type GuestSeniorityValue,
  type GuestSideValue,
} from "@/domain/guest";
import { normalizeGuestDetailsInput } from "@/domain/guest-details";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/class-names";
import type {
  GuestCheckInEntryDto,
  GuestDetailsDto,
  WeddingGiftEntryDto,
} from "@/lib/guest-list";

const initialState: GuestMutationState = { status: "idle" };

const SIDE_FIELD_LABELS = {
  GUEST: "與新人的關係",
  COUPLE: "新人角色",
  FAMILY: "家人所屬",
} as const satisfies Record<GuestCategoryValue, string>;

type GuestFieldsProps = {
  idPrefix: string;
  restoreRevision?: number;
  managedFields?: readonly GuestManagedField[];
  initialValues?: {
    name: string;
    category: GuestCategoryValue;
    seniority?: GuestSeniorityValue;
    side: GuestSideValue;
    attendanceStatus: GuestAttendanceStatusValue;
    partySize: number;
    notes: string | null;
    details?: GuestDetailsDto | null;
  };
};

type GuestFieldValues = {
  name: string;
  category: GuestCategoryValue;
  seniority: GuestSeniorityValue;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: string;
  notes: string;
  relationshipLabel: string;
  contactPhone: string;
  contactEmail: string;
  childSeatCount: string;
  vegetarianCount: string;
  invitationDelivery: "" | NonNullable<GuestDetailsDto["invitationDelivery"]>;
  invitationReply: string;
  attendanceReply: string;
  mailingAddress: string;
  guestMessage: string;
};

function guestFieldValues(
  initialValues: GuestFieldsProps["initialValues"],
): GuestFieldValues {
  const details = initialValues?.details;
  return {
    name: initialValues?.name ?? "",
    category: initialValues?.category ?? "GUEST",
    seniority:
      initialValues?.seniority ??
      (initialValues?.category === "COUPLE" ? "PEER" : "UNSPECIFIED"),
    side: initialValues?.side ?? "SHARED",
    attendanceStatus: initialValues?.attendanceStatus ?? "UNDECIDED",
    partySize: String(initialValues?.partySize ?? 1),
    notes: initialValues?.notes ?? "",
    relationshipLabel: details?.relationshipLabel ?? "",
    contactPhone: details?.contactPhone ?? "",
    contactEmail: details?.contactEmail ?? "",
    childSeatCount:
      details?.childSeatCount === null || details?.childSeatCount === undefined
        ? ""
        : String(details.childSeatCount),
    vegetarianCount:
      details?.vegetarianCount === null || details?.vegetarianCount === undefined
        ? ""
        : String(details.vegetarianCount),
    invitationDelivery: details?.invitationDelivery ?? "",
    invitationReply: details?.invitationReply ?? "",
    attendanceReply: details?.attendanceReply ?? "",
    mailingAddress: details?.mailingAddress ?? "",
    guestMessage: details?.guestMessage ?? "",
  };
}

function GuestFields({
  idPrefix,
  initialValues,
  managedFields = [],
  restoreRevision = 0,
}: GuestFieldsProps) {
  const [values, setValues] = useState<GuestFieldValues>(() =>
    guestFieldValues(initialValues),
  );
  const { category, side, seniority } = values;
  const sideOptions = category === "GUEST" ? GUEST_SIDES : GUEST_SIDES.slice(0, 2);
  const parsedPartySize = Number(values.partySize);
  const requirementMaximum =
    category === "COUPLE"
      ? 1
      : Number.isInteger(parsedPartySize) &&
          parsedPartySize >= 1 &&
          parsedPartySize <= 20
        ? parsedPartySize
        : 20;
  const hasImportedFields = managedFields.length > 0;
  const updateValue = <FieldName extends keyof GuestFieldValues>(
    field: FieldName,
    value: GuestFieldValues[FieldName],
  ) => setValues((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    if (restoreRevision === 0) return;
    const frame = requestAnimationFrame(() => {
      setValues((current) => ({ ...current }));
    });
    return () => cancelAnimationFrame(frame);
  }, [restoreRevision]);

  return (
    <div className="min-w-0 space-y-5">
      {hasImportedFields ? (
        <p className="rounded-control border border-line bg-surface-sunken px-4 py-3 text-caption leading-6 text-ink-soft">
          這筆資料曾由外部來源建立，仍可依現場狀況修改；原始來源紀錄會保留供後續追蹤。
        </p>
      ) : null}
      <div className="min-w-0">
        <Field htmlFor={`${idPrefix}-name`} label="姓名或稱呼">
          <Input
            id={`${idPrefix}-name`}
            name="name"
            type="text"
            required
            minLength={1}
            autoComplete="off"
            value={values.name}
            onChange={(event) => updateValue("name", event.target.value)}
          />
        </Field>
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
              setValues((current) => ({
                ...current,
                category: nextCategory,
                side:
                  nextCategory !== "GUEST" && current.side === "SHARED"
                    ? "PARTNER_A"
                    : current.side,
                seniority:
                  nextCategory === "COUPLE" && current.seniority === "UNSPECIFIED"
                    ? "PEER"
                    : current.seniority,
              }));
            }}
          >
            {GUEST_CATEGORIES.map((value) => (
              <option key={value} value={value}>
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
              value={side}
              onChange={(event) =>
                updateValue("side", event.target.value as GuestSideValue)
              }
            >
              {sideOptions.map((optionSide) => (
                <option key={optionSide} value={optionSide}>
                  {guestIdentityLabel(category, optionSide)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="min-w-0">
          <Field
            htmlFor={`${idPrefix}-seniority`}
            label="賓客輩份"
            hint="名單會先依輩份，再依姓氏筆劃排列；未設定會排在最後。"
          >
            <Select
              id={`${idPrefix}-seniority`}
              name="seniority"
              required
              value={seniority}
              onChange={(event) =>
                updateValue(
                  "seniority",
                  event.target.value as GuestSeniorityValue,
                )
              }
            >
              {GUEST_SENIORITIES.map((seniority) => (
                <option key={seniority} value={seniority}>
                  {GUEST_SENIORITY_LABELS[seniority]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="min-w-0">
          <Field htmlFor={`${idPrefix}-attendance`} label="出席狀態">
            <Select
              id={`${idPrefix}-attendance`}
              name="attendanceStatus"
              required
              value={values.attendanceStatus}
              onChange={(event) =>
                updateValue(
                  "attendanceStatus",
                  event.target.value as GuestAttendanceStatusValue,
                )
              }
            >
              <option value="UNDECIDED">尚未確認</option>
              <option value="ATTENDING">出席</option>
              <option value="DECLINED">不出席</option>
            </Select>
          </Field>
        </div>
      </div>

      {category !== "COUPLE" ? (
        <div className="min-w-0">
          <Field
            htmlFor={idPrefix + "-party-size"}
            label="邀請人數（含本人）"
            hint={
              category === "FAMILY"
                ? "可包含同行的伴侶、小孩或寶寶，最多 20 位；需要兒童座椅可在下方填寫。"
                : "包含賓客本人，最多 20 位。"
            }
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
              value={values.partySize}
              onChange={(event) => updateValue("partySize", event.target.value)}
              className="sm:max-w-40"
            />
          </Field>
        </div>
      ) : (
        <div className="rounded-control border border-line bg-surface-sunken px-4 py-3">
          <p className="text-sm font-semibold text-ink">名單人數：1 位</p>
          <p className="mt-1 text-caption leading-6 text-ink-soft">
            新人請一人建立一筆名單。
          </p>
          <input type="hidden" name="partySize" value="1" />
        </div>
      )}

      <Field htmlFor={idPrefix + "-notes"} label="備註" optional>
        <Textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={3}
          value={values.notes}
          onChange={(event) => updateValue("notes", event.target.value)}
        />
      </Field>

      <section className="min-w-0 border-t border-line pt-5">
        <div>
          <h3 className="font-serif text-body font-semibold text-ink">
            聯絡與回覆資料
          </h3>
          <p className="mt-1 text-caption leading-6 text-ink-soft">
            選填；不論名單是手動建立或外部匯入，都可以在這裡補充與修改。
          </p>
        </div>

        <div className="mt-5 grid min-w-0 gap-5 sm:grid-cols-2">
          <Field
            htmlFor={`${idPrefix}-relationship-label`}
            label={category === "FAMILY" ? "家人關係稱謂" : "關係補充"}
            optional
            hint={category === "FAMILY" ? "以家人所屬的新郎／新娘為稱呼基準。可搜尋稱謂、別稱或部分文字，例如爸爸、舅媽、外父；也可自訂二舅等稱呼。輩份請另外確認。" : undefined}
            className={category === "FAMILY" ? "sm:col-span-2" : undefined}
          >
            {category === "FAMILY" ? <RelationshipCombobox id={`${idPrefix}-relationship-label`} value={values.relationshipLabel} onChange={value=>updateValue("relationshipLabel",value)}/> : <Input
              id={`${idPrefix}-relationship-label`} name="relationshipLabel" maxLength={100} type="text" autoComplete="off"
              value={values.relationshipLabel} onChange={event=>updateValue("relationshipLabel",event.target.value)}
            />}
          </Field>

          <Field htmlFor={`${idPrefix}-contact-phone`} label="聯絡電話" optional>
            <Input
              id={`${idPrefix}-contact-phone`}
              name="contactPhone"
              type="tel"
              autoComplete="tel"
              value={values.contactPhone}
              onChange={(event) => updateValue("contactPhone", event.target.value)}
            />
          </Field>

          <Field htmlFor={`${idPrefix}-contact-email`} label="電子信箱" optional>
            <Input
              id={`${idPrefix}-contact-email`}
              name="contactEmail"
              type="email"
              autoComplete="email"
              value={values.contactEmail}
              onChange={(event) => updateValue("contactEmail", event.target.value)}
            />
          </Field>

          <Field htmlFor={`${idPrefix}-child-seat-count`} label="兒童座椅" optional>
            <Input
              id={`${idPrefix}-child-seat-count`}
              name="childSeatCount"
              type="number"
              min={0}
              max={requirementMaximum}
              step={1}
              inputMode="numeric"
              value={values.childSeatCount}
              onChange={(event) => updateValue("childSeatCount", event.target.value)}
            />
          </Field>

          <Field htmlFor={`${idPrefix}-vegetarian-count`} label="素食人數" optional>
            <Input
              id={`${idPrefix}-vegetarian-count`}
              name="vegetarianCount"
              type="number"
              min={0}
              max={requirementMaximum}
              step={1}
              inputMode="numeric"
              value={values.vegetarianCount}
              onChange={(event) =>
                updateValue("vegetarianCount", event.target.value)
              }
            />
          </Field>

          <Field htmlFor={`${idPrefix}-invitation-delivery`} label="喜帖方式" optional>
            <Select
              id={`${idPrefix}-invitation-delivery`}
              name="invitationDelivery"
              value={values.invitationDelivery}
              onChange={(event) =>
                updateValue(
                  "invitationDelivery",
                  event.target.value as GuestFieldValues["invitationDelivery"],
                )
              }
            >
              <option value="">尚未填寫</option>
              <option value="UNKNOWN">尚未確認</option>
              <option value="PAPER">紙本喜帖</option>
              <option value="DIGITAL">電子喜帖</option>
              <option value="NONE">不需寄送</option>
            </Select>
          </Field>

          <Field
            htmlFor={`${idPrefix}-invitation-reply`}
            label="喜帖回覆補充"
            optional
          >
            <Input
              id={`${idPrefix}-invitation-reply`}
              name="invitationReply"
              type="text"
              autoComplete="off"
              value={values.invitationReply}
              onChange={(event) => updateValue("invitationReply", event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 min-w-0 space-y-5">
          <Field
            htmlFor={`${idPrefix}-attendance-reply`}
            label="出席回覆補充"
            optional
          >
            <Textarea
              id={`${idPrefix}-attendance-reply`}
              name="attendanceReply"
              rows={2}
              value={values.attendanceReply}
              onChange={(event) => updateValue("attendanceReply", event.target.value)}
            />
          </Field>

          <Field htmlFor={`${idPrefix}-mailing-address`} label="寄送地址" optional>
            <Textarea
              id={`${idPrefix}-mailing-address`}
              name="mailingAddress"
              rows={2}
              value={values.mailingAddress}
              onChange={(event) => updateValue("mailingAddress", event.target.value)}
            />
          </Field>

          <Field htmlFor={`${idPrefix}-guest-message`} label="賓客留言" optional>
            <Textarea
              id={`${idPrefix}-guest-message`}
              name="guestMessage"
              rows={3}
              value={values.guestMessage}
              onChange={(event) => updateValue("guestMessage", event.target.value)}
            />
          </Field>
        </div>
      </section>
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
  const [fieldGeneration, setFieldGeneration] = useState(0);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const [state, formAction, isPending] = useActionState(
    async (previousState: GuestMutationState, formData: FormData) => {
      const nextState = await createAction(previousState, formData);
      if (nextState.status === "success") {
        setFieldGeneration((current) => current + 1);
        onSuccess?.();
      } else {
        setRestoreRevision((current) => current + 1);
      }
      return nextState;
    },
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-label="新增名單成員表單"
      className="min-w-0"
    >
      <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
        <GuestFields
          key={fieldGeneration}
          idPrefix="new-guest"
          restoreRevision={restoreRevision}
        />
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

export function CreateGuestDialog({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const [formGeneration, setFormGeneration] = useState(0);

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
        size="lg"
      >
        <CreateGuestForm
          key={formGeneration}
          workspaceId={workspaceId}
          onSuccess={() => {
            close();
            setFormGeneration((current) => current + 1);
          }}
        />
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
  detailsSignature: string;
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
    seniority:
      props.seniority ??
      (props.category === "COUPLE" ? "PEER" : "UNSPECIFIED"),
    managedFields: normalizedManagedFields,
    managedFieldsSignature: managedFieldsSignature(normalizedManagedFields),
    details: props.details ?? null,
    detailsSignature: JSON.stringify(props.details ?? null),
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
    current.seniority === latest.seniority &&
    current.side === latest.side &&
    current.attendanceStatus === latest.attendanceStatus &&
    current.partySize === latest.partySize &&
    current.notes === latest.notes &&
    current.detailsSignature === latest.detailsSignature &&
    current.managedFieldsSignature === latest.managedFieldsSignature
  );
}

function isEditGuestSnapshotOutdated(
  current: EditGuestSnapshot,
  latest: EditGuestSnapshot,
) {
  if (
    current.workspaceId !== latest.workspaceId ||
    current.guestId !== latest.guestId
  ) {
    return true;
  }
  if (latest.expectedVersion !== current.expectedVersion) {
    // 自己剛成功寫入時，本地 v+1 snapshot 會暫時領先舊 RSC props；只有
    // 伺服器版本更高才代表有另一份需要人工確認的新資料。
    return latest.expectedVersion > current.expectedVersion;
  }
  return !isSameEditGuestSnapshot(current, latest);
}

function successfulEditGuestSnapshot(
  current: EditGuestSnapshot,
  formData: FormData,
): EditGuestSnapshot {
  const input = normalizeGuestInput({
    name: formData.get("name"),
    category: formData.get("category"),
    seniority: formData.get("seniority"),
    side: formData.get("side"),
    attendanceStatus: formData.get("attendanceStatus"),
    partySize: formData.get("partySize"),
    notes: formData.get("notes"),
  });
  const normalizedDetails = normalizeGuestDetailsInput({
    relationshipLabel: formData.get("relationshipLabel"),
    contactPhone: formData.get("contactPhone"),
    contactEmail: formData.get("contactEmail"),
    childSeatCount: formData.get("childSeatCount"),
    vegetarianCount: formData.get("vegetarianCount"),
    invitationDelivery: formData.get("invitationDelivery"),
    mailingAddress: formData.get("mailingAddress"),
    guestMessage: formData.get("guestMessage"),
    attendanceReply: formData.get("attendanceReply"),
    invitationReply: formData.get("invitationReply"),
  });
  // 單一舊欄位已從表單移除；server 會保留它目前的 effective value。
  const details: GuestDetailsDto = {
    ...normalizedDetails,
    ceremonyAttendance: current.details?.ceremonyAttendance ?? null,
  };

  return createEditGuestSnapshot({
    workspaceId: current.workspaceId,
    guestId: current.guestId,
    expectedVersion:
      normalizeGuestVersion(formData.get("expectedVersion")) + 1,
    name: input.name,
    category: input.category,
    seniority: input.seniority ?? current.seniority,
    side: input.side,
    attendanceStatus: input.attendanceStatus,
    partySize: input.partySize,
    notes: input.notes,
    details: Object.values(details).some((value) => value !== null)
      ? details
      : null,
    managedFields: current.managedFields,
  });
}

function EditGuestActionForm({
  snapshot,
  onClose,
  onSuccess,
}: {
  snapshot: EditGuestSnapshot;
  onClose: () => void;
  onSuccess: (message: string, formData: FormData) => void;
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
        onSuccess(nextState.message ?? "已更新賓客。", formData);
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
            seniority: snapshot.seniority,
            side: snapshot.side,
            attendanceStatus: snapshot.attendanceStatus,
            partySize: snapshot.partySize,
            notes: snapshot.notes,
            details: snapshot.details,
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
  const snapshotIsOutdated = isEditGuestSnapshotOutdated(
    snapshot,
    latestSnapshot,
  );

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
        size="lg"
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
          onSuccess={(message, formData) => {
            const committedSnapshot = successfulEditGuestSnapshot(
              snapshot,
              formData,
            );
            setSnapshot(committedSnapshot);
            setFormGeneration((current) => current + 1);
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
  hasManagedImportSource,
  weddingGift = null,
  checkIn = null,
  onSuccess,
}: {
  workspaceId: string;
  guestId: string;
  expectedVersion: number;
  name: string;
  hasManagedImportSource: boolean;
  weddingGift?: Pick<WeddingGiftEntryDto, "id" | "version"> | null;
  checkIn?: Pick<GuestCheckInEntryDto, "id" | "version" | "headcount"> | null;
  onSuccess?: (message: string) => void;
}) {
  const idPrefix = useId();
  const {
    dialogRef,
    triggerRef,
    open,
    close,
    closeWithoutRestoringFocus,
    restoreFocus,
  } = useModalDialog();
  const [snapshot, setSnapshot] = useState<{
    expectedVersion: number;
    name: string;
    hasManagedImportSource: boolean;
    weddingGift: Pick<WeddingGiftEntryDto, "id" | "version"> | null;
    checkIn: Pick<GuestCheckInEntryDto, "id" | "version" | "headcount"> | null;
  } | null>(null);
  const deleteAction = deleteGuestAction.bind(null, workspaceId, guestId);
  const [state, formAction, isPending] = useActionState(
    async (previousState: GuestMutationState, formData: FormData) => {
      const nextState = await deleteAction(previousState, formData);
      if (nextState.status === "success") {
        closeWithoutRestoringFocus();
        onSuccess?.(nextState.message ?? "已刪除賓客。");
      }
      return nextState;
    },
    initialState,
  );
  const currentSnapshot = {
    expectedVersion,
    name,
    hasManagedImportSource,
    weddingGift,
    checkIn,
  };
  const activeSnapshot = snapshot ?? currentSnapshot;
  const isOutdated =
    snapshot !== null &&
    (snapshot.expectedVersion !== expectedVersion ||
      snapshot.name !== name ||
      snapshot.hasManagedImportSource !== hasManagedImportSource ||
      snapshot.weddingGift?.id !== weddingGift?.id ||
      snapshot.weddingGift?.version !== weddingGift?.version ||
      snapshot.checkIn?.id !== checkIn?.id ||
      snapshot.checkIn?.version !== checkIn?.version);

  function openWithCurrentSnapshot() {
    setSnapshot({
      ...currentSnapshot,
      weddingGift: weddingGift ? { ...weddingGift } : null,
      checkIn: checkIn ? { ...checkIn } : null,
    });
    open();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openWithCurrentSnapshot}
        aria-label={`刪除 ${name}`}
        className="inline-flex min-h-11 max-w-full items-center rounded-control px-2.5 text-caption font-semibold text-danger transition hover:bg-danger-soft"
      >
        刪除
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="刪除賓客"
        title={activeSnapshot.name}
        closeLabel="關閉刪除賓客"
        isPending={isPending}
        size="sm"
        onClose={close}
        onRestoreFocus={() => {
          restoreFocus();
          setSnapshot(null);
        }}
      >
        <form action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-3 px-5 py-6 sm:px-6">
            <input
              type="hidden"
              name="expectedVersion"
              value={activeSnapshot.expectedVersion}
            />
            <input
              type="hidden"
              name="expectedWeddingGiftId"
              value={activeSnapshot.weddingGift?.id ?? ""}
            />
            <input
              type="hidden"
              name="expectedWeddingGiftVersion"
              value={activeSnapshot.weddingGift?.version ?? ""}
            />
            <input
              type="hidden"
              name="expectedGuestCheckInId"
              value={activeSnapshot.checkIn?.id ?? ""}
            />
            <input
              type="hidden"
              name="expectedGuestCheckInVersion"
              value={activeSnapshot.checkIn?.version ?? ""}
            />
            {isOutdated ? (
              <p className="rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption font-semibold leading-6 text-caution">
                這筆賓客、禮金或報到紀錄已有較新的資料。請先關閉視窗，再重新確認最新內容。
              </p>
            ) : null}
            {activeSnapshot.hasManagedImportSource ? (
              <>
                <p className="text-sm font-semibold text-danger">
                  這筆資料仍連結外部匯入來源。
                </p>
                <p className="text-caption leading-6 text-ink-soft">
                  日後再次匯入時，這筆賓客可能會依來源資料重新建立。
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
            {activeSnapshot.weddingGift ? (
              <p className="text-caption font-semibold leading-6 text-danger">
                此禮金紀錄也會永久移除。
              </p>
            ) : null}
            {activeSnapshot.checkIn ? (
              <p className="text-caption font-semibold leading-6 text-danger">
                已登記的報到紀錄（實到 {activeSnapshot.checkIn.headcount}{" "}
                位）也會永久移除。
              </p>
            ) : null}
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
              aria-label={`確認刪除 ${activeSnapshot.name}`}
              disabled={isOutdated}
            >
              確認刪除
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
