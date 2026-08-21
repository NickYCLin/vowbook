"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  changeBudgetItemBookingStatusAction,
  createBudgetItemAction,
  createChildBudgetItemAction,
  deleteBudgetItemAction,
  moveBudgetItemAction,
  resetBudgetDataAction,
  type BudgetItemMutationState,
  updateBudgetItemAction,
} from "@/actions/budget-items";
import {
  BUDGET_BOOKING_STATUS_LABELS,
  BUDGET_PRIMARY_CONTACT_LABELS,
  BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES,
  BUDGET_TAXONOMY_STAGES,
  type BudgetBookingStatus,
  type BudgetCostCategory,
  type BudgetPrimaryContact,
  type BudgetTaxonomyItemKey,
} from "@/domain/budget-item";
import { containDialogFocus } from "@/lib/dialog-focus-containment";
import type { BudgetResetSnapshot } from "@/lib/budget-reset-snapshot";

const initialState: BudgetItemMutationState = { status: "idle" };

const fieldClassName =
  "mt-2 min-h-12 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink shadow-inner outline-none transition focus:border-clay";

type BudgetFieldValues = {
  name: string;
  category: "" | BudgetCostCategory;
  taxonomyItemKey: "" | BudgetTaxonomyItemKey;
  relatedTaxonomyItemKey: "" | BudgetTaxonomyItemKey;
  plannedAmount: string;
  actualAmount: string;
  dueDate: string;
  depositAmount: string;
  balanceAmount: string;
  additionalAmount: string;
  estimatedRange: string;
  candidateVendors: string;
  confirmedVendor: string;
  vendorContact: string;
  primaryContact: "" | BudgetPrimaryContact;
  notes: string;
};

const emptyBudgetFields: BudgetFieldValues = {
  name: "",
  category: "",
  taxonomyItemKey: "",
  relatedTaxonomyItemKey: "",
  plannedAmount: "",
  actualAmount: "",
  dueDate: "",
  depositAmount: "",
  balanceAmount: "",
  additionalAmount: "",
  estimatedRange: "",
  candidateVendors: "",
  confirmedVendor: "",
  vendorContact: "",
  primaryContact: "",
  notes: "",
};

const budgetFieldNames = Object.keys(emptyBudgetFields) as Array<
  keyof BudgetFieldValues
>;

type BudgetEditDraft = {
  values: BudgetFieldValues;
  expectedVersion: number;
  dirty: boolean;
};

type BudgetServerSnapshot = {
  values: BudgetFieldValues;
  expectedVersion: number;
};

type BudgetEditOutcome = "success" | "stale" | null;

type BookingStatusSnapshot = {
  bookingStatus: BudgetBookingStatus;
  expectedVersion: number;
};

type BookingStatusDraft = BookingStatusSnapshot & { dirty: boolean };

function toBudgetFieldValues({
  name,
  category,
  taxonomyItemKey,
  relatedTaxonomyItemKey,
  plannedAmount,
  actualAmount,
  dueDate,
  depositAmount,
  balanceAmount,
  additionalAmount,
  estimatedRange,
  candidateVendors,
  confirmedVendor,
  vendorContact,
  primaryContact,
  notes,
}: {
  name: string;
  category: BudgetCostCategory;
  taxonomyItemKey?: BudgetTaxonomyItemKey | null;
  relatedTaxonomyItemKey?: BudgetTaxonomyItemKey | null;
  plannedAmount: number;
  actualAmount: number | null;
  dueDate: string | null;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  estimatedRange: string | null;
  candidateVendors: string | null;
  confirmedVendor: string | null;
  vendorContact: string | null;
  primaryContact: BudgetPrimaryContact | null;
  notes: string | null;
}): BudgetFieldValues {
  return {
    name,
    category,
    taxonomyItemKey:
      taxonomyItemKey ?? defaultTaxonomyItemKeyForCategory(category),
    relatedTaxonomyItemKey: relatedTaxonomyItemKey ?? "",
    plannedAmount: String(plannedAmount),
    actualAmount: actualAmount === null ? "" : String(actualAmount),
    dueDate: dueDate ?? "",
    depositAmount: depositAmount === null ? "" : String(depositAmount),
    balanceAmount: balanceAmount === null ? "" : String(balanceAmount),
    additionalAmount: additionalAmount === null ? "" : String(additionalAmount),
    estimatedRange: estimatedRange ?? "",
    candidateVendors: candidateVendors ?? "",
    confirmedVendor: confirmedVendor ?? "",
    vendorContact: vendorContact ?? "",
    primaryContact: primaryContact ?? "",
    notes: notes ?? "",
  };
}

function defaultTaxonomyItemKeyForCategory(
  category: BudgetCostCategory,
): "" | BudgetTaxonomyItemKey {
  const matchingItems = BUDGET_TAXONOMY_STAGES.flatMap((stage) =>
    stage.items.filter((item) => item.defaultCategory === category),
  );
  return matchingItems.length === 1 ? matchingItems[0].key : "";
}

function sameBudgetServerSnapshot(
  left: BudgetServerSnapshot,
  right: BudgetServerSnapshot,
): boolean {
  return (
    left.expectedVersion === right.expectedVersion &&
    budgetFieldNames.every(
      (field) => left.values[field] === right.values[field],
    )
  );
}

function ActionFeedback({ state }: { state: BudgetItemMutationState }) {
  if (state.status === "idle") {
    return null;
  }

  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error"
          ? "break-words border-l-2 border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
          : "break-words border-l-2 border-sage bg-sage-soft px-4 py-3 text-sm text-sage"
      }
    >
      {state.message}
    </p>
  );
}

function OptionalLabel() {
  return <span className="ml-2 text-sm font-normal text-ink-faint">選填</span>;
}

function normalizedConfirmationName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function BudgetFields({
  idPrefix,
  values,
  bookingStatus,
  onChange,
  nameInputRef,
  lockedCategory,
  lockedTaxonomyItemKey,
}: {
  idPrefix: string;
  values: BudgetFieldValues;
  bookingStatus: BudgetBookingStatus;
  onChange: (field: keyof BudgetFieldValues, value: string) => void;
  nameInputRef?: Ref<HTMLInputElement>;
  lockedCategory?: BudgetCostCategory;
  lockedTaxonomyItemKey?: BudgetTaxonomyItemKey;
}) {
  const componentValues = [
    values.depositAmount,
    values.balanceAmount,
    values.additionalAmount,
  ];
  const hasCostComponents = componentValues.some((value) => value !== "");
  const derivedDirectAmount = hasCostComponents
    ? componentValues
        .reduce(
          (total, value) =>
            /^\d+$/u.test(value) ? total + BigInt(value) : total,
          BigInt(0),
        )
        .toString()
    : values.plannedAmount;
  const derivedActualAmount =
    bookingStatus === "PLANNING"
      ? ""
      : bookingStatus === "BOOKED_BALANCE_DUE"
        ? values.depositAmount
        : derivedDirectAmount;
  const displayedTaxonomyItemKey =
    lockedTaxonomyItemKey ?? values.taxonomyItemKey;
  const displayedCategory =
    displayedTaxonomyItemKey === ""
      ? (lockedCategory ?? values.category)
      : BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[displayedTaxonomyItemKey];

  return (
    <div className="min-w-0 space-y-5">
      <div className="min-w-0">
        <label
          htmlFor={`${idPrefix}-name`}
          className="block font-medium text-ink"
        >
          項目名稱
        </label>
        <input
          ref={nameInputRef}
          id={`${idPrefix}-name`}
          name="name"
          type="text"
          required
          minLength={1}
          autoComplete="off"
          value={values.name}
          onChange={(event) => onChange("name", event.target.value)}
          className={fieldClassName}
        />
        <p className="mt-2 text-sm leading-6 text-ink-faint">
          最多 120 個字元；送出時會再次驗證。
        </p>
      </div>

      <div className="min-w-0">
        <label
          htmlFor={`${idPrefix}-taxonomy-item-key`}
          className="block font-medium text-ink"
        >
          品項分類
        </label>
        {lockedTaxonomyItemKey ? (
          <input
            type="hidden"
            name="taxonomyItemKey"
            value={lockedTaxonomyItemKey}
          />
        ) : null}
        <input type="hidden" name="category" value={displayedCategory} />
        <select
          id={`${idPrefix}-taxonomy-item-key`}
          name={lockedTaxonomyItemKey ? undefined : "taxonomyItemKey"}
          required
          disabled={lockedTaxonomyItemKey !== undefined}
          value={displayedTaxonomyItemKey}
          onChange={(event) => {
            const taxonomyItemKey = event.target.value as BudgetTaxonomyItemKey;
            onChange("taxonomyItemKey", taxonomyItemKey);
            onChange(
              "category",
              BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[taxonomyItemKey],
            );
            if (values.relatedTaxonomyItemKey === taxonomyItemKey) {
              onChange("relatedTaxonomyItemKey", "");
            }
          }}
          className={fieldClassName}
        >
          {displayedTaxonomyItemKey === "" && (
            <option value="" hidden>
              請選擇品項分類
            </option>
          )}
          {BUDGET_TAXONOMY_STAGES.map((stage) => (
            <optgroup key={stage.key} label={stage.label}>
              {stage.items.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          {lockedTaxonomyItemKey
            ? "品項分類由所在的固定分類決定。"
            : "依籌備階段分組；變更後，花費會移到對應的固定品項分類。"}
        </p>
      </div>

      <div className="min-w-0">
        <label
          htmlFor={`${idPrefix}-related-taxonomy-item-key`}
          className="block font-medium text-stone-800"
        >
          用途關聯（選填）
        </label>
        <select
          id={`${idPrefix}-related-taxonomy-item-key`}
          aria-describedby={`${idPrefix}-related-taxonomy-help`}
          name="relatedTaxonomyItemKey"
          value={values.relatedTaxonomyItemKey}
          onChange={(event) =>
            onChange("relatedTaxonomyItemKey", event.target.value)
          }
          className={fieldClassName}
        >
          <option value="">不設定用途關聯</option>
          {BUDGET_TAXONOMY_STAGES.map((stage) => (
            <optgroup key={stage.key} label={stage.label}>
              {stage.items.map((item) => (
                <option
                  key={item.key}
                  value={item.key}
                  disabled={item.key === displayedTaxonomyItemKey}
                >
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p
          id={`${idPrefix}-related-taxonomy-help`}
          className="mt-2 text-sm leading-6 text-ink-faint"
        >
          主分類回答錢花在哪裡；用途關聯回答這筆費用為哪個品項產生，不會重複計入總額。
        </p>
      </div>

      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <label
            htmlFor={`${idPrefix}-planned-amount`}
            className="block font-medium text-ink"
          >
            預計花費
          </label>
          <input
            id={`${idPrefix}-planned-amount`}
            name="plannedAmount"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            autoComplete="off"
          value={derivedDirectAmount}
          readOnly={hasCostComponents}
            onChange={(event) =>
              onChange("plannedAmount", event.target.value)
            }
            className={`${fieldClassName} read-only:cursor-not-allowed read-only:bg-surface-sunken read-only:text-ink-soft`}
          />
          <p className="mt-2 text-sm leading-6 text-ink-faint">
            {hasCostComponents
              ? "已由訂金、尾款與加購費用即時計算。"
              : "以新台幣整數記錄；填入任一費用組成後改為自動計算。"}
          </p>
        </div>

        <div className="min-w-0">
          <label
            htmlFor={`${idPrefix}-actual-amount`}
            className="block font-medium text-ink"
          >
            實付金額
            <OptionalLabel />
          </label>
          <input
            id={`${idPrefix}-actual-amount`}
            name="actualAmount"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={derivedActualAmount}
            readOnly
            className={`${fieldClassName} cursor-not-allowed bg-surface-sunken text-ink-soft`}
          />
          <p className="mt-2 text-sm leading-6 text-ink-faint">
            規劃中留白；已下訂顯示訂金，已付清顯示本項完整直接費用。
          </p>
        </div>
      </div>

      <fieldset className="min-w-0 border-y border-dashed border-line py-5">
        <legend className="px-2 font-medium text-ink">費用組成</legend>
        <p className="mb-4 text-sm leading-6 text-ink-faint">
          任一欄有值時，預計花費會由訂金、尾款與加購費用自動加總。
        </p>
        <div className="grid min-w-0 gap-5 sm:grid-cols-3">
          {(
            [
              ["depositAmount", "訂金費用"],
              ["balanceAmount", "尾款費用"],
              ["additionalAmount", "加購費用"],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="min-w-0">
              <label
                htmlFor={`${idPrefix}-${field}`}
                className="block font-medium text-ink"
              >
                {label}
                <OptionalLabel />
              </label>
              <input
                id={`${idPrefix}-${field}`}
                name={field}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={values[field]}
                onChange={(event) => onChange(field, event.target.value)}
                className={fieldClassName}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="min-w-0">
        <label
          htmlFor={`${idPrefix}-due-date`}
          className="block font-medium text-ink"
        >
          付款期限
          <OptionalLabel />
        </label>
        <input
          id={`${idPrefix}-due-date`}
          name="dueDate"
          type="date"
          value={values.dueDate}
          onChange={(event) => onChange("dueDate", event.target.value)}
          className={fieldClassName}
        />
      </div>

      <div className="min-w-0">
        <label
          htmlFor={`${idPrefix}-estimated-range`}
          className="block font-medium text-ink"
        >
          預估費用範圍
          <OptionalLabel />
        </label>
        <textarea
          id={`${idPrefix}-estimated-range`}
          name="estimatedRange"
          rows={2}
          autoComplete="off"
          value={values.estimatedRange}
          onChange={(event) => onChange("estimatedRange", event.target.value)}
          className={`${fieldClassName} py-3`}
        />
      </div>

      <div className="min-w-0">
        <label
          htmlFor={`${idPrefix}-candidate-vendors`}
          className="block font-medium text-ink"
        >
          候選廠商或工作人員
          <OptionalLabel />
        </label>
        <textarea
          id={`${idPrefix}-candidate-vendors`}
          name="candidateVendors"
          rows={3}
          value={values.candidateVendors}
          onChange={(event) => onChange("candidateVendors", event.target.value)}
          className={`${fieldClassName} py-3`}
        />
      </div>

      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <label
            htmlFor={`${idPrefix}-confirmed-vendor`}
            className="block font-medium text-ink"
          >
            確定廠商
            <OptionalLabel />
          </label>
          <textarea
            id={`${idPrefix}-confirmed-vendor`}
            name="confirmedVendor"
            rows={2}
            autoComplete="organization"
            value={values.confirmedVendor}
            onChange={(event) =>
              onChange("confirmedVendor", event.target.value)
            }
            className={`${fieldClassName} py-3`}
          />
        </div>

        <div className="min-w-0">
          <label
            htmlFor={`${idPrefix}-vendor-contact`}
            className="block font-medium text-ink"
          >
            廠商聯絡人
            <OptionalLabel />
          </label>
          <textarea
            id={`${idPrefix}-vendor-contact`}
            name="vendorContact"
            rows={2}
            autoComplete="off"
            value={values.vendorContact}
            onChange={(event) => onChange("vendorContact", event.target.value)}
            className={`${fieldClassName} py-3`}
          />
        </div>
      </div>

      <div className="min-w-0">
        <label
          htmlFor={`${idPrefix}-primary-contact`}
          className="block font-medium text-ink"
        >
          主要負責人
          <OptionalLabel />
        </label>
        <select
          id={`${idPrefix}-primary-contact`}
          name="primaryContact"
          value={values.primaryContact}
          onChange={(event) => onChange("primaryContact", event.target.value)}
          className={fieldClassName}
        >
          <option value="">未設定</option>
          {Object.entries(BUDGET_PRIMARY_CONTACT_LABELS).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </div>

      <div className="min-w-0">
        <label
          htmlFor={`${idPrefix}-notes`}
          className="block font-medium text-ink"
        >
          備註
          <OptionalLabel />
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={4}
          value={values.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={`${fieldClassName} py-3`}
        />
        <p className="mt-2 text-sm leading-6 text-ink-faint">
          最多 1000 個字元；送出時會再次驗證。
        </p>
      </div>
    </div>
  );
}

export function CreateBudgetItemForm({
  workspaceId,
  parentId = null,
  parentBreadcrumb = [],
  onSuccess,
  parentCategory,
  parentTaxonomyItemKey,
  onPendingChange,
}: {
  workspaceId: string;
  parentId?: string | null;
  parentBreadcrumb?: string[];
  parentCategory?: BudgetCostCategory;
  parentTaxonomyItemKey?: BudgetTaxonomyItemKey;
  onSuccess?: (message: string) => void;
  onPendingChange?: (isPending: boolean) => void;
}) {
  const idPrefix = useId();
  const createAction =
    parentId === null
      ? createBudgetItemAction.bind(null, workspaceId)
      : createChildBudgetItemAction.bind(null, workspaceId, parentId);
  const [values, setValues] = useState<BudgetFieldValues>(emptyBudgetFields);
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      const nextState = await createAction(previousState, formData);
      if (nextState.status === "success") {
        setValues(emptyBudgetFields);
        onSuccess?.(nextState.message ?? "已新增花費項目。");
      }
      return nextState;
    },
    initialState,
  );

  useEffect(() => {
    onPendingChange?.(isPending);
    return () => onPendingChange?.(false);
  }, [isPending, onPendingChange]);

  function updateField(field: keyof BudgetFieldValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <form
      action={formAction}
      aria-label={
        parentId === null
          ? "新增花費表單"
          : `在${parentBreadcrumb.at(-1) ?? "指定項目"}下新增花費表單`
      }
      className="min-w-0 space-y-6 border-y border-line bg-surface/75 px-4 py-7 sm:px-7"
      noValidate
    >
      <div>
        <p className="text-sm font-semibold tracking-[0.14em] text-clay">
          {parentId === null ? "新增一筆" : "新增子項"}
        </p>
        <h2 className="mt-2 font-serif text-2xl font-semibold text-ink">
          {parentId === null ? "記下婚禮花費" : "在此項下新增花費"}
        </h2>
        {parentId !== null && (
          <p className="mt-2 min-w-0 break-words text-sm leading-6 text-ink-soft">
            建立位置：{parentBreadcrumb.join(" › ")}
          </p>
        )}
      </div>
      <BudgetFields
        idPrefix={idPrefix}
        values={values}
        bookingStatus="PLANNING"
        onChange={updateField}
        lockedCategory={parentCategory}
        lockedTaxonomyItemKey={parentTaxonomyItemKey}
      />
      {parentId !== null && state.status === "success" ? null : (
        <ActionFeedback state={state} />
      )}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-clay px-6 py-3 font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-70 sm:w-auto"
      >
        {isPending ? "正在新增…" : "新增花費項目"}
      </button>
    </form>
  );
}

export function EditBudgetItemForm({
  workspaceId,
  itemId,
  name,
  category,
  taxonomyItemKey = null,
  relatedTaxonomyItemKey = null,
  plannedAmount,
  actualAmount,
  dueDate,
  depositAmount = null,
  balanceAmount = null,
  additionalAmount = null,
  estimatedRange = null,
  candidateVendors = null,
  confirmedVendor = null,
  vendorContact = null,
  primaryContact = null,
  bookingStatus = "PLANNING",
  notes,
  expectedVersion,
  breadcrumb = [name],
  depth = 0,
  directParentName = null,
  directChildCount = 0,
  descendantCount = 0,
}: {
  workspaceId: string;
  itemId: string;
  name: string;
  category: BudgetCostCategory;
  taxonomyItemKey?: BudgetTaxonomyItemKey | null;
  relatedTaxonomyItemKey?: BudgetTaxonomyItemKey | null;
  plannedAmount: number;
  actualAmount: number | null;
  dueDate: string | null;
  depositAmount?: number | null;
  balanceAmount?: number | null;
  additionalAmount?: number | null;
  estimatedRange?: string | null;
  candidateVendors?: string | null;
  confirmedVendor?: string | null;
  vendorContact?: string | null;
  primaryContact?: BudgetPrimaryContact | null;
  bookingStatus?: BudgetBookingStatus;
  notes: string | null;
  expectedVersion: number;
  breadcrumb?: string[];
  depth?: number;
  directParentName?: string | null;
  directChildCount?: number;
  descendantCount?: number;
}) {
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogTitleId = `${idPrefix}-edit-title`;
  const dialogItemId = `${idPrefix}-edit-item`;
  const updateAction = updateBudgetItemAction.bind(null, workspaceId, itemId);
  const serverSnapshot: BudgetServerSnapshot = {
    values: toBudgetFieldValues({
      name,
      category,
      taxonomyItemKey,
      relatedTaxonomyItemKey,
      plannedAmount,
      actualAmount,
      dueDate,
      depositAmount,
      balanceAmount,
      additionalAmount,
      estimatedRange,
      candidateVendors,
      confirmedVendor,
      vendorContact,
      primaryContact,
      notes,
    }),
    expectedVersion,
  };
  const [draft, setDraft] = useState<BudgetEditDraft>(() => ({
    ...serverSnapshot,
    dirty: false,
  }));
  const [lastServerSnapshot, setLastServerSnapshot] =
    useState<BudgetServerSnapshot>(serverSnapshot);
  const [pendingOutcome, setPendingOutcome] = useState<BudgetEditOutcome>(null);
  const [showSuccessFeedback, setShowSuccessFeedback] = useState(false);
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      setShowSuccessFeedback(false);
      const nextState = await updateAction(previousState, formData);
      if (nextState.status === "success") {
        setPendingOutcome("success");
        setShowSuccessFeedback(true);
        dialogRef.current?.close();
      } else if (nextState.code === "STALE") {
        setPendingOutcome("stale");
      }
      return nextState;
    },
    initialState,
  );

  const canApplyPendingOutcome =
    pendingOutcome !== null && expectedVersion !== draft.expectedVersion;
  if (canApplyPendingOutcome) {
    setPendingOutcome(null);
    setLastServerSnapshot(serverSnapshot);
    setDraft(
      pendingOutcome === "success"
        ? { ...serverSnapshot, dirty: false }
        : { ...draft, expectedVersion },
    );
  } else if (!sameBudgetServerSnapshot(lastServerSnapshot, serverSnapshot)) {
    setLastServerSnapshot(serverSnapshot);
    if (!draft.dirty) {
      setDraft({ ...serverSnapshot, dirty: false });
    }
  }

  function updateField(field: keyof BudgetFieldValues, value: string) {
    setDraft((current) => ({
      ...current,
      dirty: true,
      values: { ...current.values, [field]: value },
    }));
  }

  function openDialog() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) {
      return;
    }

    setShowSuccessFeedback(false);
    dialog.showModal();
    firstFieldRef.current?.focus();
  }

  function closeDialog() {
    if (isPending) {
      return;
    }
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`編輯項目：${name}`}
        onClick={openDialog}
        className="mt-4 inline-flex min-h-11 w-fit max-w-full cursor-pointer items-center break-words rounded-full border border-line px-4 py-2 text-sm font-semibold text-clay transition hover:bg-clay-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2"
      >
        編輯項目
      </button>
      {showSuccessFeedback && state.status === "success" ? (
        <div className="mt-3">
          <ActionFeedback state={state} />
        </div>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogItemId}
        onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
        onCancel={(event) => {
          if (isPending) {
            event.preventDefault();
          }
        }}
        onClose={() => triggerRef.current?.focus()}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-0 text-left text-ink shadow-[0_12px_32px_rgba(69,49,38,0.16)] backdrop:bg-stone-950/30 backdrop:backdrop-blur-[1px]"
      >
        <header className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-4 border-b border-line bg-surface px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.14em] text-clay">
              花費明細
            </p>
            <h2
              id={dialogTitleId}
              className="mt-1 font-serif text-2xl font-semibold text-ink"
            >
              編輯花費項目
            </h2>
            <nav
              id={dialogItemId}
              aria-label="編輯花費層級路徑"
              className="mt-2 min-w-0 break-words text-sm leading-6 text-ink-soft"
            >
              {breadcrumb.map((entry, index) => (
                <span key={`${index}-${entry}`}>
                  {index > 0 ? " › " : ""}
                  {entry}
                </span>
              ))}
            </nav>
            <p className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 break-words text-xs text-ink-faint">
              <span>第 {depth + 1} 層</span>
              <span>直接上層：{directParentName ?? "無（最上層）"}</span>
              <span>直接子項 {directChildCount} 項</span>
              <span>全部下層 {descendantCount} 項</span>
            </p>
          </div>
          <button
            type="button"
            aria-label={`關閉編輯花費項目：${name}`}
            disabled={isPending}
            onClick={closeDialog}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-line text-2xl leading-none text-ink-soft transition hover:bg-clay-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-wait disabled:opacity-50"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <form
          action={formAction}
          aria-label={`編輯 ${name}`}
          className="min-w-0 space-y-6 px-5 py-6 sm:px-7"
          noValidate
        >
          <input
            type="hidden"
            name="expectedVersion"
            value={draft.expectedVersion}
          />
          <BudgetFields
            idPrefix={idPrefix}
            values={draft.values}
            bookingStatus={bookingStatus}
            onChange={updateField}
            nameInputRef={firstFieldRef}
          />
          {state.status === "success" ? null : (
            <ActionFeedback state={state} />
          )}
          <div className="flex min-w-0 flex-col-reverse gap-3 border-t border-dashed border-line pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isPending}
              onClick={closeDialog}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-line px-5 py-2 font-semibold text-ink transition hover:bg-clay-soft disabled:cursor-wait disabled:opacity-50 sm:w-auto"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-clay bg-clay px-5 py-2 font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-70 sm:w-auto"
            >
              {isPending ? "正在儲存…" : "儲存花費項目"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function ChangeBudgetItemBookingStatusForm({
  workspaceId,
  itemId,
  bookingStatus,
  itemName,
  expectedVersion,
  onPendingChange,
}: {
  workspaceId: string;
  itemId: string;
  bookingStatus: BudgetBookingStatus;
  itemName: string;
  expectedVersion: number;
  onPendingChange?: (pending: boolean) => void;
}) {
  const idPrefix = useId();
  const statusAction = changeBudgetItemBookingStatusAction.bind(
    null,
    workspaceId,
    itemId,
  );
  const serverSnapshot: BookingStatusSnapshot = {
    bookingStatus,
    expectedVersion,
  };
  const [draft, setDraft] = useState<BookingStatusDraft>(() => ({
    ...serverSnapshot,
    dirty: false,
  }));
  const [lastServerSnapshot, setLastServerSnapshot] =
    useState<BookingStatusSnapshot>(serverSnapshot);
  const [pendingOutcome, setPendingOutcome] = useState<BudgetEditOutcome>(null);
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      const nextState = await statusAction(previousState, formData);
      if (nextState.status === "success") {
        setPendingOutcome("success");
      } else if (nextState.code === "STALE") {
        setPendingOutcome("stale");
      }
      return nextState;
    },
    initialState,
  );
  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  const canApplyPendingOutcome =
    pendingOutcome !== null && expectedVersion !== draft.expectedVersion;
  if (canApplyPendingOutcome) {
    setPendingOutcome(null);
    setLastServerSnapshot(serverSnapshot);
    setDraft(
      pendingOutcome === "success"
        ? { ...serverSnapshot, dirty: false }
        : { ...draft, expectedVersion },
    );
  } else if (
    lastServerSnapshot.bookingStatus !== bookingStatus ||
    lastServerSnapshot.expectedVersion !== expectedVersion
  ) {
    setLastServerSnapshot(serverSnapshot);
    if (!draft.dirty) {
      setDraft({ ...serverSnapshot, dirty: false });
    }
  }

  return (
    <form
      action={formAction}
      aria-label={`更新狀態 ${itemName}`}
      className="min-w-0 space-y-3"
      noValidate
    >
      <input
        type="hidden"
        name="expectedVersion"
        value={draft.expectedVersion}
      />
      <label
        htmlFor={`${idPrefix}-booking-status`}
        className="block text-sm font-semibold text-ink"
      >
        下訂與付款狀態：{itemName}
      </label>
      <select
        id={`${idPrefix}-booking-status`}
        name="bookingStatus"
        value={draft.bookingStatus}
        onChange={(event) =>
          setDraft((current) => ({
            ...current,
            bookingStatus: event.target.value as BudgetBookingStatus,
            dirty: true,
          }))
        }
        className={`${fieldClassName} mt-0 sm:max-w-sm`}
      >
        {Object.entries(BUDGET_BOOKING_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        aria-label={`更新下訂與付款狀態：${itemName}`}
        className="min-h-11 max-w-full rounded-full border border-line px-4 py-2 text-sm font-semibold text-clay-strong transition hover:bg-clay-soft disabled:cursor-wait disabled:opacity-70"
      >
        {isPending ? "更新中…" : "更新狀態"}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

export type BudgetMoveTarget = {
  id: string;
  label: string;
};

export function MoveBudgetItemForm({
  workspaceId,
  itemId,
  itemName,
  currentParentId,
  expectedVersion,
  targets,
  onPendingChange,
}: {
  workspaceId: string;
  itemId: string;
  itemName: string;
  currentParentId: string | null;
  expectedVersion: number;
  targets: BudgetMoveTarget[];
  onPendingChange?: (pending: boolean) => void;
}) {
  const idPrefix = useId();
  const currentTarget = currentParentId ?? "";
  const [targetParentId, setTargetParentId] = useState(currentTarget);
  const moveAction = moveBudgetItemAction.bind(null, workspaceId, itemId);
  const [state, formAction, isPending] = useActionState(
    moveAction,
    initialState,
  );

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  return (
    <form
      action={formAction}
      aria-label={`調整階層位置：${itemName}`}
      className="min-w-0 space-y-3"
      noValidate
    >
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <label
        htmlFor={`${idPrefix}-target-parent`}
        className="block text-sm font-semibold text-ink"
      >
        所在位置
      </label>
      <select
        id={`${idPrefix}-target-parent`}
        name="targetParentId"
        value={targetParentId}
        onChange={(event) => setTargetParentId(event.target.value)}
        className={`${fieldClassName} mt-0`}
      >
        {targets.map((target) => (
          <option key={target.id} value={target.id}>
            {target.label}
          </option>
        ))}
      </select>
      <p className="text-sm leading-6 text-ink-faint">
        只能移到同一品項分類內；自己、下層項目與最上層不會出現在選單中。
      </p>
      <button
        type="submit"
        disabled={isPending || targetParentId === currentTarget}
        className="min-h-11 max-w-full rounded-full border border-line px-4 py-2 text-sm font-semibold text-clay-strong transition hover:bg-clay-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "移動中…" : "調整位置"}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

export function DeleteBudgetItemForm({
  workspaceId,
  itemId,
  name,
  expectedVersion,
  onPendingChange,
  onSuccess,
}: {
  workspaceId: string;
  itemId: string;
  name: string;
  expectedVersion: number;
  onPendingChange?: (pending: boolean) => void;
  onSuccess?: () => void;
}) {
  const deleteAction = deleteBudgetItemAction.bind(null, workspaceId, itemId);
  const [state, formAction, isPending] = useActionState(
    async (previousState: BudgetItemMutationState, formData: FormData) => {
      const nextState = await deleteAction(previousState, formData);
      if (nextState.status === "success") {
        onSuccess?.();
      }
      return nextState;
    },
    initialState,
  );
  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  return (
    <details className="mt-4 min-w-0">
      <summary
        aria-label={`移除項目：${name}`}
        className="inline-flex min-h-11 w-fit max-w-full cursor-pointer items-center rounded-control border border-danger/40 px-4 text-caption font-semibold break-words text-danger transition hover:bg-danger-soft [&::-webkit-details-marker]:hidden"
      >
        移除項目
      </summary>
      <div className="mt-3 rounded-control border border-danger/30 bg-danger-soft px-4 py-4">
        <p className="text-sm font-semibold text-danger">此動作無法復原。</p>
        <p className="mt-1 text-sm leading-6 text-danger">
          只有在確認不再需要這筆花費紀錄時才繼續。
        </p>
        <form
          action={formAction}
          aria-label={`移除項目：${name}`}
          className="mt-4 min-w-0 space-y-3"
        >
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <button
            type="submit"
            disabled={isPending}
            aria-label={`確認移除：${name}`}
            className="min-h-11 max-w-full rounded-full border border-danger px-5 py-2 text-sm font-semibold text-danger transition hover:bg-danger-soft disabled:cursor-wait disabled:opacity-70"
          >
            {isPending ? "正在移除…" : "確認移除"}
          </button>
          <ActionFeedback state={state} />
        </form>
      </div>
    </details>
  );
}

export function ResetBudgetDataForm({
  workspaceId,
  workspaceName,
  snapshot,
}: {
  workspaceId: string;
  workspaceName: string;
  snapshot: BudgetResetSnapshot;
}) {
  const idPrefix = useId();
  const [preparedSnapshot, setPreparedSnapshot] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const resetAction = resetBudgetDataAction.bind(null, workspaceId);
  const [state, formAction, isPending] = useActionState(
    resetAction,
    initialState,
  );
  const confirmationMatches =
    normalizedConfirmationName(confirmationName) ===
    normalizedConfirmationName(workspaceName);

  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      data-budget-reset-danger-zone="true"
      className="min-w-0 border-t border-stone-300 pt-4"
    >
      <details className="group min-w-0 text-stone-600">
        <summary className="min-h-11 w-fit cursor-pointer list-none rounded-full px-3 py-2 text-xs font-semibold underline decoration-stone-300 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
          資料重建（僅 OWNER）
        </summary>
        <div className="mt-3 border border-red-200 bg-red-50/60 px-4 py-5 sm:px-5">
          <h2
            id={`${idPrefix}-heading`}
            className="font-serif text-xl font-semibold text-red-950"
          >
            清除目前花費後重新匯入
          </h2>
          <p className="mt-3 text-sm leading-6 text-red-900">
            <span>
              {snapshot.itemCount} 筆非系統花費（Notion {snapshot.notionItemCount}{" "}
              筆、手動 {snapshot.manualItemCount} 筆）
            </span>
            將永久清除。
          </p>
          <p className="mt-2 text-sm leading-6 text-red-900">
            會保留 Drive 的 6 個籌備階段與 20 個固定品項分類。
          </p>
          <p className="mt-2 text-sm font-semibold leading-6 text-red-950">
            {snapshot.attachmentCount} 個附件將永久刪除，無法復原。
          </p>
          <p className="mt-2 text-sm leading-6 text-red-900">
            請先備妥可重新匯入的 Notion snapshot，再進行清除。
          </p>

          <form
            action={formAction}
            aria-label="清除花費資料"
            className="mt-5 min-w-0 space-y-4"
            noValidate
          >
            <input
              type="hidden"
              name="expectedResetSnapshotToken"
              value={snapshot.token}
            />
            <label className="flex min-w-0 items-start gap-3 text-sm font-medium leading-6 text-red-950">
              <input
                type="checkbox"
                name="preparedSnapshot"
                value="READY"
                checked={preparedSnapshot}
                onChange={(event) => setPreparedSnapshot(event.target.checked)}
                className="mt-1 size-4 shrink-0 accent-red-800"
              />
              <span>我已備妥可重新匯入的 Notion snapshot</span>
            </label>
            <div className="min-w-0">
              <label
                htmlFor={`${idPrefix}-confirmation-name`}
                className="block text-sm font-semibold text-red-950"
              >
                輸入「{workspaceName}」確認清除
              </label>
              <input
                id={`${idPrefix}-confirmation-name`}
                name="confirmationName"
                type="text"
                autoComplete="off"
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
                className="mt-2 min-h-12 w-full min-w-0 rounded-lg border border-red-300 bg-white px-4 text-stone-900 shadow-inner outline-none focus:border-red-700 focus:ring-2 focus:ring-red-700/20 sm:max-w-md"
              />
            </div>
            <button
              type="submit"
              disabled={
                isPending || !preparedSnapshot || !confirmationMatches
              }
              className="min-h-11 rounded-full border border-red-800 px-5 py-2 text-sm font-semibold text-red-900 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "正在清除…" : "清除並準備重建"}
            </button>
            <ActionFeedback state={state} />
          </form>
        </div>
      </details>
    </section>
  );
}
