import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ plan: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/seating-plan", () => ({ loadSeatingPlanForUser: mocks.plan }));

import { mobileSeatingPlan } from "./workspace-data";

function table(id: string, position: number, layout: { x: number; y: number } | null) {
  return {
    id,
    position,
    version: 0,
    name: null,
    number: position,
    capacity: 10,
    notes: null,
    layoutX: layout?.x ?? null,
    layoutY: layout?.y ?? null,
    guests: [],
  };
}

describe("手機桌圖座標", () => {
  beforeEach(() => vi.clearAllMocks());

  it("把桌次的座標換算成畫布百分比送給 App", async () => {
    mocks.plan.mockResolvedValue({
      role: "OWNER",
      tables: [table("table_1", 1, { x: 500, y: 220 })],
      unassignedGuests: [],
    });

    const result = await mobileSeatingPlan("workspace_1", "user_1");

    // 主桌座標 (500, 220) 在畫布上落在正中央偏上。
    expect(result.tables[0].chart).toEqual({
      x: expect.closeTo(50, 2),
      y: expect.closeTo(26.92, 2),
    });
  });

  it("沒存過座標的桌次也會拿到自動排出來的位置", async () => {
    mocks.plan.mockResolvedValue({
      role: "OWNER",
      tables: [table("table_1", 1, null), table("table_2", 2, null)],
      unassignedGuests: [],
    });

    const result = await mobileSeatingPlan("workspace_1", "user_1");

    expect(result.tables).toHaveLength(2);
    for (const item of result.tables) {
      expect(item.chart).not.toBeNull();
      expect(item.chart!.x).toBeGreaterThan(0);
      expect(item.chart!.y).toBeGreaterThan(0);
    }
    expect(result.tables[0].chart).not.toEqual(result.tables[1].chart);
  });

  it("座標排不出來的時候就不給桌圖，不讓整頁掛掉", async () => {
    mocks.plan.mockResolvedValue({
      role: "OWNER",
      tables: [table("table_1", 1, { x: 9999, y: 9999 })],
      unassignedGuests: [],
    });

    const result = await mobileSeatingPlan("workspace_1", "user_1");

    expect(result.tables[0].chart).toBeNull();
  });
});
