import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/guest-list", () => ({ loadGuestsForUser: mocks.load }));

import { mobileGiftBook } from "./workspace-data";

function guest(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "g1",
    version: 1,
    name: "林有陽",
    category: "GUEST",
    side: "PARTNER_A",
    attendanceStatus: "ATTENDING",
    giftExemptWithCake: false,
    details: null,
    seatingTable: { number: 1 },
    weddingGift: null,
    ...overrides,
  };
}

describe("手機禮金簿", () => {
  it("不列出不收禮金又沒登記的人，但保留已登記的", async () => {
    mocks.load.mockResolvedValue({
      role: "OWNER",
      guests: [
        guest(),
        guest({
          id: "g2",
          name: "新娘母親",
          category: "FAMILY",
          details: { relationshipLabel: "母親" },
        }),
        guest({
          id: "g3",
          name: "伴娘",
          giftExemptWithCake: true,
          weddingGift: { id: "gift3", amount: 2000, notes: null, version: 1 },
        }),
      ],
    });

    const page = await mobileGiftBook("ws1", "user1");

    expect(page.entries.map((entry) => entry.id)).toEqual(["g1", "g3"]);
    expect(page.summary.pendingCount).toBe(1);
    expect(page.summary.recordedCount).toBe(1);
    expect(page.summary.totalAmount).toBe(2000);
  });
});
