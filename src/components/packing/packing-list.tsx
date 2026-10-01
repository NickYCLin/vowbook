"use client";

import {
  Check,
  DotsSixVertical,
  PencilSimple,
  Plus,
  Printer,
  X,
} from "@phosphor-icons/react";
import {
  type DragEvent,
  useActionState,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  createPackingItemAction,
  deletePackingItemAction,
  movePackingItemAction,
  type PackingItemMutationState,
  setPackingItemPackedAction,
  updatePackingItemAction,
} from "@/actions/packing-items";
import {
  PACKING_SIDE_LABELS,
  PACKING_SIDE_ORDER,
  type PackingCategoryValue,
  type PackingSideValue,
} from "@/domain/packing-item";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Button, SubmitButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

export type PackingListItem = {
  id: string;
  title: string;
  side: PackingSideValue;
  category?: PackingCategoryValue;
  note?: string | null;
  packed: boolean;
  version: number;
};

function isSupply(item: PackingListItem): boolean {
  return item.category === "WEDDING_SUPPLY";
}

const PACKING_DRAG_TYPE = "application/x-vowbook-packing-item";

type PackingDragPayload = {
  id: string;
  version: number;
  side: PackingSideValue;
  category: PackingCategoryValue;
};

type DropZoneProps = {
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
  "data-drop-active"?: boolean;
};

function dropZoneClassName(active: boolean | undefined): string {
  return active ? " border-clay bg-clay-soft/40 ring-2 ring-clay/40" : " border-line bg-white";
}

function readDragPayload(event: DragEvent<HTMLElement>): PackingDragPayload | null {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData(PACKING_DRAG_TYPE));
    if (
      parsed &&
      typeof parsed.id === "string" &&
      Number.isSafeInteger(parsed.version) &&
      (PACKING_SIDE_ORDER as readonly string[]).includes(parsed.side)
    ) {
      return {
        id: parsed.id,
        version: parsed.version,
        side: parsed.side,
        category: parsed.category === "WEDDING_SUPPLY" ? "WEDDING_SUPPLY" : "PERSONAL",
      };
    }
  } catch {
    return null;
  }
  return null;
}

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
  const [destination, setDestination] = useState<string>("SHARED");
  const isSupplyDestination = destination === "WEDDING_SUPPLY";
  const [state, formAction, isPending] = useActionState(
    async (previous: PackingItemMutationState, formData: FormData) => {
      const result = await createPackingItemAction(
        workspaceId,
        previous,
        formData,
      );
      if (result.status === "success") {
        formRef.current?.reset();
        setDestination("SHARED");
      }
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
      <input
        type="hidden"
        name="category"
        value={isSupplyDestination ? "WEDDING_SUPPLY" : "PERSONAL"}
      />
      <input
        type="hidden"
        name="side"
        value={isSupplyDestination ? "SHARED" : destination}
      />
      <label htmlFor={titleId} className="sr-only">
        物品名稱
      </label>
      <Input
        id={titleId}
        name="title"
        required
        maxLength={80}
        placeholder="例：隱形眼鏡藥水、西裝、充電器、喜糖"
        className="min-w-0 flex-1"
      />
      <label htmlFor={sideId} className="sr-only">
        放在哪一區
      </label>
      <Select
        id={sideId}
        value={destination}
        onChange={(event) => setDestination(event.target.value)}
        className="sm:w-32"
      >
        {PACKING_SIDE_ORDER.map((side) => (
          <option key={side} value={side}>
            {PACKING_SIDE_LABELS[side]}
          </option>
        ))}
        <option value="WEDDING_SUPPLY">宴客用品</option>
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
  const noteId = useId();
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
        {isSupply(item) ? (
          <>
            <label htmlFor={noteId} className="sr-only">
              編輯數量／備註
            </label>
            <Input
              id={noteId}
              name="note"
              maxLength={60}
              defaultValue={item.note ?? ""}
              placeholder="數量／備註，例：120 份、放大紙箱"
              className="min-w-0"
            />
          </>
        ) : null}
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

function ItemLabel({ item }: { item: PackingListItem }) {
  const supply = isSupply(item);
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        className={
          "min-w-0 break-words text-sm " +
          (item.packed ? "text-ink-soft line-through print:no-underline" : "text-ink")
        }
      >
        {item.title}
      </span>
      {supply && item.note ? (
        <span className="min-w-0 break-words text-xs text-ink-soft">{item.note}</span>
      ) : null}
      {supply ? (
        <span className="ml-auto shrink-0 rounded-full bg-clay-soft px-2 py-0.5 text-xs text-clay-strong print:bg-transparent print:px-0 print:text-ink">
          {PACKING_SIDE_LABELS[item.side]}
          {item.side === "SHARED" ? "" : "帶"}
        </span>
      ) : null}
    </span>
  );
}

function AddSupplyForm({ workspaceId }: { workspaceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const noteId = useId();
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
      className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center print:hidden"
    >
      <input type="hidden" name="category" value="WEDDING_SUPPLY" />
      <label htmlFor={titleId} className="sr-only">
        宴客用品名稱
      </label>
      <Input
        id={titleId}
        name="title"
        required
        maxLength={80}
        placeholder="例：位上禮、遊戲禮品、簽名綢"
        className="min-w-0 sm:flex-[2]"
      />
      <label htmlFor={noteId} className="sr-only">
        數量／備註
      </label>
      <Input
        id={noteId}
        name="note"
        maxLength={60}
        placeholder="數量／備註（選填）"
        className="min-w-0 sm:flex-1"
      />
      <label htmlFor={sideId} className="sr-only">
        誰負責帶
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

function SupplySuggestion({
  workspaceId,
  title,
}: {
  workspaceId: string;
  title: string;
}) {
  const [state, formAction, isPending] = useActionState(
    (previous: PackingItemMutationState, formData: FormData) =>
      createPackingItemAction(workspaceId, previous, formData),
    initialState,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="category" value="WEDDING_SUPPLY" />
      <input type="hidden" name="side" value="SHARED" />
      <input type="hidden" name="title" value={title} />
      <button
        type="submit"
        disabled={isPending}
        aria-label={"從花費帶入：" + title}
        className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-line-strong bg-white px-3 text-xs text-ink-soft transition hover:border-clay hover:text-clay-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-wait"
      >
        <Plus size={12} weight="bold" aria-hidden="true" />
        {title}
      </button>
      {state.status === "error" ? (
        <span role="alert" className="sr-only">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function SupplySection({
  workspaceId,
  items,
  suggestions,
  canEdit,
  dropZone,
}: {
  workspaceId: string;
  items: PackingListItem[];
  suggestions: readonly string[];
  canEdit: boolean;
  dropZone: DropZoneProps;
}) {
  const headingId = `${workspaceId}-packing-supplies`;
  const sorted = [...items].sort(byStroke);
  const packedCount = sorted.filter((item) => item.packed).length;
  if (!canEdit && sorted.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      {...dropZone}
      className={
        "min-w-0 break-inside-avoid rounded-card border p-4 transition print:rounded-none print:border-line print:bg-white print:p-2 print:ring-0" +
        dropZoneClassName(dropZone["data-drop-active"])
      }
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <div className="min-w-0">
          <h2 id={headingId} className="font-serif text-lg font-semibold text-ink">
            宴客用品
          </h2>
          <p className="text-xs text-ink-soft print:hidden">
            位上禮、遊戲禮等要一起帶去會場的東西，可註明數量與誰負責。
          </p>
        </div>
        <span className="text-xs tabular-nums text-ink-soft print:hidden">
          {packedCount}/{sorted.length} 已打包
        </span>
      </header>
      {canEdit ? (
        <div className="mt-3 space-y-3 print:hidden">
          <AddSupplyForm workspaceId={workspaceId} />
          {suggestions.length > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-xs text-ink-faint">從花費帶入：</span>
              {suggestions.map((title) => (
                <SupplySuggestion
                  key={title}
                  workspaceId={workspaceId}
                  title={title}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {sorted.length === 0 ? (
        <p className="py-3 text-sm text-ink-faint">尚無宴客用品</p>
      ) : (
        <ul className="mt-1 grid min-w-0 gap-x-6 md:grid-cols-2 print:grid-cols-2">
          {sorted.map((item) => (
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
    <li
      draggable={canEdit}
      onDragStart={
        canEdit
          ? (event) => {
              const payload: PackingDragPayload = {
                id: item.id,
                version: item.version,
                side: item.side,
                category: isSupply(item) ? "WEDDING_SUPPLY" : "PERSONAL",
              };
              event.dataTransfer.setData(PACKING_DRAG_TYPE, JSON.stringify(payload));
              event.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      className={
        "group flex min-w-0 items-center gap-1 py-1.5 print:py-0.5" +
        (canEdit ? " cursor-grab active:cursor-grabbing" : "")
      }
    >
      {canEdit ? (
        <DotsSixVertical
          size={16}
          aria-hidden="true"
          className="-ml-1 shrink-0 text-ink-faint opacity-40 transition group-hover:opacity-100 print:hidden"
        />
      ) : null}
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
            <ItemLabel item={item} />
          </button>
        </form>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          {box}
          <ItemLabel item={item} />
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
  items: allItems,
  supplySuggestions = [],
  canEdit,
}: {
  workspaceId: string;
  items: PackingListItem[];
  supplySuggestions?: readonly string[];
  canEdit: boolean;
}) {
  const items = allItems.filter((item) => !isSupply(item));
  const supplies = allItems.filter(isSupply);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveState, setMoveState] = useState<PackingItemMutationState>(initialState);
  const [, startMove] = useTransition();

  function dropZone(
    key: string,
    category: PackingCategoryValue,
    side?: PackingSideValue,
  ): DropZoneProps {
    if (!canEdit) return {};
    return {
      "data-drop-active": dropTarget === key,
      onDragOver: (event) => {
        if (!Array.from(event.dataTransfer.types).includes(PACKING_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDropTarget((current) => (current === key ? null : current));
      },
      onDrop: (event) => {
        event.preventDefault();
        setDropTarget(null);
        const payload = readDragPayload(event);
        if (!payload) return;
        const nextSide = side ?? payload.side;
        if (payload.category === category && payload.side === nextSide) return;
        const formData = new FormData();
        formData.set("expectedVersion", String(payload.version));
        formData.set("side", nextSide);
        formData.set("category", category);
        startMove(async () => {
          setMoveState(
            await movePackingItemAction(workspaceId, payload.id, initialState, formData),
          );
        });
      },
    };
  }

  return (
    <div data-print-document className="mt-6 min-w-0 space-y-4 print:mt-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-ink-soft">
          前一晚入住會館要帶的東西：個人物品依新郎、新娘、共用分開，宴客用品另列在下方；打包好就點一下打勾。
          {canEdit ? "放錯區可以直接拖曳到其他區。" : null}
        </p>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={18} aria-hidden="true" />
          列印清單
        </Button>
      </div>
      {canEdit ? (
        <>
          <h2 className="font-serif text-lg font-semibold text-ink print:hidden">
            新增物品
          </h2>
          <AddPackingItemForm workspaceId={workspaceId} />
        </>
      ) : null}
      {moveState.status === "error" ? (
        <ActionFeedback state={moveState} className="print:hidden" />
      ) : null}
      {allItems.length === 0 ? (
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
            const zone = dropZone(`side-${side}`, "PERSONAL", side);
            return (
              <section
                key={side}
                aria-labelledby={headingId}
                {...zone}
                className={
                  "min-w-0 break-inside-avoid rounded-card border p-4 transition print:rounded-none print:border-line print:bg-white print:p-2 print:ring-0" +
                  dropZoneClassName(zone["data-drop-active"])
                }
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
      <SupplySection
        workspaceId={workspaceId}
        items={supplies}
        suggestions={supplySuggestions}
        canEdit={canEdit}
        dropZone={dropZone("supplies", "WEDDING_SUPPLY")}
      />
    </div>
  );
}
