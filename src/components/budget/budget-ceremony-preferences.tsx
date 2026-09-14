"use client";

import { useActionState, useState } from "react";
import {
  updateWeddingPlanningPreferencesAction,
  type WeddingPlanningPreferences,
  type WeddingPlanningPreferencesMutationState,
} from "@/actions/wedding-planning-preferences";

const initialState: WeddingPlanningPreferencesMutationState = {
  status: "idle",
};

export function BudgetCeremonyPreferences({
  workspaceId,
  preferences,
  onChange,
}: {
  workspaceId: string;
  preferences: WeddingPlanningPreferences;
  onChange?: (preferences: WeddingPlanningPreferences) => void;
}) {
  const latestPreferences = preferences;
  const [snapshot, setSnapshot] = useState(() => latestPreferences);
  const [draft, setDraft] = useState(() => ({
    hasEngagementCeremony: snapshot.hasEngagementCeremony,
    hasProcessionCeremony: snapshot.hasProcessionCeremony,
  }));
  const snapshotIsOutdated =
    latestPreferences.version > snapshot.version ||
    (latestPreferences.version === snapshot.version &&
      (latestPreferences.hasEngagementCeremony !==
        snapshot.hasEngagementCeremony ||
        latestPreferences.hasProcessionCeremony !==
          snapshot.hasProcessionCeremony));
  const action = updateWeddingPlanningPreferencesAction.bind(
    null,
    workspaceId,
  );
  const [state, formAction, pending] = useActionState(
    async (
      previousState: WeddingPlanningPreferencesMutationState,
      formData: FormData,
    ) => {
      const nextState = await action(previousState, formData);
      if (nextState.status === "success" && nextState.preferences) {
        setSnapshot(nextState.preferences);
        setDraft({
          hasEngagementCeremony:
            nextState.preferences.hasEngagementCeremony,
          hasProcessionCeremony:
            nextState.preferences.hasProcessionCeremony,
        });
        onChange?.(nextState.preferences);
      }
      return nextState;
    },
    initialState,
  );

  return (
    <details className="group min-w-0 rounded-control border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 py-2 text-sm font-semibold text-ink-soft outline-none transition hover:bg-clay-soft focus-visible:ring-2 focus-visible:ring-clay [&::-webkit-details-marker]:hidden">
        中式儀式設定（選用）
      </summary>
      <form action={formAction} className="min-w-0 space-y-4 border-t border-line px-4 py-4">
        <input
          type="hidden"
          name="expectedVersion"
          value={snapshot.version}
        />
        <p className="max-w-xl text-caption leading-6 text-ink-soft">
          只有實際舉辦的中式儀式才需要勾選。西式證婚不等於迎娶，也不會開啟迎娶用品建議。
        </p>
        {snapshotIsOutdated ? (
          <div className="rounded-control border border-caution/30 bg-caution-soft px-3 py-3 text-caption leading-6 text-caution">
            <p>協作者已更新這項設定，目前仍保留你的草稿與原本版本。</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setSnapshot(latestPreferences);
                setDraft({
                  hasEngagementCeremony:
                    latestPreferences.hasEngagementCeremony,
                  hasProcessionCeremony:
                    latestPreferences.hasProcessionCeremony,
                });
              }}
              className="mt-2 inline-flex min-h-11 items-center rounded-control border border-caution/40 px-3 font-semibold transition hover:bg-caution/10"
            >
              載入最新設定
            </button>
          </div>
        ) : null}
        <fieldset
          disabled={pending}
          aria-busy={pending}
          className="min-w-0 space-y-2 border-0 p-0"
        >
          <legend className="sr-only">選擇實際舉辦的中式儀式</legend>
          <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              name="hasEngagementCeremony"
              checked={draft.hasEngagementCeremony}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  hasEngagementCeremony: event.target.checked,
                }))
              }
            />
            有文定儀式
          </label>
          <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              name="hasProcessionCeremony"
              checked={draft.hasProcessionCeremony}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  hasProcessionCeremony: event.target.checked,
                }))
              }
            />
            有迎娶儀式
          </label>
        </fieldset>
        {state.status !== "idle" ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={
              state.status === "error"
                ? "text-caption leading-6 text-danger"
                : "text-caption leading-6 text-sage"
            }
          >
            {state.message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending || snapshotIsOutdated}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-clay bg-surface px-4 py-2 text-sm font-semibold text-clay-strong transition hover:bg-clay-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        >
          {pending ? "儲存中…" : "儲存中式儀式設定"}
        </button>
      </form>
    </details>
  );
}
