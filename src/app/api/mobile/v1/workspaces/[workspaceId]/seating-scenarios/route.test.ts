import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  seat: vi.fn(),
  addTable: vi.fn(),
  updateTable: vi.fn(),
  removeTable: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/seating-scenarios", async () => {
  class SeatingScenarioNotFoundError extends Error {}
  class SeatingScenarioStaleError extends Error {}
  return {
    SeatingScenarioNotFoundError,
    SeatingScenarioStaleError,
    loadSeatingScenarioList: mocks.list,
    loadSeatingScenarioDetail: mocks.detail,
    createSeatingScenarioFromLive: mocks.create,
    renameSeatingScenario: mocks.rename,
    deleteSeatingScenario: mocks.remove,
    seatGuestInScenario: mocks.seat,
    addScenarioTable: mocks.addTable,
    updateScenarioTable: mocks.updateTable,
    removeScenarioTable: mocks.removeTable,
    applySeatingScenario: mocks.apply,
  };
});

import { SeatingScenarioValidationError } from "@/domain/seating-scenario";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { SeatingScenarioStaleError } from "@/lib/seating-scenarios";
import { GET as list, POST as create } from "./route";
import { DELETE as remove, GET as detail, PATCH as rename } from "./[scenarioId]/route";
import { PATCH as seat } from "./[scenarioId]/seats/route";
import { POST as addTable } from "./[scenarioId]/tables/route";
import { DELETE as removeTable, PATCH as updateTable } from "./[scenarioId]/tables/[tableId]/route";
import { POST as apply } from "./[scenarioId]/apply/route";

const fingerprint = "a".repeat(64);
const send = (method: string, value?: unknown) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
const ws = { params: Promise.resolve({ workspaceId: "w1" }) };
const sc = { params: Promise.resolve({ workspaceId: "w1", scenarioId: "s1" }) };
const tb = { params: Promise.resolve({ workspaceId: "w1", scenarioId: "s1", tableId: "t1" }) };

describe("手機座位方案 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    for (const fn of [mocks.rename, mocks.remove, mocks.seat, mocks.addTable, mocks.updateTable, mocks.removeTable]) {
      fn.mockResolvedValue(undefined);
    }
  });

  it("列表只回手機需要的欄位", async () => {
    mocks.list.mockResolvedValue({ role: "OWNER", canEdit: true, drafts: [{ id: "s1" }], backups: [] });
    const response = await list(send("GET"), ws);
    expect(await response.json()).toEqual({ canEdit: true, drafts: [{ id: "s1" }], backups: [] });
    expect(mocks.list).toHaveBeenCalledWith("w1", "server-user");
  });

  it("建立方案只收名稱", async () => {
    mocks.create.mockResolvedValue({ id: "s2" });
    expect((await create(send("POST", { name: "少開一桌" }), ws)).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("w1", "server-user", "少開一桌");
    expect((await create(send("POST", { name: "x", workspaceId: "w9" }), ws)).status).toBe(400);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("名稱不合規則回 400，版本衝突回 409", async () => {
    mocks.create.mockRejectedValueOnce(new SeatingScenarioValidationError("請輸入方案名稱。"));
    const invalid = await create(send("POST", { name: "" }), ws);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).message).toBe("請輸入方案名稱。");
    mocks.rename.mockRejectedValueOnce(new SeatingScenarioStaleError("方案剛剛被其他人修改"));
    expect((await rename(send("PATCH", { name: "A", expectedVersion: 1 }), sc)).status).toBe(409);
  });

  it("唯讀成員修改時回 403", async () => {
    mocks.remove.mockRejectedValueOnce(new WorkspaceAccessDeniedError());
    const response = await remove(send("DELETE", { expectedVersion: 0 }), sc);
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("沒有這場婚宴的編輯權限。");
  });

  it("明細不外露角色與婚宴名稱", async () => {
    mocks.detail.mockResolvedValue({
      role: "OWNER", canEdit: true, workspaceName: "W", scenario: { id: "s1" }, tables: [], unseated: [],
      assumptions: [], preview: { canApply: true }, liveFingerprint: fingerprint,
    });
    const body = await (await detail(send("GET"), sc)).json();
    expect(body).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("workspaceName");
    expect(body.liveFingerprint).toBe(fingerprint);
  });

  it("換桌可以傳 null 代表不入座，版本必須是整數", async () => {
    expect((await seat(send("PATCH", { guestId: "g1", tableId: null, expectedVersion: 3 }), sc)).status).toBe(200);
    expect(mocks.seat).toHaveBeenCalledWith("w1", "server-user", "s1", "g1", null, 3);
    expect((await seat(send("PATCH", { guestId: "g1", tableId: "t1", expectedVersion: "3" }), sc)).status).toBe(400);
    expect((await seat(send("PATCH", { guestId: "", tableId: "t1", expectedVersion: 3 }), sc)).status).toBe(400);
    expect(mocks.seat).toHaveBeenCalledTimes(1);
  });

  it("方案桌次的 id 只看路徑", async () => {
    const body = { name: "主桌", capacity: 12, notes: "", expectedVersion: 2 };
    expect((await addTable(send("POST", body), sc)).status).toBe(201);
    expect((await updateTable(send("PATCH", body), tb)).status).toBe(200);
    expect(mocks.updateTable).toHaveBeenCalledWith("w1", "server-user", "s1", "t1", { name: "主桌", capacity: 12, notes: "" }, 2);
    expect((await updateTable(send("PATCH", { ...body, position: 1 }), tb)).status).toBe(400);
    expect((await removeTable(send("DELETE", { expectedVersion: 2 }), tb)).status).toBe(200);
    expect(mocks.removeTable).toHaveBeenCalledWith("w1", "server-user", "s1", "t1", 2);
  });

  it("套用要帶正式安排指紋", async () => {
    mocks.apply.mockResolvedValue({ backupId: "b1", movedCount: 1 });
    const ok = await apply(send("POST", { expectedVersion: 4, expectedLiveFingerprint: fingerprint }), sc);
    expect(ok.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith("w1", "server-user", "s1", 4, fingerprint);
    expect((await apply(send("POST", { expectedVersion: 4 }), sc)).status).toBe(400);
    expect((await apply(send("POST", { expectedVersion: 4, expectedLiveFingerprint: "abc" }), sc)).status).toBe(400);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });
});
