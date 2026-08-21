import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/class-names";

const control =
  "w-full min-w-0 rounded-control border border-line-strong bg-surface px-3.5 text-ink transition placeholder:text-ink-faint focus:border-clay focus:bg-white disabled:bg-surface-sunken disabled:text-ink-faint";

export const fieldControlClassName = cn(control, "min-h-11");

/**
 * 欄位外框：標籤、選填註記、控制項、說明文字與錯誤訊息的統一排版。
 * hint 會透過 aria-describedby 綁到控制項上，錯誤時改綁 error。
 */
export function Field({
  htmlFor,
  label,
  optional,
  hint,
  error,
  className,
  children,
}: {
  htmlFor: string;
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={htmlFor}
        className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink"
      >
        {label}
        {optional && (
          <span className="text-caption font-normal text-ink-faint">選填</span>
        )}
      </label>
      <div className="mt-2 min-w-0">{children}</div>
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-caption text-ink-faint">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="mt-1.5 text-caption font-medium text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(fieldControlClassName, className)} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cn(control, "min-h-24 py-2.5 leading-7", className)}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(fieldControlClassName, "pr-9", className)}>
      {children}
    </select>
  );
}
