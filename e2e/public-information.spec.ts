import { expect, test } from "@playwright/test";

for (const [route, title] of [["privacy", "隱私政策"], ["support", "使用說明與支援"]]) {
  test(`${route} 無登入也可讀，且狀態說明正確`, async ({ page, context }) => {
    await context.clearCookies();
    const response = await page.goto(`./${route}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    const issuesLink = route === "privacy" ? /前往 GitHub Issues 聯絡/ : /前往 GitHub Issues 回報問題/;
    await expect(page.getByRole("link", { name: issuesLink })).toHaveAttribute("href", "https://github.com/NickYCLin/vowbook/issues");
    if (route === "privacy") {
      await expect(page.getByText(/生效日期：2026 年 10 月 31 日/)).toBeVisible();
      await expect(page.getByRole("heading", { name: "賓客專屬邀請與報到碼", exact: true })).toBeVisible();
    }
    await expect(page.getByText(/待維運確認|尚未確認正式對外聯絡方式/)).toHaveCount(0);
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
