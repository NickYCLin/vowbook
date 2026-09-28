import Link from "next/link";
import {
  ArrowRight, CaretDown, Chair, CheckCircle, ClipboardText,
  Gift, IdentificationBadge, ListChecks, Path, UsersThree, Wallet,
} from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/stat";
import type { WeddingOverviewData } from "@/lib/wedding-overview";
import { WeddingOverview } from "./wedding-overview";

type WeddingHomeProps = {
  workspaceId: string;
  data: Pick<WeddingOverviewData, "guests" | "seating" | "tasks" | "budget" | "operations">;
};

const preparationLinks = [
  { section: "guests", title: "賓客名單", detail: "出席回覆、喜帖與喜餅", icon: UsersThree },
  { section: "tables", title: "桌次安排", detail: "分配座位、查看桌圖", icon: Chair },
  { section: "budget", title: "婚禮花費", detail: "預算、付款與廠商資料", icon: Wallet },
  { section: "timeline", title: "婚禮總流程", detail: "排好當天的每個時刻", icon: Path },
];
const receptionLinks = [
  { section: "check-in", title: "賓客報到", detail: "查詢名單與入席位置", icon: ClipboardText },
  { section: "gifts", title: "禮金紀錄", detail: "登記與核對禮金", icon: Gift },
  { section: "staff", title: "工作人員", detail: "確認分工與聯絡方式", icon: IdentificationBadge },
];

export function WeddingHome({ workspaceId, data }: WeddingHomeProps) {
  const href = (section: string) => `/workspaces/${workspaceId}/${section}`;
  const actions = [
    { count: data.guests.unassignedAttendingHeadcount, title: `安排 ${data.guests.unassignedAttendingHeadcount} 位親友入席`, detail: "已確認出席，尚未安排桌次。", section: "tables", icon: Chair, urgent: false },
    { count: data.guests.undecidedAttendanceGroupTotal, title: `確認 ${data.guests.undecidedAttendanceGroupTotal} 組親友是否出席`, detail: "確認人數後，再安排座位與喜餅。", section: "guests", icon: UsersThree, urgent: false },
    { count: data.tasks.todo + data.tasks.inProgress, title: `處理 ${data.tasks.todo + data.tasks.inProgress} 項婚宴任務`, detail: data.tasks.overdue > 0 ? `其中 ${data.tasks.overdue} 項已逾期，請優先確認。` : "查看負責人、期限與目前進度。", section: "tasks", icon: ListChecks, urgent: data.tasks.overdue > 0 },
    { count: data.budget.balanceDueCount, title: `確認 ${data.budget.balanceDueCount} 筆廠商尾款`, detail: data.budget.overdueBalanceDueCount > 0 ? `其中 ${data.budget.overdueBalanceDueCount} 筆已超過付款日期。` : "核對付款日期與尚未支付的金額。", section: "budget", icon: Wallet, urgent: data.budget.overdueBalanceDueCount > 0 },
  ].filter(action => action.count > 0).sort((a, b) => Number(b.urgent) - Number(a.urgent));

  return (
    <div className="space-y-6 sm:space-y-8">
      <section aria-label="婚宴規模摘要" className="grid grid-cols-3 gap-2.5 sm:gap-4">
        {[
          { label: "確認出席", value: data.guests.attendingHeadcount, unit: "位親友", hint: `已安排 ${data.guests.assignedAttendingHeadcount} 位`, section: "guests", icon: UsersThree },
          { label: "宴席規模", value: data.seating.tableTotal, unit: "桌", hint: `共 ${data.seating.capacityTotal} 席`, section: "tables", icon: Chair },
          { label: "任務完成", value: `${data.tasks.done} / ${data.tasks.total}`, unit: "項", hint: data.tasks.total === 0 ? "還沒建立任務" : "查看籌備進度", section: "tasks", icon: ListChecks },
        ].map(({ label, value, unit, hint, section, icon: Icon }) => (
          <Card key={section} className="home-metric">
            <Link href={href(section)} className="block h-full rounded-card p-3 sm:p-5">
              <div className="flex items-center justify-between gap-2 text-clay-strong">
                <span className="text-caption font-medium">{label}</span><Icon aria-hidden="true" className="hidden size-5 sm:block" />
              </div>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="break-words font-serif text-xl font-semibold tabular-nums sm:text-3xl">{value}</span>
                <span className="text-caption text-ink-soft">{unit}</span>
              </p>
              <p className="mt-2 text-caption text-ink-soft">{hint}</p>
            </Link>
          </Card>
        ))}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card as="section" aria-labelledby="wedding-home-actions" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-5 py-5 sm:px-6">
            <div><p className="mb-1 text-eyebrow font-semibold text-clay">一步一步，慢慢準備</p><h2 id="wedding-home-actions" className="font-serif text-title font-semibold">需要處理</h2></div>
            <span className="rounded-full bg-sage-soft px-3 py-1 text-caption text-sage">依目前籌備狀態</span>
          </div>
          <div className="divide-y divide-line/70">
            {actions.length ? actions.map(({ title, detail, section, icon: Icon, urgent }) => (
              <Link key={section} href={href(section)} className="home-action flex min-h-24 items-center gap-3 px-5 py-4 sm:gap-4 sm:px-6">
                <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${urgent ? "bg-caution-soft text-caution" : "bg-clay-soft text-clay-strong"}`}><Icon className="size-5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="font-semibold">{title}</span><span className={`mt-1 block text-caption ${urgent ? "text-caution" : "text-ink-soft"}`}>{detail}</span></span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-clay" />
              </Link>
            )) : (
              <div className="px-6 py-8"><CheckCircle aria-hidden="true" className="mb-4 size-9 text-sage" /><p className="font-semibold">目前沒有待確認的賓客、座位、任務或尾款。</p><p className="mt-2 text-caption text-ink-soft">可以繼續整理名單、婚宴流程與工作人員。</p><Link href={href("guests")} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-clay-strong">前往賓客名單 →</Link></div>
            )}
          </div>
          {data.tasks.total > 0 && (
            <div className="border-t border-line/70 bg-sage-soft/40 px-5 py-4 sm:px-6">
              <div className="mb-2 flex flex-wrap justify-between gap-2 text-caption text-ink-soft"><span>任務完成進度</span><span className="font-semibold tabular-nums">{data.tasks.done} / {data.tasks.total}</span></div>
              <ProgressBar label="首頁任務完成進度" value={data.tasks.done} max={data.tasks.total} tone="positive" />
            </div>
          )}
        </Card>

        <section aria-labelledby="wedding-home-tools">
          <div className="mb-4 flex items-center justify-between"><h2 id="wedding-home-tools" className="font-serif text-title font-semibold">繼續籌備</h2><span className="text-caption text-ink-soft">常用工具</span></div>
          <div className="grid grid-cols-2 gap-3">
            {preparationLinks.map(({ section, title, detail, icon: Icon }) => (
              <Card key={section} className="home-tool">
                <Link href={href(section)} className="flex h-full flex-col rounded-card p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between"><span className="grid size-11 place-items-center rounded-2xl bg-sage-soft text-sage"><Icon aria-hidden="true" className="size-6" /></span><ArrowRight aria-hidden="true" className="size-4 text-ink-faint" /></div>
                  <h3 className="font-semibold">{title}</h3><p className="mt-1 text-caption text-ink-soft">{detail}</p>
                </Link>
              </Card>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="wedding-home-reception">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="wedding-home-reception" className="font-serif text-title font-semibold">婚宴當天</h2><span className="text-caption text-ink-soft">接待與現場協作</span></div>
        <div className="grid gap-3 sm:grid-cols-3">
          {receptionLinks.map(({ section, title, detail, icon: Icon }) => (
            <Card key={section} className="home-tool"><Link href={href(section)} className="flex min-h-24 items-center gap-3 rounded-card p-4 sm:p-5"><Icon aria-hidden="true" className="size-6 shrink-0 text-clay" /><span className="min-w-0 flex-1"><span className="font-semibold">{title}</span><span className="mt-1 block text-caption text-ink-soft">{detail}</span></span><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-ink-faint" /></Link></Card>
          ))}
        </div>
      </section>

      <details className="home-statistics group rounded-card border border-line/70">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-5 py-4 text-sm font-semibold text-clay-strong [&::-webkit-details-marker]:hidden"><span>查看完整籌備統計</span><CaretDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" /></summary>
        <div className="border-t border-line/70 p-4 sm:p-6"><WeddingOverview workspaceId={workspaceId} data={data} /></div>
      </details>
    </div>
  );
}
