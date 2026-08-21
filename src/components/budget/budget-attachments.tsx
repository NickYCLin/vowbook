"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { BudgetAttachmentMetadata } from "@/domain/budget-attachment";
import { withBasePath } from "@/lib/base-path";

const ACCEPTED_ATTACHMENT_TYPES =
  "application/pdf,image/jpeg,image/png,image/webp";

const MEDIA_TYPE_LABELS: Record<
  BudgetAttachmentMetadata["mediaType"],
  string
> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
};

function formatByteSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) {
    const kibibytes = byteSize / 1024;
    return `${Number.isInteger(kibibytes) ? kibibytes : kibibytes.toFixed(1)} KB`;
  }
  const mebibytes = byteSize / (1024 * 1024);
  return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`;
}

function uploadedAtLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

async function responseError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.length > 0
      ? body.error
      : fallback;
  } catch {
    return fallback;
  }
}

function attachmentPath(
  workspaceId: string,
  budgetItemId: string,
  attachmentId?: string,
): string {
  const base = `/api/workspaces/${encodeURIComponent(
    workspaceId,
  )}/budget/${encodeURIComponent(budgetItemId)}/attachments`;
  return withBasePath(
    attachmentId === undefined
      ? base
      : `${base}/${encodeURIComponent(attachmentId)}`,
  );
}

function attachmentPreviewPath(
  workspaceId: string,
  budgetItemId: string,
  attachmentId: string,
): string {
  return withBasePath(
    "/workspaces/" +
      encodeURIComponent(workspaceId) +
      "/budget/" +
      encodeURIComponent(budgetItemId) +
      "/attachments/" +
      encodeURIComponent(attachmentId) +
      "/preview",
  );
}

export function BudgetAttachments({
  workspaceId,
  budgetItemId,
  initialAttachments,
  canEdit,
  onPendingChange,
  onAttachmentCountChange,
}: {
  workspaceId: string;
  budgetItemId: string;
  initialAttachments: BudgetAttachmentMetadata[];
  canEdit: boolean;
  onPendingChange?: (pending: boolean) => void;
  onAttachmentCountChange?: (count: number) => void;
}) {
  const [attachments, setAttachments] =
    useState<BudgetAttachmentMetadata[]>(initialAttachments);
  const [uploadPending, setUploadPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pending = uploadPending || deletingId !== null;

  useEffect(() => {
    if (status !== null || error !== null) feedbackRef.current?.focus();
  }, [error, status]);

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    const input = form.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : null;
    if (!file) {
      setStatus(null);
      setError("請先選擇一個附件。");
      return;
    }

    setUploadPending(true);
    onPendingChange?.(true);
    setStatus(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(
        attachmentPath(workspaceId, budgetItemId),
        {
          method: "POST",
          credentials: "same-origin",
          body: formData,
        },
      );
      if (!response.ok) {
        throw new Error(
          await responseError(response, "附件上傳失敗，請稍後再試。"),
        );
      }
      const body = (await response.json()) as {
        attachment?: BudgetAttachmentMetadata;
      };
      if (!body.attachment) {
        throw new Error("附件上傳失敗，請稍後再試。");
      }

      const nextAttachments = [...attachments, body.attachment];
      setAttachments(nextAttachments);
      onAttachmentCountChange?.(nextAttachments.length);
      form.reset();
      setStatus(`已上傳附件「${body.attachment.originalName}」。`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "附件上傳失敗，請稍後再試。",
      );
    } finally {
      setUploadPending(false);
      onPendingChange?.(false);
    }
  }

  async function remove(attachment: BudgetAttachmentMetadata): Promise<void> {
    if (
      pending ||
      !window.confirm(
        `確定刪除附件「${attachment.originalName}」？刪除後無法復原。`,
      )
    ) {
      return;
    }

    setDeletingId(attachment.id);
    onPendingChange?.(true);
    setStatus(null);
    setError(null);
    try {
      const response = await fetch(
        attachmentPath(workspaceId, budgetItemId, attachment.id),
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!response.ok) {
        throw new Error(
          await responseError(response, "附件刪除失敗，請稍後再試。"),
        );
      }

      const nextAttachments = attachments.filter(
        (candidate) => candidate.id !== attachment.id,
      );
      setAttachments(nextAttachments);
      onAttachmentCountChange?.(nextAttachments.length);
      setStatus(`已刪除附件「${attachment.originalName}」。`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "附件刪除失敗，請稍後再試。",
      );
    } finally {
      setDeletingId(null);
      onPendingChange?.(false);
      requestAnimationFrame(() => headingRef.current?.focus());
    }
  }

  return (
    <section
      aria-labelledby={`budget-attachments-${budgetItemId}`}
      aria-busy={pending}
      className="mt-6 min-w-0 border-t border-line pt-5"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h3
          id={`budget-attachments-${budgetItemId}`}
          ref={headingRef}
          tabIndex={-1}
          className="font-serif text-lg font-semibold text-ink"
        >
          附件
        </h3>
        <span className="text-xs tabular-nums text-ink-faint">
          {attachments.length} / 20
        </span>
      </div>

      {attachments.length === 0 ? (
        <p className="mt-3 text-sm text-ink-faint">尚未上傳附件。</p>
      ) : (
        <ul className="mt-3 min-w-0 divide-y divide-line border-y border-line">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              data-attachment-layout="mobile-stacked"
              className="grid min-w-0 grid-cols-1 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="break-all text-sm font-semibold text-ink">
                  {attachment.originalName}
                </p>
                <p className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
                  <span>{MEDIA_TYPE_LABELS[attachment.mediaType]}</span>
                  <span>{formatByteSize(attachment.byteSize)}</span>
                  <time dateTime={attachment.createdAt}>
                    上傳於 {uploadedAtLabel(attachment.createdAt)}
                  </time>
                </p>
              </div>
              <div
                data-attachment-controls="true"
                className="flex min-w-0 flex-wrap gap-2 sm:justify-end"
              >
                <a
                  href={attachmentPreviewPath(
                    workspaceId,
                    budgetItemId,
                    attachment.id,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`線上查看（新分頁）：${attachment.originalName}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong px-4 py-2 text-sm font-semibold text-clay-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9d7356]"
                >
                  線上查看（新分頁）
                </a>
                <a
                  href={attachmentPath(
                    workspaceId,
                    budgetItemId,
                    attachment.id,
                  )}
                  download
                  aria-label={`下載 ${attachment.originalName}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong px-4 py-2 text-sm font-semibold text-clay-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9d7356]"
                >
                  下載
                </a>
                {canEdit && (
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`刪除附件：${attachment.originalName}`}
                    onClick={() => void remove(attachment)}
                    className="min-h-11 rounded-full border border-danger/40 px-4 py-2 text-sm font-semibold text-danger disabled:cursor-wait disabled:opacity-50"
                  >
                    {deletingId === attachment.id ? "刪除中…" : "刪除"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          aria-label="上傳花費附件"
          onSubmit={(event) => void upload(event)}
          className="mt-4 min-w-0 rounded-lg border border-dashed border-line bg-surface/55 p-4"
        >
          <label
            htmlFor={`budget-attachment-file-${budgetItemId}`}
            className="block text-sm font-semibold text-ink"
          >
            選擇附件
          </label>
          <input
            id={`budget-attachment-file-${budgetItemId}`}
            name="file"
            type="file"
            accept={ACCEPTED_ATTACHMENT_TYPES}
            disabled={pending || attachments.length >= 20}
            className="mt-2 block min-h-11 w-full min-w-0 max-w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-full file:border file:border-line-strong file:bg-surface file:px-4 file:py-2 file:font-semibold file:text-clay-strong disabled:cursor-wait disabled:opacity-60"
          />
          <p className="mt-2 break-words text-xs leading-5 text-ink-faint">
            PDF、JPEG、PNG、WEBP，單檔最多 10 MiB；每筆花費最多 20
            個附件。
          </p>
          <button
            type="submit"
            disabled={pending || attachments.length >= 20}
            className="mt-3 min-h-11 rounded-full bg-[#765541] px-5 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50"
          >
            {uploadPending ? "上傳中…" : "上傳附件"}
          </button>
        </form>
      )}

      {status && (
        <p
          ref={feedbackRef}
          tabIndex={-1}
          role="status"
          className="mt-3 break-words border-l-2 border-sage bg-sage-soft px-4 py-3 text-sm text-sage"
        >
          {status}
        </p>
      )}
      {error && (
        <p
          ref={feedbackRef}
          tabIndex={-1}
          role="alert"
          className="mt-3 break-words border-l-2 border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
    </section>
  );
}
