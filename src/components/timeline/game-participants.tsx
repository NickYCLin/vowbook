"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Check,
  FlowerTulip,
  PencilSimple,
  Plant,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  addWeddingGameParticipantsAction,
  deleteWeddingGameParticipantAction,
  updateWeddingGameParticipantAction,
  type WeddingGameMutationState,
} from "@/actions/wedding-games";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Input } from "@/components/ui/field";
import {
  WEDDING_GAME_LABELS,
  WEDDING_GAME_NAME_MAX,
  WEDDING_GAME_NOTE_MAX,
  WEDDING_GAMES,
  type WeddingGameKey,
} from "@/domain/wedding-game";
import type {
  WeddingGameLists,
  WeddingGameParticipantItem,
} from "@/lib/wedding-timeline-list";
import { cn } from "@/lib/class-names";

const idle: WeddingGameMutationState = { status: "idle" };
const wrapText = "min-w-0 break-words [overflow-wrap:anywhere]";
const iconButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-control transition disabled:cursor-not-allowed disabled:opacity-50";

const gameStyle: Record<
  WeddingGameKey,
  { icon: typeof FlowerTulip; tone: string; number: string }
> = {
  BOUQUET: {
    icon: FlowerTulip,
    tone: "bg-clay-soft text-clay-strong",
    number: "bg-clay-soft text-clay-strong",
  },
  BROCCOLI: {
    icon: Plant,
    tone: "bg-sage-soft text-sage",
    number: "bg-sage-soft text-sage",
  },
};

export function WeddingGameParticipantLists({
  workspaceId,
  games,
  canEdit,
}: {
  workspaceId: string;
  games: WeddingGameLists;
  canEdit: boolean;
}) {
  return (
    <section
      id="wedding-games"
      aria-labelledby="wedding-games-heading"
      className="mt-10 min-w-0 scroll-mt-24"
    >
      <h2
        id="wedding-games-heading"
        className="font-serif text-title font-semibold text-ink"
      >
        遊戲名單
      </h2>
      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
        {WEDDING_GAMES.map((game) => (
          <GameList
            key={game}
            workspaceId={workspaceId}
            game={game}
            participants={games[game]}
            canEdit={canEdit}
          />
        ))}
      </div>
    </section>
  );
}

function GameList({
  workspaceId,
  game,
  participants,
  canEdit,
}: {
  workspaceId: string;
  game: WeddingGameKey;
  participants: WeddingGameParticipantItem[];
  canEdit: boolean;
}) {
  const label = WEDDING_GAME_LABELS[game];
  const style = gameStyle[game];
  const Icon = style.icon;
  const headingId = `wedding-game-${game.toLowerCase()}-heading`;

  return (
    <article
      aria-labelledby={headingId}
      data-wedding-game={game}
      className="flex min-w-0 flex-col rounded-card border border-line bg-surface"
    >
      <header className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
            style.tone,
          )}
        >
          <Icon size={20} weight="duotone" />
        </span>
        <h3
          id={headingId}
          className={cn("flex-1 text-base font-semibold text-ink", wrapText)}
        >
          {label}
        </h3>
        <span className="shrink-0 text-caption font-semibold text-ink-soft tabular-nums">
          {participants.length} 位
        </span>
      </header>

      {participants.length === 0 ? (
        <p className="px-4 py-6 text-center text-caption text-ink-faint">
          尚未填寫名單
        </p>
      ) : (
        <ol aria-label={`${label}名單`} className="min-w-0 divide-y divide-line">
          {participants.map((participant, index) => (
            <ParticipantRow
              key={participant.id}
              workspaceId={workspaceId}
              participant={participant}
              position={index + 1}
              numberTone={style.number}
              canEdit={canEdit}
            />
          ))}
        </ol>
      )}

      {canEdit ? (
        <AddParticipantsForm workspaceId={workspaceId} game={game} label={label} />
      ) : null}
    </article>
  );
}

function ParticipantRow({
  workspaceId,
  participant,
  position,
  numberTone,
  canEdit,
}: {
  workspaceId: string;
  participant: WeddingGameParticipantItem;
  position: number;
  numberTone: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const deleteAction = deleteWeddingGameParticipantAction.bind(
    null,
    workspaceId,
    participant.id,
  );
  const [deleteState, deleteFormAction, deleting] = useActionState(
    deleteAction,
    idle,
  );

  if (editing) {
    return (
      <li className="min-w-0 px-4 py-3">
        <EditParticipantForm
          workspaceId={workspaceId}
          participant={participant}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li data-game-participant className="min-w-0 px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[0.72rem] font-semibold tabular-nums",
            numberTone,
          )}
        >
          {position}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold text-ink", wrapText)}>
            {participant.name}
          </p>
          {participant.note ? (
            <p className={cn("text-caption leading-5 text-ink-soft", wrapText)}>
              {participant.note}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="-mr-2.5 flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={`編輯 ${participant.name}`}
              title="編輯"
              className={cn(iconButton, "text-ink-soft hover:bg-clay-soft hover:text-clay-strong")}
            >
              <PencilSimple size={18} />
            </button>
            <form action={deleteFormAction}>
              <input
                type="hidden"
                name="expectedVersion"
                value={participant.version}
              />
              <button
                type="submit"
                disabled={deleting}
                aria-label={`移除 ${participant.name}`}
                title="移除"
                className={cn(iconButton, "text-ink-soft hover:bg-danger-soft hover:text-danger")}
              >
                <Trash size={18} />
              </button>
            </form>
          </div>
        ) : null}
      </div>
      {deleteState.status === "error" ? (
        <ActionFeedback state={deleteState} className="mt-2" />
      ) : null}
    </li>
  );
}

function EditParticipantForm({
  workspaceId,
  participant,
  onDone,
}: {
  workspaceId: string;
  participant: WeddingGameParticipantItem;
  onDone: () => void;
}) {
  const action = updateWeddingGameParticipantAction.bind(
    null,
    workspaceId,
    participant.id,
  );
  const [state, formAction, pending] = useActionState(action, idle);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      aria-label={`編輯 ${participant.name}`}
      className="min-w-0 space-y-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
    >
      <input type="hidden" name="expectedVersion" value={participant.version} />
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Input
          name="name"
          aria-label="姓名"
          defaultValue={participant.name}
          maxLength={WEDDING_GAME_NAME_MAX}
          required
          autoFocus
        />
        <Input
          name="note"
          aria-label="備註"
          placeholder="備註"
          defaultValue={participant.note ?? ""}
          maxLength={WEDDING_GAME_NOTE_MAX}
        />
      </div>
      <div className="flex items-center justify-end gap-1">
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
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

type AddState = WeddingGameMutationState & { draft?: string };

function AddParticipantsForm({
  workspaceId,
  game,
  label,
}: {
  workspaceId: string;
  game: WeddingGameKey;
  label: string;
}) {
  const action = addWeddingGameParticipantsAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState<AddState, FormData>(
    async (previous, formData) => {
      const result = await action(previous, formData);
      // 失敗時保留剛輸入的名字，成功才清空。
      return {
        ...result,
        draft:
          result.status === "error" ? String(formData.get("names") ?? "") : "",
      };
    },
    idle,
  );

  return (
    <form
      action={formAction}
      aria-label={`新增${label}名單`}
      className="mt-auto min-w-0 space-y-2 border-t border-line bg-surface-sunken/60 px-4 py-3"
    >
      <input type="hidden" name="game" value={game} />
      <div className="flex min-w-0 gap-2">
        <Input
          name="names"
          aria-label={`${label}姓名`}
          placeholder="姓名，多位用頓號分隔"
          defaultValue={state.draft ?? ""}
          autoComplete="off"
          required
          className="flex-1"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control bg-clay px-3.5 text-sm font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-60"
        >
          <Plus size={16} weight="bold" aria-hidden="true" />
          {pending ? "加入中…" : "加入"}
        </button>
      </div>
      {state.status === "error" ? <ActionFeedback state={state} /> : null}
    </form>
  );
}
