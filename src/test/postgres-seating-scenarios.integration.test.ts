import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  addScenarioTable,
  applySeatingScenario,
  createSeatingScenarioFromLive,
  loadSeatingScenarioDetail,
  loadSeatingScenarioList,
  seatGuestInScenario,
  SeatingScenarioStaleError,
} from "@/lib/seating-scenarios";
import { SeatingScenarioValidationError } from "@/domain/seating-scenario";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
let sequence = 0;

afterAll(async () => {
  await prisma.$disconnect();
});

async function wedding() {
  sequence += 1;
  const user = await prisma.user.create({
    data: { googleSubject: `scenario-it-${sequence}-${Date.now()}`, email: `scenario-${sequence}@example.test` },
  });
  const workspace = await prisma.weddingWorkspace.create({
    data: {
      name: "方案測試",
      createdById: user.id,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const [first, second] = await Promise.all([
    prisma.seatingTable.create({ data: { workspaceId: workspace.id, position: 1, name: "主桌", capacity: 10 } }),
    prisma.seatingTable.create({ data: { workspaceId: workspace.id, position: 2, name: "男方親戚", capacity: 10 } }),
  ]);
  const guest = (name: string, attendanceStatus: "ATTENDING" | "UNDECIDED" | "DECLINED", partySize: number, seatingTableId: string | null) =>
    prisma.guest.create({
      data: { workspaceId: workspace.id, name, side: "SHARED", attendanceStatus, partySize, seatingTableId },
    });
  const a = await guest("甲", "ATTENDING", 4, first.id);
  const b = await guest("乙", "ATTENDING", 3, second.id);
  const c = await guest("丙", "UNDECIDED", 2, null);
  const d = await guest("丁", "DECLINED", 2, null);
  return { userId: user.id, workspaceId: workspace.id, tables: { first, second }, guests: { a, b, c, d } };
}

async function liveSeats(workspaceId: string) {
  const tables = await prisma.seatingTable.findMany({ where: { workspaceId }, orderBy: { position: "asc" } });
  const guests = await prisma.guest.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
  const rank = new Map(tables.map((table, index) => [table.id, index + 1]));
  return {
    tables: tables.map((table) => `${table.name}/${table.capacity}`),
    seats: Object.fromEntries(guests.map((guest) => [guest.name, guest.seatingTableId ? rank.get(guest.seatingTableId) ?? null : null])),
    attendance: Object.fromEntries(guests.map((guest) => [guest.name, guest.attendanceStatus])),
    versions: Object.fromEntries(guests.map((guest) => [guest.name, guest.version])),
  };
}

describeDatabase("PostgreSQL 座位方案", () => {
  it("從正式安排複製的草稿內容完全相同，且編輯草稿不會動到正式安排", async () => {
    const w = await wedding();
    const before = await liveSeats(w.workspaceId);
    const scenario = await createSeatingScenarioFromLive(w.workspaceId, w.userId, "王家全到");

    const detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    expect(detail.tables.map((table) => `${table.name}/${table.capacity}`)).toEqual(before.tables);
    expect(detail.preview.hasChanges).toBe(false);

    await seatGuestInScenario(w.workspaceId, w.userId, scenario.id, w.guests.c.id, detail.tables[1]!.id, detail.scenario.version);
    expect(await liveSeats(w.workspaceId)).toEqual(before);
  });

  it("套用後正式安排換成方案內容、自動備份舊安排，出席回覆完全不變", async () => {
    const w = await wedding();
    const before = await liveSeats(w.workspaceId);
    const scenario = await createSeatingScenarioFromLive(w.workspaceId, w.userId, "加開一桌");
    let detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    await addScenarioTable(w.workspaceId, w.userId, scenario.id, { name: "王家二", capacity: 8 }, detail.scenario.version);
    detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    const third = detail.tables[2]!;
    await seatGuestInScenario(w.workspaceId, w.userId, scenario.id, w.guests.b.id, third.id, detail.scenario.version);
    detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    await seatGuestInScenario(w.workspaceId, w.userId, scenario.id, w.guests.c.id, third.id, detail.scenario.version);
    detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    // 丁目前是不出席：草稿可以排，但套用時以實際回覆為準。
    await seatGuestInScenario(w.workspaceId, w.userId, scenario.id, w.guests.d.id, third.id, detail.scenario.version);
    detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);

    expect(detail.preview.willNotSeat.map((item) => item.name)).toEqual(["丁"]);
    expect(detail.preview.addedTableCount).toBe(1);

    await applySeatingScenario(w.workspaceId, w.userId, scenario.id, detail.scenario.version, detail.liveFingerprint);

    const after = await liveSeats(w.workspaceId);
    expect(after.tables).toEqual(["主桌/10", "男方親戚/10", "王家二/8"]);
    expect(after.seats).toEqual({ 丁: null, 丙: 3, 乙: 3, 甲: 1 });
    expect(after.attendance).toEqual(before.attendance);
    // 座位有變的人版本前進，網站上開著的舊表單才會被擋下；甲的座位號碼沒變但桌子重建了，也算。
    expect(after.versions["乙"]).toBeGreaterThan(before.versions["乙"]!);
    expect(after.versions["丙"]).toBeGreaterThan(before.versions["丙"]!);
    expect(after.versions["丁"]).toBe(before.versions["丁"]);

    const list = await loadSeatingScenarioList(w.workspaceId, w.userId);
    expect(list.backups).toHaveLength(1);
    const backup = await loadSeatingScenarioDetail(w.workspaceId, w.userId, list.backups[0]!.id);
    expect(backup.tables.map((table) => `${table.name}/${table.capacity}`)).toEqual(before.tables);
    expect(list.drafts.find((item) => item.id === scenario.id)?.matchesLive).toBe(true);
  });

  it("套用備份就能換回原本的安排", async () => {
    const w = await wedding();
    const original = await liveSeats(w.workspaceId);
    const scenario = await createSeatingScenarioFromLive(w.workspaceId, w.userId, "只留主桌");
    let detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    await seatGuestInScenario(w.workspaceId, w.userId, scenario.id, w.guests.b.id, null, detail.scenario.version);
    detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    await applySeatingScenario(w.workspaceId, w.userId, scenario.id, detail.scenario.version, detail.liveFingerprint);
    expect((await liveSeats(w.workspaceId)).seats["乙"]).toBeNull();

    const [backupSummary] = (await loadSeatingScenarioList(w.workspaceId, w.userId)).backups;
    const backup = await loadSeatingScenarioDetail(w.workspaceId, w.userId, backupSummary!.id);
    await applySeatingScenario(w.workspaceId, w.userId, backup.scenario.id, backup.scenario.version, backup.liveFingerprint);
    const restored = await liveSeats(w.workspaceId);
    expect(restored.tables).toEqual(original.tables);
    expect(restored.seats).toEqual(original.seats);
  });

  it("看完差異之後正式安排又被改過，就拒絕套用", async () => {
    const w = await wedding();
    const scenario = await createSeatingScenarioFromLive(w.workspaceId, w.userId, "過期的差異");
    const detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    await prisma.guest.update({ where: { id: w.guests.c.id }, data: { seatingTableId: w.tables.second.id } });
    const before = await liveSeats(w.workspaceId);

    await expect(
      applySeatingScenario(w.workspaceId, w.userId, scenario.id, detail.scenario.version, detail.liveFingerprint),
    ).rejects.toBeInstanceOf(SeatingScenarioStaleError);
    expect(await liveSeats(w.workspaceId)).toEqual(before);
    expect((await loadSeatingScenarioList(w.workspaceId, w.userId)).backups).toHaveLength(0);
  });

  it("超過座位時拒絕套用，正式安排原封不動", async () => {
    const w = await wedding();
    const scenario = await createSeatingScenarioFromLive(w.workspaceId, w.userId, "塞爆主桌");
    let detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    const main = detail.tables[0]!;
    for (const guestId of [w.guests.b.id, w.guests.c.id]) {
      await seatGuestInScenario(w.workspaceId, w.userId, scenario.id, guestId, main.id, detail.scenario.version);
      detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    }
    // 主桌 10 位：甲 4 + 乙 3 + 丙 2 = 9，還沒超過；把容量改小之後才會超過。
    await prisma.seatingScenarioTable.update({ where: { id: main.id }, data: { capacity: 6 } });
    detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
    expect(detail.preview.canApply).toBe(false);
    const before = await liveSeats(w.workspaceId);
    await expect(
      applySeatingScenario(w.workspaceId, w.userId, scenario.id, detail.scenario.version, detail.liveFingerprint),
    ).rejects.toBeInstanceOf(SeatingScenarioValidationError);
    expect(await liveSeats(w.workspaceId)).toEqual(before);
  });

  it("自動備份只留最近三份", async () => {
    const w = await wedding();
    const scenario = await createSeatingScenarioFromLive(w.workspaceId, w.userId, "反覆套用");
    for (let round = 0; round < 5; round += 1) {
      const detail = await loadSeatingScenarioDetail(w.workspaceId, w.userId, scenario.id);
      await applySeatingScenario(
        w.workspaceId, w.userId, scenario.id, detail.scenario.version, detail.liveFingerprint,
        new Date(Date.UTC(2026, 8, 23, 10, round)),
      );
    }
    const list = await loadSeatingScenarioList(w.workspaceId, w.userId);
    expect(list.backups).toHaveLength(3);
    expect(list.drafts).toHaveLength(1);
  });

  it("不能把別場婚宴的賓客排進方案，也不能動別場婚宴的方案", async () => {
    const mine = await wedding();
    const other = await wedding();
    const scenario = await createSeatingScenarioFromLive(mine.workspaceId, mine.userId, "隔離");
    const detail = await loadSeatingScenarioDetail(mine.workspaceId, mine.userId, scenario.id);

    await expect(
      seatGuestInScenario(mine.workspaceId, mine.userId, scenario.id, other.guests.a.id, detail.tables[0]!.id, detail.scenario.version),
    ).rejects.toBeInstanceOf(SeatingScenarioStaleError);
    // 別人的帳號拿著這個方案 id 也無法讀取或套用。
    await expect(loadSeatingScenarioDetail(mine.workspaceId, other.userId, scenario.id)).rejects.toThrow();
    await expect(
      applySeatingScenario(other.workspaceId, other.userId, scenario.id, detail.scenario.version, detail.liveFingerprint),
    ).rejects.toThrow();
    expect((await prisma.seatingScenarioAssignment.count({ where: { guestId: other.guests.a.id } }))).toBe(0);
  });
});
