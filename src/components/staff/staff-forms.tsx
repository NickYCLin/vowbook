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

const initialState: WeddingStaffMutationState = { status: "idle" };

type StaffFieldValues = {
  roleName: string;
  personName: string;
  contactPhone: string;
  notes: string;
};

const roleSuggestions = [
  "總招待",
  "收禮金",
  "花童",
  "主持人",
  "攝影",
  "新娘秘書",
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
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const action = createWeddingStaffAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(
    async (previousState: WeddingStaffMutationState, formData: FormData) => {
      const nextState = await action(previousState, formData);
      if (nextState.status === "success") {
        formRef.current?.reset();
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
              idPrefix={idPrefix}
              values={{
                roleName: "",
                personName: "",
                contactPhone: "",
                notes: "",
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

export function EditWeddingStaffForm({
  workspaceId,
  staffId,
  roleName,
  personName,
  contactPhone,
  notes,
  expectedVersion,
  triggerId,
}: {
  workspaceId: string;
  staffId: string;
  roleName: string;
  personName: string;
  contactPhone: string | null;
  notes: string | null;
  expectedVersion: number;
  triggerId?: string;
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const [draftVersion, setDraftVersion] = useState(expectedVersion);
  const [fieldState, setFieldState] = useState<StaffFieldValues>({
    roleName,
    personName,
    contactPhone: contactPhone ?? "",
    notes: notes ?? "",
  });
  const action = updateWeddingStaffAction.bind(null, workspaceId, staffId);
  const [state, formAction, pending] = useActionState(
    async (previousState: WeddingStaffMutationState, formData: FormData) => {
      const nextState = await action(previousState, formData);
      if (nextState.status === "success") {
        setDraftVersion((current) => current + 1);
        close();
      }
      return nextState;
    },
    initialState,
  );

  return (
    <>
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        onClick={open}
        className="inline-flex min-h-11 max-w-full min-w-0 items-center rounded-control px-2.5 text-caption font-semibold break-words text-clay-strong transition hover:bg-clay-soft [overflow-wrap:anywhere]"
      >
        <span className="min-w-0 break-words whitespace-normal [overflow-wrap:anywhere]">
          編輯 {personName}
        </span>
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
        <form action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-5 px-5 py-6 sm:px-6">
            <input type="hidden" name="expectedVersion" value={draftVersion} />
            <StaffFields
              idPrefix={idPrefix}
              values={fieldState}
              onFieldChange={(field, value) =>
                setFieldState((current) => ({ ...current, [field]: value }))
              }
            />
            {state.status === "success" ? null : (
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

      {state.status === "success" ? (
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
}: {
  workspaceId: string;
  staffId: string;
  personName: string;
  expectedVersion: number;
}) {
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const action = deleteWeddingStaffAction.bind(null, workspaceId, staffId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        className="inline-flex min-h-11 max-w-full min-w-0 items-center rounded-control px-2.5 text-caption font-semibold break-words text-danger transition hover:bg-danger-soft [overflow-wrap:anywhere]"
      >
        <span className="min-w-0 break-words whitespace-normal [overflow-wrap:anywhere]">
          移除 {personName}
        </span>
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="移除工作人員"
        title={personName}
        closeLabel="關閉移除婚禮工作人員"
        isPending={pending}
        size="sm"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-3 px-5 py-6 sm:px-6">
            <input type="hidden" name="expectedVersion" value={expectedVersion} />
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
              aria-label={`確認移除：${personName}`}
            >
              確認移除
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
