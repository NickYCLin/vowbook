"use client";

import { CornersIn, CornersOut } from "@phosphor-icons/react";
import { cn } from "@/lib/class-names";

export function FullscreenButton({
  isFullscreen,
  onToggle,
  enterLabel = "全螢幕顯示",
  exitLabel = "離開全螢幕",
  className,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
  enterLabel?: string;
  exitLabel?: string;
  className?: string;
}) {
  const label = isFullscreen ? exitLabel : enterLabel;
  const Icon = isFullscreen ? CornersIn : CornersOut;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isFullscreen}
      title={label}
      onClick={onToggle}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface text-clay-strong shadow-card transition hover:border-clay hover:bg-clay-soft focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:outline-none print:hidden",
        className,
      )}
    >
      <Icon aria-hidden="true" size={22} weight="bold" />
    </button>
  );
}
