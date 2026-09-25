import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: async () => ({ id: auth.id }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addWeddingGameParticipantsAction,
  deleteWeddingGameParticipantAction,
  updateWeddingGameParticipantAction,
} from "@/actions/wedding-games";
import { getWeddingTimelinePageData } from "@/lib/wedding-timeline-list";

const enabled = process.env.VOWBOOK_DB_INTEGRATION === "1";
const db = new PrismaClient();
const idle = { status: "idle" as const };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function seed(name = "遊戲測試") {
  const user = await db.user.create({
    data: { googleSubject: `games-${name}`, email: `games-${name.length}@example.test` },
  });
  auth.id = user.id;
  return db.weddingWorkspace.create({
    data: {
      name,
      createdById: user.id,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
}

(enabled ? describe : describe.skip).sequential("PostgreSQL wedding games", () => {
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

  it("adds, edits and removes names per game in order", async () => {
    const workspace = await seed();
    expect(
      await addWeddingGameParticipantsAction(
        workspace.id,
        idle,
        form({ game: "BOUQUET", names: "小美、小安" }),
      ),
    ).toMatchObject({ status: "success" });
    await addWeddingGameParticipantsAction(
      workspace.id,
      idle,
      form({ game: "BOUQUET", names: "小華" }),
    );
    await addWeddingGameParticipantsAction(
      workspace.id,
      idle,
      form({ game: "BROCCOLI", names: "阿哲" }),
    );

    let data = await getWeddingTimelinePageData(workspace.id);
    expect(data.games.BOUQUET.map((row) => row.name)).toEqual(["小美", "小安", "小華"]);
    expect(data.games.BROCCOLI.map((row) => row.name)).toEqual(["阿哲"]);

    const first = data.games.BOUQUET[0];
    expect(
      await updateWeddingGameParticipantAction(
        workspace.id,
        first.id,
        idle,
        form({ name: "小美美", note: "室友", expectedVersion: String(first.version) }),
      ),
    ).toMatchObject({ status: "success" });
    expect(
      await updateWeddingGameParticipantAction(
        workspace.id,
        first.id,
        idle,
        form({ name: "舊版本", note: "", expectedVersion: String(first.version) }),
      ),
    ).toMatchObject({ code: "STALE" });

    const second = data.games.BOUQUET[1];
    expect(
      await deleteWeddingGameParticipantAction(
        workspace.id,
        second.id,
        idle,
        form({ expectedVersion: String(second.version) }),
      ),
    ).toMatchObject({ status: "success" });

    data = await getWeddingTimelinePageData(workspace.id);
    expect(data.games.BOUQUET).toMatchObject([
      { name: "小美美", note: "室友", version: 1 },
      { name: "小華", note: null },
    ]);
  });

  it("cannot touch another workspace's participant", async () => {
    const workspace = await seed();
    const other = await db.weddingWorkspace.create({
      data: {
        name: "其他婚宴",
        createdById: auth.id,
        memberships: { create: { userId: auth.id, role: "OWNER" } },
      },
    });
    const foreign = await db.weddingGameParticipant.create({
      data: { workspaceId: other.id, game: "BROCCOLI", name: "他人", sortOrder: 0 },
    });
    expect(
      await deleteWeddingGameParticipantAction(
        workspace.id,
        foreign.id,
        idle,
        form({ expectedVersion: "0" }),
      ),
    ).toMatchObject({ code: "STALE" });
    expect(await db.weddingGameParticipant.count()).toBe(1);
  });

  it("keeps positions unique when two editors add at the same time", async () => {
    const workspace = await seed();
    const results = await Promise.all(
      ["甲", "乙"].map((names) =>
        addWeddingGameParticipantsAction(
          workspace.id,
          idle,
          form({ game: "BOUQUET", names }),
        ),
      ),
    );
    const rows = await db.weddingGameParticipant.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { sortOrder: "asc" },
    });
    const succeeded = results.filter((result) => result.status === "success").length;
    expect(rows).toHaveLength(succeeded);
    expect(new Set(rows.map((row) => row.sortOrder)).size).toBe(rows.length);
  });

  it("denies viewers and non-members", async () => {
    const workspace = await seed();
    await db.membership.updateMany({
      where: { workspaceId: workspace.id },
      data: { role: "VIEWER" },
    });
    expect(
      await addWeddingGameParticipantsAction(
        workspace.id,
        idle,
        form({ game: "BOUQUET", names: "甲" }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    await expect(getWeddingTimelinePageData(workspace.id)).resolves.toMatchObject({
      games: { BOUQUET: [], BROCCOLI: [] },
    });
    await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
    await expect(getWeddingTimelinePageData(workspace.id)).rejects.toThrow();
    expect(await db.weddingGameParticipant.count()).toBe(0);
  });

  it("enforces name and position checks in the database", async () => {
    const workspace = await seed();
    await expect(
      db.weddingGameParticipant.create({
        data: { workspaceId: workspace.id, game: "BOUQUET", name: "  ", sortOrder: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      db.weddingGameParticipant.create({
        data: { workspaceId: workspace.id, game: "BOUQUET", name: "甲", sortOrder: -1 },
      }),
    ).rejects.toThrow();
  });
});
