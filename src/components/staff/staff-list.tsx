"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  summarizeWeddingStaffMeals,
  summarizeWeddingStaffRedEnvelopes,
} from "@/domain/wedding-staff";
import { setWeddingStaffRedEnvelopeSentAction } from "@/actions/wedding-staff";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { SubmitButton } from "@/components/ui/button";
import type { WeddingStaffListItem } from "@/lib/wedding-staff-list";
import {
  CreateWeddingStaffForm,
  DeleteWeddingStaffForm,
  EditWeddingStaffForm,
} from "./staff-forms";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat, StatRow } from "@/components/ui/stat";

const staffHeadingId = "wedding-staff-list-heading";
const LEAD_RECEPTION_ROLE = "總招待";

function staffEditTriggerId(staffId: string) {
  return `wedding-staff-edit-${staffId}`;
}

/** 只有份數與素食兩個數字，葷食一律由相減得出，避免兩處各記一次。 */
function mealDescription(mealCount: number, vegetarianMealCount: number) {
  const nonVegetarian = mealCount - vegetarianMealCount;
  if (vegetarianMealCount === 0) return `便當 ${mealCount} 份（全葷食）`;
  if (nonVegetarian === 0) return `便當 ${mealCount} 份（全素食）`;
  return `便當 ${mealCount} 份（葷 ${nonVegetarian}／素 ${vegetarianMealCount}）`;
}

function formatTwd(amount: number) {
  return `NT$ ${new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 0,
  }).format(amount)}`;
}

/**
 * 婚宴結束時逐一發紅包，最常做的事就是「發出去了，標一下」，因此做成一次點擊。
 */
function ToggleRedEnvelopeForm({
  workspaceId,
  person,
}: {
  workspaceId: string;
  person: WeddingStaffListItem;
}) {
  const alreadySent = person.redEnvelopeSentAt !== null;
  const toggleAction = setWeddingStaffRedEnvelopeSentAction.bind(
    null,
    workspaceId,
    person.id,
  );
  const [state, formAction, isPending] = useActionState(toggleAction, {
    status: "idle" as const,
  });

  return (
    <form
      action={formAction}
      aria-label={
        alreadySent
          ? `改回 ${person.personName} 尚未發放紅包表單`
          : `標記 ${person.personName} 已發放紅包表單`
      }
      className="min-w-0"
    >
      <input type="hidden" name="expectedVersion" value={person.version} />
      {alreadySent ? null : (
        <input type="hidden" name="redEnvelopeSent" value="on" />
      )}
      <SubmitButton
        isPending={isPending}
        pendingLabel="更新中…"
        variant={alreadySent ? "ghost" : "secondary"}
        size="sm"
        className="min-h-11 sm:min-h-9"
      >
        {alreadySent ? "改回未發放" : "標記已發放"}
      </SubmitButton>
      {state.status === "error" ? (
        <ActionFeedback state={state} className="mt-2" />
      ) : null}
    </form>
  );
}

function groupedStaff(staff: WeddingStaffListItem[]) {
  const groups = new Map<string, WeddingStaffListItem[]>();
  for (const person of staff) {
    const group = groups.get(person.roleName) ?? [];
    group.push(person);
    groups.set(person.roleName, group);
  }
  return [...groups.entries()].sort(([leftRole], [rightRole]) => {
    if (leftRole === LEAD_RECEPTION_ROLE) return -1;
    if (rightRole === LEAD_RECEPTION_ROLE) return 1;
    // 其他職務沿用伺服器已提供的穩定順序，避免為了突出總招待而全面重排。
    return 0;
  });
}

export function WeddingStaffList({
  workspaceId,
  staff,
  canEdit,
}: {
  workspaceId: string;
  staff: WeddingStaffListItem[];
  canEdit: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStaffRef = useRef(
    staff.map(({ id, roleName }) => ({ id, roleName })),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const mealSummary = summarizeWeddingStaffMeals(staff);
  const redEnvelopeSummary = summarizeWeddingStaffRedEnvelopes(staff);

  useEffect(() => {
    const previousStaff = previousStaffRef.current;
    const previousIds = previousStaff.map((person) => person.id);
    const currentIds = staff.map((person) => person.id);
    previousStaffRef.current = staff.map(({ id, roleName }) => ({ id, roleName }));
    if (!canEdit) return;

    const removedIndex = previousIds.findIndex(
      (id) => !currentIds.includes(id),
    );
    let focusTargetId: string | null = null;
    if (removedIndex >= 0) {
      setNotice("已移除婚禮工作人員。");
      const adjacentId =
        currentIds[removedIndex] ?? currentIds[removedIndex - 1] ?? null;
      focusTargetId = adjacentId
        ? staffEditTriggerId(adjacentId)
        : staffHeadingId;
    } else {
      const movedPerson = staff.find((person) => {
        const previous = previousStaff.find(({ id }) => id === person.id);
        return previous && previous.roleName !== person.roleName;
      });
      if (movedPerson) {
        setNotice("已更新婚禮工作人員與職務分組。");
        focusTargetId = staffEditTriggerId(movedPerson.id);
      }
    }

    if (focusTargetId) {
      queueMicrotask(() => {
        (document.getElementById(focusTargetId) ?? headingRef.current)?.focus();
      });
    }
  }, [canEdit, staff]);

  const groups = groupedStaff(staff);

  return (
    <div className="mt-6 min-w-0 space-y-5">
      <h2
        id={staffHeadingId}
        ref={headingRef}
        tabIndex={-1}
        className="sr-only"
      >
        婚禮工作人員列表
      </h2>

      {notice ? (
        <p
          role="status"
          className="rounded-card border border-positive/30 bg-positive-soft px-4 py-3 text-caption font-medium text-positive"
        >
          {notice}
        </p>
      ) : null}

      {staff.length === 0 ? (
        <section aria-label="尚無婚禮工作人員" className="min-w-0">
          <EmptyState
            title="尚未加入婚禮工作人員"
            description={
              canEdit
                ? "可依主持、招待、攝影或其他實際職務逐一加入。"
                : "可以編輯此工作區的成員尚未加入工作人員。"
            }
            action={
              canEdit ? (
                <CreateWeddingStaffForm workspaceId={workspaceId} />
              ) : null
            }
          />
        </section>
      ) : (
        <>
          <Card>
            <div className="px-5 py-5 sm:px-6">
              <StatRow className="sm:grid-cols-3">
                <Stat label="工作人員" value={staff.length} unit="位" />
                <Stat label="職務分組" value={groups.length} unit="組" />
                <Stat
                  label="便當份數"
                  value={mealSummary.mealCount}
                  unit="份"
                  hint={`${mealSummary.entryCount} 筆需要便當`}
                  tone="brand"
                />
                <Stat
                  label="葷素分配"
                  value={`葷 ${mealSummary.nonVegetarianMealCount}`}
                  unit={`／素 ${mealSummary.vegetarianMealCount}`}
                  hint="素食份數含在便當份數內"
                />
              </StatRow>
              <StatRow className="mt-5 sm:grid-cols-3">
                <Stat
                  label="紅包總額"
                  value={formatTwd(redEnvelopeSummary.plannedAmount)}
                  hint={`${redEnvelopeSummary.plannedCount} 位要包紅包`}
                  tone="brand"
                />
                <Stat
                  label="已發放"
                  value={redEnvelopeSummary.sentCount}
                  unit="位"
                  hint={formatTwd(redEnvelopeSummary.sentAmount)}
                  tone="positive"
                />
                <Stat
                  label="尚未發放"
                  value={redEnvelopeSummary.pendingCount}
                  unit="位"
                  hint={formatTwd(redEnvelopeSummary.pendingAmount)}
                  tone={
                    redEnvelopeSummary.pendingCount > 0 ? "caution" : "neutral"
                  }
                />
              </StatRow>
            </div>
          </Card>

          {groups.map(([roleName, people]) => (
            <Card key={roleName} as="section" role="region" aria-label={roleName}>
              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line bg-surface-sunken/60 px-5 py-3 sm:px-6">
                <h2 className="min-w-0 font-serif text-title font-semibold break-words text-ink [overflow-wrap:anywhere]">
                  {roleName}
                </h2>
                <Badge tone="brand">{people.length} 位</Badge>
              </div>
              <ul className="min-w-0 divide-y divide-line">
                {people.map((person) => (
                  <li
                    key={person.id}
                    className="flex min-w-0 flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"
                  >
                    <div className="min-w-0">
                      <h3 className="min-w-0 font-serif text-base font-semibold break-words text-ink [overflow-wrap:anywhere]">
                        {person.personName}
                      </h3>
                      {person.contactPhone && (
                        <p className="mt-1 min-w-0 text-caption break-words text-ink-soft [overflow-wrap:anywhere]">
                          {person.contactPhone}
                        </p>
                      )}
                      <p className="mt-1 text-caption text-ink-soft">
                        {person.mealCount === null
                          ? "不需要便當"
                          : mealDescription(
                              person.mealCount,
                              person.vegetarianMealCount ?? 0,
                            )}
                      </p>
                      {person.redEnvelopeAmount === null ? null : (
                        <p
                          className={
                            person.redEnvelopeSentAt
                              ? "mt-1 text-caption font-semibold text-positive"
                              : "mt-1 text-caption font-semibold text-caution"
                          }
                        >
                          紅包 {formatTwd(person.redEnvelopeAmount)}・
                          {person.redEnvelopeSentAt ? "已發放" : "尚未發放"}
                        </p>
                      )}
                      {person.notes && (
                        <p className="mt-1.5 min-w-0 text-caption leading-6 break-words whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
                          {person.notes}
                        </p>
                      )}
                    </div>
                    {/* 動作區不能 shrink-0：觸發鈕帶著使用者輸入的姓名，會把整列撐爆。 */}
                    {canEdit && (
                      <div className="flex min-w-0 flex-wrap items-center gap-1 sm:justify-end">
                        {person.redEnvelopeAmount === null ? null : (
                          <ToggleRedEnvelopeForm
                            workspaceId={workspaceId}
                            person={person}
                          />
                        )}
                        <EditWeddingStaffForm
                          workspaceId={workspaceId}
                          staffId={person.id}
                          roleName={person.roleName}
                          personName={person.personName}
                          contactPhone={person.contactPhone}
                          notes={person.notes}
                          mealCount={person.mealCount}
                          vegetarianMealCount={person.vegetarianMealCount}
                          redEnvelopeAmount={person.redEnvelopeAmount}
                          expectedVersion={person.version}
                          triggerId={staffEditTriggerId(person.id)}
                        />
                        <DeleteWeddingStaffForm
                          workspaceId={workspaceId}
                          staffId={person.id}
                          personName={person.personName}
                          expectedVersion={person.version}
                          timelineAssignmentFingerprint={
                            person.timelineAssignmentFingerprint
                          }
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
