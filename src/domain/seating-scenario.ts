import type { GuestAttendanceStatusValue } from "@/domain/guest";

/**
 * 座位方案的規則。正式安排只有一份；方案是沙盒，在裡面「有入座」就代表
 * 這個方案假設他會來。方案永遠不會改到賓客的出席回覆——套用時以實際回覆為準。
 */

export const MAX_SEATING_SCENARIO_DRAFTS = 5;
/** 套用前自動備份只留最近幾份，不然分頁會越堆越多。 */
export const MAX_SEATING_SCENARIO_BACKUPS = 3;

export class SeatingScenarioValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeatingScenarioValidationError";
  }
}

export function normalizeSeatingScenarioName(value: unknown): string {
  if (typeof value !== "string") {
    throw new SeatingScenarioValidationError("請輸入方案名稱。");
  }
  const name = value.trim();
  if ([...name].length < 1 || [...name].length > 40) {
    throw new SeatingScenarioValidationError("方案名稱請輸入 1 到 40 個字。");
  }
  return name;
}

export type SeatingScenarioGuest = {
  id: string;
  name: string;
  partySize: number;
  attendanceStatus: GuestAttendanceStatusValue;
};

export type SeatingArrangementTable = {
  rank: number;
  name: string;
  capacity: number;
};

/**
 * rank 是桌子排序後的第幾桌（1 起算），桌卡上的號碼由它推導（會跳過含 4 與 13 的號碼）。
 * 兩份安排之間只能用 rank 比：內部 id 不同，position 只是排序鍵、中間可能有空號，
 * 草稿刪掉中間一桌時後面的人 position 不變，但桌卡號碼會變——對賓客來說就是換桌。
 */
export type SeatingArrangement = {
  tables: SeatingArrangementTable[];
  seats: Record<string, number>;
};

type GuestMove = { guestId: string; name: string; from: number; to: number };
type GuestSeat = { guestId: string; name: string; to: number };
type GuestUnseat = { guestId: string; name: string; from: number };

export type SeatingScenarioApplyPreview = {
  moved: GuestMove[];
  newlySeated: GuestSeat[];
  unseated: GuestUnseat[];
  /** 方案裡有座位、但實際回覆是不出席：套用後不會入座。 */
  willNotSeat: GuestSeat[];
  addedTableCount: number;
  removedTableCount: number;
  changedTables: Array<{
    rank: number;
    before: { name: string; capacity: number };
    after: { name: string; capacity: number };
  }>;
  overCapacity: Array<{ rank: number; name: string; capacity: number; seated: number }>;
  /** 實際會寫進正式安排的座位（已扣掉不出席與不存在的賓客）。 */
  effectiveSeats: Record<string, number>;
  canApply: boolean;
};

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, "zh-Hant");

export function previewSeatingScenarioApply(input: {
  live: SeatingArrangement;
  scenario: SeatingArrangement;
  guests: SeatingScenarioGuest[];
}): SeatingScenarioApplyPreview {
  const guestById = new Map(input.guests.map((guest) => [guest.id, guest]));
  const scenarioRanks = new Set(input.scenario.tables.map((table) => table.rank));

  const effectiveSeats: Record<string, number> = {};
  const willNotSeat: GuestSeat[] = [];
  for (const [guestId, rank] of Object.entries(input.scenario.seats)) {
    const guest = guestById.get(guestId);
    // 已被刪除的賓客，或指向不存在桌號的座位，都不會被寫回。
    if (!guest || !scenarioRanks.has(rank)) continue;
    if (guest.attendanceStatus === "DECLINED") {
      willNotSeat.push({ guestId, name: guest.name, to: rank });
      continue;
    }
    effectiveSeats[guestId] = rank;
  }

  const moved: GuestMove[] = [];
  const newlySeated: GuestSeat[] = [];
  for (const [guestId, to] of Object.entries(effectiveSeats)) {
    const guest = guestById.get(guestId)!;
    const from = input.live.seats[guestId];
    if (from === undefined) newlySeated.push({ guestId, name: guest.name, to });
    else if (from !== to) moved.push({ guestId, name: guest.name, from, to });
  }

  const unseated: GuestUnseat[] = [];
  for (const [guestId, from] of Object.entries(input.live.seats)) {
    const guest = guestById.get(guestId);
    if (!guest || effectiveSeats[guestId] !== undefined) continue;
    // 不出席者本來就會被移出，列在 willNotSeat 或原本就不該坐，不算「被方案移出」。
    if (guest.attendanceStatus === "DECLINED") continue;
    unseated.push({ guestId, name: guest.name, from });
  }

  const liveByRank = new Map(input.live.tables.map((table) => [table.rank, table]));
  const changedTables = input.scenario.tables
    .filter((table) => {
      const before = liveByRank.get(table.rank);
      return before !== undefined && (before.name !== table.name || before.capacity !== table.capacity);
    })
    .map((table) => {
      const before = liveByRank.get(table.rank)!;
      return {
        rank: table.rank,
        before: { name: before.name, capacity: before.capacity },
        after: { name: table.name, capacity: table.capacity },
      };
    })
    .sort((left, right) => left.rank - right.rank);

  const seatedByRank = new Map<number, number>();
  for (const [guestId, rank] of Object.entries(effectiveSeats)) {
    const size = guestById.get(guestId)!.partySize;
    seatedByRank.set(rank, (seatedByRank.get(rank) ?? 0) + size);
  }
  const overCapacity = input.scenario.tables
    .map((table) => ({
      rank: table.rank,
      name: table.name,
      capacity: table.capacity,
      seated: seatedByRank.get(table.rank) ?? 0,
    }))
    .filter((table) => table.seated > table.capacity)
    .sort((left, right) => left.rank - right.rank);

  const liveRanks = new Set(input.live.tables.map((table) => table.rank));
  return {
    moved: moved.sort(byName),
    newlySeated: newlySeated.sort(byName),
    unseated: unseated.sort(byName),
    willNotSeat: willNotSeat.sort(byName),
    addedTableCount: input.scenario.tables.filter((table) => !liveRanks.has(table.rank)).length,
    removedTableCount: input.live.tables.filter((table) => !scenarioRanks.has(table.rank)).length,
    changedTables,
    overCapacity,
    effectiveSeats,
    canApply: overCapacity.length === 0,
  };
}

export type SeatingScenarioAssumption = {
  guestId: string;
  name: string;
  attendanceStatus: GuestAttendanceStatusValue;
  to: number;
};

/** 方案裡有座位、但實際回覆還不是出席的人：這就是這個方案的假設。 */
export function scenarioAssumptions(
  seats: Record<string, number>,
  guests: SeatingScenarioGuest[],
): SeatingScenarioAssumption[] {
  const guestById = new Map(guests.map((guest) => [guest.id, guest]));
  return Object.entries(seats)
    .flatMap(([guestId, to]) => {
      const guest = guestById.get(guestId);
      if (!guest || guest.attendanceStatus === "ATTENDING") return [];
      return [{ guestId, name: guest.name, attendanceStatus: guest.attendanceStatus, to }];
    })
    .sort(byName);
}
