import { expect, test } from "@playwright/test";

for (const [route, title] of [["privacy", "資料使用說明"], ["support", "使用說明與支援"]]) {
  test(`${route} 無登入也可讀，且狀態說明正確`, async ({ page, context }) => {
    await context.clearCookies();
    const response = await page.goto(`./${route}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    if (route === "privacy") await expect(page.getByText(/待維運確認/).first()).toBeVisible();
    else {
      await expect(page.getByRole("link", { name: /前往 GitHub Issues 回報問題/ })).toHaveAttribute("href", "https://github.com/NickYCLin/vowbook/issues");
      await expect(page.getByText(/待維運確認|尚未確認正式對外聯絡方式/)).toHaveCount(0);
    }
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
