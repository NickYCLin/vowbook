"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AdjustSeatingTablesForm,
  AssignGuestForm,
  CreateSeatingTableForm,
  DeleteSeatingTableForm,
  EditSeatingTableForm,
  UnassignGuestForm,
  type AssignGuestIntent,
  type DeleteSeatingTableIntent,
  type DeleteSeatingTableIntentRejection,
  type SeatingGuestIntentRejection,
  type UnassignGuestIntent,
} from "./table-forms";
import {
  EditGuestPartySizeForm,
  type UnassignedSeatingGuest,
} from "./guest-party-size-form";
import { SeatingFloorPlan } from "./seating-floor-plan";
import { Badge, BadgeDot, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/stat";
import {
  GUEST_SIDE_LABELS,
  guestIdentityLabel,
  type GuestSideValue,
} from "@/domain/guest";
import { seatingTableLabel, seatingTableSide } from "@/domain/seating-table";
import { cn } from "@/lib/class-names";

/** 沿用場地圖的側別配色：男方偏 sage、女方偏 clay、共同親友用中性色。 */
const SIDE_BADGE_TONES = {
  PARTNER_A: "sage",
  PARTNER_B: "brand",
  SHARED: "neutral",
} as const satisfies Record<GuestSideValue, BadgeTone>;

type SeatingGuest = {
  id: string;
  name: string;
  partySize: number;
  side: GuestSideValue;
};

type SeatingTableItem = {
  id: string;
  /** 印在桌卡上的桌號。由順位推導，不是資料庫欄位。 */
  number: number;
  position: number;
  version: number;
  layoutX: number | null;
  layoutY: number | null;
  name: string;
  capacity: number;
  notes: string | null;
  guests: SeatingGuest[];
};

type PendingSeatingMove =
  | (AssignGuestIntent & {
      operation: "assign";
      sourceTables: SeatingTableItem[];
      sourceUnassignedGuests: UnassignedSeatingGuest[];
    })
  | (UnassignGuestIntent & {
      operation: "unassign";
      sourceTables: SeatingTableItem[];
      sourceUnassignedGuests: UnassignedSeatingGuest[];
    });

type PendingSeatingDelete = DeleteSeatingTableIntent & {
  sourceTables: SeatingTableItem[];
};

export function SeatingPlan({
  workspaceId,
  tables,
  unassignedGuests,
  canEdit,
}: {
  workspaceId: string;
  tables: SeatingTableItem[];
  unassignedGuests: UnassignedSeatingGuest[];
  canEdit: boolean;
}) {
  const [pendingMove, setPendingMove] = useState<PendingSeatingMove | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] =
    useState<PendingSeatingDelete | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(() =>
    canEdit ? (tables[0]?.id ?? null) : null,
  );
  const moveStatusRef = useRef<HTMLParagraphElement>(null);
  const partnerAHeadingId = useId();
  const partnerBHeadingId = useId();
  const sharedHeadingId = useId();

  const handleAssignIntent = useCallback((intent: AssignGuestIntent) => {
    setPendingDelete(null);
    setPendingMove({
      operation: "assign",
      ...intent,
      sourceTables: tables,
      sourceUnassignedGuests: unassignedGuests,
    });
  }, [tables, unassignedGuests]);

  const handleUnassignIntent = useCallback((intent: UnassignGuestIntent) => {
    setPendingDelete(null);
    setPendingMove({
      operation: "unassign",
      ...intent,
      sourceTables: tables,
      sourceUnassignedGuests: unassignedGuests,
    });
  }, [tables, unassignedGuests]);

  const handleIntentRejected = useCallback(
    (rejection: SeatingGuestIntentRejection) => {
      setPendingMove((current) =>
        current?.operation === rejection.operation &&
        current.guestId === rejection.guestId
          ? null
          : current,
      );
    },
    [],
  );

  const handleDeleteIntent = useCallback(
    (intent: DeleteSeatingTableIntent) => {
      setPendingMove(null);
      setPendingDelete({
        ...intent,
        sourceTables: tables,
      });
    },
    [tables],
  );

  const handleDeleteIntentRejected = useCallback(
    (rejection: DeleteSeatingTableIntentRejection) => {
      setPendingDelete((current) =>
        current?.tableId === rejection.tableId ? null : current,
      );
    },
    [],
  );

  const guestMoveAnnouncement = (() => {
    if (
      !pendingMove ||
      (pendingMove.sourceTables === tables &&
        pendingMove.sourceUnassignedGuests === unassignedGuests)
    ) {
      return "";
    }
    const guestIsUnassigned = unassignedGuests.some(
      (guest) => guest.id === pendingMove.guestId,
    );
    const assignedTable = tables.find((table) =>
      table.guests.some((guest) => guest.id === pendingMove.guestId),
    );

    if (
      pendingMove.operation === "assign" &&
      assignedTable?.id === pendingMove.tableId &&
      !guestIsUnassigned
    ) {
      return `已將${pendingMove.guestName}安排至 ${pendingMove.tableName}。`;
    }
    if (
      pendingMove.operation === "unassign" &&
      guestIsUnassigned &&
      !assignedTable
    ) {
      return `已將${pendingMove.guestName}移出桌次。`;
    }
    return "";
  })();
  const deleteAnnouncement =
    pendingDelete &&
    pendingDelete.sourceTables !== tables &&
    !tables.some((table) => table.id === pendingDelete.tableId)
      ? `已刪除空桌 ${pendingDelete.tableName}。`
      : "";
  const moveAnnouncement = deleteAnnouncement || guestMoveAnnouncement;

  useEffect(() => {
    if (moveAnnouncement) {
      // preventScroll 是必要的：這行狀態列在整頁最上方，安排完賓客後聚焦
      // 會把畫面捲回頂端，使用者得重新捲到剛才那筆。aria-live 已經負責朗讀，
      // 聚焦只是為了讓鍵盤使用者能接著讀，不該連帶搬動視窗。
      moveStatusRef.current?.focus({ preventScroll: true });
    }
  }, [moveAnnouncement]);

  const assignedGuestCount = tables.reduce(
    (total, table) => total + table.guests.length,
    0,
  );
  const tableOptions = tables.map((table) => ({
    id: table.id,
    // 選單一定要帶桌號：好幾桌都叫「男方同事」時，只列桌名選不出是哪一桌。
    name: seatingTableLabel(table),
    remainingCapacity:
      table.capacity -
      table.guests.reduce((total, guest) => total + guest.partySize, 0),
  }));
  const unassignedGuestsBySide = {
    PARTNER_A: unassignedGuests.filter(
      (guest) => guest.side === "PARTNER_A",
    ),
    PARTNER_B: unassignedGuests.filter(
      (guest) => guest.side === "PARTNER_B",
    ),
    SHARED: unassignedGuests.filter((guest) => guest.side === "SHARED"),
  } satisfies Record<GuestSideValue, UnassignedSeatingGuest[]>;
  const sideHeadingIds = {
    PARTNER_A: partnerAHeadingId,
    PARTNER_B: partnerBHeadingId,
    SHARED: sharedHeadingId,
  } satisfies Record<GuestSideValue, string>;
  const effectiveSelectedTableId = canEdit
    ? tables.some((table) => table.id === selectedTableId)
      ? selectedTableId
      : (tables[0]?.id ?? null)
    : null;
  const displayedTables = canEdit
    ? tables.filter((table) => table.id === effectiveSelectedTableId)
    : tables;

  function renderUnassignedGuestGroup(side: GuestSideValue) {
    const guests = unassignedGuestsBySide[side];
    const label = GUEST_SIDE_LABELS[side];

    return (
      <section
        key={side}
        data-unassigned-side={side}
        aria-labelledby={sideHeadingIds[side]}
        className={cn(
          "@container min-w-0",
          side === "SHARED" && "@lg:col-span-2",
        )}
      >
        {/* 側別是分段標題，不是另一張卡片；卡中卡會讓窄側欄變成三層外框。 */}
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-y border-line bg-surface-sunken/60 px-3 py-2.5">
          <h3
            id={sideHeadingIds[side]}
            className="min-w-0 text-caption font-semibold break-words text-ink-soft"
          >
            {label}
          </h3>
          <p className="shrink-0 text-caption text-ink-faint tabular-nums">
            {guests.length} 筆
          </p>
        </div>

        {guests.length === 0 ? (
          <p className="px-3 py-3.5 text-caption leading-6 break-words text-ink-faint">
            目前沒有{label}待安排。
          </p>
        ) : (
          <ul className="min-w-0 divide-y divide-line">
            {guests.map((guest) => (
              <li key={guest.id} className="min-w-0 px-3 py-3.5">
                {/* 姓名獨立一行，人數控制項才不會因為姓名長短忽上忽下。 */}
                <p className="min-w-0 text-caption font-medium break-words text-ink">
                  {guest.name}
                </p>
                {guest.category !== "GUEST" ? (
                  <p className="mt-1 text-caption font-semibold text-clay-strong">
                    {guestIdentityLabel(guest.category, guest.side)}
                  </p>
                ) : null}
                {canEdit ? (
                  <EditGuestPartySizeForm
                    workspaceId={workspaceId}
                    guest={guest}
                  />
                ) : (
                  <p className="mt-1 text-caption text-ink-soft tabular-nums">
                    邀請人數 {guest.partySize} 位
                  </p>
                )}
                {canEdit && tables.length > 0 && (
                  <AssignGuestForm
                    workspaceId={workspaceId}
                    guestId={guest.id}
                    guestName={guest.name}
                    guestPartySize={guest.partySize}
                    tables={tableOptions}
                    onAssignIntent={handleAssignIntent}
                    onIntentRejected={handleIntentRejected}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="mt-6 min-w-0">
      {canEdit && (
        <p
          ref={moveStatusRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          tabIndex={-1}
          className={cn(
            "mb-5 min-w-0 rounded-control border px-3.5 py-2.5 text-caption leading-6 break-words outline-none",
            // 沒有結果時這行只是預留位置，不該搶走整頁的視覺重量。
            moveAnnouncement
              ? "border-positive/30 bg-positive-soft font-medium text-positive"
              : "border-dashed border-line bg-surface/60 text-ink-faint",
          )}
        >
          {moveAnnouncement || "桌次安排結果會顯示於此。"}
        </p>
      )}
      {canEdit && (
        <AdjustSeatingTablesForm
          workspaceId={workspaceId}
          currentTableCount={tables.length}
        />
      )}
      {tables.length > 0 && (
        <SeatingFloorPlan
          workspaceId={workspaceId}
          tables={tables}
          canEdit={canEdit}
          selectedTableId={effectiveSelectedTableId}
          onSelectTable={canEdit ? setSelectedTableId : undefined}
        />
      )}
      <div
        data-seating-layout="floor-plan-first"
        className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2fr)] lg:items-start lg:gap-x-6"
      >
        <section aria-labelledby="unassigned-heading" className="@container min-w-0">
          <Card>
            <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-3.5 py-3">
              <h2
                id="unassigned-heading"
                className="font-serif text-title font-semibold text-ink"
              >
                未安排賓客
              </h2>
              <p
                aria-live="polite"
                aria-atomic="true"
                className="text-caption text-ink-soft tabular-nums"
              >
                {unassignedGuests.length} 筆
              </p>
            </div>

            {unassignedGuests.length === 0 ? (
              <p className="px-3.5 py-6 text-caption leading-6 text-ink-soft">
                {assignedGuestCount > 0
                  ? "所有賓客都已安排桌次。"
                  : "目前也沒有可安排的賓客。"}
              </p>
            ) : (
              <>
                {tables.length === 0 && (
                  <p className="border-b border-line px-3.5 py-4 text-caption leading-6 text-ink-soft">
                    請先建立桌次，再安排未入席賓客。
                  </p>
                )}
                {/*
                  男、女方在夠寬時同列左右展示，共同親友獨佔下一列；
                  未安排區在 lg 版面只有 ~300px，硬切兩欄會讓每組剩不到
                  150px，選單被壓成一個箭頭、人數與「更新」也會各佔一行。
                  斷點看的是這一區的欄寬（@container），不是視窗寬度。
                */}
                <div
                  data-unassigned-side-grid
                  className="grid min-w-0 grid-cols-1 @lg:grid-cols-2"
                >
                  {renderUnassignedGuestGroup("PARTNER_A")}
                  {renderUnassignedGuestGroup("PARTNER_B")}
                  {renderUnassignedGuestGroup("SHARED")}
                </div>
              </>
            )}
          </Card>
        </section>

        <section aria-labelledby="tables-heading" className="min-w-0" data-table-inspector>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <h2
              id="tables-heading"
              className="font-serif text-title font-semibold text-ink"
            >
              桌次明細
            </h2>
            {tables.length > 0 && (
              <p className="text-caption text-ink-soft tabular-nums">
                共 {tables.length} 桌
              </p>
            )}
          </div>

          {tables.length === 0 ? (
            canEdit ? (
              // 這裡不能出現「目前還沒有桌次。」——那句是唯讀成員專用的說法。
              <div className="mt-4 min-w-0 rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
                <p className="font-serif text-title font-semibold text-ink">
                  還沒有任何桌次
                </p>
                <p className="mx-auto mt-2 max-w-md text-caption leading-6 text-ink-soft">
                  可以先用上方的桌數設定一次建立多桌，或從這裡新增一張桌子。
                </p>
                <div className="mt-5 flex justify-center">
                  <CreateSeatingTableForm workspaceId={workspaceId} />
                </div>
              </div>
            ) : (
              <EmptyState
                className="mt-4"
                title="目前還沒有桌次。"
                description="可以編輯此工作區的成員尚未建立桌次。"
              />
            )
          ) : (
            <>
              <div className="mt-4 min-w-0 space-y-4">
                {displayedTables.map((table) => {
                  const assignedPartySize = table.guests.reduce(
                    (total, guest) => total + guest.partySize,
                    0,
                  );
                  const isOverCapacity = assignedPartySize > table.capacity;
                  const side = seatingTableSide(table.guests);

                  return (
                    <Card key={table.id}>
                      <article className="min-w-0 px-5 py-5 sm:px-6">
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
                          {/*
                            aria-label 是必要的：桌號與桌名分成兩個 span，
                            拼出來的無障礙名稱會黏成「1號桌主桌」。
                          */}
                          <h3
                            aria-label={seatingTableLabel(table)}
                            className="flex min-w-0 flex-1 items-baseline gap-2 font-serif text-title font-semibold text-ink"
                          >
                            <span className="shrink-0 tabular-nums text-clay-strong">
                              {table.number}
                              <span className="ml-0.5 font-sans text-caption font-semibold">
                                號桌
                              </span>
                            </span>
                            <span className="min-w-0 break-words">
                              {table.name}
                            </span>
                          </h3>
                          {/* 這一桌屬於哪一邊，是從入座賓客推得的，不是設定值。 */}
                          {side ? (
                            <Badge tone={SIDE_BADGE_TONES[side]}>
                              <BadgeDot />
                              {GUEST_SIDE_LABELS[side]}
                            </Badge>
                          ) : null}
                          <p
                            aria-live="polite"
                            aria-atomic="true"
                            className={`shrink-0 text-caption font-semibold tabular-nums ${
                              isOverCapacity ? "text-danger" : "text-clay-strong"
                            }`}
                          >
                            已安排 {assignedPartySize} / {table.capacity} 位
                          </p>
                        </div>

                        <ProgressBar
                          className="mt-3"
                          label={`${seatingTableLabel(table)} 座位使用率`}
                          value={assignedPartySize}
                          max={table.capacity}
                          tone={isOverCapacity ? "danger" : "brand"}
                        />

                        {table.notes && (
                          <p className="mt-3 text-caption leading-6 break-words whitespace-pre-wrap text-ink-soft">
                            {table.notes}
                          </p>
                        )}

                        <div className="mt-4 border-t border-line pt-4">
                          <h4 className="text-eyebrow font-semibold text-ink-soft uppercase">
                            已安排賓客
                          </h4>
                          {table.guests.length === 0 ? (
                            <p className="mt-2 text-caption leading-6 text-ink-faint">
                              這桌目前還沒安排賓客。
                            </p>
                          ) : (
                            <ul className="mt-2 min-w-0 divide-y divide-line">
                              {table.guests.map((guest) => (
                                <li
                                  key={guest.id}
                                  className="min-w-0 py-2.5 first:pt-0"
                                >
                                  <p className="text-caption font-medium break-words text-ink">
                                    {guest.name}・{guest.partySize} 位
                                  </p>
                                  {canEdit && (
                                    <UnassignGuestForm
                                      workspaceId={workspaceId}
                                      guestId={guest.id}
                                      guestName={guest.name}
                                      onUnassignIntent={handleUnassignIntent}
                                      onIntentRejected={handleIntentRejected}
                                    />
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {canEdit && (
                          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 border-t border-line pt-4">
                            <EditSeatingTableForm
                              workspaceId={workspaceId}
                              tableId={table.id}
                              tableLabel={seatingTableLabel(table)}
                              name={table.name}
                              capacity={table.capacity}
                              notes={table.notes}
                              version={table.version}
                            />
                            <DeleteSeatingTableForm
                              workspaceId={workspaceId}
                              tableId={table.id}
                              tableLabel={seatingTableLabel(table)}
                              onDeleteIntent={handleDeleteIntent}
                              onIntentRejected={handleDeleteIntentRejected}
                            />
                          </div>
                        )}
                      </article>
                    </Card>
                  );
                })}
                {canEdit && displayedTables.length === 0 ? (
                  <p className="rounded-card border border-dashed border-line-strong bg-surface/60 px-5 py-8 text-center text-caption leading-6 text-ink-soft">
                    請從場地配置選取要查看的桌次。
                  </p>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
