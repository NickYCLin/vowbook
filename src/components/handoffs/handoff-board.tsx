"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { saveHandoffAction, setHandoffStatusAction, deleteHandoffAction, type HandoffMutationState } from "@/actions/coordinator-handoffs";
import { HANDOFF_PHASE_LABELS, HANDOFF_STATUS_LABELS, handoffLocalTime, type HandoffPhase, type HandoffStatus } from "@/domain/coordinator-handoff";
import type { HandoffListData } from "@/lib/coordinator-handoffs";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

type Item = HandoffListData["items"][number];
const idle: HandoffMutationState = { status: "idle" };
function useSaved(state: HandoffMutationState, onSaved: (message: string) => void) {
  const previous = useRef(state);
  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    if (state.status === "success") onSaved(state.message ?? "已儲存。");
  }, [state, onSaved]);
}
function HandoffEditor({ workspaceId, item, data, onCancel, onSaved }: {
  workspaceId: string; item: Item | null; data: HandoffListData; onCancel: () => void; onSaved: (message: string) => void;
}) {
  const prefix = useId();
  const [fields, setFields] = useState({
    title: item?.title ?? "", details: item?.details ?? "", staffId: item?.staffId ?? "",
    phase: item?.phase ?? "EVENT_DAY", status: item?.status ?? "PENDING",
    dueAt: handoffLocalTime(item?.dueAt ?? null), timelineItemId: item?.timelineItemId ?? "",
  });
  function changeField(event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = event.target;
    setFields((current) => ({ ...current, [name]: value }));
  }
  const [state, action, pending] = useActionState(saveHandoffAction.bind(null, workspaceId, item?.id ?? null), idle);
  useSaved(state, onSaved);
  const latest = item ? data.items.find((row) => row.id === item.id) : null;
  const stale = !!item && (!latest || latest.version !== item.version);
  return <form action={action} className="mb-6 space-y-5 rounded-card border border-line bg-surface p-5">
    <h2 className="font-serif text-xl">{item ? "編輯交辦事項" : "新增交辦事項"}</h2>
    {item ? <input type="hidden" name="expectedVersion" value={item.version} /> : null}
    <Field htmlFor={prefix + "-title"} label="需要協助什麼？">
      <Input id={prefix + "-title"} name="title" required maxLength={120} onChange={changeField} value={fields.title} placeholder="例如：確認素食餐點與送餐桌次" />
    </Field>
    <div className="grid gap-5 sm:grid-cols-2">
      <Field htmlFor={prefix + "-staff"} label="負責人">
        <Select id={prefix + "-staff"} name="staffId" onChange={changeField} value={fields.staffId}>
          <option value="">總召（人選待定）</option>
          {data.staff.map((person) => <option key={person.id} value={person.id}>{person.roleName}・{person.personName}</option>)}
        </Select>
      </Field>
      <Field htmlFor={prefix + "-phase"} label="處理時機">
        <Select id={prefix + "-phase"} name="phase" onChange={changeField} value={fields.phase}>
          {Object.entries(HANDOFF_PHASE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Field>
      <Field htmlFor={prefix + "-due"} label="完成時間" optional hint="以台灣時間（UTC+8）記錄。">
        <Input id={prefix + "-due"} type="datetime-local" name="dueAt" onChange={changeField} value={fields.dueAt} />
      </Field>
      <Field htmlFor={prefix + "-flow"} label="關聯當日流程" optional>
        <Select id={prefix + "-flow"} name="timelineItemId" onChange={changeField} value={fields.timelineItemId}>
          <option value="">不關聯流程</option>
          {data.timeline.map((flow) => <option key={flow.id} value={flow.id}>{String(Math.floor(flow.startMinute / 60)).padStart(2, "0")}:{String(flow.startMinute % 60).padStart(2, "0")}・{flow.title}</option>)}
        </Select>
      </Field>
    </div>
    <Field htmlFor={prefix + "-details"} label="交代內容" hint="最多 2,000 字，可寫清楚要做的事、確認對象，以及遇到問題時找誰。">
      <Textarea id={prefix + "-details"} name="details" rows={4} required maxLength={2000} onChange={changeField} value={fields.details} />
    </Field>
    <Field htmlFor={prefix + "-status"} label="處理狀態">
      <Select id={prefix + "-status"} name="status" onChange={changeField} value={fields.status}>
        {Object.entries(HANDOFF_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
    </Field>
    {stale ? <p role="alert">這筆事項已被更新或移除，請保留需要的文字，再取消並重新開啟最新內容。</p> : null}
    <ActionFeedback state={state} />
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>取消</Button>
      <Button type="submit" disabled={pending || stale || state.status === "success"}>{pending ? "儲存中…" : "儲存交辦事項"}</Button>
    </div>
  </form>;
}
function HandoffActions({ workspaceId, item, onEdit, onSaved, editing }: { workspaceId: string; item: Item; editing: boolean; onEdit: () => void; onSaved: (message: string) => void }) {
  const [state, action, pending] = useActionState(setHandoffStatusAction.bind(null, workspaceId, item.id), idle);
  const [deleteState, remove, deleting] = useActionState(deleteHandoffAction.bind(null, workspaceId, item.id), idle);
  useSaved(state, onSaved);
  useSaved(deleteState, onSaved);
  const disabled = editing || pending || deleting || state.status === "success" || deleteState.status === "success";
  return <div className="mt-4 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <form action={action} className="flex min-w-0 flex-wrap gap-2">
        <input type="hidden" name="expectedVersion" value={item.version} />
        <Select name="status" aria-label={item.title + "的處理狀態"} defaultValue={item.status} className="sm:w-auto" disabled={disabled}>
          {Object.entries(HANDOFF_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Button type="submit" variant="secondary" disabled={disabled}>更新狀態</Button>
      </form>
      <Button variant="ghost" onClick={onEdit} disabled={disabled} aria-label={"編輯 " + item.title}>編輯</Button>
    </div>
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-caption text-ink-soft">移除事項</summary>
      <form action={remove} className="space-y-2">
        <p className="text-caption">確定移除「{item.title}」？移除後無法復原。</p>
        <input type="hidden" name="expectedVersion" value={item.version} />
        <Button type="submit" variant="danger" disabled={disabled}>確認移除</Button>
      </form>
    </details>
    <ActionFeedback state={state} /><ActionFeedback state={deleteState} />
  </div>;
}
export function HandoffBoard({ workspaceId, data, canEdit, defaultCreateOpen = false }: { workspaceId: string; data: HandoffListData; canEdit: boolean; defaultCreateOpen?: boolean }) {
  const router = useRouter();
  const [editor, setEditor] = useState<{ item: Item | null } | null>(defaultCreateOpen ? { item: null } : null);
  const [feedback, setFeedback] = useState("");
  function saved(message: string) { setFeedback(message); router.refresh(); }
  return <section className="min-w-0 space-y-5" aria-label="總召交辦清單">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-ink-soft">共 {data.items.length} 項・{data.items.filter((item) => item.status !== "DONE").length} 項尚未完成</p>
      {canEdit ? <Button onClick={() => setEditor({ item: null })} disabled={editor !== null}>＋ 新增交辦事項</Button> : null}
    </div>
    {feedback ? <div className="space-y-2"><p role="status">{feedback}</p><Button variant="ghost" onClick={() => router.refresh()}>重新整理清單</Button></div> : null}
    {canEdit && editor ? <HandoffEditor workspaceId={workspaceId} item={editor.item} data={data} onCancel={() => setEditor(null)} onSaved={(message) => { setEditor(null); saved(message); }} /> : null}
    {data.items.length === 0 ? <EmptyState title="還沒有交辦事項" description="先記下需要總召協助的事，人選與流程可以之後再補。" /> : (
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {data.items.map((item) => {
          const person = data.staff.find((staff) => staff.id === item.staffId);
          const flow = data.timeline.find((timeline) => timeline.id === item.timelineItemId);
          return <li key={item.id} className="min-w-0 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words font-serif text-lg">{item.title}</h3>
              <Badge tone={item.status === "DONE" ? "positive" : "neutral"}>{HANDOFF_STATUS_LABELS[item.status as HandoffStatus]}</Badge>
            </div>
            <p className="mt-2 break-words text-caption text-ink-soft">{person ? person.roleName + "・" + person.personName : "總召（人選待定）"} ／ {HANDOFF_PHASE_LABELS[item.phase as HandoffPhase]}{item.dueAt ? " ／ " + handoffLocalTime(item.dueAt).replace("T", " ") + "（台灣時間）" : ""}</p>
            <p className="mt-3 whitespace-pre-wrap break-words">{item.details}</p>
            {flow ? <p className="mt-3"><Link className="inline-flex min-h-11 items-center break-words text-clay-strong underline md:hidden" href={`/workspaces/${workspaceId}/timeline#timeline-mobile-${flow.id}`}>關聯流程：{flow.title}</Link><Link className="hidden min-h-11 items-center break-words text-clay-strong underline md:inline-flex" href={`/workspaces/${workspaceId}/timeline#timeline-desktop-${flow.id}`}>關聯流程：{flow.title}</Link></p> : null}
            {canEdit ? <HandoffActions key={item.id + ":" + item.version} workspaceId={workspaceId} item={item} editing={editor !== null} onEdit={() => setEditor({ item })} onSaved={saved} /> : null}
          </li>;
        })}
      </ul>
    )}
  </section>;
}
