import type { ReactNode } from "react";
import { cn } from "@/lib/class-names";

/**
 * 概覽數字磚：dashboard 與各功能頁頂端的統計。
 * 數字用等寬數字對齊，避免不同位數時左右跳動。
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone = "neutral",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "brand" | "positive" | "caution" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "text-ink",
    brand: "text-clay-strong",
    positive: "text-positive",
    caution: "text-caution",
    danger: "text-danger",
  } as const;

  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-caption font-medium text-ink-soft">{label}</p>
      <p
        className={cn(
          "mt-1 flex items-baseline gap-1 font-serif text-2xl font-semibold tabular-nums",
          tones[tone],
        )}
      >
        <span className="min-w-0 truncate">{value}</span>
        {unit && (
          <span className="text-caption font-sans font-medium text-ink-faint">
            {unit}
          </span>
        )}
      </p>
      {hint && <p className="mt-0.5 text-caption text-ink-faint">{hint}</p>}
    </div>
  );
}

/** 統計磚的排列容器：手機兩欄、桌機平均分配。 */
export function StatRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 進度條：預算執行率、RSVP 回覆率、任務完成率共用。 */
export function ProgressBar({
  value,
  max = 100,
  tone = "brand",
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: "brand" | "positive" | "caution" | "danger";
  label: string;
  className?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(Math.max(value / safeMax, 0), 1);
  const tones = {
    brand: "bg-clay",
    positive: "bg-positive",
    caution: "bg-caution",
    danger: "bg-danger",
  } as const;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", tones[tone])}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
