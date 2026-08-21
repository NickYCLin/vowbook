import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/class-names";

/**
 * 紙卡：全站列表項目與區塊的基本容器。
 * tone="sunken" 用在卡片內的次層區塊（例如展開後的表單）。
 */
export function Card({
  as: Tag = "div",
  tone = "raised",
  interactive = false,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  tone?: "raised" | "flat" | "sunken";
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const tones = {
    raised: "border-line bg-surface shadow-card",
    flat: "border-line bg-surface",
    sunken: "border-line bg-surface-sunken",
  } as const;

  return (
    <Tag
      {...rest}
      className={cn(
        "min-w-0 rounded-card border",
        tones[tone],
        interactive &&
          "transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raise",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** 卡片內距：統一手機 / 桌機的左右留白。 */
export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 px-5 py-5 sm:px-6", className)}>{children}</div>
  );
}

/** 卡片頁首：標題列，與內容之間有分隔線。 */
export function CardHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 border-b border-line px-5 py-4 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 小標：取代散落各處的 tracking-[0.14em] 寫法。 */
export function Eyebrow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-eyebrow font-semibold text-clay uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}
