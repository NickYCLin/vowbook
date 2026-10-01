import { describe, expect, it } from "vitest";
import {
  buildWorkspaceDocumentContentDisposition,
  canViewWorkspaceDocumentInline,
  MAX_WORKSPACE_DOCUMENT_BYTES,
  normalizeWorkspaceDocumentDetails,
  parseSingleByteRange,
  validateWorkspaceDocumentFile,
  WorkspaceDocumentValidationError,
} from "./workspace-document";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (value: string) => new TextEncoder().encode(value);
const pdf = ascii("%PDF-1.7\n...");
const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const gif = ascii("GIF89a....");
const mp4 = new Uint8Array([0, 0, 0, 0x18, ...ascii("ftypmp42"), 0, 0, 0, 0]);
const zip = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0);

describe("validateWorkspaceDocumentFile", () => {
  it.each([
    ["電子喜帖.pdf", pdf, "application/pdf"],
    ["喜帖.PNG", png, "image/png"],
    ["喜帖.jpeg", jpeg, "image/jpeg"],
    ["動態喜帖.gif", gif, "image/gif"],
    ["喜帖影片.mp4", mp4, "video/mp4"],
    ["婚攝合約.docx", zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["當日行程.xlsx", zip, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ])("以副檔名與檔頭一起判斷 %s", (name, data, mediaType) => {
    const result = validateWorkspaceDocumentFile({ originalName: name, data });
    expect(result.mediaType).toBe(mediaType);
    expect(result.byteSize).toBe(data.byteLength);
  });

  it.each([
    ["偽裝.pdf", png],
    ["網頁.html", ascii("<html>")],
    ["向量.svg", ascii("<svg>")],
    ["沒有副檔名", pdf],
    ["../合約.pdf", pdf],
    ["空白.pdf", new Uint8Array()],
  ])("拒絕不安全或不符的檔案 %s", (name, data) => {
    expect(() => validateWorkspaceDocumentFile({ originalName: name, data })).toThrow(
      WorkspaceDocumentValidationError,
    );
  });

  it("拒絕超過 25 MiB 的檔案", () => {
    const data = new Uint8Array(MAX_WORKSPACE_DOCUMENT_BYTES + 1);
    data.set(pdf);
    expect(() => validateWorkspaceDocumentFile({ originalName: "a.pdf", data })).toThrow(
      "25 MiB",
    );
  });
});

describe("normalizeWorkspaceDocumentDetails", () => {
  it("名稱留白時以檔名代替，備註留白存成 null", () => {
    expect(
      normalizeWorkspaceDocumentDetails({
        category: "INVITATION",
        title: "  ",
        notes: "",
        fallbackTitle: "喜帖 定稿",
      }),
    ).toEqual({ category: "INVITATION", title: "喜帖 定稿", notes: null });
  });

  it("收斂空白並保留填寫內容", () => {
    expect(
      normalizeWorkspaceDocumentDetails({
        category: "VENDOR_CONTRACT",
        title: " 婚攝\n合約 ",
        notes: " 尾款 10/1 前 ",
        fallbackTitle: "x",
      }),
    ).toEqual({ category: "VENDOR_CONTRACT", title: "婚攝 合約", notes: "尾款 10/1 前" });
  });

  it("拒絕未知分類與過長名稱", () => {
    expect(() =>
      normalizeWorkspaceDocumentDetails({ category: "SECRET", title: "a", notes: "", fallbackTitle: "a" }),
    ).toThrow("請選擇文件分類");
    expect(() =>
      normalizeWorkspaceDocumentDetails({ category: "OTHER", title: "字".repeat(81), notes: "", fallbackTitle: "a" }),
    ).toThrow("80");
  });
});

describe("content disposition 與 range", () => {
  it("Office 檔一律下載，不在瀏覽器內開啟", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(canViewWorkspaceDocumentInline(docx)).toBe(false);
    expect(buildWorkspaceDocumentContentDisposition("合約.docx", docx, "inline")).toMatch(/^attachment;/u);
    expect(buildWorkspaceDocumentContentDisposition("喜帖.pdf", "application/pdf", "inline")).toBe(
      `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent("喜帖.pdf")}`,
    );
  });

  it("解析影片播放需要的單一 byte range", () => {
    expect(parseSingleByteRange(null, 100)).toEqual({ kind: "none" });
    expect(parseSingleByteRange("bytes=0-", 100)).toEqual({ kind: "range", start: 0, end: 99 });
    expect(parseSingleByteRange("bytes=10-19", 100)).toEqual({ kind: "range", start: 10, end: 19 });
    expect(parseSingleByteRange("bytes=-10", 100)).toEqual({ kind: "range", start: 90, end: 99 });
    expect(parseSingleByteRange("bytes=100-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseSingleByteRange("bytes=0-1,4-5", 100)).toEqual({ kind: "invalid" });
  });
});
