"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  ArrowsOut,
  Check,
  HandHeart,
  Minus,
  PencilSimple,
  Plus,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import {
  saveWeddingSpeechAction,
  type WeddingSpeechMutationState,
} from "@/actions/wedding-speeches";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { buttonClassName } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import {
  estimateSpeechSeconds,
  WEDDING_SPEECH_LABELS,
  WEDDING_SPEECH_MAX,
  WEDDING_SPEECH_TEMPLATES,
  WEDDING_SPEECHES,
  type WeddingSpeechKey,
} from "@/domain/wedding-speech";
import type { WeddingSpeeches, WeddingSpeechItem } from "@/lib/wedding-timeline-list";
import { cn } from "@/lib/class-names";

const idle: WeddingSpeechMutationState = { status: "idle" };
const iconButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-control transition disabled:cursor-not-allowed disabled:opacity-50";

function readingTime(content: string): string {
  const seconds = estimateSpeechSeconds(content);
  if (seconds < 60) return `約 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `約 ${minutes} 分鐘` : `約 ${minutes} 分 ${rest} 秒`;
}

export function WeddingSpeechCards({
  workspaceId,
  speeches,
  canEdit,
}: {
  workspaceId: string;
  speeches: WeddingSpeeches;
  canEdit: boolean;
}) {
  return (
    <section
      id="wedding-speeches"
      aria-labelledby="wedding-speeches-heading"
      className="mt-10 min-w-0 scroll-mt-24"
    >
      <h2
        id="wedding-speeches-heading"
        className="font-serif text-title font-semibold text-ink"
      >
        證婚・謝親恩
      </h2>
      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
        {WEDDING_SPEECHES.map((kind) => (
          <SpeechCard
            key={kind}
            workspaceId={workspaceId}
            kind={kind}
            speech={speeches[kind]}
            canEdit={canEdit}
          />
        ))}
      </div>
    </section>
  );
}

function SpeechCard({
  workspaceId,
  kind,
  speech,
  canEdit,
}: {
  workspaceId: string;
  kind: WeddingSpeechKey;
  speech: WeddingSpeechItem | null;
  canEdit: boolean;
}) {
  const label = WEDDING_SPEECH_LABELS[kind];
  const headingId = `wedding-speech-${kind.toLowerCase()}-heading`;
  const [editing, setEditing] = useState(false);
  const [prompting, setPrompting] = useState(false);

  return (
    <article
      aria-labelledby={headingId}
      data-wedding-speech={kind}
      className="flex min-w-0 flex-col rounded-card border border-line bg-surface"
    >
      <header className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-2">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
            kind === "GROOM_PARENTS"
              ? "bg-sage-soft text-sage"
              : "bg-clay-soft text-clay-strong",
          )}
        >
          <HandHeart size={20} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-base font-semibold text-ink">
            {label}
          </h3>
          {speech ? (
            <p className="text-caption text-ink-soft tabular-nums">
              {readingTime(speech.content)}
            </p>
          ) : null}
        </div>
        {speech && !editing ? (
          <button
            type="button"
            onClick={() => setPrompting(true)}
            aria-label={`${label}提詞模式`}
            title="提詞模式"
            className={cn(iconButton, "text-ink-soft hover:bg-clay-soft hover:text-clay-strong")}
          >
            <ArrowsOut size={20} />
          </button>
        ) : null}
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`編輯${label}`}
            title="編輯"
            className={cn(iconButton, "-mr-2 text-ink-soft hover:bg-clay-soft hover:text-clay-strong")}
          >
            <PencilSimple size={20} />
          </button>
        ) : null}
      </header>

      {editing ? (
        <SpeechEditor
          workspaceId={workspaceId}
          kind={kind}
          speech={speech}
          onDone={() => setEditing(false)}
        />
      ) : speech ? (
        <p className="min-w-0 whitespace-pre-wrap break-words px-4 py-3 text-sm leading-7 text-ink [overflow-wrap:anywhere]">
          {speech.content}
        </p>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
          <p className="text-caption text-ink-faint">尚未撰寫</p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              <PencilSimple aria-hidden="true" size={16} />
              開始寫
            </button>
          ) : null}
        </div>
      )}

      {prompting && speech ? (
        <SpeechPrompter
          label={label}
          content={speech.content}
          onClose={() => setPrompting(false)}
        />
      ) : null}
    </article>
  );
}

function SpeechEditor({
  workspaceId,
  kind,
  speech,
  onDone,
}: {
  workspaceId: string;
  kind: WeddingSpeechKey;
  speech: WeddingSpeechItem | null;
  onDone: () => void;
}) {
  const label = WEDDING_SPEECH_LABELS[kind];
  const action = saveWeddingSpeechAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idle);
  const [content, setContent] = useState(speech?.content ?? "");
  const textareaId = useId();
  const length = Array.from(content).length;

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      aria-label={`編輯${label}`}
      className="flex min-w-0 flex-1 flex-col gap-2 px-4 py-3"
    >
      <input type="hidden" name="kind" value={kind} />
      <input
        type="hidden"
        name="expectedVersion"
        value={speech ? String(speech.version) : ""}
      />
      <Textarea
        id={textareaId}
        name="content"
        aria-label={`${label}內容`}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        maxLength={WEDDING_SPEECH_MAX}
        rows={10}
        autoFocus
        placeholder="一句一行，念的時候比較好換氣"
        className="min-h-56"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-soft tabular-nums">
        <span>
          {length} / {WEDDING_SPEECH_MAX} 字
        </span>
        {content.trim() ? <span>{readingTime(content)}</span> : null}
        {content.trim() === "" ? (
          <button
            type="button"
            onClick={() => {
              setContent(WEDDING_SPEECH_TEMPLATES[kind]);
              document.getElementById(textareaId)?.focus();
            }}
            className="inline-flex min-h-9 items-center gap-1 font-semibold text-clay-strong hover:underline"
          >
            <Sparkle aria-hidden="true" size={16} />
            帶入草稿
          </button>
        ) : null}
        {content.includes("【") ? (
          <span className="text-caution">還有【】要換成你們自己的內容</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            aria-label="取消編輯"
            title="取消"
            className={cn(iconButton, "text-ink-soft hover:bg-surface-sunken")}
          >
            <X size={18} />
          </button>
          <button
            type="submit"
            disabled={pending}
            aria-label="儲存"
            title="儲存"
            className={cn(iconButton, "bg-clay text-white hover:bg-clay-strong")}
          >
            <Check size={18} weight="bold" />
          </button>
        </span>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

const promptSizes = ["text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl"] as const;

function SpeechPrompter({
  label,
  content,
  onClose,
}: {
  label: string;
  content: string;
  onClose: () => void;
}) {
  const [size, setSize] = useState(2);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label}提詞`}
      data-speech-prompter
      className="fixed inset-0 z-50 flex flex-col bg-surface"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <p className="min-w-0 flex-1 truncate font-semibold text-ink">{label}</p>
        <button
          type="button"
          onClick={() => setSize((value) => Math.max(0, value - 1))}
          disabled={size === 0}
          aria-label="字縮小"
          title="字縮小"
          className={cn(iconButton, "text-ink-soft hover:bg-surface-sunken")}
        >
          <Minus size={20} />
        </button>
        <button
          type="button"
          onClick={() => setSize((value) => Math.min(promptSizes.length - 1, value + 1))}
          disabled={size === promptSizes.length - 1}
          aria-label="字放大"
          title="字放大"
          className={cn(iconButton, "text-ink-soft hover:bg-surface-sunken")}
        >
          <Plus size={20} />
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="關閉提詞"
          title="關閉"
          className={cn(iconButton, "text-ink-soft hover:bg-surface-sunken")}
        >
          <X size={22} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className={cn("mx-auto max-w-3xl space-y-[0.9em] font-serif leading-relaxed text-ink", promptSizes[size])}>
          {content.split("\n").map((line, index) =>
            line.trim() === "" ? (
              <div key={index} aria-hidden="true" className="h-[0.6em]" />
            ) : (
              <p key={index} className="break-words [overflow-wrap:anywhere]">
                {line}
              </p>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
