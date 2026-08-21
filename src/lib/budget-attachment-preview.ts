import "server-only";

import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import type { BudgetAttachmentMediaType } from "@/domain/budget-attachment";

export const MAX_BUDGET_ATTACHMENT_PREVIEW_PAGES = 50;
export const MAX_BUDGET_ATTACHMENT_PREVIEW_PIXELS = 20_000_000;
export const MAX_BUDGET_ATTACHMENT_PREVIEW_DIMENSION = 2_200;
export const MAX_BUDGET_ATTACHMENT_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_BUDGET_ATTACHMENT_PREVIEW_TRANSFORM_MS = 15_000;
export const BUDGET_ATTACHMENT_PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
export const BUDGET_ATTACHMENT_PREVIEW_CACHE_BYTES = 64 * 1024 * 1024;
export const BUDGET_ATTACHMENT_PREVIEW_NEGATIVE_CACHE_TTL_MS = 30_000;
const MAX_BUDGET_ATTACHMENT_PREVIEW_NEGATIVE_CACHE_ENTRIES = 256;
export const MAX_ACTIVE_BUDGET_ATTACHMENT_PREVIEWS = 2;
export const MAX_WAITING_BUDGET_ATTACHMENT_PREVIEWS = 8;

export type BudgetAttachmentPreviewInput = {
  data: Buffer;
  mediaType: BudgetAttachmentMediaType;
};

export type BudgetAttachmentPreview = {
  data: Buffer;
  mediaType: BudgetAttachmentMediaType;
};

type PreviewLimits = {
  maxDimension: number;
  maxPages: number;
  maxSanitizedOutputBytes: number;
  maxTotalPixels: number;
};

type PreviewManagerOptions = {
  maxActive?: number;
  maxCacheBytes?: number;
  maxNegativeEntries?: number;
  maxWaiting?: number;
  negativeTtlMs?: number;
  now?: () => number;
  sanitize?: (
    input: BudgetAttachmentPreviewInput,
    signal?: AbortSignal,
  ) => Promise<BudgetAttachmentPreview>;
  ttlMs?: number;
};

type QueueEntry = {
  input: BudgetAttachmentPreviewInput;
  key: string;
  reject: (reason: unknown) => void;
  resolve: (preview: BudgetAttachmentPreview) => void;
  signal?: AbortSignal;
};

type CacheEntry = {
  expiresAt: number;
  preview: BudgetAttachmentPreview;
};

type WorkerSuccessMessage = {
  data: ArrayBuffer;
  mediaType: BudgetAttachmentMediaType;
  ok: true;
};

type WorkerRunOptions = {
  behavior?: "crash" | "delay";
  deadlineMs: number;
  limits: PreviewLimits;
  signal?: AbortSignal;
};

const DEFAULT_LIMITS: PreviewLimits = {
  maxDimension: MAX_BUDGET_ATTACHMENT_PREVIEW_DIMENSION,
  maxPages: MAX_BUDGET_ATTACHMENT_PREVIEW_PAGES,
  maxSanitizedOutputBytes: MAX_BUDGET_ATTACHMENT_PREVIEW_BYTES,
  maxTotalPixels: MAX_BUDGET_ATTACHMENT_PREVIEW_PIXELS,
};
const TRANSFORM_WORKER_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "budget-attachment-preview-worker.cjs",
);
const TRANSFORM_PROCESS_EXEC_ARGV = [
  "--max-old-space-size=192",
  "--max-semi-space-size=32",
  "--stack-size=4096",
] as const;

export class BudgetAttachmentPreviewUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("這個附件無法安全預覽，請改用下載。", { cause });
    this.name = "BudgetAttachmentPreviewUnavailableError";
  }
}

export class BudgetAttachmentPreviewBusyError extends Error {
  constructor() {
    super("目前預覽服務忙碌，請稍後再試。");
    this.name = "BudgetAttachmentPreviewBusyError";
  }
}

function assertPositiveLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BudgetAttachmentPreviewUnavailableError();
  }
}

function isWorkerSuccessMessage(value: unknown): value is WorkerSuccessMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkerSuccessMessage>;
  return (
    candidate.ok === true &&
    Object.prototype.toString.call(candidate.data) === "[object ArrayBuffer]" &&
    (candidate.mediaType === "application/pdf" ||
      candidate.mediaType === "image/jpeg" ||
      candidate.mediaType === "image/png" ||
      candidate.mediaType === "image/webp")
  );
}

function copyForWorkerTransfer(data: Buffer): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function runTransformWorker(
  input: BudgetAttachmentPreviewInput,
  options: WorkerRunOptions,
): Promise<BudgetAttachmentPreview> {
  assertPositiveLimit(options.deadlineMs);
  assertPositiveLimit(options.limits.maxDimension);
  assertPositiveLimit(options.limits.maxPages);
  assertPositiveLimit(options.limits.maxSanitizedOutputBytes);
  assertPositiveLimit(options.limits.maxTotalPixels);
  if (options.signal?.aborted) {
    return Promise.reject(new BudgetAttachmentPreviewUnavailableError());
  }

  let worker: ChildProcess;
  try {
    const forkProcess = process.getBuiltinModule("node:child_process").fork;
    worker = forkProcess(TRANSFORM_WORKER_PATH, [], {
      cwd: process.cwd(),
      env: { NODE_ENV: process.env.NODE_ENV ?? "production" },
      execArgv: [...TRANSFORM_PROCESS_EXEC_ARGV],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  } catch {
    return Promise.reject(new BudgetAttachmentPreviewUnavailableError());
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const removeListeners = (): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (preview: BudgetAttachmentPreview | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeListeners();
      try {
        worker.kill("SIGKILL");
      } catch {
        // The public error is deliberately fixed even if process cleanup reports one.
      }
      try {
        if (worker.connected) worker.disconnect();
        worker.unref();
      } catch {
        // The process has already exited.
      }
      if (preview) {
        resolve(preview);
      } else {
        reject(new BudgetAttachmentPreviewUnavailableError());
      }
    };
    const onMessage = (message: unknown) => {
      if (
        !isWorkerSuccessMessage(message) ||
        message.mediaType !== input.mediaType ||
        message.data.byteLength < 1 ||
        message.data.byteLength > options.limits.maxSanitizedOutputBytes
      ) {
        finish(null);
        return;
      }
      finish({
        data: Buffer.from(message.data),
        mediaType: message.mediaType,
      });
    };
    const onError = () => {
      finish(null);
    };
    const onExit = () => {
      finish(null);
    };
    const onAbort = () => {
      finish(null);
    };

    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      finish(null);
    }, options.deadlineMs);
    timer.unref();
    if (options.signal?.aborted) {
      finish(null);
      return;
    }
    worker.send(
      {
        behavior: options.behavior,
        data: copyForWorkerTransfer(input.data),
        limits: options.limits,
        mediaType: input.mediaType,
      },
      (error) => {
        if (error) finish(null);
      },
    );
  });
}

function sanitizeUncached(
  input: BudgetAttachmentPreviewInput,
  overrides: Partial<PreviewLimits> = {},
  signal?: AbortSignal,
): Promise<BudgetAttachmentPreview> {
  return runTransformWorker(input, {
    deadlineMs: MAX_BUDGET_ATTACHMENT_PREVIEW_TRANSFORM_MS,
    limits: { ...DEFAULT_LIMITS, ...overrides },
    signal,
  });
}

function previewCacheKey(input: BudgetAttachmentPreviewInput): string {
  return (
    input.mediaType +
    ":" +
    createHash("sha256").update(input.data).digest("hex")
  );
}

function assertManagerLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid preview manager limit.");
  }
}

function createPreviewManager(
  options: PreviewManagerOptions = {},
): (
  input: BudgetAttachmentPreviewInput,
  signal?: AbortSignal,
) => Promise<BudgetAttachmentPreview> {
  const maxActive = options.maxActive ?? MAX_ACTIVE_BUDGET_ATTACHMENT_PREVIEWS;
  const maxCacheBytes =
    options.maxCacheBytes ?? BUDGET_ATTACHMENT_PREVIEW_CACHE_BYTES;
  const maxNegativeEntries =
    options.maxNegativeEntries ??
    MAX_BUDGET_ATTACHMENT_PREVIEW_NEGATIVE_CACHE_ENTRIES;
  const maxWaiting =
    options.maxWaiting ?? MAX_WAITING_BUDGET_ATTACHMENT_PREVIEWS;
  const now = options.now ?? Date.now;
  const negativeTtlMs =
    options.negativeTtlMs ?? BUDGET_ATTACHMENT_PREVIEW_NEGATIVE_CACHE_TTL_MS;
  const sanitize = options.sanitize ?? sanitizeUncached;
  const ttlMs = options.ttlMs ?? BUDGET_ATTACHMENT_PREVIEW_CACHE_TTL_MS;
  assertManagerLimit(maxActive);
  assertManagerLimit(maxCacheBytes);
  assertManagerLimit(maxNegativeEntries);
  assertManagerLimit(maxWaiting);
  assertManagerLimit(negativeTtlMs);
  assertManagerLimit(ttlMs);

  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<BudgetAttachmentPreview>>();
  const negativeCache = new Map<string, number>();
  const queue: QueueEntry[] = [];
  let active = 0;
  let cacheBytes = 0;

  function removeCacheEntry(key: string, entry: CacheEntry): void {
    cache.delete(key);
    cacheBytes -= entry.preview.data.byteLength;
  }

  function cached(key: string): BudgetAttachmentPreview | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      removeCacheEntry(key, entry);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.preview;
  }

  function putCache(key: string, preview: BudgetAttachmentPreview): void {
    if (preview.data.byteLength > maxCacheBytes) return;
    const existing = cache.get(key);
    if (existing) removeCacheEntry(key, existing);
    for (const [candidateKey, candidate] of cache) {
      if (candidate.expiresAt <= now()) {
        removeCacheEntry(candidateKey, candidate);
      }
    }
    while (
      cacheBytes + preview.data.byteLength > maxCacheBytes &&
      cache.size > 0
    ) {
      const oldestKey = cache.keys().next().value as string;
      const oldest = cache.get(oldestKey);
      if (!oldest) break;
      removeCacheEntry(oldestKey, oldest);
    }
    cache.set(key, { expiresAt: now() + ttlMs, preview });
    negativeCache.delete(key);
    cacheBytes += preview.data.byteLength;
  }

  function isNegativeCached(key: string): boolean {
    const expiresAt = negativeCache.get(key);
    if (!expiresAt) return false;
    if (expiresAt <= now()) {
      negativeCache.delete(key);
      return false;
    }
    return true;
  }

  function putNegativeCache(key: string): void {
    for (const [candidateKey, expiresAt] of negativeCache) {
      if (expiresAt <= now()) negativeCache.delete(candidateKey);
    }
    negativeCache.delete(key);
    while (negativeCache.size >= maxNegativeEntries) {
      const oldestKey = negativeCache.keys().next().value as string;
      negativeCache.delete(oldestKey);
    }
    negativeCache.set(key, now() + negativeTtlMs);
  }

  function start(entry: QueueEntry): void {
    active += 1;
    void (async () => {
      try {
        const cacheHit = cached(entry.key);
        if (cacheHit) {
          entry.resolve(cacheHit);
          return;
        }
        if (isNegativeCached(entry.key)) {
          throw new BudgetAttachmentPreviewUnavailableError();
        }
        const preview = await sanitize(entry.input, entry.signal);
        if (
          !Buffer.isBuffer(preview.data) ||
          preview.data.byteLength < 1 ||
          preview.mediaType !== entry.input.mediaType
        ) {
          throw new BudgetAttachmentPreviewUnavailableError();
        }
        putCache(entry.key, preview);
        entry.resolve(preview);
      } catch (error) {
        if (
          error instanceof BudgetAttachmentPreviewUnavailableError &&
          !entry.signal?.aborted
        ) {
          putNegativeCache(entry.key);
        }
        entry.reject(error);
      } finally {
        active -= 1;
        const next = queue.shift();
        if (next) start(next);
      }
    })();
  }

  function enqueue(
    input: BudgetAttachmentPreviewInput,
    key: string,
    signal?: AbortSignal,
  ): Promise<BudgetAttachmentPreview> {
    return new Promise((resolve, reject) => {
      const entry = { input, key, reject, resolve, signal };
      if (active < maxActive) {
        start(entry);
        return;
      }
      if (queue.length >= maxWaiting) {
        reject(new BudgetAttachmentPreviewBusyError());
        return;
      }
      queue.push(entry);
    });
  }

  return async (input, signal) => {
    const key = previewCacheKey(input);
    const cacheHit = cached(key);
    if (cacheHit) return cacheHit;
    if (isNegativeCached(key)) {
      throw new BudgetAttachmentPreviewUnavailableError();
    }
    const existing = inFlight.get(key);
    if (existing) return existing;
    const task = enqueue(input, key, signal);
    inFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  };
}

const defaultPreviewManager = createPreviewManager();

export async function createBudgetAttachmentPreview(
  input: BudgetAttachmentPreviewInput,
  signal?: AbortSignal,
): Promise<BudgetAttachmentPreview> {
  return defaultPreviewManager(input, signal);
}

export function sanitizeBudgetAttachmentPreviewUncachedForTests(
  input: BudgetAttachmentPreviewInput,
  overrides: Partial<PreviewLimits> = {},
): Promise<BudgetAttachmentPreview> {
  return sanitizeUncached(input, overrides);
}

export function runBudgetAttachmentPreviewWorkerForTests(
  input: BudgetAttachmentPreviewInput,
  options: {
    behavior: "crash" | "delay";
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<BudgetAttachmentPreview> {
  return runTransformWorker(input, {
    behavior: options.behavior,
    deadlineMs: options.timeoutMs,
    limits: DEFAULT_LIMITS,
    signal: options.signal,
  });
}

export function createBudgetAttachmentPreviewManagerForTests(
  options: PreviewManagerOptions = {},
): (input: BudgetAttachmentPreviewInput) => Promise<BudgetAttachmentPreview> {
  return createPreviewManager(options);
}
