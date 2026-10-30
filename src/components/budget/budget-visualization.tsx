"use client";
import { useState } from "react";
import type { BudgetVisualization as Visualization } from "@/domain/budget-visualization";

const colors = ["#8b5e40", "#65785d", "#b28358", "#637e8c", "#9a6c7a", "#8a8756", "#626080", "#a16c53"];
const money = (amount: number) => `NT$${amount.toLocaleString("zh-TW")}`;

export function BudgetVisualization({ data }: { data: Visualization }) {
  const [metric, setMetric] = useState<"planned" | "actual">("planned");
  if (!data.available) return <section className="my-5 rounded-2xl border border-line p-5"><h2>花費分析</h2><p>金額超出圖表可安全表示的範圍，請參考花費明細。</p></section>;
  const label = metric === "planned" ? "預計" : "實際";
  const value = (row: Visualization["rows"][number]) => metric === "planned" ? row.plannedAmount : row.actualAmount;
  const rows = data.rows.filter((row) => value(row) > 0).sort((left, right) => value(right) - value(left) || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  const total = metric === "planned" ? data.plannedTotal : data.actualTotal;
  const stops = rows.map((row, index) => {
    const start = rows.slice(0, index).reduce((amount, previous) => amount + value(previous), 0) / total * 100;
    const end = start + value(row) / total * 100;
    return `${colors[index % colors.length]} ${start}% ${end}%`;
  });
  return <section className="my-5 rounded-2xl border border-line bg-surface p-5" aria-label="花費分類分析">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">花費分析</h2>
      <div role="group" aria-label="統計金額" className="flex gap-2">
        {(["planned", "actual"] as const).map((mode) => <button key={mode} type="button" aria-pressed={metric === mode}
          onClick={() => setMetric(mode)} className="min-h-12 rounded-xl border border-line px-4 py-2">
          {mode === "planned" ? "預計花費" : "實際花費"}
        </button>)}
      </div>
    </div>
    {total > 0 ? <div className="mt-5 grid gap-6 sm:grid-cols-[12rem_1fr]">
      <div role="img" aria-label={`${label}花費分類圓環圖，合計${money(total)}`} className="mx-auto flex size-48 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${stops.join(",")})` }}>
        <div className="flex size-32 flex-col items-center justify-center rounded-full bg-surface text-center">
          <span className="text-xs text-ink-soft">{label}合計</span><strong className="text-sm tabular-nums">{money(total)}</strong>
        </div>
      </div>
      <ol className="min-w-0 space-y-3" aria-label={`${label}花費分類金額排行`}>
        {rows.map((row, index) => <li key={row.key}>
          <div className="flex flex-wrap justify-between gap-x-3 text-sm"><span>{row.label}</span>
            <span className="tabular-nums">{money(value(row))}（{(value(row) / total * 100).toFixed(1)}%）</span></div>
          <div className="mt-1 h-2 rounded-full bg-paper" aria-hidden="true"><div className="h-2 rounded-full"
            style={{ width: `${value(row) / total * 100}%`, backgroundColor: colors[index % colors.length] }} /></div>
        </li>)}
      </ol>
    </div> : <p role="status" className="my-5 text-ink-soft">{metric === "planned" ? "尚未填寫預計花費。" :
      data.actualRecordedCount === 0 ? "尚未登記實際花費。" : "已登記的實際花費目前為 0 元。"}</p>}
    <p className="mt-5 text-sm text-ink-soft">預計包含依名單換算的估算費用；實際只計已填寫的實際金額，不用預計或付款紀錄代填。圖表統計全部花費，不受下方搜尋影響。</p>
    {metric === "actual" && data.missingActualCount > 0 && <p className="mt-2 text-sm text-ink-soft">另有 {data.missingActualCount} 筆尚未填寫實際金額，不代表免費或已付清。</p>}
  </section>;
}
