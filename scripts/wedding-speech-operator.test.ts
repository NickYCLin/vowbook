import { describe, expect, it } from "vitest";
import {
  appendWeddingSpeeches,
  formatWeddingSpeechSummary,
  parseWeddingSpeechCliArguments,
  parseWeddingSpeechPlanJson,
  runWeddingSpeechCli,
  WeddingSpeechOperatorValidationError,
} from "./wedding-speech-operator.mjs";

const workspaceId = "synthetic_workspace";
const actorUserId = "synthetic_editor";

function planJson(speeches: unknown[] = [{ kind: "GROOM_PARENTS", content: "爸、媽，\r\n謝謝你們。  \n" }]) {
  return JSON.stringify({ version: 1, speeches });
}

function fakeClient(options: { role?: string | null; workspaceExists?: boolean; existingKinds?: string[] }) {
  const created: Array<Record<string, unknown>> = [];
  const client = {
    created,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>, config: unknown) => {
      expect(config).toEqual({ isolationLevel: "Serializable" });
      return callback({
        membership: {
          findUnique: async () => (options.role ? { role: options.role } : null),
        },
        weddingWorkspace: {
          findUnique: async () => (options.workspaceExists === false ? null : { id: workspaceId }),
        },
        weddingSpeech: {
          findMany: async () => (options.existingKinds ?? []).map((kind) => ({ kind })),
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return data;
          },
        },
      });
    },
    $disconnect: async () => undefined,
  };
  return client;
}

describe("wedding speech operator", () => {
  it("normalizes content the same way the website editor does", () => {
    const plan = parseWeddingSpeechPlanJson(planJson());
    expect(plan.speeches).toEqual([{ kind: "GROOM_PARENTS", content: "爸、媽，\n謝謝你們。" }]);
  });

  it("rejects unknown kinds, empty or oversized content, duplicates and extra fields", () => {
    for (const speeches of [
      [{ kind: "BEST_MAN", content: "嗨" }],
      [{ kind: "GROOM_PARENTS", content: "   " }],
      [{ kind: "GROOM_PARENTS", content: "字".repeat(3001) }],
      [{ kind: "GROOM_PARENTS", content: "a" }, { kind: "GROOM_PARENTS", content: "b" }],
      [{ kind: "GROOM_PARENTS", content: "a", version: 3 }],
      [],
    ]) {
      expect(() => parseWeddingSpeechPlanJson(planJson(speeches))).toThrow(
        WeddingSpeechOperatorValidationError,
      );
    }
  });

  it("requires matching workspace and actor confirmations", () => {
    const base = ["--workspace-id", "w", "--confirm-workspace-id", "w", "--actor-user-id", "u", "--confirm-actor-user-id", "u", "--plan", "/tmp/p.json"];
    expect(parseWeddingSpeechCliArguments(base)).toMatchObject({ workspaceId: "w", actorUserId: "u", apply: false });
    expect(() => parseWeddingSpeechCliArguments(base.map((v, i) => (i === 3 ? "x" : v)))).toThrow("婚宴工作區不一致");
    expect(() => parseWeddingSpeechCliArguments(base.map((v, i) => (i === 7 ? "x" : v)))).toThrow("操作者不一致");
    expect(() => parseWeddingSpeechCliArguments([...base, "--user-role", "OWNER"])).toThrow("不支援的參數");
  });

  it("does not write on dry-run and creates on apply for an editor", async () => {
    const plan = parseWeddingSpeechPlanJson(planJson());
    const dry = fakeClient({ role: "OWNER" });
    expect(await appendWeddingSpeeches({ client: dry, workspaceId, actorUserId, plan })).toMatchObject({ applied: false, create: 1, conflict: 0 });
    expect(dry.created).toHaveLength(0);

    const live = fakeClient({ role: "PARTNER" });
    expect(await appendWeddingSpeeches({ client: live, workspaceId, actorUserId, plan, apply: true })).toMatchObject({ applied: true, create: 1 });
    expect(live.created).toEqual([{ workspaceId, kind: "GROOM_PARENTS", content: "爸、媽，\n謝謝你們。" }]);
  });

  it("never overwrites an existing speech", async () => {
    const client = fakeClient({ role: "OWNER", existingKinds: ["GROOM_PARENTS"] });
    const summary = await appendWeddingSpeeches({ client, workspaceId, actorUserId, plan: parseWeddingSpeechPlanJson(planJson()), apply: true });
    expect(summary).toMatchObject({ applied: false, create: 0, conflict: 1 });
    expect(client.created).toHaveLength(0);
  });

  it("refuses viewers and missing workspaces", async () => {
    const plan = parseWeddingSpeechPlanJson(planJson());
    await expect(appendWeddingSpeeches({ client: fakeClient({ role: "VIEWER" }), workspaceId, actorUserId, plan, apply: true })).rejects.toThrow("編輯權限");
    await expect(appendWeddingSpeeches({ client: fakeClient({ role: null }), workspaceId, actorUserId, plan, apply: true })).rejects.toThrow("編輯權限");
    await expect(appendWeddingSpeeches({ client: fakeClient({ role: "OWNER", workspaceExists: false }), workspaceId, actorUserId, plan, apply: true })).rejects.toThrow("找不到");
  });

  it("keeps the plan outside the repository and prints only aggregates", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const argv = ["--workspace-id", workspaceId, "--confirm-workspace-id", workspaceId, "--actor-user-id", actorUserId, "--confirm-actor-user-id", actorUserId, "--plan", "/outside/plan.json", "--apply"];
    const deps = {
      databaseUrl: "postgresql://synthetic",
      repositoryRoot: "/repo",
      resolveRealPath: async (p: string) => p,
      readCheckedFile: async () => ({ isFile: true, text: planJson() }),
      createClient: () => fakeClient({ role: "OWNER" }),
      writeOutput: (line: string) => out.push(line),
      writeError: (line: string) => err.push(line),
    };
    expect(await runWeddingSpeechCli(argv, deps)).toBe(0);
    expect(out).toEqual(["mode=apply applied=true create=1 conflict=0"]);
    expect(out.join("")).not.toContain("謝謝");

    const inside = [...argv];
    inside[9] = "/repo/plan.json";
    expect(await runWeddingSpeechCli(inside, deps)).toBe(1);
    expect(err.at(-1)).toContain("repository 外");
  });

  it("formats a summary without content", () => {
    expect(formatWeddingSpeechSummary({ mode: "dry-run", applied: false, create: 1, conflict: 0 })).toBe(
      "mode=dry-run applied=false create=1 conflict=0",
    );
  });
});
