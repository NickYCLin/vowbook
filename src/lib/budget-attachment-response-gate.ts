import "server-only";

import { BudgetAttachmentPreviewBusyError } from "@/lib/budget-attachment-preview";

export const MAX_ACTIVE_BUDGET_ATTACHMENT_RESPONSES = 3;
export const MAX_WAITING_BUDGET_ATTACHMENT_RESPONSES = 8;

type ResponseGateOptions = {
  maxActive?: number;
  maxActivePerUser?: number;
  maxActivePerWorkspace?: number;
  maxWaiting?: number;
  maxWaitingPerUser?: number;
  maxWaitingPerWorkspace?: number;
};

type ResponseSlotRequest = {
  signal?: AbortSignal;
  userId: string;
  workspaceId: string;
};

type ResponseSlot = {
  release: () => void;
};

type QueueEntry = ResponseSlotRequest & {
  onAbort: () => void;
  reject: (reason: unknown) => void;
  resolve: (slot: ResponseSlot) => void;
};

function assertLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid attachment response gate limit.");
  }
}

function abortError(): DOMException {
  return new DOMException("The attachment response was aborted.", "AbortError");
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrement(counts: Map<string, number>, key: string): void {
  const next = (counts.get(key) ?? 1) - 1;
  if (next > 0) counts.set(key, next);
  else counts.delete(key);
}

function createResponseGate(options: ResponseGateOptions = {}) {
  const maxActive = options.maxActive ?? MAX_ACTIVE_BUDGET_ATTACHMENT_RESPONSES;
  const maxActivePerUser = options.maxActivePerUser ?? 1;
  const maxActivePerWorkspace = options.maxActivePerWorkspace ?? 1;
  const maxWaiting =
    options.maxWaiting ?? MAX_WAITING_BUDGET_ATTACHMENT_RESPONSES;
  const maxWaitingPerUser = options.maxWaitingPerUser ?? 1;
  const maxWaitingPerWorkspace = options.maxWaitingPerWorkspace ?? 2;
  for (const limit of [
    maxActive,
    maxActivePerUser,
    maxActivePerWorkspace,
    maxWaiting,
    maxWaitingPerUser,
    maxWaitingPerWorkspace,
  ]) {
    assertLimit(limit);
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

  function removeWaiting(entry: QueueEntry): void {
    decrement(waitingByUser, entry.userId);
    decrement(waitingByWorkspace, entry.workspaceId);
    entry.signal?.removeEventListener("abort", entry.onAbort);
  }

  function drain(): void {
    while (active < maxActive) {
      const index = waiting.findIndex(canStart);
      if (index < 0) return;
      const [entry] = waiting.splice(index, 1);
      removeWaiting(entry);
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
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      active -= 1;
      decrement(activeByUser, entry.userId);
      decrement(activeByWorkspace, entry.workspaceId);
      drain();
    };
    entry.resolve({ release });
  }

  return function acquire(request: ResponseSlotRequest): Promise<ResponseSlot> {
    return new Promise((resolve, reject) => {
      if (request.signal?.aborted) {
        reject(abortError());
        return;
      }
      const entry: QueueEntry = {
        ...request,
        onAbort: () => {
          const index = waiting.indexOf(entry);
          if (index < 0) return;
          waiting.splice(index, 1);
          removeWaiting(entry);
          reject(abortError());
          drain();
        },
        reject,
        resolve,
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

export const acquireBudgetAttachmentResponseSlot = createResponseGate();

export function createBudgetAttachmentResponseGateForTests(
  options: ResponseGateOptions = {},
) {
  return createResponseGate(options);
}
