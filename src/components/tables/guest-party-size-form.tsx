"use client";

import { useActionState, useId, useState } from "react";
import {
  updateGuestAction,
  type GuestMutationState,
} from "@/actions/guests";
import type {
  GuestAttendanceStatusValue,
  GuestCategoryValue,
  GuestSeniorityValue,
  GuestSideValue,
} from "@/domain/guest";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { SubmitButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

const initialState: GuestMutationState = { status: "idle" };

export type UnassignedSeatingGuest = {
  id: string;
  name: string;
  category: GuestCategoryValue;
  seniority: GuestSeniorityValue;
  partySize: number;
  version: number;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  notes: string | null;
  vegetarianCount?: number | null;
};

type GuestPartySizeSubmissionSnapshot = UnassignedSeatingGuest & {
  workspaceId: string;
};

function createGuestPartySizeSubmissionSnapshot(
  workspaceId: string,
  guest: UnassignedSeatingGuest,
): GuestPartySizeSubmissionSnapshot {
  return { workspaceId, ...guest };
}

function isSameGuestPartySizeSubmissionSnapshot(
  current: GuestPartySizeSubmissionSnapshot,
  latest: GuestPartySizeSubmissionSnapshot,
): boolean {
  return (
    current.workspaceId === latest.workspaceId &&
    current.id === latest.id &&
    current.name === latest.name &&
    current.category === latest.category &&
    current.seniority === latest.seniority &&
    current.partySize === latest.partySize &&
    current.version === latest.version &&
    current.side === latest.side &&
    current.attendanceStatus === latest.attendanceStatus &&
    current.notes === latest.notes
  );
}

function isGuestPartySizeSubmissionSnapshotOutdated(
  current: GuestPartySizeSubmissionSnapshot,
  latest: GuestPartySizeSubmissionSnapshot,
): boolean {
  if (
    current.workspaceId !== latest.workspaceId ||
    current.id !== latest.id
  ) {
    return true;
  }
  if (latest.version !== current.version) {
    // 自己剛寫入成功時，本地 CAS 會暫時領先仍未刷新的 RSC props。
    return latest.version > current.version;
  }
  return !isSameGuestPartySizeSubmissionSnapshot(current, latest);
}

/**
 * 未安排賓客的人數就地編輯。
 * 不必為了改一個數字切到賓客名單頁，改完再切回來重新找一次人。
 */
export function EditGuestPartySizeForm({
  workspaceId,
  guest,
}: {
  workspaceId: string;
  guest: UnassignedSeatingGuest;
}) {
  const inputId = useId();
  const latestSnapshot = createGuestPartySizeSubmissionSnapshot(
    workspaceId,
    guest,
  );
  const [snapshot, setSnapshot] = useState(() => latestSnapshot);
  const [draft, setDraft] = useState(String(snapshot.partySize));
  const [hideActionFeedback, setHideActionFeedback] = useState(false);
  const snapshotIsOutdated = isGuestPartySizeSubmissionSnapshotOutdated(
    snapshot,
    latestSnapshot,
  );
  const updateAction = updateGuestAction.bind(
    null,
    snapshot.workspaceId,
    snapshot.id,
  );
  const [state, formAction, isPending] = useActionState(
    async (previousState: GuestMutationState, formData: FormData) => {
      setHideActionFeedback(false);
      const nextState = await updateAction(previousState, formData);
      if (nextState.status === "success") {
        const committedPartySize = Number(formData.get("partySize"));
        const submittedVersion = Number(formData.get("expectedVersion"));
        setSnapshot((current) => ({
          ...current,
          partySize: committedPartySize,
          version: submittedVersion + 1,
        }));
        setDraft(String(committedPartySize));
      }
      return nextState;
    },
    initialState,
  );

  function loadLatestSnapshot() {
    setSnapshot(latestSnapshot);
    setDraft(String(latestSnapshot.partySize));
    setHideActionFeedback(true);
  }

  const newerSnapshotNotice = snapshotIsOutdated ? (
    <div
      role="alert"
      className="mt-2 rounded-control border border-caution/30 bg-caution-soft px-3 py-2 text-caption leading-6 text-caution"
    >
      <p>這筆賓客已有較新的資料，目前仍保留原本的人數草稿與版本。</p>
      <button
        type="button"
        disabled={isPending}
        onClick={loadLatestSnapshot}
        className="mt-2 inline-flex min-h-11 items-center rounded-control border border-caution/40 px-3 font-semibold transition hover:bg-caution/10 disabled:cursor-wait disabled:opacity-60"
      >
        載入最新資料
      </button>
    </div>
  ) : null;

  if (snapshot.category === "COUPLE") {
    return (
      <div className="mt-2 min-w-0">
        <p className="text-caption text-ink-faint">
          名單人數 1 位・新人一人一筆
        </p>
        {newerSnapshotNotice}
      </div>
    );
  }

  const isDirty = draft.trim() !== String(snapshot.partySize);

  return (
    <form
      action={formAction}
      className="mt-2 min-w-0"
      onSubmit={(event) => {
        if (snapshotIsOutdated) event.preventDefault();
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
        {/*
          可及性名稱要帶賓客姓名（同一頁有很多個），但畫面上只需要短短兩個字，
          否則沒人看得出這個數字框是做什麼的。
        */}
        <label htmlFor={inputId} className="sr-only">
          {snapshot.name}的邀請人數（含本人）
        </label>
        <span aria-hidden="true" className="text-caption text-ink-soft">
          邀請人數
        </span>
        {/* 寬度靠外層容器控制：Input 自帶 w-full，同層加 w-* 會被蓋掉。 */}
        <div className="w-20 shrink-0">
          <Input
            id={inputId}
            name="partySize"
            type="number"
            required
            min={1}
            max={20}
            step={1}
            inputMode="numeric"
            value={draft}
            disabled={isPending}
            onChange={(event) => setDraft(event.target.value)}
            className="px-2 text-center tabular-nums"
          />
        </div>
        <span aria-hidden="true" className="text-caption text-ink-soft">
          位
        </span>
        {/*
          按鈕一直在，只是沒改動時停用。
          之前是改了才出現，結果整個控制項看起來不像可以存檔。
        */}
        <SubmitButton
          isPending={isPending}
          pendingLabel="更新中…"
          variant="secondary"
          disabled={!isDirty || snapshotIsOutdated}
          aria-label={`更新${snapshot.name}的邀請人數`}
        >
          更新
        </SubmitButton>
      </div>

      {/*
        updateGuestAction 要求整筆賓客內容與 CAS 版本，這裡只改人數，
        其餘欄位原樣帶回；版本不符時伺服器會擋下並要求重新整理。
      */}
      <input type="hidden" name="name" value={snapshot.name} />
      <input type="hidden" name="category" value={snapshot.category} />
      <input type="hidden" name="seniority" value={snapshot.seniority} />
      <input type="hidden" name="side" value={snapshot.side} />
      <input
        type="hidden"
        name="attendanceStatus"
        value={snapshot.attendanceStatus}
      />
      <input type="hidden" name="notes" value={snapshot.notes ?? ""} />
      <input type="hidden" name="expectedVersion" value={snapshot.version} />

      {newerSnapshotNotice}

      {hideActionFeedback || isPending || snapshotIsOutdated ? null : (
        <ActionFeedback state={state} className="mt-2" />
      )}
    </form>
  );
}
