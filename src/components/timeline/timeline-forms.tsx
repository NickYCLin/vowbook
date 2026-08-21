"use client";

import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useActionState,
  useId,
  useRef,
  useState,
} from "react";
import {
  applyGeneralLunchTimelineTemplateAction,
  createWeddingTimelineItemAction,
  deleteWeddingTimelineItemAction,
  type WeddingTimelineMutationState,
  updateWeddingTimelineItemAction,
} from "@/actions/wedding-timeline";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { containDialogFocus } from "@/lib/dialog-focus-containment";
import type {
  WeddingTimelineListItem,
  WeddingTimelineStaffOption,
} from "@/lib/wedding-timeline-list";

const initialState: WeddingTimelineMutationState = { status: "idle" };
const fieldClassName =
  "mt-2 min-h-12 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink shadow-inner outline-none transition focus:border-clay";

function closeOwningDialog(event: MouseEvent<HTMLButtonElement>): void {
  event.currentTarget.closest("dialog")?.close();
}

function Feedback({ state }: { state: WeddingTimelineMutationState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error"
          ? "border-l-2 border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
          : "border-l-2 border-sage bg-sage-soft px-4 py-3 text-sm text-sage"
      }
    >
      {state.message}
    </p>
  );
}

function TimelineFields({
  idPrefix,
  values,
  staff,
  selectedStaffIds,
  onFieldChange,
  onStaffChange,
}: {
  idPrefix: string;
  values: TimelineFieldValues;
  staff: WeddingTimelineStaffOption[];
  selectedStaffIds: string[];
  onFieldChange: (field: keyof TimelineFieldValues, value: string) => void;
  onStaffChange: (staffId: string, selected: boolean) => void;
}) {
  const assignedIds = new Set(selectedStaffIds);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-start`} className="font-medium">
            開始時間
          </label>
          <input
            id={`${idPrefix}-start`}
            name="startTime"
            type="time"
            required
            value={values.startTime}
            onChange={(event) =>
              onFieldChange("startTime", event.target.value)
            }
            className={fieldClassName}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-end`} className="font-medium">
            結束時間 <span className="text-sm font-normal text-ink-faint">選填</span>
          </label>
          <input
            id={`${idPrefix}-end`}
            name="endTime"
            type="time"
            value={values.endTime}
            onChange={(event) => onFieldChange("endTime", event.target.value)}
            className={fieldClassName}
          />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-phase`} className="font-medium">
            階段
          </label>
          <input
            id={`${idPrefix}-phase`}
            name="phase"
            required
            maxLength={60}
            value={values.phase}
            onChange={(event) => onFieldChange("phase", event.target.value)}
            className={fieldClassName}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-title`} className="font-medium">
            流程項目
          </label>
          <input
            id={`${idPrefix}-title`}
            name="title"
            required
            maxLength={120}
            value={values.title}
            onChange={(event) => onFieldChange("title", event.target.value)}
            className={fieldClassName}
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-location`} className="font-medium">
          地點 <span className="text-sm font-normal text-ink-faint">選填</span>
        </label>
        <input
          id={`${idPrefix}-location`}
          name="location"
          maxLength={120}
          value={values.location}
          onChange={(event) => onFieldChange("location", event.target.value)}
          className={fieldClassName}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-details`} className="font-medium">
          流程細節 <span className="text-sm font-normal text-ink-faint">選填</span>
        </label>
        <textarea
          id={`${idPrefix}-details`}
          name="details"
          rows={4}
          maxLength={2000}
          value={values.details}
          onChange={(event) => onFieldChange("details", event.target.value)}
          className={`${fieldClassName} py-3`}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-media-cue`} className="font-medium">
          音樂／影片（選填）
        </label>
        <textarea
          id={`${idPrefix}-media-cue`}
          name="mediaCue"
          rows={3}
          maxLength={500}
          value={values.mediaCue}
          onChange={(event) => onFieldChange("mediaCue", event.target.value)}
          className={`${fieldClassName} py-3`}
        />
      </div>
      <fieldset className="border-y border-dashed border-line py-5">
        <legend className="px-2 font-medium">負責工作人員</legend>
        {staff.length === 0 ? (
          <p className="text-sm text-ink-soft">
            尚無可指派人員；可先儲存流程，再到工作人員頁新增。
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {staff.map((person) => {
              const label = `${person.roleName}・${person.personName}`;
              return (
                <label
                  key={person.id}
                  className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="staffIds"
                    value={person.id}
                    checked={assignedIds.has(person.id)}
                    onChange={(event) =>
                      onStaffChange(person.id, event.target.checked)
                    }
                    className="shrink-0"
                  />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {label}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      <div>
        <label htmlFor={`${idPrefix}-notes`} className="font-medium">
          備註 <span className="text-sm font-normal text-ink-faint">選填</span>
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={3}
          maxLength={1000}
          value={values.notes}
          onChange={(event) => onFieldChange("notes", event.target.value)}
          className={`${fieldClassName} py-3`}
        />
      </div>
    </div>
  );
}

function TimelineDialog({
  title,
  triggerLabel,
  triggerId,
  dialogRef,
  pending,
  children,
}: {
  title: string;
  triggerLabel: string;
  triggerId?: string;
  dialogRef: RefObject<HTMLDialogElement | null>;
  pending: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        onClick={() => {
          const dialog = dialogRef.current;
          if (!dialog) return;
          dialog.showModal();
          dialog
            .querySelector<HTMLElement>(
              'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled)',
            )
            ?.focus();
        }}
        className="inline-flex min-h-11 max-w-full min-w-0 items-center whitespace-normal break-words rounded-full border border-line px-4 py-2 text-left text-sm font-semibold text-clay-strong hover:bg-clay-soft [overflow-wrap:anywhere]"
      >
        <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
          {triggerLabel}
        </span>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={id}
        onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => triggerRef.current?.focus()}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-stone-950/35"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-5 sm:px-7">
          <h2 id={id} className="min-w-0 break-words font-serif text-2xl font-semibold [overflow-wrap:anywhere]">
            {title}
          </h2>
          <button
            type="button"
            aria-label={`關閉${title}`}
            disabled={pending}
            onClick={(event) => event.currentTarget.closest("dialog")?.close()}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line text-2xl disabled:cursor-wait disabled:opacity-50"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {children}
      </dialog>
    </>
  );
}

type TimelineFieldValues = {
  startTime: string;
  endTime: string;
  phase: string;
  title: string;
  location: string;
  details: string;
  mediaCue: string;
  notes: string;
};

const emptyValues: TimelineFieldValues = {
  startTime: "11:30",
  endTime: "",
  phase: "",
  title: "",
  location: "",
  details: "",
  mediaCue: "",
  notes: "",
};

function fieldValues(
  values: Omit<WeddingTimelineListItem, "id" | "version" | "assignedStaff">,
): TimelineFieldValues {
  return {
    startTime: values.startTime,
    endTime: values.endTime ?? "",
    phase: values.phase,
    title: values.title,
    location: values.location ?? "",
    details: values.details ?? "",
    mediaCue: values.mediaCue ?? "",
    notes: values.notes ?? "",
  };
}

export function CreateWeddingTimelineItemForm({
  workspaceId,
  staff,
}: {
  workspaceId: string;
  staff: WeddingTimelineStaffOption[];
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<TimelineFieldValues>(emptyValues);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const action = createWeddingTimelineItemAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(
    async (previousState: WeddingTimelineMutationState, formData: FormData) => {
      const nextState = await action(previousState, formData);
      if (nextState.status === "success") {
        setValues(emptyValues);
        setSelectedStaffIds([]);
        dialogRef.current?.close();
      }
      return nextState;
    },
    initialState,
  );
  return (
    <>
      <TimelineDialog
        title="新增婚禮流程"
        triggerLabel="新增流程項目"
        dialogRef={dialogRef}
        pending={pending}
      >
        <form action={formAction} className="space-y-6 px-5 py-6 sm:px-7">
          <TimelineFields
            idPrefix={id}
            values={values}
            staff={staff}
            selectedStaffIds={selectedStaffIds}
            onFieldChange={(field, value) =>
              setValues((current) => ({ ...current, [field]: value }))
            }
            onStaffChange={(staffId, selected) =>
              setSelectedStaffIds((current) =>
                selected
                  ? current.includes(staffId)
                    ? current
                    : [...current, staffId]
                  : current.filter((id) => id !== staffId),
              )
            }
          />
          {state.status === "success" ? null : <Feedback state={state} />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={closeOwningDialog}
              className="min-h-11 rounded-full border border-line px-5 font-semibold disabled:cursor-wait disabled:opacity-50"
            >
              取消
            </button>
            <button type="submit" disabled={pending} className="min-h-11 rounded-full bg-clay px-5 font-semibold text-white">
              {pending ? "新增中…" : "新增流程項目"}
            </button>
          </div>
        </form>
      </TimelineDialog>
      {state.status === "success" ? <Feedback state={state} /> : null}
    </>
  );
}

export function EditWeddingTimelineItemForm({
  workspaceId,
  itemId,
  staff,
  assignedStaff,
  expectedVersion,
  triggerId,
  ...values
}: {
  workspaceId: string;
  itemId: string;
  staff: WeddingTimelineStaffOption[];
  assignedStaff: WeddingTimelineStaffOption[];
  expectedVersion: number;
  triggerId?: string;
} & Omit<WeddingTimelineListItem, "id" | "version" | "assignedStaff">) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draftVersion, setDraftVersion] = useState(expectedVersion);
  const [fieldState, setFieldState] = useState<TimelineFieldValues>(() =>
    fieldValues(values),
  );
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(() =>
    assignedStaff.map((person) => person.id),
  );
  const action = updateWeddingTimelineItemAction.bind(
    null,
    workspaceId,
    itemId,
  );
  const [state, formAction, pending] = useActionState(
    async (previousState: WeddingTimelineMutationState, formData: FormData) => {
      const nextState = await action(previousState, formData);
      if (nextState.status === "success") {
        setDraftVersion((current) => current + 1);
        dialogRef.current?.close();
      }
      return nextState;
    },
    initialState,
  );
  return (
    <>
      <TimelineDialog
        title="編輯婚禮流程"
        triggerLabel={`編輯 ${values.title}`}
        triggerId={triggerId}
        dialogRef={dialogRef}
        pending={pending}
      >
        <form action={formAction} className="space-y-6 px-5 py-6 sm:px-7">
          <input type="hidden" name="expectedVersion" value={draftVersion} />
          <TimelineFields
            idPrefix={id}
            values={fieldState}
            staff={staff}
            selectedStaffIds={selectedStaffIds}
            onFieldChange={(field, value) =>
              setFieldState((current) => ({ ...current, [field]: value }))
            }
            onStaffChange={(staffId, selected) =>
              setSelectedStaffIds((current) =>
                selected
                  ? current.includes(staffId)
                    ? current
                    : [...current, staffId]
                  : current.filter((id) => id !== staffId),
              )
            }
          />
          {state.status === "success" ? null : <Feedback state={state} />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={closeOwningDialog}
              className="min-h-11 rounded-full border border-line px-5 font-semibold disabled:cursor-wait disabled:opacity-50"
            >
              取消
            </button>
            <button type="submit" disabled={pending} className="min-h-11 rounded-full bg-clay px-5 font-semibold text-white">
              {pending ? "儲存中…" : "儲存流程項目"}
            </button>
          </div>
        </form>
      </TimelineDialog>
      {state.status === "success" ? <Feedback state={state} /> : null}
    </>
  );
}

export function DeleteWeddingTimelineItemForm({
  workspaceId,
  itemId,
  title,
  expectedVersion,
}: {
  workspaceId: string;
  itemId: string;
  title: string;
  expectedVersion: number;
}) {
  const action = deleteWeddingTimelineItemAction.bind(
    null,
    workspaceId,
    itemId,
  );
  const idPrefix = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
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
          刪除 {title}
        </span>
      </button>

      <Dialog
        dialogRef={dialogRef}
        titleId={`${idPrefix}-dialog-title`}
        eyebrow="刪除流程項目"
        title={title}
        closeLabel="關閉刪除流程項目"
        isPending={pending}
        size="sm"
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction} className="min-w-0">
          <div className="min-w-0 space-y-3 px-5 py-6 sm:px-6">
            <input type="hidden" name="expectedVersion" value={expectedVersion} />
            <p className="text-sm font-semibold text-danger">此動作無法復原。</p>
            <p className="text-caption leading-6 text-ink-soft">
              只有在確認不再需要這個流程項目時才繼續。
            </p>
            <Feedback state={state} />
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={close}>
              取消
            </Button>
            <SubmitButton
              isPending={pending}
              pendingLabel="刪除中…"
              variant="danger-solid"
              aria-label={`確認刪除：${title}`}
            >
              確認刪除
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

export function GeneralLunchTimelineTemplateForm({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const action = applyGeneralLunchTimelineTemplateAction.bind(
    null,
    workspaceId,
  );
  const [state, formAction, pending] = useActionState(
    async (previousState: WeddingTimelineMutationState) =>
      action(previousState),
    initialState,
  );
  return (
    <form action={formAction} className="space-y-3">
      <button type="submit" disabled={pending} className="min-h-11 rounded-full border border-clay bg-surface px-5 text-sm font-semibold text-clay-strong">
        {pending ? "建立中…" : "建立詳細午宴流程範本"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
