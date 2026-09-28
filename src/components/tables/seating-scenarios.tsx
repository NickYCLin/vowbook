"use client";

import {
  ClockCounterClockwise,
  CopySimple,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useState, type ReactNode } from "react";
import {
  addScenarioTableAction,
  applySeatingScenarioAction,
  createSeatingScenarioAction,
  deleteSeatingScenarioAction,
  removeScenarioTableAction,
  renameSeatingScenarioAction,
  seatScenarioGuestAction,
  type SeatingScenarioMutationState,
  updateScenarioTableAction,
} from "@/actions/seating-scenarios";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Badge } from "@/components/ui/badge";
import { Button, SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { MAX_SEATING_SCENARIO_DRAFTS } from "@/domain/seating-scenario";
import type { GuestAttendanceStatusValue } from "@/domain/guest";
import type {
  loadSeatingScenarioDetail,
  SeatingScenarioSummary,
} from "@/lib/seating-scenarios";
import { cn } from "@/lib/class-names";

export type SeatingScenarioDetail = Awaited<ReturnType<typeof loadSeatingScenarioDetail>>;
type ScenarioTable = SeatingScenarioDetail["tables"][number];
type ScenarioGuest = SeatingScenarioDetail["unseated"][number];

const idle: SeatingScenarioMutationState = { status: "idle" };

const attendanceText: Record<GuestAttendanceStatusValue, string> = {
  ATTENDING: "出席",
  UNDECIDED: "未回覆",
  DECLINED: "不出席",
};

const iconButtonClassName =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-soft transition hover:bg-clay-soft hover:text-clay-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-not-allowed disabled:opacity-50 sm:size-9";

// ─── 分頁列 ──────────────────────────────────────────────────────────────

/** 桌次頁與方案頁共用的分頁列：正式安排永遠在最前面。 */
export function SeatingScenarioTabs({
  workspaceId,
  drafts,
  backups,
  activeId,
  canEdit,
}: {
  workspaceId: string;
  drafts: SeatingScenarioSummary[];
  backups: SeatingScenarioSummary[];
  activeId: string | null;
  canEdit: boolean;
}) {
  const base = `/workspaces/${workspaceId}/tables`;
  const tabClassName = (active: boolean) =>
    cn(
      "inline-flex min-h-11 max-w-full items-center gap-2 rounded-control border px-3.5 py-2 text-sm font-semibold break-words transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay",
      active
        ? "border-ink bg-ink text-surface"
        : "border-line-strong bg-surface text-ink-soft hover:border-clay hover:text-clay-strong",
    );
  const activeBackup = backups.find((item) => item.id === activeId);

  return (
    <nav aria-label="座位方案" className="mt-6 flex min-w-0 flex-wrap items-center gap-2">
      <Link href={base} className={tabClassName(activeId === null)} aria-current={activeId === null ? "page" : undefined}>
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-positive" />
        正式安排
        <span className={cn("text-caption font-medium", activeId === null ? "text-surface/75" : "text-ink-faint")}>
          報到與列印使用中
        </span>
      </Link>
      {drafts.map((draft) => (
        <Link
          key={draft.id}
          href={`${base}/scenarios/${draft.id}`}
          className={tabClassName(draft.id === activeId)}
          aria-current={draft.id === activeId ? "page" : undefined}
        >
          <span className="min-w-0 break-words">{draft.name}</span>
          {draft.matchesLive ? (
            <span className={cn("text-caption font-medium", draft.id === activeId ? "text-surface/75" : "text-positive")}>
              與正式相同
            </span>
          ) : null}
        </Link>
      ))}
      {canEdit && drafts.length < MAX_SEATING_SCENARIO_DRAFTS ? (
        <CreateSeatingScenarioButton workspaceId={workspaceId} suggestedName={`方案 ${drafts.length + 1}`} />
      ) : null}
      {backups.length > 0 ? (
        <details className="relative">
          <summary
            className={cn(tabClassName(Boolean(activeBackup)), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}
          >
            <ClockCounterClockwise aria-hidden="true" className="size-4.5" />
            {activeBackup ? activeBackup.name : `之前的安排 ${backups.length}`}
          </summary>
          <ul className="absolute left-0 z-20 mt-2 w-72 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-card border border-line bg-surface shadow-overlay">
            {backups.map((backup) => (
              <li key={backup.id} className="border-b border-line last:border-b-0">
                <Link
                  href={`${base}/scenarios/${backup.id}`}
                  className="block px-4 py-3 text-caption transition hover:bg-clay-soft/50"
                >
                  <span className="block font-semibold text-ink">{backup.name}</span>
                  <span className="mt-0.5 block text-ink-faint tabular-nums">
                    {backup.tableCount} 桌 · {backup.seatedGroupCount} 組入座
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </nav>
  );
}

function CreateSeatingScenarioButton({ workspaceId, suggestedName }: { workspaceId: string; suggestedName: string }) {
  const titleId = useId();
  const inputId = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const [state, formAction, isPending] = useActionState(createSeatingScenarioAction.bind(null, workspaceId), idle);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-dashed border-clay/60 px-3.5 py-2 text-sm font-semibold text-clay-strong transition hover:bg-clay-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
      >
        <CopySimple aria-hidden="true" className="size-4.5" />
        從目前安排複製
      </button>
      <Dialog
        dialogRef={dialogRef}
        titleId={titleId}
        title="新增座位方案"
        description="複製一份目前的正式安排，在上面試排；套用之前不會影響報到、列印與手機。"
        closeLabel="關閉"
        size="sm"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction}>
          <div className="space-y-4 px-5 py-5 sm:px-6">
            <Field htmlFor={inputId} label="方案名稱" hint="例如「王家全到」「少開一桌」。">
              <Input id={inputId} name="name" required maxLength={40} defaultValue={suggestedName} />
            </Field>
            <ActionFeedback state={state} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={isPending}>
              取消
            </Button>
            <SubmitButton isPending={isPending} pendingLabel="建立中…">
              建立方案
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

// ─── 方案編輯頁 ───────────────────────────────────────────────────────────

export function SeatingScenarioEditor({
  workspaceId,
  detail,
}: {
  workspaceId: string;
  detail: SeatingScenarioDetail;
}) {
  const { scenario, canEdit } = detail;
  const isBackup = scenario.kind === "BACKUP";
  const [applyState, setApplyState] = useState<SeatingScenarioMutationState>(idle);
  const attendingUnseated = detail.unseated.filter((guest) => guest.attendanceStatus !== "DECLINED");
  const declinedUnseated = detail.unseated.filter((guest) => guest.attendanceStatus === "DECLINED");

  return (
    <div className="mt-5 min-w-0 space-y-5">
      <Notice
        tone={isBackup ? "info" : "caution"}
        action={
          canEdit ? (
            <ApplySeatingScenarioButton
              workspaceId={workspaceId}
              detail={detail}
              onApplied={setApplyState}
            />
          ) : undefined
        }
      >
        {isBackup
          ? "這是套用方案前自動留下的正式安排。想回到這個版本時，按「換回這份安排」。"
          : "你正在編輯草稿。這裡的調整不會影響報到、列印與手機，直到你按「套用為正式安排」。"}
      </Notice>
      {scenario.liveChangedSinceCopy && !isBackup ? (
        <Notice tone="info">正式安排在建立這個方案之後又被修改過，套用前請看清楚差異。</Notice>
      ) : null}
      <ActionFeedback state={applyState} />

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="min-w-0 font-serif text-title font-semibold break-words text-ink">{scenario.name}</h2>
          {canEdit && !isBackup ? <RenameSeatingScenarioButton workspaceId={workspaceId} detail={detail} /> : null}
          {canEdit ? <DeleteSeatingScenarioButton workspaceId={workspaceId} detail={detail} /> : null}
        </div>
        <p className="text-caption text-ink-soft tabular-nums">
          {detail.tables.length} 桌 · 入座{" "}
          {detail.tables.reduce((total, table) => total + table.seatedHeadcount, 0)} 位 · 座位{" "}
          {detail.tables.reduce((total, table) => total + table.capacity, 0)} 位
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] lg:items-start">
        <section aria-label="方案桌次" className="min-w-0">
          <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {detail.tables.map((table) => (
              <li key={table.id} className="min-w-0">
                <ScenarioTableCard
                  workspaceId={workspaceId}
                  detail={detail}
                  table={table}
                  canEdit={canEdit && !isBackup}
                />
              </li>
            ))}
            {canEdit && !isBackup ? (
              <li className="min-w-0">
                <ScenarioTableDialogButton workspaceId={workspaceId} detail={detail} />
              </li>
            ) : null}
          </ul>
          <ul aria-label="圖例" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-faint">
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-full border-2 border-sage" />坐滿</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-full border-2 border-danger" />超過座位</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-full border-2 border-dashed border-clay" />此方案新增</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-full border-2 border-caution" />和正式安排不同</li>
          </ul>
        </section>

        <aside className="min-w-0 space-y-4">
          <Card as="section" aria-labelledby="scenario-unseated-heading">
            <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
              <h3 id="scenario-unseated-heading" className="font-serif text-body font-semibold text-ink">未入座</h3>
              <p className="text-caption text-ink-soft tabular-nums">
                {attendingUnseated.length} 組 · {attendingUnseated.reduce((total, guest) => total + guest.partySize, 0)} 位
              </p>
            </div>
            {attendingUnseated.length === 0 ? (
              <p className="px-4 py-4 text-caption text-ink-soft">會出席或未回覆的賓客都已排進這個方案。</p>
            ) : (
              <ul className="divide-y divide-line">
                {attendingUnseated.map((guest) => (
                  <ScenarioGuestRow key={guest.id} workspaceId={workspaceId} detail={detail} guest={guest} tableId={null} canEdit={canEdit && !isBackup} />
                ))}
              </ul>
            )}
            {declinedUnseated.length > 0 ? (
              <details className="border-t border-line">
                <summary className="cursor-pointer px-4 py-3 text-caption font-semibold text-ink-soft">
                  不出席的賓客 {declinedUnseated.length} 組
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {declinedUnseated.map((guest) => (
                    <ScenarioGuestRow key={guest.id} workspaceId={workspaceId} detail={detail} guest={guest} tableId={null} canEdit={canEdit && !isBackup} />
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          {detail.assumptions.length > 0 ? (
            <Card as="section" aria-labelledby="scenario-assumptions-heading">
              <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
                <h3 id="scenario-assumptions-heading" className="font-serif text-body font-semibold text-ink">這個方案的假設</h3>
                <p className="text-caption text-ink-soft tabular-nums">{detail.assumptions.length}</p>
              </div>
              <ul className="divide-y divide-line">
                {detail.assumptions.map((item) => (
                  <li key={item.guestId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="min-w-0 text-caption font-medium break-words text-ink">{item.name}</span>
                    <Badge tone={item.attendanceStatus === "DECLINED" ? "danger" : "caution"}>
                      {attendanceText[item.attendanceStatus]} → 坐第 {item.toNumber} 桌
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function tableTone(table: ScenarioTable) {
  if (table.seatedHeadcount > table.capacity) return "border-danger text-danger";
  if (table.differsFromLive) return "border-caution text-caution";
  if (table.seatedHeadcount === table.capacity) return "border-sage text-sage";
  return "border-line-strong text-ink";
}

function ScenarioTableCard({
  workspaceId,
  detail,
  table,
  canEdit,
}: {
  workspaceId: string;
  detail: SeatingScenarioDetail;
  table: ScenarioTable;
  canEdit: boolean;
}) {
  const over = table.seatedHeadcount > table.capacity;
  return (
    <Card as="article" className={cn("h-full", table.addedInScenario && "border-dashed border-clay/60")}>
      <header className="flex min-w-0 items-center gap-3 px-4 pt-4">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-14 shrink-0 flex-col items-center justify-center rounded-full border-2 bg-surface-sunken/60 leading-none",
            table.addedInScenario ? "border-dashed border-clay text-clay-strong" : tableTone(table),
          )}
        >
          <span className="font-serif text-body font-semibold">{table.number}</span>
          <span className="mt-1 text-[0.7rem] font-semibold tabular-nums">
            {table.seatedHeadcount}/{table.capacity}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-body font-semibold break-words text-ink">
            第 {table.number} 桌 · {table.name}
          </h3>
          <p className={cn("mt-0.5 text-caption tabular-nums", over ? "font-semibold text-danger" : "text-ink-faint")}>
            {over ? `超過 ${table.seatedHeadcount - table.capacity} 位` : `剩 ${table.capacity - table.seatedHeadcount} 位`}
            {table.addedInScenario ? " · 此方案新增" : table.differsFromLive ? " · 和正式安排不同" : ""}
          </p>
        </div>
        {canEdit ? (
          <div className="flex shrink-0">
            <ScenarioTableDialogButton workspaceId={workspaceId} detail={detail} table={table} />
            <RemoveScenarioTableButton workspaceId={workspaceId} detail={detail} table={table} />
          </div>
        ) : null}
      </header>
      {table.guests.length === 0 ? (
        <p className="px-4 py-4 text-caption text-ink-faint">還沒有人坐這桌。</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {table.guests.map((guest) => (
            <ScenarioGuestRow key={guest.id} workspaceId={workspaceId} detail={detail} guest={guest} tableId={table.id} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ScenarioGuestRow({
  workspaceId,
  detail,
  guest,
  tableId,
  canEdit,
}: {
  workspaceId: string;
  detail: SeatingScenarioDetail;
  guest: ScenarioGuest;
  tableId: string | null;
  canEdit: boolean;
}) {
  const selectId = useId();
  const [state, dispatch, isPending] = useActionState(
    seatScenarioGuestAction.bind(null, workspaceId, detail.scenario.id),
    idle,
  );
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const current = tableId ?? "";

  return (
    <li className="min-w-0 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <label htmlFor={selectId} className="min-w-0 flex-1 text-caption">
          <span className="font-medium break-words text-ink">{guest.name}</span>
          <span className="ml-1.5 text-ink-faint tabular-nums">{guest.partySize} 位</span>
          {guest.attendanceStatus !== "ATTENDING" ? (
            <span className={cn("ml-1.5 font-semibold", guest.attendanceStatus === "DECLINED" ? "text-danger" : "text-caution")}>
              {attendanceText[guest.attendanceStatus]}
            </span>
          ) : null}
        </label>
        {canEdit ? (
          <Select
            id={selectId}
            value={isPending && pendingValue !== null ? pendingValue : current}
            disabled={isPending}
            className="min-h-9 w-full py-1.5 text-caption sm:w-40"
            onChange={(event) => {
              const value = event.target.value;
              if (value === current) return;
              setPendingValue(value);
              const formData = new FormData();
              formData.set("guestId", guest.id);
              formData.set("tableId", value);
              formData.set("expectedVersion", String(detail.scenario.version));
              startTransition(() => dispatch(formData));
            }}
          >
            {detail.tables.map((table) => (
              <option key={table.id} value={table.id}>
                第 {table.number} 桌 · {table.name}
              </option>
            ))}
            <option value="">不入座</option>
          </Select>
        ) : null}
      </div>
      {state.status === "error" ? <ActionFeedback state={state} className="mt-2" /> : null}
    </li>
  );
}

function ScenarioTableDialogButton({
  workspaceId,
  detail,
  table,
}: {
  workspaceId: string;
  detail: SeatingScenarioDetail;
  table?: ScenarioTable;
}) {
  const titleId = useId();
  const nameId = useId();
  const capacityId = useId();
  const notesId = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const action = table ? updateScenarioTableAction : addScenarioTableAction;
  const [state, formAction, isPending] = useActionState(action.bind(null, workspaceId, detail.scenario.id), idle);
  useEffect(() => {
    if (state.status === "success") close();
  }, [state, close]);

  return (
    <>
      {table ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={open}
          aria-label={`編輯第 ${table.number} 桌`}
          title="編輯這桌"
          className={iconButtonClassName}
        >
          <PencilSimple aria-hidden="true" className="size-4.5" />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={open}
          className="flex h-full min-h-24 w-full items-center justify-center gap-2 rounded-card border border-dashed border-line-strong text-sm font-semibold text-clay-strong transition hover:border-clay hover:bg-clay-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
        >
          <Plus aria-hidden="true" className="size-4.5" />
          加開一桌
        </button>
      )}
      <Dialog
        dialogRef={dialogRef}
        titleId={titleId}
        title={table ? `編輯第 ${table.number} 桌` : "在方案裡加開一桌"}
        closeLabel="關閉"
        size="sm"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction}>
          <input type="hidden" name="expectedVersion" value={detail.scenario.version} />
          {table ? <input type="hidden" name="tableId" value={table.id} /> : null}
          <div className="space-y-4 px-5 py-5 sm:px-6">
            <Field htmlFor={nameId} label="桌名">
              <Input id={nameId} name="name" required maxLength={80} defaultValue={table?.name ?? ""} />
            </Field>
            <Field htmlFor={capacityId} label="座位數">
              <Input id={capacityId} name="capacity" type="number" inputMode="numeric" min={1} max={100} required defaultValue={table?.capacity ?? 10} />
            </Field>
            <Field htmlFor={notesId} label="備註" optional>
              <Textarea id={notesId} name="notes" rows={2} maxLength={500} defaultValue={table?.notes ?? ""} />
            </Field>
            <ActionFeedback state={state} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={isPending}>
              取消
            </Button>
            <SubmitButton isPending={isPending} pendingLabel="儲存中…">
              {table ? "儲存" : "加開"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

function RemoveScenarioTableButton({
  workspaceId,
  detail,
  table,
}: {
  workspaceId: string;
  detail: SeatingScenarioDetail;
  table: ScenarioTable;
}) {
  const titleId = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const [state, formAction, isPending] = useActionState(
    removeScenarioTableAction.bind(null, workspaceId, detail.scenario.id),
    idle,
  );
  useEffect(() => {
    if (state.status === "success") close();
  }, [state, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label={`從方案移除第 ${table.number} 桌`}
        title="從方案移除這桌"
        className={cn(iconButtonClassName, "hover:bg-danger-soft hover:text-danger")}
      >
        <Trash aria-hidden="true" className="size-4.5" />
      </button>
      <Dialog
        dialogRef={dialogRef}
        titleId={titleId}
        title={`從方案移除第 ${table.number} 桌？`}
        description={
          table.guests.length > 0
            ? `這桌的 ${table.guests.length} 組賓客會回到未入座。只影響這個方案。`
            : "只影響這個方案。"
        }
        closeLabel="關閉"
        size="sm"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction}>
          <input type="hidden" name="expectedVersion" value={detail.scenario.version} />
          <input type="hidden" name="tableId" value={table.id} />
          {state.status === "error" ? (
            <div className="px-5 py-4 sm:px-6">
              <ActionFeedback state={state} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={isPending}>
              取消
            </Button>
            <SubmitButton variant="danger-solid" isPending={isPending} pendingLabel="移除中…">
              移除這桌
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

function RenameSeatingScenarioButton({ workspaceId, detail }: { workspaceId: string; detail: SeatingScenarioDetail }) {
  const titleId = useId();
  const inputId = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const [state, formAction, isPending] = useActionState(
    renameSeatingScenarioAction.bind(null, workspaceId, detail.scenario.id),
    idle,
  );
  useEffect(() => {
    if (state.status === "success") close();
  }, [state, close]);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={open} aria-label="重新命名方案" title="重新命名" className={iconButtonClassName}>
        <PencilSimple aria-hidden="true" className="size-4.5" />
      </button>
      <Dialog
        dialogRef={dialogRef}
        titleId={titleId}
        title="重新命名方案"
        closeLabel="關閉"
        size="sm"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction}>
          <input type="hidden" name="expectedVersion" value={detail.scenario.version} />
          <div className="space-y-4 px-5 py-5 sm:px-6">
            <Field htmlFor={inputId} label="方案名稱">
              <Input id={inputId} name="name" required maxLength={40} defaultValue={detail.scenario.name} />
            </Field>
            <ActionFeedback state={state} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={isPending}>
              取消
            </Button>
            <SubmitButton isPending={isPending} pendingLabel="儲存中…">
              儲存
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

function DeleteSeatingScenarioButton({ workspaceId, detail }: { workspaceId: string; detail: SeatingScenarioDetail }) {
  const titleId = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const [state, formAction, isPending] = useActionState(
    deleteSeatingScenarioAction.bind(null, workspaceId, detail.scenario.id),
    idle,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label="刪除方案"
        title="刪除方案"
        className={cn(iconButtonClassName, "hover:bg-danger-soft hover:text-danger")}
      >
        <Trash aria-hidden="true" className="size-4.5" />
      </button>
      <Dialog
        dialogRef={dialogRef}
        titleId={titleId}
        title={`刪除「${detail.scenario.name}」？`}
        description="只刪除這個方案，正式安排不受影響。"
        closeLabel="關閉"
        size="sm"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction}>
          <input type="hidden" name="expectedVersion" value={detail.scenario.version} />
          {state.status === "error" ? (
            <div className="px-5 py-4 sm:px-6">
              <ActionFeedback state={state} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={isPending}>
              取消
            </Button>
            <SubmitButton variant="danger-solid" isPending={isPending} pendingLabel="刪除中…">
              刪除方案
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

// ─── 套用前的差異確認 ─────────────────────────────────────────────────────

function DiffSection({
  title,
  count,
  tone = "neutral",
  children,
}: {
  title: string;
  count: string;
  tone?: "neutral" | "danger";
  children?: ReactNode;
}) {
  return (
    <li className={cn("px-4 py-3", tone === "danger" && "bg-danger-soft text-danger")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("text-sm font-semibold", tone === "danger" ? "text-danger" : "text-ink")}>{title}</p>
        <p className="shrink-0 text-sm font-semibold tabular-nums">{count}</p>
      </div>
      {children ? (
        <p className={cn("mt-1 text-caption leading-6 break-words", tone === "danger" ? "text-danger" : "text-ink-soft")}>
          {children}
        </p>
      ) : null}
    </li>
  );
}

function listNames(items: string[], limit = 6) {
  return items.length > limit ? `${items.slice(0, limit).join("、")}…等 ${items.length} 組` : items.join("、");
}

export function ApplySeatingScenarioButton({
  workspaceId,
  detail,
  onApplied,
}: {
  workspaceId: string;
  detail: SeatingScenarioDetail;
  onApplied: (state: SeatingScenarioMutationState) => void;
}) {
  const titleId = useId();
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const [state, formAction, isPending] = useActionState(
    applySeatingScenarioAction.bind(null, workspaceId, detail.scenario.id),
    idle,
  );
  const { preview, scenario } = detail;
  const isBackup = scenario.kind === "BACKUP";
  useEffect(() => {
    if (state.status === "success") {
      onApplied(state);
      close();
    }
  }, [state, close, onApplied]);

  return (
    <>
      <Button ref={triggerRef} onClick={open} className="w-full sm:w-auto">
        {isBackup ? "換回這份安排" : "套用為正式安排"}
      </Button>
      <Dialog
        dialogRef={dialogRef}
        titleId={titleId}
        title={isBackup ? `換回「${scenario.name}」？` : `把「${scenario.name}」套用為正式安排？`}
        description="套用後報到、列印與手機都會改用這個安排；賓客的出席回覆不會變。"
        closeLabel="關閉"
        isPending={isPending}
        onClose={close}
        onRestoreFocus={restoreFocus}
      >
        <form action={formAction}>
          <input type="hidden" name="expectedVersion" value={scenario.version} />
          <input type="hidden" name="expectedLiveFingerprint" value={detail.liveFingerprint} />
          <div className="space-y-4 px-5 py-5 sm:px-6">
            {!preview.hasChanges ? (
              <Notice tone="info">這個方案和目前的正式安排完全相同，沒有需要套用的變更。</Notice>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
                {preview.moved.length > 0 ? (
                  <DiffSection title="換桌" count={`${preview.moved.length} 組`}>
                    {listNames(preview.moved.map((item) => `${item.name} 第 ${item.fromNumber} → ${item.toNumber} 桌`))}
                  </DiffSection>
                ) : null}
                {preview.addedTableCount > 0 ? (
                  <DiffSection title="新增桌次" count={`${preview.addedTableCount} 桌`} />
                ) : null}
                {preview.removedTableCount > 0 ? (
                  <DiffSection title="減少桌次" count={`${preview.removedTableCount} 桌`} />
                ) : null}
                {preview.changedTables.length > 0 ? (
                  <DiffSection title="桌名或座位數調整" count={`${preview.changedTables.length} 桌`}>
                    {listNames(
                      preview.changedTables.map(
                        (item) =>
                          `第 ${item.number} 桌 ${item.before.name} ${item.before.capacity} 位 → ${item.after.name} ${item.after.capacity} 位`,
                      ),
                      4,
                    )}
                  </DiffSection>
                ) : null}
                {preview.newlySeated.length > 0 ? (
                  <DiffSection title="原本未安排、這次入座" count={`${preview.newlySeated.length} 組`}>
                    {listNames(preview.newlySeated.map((item) => `${item.name} 第 ${item.toNumber} 桌`))}
                  </DiffSection>
                ) : null}
                {preview.unseated.length > 0 ? (
                  <DiffSection title="改成未安排" count={`${preview.unseated.length} 組`}>
                    {listNames(preview.unseated.map((item) => item.name))}
                  </DiffSection>
                ) : null}
                {preview.willNotSeat.length > 0 ? (
                  <DiffSection title="不會入座" count={`${preview.willNotSeat.length} 組`} tone="danger">
                    {listNames(preview.willNotSeat.map((item) => item.name))}
                    目前回覆「不出席」，以實際回覆為準；若確定要來，請先到賓客名單改成出席。
                  </DiffSection>
                ) : null}
              </ul>
            )}
            {preview.overCapacity.length > 0 ? (
              <Notice tone="danger" role="alert">
                {preview.overCapacity.map((item) => `第 ${item.number} 桌 ${item.name}（${item.seated}/${item.capacity}）`).join("、")}
                超過座位，請先在方案裡調整。
              </Notice>
            ) : null}
            {preview.hasChanges && preview.canApply ? (
              <Notice tone="positive">目前的正式安排會自動存成一份備份，隨時可以換回來。</Notice>
            ) : null}
            <ActionFeedback state={state} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={isPending}>
              取消
            </Button>
            <SubmitButton isPending={isPending} pendingLabel="套用中…" disabled={!preview.hasChanges || !preview.canApply}>
              確認套用
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
