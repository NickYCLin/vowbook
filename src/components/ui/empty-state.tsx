import type { ReactNode } from "react";
import { cn } from "@/lib/class-names";

/**
 * 空狀態：列表沒有資料、或篩選後沒有結果時顯示。
 * 一定要給下一步該做什麼，不要只寫「沒有資料」。
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      <p className="font-serif text-title font-semibold text-ink">{title}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-caption leading-6 text-ink-soft">
          {description}
        </p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
