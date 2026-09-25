"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Badge, BadgeDot } from "@/components/ui/badge";
import { GUEST_SIDE_SHORT_LABELS } from "@/domain/guest";
import { cn } from "@/lib/class-names";
import type { SeatingFloorPlanTable } from "./seating-floor-plan";

const CARD_WIDTH = 320;
const GAP = 12;
const EDGE = 12;
/** 比這窄就改成貼底的卡片，手指不會被桌子擋住。 */
const SHEET_BREAKPOINT = 640;

function placement(anchor: DOMRect, card: HTMLElement | null): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth < SHEET_BREAKPOINT) {
    return { left: EDGE, right: EDGE, bottom: EDGE };
  }
  const height = card?.offsetHeight ?? 240;
  // 優先放在桌子右邊，右邊放不下就放左邊。
  const right = anchor.right + GAP;
  const left =
    right + CARD_WIDTH <= viewportWidth - EDGE
      ? right
      : Math.max(EDGE, anchor.left - GAP - CARD_WIDTH);
  const top = Math.min(
    Math.max(EDGE, anchor.top + anchor.height / 2 - height / 2),
    Math.max(EDGE, viewportHeight - EDGE - height),
  );
  return { left, top, width: CARD_WIDTH };
}

export function SeatingTablePeek({
  table,
  anchor,
  canEdit,
  onClose,
  onOpenDetail,
}: {
  table: SeatingFloorPlanTable;
  /** 被點的圓桌；位置在捲動或縮放時重新量。 */
  anchor: HTMLElement;
  canEdit: boolean;
  onClose: () => void;
  onOpenDetail?: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const update = () => {
      if (!anchor.isConnected) return onClose();
      setStyle(placement(anchor.getBoundingClientRect(), cardRef.current));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, onClose, table.guests.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        anchor.focus({ preventScroll: true });
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || cardRef.current?.contains(target)) return;
      // 點到其他圓桌由圓桌自己換卡片，這裡不先關掉以免閃一下。
      if ((target as Element).closest?.("[data-floor-table-id]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [anchor, onClose]);

  const seated = table.guests.reduce((total, guest) => total + guest.partySize, 0);
  const vegetarian = table.guests.reduce((total, guest) => total + (guest.vegetarianCount ?? 0), 0);
  const childSeats = table.guests.reduce(
    (total, guest) => total + Math.max(guest.childSeatCount ?? 0, 0),
    0,
  );
  const isOver = seated > table.capacity;

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-labelledby={titleId}
      data-seating-table-peek={table.id}
      style={style}
      className="fixed z-50 flex max-h-[min(70dvh,32rem)] min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface text-left shadow-overlay"
    >
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 id={titleId} className="flex min-w-0 items-baseline gap-2 font-serif text-body font-semibold text-ink">
            <span className="shrink-0 tabular-nums text-clay-strong">
              {table.number}
              <span className="ml-0.5 font-sans text-caption font-semibold">號桌</span>
            </span>
            <span className="min-w-0 break-words">{table.name}</span>
          </h3>
          <p className={cn("mt-0.5 text-caption font-semibold tabular-nums", isOver ? "text-danger" : "text-ink-soft")}>
            {seated} / {table.capacity} 位
            {isOver ? `・超出 ${seated - table.capacity} 位` : seated < table.capacity ? `・空 ${table.capacity - seated} 位` : "・坐滿"}
          </p>
        </div>
        <button
          type="button"
          aria-label="關閉桌次卡片"
          onClick={() => {
            onClose();
            anchor.focus({ preventScroll: true });
          }}
          className="-mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-4.5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      {vegetarian > 0 || childSeats > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2">
          {vegetarian > 0 ? <Badge tone="sage">素食 {vegetarian} 位</Badge> : null}
          {childSeats > 0 ? (
            <Badge tone="caution">
              <BadgeDot />
              兒童椅 {childSeats} 張
            </Badge>
          ) : null}
        </div>
      ) : null}

      {table.guests.length === 0 ? (
        <p className="px-4 py-5 text-caption text-ink-faint">這桌還沒有安排賓客。</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain px-4">
          {table.guests.map((guest) => (
            <li key={guest.id} className="flex min-w-0 items-center gap-2 py-2">
              <span
                title={GUEST_SIDE_SHORT_LABELS[guest.side]}
                aria-label={GUEST_SIDE_SHORT_LABELS[guest.side]}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[0.6875rem] font-semibold text-ink-soft"
              >
                {GUEST_SIDE_SHORT_LABELS[guest.side].slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 text-caption font-semibold break-words text-ink">{guest.name}</span>
              {(guest.vegetarianCount ?? 0) > 0 ? (
                <span className="shrink-0 text-[0.6875rem] font-semibold text-sage">素 {guest.vegetarianCount}</span>
              ) : null}
              {(guest.childSeatCount ?? 0) > 0 ? (
                <span className="shrink-0 text-[0.6875rem] font-semibold text-caution">椅 {guest.childSeatCount}</span>
              ) : null}
              <span className="shrink-0 text-caption text-ink-soft tabular-nums">{guest.partySize} 位</span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && onOpenDetail ? (
        <div className="border-t border-line bg-surface-sunken/60 px-4 py-2.5">
          <button
            type="button"
            onClick={onOpenDetail}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-control border border-line-strong bg-surface px-3 text-caption font-semibold text-clay-strong transition-colors hover:border-clay hover:bg-clay-soft/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
          >
            編輯這桌
          </button>
        </div>
      ) : null}
    </div>
  );
}
