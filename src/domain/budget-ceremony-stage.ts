import { BUDGET_TAXONOMY_STAGES } from "@/domain/budget-item";

/**
 * 文定與迎娶是中式傳統儀式才會用到的籌備階段。沒有這些儀式的婚禮不該在
 * 花費頁看到整段用不到的分類，所以兩者都由 workspace 的儀式設定決定顯示。
 */
export const BUDGET_CEREMONY_STAGE_PREFERENCES = [
  {
    stageKey: "STAGE_ENGAGEMENT_CEREMONY",
    preference: "hasEngagementCeremony",
    shortLabel: "文定儀式",
  },
  {
    stageKey: "STAGE_WEDDING_PROCESSION",
    preference: "hasProcessionCeremony",
    shortLabel: "迎娶儀式",
  },
] as const;

export type BudgetCeremonyStageKey =
  (typeof BUDGET_CEREMONY_STAGE_PREFERENCES)[number]["stageKey"];

export type BudgetCeremonyPreferenceFlags = {
  hasEngagementCeremony: boolean;
  hasProcessionCeremony: boolean;
};

export function isBudgetCeremonyStageKey(
  value: unknown,
): value is BudgetCeremonyStageKey {
  return BUDGET_CEREMONY_STAGE_PREFERENCES.some(
    (entry) => entry.stageKey === value,
  );
}

export function budgetCeremonyStageLabel(
  stageKey: BudgetCeremonyStageKey,
): string {
  const stage = BUDGET_TAXONOMY_STAGES.find(
    (candidate) => candidate.key === stageKey,
  );
  if (!stage) {
    throw new Error(`Unknown budget ceremony stage key: ${stageKey}`);
  }
  return stage.label;
}

export function budgetCeremonyShortLabel(
  stageKey: BudgetCeremonyStageKey,
): string {
  const entry = BUDGET_CEREMONY_STAGE_PREFERENCES.find(
    (candidate) => candidate.stageKey === stageKey,
  );
  if (!entry) {
    throw new Error(`Unknown budget ceremony stage key: ${stageKey}`);
  }
  return entry.shortLabel;
}

/** 儀式設定關閉的階段就是要隱藏的階段；設定開啟時一律照常顯示。 */
export function hiddenBudgetCeremonyStageKeys(
  preferences: BudgetCeremonyPreferenceFlags,
): Set<BudgetCeremonyStageKey> {
  return new Set(
    BUDGET_CEREMONY_STAGE_PREFERENCES.filter(
      (entry) => !preferences[entry.preference],
    ).map((entry) => entry.stageKey),
  );
}
