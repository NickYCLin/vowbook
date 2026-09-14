import type { MembershipRole, WeddingWorkspace } from "@prisma/client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressBar, Stat, StatRow } from "@/components/ui/stat";
import {
  daysUntilWedding,
  type WorkspaceOverviewStats,
} from "@/lib/workspace-overview";
import { WorkspaceOwnerControls } from "./workspace-owner-controls";
import {
  workspaceSectionHref,
  workspaceSections,
  type WorkspaceSection,
  type WorkspaceSectionIcon,
} from "./workspace-sections";

const roleLabels: Record<MembershipRole, string> = {
  OWNER: "擁有者",
  PARTNER: "伴侶",
  PLANNER: "婚顧",
  VIEWER: "檢視者",
};

const roleTones: Record<MembershipRole, "brand" | "sage" | "neutral"> = {
  OWNER: "brand",
  PARTNER: "brand",
  PLANNER: "sage",
  VIEWER: "neutral",
};

type WorkspaceSummaryProps = {
  role: MembershipRole;
  workspace: Pick<
    WeddingWorkspace,
    "id" | "name" | "weddingDate" | "timezone" | "updatedAt"
  >;
  stats?: WorkspaceOverviewStats;
  now?: Date;
};

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function ModuleLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: WorkspaceSectionIcon;
  children: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3 text-caption font-semibold whitespace-nowrap text-clay-strong transition hover:border-clay hover:bg-clay-soft max-sm:min-w-0 max-sm:rounded-control max-sm:px-3.5 sm:min-h-9"
    >
      <Icon aria-hidden="true" className="size-4.5 shrink-0 text-clay" />
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}

export function WorkspaceSummary({
  role,
  workspace,
  stats,
  now = new Date(),
}: WorkspaceSummaryProps) {
  const weddingDate = workspace.weddingDate
    ? new Intl.DateTimeFormat("zh-TW", {
        dateStyle: "long",
        timeZone: workspace.timezone,
      }).format(workspace.weddingDate)
    : "日期尚未決定";
  const countdown = daysUntilWedding(
    workspace.weddingDate,
    now,
    workspace.timezone,
  );

  const moduleLabels: Partial<Record<WorkspaceSection, string>> = {
    overview: "查看婚宴總覽",
    guests: "開啟賓客名單",
    tables: "安排桌次",
    tasks: "婚宴任務",
    budget: "管理婚禮花費",
    staff: "婚禮工作人員",
    timeline: "婚禮總流程",
    members: role === "OWNER" ? "分享與協作" : "查看協作者",
  };
  // 報到與禮金是婚宴當天的入口，總覽卡片維持籌備期的八個模組。
  const modules = workspaceSections.flatMap((section) => {
    const label = moduleLabels[section.key];
    return label
      ? [{ href: workspaceSectionHref(workspace.id, section), label, icon: section.icon }]
      : [];
  });

  const budgetRatio = percent(stats?.budgetActual ?? 0, stats?.budgetPlanned ?? 0);

  return (
    <Card as="article" className="min-w-0">
      <div className="min-w-0 px-5 py-5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h2 className="min-w-0 flex-1 break-words font-serif text-title font-semibold text-ink sm:text-2xl">
            {workspace.name}
          </h2>
          <Badge tone={roleTones[role]}>{roleLabels[role]}</Badge>
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-soft">
          <span>{weddingDate}</span>
          {countdown !== null && (
            <>
              <span aria-hidden="true" className="text-line-strong">
                ·
              </span>
              <span className="font-semibold text-clay-strong tabular-nums">
                {countdown === 0 ? "就是今天" : `還有 ${countdown} 天`}
              </span>
            </>
          )}
        </div>

        {stats && (
          <div className="mt-5 border-t border-line pt-5">
            <StatRow>
              <Stat
                label="一般賓客"
                value={stats.guestTotal}
                unit="組"
                hint={`已回覆 ${stats.guestResponded}`}
              />
              <Stat
                label="宴席人數"
                value={stats.attendingHeadcount}
                unit="人"
                hint={`${stats.tableTotal} 桌`}
                tone="positive"
              />
              <Stat
                label="任務完成"
                value={`${stats.taskDone}/${stats.taskTotal}`}
                hint={`${percent(stats.taskDone, stats.taskTotal)}%`}
              />
              <Stat
                label="花費執行"
                value={`${budgetRatio}%`}
                hint={`預算 ${stats.budgetPlanned.toLocaleString("zh-TW")}`}
                tone={budgetRatio > 100 ? "danger" : "brand"}
              />
            </StatRow>
            {stats.budgetPlanned > 0 && (
              <ProgressBar
                className="mt-4"
                label={`${workspace.name} 花費執行率`}
                value={stats.budgetActual}
                max={stats.budgetPlanned}
                tone={budgetRatio > 100 ? "danger" : "brand"}
              />
            )}
          </div>
        )}

        {/* 手機排成兩欄的入口列，比九顆藥丸籤更好點也更整齊。 */}
        <div className="mt-5 grid min-w-0 grid-cols-2 gap-2 border-t border-line pt-5 sm:flex sm:flex-wrap">
          {modules.map((module) => (
            <ModuleLink key={module.href} href={module.href} icon={module.icon}>
              {module.label}
            </ModuleLink>
          ))}
        </div>

        {role === "OWNER" ? (
          <WorkspaceOwnerControls workspace={workspace} />
        ) : null}
      </div>
    </Card>
  );
}
