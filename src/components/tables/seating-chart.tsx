import Link from "next/link";
import {
  resolveSeatingFloorPlanPositions,
  seatingFloorPlanCoordinateToBoardPercent,
} from "@/domain/seating-floor-plan";
import { GUEST_SIDE_LABELS, GUEST_SIDE_SHORT_LABELS, type GuestSideValue } from "@/domain/guest";
import { seatingTableLabel, seatingTableSide } from "@/domain/seating-table";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/class-names";

export type SeatingChartTable = {
  id: string;
  number: number;
  position: number;
  name: string;
  layoutX: number | null;
  layoutY: number | null;
  guests: Array<{ side: GuestSideValue; childSeatCount?: number | null }>;
};

const SIDE_DOT_CLASSNAMES = {
  PARTNER_A: "bg-sage",
  PARTNER_B: "bg-clay",
  SHARED: "bg-ink-faint",
} as const satisfies Record<GuestSideValue, string>;

const SIDE_ORDER = ["PARTNER_A", "PARTNER_B", "SHARED"] as const;

/**
 * 桌圖是輸出品，尺寸由輸出載體決定（會館的直式看板、相片紙），不是瀏覽器
 * 視窗，所以所有字級與圓桌大小都用 cqw 對著海報寬度等比縮放：螢幕預覽
 * 420px 與印成 9 吋寬是同一張圖。分級門檻沿用場地圖的 112/80/64/44px
 * 四級（除以 960px 板寬換成百分比），位置安全距離的推導才能沿用。
 */
function chartDensity(tableCount: number) {
  if (tableCount <= 15) {
    return {
      marker: "w-[11.2cqw] h-[11.2cqw]",
      number: "text-[3cqw] leading-[1.1]",
      name: "text-[1.5cqw] leading-[1.25] line-clamp-2",
      dot: "size-[0.9cqw]",
      sideLabel: "text-[1.3cqw] leading-[1.2]",
      childSeats: "text-[1.05cqw] leading-[1.15]",
    };
  }
  if (tableCount <= 20) {
    return {
      marker: "w-[8.3cqw] h-[8.3cqw]",
      number: "text-[2.3cqw] leading-[1.1]",
      name: "text-[1.2cqw] leading-[1.25] line-clamp-1",
      dot: "size-[0.8cqw]",
      sideLabel: null,
      childSeats: "text-[0.9cqw] leading-[1.15]",
    };
  }
  if (tableCount <= 32) {
    return {
      marker: "w-[6.7cqw] h-[6.7cqw]",
      number: "text-[1.9cqw] leading-[1.1]",
      name: null,
      dot: "size-[0.7cqw]",
      sideLabel: null,
      childSeats: "text-[0.8cqw] leading-[1.15]",
    };
  }
  return {
    marker: "w-[4.5cqw] h-[4.5cqw]",
    number: "text-[1.4cqw] leading-[1.1]",
    name: null,
    dot: null,
    sideLabel: null,
    childSeats: null,
  };
}

export function SeatingChart({
  workspaceId,
  workspaceName,
  weddingDateLabel,
  tables,
}: {
  workspaceId: string;
  workspaceName: string;
  weddingDateLabel: string | null;
  tables: SeatingChartTable[];
}) {
  if (tables.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        title="還沒有桌次可以輸出"
        description="先到桌次安排建立桌次並調整場地圖，桌圖會用同一份配置輸出。"
        action={
          <Link
            href={`/workspaces/${workspaceId}/tables`}
            className={buttonClassName({ variant: "secondary" })}
          >
            前往桌次安排
          </Link>
        }
      />
    );
  }

  const positions = resolveSeatingFloorPlanPositions(tables);
  const density = chartDensity(tables.length);
  const sides = tables.map((table) => seatingTableSide(table.guests));
  const legendSides = SIDE_ORDER.filter((side) => sides.includes(side));

  return (
    <>
      <div
        data-testid="seating-chart-poster"
        // 列印時海報鋪滿整頁：@page 已固定成 9:16，比例交給紙張。
        className="@container relative mx-auto mt-6 aspect-[9/16] w-full max-w-105 overflow-hidden rounded-card border border-line-strong bg-paper shadow-card print:fixed print:inset-0 print:mt-0 print:aspect-auto print:h-full print:w-full print:max-w-none print:rounded-none print:border-0 print:shadow-none"
      >
        <header className="absolute inset-x-0 top-0 flex h-[12%] min-w-0 flex-col items-center justify-center gap-[0.6cqw] border-b border-line bg-surface/70 px-[6cqw] text-center">
          <p className="text-[1.8cqw] font-semibold tracking-[0.5em] text-clay-strong">
            婚宴桌次圖
          </p>
          <h3 className="min-w-0 max-w-full font-serif text-[4cqw] leading-[1.2] font-semibold break-words text-ink">
            {workspaceName}
          </h3>
          {weddingDateLabel ? (
            <p className="text-[1.8cqw] text-ink-soft">{weddingDateLabel}</p>
          ) : null}
        </header>

        <div className="absolute inset-x-[2.5%] top-[13%] bottom-[6%]">
          <div
            role="img"
            aria-label="舞台"
            className="absolute top-[1%] left-[24%] grid h-[7%] w-[52%] place-items-center rounded-control border border-line-strong bg-paper-deep font-serif text-[1.8cqw] font-semibold text-ink-soft"
          >
            舞台
          </div>
          {tables.map((table) => {
            const position = positions.find((item) => item.tableId === table.id);
            if (!position) return null;
            const percent = seatingFloorPlanCoordinateToBoardPercent(position);
            const side = seatingTableSide(table.guests);
            const childSeats = table.guests.reduce(
              (total, guest) =>
                total + Math.max(guest.childSeatCount ?? 0, 0),
              0,
            );
            return (
              <article
                key={table.id}
                aria-label={`${seatingTableLabel(table)}${
                  side ? `，${GUEST_SIDE_LABELS[side]}` : ""
                }${childSeats > 0 ? `，兒童椅 ${childSeats} 張` : ""}`}
                className={cn(
                  "absolute grid -translate-x-1/2 -translate-y-1/2 place-content-center gap-[0.2cqw] rounded-full border border-line-strong bg-surface px-[0.6cqw] text-center shadow-card",
                  density.marker,
                )}
                style={{ left: `${percent.x}%`, top: `${percent.y}%` }}
              >
                <span className={cn("font-semibold text-ink tabular-nums", density.number)}>
                  {table.number}
                </span>
                {density.name ? (
                  <span
                    className={cn(
                      "max-w-full font-medium break-words text-ink-soft",
                      density.name,
                    )}
                  >
                    {table.name}
                  </span>
                ) : null}
                {side && density.dot ? (
                  <span className="flex items-center justify-center gap-[0.5cqw]">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "shrink-0 rounded-full",
                        SIDE_DOT_CLASSNAMES[side],
                        density.dot,
                      )}
                    />
                    {density.sideLabel ? (
                      <span
                        className={cn(
                          "font-semibold text-ink-soft",
                          density.sideLabel,
                        )}
                      >
                        {GUEST_SIDE_SHORT_LABELS[side]}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {childSeats > 0 && density.childSeats ? (
                  <span
                    className={cn(
                      "font-semibold text-caution tabular-nums",
                      density.childSeats,
                    )}
                  >
                    兒童椅 {childSeats}
                  </span>
                ) : null}
              </article>
            );
          })}
        </div>

        <footer className="absolute inset-x-0 bottom-0 flex h-[5%] items-center justify-center gap-[3cqw] border-t border-line bg-surface/70 px-[4cqw] text-[1.6cqw] text-ink-soft">
          {legendSides.map((side) => (
            <span key={side} className="flex items-center gap-[0.7cqw] font-medium">
              <span
                aria-hidden="true"
                className={cn("size-[1cqw] rounded-full", SIDE_DOT_CLASSNAMES[side])}
              />
              {GUEST_SIDE_LABELS[side]}
            </span>
          ))}
          <span className="font-semibold tabular-nums">共 {tables.length} 桌</span>
        </footer>
      </div>
      {/*
        9:16 直式頁面（9in × 16in）。@page 沒辦法寫成 Tailwind class，
        跟著海報一起輸出，只影響列印。
      */}
      <style>{`@media print { @page { size: 228.6mm 406.4mm; margin: 0; } }`}</style>
    </>
  );
}
