import { describe, expect, it } from "vitest";
import {
  parseWeddingGameNoteCliArguments,
  parseWeddingGameNotePlanJson,
  runWeddingGameNoteCli,
  updateWeddingGameNotes,
  WeddingGameNoteValidationError,
} from "./wedding-game-note-operator.mjs";

const workspaceId = "synthetic_workspace";
const actorUserId = "synthetic_editor";
const row = { participantId: "cmsyntheticparticipant01", game: "BROCCOLI", name: "甲", expectedVersion: 2, note: "  新的介紹  " };

function planJson(updates: unknown[] = [row]) {
  return JSON.stringify({ version: 1, updates });
}

function fakeClient(options: { role?: string | null; workspaceExists?: boolean; matchCount?: number }) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>, config: unknown) => {
      expect(config).toEqual({ isolationLevel: "Serializable" });
      return callback({
        membership: { findUnique: async () => (options.role ? { role: options.role } : null) },
        weddingWorkspace: {
          findUnique: async () => (options.workspaceExists === false ? null : { id: workspaceId }),
        },
        weddingGameParticipant: {
          count: async () => options.matchCount ?? 1,
          updateMany: async (args: Record<string, unknown>) => {
            calls.push(args);
            return { count: 1 };
          },
        },
      });
    },
    $disconnect: async () => undefined,
  };
}

describe("wedding game note operator", () => {
  it("trims notes and rejects bad rows", () => {
    expect(parseWeddingGameNotePlanJson(planJson()).updates[0].note).toBe("新的介紹");
    for (const updates of [
      [],
      [{ ...row, game: "DANCE" }],
      [{ ...row, note: "字".repeat(201) }],
      [{ ...row, note: "  " }],
      [{ ...row, expectedVersion: -1 }],
      [{ ...row, sortOrder: 3 }],
      [row, row],
    ]) {
      expect(() => parseWeddingGameNotePlanJson(planJson(updates))).toThrow(WeddingGameNoteValidationError);
    }
  });

  it("requires matching confirmations", () => {
    const base = ["--workspace-id", "w", "--confirm-workspace-id", "w", "--actor-user-id", "u", "--confirm-actor-user-id", "u", "--plan", "/tmp/p.json"];
    expect(parseWeddingGameNoteCliArguments(base)).toMatchObject({ apply: false });
    expect(() => parseWeddingGameNoteCliArguments(base.map((v, i) => (i === 3 ? "x" : v)))).toThrow("不一致");
    expect(() => parseWeddingGameNoteCliArguments(base.map((v, i) => (i === 7 ? "x" : v)))).toThrow("不一致");
  });

  it("updates only the note with a version guard on apply", async () => {
    const plan = parseWeddingGameNotePlanJson(planJson());
    const dry = fakeClient({ role: "OWNER" });
    expect(await updateWeddingGameNotes({ client: dry, workspaceId, actorUserId, plan })).toMatchObject({ applied: false, update: 1, conflict: 0 });
    expect(dry.calls).toHaveLength(0);

    const live = fakeClient({ role: "OWNER" });
    expect(await updateWeddingGameNotes({ client: live, workspaceId, actorUserId, plan, apply: true })).toMatchObject({ applied: true, update: 1 });
    expect(live.calls).toEqual([{
      where: { id: "cmsyntheticparticipant01", workspaceId, game: "BROCCOLI", name: "甲", version: 2 },
      data: { note: "新的介紹", version: { increment: 1 } },
    }]);
  });

  it("stops the whole batch when any row changed since it was read", async () => {
    const client = fakeClient({ role: "OWNER", matchCount: 0 });
    const summary = await updateWeddingGameNotes({ client, workspaceId, actorUserId, plan: parseWeddingGameNotePlanJson(planJson()), apply: true });
    expect(summary).toMatchObject({ applied: false, update: 0, conflict: 1 });
    expect(client.calls).toHaveLength(0);
  });

  it("refuses viewers and missing workspaces", async () => {
    const plan = parseWeddingGameNotePlanJson(planJson());
    await expect(updateWeddingGameNotes({ client: fakeClient({ role: "VIEWER" }), workspaceId, actorUserId, plan, apply: true })).rejects.toThrow("編輯權限");
    await expect(updateWeddingGameNotes({ client: fakeClient({ role: "OWNER", workspaceExists: false }), workspaceId, actorUserId, plan, apply: true })).rejects.toThrow("找不到");
  });

  it("keeps the plan outside the repository and prints only counts", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const argv = ["--workspace-id", workspaceId, "--confirm-workspace-id", workspaceId, "--actor-user-id", actorUserId, "--confirm-actor-user-id", actorUserId, "--plan", "/outside/p.json", "--apply"];
    const deps = {
      databaseUrl: "postgresql://synthetic",
      repositoryRoot: "/repo",
      resolveRealPath: async (p: string) => p,
      readCheckedFile: async () => ({ isFile: true, text: planJson() }),
      createClient: () => fakeClient({ role: "OWNER" }),
      writeOutput: (line: string) => out.push(line),
      writeError: (line: string) => err.push(line),
    };
    expect(await runWeddingGameNoteCli(argv, deps)).toBe(0);
    expect(out).toEqual(["mode=apply applied=true update=1 conflict=0"]);
    const inside = [...argv];
    inside[9] = "/repo/p.json";
    expect(await runWeddingGameNoteCli(inside, deps)).toBe(1);
    expect(err.at(-1)).toContain("repository 外");
  });
});
