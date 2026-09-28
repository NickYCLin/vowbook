import { expect, test, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

test.skip(process.env.VOWBOOK_CRUD_E2E !== "1", "需要隔離的合成婚宴資料。");
test.use({ actionTimeout: 15_000 });
test.setTimeout(90_000);

async function navigate(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "工作區功能" });
  const link = nav.getByRole("link", { name, exact: true });
  if (!await link.isVisible()) await nav.getByRole("button", { name: "更多", exact: true }).click();
  await link.click();
}

test("切換功能保留搜尋和位置，編輯及列印預覽不離開原頁", async ({ page, context }, testInfo) => {
  const fixtureSet = JSON.parse(process.env.VOWBOOK_CRUD_E2E_FIXTURES!);
  const fixture = testInfo.project.name.startsWith("mobile") ? fixtureSet.mobile : fixtureSet.desktop;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const token = await encode({ secret: process.env.AUTH_SECRET!, maxAge: 3600, token: {
    googleSubject: process.env.VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT,
    email: process.env.VOWBOOK_CRUD_E2E_EMAIL,
    name: "合成操作測試擁有者",
  } });
  await context.addCookies([{ name: "vowbook.session-token", value: token, domain: "127.0.0.1", path: basePath || "/", httpOnly: true, sameSite: "Lax" }]);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // 正式反向代理仍會加上舊的 DENY；列印頁 CSP 僅允許同源嵌入。
  await page.route("**/tables/print?preview=1", async route => {
    const response = await route.fetch();
    expect(response.headers()["content-security-policy"]).toBe("frame-ancestors 'self'");
    await route.fulfill({ response, headers: { ...response.headers(), "x-frame-options": "DENY" } });
  });
  await page.goto(`${basePath}/workspaces/${fixture.workspaceId}/guests`);
  const nav = page.getByRole("navigation", { name: "工作區功能" });
  await expect(nav).toHaveCount(1);
  await nav.evaluate(element => element.setAttribute("data-retained-navigation", "true"));
  const search = page.getByRole("searchbox");
  const planningSummary = page.getByRole("button", { name: /宴席與喜帖摘要/ });
  await expect(planningSummary).toHaveAttribute("aria-expanded", "false");
  await planningSummary.click();
  await expect(page.getByRole("region", { name: "喜帖安排" })).toBeVisible();
  await search.fill("手動");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  const position = await page.evaluate(() => window.scrollY);
  expect(position).toBeGreaterThan(0);
  await expect.poll(() => page.locator("[data-app-header]").evaluate(
    header => Math.round(header.getBoundingClientRect().top),
  )).toBe(0);
  await navigate(page, "桌次");
  await expect(page.getByRole("heading", { level: 1, name: "桌次安排" })).toBeVisible();
  await expect(nav).toHaveAttribute("data-retained-navigation", "true");
  await navigate(page, "賓客");
  await expect(search).toHaveValue("手動");
  await expect(planningSummary).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(position, 0);
  await page.getByRole("button", { name: "新增名單成員", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const beforeClose = await page.evaluate(() => window.scrollY);
  await dialog.getByRole("button", { name: /關閉/ }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(beforeClose);
  await expect(search).toHaveValue("手動");
  await page.screenshot({ path: testInfo.outputPath("workspace-guests.png"), fullPage: false });
  await navigate(page, "桌次");
  await page.getByRole("link", { name: "列印帶位名單", exact: true }).click();
  const preview = page.getByRole("dialog");
  await expect(preview.getByRole("button", { name: "列印／另存 PDF" })).toBeEnabled();
  await expect(page.frameLocator('iframe[title="列印帶位名單預覽"]').locator("[data-app-header]")).toBeHidden();
  await expect(page.frameLocator('iframe[title="列印帶位名單預覽"]').locator("[data-operations-print]")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-print-preview.png"), fullPage: false });
  await preview.getByRole("button", { name: "關閉列印預覽" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${fixture.workspaceId}/tables$`));
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  expect(errors).toEqual([]);

  const other = testInfo.project.name.startsWith("mobile") ? fixtureSet.desktop : fixtureSet.mobile;
  const switcher = page.locator("[data-workspace-switcher]");
  await switcher.locator("summary").click();
  await expect(switcher.getByRole("link").filter({ hasText: other.workspaceName })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: `output/wedding-switcher-${testInfo.project.name}.png`, fullPage: false });
  await switcher.getByRole("link").filter({ hasText: other.workspaceName }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${other.workspaceId}/overview$`));
  await expect(page.getByRole("heading", { name: "婚宴首頁", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "需要處理", exact: true })).toBeVisible();
  await page.goto(`${basePath}/dashboard`);
  await expect(page).toHaveURL(new RegExp(`/workspaces/${other.workspaceId}/overview$`));
  await page.goto(`${basePath}/dashboard?view=all`);
  await expect(page.getByRole("heading", { name: "所有婚宴", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "開啟賓客名單", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "進入婚宴", exact: true }).first()).toBeVisible();
  await switcher.locator("summary").click();
  await switcher.getByRole("link").filter({ hasText: fixture.workspaceName }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${fixture.workspaceId}/overview$`));
  await expect(page.getByRole("heading", { name: "繼續籌備", exact: true })).toBeVisible();
  await expect(page.locator("[data-workspace-loading]")).toHaveCount(0);
  await page.screenshot({ path: `output/wedding-home-${testInfo.project.name}.png`, fullPage: false });
  expect(errors).toEqual([]);
});
