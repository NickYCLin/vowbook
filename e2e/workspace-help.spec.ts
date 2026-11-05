import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

test.skip(process.env.VOWBOOK_CRUD_E2E !== "1", "需要隔離 CRUD 合成資料。");
test.beforeEach(async ({ context }) => {
  const subject = process.env.VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT;
  const email = process.env.VOWBOOK_CRUD_E2E_EMAIL;
  if (!subject || !email) throw new Error("Missing isolated CRUD identity");
  const token = await encode({ secret: process.env.AUTH_SECRET ?? "vowbook-e2e-local-secret-not-for-production", maxAge: 3600, token: { googleSubject: subject, email, name: "合成擁有者" } });
  await context.addCookies([{ name: "vowbook.session-token", value: token, domain: "127.0.0.1", path: process.env.NEXT_PUBLIC_BASE_PATH || "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
});
function workspace(project: string) {
  const encoded = process.env.VOWBOOK_CRUD_E2E_FIXTURES;
  if (!encoded) throw new Error("Missing isolated CRUD fixtures");
  const fixtures = JSON.parse(encoded) as Record<"desktop" | "mobile", { workspaceId: string }>;
  return fixtures[project.startsWith("mobile") ? "mobile" : "desktop"].workspaceId;
}
test("每個功能都有完成範例，開關不會改動婚宴", async ({ page }, info) => {
  const workspaceId = workspace(info.project.name);
  for (const section of ["overview", "guests", "tables", "tasks", "budget", "documents", "check-in", "gifts", "timeline", "staff", "members", "settings"]) {
    await page.goto(`./workspaces/${workspaceId}/${section}`);
    const trigger = page.getByRole("button", { name: "看完成範例", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/以下皆為虛構資料/)).toBeVisible();
    await expect(dialog.getByRole("table")).toBeVisible();
    await expect(dialog.locator("form, input, textarea, a")).toHaveCount(0);
    if (section === "timeline" || section === "budget") await page.screenshot({ path: info.outputPath(`example-${section}.png`) });
    await dialog.getByRole("button", { name: "關閉範例", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});
test("功能列可送出回饋，暫時關閉保留內容，保存後顯示編號", async ({ page }, info) => {
  await page.goto(`./workspaces/${workspace(info.project.name)}/timeline`);
  if (info.project.name.startsWith("mobile")) await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "意見回饋", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "意見回饋", exact: true });
  await expect(dialog.getByRole("combobox", { name: "相關功能（選填）" })).toHaveValue("");
  await expect(dialog.getByRole("combobox", { name: "回饋類型（選填）" })).toHaveValue("");
  const message = "想法";
  await dialog.getByRole("textbox", { name: "回饋內容" }).fill(message);
  await dialog.getByRole("button", { name: "暫時關閉，保留內容" }).click();
  await page.getByRole("button", { name: "意見回饋", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "回饋內容" })).toHaveValue(message);
  await dialog.getByRole("button", { name: "暫時關閉，保留內容" }).click();
  if (info.project.name.startsWith("mobile")) await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("navigation", { name: "工作區功能", exact: true }).getByRole("link", { name: "花費", exact: true }).click();
  await expect(page).toHaveURL(/\/budget$/u);
  if (info.project.name.startsWith("mobile")) await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "意見回饋", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "相關功能（選填）" })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: "回饋內容" })).toHaveValue("");
  await dialog.getByRole("textbox", { name: "回饋內容" }).fill(message);
  await page.screenshot({ path: info.outputPath("feedback-form.png") });
  await dialog.getByRole("button", { name: "送出回饋", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("你的回饋已保存");
  await expect(dialog.getByRole("status")).toContainText(/回饋編號：[0-9a-f-]{36}/u);
  await page.screenshot({ path: info.outputPath("feedback-saved.png") });
  await dialog.getByRole("button", { name: "再寫一則回饋" }).click();
  await dialog.getByRole("textbox", { name: "回饋內容" }).fill("合成想法".repeat(1000));
  await dialog.getByRole("button", { name: "送出回饋", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("你的回饋已保存");
});
