"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/class-names";
import { fieldControlClassName } from "./field";

/**
 * 列表工具列：搜尋 + 篩選 + 主要動作。
 * 讓賓客／花費這種會長到上百筆的列表不必用捲的找資料。
 */
export function Toolbar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SearchInput({
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const id = useId();

  return (
    <div className={cn("relative min-w-0 flex-1 sm:max-w-xs", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
      >
        <circle cx="9" cy="9" r="5.5" />
        <path d="M13.5 13.5L17 17" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(fieldControlClassName, "pl-9")}
      />
    </div>
  );
}

/**
 * 篩選籤：單選的分段控制項。用 radiogroup 語意，鍵盤可以左右切換。
 */
export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1 rounded-control border border-line bg-surface-sunken p-1",
        className,
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              // 手機維持 44px 觸控目標，桌機才收成緊湊的分段控制。
              "inline-flex min-h-11 items-center gap-1.5 rounded-[0.4rem] px-3 text-caption font-semibold whitespace-nowrap transition sm:min-h-9",
              isSelected
                ? "bg-surface text-ink shadow-card"
                : "text-ink-soft hover:text-ink",
            )}
          >
            {option.label}
            {typeof option.count === "number" && (
              <span
                className={cn(
                  "tabular-nums",
                  isSelected ? "text-clay" : "text-ink-faint",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
