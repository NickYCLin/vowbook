import { describe, expect, it } from "vitest";
import {
  budgetCeremonyShortLabel,
  budgetCeremonyStageLabel,
  hiddenBudgetCeremonyStageKeys,
  isBudgetCeremonyStageKey,
} from "./budget-ceremony-stage";

describe("budget ceremony stage identity", () => {
  it("only recognises the two Chinese-ceremony stages", () => {
    expect(isBudgetCeremonyStageKey("STAGE_ENGAGEMENT_CEREMONY")).toBe(true);
    expect(isBudgetCeremonyStageKey("STAGE_WEDDING_PROCESSION")).toBe(true);
    for (const value of [
      "STAGE_WEDDING_DAY",
      "INTERNAL_UNCLASSIFIED_STAGE",
      "",
      null,
      undefined,
      3,
      {},
    ]) {
      expect(isBudgetCeremonyStageKey(value)).toBe(false);
    }
  });

  it("reads the visible label from the single fixed taxonomy definition", () => {
    expect(budgetCeremonyStageLabel("STAGE_WEDDING_PROCESSION")).toBe(
      "迎娶儀式用品、工作人員紅包",
    );
    expect(budgetCeremonyStageLabel("STAGE_ENGAGEMENT_CEREMONY")).toBe(
      "文定儀式用品、工作人員紅包",
    );
    expect(budgetCeremonyShortLabel("STAGE_WEDDING_PROCESSION")).toBe(
      "迎娶儀式",
    );
  });

  it("hides exactly the stages whose ceremony preference is off", () => {
    expect(
      hiddenBudgetCeremonyStageKeys({
        hasEngagementCeremony: false,
        hasProcessionCeremony: false,
      }),
    ).toEqual(
      new Set(["STAGE_ENGAGEMENT_CEREMONY", "STAGE_WEDDING_PROCESSION"]),
    );
    expect(
      hiddenBudgetCeremonyStageKeys({
        hasEngagementCeremony: true,
        hasProcessionCeremony: false,
      }),
    ).toEqual(new Set(["STAGE_WEDDING_PROCESSION"]));
    expect(
      hiddenBudgetCeremonyStageKeys({
        hasEngagementCeremony: true,
        hasProcessionCeremony: true,
      }),
    ).toEqual(new Set());
  });
});
