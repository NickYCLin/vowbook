import { describe, expect, it } from "vitest";
import {
  BudgetAttachmentValidationError,
  MAX_BUDGET_ATTACHMENT_BYTES,
  buildAttachmentContentDisposition,
  resolveBudgetAttachmentDisposition,
  validateBudgetAttachmentFile,
} from "./budget-attachment";

const signatures = {
  "application/pdf": Uint8Array.from([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a,
  ]),
  "image/jpeg": Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]),
  "image/png": Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]),
  "image/webp": Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
  ]),
} as const;

const extensions = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

describe("budget attachment validation", () => {
  it.each(Object.entries(signatures))(
    "accepts a valid %s signature and computes a lower-case SHA-256",
    (mediaType, data) => {
      const result = validateBudgetAttachmentFile({
        originalName: `合約.${extensions[mediaType as keyof typeof extensions]}`,
        mediaType,
        data,
      });

      expect(result.mediaType).toBe(mediaType);
      expect(result.byteSize).toBe(data.byteLength);
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it("normalizes image/jpg to image/jpeg", () => {
    expect(
      validateBudgetAttachmentFile({
        originalName: "廠商對話.jpg",
        mediaType: "image/jpg",
        data: signatures["image/jpeg"],
      }).mediaType,
    ).toBe("image/jpeg");
  });

  it("canonicalizes an accepted extension from verified bytes", () => {
    expect(
      validateBudgetAttachmentFile({
        originalName: "CONTRACT.PDF",
        mediaType: "application/pdf",
        data: signatures["application/pdf"],
      }).originalName,
    ).toBe("CONTRACT.pdf");
  });

  it("normalizes Unicode filenames to NFC before persistence and download", () => {
    const decomposedName = "re\u0301ceipt.pdf";
    const normalizedName = "réceipt.pdf";
    const result = validateBudgetAttachmentFile({
      originalName: decomposedName,
      mediaType: "application/pdf",
      data: signatures["application/pdf"],
    });

    expect(result.originalName).toBe(normalizedName);
    expect(
      buildAttachmentContentDisposition(result.originalName, result.mediaType),
    ).toContain("filename*=UTF-8''r%C3%A9ceipt.pdf");
  });

  it.each([
    {
      label: "empty",
      input: {
        originalName: "empty.pdf",
        mediaType: "application/pdf",
        data: new Uint8Array(),
      },
    },
    {
      label: "unknown",
      input: {
        originalName: "note.txt",
        mediaType: "text/plain",
        data: Uint8Array.from([0x68, 0x69]),
      },
    },
    {
      label: "spoofed",
      input: {
        originalName: "fake.pdf",
        mediaType: "application/pdf",
        data: signatures["image/png"],
      },
    },
    {
      label: "oversize",
      input: {
        originalName: "large.pdf",
        mediaType: "application/pdf",
        data: new Uint8Array(MAX_BUDGET_ATTACHMENT_BYTES + 1),
      },
    },
    {
      label: "path filename",
      input: {
        originalName: "../contract.pdf",
        mediaType: "application/pdf",
        data: signatures["application/pdf"],
      },
    },
    {
      label: "control filename",
      input: {
        originalName: "contract\u0000.pdf",
        mediaType: "application/pdf",
        data: signatures["application/pdf"],
      },
    },
    {
      label: "long filename",
      input: {
        originalName: `${"合".repeat(201)}.pdf`,
        mediaType: "application/pdf",
        data: signatures["application/pdf"],
      },
    },
    {
      label: "dangerous double extension",
      input: {
        originalName: "場地合約.pdf.cmd",
        mediaType: "application/pdf",
        data: signatures["application/pdf"],
      },
    },
    {
      label: "extension that does not match verified bytes",
      input: {
        originalName: "場地合約.png",
        mediaType: "application/pdf",
        data: signatures["application/pdf"],
      },
    },
    {
      label: "trailing dot filename",
      input: {
        originalName: "場地合約.",
        mediaType: "application/pdf",
        data: signatures["application/pdf"],
      },
    },
    {
      label: "bidi extension spoof",
      input: {
        originalName: "場地合約\u202Efdp.exe.pdf",
        mediaType: "application/pdf",
        data: signatures["application/pdf"],
      },
    },
  ])("rejects $label input", ({ input }) => {
    expect(() => validateBudgetAttachmentFile(input)).toThrow(
      BudgetAttachmentValidationError,
    );
  });

  it("builds a default attachment RFC 5987 content disposition", () => {
    const disposition = buildAttachmentContentDisposition(
      "婚宴 場地合約(最終版).pdf",
      "application/pdf",
    );

    expect(disposition).toBe(
      "attachment; filename=\"attachment.pdf\"; filename*=UTF-8''%E5%A9%9A%E5%AE%B4%20%E5%A0%B4%E5%9C%B0%E5%90%88%E7%B4%84%28%E6%9C%80%E7%B5%82%E7%89%88%29.pdf",
    );
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
  });

  it("builds an inline RFC 5987 content disposition with the same safe filename", () => {
    const disposition = buildAttachmentContentDisposition(
      "婚宴 場地合約(最終版).pdf",
      "application/pdf",
      "inline",
    );

    expect(disposition).toBe(
      "inline; filename=\"attachment.pdf\"; filename*=UTF-8''%E5%A9%9A%E5%AE%B4%20%E5%A0%B4%E5%9C%B0%E5%90%88%E7%B4%84%28%E6%9C%80%E7%B5%82%E7%89%88%29.pdf",
    );
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
  });

  it("selects inline only for the exact disposition=inline query", () => {
    expect(
      resolveBudgetAttachmentDisposition(
        new URL("https://example.test/attachment?disposition=inline"),
      ),
    ).toBe("inline");
  });

  it.each([
    ["missing", "https://example.test/attachment"],
    ["blank", "https://example.test/attachment?disposition="],
    ["upper-case value", "https://example.test/attachment?disposition=INLINE"],
    ["mixed-case key", "https://example.test/attachment?Disposition=inline"],
    ["unknown", "https://example.test/attachment?disposition=preview"],
    [
      "duplicate",
      "https://example.test/attachment?disposition=inline&disposition=inline",
    ],
    [
      "confused with another query",
      "https://example.test/attachment?disposition=inline&download=1",
    ],
    [
      "percent-encoded value",
      "https://example.test/attachment?disposition=%69nline",
    ],
  ])("selects attachment for a %s query", (_label, url) => {
    expect(resolveBudgetAttachmentDisposition(new URL(url))).toBe(
      "attachment",
    );
  });

  it("forces the download extension from the verified media type", () => {
    const disposition = buildAttachmentContentDisposition(
      "場地合約.pdf.cmd",
      "application/pdf",
    );

    expect(disposition).toContain(
      "filename*=UTF-8''%E5%A0%B4%E5%9C%B0%E5%90%88%E7%B4%84.pdf",
    );
    expect(disposition).not.toContain(".cmd");
  });
});
