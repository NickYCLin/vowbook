"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

const path = require("node:path");
const { createCanvas } = require("@napi-rs/canvas");
const { PDFDocument } = require("pdf-lib");
const sharpModule = require("sharp");

const sharp = sharpModule.default ?? sharpModule;
const IMAGE_INPUT_PIXEL_LIMIT = 20_000_000;
const PDF_RENDER_SCALE = 2;
const PDFJS_ROOT = path.dirname(require.resolve("pdfjs-dist/package.json"));
const PDFJS_CMAP_URL = `${path.join(PDFJS_ROOT, "cmaps")}${path.sep}`;
const PDFJS_STANDARD_FONT_DATA_URL = `${path.join(
  PDFJS_ROOT,
  "standard_fonts",
)}${path.sep}`;
const PDFJS_WASM_URL = `${path.join(PDFJS_ROOT, "wasm")}${path.sep}`;

function failPreview() {
  throw new Error("preview unavailable");
}

function assertPositiveLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1) failPreview();
}

function isExactPng(data) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (
    data.byteLength < signature.byteLength ||
    !data.subarray(0, 8).equals(signature)
  ) {
    return false;
  }

  let offset = 8;
  let sawHeader = false;
  while (offset + 12 <= data.byteLength) {
    const chunkLength = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > data.byteLength) {
      return false;
    }
    const chunkType = data.toString("ascii", offset + 4, offset + 8);
    if (!sawHeader) {
      if (chunkType !== "IHDR") return false;
      sawHeader = true;
    }
    if (chunkType === "IEND") {
      return chunkLength === 0 && chunkEnd === data.byteLength;
    }
    offset = chunkEnd;
  }
  return false;
}

function isExactJpeg(data) {
  return (
    data.byteLength >= 4 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[data.byteLength - 2] === 0xff &&
    data[data.byteLength - 1] === 0xd9
  );
}

function isExactWebp(data) {
  if (
    data.byteLength < 20 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return false;
  }
  return data.readUInt32LE(4) + 8 === data.byteLength;
}

function assertExactImageContainer(data, mediaType) {
  const valid =
    mediaType === "image/png"
      ? isExactPng(data)
      : mediaType === "image/jpeg"
        ? isExactJpeg(data)
        : mediaType === "image/webp"
          ? isExactWebp(data)
          : false;
  if (!valid) failPreview();
}

async function sanitizeImage(input, limits) {
  assertExactImageContainer(input.data, input.mediaType);
  const expectedFormat =
    input.mediaType === "image/jpeg"
      ? "jpeg"
      : input.mediaType === "image/png"
        ? "png"
        : "webp";

  const image = sharp(input.data, {
    animated: false,
    failOn: "error",
    limitInputPixels: IMAGE_INPUT_PIXEL_LIMIT,
    page: 0,
    pages: 1,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  if (
    metadata.format !== expectedFormat ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > IMAGE_INPUT_PIXEL_LIMIT
  ) {
    failPreview();
  }

  const rotated = image.rotate();
  const output =
    input.mediaType === "image/jpeg"
      ? await rotated.jpeg({ chromaSubsampling: "4:4:4", quality: 90 }).toBuffer()
      : input.mediaType === "image/png"
        ? await rotated.png({ adaptiveFiltering: true, compressionLevel: 9 }).toBuffer()
        : await rotated.webp({ effort: 4, quality: 90 }).toBuffer();
  if (output.byteLength < 1 || output.byteLength > limits.maxSanitizedOutputBytes) {
    failPreview();
  }
  return { data: output, mediaType: input.mediaType };
}

function assertExactPdfContainer(data) {
  if (data.byteLength < 16 || data.toString("ascii", 0, 5) !== "%PDF-") {
    failPreview();
  }
  const tail = data.toString(
    "latin1",
    Math.max(0, data.byteLength - 4096),
  );
  if (!/startxref\s+\d+\s+%%EOF\s*$/u.test(tail)) {
    failPreview();
  }
}

async function planPdfPages(document, limits) {
  if (document.numPages < 1 || document.numPages > limits.maxPages) {
    failPreview();
  }

  const plans = [];
  let totalPixels = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const largestBaseDimension = Math.max(
      baseViewport.width,
      baseViewport.height,
    );
    if (!Number.isFinite(largestBaseDimension) || largestBaseDimension <= 0) {
      failPreview();
    }
    const scale = Math.min(
      PDF_RENDER_SCALE,
      limits.maxDimension / largestBaseDimension,
    );
    if (!Number.isFinite(scale) || scale <= 0) failPreview();
    const viewport = page.getViewport({ scale });
    const pixelWidth = Math.max(1, Math.ceil(viewport.width));
    const pixelHeight = Math.max(1, Math.ceil(viewport.height));
    if (
      pixelWidth > limits.maxDimension ||
      pixelHeight > limits.maxDimension
    ) {
      failPreview();
    }
    const pagePixels = pixelWidth * pixelHeight;
    totalPixels += pagePixels;
    if (
      !Number.isSafeInteger(pagePixels) ||
      !Number.isSafeInteger(totalPixels) ||
      totalPixels > limits.maxTotalPixels
    ) {
      failPreview();
    }
    plans.push({
      page,
      pdfHeight: baseViewport.height,
      pdfWidth: baseViewport.width,
      pixelHeight,
      pixelWidth,
      scale,
    });
  }
  return plans;
}

async function sanitizePdf(input, limits) {
  const { AnnotationMode, getDocument } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  assertExactPdfContainer(input.data);
  const loadingTask = getDocument({
    canvasMaxAreaInBytes: limits.maxTotalPixels * 4,
    cMapPacked: true,
    cMapUrl: PDFJS_CMAP_URL,
    data: new Uint8Array(input.data),
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    enableXfa: false,
    isEvalSupported: false,
    maxImageSize: IMAGE_INPUT_PIXEL_LIMIT,
    standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
    stopAtErrors: true,
    useSystemFonts: false,
    wasmUrl: PDFJS_WASM_URL,
  });
  let sourceDocument = null;
  try {
    sourceDocument = await loadingTask.promise;
    const plans = await planPdfPages(sourceDocument, limits);
    const outputDocument = await PDFDocument.create();

    for (const plan of plans) {
      const canvas = createCanvas(plan.pixelWidth, plan.pixelHeight);
      const viewport = plan.page.getViewport({ scale: plan.scale });
      await plan.page.render({
        annotationMode: AnnotationMode.DISABLE,
        background: "rgb(255,255,255)",
        canvas: null,
        canvasContext: canvas.getContext("2d"),
        viewport,
      }).promise;
      const raster = canvas.toBuffer("image/png");
      const embeddedRaster = await outputDocument.embedPng(raster);
      const outputPage = outputDocument.addPage([
        plan.pdfWidth,
        plan.pdfHeight,
      ]);
      outputPage.drawImage(embeddedRaster, {
        x: 0,
        y: 0,
        width: plan.pdfWidth,
        height: plan.pdfHeight,
      });
      canvas.width = 1;
      canvas.height = 1;
    }

    const output = Buffer.from(
      await outputDocument.save({ useObjectStreams: false }),
    );
    if (
      output.byteLength < 1 ||
      output.byteLength > limits.maxSanitizedOutputBytes
    ) {
      failPreview();
    }
    return { data: output, mediaType: "application/pdf" };
  } finally {
    if (sourceDocument) {
      await sourceDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

async function sanitize(workerInput) {
  const limits = workerInput.limits;
  assertPositiveLimit(limits.maxDimension);
  assertPositiveLimit(limits.maxPages);
  assertPositiveLimit(limits.maxSanitizedOutputBytes);
  assertPositiveLimit(limits.maxTotalPixels);

  const mediaType = workerInput.mediaType;
  const input = {
    data: Buffer.from(workerInput.data),
    mediaType,
  };
  if (mediaType === "application/pdf") {
    return sanitizePdf(input, limits);
  }
  if (
    mediaType === "image/jpeg" ||
    mediaType === "image/png" ||
    mediaType === "image/webp"
  ) {
    return sanitizeImage(input, limits);
  }
  return failPreview();
}

function finish(message, exitCode) {
  if (typeof process.send !== "function") process.exit(1);
  process.send(message, (error) => {
    process.exit(error ? 1 : exitCode);
  });
}

async function main(workerInput) {
  try {
    if (workerInput.behavior === "delay") {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
    if (workerInput.behavior === "crash") {
      throw new Error("fixed transform process crash fixture");
    }
    const preview = await sanitize(workerInput);
    const transferable = new Uint8Array(preview.data.byteLength);
    transferable.set(preview.data);
    finish(
      {
        ok: true,
        data: transferable.buffer,
        mediaType: preview.mediaType,
      },
      0,
    );
  } catch {
    finish({ ok: false }, 1);
  }
}

process.once("message", (workerInput) => {
  void main(workerInput);
});
