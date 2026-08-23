import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

type PreparationPresetFixture = {
  budgetSmallShoesExpenseName: string;
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
  desktop: PreparationPresetFixture;
  mobile: PreparationPresetFixture;
} | null {
  if (!value) return null;
  return JSON.parse(value) as {
    desktop: PreparationPresetFixture;
    mobile: PreparationPresetFixture;
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

test("OWNER 可補齊非文定常見項目，且既有小白鞋不會覆蓋婚鞋", async ({
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
  const smallShoesHeading = ledger.getByRole("heading", {
    name: fixture.budgetSmallShoesExpenseName,
    exact: true,
  });
  const trigger = page.getByRole("button", {
    name: "補齊常見婚禮項目",
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole("dialog", {
    name: "補齊常見婚禮項目",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "有迎娶流程？加入迎娶項目",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    dialog.getByRole("group", {
      name: "迎娶儀式用品、工作人員紅包",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(dialog).not.toContainText("文定");
  await expect(dialog).not.toContainText("提親");
  await expect(
    dialog.getByRole("group", { name: "婚紗照拍攝", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "婚鞋", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('input[type="checkbox"]:checked')).toHaveCount(
    0,
  );

  await dialog
    .getByRole("button", { name: "全選一般項目", exact: true })
    .click();
  const selectedAfterSelectAll = await dialog
    .locator('input[type="checkbox"]:checked')
    .count();
  expect(selectedAfterSelectAll).toBeGreaterThan(2);
  await dialog
    .getByRole("button", { name: "清除選取", exact: true })
    .click();
  await expect(dialog.locator('input[type="checkbox"]:checked')).toHaveCount(
    0,
  );

  await dialog
    .getByRole("button", {
      name: "有迎娶流程？加入迎娶項目",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole("group", {
      name: "迎娶儀式用品、工作人員紅包",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: /^陪娶禮/u }),
  ).not.toBeChecked();

  const retouching = dialog.getByRole("checkbox", {
    name: /^精修/u,
  });
  const brideShoes = dialog.getByRole("checkbox", {
    name: /^新娘婚鞋/u,
  });
  await expect(retouching).toBeEnabled();
  await expect(brideShoes).toBeEnabled();
  await retouching.check();
  await brideShoes.check();
  await expect(dialog.getByText("已選 2 個項目", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "加入 2 個常見項目", exact: true })
    .click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "全部展開", exact: true }).click();
  const retouchingRow = ledger
    .locator('[data-budget-preparation-status="pending"]')
    .filter({ hasText: "精修" });
  const brideShoesRow = ledger
    .locator('[data-budget-preparation-status="pending"]')
    .filter({ hasText: "新娘婚鞋" });
  await expect(retouchingRow).toHaveCount(1);
  await expect(
    retouchingRow.getByRole("heading", { name: "精修", exact: true }),
  ).toBeVisible();
  await expect(retouchingRow.getByText("待準備", { exact: true })).toBeVisible();
  await expect(brideShoesRow).toHaveCount(1);
  await expect(
    brideShoesRow.getByRole("heading", { name: "新娘婚鞋", exact: true }),
  ).toBeVisible();
  await expect(brideShoesRow.getByText("待準備", { exact: true })).toBeVisible();

  await expect(smallShoesHeading).toHaveCount(1);
  await expect(smallShoesHeading).toBeVisible();
  const smallShoesRow = smallShoesHeading.locator("xpath=ancestor::article[1]");
  await expect(smallShoesRow).not.toHaveAttribute(
    "data-budget-preparation-status",
    "pending",
  );
  await expect(
    ledger.getByRole("heading", { name: "新娘婚鞋", exact: true }),
  ).toHaveCount(1);

  await trigger.click();
  await expect(dialog).toBeVisible();
  const existingRetouching = dialog.getByRole("checkbox", {
    name: /^精修/u,
  });
  const existingBrideShoes = dialog.getByRole("checkbox", {
    name: /^新娘婚鞋/u,
  });
  await expect(existingRetouching).toBeDisabled();
  await expect(existingBrideShoes).toBeDisabled();
  await expect(
    existingRetouching.locator("xpath=ancestor::label[1]"),
  ).toContainText("已加入");
  await expect(
    existingBrideShoes.locator("xpath=ancestor::label[1]"),
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
    path: testInfo.outputPath("budget-preparation-preset.png"),
    fullPage: true,
  });
});
