import { describe, expect, it, vi } from "vitest";
import { BudgetAttachmentPreviewBusyError } from "./budget-attachment-preview";
import { createBudgetAttachmentPreviewRequestGateForTests } from "./budget-attachment-preview-request-gate";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}

describe("budget attachment preview request gate", () => {
  it("keeps one principal and workspace from occupying both global workers", async () => {
    const gate = createBudgetAttachmentPreviewRequestGateForTests({
      maxActive: 2,
      maxActivePerUser: 1,
      maxActivePerWorkspace: 1,
      maxWaiting: 8,
    });
    const firstRelease = deferred();
    const secondRelease = deferred();
    const firstStarted = vi.fn();
    const samePrincipalStarted = vi.fn();
    const otherWorkspaceStarted = vi.fn();

    const first = gate({
      task: async () => {
        firstStarted();
        await firstRelease.promise;
        return "first";
      },
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const samePrincipal = gate({
      task: async () => {
        samePrincipalStarted();
        return "same";
      },
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const otherWorkspace = gate({
      task: async () => {
        otherWorkspaceStarted();
        await secondRelease.promise;
        return "other";
      },
      userId: "user-2",
      workspaceId: "workspace-2",
    });

    await vi.waitFor(() => {
      expect(firstStarted).toHaveBeenCalledTimes(1);
      expect(otherWorkspaceStarted).toHaveBeenCalledTimes(1);
    });
    expect(samePrincipalStarted).not.toHaveBeenCalled();

    firstRelease.resolve();
    await expect(first).resolves.toBe("first");
    await expect(samePrincipal).resolves.toBe("same");
    secondRelease.resolve();
    await expect(otherWorkspace).resolves.toBe("other");
  });

  it("removes an aborted queued request and reclaims its queue slot", async () => {
    const gate = createBudgetAttachmentPreviewRequestGateForTests({
      maxActive: 1,
      maxActivePerUser: 1,
      maxActivePerWorkspace: 1,
      maxWaiting: 1,
      maxWaitingPerUser: 1,
      maxWaitingPerWorkspace: 1,
    });
    const release = deferred();
    const controller = new AbortController();

    const active = gate({
      task: async () => {
        await release.promise;
        return "active";
      },
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const aborted = gate({
      signal: controller.signal,
      task: async () => "must-not-run",
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

    const replacement = gate({
      task: async () => "replacement",
      userId: "user-2",
      workspaceId: "workspace-2",
    });
    release.resolve();
    await expect(active).resolves.toBe("active");
    await expect(replacement).resolves.toBe("replacement");
  });

  it("rejects work beyond the global or principal waiting budget", async () => {
    const gate = createBudgetAttachmentPreviewRequestGateForTests({
      maxActive: 1,
      maxActivePerUser: 1,
      maxActivePerWorkspace: 1,
      maxWaiting: 2,
      maxWaitingPerUser: 1,
      maxWaitingPerWorkspace: 2,
    });
    const release = deferred();

    const active = gate({
      task: async () => {
        await release.promise;
      },
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const waiting = gate({
      task: async () => undefined,
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    await expect(
      gate({
        task: async () => undefined,
        userId: "user-1",
        workspaceId: "workspace-1",
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentPreviewBusyError);

    release.resolve();
    await active;
    await waiting;
  });
});
