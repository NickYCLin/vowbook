"use client";

import { useActionState, useId } from "react";
import {
  createWorkspaceAction,
  type CreateWorkspaceState,
} from "@/actions/workspaces";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const initialState: CreateWorkspaceState = { status: "idle" };

export function CreateWorkspaceForm({ className }: { className?: string }) {
  const idPrefix = useId();
  const [state, formAction, isPending] = useActionState(
    createWorkspaceAction,
    initialState,
  );

  return (
    <form action={formAction} className={className ?? "space-y-6"} noValidate>
      <Field
        htmlFor={`${idPrefix}-name`}
        label="婚宴名稱"
        hint="例如：小林與小陳的婚宴"
      >
        <Input
          id={`${idPrefix}-name`}
          name="name"
          type="text"
          required
          minLength={2}
          maxLength={80}
          autoComplete="off"
          aria-describedby={`${idPrefix}-name-hint`}
          placeholder="小林與小陳的婚宴"
        />
      </Field>

      <Field
        htmlFor={`${idPrefix}-wedding-date`}
        label="婚宴日期"
        optional
        hint="可以稍後再決定，設定後 dashboard 會顯示倒數天數。"
      >
        <Input
          id={`${idPrefix}-wedding-date`}
          name="weddingDate"
          type="date"
        />
      </Field>

      <input type="hidden" name="timezone" value="Asia/Taipei" />

      <ActionFeedback state={state} />

      <SubmitButton
        isPending={isPending}
        pendingLabel="正在建立…"
        size="lg"
        className="w-full"
      >
        建立婚宴工作區
      </SubmitButton>
    </form>
  );
}
