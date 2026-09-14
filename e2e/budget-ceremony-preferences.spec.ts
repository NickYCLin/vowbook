import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

type CeremonyPreferenceFixture = { workspaceId: string };

const enabled = process.env.VOWBOOK_CRUD_E2E === "1";
const googleSubject = process.env.VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT;
const email = process.env.VOWBOOK_CRUD_E2E_EMAIL;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const authSecret =
  process.env.AUTH_SECRET ?? "vowbook-e2e-local-secret-not-for-production";
const fixtures = parseFixtures(process.env.VOWBOOK_CRUD_E2E_FIXTURES);

function parseFixtures(value: string | undefined): {
  desktop: CeremonyPreferenceFixture;
  mobile: CeremonyPreferenceFixture;
} | null {
  if (!value) return null;
  return JSON.parse(value) as {
    desktop: CeremonyPreferenceFixture;
    mobile: CeremonyPreferenceFixture;
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required when VOWBOOK_CRUD_E2E=1.`);
  return value;
}

test.skip(!enabled, "需要明確啟用隔離 CRUD E2E fixture。");
test.use({ actionTimeout: 15_000 });

test("OWNER 必須明確開啟中式儀式才會看到對應花費建議", async ({
  context,
  page,
}, testInfo) => {
  if (!fixtures) throw new Error("VOWBOOK_CRUD_E2E_FIXTURES is required.");
  const isMobile = testInfo.project.name.startsWith("mobile");
  const fixture = isMobile ? fixtures.mobile : fixtures.desktop;
  const sessionToken = await encode({
    secret: authSecret,
    maxAge: 60 * 60,
    token: {
      googleSubject: required(
        googleSubject,
        "VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT",
      ),
      email: required(email, "VOWBOOK_CRUD_E2E_EMAIL"),
      name: "CRUD E2E 擁有者",
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

  await page.goto(`./workspaces/${fixture.workspaceId}/budget`);
  await expect(
    page.getByRole("button", { name: "加入文定儀式項目" }),
  ).toHaveCount(0);
  // 沒有中式儀式的婚禮不該在分類導覽看到整段用不到的階段；固定階段本來
  // 就會在完全沒有花費時收起來，這裡確認的是「即使日後有資料也仍隱藏」的
  // 前置條件：兩個階段目前都不在畫面上。
  for (const stageLabel of [
    "文定儀式用品、工作人員紅包",
    "迎娶儀式用品、工作人員紅包",
  ]) {
    await expect(page.getByText(stageLabel, { exact: true })).toHaveCount(0);
  }
  const commonItems = page.getByRole("button", {
    name: "補齊常見婚禮項目",
  });
  await commonItems.click();
  const commonItemsDialog = page.getByRole("dialog", {
    name: "補齊常見婚禮項目",
  });
  await expect(
    commonItemsDialog.getByRole("button", {
      name: "有迎娶流程？加入迎娶項目",
    }),
  ).toHaveCount(0);
  await commonItemsDialog
    .getByRole("button", { name: "取消補齊常見項目" })
    .click();

  const preferences = page.locator("details", {
    hasText: "中式儀式設定（選用）",
  });
  await preferences.locator("summary").click();
  const engagement = preferences.getByRole("checkbox", {
    name: "有文定儀式",
  });
  const procession = preferences.getByRole("checkbox", {
    name: "有迎娶儀式",
  });
  await expect(engagement).not.toBeChecked();
  await expect(procession).not.toBeChecked();
  await engagement.check();
  await procession.check();

  const actionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]),
  );
  await preferences
    .getByRole("button", { name: "儲存中式儀式設定" })
    .click();
  expect((await actionResponse).ok()).toBe(true);
  await expect(preferences.locator('input[name="expectedVersion"]')).toHaveValue(
    "1",
  );
  await expect(
    page.getByRole("button", { name: "加入文定儀式項目" }),
  ).toBeVisible();
  const dimensions = await page.locator("body").evaluate((body) => ({
    clientWidth: body.clientWidth,
    scrollWidth: body.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
