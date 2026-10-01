"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { FileText, FilmStrip, Image as ImageIcon, Table } from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";
import {
  canViewWorkspaceDocumentInline,
  MAX_WORKSPACE_DOCUMENT_COUNT,
  WORKSPACE_DOCUMENT_ACCEPT,
  WORKSPACE_DOCUMENT_CATEGORIES,
  WORKSPACE_DOCUMENT_CATEGORY_LABELS,
  workspaceDocumentMediaTypeLabel,
  type WorkspaceDocumentCategory,
  type WorkspaceDocumentMetadata,
} from "@/domain/workspace-document";
import { withBasePath } from "@/lib/base-path";

const CATEGORY_HINTS: Record<WorkspaceDocumentCategory, string> = {
  INVITATION: "傳給親友的喜帖圖檔、PDF 或影片，要重傳時從這裡下載。",
  VENDOR_SCHEDULE: "婚企、婚攝、場地給的當日流程或彩排行程。",
  VENDOR_CONTRACT: "報價單、合約與加購確認，付尾款前可以回來核對。",
  OTHER: "其他想留存的檔案。",
};

function formatByteSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(byteSize % 1024 === 0 ? 0 : 1)} KB`;
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

function documentPath(workspaceId: string, documentId?: string): string {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/documents`;
  return withBasePath(documentId === undefined ? base : `${base}/${encodeURIComponent(documentId)}`);
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.length > 0 ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function DocumentIcon({ mediaType }: { mediaType: WorkspaceDocumentMetadata["mediaType"] }) {
  const className = "size-7 text-clay";
  if (mediaType.startsWith("image/")) return <ImageIcon aria-hidden="true" className={className} />;
  if (mediaType === "video/mp4") return <FilmStrip aria-hidden="true" className={className} />;
  if (mediaType.includes("spreadsheet")) return <Table aria-hidden="true" className={className} />;
  return <FileText aria-hidden="true" className={className} />;
}

export function WorkspaceDocuments({
  workspaceId,
  initialDocuments,
  canEdit,
}: {
  workspaceId: string;
  initialDocuments: WorkspaceDocumentMetadata[];
  canEdit: boolean;
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploadPending, setUploadPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const pending = uploadPending || deletingId !== null;
  const full = documents.length >= MAX_WORKSPACE_DOCUMENT_COUNT;

  useEffect(() => {
    if (status !== null || error !== null) feedbackRef.current?.focus({ preventScroll: true });
  }, [error, status]);

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const input = form.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : null;
    if (!file) {
      setStatus(null);
      setError("請先選擇要上傳的檔案。");
      return;
    }

    setUploadPending(true);
    setStatus(null);
    setError(null);
    try {
      const formData = new FormData(form);
      formData.set("file", file);
      const response = await fetch(documentPath(workspaceId), {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      if (!response.ok) throw new Error(await responseError(response, "上傳失敗，請稍後再試。"));
      const body = (await response.json()) as { document?: WorkspaceDocumentMetadata };
      if (!body.document) throw new Error("上傳失敗，請稍後再試。");
      const created = body.document;
      setDocuments((current) => [created, ...current]);
      const category = form.elements.namedItem("category");
      const keptCategory = category instanceof HTMLSelectElement ? category.value : null;
      form.reset();
      if (category instanceof HTMLSelectElement && keptCategory) category.value = keptCategory;
      setStatus(`已存好「${created.title}」。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上傳失敗，請稍後再試。");
    } finally {
      setUploadPending(false);
    }
  }

  async function remove(document: WorkspaceDocumentMetadata): Promise<void> {
    if (pending || !window.confirm(`確定刪除「${document.title}」？刪除後無法復原。`)) return;
    setDeletingId(document.id);
    setStatus(null);
    setError(null);
    try {
      const response = await fetch(documentPath(workspaceId, document.id), {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(await responseError(response, "刪除失敗，請稍後再試。"));
      }
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setStatus(`已刪除「${document.title}」。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "刪除失敗，請稍後再試。");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mt-6 space-y-6 sm:mt-8 sm:space-y-8">
      {canEdit && (
        <Card as="section" aria-labelledby="document-upload-heading" className="min-w-0 p-5 sm:p-6">
          <h2 id="document-upload-heading" className="font-serif text-title font-semibold text-ink">
            上傳文件
          </h2>
          <form aria-label="上傳喜帖或廠商文件" onSubmit={(event) => void upload(event)} className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="block min-w-0 text-sm font-semibold text-ink">
              分類
              <select
                name="category"
                defaultValue="INVITATION"
                disabled={pending || full}
                className="mt-2 block min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm font-normal"
              >
                {WORKSPACE_DOCUMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {WORKSPACE_DOCUMENT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm font-semibold text-ink">
              檔案
              <input
                name="file"
                type="file"
                required
                accept={WORKSPACE_DOCUMENT_ACCEPT}
                disabled={pending || full}
                className="mt-2 block min-h-11 w-full min-w-0 max-w-full text-sm font-normal text-ink file:mr-3 file:min-h-11 file:rounded-full file:border file:border-line-strong file:bg-surface file:px-4 file:py-2 file:font-semibold file:text-clay-strong"
              />
            </label>
            <label className="block min-w-0 text-sm font-semibold text-ink">
              名稱<span className="ml-1 font-normal text-ink-faint">（選填，留白用檔名）</span>
              <input
                name="title"
                type="text"
                maxLength={80}
                disabled={pending || full}
                placeholder="例如：電子喜帖定稿、婚攝合約"
                className="mt-2 block min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm font-normal"
              />
            </label>
            <label className="block min-w-0 text-sm font-semibold text-ink">
              備註<span className="ml-1 font-normal text-ink-faint">（選填）</span>
              <input
                name="notes"
                type="text"
                maxLength={200}
                disabled={pending || full}
                placeholder="例如：婚攝 Amy 提供，尾款 10/15 前"
                className="mt-2 block min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm font-normal"
              />
            </label>
            <div className="flex min-w-0 flex-wrap items-center gap-3 sm:col-span-2">
              <button type="submit" disabled={pending || full} className={buttonClassName()}>
                {uploadPending ? "上傳中…" : "上傳"}
              </button>
              <p className="min-w-0 flex-1 break-words text-caption leading-5 text-ink-faint">
                PDF、圖片（JPEG、PNG、WEBP、GIF）、MP4 影片、Word、Excel；單檔最多 25 MiB，每場婚宴最多 {MAX_WORKSPACE_DOCUMENT_COUNT} 份、共 500 MiB。
              </p>
            </div>
          </form>
        </Card>
      )}

      {status && (
        <p ref={feedbackRef} tabIndex={-1} role="status" className="break-words border-l-2 border-sage bg-sage-soft px-4 py-3 text-sm text-sage">
          {status}
        </p>
      )}
      {error && (
        <p ref={feedbackRef} tabIndex={-1} role="alert" className="break-words border-l-2 border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {WORKSPACE_DOCUMENT_CATEGORIES.map((category) => {
        const items = documents.filter((document) => document.category === category);
        const headingId = `documents-${category.toLowerCase()}`;
        return (
          <section key={category} aria-labelledby={headingId} className="min-w-0">
            <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id={headingId} className="font-serif text-title font-semibold text-ink">
                {WORKSPACE_DOCUMENT_CATEGORY_LABELS[category]}
                <span className="ml-2 text-caption font-normal text-ink-soft tabular-nums">{items.length} 份</span>
              </h2>
              <p className="min-w-0 text-caption text-ink-soft">{CATEGORY_HINTS[category]}</p>
            </div>
            {items.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong bg-surface/60 px-4 py-5 text-caption text-ink-soft">
                {canEdit ? "還沒有檔案，可以從上方上傳。" : "還沒有檔案。"}
              </p>
            ) : (
              <ul className="grid min-w-0 gap-3 md:grid-cols-2">
                {items.map((document) => {
                  const url = documentPath(workspaceId, document.id);
                  const inlineUrl = `${url}?disposition=inline`;
                  const viewable = canViewWorkspaceDocumentInline(document.mediaType);
                  const isImage = document.mediaType.startsWith("image/");
                  return (
                    <li key={document.id} data-document-id={document.id} className="flex min-w-0 gap-4 rounded-card border border-line bg-surface p-4">
                      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-clay-soft/60">
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 需帶登入 cookie 的私有檔案，不經 next/image 最佳化。
                          <img src={inlineUrl} alt="" loading="lazy" className="size-full object-cover" />
                        ) : (
                          <DocumentIcon mediaType={document.mediaType} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold text-ink">{document.title}</p>
                        <p className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
                          <span>{workspaceDocumentMediaTypeLabel(document.mediaType)}</span>
                          <span>{formatByteSize(document.byteSize)}</span>
                          <time dateTime={document.createdAt}>{uploadedAtLabel(document.createdAt)}</time>
                          {document.uploadedByName && <span>{document.uploadedByName} 上傳</span>}
                        </p>
                        {document.notes && <p className="mt-2 break-words text-caption text-ink-soft">{document.notes}</p>}
                        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                          {viewable && (
                            <a
                              href={inlineUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`開啟（新分頁）：${document.title}`}
                              className={buttonClassName({ variant: "secondary", size: "sm" })}
                            >
                              開啟
                            </a>
                          )}
                          <a href={url} download aria-label={`下載：${document.title}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                            下載
                          </a>
                          {canEdit && (
                            <button
                              type="button"
                              disabled={pending}
                              aria-label={`刪除：${document.title}`}
                              onClick={() => void remove(document)}
                              className={buttonClassName({ variant: "danger", size: "sm" })}
                            >
                              {deletingId === document.id ? "刪除中…" : "刪除"}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
