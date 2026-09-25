"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  WeddingTimelineListItem,
  WeddingTimelineStaffOption,
} from "@/lib/wedding-timeline-list";
import {
  CreateWeddingTimelineItemForm,
  DeleteWeddingTimelineItemForm,
  EditWeddingTimelineItemForm,
  GeneralLunchTimelineTemplateForm,
} from "./timeline-forms";
import { Badge } from "@/components/ui/badge";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { cn } from "@/lib/class-names";

const timelineHeadingId = "wedding-timeline-list-heading";

function timelineEditTriggerId(itemId: string) {
  return `wedding-timeline-edit-${itemId}`;
}

export function WeddingTimelineList({
  workspaceId,
  items,
  staff,
  canEdit,
}: {
  workspaceId: string;
  items: WeddingTimelineListItem[];
  staff: WeddingTimelineStaffOption[];
  canEdit: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousIdsRef = useRef(items.map((item) => item.id));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const previousIds = previousIdsRef.current;
    const currentIds = items.map((item) => item.id);
    previousIdsRef.current = currentIds;
    if (!canEdit) return;

    const removedIndex = previousIds.findIndex(
      (id) => !currentIds.includes(id),
    );
    let focusTargetId: string | null = null;
    if (removedIndex >= 0) {
      setNotice("已刪除流程項目。");
      const adjacentId =
        currentIds[removedIndex] ?? currentIds[removedIndex - 1] ?? null;
      focusTargetId = adjacentId
        ? timelineEditTriggerId(adjacentId)
        : timelineHeadingId;
    } else if (
      previousIds.length === 0 &&
      (currentIds.length === 8 || currentIds.length === 9)
    ) {
      setNotice("已建立詳細午宴流程範本，所有項目都可以繼續編輯。");
      focusTargetId = timelineEditTriggerId(currentIds[0]);
    }

    if (focusTargetId) {
      queueMicrotask(() => {
        (document.getElementById(focusTargetId) ?? headingRef.current)?.focus({ preventScroll: true });
      });
    }
  }, [canEdit, items]);

  if (items.length === 0) {
    return (
      <section
        role="region"
        aria-label="尚無婚禮總流程"
        className="mt-6 min-w-0 rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center"
      >
        <h2
          id={timelineHeadingId}
          ref={headingRef}
          tabIndex={-1}
          className="font-serif text-title font-semibold text-ink outline-none"
        >
          尚未建立婚禮總流程
        </h2>
        {notice ? (
          <p role="status" className="mt-2 text-caption font-medium text-positive">
            {notice}
          </p>
        ) : null}
        <p className="mx-auto mt-2 max-w-md text-caption leading-6 text-ink-soft">
          {canEdit
            ? "可自行新增第一項，或建立詳細午宴流程範本；套用時可明確選擇是否加入西式證婚流程。"
            : "可以編輯此工作區的成員尚未建立流程。"}
        </p>
        {canEdit && (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <CreateWeddingTimelineItemForm
              workspaceId={workspaceId}
              staff={staff}
            />
            <GeneralLunchTimelineTemplateForm workspaceId={workspaceId} />
          </div>
        )}
      </section>
    );
  }

  const firstStart = items[0].startTime;
  const lastEnd = items.reduce<string>(
    (latest, item) => {
      const candidate = item.endTime ?? item.startTime;
      return candidate > latest ? candidate : latest;
    },
    items[0].endTime ?? items[0].startTime,
  );
  const unassignedCount = items.filter(
    (item) => item.assignedStaff.length === 0,
  ).length;

  return (
    <div className="mt-6 min-w-0 space-y-5">
      <h2
        id={timelineHeadingId}
        ref={headingRef}
        tabIndex={-1}
        className="sr-only"
      >
        婚禮總流程列表
      </h2>
      {notice ? (
        <p
          role="status"
          className="rounded-card border border-positive/30 bg-positive-soft px-4 py-3 text-caption font-medium text-positive"
        >
          {notice}
        </p>
      ) : null}

      <dl
        data-timeline-summary
        className="grid min-w-0 grid-cols-3 divide-x divide-line overflow-hidden rounded-card border border-line bg-surface"
      >
        <SummaryCell
          label="全天時段"
          value={
            <>
              <span className="inline-block">{firstStart}</span>
              <span className="inline-block">–{lastEnd}</span>
            </>
          }
        />
        <SummaryCell label="流程段落" value={`${items.length} 段`} />
        <SummaryCell
          label="待指派"
          value={unassignedCount === 0 ? "全部已指派" : `${unassignedCount} 段`}
          tone={unassignedCount === 0 ? "positive" : "caution"}
        />
      </dl>

      <ol
        data-timeline-layout="timeline"
        aria-label="婚禮總流程時間軸"
        className="min-w-0 border-y border-line"
      >
        {items.map((item) => (
          <TimelineRow
            key={item.id}
            item={item}
            actions={
              canEdit ? (
                <>
                  <EditWeddingTimelineItemForm
                    workspaceId={workspaceId}
                    itemId={item.id}
                    staff={staff}
                    assignedStaff={item.assignedStaff}
                    expectedVersion={item.version}
                    triggerId={timelineEditTriggerId(item.id)}
                    startTime={item.startTime}
                    endTime={item.endTime}
                    phase={item.phase}
                    title={item.title}
                    location={item.location}
                    details={item.details}
                    mediaCue={item.mediaCue}
                    notes={item.notes}
                  />
                  <DeleteWeddingTimelineItemForm
                    workspaceId={workspaceId}
                    itemId={item.id}
                    title={item.title}
                    expectedVersion={item.version}
                  />
                </>
              ) : null
            }
          />
        ))}
      </ol>
    </div>
  );
}

const wrapText = "min-w-0 break-words [overflow-wrap:anywhere]";

function splitLines(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "positive" | "caution";
}) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <dt className="text-eyebrow font-semibold text-ink-faint">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums sm:text-base",
          wrapText,
          tone === "positive"
            ? "text-positive"
            : tone === "caution"
              ? "text-caution"
              : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function TimelineRow({
  item,
  actions,
}: {
  item: WeddingTimelineListItem;
  actions: ReactNode;
}) {
  const steps = splitLines(item.details);
  const cues = splitLines(item.mediaCue);
  const hasSide = cues.length > 0;

  return (
    <li
      id={`timeline-item-${item.id}`}
      data-timeline-item
      className="grid min-w-0 scroll-mt-24 border-b border-line last:border-b-0 md:grid-cols-[8.5rem_minmax(0,1fr)]"
    >
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pt-4 md:flex-col md:items-start md:border-r md:border-line md:py-5 md:pr-4">
        <span
          aria-hidden="true"
          className="absolute top-6 -right-[5px] hidden size-2.5 rounded-full border-2 border-surface bg-clay md:block"
        />
        <time className="text-base font-semibold text-clay-strong tabular-nums">
          {item.startTime}
          <span className="font-normal text-ink-faint">
            {item.endTime ? `–${item.endTime}` : " 起"}
          </span>
        </time>
        <Badge tone="brand">
          <span className={cn("max-w-full", wrapText)}>{item.phase}</span>
        </Badge>
      </div>

      <div className="min-w-0 pt-2 pb-5 md:py-5 md:pl-6">
        <div className="flex min-w-0 items-start gap-x-3">
          <div className="min-w-0 flex-1 basis-0">
            <h3 className={cn("font-serif text-title font-semibold text-ink", wrapText)}>
              {item.title}
            </h3>
            {item.location && (
              <p className={cn("mt-0.5 text-caption text-ink-faint", wrapText)}>
                {item.location}
              </p>
            )}
          </div>
          {actions ? (
            <div className="-my-1 flex shrink-0 items-center gap-0.5">{actions}</div>
          ) : null}
        </div>

        <div
          aria-label="負責人"
          role="group"
          className="mt-3 flex min-w-0 flex-wrap gap-1.5"
        >
          {item.assignedStaff.length === 0 ? (
            <span className="rounded-control border border-dashed border-line-strong px-2 py-0.5 text-caption text-ink-faint">
              尚未指派負責人
            </span>
          ) : (
            item.assignedStaff.map((person) => (
              <span
                key={person.id}
                data-staff-chip
                className={cn(
                  "max-w-full rounded-control border border-sage/25 bg-sage-soft px-2 py-0.5 text-caption text-sage",
                  wrapText,
                )}
              >
                <span className="font-semibold">{person.roleName}</span>
                ・{person.personName}
              </span>
            ))
          )}
        </div>

        {(steps.length > 0 || hasSide) && (
          <div
            className={cn(
              "mt-4 grid min-w-0 gap-x-8 gap-y-4",
              hasSide && "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]",
            )}
          >
            {steps.length > 1 ? (
              <ol className="min-w-0 space-y-1.5 text-sm leading-6 text-ink">
                {steps.map((step, index) => (
                  <li key={index} className="flex min-w-0 gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[0.7rem] font-semibold text-ink-soft tabular-nums"
                    >
                      {index + 1}
                    </span>
                    <span className={wrapText}><LinkifiedText text={step} /></span>
                  </li>
                ))}
              </ol>
            ) : steps.length === 1 ? (
              <p className={cn("text-sm leading-6 text-ink", wrapText)}>
                <LinkifiedText text={steps[0]} />
              </p>
            ) : (
              <span className="hidden lg:block" />
            )}
            {hasSide && (
              <div className="min-w-0 border-l-2 border-clay/30 pl-4">
                <h4 className="text-eyebrow font-semibold text-ink-faint">
                  音樂／影片
                </h4>
                <ul className="mt-1.5 space-y-1 text-caption leading-5 text-clay-strong">
                  {cues.map((cue, index) => (
                    <li key={index} className={wrapText}>
                      <LinkifiedText text={cue} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {item.notes && (
          <div className="mt-4 min-w-0 rounded-control border-l-[3px] border-caution bg-caution-soft px-3 py-2">
            <p className="text-eyebrow font-semibold text-caution">備註</p>
            <p
              className={cn(
                "mt-0.5 text-caption leading-6 whitespace-pre-wrap text-ink",
                wrapText,
              )}
            >
              <LinkifiedText text={item.notes} />
            </p>
          </div>
        )}
      </div>
    </li>
  );
}
