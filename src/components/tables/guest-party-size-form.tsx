"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  updateGuestAction,
  type GuestMutationState,
} from "@/actions/guests";
import type {
  GuestAttendanceStatusValue,
  GuestCategoryValue,
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
  partySize: number;
  version: number;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  notes: string | null;
  partySizeManaged: boolean;
};

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
  const updateAction = updateGuestAction.bind(null, workspaceId, guest.id);
  const [state, formAction, isPending] = useActionState(
    updateAction,
    initialState,
  );
  const [draft, setDraft] = useState(String(guest.partySize));
  const syncedVersionRef = useRef(guest.version);

  useEffect(() => {
    // 只有伺服器寫出新版本時才覆蓋草稿，避免打到一半被重新整理蓋掉。
    if (syncedVersionRef.current === guest.version) return;
    syncedVersionRef.current = guest.version;
    setDraft(String(guest.partySize));
  }, [guest.partySize, guest.version]);

  if (guest.category !== "GUEST") {
    return (
      <p className="mt-2 text-caption text-ink-faint">
        名單人數 1 位・新人與家人一人一筆
      </p>
    );
  }

  if (guest.partySizeManaged) {
    return (
      <p className="mt-2 text-caption text-ink-faint">
        邀請人數 {guest.partySize} 位・由匯入來源維護
      </p>
    );
  }

  const isDirty = draft.trim() !== String(guest.partySize);

  return (
    <form action={formAction} className="mt-2 min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
        {/*
          可及性名稱要帶賓客姓名（同一頁有很多個），但畫面上只需要短短兩個字，
          否則沒人看得出這個數字框是做什麼的。
        */}
        <label htmlFor={inputId} className="sr-only">
          {guest.name}的邀請人數（含本人）
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
          disabled={!isDirty}
          aria-label={`更新${guest.name}的邀請人數`}
        >
          更新
        </SubmitButton>
      </div>

      {/*
        updateGuestAction 要求整筆賓客內容與 CAS 版本，這裡只改人數，
        其餘欄位原樣帶回；版本不符時伺服器會擋下並要求重新整理。
      */}
      <input type="hidden" name="name" value={guest.name} />
      <input type="hidden" name="category" value={guest.category} />
      <input type="hidden" name="side" value={guest.side} />
      <input
        type="hidden"
        name="attendanceStatus"
        value={guest.attendanceStatus}
      />
      <input type="hidden" name="notes" value={guest.notes ?? ""} />
      <input type="hidden" name="expectedVersion" value={guest.version} />

      <ActionFeedback state={state} className="mt-2" />
    </form>
  );
}
