"use client";

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cancelGuestCheckInAction,
  checkInGuestAction,
  updateGuestCheckInAction,
  type GuestCheckInMutationState,
} from "@/actions/guest-check-ins";
import {
  GUEST_CATEGORY_LABELS,
  guestIdentityLabel,
  type GuestAttendanceStatusValue,
  type GuestCategoryValue,
  type GuestSideValue,
} from "@/domain/guest";
import {
  MAX_GUEST_CHECK_IN_HEADCOUNT,
  reconcileGuestCheckIn,
  sameGuestCheckIn,
  summarizeGuestCheckIns,
  type GuestCheckInRecordSnapshot,
  type PendingGuestCheckInMutation,
} from "@/domain/guest-check-in";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Badge, BadgeDot, type BadgeTone } from "@/components/ui/badge";
import { Button, SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Stat, StatRow } from "@/components/ui/stat";
import { FilterChips, SearchInput, Toolbar } from "@/components/ui/toolbar";

const initialState: GuestCheckInMutationState = { status: "idle" };
const MAX_NOTES_CHARACTERS = 200;

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

export type GuestCheckInBoardGuest = {
  id: string;
  name: string;
  category: GuestCategoryValue;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: number;
  notes: string | null;
  seatingTable: { number: number; name: string } | null;
  checkIn: GuestCheckInRecordSnapshot | null;
};

export type GuestCheckInBoardTable = {
  id: string;
  number: number;
  name: string;
  capacity: number;
  expectedHeadcount: number;
  arrivedHeadcount: number;
  pendingGroups: number;
};

type CheckInFilter = "ALL" | "PENDING" | "ARRIVED";

type BoardFeedback = { message: string; revision: number };

type EditorSelection = {
  guest: GuestCheckInBoardGuest;
  checkIn: GuestCheckInRecordSnapshot | null;
};

type CancelSelection = {
  guest: GuestCheckInBoardGuest;
  checkIn: GuestCheckInRecordSnapshot;
};

function checkInMapFromGuests(guests: readonly GuestCheckInBoardGuest[]) {
  return Object.fromEntries(
    guests.map((guest) => [guest.id, guest.checkIn]),
  ) as Record<string, GuestCheckInRecordSnapshot | null>;
}

function sameCheckInMap(
  left: Record<string, GuestCheckInRecordSnapshot | null>,
  right: Record<string, GuestCheckInRecordSnapshot | null>,
) {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((guestId) =>
      sameGuestCheckIn(left[guestId] ?? null, right[guestId] ?? null),
    )
  );
}

function seatLabel(guest: GuestCheckInBoardGuest): string {
  if (guest.attendanceStatus === "DECLINED" && !guest.seatingTable) {
    return "不需安排座位";
  }
  if (!guest.seatingTable) return "尚未安排座位";
  return `第 ${guest.seatingTable.number} 桌 ${guest.seatingTable.name}`;
}

function CheckInFields({
  idPrefix,
  defaultHeadcount,
  defaultNotes,
}: {
  idPrefix: string;
  defaultHeadcount: number;
  defaultNotes: string | null;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <Field
        htmlFor={`${idPrefix}-headcount`}
        label="實際到場人數"
        hint={`請輸入 1 到 ${MAX_GUEST_CHECK_IN_HEADCOUNT} 的整數；記錄的是這一組實際入場的人數。`}
      >
        <Input
          id={`${idPrefix}-headcount`}
          name="headcount"
          type="number"
          min={1}
          max={MAX_GUEST_CHECK_IN_HEADCOUNT}
          step={1}
          inputMode="numeric"
          required
          autoComplete="off"
          defaultValue={defaultHeadcount}
        />
      </Field>
      <Field
        htmlFor={`${idPrefix}-notes`}
        label="報到備註（選填）"
        hint={`最多 ${MAX_NOTES_CHARACTERS} 個字元；可記錄臨時加減人數的原因，請避免填入不必要的個資。`}
      >
        <Textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={3}
          maxLength={MAX_NOTES_CHARACTERS}
          defaultValue={defaultNotes ?? ""}
        />
      </Field>
    </div>
  );
}

function useSelectedCheckInDialog({
  fallbackFocusId,
  onDismiss,
}: {
  fallbackFocusId: string;
  onDismiss: () => void;
}) {
  const { dialogRef, open, close, closeWithoutRestoringFocus, restoreFocus } =
    useModalDialog({ fallbackFocusId });

  useEffect(() => {
    open();
  }, [open]);

  return {
    dialogRef,
    close,
    closeWithoutRestoringFocus,
    finishClose() {
      restoreFocus();
      onDismiss();
    },
  };
}

function CheckInEditorDialog({
  workspaceId,
  selection,
  guestIsMissing,
  onDismiss,
  onSaved,
}: {
  workspaceId: string;
  selection: EditorSelection;
  guestIsMissing: boolean;
  onDismiss: () => void;
  onSaved: (
    guestId: string,
    checkIn: GuestCheckInRecordSnapshot,
    message: string,
  ) => void;
}) {
  const idPrefix = useId();
  const { guest, checkIn } = selection;
  const isEditing = checkIn !== null;
  const { dialogRef, close, closeWithoutRestoringFocus, finishClose } =
    useSelectedCheckInDialog({
      fallbackFocusId: `check-in-adjust-${guest.id}`,
      onDismiss,
    });
  const submitAction = isEditing
    ? updateGuestCheckInAction.bind(null, workspaceId, checkIn.id)
    : checkInGuestAction.bind(null, workspaceId, guest.id);
  const [state, formAction, isPending] = useActionState(
    async (previousState: GuestCheckInMutationState, formData: FormData) => {
      const nextState = await submitAction(previousState, formData);
      if (nextState.status === "success" && nextState.checkIn) {
        onSaved(guest.id, nextState.checkIn, nextState.message);
        closeWithoutRestoringFocus();
      }
      return nextState;
    },
    initialState,
  );

  return (
    <Dialog
      dialogRef={dialogRef}
      titleId={`${idPrefix}-title`}
      eyebrow="賓客報到"
      title={
        isEditing ? `調整 ${guest.name} 的報到人數` : `為 ${guest.name} 報到`
      }
      description={`原本邀請 ${guest.partySize} 位・${seatLabel(guest)}`}
      closeLabel={
        isEditing
          ? `關閉調整 ${guest.name} 的報到人數`
          : `關閉為 ${guest.name} 報到`
      }
      isPending={isPending}
      size="sm"
      onClose={close}
      onRestoreFocus={finishClose}
    >
      {guestIsMissing ? (
        <div className="mx-5 mt-5 rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption leading-6 text-caution sm:mx-6">
          這筆賓客已由其他人移除。目前保留草稿供確認，但不能送出。
        </div>
      ) : null}
      <form
        action={formAction}
        aria-label={
          isEditing
            ? `調整 ${guest.name} 的報到人數表單`
            : `為 ${guest.name} 報到表單`
        }
        onSubmit={(event) => {
          if (guestIsMissing) event.preventDefault();
        }}
      >
        <div className="space-y-5 px-5 py-6 sm:px-6">
          <CheckInFields
            idPrefix={idPrefix}
            defaultHeadcount={checkIn?.headcount ?? guest.partySize}
            defaultNotes={checkIn?.notes ?? null}
          />
          {isEditing ? (
            <input
              type="hidden"
              name="expectedVersion"
              value={checkIn.version}
            />
          ) : null}
          <ActionFeedback state={state} />
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={isPending} onClick={close}>
            取消
          </Button>
          <SubmitButton
            isPending={isPending}
            pendingLabel="正在儲存…"
            disabled={guestIsMissing}
          >
            {isEditing ? "儲存報到人數" : "確認報到"}
          </SubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function CancelCheckInDialog({
  workspaceId,
  selection,
  onDismiss,
  onCancelled,
}: {
  workspaceId: string;
  selection: CancelSelection;
  onDismiss: () => void;
  onCancelled: (
    guestId: string,
    checkIn: GuestCheckInRecordSnapshot,
    message: string,
  ) => void;
}) {
  const idPrefix = useId();
  const { guest, checkIn } = selection;
  const { dialogRef, close, closeWithoutRestoringFocus, finishClose } =
    useSelectedCheckInDialog({
      fallbackFocusId: `check-in-cancel-${guest.id}`,
      onDismiss,
    });
  const cancelAction = cancelGuestCheckInAction.bind(
    null,
    workspaceId,
    checkIn.id,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: GuestCheckInMutationState, formData: FormData) => {
      const nextState = await cancelAction(previousState, formData);
      if (nextState.status === "success") {
        onCancelled(guest.id, checkIn, nextState.message);
        closeWithoutRestoringFocus();
      }
      return nextState;
    },
    initialState,
  );

  return (
    <Dialog
      dialogRef={dialogRef}
      titleId={`${idPrefix}-title`}
      eyebrow="賓客報到"
      title={`取消 ${guest.name} 的報到`}
      description="取消後這一組會回到未報到，實到人數也會扣回。可以再次報到。"
      closeLabel={`關閉取消 ${guest.name} 的報到`}
      isPending={isPending}
      size="sm"
      onClose={close}
      onRestoreFocus={finishClose}
    >
      <form action={formAction} aria-label={`取消 ${guest.name} 的報到表單`}>
        <div className="space-y-4 px-5 py-6 sm:px-6">
          <p className="text-caption leading-6 text-ink-soft">
            目前記錄實到 {checkIn.headcount} 位。
          </p>
          <input type="hidden" name="expectedVersion" value={checkIn.version} />
          <ActionFeedback state={state} />
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={isPending} onClick={close}>
            保留報到
          </Button>
          <SubmitButton
            isPending={isPending}
            pendingLabel="正在取消…"
            variant="danger-solid"
          >
            取消報到
          </SubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function QuickCheckInForm({
  workspaceId,
  guest,
  onSaved,
}: {
  workspaceId: string;
  guest: GuestCheckInBoardGuest;
  onSaved: (
    guestId: string,
    checkIn: GuestCheckInRecordSnapshot,
    message: string,
  ) => void;
}) {
  const quickAction = checkInGuestAction.bind(null, workspaceId, guest.id);
  const [state, formAction, isPending] = useActionState(
    async (previousState: GuestCheckInMutationState, formData: FormData) => {
      const nextState = await quickAction(previousState, formData);
      if (nextState.status === "success" && nextState.checkIn) {
        onSaved(guest.id, nextState.checkIn, nextState.message);
      }
      return nextState;
    },
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-label={`為 ${guest.name} 快速報到表單`}
      className="min-w-0"
    >
      {/* 報到桌最常見的動作就是「照原本邀請人數全到」，所以做成一次點擊。 */}
      <input type="hidden" name="headcount" value={guest.partySize} />
      <SubmitButton
        id={`check-in-quick-${guest.id}`}
        isPending={isPending}
        pendingLabel="報到中…"
        size="sm"
        className="min-h-11 sm:min-h-9"
      >
        報到 {guest.partySize} 位
      </SubmitButton>
      {state.status === "error" ? (
        <ActionFeedback state={state} className="mt-2" />
      ) : null}
    </form>
  );
}

export function GuestCheckInBoard({
  workspaceId,
  guests,
  tables,
  canEdit,
}: {
  workspaceId: string;
  guests: GuestCheckInBoardGuest[];
  tables: GuestCheckInBoardTable[];
  canEdit: boolean;
}) {
  const tableSummaryId = useId();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CheckInFilter>("ALL");
  const [tablesExpanded, setTablesExpanded] = useState(false);
  const [feedback, setFeedback] = useState<BoardFeedback | null>(null);
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(
    null,
  );
  const [cancelSelection, setCancelSelection] = useState<CancelSelection | null>(
    null,
  );
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const pendingMutations = useRef(
    new Map<string, PendingGuestCheckInMutation>(),
  );
  const [checkInByGuestId, setCheckInByGuestId] = useState(() =>
    checkInMapFromGuests(guests),
  );

  useEffect(() => {
    const next: Record<string, GuestCheckInRecordSnapshot | null> = {};
    const currentGuestIds = new Set(guests.map((guest) => guest.id));

    for (const guest of guests) {
      const resolution = reconcileGuestCheckIn(
        pendingMutations.current.get(guest.id),
        guest.checkIn,
      );
      if (resolution.settled) pendingMutations.current.delete(guest.id);
      next[guest.id] = resolution.checkIn;
    }

    for (const guestId of pendingMutations.current.keys()) {
      if (!currentGuestIds.has(guestId)) {
        pendingMutations.current.delete(guestId);
      }
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCheckInByGuestId((current) =>
        sameCheckInMap(current, next) ? current : next,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [guests]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  const boardGuests = useMemo(
    () =>
      guests.map((guest) => ({
        ...guest,
        checkIn: Object.prototype.hasOwnProperty.call(
          checkInByGuestId,
          guest.id,
        )
          ? (checkInByGuestId[guest.id] ?? null)
          : guest.checkIn,
      })),
    [checkInByGuestId, guests],
  );

  const summary = useMemo(
    () =>
      summarizeGuestCheckIns(
        boardGuests.map((guest) => ({
          attendanceStatus: guest.attendanceStatus,
          partySize: guest.partySize,
          checkedInHeadcount: guest.checkIn?.headcount ?? null,
        })),
      ),
    [boardGuests],
  );

  const counts = useMemo(
    () => ({
      ALL: boardGuests.length,
      PENDING: boardGuests.filter((guest) => guest.checkIn === null).length,
      ARRIVED: boardGuests.filter((guest) => guest.checkIn !== null).length,
    }),
    [boardGuests],
  );

  const filteredGuests = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("zh-TW");
    return boardGuests.filter((guest) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        guest.name.toLocaleLowerCase("zh-TW").includes(normalizedSearch) ||
        (guest.seatingTable?.name ?? "")
          .toLocaleLowerCase("zh-TW")
          .includes(normalizedSearch);
      const matchesFilter =
        filter === "ALL" ||
        (filter === "ARRIVED" ? guest.checkIn !== null : guest.checkIn === null);
      return matchesSearch && matchesFilter;
    });
  }, [boardGuests, filter, search]);

  const hasActiveFilter = search.trim().length > 0 || filter !== "ALL";
  const resultLabel = hasActiveFilter
    ? `符合 ${filteredGuests.length} / ${boardGuests.length} 組`
    : `顯示 ${filteredGuests.length} / ${boardGuests.length} 組`;

  const editorGuestIsMissing =
    editorSelection !== null &&
    !guests.some((guest) => guest.id === editorSelection.guest.id);

  function clearFilters() {
    setSearch("");
    setFilter("ALL");
  }

  function recordSavedCheckIn(
    guestId: string,
    checkIn: GuestCheckInRecordSnapshot,
    message: string,
  ) {
    pendingMutations.current.set(guestId, { kind: "SAVE", checkIn });
    setCheckInByGuestId((current) => ({ ...current, [guestId]: checkIn }));
    setFeedback((current) => ({
      message,
      revision: (current?.revision ?? 0) + 1,
    }));
  }

  function recordCancelledCheckIn(
    guestId: string,
    checkIn: GuestCheckInRecordSnapshot,
    message: string,
  ) {
    pendingMutations.current.set(guestId, { kind: "CANCEL", checkIn });
    setCheckInByGuestId((current) => ({ ...current, [guestId]: null }));
    setFeedback((current) => ({
      message,
      revision: (current?.revision ?? 0) + 1,
    }));
  }

  return (
    <section aria-label="賓客報到" className="mt-6 min-w-0">
      {feedback ? (
        <p
          ref={feedbackRef}
          key={feedback.revision}
          tabIndex={-1}
          role="status"
          className="mb-4 rounded-control border border-positive/30 bg-positive-soft px-3.5 py-2.5 text-caption leading-6 text-positive outline-none"
        >
          {feedback.message}
        </p>
      ) : null}

      <Card>
        <div className="px-5 py-5 sm:px-6">
          <StatRow className="md:grid-cols-4">
            <Stat
              label="實到人數"
              value={summary.arrivedHeadcount}
              unit="位"
              hint={`預計 ${summary.expectedHeadcount} 位`}
              tone="brand"
            />
            <Stat
              label="已報到組數"
              value={summary.arrivedGroups}
              hint={`全部 ${boardGuests.length} 組名單`}
              tone="positive"
            />
            <Stat
              label="未報到組數"
              value={summary.pendingGroups}
              hint={`還有 ${summary.pendingHeadcount} 位回覆出席未到`}
              tone={summary.pendingGroups > 0 ? "caution" : "neutral"}
            />
            <Stat
              label="非預期到場組數"
              value={summary.unexpectedGroups}
              hint="回覆不出席或尚未確認卻到場"
              tone="neutral"
            />
          </StatRow>
        </div>

        {tables.length > 0 ? (
          <div className="border-t border-line px-5 py-4 sm:px-6">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-serif text-body font-semibold text-ink">
                  逐桌實到對照
                </h2>
                <p className="mt-0.5 text-caption leading-6 text-ink-soft">
                  只計算已安排座位的賓客；未安排座位的到場人數列在名單裡。
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={tablesExpanded}
                aria-controls={tableSummaryId}
                onClick={() => setTablesExpanded((current) => !current)}
                className="min-h-11 w-full sm:min-h-9 sm:w-auto"
              >
                {tablesExpanded ? "收合逐桌對照" : "展開逐桌對照"}
              </Button>
            </div>
            <ul
              id={tableSummaryId}
              hidden={!tablesExpanded}
              className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3"
            >
              {tables.map((table) => (
                <li key={table.id} className="min-w-0">
                  <div className="flex min-w-0 items-baseline justify-between gap-3 rounded-control border border-line bg-surface-sunken px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-caption font-semibold text-ink">
                        第 {table.number} 桌 {table.name}
                      </p>
                      <p className="text-caption text-ink-faint">
                        {table.pendingGroups > 0
                          ? `${table.pendingGroups} 組未到`
                          : "全數到齊"}
                      </p>
                    </div>
                    <p className="shrink-0 font-serif text-body font-semibold tabular-nums text-clay-strong">
                      {table.arrivedHeadcount}
                      <span className="text-caption font-sans text-ink-faint">
                        {" "}
                        / {table.expectedHeadcount}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="border-t border-line px-5 py-5 sm:px-6">
          <Toolbar className="mb-4">
            <SearchInput
              label="搜尋報到名單"
              placeholder="搜尋姓名或桌名"
              value={search}
              onChange={setSearch}
            />
            <FilterChips
              label="報到狀態篩選"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "ALL", label: "全部", count: counts.ALL },
                { value: "PENDING", label: "未報到", count: counts.PENDING },
                { value: "ARRIVED", label: "已報到", count: counts.ARRIVED },
              ]}
            />
            <div className="flex min-h-11 min-w-0 items-center gap-3 sm:ml-auto">
              <p
                aria-live="polite"
                className="text-caption tabular-nums text-ink-soft sm:whitespace-nowrap"
              >
                {resultLabel}
              </p>
              {hasActiveFilter && filteredGuests.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="min-h-11 sm:min-h-9"
                >
                  清除報到篩選
                </Button>
              ) : null}
            </div>
          </Toolbar>

          {boardGuests.length === 0 ? (
            <EmptyState
              title="報到名單目前沒有賓客。"
              description="先到賓客頁建立名單，婚宴當天就能直接在這裡報到。"
            />
          ) : filteredGuests.length === 0 ? (
            <EmptyState
              title="找不到符合條件的賓客。"
              description="調整搜尋關鍵字或報到狀態，就能找回其他名單。"
              action={<Button onClick={clearFilters}>清除報到篩選</Button>}
            />
          ) : (
            <div className="overflow-hidden rounded-card border border-line">
              <ul className="min-w-0 divide-y divide-line bg-surface">
                {filteredGuests.map((guest) => {
                  const checkIn = guest.checkIn;
                  return (
                    <li key={guest.id} className="min-w-0">
                      <article
                        aria-label={guest.name}
                        className="grid min-w-0 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,auto)_auto] sm:items-center sm:px-5"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h3 className="min-w-0 font-serif text-body font-semibold break-words text-ink">
                              {guest.name}
                            </h3>
                            <Badge
                              tone={attendanceTones[guest.attendanceStatus]}
                            >
                              <BadgeDot />
                              {attendanceLabels[guest.attendanceStatus]}
                            </Badge>
                            {guest.category !== "GUEST" ? (
                              <Badge
                                tone={
                                  guest.category === "COUPLE"
                                    ? "brand"
                                    : "sage"
                                }
                              >
                                {GUEST_CATEGORY_LABELS[guest.category]}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-caption text-ink-soft">
                            {guestIdentityLabel(guest.category, guest.side)}・
                            {seatLabel(guest)}・邀請 {guest.partySize} 位
                          </p>
                          {checkIn?.notes ? (
                            <p className="mt-1 text-caption leading-6 whitespace-pre-wrap break-words text-ink-soft">
                              {checkIn.notes}
                            </p>
                          ) : null}
                        </div>

                        <div className="min-w-0 sm:text-right">
                          {checkIn ? (
                            <p className="font-serif text-xl font-semibold tabular-nums text-clay-strong">
                              實到 {checkIn.headcount} 位
                            </p>
                          ) : (
                            <p className="text-caption font-semibold text-ink-faint">
                              尚未報到
                            </p>
                          )}
                        </div>

                        {canEdit ? (
                          <div className="flex min-w-0 flex-wrap items-start gap-1 sm:justify-end">
                            {checkIn ? (
                              <>
                                <Button
                                  id={`check-in-adjust-${guest.id}`}
                                  variant="secondary"
                                  size="sm"
                                  className="min-h-11 sm:min-h-9"
                                  onClick={() =>
                                    setEditorSelection({ guest, checkIn })
                                  }
                                >
                                  調整人數
                                </Button>
                                <Button
                                  id={`check-in-cancel-${guest.id}`}
                                  variant="danger"
                                  size="sm"
                                  className="min-h-11 sm:min-h-9"
                                  onClick={() =>
                                    setCancelSelection({ guest, checkIn })
                                  }
                                >
                                  取消報到
                                </Button>
                              </>
                            ) : (
                              <>
                                <QuickCheckInForm
                                  workspaceId={workspaceId}
                                  guest={guest}
                                  onSaved={recordSavedCheckIn}
                                />
                                <Button
                                  id={`check-in-adjust-${guest.id}`}
                                  variant="secondary"
                                  size="sm"
                                  className="min-h-11 sm:min-h-9"
                                  onClick={() =>
                                    setEditorSelection({ guest, checkIn: null })
                                  }
                                >
                                  其他人數
                                </Button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </Card>

      {editorSelection ? (
        <CheckInEditorDialog
          workspaceId={workspaceId}
          selection={editorSelection}
          guestIsMissing={editorGuestIsMissing}
          onDismiss={() => setEditorSelection(null)}
          onSaved={recordSavedCheckIn}
        />
      ) : null}

      {cancelSelection ? (
        <CancelCheckInDialog
          workspaceId={workspaceId}
          selection={cancelSelection}
          onDismiss={() => setCancelSelection(null)}
          onCancelled={recordCancelledCheckIn}
        />
      ) : null}
    </section>
  );
}
