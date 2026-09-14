"use client";

import {isGiftCollectionExcluded} from "@/domain/wedding-gift-policy";
import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  setGuestGiftExemptionAction,
  type GuestGiftExemptionSnapshot,
  createWeddingGiftAction,
  deleteWeddingGiftAction,
  setWeddingGiftReturnAction,
  updateWeddingGiftAction,
  type WeddingGiftMutationSnapshot,
  type WeddingGiftMutationState,
} from "@/actions/wedding-gifts";
import {
  GUEST_CATEGORY_LABELS,
  guestIdentityLabel,
  type GuestAttendanceStatusValue,
  type GuestCategoryValue,
  type GuestSideValue,
} from "@/domain/guest";
import {
  isWeddingGiftReturnPending,
  isWeddingGiftSort,
  isWeddingGiftWithoutAttendance,
  sortWeddingGiftEntries,
  WEDDING_GIFT_SORTS,
  WEDDING_GIFT_SORT_LABELS,
  type WeddingGiftSort,
} from "@/domain/wedding-gift";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Badge, BadgeDot, type BadgeTone } from "@/components/ui/badge";
import { Button, SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter, useModalDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Stat, StatRow } from "@/components/ui/stat";
import { SearchInput, Toolbar } from "@/components/ui/toolbar";

const initialState: WeddingGiftMutationState = { status: "idle" };
const MAX_TWD_AMOUNT = 2_147_483_647;
const MAX_NOTES_CHARACTERS = 500;

const attendanceLabels: Record<GuestAttendanceStatusValue, string> = {
  UNDECIDED: "尚未確認",
  ATTENDING: "出席",
  DECLINED: "不出席",
};

const attendanceTones: Record<GuestAttendanceStatusValue, BadgeTone> = {
  UNDECIDED: "neutral",
  ATTENDING: "positive",
  DECLINED: "danger",
};

export type WeddingGiftBookGuest = {
  version?: number;
  giftExemptWithCake?: boolean;
  relationshipLabel?: string | null;
  id: string;
  name: string;
  category: GuestCategoryValue;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  weddingGift: (WeddingGiftMutationSnapshot & { createdAt?: Date }) | null;
  /** 報到紀錄優先於不出席回覆；尚未報到本身不代表缺席。 */
  checkIn?: { id: string } | null;
};

type GiftFilter =
  | "EXEMPT_WITH_CAKE"
  | "ALL"
  | "RECORDED"
  | "UNRECORDED_GENERAL"
  | "WITHOUT_ATTENDANCE";

type PendingGiftMutation =
  | { kind: "CREATE" | "UPDATE"; gift: WeddingGiftMutationSnapshot }
  | { kind: "DELETE"; gift: WeddingGiftMutationSnapshot };

type GiftFeedback = {
  message: string;
  revision: number;
};

type GiftEditorSelection =
  | {
      guestId: string;
      mode: "CREATE";
      guest: WeddingGiftBookGuest;
    }
  | {
      guestId: string;
      mode: "EDIT";
      guest: WeddingGiftBookGuest;
      gift: WeddingGiftMutationSnapshot;
      allowMissingLatest: boolean;
    };

type GiftDeleteSelection = {
  guestId: string;
  guest: WeddingGiftBookGuest;
  gift: WeddingGiftMutationSnapshot;
  allowMissingLatest: boolean;
};

function sameGift(
  left: WeddingGiftMutationSnapshot | null,
  right: WeddingGiftMutationSnapshot | null,
) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.id === right.id &&
      left.amount === right.amount &&
      left.notes === right.notes &&
      left.returnGiftNote === right.returnGiftNote &&
      String(left.returnGiftSentAt ?? "") ===
        String(right.returnGiftSentAt ?? "") &&
      left.version === right.version)
  );
}

function giftMapFromGuests(guests: readonly WeddingGiftBookGuest[]) {
  return Object.fromEntries(
    guests.map((guest) => [guest.id, guest.weddingGift]),
  ) as Record<string, WeddingGiftMutationSnapshot | null>;
}

function sameGiftMap(
  left: Record<string, WeddingGiftMutationSnapshot | null>,
  right: Record<string, WeddingGiftMutationSnapshot | null>,
) {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((guestId) => sameGift(left[guestId] ?? null, right[guestId] ?? null))
  );
}

function formatTwdAmount(decimalAmount: string) {
  const grouped = new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(BigInt(decimalAmount));
  return `NT$ ${grouped}`;
}

function giftSummary(guests: readonly WeddingGiftBookGuest[]) {
  let totalAmount = BigInt(0);
  let registeredGroups = 0;
  let unregisteredGeneralGroups = 0;

  for (const guest of guests) {
    if (guest.weddingGift) {
      totalAmount += BigInt(guest.weddingGift.amount);
      registeredGroups += 1;
    } else if (guest.category === "GUEST" && !guest.giftExemptWithCake) {
      unregisteredGeneralGroups += 1;
    }
  }

  return {
    totalAmount: totalAmount.toString(),
    registeredGroups,
    unregisteredGeneralGroups,
  };
}

function GiftFields({
  idPrefix,
  gift,
}: {
  idPrefix: string;
  gift?: WeddingGiftMutationSnapshot;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <Field
        htmlFor={`${idPrefix}-amount`}
        label="禮金金額"
        hint="請輸入新台幣正整數，最高 2,147,483,647 元。"
      >
        <Input
          id={`${idPrefix}-amount`}
          name="amount"
          type="number"
          min={1}
          max={MAX_TWD_AMOUNT}
          step={1}
          inputMode="numeric"
          required
          autoComplete="off"
          defaultValue={gift?.amount}
        />
      </Field>
      <Field
        htmlFor={`${idPrefix}-notes`}
        label="備註（選填）"
        hint="最多 500 個字元；可記錄代收人或信封辨識資訊，請避免填入不必要的個資。"
      >
        <Textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={4}
          maxLength={MAX_NOTES_CHARACTERS}
          defaultValue={gift?.notes ?? ""}
        />
      </Field>
    </div>
  );
}

function useSelectedGiftDialog({
  fallbackFocusId,
  onDismiss,
}: {
  fallbackFocusId: string;
  onDismiss: () => void;
}) {
  const {
    dialogRef,
    open,
    close,
    closeWithoutRestoringFocus,
    restoreFocus,
  } = useModalDialog({ fallbackFocusId });

  useEffect(() => {
    open();
  }, [open]);

  return {
    dialogRef,
    close,
    closeWithoutRestoringFocus,
    finishClose() {
      restoreFocus();
      onDismiss();
    },
  };
}

function CreateWeddingGiftDialog({
  workspaceId,
  guest,
  guestIsMissing,
  onDismiss,
  onSaved,
}: {
  workspaceId: string;
  guest: WeddingGiftBookGuest;
  guestIsMissing: boolean;
  onDismiss: () => void;
  onSaved: (
    guestId: string,
    gift: WeddingGiftMutationSnapshot,
    message: string,
  ) => void;
}) {
  const idPrefix = useId();
  const { dialogRef, close, closeWithoutRestoringFocus, finishClose } =
    useSelectedGiftDialog({
      fallbackFocusId: `gift-create-${guest.id}`,
      onDismiss,
    });
  const createAction = createWeddingGiftAction.bind(
    null,
    workspaceId,
    guest.id,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: WeddingGiftMutationState, formData: FormData) => {
      const nextState = await createAction(previousState, formData);
      if (nextState.status === "success" && nextState.gift) {
        onSaved(guest.id, nextState.gift, nextState.message);
        closeWithoutRestoringFocus();
      }
      return nextState;
    },
    initialState,
  );

  return (
    <Dialog
      dialogRef={dialogRef}
      titleId={`${idPrefix}-title`}
      eyebrow="禮金簿"
      title={`登記 ${guest.name} 的禮金`}
      description="禮金與出席狀態分開記錄；不出席的邀請群組也可以登記。"
      closeLabel={`關閉登記 ${guest.name} 的禮金`}
      isPending={isPending}
      onClose={close}
      onRestoreFocus={finishClose}
    >
      {guestIsMissing ? (
        <div className="mx-5 mt-5 rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption leading-6 text-caution sm:mx-6">
          這筆賓客已由其他人移除。目前保留草稿供確認，但不能送出。
        </div>
      ) : null}
      <form
        action={formAction}
        aria-label={`登記 ${guest.name} 的禮金表單`}
        onSubmit={(event) => {
          if (guestIsMissing) event.preventDefault();
        }}
      >
        <div className="space-y-5 px-5 py-6 sm:px-6">
          <GiftFields idPrefix={idPrefix} />
          <ActionFeedback state={state} />
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={isPending} onClick={close}>
            取消
          </Button>
          <SubmitButton
            isPending={isPending}
            pendingLabel="正在儲存…"
            disabled={guestIsMissing}
          >
            儲存禮金
          </SubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function giftSnapshotIsOutdated(
  current: WeddingGiftMutationSnapshot,
  latest: WeddingGiftMutationSnapshot | null,
  allowMissingLatest: boolean,
) {
  // Create 成功後，本地會先有 v0，舊 RSC props 仍可能是 null；只有在
  // pending CREATE 明確對得上時，null 才代表舊 RSC 而非 authoritative delete。
  if (!latest) return !allowMissingLatest;
  if (latest.id !== current.id) return true;
  if (latest.version !== current.version) {
    return latest.version > current.version;
  }
  return !sameGift(current, latest);
}

function EditWeddingGiftActionForm({
  workspaceId,
  guest,
  snapshot,
  onCancel,
  onSuccess,
  onPendingChange,
  submissionDisabled,
}: {
  workspaceId: string;
  guest: WeddingGiftBookGuest;
  snapshot: WeddingGiftMutationSnapshot;
  onCancel: () => void;
  onSuccess: (gift: WeddingGiftMutationSnapshot, message: string) => void;
  onPendingChange: (isPending: boolean) => void;
  submissionDisabled: boolean;
}) {
  const idPrefix = useId();
  const updateAction = updateWeddingGiftAction.bind(
    null,
    workspaceId,
    snapshot.id,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: WeddingGiftMutationState, formData: FormData) => {
      const nextState = await updateAction(previousState, formData);
      if (nextState.status === "success" && nextState.gift) {
        onSuccess(nextState.gift, nextState.message);
      }
      return nextState;
    },
    initialState,
  );

  useEffect(() => {
    onPendingChange(isPending);
  }, [isPending, onPendingChange]);

  return (
    <form
      action={formAction}
      aria-label={`編輯 ${guest.name} 的禮金表單`}
      onSubmit={(event) => {
        if (submissionDisabled) event.preventDefault();
      }}
    >
      <div className="space-y-5 px-5 py-6 sm:px-6">
        <input
          type="hidden"
          name="expectedVersion"
          value={snapshot.version}
        />
        <GiftFields idPrefix={idPrefix} gift={snapshot} />
        <ActionFeedback state={state} />
      </div>
      <DialogFooter>
        <Button variant="secondary" disabled={isPending} onClick={onCancel}>
          取消
        </Button>
        <SubmitButton
          isPending={isPending}
          pendingLabel="正在儲存…"
          disabled={submissionDisabled}
        >
          儲存變更
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

function EditWeddingGiftDialog({
  workspaceId,
  guest,
  guestIsMissing,
  gift,
  latestGift,
  allowMissingLatest,
  onDismiss,
  onSaved,
  onAcceptLatest,
}: {
  workspaceId: string;
  guest: WeddingGiftBookGuest;
  guestIsMissing: boolean;
  gift: WeddingGiftMutationSnapshot;
  latestGift: WeddingGiftMutationSnapshot | null;
  allowMissingLatest: boolean;
  onDismiss: () => void;
  onSaved: (
    guestId: string,
    gift: WeddingGiftMutationSnapshot,
    message: string,
  ) => void;
  onAcceptLatest: (
    guestId: string,
    gift: WeddingGiftMutationSnapshot,
  ) => void;
}) {
  const idPrefix = useId();
  const [snapshot, setSnapshot] = useState(gift);
  const [formGeneration, setFormGeneration] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const { dialogRef, close, closeWithoutRestoringFocus, finishClose } =
    useSelectedGiftDialog({
      fallbackFocusId: `gift-edit-${guest.id}`,
      onDismiss,
    });
  const isOutdated = giftSnapshotIsOutdated(
    snapshot,
    latestGift,
    allowMissingLatest,
  );
  const latestGiftWasRemoved = latestGift === null && !allowMissingLatest;
  const submissionDisabled = guestIsMissing || isOutdated;

  function loadLatestGift() {
    if (!latestGift) return;
    setSnapshot(latestGift);
    setFormGeneration((current) => current + 1);
    onAcceptLatest(guest.id, latestGift);
  }

  return (
    <Dialog
      dialogRef={dialogRef}
      titleId={`${idPrefix}-title`}
      eyebrow="禮金簿"
      title={`編輯 ${guest.name} 的禮金`}
      closeLabel={`關閉編輯 ${guest.name} 的禮金`}
      isPending={isPending}
      onClose={close}
      onRestoreFocus={finishClose}
    >
      {submissionDisabled ? (
        <div className="mx-5 mt-5 rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption leading-6 text-caution sm:mx-6">
          <p>
            {guestIsMissing
              ? "這筆賓客已由其他人移除。目前保留草稿供確認，但不能送出。"
              : latestGiftWasRemoved
              ? "這筆禮金已由其他人移除。目前仍保留你的草稿供確認，但不能再送出。"
              : "這筆禮金已有較新的資料，目前仍保留你原本的草稿與版本。"}
          </p>
          {!guestIsMissing && latestGift ? (
            <button
              type="button"
              onClick={loadLatestGift}
              className="mt-3 inline-flex min-h-11 items-center rounded-control border border-caution/40 px-4 font-semibold transition hover:bg-caution/10"
            >
              載入最新禮金資料
            </button>
          ) : null}
        </div>
      ) : null}
      <EditWeddingGiftActionForm
        key={formGeneration}
        workspaceId={workspaceId}
        guest={guest}
        snapshot={snapshot}
        onCancel={close}
        onPendingChange={setIsPending}
        submissionDisabled={submissionDisabled}
        onSuccess={(savedGift, message) => {
          setSnapshot(savedGift);
          setFormGeneration((current) => current + 1);
          onSaved(guest.id, savedGift, message);
          closeWithoutRestoringFocus();
        }}
      />
    </Dialog>
  );
}

function DeleteWeddingGiftDialog({
  workspaceId,
  guest,
  guestIsMissing,
  gift,
  latestGift,
  allowMissingLatest,
  onDismiss,
  onDeleted,
}: {
  workspaceId: string;
  guest: WeddingGiftBookGuest;
  guestIsMissing: boolean;
  gift: WeddingGiftMutationSnapshot;
  latestGift: WeddingGiftMutationSnapshot | null;
  allowMissingLatest: boolean;
  onDismiss: () => void;
  onDeleted: (
    guestId: string,
    gift: WeddingGiftMutationSnapshot,
    message: string,
  ) => void;
}) {
  const idPrefix = useId();
  const { dialogRef, close, closeWithoutRestoringFocus, finishClose } =
    useSelectedGiftDialog({
      fallbackFocusId: `gift-delete-${guest.id}`,
      onDismiss,
    });
  const deleteAction = deleteWeddingGiftAction.bind(
    null,
    workspaceId,
    gift.id,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: WeddingGiftMutationState, formData: FormData) => {
      const nextState = await deleteAction(previousState, formData);
      if (nextState.status === "success") {
        onDeleted(guest.id, gift, nextState.message);
        closeWithoutRestoringFocus();
      }
      return nextState;
    },
    initialState,
  );
  // 自己剛完成的 create/update 會先產生比舊 RSC props 更新的本地 snapshot；
  // 只有 authoritative props 真正前進時才停用刪除，不能把自己的成功狀態
  // 誤判成協作者更新。
  const isOutdated = giftSnapshotIsOutdated(
    gift,
    latestGift,
    allowMissingLatest,
  );
  const submissionDisabled = guestIsMissing || isOutdated;

  return (
    <Dialog
      dialogRef={dialogRef}
      titleId={`${idPrefix}-title`}
      eyebrow="移除禮金"
      title={`移除 ${guest.name} 的禮金`}
      closeLabel={`關閉移除 ${guest.name} 的禮金`}
      isPending={isPending}
      onClose={close}
      onRestoreFocus={finishClose}
      size="sm"
    >
      {submissionDisabled ? (
        <div className="mx-5 mt-5 rounded-control border border-caution/30 bg-caution-soft px-4 py-3 text-caption leading-6 text-caution sm:mx-6">
          {guestIsMissing
            ? "這筆賓客已由其他人移除，因此不能再移除這筆禮金。"
            : "這筆禮金已在其他地方更新或移除。為避免刪掉你尚未確認的新資料，請先關閉視窗，再重新確認最新內容。"}
        </div>
      ) : null}
      <form
        action={formAction}
        aria-label={`移除 ${guest.name} 的禮金表單`}
        onSubmit={(event) => {
          if (submissionDisabled) event.preventDefault();
        }}
      >
        <div className="space-y-3 px-5 py-6 sm:px-6">
          <input type="hidden" name="expectedVersion" value={gift.version} />
          <p className="text-sm font-semibold text-danger">
            此動作會永久移除這筆禮金紀錄。
          </p>
          <p className="text-caption leading-6 text-ink-soft">
            名單成員不會被刪除；若只需修正金額或備註，請改用編輯。
          </p>
          <ActionFeedback state={state} />
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={isPending} onClick={close}>
            取消
          </Button>
          <SubmitButton
            isPending={isPending}
            pendingLabel="正在移除…"
            variant="danger-solid"
            disabled={submissionDisabled}
          >
            確認移除禮金
          </SubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * 禮到人不到最常做的事就是「寄出去了，標一下」，所以做成一次點擊；
 * 回禮備註在編輯視窗裡填，這裡只切換狀態並保留既有備註。
 */
function ToggleGiftReturnForm({
  workspaceId,
  guest,
  gift,
  onSaved,
}: {
  workspaceId: string;
  guest: WeddingGiftBookGuest;
  gift: WeddingGiftMutationSnapshot;
  onSaved: (
    guestId: string,
    nextGift: WeddingGiftMutationSnapshot,
    message: string,
  ) => void;
}) {
  const alreadySent = gift.returnGiftSentAt !== null;
  const toggleAction = setWeddingGiftReturnAction.bind(
    null,
    workspaceId,
    gift.id,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: WeddingGiftMutationState, formData: FormData) => {
      const nextState = await toggleAction(previousState, formData);
      if (nextState.status === "success" && nextState.gift) {
        onSaved(guest.id, nextState.gift, nextState.message);
      }
      return nextState;
    },
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-label={
        alreadySent
          ? `改回 ${guest.name} 尚未回禮表單`
          : `標記 ${guest.name} 已回禮表單`
      }
      className="min-w-0"
    >
      <input type="hidden" name="expectedVersion" value={gift.version} />
      {alreadySent ? null : <input type="hidden" name="returnGiftSent" value="on" />}
      <input
        type="hidden"
        name="returnGiftNote"
        value={gift.returnGiftNote ?? ""}
      />
      <SubmitButton
        id={`gift-return-${guest.id}`}
        isPending={isPending}
        pendingLabel="更新中…"
        variant={alreadySent ? "ghost" : "secondary"}
        size="sm"
        className="min-h-11 sm:min-h-9"
      >
        {alreadySent ? "改回未回禮" : "標記已回禮"}
      </SubmitButton>
      {state.status === "error" ? (
        <ActionFeedback state={state} className="mt-2" />
      ) : null}
    </form>
  );
}

function GiftExemptionForm({ workspaceId, guest, onSaved }: {
  workspaceId: string;
  guest: WeddingGiftBookGuest;
  onSaved: (id: string, snapshot: GuestGiftExemptionSnapshot) => void;
}) {
  const [state, action, pending] = useActionState(
    setGuestGiftExemptionAction.bind(null, workspaceId, guest.id), initialState,
  );
  const saved = useRef(state);
  useEffect(() => {
    if (saved.current === state) return;
    saved.current = state;
    if (state.status === "success" && state.guest) onSaved(guest.id, state.guest);
  }, [state, guest.id, onSaved]);
  return <form action={action}>
    <input type="hidden" name="expectedVersion" value={guest.version ?? 0} />
    <input type="hidden" name="giftExemptWithCake" value={guest.giftExemptWithCake ? "off" : "on"} />
    <Button type="submit" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" disabled={pending}
      aria-label={guest.giftExemptWithCake ? `取消 ${guest.name} 的不收禮金、會送餅標記` : `標記 ${guest.name} 不收禮金、會送餅`}>
      {guest.giftExemptWithCake ? "取消不收禮金標記" : "不收禮金、會送餅"}
    </Button>
    <ActionFeedback state={state} />
  </form>;
}

export function WeddingGiftBook({
  workspaceId,
  guests,
  canEdit,
  defaultExpanded = false,
  collapsible = true,
}: {
  workspaceId: string;
  guests: WeddingGiftBookGuest[];
  canEdit: boolean;
  defaultExpanded?: boolean;
  /** 禮金有自己的頁面之後，那一頁不需要再收合一次。 */
  collapsible?: boolean;
}) {
  const [exemptions, setExemptions] = useState<Record<string, GuestGiftExemptionSnapshot>>({});
  const contentId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded || !collapsible);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<GiftFilter>("ALL");
  const [sort, setSort] = useState<WeddingGiftSort>("ROSTER");
  const [feedback, setFeedback] = useState<GiftFeedback | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [editorSelection, setEditorSelection] =
    useState<GiftEditorSelection | null>(null);
  const [deleteSelection, setDeleteSelection] =
    useState<GiftDeleteSelection | null>(null);
  const pendingMutations = useRef(new Map<string, PendingGiftMutation>());
  const [giftByGuestId, setGiftByGuestId] = useState(() =>
    giftMapFromGuests(guests),
  );

  const serverGiftByGuestId = useMemo(
    () => giftMapFromGuests(guests),
    [guests],
  );

  useEffect(() => {
    const next: Record<string, WeddingGiftMutationSnapshot | null> = {};
    const currentGuestIds = new Set(guests.map((guest) => guest.id));
    const authoritativeMissingGiftGuestIds = new Set<string>();

    for (const guest of guests) {
      const latest = guest.weddingGift;
      const pending = pendingMutations.current.get(guest.id);

      if (pending?.kind === "CREATE" || pending?.kind === "UPDATE") {
        if (sameGift(pending.gift, latest)) {
          pendingMutations.current.delete(guest.id);
          next[guest.id] = latest;
        } else if (
          latest !== null &&
          (latest.id !== pending.gift.id ||
            latest.version > pending.gift.version)
        ) {
          // 自己送出成功後，若 authoritative RSC 已經出現另一筆資料，
          // 或同一筆有更高版本，代表協作者後來又更新過。財務總額與清單
          // 必須立即採用最新版，不能長時間保留自己的舊成功快照。
          pendingMutations.current.delete(guest.id);
          next[guest.id] = latest;
        } else if (latest === null) {
          // pending mutation 建立後，只有下一個新的 guests props 才會觸發
          // 這個 effect；若該 authoritative generation 仍是 null，就不能
          // 永久保留本地 create/update 造成的財務幽靈紀錄。
          pendingMutations.current.delete(guest.id);
          authoritativeMissingGiftGuestIds.add(guest.id);
          next[guest.id] = null;
        } else {
          // 同一筆較低版本是較舊的 RSC payload，暫時保留自己的成功 snapshot。
          next[guest.id] = pending.gift;
        }
        continue;
      }

      if (pending?.kind === "DELETE") {
        if (latest === null) {
          pendingMutations.current.delete(guest.id);
          next[guest.id] = null;
        } else if (
          latest.id === pending.gift.id &&
          latest.version <= pending.gift.version
        ) {
          // Delete 已成功；這只是刪除前的舊 RSC snapshot。
          next[guest.id] = null;
        } else {
          // 刪除後若真的出現另一筆 authoritative gift，不應永遠藏住。
          pendingMutations.current.delete(guest.id);
          next[guest.id] = latest;
        }
        continue;
      }

      next[guest.id] = latest;
    }

    for (const guestId of pendingMutations.current.keys()) {
      if (!currentGuestIds.has(guestId)) {
        pendingMutations.current.delete(guestId);
      }
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setGiftByGuestId((current) =>
        sameGiftMap(current, next) ? current : next,
      );
      if (authoritativeMissingGiftGuestIds.size > 0) {
        setEditorSelection((current) =>
          current?.mode === "EDIT" &&
          authoritativeMissingGiftGuestIds.has(current.guestId)
            ? { ...current, allowMissingLatest: false }
            : current,
        );
        setDeleteSelection((current) =>
          current && authoritativeMissingGiftGuestIds.has(current.guestId)
            ? { ...current, allowMissingLatest: false }
            : current,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [guests]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  useEffect(() => {
    if (!collapsible) return;
    function revealGiftLedgerFromHash() {
      if (window.location.hash === "#gift-ledger") setExpanded(true);
    }

    revealGiftLedgerFromHash();
    window.addEventListener("hashchange", revealGiftLedgerFromHash);
    return () =>
      window.removeEventListener("hashchange", revealGiftLedgerFromHash);
  }, [collapsible]);

  const ledgerGuests = useMemo(
    () =>
      guests.map((guest) => ({
        ...guest,
        ...(exemptions[guest.id] && exemptions[guest.id].version > (guest.version ?? 0) ? exemptions[guest.id] : {}),
        weddingGift:
          Object.prototype.hasOwnProperty.call(giftByGuestId, guest.id)
            ? giftByGuestId[guest.id] ?? null
            : guest.weddingGift,
      })),
    [giftByGuestId, guests, exemptions],
  );
  const summary = useMemo(() => giftSummary(ledgerGuests), [ledgerGuests]);
  const returnPendingCount = useMemo(
    () =>
      ledgerGuests.filter((guest) =>
        isWeddingGiftReturnPending({
          attendanceStatus: guest.attendanceStatus,
          weddingGift: guest.weddingGift,
          checkIn: guest.checkIn ?? null,
        }),
      ).length,
    [ledgerGuests],
  );
  const filteredGuests = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("zh-TW");
    const matched = ledgerGuests.filter((guest) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        guest.name.toLocaleLowerCase("zh-TW").includes(normalizedSearch);
      if (!matchesSearch) return false;
      if (filter === "ALL") return true;
      if (filter === "EXEMPT_WITH_CAKE") return !!guest.giftExemptWithCake;
      if (filter === "RECORDED") return guest.weddingGift !== null;
      if (filter === "WITHOUT_ATTENDANCE") {
        return isWeddingGiftWithoutAttendance({
          attendanceStatus: guest.attendanceStatus,
          weddingGift: guest.weddingGift,
          checkIn: guest.checkIn ?? null,
        });
      }
      return guest.category === "GUEST" && !guest.giftExemptWithCake && guest.weddingGift === null;
    });
    return sortWeddingGiftEntries(matched, sort);
  }, [filter, ledgerGuests, search, sort]);
  const hasActiveFilter =
    search.trim().length > 0 || filter !== "ALL" || sort !== "ROSTER";
  const resultLabel = hasActiveFilter
    ? `符合 ${filteredGuests.length} / ${ledgerGuests.length} 組`
    : `顯示 ${filteredGuests.length} / ${ledgerGuests.length} 組`;
  const selectedEditorGuest = editorSelection?.guest ?? null;
  const selectedDeleteGuest = deleteSelection?.guest ?? null;
  const editorGuestIsMissing =
    editorSelection !== null &&
    !guests.some((guest) => guest.id === editorSelection.guestId);
  const deleteGuestIsMissing =
    deleteSelection !== null &&
    !guests.some((guest) => guest.id === deleteSelection.guestId);

  function clearFilters() {
    setSearch("");
    setFilter("ALL");
    setSort("ROSTER");
  }

  function recordSavedGift(
    mutationKind: "CREATE" | "UPDATE",
    guestId: string,
    gift: WeddingGiftMutationSnapshot,
    message: string,
  ) {
    const pendingKind =
      mutationKind === "UPDATE" && serverGiftByGuestId[guestId] === null
        ? "CREATE"
        : mutationKind;
    pendingMutations.current.set(guestId, { kind: pendingKind, gift });
    setGiftByGuestId((current) => ({ ...current, [guestId]: gift }));
    setFeedback((current) => ({
      message,
      revision: (current?.revision ?? 0) + 1,
    }));
  }

  function recordDeletedGift(
    guestId: string,
    gift: WeddingGiftMutationSnapshot,
    message: string,
  ) {
    pendingMutations.current.set(guestId, { kind: "DELETE", gift });
    setGiftByGuestId((current) => ({ ...current, [guestId]: null }));
    setFeedback((current) => ({
      message,
      revision: (current?.revision ?? 0) + 1,
    }));
  }

  function acceptLatestGift(
    guestId: string,
    gift: WeddingGiftMutationSnapshot,
  ) {
    pendingMutations.current.delete(guestId);
    setGiftByGuestId((current) => ({ ...current, [guestId]: gift }));
  }

  return (
    <section
      id="gift-ledger"
      aria-labelledby={`${contentId}-heading`}
      className="mt-5 min-w-0"
    >
      {feedback ? (
        <p
          ref={feedbackRef}
          key={feedback.revision}
          tabIndex={-1}
          role="status"
          className="mb-4 rounded-control border border-positive/30 bg-positive-soft px-3.5 py-2.5 text-caption leading-6 text-positive outline-none"
        >
          {feedback.message}
        </p>
      ) : null}
      <Card>
        <div className="px-5 py-5 sm:px-6">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2
                id={`${contentId}-heading`}
                className="font-serif text-title font-semibold text-ink"
              >
                禮金簿
              </h2>
              <p className="mt-1 text-caption leading-6 text-ink-soft">
                每個邀請群組最多一筆；禮金不屬於婚宴支出，也不受出席狀態影響。
                爸媽請客的親友可逐位點選「不收禮金、會送餅」，紙本禮金簿會排除該位親友，發餅名單仍依出席狀態保留。新人、雙方父母與親兄弟姊妹也不開放新增禮金登記。
              </p>
              <p className="mt-0.5 text-caption leading-6 text-ink-faint">
                新人與家人不列入「一般賓客未有紀錄」統計，但既有紀錄仍會保留並顯示。
              </p>
            </div>
            {collapsible ? (
              <Button
                variant="secondary"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => setExpanded((current) => !current)}
                className="w-full sm:w-auto"
              >
                {expanded ? "收合禮金簿" : "展開禮金簿"}
              </Button>
            ) : null}
          </div>

          <StatRow className="mt-5 sm:grid-cols-4">
            <Stat
              label="禮金總額"
              value={
                <span title={formatTwdAmount(summary.totalAmount)}>
                  {formatTwdAmount(summary.totalAmount)}
                </span>
              }
              hint="以新台幣彙總"
              tone="brand"
            />
            <Stat
              label="已登記組數"
              value={summary.registeredGroups}
              unit="組"
              hint={`全部 ${ledgerGuests.length} 組名單`}
              tone="positive"
            />
            <Stat
              label="一般賓客未有紀錄"
              value={summary.unregisteredGeneralGroups}
              unit="組"
              hint="僅表示目前沒有紀錄，不代表應送禮。"
              tone="neutral"
            />
            <Stat
              label="待回禮"
              value={returnPendingCount}
              unit="組"
              hint="禮到人不到且尚未回禮"
              tone={returnPendingCount > 0 ? "caution" : "neutral"}
            />
          </StatRow>
        </div>

        <div
          id={contentId}
          hidden={!expanded}
          className="border-t border-line px-5 py-5 sm:px-6"
        >
            <Toolbar className="mb-4">
              <SearchInput
                label="搜尋禮金簿名單"
                placeholder="搜尋姓名"
                value={search}
                onChange={setSearch}
              />
              <Select
                aria-label="禮金登記狀態篩選"
                value={filter}
                onChange={(event) => setFilter(event.target.value as GiftFilter)}
                className="sm:w-auto"
              >
                <option value="ALL">全部邀請群組</option>
                <option value="EXEMPT_WITH_CAKE">不收禮金、會送餅</option>
                <option value="RECORDED">已登記</option>
                <option value="UNRECORDED_GENERAL">未有紀錄的一般賓客</option>
                <option value="WITHOUT_ATTENDANCE">禮到人不到</option>
              </Select>
              <Select
                aria-label="禮金簿排序"
                value={sort}
                onChange={(event) =>
                  setSort(
                    isWeddingGiftSort(event.target.value)
                      ? event.target.value
                      : "ROSTER",
                  )
                }
                className="sm:w-auto"
              >
                {WEDDING_GIFT_SORTS.map((option) => (
                  <option key={option} value={option}>
                    {WEDDING_GIFT_SORT_LABELS[option]}
                  </option>
                ))}
              </Select>
              <div className="flex min-h-11 min-w-0 items-center gap-3 sm:ml-auto">
                <p
                  aria-live="polite"
                  className="text-caption text-ink-soft tabular-nums sm:whitespace-nowrap"
                >
                  {resultLabel}
                </p>
                {hasActiveFilter && filteredGuests.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    清除禮金簿篩選
                  </Button>
                ) : null}
              </div>
            </Toolbar>

            {ledgerGuests.length === 0 ? (
              <EmptyState
                title="禮金簿目前沒有邀請群組。"
                description="先新增名單後即可登記禮金。"
              />
            ) : filteredGuests.length === 0 ? (
              <EmptyState
                title="找不到符合條件的邀請群組。"
                description="調整搜尋關鍵字、登記狀態或排序，就能找回其他名單。"
                action={
                  <Button onClick={clearFilters}>清除禮金簿篩選</Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-card border border-line">
                <ul className="min-w-0 divide-y divide-line bg-surface">
                  {filteredGuests.map((guest) => {
                    const gift = guest.weddingGift;
                    const withoutAttendance = isWeddingGiftWithoutAttendance({
                      attendanceStatus: guest.attendanceStatus,
                      weddingGift: gift,
                      checkIn: guest.checkIn ?? null,
                    });
                    return (
                      <li key={guest.id} className="min-w-0">
                        <article className="grid min-w-0 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto] sm:items-center sm:px-5">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <h3 className="min-w-0 font-serif text-body font-semibold break-words text-ink">
                                {guest.name}
                              </h3>
                              <Badge tone={attendanceTones[guest.attendanceStatus]}>
                                <BadgeDot />
                                {attendanceLabels[guest.attendanceStatus]}
                              </Badge>
                              {guest.giftExemptWithCake ? <Badge tone="sage">不收禮金・會送餅</Badge> : null}
                              {guest.category !== "GUEST" ? (
                                <Badge tone={guest.category === "COUPLE" ? "brand" : "sage"}>
                                  {GUEST_CATEGORY_LABELS[guest.category]}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-caption text-ink-soft">
                              {guestIdentityLabel(guest.category, guest.side)}
                            </p>
                            {gift?.notes ? (
                              <p className="mt-1 text-caption leading-6 whitespace-pre-wrap break-words text-ink-soft">
                                {gift.notes}
                              </p>
                            ) : null}
                            {withoutAttendance ? (
                              <p className="mt-1 text-caption font-semibold text-caution">
                                {gift?.returnGiftSentAt
                                  ? `禮到人不到・已回禮${
                                      gift.returnGiftNote
                                        ? `（${gift.returnGiftNote}）`
                                        : ""
                                    }`
                                  : "禮到人不到・待回禮回喜餅"}
                              </p>
                            ) : null}
                          </div>

                          <div className="min-w-0 sm:text-right">
                            {gift ? (
                              <p className="font-serif text-xl font-semibold break-words tabular-nums text-clay-strong">
                                {formatTwdAmount(String(gift.amount))}
                              </p>
                            ) : (
                              <p className="text-caption font-semibold text-ink-faint">
                                {isGiftCollectionExcluded(guest) ? "不收禮金" : guest.category === "GUEST"
                                  ? "未有禮金紀錄"
                                  : "未有禮金紀錄（不列入一般賓客統計）"}
                              </p>
                            )}
                          </div>

                          {canEdit ? (
                            <div className="flex min-w-0 flex-wrap gap-1 sm:justify-end">
                              <GiftExemptionForm workspaceId={workspaceId} guest={guest} onSaved={(id, snapshot) => setExemptions((current) => ({ ...current, [id]: snapshot }))} />
                              {gift ? (
                                <>
                                  <Button
                                    id={`gift-edit-${guest.id}`}
                                    variant="ghost"
                                    size="sm"
                                    className="min-h-11 sm:min-h-9"
                                    aria-label={`編輯 ${guest.name} 的禮金`}
                                    onClick={() => {
                                      const pending =
                                        pendingMutations.current.get(guest.id);
                                      setEditorSelection({
                                        guestId: guest.id,
                                        mode: "EDIT",
                                        guest,
                                        gift,
                                        allowMissingLatest:
                                          pending?.kind === "CREATE" &&
                                          sameGift(pending.gift, gift),
                                      });
                                    }}
                                  >
                                    編輯
                                  </Button>
                                  <Button
                                    id={`gift-delete-${guest.id}`}
                                    variant="danger"
                                    size="sm"
                                    className="min-h-11 sm:min-h-9"
                                    aria-label={`移除 ${guest.name} 的禮金`}
                                    onClick={() => {
                                      const pending =
                                        pendingMutations.current.get(guest.id);
                                      setDeleteSelection({
                                        guestId: guest.id,
                                        guest,
                                        gift,
                                        allowMissingLatest:
                                          pending?.kind === "CREATE" &&
                                          sameGift(pending.gift, gift),
                                      });
                                    }}
                                  >
                                    移除
                                  </Button>
                                  {withoutAttendance ? (
                                    <ToggleGiftReturnForm
                                      workspaceId={workspaceId}
                                      guest={guest}
                                      gift={gift}
                                      onSaved={(guestId, nextGift, message) =>
                                        recordSavedGift(
                                          "UPDATE",
                                          guestId,
                                          nextGift,
                                          message,
                                        )
                                      }
                                    />
                                  ) : null}
                                </>
                              ) : !isGiftCollectionExcluded(guest) ? (
                                <Button
                                  id={`gift-create-${guest.id}`}
                                  variant="secondary"
                                  size="sm"
                                  className="min-h-11 sm:min-h-9"
                                  aria-label={`登記 ${guest.name} 的禮金`}
                                  onClick={() =>
                                    setEditorSelection({
                                      guestId: guest.id,
                                      mode: "CREATE",
                                      guest,
                                    })
                                  }
                                >
                                  登記禮金
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
        </div>
      </Card>

      {editorSelection?.mode === "CREATE" && selectedEditorGuest && !isGiftCollectionExcluded(selectedEditorGuest) ? (
        <CreateWeddingGiftDialog
          workspaceId={workspaceId}
          guest={selectedEditorGuest}
          guestIsMissing={editorGuestIsMissing}
          onDismiss={() => setEditorSelection(null)}
          onSaved={(guestId, gift, message) =>
            recordSavedGift("CREATE", guestId, gift, message)
          }
        />
      ) : null}
      {editorSelection?.mode === "EDIT" && selectedEditorGuest ? (
        <EditWeddingGiftDialog
          workspaceId={workspaceId}
          guest={selectedEditorGuest}
          guestIsMissing={editorGuestIsMissing}
          gift={editorSelection.gift}
          latestGift={serverGiftByGuestId[selectedEditorGuest.id] ?? null}
          allowMissingLatest={editorSelection.allowMissingLatest}
          onDismiss={() => setEditorSelection(null)}
          onSaved={(guestId, gift, message) =>
            recordSavedGift("UPDATE", guestId, gift, message)
          }
          onAcceptLatest={acceptLatestGift}
        />
      ) : null}
      {deleteSelection && selectedDeleteGuest ? (
        <DeleteWeddingGiftDialog
          workspaceId={workspaceId}
          guest={selectedDeleteGuest}
          guestIsMissing={deleteGuestIsMissing}
          gift={deleteSelection.gift}
          latestGift={
            serverGiftByGuestId[deleteSelection.guestId] ?? null
          }
          allowMissingLatest={deleteSelection.allowMissingLatest}
          onDismiss={() => setDeleteSelection(null)}
          onDeleted={recordDeletedGift}
        />
      ) : null}
    </section>
  );
}
