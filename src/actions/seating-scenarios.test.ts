import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const lib = vi.hoisted(() => {
  class SeatingScenarioNotFoundError extends Error {
    constructor() {
      super("找不到這個方案，可能已被刪除。");
    }
  }
  class SeatingScenarioStaleError extends Error {
    constructor(message = "方案剛剛被其他人修改，請重新整理後再試。") {
      super(message);
    }
  }
  return {
    SeatingScenarioNotFoundError,
    SeatingScenarioStaleError,
    addScenarioTable: vi.fn(),
    applySeatingScenario: vi.fn(),
    createSeatingScenarioFromLive: vi.fn(),
    deleteSeatingScenario: vi.fn(),
    removeScenarioTable: vi.fn(),
    renameSeatingScenario: vi.fn(),
    seatGuestInScenario: vi.fn(),
    updateScenarioTable: vi.fn(),
  };
});
const { requireCurrentUser, revalidatePath, redirect } = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/seating-scenarios", () => lib);
vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

import {
  applySeatingScenarioAction,
  createSeatingScenarioAction,
  seatScenarioGuestAction,
} from "./seating-scenarios";

const idle = { status: "idle" as const };
const fingerprint = "a".repeat(64);

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("seating scenario actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
  });

  it("建立方案用登入者身分，成功後導向方案頁", async () => {
    lib.createSeatingScenarioFromLive.mockResolvedValue({ id: "scenario_1" });

    await expect(
      createSeatingScenarioAction("workspace_1", idle, form({ name: "王家全到", userId: "attacker" })),
    ).rejects.toThrow("NEXT_REDIRECT:/workspaces/workspace_1/tables/scenarios/scenario_1");
    expect(lib.createSeatingScenarioFromLive).toHaveBeenCalledWith("workspace_1", "session_user", "王家全到");
  });

  it("沒有權限時回傳錯誤，不導向", async () => {
    lib.createSeatingScenarioFromLive.mockRejectedValue(new WorkspaceAccessDeniedError());

    const state = await createSeatingScenarioAction("workspace_1", idle, form({ name: "方案" }));
    expect(state.status).toBe("error");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("排座時空白桌次代表不入座，版本必須是數字", async () => {
    lib.seatGuestInScenario.mockResolvedValue(undefined);

    await seatScenarioGuestAction(
      "workspace_1",
      "scenario_1",
      idle,
      form({ guestId: "guest_1", tableId: "", expectedVersion: "3" }),
    );
    expect(lib.seatGuestInScenario).toHaveBeenCalledWith("workspace_1", "session_user", "scenario_1", "guest_1", null, 3);

    const invalid = await seatScenarioGuestAction(
      "workspace_1",
      "scenario_1",
      idle,
      form({ guestId: "guest_1", tableId: "table_1", expectedVersion: "abc" }),
    );
    expect(invalid).toEqual({ status: "error", message: "版本資訊無效，請重新整理後再試。" });
    expect(lib.seatGuestInScenario).toHaveBeenCalledOnce();
  });

  it("套用時檢查差異指紋格式，並把舊資料的錯誤轉成可讀訊息", async () => {
    const tampered = await applySeatingScenarioAction(
      "workspace_1",
      "scenario_1",
      idle,
      form({ expectedVersion: "2", expectedLiveFingerprint: "not-a-hash" }),
    );
    expect(tampered.status).toBe("error");
    expect(lib.applySeatingScenario).not.toHaveBeenCalled();

    lib.applySeatingScenario.mockRejectedValueOnce(
      new lib.SeatingScenarioStaleError("正式安排剛剛被修改，請重新檢視差異後再套用。"),
    );
    const stale = await applySeatingScenarioAction(
      "workspace_1",
      "scenario_1",
      idle,
      form({ expectedVersion: "2", expectedLiveFingerprint: fingerprint }),
    );
    expect(stale).toEqual({ status: "error", message: "正式安排剛剛被修改，請重新檢視差異後再套用。" });
  });

  it("套用成功後重新整理整個工作區並告知備份名稱", async () => {
    lib.applySeatingScenario.mockResolvedValue({ backupId: "backup_1", backupName: "套用前的安排 9/23 22:40" });

    const state = await applySeatingScenarioAction(
      "workspace_1",
      "scenario_1",
      idle,
      form({ expectedVersion: "2", expectedLiveFingerprint: fingerprint }),
    );
    expect(lib.applySeatingScenario).toHaveBeenCalledWith("workspace_1", "session_user", "scenario_1", 2, fingerprint);
    expect(state.status).toBe("success");
    expect(state.message).toContain("套用前的安排 9/23 22:40");
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces/workspace_1", "layout");
  });

  it("非預期錯誤不外洩內部訊息", async () => {
    lib.applySeatingScenario.mockRejectedValue(new Error("connection refused at 10.0.0.5"));

    const state = await applySeatingScenarioAction(
      "workspace_1",
      "scenario_1",
      idle,
      form({ expectedVersion: "2", expectedLiveFingerprint: fingerprint }),
    );
    expect(state).toEqual({ status: "error", message: "目前無法儲存座位方案，請稍後再試。" });
  });
});
