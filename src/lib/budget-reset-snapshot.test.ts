import { describe, expect, it } from "vitest";
import {
  summarizeBudgetResetSnapshot,
  summarizeBudgetSubtreeSnapshot,
} from "./budget-reset-snapshot";

describe("Budget reset snapshot", () => {
  it("is stable across row order and changes with a version or attachment ID", () => {
    const rows = [
      {
        id: "b",
        version: 2,
        source: "NOTION" as const,
        attachments: [{ id: "z" }, { id: "a" }],
      },
      {
        id: "a",
        version: 1,
        source: "MANUAL" as const,
        attachments: [],
      },
    ];
    const snapshot = summarizeBudgetResetSnapshot(rows);
    expect(summarizeBudgetResetSnapshot(rows.toReversed()).token).toBe(
      snapshot.token,
    );
    expect(
      summarizeBudgetResetSnapshot([
        rows[0],
        { ...rows[1], version: 2 },
      ]).token,
    ).not.toBe(snapshot.token);
    expect(
      summarizeBudgetResetSnapshot([
        { ...rows[0], attachments: [{ id: "z" }] },
        rows[1],
      ]).token,
    ).not.toBe(snapshot.token);
  });
});

describe("Budget subtree delete snapshot", () => {
  const rows = [
    {
      id: "root",
      parentId: "fixed_parent",
      version: 1,
      source: "MANUAL" as const,
      attachments: [],
    },
    {
      id: "child_group",
      parentId: "root",
      version: 2,
      source: "NOTION" as const,
      attachments: [],
    },
    {
      id: "expense",
      parentId: "child_group",
      version: 3,
      source: "NOTION" as const,
      attachments: [{ id: "receipt_b" }, { id: "receipt_a" }],
    },
  ];

  it("is stable across row and attachment order while binding hierarchy and every row", () => {
    const snapshot = summarizeBudgetSubtreeSnapshot(rows, "root");
    expect(snapshot).toMatchObject({ itemCount: 3, attachmentCount: 2 });
    expect(
      summarizeBudgetSubtreeSnapshot(
        [
          { ...rows[2], attachments: rows[2].attachments.toReversed() },
          rows[0],
          rows[1],
        ],
        "root",
      ).token,
    ).toBe(snapshot.token);
    expect(
      summarizeBudgetSubtreeSnapshot(
        rows.map((row) =>
          row.id === "expense" ? { ...row, version: 4 } : row,
        ),
        "root",
      ).token,
    ).not.toBe(snapshot.token);
    expect(
      summarizeBudgetSubtreeSnapshot(
        rows.map((row) =>
          row.id === "expense" ? { ...row, parentId: "root" } : row,
        ),
        "root",
      ).token,
    ).not.toBe(snapshot.token);
    expect(
      summarizeBudgetSubtreeSnapshot(
        rows.map((row) =>
          row.id === "expense" ? { ...row, attachments: [] } : row,
        ),
        "root",
      ).token,
    ).not.toBe(snapshot.token);
  });

  it("rejects duplicate, cyclic, disconnected, and missing-root input", () => {
    expect(() =>
      summarizeBudgetSubtreeSnapshot([rows[0], rows[0]], "root"),
    ).toThrow(/duplicate/u);
    expect(() =>
      summarizeBudgetSubtreeSnapshot(
        [
          { ...rows[0], parentId: "child_group" },
          { ...rows[1], parentId: "root" },
        ],
        "root",
      ),
    ).toThrow(/cycle/u);
    expect(() =>
      summarizeBudgetSubtreeSnapshot(
        [...rows, { ...rows[2], id: "orphan", parentId: "outside" }],
        "root",
      ),
    ).toThrow(/disconnected/u);
    expect(() => summarizeBudgetSubtreeSnapshot(rows, "missing")).toThrow(
      /root is missing/u,
    );
  });
});
