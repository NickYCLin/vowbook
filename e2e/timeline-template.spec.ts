import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

type TimelineTemplateFixture = { workspaceId: string };

const enabled = process.env.VOWBOOK_CRUD_E2E === "1";
const googleSubject = process.env.VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT;
const email = process.env.VOWBOOK_CRUD_E2E_EMAIL;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const authSecret =
  process.env.AUTH_SECRET ?? "vowbook-e2e-local-secret-not-for-production";
const fixtures = parseFixtures(process.env.VOWBOOK_CRUD_E2E_FIXTURES);

function parseFixtures(value: string | undefined): {
  desktop: TimelineTemplateFixture;
  mobile: TimelineTemplateFixture;
} | null {
  if (!value) return null;
  return JSON.parse(value) as {
    desktop: TimelineTemplateFixture;
    mobile: TimelineTemplateFixture;
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required when VOWBOOK_CRUD_E2E=1.`);
  return value;
}

test.skip(!enabled, "需要明確啟用隔離 CRUD E2E fixture。");
test.use({ actionTimeout: 15_000 });

test("午宴範本只在本次明確選擇時加入西式證婚", async ({
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

  await page.goto(`./workspaces/${fixture.workspaceId}/timeline`);
  await expect(
    page.getByRole("heading", { name: "尚未建立婚禮總流程" }),
  ).toBeVisible();
  const westernOption = page.getByRole("checkbox", {
    name: "這次有西式證婚，範本要加入證婚流程",
  });
  await expect(westernOption).not.toBeChecked();
  if (!isMobile) await westernOption.check();

  const submit = page.getByRole("button", {
    name: "建立詳細午宴流程範本",
  });
  const actionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]),
  );
  await submit.click();
  expect((await actionResponse).ok()).toBe(true);

  const activeLayout = page.locator(
    isMobile
      ? '[data-timeline-layout="mobile"]'
      : '[data-timeline-layout="desktop"]',
  );
  // Server Action 的 HTTP response 可能早於 RSC payload 套用完成；直接等待
  // 使用者真正需要的流程清單，避免把 Tailwind 的 disabled:cursor-wait
  // class 字串誤當成 transition 已結束的訊號。手機模擬下整份 RSC payload
  // 套用得比桌機慢得多，所以這裡的預算要比一般 action timeout 寬。
  await expect(activeLayout.locator("li")).toHaveCount(isMobile ? 8 : 9, {
    timeout: 30_000,
  });
  const westernHeading = activeLayout.getByRole("heading", {
    name: "證婚儀式",
    exact: true,
  });
  if (isMobile) await expect(westernHeading).toHaveCount(0);
  else await expect(westernHeading).toBeVisible();

  const dimensions = await page.locator("body").evaluate((body) => ({
    clientWidth: body.clientWidth,
    scrollWidth: body.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
