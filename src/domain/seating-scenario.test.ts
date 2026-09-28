import { describe, expect, it } from "vitest";
import {
  normalizeSeatingScenarioName,
  previewSeatingScenarioApply,
  scenarioAssumptions,
  SeatingScenarioValidationError,
  type SeatingArrangement,
  type SeatingScenarioGuest,
} from "./seating-scenario";

const guest = (
  id: string,
  attendanceStatus: SeatingScenarioGuest["attendanceStatus"],
  partySize = 2,
): SeatingScenarioGuest => ({ id, name: `賓客${id}`, partySize, attendanceStatus });

const table = (rank: number, capacity = 10, name = `第${rank}桌`) => ({
  rank,
  name,
  capacity,
});

describe("座位方案名稱", () => {
  it("去除前後空白並限制在 1 到 40 字", () => {
    expect(normalizeSeatingScenarioName("  王家全到  ")).toBe("王家全到");
    expect(() => normalizeSeatingScenarioName("   ")).toThrow(SeatingScenarioValidationError);
    expect(() => normalizeSeatingScenarioName("字".repeat(41))).toThrow(SeatingScenarioValidationError);
    expect(() => normalizeSeatingScenarioName(42)).toThrow(SeatingScenarioValidationError);
  });
});

describe("套用方案前的差異", () => {
  const guests = [
    guest("a", "ATTENDING"),
    guest("b", "ATTENDING"),
    guest("c", "UNDECIDED"),
    guest("d", "DECLINED"),
    guest("e", "ATTENDING"),
  ];
  const live: SeatingArrangement = {
    tables: [table(1), table(2)],
    seats: { a: 1, b: 2, e: 2 },
  };

  it("以第幾桌比對換桌、新入座與移出，不看桌子的內部 id", () => {
    const scenario: SeatingArrangement = {
      tables: [table(1), table(2), table(3)],
      seats: { a: 1, b: 3, c: 2 },
    };
    const preview = previewSeatingScenarioApply({ live, scenario, guests });
    expect(preview.moved).toEqual([{ guestId: "b", name: "賓客b", from: 2, to: 3 }]);
    expect(preview.newlySeated).toEqual([{ guestId: "c", name: "賓客c", to: 2 }]);
    expect(preview.unseated).toEqual([{ guestId: "e", name: "賓客e", from: 2 }]);
    expect(preview.addedTableCount).toBe(1);
    expect(preview.removedTableCount).toBe(0);
    expect(preview.canApply).toBe(true);
  });

  it("方案裡坐了但實際回覆是不出席的人不會入座，以真實回覆為準", () => {
    const scenario: SeatingArrangement = { tables: [table(1), table(2)], seats: { a: 1, b: 2, d: 2, e: 2 } };
    const preview = previewSeatingScenarioApply({ live, scenario, guests });
    expect(preview.willNotSeat).toEqual([{ guestId: "d", name: "賓客d", to: 2 }]);
    expect(preview.newlySeated).toEqual([]);
    expect(preview.effectiveSeats).toEqual({ a: 1, b: 2, e: 2 });
  });

  it("超過座位時不能套用，而且以扣掉不出席者之後的人數判斷", () => {
    const crowded: SeatingArrangement = {
      tables: [table(1, 4), table(2)],
      seats: { a: 1, b: 1, d: 1 },
    };
    const withDeclined = previewSeatingScenarioApply({ live, scenario: crowded, guests });
    // a、b 各 2 位剛好 4 位；d 不出席不算，所以沒有超過。
    expect(withDeclined.overCapacity).toEqual([]);
    expect(withDeclined.canApply).toBe(true);

    const over: SeatingArrangement = { tables: [table(1, 4), table(2)], seats: { a: 1, b: 1, e: 1 } };
    const preview = previewSeatingScenarioApply({ live, scenario: over, guests });
    expect(preview.overCapacity).toEqual([{ rank: 1, name: "第1桌", capacity: 4, seated: 6 }]);
    expect(preview.canApply).toBe(false);
  });

  it("記下桌名或容量改變，以及少開的桌數", () => {
    const scenario: SeatingArrangement = { tables: [table(1, 12, "主桌")], seats: { a: 1, b: 1, e: 1 } };
    const preview = previewSeatingScenarioApply({ live, scenario, guests });
    expect(preview.removedTableCount).toBe(1);
    expect(preview.changedTables).toEqual([
      { rank: 1, before: { name: "第1桌", capacity: 10 }, after: { name: "主桌", capacity: 12 } },
    ]);
  });

  it("忽略已經不在名單上的賓客", () => {
    const scenario: SeatingArrangement = { tables: [table(1), table(2)], seats: { a: 1, ghost: 2 } };
    const preview = previewSeatingScenarioApply({ live, scenario, guests });
    expect(preview.effectiveSeats).toEqual({ a: 1 });
  });
});

describe("方案的假設", () => {
  it("列出座位和實際回覆對不上的人", () => {
    const guests = [guest("a", "ATTENDING"), guest("c", "UNDECIDED"), guest("d", "DECLINED")];
    expect(scenarioAssumptions({ a: 1, c: 2, d: 3 }, guests)).toEqual([
      { guestId: "c", name: "賓客c", attendanceStatus: "UNDECIDED", to: 2 },
      { guestId: "d", name: "賓客d", attendanceStatus: "DECLINED", to: 3 },
    ]);
  });
});
