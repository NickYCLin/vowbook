import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

async function installDialogFocusHelper(page: Page) {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/dialog-focus-containment.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  await page.addScriptTag({
    type: "module",
    content: `${compiled}\nwindow.__containDialogFocus = containDialogFocus;`,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as Window & {
              __containDialogFocus?: unknown;
            }
          ).__containDialogFocus,
      ),
    )
    .toBe("function");
}

async function installWorkspaceNavigationHelper(page: Page) {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/workspace-navigation.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  await page.addScriptTag({
    type: "module",
    content: `${compiled}\nwindow.__revealActiveWorkspaceNavigationItem = revealActiveWorkspaceNavigationItem;`,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as Window & {
              __revealActiveWorkspaceNavigationItem?: unknown;
            }
          ).__revealActiveWorkspaceNavigationItem,
      ),
    )
    .toBe("function");
}

async function loadAuthenticatedLayoutFixture(page: Page) {
  await page.goto("./");
  const stylesheets = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).href),
    );

  await page.setContent(`
    <!doctype html>
    <html lang="zh-Hant">
      <head>
        ${stylesheets
          .map((href) => `<link rel="stylesheet" href="${href}">`)
          .join("")}
      </head>
      <body>
        <header class="border-b border-stone-300 bg-[#f8f3ec]">
          <div data-header-frame class="mx-auto flex w-full max-w-6xl items-center px-5 py-4 sm:px-8">
            <span class="font-serif text-xl font-semibold">誓約簿 VowBook</span>
          </div>
        </header>
        <main data-content-frame class="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
          <p data-route-title class="font-serif text-3xl">我的婚宴</p>
          <nav data-workspace-nav aria-label="工作區功能" class="mt-3 min-w-0 overflow-x-auto border-y border-stone-300 [scrollbar-width:thin]">
            <div class="flex w-max min-w-full flex-nowrap gap-x-1">
              ${[
                ["賓客", "Guests"],
                ["桌次", "Tables"],
                ["任務", "Tasks"],
                ["花費", "Budget"],
                ["工作人員", "Staff"],
                ["總流程", "Timeline"],
                ["協作者", "Members"],
              ]
                .map(
                  ([label, route]) =>
                    `<a href="#${route}" data-route="${route}" class="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap px-3 py-2 text-sm font-medium">${label}</a>`,
                )
                .join("")}
            </div>
          </nav>
          <section class="mt-6 border-y border-stone-300 py-8">
            <h1 data-section-heading class="font-serif text-4xl">Dashboard</h1>
          </section>
        </main>
        <script>
          for (const link of document.querySelectorAll("[data-route]")) {
            link.addEventListener("click", (event) => {
              event.preventDefault();
              for (const candidate of document.querySelectorAll("[data-route]")) {
                candidate.removeAttribute("aria-current");
              }
              link.setAttribute("aria-current", "page");
              window.__revealActiveWorkspaceNavigationItem(
                document.querySelector("[data-workspace-nav]"),
                link,
              );
              document.querySelector("[data-section-heading]").textContent =
                link.dataset.route;
            });
          }
        </script>
      </body>
    </html>
  `);
  await installWorkspaceNavigationHelper(page);

  await expect
    .poll(() =>
      page
        .locator("[data-header-frame]")
        .evaluate((element) => getComputedStyle(element).maxWidth),
    )
    .toBe("1152px");
}

test("authenticated frame 與七頁籤在切換時維持對齊及固定高度", async ({
  page,
}, testInfo) => {
  await loadAuthenticatedLayoutFixture(page);

  const headerFrame = page.locator("[data-header-frame]");
  const contentFrame = page.locator("[data-content-frame]");
  const navigation = page.locator("[data-workspace-nav]");
  const initialHeaderX = (await headerFrame.boundingBox())?.x;
  const initialContentX = (await contentFrame.boundingBox())?.x;
  const initialNavigationHeight = (await navigation.boundingBox())?.height;

  expect(initialHeaderX).toBeDefined();
  expect(initialContentX).toBe(initialHeaderX);
  expect(initialNavigationHeight).toBeGreaterThan(0);

  await expect(navigation.locator("[data-route]")).toHaveCount(7);

  for (const route of ["Guests", "Staff", "Timeline", "Members"]) {
    await page.locator(`[data-route="${route}"]`).click();
    await expect(page.locator("[data-section-heading]")).toHaveText(route);
    expect((await headerFrame.boundingBox())?.x).toBe(initialHeaderX);
    expect((await contentFrame.boundingBox())?.x).toBe(initialContentX);
    expect((await navigation.boundingBox())?.height).toBe(
      initialNavigationHeight,
    );
  }

  const linkTopPositions = await navigation
    .locator("[data-route]")
    .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
  expect(new Set(linkTopPositions).size).toBe(1);

  if (testInfo.project.name === "mobile-chromium") {
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    const [navigationBox, activeTabBox] = await Promise.all([
      navigation.boundingBox(),
      navigation.locator('[aria-current="page"]').boundingBox(),
    ]);
    expect(navigationBox).not.toBeNull();
    expect(activeTabBox).not.toBeNull();
    expect(activeTabBox!.x).toBeGreaterThanOrEqual(navigationBox!.x - 1);
    expect(activeTabBox!.x + activeTabBox!.width).toBeLessThanOrEqual(
      navigationBox!.x + navigationBox!.width + 1,
    );
  }

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("協作頁長姓名、Email與撤銷控制在 390px 內不溢位", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await loadAuthenticatedLayoutFixture(page);

  await page
    .locator("[data-content-frame]")
    .evaluate((container: HTMLElement) => {
      const memberName = "N".repeat(160);
      const memberEmail = `${"e".repeat(140)}@example.com`;
      const pendingEmail = `${"p".repeat(140)}@example.com`;
      const renewableEmail = `${"r".repeat(242)}@example.com`;
      container.innerHTML = `
        <section class="min-w-0 border-y border-stone-300 py-6">
          <ul class="divide-y divide-stone-200">
            <li class="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div class="min-w-0">
                <p data-collaboration-overflow="member-name" class="min-w-0 break-words font-medium [overflow-wrap:anywhere]">${memberName}</p>
                <a data-collaboration-overflow="member-email" class="mt-1 block min-w-0 break-all text-sm underline underline-offset-4 [overflow-wrap:anywhere]" href="mailto:${memberEmail}">${memberEmail}</a>
              </div>
              <span class="w-fit shrink-0 rounded-full border px-3 py-1 text-xs">婚顧</span>
            </li>
            <li class="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div class="min-w-0">
                <span data-collaboration-overflow="pending-email" class="block min-w-0 break-all font-medium [overflow-wrap:anywhere]">${pendingEmail}</span>
              </div>
              <button data-collaboration-overflow="revoke-control" type="button" class="inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-full border px-4 py-2 text-sm">
                <span class="min-w-0 break-words [overflow-wrap:anywhere]">撤銷 ${pendingEmail} 的邀請</span>
              </button>
            </li>
            <li class="min-w-0 py-4">
              <label data-collaboration-overflow="renewable-label" class="block min-w-0 break-all text-sm font-medium [overflow-wrap:anywhere]">
                重新邀請 ${renewableEmail} 的角色
              </label>
            </li>
          </ul>
        </section>
      `;
    });

  const dimensions = await page
    .locator("[data-collaboration-overflow]")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        field: (element as HTMLElement).dataset.collaborationOverflow,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    );
  expect(dimensions).toHaveLength(5);
  for (const dimension of dimensions) {
    expect(
      dimension.clientWidth,
      `${dimension.field} 必須是可量測的box，不能以0寬假通過`,
    ).toBeGreaterThan(0);
    expect(
      dimension.scrollWidth,
      `${dimension.field} 不應超出自己的內容寬度`,
    ).toBeLessThanOrEqual(dimension.clientWidth);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("Staff 與 Timeline 合法 Latin 長字串在 390px 內不溢位", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await loadAuthenticatedLayoutFixture(page);

  const tokens = {
    role: "R".repeat(60),
    person: "P".repeat(120),
    phase: "H".repeat(60),
    title: "T".repeat(120),
    location: "L".repeat(120),
    details: "D".repeat(500),
    media: "M".repeat(500),
    notes: "N".repeat(500),
  };
  await page
    .locator("[data-content-frame]")
    .evaluate(
      (container: HTMLElement, values: typeof tokens) => {
    container.innerHTML = "";
    const item = document.createElement("article");
    item.className =
      "min-w-0 space-y-3 border-y border-stone-300 bg-[#fffdf8]/70 px-4 py-5";
    const wrapped = "min-w-0 break-words [overflow-wrap:anywhere]";
    const control = `${wrapped} inline-flex min-h-11 max-w-full items-center whitespace-normal rounded-full border px-4 py-2 text-left`;
    const surfaces = [
      ["staff-role", "h2", wrapped, values.role],
      ["staff-person", "h3", wrapped, values.person],
      ["staff-edit", "button", control, `編輯 ${values.person}`],
      ["staff-delete", "summary", control, `移除 ${values.person}`],
      ["timeline-title", "h3", wrapped, values.title],
      ["timeline-location", "p", wrapped, values.location],
      [
        "timeline-details",
        "p",
        `${wrapped} whitespace-pre-wrap`,
        values.details,
      ],
      [
        "timeline-media",
        "p",
        `${wrapped} whitespace-pre-wrap`,
        `音樂／影片：${values.media}`,
      ],
      [
        "timeline-notes",
        "p",
        `${wrapped} whitespace-pre-wrap`,
        `備註：${values.notes}`,
      ],
      [
        "timeline-staff",
        "p",
        wrapped,
        `負責人：${values.role}・${values.person}`,
      ],
      ["timeline-edit", "button", control, `編輯 ${values.title}`],
      ["timeline-delete", "summary", control, `刪除 ${values.title}`],
    ] as const;
    for (const [field, tagName, className, text] of surfaces) {
      const element = document.createElement(tagName);
      element.dataset.overflowSurface = field;
      element.className = className;
      if (tagName === "button" || tagName === "summary") {
        const label = document.createElement("span");
        label.className = `${wrapped} whitespace-normal`;
        label.textContent = text;
        element.append(label);
      } else {
        element.textContent = text;
      }
      item.append(element);
    }

    const phaseRow = document.createElement("div");
    phaseRow.className = "flex min-w-0 items-center justify-between gap-3";
    const time = document.createElement("time");
    time.className = "shrink-0";
    time.textContent = "11:30";
    const phase = document.createElement("span");
    phase.dataset.overflowSurface = "timeline-phase";
    phase.className = `${wrapped} max-w-full`;
    phase.textContent = values.phase;
    phaseRow.append(time, phase);
    item.append(phaseRow);

    const staffLabel = document.createElement("label");
    staffLabel.className =
      "flex min-h-11 min-w-0 items-center gap-3 rounded-lg border px-3 py-2";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "shrink-0";
    const checkboxText = document.createElement("span");
    checkboxText.dataset.overflowSurface = "timeline-checkbox-label";
    checkboxText.className = wrapped;
    checkboxText.textContent = `${values.role}・${values.person}`;
    staffLabel.append(checkbox, checkboxText);
    item.append(staffLabel);
    container.append(item);
  }, tokens);

  // Vitest locks these classes to the real components; this browser matrix
  // independently proves the utility contract against Chromium layout.
  const dimensions = await page
    .locator("[data-overflow-surface]")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        field: (element as HTMLElement).dataset.overflowSurface,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    );
  expect(dimensions).toHaveLength(14);
  for (const dimension of dimensions) {
    expect(
      dimension.scrollWidth,
      `${dimension.field} 不應超出自己的內容寬度`,
    ).toBeLessThanOrEqual(dimension.clientWidth);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("native dialog 在真實 Chromium 鎖定 outer 與 nested 鍵盤焦點", async ({
  page,
}) => {
  await page.setContent(`
    <!doctype html>
    <html lang="zh-Hant">
      <body>
        <button id="outside">dialog 外部</button>
        <dialog id="outer">
          <button id="outer-zero-first">outer zero first</button>
          <button id="outer-positive-two" tabindex="2">outer positive two</button>
          <button id="outer-positive-one" tabindex="1">outer positive one</button>
          <button hidden>hidden</button>
          <button disabled>disabled</button>
          <div inert><button>inert descendant</button></div>
          <details>
            <summary>closed details</summary>
            <button>closed details control</button>
          </details>
          <dialog id="inner">
            <button id="inner-first">inner first</button>
            <button hidden>inner hidden</button>
            <button id="inner-last">inner last</button>
          </dialog>
          <button id="outer-last">outer last</button>
        </dialog>
      </body>
    </html>
  `);
  await installDialogFocusHelper(page);
  await page.evaluate(() => {
    const scope = window as unknown as Window & {
      __containDialogFocus: (
        event: KeyboardEvent,
        dialog: HTMLDialogElement,
      ) => void;
    };
    const outer = document.querySelector<HTMLDialogElement>("#outer")!;
    const inner = document.querySelector<HTMLDialogElement>("#inner")!;
    outer.addEventListener("keydown", (event) =>
      scope.__containDialogFocus(event, outer),
    );
    inner.addEventListener("keydown", (event) =>
      scope.__containDialogFocus(event, inner),
    );
    outer.showModal();
  });

  await page.locator("#outer-last").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#outer-positive-one")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#outer-last")).toBeFocused();
  await expect(page.locator("#outside")).not.toBeFocused();

  await page.evaluate(() =>
    document.querySelector<HTMLDialogElement>("#inner")!.showModal(),
  );
  await page.locator("#inner-last").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#inner-first")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#inner-last")).toBeFocused();
  await expect(page.locator("#outer-positive-one")).not.toBeFocused();

  await page.evaluate(() =>
    document.querySelector<HTMLDialogElement>("#inner")!.close(),
  );
  await page.locator("#outer-last").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#outer-positive-one")).toBeFocused();
});
