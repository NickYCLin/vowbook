"use client";

import { useActionState, useId, useRef, useState } from "react";
import {
  addBudgetEngagementSuggestionsAction,
  type BudgetItemMutationState,
} from "@/actions/budget-items";
import { BUDGET_ENGAGEMENT_PRESET_GROUPS } from "@/domain/budget-engagement-preset";
import { containDialogFocus } from "@/lib/dialog-focus-containment";

const initialState: BudgetItemMutationState = { status: "idle" };

const engagementPresetItems = BUDGET_ENGAGEMENT_PRESET_GROUPS.flatMap(
  (group) => group.items,
);

function restoreConnectedFocus(trigger: HTMLButtonElement | null) {
  if (trigger?.isConnected && trigger.closest("[hidden]") === null) {
    trigger.focus();
    return;
  }
  document.getElementById("budget-items-heading")?.focus();
}

export function BudgetEngagementPreset({
  workspaceId,
  existingSuggestionKeys,
  onSuccess,
}: {
  workspaceId: string;
  existingSuggestionKeys: ReadonlySet<string>;
  onSuccess?: (message: string) => void;
}) {
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [inputVersion, setInputVersion] = useState(0);
  const availableSelectedKeys = new Set(
    [...selectedKeys].filter((key) => !existingSuggestionKeys.has(key)),
  );
  const existingPresetCount = engagementPresetItems.reduce(
    (count, item) => count + (existingSuggestionKeys.has(item.key) ? 1 : 0),
    0,
  );
  const allSuggestionsExist =
    existingPresetCount === engagementPresetItems.length;
  const triggerLabel =
    existingPresetCount === 0
      ? "加入文定儀式項目"
      : "加入更多文定項目";
  const selectedCount = availableSelectedKeys.size;
  const submitLabel =
    selectedCount === 0
      ? "加入選取的文定品項"
      : `加入 ${selectedCount} 個文定品項`;
  const action = addBudgetEngagementSuggestionsAction.bind(null, workspaceId);
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
        onSuccess?.(nextState.message ?? "已加入文定品項。");
      } else if (nextState.status === "error") {
        window.setTimeout(() => {
          setSelectedKeys(
            new Set(
              submittedKeys.filter(
                (key) => !existingSuggestionKeys.has(key),
              ),
            ),
          );
          setInputVersion((current) => current + 1);
        }, 0);
      }
      return nextState;
    },
    initialState,
  );

  if (allSuggestionsExist) return null;

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
    if (existingSuggestionKeys.has(key) || isPending) return;
    setSelectedKeys((current) => {
      const next = new Set(
        [...current].filter(
          (currentKey) => !existingSuggestionKeys.has(currentKey),
        ),
      );
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        className="inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full border border-[#b99a79] bg-[#fffaf2] px-4 py-2 text-sm font-semibold text-[#68432d] transition hover:bg-[#f0e2d5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#765541] focus-visible:ring-offset-2 sm:w-fit"
      >
        {triggerLabel}
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
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-stone-300 bg-[#fffdf8] p-0 text-left text-stone-900 shadow-[0_12px_32px_rgba(69,49,38,0.16)] backdrop:bg-stone-950/35 backdrop:backdrop-blur-[1px]"
      >
        <header className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-4 border-b border-stone-200 bg-[#fffdf8] px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.14em] text-[#765541]">
              選用建議
            </p>
            <h2
              id={`${idPrefix}-title`}
              ref={dialogTitleRef}
              tabIndex={-1}
              className="mt-1 break-words font-serif text-2xl font-semibold text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#765541]"
            >
              加入文定建議品項
            </h2>
          </div>
          <button
            type="button"
            aria-label="關閉加入文定品項"
            disabled={isPending}
            onClick={closeDialog}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-stone-300 text-2xl leading-none text-stone-600 transition hover:bg-[#f0e2d5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#765541] disabled:cursor-wait disabled:opacity-50"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <form action={formAction} className="min-w-0 px-5 py-6 sm:px-7">
          <p
            id={`${idPrefix}-description`}
            className="text-sm leading-6 text-stone-600"
          >
            只會加入勾選的品項；加入後金額為 NT$0、狀態為規劃中，之後可再編輯。
          </p>

          <fieldset
            disabled={isPending}
            aria-busy={isPending}
            className="mt-5 min-w-0 space-y-5 border-0 p-0"
          >
            <legend className="sr-only">建議品項</legend>
            {BUDGET_ENGAGEMENT_PRESET_GROUPS.map((group) => (
              <fieldset
                key={group.taxonomyItemKey}
                className="min-w-0 border-y border-stone-200 py-4"
              >
                <legend className="px-2 font-serif text-lg font-semibold text-stone-900">
                  {group.label}
                </legend>
                <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                  {group.items.map((item) => {
                    const exists = existingSuggestionKeys.has(item.key);
                    return (
                      <label
                        key={item.key}
                        className={[
                          "flex min-h-11 min-w-0 items-start gap-3 rounded-xl border px-3 py-3 text-sm",
                          exists
                            ? "border-stone-200 bg-stone-100 text-stone-500"
                            : "cursor-pointer border-stone-300 bg-white text-stone-800 hover:border-[#b99a79] hover:bg-[#fffaf2]",
                        ].join(" ")}
                      >
                        <input
                          key={item.key + ":" + inputVersion}
                          type="checkbox"
                          name="suggestionKey"
                          value={item.key}
                          checked={
                            !exists && availableSelectedKeys.has(item.key)
                          }
                          disabled={exists}
                          onChange={(event) =>
                            setSuggestionSelected(item.key, event.target.checked)
                          }
                          className="mt-0.5 shrink-0"
                        />
                        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                          <span className="font-semibold">{item.name}</span>
                          {item.notes ? (
                            <span className="mt-1 block text-xs leading-5 text-stone-500">
                              {item.notes}
                            </span>
                          ) : null}
                          {exists ? (
                            <span className="mt-1 block text-xs font-semibold text-[#765541]">
                              已加入
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </fieldset>

          <p role="status" className="mt-4 text-sm font-medium text-stone-700">
            已選 {selectedCount} 個品項
          </p>
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
              aria-label="取消加入文定品項"
              disabled={isPending}
              onClick={closeDialog}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-stone-300 px-5 py-2 font-semibold text-stone-700 transition hover:bg-[#f0e2d5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#765541] disabled:cursor-wait disabled:opacity-50 sm:w-auto"
            >
              取消
            </button>
            <button
              type="submit"
              aria-label={isPending ? "加入中…" : submitLabel}
              disabled={isPending || selectedCount === 0}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#744c32] bg-[#744c32] px-5 py-2 font-semibold text-white transition hover:bg-[#5f3d29] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#765541] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isPending ? "加入中…" : submitLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
