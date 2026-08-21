import { expect, test } from "@playwright/test";

test("品牌首頁在桌面與手機皆可安全使用", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  const response = await page.goto("./");

  const cacheControl = response?.headers()["cache-control"] ?? "";

  expect(response?.status()).toBe(200);
  expect(cacheControl).toBe("private, no-store");
  await expect(page.getByRole("heading", { name: /誓約簿/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用 Google 開始規劃" }),
  ).toBeVisible();
  await expect(page.getByText("一起把婚宴裡的每個承諾")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

  expect(hasHorizontalOverflow).toBe(false);
  expect(consoleErrors).toEqual([]);
});

test("OAuth provider保留完整base path與安全timing header", async ({
  request,
}) => {
  const response = await request.get("./api/auth/providers");

  expect(response.status()).toBe(200);
  expect(response.headers()["server-timing"]).toMatch(
    /^vowbook_auth;dur=\d+(?:\.\d+)?;desc="providers"$/u,
  );
  const providers = (await response.json()) as {
    google: { callbackUrl: string; signinUrl: string };
  };
  expect(new URL(providers.google.callbackUrl).pathname).toBe(
    "/VowBook/api/auth/callback/google",
  );
  expect(new URL(providers.google.signinUrl).pathname).toBe(
    "/VowBook/api/auth/signin/google",
  );
});

test("登入頁不會把 dot-segment callback 傳給 NextAuth", async ({ page }) => {
  let submittedBody: string | null = null;
  let submittedUrl: string | null = null;

  await page.route(
    (url) => url.pathname.endsWith("/api/auth/signin/google"),
    async (route) => {
      submittedBody = route.request().postData();
      submittedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "" }),
      });
    },
  );

  await page.goto(
    "./signin?callbackUrl=%2FVowBook%2F%252e%252e%2Fother-service",
  );
  await page.getByRole("button", { name: "使用 Google 登入" }).click();

  await expect.poll(() => submittedBody).not.toBeNull();
  expect(submittedUrl).not.toBeNull();
  expect(new URL(submittedUrl ?? "http://invalid").searchParams.get("prompt")).toBe(
    "select_account",
  );
  expect(new URLSearchParams(submittedBody ?? "").get("callbackUrl")).toBe(
    "/VowBook/dashboard",
  );
});
