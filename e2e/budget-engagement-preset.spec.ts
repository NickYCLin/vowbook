import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

type EngagementPresetFixture = {
  workspaceId: string;
};

const enabled = process.env.VOWBOOK_CRUD_E2E === "1";
const googleSubject = process.env.VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT;
const email = process.env.VOWBOOK_CRUD_E2E_EMAIL;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const authSecret =
  process.env.AUTH_SECRET ?? "vowbook-e2e-local-secret-not-for-production";
const fixtures = parseFixtures(process.env.VOWBOOK_CRUD_E2E_FIXTURES);

function parseFixtures(value: string | undefined): {
  desktop: EngagementPresetFixture;
  mobile: EngagementPresetFixture;
} | null {
  if (!value) return null;
  return JSON.parse(value) as {
    desktop: EngagementPresetFixture;
    mobile: EngagementPresetFixture;
  };
}

function requireFixture(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when VOWBOOK_CRUD_E2E=1.`);
  }
  return value;
}

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.locator("body").evaluate((body) => ({
    clientWidth: body.clientWidth,
    scrollWidth: body.scrollWidth,
  }));
  expect(dimensions.clientWidth).toBeGreaterThan(0);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.skip(!enabled, "需要明確啟用隔離 CRUD E2E fixture。");
test.use({ actionTimeout: 15_000 });

test("OWNER 可選擇加入男方與女方文定品項，且手機版不產生水平溢位", async ({
  context,
  page,
}, testInfo) => {
  const fixtureSet = fixtures;
  if (!fixtureSet) {
    throw new Error("VOWBOOK_CRUD_E2E_FIXTURES is required.");
  }
  const isMobile = testInfo.project.name.startsWith("mobile");
  const fixture = isMobile ? fixtureSet.mobile : fixtureSet.desktop;
  const fixtureGoogleSubject = requireFixture(
    googleSubject,
    "VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT",
  );
  const fixtureEmail = requireFixture(
    email,
    "VOWBOOK_CRUD_E2E_EMAIL",
  );
  const sessionToken = await encode({
    secret: authSecret,
    maxAge: 60 * 60,
    token: {
      googleSubject: fixtureGoogleSubject,
      email: fixtureEmail,
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

  const ledger = page.locator('ul[data-budget-view="group"]');
  const engagementStageHeading = ledger.getByRole("heading", {
    name: "文定儀式用品、工作人員紅包",
    exact: true,
  });
  await expect(engagementStageHeading).toHaveCount(0);

  const initialTrigger = page.getByRole("button", {
    name: "加入文定儀式項目",
    exact: true,
  });
  await expect(initialTrigger).toBeVisible();
  await initialTrigger.click();

  const dialog = page.getByRole("dialog", {
    name: "加入文定建議品項",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "男方準備" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "女方準備" }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    "加入後金額為 NT$0、狀態為規劃中",
  );
  await expect(dialog.locator('input[type="checkbox"]:checked')).toHaveCount(
    0,
  );
  await expect(dialog.getByText("已選 0 個品項", { exact: true })).toBeVisible();

  const groomSuggestion = dialog.getByRole("checkbox", {
    name: "大聘",
  });
  const brideSuggestion = dialog.getByRole("checkbox", {
    name: "接聘禮",
  });
  await expect(groomSuggestion).toBeEnabled();
  await expect(brideSuggestion).toBeEnabled();
  await groomSuggestion.check();
  await brideSuggestion.check();
  await expect(groomSuggestion).toBeChecked();
  await expect(brideSuggestion).toBeChecked();
  await expect(dialog.getByText("已選 2 個品項", { exact: true })).toBeVisible();

  await dialog
    .getByRole("button", { name: "加入 2 個文定品項", exact: true })
    .click();
  await expect(dialog).toBeHidden();

  await expect(engagementStageHeading).toBeVisible();
  await page.getByRole("button", { name: "全部展開", exact: true }).click();

  const groomItemHeading = ledger.getByRole("heading", {
    name: "文定儀式（男方準備）",
    exact: true,
  });
  const brideItemHeading = ledger.getByRole("heading", {
    name: "文定儀式（女方準備）",
    exact: true,
  });
  await expect(groomItemHeading).toBeVisible();
  await expect(brideItemHeading).toBeVisible();
  await expect(
    ledger.getByRole("heading", { name: "大聘", exact: true }),
  ).toBeVisible();
  await expect(
    ledger.getByRole("heading", { name: "接聘禮", exact: true }),
  ).toBeVisible();

  const moreTrigger = page.getByRole("button", {
    name: "加入更多文定項目",
    exact: true,
  });
  await expect(moreTrigger).toBeVisible();
  await moreTrigger.click();
  await expect(dialog).toBeVisible();

  const existingGroomSuggestion = dialog.getByRole("checkbox", {
    name: "大聘",
  });
  const existingBrideSuggestion = dialog.getByRole("checkbox", {
    name: "接聘禮",
  });
  await expect(existingGroomSuggestion).toBeDisabled();
  await expect(existingBrideSuggestion).toBeDisabled();
  await expect(existingGroomSuggestion).not.toBeChecked();
  await expect(existingBrideSuggestion).not.toBeChecked();
  await expect(
    existingGroomSuggestion.locator("xpath=ancestor::label[1]"),
  ).toContainText("已加入");
  await expect(
    existingBrideSuggestion.locator("xpath=ancestor::label[1]"),
  ).toContainText("已加入");

  if (isMobile) {
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(
      390,
    );
    await expectNoPageOverflow(page);
  }

  await page.screenshot({
    path: testInfo.outputPath("budget-engagement-preset.png"),
    fullPage: true,
  });
});
