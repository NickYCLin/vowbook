export type SeatingFloorPlanPositionInput = {
  id: string;
  position: number;
  name: string;
  layoutX: number | null;
  layoutY: number | null;
};

export type ResolvedSeatingFloorPlanPosition = {
  tableId: string;
  x: number;
  y: number;
  source: "persisted" | "automatic";
};

export type SeatingFloorPlanCoordinate = { x: number; y: number };

export type SeatingFloorPlanCollision = {
  collidingTableName: string;
};

export type SeatingFloorPlanBoardBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SeatingFloorPlanMetrics = {
  boardMinWidthPx: number;
  boardHeightPx: number;
  markerSizePx: number;
  automaticColumnsPerSide: number;
  automaticRowCount: number;
};

export type SeatingFloorPlanSafeCoordinateBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type SeatingFloorPlanLayoutConflictReason =
  | "invalid-persisted-coordinate"
  | "out-of-bounds"
  | "overlap"
  | "no-safe-automatic-position";

export class SeatingFloorPlanLayoutConflictError extends Error {
  constructor(
    readonly reason: SeatingFloorPlanLayoutConflictReason,
    readonly tableIds: readonly string[] = [],
  ) {
    super("The seating floor-plan cannot be resolved safely.");
    this.name = "SeatingFloorPlanLayoutConflictError";
  }
}

const MAIN_TABLE_POSITION = { x: 500, y: 220 } as const;
/**
 * 自動排列刻意照著宴會廳的實際擺法：主桌居中面向舞台，其餘圓桌分成
 * 女方（左）與男方（右）兩塊，中央 320～680 留給主桌與中央動線。
 * 舊版是一片跨越整個場地的網格，圓桌會壓在動線和側別色塊上。
 */
const LEFT_X_MIN = 60;
const LEFT_X_MAX = 320;
const RIGHT_X_MIN = 680;
const RIGHT_X_MAX = 940;
const GRID_Y_MIN = 220;
const GRID_Y_MAX = 920;
/** 一般婚宴大約排四排；桌數變多時才往兩側加欄。 */
const PREFERRED_ROW_COUNT = 4;
const BOARD_X_MIN_PERCENT = 6;
const BOARD_X_MAX_PERCENT = 94;
const BOARD_Y_MIN_PERCENT = 8;
const BOARD_Y_MAX_PERCENT = 94;
const BOARD_MIN_WIDTH_PX = 60 * 16;
const BOARD_MIN_HEIGHT_PX = 960;
export const SEATING_FLOOR_PLAN_MARKER_GAP_PX = 8;
const BOARD_BORDER_PX = 1;
const SAFE_BOUNDARY_EPSILON = 1e-9;

type SeatingFloorPlanMetricsSource = number | SeatingFloorPlanMetrics;

function isDomainCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1000
  );
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function persistedCoordinate(
  table: SeatingFloorPlanPositionInput,
): SeatingFloorPlanCoordinate | null {
  if (isNullish(table.layoutX) && isNullish(table.layoutY)) return null;
  if (
    isNullish(table.layoutX) ||
    isNullish(table.layoutY) ||
    !isDomainCoordinate(table.layoutX) ||
    !isDomainCoordinate(table.layoutY)
  ) {
    throw new SeatingFloorPlanLayoutConflictError(
      "invalid-persisted-coordinate",
      [table.id],
    );
  }
  return { x: table.layoutX, y: table.layoutY };
}

function assertDomainCoordinate(coordinate: SeatingFloorPlanCoordinate): void {
  if (!isDomainCoordinate(coordinate.x) || !isDomainCoordinate(coordinate.y)) {
    throw new RangeError(
      "Floor-plan coordinates must be integers from 0 to 1000.",
    );
  }
}

function interpolate(
  minimum: number,
  maximum: number,
  index: number,
  count: number,
) {
  if (count <= 1) return Math.round((minimum + maximum) / 2);
  return Math.round(minimum + ((maximum - minimum) * index) / (count - 1));
}

function markerSizeForTableCount(tableCount: number) {
  if (tableCount <= 15) return 112;
  if (tableCount <= 20) return 80;
  if (tableCount <= 32) return 64;
  return 44;
}

function roundUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}


/**
 * These are the canonical board and marker metrics consumed by every geometry
 * operation. The 960px minimum dimensions keep the entire persisted 0..1000
 * coordinate domain marker-safe even at the largest 112px marker tier.
 */
export function getSeatingFloorPlanMetrics(
  rawTableCount: number,
): SeatingFloorPlanMetrics {
  const tableCount = Math.max(0, Math.floor(rawTableCount));
  const markerSizePx = markerSizeForTableCount(tableCount);
  const automaticGridCount = Math.max(0, tableCount - 1);
  const contentMinWidthPx = BOARD_MIN_WIDTH_PX - BOARD_BORDER_PX * 2;
  const mappedSideWidthPx =
    contentMinWidthPx *
    ((BOARD_X_MAX_PERCENT - BOARD_X_MIN_PERCENT) / 100) *
    ((LEFT_X_MAX - LEFT_X_MIN) / 1000);
  const maximumColumnsPerSide = Math.max(
    1,
    Math.floor(mappedSideWidthPx / (markerSizePx + SEATING_FLOOR_PLAN_MARKER_GAP_PX)) + 1,
  );
  const automaticColumnsPerSide =
    automaticGridCount === 0
      ? 0
      : Math.min(
          maximumColumnsPerSide,
          Math.max(
            1,
            Math.ceil(automaticGridCount / (2 * PREFERRED_ROW_COUNT)),
          ),
        );
  const automaticRowCount =
    automaticColumnsPerSide === 0
      ? 0
      : Math.ceil(automaticGridCount / (automaticColumnsPerSide * 2));
  // 排與排的間距要用「取整之後」的最小值來算：席位座標是整數，
  // 700 / 19 這種除不盡的情況會有一排比平均值窄一個單位，用平均值推
  // 出來的高度會讓那一對圓桌的間隙短少約 1px。
  const rowSpacingCoordinates =
    automaticRowCount <= 1
      ? 0
      : Math.floor((GRID_Y_MAX - GRID_Y_MIN) / (automaticRowCount - 1));
  const requiredGridContentHeight =
    rowSpacingCoordinates === 0
      ? 0
      : (markerSizePx + SEATING_FLOOR_PLAN_MARKER_GAP_PX) /
        (((BOARD_Y_MAX_PERCENT - BOARD_Y_MIN_PERCENT) / 100) *
          (rowSpacingCoordinates / 1000));

  return {
    boardMinWidthPx: BOARD_MIN_WIDTH_PX,
    boardHeightPx: roundUp(
      Math.max(
        BOARD_MIN_HEIGHT_PX,
        requiredGridContentHeight + BOARD_BORDER_PX * 2,
      ),
      8,
    ),
    markerSizePx,
    automaticColumnsPerSide,
    automaticRowCount,
  };
}

export function seatingFloorPlanCoordinateToBoardPercent(
  coordinate: SeatingFloorPlanCoordinate,
): SeatingFloorPlanCoordinate {
  assertDomainCoordinate(coordinate);
  return {
    x:
      BOARD_X_MIN_PERCENT +
      (coordinate.x / 1000) *
        (BOARD_X_MAX_PERCENT - BOARD_X_MIN_PERCENT),
    y:
      BOARD_Y_MIN_PERCENT +
      (coordinate.y / 1000) *
        (BOARD_Y_MAX_PERCENT - BOARD_Y_MIN_PERCENT),
  };
}

export function seatingFloorPlanCoordinateToBoardPoint(
  coordinate: SeatingFloorPlanCoordinate,
  board: SeatingFloorPlanBoardBounds,
): SeatingFloorPlanCoordinate {
  if (board.width <= 0 || board.height <= 0) {
    throw new RangeError("Floor-plan board dimensions must be positive.");
  }
  const percent = seatingFloorPlanCoordinateToBoardPercent(coordinate);
  return {
    x: board.left + (percent.x / 100) * board.width,
    y: board.top + (percent.y / 100) * board.height,
  };
}

function resolveSeatingFloorPlanMetrics(
  source: SeatingFloorPlanMetricsSource,
): SeatingFloorPlanMetrics {
  return typeof source === "number"
    ? getSeatingFloorPlanMetrics(source)
    : source;
}

function markerSafeAxisBounds(
  mappedMinimumPx: number,
  mappedMaximumPx: number,
  boardSizePx: number,
  markerRadiusPx: number,
): { minimum: number; maximum: number } {
  const pixelsPerCoordinate =
    (mappedMaximumPx - mappedMinimumPx) / 1000;
  if (
    !Number.isFinite(pixelsPerCoordinate) ||
    pixelsPerCoordinate <= 0 ||
    !Number.isFinite(boardSizePx) ||
    boardSizePx <= 0 ||
    !Number.isFinite(markerRadiusPx) ||
    markerRadiusPx < 0
  ) {
    throw new RangeError("Floor-plan safe-bound metrics must be positive.");
  }

  const continuousMinimum =
    (markerRadiusPx - mappedMinimumPx) / pixelsPerCoordinate;
  const continuousMaximum =
    (boardSizePx - markerRadiusPx - mappedMinimumPx) /
    pixelsPerCoordinate;
  const minimum = Math.max(
    0,
    Math.ceil(continuousMinimum - SAFE_BOUNDARY_EPSILON),
  );
  const maximum = Math.min(
    1000,
    Math.floor(continuousMaximum + SAFE_BOUNDARY_EPSILON),
  );
  if (minimum > maximum) {
    throw new RangeError("Floor-plan marker does not fit within the board.");
  }
  return { minimum, maximum };
}

export function getSeatingFloorPlanSafeCoordinateBounds(
  source: SeatingFloorPlanMetricsSource,
): SeatingFloorPlanSafeCoordinateBounds {
  const metrics = resolveSeatingFloorPlanMetrics(source);
  const board = canonicalBoard(metrics);
  const mappedMinimum = seatingFloorPlanCoordinateToBoardPoint(
    { x: 0, y: 0 },
    board,
  );
  const mappedMaximum = seatingFloorPlanCoordinateToBoardPoint(
    { x: 1000, y: 1000 },
    board,
  );
  const markerRadiusPx = metrics.markerSizePx / 2;
  const x = markerSafeAxisBounds(
    mappedMinimum.x,
    mappedMaximum.x,
    board.width,
    markerRadiusPx,
  );
  const y = markerSafeAxisBounds(
    mappedMinimum.y,
    mappedMaximum.y,
    board.height,
    markerRadiusPx,
  );

  return {
    minX: x.minimum,
    maxX: x.maximum,
    minY: y.minimum,
    maxY: y.maximum,
  };
}

export function isSeatingFloorPlanCoordinateWithinSafeBounds(
  coordinate: SeatingFloorPlanCoordinate,
  source: SeatingFloorPlanMetricsSource,
): boolean {
  if (!isDomainCoordinate(coordinate.x) || !isDomainCoordinate(coordinate.y)) {
    return false;
  }
  const bounds = getSeatingFloorPlanSafeCoordinateBounds(source);
  return (
    coordinate.x >= bounds.minX &&
    coordinate.x <= bounds.maxX &&
    coordinate.y >= bounds.minY &&
    coordinate.y <= bounds.maxY
  );
}

export function clampSeatingFloorPlanCoordinateToSafeBounds(
  coordinate: SeatingFloorPlanCoordinate,
  source: SeatingFloorPlanMetricsSource,
): SeatingFloorPlanCoordinate {
  const bounds = getSeatingFloorPlanSafeCoordinateBounds(source);
  return {
    x: Math.max(
      bounds.minX,
      Math.min(bounds.maxX, clampSeatingFloorPlanCoordinate(coordinate.x)),
    ),
    y: Math.max(
      bounds.minY,
      Math.min(bounds.maxY, clampSeatingFloorPlanCoordinate(coordinate.y)),
    ),
  };
}

export function seatingFloorPlanBoardPointToCoordinate(
  point: SeatingFloorPlanCoordinate,
  board: SeatingFloorPlanBoardBounds,
): SeatingFloorPlanCoordinate {
  if (board.width <= 0 || board.height <= 0) {
    throw new RangeError("Floor-plan board dimensions must be positive.");
  }
  const xPercent = ((point.x - board.left) / board.width) * 100;
  const yPercent = ((point.y - board.top) / board.height) * 100;
  return {
    x: clampSeatingFloorPlanCoordinate(
      ((xPercent - BOARD_X_MIN_PERCENT) /
        (BOARD_X_MAX_PERCENT - BOARD_X_MIN_PERCENT)) *
        1000,
    ),
    y: clampSeatingFloorPlanCoordinate(
      ((yPercent - BOARD_Y_MIN_PERCENT) /
        (BOARD_Y_MAX_PERCENT - BOARD_Y_MIN_PERCENT)) *
        1000,
    ),
  };
}

export function seatingFloorPlanMarkerCentersCollide(
  left: SeatingFloorPlanCoordinate,
  right: SeatingFloorPlanCoordinate,
  markerSizePx: number,
): boolean {
  const deltaX = left.x - right.x;
  const deltaY = left.y - right.y;
  return deltaX * deltaX + deltaY * deltaY < markerSizePx * markerSizePx;
}

export function getSeatingFloorPlanContentBounds(
  source: SeatingFloorPlanMetricsSource,
): SeatingFloorPlanBoardBounds {
  const metrics = resolveSeatingFloorPlanMetrics(source);
  return {
    left: BOARD_BORDER_PX,
    top: BOARD_BORDER_PX,
    width: metrics.boardMinWidthPx - BOARD_BORDER_PX * 2,
    height: metrics.boardHeightPx - BOARD_BORDER_PX * 2,
  };
}

function canonicalBoard(
  metrics: SeatingFloorPlanMetrics,
): SeatingFloorPlanBoardBounds {
  // The floor-plan's CSS uses border-box sizing, but pointer mapping and
  // marker painting occur in its content box after the 1px border on each
  // side. Validation geometry must use that same box: a tangent pair in the
  // 960px border box can otherwise overlap fractionally in Chromium's 958px
  // content box.
  return getSeatingFloorPlanContentBounds(metrics);
}

/**
 * 使用者存下來的座標只要圓桌不重疊就算合法；但自己挑位置時要多留一個
 * 間隙，否則自動排出來的圓桌可能貼著某張被拖到旁邊的桌子邊緣。
 */
function positionsCollide(
  left: SeatingFloorPlanCoordinate,
  right: SeatingFloorPlanCoordinate,
  metrics: SeatingFloorPlanMetrics,
  clearancePx = 0,
): boolean {
  const board = canonicalBoard(metrics);
  return seatingFloorPlanMarkerCentersCollide(
    seatingFloorPlanCoordinateToBoardPoint(left, board),
    seatingFloorPlanCoordinateToBoardPoint(right, board),
    metrics.markerSizePx + clearancePx,
  );
}

function isAvailablePosition(
  candidate: SeatingFloorPlanCoordinate,
  occupied: Array<ResolvedSeatingFloorPlanPosition>,
  metrics: SeatingFloorPlanMetrics,
  clearancePx = 0,
): boolean {
  return (
    isSeatingFloorPlanCoordinateWithinSafeBounds(candidate, metrics) &&
    occupied.every(
      (position) =>
        !positionsCollide(candidate, position, metrics, clearancePx),
    )
  );
}

function preferredAutomaticPositions(
  ordered: SeatingFloorPlanPositionInput[],
  metrics: SeatingFloorPlanMetrics,
): Map<string, SeatingFloorPlanCoordinate> {
  const preferred = new Map<string, SeatingFloorPlanCoordinate>();
  // 主桌就是 1 號桌，也就是排序的第一桌。原本是比對桌名叫不叫「主桌」，桌名
  // 開放重複之後那個判斷會抓到不特定的一桌；桌號才是身分。
  const mainTable = ordered[0];
  if (mainTable) preferred.set(mainTable.id, MAIN_TABLE_POSITION);

  const remaining = ordered.slice(1);
  const slots = automaticSideSlots(metrics, remaining.length);
  remaining.forEach((table, index) => {
    // 席位不夠時不硬塞：沒有偏好位置的桌次會走後備候選池。
    const slot = slots[index];
    if (slot) preferred.set(table.id, slot);
  });
  return preferred;
}

function sideColumnCenters(columnsPerSide: number): number[] {
  return [
    ...Array.from({ length: columnsPerSide }, (_, index) =>
      interpolate(LEFT_X_MIN, LEFT_X_MAX, index, columnsPerSide),
    ),
    ...Array.from({ length: columnsPerSide }, (_, index) =>
      interpolate(RIGHT_X_MIN, RIGHT_X_MAX, index, columnsPerSide),
    ),
  ];
}

function rowCenterY(row: number, rowCount: number): number {
  // 只有一排時要與主桌同高，interpolate 在 count 為 1 時會回傳中點。
  return rowCount === 1
    ? GRID_Y_MIN
    : interpolate(GRID_Y_MIN, GRID_Y_MAX, row, rowCount);
}

/**
 * 取最靠外側的 count 欄，再依左到右輸出。
 *
 * 「最外側優先」決定哪幾欄有桌子：沒排滿的那一排缺口會落在靠近中央動線
 * 的位置，兩側維持對稱。「左到右」決定填入順序：桌次編號才會照閱讀方向
 * 落下，而不是在左右兩側之間跳來跳去。
 */
function outermostColumns(columns: number[], count: number): number[] {
  return [...columns]
    .sort(
      (left, right) =>
        Math.abs(right - MAIN_TABLE_POSITION.x) -
        Math.abs(left - MAIN_TABLE_POSITION.x),
    )
    .slice(0, Math.max(0, count))
    .sort((left, right) => left - right);
}

/**
 * 兩側賓客區的座位順序：由上而下一排一排，每排都排滿，唯一可能不滿的
 * 是「主桌那一排」，而且缺口一定落在最靠近中央動線的位置。
 *
 * 不滿的排放最前面而不是最後面，是為了讓主桌維持在走道最前端、兩側只有
 * 最外圈的桌子——這才是實際宴會廳的樣子。以 15 桌為例，左到右每欄是
 * 4、3、3、4 桌；13 桌則剛好排滿成 3、3、3、3。
 *
 * 主桌那一排排滿時也不會撞到主桌：最內側的一欄在 320／680，離主桌 180 個
 * 座標單位（約 152px），大於任何標記層級所需的間距。
 */
function automaticSideSlots(
  metrics: SeatingFloorPlanMetrics,
  guestTableCount: number,
): SeatingFloorPlanCoordinate[] {
  const columnsPerSide = metrics.automaticColumnsPerSide;
  const rowCount = metrics.automaticRowCount;
  if (columnsPerSide === 0 || rowCount === 0) return [];

  const columns = sideColumnCenters(columnsPerSide);
  const mainRowCount = guestTableCount - columns.length * (rowCount - 1);
  const slots: SeatingFloorPlanCoordinate[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const take = row === 0 ? mainRowCount : columns.length;
    for (const x of outermostColumns(columns, take)) {
      slots.push({ x, y: rowCenterY(row, rowCount) });
    }
  }
  return slots;
}

/** 拖曳時可以吸附的所有位置：主桌席位，加上兩側賓客區的完整格線。 */
function seatingFloorPlanSlotGrid(
  metrics: SeatingFloorPlanMetrics,
): SeatingFloorPlanCoordinate[] {
  const columnsPerSide = metrics.automaticColumnsPerSide;
  const rowCount = metrics.automaticRowCount;
  const slots: SeatingFloorPlanCoordinate[] = [{ ...MAIN_TABLE_POSITION }];
  if (columnsPerSide === 0 || rowCount === 0) return slots;

  for (let row = 0; row < rowCount; row += 1) {
    for (const x of sideColumnCenters(columnsPerSide)) {
      slots.push({ x, y: rowCenterY(row, rowCount) });
    }
  }
  return slots;
}

/**
 * 找出拖曳落點壓在哪一張桌子上，用來判斷這一次放開是「移動」還是「交換」。
 * 落點要進到對方圓桌的範圍內才算，僅僅靠近不算。
 */
export function findSeatingFloorPlanSwapTarget(
  coordinate: SeatingFloorPlanCoordinate,
  candidates: readonly ResolvedSeatingFloorPlanPosition[],
  source: SeatingFloorPlanMetricsSource,
): string | null {
  const metrics = resolveSeatingFloorPlanMetrics(source);
  const board = canonicalBoard(metrics);
  const point = seatingFloorPlanCoordinateToBoardPoint(coordinate, board);

  let nearest: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const candidatePoint = seatingFloorPlanCoordinateToBoardPoint(
      candidate,
      board,
    );
    const distance = Math.hypot(
      point.x - candidatePoint.x,
      point.y - candidatePoint.y,
    );
    if (distance <= metrics.markerSizePx / 2 && distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate.tableId;
    }
  }
  return nearest;
}

/**
 * 把拖曳中的座標吸附到最近的版面席位，超過半個圓桌的距離就維持原樣，
 * 讓自訂擺法仍然可行。已被其他桌佔用的席位會跳過，否則預覽會卡住不動。
 */
export function snapSeatingFloorPlanCoordinate(
  coordinate: SeatingFloorPlanCoordinate,
  source: SeatingFloorPlanMetricsSource,
  occupied: readonly SeatingFloorPlanCoordinate[] = [],
): SeatingFloorPlanCoordinate {
  const metrics = resolveSeatingFloorPlanMetrics(source);
  const board = canonicalBoard(metrics);
  const point = seatingFloorPlanCoordinateToBoardPoint(coordinate, board);

  let nearest: SeatingFloorPlanCoordinate | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const slot of seatingFloorPlanSlotGrid(metrics)) {
    if (!isSeatingFloorPlanCoordinateWithinSafeBounds(slot, metrics)) continue;
    if (
      occupied.some((taken) =>
        positionsCollide(
          slot,
          taken,
          metrics,
          SEATING_FLOOR_PLAN_MARKER_GAP_PX,
        ),
      )
    ) {
      continue;
    }
    const slotPoint = seatingFloorPlanCoordinateToBoardPoint(slot, board);
    const distance = Math.hypot(
      point.x - slotPoint.x,
      point.y - slotPoint.y,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = slot;
    }
  }

  return nearest && nearestDistance <= metrics.markerSizePx / 2
    ? nearest
    : coordinate;
}

function fallbackAxisStarts(step: number): number[] {
  return [...new Set([0, Math.floor(step / 2), 1000 % step])].filter(
    (value) => value >= 0 && value <= 1000,
  );
}

function fallbackAutomaticCandidates(
  ordered: SeatingFloorPlanPositionInput[],
  persistedTableIds: ReadonlySet<string>,
  preferred: ReadonlyMap<string, SeatingFloorPlanCoordinate>,
  metrics: SeatingFloorPlanMetrics,
): SeatingFloorPlanCoordinate[] {
  const candidates: SeatingFloorPlanCoordinate[] = [];
  const seen = new Set<string>();
  const add = (candidate: SeatingFloorPlanCoordinate) => {
    const key = `${candidate.x}:${candidate.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  };

  for (const table of ordered) {
    if (!persistedTableIds.has(table.id)) continue;
    const candidate = preferred.get(table.id);
    if (candidate) add(candidate);
  }

  const contentBounds = canonicalBoard(metrics);
  const xPixelsPerCoordinate =
    (contentBounds.width *
      ((BOARD_X_MAX_PERCENT - BOARD_X_MIN_PERCENT) / 100)) /
    1000;
  const yPixelsPerCoordinate =
    (contentBounds.height *
      ((BOARD_Y_MAX_PERCENT - BOARD_Y_MIN_PERCENT) / 100)) /
    1000;
  const xStep = Math.max(
    1,
    Math.ceil(
      (metrics.markerSizePx + SEATING_FLOOR_PLAN_MARKER_GAP_PX) /
        xPixelsPerCoordinate,
    ),
  );
  const yStep = Math.max(
    1,
    Math.ceil(
      (metrics.markerSizePx + SEATING_FLOOR_PLAN_MARKER_GAP_PX) /
        yPixelsPerCoordinate,
    ),
  );

  for (const yStart of fallbackAxisStarts(yStep)) {
    for (const xStart of fallbackAxisStarts(xStep)) {
      for (let y = yStart; y <= 1000; y += yStep) {
        for (let x = xStart; x <= 1000; x += xStep) {
          add({ x, y });
        }
      }
    }
  }

  return candidates;
}

function assertResolvedLayout(
  resolved: ResolvedSeatingFloorPlanPosition[],
  metrics: SeatingFloorPlanMetrics,
): void {
  for (const position of resolved) {
    if (!isSeatingFloorPlanCoordinateWithinSafeBounds(position, metrics)) {
      throw new SeatingFloorPlanLayoutConflictError("out-of-bounds", [
        position.tableId,
      ]);
    }
  }
  for (let leftIndex = 0; leftIndex < resolved.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < resolved.length;
      rightIndex += 1
    ) {
      if (positionsCollide(resolved[leftIndex], resolved[rightIndex], metrics)) {
        throw new SeatingFloorPlanLayoutConflictError("overlap", [
          resolved[leftIndex].tableId,
          resolved[rightIndex].tableId,
        ]);
      }
    }
  }
}

/**
 * Resolves and validates the complete layout. Persisted markers are fixed;
 * automatic markers retain their preferred slots whenever those slots remain
 * safe, then use a deterministic fallback pool. No read path writes or clamps
 * persisted values.
 */
export function resolveSeatingFloorPlanPositions(
  tables: SeatingFloorPlanPositionInput[],
): ResolvedSeatingFloorPlanPosition[] {
  const ordered = [...tables].sort(
    (left, right) =>
      left.position - right.position || left.id.localeCompare(right.id),
  );
  const metrics = getSeatingFloorPlanMetrics(ordered.length);
  const preferred = preferredAutomaticPositions(ordered, metrics);
  const persistedTableIds = new Set<string>();
  const occupied: ResolvedSeatingFloorPlanPosition[] = [];
  const automaticTables: SeatingFloorPlanPositionInput[] = [];

  for (const table of ordered) {
    const coordinate = persistedCoordinate(table);
    if (!coordinate) {
      automaticTables.push(table);
      continue;
    }
    const position = {
      tableId: table.id,
      ...coordinate,
      source: "persisted" as const,
    };
    if (!isAvailablePosition(position, occupied, metrics)) {
      const reason = isSeatingFloorPlanCoordinateWithinSafeBounds(
        position,
        metrics,
      )
        ? "overlap"
        : "out-of-bounds";
      throw new SeatingFloorPlanLayoutConflictError(reason, [
        ...occupied
          .filter((other) => positionsCollide(position, other, metrics))
          .map((other) => other.tableId),
        table.id,
      ]);
    }
    persistedTableIds.add(table.id);
    occupied.push(position);
  }

  const blocked: SeatingFloorPlanPositionInput[] = [];
  for (const table of automaticTables) {
    const candidate = preferred.get(table.id);
    if (
      !candidate ||
      !isAvailablePosition(
        candidate,
        occupied,
        metrics,
        SEATING_FLOOR_PLAN_MARKER_GAP_PX,
      )
    ) {
      blocked.push(table);
      continue;
    }
    occupied.push({
      tableId: table.id,
      ...candidate,
      source: "automatic",
    });
  }

  const fallbackCandidates = fallbackAutomaticCandidates(
    ordered,
    persistedTableIds,
    preferred,
    metrics,
  );
  for (const table of blocked) {
    const candidate =
      fallbackCandidates.find((position) =>
        isAvailablePosition(
          position,
          occupied,
          metrics,
          SEATING_FLOOR_PLAN_MARKER_GAP_PX,
        ),
      ) ??
      // 場地很擠時退回「不重疊就好」，寧可貼著也不要整張圖排不出來。
      fallbackCandidates.find((position) =>
        isAvailablePosition(position, occupied, metrics),
      );
    if (!candidate) {
      throw new SeatingFloorPlanLayoutConflictError(
        "no-safe-automatic-position",
        [table.id],
      );
    }
    occupied.push({
      tableId: table.id,
      ...candidate,
      source: "automatic",
    });
  }

  const byTableId = new Map(
    occupied.map((position) => [position.tableId, position]),
  );
  const resolved = ordered.map((table) => {
    const position = byTableId.get(table.id);
    if (!position) {
      throw new SeatingFloorPlanLayoutConflictError(
        "no-safe-automatic-position",
        [table.id],
      );
    }
    return position;
  });
  assertResolvedLayout(resolved, metrics);
  return resolved;
}

/**
 * Compatibility helper for a single persisted candidate. Automatic markers
 * are allowed to move to safe fallbacks, so only an unavoidable persisted
 * collision is returned.
 */
export function findSeatingFloorPlanCollision(
  tables: SeatingFloorPlanPositionInput[],
  targetTableId: string,
  candidate: SeatingFloorPlanCoordinate,
): SeatingFloorPlanCollision | null {
  assertDomainCoordinate(candidate);
  const target = tables.find((table) => table.id === targetTableId);
  if (!target) {
    throw new Error("Unable to find the target seating floor-plan table.");
  }
  const candidateTables = tables.map((table) =>
    table.id === targetTableId
      ? { ...table, layoutX: candidate.x, layoutY: candidate.y }
      : table,
  );
  try {
    resolveSeatingFloorPlanPositions(candidateTables);
    return null;
  } catch (error) {
    if (
      !(error instanceof SeatingFloorPlanLayoutConflictError) ||
      error.reason !== "overlap"
    ) {
      throw error;
    }
    const metrics = getSeatingFloorPlanMetrics(tables.length);
    for (const table of tables) {
      if (table.id === targetTableId) continue;
      const persisted = persistedCoordinate(table);
      if (persisted && positionsCollide(candidate, persisted, metrics)) {
        return { collidingTableName: table.name };
      }
    }
    throw error;
  }
}

export function clampSeatingFloorPlanCoordinate(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(value)));
}
