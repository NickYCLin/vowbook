import { expect, test, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

type CrudFixture = {
  workspaceId: string;
  workspaceName: string;
  memberId: string;
  memberName: string;
  groupName: string;
  renamedGroupName: string;
  dissolveChildName: string;
  temporaryWorkspaceName: string;
  renamedTemporaryWorkspaceName: string;
  manualGuestName: string;
  declinedGuestName: string;
  editedGuestName: string;
  editedGuestNotes: string;
  importedGuestName: string;
  importedGuestEditedPartySize: number;
  importedGuestEditedPhone: string;
  stableTableName: string;
  createdTableName: string;
  editedSecondTableName: string;
  budgetRollupParentId: string;
  budgetRollupParentName: string;
  budgetRollupChildId: string;
  budgetRollupChildName: string;
  budgetCrossCategoryChildId: string;
  budgetCrossCategoryChildName: string;
  budgetZeroLeafId: string;
  budgetZeroLeafName: string;
  budgetNotionOtherGroupId: string;
  budgetNotionOtherGroupName: string;
  budgetSmallShoesExpenseId: string;
  budgetSmallShoesExpenseName: string;
};

const enabled = process.env.VOWBOOK_CRUD_E2E === "1";
const googleSubject = process.env.VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT;
const email = process.env.VOWBOOK_CRUD_E2E_EMAIL;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const authSecret =
  process.env.AUTH_SECRET ?? "vowbook-e2e-local-secret-not-for-production";
const fixtures = parseFixtures(process.env.VOWBOOK_CRUD_E2E_FIXTURES);

/**
 * 從工作區功能導覽切換頁面。手機底部功能列只放四個主要入口，
 * 其餘功能收在「更多」面板裡，得先展開才點得到。
 */
async function openWorkspaceSection(page: Page, name: string) {
  const navigation = page.getByRole("navigation", { name: "工作區功能" });
  const link = navigation.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) {
    await navigation.getByRole("button", { name: "更多", exact: true }).click();
    await expect(link).toBeVisible();
  }
  await link.click();
}

function requireFixture(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when VOWBOOK_CRUD_E2E=1.`);
  }
  return value;
}

function parseFixtures(value: string | undefined): {
  desktop: CrudFixture;
  mobile: CrudFixture;
} | null {
  if (!value) return null;
  return JSON.parse(value) as { desktop: CrudFixture; mobile: CrudFixture };
}

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.locator("body").evaluate((body) => ({
    clientWidth: body.clientWidth,
    scrollWidth: body.scrollWidth,
  }));
  expect(dimensions.clientWidth).toBeGreaterThan(0);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectFloorPlanCardsDoNotOverlap(
  floorPlan: import("@playwright/test").Locator,
) {
  const circles = await floorPlan.getByRole("article").evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        label: card.getAttribute("aria-label") ?? "未知桌次",
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        radius: Math.min(rect.width, rect.height) / 2,
      };
    }),
  );

  for (let left = 0; left < circles.length; left += 1) {
    for (let right = left + 1; right < circles.length; right += 1) {
      const first = circles[left]!;
      const second = circles[right]!;
      const centerDistance = Math.hypot(
        first.centerX - second.centerX,
        first.centerY - second.centerY,
      );
      expect(
        centerDistance,
        `${first.label} 與 ${second.label} 在場地面板上重疊`,
      ).toBeGreaterThanOrEqual(first.radius + second.radius);
    }
  }
}

async function submitServerAction(
  button: import("@playwright/test").Locator,
  {
    // Server Action 的 POST 回 2xx 之後，React 還要套用 revalidatePath 觸發的
    // RSC payload，transition 才會結束。頁面較重時這段可能拖很久，因此需要
    // 直接等畫面結果的呼叫端可以關掉這個附加等待。
    awaitPendingState = true,
  }: { awaitPendingState?: boolean } = {},
): Promise<void> {
  const page = button.page();
  // URL fragment 只存在瀏覽器端，不會隨 HTTP request 傳送；直接比較
  // page.url() 會把帶 fragment 的頁面誤判成沒有送出 Server Action。
  const actionUrl = new URL(page.url());
  actionUrl.hash = "";
  const requestPromise = page.waitForRequest(
    (request) =>
      request.url() === actionUrl.toString() &&
      request.method() === "POST" &&
      Boolean(request.headers()["next-action"]),
  );
  const buttonElement = await button.elementHandle();
  await button.click();
  const request = await requestPromise;
  const response = await request.response();
  expect(response, `Server Action response ${actionUrl}`).not.toBeNull();
  if (!response) return;
  expect(response.ok(), `Server Action ${response.status()} ${actionUrl}`).toBe(
    true,
  );
  if (!awaitPendingState) return;
  await expect
    .poll(
      async () => {
        if (!buttonElement) return false;
        return buttonElement
          .evaluate(
            (element) =>
              element.isConnected && element.classList.contains("cursor-wait"),
          )
          .catch(() => false);
      },
      {
        message: `Server Action pending state ${actionUrl}`,
        timeout: 15_000,
      },
    )
    .toBe(false);
}

test.skip(!enabled, "需要明確啟用隔離 CRUD E2E fixture。");
// This one test intentionally covers the complete desktop/mobile CRUD lifecycle.
// Bound every UI action separately while leaving enough headroom for the aggregate flow.
test.use({ actionTimeout: 15_000 });
test.setTimeout(120_000);

test("OWNER 可從真實介面完成工作區、成員、禮金與花費群組生命週期", async ({
  context,
  page,
}, testInfo) => {
  const fixtureSet = fixtures;
  if (!fixtureSet) {
    throw new Error("VOWBOOK_CRUD_E2E_FIXTURES is required.");
  }
  const isMobile = testInfo.project.name.startsWith("mobile");
  const fixture = isMobile
    ? fixtureSet.mobile
    : fixtureSet.desktop;
  const fixtureGoogleSubject = requireFixture(
    googleSubject,
    "VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT",
  );
  const fixtureEmail = requireFixture(email, "VOWBOOK_CRUD_E2E_EMAIL");
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

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

  await test.step("已登入使用者開啟舊儀式路徑仍會得到 404", async () => {
    const ceremoniesResponse = await context.request.get(
      `./workspaces/${fixture.workspaceId}/ceremonies`,
    );
    expect(ceremoniesResponse.status()).toBe(404);

    const attendanceResponse = await context.request.get(
      `./workspaces/${fixture.workspaceId}/ceremonies/removed-ceremony/attendance`,
    );
    expect(attendanceResponse.status()).toBe(404);
  });

  await test.step("建立、修改並永久刪除第二個工作區", async () => {
    await page.goto("./dashboard");
    await expect(page.getByRole("heading", { name: "我的婚宴" })).toBeVisible();
    await page.getByRole("button", { name: "新增婚宴" }).click();
    const createWorkspaceDialog = page.getByRole("dialog", {
      name: "建立另一個婚宴工作區",
    });
    await expect(createWorkspaceDialog).toBeVisible();
    await createWorkspaceDialog
      .getByRole("textbox", { name: "婚宴名稱" })
      .fill(fixture.temporaryWorkspaceName);
    await createWorkspaceDialog
      .getByRole("button", { name: "建立婚宴工作區" })
      .click();

    const temporaryHeading = page.getByRole("heading", {
      name: fixture.temporaryWorkspaceName,
      exact: true,
    });
    await expect(temporaryHeading).toBeVisible();
    let temporaryCard = temporaryHeading.locator("xpath=ancestor::article[1]");
    await temporaryCard
      .getByRole("button", { name: `編輯 ${fixture.temporaryWorkspaceName}` })
      .click();

    const editDialog = page.getByRole("dialog", {
      name: "編輯婚宴工作區",
    });
    await expect(editDialog).toBeVisible();
    await editDialog
      .getByLabel("婚宴名稱", { exact: true })
      .fill(fixture.renamedTemporaryWorkspaceName);
    await editDialog.getByRole("button", { name: "儲存工作區" }).click();
    await expect(editDialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: fixture.renamedTemporaryWorkspaceName,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "已更新婚宴工作區。" })).toBeVisible();

    temporaryCard = page
      .getByRole("heading", {
        name: fixture.renamedTemporaryWorkspaceName,
        exact: true,
      })
      .locator("xpath=ancestor::article[1]");
    await temporaryCard
      .getByRole("button", {
        name: `永久刪除 ${fixture.renamedTemporaryWorkspaceName}`,
      })
      .click();
    const deleteDialog = page.getByRole("dialog", {
      name: "永久刪除婚宴工作區",
    });
    await expect(deleteDialog.getByText("此動作永久且無法復原。")).toBeVisible();
    await deleteDialog
      .getByLabel(
        `輸入「${fixture.renamedTemporaryWorkspaceName}」以確認永久刪除`,
      )
      .fill(fixture.renamedTemporaryWorkspaceName);
    await deleteDialog
      .getByRole("button", {
        name: `確認永久刪除 ${fixture.renamedTemporaryWorkspaceName}`,
      })
      .click();
    await expect(
      page.getByRole("status", { name: "" }).filter({
        hasText: "已永久刪除婚宴工作區。",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: fixture.renamedTemporaryWorkspaceName,
        exact: true,
      }),
    ).toHaveCount(0);
    await expectNoPageOverflow(page);
  });

  await test.step("修改已接受成員角色並移除", async () => {
    await page.goto(`./workspaces/${fixture.workspaceId}/members`);
    const memberRegion = page.getByRole("region", { name: "目前成員" });
    await expect(memberRegion.getByRole("heading", { name: "目前成員" })).toBeVisible();
    let memberRow = memberRegion
      .getByRole("listitem")
      .filter({ hasText: fixture.memberName });
    await expect(
      memberRow.locator("p").filter({ hasText: /^婚顧$/u }),
    ).toBeVisible();
    if (isMobile) {
      await expectNoPageOverflow(page);
      return;
    }
    await memberRow
      .getByRole("button", { name: `編輯 ${fixture.memberName} 的角色` })
      .click();

    const roleDialog = page.getByRole("dialog", {
      name: `編輯${fixture.memberName}的角色`,
    });
    await roleDialog.getByLabel("協作角色").selectOption("VIEWER");
    await submitServerAction(
      roleDialog.getByRole("button", { name: "儲存角色" }),
    );
    memberRow = memberRegion
      .getByRole("listitem")
      .filter({ hasText: fixture.memberName });
    await expect(
      memberRow.locator("p").filter({ hasText: /^檢視者$/u }),
    ).toBeVisible();

    await memberRow
      .getByRole("button", { name: `移除 ${fixture.memberName}` })
      .click();
    const removeDialog = page.getByRole("dialog", {
      name: `移除${fixture.memberName}`,
    });
    await removeDialog
      .getByLabel(`請輸入「${fixture.memberName}」以確認移除`)
      .fill(fixture.memberName);
    await submitServerAction(
      removeDialog.getByRole("button", {
        name: `確認移除${fixture.memberName}`,
      }),
    );
    await expect(
      memberRegion.getByRole("listitem").filter({ hasText: fixture.memberName }),
    ).toHaveCount(0);
    await expectNoPageOverflow(page);
  });

  await test.step("從總覽進入禮金頁並完成登記、修改、重載與移除", async () => {
    await page.goto(`./workspaces/${fixture.workspaceId}/overview`);
    await page.getByRole("link", { name: "查看禮金簿", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/workspaces/${fixture.workspaceId}/gifts$`, "u"),
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "禮金簿",
      }),
    ).toBeVisible();

    const ledger = page.getByRole("region", { name: "禮金簿" });
    await expect(ledger.getByLabel("搜尋禮金簿名單")).toBeVisible();
    // 禮金有自己的頁面之後就不再收合，也不該留著收合鈕。
    await expect(
      ledger.getByRole("button", { name: /收合禮金簿|展開禮金簿/u }),
    ).toHaveCount(0);

    // 不出席賓客的座位文案屬於賓客頁；先繞過去確認，再回禮金頁繼續登記。
    await openWorkspaceSection(page, "賓客");
    const guestList = page.getByRole("region", { name: "名單", exact: true });
    const declinedGuestArticle = guestList
      .getByRole("heading", { name: fixture.declinedGuestName, exact: true })
      .locator("xpath=ancestor::article[1]");
    await expect(
      declinedGuestArticle.getByText("座位：不需安排", { exact: true }),
    ).toBeVisible();
    await expect(
      declinedGuestArticle.getByText("桌次：尚未安排", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("region", { name: "禮金簿" })).toHaveCount(0);

    await openWorkspaceSection(page, "禮金");
    await expect(ledger.getByLabel("搜尋禮金簿名單")).toBeVisible();

    const initialAmount = isMobile ? "6000" : "3600";
    const updatedAmount = isMobile ? "12000" : "6600";
    const updatedFormattedAmount = isMobile ? "NT$ 12,000" : "NT$ 6,600";
    const initialNotes = `${isMobile ? "手機" : "桌面"}禮金初次登記`;
    const updatedNotes = `${isMobile ? "手機" : "桌面"}禮金已核對轉帳`;

    await ledger
      .getByRole("button", {
        name: `登記 ${fixture.manualGuestName} 的禮金`,
      })
      .click();
    let giftDialog = page.getByRole("dialog", {
      name: `登記 ${fixture.manualGuestName} 的禮金`,
    });
    await giftDialog.getByLabel("禮金金額").fill(initialAmount);
    await giftDialog.getByLabel("備註（選填）").fill(initialNotes);
    await submitServerAction(
      giftDialog.getByRole("button", { name: "儲存禮金" }),
    );
    await expect(giftDialog).toBeHidden();

    let giftRow = ledger
      .getByRole("heading", { name: fixture.manualGuestName })
      .locator("xpath=ancestor::li[1]");
    await expect(giftRow).toContainText(initialNotes);
    await expect(
      giftRow.getByRole("button", {
        name: `編輯 ${fixture.manualGuestName} 的禮金`,
      }),
    ).toBeVisible();

    await giftRow
      .getByRole("button", {
        name: `編輯 ${fixture.manualGuestName} 的禮金`,
      })
      .click();
    giftDialog = page.getByRole("dialog", {
      name: `編輯 ${fixture.manualGuestName} 的禮金`,
    });
    await giftDialog.getByLabel("禮金金額").fill(updatedAmount);
    await giftDialog.getByLabel("備註（選填）").fill(updatedNotes);
    await submitServerAction(
      giftDialog.getByRole("button", { name: "儲存變更" }),
    );
    await expect(giftDialog).toBeHidden();
    await expect(giftRow).toContainText(updatedFormattedAmount);
    await expect(giftRow).toContainText(updatedNotes);

    // 排序不改變成員，只改變順序；金額由高到低時剛登記這筆要排在最前面。
    const ledgerNames = async () =>
      ledger.getByRole("heading", { level: 3 }).allTextContents();
    const rosterOrder = await ledgerNames();
    await ledger.getByLabel("禮金簿排序").selectOption("AMOUNT_DESC");
    const amountOrder = await ledgerNames();
    expect([...amountOrder].sort()).toEqual([...rosterOrder].sort());
    expect(amountOrder[0]).toBe(fixture.manualGuestName);
    await ledger.getByLabel("禮金簿排序").selectOption("ROSTER");
    expect(await ledgerNames()).toEqual(rosterOrder);

    await page.reload();
    const reloadedLedger = page.getByRole("region", { name: "禮金簿" });
    await expect(reloadedLedger.getByLabel("搜尋禮金簿名單")).toBeVisible();
    giftRow = reloadedLedger
      .getByRole("heading", { name: fixture.manualGuestName })
      .locator("xpath=ancestor::li[1]");
    await expect(giftRow).toContainText(updatedFormattedAmount);
    await expect(giftRow).toContainText(updatedNotes);

    // 這位賓客沒有報到，屬於禮到人不到；標記已回禮後待回禮數要歸零。
    await reloadedLedger
      .getByLabel("禮金登記狀態篩選")
      .selectOption("WITHOUT_ATTENDANCE");
    await expect(
      giftRow.getByText("禮到人不到・待回禮回喜餅"),
    ).toBeVisible();
    await submitServerAction(
      giftRow.getByRole("button", { name: "標記已回禮" }),
      { awaitPendingState: false },
    );
    await expect(giftRow.getByText(/禮到人不到・已回禮/u)).toBeVisible({
      timeout: 30_000,
    });
    await reloadedLedger.getByLabel("禮金登記狀態篩選").selectOption("ALL");

    await giftRow
      .getByRole("button", {
        name: `移除 ${fixture.manualGuestName} 的禮金`,
      })
      .click();
    const deleteGiftDialog = page.getByRole("dialog", {
      name: `移除 ${fixture.manualGuestName} 的禮金`,
    });
    await submitServerAction(
      deleteGiftDialog.getByRole("button", { name: "確認移除禮金" }),
    );
    await expect(deleteGiftDialog).toBeHidden();
    await expect(
      reloadedLedger.getByRole("button", {
        name: `登記 ${fixture.manualGuestName} 的禮金`,
      }),
    ).toBeVisible();
    await expectNoPageOverflow(page);
  });

  await test.step("建立選用群組、保留子項解除群組，並清理合成資料", async () => {
    await page.goto(`./workspaces/${fixture.workspaceId}/budget`);
    const budgetWorkspace = page.getByRole("region", { name: "花費工作區" });
    await budgetWorkspace
      .getByLabel("建立群組（選用）", { exact: true })
      .click();
    await budgetWorkspace
      .getByRole("button", { name: "建立群組", exact: true })
      .click();
    const createDialog = page.getByRole("dialog", {
      name: "建立群組",
    });
    const taxonomySelect = createDialog.getByLabel("品項分類");
    await expect(taxonomySelect.locator("optgroup")).toHaveCount(6);
    await expect(
      taxonomySelect.locator('option:not([value=""])'),
    ).toHaveCount(21);
    // 工作人員紅包不分中西式，沒有迎娶的婚禮也要選得到。
    await expect(taxonomySelect).toContainText("工作人員紅包");
    await expect(taxonomySelect).not.toContainText("其他");
    await expect(taxonomySelect).not.toContainText("待分類");
    await createDialog.getByLabel("群組名稱").fill(fixture.groupName);
    await taxonomySelect.selectOption("ITEM_WEDDING_VENUE");
    await createDialog
      .getByRole("button", { name: "建立群組", exact: true })
      .click();
    await page.getByRole("button", { name: "全部展開" }).click();
    await expect(
      page.getByRole("heading", { name: fixture.groupName, exact: true }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: `管理群組：${fixture.groupName}` })
      .click();
    const manageDialog = page.getByRole("dialog", {
      name: fixture.groupName,
      exact: true,
    });
    await manageDialog
      .getByRole("button", { name: `編輯群組：${fixture.groupName}` })
      .click();
    const editGroupDialog = page.getByRole("dialog", {
      name: "編輯群組",
    });
    await editGroupDialog.getByLabel("群組名稱").fill(fixture.renamedGroupName);
    await editGroupDialog.getByRole("button", { name: "儲存群組" }).click();
    await expect(
      page.getByRole("heading", {
        name: fixture.renamedGroupName,
        exact: true,
        level: 5,
      }),
    ).toBeVisible();
    const renamedManageDialog = page.getByRole("dialog", {
      name: fixture.renamedGroupName,
      exact: true,
    });
    await renamedManageDialog
      .locator("summary")
      .filter({ hasText: "在此項下新增花費" })
      .click();
    const childForm = renamedManageDialog.getByRole("form", {
      name: `在${fixture.renamedGroupName}下新增花費表單`,
    });
    await childForm.getByLabel("項目名稱").fill(fixture.dissolveChildName);
    await childForm.getByLabel("預計花費").fill("0");
    await childForm
      .getByRole("button", { name: "新增花費項目", exact: true })
      .click();
    await expect(
      renamedManageDialog.getByText(fixture.dissolveChildName, { exact: true }),
    ).toBeVisible();
    const sourceGroupRow = page
      .getByRole("heading", {
        name: fixture.renamedGroupName,
        exact: true,
        level: 5,
      })
      .locator("xpath=ancestor::article[1]");
    await expect(sourceGroupRow).toHaveAttribute("data-budget-item-kind", "GROUP");
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
    await expect(
      renamedManageDialog.locator(`[data-budget-non-priced-heading="true"]`),
    ).toBeVisible();
    await expect(renamedManageDialog).toContainText(
      "此來源群組是非計價標題；金額只記錄在下層花費。",
    );
    await renamedManageDialog
      .getByRole("button", {
        name: `關閉管理：${fixture.renamedGroupName}`,
      })
      .click();
    await page.getByRole("button", { name: "規劃中", exact: true }).click();
    await expect(sourceGroupRow).toBeVisible();
    await expect(
      sourceGroupRow.locator(`[data-budget-mobile-row="amounts"]`),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page
      .getByRole("button", { name: `管理群組：${fixture.renamedGroupName}` })
      .click();
    await expect(renamedManageDialog).toBeVisible();
    await renamedManageDialog
      .locator("summary")
      .filter({ hasText: "移除群組並保留項目" })
      .click();
    if (isMobile) {
      const longNameConfirmation = renamedManageDialog.getByText(
        `會移除群組「${fixture.renamedGroupName}」本身。`,
        { exact: true },
      );
      await expect(longNameConfirmation).toBeVisible();
      expect(
        await longNameConfirmation.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    await expect(
      renamedManageDialog.getByText(
        "1 個直接子項會移到原上層「婚宴場地」。",
        {
        exact: true,
        },
      ),
    ).toBeVisible();
    await renamedManageDialog
      .getByRole("button", {
        name: "確認移除群組並保留項目",
        exact: true,
      })
      .click();
    await expect(renamedManageDialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: fixture.renamedGroupName,
        exact: true,
      }),
    ).toHaveCount(0);

    const preservedChildRow = page
      .getByRole("heading", {
        name: fixture.dissolveChildName,
        exact: true,
      })
      .locator("xpath=ancestor::article[1]");
    await expect(preservedChildRow).toHaveAttribute("data-budget-depth", "2");
    await preservedChildRow
      .getByRole("button", {
        name: `開啟花費明細與附件：${fixture.dissolveChildName}`,
      })
      .click();
    const childDialog = page.getByRole("dialog", {
      name: fixture.dissolveChildName,
      exact: true,
    });
    await childDialog
      .locator("summary")
      .filter({ hasText: "移除項目" })
      .click();
    await childDialog
      .getByRole("button", {
        name: `確認移除：${fixture.dissolveChildName}`,
        exact: true,
      })
      .click();
    await expect(childDialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: fixture.dissolveChildName,
        exact: true,
      }),
    ).toHaveCount(0);
    await expectNoPageOverflow(page);
  });

  await test.step("從真實花費頁驗證固定分類階層與 subtree rollup 金額", async () => {
    await page.goto(`./workspaces/${fixture.workspaceId}/budget`);
    const budgetWorkspace = page.getByRole("region", { name: "花費工作區" });

    await expect(
      page.getByRole("group", { name: "花費檢視方式" }),
    ).toHaveCount(0);
    const budgetLedger = budgetWorkspace.locator('ul[data-budget-view="group"]');
    await expect(
      budgetLedger.locator('[data-budget-taxonomy-kind="stage"]'),
    ).toHaveCount(1);
    await expect(
      budgetLedger.locator('[data-budget-taxonomy-kind="item"]'),
    ).toHaveCount(2);
    await expect(
      page.getByRole("heading", { name: "待重新分類的既有資料" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "系統保留" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "未分類既有項目" }),
    ).toHaveCount(0);
    await expect(
      budgetLedger.getByRole("heading", {
        name: "籌備婚禮第4個月",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      budgetLedger.getByRole("heading", { name: "婚鞋", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "全部展開" }).click();

    const notionOtherGroupRow = budgetLedger
      .locator("[data-budget-item-id]")
      .filter({
        has: page.getByRole("heading", {
          name: fixture.budgetNotionOtherGroupName,
          exact: true,
        }),
      });
    await expect(notionOtherGroupRow).toBeVisible();
    await expect(notionOtherGroupRow).toHaveAttribute(
      "data-budget-item-kind",
      "GROUP",
    );
    await expect(
      notionOtherGroupRow.getByText("來源群組", { exact: true }),
    ).toBeVisible();
    await expect(
      notionOtherGroupRow.getByText("非計價標題", { exact: true }),
    ).toBeVisible();
    await expect(
      notionOtherGroupRow.locator(`[data-budget-ledger-column="brand"]`),
    ).toHaveCount(0);
    await expect(
      notionOtherGroupRow.locator(`[data-budget-mobile-row="amounts"]`),
    ).toHaveCount(0);

    const smallShoesRow = budgetLedger
      .locator("[data-budget-item-id]")
      .filter({
        has: page.getByRole("heading", {
          name: fixture.budgetSmallShoesExpenseName,
          exact: true,
        }),
      });
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
    // Notion 匯入痕跡完全不對使用者顯示。
    await expect(
      smallShoesRow.locator(`[data-budget-notion-source-path="true"]`),
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
    await expect(smallShoesDialog.getByText("原始分類路徑")).toHaveCount(0);
    await expect(smallShoesDialog).not.toContainText(
      "婚紗拍攝 › 其他 › 合成姓名的小白鞋",
    );
    await smallShoesDialog
      .getByRole("button", {
        name: `關閉管理：${fixture.budgetSmallShoesExpenseName}`,
      })
      .click();
    await expect(smallShoesDialog).not.toBeVisible();

    await notionOtherGroupRow
      .getByRole("button", {
        name: `管理群組：${fixture.budgetNotionOtherGroupName}`,
      })
      .click();
    const notionOtherManageDialog = page.getByRole("dialog", {
      name: fixture.budgetNotionOtherGroupName,
      exact: true,
    });
    await expect(notionOtherManageDialog).toBeVisible();
    await expect(
      notionOtherManageDialog
        .locator("summary")
        .filter({ hasText: "移除群組並保留項目" }),
    ).toBeVisible();
    await expect(
      notionOtherManageDialog.locator(
        `form[aria-label="移除項目：${fixture.budgetNotionOtherGroupName}"]`,
      ),
    ).toHaveCount(0);
    const subtreeDeleteTrigger = notionOtherManageDialog.getByRole("button", {
      name: `永久刪除群組：${fixture.budgetNotionOtherGroupName}`,
    });
    await expect(subtreeDeleteTrigger).toBeVisible();
    await subtreeDeleteTrigger.click();

    const subtreeDeleteDialog = page.getByRole("dialog", {
      name: `永久刪除群組：${fixture.budgetNotionOtherGroupName}`,
    });
    await expect(subtreeDeleteDialog).toBeVisible();
    await expect(subtreeDeleteDialog).toContainText(
      "下層 1 筆，總共 2 筆資料",
    );
    await expect(subtreeDeleteDialog).toContainText("目前沒有附件");
    const subtreeConfirmation = subtreeDeleteDialog.getByRole("textbox", {
      name: `輸入「${fixture.budgetNotionOtherGroupName}」確認永久刪除`,
    });
    const subtreeSubmit = subtreeDeleteDialog.getByRole("button", {
      name: "永久刪除 2 筆資料",
    });
    await expect(subtreeSubmit).toBeDisabled();
    await subtreeConfirmation.fill("錯誤名稱");
    await expect(subtreeSubmit).toBeDisabled();
    await subtreeConfirmation.fill(fixture.budgetNotionOtherGroupName);
    await expect(subtreeSubmit).toBeEnabled();
    await subtreeDeleteDialog.getByRole("button", { name: "取消" }).click();
    await expect(subtreeDeleteDialog).not.toBeVisible();
    await expect(subtreeDeleteTrigger).toBeFocused();
    await notionOtherManageDialog
      .getByRole("button", {
        name: `關閉管理：${fixture.budgetNotionOtherGroupName}`,
      })
      .click();
    await expect(notionOtherManageDialog).not.toBeVisible();
    await expect(notionOtherGroupRow).toBeVisible();
    await expect(smallShoesRow).toBeVisible();
    const photographyItemRow = budgetLedger
      .locator(`[data-budget-taxonomy-kind="item"]`)
      .filter({
        has: page.getByRole("heading", {
          name: "婚紗照拍攝",
          exact: true,
        }),
      });
    await expect(photographyItemRow).toHaveCount(1);
    await expect(
      photographyItemRow.getByRole("region", {
        name: "婚紗照拍攝的關聯延伸費用",
      }),
    ).toHaveCount(0);

    const rollupParentRow = page
      .getByRole("heading", {
        name: fixture.budgetRollupParentName,
        exact: true,
      })
      .locator("xpath=ancestor::article[1]");
    const flatNestedExpense = page
      .getByRole("heading", {
        name: fixture.budgetRollupChildName,
        exact: true,
      })
      .locator("xpath=ancestor::article[1]");
    await expect(flatNestedExpense).toBeVisible();
    await expect(flatNestedExpense).toHaveAttribute("data-budget-depth", "3");
    await expect(flatNestedExpense).toHaveAttribute("data-budget-branch", "nested");

    const allRollupAmount = rollupParentRow.getByRole("group", {
      name: "含子項預計花費：NT$80,000",
    });
    await expect(allRollupAmount).toBeVisible();
    await expect(
      allRollupAmount.getByText("NT$80,000", { exact: true }),
    ).toBeVisible();
    const allRollupScopeBadge = rollupParentRow.getByText("含子項", {
      exact: true,
    });
    await expect(allRollupScopeBadge).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: fixture.budgetRollupChildName,
        exact: true,
      }),
    ).toBeVisible();
    await expect(flatNestedExpense).toHaveAttribute("data-budget-depth", "3");
    await expect(
      page.getByRole("heading", {
        name: fixture.budgetCrossCategoryChildName,
        exact: true,
      }),
    ).toBeVisible();
    // 有子項的四種金額都採同一個含子項口徑，不能把已付的子項誤說成未記錄。
    const rolledUpActualAmount = rollupParentRow.getByLabel(
      "含子項實付：NT$68,000",
    );
    await expect(rolledUpActualAmount).toBeVisible();
    await expect(rolledUpActualAmount).toHaveText("NT$68,000");
    await expect(
      rollupParentRow.getByText("2 個直接項目", { exact: true }),
    ).toBeVisible();
    await expect(
      rollupParentRow.getByText("共 2 個下層項目", { exact: true }),
    ).toBeVisible();

    const zeroLeafRow = page
      .getByRole("heading", {
        name: fixture.budgetZeroLeafName,
        exact: true,
      })
      .locator("xpath=ancestor::article[1]");
    const allZeroLeafAmount = zeroLeafRow.getByLabel("本項預計花費：NT$0");
    await expect(allZeroLeafAmount).toBeVisible();
    await expect(
      allZeroLeafAmount.getByText("NT$0", { exact: true }),
    ).toBeVisible();
    await expect(
      allZeroLeafAmount.getByText("含子項", { exact: true }),
    ).toHaveCount(0);
    await expectNoPageOverflow(page);

    const sameCategoryChildRow = page
      .getByRole("heading", {
        name: fixture.budgetRollupChildName,
        exact: true,
      })
      .locator("xpath=ancestor::article[1]");
    const crossCategoryChildRow = page
      .getByRole("heading", {
        name: fixture.budgetCrossCategoryChildName,
        exact: true,
      })
      .locator("xpath=ancestor::article[1]");
    const planningFilter = page.getByRole("button", {
      name: "規劃中",
      exact: true,
    });
    await planningFilter.click();
    await expect(planningFilter).toHaveAttribute("aria-pressed", "true");
    await expect(rollupParentRow).toBeVisible();
    await expect(sameCategoryChildRow).toBeHidden();
    await expect(crossCategoryChildRow).toBeHidden();
    await expect(allRollupAmount).toHaveAccessibleName(
      "含子項預計花費：NT$80,000",
    );
    await expect(allRollupAmount).toHaveAccessibleDescription(
      "包含完整下層，即使部分項目因篩選未顯示",
    );
    const completeTreeScope = rollupParentRow.getByText(
      "包含完整下層，即使部分項目因篩選未顯示",
      { exact: true },
    );
    await expect(completeTreeScope).toBeVisible();
    const completeTreeScopeId = await completeTreeScope.getAttribute("id");
    expect(completeTreeScopeId).toBeTruthy();
    await expect(allRollupAmount).toHaveAttribute(
      "aria-describedby",
      completeTreeScopeId!,
    );
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await expect(completeTreeScope).toHaveCount(0);

    await expect(
      sameCategoryChildRow.getByLabel("本項預計花費：NT$62,800"),
    ).toBeVisible();
    await expect(
      sameCategoryChildRow.getByLabel("本項實付：NT$62,800"),
    ).toBeVisible();
    await expect(
      crossCategoryChildRow.getByLabel("本項預計花費：NT$17,200"),
    ).toBeVisible();
    await expect(
      crossCategoryChildRow.getByLabel("本項實付：NT$5,200"),
    ).toBeVisible();
    await expect(
      rollupParentRow.locator('[data-budget-category-label="true"]'),
    ).toHaveText("品項分類：婚宴場地");
    await expect(
      sameCategoryChildRow.locator('[data-budget-category-label="true"]'),
    ).toHaveText("品項分類：婚宴場地");
    await expect(
      crossCategoryChildRow.locator('[data-budget-category-label="true"]'),
    ).toHaveText("品項分類：婚宴場地");
    const categoryZeroLeafAmount = zeroLeafRow.getByLabel(
      "本項預計花費：NT$0",
    );
    await expect(categoryZeroLeafAmount).toBeVisible();
    await expect(
      categoryZeroLeafAmount.getByText("含子項", { exact: true }),
    ).toHaveCount(0);
    await expect(
      zeroLeafRow.locator('[data-budget-category-label="true"]'),
    ).toHaveText("分類狀態：待重新分類");
    const plannedSummary = page.locator(
      '[data-budget-summary-cell="planned"]',
    );
    const actualSummary = page.locator(
      '[data-budget-summary-cell="actual"]',
    );
    await expect(plannedSummary).toContainText("預計總花費");
    await expect(plannedSummary).toContainText("NT$122,000");
    await expect(actualSummary).toContainText("已記錄實付");
    await expect(actualSummary).toContainText("NT$68,000");
    await expectNoPageOverflow(page);
  });

  await test.step("從賓客入口編輯手動賓客全部欄位", async () => {
    await openWorkspaceSection(page, "賓客");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "婚宴名單",
      }),
    ).toBeVisible();

    const guestArticle = page
      .getByRole("heading", { name: fixture.manualGuestName, exact: true })
      .locator("xpath=ancestor::article[1]");
    await guestArticle
      .getByRole("button", { name: `編輯 ${fixture.manualGuestName}`, exact: true })
      .click();
    const editGuestDialog = page.getByRole("dialog", {
      name: fixture.manualGuestName,
      exact: true,
    });
    await expect(editGuestDialog).toBeVisible();
    const editGuestForm = editGuestDialog.getByRole("form", {
      name: "編輯賓客表單",
    });
    await editGuestForm.getByLabel("姓名或稱呼").fill(fixture.editedGuestName);
    await editGuestForm.getByLabel("與新人的關係").selectOption("PARTNER_B");
    await editGuestForm.getByLabel("出席狀態").selectOption("ATTENDING");
    await editGuestForm.getByLabel("邀請人數（含本人）").fill("3");
    await editGuestForm.getByLabel(/備註/u).fill(fixture.editedGuestNotes);
    await submitServerAction(
      editGuestForm.getByRole("button", { name: "儲存變更" }),
    );

    const guestUpdateStatus = page.getByRole("status").filter({
      hasText: "已更新賓客。",
    });
    await expect(guestUpdateStatus).toBeVisible();
    await expect(guestUpdateStatus).toBeFocused();
    const editedGuestArticle = page
      .getByRole("heading", { name: fixture.editedGuestName, exact: true })
      .locator("xpath=ancestor::article[1]");
    await expect(editedGuestArticle).toContainText("女方親友");
    await expect(editedGuestArticle).toContainText("出席");
    await expect(
      editedGuestArticle.getByText("3 位", { exact: true }),
    ).toBeVisible();
    await expect(
      editedGuestArticle.getByRole("paragraph").filter({
        hasText: new RegExp(`^${fixture.editedGuestNotes}$`, "u"),
      }),
    ).toBeVisible();
    await expect(page.getByText("顯示 3 / 3 筆", { exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
  });

  await test.step("匯入賓客可修改營運欄位與通用聯絡資料", async () => {
    const importedGuestArticle = page
      .getByRole("heading", { name: fixture.importedGuestName, exact: true })
      .locator("xpath=ancestor::article[1]");
    const importedEditSummary = importedGuestArticle.getByRole("button", {
      name: `編輯 ${fixture.importedGuestName}`,
      exact: true,
    });
    await importedEditSummary.click();
    const importedEditDialog = page.getByRole("dialog", {
      name: fixture.importedGuestName,
      exact: true,
    });
    await expect(importedEditDialog).toBeVisible();
    const importedEditForm = importedEditDialog.getByRole("form", {
      name: "編輯賓客表單",
    });
    const importedName = importedEditForm.getByLabel("姓名或稱呼");
    const importedSide = importedEditForm.getByLabel("與新人的關係");
    const importedAttendance = importedEditForm.getByLabel("出席狀態");
    const importedPartySize = importedEditForm.getByLabel("邀請人數（含本人）");
    const importedPhone = importedEditForm.getByLabel("聯絡電話");

    await expect(importedName).toHaveValue(fixture.importedGuestName);
    await expect(importedName).toBeEditable();
    await expect(importedSide).toHaveValue("PARTNER_A");
    await expect(importedSide).toBeEnabled();
    await expect(importedAttendance).toHaveValue("ATTENDING");
    await expect(importedAttendance).toBeEnabled();
    await expect(
      importedEditForm.getByText(
        "這筆資料曾由外部來源建立，仍可依現場狀況修改；原始來源紀錄會保留供後續追蹤。",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(importedPartySize).toHaveValue("2");
    await expect(importedPartySize).toBeEditable();
    await expect(importedPartySize).toHaveJSProperty("readOnly", false);

    await importedPartySize.fill(String(fixture.importedGuestEditedPartySize));
    await importedPhone.fill(fixture.importedGuestEditedPhone);
    await submitServerAction(
      importedEditForm.getByRole("button", { name: "儲存變更" }),
    );

    const importedUpdateStatus = page.getByRole("status").filter({
      hasText: "已更新賓客。",
    });
    await expect(importedUpdateStatus).toBeVisible();
    await expect(importedUpdateStatus).toBeFocused();
    await expect(
      importedGuestArticle.getByRole("heading", {
        name: fixture.importedGuestName,
        exact: true,
      }),
    ).toBeVisible();
    await expect(importedGuestArticle).toContainText("男方親友");
    await expect(importedGuestArticle).toContainText("出席");
    await expect(
      importedGuestArticle.getByText(
        `${fixture.importedGuestEditedPartySize} 位`,
        { exact: true },
      ),
    ).toBeVisible();

    await importedGuestArticle
      .getByRole("button", {
        name: `編輯 ${fixture.importedGuestName}`,
        exact: true,
      })
      .click();
    const persistedGuestDialog = page.getByRole("dialog", {
      name: fixture.importedGuestName,
      exact: true,
    });
    const loadLatest = persistedGuestDialog.getByRole("button", {
      name: "載入最新資料",
    });
    if (await loadLatest.isVisible()) await loadLatest.click();
    await expect(persistedGuestDialog.getByLabel("聯絡電話")).toHaveValue(
      fixture.importedGuestEditedPhone,
    );
    await persistedGuestDialog
      .getByRole("button", { name: "關閉編輯賓客" })
      .click();
    await expect(importedGuestArticle.getByText(/拍拍印/u)).toHaveCount(0);
    await expectNoPageOverflow(page);
  });

  await test.step("從桌次入口新增、安排，並阻擋有人桌次縮減後安全移除空桌", async () => {
    const editedSecondTableLabel = `2 號桌 ${fixture.editedSecondTableName}`;
    await openWorkspaceSection(page, "桌次");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "桌次安排",
      }),
    ).toBeVisible();

    let floorPlan = page.getByRole("region", { name: "宴會場地配置" });
    let stableFloorCard = floorPlan.getByRole("article", {
      name: `${fixture.stableTableName}，已安排 0 / 6 位`,
    });
    await expect(stableFloorCard).toHaveAttribute("data-layout-source", "automatic");
    await expect(stableFloorCard).toHaveAttribute("data-layout-x", "500");
    await expect(stableFloorCard).toHaveAttribute("data-layout-y", "220");
    await expectFloorPlanCardsDoNotOverlap(floorPlan);
    const stableFloorButton = stableFloorCard.getByRole("button");
    await stableFloorButton.click();
    const stableFloorButtonBox = await stableFloorButton.boundingBox();
    const floorPlanBox = await floorPlan.boundingBox();
    if (!stableFloorButtonBox || !floorPlanBox) {
      throw new Error("Expected the stable floor-plan table and board to be visible.");
    }
    const dragDistance = (floorPlanBox.width - 2) * 0.05;
    await page.mouse.move(
      stableFloorButtonBox.x + stableFloorButtonBox.width / 2,
      stableFloorButtonBox.y + stableFloorButtonBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      stableFloorButtonBox.x + stableFloorButtonBox.width / 2 + dragDistance,
      stableFloorButtonBox.y + stableFloorButtonBox.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(
      page.getByRole("status").filter({ hasText: "已更新場地位置。" }),
    ).toHaveCount(0);
    // 拖到空白處不會改變固定桌號的席位；只有拖到另一桌才交換內容。
    await expect(stableFloorCard).toHaveAttribute("data-layout-source", "automatic");
    await expect(stableFloorCard).toHaveAttribute("data-layout-x", "500");
    await expect(stableFloorCard).toHaveAttribute("data-layout-y", "220");
    await expectFloorPlanCardsDoNotOverlap(floorPlan);

    await page.reload();
    floorPlan = page.getByRole("region", { name: "宴會場地配置" });
    stableFloorCard = floorPlan.getByRole("article", {
      name: `${fixture.stableTableName}，已安排 0 / 6 位`,
    });
    await expect(stableFloorCard).toHaveAttribute("data-layout-source", "automatic");
    await expect(stableFloorCard).toHaveAttribute("data-layout-x", "500");
    await expect(stableFloorCard).toHaveAttribute("data-layout-y", "220");
    await expectFloorPlanCardsDoNotOverlap(floorPlan);
    await expectNoPageOverflow(page);

    let settingsForm = page
      .getByRole("heading", { name: "桌數設定" })
      .locator("xpath=ancestor::section[1]")
      .locator("form");
    await expect(settingsForm.getByLabel("總桌數")).toHaveValue("1");

    // 收合的 <dialog> 不在無障礙樹裡，所以這時只會命中標題列的觸發鈕。
    await page.getByRole("button", { name: "新增桌次", exact: true }).click();
    const createTableDialog = page.getByRole("dialog", { name: "新增桌次" });
    await expect(createTableDialog).toBeVisible();
    await createTableDialog.getByLabel("桌名").fill(fixture.editedSecondTableName);
    await createTableDialog.getByLabel("容量").fill("10");
    await createTableDialog.getByLabel(/備註/u).fill("真實桌次流程人工備註");
    // 其他步驟都用 submitServerAction 等 POST 真的回 2xx；這裡原本只點下去
    // 就往下走，Server Action 還沒成功時會誤判成「桌次已建立」。
    await submitServerAction(
      createTableDialog.getByRole("button", { name: "新增桌次", exact: true }),
      { awaitPendingState: false },
    );
    await expect(createTableDialog).toBeHidden();

    // Dialog 會在 action 成功後先收合，RSC 的桌次清單與總桌數稍後才一起
    // 套用。等待真正新增的桌次出現在場地配置，避免讀到上一個 render 的 1 桌。
    const createdFloorCard = floorPlan.getByRole("article", {
      name: fixture.editedSecondTableName,
    });
    await expect(createdFloorCard).toBeVisible({ timeout: 30_000 });

    settingsForm = page
      .getByRole("heading", { name: "桌數設定" })
      .locator("xpath=ancestor::section[1]")
      .locator("form");
    await expect(settingsForm.getByLabel("總桌數")).toHaveValue("2");
    await expect(
      floorPlan.getByRole("article", { name: fixture.stableTableName }),
    ).toBeVisible();
    await expectFloorPlanCardsDoNotOverlap(floorPlan);
    await createdFloorCard.getByRole("button").click();
    const tableDetails = page.getByRole("region", { name: "桌次明細" });

    const maleUnassignedSection = page.getByRole("region", {
      name: "男方親友",
    });
    const femaleUnassignedSection = page.getByRole("region", {
      name: "女方親友",
    });
    const sharedUnassignedSection = page.getByRole("region", {
      name: "共同親友",
    });
    await expect(maleUnassignedSection).toContainText(fixture.importedGuestName);
    await expect(femaleUnassignedSection).toContainText(fixture.editedGuestName);
    await expect(sharedUnassignedSection).not.toContainText(fixture.declinedGuestName);
    await expect(page.getByText(fixture.declinedGuestName, { exact: true })).toHaveCount(0);
    const [maleBox, femaleBox, sharedBox] = await Promise.all([
      maleUnassignedSection.boundingBox(),
      femaleUnassignedSection.boundingBox(),
      sharedUnassignedSection.boundingBox(),
    ]);
    expect(maleBox).not.toBeNull();
    expect(femaleBox).not.toBeNull();
    expect(sharedBox).not.toBeNull();
    expect(Math.abs(maleBox!.x - femaleBox!.x)).toBeLessThanOrEqual(2);
    expect(femaleBox!.y).toBeGreaterThanOrEqual(
      maleBox!.y + maleBox!.height - 2,
    );
    expect(sharedBox!.y).toBeGreaterThanOrEqual(
      femaleBox!.y + femaleBox!.height - 2,
    );
    await expectNoPageOverflow(page);
    if (isMobile) return;

    const assignment = page.getByLabel(`為${fixture.editedGuestName}選擇桌次`);
    await assignment.selectOption({ label: `${editedSecondTableLabel}（剩餘 10 位）` });
    await submitServerAction(
      page.getByRole("button", { name: `安排${fixture.editedGuestName}` }),
    );
    const editedTableArticle = tableDetails
      .getByRole("article")
      .filter({ hasText: fixture.editedSecondTableName });
    await expect(
      editedTableArticle.getByText(`${fixture.editedGuestName}・3 位`, { exact: true }),
    ).toBeVisible();
    await submitServerAction(
      editedTableArticle.getByRole("button", {
        name: `將${fixture.editedGuestName}移出桌次`,
      }),
    );
    const unassignedSection = page.getByRole("region", {
      name: "女方親友",
    });
    // 從實際的女方未安排區操作；姓名與可就地編輯的人數是兩個元素。
    await expect(
      unassignedSection.getByText(fixture.editedGuestName, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      unassignedSection.getByLabel(
        `${fixture.editedGuestName}的邀請人數（含本人）`,
      ),
    ).toHaveValue("3");
    await expect(
      editedTableArticle.getByText(`${fixture.editedGuestName}・3 位`, {
        exact: true,
      }),
    ).toHaveCount(0);

    // 不切到賓客名單頁，直接在未安排清單調整最終邀請人數。
    const partySizeField = unassignedSection.getByLabel(
      `${fixture.editedGuestName}的邀請人數（含本人）`,
    );
    const partySizeSubmit = unassignedSection.getByRole("button", {
      name: `更新${fixture.editedGuestName}的邀請人數`,
    });
    await expect(partySizeSubmit).toBeDisabled();
    await partySizeField.fill("4");
    await submitServerAction(partySizeSubmit);
    await expect(
      unassignedSection.getByLabel(
        `${fixture.editedGuestName}的邀請人數（含本人）`,
      ),
    ).toHaveValue("4");

    await page
      .getByLabel(`為${fixture.editedGuestName}選擇桌次`)
      .selectOption({ label: `${editedSecondTableLabel}（剩餘 10 位）` });
    await submitServerAction(
      page.getByRole("button", { name: `安排${fixture.editedGuestName}` }),
    );
    await expect(
      editedTableArticle.getByText(`${fixture.editedGuestName}・4 位`, {
        exact: true,
      }),
    ).toBeVisible();

    settingsForm = page
      .getByRole("heading", { name: "桌數設定" })
      .locator("xpath=ancestor::section[1]")
      .locator("form");
    await settingsForm.getByLabel("總桌數").fill("1");
    await submitServerAction(
      settingsForm.getByRole("button", { name: "套用桌數設定" }),
    );
    await expect(
      settingsForm.getByRole("heading", { name: "確認縮減桌數" }),
    ).toBeVisible();
    await expect(
      settingsForm.getByText("將移除名單中的 1 桌。", { exact: true }),
    ).toBeVisible();
    await expect(
      settingsForm.getByText("合計受影響 1 組、4 位賓客。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      settingsForm.getByRole("alert").filter({
        hasText: "仍有賓客的桌次不能移除，請先移動賓客。",
      }),
    ).toBeVisible();
    await expect(
      settingsForm.getByRole("button", {
        name: "請先移動待移除桌次的賓客",
      }),
    ).toBeDisabled();
    await expect(editedTableArticle).toBeVisible();
    await expect(
      editedTableArticle.getByText(`${fixture.editedGuestName}・4 位`, {
        exact: true,
      }),
    ).toBeVisible();

    await submitServerAction(
      editedTableArticle.getByRole("button", {
        name: `將${fixture.editedGuestName}移出桌次`,
      }),
    );
    // 未安排清單把人數換成可就地編輯的輸入框，姓名與人數是兩個元素。
    await expect(
      unassignedSection.getByText(fixture.editedGuestName, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      unassignedSection.getByLabel(
        `${fixture.editedGuestName}的邀請人數（含本人）`,
      ),
    ).toHaveValue("4");
    await settingsForm
      .getByRole("button", { name: "取消並放棄確認" })
      .click();

    settingsForm = page
      .getByRole("heading", { name: "桌數設定" })
      .locator("xpath=ancestor::section[1]")
      .locator("form");
    await settingsForm.getByLabel("總桌數").fill("1");
    await submitServerAction(
      settingsForm.getByRole("button", { name: "套用桌數設定" }),
    );
    await expect(
      settingsForm.getByText("所列桌次目前都是空桌；確認後才會永久移除。", {
        exact: true,
      }),
    ).toBeVisible();
    await submitServerAction(
      settingsForm.getByRole("button", { name: "確認移除 1 桌空桌" }),
    );
    await expect(editedTableArticle).toHaveCount(0);
    await expect(
      page.getByLabel(`${fixture.editedGuestName}的邀請人數（含本人）`),
    ).toHaveValue("4");
    await expect(
      tableDetails
        .getByRole("article")
        .filter({ hasText: fixture.stableTableName })
        .getByText("已安排 0 / 6 位", { exact: true }),
    ).toBeVisible();
    floorPlan = page.getByRole("region", { name: "宴會場地配置" });
    await expectFloorPlanCardsDoNotOverlap(floorPlan);
    await expectNoPageOverflow(page);
  });

  await test.step("從報到入口完成一鍵報到、調整人數與取消報到", async () => {
    await openWorkspaceSection(page, "報到");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "賓客報到",
      }),
    ).toBeVisible();

    const board = page.getByRole("region", { name: "賓客報到" });
    const expectStat = async (label: string, value: string) => {
      await expect(
        board
          .getByText(label, { exact: true })
          .locator("xpath=following-sibling::p[1]"),
      ).toHaveText(new RegExp(`^${value}`, "u"));
    };

    // 出席回覆是「預計」，報到才是「實到」；一開始兩者不該互相污染。
    await expectStat("實到人數", "0");
    await expectStat("已報到組數", "0");

    const guestCard = board.getByRole("article", {
      name: fixture.editedGuestName,
    });
    await expect(guestCard.getByText("尚未報到", { exact: true })).toBeVisible();

    // 一鍵報到預設帶入這一組的邀請人數；桌機與手機的既有名單人數不同，
    // 所以從畫面讀回真正的預設值，而不是把某一種尺寸的數字寫死。
    const quickCheckInButton = guestCard
      .getByRole("form", {
        name: `為 ${fixture.editedGuestName} 快速報到表單`,
      })
      .getByRole("button");
    const invitedHeadcount = Number(
      ((await quickCheckInButton.textContent()) ?? "").replace(/\D+/gu, ""),
    );
    expect(invitedHeadcount).toBeGreaterThan(1);

    await submitServerAction(quickCheckInButton);
    await expect(
      guestCard.getByText(`實到 ${invitedHeadcount} 位`, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expectStat("實到人數", String(invitedHeadcount));
    await expectStat("已報到組數", "1");
    await expectNoPageOverflow(page);

    await guestCard.getByRole("button", { name: "調整人數" }).click();
    const adjustForm = page.getByRole("form", {
      name: `調整 ${fixture.editedGuestName} 的報到人數表單`,
    });
    await expect(adjustForm.getByLabel("實際到場人數")).toHaveValue(
      String(invitedHeadcount),
    );
    await adjustForm.getByLabel("實際到場人數").fill("1");
    await adjustForm.getByLabel("報到備註（選填）").fill("其他人臨時未到");
    await submitServerAction(
      adjustForm.getByRole("button", { name: "儲存報到人數" }),
    );
    await expect(guestCard.getByText("實到 1 位", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(guestCard.getByText("其他人臨時未到")).toBeVisible();
    await expectStat("實到人數", "1");

    // 重新載入後仍要看到 server 的權威結果，而不是只有本地成功快照。
    await page.reload();
    const reloadedCard = page
      .getByRole("region", { name: "賓客報到" })
      .getByRole("article", { name: fixture.editedGuestName });
    await expect(
      reloadedCard.getByText("實到 1 位", { exact: true }),
    ).toBeVisible();

    await reloadedCard.getByRole("button", { name: "取消報到" }).click();
    const cancelForm = page.getByRole("form", {
      name: `取消 ${fixture.editedGuestName} 的報到表單`,
    });
    await expect(cancelForm.getByText("目前記錄實到 1 位。")).toBeVisible();
    await submitServerAction(
      cancelForm.getByRole("button", { name: "取消報到" }),
    );
    await expect(
      page
        .getByRole("region", { name: "賓客報到" })
        .getByRole("article", { name: fixture.editedGuestName })
        .getByText("尚未報到", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expectStat("實到人數", "0");
    await expectNoPageOverflow(page);
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
