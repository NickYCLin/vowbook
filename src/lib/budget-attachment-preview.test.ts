import { createCanvas } from "@napi-rs/canvas";
import { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
} from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  BUDGET_ATTACHMENT_PREVIEW_CACHE_BYTES,
  BUDGET_ATTACHMENT_PREVIEW_CACHE_TTL_MS,
  BUDGET_ATTACHMENT_PREVIEW_NEGATIVE_CACHE_TTL_MS,
  MAX_BUDGET_ATTACHMENT_PREVIEW_TRANSFORM_MS,
  BudgetAttachmentPreviewBusyError,
  BudgetAttachmentPreviewUnavailableError,
  createBudgetAttachmentPreviewManagerForTests,
  runBudgetAttachmentPreviewWorkerForTests,
  sanitizeBudgetAttachmentPreviewUncachedForTests,
} from "./budget-attachment-preview";

async function makeImage(
  format: "jpeg" | "png" | "webp",
): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      width: 8,
      height: 5,
      channels: 4,
      background: { r: 170, g: 80, b: 40, alpha: 0.8 },
    },
  });
  if (format === "jpeg") return pipeline.jpeg({ quality: 88 }).toBuffer();
  if (format === "png") return pipeline.png().toBuffer();
  return pipeline.webp({ quality: 88 }).toBuffer();
}

async function makeAnimatedWebp(): Promise<Buffer> {
  const red = Buffer.alloc(2 * 2 * 4);
  const blue = Buffer.alloc(2 * 2 * 4);
  for (let offset = 0; offset < red.byteLength; offset += 4) {
    red.set([255, 0, 0, 255], offset);
    blue.set([0, 0, 255, 255], offset);
  }
  return sharp(Buffer.concat([red, blue]), {
    animated: true,
    pages: 2,
    raw: { width: 2, height: 4, channels: 4, pageHeight: 2 },
  })
    .webp({ delay: [100, 100], loop: 0 })
    .toBuffer();
}

async function makePdf(pageSizes: [number, number][]): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (const [width, height] of pageSizes) {
    const page = document.addPage([width, height]);
    page.drawRectangle({
      x: 4,
      y: 4,
      width: Math.max(1, width - 8),
      height: Math.max(1, height - 8),
      color: rgb(0.72, 0.42, 0.24),
    });
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

async function makeActivePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([160, 120]);
  page.drawRectangle({
    x: 10,
    y: 10,
    width: 100,
    height: 60,
    color: rgb(0.5, 0.2, 0.1),
  });

  document.addJavaScript("open", "app.alert('unsafe')");
  await document.attach("embedded", "payload.txt", {
    mimeType: "text/plain",
  });
  const field = document.getForm().createTextField("dangerous-form");
  field.addToPage(page, { x: 10, y: 80, width: 80, height: 15 });

  const javaScriptAction = document.context.register(
    document.context.obj({
      S: PDFName.of("JavaScript"),
      JS: PDFString.of("app.alert('open')"),
    }),
  );
  document.catalog.set(PDFName.of("OpenAction"), javaScriptAction);
  document.catalog.set(
    PDFName.of("AA"),
    document.context.obj({ WC: javaScriptAction }),
  );

  const launchAction = document.context.register(
    document.context.obj({
      S: PDFName.of("Launch"),
      F: PDFString.of("unsafe.exe"),
    }),
  );
  const annotation = document.context.register(
    document.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Link"),
      Rect: [0, 0, 30, 30],
      A: launchAction,
    }),
  );
  page.node.set(PDFName.of("Annots"), document.context.obj([annotation]));

  return Buffer.from(await document.save({ useObjectStreams: false }));
}

describe("budget attachment sanitized preview", () => {
  it.each([
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ] as const)(
    "fully decodes and re-encodes a valid %s image",
    async (format, mediaType) => {
      const source = await makeImage(format);

      const preview =
        await sanitizeBudgetAttachmentPreviewUncachedForTests({
          data: source,
          mediaType,
        });

      expect(preview.mediaType).toBe(mediaType);
      expect(preview.data.byteLength).toBeGreaterThan(0);
      const metadata = await sharp(preview.data, {
        failOn: "error",
      }).metadata();
      expect(metadata.format).toBe(format);
      expect(metadata.width).toBe(8);
      expect(metadata.height).toBe(5);
    },
  );

  it("turns animated WEBP input into one static safe frame", async () => {
    const source = await makeAnimatedWebp();
    expect((await sharp(source, { animated: true }).metadata()).pages).toBe(2);

    const preview =
      await sanitizeBudgetAttachmentPreviewUncachedForTests({
        data: source,
        mediaType: "image/webp",
      });

    const metadata = await sharp(preview.data, { animated: true }).metadata();
    expect(metadata.pages ?? 1).toBe(1);
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(2);
  });

  it("rejects header-only, truncated, and trailing-polyglot images", async () => {
    const validPng = await makeImage("png");

    for (const data of [
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      validPng.subarray(0, Math.floor(validPng.byteLength / 2)),
      Buffer.concat([validPng, Buffer.from("<script>unsafe</script>")]),
    ]) {
      await expect(
        sanitizeBudgetAttachmentPreviewUncachedForTests({
          data,
          mediaType: "image/png",
        }),
      ).rejects.toBeInstanceOf(BudgetAttachmentPreviewUnavailableError);
    }
  });

  it("rasterizes every PDF page into a new reopenable PDF", async () => {
    const source = await makePdf([
      [180, 240],
      [240, 180],
    ]);

    const preview =
      await sanitizeBudgetAttachmentPreviewUncachedForTests({
        data: source,
        mediaType: "application/pdf",
      });

    expect(preview.mediaType).toBe("application/pdf");
    expect(preview.data).not.toEqual(source);
    const loadingTask = getDocument({
      data: Uint8Array.from(preview.data),
      isEvalSupported: false,
    });
    const reopened = await loadingTask.promise;
    try {
      expect(reopened.numPages).toBe(2);
    } finally {
      await reopened.destroy();
    }
  });

  it("pins PDF.js resources and defensive parser options in the child process", () => {
    const workerSource = readFileSync(
      path.join(
        process.cwd(),
        "src",
        "lib",
        "budget-attachment-preview-worker.cjs",
      ),
      "utf8",
    );
    expect(workerSource).toContain("standardFontDataUrl");
    expect(workerSource).toContain("standard_fonts");
    expect(workerSource).toContain("useSystemFonts: false");
    expect(workerSource).toContain("disableFontFace: true");
    expect(workerSource).toContain("enableXfa: false");
    expect(workerSource).toContain("maxImageSize: IMAGE_INPUT_PIXEL_LIMIT");
    expect(workerSource).toContain("stopAtErrors: true");
    expect(workerSource).toContain('process.once("message"');
    expect(workerSource).not.toContain("parentPort");
  });

  it("renders standard PDF fonts instead of producing a blank preview", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([240, 120]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("Hello VowBook 123", {
      x: 20,
      y: 55,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });
    const source = Buffer.from(
      await document.save({ useObjectStreams: false }),
    );

    const preview =
      await sanitizeBudgetAttachmentPreviewUncachedForTests({
        data: source,
        mediaType: "application/pdf",
      });
    const loadingTask = getDocument({
      data: Uint8Array.from(preview.data),
      isEvalSupported: false,
    });
    const reopened = await loadingTask.promise;
    try {
      const previewPage = await reopened.getPage(1);
      const viewport = previewPage.getViewport({ scale: 1 });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await previewPage.render({
        canvas: null,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let darkPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (
          pixels[offset] < 240 ||
          pixels[offset + 1] < 240 ||
          pixels[offset + 2] < 240
        ) {
          darkPixels += 1;
        }
      }
      expect(darkPixels).toBeGreaterThan(50);
    } finally {
      await reopened.destroy();
    }
  });

  it("drops JavaScript, actions, embedded files, forms, and annotation actions", async () => {
    const source = await makeActivePdf();
    const sourceText = source.toString("latin1");
    expect(sourceText).toContain("/OpenAction");
    expect(sourceText).toContain("/JavaScript");
    expect(sourceText).toContain("/EmbeddedFiles");
    expect(sourceText).toContain("/AcroForm");
    expect(sourceText).toContain("/Annots");
    expect(sourceText).toContain("/Launch");

    const preview =
      await sanitizeBudgetAttachmentPreviewUncachedForTests({
        data: source,
        mediaType: "application/pdf",
      });

    const sanitizedText = preview.data.toString("latin1");
    for (const token of [
      "/OpenAction",
      "/JavaScript",
      "/EmbeddedFiles",
      "/AcroForm",
      "/Launch",
      "/AA",
    ]) {
      expect(sanitizedText).not.toContain(token);
    }
    expect(sanitizedText).not.toMatch(
      /\/Annots\s*\[\s*\d+\s+\d+\s+R/u,
    );
  });

  it("rejects header-only and malformed PDFs", async () => {
    for (const data of [
      Buffer.from("%PDF-1.7", "ascii"),
      Buffer.from(
        "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
        "ascii",
      ),
    ]) {
      await expect(
        sanitizeBudgetAttachmentPreviewUncachedForTests({
          data,
          mediaType: "application/pdf",
        }),
      ).rejects.toBeInstanceOf(BudgetAttachmentPreviewUnavailableError);
    }
  });

  it("enforces page, total-pixel, and sanitized-output bounds", async () => {
    await expect(
      sanitizeBudgetAttachmentPreviewUncachedForTests({
        data: await makePdf(
          Array.from({ length: 51 }, () => [20, 20] as [number, number]),
        ),
        mediaType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentPreviewUnavailableError);

    await expect(
      sanitizeBudgetAttachmentPreviewUncachedForTests({
        data: await makePdf(
          Array.from({ length: 5 }, () => [2200, 2200] as [number, number]),
        ),
        mediaType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentPreviewUnavailableError);

    await expect(
      sanitizeBudgetAttachmentPreviewUncachedForTests(
        {
          data: await makePdf([[120, 120]]),
          mediaType: "application/pdf",
        },
        { maxSanitizedOutputBytes: 32 },
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentPreviewUnavailableError);
  });

  it("SIGKILLs a delayed transform process at the fixed deadline", async () => {
    expect(MAX_BUDGET_ATTACHMENT_PREVIEW_TRANSFORM_MS).toBe(15_000);
    const kill = vi.spyOn(ChildProcess.prototype, "kill");
    const startedAt = Date.now();

    try {
      await expect(
        runBudgetAttachmentPreviewWorkerForTests(
          {
            data: Buffer.from([1]),
            mediaType: "image/png",
          },
          { behavior: "delay", timeoutMs: 25 },
        ),
      ).rejects.toMatchObject({
        message: "這個附件無法安全預覽，請改用下載。",
        name: "BudgetAttachmentPreviewUnavailableError",
      });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
      expect(kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });

  it("SIGKILLs an active transform process when the request aborts", async () => {
    const kill = vi.spyOn(ChildProcess.prototype, "kill");
    const controller = new AbortController();

    try {
      const preview = runBudgetAttachmentPreviewWorkerForTests(
        {
          data: Buffer.from([1]),
          mediaType: "image/png",
        },
        {
          behavior: "delay",
          signal: controller.signal,
          timeoutMs: 1_000,
        },
      );
      controller.abort();
      await expect(preview).rejects.toMatchObject({
        name: "BudgetAttachmentPreviewUnavailableError",
      });
      expect(kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });

  it("terminates and hides details when the transform process crashes", async () => {
    const kill = vi.spyOn(ChildProcess.prototype, "kill");

    try {
      await expect(
        runBudgetAttachmentPreviewWorkerForTests(
          {
            data: Buffer.from([1]),
            mediaType: "image/png",
          },
          { behavior: "crash", timeoutMs: 1_000 },
        ),
      ).rejects.toMatchObject({
        message: "這個附件無法安全預覽，請改用下載。",
        name: "BudgetAttachmentPreviewUnavailableError",
      });
      expect(kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });

  it("uses a five-minute, 64 MiB bounded LRU cache", async () => {
    expect(BUDGET_ATTACHMENT_PREVIEW_CACHE_TTL_MS).toBe(5 * 60 * 1000);
    expect(BUDGET_ATTACHMENT_PREVIEW_CACHE_BYTES).toBe(64 * 1024 * 1024);

    let now = 0;
    const sanitize = vi.fn(async ({ data, mediaType }) => ({
      data: Buffer.from([data[0], data[0]]),
      mediaType,
    }));
    const manager = createBudgetAttachmentPreviewManagerForTests({
      maxCacheBytes: 3,
      now: () => now,
      sanitize,
      ttlMs: 100,
    });
    const first = {
      data: Buffer.from([1]),
      mediaType: "image/png" as const,
    };
    const second = {
      data: Buffer.from([2]),
      mediaType: "image/png" as const,
    };

    await manager(first);
    await manager(first);
    expect(sanitize).toHaveBeenCalledTimes(1);

    await manager(second);
    await manager(first);
    expect(sanitize).toHaveBeenCalledTimes(3);

    now = 101;
    await manager(first);
    expect(sanitize).toHaveBeenCalledTimes(4);
  });

  it("negative-caches fixed sanitizer failures for thirty seconds", async () => {
    expect(BUDGET_ATTACHMENT_PREVIEW_NEGATIVE_CACHE_TTL_MS).toBe(30_000);
    let now = 0;
    const sanitize = vi.fn(async () => {
      throw new BudgetAttachmentPreviewUnavailableError();
    });
    const manager = createBudgetAttachmentPreviewManagerForTests({
      negativeTtlMs: 100,
      now: () => now,
      sanitize,
    });
    const input = {
      data: Buffer.from([9]),
      mediaType: "image/png" as const,
    };

    await expect(manager(input)).rejects.toBeInstanceOf(
      BudgetAttachmentPreviewUnavailableError,
    );
    await expect(manager(input)).rejects.toBeInstanceOf(
      BudgetAttachmentPreviewUnavailableError,
    );
    expect(sanitize).toHaveBeenCalledTimes(1);

    now = 101;
    await expect(manager(input)).rejects.toBeInstanceOf(
      BudgetAttachmentPreviewUnavailableError,
    );
    expect(sanitize).toHaveBeenCalledTimes(2);
  });

  it("deduplicates identical in-flight transforms before caching", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sanitize = vi.fn(async ({ data, mediaType }) => {
      await gate;
      return { data: Buffer.from(data), mediaType };
    });
    const manager = createBudgetAttachmentPreviewManagerForTests({ sanitize });
    const input = {
      data: Buffer.from([7]),
      mediaType: "image/png" as const,
    };

    const first = manager(input);
    const second = manager(input);
    await vi.waitFor(() => expect(sanitize).toHaveBeenCalledTimes(1));
    release?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(sanitize).toHaveBeenCalledTimes(1);
  });

  it("allows at most two active and eight waiting preview jobs", async () => {
    let active = 0;
    let maximumActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createBudgetAttachmentPreviewManagerForTests({
      sanitize: async ({ data, mediaType }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gate;
        active -= 1;
        return { data: Buffer.from(data), mediaType };
      },
    });

    const accepted = Array.from({ length: 10 }, (_, index) =>
      manager({
        data: Buffer.from([index]),
        mediaType: "image/png",
      }),
    );
    await vi.waitFor(() => expect(active).toBe(2));
    await expect(
      manager({
        data: Buffer.from([10]),
        mediaType: "image/png",
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentPreviewBusyError);

    release?.();
    await Promise.all(accepted);
    expect(maximumActive).toBe(2);
  });
});
