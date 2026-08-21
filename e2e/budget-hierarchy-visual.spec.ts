import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

type HierarchyFixture = {
  budgetPhotographyExpenseId: string;
  budgetPhotographyExpenseName: string;
  budgetNotionOtherGroupId: string;
  budgetNotionOtherGroupName: string;
  budgetSmallShoesExpenseId: string;
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
  desktop: HierarchyFixture;
  mobile: HierarchyFixture;
} | null {
  if (!value) return null;
  return JSON.parse(value) as {
    desktop: HierarchyFixture;
    mobile: HierarchyFixture;
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

test("花費頁在桌面與手機都清楚區分固定分類、來源群組與花費", async ({
  context,
  page,
}, testInfo) => {
  const fixtureSet = fixtures;
  if (!fixtureSet) {
    throw new Error("VOWBOOK_CRUD_E2E_FIXTURES is required.");
  }
  const fixture = testInfo.project.name.startsWith("mobile")
    ? fixtureSet.mobile
    : fixtureSet.desktop;
  const fixtureGoogleSubject = requireFixture(
    googleSubject,
    "VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT",
  );
  const fixtureEmail = requireFixture(email, "VOWBOOK_CRUD_E2E_EMAIL");
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

  const workspaceLayout = page.locator(
    '[data-budget-workspace-layout="taxonomy-expenses"]',
  );
  const taxonomyPanel = page.getByRole("navigation", {
    name: "花費分類導覽",
  });
  const expensesPanel = page.getByRole("region", {
    name: "花費工作區",
  });
  await expect(workspaceLayout).toHaveAttribute("data-desktop-layout", "split");
  await expect(workspaceLayout).toHaveAttribute("data-mobile-layout", "stacked");
  await expect(expensesPanel).toBeVisible();

  if (testInfo.project.name.startsWith("mobile")) {
    await expect(taxonomyPanel).toBeHidden();
    const expensesBox = await expensesPanel.boundingBox();
    expect(expensesBox).not.toBeNull();
    expect(expensesBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((expensesBox?.x ?? 0) + (expensesBox?.width ?? 0)).toBeLessThanOrEqual(
      390,
    );
    const selectionContext = expensesPanel.locator(
      '[data-budget-selection-context="true"]',
    );
    await expect(
      selectionContext.getByRole("heading", { name: "全部花費" }),
    ).toBeVisible();
  } else {
    await expect(taxonomyPanel).toBeVisible();
    const taxonomyBox = await taxonomyPanel.boundingBox();
    const expensesBox = await expensesPanel.boundingBox();
    expect(taxonomyBox).not.toBeNull();
    expect(expensesBox).not.toBeNull();
    expect(taxonomyBox?.x ?? 0).toBeLessThan(expensesBox?.x ?? 0);
    expect(expensesBox?.width ?? 0).toBeGreaterThan(taxonomyBox?.width ?? 0);
    expect(
      Math.abs((taxonomyBox?.y ?? 0) - (expensesBox?.y ?? 0)),
    ).toBeLessThanOrEqual(8);

    await expect(
      taxonomyPanel.locator('[aria-current="location"]'),
    ).toHaveCount(0);
    const photographyNavigationLink = taxonomyPanel.getByRole("link", {
      name: /婚紗照拍攝/u,
    });
    const photographyTargetId = (
      await photographyNavigationLink.getAttribute("href")
    )?.slice(1);
    expect(photographyTargetId).toBeTruthy();
    await photographyNavigationLink.click();
    await expect(photographyNavigationLink).toHaveAttribute(
      "aria-current",
      "location",
    );
    const photographyTarget = page.locator(`[id="${photographyTargetId}"]`);
    await expect(photographyTarget).toBeVisible();
    await expect(photographyTarget.locator("article")).toBeFocused();
    const selectionContext = expensesPanel.locator(
      '[data-budget-selection-context="true"]',
    );
    await expect(
      selectionContext.getByText("籌備第1-2月 ›", { exact: true }),
    ).toBeVisible();
    await expect(
      selectionContext.getByRole("heading", { name: "婚紗照拍攝" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "婚宴場地", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "籌備第1-2月", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: fixture.budgetSmallShoesExpenseName,
        exact: true,
      }),
    ).toBeVisible();
    const missingControlledIds = await expensesPanel
      .locator("[aria-controls]")
      .evaluateAll((controllers) =>
        controllers.flatMap((controller) =>
          (controller.getAttribute("aria-controls") ?? "")
            .split(/\s+/u)
            .filter(Boolean)
            .filter((controlledId) => document.getElementById(controlledId) === null),
        ),
      );
    expect(missingControlledIds).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("budget-selected-category.png"),
    });
    await selectionContext.getByRole("button", {
      name: "顯示全部分類",
    }).click();
    await expect(
      selectionContext.getByRole("heading", { name: "全部花費" }),
    ).toBeFocused();
    await expect(
      taxonomyPanel.locator('[aria-current="location"]'),
    ).toHaveCount(0);
  }

  const ledger = page.locator('ul[data-budget-view="group"]');
  const stageRow = ledger
    .locator('[data-budget-taxonomy-kind="stage"]')
    .filter({ has: page.locator("h3", { hasText: /^籌備第1-2月$/u }) });
  const itemRow = ledger
    .locator('[data-budget-taxonomy-kind="item"]')
    .filter({ has: page.locator("h4", { hasText: /^婚宴場地$/u }) });

  await expect(ledger.locator("[data-budget-taxonomy-kind=\"stage\"]")).toHaveCount(1);
  await expect(ledger.locator("[data-budget-taxonomy-kind=\"item\"]")).toHaveCount(2);
  await expect(stageRow).toHaveCount(1);
  await expect(itemRow).toHaveCount(1);
  await expect(ledger.getByRole("heading", { name: "籌備婚禮第4個月", exact: true })).toHaveCount(0);
  await expect(ledger.getByRole("heading", { name: "婚鞋", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "待重新分類的既有資料" })).toBeVisible();
  await expect(
    stageRow.getByRole("button", {
      name: /^(?:展開|收合)籌備階段：籌備第1-2月$/u,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "全部展開" }).click();

  const stageSurface = stageRow.locator(
    '[data-budget-ledger-surface="stage-chapter"]',
  );
  const itemSurface = itemRow.locator(
    '[data-budget-ledger-surface="taxonomy-child"]',
  );
  await expect(stageRow).toHaveAttribute("data-budget-hierarchy-level", "parent");
  await expect(stageSurface).toHaveAttribute(
    "data-budget-ledger-surface",
    "stage-chapter",
  );
  await expect(stageSurface).toHaveAttribute(
    "data-budget-row-layout",
    "hierarchy-ledger",
  );
  await expect(
    stageSurface.locator('[data-budget-scan-layout="stage-header"]'),
  ).toBeVisible();
  await expect(stageSurface.getByText("籌備階段", { exact: true })).toBeVisible();
  await expect(itemRow).toHaveAttribute("data-budget-hierarchy-level", "child");
  await expect(itemSurface).toHaveAttribute(
    "data-budget-ledger-surface",
    "taxonomy-child",
  );
  await expect(itemSurface).toHaveAttribute(
    "data-budget-row-layout",
    "hierarchy-ledger",
  );
  await expect(
    itemSurface.locator('[data-budget-scan-layout="taxonomy-header"]'),
  ).toBeVisible();
  await expect(
    itemRow.locator('[data-budget-hierarchy-connector="true"]'),
  ).toBeVisible();


  const sourceGroupRow = ledger
    .locator("[data-budget-item-id]")
    .filter({
      has: page.getByRole("heading", {
        name: fixture.budgetNotionOtherGroupName,
        exact: true,
      }),
    });
  const smallShoesRow = ledger
    .locator("[data-budget-item-id]")
    .filter({
      has: page.getByRole("heading", {
        name: fixture.budgetSmallShoesExpenseName,
        exact: true,
      }),
    });

  await expect(sourceGroupRow).toBeVisible();
  await expect(sourceGroupRow).toHaveAttribute("data-budget-item-kind", "GROUP");
  await expect(
    sourceGroupRow.locator(`[data-budget-ledger-surface="group-band"]`),
  ).toBeVisible();
  await expect(
    sourceGroupRow.getByText("來源群組", { exact: true }),
  ).toBeVisible();
  await expect(
    sourceGroupRow.getByText("非計價標題", { exact: true }),
  ).toBeVisible();
  await expect(
    sourceGroupRow.locator(`[data-budget-ledger-column="brand"]`),
  ).toHaveCount(0);
  await expect(
    sourceGroupRow.locator(`[data-budget-mobile-row="amounts"]`),
  ).toHaveCount(0);

  await expect(smallShoesRow).toBeVisible();
  await expect(smallShoesRow).toHaveAttribute("data-budget-depth", "3");
  await expect(
    smallShoesRow.locator(`[data-budget-category-label="true"]`),
  ).toHaveText("品項分類：婚紗照拍攝");
  await expect(
    smallShoesRow.locator(`[data-budget-relation-badge="true"]`),
  ).toHaveCount(0);
  await expect(
    smallShoesRow.locator(`[data-budget-related-purpose="true"]`),
  ).toHaveCount(0);
  // 正確父節點已表達來源路徑，列上不重複；完整資料保留在明細對話框。
  await expect(
    smallShoesRow.locator(`[data-budget-notion-source-path="true"]`),
  ).toHaveCount(0);

  const photographyItemRow = ledger
    .locator(`[data-budget-taxonomy-kind="item"]`)
    .filter({ has: page.locator("h4", { hasText: /^婚紗照拍攝$/u }) });
  await expect(photographyItemRow).toHaveCount(1);
  await expect(
    photographyItemRow.getByRole("group", {
      name: "品項分類預計花費：NT$42,000",
    }),
  ).toBeVisible();
  await expect(
    photographyItemRow.getByRole("region", {
      name: "婚紗照拍攝的關聯延伸費用",
    }),
  ).toHaveCount(0);
  await smallShoesRow
    .getByRole("button", {
      name: `開啟花費明細與附件：${fixture.budgetSmallShoesExpenseName}`,
    })
    .click();
  const smallShoesDialog = page.getByRole("dialog", {
    name: fixture.budgetSmallShoesExpenseName,
    exact: true,
  });
  await expect(smallShoesDialog).toBeVisible();
  await expect(smallShoesDialog.getByText("Notion 原始路徑")).toBeVisible();
  await expect(smallShoesDialog).toContainText(
    "婚紗拍攝 › 其他 › 合成姓名的小白鞋",
  );
  await smallShoesDialog
    .getByRole("button", {
      name: `關閉管理：${fixture.budgetSmallShoesExpenseName}`,
    })
    .click();
  await expect(smallShoesDialog).not.toBeVisible();
  await sourceGroupRow.screenshot({
    path: testInfo.outputPath("notion-other-source-group.png"),
  });
  await smallShoesRow.screenshot({
    path: testInfo.outputPath("small-shoes-row.png"),
  });

  const searchbox = page.getByRole("searchbox", { name: "搜尋花費項目" });
  if (testInfo.project.name.startsWith("mobile")) {
    const searchboxDimensions = await searchbox.boundingBox();
    expect(searchboxDimensions).not.toBeNull();
    expect(searchboxDimensions?.width ?? 0).toBeGreaterThan(250);
  }
  await searchbox.fill(fixture.budgetSmallShoesExpenseName);
  await expect(smallShoesRow).toBeVisible();
  await expect(page.locator(`[aria-live="polite"]`)).toContainText(
    "符合 1 / 6 筆花費",
  );
  await searchbox.fill("");

  const itemCollapse = itemRow.getByRole("button", {
    name: "收合品項分類：婚宴場地",
  });
  await expect(itemCollapse).toBeVisible();
  await itemCollapse.click();
  const itemExpand = itemRow.getByRole("button", {
    name: "展開品項分類：婚宴場地",
  });
  await expect(itemExpand).toBeVisible();
  await itemExpand.click();
  await expect(
    itemRow.getByRole("button", {
      name: "收合品項分類：婚宴場地",
    }),
  ).toBeVisible();

  await stageRow.scrollIntoViewIfNeeded();
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("budget-hierarchy.png"),
    fullPage: true,
  });
  await ledger.screenshot({
    path: testInfo.outputPath("budget-ledger.png"),
  });
});
