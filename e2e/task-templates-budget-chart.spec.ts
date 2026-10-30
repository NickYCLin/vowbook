import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
test.skip(process.env.VOWBOOK_CRUD_E2E !== "1", "需要隔離 CRUD 合成資料。");
test.beforeEach(async ({ context }) => {
  const subject = process.env.VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT;
  const email = process.env.VOWBOOK_CRUD_E2E_EMAIL;
  if (!subject || !email) throw new Error("Missing isolated CRUD identity");
  const token = await encode({ secret: process.env.AUTH_SECRET ?? "vowbook-e2e-local-secret-not-for-production", maxAge: 3600,
    token: { googleSubject: subject, email, name: "合成擁有者" } });
  await context.addCookies([{ name: "vowbook.session-token", value: token, domain: "127.0.0.1", path: process.env.NEXT_PUBLIC_BASE_PATH || "/",
    httpOnly: true, secure: false, sameSite: "Lax" }]);
});
function workspace(project: string) {
  const encoded = process.env.VOWBOOK_CRUD_E2E_FIXTURES;
  if (!encoded) throw new Error("Missing isolated CRUD fixtures");
  const fixtures = JSON.parse(encoded) as { desktop: { workspaceId: string }; mobile: { workspaceId: string } };
  return (project.startsWith("mobile") ? fixtures.mobile : fixtures.desktop).workspaceId;
}
test("文定與宴客任務可預覽並加入，重複加入不覆蓋既有任務", async ({ page }, info) => {
  await page.goto(`./workspaces/${workspace(info.project.name)}/tasks`);
  await page.getByRole("button", { name: "從範本新增", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "選擇任務範本" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(8);
  await dialog.getByRole("button", { name: "加入文定任務", exact: true }).click();
  await expect(dialog.getByText("已加入 8 項任務，略過 0 項既有任務。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "加入文定任務", exact: true }).click();
  await expect(dialog.getByText("已加入 0 項任務，略過 8 項既有任務。", { exact: true })).toBeVisible();
  await dialog.getByLabel(/任務類型/).selectOption("RECEPTION");
  await expect(dialog.getByRole("listitem")).toHaveCount(10);
  await dialog.getByRole("button", { name: "加入宴客任務", exact: true }).click();
  await expect(dialog.getByText("已加入 10 項任務，略過 0 項既有任務。", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel(/任務類型/)).toHaveValue("RECEPTION");
  await dialog.getByRole("button", { name: "加入宴客任務", exact: true }).click();
  await expect(dialog.getByText("已加入 0 項任務，略過 10 項既有任務。", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel(/任務類型/)).toHaveValue("RECEPTION");
  await page.screenshot({ path: info.outputPath("task-template-result.png"), fullPage: true });
  await dialog.getByRole("button", { name: "關閉任務範本" }).click();
  await expect(page.getByRole("region", { name: "婚宴任務清單" }).getByRole("heading", { name: "確認文定日期與儀式地點" })).toHaveCount(1);
});
test("花費分類圓環圖有金額排行且可切換實際花費", async ({ page }, info) => {
  await page.goto(`./workspaces/${workspace(info.project.name)}/budget`);
  const analysis = page.getByRole("region", { name: "花費分類分析" });
  await expect(analysis.getByRole("img", { name: /預計花費分類圓環圖/ })).toBeVisible();
  await expect(analysis.getByRole("list", { name: "預計花費分類金額排行" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("budget-planned-analysis.png"), fullPage: true });
  await analysis.getByRole("button", { name: "實際花費", exact: true }).click();
  await expect(analysis.getByRole("button", { name: "實際花費", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(analysis.getByText(/不用預計或付款紀錄代填/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath("budget-analysis.png"), fullPage: true });
});
