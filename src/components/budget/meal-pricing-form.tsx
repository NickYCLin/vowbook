"use client";

import { useActionState } from "react";
import { updateWeddingMealPricingAction } from "@/actions/wedding-meal-pricing";
import type { WeddingMealPricingMutationState } from "@/actions/wedding-meal-pricing";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Button } from "@/components/ui/button";

const initialState: WeddingMealPricingMutationState = { status: "idle" };

function Field({
  id,
  label,
  suffix,
  defaultValue,
  placeholder,
}: {
  id: string;
  label: string;
  suffix: string;
  defaultValue: number | null;
  placeholder: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs text-ink-faint">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          id={id}
          name={id}
          type="text"
          inputMode="numeric"
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          className="min-h-11 w-full min-w-0 rounded-control border border-line px-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
        />
        <span className="shrink-0 text-xs text-ink-faint">{suffix}</span>
      </div>
    </div>
  );
}

export function MealPricingForm({
  workspaceId,
  staffMealUnitPrice,
  vegetarianMealUnitPrice,
  serviceChargePercent,
}: {
  workspaceId: string;
  staffMealUnitPrice: number | null;
  vegetarianMealUnitPrice: number | null;
  serviceChargePercent: number;
}) {
  const [state, formAction, pending] = useActionState(
    updateWeddingMealPricingAction.bind(null, workspaceId),
    initialState,
  );
  return (
    <form action={formAction} className="mt-3 min-w-0">
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <Field
          id="staffMealUnitPrice"
          label="工作人員便當單價"
          suffix="元／份"
          defaultValue={staffMealUnitPrice}
          placeholder="尚未設定"
        />
        <Field
          id="vegetarianMealUnitPrice"
          label="素食套餐單價"
          suffix="元／位"
          defaultValue={vegetarianMealUnitPrice}
          placeholder="尚未設定"
        />
        <Field
          id="serviceChargePercent"
          label="服務費"
          suffix="%"
          defaultValue={serviceChargePercent}
          placeholder="0"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "儲存中…" : "儲存單價"}
        </Button>
        {state.status === "idle" ? null : (
          <ActionFeedback state={state} />
        )}
      </div>
    </form>
  );
}
