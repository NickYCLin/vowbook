"use client";

import { useActionState, useId, useRef, useState } from "react";
import {
  addBudgetPreparationSuggestionsAction,
  type BudgetItemMutationState,
} from "@/actions/budget-items";
import { BUDGET_PREPARATION_PRESET_STAGES } from "@/domain/budget-preparation-preset";
import { containDialogFocus } from "@/lib/dialog-focus-containment";

const initialState: BudgetItemMutationState = { status: "idle" };
const emptySuggestionKeys: ReadonlySet<string> = new Set();

const preparationPresetItems = BUDGET_PREPARATION_PRESET_STAGES.flatMap(
  (stage) => stage.groups.flatMap((group) => group.items),
);

function restoreConnectedFocus(trigger: HTMLButtonElement | null) {
  if (trigger?.isConnected && trigger.closest("[hidden]") === null) {
    trigger.focus();
    return;
  }
  document.getElementById("budget-items-heading")?.focus();
}

export function BudgetPreparationPreset({
  workspaceId,
  existingSuggestionKeys,
  coveredSuggestionKeys = emptySuggestionKeys,
  onSuccess,
}: {
  workspaceId: string;
  existingSuggestionKeys: ReadonlySet<string>;
  coveredSuggestionKeys?: ReadonlySet<string>;
  onSuccess?: (message: string) => void;
}) {
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [inputVersion, setInputVersion] = useState(0);
  const isUnavailable = (key: string) =>
    existingSuggestionKeys.has(key) || coveredSuggestionKeys.has(key);
  const availableItems = preparationPresetItems.filter(
    (item) => !isUnavailable(item.key),
  );
  const availableKeys: ReadonlySet<string> = new Set(availableItems.map((item) => item.key));
  const availableSelectedKeys = new Set(
    [...selectedKeys].filter((key) => availableKeys.has(key)),
  );
  const selectedCount = availableSelectedKeys.size;
  const allSuggestionsHandled = availableItems.length === 0;
  const submitLabel =
    selectedCount === 0
      ? "加入選取的常見項目"
      : `加入 ${selectedCount} 個常見項目`;
  const action = addBudgetPreparationSuggestionsAction.bind(null, workspaceId);
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      const submittedKeys = formData
        .getAll("suggestionKey")
        .filter((value): value is string => typeof value === "string");
      const nextState = await action(previousState, formData);
      setShowFeedback(true);
      if (nextState.status === "success") {
        setSelectedKeys(new Set());
        dialogRef.current?.close();
        onSuccess?.(nextState.message ?? "已加入常見婚禮項目。");
      } else if (nextState.status === "error") {
        window.setTimeout(() => {
          setSelectedKeys(
            new Set(submittedKeys.filter((key) => !isUnavailable(key))),
          );
          setInputVersion((current) => current + 1);
        }, 0);
      }
      return nextState;
    },
    initialState,
  );

  if (allSuggestionsHandled) return null;

  function openDialog() {
    if (dialogRef.current?.open) return;
    setShowFeedback(false);
    dialogRef.current?.showModal();
    dialogTitleRef.current?.focus();
  }

  function closeDialog() {
    if (!isPending) dialogRef.current?.close();
  }

  function setSuggestionSelected(key: string, selected: boolean) {
    if (isUnavailable(key) || isPending) return;
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((value) => availableKeys.has(value)));
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function selectAllAvailable() {
    if (isPending) return;
    setSelectedKeys(new Set(availableKeys));
  }

  function clearSelection() {
    if (isPending) return;
    setSelectedKeys(new Set());
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        className="inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full border border-[#789584] bg-[#f4faf5] px-4 py-2 text-sm font-semibold text-[#405448] transition hover:bg-[#e8f2e9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#567260] focus-visible:ring-offset-2 sm:w-fit"
      >
        補齊常見婚禮項目
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`${idPrefix}-title`}
        aria-describedby={`${idPrefix}-description`}
        onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
        onCancel={(event) => {
          if (isPending) event.preventDefault();
        }}
        onClose={() => restoreConnectedFocus(triggerRef.current)}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-stone-300 bg-[#fffdf8] p-0 text-left text-stone-900 shadow-[0_12px_32px_rgba(69,49,38,0.16)] backdrop:bg-stone-950/35 backdrop:backdrop-blur-[1px]"
      >
        <header className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-4 border-b border-stone-200 bg-[#fffdf8] px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.14em] text-[#567260]">
              常見籌備清單
            </p>
            <h2
              id={`${idPrefix}-title`}
              ref={dialogTitleRef}
              tabIndex={-1}
              className="mt-1 break-words font-serif text-2xl font-semibold text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#567260]"
            >
              補齊常見婚禮項目
            </h2>
          </div>
          <button
            type="button"
            aria-label="關閉常見婚禮項目"
            disabled={isPending}
            onClick={closeDialog}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-stone-300 text-2xl leading-none text-stone-600 transition hover:bg-[#edf3ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#567260] disabled:cursor-wait disabled:opacity-50"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <form action={formAction} className="min-w-0 px-5 py-6 sm:px-7">
          <p
            id={`${idPrefix}-description`}
            className="text-sm leading-6 text-stone-600"
          >
            依 Drive 籌備階段列出常見項目；只會加入勾選內容，加入後會標示為待準備，之後可再編輯。
          </p>

          <div className="mt-5 flex min-w-0 flex-col gap-2 rounded-xl border border-[#cbd8ce] bg-[#f4faf5] p-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className="text-sm font-semibold text-[#405448]">
              已選 {selectedCount} 個項目
            </p>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={isPending || selectedCount === availableItems.length}
                onClick={selectAllAvailable}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#789584] bg-white px-4 py-2 text-sm font-semibold text-[#405448] transition hover:bg-[#e8f2e9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#567260] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                全選可加入項目
              </button>
              <button
                type="button"
                disabled={isPending || selectedCount === 0}
                onClick={clearSelection}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#567260] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                清除選取
              </button>
            </div>
          </div>

          <fieldset
            disabled={isPending}
            aria-busy={isPending}
            className="mt-5 min-w-0 space-y-6 border-0 p-0"
          >
            <legend className="sr-only">常見婚禮項目</legend>
            {BUDGET_PREPARATION_PRESET_STAGES.map((stage) => {
              const stageTitleId = `${idPrefix}-${stage.stageKey}-title`;
              return (
                <section
                  key={stage.stageKey}
                  role="group"
                  aria-labelledby={stageTitleId}
                  className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5"
                >
                  <h3
                    id={stageTitleId}
                    className="break-words font-serif text-xl font-semibold text-stone-900"
                  >
                    {stage.label}
                  </h3>
                  <div className="mt-4 min-w-0 space-y-5">
                    {stage.groups.map((group) => (
                      <fieldset
                        key={group.taxonomyItemKey}
                        className="min-w-0 border-0 p-0"
                      >
                        <legend className="px-0 text-sm font-semibold tracking-[0.06em] text-[#765541]">
                          {group.label}
                        </legend>
                        <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                          {group.items.map((item) => {
                            const exists = existingSuggestionKeys.has(item.key);
                            const covered =
                              !exists && coveredSuggestionKeys.has(item.key);
                            const unavailable = exists || covered;
                            return (
                              <label
                                key={item.key}
                                className={[
                                  "flex min-h-11 min-w-0 items-start gap-3 rounded-xl border px-3 py-3 text-sm",
                                  unavailable
                                    ? "border-stone-200 bg-stone-100 text-stone-500"
                                    : "cursor-pointer border-stone-300 bg-white text-stone-800 hover:border-[#9bb1a2] hover:bg-[#f4faf5]",
                                ].join(" ")}
                              >
                                <input
                                  key={item.key + ":" + inputVersion}
                                  type="checkbox"
                                  name="suggestionKey"
                                  value={item.key}
                                  checked={
                                    !unavailable &&
                                    availableSelectedKeys.has(item.key)
                                  }
                                  disabled={unavailable}
                                  onChange={(event) =>
                                    setSuggestionSelected(
                                      item.key,
                                      event.target.checked,
                                    )
                                  }
                                  className="mt-0.5 shrink-0"
                                />
                                <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                                  <span className="font-semibold">
                                    {item.name}
                                  </span>
                                  {item.notes ? (
                                    <span className="mt-1 block text-xs leading-5 text-stone-500">
                                      {item.notes}
                                    </span>
                                  ) : null}
                                  {exists ? (
                                    <span className="mt-1 block text-xs font-semibold text-[#567260]">
                                      已加入
                                    </span>
                                  ) : covered ? (
                                    <span className="mt-1 block text-xs font-semibold text-[#567260]">
                                      已有相關紀錄
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}
                  </div>
                </section>
              );
            })}
          </fieldset>

          {showFeedback && state.status === "error" ? (
            <p
              role="alert"
              className="mt-4 break-words border-l-2 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              {state.message}
            </p>
          ) : null}

          <div className="mt-6 flex min-w-0 flex-col-reverse gap-3 border-t border-dashed border-stone-300 pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              aria-label="取消補齊常見項目"
              disabled={isPending}
              onClick={closeDialog}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-stone-300 px-5 py-2 font-semibold text-stone-700 transition hover:bg-[#edf3ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#567260] disabled:cursor-wait disabled:opacity-50 sm:w-auto"
            >
              取消
            </button>
            <button
              type="submit"
              aria-label={isPending ? "加入中…" : submitLabel}
              disabled={isPending || selectedCount === 0}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#405448] bg-[#405448] px-5 py-2 font-semibold text-white transition hover:bg-[#304238] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#567260] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isPending ? "加入中…" : submitLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
