"use client";

import {
  useCallback,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/class-names";
import { containDialogFocus } from "@/lib/dialog-focus-containment";

/**
 * 原生 <dialog> 的共用外殼：焦點鎖定、關閉後把焦點還給觸發鈕、
 * 送出中不允許 Esc 關閉。原本 budget / staff 各自實作一份，統一到這裡。
 */
export function useModalDialog<T extends HTMLElement = HTMLButtonElement>({
  fallbackFocusId,
}: { fallbackFocusId?: string } = {}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<T>(null);
  const restoreFocusOnCloseRef = useRef(true);

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    restoreFocusOnCloseRef.current = true;
    dialog.showModal();
    // 開啟後把游標帶到第一個可輸入的欄位，省下一次 Tab。
    dialog
      .querySelector<HTMLElement>(
        'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)',
      )
      ?.focus();
  }, []);

  const close = useCallback(() => {
    restoreFocusOnCloseRef.current = true;
    dialogRef.current?.close();
  }, []);

  const closeWithoutRestoringFocus = useCallback(() => {
    restoreFocusOnCloseRef.current = false;
    dialogRef.current?.close();
  }, []);

  const restoreFocus = useCallback(() => {
    if (!restoreFocusOnCloseRef.current) {
      return;
    }
    const trigger = triggerRef.current;
    if (trigger?.isConnected && trigger.closest("[hidden]") === null) {
      trigger.focus();
      return;
    }
    if (fallbackFocusId) {
      document.getElementById(fallbackFocusId)?.focus();
    }
  }, [fallbackFocusId]);

  return {
    dialogRef,
    triggerRef,
    open,
    close,
    closeWithoutRestoringFocus,
    restoreFocus,
  };
}

const sizes = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
} as const;

export function Dialog({
  dialogRef,
  titleId,
  title,
  eyebrow,
  description,
  closeLabel,
  isPending = false,
  size = "md",
  onClose,
  onRestoreFocus,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  titleId: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  isPending?: boolean;
  size?: keyof typeof sizes;
  onClose: () => void;
  onRestoreFocus?: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
      onCancel={(event) => {
        if (isPending) event.preventDefault();
      }}
      onClose={() => onRestoreFocus?.()}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-x-hidden overflow-y-auto overscroll-contain",
        "rounded-card border border-line bg-surface p-0 text-left text-ink shadow-overlay",
        sizes[size],
      )}
    >
      <div className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur sm:px-6">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-eyebrow font-semibold text-clay uppercase">
              {eyebrow}
            </p>
          )}
          <h2
            id={titleId}
            className={cn(
              "font-serif text-title font-semibold break-words text-ink",
              eyebrow ? "mt-1" : null,
            )}
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 text-caption break-words text-ink-soft">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          disabled={isPending}
          onClick={onClose}
          className="-mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface-sunken hover:text-ink disabled:cursor-wait disabled:opacity-50 sm:size-9"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="size-4.5"
          >
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** Dialog 底部動作列：主要動作靠右，手機上撐滿。 */
export function DialogFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-3 border-t border-line bg-surface-sunken/60 px-5 py-4 sm:flex-row sm:justify-end sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
