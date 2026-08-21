import type { ReactNode } from "react";
import { cn } from "@/lib/class-names";

export type NoticeTone = "info" | "positive" | "caution" | "danger";

const tones: Record<NoticeTone, string> = {
  info: "border-line-strong bg-surface-sunken text-ink",
  positive: "border-positive/30 bg-positive-soft text-positive",
  caution: "border-caution/30 bg-caution-soft text-caution",
  danger: "border-danger/30 bg-danger-soft text-danger",
};

/**
 * 頁面層級的提示條：邀請通知、刪除完成、唯讀提醒等。
 * action 放在右側，手機上換行到下方。
 */
export function Notice({
  tone = "info",
  role = "status",
  action,
  className,
  children,
  ...rest
}: {
  tone?: NoticeTone;
  role?: "status" | "alert";
  action?: ReactNode;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <div
      {...rest}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-card border px-4 py-3.5 text-caption leading-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5",
        tones[tone],
        className,
      )}
    >
      <p role={role} className="min-w-0 break-words font-medium">
        {children}
      </p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
