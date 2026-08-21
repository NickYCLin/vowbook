import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiCurrentUser = vi.hoisted(() => vi.fn());
const assertBudgetAttachmentReadAccess = vi.hoisted(() => vi.fn());
const getBudgetAttachmentDownload = vi.hoisted(() => vi.fn());
const deleteBudgetAttachment = vi.hoisted(() => vi.fn());
const responseSlotRelease = vi.hoisted(() => vi.fn());
const acquireBudgetAttachmentResponseSlot = vi.hoisted(() => vi.fn());
const previewModule = vi.hoisted(() => {
  class BudgetAttachmentPreviewUnavailableError extends Error {
    constructor() {
      super("這個附件無法安全預覽，請改用下載。");
    }
  }
  class BudgetAttachmentPreviewBusyError extends Error {
    constructor() {
      super("目前預覽服務忙碌，請稍後再試。");
    }
  }
  return {
    BudgetAttachmentPreviewBusyError,
    BudgetAttachmentPreviewUnavailableError,
    MAX_ACTIVE_BUDGET_ATTACHMENT_PREVIEWS: 2,
    MAX_WAITING_BUDGET_ATTACHMENT_PREVIEWS: 8,
    createBudgetAttachmentPreview: vi.fn(),
  };
});

vi.mock("@/lib/api-current-user", () => ({ getApiCurrentUser }));
vi.mock("@/lib/budget-attachment-preview", () => previewModule);
vi.mock("@/lib/budget-attachment-response-gate", () => ({
  acquireBudgetAttachmentResponseSlot,
}));
vi.mock("@/lib/budget-attachments", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/budget-attachments")
  >("@/lib/budget-attachments");
  return {
    ...actual,
    assertBudgetAttachmentReadAccess,
    getBudgetAttachmentDownload,
    deleteBudgetAttachment,
  };
});

import {
  BudgetAttachmentPermissionError,
  BudgetAttachmentTargetError,
} from "@/lib/budget-attachments";
import { DELETE, GET } from "./route";

const context = {
  params: Promise.resolve({
    workspaceId: "workspace_1",
    budgetItemId: "expense_1",
    attachmentId: "attachment_1",
  }),
};
const url =
  "https://example.test/VowBook/api/workspaces/workspace_1/budget/expense_1/attachments/attachment_1";

describe("budget attachment item route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiCurrentUser.mockResolvedValue({ id: "viewer_1" });
    assertBudgetAttachmentReadAccess.mockResolvedValue(undefined);
    acquireBudgetAttachmentResponseSlot.mockResolvedValue({
      release: responseSlotRelease,
    });
    getBudgetAttachmentDownload.mockResolvedValue({
      originalName: "婚宴 場地合約.pdf",
      mediaType: "application/pdf",
      byteSize: 9,
      data: Buffer.from("%PDF-1.7"),
    });
    previewModule.createBudgetAttachmentPreview.mockResolvedValue({
      data: Buffer.from("safe-preview"),
      mediaType: "application/pdf",
    });
    deleteBudgetAttachment.mockResolvedValue(undefined);
  });

  it("returns 401 for unauthenticated download", async () => {
    getApiCurrentUser.mockResolvedValue(null);

    const response = await GET(new Request(url), context);

    expect(response.status).toBe(401);
    expect(getBudgetAttachmentDownload).not.toHaveBeenCalled();
    expect(previewModule.createBudgetAttachmentPreview).not.toHaveBeenCalled();
  });

  it("renders an accessible browser fallback when inline auth has expired", async () => {
    getApiCurrentUser.mockResolvedValue(null);

    const response = await GET(
      new Request(`${url}?disposition=inline`, {
        headers: { "sec-fetch-dest": "document" },
      }),
      context,
    );
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("登入狀態已失效");
    expect(html).not.toContain("下載原始檔");
  });

  it("renders the same accessible inline error inside only the same-origin branded iframe", async () => {
    getApiCurrentUser.mockResolvedValue(null);

    const response = await GET(
      new Request(`${url}?disposition=inline`, {
        headers: { "sec-fetch-dest": "iframe" },
      }),
      context,
    );
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self'",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("登入狀態已失效");
  });

  it("renders a branded same-origin iframe fallback when the attachment disappears after shell authorization", async () => {
    getBudgetAttachmentDownload.mockRejectedValueOnce(
      new BudgetAttachmentTargetError(),
    );

    const response = await GET(
      new Request(`${url}?disposition=inline`, {
        headers: { "sec-fetch-dest": "iframe" },
      }),
      context,
    );
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self'",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("附件預覽暫時無法使用");
  });

  it("renders a branded same-origin iframe fallback for unexpected auth resolution failures", async () => {
    getApiCurrentUser.mockRejectedValueOnce(new Error("unexpected auth failure"));

    const response = await GET(
      new Request(`${url}?disposition=inline`, {
        headers: { "sec-fetch-dest": "iframe" },
      }),
      context,
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self'",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain('role="alert"');
    expect(html).toContain("附件預覽暫時無法使用");
    expect(html).not.toContain("unexpected auth failure");
  });

  it("keeps the query-less VIEWER response as an authenticated download", async () => {
    const response = await GET(new Request(url), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe("9");
    expect(response.headers.get("content-disposition")).toContain(
      "attachment; filename=\"attachment.pdf\"; filename*=UTF-8''",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from("%PDF-1.7"),
    );
    expect(responseSlotRelease).toHaveBeenCalledTimes(1);
    expect(previewModule.createBudgetAttachmentPreview).not.toHaveBeenCalled();
    expect(getBudgetAttachmentDownload).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      budgetItemId: "expense_1",
      attachmentId: "attachment_1",
      currentUserId: "viewer_1",
    });
  });

  it("sanitizes only exact inline viewing after the authenticated service check", async () => {
    const downloadResponse = await GET(new Request(url), context);
    const inlineResponse = await GET(
      new Request(`${url}?disposition=inline`),
      context,
    );

    expect(downloadResponse.headers.get("content-disposition")).toContain(
      "attachment; filename=\"attachment.pdf\"; filename*=UTF-8''",
    );
    expect(inlineResponse.status).toBe(200);
    expect(inlineResponse.headers.get("content-disposition")).toContain(
      "inline; filename=\"attachment.pdf\"; filename*=UTF-8''",
    );
    expect(inlineResponse.headers.get("content-type")).toBe(
      "application/pdf",
    );
    expect(inlineResponse.headers.get("content-length")).toBe("12");
    expect(inlineResponse.headers.get("accept-ranges")).toBe("bytes");
    expect(inlineResponse.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(inlineResponse.headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
    expect(inlineResponse.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
    expect(Buffer.from(await inlineResponse.arrayBuffer())).toEqual(
      Buffer.from("safe-preview"),
    );
    expect(responseSlotRelease).toHaveBeenCalledTimes(1);
    expect(previewModule.createBudgetAttachmentPreview).toHaveBeenCalledTimes(1);
    expect(previewModule.createBudgetAttachmentPreview).toHaveBeenCalledWith(
      {
        data: expect.any(Buffer),
        mediaType: "application/pdf",
      },
      expect.any(AbortSignal),
    );
    expect(getBudgetAttachmentDownload).toHaveBeenCalledTimes(2);
    expect(
      getBudgetAttachmentDownload.mock.invocationCallOrder[1],
    ).toBeLessThan(
      previewModule.createBudgetAttachmentPreview.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["blank", "?disposition="],
    ["upper-case value", "?disposition=INLINE"],
    ["mixed-case key", "?Disposition=inline"],
    ["unknown", "?disposition=preview"],
    ["duplicate", "?disposition=inline&disposition=inline"],
    ["confused", "?disposition=inline&download=1"],
    ["percent-encoded", "?disposition=%69nline"],
  ])("keeps a %s query as attachment", async (_label, query) => {
    const response = await GET(new Request(`${url}${query}`), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "attachment; filename=\"attachment.pdf\"; filename*=UTF-8''",
    );
    expect(previewModule.createBudgetAttachmentPreview).not.toHaveBeenCalled();
  });

  it("keeps sandboxing while allowing the sanitized image document to render", async () => {
    getBudgetAttachmentDownload.mockResolvedValueOnce({
      originalName: "配置圖.png",
      mediaType: "image/png",
      byteSize: 8,
      data: Buffer.from("raw-image"),
    });
    previewModule.createBudgetAttachmentPreview.mockResolvedValueOnce({
      data: Buffer.from("safe-image"),
      mediaType: "image/png",
    });

    const response = await GET(
      new Request(`${url}?disposition=inline`),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("maps unsafe and busy inline previews to fixed 422 and 429 responses", async () => {
    previewModule.createBudgetAttachmentPreview
      .mockRejectedValueOnce(
        new previewModule.BudgetAttachmentPreviewUnavailableError(),
      )
      .mockRejectedValueOnce(new previewModule.BudgetAttachmentPreviewBusyError());

    const unsafe = await GET(
      new Request(`${url}?disposition=inline`),
      context,
    );
    expect(unsafe.status).toBe(422);
    expect(await unsafe.json()).toEqual({
      error: "這個附件無法安全預覽，請改用下載。",
    });
    expect(unsafe.headers.get("cache-control")).toBe("private, no-store");

    const busy = await GET(
      new Request(`${url}?disposition=inline`),
      context,
    );
    expect(busy.status).toBe(429);
    expect(await busy.json()).toEqual({
      error: "目前預覽服務忙碌，請稍後再試。",
    });
    expect(busy.headers.get("cache-control")).toBe("private, no-store");
    expect(busy.headers.get("retry-after")).toBe("5");
    expect(busy.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("renders a safe browser fallback with a query-less download link", async () => {
    previewModule.createBudgetAttachmentPreview.mockRejectedValueOnce(
      new previewModule.BudgetAttachmentPreviewUnavailableError(),
    );

    const response = await GET(
      new Request(`${url}?disposition=inline`, {
        headers: { "sec-fetch-dest": "document" },
      }),
      context,
    );
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html).toContain("這個附件無法安全預覽");
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      'href="/VowBook/api/workspaces/workspace_1/budget/expense_1/attachments/attachment_1"',
    );
    expect(html).not.toContain("?disposition=inline");
    expect(responseSlotRelease).toHaveBeenCalled();
  });

  it("keeps Retry-After on the browser busy fallback", async () => {
    previewModule.createBudgetAttachmentPreview.mockRejectedValueOnce(
      new previewModule.BudgetAttachmentPreviewBusyError(),
    );

    const response = await GET(
      new Request(`${url}?disposition=inline`, {
        headers: { "sec-fetch-dest": "document" },
      }),
      context,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.text()).toContain("附件預覽服務忙碌");
  });

  it.each([
    {
      createError: () => {
        const error =
          new previewModule.BudgetAttachmentPreviewUnavailableError();
        Object.defineProperty(error, "cause", {
          value: new Error("internal pdf parser detail"),
        });
        return error;
      },
      expectedGuidance: "請關閉此分頁，或下載原始檔。",
      expectedTitle: "這個附件無法安全預覽",
      retryAfter: null,
      status: 422,
    },
    {
      createError: () =>
        new previewModule.BudgetAttachmentPreviewBusyError(),
      expectedGuidance: "請稍後再試，或下載原始檔。",
      expectedTitle: "附件預覽服務忙碌",
      retryAfter: "5",
      status: 429,
    },
  ])(
    "renders a fixed $status iframe fallback without leaking internals",
    async ({
      createError,
      expectedGuidance,
      expectedTitle,
      retryAfter,
      status,
    }) => {
      previewModule.createBudgetAttachmentPreview.mockRejectedValueOnce(
        createError(),
      );

      const response = await GET(
        new Request(`${url}?disposition=inline`, {
          headers: { "sec-fetch-dest": "iframe" },
        }),
        context,
      );
      const html = await response.text();

      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'self'",
      );
      expect(response.headers.get("cross-origin-resource-policy")).toBe(
        "same-origin",
      );
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(html).toContain('role="alert"');
      expect(html).toContain("VowBook 安全附件預覽");
      expect(html).toContain(expectedTitle);
      expect(html).toContain(expectedGuidance);
      expect(html).toContain("下載原始檔");
      expect(html).not.toContain("internal pdf parser detail");
      expect(html.trimStart()).toMatch(/^<!doctype html>/iu);
      expect(html.trimStart()).not.toMatch(/^\{/u);
    },
  );

  it("limits one principal to one active and two waiting inline requests", async () => {
    let activeLoaders = 0;
    let maximumActiveLoaders = 0;
    let releaseLoaders: (() => void) | undefined;
    const loaderGate = new Promise<void>((resolve) => {
      releaseLoaders = resolve;
    });
    getBudgetAttachmentDownload.mockImplementation(async () => {
      activeLoaders += 1;
      maximumActiveLoaders = Math.max(maximumActiveLoaders, activeLoaders);
      await loaderGate;
      activeLoaders -= 1;
      return {
        originalName: "婚宴 場地合約.pdf",
        mediaType: "application/pdf",
        byteSize: 9,
        data: Buffer.from("%PDF-1.7"),
      };
    });

    const accepted = Array.from({ length: 3 }, () =>
      GET(new Request(`${url}?disposition=inline`), context),
    );
    try {
      await vi.waitFor(() =>
        expect(getBudgetAttachmentDownload).toHaveBeenCalledTimes(1),
      );
      expect(activeLoaders).toBe(1);

      const overflow = await GET(
        new Request(`${url}?disposition=inline`),
        context,
      );
      expect(overflow.status).toBe(429);
      expect(await overflow.json()).toEqual({
        error: "目前預覽服務忙碌，請稍後再試。",
      });
      expect(getBudgetAttachmentDownload).toHaveBeenCalledTimes(1);
    } finally {
      releaseLoaders?.();
      await Promise.all(accepted);
    }

    expect(maximumActiveLoaders).toBe(1);
    expect(getBudgetAttachmentDownload).toHaveBeenCalledTimes(3);
  });

  it("does not preview-gate query-less or ambiguous attachment downloads", async () => {
    let releaseLoaders: (() => void) | undefined;
    const loaderGate = new Promise<void>((resolve) => {
      releaseLoaders = resolve;
    });
    getBudgetAttachmentDownload.mockImplementation(async () => {
      await loaderGate;
      return {
        originalName: "婚宴 場地合約.pdf",
        mediaType: "application/pdf",
        byteSize: 9,
        data: Buffer.from("%PDF-1.7"),
      };
    });

    const inlineRequest = GET(
      new Request(`${url}?disposition=inline`),
      context,
    );
    try {
      await vi.waitFor(() =>
        expect(getBudgetAttachmentDownload).toHaveBeenCalledTimes(1),
      );

      const plainDownload = GET(new Request(url), context);
      const ambiguousDownload = GET(
        new Request(`${url}?disposition=inline&download=1`),
        context,
      );
      await vi.waitFor(() =>
        expect(getBudgetAttachmentDownload).toHaveBeenCalledTimes(3),
      );

      releaseLoaders?.();
      const [plainResponse, ambiguousResponse] = await Promise.all([
        plainDownload,
        ambiguousDownload,
      ]);
      expect(plainResponse.headers.get("content-disposition")).toContain(
        "attachment;",
      );
      expect(ambiguousResponse.headers.get("content-disposition")).toContain(
        "attachment;",
      );
    } finally {
      releaseLoaders?.();
      await inlineRequest;
    }
  });

  it("holds the response slot through an uncancellable BLOB read after abort", async () => {
    type Download = {
      byteSize: number;
      data: Buffer;
      mediaType: "application/pdf";
      originalName: string;
    };
    let resolveDownload: ((value: Download) => void) | undefined;
    getBudgetAttachmentDownload.mockReturnValue(
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
    );
    const controller = new AbortController();
    const responsePromise = GET(
      new Request(url, { signal: controller.signal }),
      context,
    );
    await vi.waitFor(() =>
      expect(getBudgetAttachmentDownload).toHaveBeenCalledTimes(1),
    );

    controller.abort();
    expect(responseSlotRelease).not.toHaveBeenCalled();
    resolveDownload?.({
      byteSize: 9,
      data: Buffer.from("%PDF-1.7"),
      mediaType: "application/pdf",
      originalName: "婚宴 場地合約.pdf",
    });

    await responsePromise;
    expect(responseSlotRelease).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["closed", "bytes=2-5", "2345", "bytes 2-5/10"],
    ["case-insensitive unit", "Bytes=2-5", "2345", "bytes 2-5/10"],
    ["open-ended", "bytes=6-", "6789", "bytes 6-9/10"],
    ["suffix", "bytes=-3", "789", "bytes 7-9/10"],
  ])(
    "serves a %s single range from sanitized inline bytes",
    async (_label, range, expectedBody, expectedContentRange) => {
      previewModule.createBudgetAttachmentPreview.mockResolvedValueOnce({
        data: Buffer.from("0123456789"),
        mediaType: "application/pdf",
      });

      const response = await GET(
        new Request(`${url}?disposition=inline`, {
          headers: { range },
        }),
        context,
      );

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(expectedContentRange);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/u);
      expect(response.headers.get("content-length")).toBe(
        String(expectedBody.length),
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("sandbox");
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
        expectedBody,
      );
    },
  );

  it.each(["bytes=20-", "bytes=-0"])(
    "returns a secure 416 for an unsatisfiable range %s",
    async (range) => {
      previewModule.createBudgetAttachmentPreview.mockResolvedValueOnce({
        data: Buffer.from("0123456789"),
        mediaType: "application/pdf",
      });

      const response = await GET(
        new Request(`${url}?disposition=inline`, { headers: { range } }),
        context,
      );

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("content-length")).toBe("0");
      expect(response.headers.get("content-disposition")).toContain(
        "inline; filename=\"attachment.pdf\"; filename*=UTF-8''",
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain(
        "sandbox",
      );
      expect(await response.text()).toBe("");
    },
  );

  it.each([
    "bytes=",
    "items=0-1",
    "bytes=0-1,3-4",
    "bytes=4-2",
    "bytes=abc-def",
  ])("ignores an invalid or unsupported range %s", async (range) => {
    previewModule.createBudgetAttachmentPreview.mockResolvedValueOnce({
      data: Buffer.from("0123456789"),
      mediaType: "application/pdf",
    });

    const response = await GET(
      new Request(`${url}?disposition=inline`, { headers: { range } }),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-disposition")).toContain(
      "inline; filename=\"attachment.pdf\"; filename*=UTF-8''",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(await response.text()).toBe("0123456789");
  });

  it("honors Range only when a supplied If-Range matches the strong preview ETag", async () => {
    previewModule.createBudgetAttachmentPreview.mockResolvedValue({
      data: Buffer.from("0123456789"),
      mediaType: "application/pdf",
    });
    const initial = await GET(
      new Request(`${url}?disposition=inline`),
      context,
    );
    const etag = initial.headers.get("etag");
    await initial.arrayBuffer();
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/u);

    const matching = await GET(
      new Request(`${url}?disposition=inline`, {
        headers: { range: "bytes=0-1", "if-range": etag! },
      }),
      context,
    );
    expect(matching.status).toBe(206);
    expect(await matching.text()).toBe("01");

    const stale = await GET(
      new Request(`${url}?disposition=inline`, {
        headers: { range: "bytes=0-1", "if-range": '"stale"' },
      }),
      context,
    );
    expect(stale.status).toBe(200);
    expect(stale.headers.get("content-range")).toBeNull();
    expect(await stale.text()).toBe("0123456789");
  });

  it("streams bounded chunks and copies only the requested Range", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/workspaces/[workspaceId]/budget/[budgetItemId]/attachments/[attachmentId]/route.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("Uint8Array.from");
    expect(source).toContain("new ReadableStream<Uint8Array>");
    expect(source).toContain("RESPONSE_CHUNK_BYTES");
    expect(source).toContain("controller.enqueue(data.subarray(offset, end))");
    expect(source).toContain("const body = Buffer.from(");
  });

  it("rejects missing and foreign attachment IDs before admission or BLOB load", async () => {
    assertBudgetAttachmentReadAccess.mockRejectedValueOnce(
      new BudgetAttachmentTargetError(),
    );

    const response = await GET(new Request(url), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "找不到可使用的附件。",
    });
    expect(acquireBudgetAttachmentResponseSlot).not.toHaveBeenCalled();
    expect(getBudgetAttachmentDownload).not.toHaveBeenCalled();
    expect(previewModule.createBudgetAttachmentPreview).not.toHaveBeenCalled();
  });

  it("rejects cross-origin DELETE before auth", async () => {
    const response = await DELETE(
      new Request(url, {
        method: "DELETE",
        headers: { host: "example.test", origin: "https://evil.test" },
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(getApiCurrentUser).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated same-origin DELETE", async () => {
    getApiCurrentUser.mockResolvedValue(null);

    const response = await DELETE(
      new Request(url, {
        method: "DELETE",
        headers: { host: "example.test", origin: "https://example.test" },
      }),
      context,
    );

    expect(response.status).toBe(401);
    expect(deleteBudgetAttachment).not.toHaveBeenCalled();
  });

  it("returns 403 for VIEWER delete and 204 for editor success", async () => {
    deleteBudgetAttachment.mockRejectedValueOnce(
      new BudgetAttachmentPermissionError(),
    );

    const denied = await DELETE(
      new Request(url, {
        method: "DELETE",
        headers: { host: "example.test", origin: "https://example.test" },
      }),
      context,
    );
    expect(denied.status).toBe(403);

    const deleted = await DELETE(
      new Request(url, {
        method: "DELETE",
        headers: { host: "example.test", origin: "https://example.test" },
      }),
      context,
    );
    expect(deleted.status).toBe(204);
  });
});
