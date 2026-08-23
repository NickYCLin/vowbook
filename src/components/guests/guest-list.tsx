"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  GUEST_CATEGORIES,
  GUEST_CATEGORY_LABELS,
  GUEST_SIDES,
  GUEST_SIDE_LABELS,
  guestIdentityLabel,
  type GuestAttendanceStatusValue,
  type GuestCategoryValue,
  type GuestSideValue,
} from "@/domain/guest";
import {
  CreateGuestDialog,
  DeleteGuestForm,
  EditGuestForm,
} from "./guest-forms";
import type {
  GuestDetailsDto,
  GuestListItemDto,
} from "@/lib/guest-list";
import { Badge, BadgeDot, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Stat, StatRow } from "@/components/ui/stat";
import { SearchInput, Toolbar } from "@/components/ui/toolbar";
import { cn } from "@/lib/class-names";

const attendanceLabels: Record<GuestAttendanceStatusValue, string> = {
  UNDECIDED: "尚未確認",
  ATTENDING: "出席",
  DECLINED: "不出席",
};

const attendanceTones: Record<GuestAttendanceStatusValue, BadgeTone> = {
  UNDECIDED: "neutral",
  ATTENDING: "positive",
  DECLINED: "danger",
};

export type GuestListItem = GuestListItemDto;

type GuestListProps = {
  workspaceId: string;
  guests: GuestListItem[];
  canEdit: boolean;
};

type InvitationDelivery = Exclude<
  GuestDetailsDto["invitationDelivery"],
  null
>;

const invitationLabels: Record<InvitationDelivery, string> = {
  PAPER: "紙本喜帖",
  DIGITAL: "電子喜帖",
  NONE: "不需寄送",
  UNKNOWN: "未填寫",
};

type GuestFeedback = {
  message: string;
  revision: number;
};

function ceremonyLabel(value: boolean): string {
  return value ? "出席" : "不出席";
}

function GuestDetails({ details }: { details: GuestDetailsDto }) {
  return (
    <details className="group mt-1 min-w-0">
      <summary className="inline-flex min-h-11 w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-control px-2.5 text-caption font-semibold break-words text-clay-strong transition hover:bg-clay-soft [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3 transition-transform group-open:rotate-90"
        >
          <path d="M6 3l5 5-5 5" />
        </svg>
        聯絡與回覆資料
      </summary>
      <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-3 rounded-control border border-line bg-surface-sunken p-4 text-caption sm:grid-cols-[8rem_minmax(0,1fr)]">
          {details.contactPhone && (
            <>
              <dt className="font-semibold text-ink">聯絡電話</dt>
              <dd className="min-w-0 break-words text-ink-soft">
                {details.contactPhone}
              </dd>
            </>
          )}

          {details.contactEmail && (
            <>
              <dt className="font-semibold text-ink">電子信箱</dt>
              <dd className="min-w-0 break-all text-ink-soft">
                {details.contactEmail}
              </dd>
            </>
          )}

          {details.relationshipLabel && (
            <>
              <dt className="font-semibold text-ink">關係補充</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-ink-soft">
                {details.relationshipLabel}
              </dd>
            </>
          )}

          {details.attendanceReply && (
            <>
              <dt className="font-semibold text-ink">出席回覆補充</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-ink-soft">
                {details.attendanceReply}
              </dd>
            </>
          )}

          {details.ceremonyAttendance !== null && (
            <>
              <dt className="font-semibold text-ink">證婚儀式</dt>
              <dd className="text-ink-soft">
                {ceremonyLabel(details.ceremonyAttendance)}
              </dd>
            </>
          )}

          {details.childSeatCount !== null && (
            <>
              <dt className="font-semibold text-ink">兒童座椅</dt>
              <dd className="text-ink-soft">{details.childSeatCount} 張</dd>
            </>
          )}

          {details.vegetarianCount !== null && (
            <>
              <dt className="font-semibold text-ink">素食人數</dt>
              <dd className="text-ink-soft">{details.vegetarianCount} 位</dd>
            </>
          )}

          {details.invitationDelivery !== null && (
            <>
              <dt className="font-semibold text-ink">喜帖方式</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-ink-soft">
                {invitationLabels[details.invitationDelivery]}
                {details.invitationReply ? ` · ${details.invitationReply}` : ""}
              </dd>
            </>
          )}

          {details.mailingAddress && (
            <>
              <dt className="font-semibold text-ink">寄送地址</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-ink-soft">
                {details.mailingAddress}
              </dd>
            </>
          )}

          {details.guestMessage && (
            <>
              <dt className="font-semibold text-ink">賓客留言</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-ink-soft">
                {details.guestMessage}
              </dd>
            </>
          )}

      </dl>
    </details>
  );
}

type GuestRequirementNeed = {
  id: string;
  name: string;
  count: number;
};

type GuestRequirementSummary = {
  total: number;
  confirmedTotal: number;
  pendingTotal: number;
  confirmedGuests: GuestRequirementNeed[];
  pendingGuests: GuestRequirementNeed[];
};

function summariseRequirement(
  guests: readonly GuestListItem[],
  field: "childSeatCount" | "vegetarianCount",
): GuestRequirementSummary {
  const confirmedGuests: GuestRequirementNeed[] = [];
  const pendingGuests: GuestRequirementNeed[] = [];

  for (const guest of guests) {
    if (guest.attendanceStatus === "DECLINED") continue;
    const count = guest.details?.[field] ?? 0;
    if (count <= 0) continue;

    const need = { id: guest.id, name: guest.name, count };
    if (guest.attendanceStatus === "ATTENDING") {
      confirmedGuests.push(need);
    } else {
      pendingGuests.push(need);
    }
  }

  const confirmedTotal = confirmedGuests.reduce(
    (total, guest) => total + guest.count,
    0,
  );
  const pendingTotal = pendingGuests.reduce(
    (total, guest) => total + guest.count,
    0,
  );

  return {
    total: confirmedTotal + pendingTotal,
    confirmedTotal,
    pendingTotal,
    confirmedGuests,
    pendingGuests,
  };
}

function RequirementGuestGroup({
  title,
  guests,
  unit,
}: {
  title: string;
  guests: readonly GuestRequirementNeed[];
  unit: string;
}) {
  if (guests.length === 0) return null;

  return (
    <div>
      <h4 className="text-caption font-semibold text-ink-soft">{title}</h4>
      <ul className="mt-2 divide-y divide-line rounded-control border border-line bg-surface">
        {guests.map((guest) => (
          <li
            key={guest.id}
            className="flex min-w-0 items-center justify-between gap-4 px-3.5 py-2.5 text-caption"
          >
            <span className="min-w-0 break-words text-ink">{guest.name}</span>
            <span className="shrink-0 font-semibold tabular-nums text-ink-soft">
              {guest.count} {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequirementSummary({
  label,
  unit,
  summary,
}: {
  label: string;
  unit: string;
  summary: GuestRequirementSummary;
}) {
  return (
    <details className="group min-w-0 rounded-control border border-line bg-surface-sunken">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-control px-4 py-3 transition hover:bg-clay-soft/50 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="font-serif text-body font-semibold text-ink">{label}</p>
          <p className="mt-0.5 text-caption text-ink-soft">
            已確認 {summary.confirmedTotal} {unit} · 待確認 {summary.pendingTotal}{" "}
            {unit}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <p className="font-serif text-xl font-semibold tabular-nums text-clay-strong">
            {summary.total} {unit}
          </p>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4 text-ink-faint transition-transform group-open:rotate-90"
          >
            <path d="M6 3l5 5-5 5" />
          </svg>
        </div>
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-4">
        {summary.total === 0 ? (
          <p className="text-caption text-ink-faint">目前沒有登記需求。</p>
        ) : (
          <>
            <RequirementGuestGroup
              title="已確認出席"
              guests={summary.confirmedGuests}
              unit={unit}
            />
            <RequirementGuestGroup
              title="尚未確認出席"
              guests={summary.pendingGuests}
              unit={unit}
            />
          </>
        )}
      </div>
    </details>
  );
}

export function GuestList({ workspaceId, guests, canEdit }: GuestListProps) {
  const [feedback, setFeedback] = useState<GuestFeedback | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [search, setSearch] = useState("");
  const [attendanceFilter, setAttendanceFilter] = useState<
    GuestAttendanceStatusValue | "ALL"
  >("ALL");
  const [categoryFilter, setCategoryFilter] = useState<
    GuestCategoryValue | "ALL"
  >("ALL");
  const [sideFilter, setSideFilter] = useState<GuestSideValue | "ALL">("ALL");
  const [seatingFilter, setSeatingFilter] = useState<
    "ALL" | "ASSIGNED" | "UNASSIGNED"
  >("ALL");
  const totals = useMemo(() => {
    let generalGuestGroups = 0;
    let generalRespondedGroups = 0;
    let generalUndecidedGroups = 0;
    let generalAttendingHeadcount = 0;
    let hostMembers = 0;
    let hostAttendingMembers = 0;
    let banquetHeadcount = 0;
    let seatableEntries = 0;
    let seatedEntries = 0;

    for (const guest of guests) {
      if (guest.category === "GUEST") {
        generalGuestGroups += 1;
        if (guest.attendanceStatus === "UNDECIDED") {
          generalUndecidedGroups += 1;
        } else {
          generalRespondedGroups += 1;
        }
        if (guest.attendanceStatus === "ATTENDING") {
          generalAttendingHeadcount += guest.partySize;
        }
      } else {
        hostMembers += 1;
        if (guest.attendanceStatus === "ATTENDING") {
          hostAttendingMembers += 1;
        }
      }

      if (guest.attendanceStatus === "ATTENDING") {
        banquetHeadcount += guest.partySize;
      }
      if (guest.attendanceStatus !== "DECLINED") {
        seatableEntries += 1;
        if (guest.seatingTable !== null) seatedEntries += 1;
      }
    }

    return {
      generalGuestGroups,
      generalRespondedGroups,
      generalUndecidedGroups,
      generalAttendingHeadcount,
      hostMembers,
      hostAttendingMembers,
      banquetHeadcount,
      seatableEntries,
      seatedEntries,
    };
  }, [guests]);
  const requirements = useMemo(
    () => ({
      childSeats: summariseRequirement(guests, "childSeatCount"),
      vegetarianMeals: summariseRequirement(guests, "vegetarianCount"),
    }),
    [guests],
  );
  const filteredGuests = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("zh-TW");

    return guests.filter((guest) => {
      const matchesName =
        normalizedSearch.length === 0 ||
        guest.name.toLocaleLowerCase("zh-TW").includes(normalizedSearch);
      const matchesCategory =
        categoryFilter === "ALL" || guest.category === categoryFilter;
      const matchesAttendance =
        attendanceFilter === "ALL" ||
        guest.attendanceStatus === attendanceFilter;
      const matchesSide = sideFilter === "ALL" || guest.side === sideFilter;
      const matchesSeating =
        seatingFilter === "ALL" ||
        (seatingFilter === "ASSIGNED"
          ? guest.seatingTable !== null
          : guest.seatingTable === null);

      return (
        matchesName &&
        matchesCategory &&
        matchesAttendance &&
        matchesSide &&
        matchesSeating
      );
    });
  }, [
    attendanceFilter,
    categoryFilter,
    guests,
    search,
    seatingFilter,
    sideFilter,
  ]);
  const filteredHosts = filteredGuests.filter(
    (guest) => guest.category !== "GUEST",
  );
  const filteredGeneralGuests = filteredGuests.filter(
    (guest) => guest.category === "GUEST",
  );
  const displayedGuests = [...filteredHosts, ...filteredGeneralGuests];
  const hasActiveFilter =
    search.trim().length > 0 ||
    attendanceFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    sideFilter !== "ALL" ||
    seatingFilter !== "ALL";
  const resultLabel = hasActiveFilter
    ? "符合 " + filteredGuests.length + " / " + guests.length + " 筆"
    : "顯示 " + filteredGuests.length + " / " + guests.length + " 筆";

  function clearFilters() {
    setSearch("");
    setAttendanceFilter("ALL");
    setCategoryFilter("ALL");
    setSideFilter("ALL");
    setSeatingFilter("ALL");
  }

  useEffect(() => {
    if (feedback) {
      feedbackRef.current?.focus();
    }
  }, [feedback]);

  function announceFeedback(message: string) {
    setFeedback((current) => ({
      message,
      revision: (current?.revision ?? 0) + 1,
    }));
  }

  return (
    <div className="mt-5 min-w-0 space-y-5">
      {/*
        斷點看的是這一區的欄寬（@container），不是視窗寬度：名單日後若被放進
        側欄或雙欄版面，用視窗寬度判斷就會在窄欄裡展開成擠爛的六欄。
      */}
      <section
        aria-labelledby="guest-list-heading"
        className="@container min-w-0"
      >
        <h2 id="guest-list-heading" className="sr-only">
          名單
        </h2>
        {feedback ? (
          <p
            ref={feedbackRef}
            tabIndex={-1}
            role="status"
            className="mb-5 rounded-control border border-positive/30 bg-positive-soft px-3.5 py-2.5 text-caption leading-6 text-positive outline-none"
          >
            {feedback.message}
          </p>
        ) : null}

        {guests.length > 0 && (
          <Card className="mb-4">
            <div className="px-5 py-4 sm:px-6">
              <StatRow>
                  <Stat
                    label="一般賓客組數"
                    value={totals.generalGuestGroups}
                    unit="組"
                    hint={
                      "已回覆 " +
                      totals.generalRespondedGroups +
                      " 組 · 尚未確認 " +
                      totals.generalUndecidedGroups +
                      " 組"
                    }
                  />
                  <Stat
                    label="新人與家人數"
                    value={totals.hostMembers}
                    unit="位"
                    hint={"出席 " + totals.hostAttendingMembers + " 位"}
                    tone="brand"
                  />
                  <Stat
                    label="宴席人數"
                    value={totals.banquetHeadcount}
                    unit="位"
                    hint={
                      "其中一般賓客 " +
                      totals.generalAttendingHeadcount +
                      " 位"
                    }
                    tone="positive"
                  />
                  <Stat
                    label="已排座位"
                    value={totals.seatedEntries + "/" + totals.seatableEntries}
                    hint={
                      "未安排 " +
                      (totals.seatableEntries - totals.seatedEntries) +
                      " 筆"
                    }
                  />
                </StatRow>
            </div>
          </Card>
        )}

        {guests.length > 0 && canEdit ? (
          <Card className="mb-4">
            <section
              aria-labelledby="guest-requirements-heading"
              className="px-5 py-5 sm:px-6"
            >
              <div>
                <h3
                  id="guest-requirements-heading"
                  className="font-serif text-title font-semibold text-ink"
                >
                  宴席特殊需求
                </h3>
                <p className="mt-1 text-caption leading-6 text-ink-soft">
                  總數包含已確認出席與尚未確認；不出席不計入。
                </p>
              </div>
              <div className="mt-4 grid min-w-0 gap-3 @3xl:grid-cols-2">
                <RequirementSummary
                  label="兒童座椅需求"
                  unit="張"
                  summary={requirements.childSeats}
                />
                <RequirementSummary
                  label="素食餐需求"
                  unit="位"
                  summary={requirements.vegetarianMeals}
                />
              </div>
            </section>
          </Card>
        ) : null}

        {guests.length === 0 ? (
          <EmptyState
            title="婚宴名單還是空白的。"
            description={
              canEdit
                ? "先加入第一位名單成員；新人、家人與一般賓客都會清楚分開。"
                : "可以編輯此工作區的成員尚未加入名單成員。"
            }
            action={
              canEdit ? <CreateGuestDialog workspaceId={workspaceId} /> : null
            }
          />
        ) : (
          <>
            <Toolbar className="mb-4">
              <SearchInput
                label="搜尋賓客姓名"
                placeholder="搜尋姓名"
                value={search}
                onChange={setSearch}
              />
              <Select
                aria-label="名單身份篩選"
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(
                    event.target.value as GuestCategoryValue | "ALL",
                  )
                }
                className="sm:w-auto"
              >
                <option value="ALL">所有名單身份</option>
                {GUEST_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {GUEST_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="出席狀態篩選"
                value={attendanceFilter}
                onChange={(event) =>
                  setAttendanceFilter(
                    event.target.value as GuestAttendanceStatusValue | "ALL",
                  )
                }
                className="sm:w-auto"
              >
                <option value="ALL">所有出席狀態</option>
                <option value="ATTENDING">出席</option>
                <option value="DECLINED">不出席</option>
                <option value="UNDECIDED">尚未確認</option>
              </Select>
              <Select
                aria-label="關係篩選"
                value={sideFilter}
                onChange={(event) =>
                  setSideFilter(event.target.value as GuestSideValue | "ALL")
                }
                className="sm:w-auto"
              >
                <option value="ALL">所有關係</option>
                {GUEST_SIDES.map((side) => (
                  <option key={side} value={side}>
                    {GUEST_SIDE_LABELS[side]}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="座位狀態篩選"
                value={seatingFilter}
                onChange={(event) =>
                  setSeatingFilter(
                    event.target.value as "ALL" | "ASSIGNED" | "UNASSIGNED",
                  )
                }
                className="sm:w-auto"
              >
                <option value="ALL">所有座位狀態</option>
                <option value="ASSIGNED">已安排</option>
                <option value="UNASSIGNED">未安排</option>
              </Select>
              <div className="flex min-h-11 min-w-0 items-center gap-3 sm:ml-auto">
                <p
                  aria-live="polite"
                  className="text-caption text-ink-soft tabular-nums sm:whitespace-nowrap"
                >
                  {resultLabel}
                </p>
                {hasActiveFilter && filteredGuests.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    清除篩選
                  </Button>
                )}
              </div>
            </Toolbar>

            {filteredGuests.length === 0 ? (
              <EmptyState
                title="找不到符合條件的名單成員。"
                description="調整搜尋關鍵字或篩選條件，就能找回其他名單成員。"
                action={<Button onClick={clearFilters}>清除篩選</Button>}
              />
            ) : (
              /*
                一張卡片裝整份名單，靠分隔線分列。原本每位賓客各自一張帶陰影
                的卡片，八個人就是八個框加七道間距，橫向又只用到左邊三分之一。
              */
              <Card>
                <ul className="min-w-0 divide-y divide-line">
                  {displayedGuests.map((guest, index) => (
                    <Fragment key={guest.id}>
                      {index === 0 && filteredHosts.length > 0 ? (
                        <li className="border-b border-line bg-clay-soft/50 px-4 py-3 sm:px-5">
                          <h3 className="font-serif text-body font-semibold text-ink">
                            新人與家人
                          </h3>
                          <p className="mt-1 text-caption leading-6 text-ink-soft">
                            不計入一般賓客統計，仍會計入宴席人數與桌位。
                          </p>
                        </li>
                      ) : null}
                      {index === filteredHosts.length &&
                      filteredGeneralGuests.length > 0 ? (
                        <li className="border-b border-line bg-surface-sunken px-4 py-3 sm:px-5">
                          <h3 className="font-serif text-body font-semibold text-ink">
                            一般賓客
                          </h3>
                        </li>
                      ) : null}
                    <li className="min-w-0">
                      <article className="min-w-0 px-4 py-2.5 sm:px-5">
                        {/*
                          窄欄是兩欄兩列：姓名／出席在上，其餘資訊／操作在下。
                          純靠自動排版會把徽章排到姓名下面，一位賓客就佔掉四行。

                          寬欄的徽章欄寬度寫死：每一列是各自獨立的 grid，只要
                          這欄依內容伸縮，「尚未確認」那幾列就會把前面的欄位往
                          左推，整份名單的關係／人數／桌次會排不齊。
                        */}
                        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 @4xl:grid-cols-[minmax(0,1fr)_6rem_4rem_minmax(0,11rem)_10rem_auto] @4xl:gap-x-4">
                          <h3 className="min-w-0 font-serif text-body font-semibold break-words text-ink">
                            {guest.name}
                          </h3>
                          {/*
                            display:contents：窄欄時這三項是一行以「·」分隔的
                            文字，寬欄時外框消失、三個 span 直接變成對齊的欄，
                            一位賓客只佔一列，右邊不再空一大片。
                          */}
                          {/*
                            這裡不放「·」分隔點：窄欄一行塞不下三項，斷行後會
                            留一個孤零零的點在行尾。三項的字重與顏色本來就不同，
                            靠間距就分得開。
                          */}
                          <div className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-ink-soft @4xl:contents">
                            <span className="min-w-0 break-words">
                              {guestIdentityLabel(guest.category, guest.side)}
                            </span>
                            <span className="tabular-nums">
                              {guest.partySize} 位
                            </span>
                            {/*
                              桌名可以重複，賓客真正要知道的是「幾號桌」，
                              桌名只是給規劃的人對照用的標籤。
                            */}
                            <span
                              data-guest-seating="summary"
                              className={cn(
                                "min-w-0 break-words",
                                guest.seatingTable
                                  ? "font-medium text-ink"
                                  : "text-ink-faint",
                              )}
                            >
                              {guest.seatingTable ? (
                                <>
                                  桌次：{guest.seatingTable.number} 號桌
                                  <span className="ml-1.5 font-normal text-ink-soft">
                                    {guest.seatingTable.name}
                                  </span>
                                </>
                              ) : (
                                "桌次：尚未安排"
                              )}
                            </span>
                          </div>
                          <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center justify-end gap-1.5 @4xl:col-auto @4xl:row-auto">
                            {guest.category !== "GUEST" ? (
                              <Badge
                                tone={guest.category === "COUPLE" ? "brand" : "sage"}
                              >
                                {GUEST_CATEGORY_LABELS[guest.category]}
                              </Badge>
                            ) : null}
                            <Badge
                              tone={attendanceTones[guest.attendanceStatus]}
                            >
                              <BadgeDot />
                              {attendanceLabels[guest.attendanceStatus]}
                            </Badge>
                          </div>
                          {canEdit && (
                            <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center justify-end gap-0.5 @4xl:col-auto @4xl:row-auto">
                              <EditGuestForm
                                workspaceId={workspaceId}
                                guestId={guest.id}
                                expectedVersion={guest.version}
                                name={guest.name}
                                category={guest.category}
                                side={guest.side}
                                attendanceStatus={guest.attendanceStatus}
                                partySize={guest.partySize}
                                notes={guest.notes}
                                details={guest.details}
                                onSuccess={announceFeedback}
                                managedFields={Array.from(
                                  new Set(
                                    guest.importRecords.flatMap((record) =>
                                      record.sourceManaged
                                        ? record.managedFields
                                        : [],
                                    ),
                                  ),
                                )}
                              />
                              <DeleteGuestForm
                                workspaceId={workspaceId}
                                guestId={guest.id}
                                expectedVersion={guest.version}
                                name={guest.name}
                                hasManagedImportSource={guest.importRecords.some(
                                  (record) => record.sourceManaged,
                                )}
                              />
                            </div>
                          )}
                        </div>

                        {guest.notes && (
                          <p className="mt-1 text-caption leading-6 break-words whitespace-pre-wrap text-ink-soft">
                            {guest.notes}
                          </p>
                        )}

                        {guest.details ? (
                          <GuestDetails details={guest.details} />
                        ) : null}

                        {guest.importRecords.some(
                          (record) => record.details === null,
                        ) && (
                          <p className="mt-1 text-caption leading-6 text-ink-faint">
                            聯絡與回覆資料限可編輯成員查看
                          </p>
                        )}
                      </article>
                    </li>
                    </Fragment>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </section>
    </div>
  );
}
