"use client";
import { useActionState, useId, useState } from "react";
import { applyWeddingTaskTemplateAction, type TaskTemplateState } from "@/actions/wedding-task-templates";
import { WEDDING_TASK_TEMPLATES } from "@/domain/wedding-task-templates";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { ActionFeedback } from "@/components/ui/action-feedback";

export function TaskTemplateDialog({ workspaceId }: { workspaceId: string }) {
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const titleId = useId();
  const [selection, setSelection] = useState<string>("ENGAGEMENT");
  const [showFeedback, setShowFeedback] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: TaskTemplateState, form: FormData) => {
    const result = await applyWeddingTaskTemplateAction(workspaceId, previous, form);
    setShowFeedback(true);
    return result;
  }, { status: "idle" });
  const template = WEDDING_TASK_TEMPLATES.find((item) => item.key === selection) ?? WEDDING_TASK_TEMPLATES[0];
  return <>
    <Button ref={triggerRef} variant="secondary" onClick={open}>從範本新增</Button>
    <Dialog dialogRef={dialogRef} titleId={titleId} title="選擇任務範本" closeLabel="關閉任務範本"
      onClose={close} onRestoreFocus={restoreFocus} isPending={pending}>
      {/* Server Action 成功後 React 會重設表單；保留目前範本，讓選單、預覽與下次提交一致。 */}
      <form action={formAction} aria-label="加入任務範本" onSubmit={() => setShowFeedback(false)} onReset={(event) => event.preventDefault()}>
        <div className="space-y-4 px-5 py-6">
          <label className="block">任務類型
            <select name="templateKey" value={selection} disabled={pending} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
              onChange={(event) => { setSelection(event.target.value); setShowFeedback(false); }}>
              {WEDDING_TASK_TEMPLATES.map((item) => <option key={item.key} value={item.key}>{item.label}（{item.tasks.length} 項）</option>)}
            </select>
          </label>
          <p>{template.description}</p>
          <ol className="list-inside list-decimal space-y-3" aria-label="將加入的任務">
            {template.tasks.map((task) => <li key={task.key}><strong>{task.title}</strong><p className="mt-1 text-sm text-ink-soft">{task.description}</p></li>)}
          </ol>
          <p className="text-sm text-ink-soft">加入為共同待辦，不預設期限。相同範本或同名任務會略過，不覆蓋已修改或已完成的任務；加入後仍可自行調整或刪除。</p>
          {showFeedback && <ActionFeedback state={state} />}
        </div>
        <DialogFooter><SubmitButton isPending={pending} pendingLabel="正在加入…">加入{template.label}</SubmitButton></DialogFooter>
      </form>
    </Dialog>
  </>;
}
