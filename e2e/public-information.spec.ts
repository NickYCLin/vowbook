import { expect, test } from "@playwright/test";

for (const [route, title] of [["privacy", "資料使用說明"], ["support", "使用說明與支援狀態"]]) {
  test(`${route} 無登入也可讀，且明示待核定狀態`, async ({ page, context }) => {
    await context.clearCookies();
    const response = await page.goto(`./${route}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText(/待維運確認/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`${route}.png`), fullPage: true });
  });
}

test("平板窄分割視窗仍能讀取公開說明", async ({ page }) => {
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("./privacy");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`privacy-${width}.png`), fullPage: true });
  }
});
