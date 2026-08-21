"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  createBudgetGroupAction,
  deleteBudgetGroupSubtreeAction,
  dissolveBudgetGroupAction,
  type BudgetItemMutationState,
  updateBudgetGroupAction,
} from "@/actions/budget-items";
import {
  BUDGET_TAXONOMY_STAGES,
  type BudgetTaxonomyItemKey,
} from "@/domain/budget-item";
import { containDialogFocus } from "@/lib/dialog-focus-containment";

const initialState: BudgetItemMutationState = { status: "idle" };
const fieldClassName =
  "mt-2 min-h-12 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink shadow-inner outline-none transition focus:border-clay disabled:cursor-wait disabled:bg-surface-sunken";
const triggerClassName =
  "inline-flex min-h-11 w-fit max-w-full items-center justify-center rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-clay-strong transition hover:bg-clay-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2";
const dialogClassName =
  "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-0 text-left text-ink shadow-[0_12px_32px_rgba(69,49,38,0.16)] backdrop:bg-stone-950/35 backdrop:backdrop-blur-[1px]";

type GroupDialogCallbacks = {
  onSuccess?: (message: string) => void;
  onPendingChange?: (pending: boolean) => void;
};

function ActionFeedback({ state }: { state: BudgetItemMutationState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error"
          ? "break-words border-l-2 border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
          : "break-words border-l-2 border-sage bg-sage-soft px-4 py-3 text-sm text-sage"
      }
    >
      {state.message}
    </p>
  );
}

function restoreConnectedFocus(trigger: HTMLButtonElement | null) {
  if (trigger?.isConnected && trigger.closest("[hidden]") === null) {
    trigger.focus();
    return;
  }
  document.getElementById("budget-items-heading")?.focus();
}

function GroupDialogHeader({
  titleId,
  eyebrow,
  title,
  closeLabel,
  isPending,
  onClose,
}: {
  titleId: string;
  eyebrow: string;
  title: string;
  closeLabel: string;
  isPending: boolean;
  onClose: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-4 border-b border-line bg-surface px-5 py-5 sm:px-7">
      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-[0.14em] text-clay">
          {eyebrow}
        </p>
        <h2
          id={titleId}
          className="mt-1 break-words font-serif text-2xl font-semibold text-ink"
        >
          {title}
        </h2>
      </div>
      <button
        type="button"
        aria-label={closeLabel}
        disabled={isPending}
        onClick={onClose}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-line text-2xl leading-none text-ink-soft transition hover:bg-clay-soft disabled:cursor-wait disabled:opacity-50"
      >
        <span aria-hidden="true">×</span>
      </button>
    </header>
  );
}

function GroupNameField({
  id,
  value,
  disabled,
  inputRef,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block font-medium text-ink">
        群組名稱
      </label>
      <input
        ref={inputRef}
        id={id}
        name="name"
        type="text"
        required
        minLength={1}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClassName}
      />
      <p className="mt-2 text-sm leading-6 text-ink-faint">
        最多 120 個 Unicode 字元；群組只保存名稱與階層位置，不保存費用、付款或廠商資料。
      </p>
    </div>
  );
}

export function CreateBudgetGroupDialog({
  workspaceId,
  parentId = null,
  parentBreadcrumb = [],
  onSuccess,
  onPendingChange,
}: {
  workspaceId: string;
  parentId?: string | null;
  parentBreadcrumb?: string[];
} & GroupDialogCallbacks) {
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [taxonomyItemKey, setTaxonomyItemKey] = useState<
    "" | BudgetTaxonomyItemKey
  >("");
  const [showSuccessFeedback, setShowSuccessFeedback] = useState(false);
  const parentName = parentBreadcrumb.at(-1) ?? "指定項目";
  const title = "建立群組";
  const triggerLabel =
    parentId === null ? title : `在「${parentName}」下建立群組`;
  const formLabel =
    parentId === null ? `${title}表單` : `在${parentName}下建立群組表單`;
  const createAction = createBudgetGroupAction.bind(
    null,
    workspaceId,
    parentId,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      setShowSuccessFeedback(false);
      const nextState = await createAction(previousState, formData);
      if (nextState.status === "success") {
        setName("");
        setTaxonomyItemKey("");
        setShowSuccessFeedback(true);
        onSuccess?.(nextState.message ?? "已建立群組。");
        dialogRef.current?.close();
      }
      return nextState;
    },
    initialState,
  );

  useEffect(() => {
    onPendingChange?.(isPending);
    return () => onPendingChange?.(false);
  }, [isPending, onPendingChange]);

  function openDialog() {
    if (dialogRef.current?.open) return;
    setShowSuccessFeedback(false);
    dialogRef.current?.showModal();
    nameInputRef.current?.focus();
  }

  function closeDialog() {
    if (!isPending) dialogRef.current?.close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        onClick={openDialog}
        className={triggerClassName}
      >
        建立群組
      </button>
      {showSuccessFeedback && state.status === "success" ? (
        <div className="mt-3">
          <ActionFeedback state={state} />
        </div>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby={`${idPrefix}-title`}
        onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
        onCancel={(event) => {
          if (isPending) event.preventDefault();
        }}
        onClose={() => restoreConnectedFocus(triggerRef.current)}
        className={dialogClassName}
      >
        <GroupDialogHeader
          titleId={`${idPrefix}-title`}
          eyebrow={parentId === null ? "選用整理工具" : "新的下層群組"}
          title={title}
          closeLabel={`關閉${triggerLabel}`}
          isPending={isPending}
          onClose={closeDialog}
        />
        <form
          action={formAction}
          aria-label={formLabel}
          className="min-w-0 space-y-6 px-5 py-6 sm:px-7"
          noValidate
        >
          {parentId !== null ? (
            <p className="min-w-0 break-words text-sm leading-6 text-ink-soft">
              建立位置：{parentBreadcrumb.join(" › ")}
            </p>
          ) : (
            <p className="text-sm leading-6 text-ink-soft">
              選擇此自訂群組所屬的固定品項分類；建立後只會在該分類內整理。
            </p>
          )}
          <fieldset
            disabled={isPending}
            aria-busy={isPending}
            className="min-w-0 space-y-6 border-0 p-0"
          >
            <legend className="sr-only">群組資料</legend>
            {parentId === null ? (
              <div className="min-w-0">
                <label
                  htmlFor={`${idPrefix}-taxonomy-item-key`}
                  className="block font-medium text-ink"
                >
                  品項分類
                </label>
                <select
                  id={`${idPrefix}-taxonomy-item-key`}
                  name="taxonomyItemKey"
                  required
                  value={taxonomyItemKey}
                  onChange={(event) =>
                    setTaxonomyItemKey(
                      event.target.value as BudgetTaxonomyItemKey,
                    )
                  }
                  className={fieldClassName}
                >
                  <option value="" hidden>
                    請選擇品項分類
                  </option>
                  {BUDGET_TAXONOMY_STAGES.map((stage) => (
                    <optgroup key={stage.key} label={stage.label}>
                      {stage.items.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            ) : null}
            <GroupNameField
              id={`${idPrefix}-name`}
              value={name}
              disabled={isPending}
              inputRef={nameInputRef}
              onChange={setName}
            />
            {state.status === "success" ? null : (
              <ActionFeedback state={state} />
            )}
            <div className="flex min-w-0 flex-col-reverse gap-3 border-t border-dashed border-line pt-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isPending}
                onClick={closeDialog}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-line px-5 py-2 font-semibold text-ink transition hover:bg-clay-soft disabled:cursor-wait disabled:opacity-50 sm:w-auto"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-clay bg-clay px-5 py-2 font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-70 sm:w-auto"
              >
                {isPending ? "正在建立…" : "建立群組"}
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
    </>
  );
}

export function EditBudgetGroupDialog({
  workspaceId,
  itemId,
  name,
  expectedVersion,
  breadcrumb = [name],
  onSuccess,
  onPendingChange,
}: {
  workspaceId: string;
  itemId: string;
  name: string;
  expectedVersion: number;
  breadcrumb?: string[];
} & GroupDialogCallbacks) {
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [draftOverride, setDraftOverride] = useState<{
    name: string;
    expectedVersion: number;
    dirty: true;
  } | null>(null);
  const draft = draftOverride ?? {
    name,
    expectedVersion,
    dirty: false as const,
  };
  const [showSuccessFeedback, setShowSuccessFeedback] = useState(false);
  const updateAction = updateBudgetGroupAction.bind(null, workspaceId, itemId);
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      setShowSuccessFeedback(false);
      const nextState = await updateAction(previousState, formData);
      if (nextState.status === "success") {
        setDraftOverride(null);
        setShowSuccessFeedback(true);
        onSuccess?.(nextState.message ?? "已更新群組。");
        dialogRef.current?.close();
      }
      return nextState;
    },
    initialState,
  );
  const hasFreshServerSnapshot =
    expectedVersion !== draft.expectedVersion || name !== draft.name;

  useEffect(() => {
    onPendingChange?.(isPending);
    return () => onPendingChange?.(false);
  }, [isPending, onPendingChange]);

  function openDialog() {
    if (dialogRef.current?.open) return;
    setShowSuccessFeedback(false);
    dialogRef.current?.showModal();
    nameInputRef.current?.focus();
  }

  function closeDialog() {
    if (!isPending) dialogRef.current?.close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`編輯群組：${name}`}
        onClick={openDialog}
        className={`${triggerClassName} mt-4`}
      >
        編輯群組
      </button>
      {showSuccessFeedback && state.status === "success" ? (
        <div className="mt-3">
          <ActionFeedback state={state} />
        </div>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby={`${idPrefix}-title`}
        onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
        onCancel={(event) => {
          if (isPending) event.preventDefault();
        }}
        onClose={() => restoreConnectedFocus(triggerRef.current)}
        className={dialogClassName}
      >
        <GroupDialogHeader
          titleId={`${idPrefix}-title`}
          eyebrow="群組"
          title="編輯群組"
          closeLabel={`關閉編輯群組：${name}`}
          isPending={isPending}
          onClose={closeDialog}
        />
        <form
          action={formAction}
          aria-label={`編輯群組：${name}`}
          className="min-w-0 space-y-6 px-5 py-6 sm:px-7"
          noValidate
        >
          <nav
            aria-label="編輯群組層級路徑"
            className="min-w-0 break-words text-sm leading-6 text-ink-soft"
          >
            {breadcrumb.join(" › ")}
          </nav>
          <input
            type="hidden"
            name="expectedVersion"
            value={draft.expectedVersion}
          />
          <fieldset
            disabled={isPending}
            aria-busy={isPending}
            className="min-w-0 space-y-6 border-0 p-0"
          >
            <legend className="sr-only">群組資料</legend>
            <GroupNameField
              id={`${idPrefix}-name`}
              value={draft.name}
              disabled={isPending}
              inputRef={nameInputRef}
              onChange={(nextName) =>
                setDraftOverride((current) => ({
                  ...(current ?? { name, expectedVersion }),
                  name: nextName,
                  dirty: true,
                }))
              }
            />
            <ActionFeedback state={state} />
            {state.code === "STALE" && hasFreshServerSnapshot ? (
              <button
                type="button"
                onClick={() => setDraftOverride(null)}
                className="min-h-11 rounded-full border border-line px-4 py-2 text-sm font-semibold text-clay-strong hover:bg-clay-soft"
              >
                載入最新群組資料
              </button>
            ) : null}
            <div className="flex min-w-0 flex-col-reverse gap-3 border-t border-dashed border-line pt-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isPending}
                onClick={closeDialog}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-line px-5 py-2 font-semibold text-ink transition hover:bg-clay-soft disabled:cursor-wait disabled:opacity-50 sm:w-auto"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-clay bg-clay px-5 py-2 font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-70 sm:w-auto"
              >
                {isPending ? "正在儲存…" : "儲存群組"}
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
    </>
  );
}

export function DissolveBudgetGroupForm({
  workspaceId,
  itemId,
  name,
  expectedVersion,
  expectedDirectChildSetHash,
  directChildCount,
  directParentName,
  onSuccess,
  onPendingChange,
}: {
  workspaceId: string;
  itemId: string;
  name: string;
  expectedVersion: number;
  expectedDirectChildSetHash: string;
  directChildCount: number;
  directParentName: string | null;
} & GroupDialogCallbacks) {
  const dissolveAction = dissolveBudgetGroupAction.bind(
    null,
    workspaceId,
    itemId,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      const nextState = await dissolveAction(previousState, formData);
      if (nextState.status === "success") {
        onSuccess?.(nextState.message ?? "已移除群組並保留其中項目。");
      }
      return nextState;
    },
    initialState,
  );

  useEffect(() => {
    onPendingChange?.(isPending);
    return () => onPendingChange?.(false);
  }, [isPending, onPendingChange]);

  const targetDescription =
    directParentName === null ? "最上層" : `原上層「${directParentName}」`;

  return (
    <details className="mt-4 min-w-0">
      <summary
        aria-label={`移除群組並保留項目：${name}`}
        className="inline-flex min-h-11 w-fit max-w-full cursor-pointer items-center rounded-control border border-caution/40 px-4 text-caption font-semibold break-words text-caution transition hover:bg-caution-soft [&::-webkit-details-marker]:hidden"
      >
        移除群組並保留項目
      </summary>
      <div className="mt-3 min-w-0 rounded-control border border-caution/30 bg-caution-soft px-4 py-4 text-caution">
        <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-semibold">
          會移除群組「{name}」本身。
        </p>
        <p className="mt-2 min-w-0 [overflow-wrap:anywhere] text-sm leading-6">
          {directChildCount} 個直接子項會移到{targetDescription}。
        </p>
        <p className="mt-2 text-sm leading-6">
          費用金額、類別、付款資料與附件都不會改變。
        </p>
        <p className="mt-2 text-sm leading-6">
          更下層的項目仍會留在原本的直接父項下。
        </p>
        <form
          action={formAction}
          aria-label={`移除群組並保留項目：${name}`}
          aria-busy={isPending}
          className="mt-4 min-w-0 space-y-3"
        >
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <input
            type="hidden"
            name="expectedDirectChildSetHash"
            value={expectedDirectChildSetHash}
          />
          <button
            type="submit"
            disabled={isPending}
            className="min-h-11 max-w-full rounded-full border border-caution px-5 py-2 text-sm font-semibold text-caution transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-70"
          >
            {isPending ? "正在移除群組…" : "確認移除群組並保留項目"}
          </button>
          <ActionFeedback state={state} />
        </form>
      </div>
    </details>
  );
}

export function DeleteBudgetGroupSubtreeDialog({
  workspaceId,
  itemId,
  name,
  expectedVersion,
  expectedSubtreeSnapshotToken,
  descendantCount,
  attachmentCount,
  onSuccess,
  onPendingChange,
}: {
  workspaceId: string;
  itemId: string;
  name: string;
  expectedVersion: number;
  expectedSubtreeSnapshotToken: string;
  descendantCount: number;
  attachmentCount: number;
} & GroupDialogCallbacks) {
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirmationName, setConfirmationName] = useState("");
  const totalCount = descendantCount + 1;
  const normalizedConfirmationName = confirmationName
    .trim()
    .replace(/\s+/gu, " ");
  const normalizedGroupName = name.trim().replace(/\s+/gu, " ");
  const isConfirmed = normalizedConfirmationName === normalizedGroupName;
  const deleteAction = deleteBudgetGroupSubtreeAction.bind(
    null,
    workspaceId,
    itemId,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      const nextState = await deleteAction(previousState, formData);
      if (nextState.status === "success") {
        setConfirmationName("");
        onSuccess?.(
          nextState.message ?? "已永久刪除群組與全部下層項目。",
        );
        dialogRef.current?.close();
      }
      return nextState;
    },
    initialState,
  );

  useEffect(() => {
    onPendingChange?.(isPending);
    return () => onPendingChange?.(false);
  }, [isPending, onPendingChange]);

  function openDialog() {
    if (dialogRef.current?.open) return;
    setConfirmationName("");
    dialogRef.current?.showModal();
    titleRef.current?.focus();
  }

  function closeDialog() {
    if (!isPending) dialogRef.current?.close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`永久刪除群組：${name}`}
        onClick={openDialog}
        className="mt-4 inline-flex min-h-11 w-fit max-w-full items-center justify-center rounded-full border border-red-700 px-4 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
      >
        永久刪除群組與全部下層
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${idPrefix}-title`}
        aria-describedby={`${idPrefix}-warning`}
        onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
        onCancel={(event) => {
          if (isPending) event.preventDefault();
        }}
        onClose={() => restoreConnectedFocus(triggerRef.current)}
        className={dialogClassName}
      >
        <header className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-4 border-b border-red-200 bg-[#fffdf8] px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.14em] text-red-700">
              不可復原
            </p>
            <h2
              ref={titleRef}
              id={`${idPrefix}-title`}
              tabIndex={-1}
              className="mt-1 break-words font-serif text-2xl font-semibold text-stone-900 outline-none"
            >
              永久刪除群組：{name}
            </h2>
          </div>
          <button
            type="button"
            aria-label={`關閉永久刪除群組：${name}`}
            disabled={isPending}
            onClick={closeDialog}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-stone-300 text-2xl leading-none text-stone-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <form
          action={formAction}
          aria-label={`永久刪除群組：${name}`}
          aria-busy={isPending}
          className="min-w-0 space-y-5 px-5 py-6 sm:px-7"
          noValidate
        >
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <input
            type="hidden"
            name="expectedSubtreeSnapshotToken"
            value={expectedSubtreeSnapshotToken}
          />
          <div
            id={`${idPrefix}-warning`}
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm leading-6 text-red-950"
          >
            <p className="font-semibold">
              {`將刪除群組本身與下層 ${descendantCount} 筆，總共 ${totalCount} 筆資料。`}
            </p>
            <p className="mt-2">
              {attachmentCount === 0
                ? "目前沒有附件；群組內的費用、付款與廠商資料仍會一併永久刪除。"
                : `同時會刪除 ${attachmentCount} 個附件；費用、付款、廠商與附件資料均無法復原。`}
            </p>
          </div>
          <p className="text-sm leading-6 text-stone-600">
            如果只想移除整理用的群組外框，請改用「移除群組並保留項目」。
          </p>
          <fieldset
            disabled={isPending}
            className="min-w-0 space-y-5 border-0 p-0"
          >
            <legend className="sr-only">永久刪除確認</legend>
            <div>
              <label
                htmlFor={`${idPrefix}-confirmation-name`}
                className="block font-medium text-stone-800"
              >
                輸入「{name}」確認永久刪除
              </label>
              <input
                id={`${idPrefix}-confirmation-name`}
                name="confirmationName"
                type="text"
                required
                autoComplete="off"
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
                className={fieldClassName}
              />
            </div>
            <ActionFeedback state={state} />
            <div className="flex min-w-0 flex-col-reverse gap-3 border-t border-dashed border-stone-300 pt-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isPending}
                onClick={closeDialog}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-stone-300 px-5 py-2 font-semibold text-stone-700 transition hover:bg-[#f0e2d5] disabled:cursor-wait disabled:opacity-50 sm:w-auto"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isPending || !isConfirmed}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-red-800 bg-red-800 px-5 py-2 font-semibold text-white transition hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {isPending ? "正在永久刪除…" : `永久刪除 ${totalCount} 筆資料`}
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
    </>
  );
}
