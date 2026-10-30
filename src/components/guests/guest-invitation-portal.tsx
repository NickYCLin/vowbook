"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import type { readGuestInvitation } from "@/lib/guest-invitations";
import type { InvitationReply } from "@/domain/guest-invitations";
type Data = Awaited<ReturnType<typeof readGuestInvitation>>;
const field = "mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3 py-2";
const button = "min-h-12 rounded-xl border border-line px-4 py-2 disabled:opacity-50";
const blank: InvitationReply = { attendance: "ATTENDING", partySize: 1, vegetarianCount: 0, phone: "", dietaryNotes: "", answers: {} };
async function guestRequest(path: string, token: string, body?: unknown) {
  return fetch(withBasePath(`/api/guest-invitations/${path}`), { method: "POST", cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
export function GuestInvitationPortal() {
  const token = useRef("");
  const [data, setData] = useState<Data | null>(null), [reply, setReply] = useState<InvitationReply>(blank);
  const [message, setMessage] = useState("正在載入邀請…"), [saving, setSaving] = useState(false);
  const [qr, setQR] = useState<string | null>(null), [venueMap, setVenueMap] = useState<string | null>(null), [mapError, setMapError] = useState("");
  async function load() {
    const response = await guestRequest("view", token.current);
    const next = await response.json();
    if (!response.ok) { setData(null); throw new Error(next.message ?? "邀請目前無法開啟。"); }
    const result = next as Data;
    const previous = (result.response as unknown as { reply: InvitationReply } | null)?.reply;
    const answers = Object.fromEntries(result.settings.questions.map((question) => {
      const value = previous?.answers[question.id] ?? "";
      return [question.id, question.type === "TEXT" || question.options.includes(value) ? value : ""];
    }));
    setReply({ ...(previous ?? { ...blank, partySize: Math.min(20, result.guest.maxPartySize) }), answers });
    setData(result); return result;
  }
  useEffect(() => {
    token.current = window.location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token.current)) {
      Promise.resolve().then(() => setMessage("請使用主辦方提供的完整專屬邀請連結。")); return;
    }
    let active = true;
    void load().then((result) => { if (active) setMessage(result.response ? "已載入你先前的回覆，可修改後再次儲存。" : "請填寫這組邀請的回覆。"); })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "邀請目前無法開啟。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!data) return;
    let active = true, imageURL: string | null = null;
    void import("qrcode").then((module) => module.toDataURL(data.checkInCode, { width: 280, margin: 3, errorCorrectionLevel: "M" }))
      .then((image) => { if (active) setQR(image); }).catch(() => { if (active) setQR(null); });
    if (data.settings.hasVenueMap) void guestRequest("venue-map", token.current).then(async (response) => {
      if (!response.ok || response.headers.get("content-type") !== "image/png") throw new Error("會館圖目前無法載入，請重新整理或洽主辦方。");
      imageURL = URL.createObjectURL(await response.blob());
      if (active) { setVenueMap(imageURL); setMapError(""); } else URL.revokeObjectURL(imageURL);
    }).catch((error: unknown) => { if (active) { setVenueMap(null); setMapError(error instanceof Error ? error.message : "會館圖目前無法載入。"); } });
    else Promise.resolve().then(() => { if (active) { setVenueMap(null); setMapError(""); } });
    return () => { active = false; if (imageURL) URL.revokeObjectURL(imageURL); };
  }, [data]);
  return <div className="space-y-6">
    <p role="status" aria-live="polite">{message}</p>
    {data && <>
      <section className="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-xl font-semibold">{data.wedding.name}</h2><p>親愛的{data.guest.name}，這是你這組賓客的專屬邀請。</p>
        {data.wedding.date && <p>婚宴日期：{new Date(data.wedding.date).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}</p>}
        {data.settings.venueName && <p>會館：{data.settings.venueName}</p>}{data.settings.venueAddress && <p>地址：{data.settings.venueAddress}</p>}
        <p>連結可查看與修改本組回覆，請妥善保管。有效至 {new Date(data.expiresAt).toLocaleDateString("zh-TW")}。</p>
      </section>
      <form aria-label="賓客邀請回覆" className="space-y-4 rounded-2xl border border-line bg-surface p-5" onSubmit={(event) => {
        event.preventDefault(); if (saving) return; setSaving(true); setMessage("");
        void (async () => {
          try {
            const response = await guestRequest("reply", token.current, { formVersion: data.settings.version, responseVersion: data.responseVersion, reply });
            const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "回覆尚未儲存，請稍後再試。");
            setData((current) => current ? { ...current, responseVersion: result.responseVersion } : current);
            setMessage("回覆已儲存，謝謝！若資料有變更，可再次修改後儲存。");
          } catch (error) { setMessage(error instanceof Error ? error.message : "回覆尚未儲存，請稍後再試。"); }
          finally { setSaving(false); }
        })();
      }}>
        <h2 className="text-xl font-semibold">回覆邀請</h2>
        <fieldset disabled={saving} className="space-y-4">
          <label className="block">是否出席<select className={field} required value={reply.attendance} onChange={(event) => {
            const attendance = event.target.value as InvitationReply["attendance"];
            setReply((current) => ({ ...current, attendance, partySize: attendance === "DECLINED" ? 0 : Math.min(data.guest.maxPartySize, Math.max(1, current.partySize)), vegetarianCount: 0 }));
          }}><option value="ATTENDING">會出席</option><option value="DECLINED">無法出席</option></select></label>
          <label className="block">出席人數（含本人）<input className={field} type="number" required min={reply.attendance === "ATTENDING" ? 1 : 0} max={Math.min(20, data.guest.maxPartySize)} disabled={reply.attendance === "DECLINED"}
            value={reply.partySize} onChange={(event) => setReply((current) => ({ ...current, partySize: Number(event.target.value) }))} /></label>
          <label className="block">其中素食人數<input className={field} type="number" required min={0} max={reply.partySize} disabled={reply.attendance === "DECLINED"}
            value={reply.vegetarianCount} onChange={(event) => setReply((current) => ({ ...current, vegetarianCount: Number(event.target.value) }))} /></label>
          <label className="block">聯絡電話（選填）<input className={field} type="tel" maxLength={40} value={reply.phone} onChange={(event) => setReply((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label className="block">飲食需求（選填）<textarea className={field} maxLength={300} value={reply.dietaryNotes} onChange={(event) => setReply((current) => ({ ...current, dietaryNotes: event.target.value }))} /></label>
          {data.settings.questions.map((question) => <label key={question.id} className="block">{question.label}{question.required ? "（必填）" : "（選填）"}
            {question.type === "TEXT" ? <textarea className={field} required={question.required} maxLength={200} value={reply.answers[question.id] ?? ""} onChange={(event) => setReply((current) => ({ ...current, answers: { ...current.answers, [question.id]: event.target.value } }))} /> :
              <select className={field} required={question.required} value={reply.answers[question.id] ?? ""} onChange={(event) => setReply((current) => ({ ...current, answers: { ...current.answers, [question.id]: event.target.value } }))}>
                <option value="">請選擇</option>{question.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>}
          </label>)}
          <p className="text-sm">請勿填寫證件、金融帳號或密碼。若超過邀請人數，請先聯絡主辦方協調。</p>
          <button type="submit" className={button}>{saving ? "正在儲存…" : "儲存回覆"}</button>
        </fieldset>
      </form>
      <section className="space-y-4 rounded-2xl border border-line bg-surface p-5" aria-label="我的桌次與會館圖">
        <h2 className="text-xl font-semibold">我的桌次與會館圖</h2>
        <p>{data.table ? `你的桌次：${data.table.number} 號桌 · ${data.table.name}` : "尚未安排桌次，請洽主辦方。"}</p>
        {venueMap && <div><h3 className="font-semibold">主辦方提供的會館圖</h3><Image src={venueMap} alt="主辦方提供的會館平面圖" width={1200} height={1200} className="mt-3 h-auto w-full" unoptimized /></div>}
        {mapError && <p>{mapError}</p>}
        {!data.settings.hasVenueMap && <p>主辦方尚未提供會館平面圖。</p>}
        {data.floorPlanUnavailable ? <p>桌位圖需要主辦方重新確認，請依上方桌次洽現場工作人員。</p> : data.floorPlan.length > 0 && <>
          <h3 className="font-semibold">桌位配置示意圖</h3><p>標示「你的桌次」的是本組座位。示意圖非會館實測平面圖，請以現場安排為準。</p>
          {data.floorPlan.some((table) => table.automatic) && <p>部分桌位尚未設定實際位置，目前以自動排列顯示。</p>}
          <svg viewBox="0 0 1000 1000" role="img" aria-label="桌位配置示意圖" className="w-full rounded-xl border border-line bg-paper">
            {data.floorPlan.map((table) => <g key={table.number}>
              <circle cx={table.x} cy={table.y} r={36} fill={table.own ? "#8b5e40" : "#ffffff"} stroke="#8b5e40" strokeWidth={table.own ? 6 : 2} />
              <text x={table.x} y={table.y + 9} textAnchor="middle" fill={table.own ? "#ffffff" : "#49392c"} fontSize={28}>{table.number}</text>
              {table.own && <text x={table.x} y={table.y + 66} textAnchor="middle" fontSize={22}>你的桌次</text>}
            </g>)}
          </svg>
        </>}
      </section>
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-5 text-center" aria-label="賓客報到碼">
        <h2 className="text-xl font-semibold">賓客報到碼</h2><p>到場後出示給已登入 App 的工作人員掃描，再確認到場人數。出示本頁不會自動報到。</p>
        {qr ? <><Image src={qr} width={280} height={280} alt="本組賓客專屬報到 QR Code" className="mx-auto w-full max-w-72" unoptimized />
          <a className={`${button} inline-flex items-center`} href={qr} download="vowbook-check-in.png">儲存報到碼</a></> : <p>報到圖碼尚未產生，可請工作人員依名單查詢。</p>}
        <details><summary className="min-h-12 cursor-pointer py-3">顯示供工作人員手動輸入的報到碼</summary><p className="break-all select-all">{data.checkInCode}</p></details>
      </section>
      <button className={button} disabled={saving} onClick={() => { if (window.confirm("重新載入會捨棄尚未儲存的回覆，繼續？")) void load().then(() => setMessage("邀請資料已更新。")).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "目前無法重新載入。")); }}>重新載入邀請與桌次</button>
    </>}
  </div>;
}
