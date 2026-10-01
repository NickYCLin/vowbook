"use client";

import { Check, PencilSimple, Printer, X } from "@phosphor-icons/react";
import { useActionState, useId, useRef, useState } from "react";
import {
  createPackingItemAction,
  deletePackingItemAction,
  type PackingItemMutationState,
  setPackingItemPackedAction,
  updatePackingItemAction,
} from "@/actions/packing-items";
import {
  PACKING_SIDE_LABELS,
  PACKING_SIDE_ORDER,
  type PackingSideValue,
} from "@/domain/packing-item";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Button, SubmitButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

export type PackingListItem = {
  id: string;
  title: string;
  side: PackingSideValue;
  packed: boolean;
  version: number;
};

const initialState: PackingItemMutationState = { status: "idle" };

const strokeCollator = new Intl.Collator("zh-Hant-TW", { numeric: true });

function byStroke(left: PackingListItem, right: PackingListItem): number {
  return (
    strokeCollator.compare(left.title, right.title) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function AddPackingItemForm({ workspaceId }: { workspaceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const sideId = useId();
  const [state, formAction, isPending] = useActionState(
    async (previous: PackingItemMutationState, formData: FormData) => {
      const result = await createPackingItemAction(
        workspaceId,
        previous,
        formData,
      );
      if (result.status === "success") formRef.current?.reset();
      return result;
    },
    initialState,
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-3 sm:flex-row sm:items-center print:hidden"
    >
      <label htmlFor={titleId} className="sr-only">
        物品名稱
      </label>
      <Input
        id={titleId}
        name="title"
        required
        maxLength={80}
        placeholder="例：隱形眼鏡藥水、西裝、充電器"
        className="min-w-0 flex-1"
      />
      <label htmlFor={sideId} className="sr-only">
        誰要帶
      </label>
      <Select id={sideId} name="side" defaultValue="SHARED" className="sm:w-28">
        {PACKING_SIDE_ORDER.map((side) => (
          <option key={side} value={side}>
            {PACKING_SIDE_LABELS[side]}
          </option>
        ))}
      </Select>
      <SubmitButton isPending={isPending} pendingLabel="加入中…">
        加入
      </SubmitButton>
      <ActionFeedback
        state={state.status === "error" ? state : initialState}
        className="sm:basis-full"
      />
    </form>
  );
}

function EditPackingItemForm({
  workspaceId,
  item,
  onDone,
}: {
  workspaceId: string;
  item: PackingListItem;
  onDone: () => void;
}) {
  const titleId = useId();
  const sideId = useId();
  const [state, formAction, isPending] = useActionState(
    async (previous: PackingItemMutationState, formData: FormData) => {
      const result = await updatePackingItemAction(
        workspaceId,
        item.id,
        previous,
        formData,
      );
      if (result.status === "success") onDone();
      return result;
    },
    initialState,
  );

  return (
    <li className="py-1.5 print:hidden">
      <form action={formAction} className="flex min-w-0 flex-col gap-2">
        <input type="hidden" name="expectedVersion" value={item.version} />
        <label htmlFor={titleId} className="sr-only">
          編輯物品名稱
        </label>
        <Input
          id={titleId}
          name="title"
          required
          maxLength={80}
          defaultValue={item.title}
          autoFocus
          className="min-w-0"
        />
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={sideId} className="sr-only">
            誰要帶
          </label>
          <Select
            id={sideId}
            name="side"
            defaultValue={item.side}
            className="min-w-0 flex-1"
          >
            {PACKING_SIDE_ORDER.map((side) => (
              <option key={side} value={side}>
                {PACKING_SIDE_LABELS[side]}
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" onClick={onDone}>
            取消
          </Button>
          <SubmitButton isPending={isPending} pendingLabel="儲存中…">
            儲存
          </SubmitButton>
        </div>
        <ActionFeedback state={state.status === "error" ? state : initialState} />
      </form>
    </li>
  );
}

function PackingRow({
  workspaceId,
  item,
  canEdit,
}: {
  workspaceId: string;
  item: PackingListItem;
  canEdit: boolean;
}) {
  const [toggleState, toggleAction, togglePending] = useActionState(
    (previous: PackingItemMutationState, formData: FormData) =>
      setPackingItemPackedAction(
        workspaceId,
        item.id,
        !item.packed,
        previous,
        formData,
      ),
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    (previous: PackingItemMutationState, formData: FormData) =>
      deletePackingItemAction(workspaceId, item.id, previous, formData),
    initialState,
  );
  const [editing, setEditing] = useState(false);
  const box = (
    <span
      aria-hidden="true"
      className={[
        "inline-flex size-5 shrink-0 items-center justify-center rounded border",
        item.packed
          ? "border-positive bg-positive text-white print:border-ink print:bg-transparent print:text-ink"
          : "border-line-strong bg-surface",
      ].join(" ")}
    >
      {item.packed ? <Check size={14} weight="bold" /> : null}
    </span>
  );

  if (editing && canEdit) {
    return (
      <EditPackingItemForm
        workspaceId={workspaceId}
        item={item}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <li className="flex min-w-0 items-center gap-1 py-1.5 print:py-0.5">
      {canEdit ? (
        <form action={toggleAction} className="flex min-w-0 flex-1">
          <input type="hidden" name="expectedVersion" value={item.version} />
          <button
            type="submit"
            disabled={togglePending}
            aria-pressed={item.packed}
            aria-label={(item.packed ? "改回未打包：" : "標記已打包：") + item.title}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-wait"
          >
            {box}
            <span
              className={
                "min-w-0 break-words text-sm " +
                (item.packed ? "text-ink-soft line-through print:no-underline" : "text-ink")
              }
            >
              {item.title}
            </span>
          </button>
        </form>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          {box}
          <span className="min-w-0 break-words text-sm text-ink">{item.title}</span>
        </span>
      )}
      {canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={"編輯：" + item.title}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-clay-soft hover:text-clay-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay print:hidden"
        >
          <PencilSimple size={16} aria-hidden="true" />
        </button>
      ) : null}
      {canEdit ? (
        <form action={deleteAction} className="shrink-0 print:hidden">
          <input type="hidden" name="expectedVersion" value={item.version} />
          <button
            type="submit"
            disabled={deletePending}
            aria-label={"移除：" + item.title}
            className="inline-flex size-9 items-center justify-center rounded-full text-ink-faint transition hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </form>
      ) : null}
      {toggleState.status === "error" || deleteState.status === "error" ? (
        <span role="alert" className="sr-only">
          {toggleState.message ?? deleteState.message}
        </span>
      ) : null}
    </li>
  );
}

export function PackingList({
  workspaceId,
  items,
  canEdit,
}: {
  workspaceId: string;
  items: PackingListItem[];
  canEdit: boolean;
}) {
  return (
    <div data-print-document className="mt-6 min-w-0 space-y-4 print:mt-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-ink-soft">
          婚禮前一晚入住會館要帶的東西；打包好就點一下打勾。
        </p>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={18} aria-hidden="true" />
          列印清單
        </Button>
      </div>
      {canEdit ? <AddPackingItemForm workspaceId={workspaceId} /> : null}
      {items.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-10 text-center text-sm text-ink-soft print:hidden">
          還沒有要帶的物品，從上方輸入第一項吧。
        </p>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-3 print:grid-cols-3 print:gap-3">
          {PACKING_SIDE_ORDER.map((side) => {
            const sideItems = items
              .filter((item) => item.side === side)
              .sort(byStroke);
            const packedCount = sideItems.filter((item) => item.packed).length;
            const headingId = `${workspaceId}-packing-${side}`;
            return (
              <section
                key={side}
                aria-labelledby={headingId}
                className="min-w-0 break-inside-avoid rounded-card border border-line bg-white p-4 print:rounded-none print:p-2"
              >
                <header className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
                  <h2 id={headingId} className="font-serif text-lg font-semibold text-ink">
                    {PACKING_SIDE_LABELS[side]}
                  </h2>
                  <span className="text-xs tabular-nums text-ink-soft print:hidden">
                    {packedCount}/{sideItems.length} 已打包
                  </span>
                </header>
                {sideItems.length === 0 ? (
                  <p className="py-3 text-sm text-ink-faint">尚無物品</p>
                ) : (
                  <ul className="mt-1 min-w-0">
                    {sideItems.map((item) => (
                      <PackingRow
                        key={item.id + ":" + item.version}
                        workspaceId={workspaceId}
                        item={item}
                        canEdit={canEdit}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
