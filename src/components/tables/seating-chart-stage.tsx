"use client";

import { useRef, type ReactNode } from "react";
import { FullscreenButton } from "@/components/ui/fullscreen-button";
import { cn } from "@/lib/class-names";
import { useFullscreen } from "@/lib/use-fullscreen";

/**
 * 桌圖外框：平常照原本大小預覽；全螢幕時海報以畫面高度為準放到最大，
 * 可以直接投到會場的螢幕或平板上給賓客看。
 */
export function SeatingChartStage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(stageRef);
  const isFullscreen = fullscreen.isFullscreen;

  return (
    <div
      ref={stageRef}
      data-testid="seating-chart-stage"
      data-fullscreen={fullscreen.mode}
      data-seating-chart-fullscreen={isFullscreen ? "true" : undefined}
      className={cn(
        isFullscreen
          ? "fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center overflow-hidden bg-paper-deep p-[max(0.75rem,env(safe-area-inset-top))]"
          : "relative",
      )}
    >
      <div
        className={cn(
          "flex justify-end print:hidden",
          isFullscreen
            ? "absolute top-3 right-3 z-10"
            : "mx-auto mt-6 w-full max-w-105",
        )}
      >
        <FullscreenButton
          isFullscreen={isFullscreen}
          onToggle={fullscreen.toggle}
          enterLabel="全螢幕顯示桌圖"
          exitLabel="離開全螢幕"
        />
      </div>
      {children}
    </div>
  );
}
