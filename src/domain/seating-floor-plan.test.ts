import { describe, expect, it } from "vitest";
import {
  SeatingFloorPlanLayoutConflictError,
  SEATING_FLOOR_PLAN_MARKER_GAP_PX,
  clampSeatingFloorPlanCoordinateToSafeBounds,
  getSeatingFloorPlanContentBounds,
  getSeatingFloorPlanSafeCoordinateBounds,
  getSeatingFloorPlanMetrics,
  isSeatingFloorPlanCoordinateWithinSafeBounds,
  resolveSeatingFloorPlanPositions,
  seatingFloorPlanBoardPointToCoordinate,
  seatingFloorPlanCoordinateToBoardPoint,
  seatingFloorPlanMarkerCentersCollide,
  snapSeatingFloorPlanCoordinate,
  type SeatingFloorPlanPositionInput,
} from "./seating-floor-plan";

const legacyTable = (
  id: string,
  position: number,
  name: string,
  layoutX: number | null = null,
  layoutY: number | null = null,
) => ({ id, position, name, layoutX, layoutY });

function automaticTables(tableCount: number) {
  return Array.from({ length: tableCount }, (_, index) =>
    legacyTable(
      `table_${index}`,
      index + 1,
      index === 0 ? "主桌" : `婚宴桌 ${index + 1}`,
    ),
  );
}

function expectValidResolvedLayout(
  tables: SeatingFloorPlanPositionInput[],
) {
  const metrics = getSeatingFloorPlanMetrics(tables.length);
  const board = getSeatingFloorPlanContentBounds(metrics);
  const resolved = resolveSeatingFloorPlanPositions(tables);
  const centers = resolved.map((position) =>
    seatingFloorPlanCoordinateToBoardPoint(position, board),
  );

  for (const position of resolved) {
    expect(
      isSeatingFloorPlanCoordinateWithinSafeBounds(position, metrics),
      `${tables.length} tables: ${position.tableId} at ${position.x},${position.y}`,
    ).toBe(true);
  }
  for (let leftIndex = 0; leftIndex < centers.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < centers.length;
      rightIndex += 1
    ) {
      expect(
        Math.hypot(
          centers[leftIndex].x - centers[rightIndex].x,
          centers[leftIndex].y - centers[rightIndex].y,
        ),
      ).toBeGreaterThanOrEqual(
        metrics.markerSizePx + SEATING_FLOOR_PLAN_MARKER_GAP_PX,
      );
    }
  }

  return resolved;
}

describe("seating floor-plan layout", () => {
  it("uses canonical board metrics that keep every persisted endpoint safe from 1 through 200 tables", () => {
    for (let tableCount = 1; tableCount <= 200; tableCount += 1) {
      const metrics = getSeatingFloorPlanMetrics(tableCount);

      expect(getSeatingFloorPlanSafeCoordinateBounds(metrics)).toEqual({
        minX: 0,
        maxX: 1000,
        minY: 0,
        maxY: 1000,
      });
      expect(
        isSeatingFloorPlanCoordinateWithinSafeBounds({ x: 0, y: 0 }, metrics),
      ).toBe(true);
      expect(
        isSeatingFloorPlanCoordinateWithinSafeBounds(
          { x: 1000, y: 1000 },
          metrics,
        ),
      ).toBe(true);
    }

    expect(
      clampSeatingFloorPlanCoordinateToSafeBounds(
        { x: -100, y: 1100 },
        getSeatingFloorPlanMetrics(15),
      ),
    ).toEqual({ x: 0, y: 1000 });
  });

  it("keeps persisted 0,0 and 1000,1000 fully valid across the 16 to 15 density transition", () => {
    const atSixteen = automaticTables(16).map((table, index) =>
      index === 0
        ? { ...table, layoutX: 0, layoutY: 0 }
        : index === 1
          ? { ...table, layoutX: 1000, layoutY: 1000 }
          : table,
    );
    const atFifteen = atSixteen.slice(0, 15);

    for (const tables of [atSixteen, atFifteen]) {
      const resolved = expectValidResolvedLayout(tables);
      expect(resolved.find((position) => position.tableId === "table_0")).toEqual(
        { tableId: "table_0", x: 0, y: 0, source: "persisted" },
      );
      expect(resolved.find((position) => position.tableId === "table_1")).toEqual(
        { tableId: "table_1", x: 1000, y: 1000, source: "persisted" },
      );
    }
  });

  it("rejects a near-tangent 16-table persisted pair in the rendered content box", () => {
    const tables = automaticTables(16).map((table, index) =>
      index === 0
        ? { ...table, layoutX: 0, layoutY: 0 }
        : index === 1
          ? { ...table, layoutX: 0, layoutY: 97 }
          : table,
    );

    expect(() => resolveSeatingFloorPlanPositions(tables)).toThrow(
      SeatingFloorPlanLayoutConflictError,
    );
  });

  it("keeps a positive rendered-content-box gap across every 200-table automatic slot", () => {
    expectValidResolvedLayout(automaticTables(200));
  });

  it("keeps every automatic slot and main-table slot valid through 200 tables", () => {
    for (let tableCount = 1; tableCount <= 200; tableCount += 1) {
      const metrics = getSeatingFloorPlanMetrics(tableCount);
      const resolved = resolveSeatingFloorPlanPositions(
        automaticTables(tableCount),
      );

      expect(resolved).toHaveLength(tableCount);
      expect(
        resolved.every((position) =>
          isSeatingFloorPlanCoordinateWithinSafeBounds(position, metrics),
        ),
      ).toBe(true);
    }
  });

  it("lays a 15-table venue out as main table, two side blocks and a clear centre aisle", () => {
    const resolved = expectValidResolvedLayout(automaticTables(15));
    const main = resolved.find((position) => position.tableId === "table_0");
    const others = resolved.filter((position) => position.tableId !== "table_0");

    expect(main).toMatchObject({ x: 500, y: 220, source: "automatic" });

    // 中央 320～680 只留給主桌與中央動線，其餘圓桌一律落在兩側賓客區。
    const left = others.filter((position) => position.x <= 320);
    const right = others.filter((position) => position.x >= 680);
    expect(left).toHaveLength(7);
    expect(right).toHaveLength(7);
    expect(left.length + right.length).toBe(others.length);

    // 四排，第一排與主桌同高。
    const rows = [...new Set(others.map((position) => position.y))].sort(
      (first, second) => first - second,
    );
    expect(rows).toEqual([220, 453, 687, 920]);

    // 唯一不滿的是主桌那一排，缺口落在最靠近中央動線的兩欄，
    // 主桌因此留在走道最前端、兩側只有最外圈的桌子。
    const mainRow = others.filter((position) => position.y === 220);
    expect(mainRow.map((position) => position.x).sort((a, b) => a - b)).toEqual([
      60, 940,
    ]);

    // 由左到右每一欄的桌數是 4、3、3、4。
    const columns = [...new Set(others.map((position) => position.x))].sort(
      (first, second) => first - second,
    );
    expect(columns).toEqual([60, 320, 680, 940]);
    expect(
      columns.map(
        (x) => others.filter((position) => position.x === x).length,
      ),
    ).toEqual([4, 3, 3, 4]);

    // 桌號先排完左側區塊，再接著排右側區塊。這樣賓客沿著同一側往下找桌時，
    // 不會看到 8 號旁邊突然變成 18 號。
    const readingOrder = (positions: typeof others) =>
      [...positions]
        .sort((left, right) => left.y - right.y || left.x - right.x)
        .map((position) => position.tableId);
    expect(readingOrder(left)).toEqual([
      "table_1",
      "table_2",
      "table_3",
      "table_4",
      "table_5",
      "table_6",
      "table_7",
    ]);
    expect(readingOrder(right)).toEqual([
      "table_8",
      "table_9",
      "table_10",
      "table_11",
      "table_12",
      "table_13",
      "table_14",
    ]);

    // 第二排仍然由左到右閱讀，但左右兩個區塊各自保持連續桌號。
    expect(
      others
        .filter((position) => position.y === 453)
        .map((position) => position.tableId),
    ).toEqual(["table_2", "table_3", "table_9", "table_10"]);
  });

  it("packs every row but the main-table row so column counts stay even", () => {
    const distribution = (tableCount: number) => {
      const resolved = resolveSeatingFloorPlanPositions(
        automaticTables(tableCount),
      );
      const guests = resolved.filter((position) => position.tableId !== "table_0");
      const columns = [...new Set(guests.map((position) => position.x))].sort(
        (first, second) => first - second,
      );
      return columns.map(
        (x) => guests.filter((position) => position.x === x).length,
      );
    };

    // 只有主桌那一排可能不滿，每一欄的桌數才會隨桌數平順增加。
    // 13 桌剛好排滿成 3-3-3-3，主桌單獨在走道最前端。
    expect(distribution(12)).toEqual([3, 3, 2, 3]);
    expect(distribution(13)).toEqual([3, 3, 3, 3]);
    expect(distribution(14)).toEqual([4, 3, 3, 3]);
    expect(distribution(15)).toEqual([4, 3, 3, 4]);
    expect(distribution(16)).toEqual([4, 4, 3, 4]);
    expect(distribution(17)).toEqual([4, 4, 4, 4]);
  });

  it("snaps a dragged coordinate to the nearest free slot and leaves distant ones alone", () => {
    const metrics = getSeatingFloorPlanMetrics(15);

    // 席位附近的落點吸附到席位。
    expect(snapSeatingFloorPlanCoordinate({ x: 72, y: 232 }, metrics)).toEqual({
      x: 60,
      y: 220,
    });
    // 離任何席位都超過半個圓桌時維持自訂位置。
    expect(
      snapSeatingFloorPlanCoordinate({ x: 500, y: 600 }, metrics),
    ).toEqual({ x: 500, y: 600 });
    // 已被佔用的席位要跳過，否則會吸到一個放不下的位置。
    expect(
      snapSeatingFloorPlanCoordinate({ x: 72, y: 232 }, metrics, [
        { x: 60, y: 220 },
      ]),
    ).toEqual({ x: 72, y: 232 });
  });

  it("keeps persisted coordinates and deterministically auto-places legacy rows", () => {
    const tables = [
      legacyTable("friends", 3, "同學桌", 0, 1000),
      legacyTable("family", 1, "長輩桌"),
      legacyTable("coworkers", 2, "同事桌"),
    ];

    const first = expectValidResolvedLayout(tables);
    const second = resolveSeatingFloorPlanPositions([...tables].reverse());

    expect(first).toEqual(second);
    expect(first.find((item) => item.tableId === "friends")).toEqual({
      tableId: "friends",
      x: 0,
      y: 1000,
      source: "persisted",
    });
    expect(first.find((item) => item.tableId === "family")).toEqual({
      tableId: "family",
      x: 500,
      y: 220,
      source: "automatic",
    });
  });

  it("gives the first table the upper center slot whatever the tables are called", () => {
    // 主桌就是 1 號桌。桌名開放重複之後不能再靠比對「主桌」兩個字找中央那一
    // 桌——三桌都叫主桌時那個比對只會抓到不特定的一桌。
    const positions = resolveSeatingFloorPlanPositions([
      legacyTable("first", 1, "主桌"),
      legacyTable("second", 8, "主桌"),
      legacyTable("third", 9, "主桌"),
    ]);

    expect(positions.find((item) => item.tableId === "first")).toMatchObject({
      x: 500,
      y: 220,
      source: "automatic",
    });
    for (const tableId of ["second", "third"]) {
      expect(
        positions.find((item) => item.tableId === tableId),
      ).not.toMatchObject({ x: 500, y: 220 });
    }
  });

  it("preserves unaffected automatic slots when a persisted move does not conflict", () => {
    const tables = automaticTables(8).map((table, index) =>
      index === 2 ? { ...table, layoutX: 0, layoutY: 0 } : table,
    );
    const automatic = resolveSeatingFloorPlanPositions(automaticTables(8));
    const withOnePersisted = expectValidResolvedLayout(tables);

    expect(withOnePersisted.find((item) => item.tableId === "table_2")).toEqual({
      tableId: "table_2",
      x: 0,
      y: 0,
      source: "persisted",
    });
    for (const expected of automatic.filter(
      (item) => item.tableId !== "table_2",
    )) {
      expect(
        withOnePersisted.find((item) => item.tableId === expected.tableId),
      ).toEqual(expected);
    }
  });

  it("moves only the affected future automatic slot to a deterministic safe fallback when adding a table", () => {
    const finalAutomaticTables = automaticTables(8);
    const preferred = resolveSeatingFloorPlanPositions(finalAutomaticTables);
    const blockerPreferred = preferred.find(
      (position) => position.tableId === "table_2",
    )!;
    const futurePreferred = preferred.find(
      (position) => position.tableId === "table_7",
    )!;
    const withPersistedBlocker = finalAutomaticTables.map((table) =>
      table.id === "table_2"
        ? {
            ...table,
            layoutX: futurePreferred.x,
            layoutY: futurePreferred.y,
          }
        : table,
    );

    const resolved = expectValidResolvedLayout(withPersistedBlocker);
    const secondResolution = resolveSeatingFloorPlanPositions([
      ...withPersistedBlocker,
    ].reverse());

    expect(resolved).toEqual(secondResolution);
    expect(resolved.find((position) => position.tableId === "table_7")).toEqual({
      tableId: "table_7",
      x: blockerPreferred.x,
      y: blockerPreferred.y,
      source: "automatic",
    });
    for (const expected of preferred.filter(
      (position) => !["table_2", "table_7"].includes(position.tableId),
    )) {
      expect(
        resolved.find((position) => position.tableId === expected.tableId),
      ).toEqual(expected);
    }
  });

  it("resets one table to a deterministic fallback when another persisted table occupies its preferred slot", () => {
    const preferred = resolveSeatingFloorPlanPositions(automaticTables(5));
    const targetPreferred = preferred.find(
      (position) => position.tableId === "table_1",
    )!;
    const blockerPreferred = preferred.find(
      (position) => position.tableId === "table_2",
    )!;
    const resetCandidate = automaticTables(5).map((table) =>
      table.id === "table_2"
        ? {
            ...table,
            layoutX: targetPreferred.x,
            layoutY: targetPreferred.y,
          }
        : table,
    );

    const resolved = expectValidResolvedLayout(resetCandidate);

    expect(resolved.find((position) => position.tableId === "table_1")).toEqual({
      tableId: "table_1",
      x: blockerPreferred.x,
      y: blockerPreferred.y,
      source: "automatic",
    });
  });

  it("returns bounded unique automatic slots for a large stable sequence", () => {
    const positions = expectValidResolvedLayout(automaticTables(200));
    const automatic = positions.filter((item) => item.source === "automatic");

    expect(automatic).toHaveLength(200);
    expect(new Set(automatic.map((item) => `${item.x}:${item.y}`)).size).toBe(
      200,
    );
  });

  it("uses an exact inverse mapping between rendered board points and stored coordinates", () => {
    const board = { left: 37, top: 91, width: 960, height: 960 };

    for (const coordinate of [
      { x: 0, y: 0 },
      { x: 123, y: 789 },
      { x: 500, y: 220 },
      { x: 1000, y: 1000 },
    ]) {
      expect(
        seatingFloorPlanBoardPointToCoordinate(
          seatingFloorPlanCoordinateToBoardPoint(coordinate, board),
          board,
        ),
      ).toEqual(coordinate);
    }
  });

  it("exposes a typed domain conflict for an invalid full persisted layout", () => {
    expect(() =>
      resolveSeatingFloorPlanPositions([
        legacyTable("left", 1, "左桌", 500, 500),
        legacyTable("right", 2, "右桌", 500, 500),
      ]),
    ).toThrow(SeatingFloorPlanLayoutConflictError);
  });

  it("does not silently reinterpret a crafted persisted coordinate as automatic", () => {
    expect(() =>
      resolveSeatingFloorPlanPositions([
        legacyTable("invalid", 1, "異常桌", -1, 500),
      ]),
    ).toThrow(SeatingFloorPlanLayoutConflictError);
  });

  it("permits circular markers whose edges are exactly tangent", () => {
    expect(
      seatingFloorPlanMarkerCentersCollide(
        { x: 10, y: 20 },
        { x: 122, y: 20 },
        112,
      ),
    ).toBe(false);
  });
});
