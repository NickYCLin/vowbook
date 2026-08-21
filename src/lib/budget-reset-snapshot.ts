import "server-only";

import { createHash } from "node:crypto";

export type BudgetResetSnapshotRow = {
  id: string;
  version: number;
  source: "MANUAL" | "NOTION";
  attachments?: ReadonlyArray<{ id: string }>;
};

export type BudgetResetSnapshot = {
  token: string;
  itemCount: number;
  notionItemCount: number;
  manualItemCount: number;
  attachmentCount: number;
};

export function summarizeBudgetResetSnapshot(
  rows: ReadonlyArray<BudgetResetSnapshotRow>,
): BudgetResetSnapshot {
  const canonicalRows = rows
    .map((row) => ({
      id: row.id,
      version: row.version,
      source: row.source,
      attachmentIds: (row.attachments ?? [])
        .map((attachment) => attachment.id)
        .toSorted(),
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));

  return {
    token: createHash("sha256")
      .update(JSON.stringify(canonicalRows))
      .digest("hex"),
    itemCount: canonicalRows.length,
    notionItemCount: canonicalRows.filter((row) => row.source === "NOTION")
      .length,
    manualItemCount: canonicalRows.filter((row) => row.source === "MANUAL")
      .length,
    attachmentCount: canonicalRows.reduce(
      (count, row) => count + row.attachmentIds.length,
      0,
    ),
  };
}

export type BudgetSubtreeDeleteSnapshotRow = BudgetResetSnapshotRow & {
  parentId: string | null;
};

export type BudgetSubtreeDeleteSnapshot = {
  token: string;
  itemCount: number;
  attachmentCount: number;
};

export type BudgetSubtreeChildSnapshot = BudgetSubtreeDeleteSnapshot & {
  id: string;
};

export function summarizeBudgetSubtreeNode(
  row: BudgetResetSnapshotRow,
  children: ReadonlyArray<BudgetSubtreeChildSnapshot>,
): BudgetSubtreeDeleteSnapshot {
  const canonicalChildren = children
    .map((child) => ({ id: child.id, token: child.token }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  if (
    new Set(canonicalChildren.map((child) => child.id)).size !==
    canonicalChildren.length
  ) {
    throw new Error("Budget subtree snapshot contains duplicate children.");
  }
  const attachmentIds = (row.attachments ?? [])
    .map((attachment) => attachment.id)
    .toSorted();

  return {
    token: createHash("sha256")
      .update(
        JSON.stringify({
          id: row.id,
          version: row.version,
          source: row.source,
          attachmentIds,
          children: canonicalChildren,
        }),
      )
      .digest("hex"),
    itemCount:
      1 + children.reduce((count, child) => count + child.itemCount, 0),
    attachmentCount:
      attachmentIds.length +
      children.reduce((count, child) => count + child.attachmentCount, 0),
  };
}

export function summarizeBudgetSubtreeSnapshot(
  rows: ReadonlyArray<BudgetSubtreeDeleteSnapshotRow>,
  rootId: string,
): BudgetSubtreeDeleteSnapshot {
  const byId = new Map<string, BudgetSubtreeDeleteSnapshotRow>();
  for (const row of rows) {
    if (byId.has(row.id)) {
      throw new Error("Budget subtree snapshot contains duplicate rows.");
    }
    byId.set(row.id, row);
  }
  const root = byId.get(rootId);
  if (!root) throw new Error("Budget subtree snapshot root is missing.");

  const childrenByParent = new Map<
    string,
    BudgetSubtreeDeleteSnapshotRow[]
  >();
  for (const row of rows) {
    if (row.parentId === null || !byId.has(row.parentId)) continue;
    const children = childrenByParent.get(row.parentId) ?? [];
    children.push(row);
    childrenByParent.set(row.parentId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.id.localeCompare(right.id));
  }

  const color = new Map<string, 0 | 1 | 2>();
  const summaries = new Map<string, BudgetSubtreeDeleteSnapshot>();
  const stack: Array<{
    row: BudgetSubtreeDeleteSnapshotRow;
    exiting: boolean;
  }> = [{ row: root, exiting: false }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const currentColor = color.get(frame.row.id) ?? 0;
    if (frame.exiting) {
      const childSnapshots = (childrenByParent.get(frame.row.id) ?? []).map(
        (child) => {
          const snapshot = summaries.get(child.id);
          if (!snapshot) {
            throw new Error("Budget subtree child snapshot is missing.");
          }
          return { id: child.id, ...snapshot };
        },
      );
      summaries.set(
        frame.row.id,
        summarizeBudgetSubtreeNode(frame.row, childSnapshots),
      );
      color.set(frame.row.id, 2);
      continue;
    }
    if (currentColor !== 0) {
      throw new Error("Budget subtree snapshot contains a cycle.");
    }
    color.set(frame.row.id, 1);
    stack.push({ row: frame.row, exiting: true });
    const children = childrenByParent.get(frame.row.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ row: children[index], exiting: false });
    }
  }

  if (color.size !== rows.length) {
    throw new Error("Budget subtree snapshot contains disconnected rows.");
  }
  const snapshot = summaries.get(rootId);
  if (!snapshot || snapshot.itemCount !== rows.length) {
    throw new Error("Budget subtree snapshot is incomplete.");
  }
  return snapshot;
}
