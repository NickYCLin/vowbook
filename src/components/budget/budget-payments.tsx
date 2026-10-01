"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  addBudgetPaymentAction,
  deleteBudgetPaymentAction,
  updateBudgetPaymentAction,
  type BudgetItemMutationState,
} from "@/actions/budget-items";
import {
  BUDGET_BALANCE_PAYMENT_METHOD_LABELS,
  BUDGET_BALANCE_PAYMENT_METHOD_OPTIONS,
  formatTwdAmount,
  type BudgetBalancePaymentMethod,
  type BudgetBookingStatus,
} from "@/domain/budget-item";
import {
  budgetBalanceTotal,
  budgetRemainingBalance,
  type BudgetPaymentRecord,
} from "@/domain/budget-payment";

const initialState: BudgetItemMutationState = { status: "idle" };

const fieldClassName =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-ink shadow-inner outline-none transition focus:border-clay";

type BudgetPaymentsProps = {
  workspaceId: string;
  itemId: string;
  itemName: string;
  expectedVersion: number;
  bookingStatus: BudgetBookingStatus;
  balanceAmount: number | null;
  additionalAmount: number | null;
  balancePaymentMethod: BudgetBalancePaymentMethod | null;
  payments: readonly BudgetPaymentRecord[];
  canEdit: boolean;
  today: string | null;
  onPendingChange?: (pending: boolean) => void;
};

function methodLabel(method: BudgetBalancePaymentMethod | null): string | null {
  return method === null ? null : BUDGET_BALANCE_PAYMENT_METHOD_LABELS[method];
}

function StatusMessage({ state }: { state: BudgetItemMutationState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        "text-sm " +
        (state.status === "error" ? "text-danger" : "text-positive")
      }
    >
      {state.message}
    </p>
  );
}

function DeletePaymentButton({
  workspaceId,
  itemId,
  payment,
  expectedVersion,
  onPendingChange,
}: {
  workspaceId: string;
  itemId: string;
  payment: BudgetPaymentRecord;
  expectedVersion: number;
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    deleteBudgetPaymentAction.bind(null, workspaceId, itemId, payment.id),
    initialState,
  );
  useEffect(() => {
    onPendingChange(isPending);
  }, [isPending, onPendingChange]);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `確定刪除 ${payment.paidOn} 的 ${formatTwdAmount(payment.amount)} 付款紀錄？`,
          )
        ) {
          event.preventDefault();
        }
      }}
      className="shrink-0"
    >
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <button
        type="submit"
        disabled={isPending}
        aria-label={`刪除 ${payment.paidOn} 的付款紀錄`}
        className="min-h-9 rounded-full px-3 text-xs font-semibold text-danger transition hover:bg-danger-soft disabled:opacity-60"
      >
        刪除
      </button>
      {state.status === "error" ? <StatusMessage state={state} /> : null}
    </form>
  );
}

function EditPaymentForm({
  workspaceId,
  itemId,
  payment,
  expectedVersion,
  onPendingChange,
  onDone,
}: {
  workspaceId: string;
  itemId: string;
  payment: BudgetPaymentRecord;
  expectedVersion: number;
  onPendingChange: (pending: boolean) => void;
  onDone: (state: BudgetItemMutationState | null) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      const nextState = await updateBudgetPaymentAction(
        workspaceId,
        itemId,
        payment.id,
        previousState,
        formData,
      );
      if (nextState.status === "success") onDone(nextState);
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
      aria-label={`編輯付款：${payment.paidOn}`}
      className="grid min-w-0 gap-3 py-3 sm:grid-cols-3"
      noValidate
    >
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <label className="min-w-0 text-xs font-semibold text-ink-soft">
        金額
        <input
          name="amount"
          inputMode="numeric"
          required
          defaultValue={payment.amount}
          className={fieldClassName}
        />
      </label>
      <label className="min-w-0 text-xs font-semibold text-ink-soft">
        日期
        <input
          name="paidOn"
          type="date"
          required
          defaultValue={payment.paidOn}
          className={fieldClassName}
        />
      </label>
      <label className="min-w-0 text-xs font-semibold text-ink-soft">
        方式
        <select
          name="method"
          defaultValue={payment.method ?? ""}
          className={fieldClassName}
        >
          <option value="">未指定</option>
          {BUDGET_BALANCE_PAYMENT_METHOD_OPTIONS.map((method) => (
            <option key={method} value={method}>
              {BUDGET_BALANCE_PAYMENT_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 text-xs font-semibold text-ink-soft sm:col-span-2">
        備註
        <input
          name="notes"
          maxLength={200}
          defaultValue={payment.notes ?? ""}
          className={fieldClassName}
        />
      </label>
      <div className="flex min-w-0 items-end gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 flex-1 rounded-full bg-clay px-4 text-sm font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-70"
        >
          {isPending ? "儲存中…" : "儲存"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => onDone(null)}
          className="min-h-11 flex-1 rounded-full border border-line px-4 text-sm font-semibold text-ink transition hover:bg-surface disabled:opacity-60"
        >
          取消
        </button>
      </div>
      {state.status === "error" ? (
        <div className="sm:col-span-3">
          <StatusMessage state={state} />
        </div>
      ) : null}
    </form>
  );
}

/**
 * 尾款動輒幾十萬，常常先分幾天匯一部分給廠商；每一筆都記下來，
 * 才知道婚禮當天還要準備多少。待付＝尾款＋加購－已付。
 */
export function BudgetPayments({
  workspaceId,
  itemId,
  itemName,
  expectedVersion,
  bookingStatus,
  balanceAmount,
  additionalAmount,
  balancePaymentMethod,
  payments,
  canEdit,
  today,
  onPendingChange,
}: BudgetPaymentsProps) {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const paidAmount = payments.reduce(
    (total, payment) => total + payment.amount,
    0,
  );
  const total = budgetBalanceTotal({ balanceAmount, additionalAmount });
  const remaining = budgetRemainingBalance({
    balanceAmount,
    additionalAmount,
    paidAmount,
  });
  const canAddPayment = canEdit && bookingStatus === "BOOKED_BALANCE_DUE";
  const [formKey, setFormKey] = useState(0);
  const [deletePending, setDeletePending] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editState, setEditState] =
    useState<BudgetItemMutationState>(initialState);
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      const nextState = await addBudgetPaymentAction(
        workspaceId,
        itemId,
        previousState,
        formData,
      );
      if (nextState.status === "success") setFormKey((key) => key + 1);
      return nextState;
    },
    initialState,
  );
  useEffect(() => {
    onPendingChange?.(isPending || deletePending || editPending);
  }, [isPending, deletePending, editPending, onPendingChange]);

  if (payments.length === 0 && !canAddPayment) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-budget-payments="true"
      className="mt-5 min-w-0 border-t border-line pt-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 id={headingId} className="text-sm font-semibold text-ink">
          尾款分批付款
        </h4>
        <p className="text-xs text-ink-soft">
          尾款＋加購，扣掉已先付的就是還要準備的錢
        </p>
      </div>

      <dl className="mt-3 grid min-w-0 grid-cols-3 gap-x-4 rounded-lg border border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">尾款＋加購</dt>
          <dd className="mt-0.5 font-sans text-sm font-semibold tabular-nums text-ink">
            {total === null ? "未記錄" : formatTwdAmount(total.toString())}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">已先付</dt>
          <dd className="mt-0.5 font-sans text-sm font-semibold tabular-nums text-ink">
            {formatTwdAmount(paidAmount)}
            {payments.length > 0 ? (
              <span className="ml-1 text-xs font-normal text-ink-soft">
                （{payments.length} 筆）
              </span>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">還要付</dt>
          <dd
            data-budget-payment-remaining="true"
            className="mt-0.5 font-sans text-sm font-semibold tabular-nums text-clay-strong"
          >
            {remaining === null
              ? "待確認"
              : remaining === BigInt(0)
                ? "已付清"
                : formatTwdAmount(remaining.toString())}
          </dd>
        </div>
      </dl>

      {payments.length > 0 ? (
        <ol className="mt-3 min-w-0 divide-y divide-line border-y border-line">
          {payments.map((payment) =>
            editingPaymentId === payment.id ? (
              <li key={payment.id} className="min-w-0">
                <EditPaymentForm
                  workspaceId={workspaceId}
                  itemId={itemId}
                  payment={payment}
                  expectedVersion={expectedVersion}
                  onPendingChange={setEditPending}
                  onDone={(nextState) => {
                    setEditPending(false);
                    setEditingPaymentId(null);
                    if (nextState) setEditState(nextState);
                  }}
                />
              </li>
            ) : (
              <li
                key={payment.id}
                className="flex min-w-0 items-center gap-3 py-2 text-sm"
              >
                <time
                  dateTime={payment.paidOn}
                  className="w-24 shrink-0 tabular-nums text-ink-soft"
                >
                  {payment.paidOn}
                </time>
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-semibold tabular-nums text-ink">
                    {formatTwdAmount(payment.amount)}
                  </span>
                  {methodLabel(payment.method) ? (
                    <span className="ml-2 text-xs text-ink-soft">
                      {methodLabel(payment.method)}
                    </span>
                  ) : null}
                  {payment.notes ? (
                    <span className="block text-xs text-ink-soft">
                      {payment.notes}
                    </span>
                  ) : null}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    disabled={editingPaymentId !== null}
                    onClick={() => {
                      setEditState(initialState);
                      setEditingPaymentId(payment.id);
                    }}
                    aria-label={`編輯 ${payment.paidOn} 的付款紀錄`}
                    className="min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-clay-strong transition hover:bg-surface disabled:opacity-60"
                  >
                    編輯
                  </button>
                ) : null}
                {canEdit ? (
                  <DeletePaymentButton
                    workspaceId={workspaceId}
                    itemId={itemId}
                    payment={payment}
                    expectedVersion={expectedVersion}
                    onPendingChange={setDeletePending}
                  />
                ) : null}
              </li>
            ),
          )}
        </ol>
      ) : null}
      <StatusMessage state={editState} />

      {canAddPayment ? (
        <form
          key={formKey}
          action={formAction}
          aria-label={`記錄付款：${itemName}`}
          className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
          noValidate
        >
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <label className="min-w-0 text-xs font-semibold text-ink-soft">
            這次付款金額
            <input
              name="amount"
              inputMode="numeric"
              required
              placeholder={
                remaining !== null && remaining > BigInt(0)
                  ? remaining.toString()
                  : "例如 100000"
              }
              className={fieldClassName}
            />
          </label>
          <label className="min-w-0 text-xs font-semibold text-ink-soft">
            付款日期
            <input
              name="paidOn"
              type="date"
              required
              defaultValue={today ?? ""}
              className={fieldClassName}
            />
          </label>
          <label className="min-w-0 text-xs font-semibold text-ink-soft">
            付款方式
            <select
              name="method"
              defaultValue={
                balancePaymentMethod === "RED_ENVELOPE"
                  ? "CASH"
                  : (balancePaymentMethod ?? "CASH")
              }
              className={fieldClassName}
            >
              <option value="">未指定</option>
              {BUDGET_BALANCE_PAYMENT_METHOD_OPTIONS.map((method) => (
                <option key={method} value={method}>
                  {BUDGET_BALANCE_PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold text-ink-soft sm:col-span-2">
            備註（選填）
            <input
              name="notes"
              maxLength={200}
              placeholder="例如：匯款末五碼 12345"
              className={fieldClassName}
            />
          </label>
          <div className="flex min-w-0 items-end">
            <button
              type="submit"
              disabled={isPending}
              className="min-h-11 w-full rounded-full bg-clay px-4 text-sm font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-70"
            >
              {isPending ? "記錄中…" : "記錄這筆付款"}
            </button>
          </div>
          <div className="sm:col-span-3">
            <StatusMessage state={state} />
          </div>
        </form>
      ) : (
        <StatusMessage state={state} />
      )}
    </section>
  );
}
