import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: async () => ({ id: auth.id }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveWeddingSpeechAction } from "@/actions/wedding-speeches";
import { getWeddingTimelinePageData } from "@/lib/wedding-timeline-list";

const enabled = process.env.VOWBOOK_DB_INTEGRATION === "1";
const db = new PrismaClient();
const idle = { status: "idle" as const };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function seed(role: "OWNER" | "VIEWER" = "OWNER") {
  const user = await db.user.create({
    data: { googleSubject: `speech-${role}`, email: `speech-${role.toLowerCase()}@example.test` },
  });
  auth.id = user.id;
  return db.weddingWorkspace.create({
    data: {
      name: "致詞測試",
      createdById: user.id,
      memberships: { create: { userId: user.id, role } },
    },
  });
}

(enabled ? describe : describe.skip).sequential("PostgreSQL wedding speeches", () => {
  beforeEach(async () => {
    await db.weddingWorkspace.deleteMany();
    await db.user.deleteMany();
  });
  afterAll(async () => {
    if (enabled) {
      await db.weddingWorkspace.deleteMany();
      await db.user.deleteMany();
    }
    await db.$disconnect();
  });

  it("creates, updates, rejects stale edits and clears a speech", async () => {
    const workspace = await seed();
    expect(
      await saveWeddingSpeechAction(
        workspace.id,
        idle,
        form({ kind: "GROOM_PARENTS", content: "爸、媽\n謝謝你們", expectedVersion: "" }),
      ),
    ).toMatchObject({ status: "success" });
    // 另一個分頁也以為還沒有稿子，第二次建立要被擋下。
    expect(
      await saveWeddingSpeechAction(
        workspace.id,
        idle,
        form({ kind: "GROOM_PARENTS", content: "重複", expectedVersion: "" }),
      ),
    ).toMatchObject({ code: "STALE", draft: "重複" });

    let data = await getWeddingTimelinePageData(workspace.id);
    expect(data.speeches).toEqual({
      GROOM_PARENTS: { content: "爸、媽\n謝謝你們", version: 0 },
      BRIDE_PARENTS: null,
    });

    expect(
      await saveWeddingSpeechAction(
        workspace.id,
        idle,
        form({ kind: "GROOM_PARENTS", content: "新版", expectedVersion: "0" }),
      ),
    ).toMatchObject({ status: "success" });
    expect(
      await saveWeddingSpeechAction(
        workspace.id,
        idle,
        form({ kind: "GROOM_PARENTS", content: "舊版", expectedVersion: "0" }),
      ),
    ).toMatchObject({ code: "STALE" });

    expect(
      await saveWeddingSpeechAction(
        workspace.id,
        idle,
        form({ kind: "GROOM_PARENTS", content: " ", expectedVersion: "1" }),
      ),
    ).toMatchObject({ status: "success", message: "已清空致詞稿。" });
    data = await getWeddingTimelinePageData(workspace.id);
    expect(data.speeches.GROOM_PARENTS).toBeNull();
  });

  it("does not let a viewer write", async () => {
    const workspace = await seed("VIEWER");
    expect(
      await saveWeddingSpeechAction(
        workspace.id,
        idle,
        form({ kind: "BRIDE_PARENTS", content: "稿", expectedVersion: "" }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(await db.weddingSpeech.count()).toBe(0);
  });
});
