import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/stat";
import type { WeddingOverviewData } from "@/lib/wedding-overview";

function twd(value: string): string {
  return `NT$${new Intl.NumberFormat("zh-TW").format(BigInt(value))}`;
}

function OverviewLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="mt-4 inline-flex min-h-11 items-center text-caption font-semibold text-clay-strong underline decoration-clay/30 underline-offset-4 transition hover:decoration-clay sm:min-h-9"
    >
      {children}
    </Link>
  );
}

function ProgressCard({
  title,
  value,
  detail,
  progressLabel,
  progressValue,
  progressMax,
  tone = "brand",
  href,
  linkLabel,
}: {
  title: string;
  value: string;
  detail: string;
  progressLabel: string;
  progressValue: number;
  progressMax: number;
  tone?: "neutral" | "brand" | "positive" | "caution" | "danger";
  href: string;
  linkLabel: string;
}) {
  return (
    <Card as="article" tone="flat" className="h-full">
      <CardBody className="flex h-full flex-col">
        <p className="text-caption font-semibold text-ink-soft">{title}</p>
        <p className="mt-2 font-serif text-2xl font-semibold text-ink tabular-nums">
          {value}
        </p>
        <p className="mt-1 text-caption leading-6 text-ink-faint">{detail}</p>
        <ProgressBar
          className="mt-4"
          label={progressLabel}
          value={progressValue}
          max={progressMax}
          tone={tone}
        />
        <div className="mt-auto">
          <OverviewLink href={href}>{linkLabel}</OverviewLink>
        </div>
      </CardBody>
    </Card>
  );
}

function DetailCard({
  title,
  lines,
}: {
  title: string;
  lines: string[];
}) {
  return (
    <Card as="article" tone="sunken" className="h-full">
      <CardBody className="h-full">
        <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
        <ul className="mt-3 space-y-1.5 text-caption leading-6 text-ink-soft">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export function WeddingOverview({
  workspaceId,
  data,
}: {
  workspaceId: string;
  data: Pick<
    WeddingOverviewData,
    "guests" | "seating" | "tasks" | "budget" | "operations"
  >;
}) {
  const sideCards = [
    ["男方親友", data.guests.bySide.PARTNER_A],
    ["女方親友", data.guests.bySide.PARTNER_B],
    ["共同親友", data.guests.bySide.SHARED],
  ] as const;
  const seatingIsOverCapacity = data.seating.remainingCapacity < 0;

  return (
    <div className="space-y-8 pb-8">
      <section aria-labelledby="overview-progress-title">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-eyebrow font-semibold text-clay uppercase">總覽</p>
            <h2
              id="overview-progress-title"
              className="mt-1 font-serif text-xl font-semibold text-ink sm:text-2xl"
            >
              籌備進度
            </h2>
          </div>
          <p className="text-caption text-ink-faint">所有數字皆為目前工作區即時彙總</p>
        </div>

        <div className="mt-4 grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ProgressCard
            title="一般賓客回覆"
            value={`${data.guests.respondedGroupTotal}/${data.guests.generalGroupTotal} 組`}
            detail={`待回覆 ${data.guests.undecidedGroupTotal} 組・婉拒 ${data.guests.declinedGroupTotal} 組`}
            progressLabel="一般賓客回覆進度"
            progressValue={data.guests.respondedGroupTotal}
            progressMax={data.guests.generalGroupTotal}
            href={`/workspaces/${workspaceId}/guests`}
            linkLabel="查看賓客名單"
          />
          <ProgressCard
            title="確認出席人數"
            value={`${data.guests.attendingHeadcount} 人`}
            detail={`已安排 ${data.guests.assignedAttendingHeadcount} 人・待安排 ${data.guests.unassignedAttendingHeadcount} 人`}
            progressLabel="確認出席者入席進度"
            progressValue={data.guests.assignedAttendingHeadcount}
            progressMax={data.guests.attendingHeadcount}
            tone={
              seatingIsOverCapacity
                ? "danger"
                : data.guests.attendingHeadcount === 0
                  ? "neutral"
                  : data.guests.unassignedAttendingHeadcount > 0
                    ? "caution"
                    : "positive"
            }
            href={`/workspaces/${workspaceId}/tables`}
            linkLabel="查看桌次安排"
          />
          <ProgressCard
            title="婚宴任務"
            value={`${data.tasks.done}/${data.tasks.total} 項`}
            detail={`進行中 ${data.tasks.inProgress} 項・逾期 ${data.tasks.overdue} 項`}
            progressLabel="婚宴任務完成進度"
            progressValue={data.tasks.done}
            progressMax={data.tasks.total}
            tone={
              data.tasks.total === 0
                ? "neutral"
                : data.tasks.overdue > 0
                  ? "danger"
                  : data.tasks.done === data.tasks.total
                    ? "positive"
                    : "caution"
            }
            href={`/workspaces/${workspaceId}/tasks`}
            linkLabel="查看婚宴任務"
          />
          <ProgressCard
            title="婚禮花費"
            value={`${data.budget.paidCount}/${data.budget.itemCount} 項`}
            detail={`預計 ${twd(data.budget.plannedTotal)}・已記錄 ${twd(data.budget.actualTotal)}・規劃中 ${data.budget.planningCount} 項・待付尾款 ${data.budget.balanceDueCount} 項／${twd(data.budget.balanceDueTotal)}・逾期尾款 ${data.budget.overdueBalanceDueCount} 項・已有／自備 ${data.budget.selfProvidedCount} 項・不準備 ${data.budget.notPlannedCount} 項`}
            progressLabel="婚禮花費付清進度"
            progressValue={data.budget.paidCount}
            progressMax={data.budget.itemCount}
            tone={
              data.budget.itemCount === 0
                ? "neutral"
                : data.budget.overdueBalanceDueCount > 0
                  ? "danger"
                  : data.budget.paidCount === data.budget.itemCount
                    ? "positive"
                    : "caution"
            }
            href={`/workspaces/${workspaceId}/budget`}
            linkLabel="查看婚禮花費"
          />
        </div>
      </section>

      <section
        aria-label="賓客與宴席摘要"
        className="rounded-card border border-line bg-surface px-5 py-5 shadow-card sm:px-6"
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow font-semibold text-clay uppercase">賓客</p>
            <h2 className="mt-1 font-serif text-xl font-semibold text-ink sm:text-2xl">
              賓客與宴席
            </h2>
          </div>
          <p
            className={`text-caption leading-6 ${
              seatingIsOverCapacity ? "font-semibold text-danger" : "text-ink-soft"
            }`}
          >
            {data.seating.tableTotal} 桌・容量 {data.seating.capacityTotal} 人・
            {seatingIsOverCapacity
              ? `已超出 ${Math.abs(data.seating.remainingCapacity)} 席`
              : `尚有 ${data.seating.remainingCapacity} 席`}
          </p>
        </div>

        <div className="mt-4 grid auto-rows-fr gap-3 md:grid-cols-3">
          {sideCards.map(([label, summary]) => (
            <DetailCard
              key={label}
              title={label}
              lines={[
                `${summary.groupTotal} 組一般賓客`,
                `${summary.attendingGroupTotal} 組確認出席`,
                `${summary.attendingHeadcount} 位出席者`,
              ]}
            />
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <DetailCard
            title="喜帖安排"
            lines={[
              `紙本 ${data.guests.invitations.PAPER} 組`,
              `數位 ${data.guests.invitations.DIGITAL} 組`,
              `不寄送 ${data.guests.invitations.NONE} 組`,
              `尚未確認 ${data.guests.invitations.UNKNOWN} 組`,
              `尚未填寫 ${data.guests.invitations.UNSET} 組`,
            ]}
          />
          <DetailCard
            title="宴席需求"
            lines={[
              `兒童椅 ${data.guests.childSeatCount} 張`,
              `素食 ${data.guests.vegetarianCount} 人`,
              `目前已安排 ${data.seating.assignedHeadcount} 個席位`,
            ]}
          />
          <DetailCard
            title="禮金簿"
            lines={[
              `已登記 ${data.guests.gifts.recordedCount} 筆`,
              `合計 ${twd(data.guests.gifts.totalAmount)}`,
              `一般賓客未有紀錄 ${data.guests.gifts.unrecordedGeneralGroupCount} 組`,
            ]}
          />
        </div>
        <div className="mt-2">
          <OverviewLink href={`/workspaces/${workspaceId}/gifts`}>
            查看禮金簿
          </OverviewLink>
        </div>
      </section>

      <section
        aria-label="婚宴執行摘要"
        className="rounded-card border border-line bg-surface px-5 py-5 shadow-card sm:px-6"
      >
        <p className="text-eyebrow font-semibold text-clay uppercase">執行</p>
        <h2 className="mt-1 font-serif text-xl font-semibold text-ink sm:text-2xl">
          婚宴執行
        </h2>
        <div className="mt-4 grid auto-rows-fr gap-3 sm:grid-cols-3">
          <DetailCard
            title="工作人員"
            lines={[`${data.operations.staffTotal} 位工作人員`]}
          />
          <DetailCard
            title="婚禮總流程"
            lines={[`${data.operations.timelineItemTotal} 個流程項目`]}
          />
          <DetailCard
            title="協作成員"
            lines={[`${data.operations.memberTotal} 位協作者`]}
          />
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap gap-x-5 gap-y-1">
          <OverviewLink href={`/workspaces/${workspaceId}/staff`}>
            查看工作人員
          </OverviewLink>
          <OverviewLink href={`/workspaces/${workspaceId}/timeline`}>
            查看婚禮總流程
          </OverviewLink>
          <OverviewLink href={`/workspaces/${workspaceId}/members`}>
            查看協作者
          </OverviewLink>
        </div>
      </section>
    </div>
  );
}
