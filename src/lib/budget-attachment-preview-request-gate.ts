import "server-only";

import {
  BudgetAttachmentPreviewBusyError,
  MAX_ACTIVE_BUDGET_ATTACHMENT_PREVIEWS,
  MAX_WAITING_BUDGET_ATTACHMENT_PREVIEWS,
} from "@/lib/budget-attachment-preview";

type PreviewRequestTask<T> = () => Promise<T>;

type PreviewRequest<T> = {
  signal?: AbortSignal;
  task: PreviewRequestTask<T>;
  userId: string;
  workspaceId: string;
};

type PreviewRequestGateOptions = {
  maxActive?: number;
  maxActivePerUser?: number;
  maxActivePerWorkspace?: number;
  maxWaiting?: number;
  maxWaitingPerUser?: number;
  maxWaitingPerWorkspace?: number;
};

type QueueEntry = {
  onAbort: () => void;
  reject: (reason: unknown) => void;
  resolve: (value: unknown) => void;
  signal?: AbortSignal;
  task: PreviewRequestTask<unknown>;
  userId: string;
  workspaceId: string;
};

function assertGateLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid preview request gate limit.");
  }
}

function abortError(): DOMException {
  return new DOMException("The preview request was aborted.", "AbortError");
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrement(counts: Map<string, number>, key: string): void {
  const next = (counts.get(key) ?? 1) - 1;
  if (next > 0) counts.set(key, next);
  else counts.delete(key);
}

function createPreviewRequestGate(options: PreviewRequestGateOptions = {}) {
  const maxActive = options.maxActive ?? MAX_ACTIVE_BUDGET_ATTACHMENT_PREVIEWS;
  const maxActivePerUser = options.maxActivePerUser ?? 1;
  const maxActivePerWorkspace = options.maxActivePerWorkspace ?? 1;
  const maxWaiting =
    options.maxWaiting ?? MAX_WAITING_BUDGET_ATTACHMENT_PREVIEWS;
  const maxWaitingPerUser = options.maxWaitingPerUser ?? 2;
  const maxWaitingPerWorkspace = options.maxWaitingPerWorkspace ?? 4;
  for (const limit of [
    maxActive,
    maxActivePerUser,
    maxActivePerWorkspace,
    maxWaiting,
    maxWaitingPerUser,
    maxWaitingPerWorkspace,
  ]) {
    assertGateLimit(limit);
  }

  const activeByUser = new Map<string, number>();
  const activeByWorkspace = new Map<string, number>();
  const waitingByUser = new Map<string, number>();
  const waitingByWorkspace = new Map<string, number>();
  const waiting: QueueEntry[] = [];
  let active = 0;

  function canStart(entry: QueueEntry): boolean {
    return (
      active < maxActive &&
      (activeByUser.get(entry.userId) ?? 0) < maxActivePerUser &&
      (activeByWorkspace.get(entry.workspaceId) ?? 0) <
        maxActivePerWorkspace
    );
  }

  function removeWaitingCounts(entry: QueueEntry): void {
    decrement(waitingByUser, entry.userId);
    decrement(waitingByWorkspace, entry.workspaceId);
    entry.signal?.removeEventListener("abort", entry.onAbort);
  }

  function drain(): void {
    while (active < maxActive) {
      const index = waiting.findIndex(canStart);
      if (index < 0) return;
      const [entry] = waiting.splice(index, 1);
      removeWaitingCounts(entry);
      start(entry);
    }
  }

  function start(entry: QueueEntry): void {
    if (entry.signal?.aborted) {
      entry.reject(abortError());
      drain();
      return;
    }
    active += 1;
    increment(activeByUser, entry.userId);
    increment(activeByWorkspace, entry.workspaceId);
    void (async () => {
      try {
        entry.resolve(await entry.task());
      } catch (error) {
        entry.reject(error);
      } finally {
        active -= 1;
        decrement(activeByUser, entry.userId);
        decrement(activeByWorkspace, entry.workspaceId);
        drain();
      }
    })();
  }

  return function run<T>(request: PreviewRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (request.signal?.aborted) {
        reject(abortError());
        return;
      }
      const entry: QueueEntry = {
        onAbort: () => {
          const index = waiting.indexOf(entry);
          if (index < 0) return;
          waiting.splice(index, 1);
          removeWaitingCounts(entry);
          reject(abortError());
          drain();
        },
        reject,
        resolve: (value) => resolve(value as T),
        signal: request.signal,
        task: request.task as PreviewRequestTask<unknown>,
        userId: request.userId,
        workspaceId: request.workspaceId,
      };

      if (canStart(entry)) {
        start(entry);
        return;
      }
      if (
        waiting.length >= maxWaiting ||
        (waitingByUser.get(entry.userId) ?? 0) >= maxWaitingPerUser ||
        (waitingByWorkspace.get(entry.workspaceId) ?? 0) >=
          maxWaitingPerWorkspace
      ) {
        reject(new BudgetAttachmentPreviewBusyError());
        return;
      }
      waiting.push(entry);
      increment(waitingByUser, entry.userId);
      increment(waitingByWorkspace, entry.workspaceId);
      entry.signal?.addEventListener("abort", entry.onAbort, { once: true });
      if (entry.signal?.aborted) entry.onAbort();
    });
  };
}

export const runBudgetAttachmentPreviewRequest = createPreviewRequestGate();

export function createBudgetAttachmentPreviewRequestGateForTests(
  options: PreviewRequestGateOptions = {},
) {
  return createPreviewRequestGate(options);
}
