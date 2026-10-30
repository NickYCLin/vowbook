"use client";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { normalizeInvitationQuestions, type InvitationQuestion, type InvitationReply } from "@/domain/guest-invitations";
import type { loadGuestInvitationManagement } from "@/lib/guest-invitations";
type Data = Awaited<ReturnType<typeof loadGuestInvitationManagement>>;
type DraftQuestion = InvitationQuestion & { optionText: string };
const field = "mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3 py-2";
const button = "min-h-12 rounded-xl border border-line px-4 py-2 disabled:opacity-50";
export function GuestInvitationManager({ workspaceId, initial }: { workspaceId: string; initial: Data }) {
  const [data, setData] = useState(initial);
  const [venueName, setVenueName] = useState(initial.settings.venueName ?? "");
  const [venueAddress, setVenueAddress] = useState(initial.settings.venueAddress ?? "");
  const [questions, setQuestions] = useState<DraftQuestion[]>(initial.settings.questions.map((item) => ({ ...item, optionText: item.options.join("\n") })));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [issued, setIssued] = useState<{ name: string; url: string; expiresAt: string } | null>(null);
  const [validDays, setValidDays] = useState(30);
  const endpoint = withBasePath(`/api/workspaces/${workspaceId}/guest-invitations`);
  const normalized = questions.map(({ optionText, ...question }) => ({ ...question, options: question.type === "CHOICE" ? optionText.split("\n").map((item) => item.trim()).filter(Boolean) : [] }));
  const dirty = venueName !== (data.settings.venueName ?? "") || venueAddress !== (data.settings.venueAddress ?? "") || JSON.stringify(normalized) !== JSON.stringify(data.settings.questions);
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "目前無法完成操作，請重新載入後再試。");
    return result as T;
  }
  async function reload() { const next = await request<Data>(endpoint); setData(next); return next; }
  async function operate(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "目前無法完成操作。"); }
    finally { setBusy(false); }
  }
  const post = <T,>(body: unknown) => request<T>(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  function edit(index: number, update: Partial<DraftQuestion>) { setQuestions((all) => all.map((item, i) => i === index ? { ...item, ...update } : item)); }
  return <div className="space-y-6">
    <p role="status" aria-live="polite">{message}</p>
    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-4" aria-label="邀請回覆統計">
      <p>已建立邀請 {data.summary.issuedGroups} 組</p><p>已回覆 {data.summary.repliedGroups} 組</p>
      <p>尚未回覆 {data.summary.pendingGroups} 組</p><p>回覆出席 {data.summary.headcount} 人（素食 {data.summary.vegetarianCount} 人）</p>
      <p>出席 {data.summary.attendingGroups} 組</p><p>不出席 {data.summary.declinedGroups} 組</p>
    </div>
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-5" aria-label="邀請表單設定">
      <h2 className="text-xl font-semibold">邀請表單與會館</h2>
      <p>基本題包含出席、人數、素食人數、聯絡電話與飲食需求。可另加最多 8 題文字或單選題。</p>
      <form onSubmit={(event) => { event.preventDefault(); void operate(async () => {
        const checked = normalizeInvitationQuestions(normalized);
        await post({ operation: "settings", expectedVersion: data.settings.version, venueName, venueAddress, questions: checked });
        const next = await reload(); setVenueName(next.settings.venueName ?? ""); setVenueAddress(next.settings.venueAddress ?? "");
        setQuestions(next.settings.questions.map((item) => ({ ...item, optionText: item.options.join("\n") }))); setMessage("邀請表單已儲存。");
      }); }}>
        <fieldset disabled={busy} className="space-y-4">
          <label className="block">會館名稱<input className={field} value={venueName} maxLength={100} onChange={(event) => setVenueName(event.target.value)} /></label>
          <label className="block">會館地址<input className={field} value={venueAddress} maxLength={200} onChange={(event) => setVenueAddress(event.target.value)} /></label>
          {questions.map((question, index) => <fieldset key={question.id} className="space-y-3 rounded-xl border border-line p-4">
            <legend>自訂第 {index + 1} 題</legend>
            <label className="block">自訂題目 {index + 1}<input className={field} required maxLength={100} value={question.label} onChange={(event) => edit(index, { label: event.target.value })} /></label>
            <label className="block">第 {index + 1} 題類型<select className={field} value={question.type} onChange={(event) => edit(index, { type: event.target.value as InvitationQuestion["type"] })}>
              <option value="TEXT">文字</option><option value="CHOICE">單選</option>
            </select></label>
            {question.type === "CHOICE" && <label className="block">第 {index + 1} 題選項（每行一項，共 2 至 6 項）<textarea className={field} value={question.optionText} onChange={(event) => edit(index, { optionText: event.target.value })} /></label>}
            <label className="flex min-h-12 items-center gap-2"><input type="checkbox" checked={question.required} onChange={(event) => edit(index, { required: event.target.checked })} />第 {index + 1} 題必填</label>
            <button type="button" className={button} onClick={() => setQuestions((all) => all.filter((_, i) => i !== index))}>移除第 {index + 1} 題</button>
          </fieldset>)}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={button} disabled={questions.length >= 8} onClick={() => setQuestions((all) => [...all, { id: crypto.randomUUID(), label: "", type: "TEXT", required: false, options: [], optionText: "" }])}>新增自訂題目</button>
            <button type="submit" className={button}>儲存邀請表單</button>
          </div>
        </fieldset>
      </form>
      {dirty && <p>題目或會館資料尚未儲存，請先儲存後再管理連結或會館圖。</p>}
      <div className="space-y-3 border-t border-line pt-4">
        <h3 className="font-semibold">會館平面圖</h3>
        <p>上傳的圖會提供給持有效邀請的賓客，請勿放入名單或個資。接受 PNG、JPEG、WebP，最多 3 MiB。</p>
        <p>{data.settings.hasVenueMap ? "已提供會館圖。" : "尚未提供會館圖，賓客仍可查看桌位示意圖。"}</p>
        <label className="block">上傳會館圖<input type="file" className={field} accept="image/png,image/jpeg,image/webp" disabled={busy || dirty} onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          void operate(async () => {
            if (file.size > 3 * 1024 * 1024) throw new Error("圖片超過 3 MiB 上限。");
            const form = new FormData(); form.append("file", file);
            await request(`${endpoint}/map?version=${data.settings.version}`, { method: "POST", body: form });
            await reload(); setMessage("會館圖已更新，將提供給受邀賓客。");
          });
        }} /></label>
        {data.settings.hasVenueMap && <button className={button} disabled={busy || dirty} onClick={() => { if (window.confirm("移除提供給賓客的會館圖？")) void operate(async () => {
          await request(`${endpoint}/map?version=${data.settings.version}`, { method: "DELETE" }); await reload(); setMessage("會館圖已移除。");
        }); }}>移除會館圖</button>}
      </div>
    </section>
    {issued && <aside className="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="新邀請連結">
      <h2 className="font-semibold">{issued.name}的專屬連結</h2>
      <label className="block">賓客專屬邀請連結<textarea className={`${field} break-all`} readOnly value={issued.url} onFocus={(event) => event.target.select()} /></label>
      <button className={button} onClick={() => { void navigator.clipboard.writeText(issued.url).then(() => setMessage("已複製邀請連結。")).catch(() => setMessage("請選取上方連結後手動複製。")); }}>複製專屬連結</button>
      <p>連結只在產生時顯示，請私下傳給這組賓客。有效至 {new Date(issued.expiresAt).toLocaleDateString("zh-TW")}；重發會使舊連結與 QR 碼失效。</p>
    </aside>}
    <section className="space-y-4" aria-label="賓客邀請與回覆">
      <h2 className="text-xl font-semibold">賓客邀請與回覆</h2>
      <p>回覆獨立保存，請核對後到賓客名單確認出席、人數與桌次；不會自動更動已安排的座位。新人本人不建立賓客邀請。</p>
      <label className="block">新連結有效天數<select className={field} value={validDays} disabled={busy} onChange={(event) => setValidDays(Number(event.target.value))}>
        {[7, 30, 90, 180].map((days) => <option key={days} value={days}>{days} 天</option>)}
      </select></label>
      <button className={button} disabled={busy || dirty} onClick={() => { void operate(async () => { await reload(); setMessage("回覆已重新整理。"); }); }}>重新整理回覆</button>
      {data.guests.length === 0 && <p>先在賓客名單新增受邀賓客。</p>}
      {data.guests.map((guest) => {
        const invitation = guest.invitation;
        const response = invitation?.response as unknown as { reply: InvitationReply; questions: InvitationQuestion[] } | null;
        return <article key={guest.id} aria-label={`邀請回覆：${guest.name}`} className="space-y-3 rounded-2xl border border-line bg-surface p-5 break-words">
          <h3 className="font-semibold">{guest.name}（邀請上限 {guest.partySize} 人）</h3>
          <p>{!invitation ? "尚未建立邀請" : invitation.active ? "連結有效" : invitation.revokedAt ? "連結已撤銷" : "連結已到期"} · {response ? "已回覆" : "尚未回覆"}</p>
          <div className="flex flex-wrap gap-3">
            <button className={button} disabled={busy || dirty} onClick={() => {
              if (invitation && !window.confirm("重發會使舊連結與 QR 碼立即失效，保留既有回覆。繼續？")) return;
              void operate(async () => {
                const result = await post<{ token: string; expiresAt: string }>({ operation: "issue", guestId: guest.id, expectedVersion: invitation?.version ?? null, validDays });
                setIssued({ name: guest.name, url: `${window.location.origin}${withBasePath("/guest-invitation")}#${result.token}`, expiresAt: result.expiresAt });
                await reload(); setMessage("已產生專屬連結，請複製後私下提供給賓客。");
              });
            }}>{invitation ? "重發專屬連結" : "建立專屬連結"}</button>
            {invitation?.active && <button className={button} disabled={busy || dirty} onClick={() => { if (window.confirm("撤銷這組賓客的連結與 QR 碼？回覆將保留。")) void operate(async () => {
              await post({ operation: "revoke", guestId: guest.id, expectedVersion: invitation.version }); setIssued(null); await reload(); setMessage("連結與 QR 碼已撤銷，既有回覆仍保留。");
            }); }}>撤銷連結</button>}
          </div>
          {response && <details><summary className="min-h-12 cursor-pointer py-3">查看回覆內容</summary><dl className="space-y-2">
            <div><dt>出席</dt><dd>{response.reply.attendance === "ATTENDING" ? "出席" : "不出席"} · {response.reply.partySize} 人，素食 {response.reply.vegetarianCount} 人</dd></div>
            <div><dt>聯絡電話</dt><dd>{response.reply.phone || "未填寫"}</dd></div><div><dt>飲食需求</dt><dd className="whitespace-pre-wrap">{response.reply.dietaryNotes || "未填寫"}</dd></div>
            {response.questions.map((question) => <div key={question.id}><dt>{question.label}</dt><dd className="whitespace-pre-wrap">{response.reply.answers[question.id] || "未填寫"}</dd></div>)}
          </dl></details>}
        </article>;
      })}
    </section>
  </div>;
}
