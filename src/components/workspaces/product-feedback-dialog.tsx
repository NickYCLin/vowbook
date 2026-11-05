"use client";

import { useActionState, useId, useState } from "react";
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";
import { submitProductFeedbackAction, type ProductFeedbackState } from "@/actions/product-feedback";
import { feedbackCategories, feedbackSections } from "@/domain/product-feedback";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import type { WorkspaceSection } from "./workspace-sections";

function FeedbackForm({ workspaceId, section, requestId, close, setPending, startNew }: {
  workspaceId: string; section: WorkspaceSection; requestId: string; close: () => void; setPending: (pending: boolean) => void; startNew: () => void;
}) {
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [category, setCategory] = useState("");
  const [selectedSection, setSection] = useState("");
  const [state, action, pending] = useActionState<ProductFeedbackState, FormData>(async (previous, formData) => {
    setPending(true);
    try { return await submitProductFeedbackAction(workspaceId, previous, formData); }
    catch { return { status: "error", message: "連線中斷，內容仍保留，請重試。" }; }
    finally { setPending(false); }
  }, { status: "idle" });
  if (state.status === "success") return <div className="space-y-4 p-5" role="status">
    <h3 className="font-semibold">謝謝，你的回饋已保存！</h3>
    <p className="break-all text-sm text-ink-soft">回饋編號：{state.reference}</p>
    <p className="text-sm text-ink-soft">系統管理者可在意見回饋管理頁查看；不代表已讀取或承諾完成時間。</p>
    <Button onClick={close}>完成</Button>
    <Button variant="secondary" onClick={startNew}>再寫一則回饋</Button>
  </div>;
  const fieldClass = "mt-2 block min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-base";
  return <form action={action}>
    <fieldset disabled={pending} className="space-y-4 p-5">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block text-sm font-semibold">回饋類型（選填）<select name="category" className={fieldClass} value={category} onChange={event => setCategory(event.target.value)}><option value="">不分類</option>{Object.entries(feedbackCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block text-sm font-semibold">相關功能（選填）<select name="section" className={fieldClass} value={selectedSection} onChange={event => setSection(event.target.value)}><option value="">一般想法／不限定功能</option>{Object.entries(feedbackSections).filter(([value]) => value !== "general").map(([value, label]) => <option key={value} value={value}>{label}{value === section ? "（目前頁面）" : ""}</option>)}</select></label>
      <label className="block text-sm font-semibold">回饋內容<textarea name="message" className={fieldClass} rows={5} required value={content} onChange={event => setContent(event.target.value)} placeholder="任何想法都歡迎，簡短一句或詳細說明都可以，不必是目前頁面的問題。" /></label>
      <label className="block text-sm font-semibold">回覆電子郵件（選填）<input type="email" name="contact" className={fieldClass} maxLength={254} value={contact} onChange={event => setContact(event.target.value)} autoComplete="email" /></label>
      <p className="text-xs leading-6 text-ink-soft">僅送出你填寫的內容、功能類別與必要的帳號／工作區識別，供系統管理者處理。不會自動附上名單、禮金、邀請連結或截圖。請勿填寫密碼、金鑰或賓客個資；不填電子郵件也能送出。</p>
      {state.status === "error" && <p role="alert" className="text-sm text-danger">{state.message}</p>}
    </fieldset>
    <DialogFooter><Button variant="secondary" disabled={pending} onClick={close}>暫時關閉，保留內容</Button><SubmitButton isPending={pending} pendingLabel="保存中…">送出回饋</SubmitButton></DialogFooter>
  </form>;
}

export function ProductFeedbackDialog({ workspaceId, section }: { workspaceId: string; section: WorkspaceSection }) {
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const titleId = useId();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return <>
    <button ref={triggerRef} type="button" onClick={() => { if (!requestId) setRequestId(crypto.randomUUID()); open(); }} className="workspace-sidebar-link flex min-h-11 items-center justify-center gap-2 rounded-control border border-line px-3 text-sm font-semibold text-ink-soft hover:bg-clay-soft md:order-last md:ml-3 md:mt-4 max-md:min-h-[4.5rem] max-md:flex-col">
      <ChatCircleText aria-hidden="true" className="size-5" />意見回饋
    </button>
    <Dialog dialogRef={dialogRef} titleId={titleId} title="意見回饋" description="告訴我們你的使用習慣，或哪裡可以做得更好。" closeLabel="關閉意見回饋" isPending={pending} onClose={close} onRestoreFocus={restoreFocus}>
      {requestId && <FeedbackForm key={requestId} workspaceId={workspaceId} section={section} requestId={requestId} close={close} setPending={setPending} startNew={() => setRequestId(crypto.randomUUID())} />}
    </Dialog>
  </>;
}
