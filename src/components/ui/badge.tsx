import type { ReactNode } from "react";
import { cn } from "@/lib/class-names";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "positive"
  | "caution"
  | "danger"
  | "sage";

const tones: Record<BadgeTone, string> = {
  neutral: "border-line-strong bg-surface-sunken text-ink-soft",
  brand: "border-clay/30 bg-clay-soft text-clay-strong",
  positive: "border-positive/30 bg-positive-soft text-positive",
  caution: "border-caution/30 bg-caution-soft text-caution",
  danger: "border-danger/30 bg-danger-soft text-danger",
  sage: "border-sage/30 bg-sage-soft text-sage",
};

/** 狀態徽章：出席狀態、任務狀態、成員角色等一律用這個。 */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        // 不用 shrink-0：徽章內容可能是使用者輸入的長字串（例如流程階段名稱），
        // 窄畫面必須讓它換行，而不是被 html/body 的 overflow-x:hidden 默默切掉。
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-semibold break-words [overflow-wrap:anywhere]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 徽章前的小圓點，用來加強狀態的可掃視性。 */
export function BadgeDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 rounded-full bg-current opacity-70", className)}
    />
  );
}
