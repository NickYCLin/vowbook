import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/class-names";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-solid";

export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex max-w-full items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-clay text-white shadow-card hover:bg-clay-strong active:bg-clay-strong",
  secondary:
    "border border-line-strong bg-surface text-clay-strong hover:border-clay hover:bg-clay-soft",
  ghost: "text-clay-strong hover:bg-clay-soft",
  danger:
    "border border-danger/40 bg-surface text-danger hover:border-danger hover:bg-danger-soft",
  "danger-solid": "bg-danger text-white hover:bg-danger/90",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-caption",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-6 text-body",
};

export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export function Button({
  variant,
  size,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClassName({ variant, size, className })}
    >
      {children}
    </button>
  );
}

/**
 * 送出鈕：pending 時自動 disable 並換成進行中文案，
 * 讓每個表單不必各自重複這段。
 */
export function SubmitButton({
  isPending,
  pendingLabel,
  children,
  variant,
  size,
  className,
  ...rest
}: Omit<ButtonProps, "type"> & {
  isPending: boolean;
  pendingLabel: string;
}) {
  return (
    <button
      {...rest}
      type="submit"
      disabled={isPending || rest.disabled}
      // 送出中才是等待游標；單純「沒東西可存」的停用不該顯示 wait。
      className={buttonClassName({
        variant,
        size,
        className: cn(isPending && "cursor-wait", className),
      })}
    >
      {isPending ? pendingLabel : children}
    </button>
  );
}
