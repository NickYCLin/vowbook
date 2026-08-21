import {
  expect,
  test,
  type Frame,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { encode } from "next-auth/jwt";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const enabled = process.env.VOWBOOK_ATTACHMENT_E2E === "1";
const workspaceId = process.env.VOWBOOK_ATTACHMENT_E2E_WORKSPACE_ID;
const expenseId = process.env.VOWBOOK_ATTACHMENT_E2E_EXPENSE_ID;
const googleSubject = process.env.VOWBOOK_ATTACHMENT_E2E_GOOGLE_SUBJECT;
const email = process.env.VOWBOOK_ATTACHMENT_E2E_EMAIL;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const authSecret =
  process.env.AUTH_SECRET ?? "vowbook-e2e-local-secret-not-for-production";

function requireFixture(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when VOWBOOK_ATTACHMENT_E2E=1.`);
  }
  return value;
}

async function expectNoHorizontalOverflow(
  surface: Locator,
  label: string,
): Promise<void> {
  const dimensions = await surface.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `${label} 不應產生水平溢位`,
  ).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectVowBookFavicon(page: Page): Promise<void> {
  const icon = page.locator('link[rel~="icon"]').first();
  await expect(icon).toHaveCount(1);
  const href = await icon.getAttribute("href");
  expect(href).not.toBeNull();
  const iconUrl = new URL(href!, page.url());
  expect(iconUrl.pathname).toBe(`${basePath}/favicon.ico`);
  const response = await page.request.get(iconUrl.toString());
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//u);
}

type PdfViewerDiagnostic = {
  documentReady: boolean;
  errorText: string | null;
  loadProgress: number | null;
  pageCount: number | null;
  pageCountSources: Array<{ source: string; value: number }>;
  pluginCandidates: Array<{
    height: number;
    id: string;
    tag: string;
    type: string | null;
    width: number;
  }>;
  pluginReady: boolean;
  viewerCount: number;
};

async function inspectChromePdfViewer(
  viewerFrame: Frame,
): Promise<PdfViewerDiagnostic> {
  return viewerFrame.evaluate(() => {
    const nodes: Element[] = [];
    const collect = (root: Document | ShadowRoot): void => {
      for (const element of root.querySelectorAll("*")) {
        nodes.push(element);
        if (element.shadowRoot) collect(element.shadowRoot);
      }
    };
    collect(document);

    const viewers = nodes.filter(
      (element) => element.localName === "pdf-viewer",
    );
    const viewer = viewers[0] as
      | (HTMLElement & {
          docLength?: unknown;
          documentDimensions?: { pageDimensions?: unknown };
          loadProgress?: unknown;
        })
      | undefined;
    const pageCountSources: Array<{ source: string; value: number }> = [];
    const recordPageCount = (source: string, value: unknown): void => {
      const numericValue =
        typeof value === "number" ? value : Number.parseInt(String(value), 10);
      if (Number.isSafeInteger(numericValue) && numericValue >= 0) {
        pageCountSources.push({ source, value: numericValue });
      }
    };

    if (viewer) {
      recordPageCount("pdf-viewer.docLength", viewer.docLength);
      const pageDimensions = viewer.documentDimensions?.pageDimensions;
      if (Array.isArray(pageDimensions)) {
        recordPageCount(
          "pdf-viewer.documentDimensions.pageDimensions.length",
          pageDimensions.length,
        );
      }
      recordPageCount(
        "pdf-viewer[doc-length]",
        viewer.getAttribute("doc-length"),
      );
    }
    for (const element of nodes) {
      const candidate = element as HTMLElement & { docLength?: unknown };
      recordPageCount(
        `${element.localName}${element.id ? "#" + element.id : ""}.docLength`,
        candidate.docLength,
      );
      if (element.hasAttribute("doc-length")) {
        recordPageCount(
          `${element.localName}${element.id ? "#" + element.id : ""}[doc-length]`,
          element.getAttribute("doc-length"),
        );
      }
    }

    const pluginCandidates = nodes
      .filter(
        (element) =>
          element.id === "plugin" ||
          element.localName === "embed" ||
          element.getAttribute("type") === "application/x-google-chrome-pdf",
      )
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          height: Math.round(bounds.height),
          id: element.id,
          tag: element.localName,
          type: element.getAttribute("type"),
          width: Math.round(bounds.width),
        };
      });
    const pluginReady = pluginCandidates.some(
      (plugin) =>
        plugin.width > 0 &&
        plugin.height > 0 &&
        (plugin.id === "plugin" ||
          plugin.tag === "embed" ||
          plugin.type === "application/x-google-chrome-pdf"),
    );

    const errorText =
      nodes
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          if (bounds.width <= 0 || bounds.height <= 0) return false;
          const style = getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            element.getAttribute("aria-hidden") === "true"
          ) {
            return false;
          }
          const marker =
            `${element.id} ${element.getAttribute("class") ?? ""} ${
              element.getAttribute("role") ?? ""
            }`.toLowerCase();
          return (
            marker.includes("error") ||
            marker.includes("failed") ||
            element.getAttribute("role") === "alert"
          );
        })
        .map((element) => element.textContent?.trim() ?? "")
        .find((text) => text.length > 0) ?? null;
    const loadProgress =
      viewer && typeof viewer.loadProgress === "number"
        ? viewer.loadProgress
        : null;
    const pageCount =
      pageCountSources.find(
        ({ source }) => source === "pdf-viewer.docLength",
      )?.value ??
      pageCountSources.find(({ source }) =>
        source.includes("pageDimensions.length"),
      )?.value ??
      pageCountSources[0]?.value ??
      null;

    return {
      documentReady:
        viewers.length === 1 &&
        pluginReady &&
        pageCount === 2 &&
        errorText === null,
      errorText,
      loadProgress,
      pageCount,
      pageCountSources,
      pluginCandidates,
      pluginReady,
      viewerCount: viewers.length,
    };
  });
}

function isChromePdfViewerFrameUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "chrome-extension:" &&
      url.pathname.endsWith("/index.html")
    );
  } catch {
    return false;
  }
}

test.skip(!enabled, "需要明確啟用隔離附件 E2E fixture。");

test("登入使用者可在真實花費頁上傳、下載並刪除私有附件", async ({
  context,
  page,
}, testInfo) => {
  const fixtureWorkspaceId = requireFixture(
    workspaceId,
    "VOWBOOK_ATTACHMENT_E2E_WORKSPACE_ID",
  );
  const fixtureExpenseId = requireFixture(
    expenseId,
    "VOWBOOK_ATTACHMENT_E2E_EXPENSE_ID",
  );
  const fixtureGoogleSubject = requireFixture(
    googleSubject,
    "VOWBOOK_ATTACHMENT_E2E_GOOGLE_SUBJECT",
  );
  const fixtureEmail = requireFixture(
    email,
    "VOWBOOK_ATTACHMENT_E2E_EMAIL",
  );
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const sessionToken = await encode({
    secret: authSecret,
    maxAge: 60 * 60,
    token: {
      googleSubject: fixtureGoogleSubject,
      email: fixtureEmail,
      name: "附件 E2E 使用者",
    },
  });
  await context.addCookies([
    {
      name: "vowbook.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: basePath || "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.goto(`./workspaces/${fixtureWorkspaceId}/budget`);
  await expect(page.getByRole("heading", { name: "婚禮花費" })).toBeVisible();

  await expect(
    page.getByRole("group", { name: "花費檢視方式" }),
  ).toHaveCount(0);
  const budgetLedger = page.locator('ul[data-budget-view="group"]');
  // 花費帳本只顯示此工作區已使用的固定分類；本附件 fixture 只使用婚宴場地。
  // 全 6 階段／20 品項的完整 taxonomy 覆蓋由 CRUD E2E 驗證。
  await expect(
    budgetLedger.locator('[data-budget-taxonomy-kind="stage"]'),
  ).toHaveCount(1);
  await expect(
    budgetLedger.locator('[data-budget-taxonomy-kind="item"]'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "待重新分類的既有資料" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "系統保留" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "未分類既有項目" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "全部展開" }).click();

  const groupRow = page
    .getByRole("heading", { name: "E2E 附件群組", exact: true })
    .locator("xpath=ancestor::*[@data-budget-ledger-row='group'][1]");
  const groupToggle = groupRow.locator("button[aria-controls]");
  await expect(groupToggle).toBeVisible();
  await expect(groupToggle).toHaveAccessibleName("收合群組：E2E 附件群組");
  await expect(groupToggle).toHaveAttribute("aria-expanded", "true");

  const controlledIds = (
    (await groupToggle.getAttribute("aria-controls")) ?? ""
  )
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  expect(controlledIds).toHaveLength(1);
  const controlledExpenseRow = page.locator(
    `li[id="${controlledIds[0]}"]`,
  );
  await expect(controlledExpenseRow).toHaveCount(1);
  await expect(
    controlledExpenseRow.locator(
      `[data-budget-item-id="${fixtureExpenseId}"]`,
    ),
  ).toHaveCount(1);
  await expect(controlledExpenseRow).toBeVisible();

  await groupToggle.click();
  await expect(groupToggle).toHaveAccessibleName("展開群組：E2E 附件群組");
  await expect(groupToggle).toHaveAttribute("aria-expanded", "false");
  await expect(controlledExpenseRow).toBeHidden();

  await groupToggle.click();
  await expect(groupToggle).toHaveAccessibleName("收合群組：E2E 附件群組");
  await expect(groupToggle).toHaveAttribute("aria-expanded", "true");
  const expenseRow = page
    .getByRole("heading", { name: "E2E 場地費用", exact: true })
    .locator("xpath=ancestor::*[@data-budget-ledger-row][1]");
  await expect(expenseRow).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "E2E 場地費用", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("budget-taxonomy.png"),
    fullPage: false,
  });

  const expenseTrigger = expenseRow.getByRole("button", {
    name: "開啟花費明細與附件：E2E 場地費用",
  });
  await expect(expenseTrigger).toHaveAccessibleName(
    "開啟花費明細與附件：E2E 場地費用",
  );
  await expect(expenseTrigger).toHaveText("明細與附件 · 0");
  await expect(expenseTrigger).toHaveAccessibleDescription("尚無附件");
  await expect(
    expenseRow.locator('[data-budget-attachment-affordance="true"]'),
  ).toHaveCount(1);

  const toolbar = page.locator('[data-budget-toolbar="true"]');
  const statusFilters = page.getByRole("group", {
    name: "依下訂與付款狀態篩選",
  });
  await expectNoHorizontalOverflow(page.locator("html"), "document");
  await expectNoHorizontalOverflow(toolbar, "Budget toolbar");
  await expectNoHorizontalOverflow(budgetLedger, "Budget ledger");

  if (testInfo.project.name === "desktop-chromium") {
    const desktopViewport = page.viewportSize();
    expect(desktopViewport).not.toBeNull();
    await page.setViewportSize({ width: 768, height: 844 });
    await page.getByLabel("搜尋花費項目").fill("E2E 場地費用");
    await expect(expenseRow).toBeVisible();
    await expectNoHorizontalOverflow(toolbar, "768px Budget toolbar");
    await expectNoHorizontalOverflow(statusFilters, "768px status filters");
    expect(
      await statusFilters.evaluate((group) => {
        const bounds = group.getBoundingClientRect();
        return Array.from(group.querySelectorAll("button")).every((button) => {
          const buttonBounds = button.getBoundingClientRect();
          return (
            buttonBounds.left >= bounds.left - 0.5 &&
            buttonBounds.right <= bounds.right + 0.5
          );
        });
      }),
    ).toBe(true);
    await page.getByLabel("搜尋花費項目").fill("");
    await page.setViewportSize(desktopViewport!);
  }

  if (testInfo.project.name === "mobile-chromium") {
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    for (const region of ["primary", "amounts", "action"]) {
      await expect(
        expenseRow.locator(`[data-budget-mobile-row="${region}"]`).first(),
      ).toBeVisible();
    }

    // 手機版在主欄已顯示分類、名稱與廠商；重複的完整路徑／分類僅保留給輔助技術，
    // 避免窄螢幕重複堆疊相同資訊。
    const semanticMetadata = expenseRow
      .locator('[data-budget-mobile-row="metadata"]')
      .first();
    await expect(semanticMetadata).toBeHidden();
    await expect(semanticMetadata).toContainText("籌備第1-2月");
    await expect(semanticMetadata).toContainText("品項分類：婚宴場地");

    const rowActionButtons = expenseRow.locator(
      '[data-budget-mobile-row="action"] button',
    );
    expect(await rowActionButtons.count()).toBeGreaterThan(0);
    const actionSizes = await rowActionButtons.evaluateAll((buttons) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      }),
    );
    for (const size of actionSizes) {
      expect(size.height).toBeGreaterThanOrEqual(44);
      expect(size.width).toBeGreaterThanOrEqual(44);
    }

    const groupToggleSize = await groupToggle.boundingBox();
    expect(groupToggleSize).not.toBeNull();
    expect(groupToggleSize!.height).toBeGreaterThanOrEqual(44);
    expect(groupToggleSize!.width).toBeGreaterThanOrEqual(44);
  }

  await expenseRow.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("budget-browse.png"),
    fullPage: false,
  });

  await groupRow
    .getByRole("button", { name: "管理群組：E2E 附件群組" })
    .click();
  const groupDialog = page.getByRole("dialog", { name: "E2E 附件群組" });
  await expect(groupDialog).toBeVisible();
  await expect(
    groupDialog.getByRole("heading", { name: "附件", exact: true }),
  ).toBeHidden();
  await groupDialog
    .getByRole("button", { name: "關閉管理：E2E 附件群組" })
    .click();

  await expenseTrigger.click();
  const expenseDialog = page.getByRole("dialog", { name: "E2E 場地費用" });
  await expect(expenseDialog).toBeVisible();
  await expect(expenseDialog.getByRole("heading", { name: "附件", exact: true })).toBeVisible();

  const staleDeleteButtons = expenseDialog.getByRole("button", {
    name: /^刪除附件：/u,
  });
  for (let remaining = await staleDeleteButtons.count(); remaining > 0; remaining -= 1) {
    page.once("dialog", (confirmation) => confirmation.accept());
    await staleDeleteButtons.first().click();
    await expect(staleDeleteButtons).toHaveCount(remaining - 1);
  }
  await expect(expenseDialog.getByText("尚未上傳附件。")).toBeVisible();

  const rawFilename =
    "re\u0301ceipt 場地配置圖（最終確認版，含動線與桌次）💍.png";
  const filename = rawFilename.normalize("NFC");
  const pngBytes = await readFile(
    path.join(process.cwd(), "src", "app", "apple-icon.png"),
  );
  await expenseDialog.getByLabel("選擇附件").setInputFiles({
    name: rawFilename,
    mimeType: "image/png",
    buffer: pngBytes,
  });
  await expenseDialog.getByRole("button", { name: "上傳附件" }).click();

  const uploadStatus = expenseDialog.getByRole("status").filter({
    hasText: `已上傳附件「${filename}」。`,
  });
  await expect(uploadStatus).toHaveText(`已上傳附件「${filename}」。`);
  await expect(uploadStatus).toBeFocused();
  await expect(expenseDialog.getByText(filename, { exact: true })).toBeVisible();
  await expect(expenseDialog.getByText("1 / 20", { exact: true })).toBeVisible();
  await expect(expenseTrigger).toHaveText("明細與附件 · 1");
  await expect(expenseTrigger).toHaveAccessibleName(
    "開啟花費明細與附件：E2E 場地費用",
  );

  const downloadLink = expenseDialog.getByRole("link", {
    name: `下載 ${filename}`,
  });
  const downloadHref = await downloadLink.getAttribute("href");
  expect(downloadHref).toBe(
    `${basePath}/api/workspaces/${fixtureWorkspaceId}/budget/${fixtureExpenseId}/attachments/` +
      downloadHref?.split("/").at(-1),
  );
  await expect(downloadLink).toHaveAttribute("download", "");

  const onlineViewLink = expenseDialog.getByRole("link", {
    name: `線上查看（新分頁）：${filename}`,
  });
  await expect(onlineViewLink).toHaveText("線上查看（新分頁）");
  const onlineViewHref = await onlineViewLink.getAttribute("href");
  const attachmentId = downloadHref?.split("/").at(-1);
  expect(onlineViewHref).toBe(
    `${basePath}/workspaces/${fixtureWorkspaceId}/budget/${fixtureExpenseId}/attachments/${attachmentId}/preview`,
  );
  await expect(onlineViewLink).toHaveAttribute("target", "_blank");
  await expect(onlineViewLink).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  const previewShellResponse = await page.request.get(
    new URL(onlineViewHref!, page.url()).toString(),
  );
  expect(previewShellResponse.status()).toBe(200);
  expect(previewShellResponse.headers()["content-security-policy"]).toBe(
    "frame-ancestors 'none'",
  );
  expect(previewShellResponse.headers()["x-frame-options"]).toBe("DENY");
  expect(previewShellResponse.headers()["cache-control"]).toBe(
    "private, no-store",
  );

  let previewDownloadStarted = false;
  const previewDownloadListener = () => {
    previewDownloadStarted = true;
  };
  page.on("download", previewDownloadListener);
  const popupPromise = page.waitForEvent("popup");
  if (testInfo.project.name === "mobile-chromium") {
    await onlineViewLink.press("Enter");
  } else {
    await onlineViewLink.click();
  }
  const previewPopup = await popupPromise;
  try {
    await previewPopup.waitForLoadState("load");
    expect(previewPopup.url()).toBe(
      new URL(onlineViewHref!, page.url()).toString(),
    );
    await expect(
      previewPopup.getByRole("heading", { name: "VowBook 安全附件預覽" }),
    ).toBeVisible();
    await expect(previewPopup).toHaveTitle(/附件預覽.*VowBook/u);
    await expectVowBookFavicon(previewPopup);
    const previewFrame = previewPopup.getByTitle(`${filename} 的安全預覽`);
    await expect(previewFrame).toBeVisible();
    await expect(previewFrame).toHaveAttribute(
      "src",
      `${downloadHref}?disposition=inline`,
    );
    const previewImage = previewPopup
      .frameLocator(`iframe[title="${filename} 的安全預覽"]`)
      .locator("img");
    await expect(previewImage).toHaveCount(1);
    const naturalSize = await previewImage.evaluate((image) => ({
      height: (image as HTMLImageElement).naturalHeight,
      width: (image as HTMLImageElement).naturalWidth,
    }));
    expect(naturalSize.width).toBeGreaterThan(0);
    expect(naturalSize.height).toBeGreaterThan(0);
    expect(previewDownloadStarted).toBe(false);
  } finally {
    page.off("download", previewDownloadListener);
    await previewPopup.close();
  }

  const downloadResponse = await page.request.get(
    new URL(downloadHref!, page.url()).toString(),
  );
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()["content-type"]).toBe("image/png");
  expect(downloadResponse.headers()["content-length"]).toBe(
    String(pngBytes.byteLength),
  );
  expect(downloadResponse.headers()["cache-control"]).toBe(
    "private, no-store",
  );
  expect(downloadResponse.headers()["x-content-type-options"]).toBe(
    "nosniff",
  );
  expect(downloadResponse.headers()["content-security-policy"]).toBe(
    "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  expect(downloadResponse.headers()["content-disposition"]).toContain(
    "attachment;",
  );
  expect(downloadResponse.headers()["content-disposition"]).toContain(
    "filename*=UTF-8''r%C3%A9ceipt%20",
  );
  expect(await downloadResponse.body()).toEqual(pngBytes);

  await expectNoHorizontalOverflow(
    expenseDialog.locator('[data-attachment-controls="true"]'),
    "Attachment controls",
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(filename);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  expect(await readFile(downloadedPath!)).toEqual(pngBytes);

  await expectNoHorizontalOverflow(expenseDialog, "Budget dialog");
  await expectNoHorizontalOverflow(page.locator("html"), "document");
  await expectNoHorizontalOverflow(toolbar, "Budget toolbar");
  await expectNoHorizontalOverflow(budgetLedger, "Budget ledger");
  await expenseDialog
    .getByRole("heading", { name: "附件", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("budget-attachments-after-upload.png"),
    fullPage: false,
  });

  page.once("dialog", (confirmation) => confirmation.accept());
  await expenseDialog
    .getByRole("button", { name: `刪除附件：${filename}` })
    .click();
  await expect(
    expenseDialog.getByRole("status").filter({
      hasText: `已刪除附件「${filename}」。`,
    }),
  ).toBeVisible();
  await expect(expenseDialog.getByText("尚未上傳附件。")).toBeVisible();
  await expect(expenseDialog.getByText("0 / 20", { exact: true })).toBeVisible();
  await expect(expenseTrigger).toHaveText("明細與附件 · 0");
  await expect(expenseTrigger).toHaveAccessibleName(
    "開啟花費明細與附件：E2E 場地費用",
  );

  const pdfDocument = await PDFDocument.create();
  const standardFont = await pdfDocument.embedFont(StandardFonts.Helvetica);
  for (const [index, label] of ["first page", "second page"].entries()) {
    const pdfPage = pdfDocument.addPage([320, 240]);
    pdfPage.drawText(`VowBook PDF preview ${label}`, {
      x: 28,
      y: 170 - index * 20,
      size: 18,
      font: standardFont,
      color: rgb(0.1, 0.2, 0.3),
    });
  }
  const pdfBytes = Buffer.from(
    await pdfDocument.save({ useObjectStreams: false }),
  );
  const pdfFilename = "pdf-release-gate 合約.pdf";
  await expenseDialog.getByLabel("選擇附件").setInputFiles({
    name: pdfFilename,
    mimeType: "application/pdf",
    buffer: pdfBytes,
  });
  await expenseDialog.getByRole("button", { name: "上傳附件" }).click();
  await expect(expenseDialog.getByText(pdfFilename, { exact: true })).toBeVisible();

  const pdfDownloadLink = expenseDialog.getByRole("link", {
    name: `下載 ${pdfFilename}`,
  });
  const pdfDownloadHref = await pdfDownloadLink.getAttribute("href");
  const pdfViewHref = await expenseDialog
    .getByRole("link", { name: `線上查看（新分頁）：${pdfFilename}` })
    .getAttribute("href");
  const pdfAttachmentId = pdfDownloadHref?.split("/").at(-1);
  expect(pdfViewHref).toBe(
    `${basePath}/workspaces/${fixtureWorkspaceId}/budget/${fixtureExpenseId}/attachments/${pdfAttachmentId}/preview`,
  );

  let pdfPreviewDownloadStarted = false;
  const recordPdfPreviewDownload = () => {
    pdfPreviewDownloadStarted = true;
  };
  const observedPdfPopups = new Set<Page>();
  const observePdfPopupDownloads = (popup: Page) => {
    observedPdfPopups.add(popup);
    popup.on("download", recordPdfPreviewDownload);
  };
  page.on("download", recordPdfPreviewDownload);
  page.on("popup", observePdfPopupDownloads);
  const pdfPopupPromise = page.waitForEvent("popup");
  const pdfOnlineViewLink = expenseDialog.getByRole("link", {
    name: `線上查看（新分頁）：${pdfFilename}`,
  });
  if (testInfo.project.name === "mobile-chromium") {
    await pdfOnlineViewLink.press("Enter");
  } else {
    await pdfOnlineViewLink.click();
  }
  const pdfPopup = await pdfPopupPromise;
  try {
    await pdfPopup.waitForLoadState("load");
    await expect(
      pdfPopup.getByRole("heading", { name: "VowBook 安全附件預覽" }),
    ).toBeVisible();
    await expect(pdfPopup).toHaveTitle(/附件預覽.*VowBook/u);
    await expectVowBookFavicon(pdfPopup);
    await expect(
      pdfPopup.getByTitle(`${pdfFilename} 的安全預覽`),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          pdfPopup
            .frames()
            .some((frame) => isChromePdfViewerFrameUrl(frame.url())),
        { timeout: 15_000 },
      )
      .toBe(true);
    const viewerFrame = pdfPopup
      .frames()
      .find((frame) => isChromePdfViewerFrameUrl(frame.url()));
    expect(viewerFrame).toBeDefined();
    await expect
      .poll(() => inspectChromePdfViewer(viewerFrame!), {
        message:
          "Chrome PDF viewer must load its plugin, parse the document, and expose the exact two-page fixture state.",
        timeout: 15_000,
      })
      .toMatchObject({
        documentReady: true,
        errorText: null,
        pageCount: 2,
        pluginReady: true,
        viewerCount: 1,
      });
    expect(pdfPreviewDownloadStarted).toBe(false);
  } finally {
    page.off("download", recordPdfPreviewDownload);
    page.off("popup", observePdfPopupDownloads);
    for (const popup of observedPdfPopups) {
      popup.off("download", recordPdfPreviewDownload);
    }
    await pdfPopup.close();
  }

  const pdfViewUrl = new URL(
    `${pdfDownloadHref}?disposition=inline`,
    page.url(),
  ).toString();

  const fullPdfPreview = await page.request.get(pdfViewUrl);
  const sanitizedPdf = await fullPdfPreview.body();
  expect(fullPdfPreview.status()).toBe(200);
  expect(fullPdfPreview.headers()["content-type"]).toBe("application/pdf");
  expect(fullPdfPreview.headers()["content-disposition"]).toContain("inline;");
  expect(fullPdfPreview.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'self'",
  );
  expect(fullPdfPreview.headers()["accept-ranges"]).toBe("bytes");
  const previewEtag = fullPdfPreview.headers().etag;
  expect(previewEtag).toMatch(/^"[a-f0-9]{64}"$/u);
  expect(sanitizedPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(sanitizedPdf).not.toEqual(pdfBytes);

  const closedRange = await page.request.get(pdfViewUrl, {
    headers: { range: "bytes=0-4", "if-range": previewEtag },
  });
  expect(closedRange.status()).toBe(206);
  expect((await closedRange.body()).toString("ascii")).toBe("%PDF-");
  expect(closedRange.headers()["content-range"]).toBe(
    `bytes 0-4/${sanitizedPdf.byteLength}`,
  );

  const openRange = await page.request.get(pdfViewUrl, {
    headers: { range: "bytes=5-" },
  });
  expect(openRange.status()).toBe(206);
  expect((await openRange.body()).byteLength).toBe(sanitizedPdf.byteLength - 5);
  expect(openRange.headers()["content-range"]).toBe(
    `bytes 5-${sanitizedPdf.byteLength - 1}/${sanitizedPdf.byteLength}`,
  );

  const suffixRange = await page.request.get(pdfViewUrl, {
    headers: { range: "bytes=-5" },
  });
  expect(suffixRange.status()).toBe(206);
  expect((await suffixRange.body()).byteLength).toBe(5);
  expect(suffixRange.headers()["content-range"]).toBe(
    `bytes ${sanitizedPdf.byteLength - 5}-${sanitizedPdf.byteLength - 1}/${sanitizedPdf.byteLength}`,
  );

  const invalidRange = await page.request.get(pdfViewUrl, {
    headers: { range: "bytes=999999999-" },
  });
  expect(invalidRange.status()).toBe(416);
  expect(invalidRange.headers()["content-range"]).toBe(
    `bytes */${sanitizedPdf.byteLength}`,
  );

  const staleIfRange = await page.request.get(pdfViewUrl, {
    headers: { range: "bytes=0-4", "if-range": '"stale"' },
  });
  expect(staleIfRange.status()).toBe(200);
  expect(staleIfRange.headers()["content-range"]).toBeUndefined();
  expect(await staleIfRange.body()).toEqual(sanitizedPdf);

  const unsupportedRange = await page.request.get(pdfViewUrl, {
    headers: { range: "items=0-4" },
  });
  expect(unsupportedRange.status()).toBe(200);
  expect(unsupportedRange.headers()["content-range"]).toBeUndefined();
  expect(await unsupportedRange.body()).toEqual(sanitizedPdf);

  const rawPdfDownload = await page.request.get(
    new URL(pdfDownloadHref!, page.url()).toString(),
  );
  expect(rawPdfDownload.status()).toBe(200);
  expect(rawPdfDownload.headers()["content-disposition"]).toContain(
    "attachment;",
  );
  expect(await rawPdfDownload.body()).toEqual(pdfBytes);

  const fallbackRawUrl = new URL(
    `${pdfDownloadHref}?disposition=inline`,
    page.url(),
  ).toString();
  let releaseFallbackRawRequest: (() => void) | undefined;
  let markFallbackRawRequestObserved: (() => void) | undefined;
  const fallbackRawRequestGate = new Promise<void>((resolve) => {
    releaseFallbackRawRequest = resolve;
  });
  const fallbackRawRequestObserved = new Promise<void>((resolve) => {
    markFallbackRawRequestObserved = resolve;
  });
  const holdFallbackRawRequest = async (route: Route) => {
    markFallbackRawRequestObserved?.();
    await fallbackRawRequestGate;
    await route.continue();
  };
  await context.route(fallbackRawUrl, holdFallbackRawRequest);
  const fallbackPopupPromise = page.waitForEvent("popup");
  await pdfOnlineViewLink.click();
  const fallbackPopup = await fallbackPopupPromise;
  try {
    await expect(
      fallbackPopup.getByRole("heading", {
        name: "VowBook 安全附件預覽",
      }),
    ).toBeVisible();
    await fallbackRawRequestObserved;

    page.once("dialog", (confirmation) => confirmation.accept());
    await expenseDialog
      .getByRole("button", { name: `刪除附件：${pdfFilename}` })
      .click();
    await expect(
      expenseDialog.getByRole("status").filter({
        hasText: `已刪除附件「${pdfFilename}」。`,
      }),
    ).toBeVisible();
    await expect(expenseDialog.getByText("尚未上傳附件。")).toBeVisible();

    const fallbackResponsePromise = fallbackPopup.waitForResponse(
      (response) => response.url() === fallbackRawUrl,
    );
    releaseFallbackRawRequest?.();
    const fallbackResponse = await fallbackResponsePromise;
    expect(fallbackResponse.status()).toBe(404);
    expect(fallbackResponse.headers()["content-type"]).toContain("text/html");

    const fallbackFrame = fallbackPopup.frameLocator(
      `iframe[title="${pdfFilename} 的安全預覽"]`,
    );
    const fallbackAlert = fallbackFrame.getByRole("alert");
    await expect(fallbackAlert).toBeVisible();
    await expect(fallbackAlert).toContainText("VowBook 安全附件預覽");
    await expect(fallbackAlert).toContainText("附件預覽暫時無法使用");
    await expect(fallbackAlert).toContainText("請稍後重試，或關閉此分頁。");
    await expect(
      fallbackPopup.getByRole("heading", {
        name: "VowBook 安全附件預覽",
      }),
    ).toBeVisible();
    const fallbackBody = fallbackFrame.locator("body");
    await expect(fallbackBody).not.toContainText(
      '{"error":"找不到可使用的附件。"}',
    );
  } finally {
    releaseFallbackRawRequest?.();
    await context.unroute(fallbackRawUrl, holdFallbackRawRequest);
    await fallbackPopup.close();
  }

  await expect(expenseDialog.getByText("尚未上傳附件。")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
