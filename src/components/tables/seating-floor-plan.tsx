"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  resetSeatingTableLayoutsAction,
  swapSeatingTableContentsAction,
  updateSeatingTableLayoutAction,
  type SeatingTableMutationState,
} from "@/actions/seating-tables";
import {
  clampSeatingFloorPlanCoordinateToSafeBounds,
  getSeatingFloorPlanMetrics,
  resolveSeatingFloorPlanPositions,
  seatingFloorPlanBoardPointToCoordinate,
  seatingFloorPlanCoordinateToBoardPercent,
  seatingFloorPlanCoordinateToBoardPoint,
  snapSeatingFloorPlanCoordinate,
  findSeatingFloorPlanSwapTarget,
  type SeatingFloorPlanCoordinate,
} from "@/domain/seating-floor-plan";
import {
  GUEST_SIDE_LABELS,
  GUEST_SIDE_SHORT_LABELS,
  type GuestSideValue,
} from "@/domain/guest";
import { seatingTableLabel, seatingTableSide } from "@/domain/seating-table";
import { cn } from "@/lib/class-names";

export type SeatingFloorPlanTable = {
  id: string;
  /** 印在桌卡上的桌號。由順位推導，不是資料庫欄位。 */
  number: number;
  position: number;
  version: number;
  layoutX: number | null;
  layoutY: number | null;
  name: string;
  capacity: number;
  guests: Array<{
    id: string;
    name: string;
    partySize: number;
    side: GuestSideValue;
  }>;
};

type DraftPosition = {
  x: number;
  y: number;
  source: "persisted" | "automatic";
  version: number;
  layoutX: number | null;
  layoutY: number | null;
  // A full automatic resolution is only a preview of one authoritative
  // server table set. It must never survive a changed set or any changed
  // input that can choose different automatic slots.
  layoutSnapshotKey: string;
};

type TableContentOverride = Pick<
  SeatingFloorPlanTable,
  "name" | "guests"
> & { contentSnapshotKey: string };

type DragState = {
  tableId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  grabOffsetClientX: number;
  grabOffsetClientY: number;
  moved: boolean;
  // 拖曳開始時的版面。交換要以「還沒拖之前」的位置為準：拖曳中的預覽會把
  // 被拖的桌子移到別的席位，也可能把自動排列的桌次擠開，直接讀當下的
  // draft 會拿到預覽值，和伺服器實際交換的來源對不起來。
  startOverrides: Record<string, DraftPosition>;
  startPositions: Record<string, SeatingFloorPlanCoordinate>;
} | null;

/** 拖到別張桌子上時的交換預覽：固定桌位原地顯示對方的桌名與賓客。 */
type SwapPreview = {
  draggedTableId: string;
  targetTableId: string;
  draggedTo: SeatingFloorPlanCoordinate;
  targetTo: SeatingFloorPlanCoordinate;
};

const idleState: SeatingTableMutationState = { status: "idle" };
const DIRECTION_STEP = 50;

function layoutSnapshotKey(tables: SeatingFloorPlanTable[]): string {
  return [...tables]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((table) => [
      table.id,
      table.position,
      table.version,
      table.layoutX ?? "null",
      table.layoutY ?? "null",
      table.name,
    ].join("\u001f"))
    .join("\u001e");
}

function buildDraftPositions(
  tables: SeatingFloorPlanTable[],
): Record<string, DraftPosition> {
  const snapshotKey = layoutSnapshotKey(tables);
  const resolved = resolveSeatingFloorPlanPositions(tables);
  return Object.fromEntries(
    tables.map((table) => {
      const position = resolved.find((item) => item.tableId === table.id);
      if (!position) throw new Error("Missing floor-plan position.");
      return [
        table.id,
        {
          x: position.x,
          y: position.y,
          source: position.source,
          version: table.version,
          layoutX: table.layoutX,
          layoutY: table.layoutY,
          layoutSnapshotKey: snapshotKey,
        },
      ];
    }),
  );
}

function mergeDraftPositions(
  base: Record<string, DraftPosition>,
  overrides: Record<string, DraftPosition>,
): Record<string, DraftPosition> {
  return Object.fromEntries(
    Object.entries(base).map(([tableId, position]) => {
      const override = overrides[tableId];
      return [
        tableId,
        override && override.layoutSnapshotKey === position.layoutSnapshotKey
          ? override
          : position,
      ];
    }),
  );
}

function occupancy(table: SeatingFloorPlanTable): number {
  return table.guests.reduce((total, guest) => total + guest.partySize, 0);
}

/**
 * 側別的顏色沿用場地兩側原本的色系：男方偏 sage、女方偏 clay。共同親友用
 * 中性色而不是第三種顏色——它代表的是「兩邊都有」，不是另一個陣營。
 */
const SIDE_DOT_CLASSNAMES = {
  PARTNER_A: "bg-sage",
  PARTNER_B: "bg-clay",
  SHARED: "bg-ink-faint",
} as const satisfies Record<GuestSideValue, string>;

const SIDE_TEXT_CLASSNAMES = {
  PARTNER_A: "text-sage",
  PARTNER_B: "text-clay-strong",
  SHARED: "text-ink-soft",
} as const satisfies Record<GuestSideValue, string>;

/**
 * 圓桌上的字。桌號最大、擺第一行：那是印在桌卡上、賓客真正拿來找位子的資訊。
 * 桌數多到圓桌只剩 44px 時只留桌號——原本那個被壓成 8px 的桌名根本讀不出來。
 */
function MarkerContent({
  table,
  side,
  assignedPartySize,
  isDense,
  isMaximumDensity,
}: {
  table: SeatingFloorPlanTable;
  side: GuestSideValue | null;
  assignedPartySize: number;
  isDense: boolean;
  isMaximumDensity: boolean;
}) {
  return (
    <>
      <span
        className={cn(
          "font-semibold text-ink tabular-nums",
          isMaximumDensity
            ? "text-caption leading-4"
            : isDense
              ? "text-sm leading-4"
              : "text-body leading-5",
        )}
      >
        {table.number}
      </span>
      {!isMaximumDensity ? (
        <>
          <span
            className={cn(
              "max-w-full font-medium break-words text-ink-soft",
              isDense
                ? "line-clamp-1 text-[0.625rem] leading-3"
                : "line-clamp-2 text-caption leading-4",
            )}
          >
            {table.name}
          </span>
          {/*
            側別是從入座賓客推出來的，空桌就不標——沒有人坐的桌子不屬於任何
            一邊。圓桌小到 64px 時只留色點，文字擠不下。
          */}
          {side ? (
            <span
              className={cn(
                "flex max-w-full items-center gap-1 font-semibold",
                SIDE_TEXT_CLASSNAMES[side],
                isDense ? "text-[0.5rem] leading-3" : "text-[0.6875rem]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  SIDE_DOT_CLASSNAMES[side],
                )}
              />
              {!isDense ? GUEST_SIDE_SHORT_LABELS[side] : null}
            </span>
          ) : null}
          <span
            className={cn(
              "font-semibold text-clay-strong tabular-nums",
              isDense ? "text-[0.5rem] leading-3" : "text-[0.6875rem]",
            )}
          >
            {assignedPartySize} / {table.capacity} 位
          </span>
        </>
      ) : null}
    </>
  );
}

function coordinateBounds(element: HTMLDivElement) {
  const rect = element.getBoundingClientRect();
  const styles = window.getComputedStyle(element);
  const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(styles.borderRightWidth) || 0;
  const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
  return {
    left: rect.left + borderLeft,
    top: rect.top + borderTop,
    width: rect.width - borderLeft - borderRight,
    height: rect.height - borderTop - borderBottom,
  };
}

export function SeatingFloorPlan({
  workspaceId,
  tables,
  canEdit,
  selectedTableId,
  onSelectTable,
}: {
  workspaceId: string;
  tables: SeatingFloorPlanTable[];
  canEdit: boolean;
  selectedTableId: string | null;
  onSelectTable?: (tableId: string) => void;
}) {
  const router = useRouter();
  const swapSelectId = useId();
  const boardRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const dragRef = useRef<DragState>(null);
  const metrics = useMemo(
    () => getSeatingFloorPlanMetrics(tables.length),
    [tables.length],
  );
  const baseDrafts = useMemo(() => buildDraftPositions(tables), [tables]);
  const [draftOverrides, setDraftOverrides] = useState<
    Record<string, DraftPosition>
  >({});
  const drafts = useMemo(
    () => mergeDraftPositions(baseDrafts, draftOverrides),
    [baseDrafts, draftOverrides],
  );
  const contentSnapshotKey = useMemo(() => layoutSnapshotKey(tables), [tables]);
  const [contentOverrides, setContentOverrides] = useState<
    Record<string, TableContentOverride>
  >({});
  const displayTables = useMemo(
    () =>
      tables.map((table) => {
        const override = contentOverrides[table.id];
        return {
          ...table,
          ...(override?.contentSnapshotKey === contentSnapshotKey
            ? { name: override.name, guests: override.guests }
            : {}),
        };
      }),
    [contentOverrides, contentSnapshotKey, tables],
  );
  const [feedback, setFeedback] = useState<SeatingTableMutationState>(idleState);
  // 拖曳中壓在哪一張桌子上；放開時要交換而不是移動。
  const [swapPreview, setSwapPreview] = useState<SwapPreview | null>(null);
  // 哪一張桌子正跟著指標跑。跟著指標的那張不能有位移動畫，否則會慢半拍。
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [swapSelectionId, setSwapSelectionId] = useState("");
  // 「依桌號重新排列」會一次抹掉所有手動位置且無法復原，要先確認。
  const [isConfirmingResetAll, setIsConfirmingResetAll] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // preventScroll 是必要的：這段訊息在場地圖下方，移動完圓桌就聚焦會把
    // 畫面捲離剛才那張桌子，正在微調位置時尤其惱人。role 已經是 status／
    // alert，輔助技術照樣會朗讀。
    if (feedback.status !== "idle") {
      feedbackRef.current?.focus({ preventScroll: true });
    }
  }, [feedback]);

  const selectedTable = useMemo(
    () =>
      displayTables.find((table) => table.id === selectedTableId) ?? null,
    [displayTables, selectedTableId],
  );
  const swappableTables = useMemo(
    () => displayTables.filter((table) => table.id !== selectedTableId),
    [displayTables, selectedTableId],
  );
  // 改選別張桌子、或所選對象被刪掉時，這個選擇就自動失效——用推導的而不是
  // 在 effect 裡重設，才不會多一次渲染，也不會有一瞬間套用到別張桌子。
  const effectiveSwapSelectionId = swappableTables.some(
    (table) => table.id === swapSelectionId,
  )
    ? swapSelectionId
    : "";

  /** 指標位置換算成場地座標，未吸附。判斷要不要交換時必須用這個原始落點。 */
  function pointToCoordinate(clientX: number, clientY: number) {
    const board = boardRef.current;
    if (!board) return null;
    const bounds = coordinateBounds(board);
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return clampSeatingFloorPlanCoordinateToSafeBounds(
      seatingFloorPlanBoardPointToCoordinate(
        { x: clientX, y: clientY },
        bounds,
      ),
      metrics,
    );
  }

  function otherPositions(draggedTableId: string) {
    return Object.entries(drafts)
      .filter(([tableId]) => tableId !== draggedTableId)
      .map(([tableId, position]) => ({
        tableId,
        x: position.x,
        y: position.y,
        source: position.source,
      }));
  }

  /**
   * 吸附到版面席位，桌子才不會因為拖曳而歪掉。其他桌目前佔住的席位要
   * 排除，否則會吸到一個放不下的位置，預覽就停在原地不動。
   */
  function snapToLayout(
    coordinate: SeatingFloorPlanCoordinate,
    draggedTableId: string,
  ) {
    return clampSeatingFloorPlanCoordinateToSafeBounds(
      snapSeatingFloorPlanCoordinate(
        coordinate,
        metrics,
        otherPositions(draggedTableId),
      ),
      metrics,
    );
  }

  function swapTargetAt(
    coordinate: SeatingFloorPlanCoordinate,
    draggedTableId: string,
  ) {
    return findSeatingFloorPlanSwapTarget(
      coordinate,
      otherPositions(draggedTableId),
      metrics,
    );
  }

  function optimisticPosition(
    table: SeatingFloorPlanTable,
    layoutX: number | null,
    layoutY: number | null,
  ) {
    setDraftOverrides((currentOverrides) => {
      const current = mergeDraftPositions(baseDrafts, currentOverrides);
      const virtualTables = tables.map((candidate) => {
        const draft = current[candidate.id];
        return candidate.id === table.id
          ? { ...candidate, layoutX, layoutY }
          : {
              ...candidate,
              layoutX: draft ? draft.layoutX : candidate.layoutX,
              layoutY: draft ? draft.layoutY : candidate.layoutY,
            };
      });
      try {
        const resolved = new Map(
          resolveSeatingFloorPlanPositions(virtualTables).map((position) => [
            position.tableId,
            position,
          ]),
        );
        return Object.fromEntries(
          virtualTables.map((candidate) => {
            const position = resolved.get(candidate.id);
            if (!position) throw new Error("Missing floor-plan position.");
            return [
              candidate.id,
              {
                ...current[candidate.id],
                x: position.x,
                y: position.y,
                source: position.source,
                layoutX: candidate.layoutX,
                layoutY: candidate.layoutY,
              },
            ];
          }),
        );
      } catch {
        return currentOverrides;
      }
    });
  }

  function persistPosition(
    table: SeatingFloorPlanTable,
    layoutX: number | null,
    layoutY: number | null,
  ) {
    if (isPending) return;
    const expectedVersion = drafts[table.id]?.version ?? table.version;
    optimisticPosition(table, layoutX, layoutY);
    const formData = new FormData();
    formData.set("layoutX", layoutX === null ? "" : String(layoutX));
    formData.set("layoutY", layoutY === null ? "" : String(layoutY));
    formData.set("expectedVersion", String(expectedVersion));

    startTransition(async () => {
      let result: SeatingTableMutationState;
      try {
        result = await updateSeatingTableLayoutAction(
          workspaceId,
          table.id,
          idleState,
          formData,
        );
      } catch {
        result = {
          status: "error",
          message: "目前無法更新場地位置，請稍後再試。",
        };
      }

      setFeedback(result);
      if (result.status === "success") {
        setDraftOverrides((currentOverrides) => {
          const current = mergeDraftPositions(baseDrafts, currentOverrides);
          return {
            ...currentOverrides,
            [table.id]: {
              ...current[table.id],
              version: expectedVersion + 1,
            },
          };
        });
      } else {
        setDraftOverrides({});
        router.refresh();
      }
    });
  }

  /**
   * 交換兩個固定桌位的桌名與入座賓客。桌號、座標、容量與備註不變；
   * 用戶端只做內容樂觀預覽，權威交換仍由伺服器依兩桌版本完成。
   */
  function persistSwap(
    table: SeatingFloorPlanTable,
    targetTableId: string,
  ) {
    if (isPending) return;
    const targetTable = displayTables.find(
      (candidate) => candidate.id === targetTableId,
    );
    const from = drafts[table.id];
    const to = drafts[targetTableId];
    if (!targetTable || !from || !to) return;
    const expectedVersion = from.version;
    const targetExpectedVersion = to.version;

    setContentOverrides((currentOverrides) => ({
      ...currentOverrides,
      [table.id]: {
        contentSnapshotKey,
        name: targetTable.name,
        guests: targetTable.guests,
      },
      [targetTableId]: {
        contentSnapshotKey,
        name: table.name,
        guests: table.guests,
      },
    }));

    const formData = new FormData();
    formData.set("targetTableId", targetTableId);
    formData.set("expectedVersion", String(expectedVersion));
    formData.set("targetExpectedVersion", String(targetExpectedVersion));

    startTransition(async () => {
      let result: SeatingTableMutationState;
      try {
        result = await swapSeatingTableContentsAction(
          workspaceId,
          table.id,
          idleState,
          formData,
        );
      } catch {
        result = {
          status: "error",
          message: "目前無法交換桌名與入座賓客，請稍後再試。",
        };
      }

      setFeedback(result);
      if (result.status === "success") {
        setDraftOverrides((currentOverrides) => {
          const current = mergeDraftPositions(baseDrafts, currentOverrides);
          return {
            ...currentOverrides,
            [table.id]: {
              ...current[table.id],
              version: expectedVersion + 1,
            },
            [targetTableId]: {
              ...current[targetTableId],
              version: targetExpectedVersion + 1,
            },
          };
        });
        router.refresh();
      } else {
        setContentOverrides({});
        setDraftOverrides({});
        router.refresh();
      }
    });
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    table: SeatingFloorPlanTable,
  ) {
    if (isPending || event.isPrimary === false || event.button > 0) return;
    onSelectTable?.(table.id);
    const board = boardRef.current;
    const current = drafts[table.id];
    if (!board || !current) return;
    const bounds = coordinateBounds(board);
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const renderedCenter = seatingFloorPlanCoordinateToBoardPoint(
      current,
      bounds,
    );
    dragRef.current = {
      tableId: table.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      grabOffsetClientX: event.clientX - renderedCenter.x,
      grabOffsetClientY: event.clientY - renderedCenter.y,
      moved: false,
      startOverrides: draftOverrides,
      startPositions: Object.fromEntries(
        Object.entries(drafts).map(([tableId, position]) => [
          tableId,
          { x: position.x, y: position.y },
        ]),
      ),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
    table: SeatingFloorPlanTable,
  ) {
    const drag = dragRef.current;
    if (!drag || drag.tableId !== table.id || drag.pointerId !== event.pointerId) {
      return;
    }
    if (
      !drag.moved &&
      (Math.abs(event.clientX - drag.startClientX) > 3 ||
        Math.abs(event.clientY - drag.startClientY) > 3)
    ) {
      drag.moved = true;
      setDraggingTableId(table.id);
    }
    if (!drag.moved) return;
    const coordinate = pointToCoordinate(
      event.clientX - drag.grabOffsetClientX,
      event.clientY - drag.grabOffsetClientY,
    );
    if (!coordinate) return;
    const swapTarget = swapTargetAt(coordinate, table.id);
    const draggedOrigin = drag.startPositions[table.id];
    const targetOrigin = swapTarget ? drag.startPositions[swapTarget] : null;
    if (swapTarget && draggedOrigin && targetOrigin) {
      // 交換是「兩張互換」而已，拖曳途中被擠開的其他桌次要先還原，預覽才
      // 等於放開後的結果。傳回同一個參照，React 會自己略過不必要的重繪。
      setDraftOverrides(drag.startOverrides);
      setSwapPreview((current) =>
        current?.draggedTableId === table.id &&
        current.targetTableId === swapTarget
          ? current
          : {
              draggedTableId: table.id,
              targetTableId: swapTarget,
              draggedTo: targetOrigin,
              targetTo: draggedOrigin,
            },
      );
      return;
    }
    setSwapPreview(null);
    // Drag preview shares the full-layout resolver with keyboard moves and
    // server writes. A rejected candidate leaves the last valid preview in
    // place instead of briefly painting one round table over another.
    const snapped = snapToLayout(coordinate, table.id);
    optimisticPosition(table, snapped.x, snapped.y);
  }

  function handlePointerUp(
    event: ReactPointerEvent<HTMLButtonElement>,
    table: SeatingFloorPlanTable,
  ) {
    const drag = dragRef.current;
    if (!drag || drag.tableId !== table.id || drag.pointerId !== event.pointerId) {
      return;
    }
    const moved =
      drag.moved ||
      Math.abs(event.clientX - drag.startClientX) > 3 ||
      Math.abs(event.clientY - drag.startClientY) > 3;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!moved) return;
    const coordinate = pointToCoordinate(
      event.clientX - drag.grabOffsetClientX,
      event.clientY - drag.grabOffsetClientY,
    );
    const swapTarget = coordinate ? swapTargetAt(coordinate, table.id) : null;
    setSwapPreview(null);
    setDraggingTableId(null);
    const draggedOrigin = drag.startPositions[table.id];
    const targetOrigin = swapTarget ? drag.startPositions[swapTarget] : null;
    if (swapTarget && draggedOrigin && targetOrigin) {
      // 桌位保持原狀，放開後只提交兩桌的內容交換。
      setDraftOverrides(drag.startOverrides);
      persistSwap(table, swapTarget);
      return;
    }
    if (coordinate) {
      const snapped = snapToLayout(coordinate, table.id);
      persistPosition(table, snapped.x, snapped.y);
    }
  }

  function cancelPointerDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    table: SeatingFloorPlanTable,
  ) {
    const drag = dragRef.current;
    if (drag?.tableId !== table.id) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setSwapPreview(null);
    setDraggingTableId(null);
    // 還原成拖曳前的版面，而不是清空：清空會連同先前已經存檔成功的樂觀
    // 位置一起丟掉，那些桌子會倒退回還沒重新驗證的伺服器座標。
    setDraftOverrides(drag.startOverrides);
  }

  /** 目前有幾桌是手動擺的。樂觀預覽也算進去，按鈕的可用狀態才會即時。 */
  const persistedDraftCount = tables.filter((table) => {
    const draft = drafts[table.id];
    const layoutX = draft ? draft.layoutX : table.layoutX;
    const layoutY = draft ? draft.layoutY : table.layoutY;
    return layoutX !== null || layoutY !== null;
  }).length;

  /**
   * 全部還原自動排列。這是絕對語意，不送逐桌版本；伺服器只會動到還有
   * 手動座標的桌次，成功後把那些桌次的版本樂觀加一，之後的單桌操作
   * 才不會拿舊版本去撞 CAS。
   */
  function persistResetAll() {
    if (isPending) return;
    setIsConfirmingResetAll(false);
    const resetTableIds = tables
      .filter((table) => {
        const draft = drafts[table.id];
        const layoutX = draft ? draft.layoutX : table.layoutX;
        const layoutY = draft ? draft.layoutY : table.layoutY;
        return layoutX !== null || layoutY !== null;
      })
      .map((table) => table.id);
    if (resetTableIds.length === 0) return;

    // 樂觀預覽：整張圖立刻回到自動排列，不等伺服器。
    setDraftOverrides((currentOverrides) => {
      const current = mergeDraftPositions(baseDrafts, currentOverrides);
      const virtualTables = tables.map((candidate) => ({
        ...candidate,
        layoutX: null,
        layoutY: null,
      }));
      try {
        const resolved = new Map(
          resolveSeatingFloorPlanPositions(virtualTables).map((position) => [
            position.tableId,
            position,
          ]),
        );
        return Object.fromEntries(
          tables.map((candidate) => {
            const position = resolved.get(candidate.id);
            if (!position) throw new Error("Missing floor-plan position.");
            return [
              candidate.id,
              {
                ...current[candidate.id],
                x: position.x,
                y: position.y,
                source: position.source,
                layoutX: null,
                layoutY: null,
              },
            ];
          }),
        );
      } catch {
        return currentOverrides;
      }
    });

    startTransition(async () => {
      let result: SeatingTableMutationState;
      try {
        result = await resetSeatingTableLayoutsAction(
          workspaceId,
          idleState,
          new FormData(),
        );
      } catch {
        result = {
          status: "error",
          message: "目前無法還原自動排列，請稍後再試。",
        };
      }

      setFeedback(result);
      if (result.status === "success") {
        setDraftOverrides((currentOverrides) => {
          const current = mergeDraftPositions(baseDrafts, currentOverrides);
          return {
            ...currentOverrides,
            ...Object.fromEntries(
              resetTableIds
                .filter((tableId) => current[tableId])
                .map((tableId) => [
                  tableId,
                  { ...current[tableId], version: current[tableId].version + 1 },
                ]),
            ),
          };
        });
      } else {
        setDraftOverrides({});
        router.refresh();
      }
    });
  }

  function moveSelected(deltaX: number, deltaY: number) {
    if (!selectedTable) return;
    const current = drafts[selectedTable.id];
    if (!current) return;
    const candidate = clampSeatingFloorPlanCoordinateToSafeBounds(
      { x: current.x + deltaX, y: current.y + deltaY },
      metrics,
    );
    persistPosition(selectedTable, candidate.x, candidate.y);
  }

  return (
    <section aria-labelledby="floor-plan-heading" className="min-w-0">
      <div className="flex min-h-11 flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-eyebrow font-semibold text-clay uppercase">
            宴會場地
          </p>
          <h2
            id="floor-plan-heading"
            className="mt-1 font-serif text-title font-semibold text-ink"
          >
            場地配置
          </h2>
        </div>
        <p className="text-caption leading-6 text-ink-soft">
          {canEdit
            ? "拖曳圓桌可調整位置；壓在另一桌時，桌號與位置固定，只交換桌名與入座賓客。"
            : "桌名與入席人數依目前配置顯示。"}
        </p>
      </div>

      {canEdit ? (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          {isConfirmingResetAll ? (
            <>
              <p className="min-w-0 text-caption font-semibold text-ink">
                {`確定把 ${persistedDraftCount} 桌的手動位置清除，並依桌號重新排列？這個動作無法復原。`}
              </p>
              <button
                type="button"
                disabled={isPending}
                onClick={persistResetAll}
                className="inline-flex min-h-11 items-center justify-center rounded-control border border-danger/40 bg-surface px-3.5 text-sm font-semibold text-danger hover:border-danger hover:bg-danger-soft disabled:opacity-60"
              >
                確定重新排列
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingResetAll(false)}
                className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink-soft hover:bg-clay-soft disabled:opacity-60"
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending || persistedDraftCount === 0}
              onClick={() => setIsConfirmingResetAll(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-3.5 text-sm font-semibold text-clay-strong hover:bg-clay-soft disabled:opacity-60"
            >
              依桌號重新排列
            </button>
          )}
        </div>
      ) : null}

      <div
        data-floor-plan-scroll
        className="mt-4 max-w-full overflow-x-auto pb-2"
      >
        <div
          ref={boardRef}
          data-testid="seating-floor-plan-board"
          data-board-height={metrics.boardHeightPx}
          data-board-min-width={metrics.boardMinWidthPx}
          data-marker-size={metrics.markerSizePx}
          role="region"
          aria-label="宴會場地配置"
          className="relative w-full rounded-card border border-line-strong bg-surface-sunken/45 shadow-card"
          style={{
            // Include the border in the minimum width. Otherwise a w-full
            // content box grows two pixels beyond its scroll container on a
            // wide screen and advertises a needless horizontal scrollbar.
            boxSizing: "border-box",
            minWidth: `${metrics.boardMinWidthPx}px`,
            height: `${metrics.boardHeightPx}px`,
          }}
        >
          {/*
            場地裝飾全部用設計系統的色票：先前的 rose／sky／amber 是 Tailwind
            預設調色盤，和整站的暖陶色系對不起來，圓桌壓上去就顯得雜亂。
          */}
          <div
            role="img"
            aria-label="舞台"
            className="absolute top-[3%] left-[24%] grid h-[10%] w-[52%] place-items-center rounded-control border border-line-strong bg-paper-deep font-serif font-semibold text-ink-soft"
          >
            舞台
          </div>
          {/*
            兩側座位區是中性色，也不再標「女方親友」「男方親友」：桌次沒有
            關係欄位，自動排列只依桌號先排左區再排右區，位置跟賓客是誰毫無
            關聯。把側別寫死在背景上，等於保證有些桌會被標錯邊。
            每一桌實際屬於哪一邊，改標在圓桌本身，由入座賓客推得。
          */}
          <div
            aria-hidden="true"
            className="absolute top-[20%] bottom-[5%] left-[3%] w-[37%] rounded-card border border-line bg-surface-sunken/60"
          />
          <div
            aria-hidden="true"
            className="absolute top-[20%] right-[3%] bottom-[5%] w-[37%] rounded-card border border-line bg-surface-sunken/60"
          />
          {/*
            動線從主桌下緣才開始：主桌固定在 (500, 220)，換算後佔到約 33%，
            動線若從 20% 起跳就會被主桌壓住一截。
          */}
          {/*
            書寫方向放在內層的 span：vertical-rl 會把 logical inline 軸轉成
            垂直，border-x 就會畫到上下緣，虛線變成兩截橫線。
          */}
          <div
            role="img"
            aria-label="中央動線"
            className="absolute top-[36%] bottom-[5%] left-1/2 grid w-[10%] -translate-x-1/2 place-items-center border-x border-dashed border-line-strong"
          >
            <span className="text-caption font-semibold text-ink-faint [writing-mode:vertical-rl]">
              中央動線
            </span>
          </div>

          {tables.map((table) => {
            const draft = drafts[table.id];
            if (!draft) return null;
            const displayTable =
              displayTables.find((candidate) => candidate.id === table.id) ?? table;
            const previewSourceId =
              swapPreview?.draggedTableId === table.id
                ? swapPreview.targetTableId
                : swapPreview?.targetTableId === table.id
                  ? swapPreview.draggedTableId
                  : null;
            const previewSource = previewSourceId
              ? displayTables.find((candidate) => candidate.id === previewSourceId)
              : null;
            const contentTable = previewSource
              ? {
                  ...displayTable,
                  name: previewSource.name,
                  guests: previewSource.guests,
                }
              : displayTable;
            const assignedPartySize = occupancy(contentTable);
            const isSelected = canEdit && selectedTableId === table.id;
            const side = seatingTableSide(contentTable.guests);
            const label = `${seatingTableLabel(contentTable)}，${
              side ? `${GUEST_SIDE_LABELS[side]}，` : ""
            }已安排 ${assignedPartySize} / ${contentTable.capacity} 位`;
            // 交換時固定桌位不移動，只預覽對方的桌名與入座賓客。
            const rendered = draft;
            const isSwapPreview =
              swapPreview?.draggedTableId === table.id ||
              swapPreview?.targetTableId === table.id;
            const followsPointer =
              draggingTableId === table.id && !isSwapPreview;
            const boardPercent =
              seatingFloorPlanCoordinateToBoardPercent(rendered);
            const isDense = metrics.markerSizePx <= 64;
            const isMaximumDensity = metrics.markerSizePx === 44;
            return (
              <article
                key={table.id}
                aria-label={label}
                data-layout-source={draft.source}
                data-layout-x={rendered.x}
                data-layout-y={rendered.y}
                data-swap-target={
                  swapPreview?.targetTableId === table.id ? "true" : undefined
                }
                className={cn(
                  "absolute z-10 grid min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 bg-surface text-center shadow-card",
                  followsPointer
                    ? "transition-[box-shadow]"
                    : "transition-[box-shadow,left,top] duration-200 ease-out motion-reduce:transition-[box-shadow]",
                  // 拖曳中壓住的那一張要看得出來「放開會跟它換」。
                  swapPreview?.targetTableId === table.id
                    ? "border-dashed border-clay ring-4 ring-clay/35"
                    : isSelected
                      ? "border-clay ring-4 ring-clay/20"
                      : "border-line-strong",
                )}
                style={{
                  left: `${boardPercent.x}%`,
                  top: `${boardPercent.y}%`,
                  width: `${metrics.markerSizePx}px`,
                  height: `${metrics.markerSizePx}px`,
                }}
              >
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`選取並移動 ${seatingTableLabel(contentTable)}`}
                    title={label}
                    aria-pressed={isSelected}
                    disabled={isPending}
                    className={cn(
                      "grid size-full min-h-11 min-w-11 touch-none place-content-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2",
                      isDense ? "px-0.5" : "px-2",
                    )}
                    onClick={() => onSelectTable?.(table.id)}
                    onPointerDown={(event) => handlePointerDown(event, displayTable)}
                    onPointerMove={(event) => handlePointerMove(event, displayTable)}
                    onPointerUp={(event) => handlePointerUp(event, displayTable)}
                    onPointerCancel={(event) => cancelPointerDrag(event, displayTable)}
                  >
                    <MarkerContent
                      table={contentTable}
                      side={side}
                      assignedPartySize={assignedPartySize}
                      isDense={isDense}
                      isMaximumDensity={isMaximumDensity}
                    />
                  </button>
                ) : (
                  <div
                    title={label}
                    className={cn(
                      "grid size-full place-content-center",
                      isDense ? "px-0.5" : "px-2",
                    )}
                  >
                    <MarkerContent
                      table={contentTable}
                      side={side}
                      assignedPartySize={assignedPartySize}
                      isDense={isDense}
                      isMaximumDensity={isMaximumDensity}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      {canEdit && selectedTable ? (
        <div
          role="group"
          aria-label={`${seatingTableLabel(selectedTable)}位置調整`}
          className="mt-4 flex min-w-0 flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-4 py-3"
        >
          <p className="mr-1 min-w-0 flex-1 text-caption font-semibold break-words text-ink">
            已選取：{seatingTableLabel(selectedTable)}
          </p>
          {[
            ["上", 0, -DIRECTION_STEP],
            ["下", 0, DIRECTION_STEP],
            ["左", -DIRECTION_STEP, 0],
            ["右", DIRECTION_STEP, 0],
          ].map(([label, deltaX, deltaY]) => (
            <button
              key={String(label)}
              type="button"
              aria-label={`將 ${seatingTableLabel(selectedTable)} 向${label}移動`}
              disabled={isPending}
              onClick={() => moveSelected(Number(deltaX), Number(deltaY))}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-line-strong bg-surface px-3 text-sm font-semibold text-clay-strong hover:bg-clay-soft disabled:opacity-60"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label={`還原 ${seatingTableLabel(selectedTable)} 自動排列`}
            disabled={isPending || drafts[selectedTable.id]?.source === "automatic"}
            onClick={() => persistPosition(selectedTable, null, null)}
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-3.5 text-sm font-semibold text-clay-strong hover:bg-clay-soft disabled:opacity-60"
          >
            還原自動排列
          </button>
          {/*
            交換不能只有拖曳一種做法：鍵盤與輔助技術的使用者拖不動圓桌。
            這一組選單＋按鈕是同一個伺服器動作的等價入口。
          */}
          {swappableTables.length > 0 ? (
            <div className="flex min-w-0 basis-full flex-col gap-2 border-t border-line pt-3 @sm:flex-row @sm:items-center">
              <label
                htmlFor={swapSelectId}
                className="shrink-0 text-caption font-semibold text-ink-soft"
              >
                與其他桌交換桌名與賓客
              </label>
              <select
                id={swapSelectId}
                value={effectiveSwapSelectionId}
                disabled={isPending}
                onChange={(event) => setSwapSelectionId(event.target.value)}
                className="min-h-11 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-3 text-sm text-ink disabled:opacity-60"
              >
                <option value="">請選擇桌次</option>
                {swappableTables.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {seatingTableLabel(candidate)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`交換 ${seatingTableLabel(selectedTable)} 與所選桌次的桌名與入座賓客`}
                disabled={isPending || effectiveSwapSelectionId === ""}
                onClick={() => {
                  persistSwap(selectedTable, effectiveSwapSelectionId);
                  setSwapSelectionId("");
                }}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface px-3.5 text-sm font-semibold text-clay-strong hover:bg-clay-soft disabled:opacity-60"
              >
                交換桌名與賓客
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {canEdit && feedback.status !== "idle" ? (
        <p
          ref={feedbackRef}
          role={feedback.status === "error" ? "alert" : "status"}
          tabIndex={-1}
          className={cn(
            "mt-3 rounded-control border px-3.5 py-2.5 text-caption leading-6 outline-none",
            feedback.status === "error"
              ? "border-danger/30 bg-danger-soft text-danger"
              : "border-positive/30 bg-positive-soft text-positive",
          )}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}
