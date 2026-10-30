import { expect, test } from "@playwright/test";

test("帳號連結頁拒絕無效及重複的驗證參數", async ({ page }) => {
  for (const query of ["", "?nonce=short", `?nonce=${"n".repeat(43)}&nonce=${"n".repeat(43)}`]) {
    await page.goto(`./mobile/link/google${query}`);
    await expect(page.getByRole("heading", { name: "無效的帳號連結要求" })).toBeVisible();
    await expect(page.getByRole("button", { name: "選擇要連結的 Google 帳號" })).toHaveCount(0);
  }
});

test("Google 連結先說明用途，不自動登入或合併帳號", async ({ page }) => {
  await page.goto(`./mobile/link/google?nonce=${"n".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "連結 Google 登入" })).toBeVisible();
  await expect(page.getByText(/仍需回到 App 確認/)).toBeVisible();
  await expect(page.getByRole("button", { name: "選擇要連結的 Google 帳號" })).toBeVisible();
  expect(await page.locator('meta[name="referrer"]').getAttribute("content")).toBe("no-referrer");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("account-link-consent.png"), fullPage: true });
});

test("不能偽造連結完成回跳", async ({ request }) => {
  const response = await request.get("./mobile/link/google/complete?failed=1", { maxRedirects: 0 });
  expect(response.status()).toBe(409);
  expect(response.headers()["location"]).toBeUndefined();
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.text()).toContain("帳號資料未變更");
});
