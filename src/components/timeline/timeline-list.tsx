"use client";

import { useEffect, useRef, useState } from "react";
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
import { Card } from "@/components/ui/card";

const timelineHeadingId = "wedding-timeline-list-heading";

function timelineEditTriggerId(itemId: string) {
  return `wedding-timeline-edit-${itemId}`;
}

function timeLabel(item: WeddingTimelineListItem) {
  return item.endTime
    ? `${item.startTime}–${item.endTime}`
    : `${item.startTime} 起`;
}

function StaffNames({ staff }: { staff: WeddingTimelineStaffOption[] }) {
  return staff.length === 0 ? (
    <span className="text-ink-faint">尚未指派</span>
  ) : (
    <span>{staff.map((person) => `${person.roleName}・${person.personName}`).join("、")}</span>
  );
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
    } else if (previousIds.length === 0 && currentIds.length === 9) {
      setNotice("已建立詳細午宴流程範本，所有項目都可以繼續編輯。");
      focusTargetId = timelineEditTriggerId(currentIds[0]);
    }

    if (focusTargetId) {
      queueMicrotask(() => {
        (document.getElementById(focusTargetId) ?? headingRef.current)?.focus();
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
            ? "可自行新增第一項，或建立詳細午宴流程範本；建立後可自由編輯。"
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

  // 桌機與手機是同一份資料的兩種排版；只有桌機那份掛 triggerId，
  // 避免同一個 id 出現兩次，刪除後的焦點還原才找得到唯一目標。
  const rowActions = (item: WeddingTimelineListItem, withTriggerId: boolean) =>
    canEdit ? (
      <div className="flex min-w-0 flex-wrap items-center gap-1 border-t border-line pt-3">
        <EditWeddingTimelineItemForm
          workspaceId={workspaceId}
          itemId={item.id}
          staff={staff}
          assignedStaff={item.assignedStaff}
          expectedVersion={item.version}
          triggerId={withTriggerId ? timelineEditTriggerId(item.id) : undefined}
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
      </div>
    ) : null;

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

      <Card data-timeline-layout="desktop" className="hidden min-w-0 md:block">
        <h2 className="sr-only">婚禮總流程桌面清單</h2>
        <div className="grid grid-cols-[7rem_minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-4 border-b border-line bg-surface-sunken/60 px-5 py-3 text-eyebrow font-semibold text-ink-soft">
          <span>時間</span>
          <span>階段</span>
          <span>流程與地點</span>
          <span>負責人</span>
        </div>
        <ul className="min-w-0 divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="min-w-0 px-5 py-4">
              <div className="grid min-w-0 grid-cols-[7rem_minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
                <time className="font-semibold text-clay-strong tabular-nums">
                  {timeLabel(item)}
                </time>
                <p className="min-w-0 text-caption font-semibold break-words text-ink [overflow-wrap:anywhere]">
                  {item.phase}
                </p>
                <div className="min-w-0">
                  <h3 className="min-w-0 font-serif text-base font-semibold break-words text-ink [overflow-wrap:anywhere]">
                    {item.title}
                  </h3>
                  {item.location && (
                    <p className="mt-1 min-w-0 text-caption break-words text-ink-soft [overflow-wrap:anywhere]">
                      {item.location}
                    </p>
                  )}
                  {item.details && (
                    <p className="mt-2 min-w-0 text-caption leading-6 break-words whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
                      {item.details}
                    </p>
                  )}
                  {item.mediaCue && (
                    <p className="mt-2 min-w-0 text-caption leading-6 break-words whitespace-pre-wrap text-clay-strong [overflow-wrap:anywhere]">
                      音樂／影片：{item.mediaCue}
                    </p>
                  )}
                  {item.notes && (
                    <p className="mt-2 min-w-0 text-caption break-words whitespace-pre-wrap text-ink-faint [overflow-wrap:anywhere]">
                      備註：{item.notes}
                    </p>
                  )}
                </div>
                <p className="min-w-0 text-caption leading-6 break-words text-ink [overflow-wrap:anywhere]">
                  <StaffNames staff={item.assignedStaff} />
                </p>
              </div>
              {canEdit && <div className="mt-3">{rowActions(item, true)}</div>}
            </li>
          ))}
        </ul>
      </Card>

      <section data-timeline-layout="mobile" className="min-w-0 md:hidden">
        <h2 className="sr-only">婚禮總流程手機清單</h2>
        <ul className="min-w-0 space-y-3">
          {items.map((item) => (
            <Card as="li" key={item.id} className="list-none">
              <div className="min-w-0 px-5 py-4">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <time className="font-semibold text-clay-strong tabular-nums">
                    {timeLabel(item)}
                  </time>
                  <Badge tone="brand">
                    <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
                      {item.phase}
                    </span>
                  </Badge>
                </div>
                <h3 className="mt-2 min-w-0 font-serif text-title font-semibold break-words text-ink [overflow-wrap:anywhere]">
                  {item.title}
                </h3>
                {item.location && (
                  <p className="mt-1 min-w-0 text-caption break-words text-ink-soft [overflow-wrap:anywhere]">
                    {item.location}
                  </p>
                )}
                {item.details && (
                  <p className="mt-2 min-w-0 text-caption leading-6 break-words whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
                    {item.details}
                  </p>
                )}
                {item.mediaCue && (
                  <p className="mt-2 min-w-0 text-caption leading-6 break-words whitespace-pre-wrap text-clay-strong [overflow-wrap:anywhere]">
                    音樂／影片：{item.mediaCue}
                  </p>
                )}
                <p className="mt-2 min-w-0 text-caption break-words text-ink [overflow-wrap:anywhere]">
                  負責人：<StaffNames staff={item.assignedStaff} />
                </p>
                {item.notes && (
                  <p className="mt-2 min-w-0 text-caption break-words whitespace-pre-wrap text-ink-faint [overflow-wrap:anywhere]">
                    備註：{item.notes}
                  </p>
                )}
                {canEdit && (
                  <div className="mt-3">{rowActions(item, false)}</div>
                )}
              </div>
            </Card>
          ))}
        </ul>
      </section>
    </div>
  );
}
