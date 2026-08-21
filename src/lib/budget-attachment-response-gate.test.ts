import { describe, expect, it, vi } from "vitest";
import { BudgetAttachmentPreviewBusyError } from "./budget-attachment-preview";
import { createBudgetAttachmentResponseGateForTests } from "./budget-attachment-response-gate";

describe("budget attachment response gate", () => {
  it("holds a principal lease until release while another workspace can stream", async () => {
    const acquire = createBudgetAttachmentResponseGateForTests({
      maxActive: 2,
      maxActivePerUser: 1,
      maxActivePerWorkspace: 1,
      maxWaiting: 4,
    });
    const first = await acquire({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    let samePrincipalSettled = false;
    const samePrincipal = acquire({
      userId: "user-1",
      workspaceId: "workspace-1",
    }).finally(() => {
      samePrincipalSettled = true;
    });
    const other = await acquire({
      userId: "user-2",
      workspaceId: "workspace-2",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(samePrincipalSettled).toBe(false);
    first.release();
    const next = await samePrincipal;
    next.release();
    other.release();
  });

  it("removes aborted waiters and bounds each principal queue", async () => {
    const acquire = createBudgetAttachmentResponseGateForTests({
      maxActive: 1,
      maxActivePerUser: 1,
      maxActivePerWorkspace: 1,
      maxWaiting: 1,
      maxWaitingPerUser: 1,
      maxWaitingPerWorkspace: 1,
    });
    const active = await acquire({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const controller = new AbortController();
    const aborted = acquire({
      signal: controller.signal,
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    await expect(
      acquire({ userId: "user-1", workspaceId: "workspace-1" }),
    ).rejects.toBeInstanceOf(BudgetAttachmentPreviewBusyError);

    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    const replacementPromise = acquire({
      userId: "user-2",
      workspaceId: "workspace-2",
    });
    active.release();
    const replacement = await replacementPromise;
    replacement.release();
  });

  it("does not release an active lease while uncancellable work is still running", async () => {
    const acquire = createBudgetAttachmentResponseGateForTests({
      maxActive: 1,
      maxActivePerUser: 1,
      maxActivePerWorkspace: 1,
      maxWaiting: 1,
    });
    const controller = new AbortController();
    const active = await acquire({
      signal: controller.signal,
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    let replacementSettled = false;
    const replacement = acquire({
      userId: "user-2",
      workspaceId: "workspace-2",
    }).finally(() => {
      replacementSettled = true;
    });

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replacementSettled).toBe(false);

    active.release();
    const next = await replacement;
    next.release();
  });

  it("makes release idempotent", async () => {
    const acquire = createBudgetAttachmentResponseGateForTests({ maxActive: 1 });
    const first = await acquire({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    first.release();
    first.release();
    const second = await acquire({
      userId: "user-2",
      workspaceId: "workspace-2",
    });
    const released = vi.fn(second.release);
    released();
    expect(released).toHaveBeenCalledTimes(1);
  });
});
