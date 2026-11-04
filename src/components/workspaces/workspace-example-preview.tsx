"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { cakeExample, workspaceExamples, type WorkspaceExample } from "./workspace-examples";
import type { WorkspaceSection } from "./workspace-sections";

function ExampleContent({ example, section }: { example: WorkspaceExample; section: WorkspaceSection }) {
  return <div className="space-y-6 p-5 sm:p-8">
    <div className="rounded-control border border-clay/30 bg-clay-soft px-4 py-3 text-sm text-clay-strong">
      以下皆為虛構資料，不會變更你的婚宴。僅供預覽，沒有新增、付款或報到功能。
    </div>
    <div>
      <h3 className="font-serif text-2xl font-semibold">{example.title}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{example.description}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      {example.metrics.map(metric => <div key={metric} className="rounded-card border border-line bg-surface-sunken p-4 font-semibold text-clay-strong">{metric}</div>)}
    </div>
    {section === "budget" && <figure className="flex flex-wrap items-center gap-5 rounded-card border border-line p-5" aria-label="花費占比範例：場地餐飲 60%、攝影錄影 25%、佈置禮物 15%">
      <div aria-hidden="true" className="flex size-36 items-center justify-center rounded-full" style={{ background: "conic-gradient(#577666 0% 60%, #a58caf 60% 85%, #c49968 85% 100%)" }}>
        <div className="flex size-24 items-center justify-center rounded-full bg-surface text-sm font-semibold">花費占比</div>
      </div>
      <figcaption className="text-sm leading-7">場地餐飲 60%<br />攝影錄影 25%<br />佈置禮物 15%</figcaption>
    </figure>}
    {section === "tables" && <figure className="rounded-card border border-line p-5" aria-label="桌次示意範例：舞台前方配置三桌，入口位於下方">
      <div className="mb-5 rounded-control bg-clay-soft p-2 text-center font-semibold text-clay-strong">舞台</div>
      <div className="flex flex-wrap justify-center gap-5">{[1, 2, 3].map(number => <div key={number} className="flex size-20 items-center justify-center rounded-full border-2 border-clay/40 bg-surface-sunken text-sm">第 {number} 桌</div>)}</div>
      <figcaption className="mt-5 text-center text-sm text-ink-soft">入口／報到處（配置僅供示意）</figcaption>
    </figure>}
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-80 text-left text-sm">
        <caption className="sr-only">{example.title}範例資料</caption>
        <thead className="bg-surface-sunken"><tr>{example.columns.map(column => <th key={column} scope="col" className="p-4 font-semibold">{column}</th>)}</tr></thead>
        <tbody>{example.rows.map(row => <tr key={row[0]} className="border-t border-line">{row.map((cell, index) => <td key={index} className="p-4 leading-6">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {section === "timeline" && <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-card border border-line p-5">
        <h3 className="font-semibold">謝親恩・致詞範例</h3>
        <p className="mt-3 whitespace-pre-line text-sm leading-7">{"謝謝家人一路陪伴，讓我們勇敢走到今天。\n從日常的小事到重要的決定，你們的支持一直都在。\n接下來，我們會一起照顧彼此，也繼續陪伴家人。"}</p>
        <p className="mt-3 text-xs text-ink-soft">可以從「感謝、回憶、未來的承諾」三段開始，用自己的話表達。</p>
      </section>
      <section className="rounded-card border border-line p-5">
        <h3 className="font-semibold">遊戲名單・介紹詞範例</h3>
        <ol className="mt-3 list-inside list-decimal space-y-3 text-sm leading-7"><li>朋友甲：一起走過學生時代，總能帶動全場氣氛。</li><li>朋友乙：最可靠的旅行夥伴，今天一起接住好運。</li></ol>
        <p className="mt-3 text-xs text-ink-soft">簡短交代關係與一個特色，方便主持自然介紹。</p>
      </section>
    </div>}
    <p className="rounded-control bg-surface-sunken p-4 text-sm leading-7 text-ink-soft">{example.tip}</p>
  </div>;
}

export function WorkspaceExamplePreview({ section, sectionTitle }: { section: WorkspaceSection; sectionTitle: string }) {
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog();
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const example = sectionTitle === "發餅名單" ? cakeExample : workspaceExamples[section];
  return <>
    <Button ref={triggerRef} variant="secondary" onClick={() => { setIsOpen(true); open(); }}>看完成範例</Button>
    <Dialog dialogRef={dialogRef} titleId={titleId} title={`${sectionTitle}・完成範例`} eyebrow="範例預覽" closeLabel="關閉範例" size="xl" fullScreenOnMobile onClose={close} onRestoreFocus={() => { setIsOpen(false); restoreFocus(); }}>
      {isOpen && <ExampleContent example={example} section={section} />}
      <DialogFooter><Button variant="secondary" onClick={close}>關閉範例，返回我的婚宴</Button></DialogFooter>
    </Dialog>
  </>;
}
