/**
 * RWD 稽核：把正式元件離線渲染成 HTML，套上 next build 產出的真實 CSS，
 * 在 Chromium 用多組寬度量測是否有水平溢出。
 *
 * 用法：npm run build 之後執行 node scripts/rwd-audit.mjs
 *
 * 只讀取本 repository 內的檔案，不連線、不碰資料庫；
 * Server Action 一律換成不做事的 stub，確保稽核不會觸發任何寫入。
 */
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { chromium } from "@playwright/test";

const root = process.cwd();
const projectBrowserPath = path.join(root, ".playwright-browsers");
const outDir = path.join(root, ".rwd-audit");
const widths = [320, 360, 390, 414, 640, 768, 1024, 1280, 1440];

/** 讓稽核跑得動的最小替身：Server Action、Prisma 與 Next 執行期模組。 */
function offlineStubs() {
  const virtualPrefix = "\0vowbook-rwd-stub:";
  const bareStubs = {
    "server-only": "export {};",
    "next/cache": "export const revalidatePath = () => {};",
    "next/navigation": [
      "export const notFound = () => {};",
      "export const redirect = () => {};",
      "export const useRouter = () => ({ push: () => {}, refresh: () => {} });",
      "export const usePathname = () => '/';",
    ].join("\n"),
    "next-auth/react": [
      "export const signIn = () => {};",
      "export const signOut = () => {};",
      "export const useSession = () => ({ data: null, status: 'unauthenticated' });",
      "export const SessionProvider = ({ children }) => children;",
    ].join("\n"),
    "next/link": [
      "import { createElement } from 'react';",
      "export const useLinkStatus = () => ({ pending: false });",
      "export default function Link({ href, children, ...rest }) {",
      "  return createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children);",
      "}",
    ].join("\n"),
  };

  return {
    name: "vowbook-rwd-offline-stubs",
    enforce: "pre",
    resolveId(source) {
      if (source in bareStubs) return `${virtualPrefix}${source}`;
      return null;
    },
    async load(id) {
      if (id.startsWith(virtualPrefix)) {
        return bareStubs[id.slice(virtualPrefix.length)];
      }

      const normalized = id.replace(/\\/g, "/");
      if (normalized.includes("/src/actions/")) {
        const source = await readFile(id.split("?")[0], "utf8");
        const names = new Set();
        for (const match of source.matchAll(
          /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
        )) {
          names.add(match[1]);
        }
        for (const match of source.matchAll(
          /export\s+const\s+([A-Za-z0-9_$]+)/g,
        )) {
          names.add(match[1]);
        }
        // Server Action 換成永遠 idle 的函式，稽核只需要初始畫面。
        return [...names]
          .map(
            (name) =>
              `export const ${name} = async () => ({ status: "idle" });`,
          )
          .join("\n");
      }

      if (normalized.endsWith("/src/lib/prisma.ts")) {
        return "export const prisma = {};";
      }

      return null;
    },
  };
}

async function bundleFixtures() {
  await build({
    root,
    configFile: false,
    logLevel: "error",
    plugins: [offlineStubs()],
    resolve: { alias: { "@": path.join(root, "src") } },
    define: { "process.env.NODE_ENV": '"production"' },
    build: {
      ssr: path.join(root, "scripts/rwd-fixtures.tsx"),
      outDir: path.join(outDir, "bundle"),
      emptyOutDir: true,
      target: "node20",
      minify: false,
      rollupOptions: { output: { format: "esm", entryFileNames: "fixtures.mjs" } },
    },
  });

  const bundlePath = path.join(outDir, "bundle/fixtures.mjs");
  const { renderSurfaces } = await import(pathToFileURL(bundlePath).href);
  return renderSurfaces();
}

async function findBuiltStylesheet() {
  const cssDirs = [
    path.join(root, ".next/static/chunks"),
    path.join(root, ".next/static/css"),
  ];
  for (const dir of cssDirs) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    const sheets = entries.filter((entry) => entry.endsWith(".css"));
    if (sheets.length > 0) {
      return path.join(dir, sheets[0]);
    }
  }
  throw new Error("找不到 next build 產出的 CSS，請先執行 npm run build。");
}

/**
 * 優先用 npm run e2e:install 裝在專案內的 Chromium，各平台的目錄名稱不同。
 * 找不到就回傳 undefined，交給 Playwright 自己解析預設安裝位置——
 * 否則在沒有 .playwright-browsers 的開發機（例如 Windows）會直接失敗。
 */
async function findProjectChromium() {
  const layouts = [
    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
    ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
    ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
  ];

  let entries;
  try {
    entries = (await readdir(projectBrowserPath, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith("chromium_headless_shell-"),
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    for (const [directory, binary] of layouts) {
      const executablePath = path.join(
        projectBrowserPath,
        entry,
        directory,
        binary,
      );
      try {
        await access(executablePath);
        return executablePath;
      } catch {
        // Keep looking: a partial browser installation is not usable.
      }
    }
  }

  return undefined;
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const stylesheet = await findBuiltStylesheet();
  const css = await readFile(stylesheet, "utf8");
  const surfaces = await bundleFixtures();

  for (const surface of surfaces) {
    const html = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${css}</style>
  </head>
  <body>${surface.body}</body>
</html>`;
    await writeFile(path.join(outDir, `${surface.name}.html`), html, "utf8");
  }

  const executablePath = await findProjectChromium();
  const browser = await chromium.launch(
    executablePath ? { executablePath } : {},
  );
  const failures = [];
  // 第二輪把收合的 <dialog> 攤平成一般流內元素，才量得到對話框在窄畫面的排版。
  const dialogModes = [
    { key: "closed", css: "" },
    {
      key: "dialog-open",
      // 真實的 modal 在 top layer、以視窗為基準定位，這裡用 fixed 模擬同樣的幾何。
      css:
        "dialog{display:block!important;position:fixed!important;inset:0!important;margin:auto!important;max-height:none!important;}",
    },
  ];

  for (const surface of surfaces) {
    const fileUrl = pathToFileURL(
      path.join(outDir, `${surface.name}.html`),
    ).href;

    for (const width of widths) {
     for (const mode of dialogModes) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
      });
      await page.goto(fileUrl, { waitUntil: "load" });
      if (mode.css) await page.addStyleTag({ content: mode.css });
      // 帳號外觀選單使用 <details>；固定定位的收合內容在 Chromium 量測時
      // 可能留下非零幾何。主動展開它，既避免假陽性，也讓每個斷點實際驗證選單。
      const themeSummary = page.locator(
        'summary[aria-label^="開啟帳號與外觀選單"]',
      );
      if ((await themeSummary.count()) > 0) {
        await themeSummary.evaluate((summary) => {
          summary.closest("details").open = true;
        });
      }

      const report = await page.evaluate((dialogsForcedOpen) => {
        // 用 clientWidth 當基準，捲軸寬度才不會被誤判成溢出。
        const contentWidth = document.documentElement.clientWidth;
        const documentOverflow =
          document.documentElement.scrollWidth - contentWidth;

        /**
         * 自行捲動的容器（例如工作區導覽）本來就允許比視窗寬，可以略過。
         * overflow-x: hidden 不算過關——它只是把內容默默切掉，
         * globals.css 在 html/body 都設了 hidden，會蓋掉所有真正的爆版。
         */
        const isInsideScrollContainer = (element) => {
          let node = element.parentElement;
          while (node && node !== document.documentElement) {
            const overflowX = getComputedStyle(node).overflowX;
            if (overflowX === "auto" || overflowX === "scroll") return true;
            node = node.parentElement;
          }
          return false;
        };

        /** 收合的 <dialog> 不在畫面上，量它沒有意義；攤平那一輪才要納入。 */
        const isInsideClosedDialog = (element) =>
          !dialogsForcedOpen && element.closest("dialog:not([open])") !== null;

        const measurable = [...document.body.querySelectorAll("*")].filter(
          (element) => {
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return false;
            if (isInsideClosedDialog(element)) return false;
            return true;
          },
        );

        const overflowing = new Set(
          measurable.filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.right > contentWidth + 0.5 || rect.left < -0.5;
          }),
        );

        const offenders = [];
        for (const element of overflowing) {
          if (isInsideScrollContainer(element)) continue;
          // 只回報最外層的溢出來源，子層都是它的後果。
          if (element.parentElement && overflowing.has(element.parentElement)) {
            continue;
          }
          const rect = element.getBoundingClientRect();
          offenders.push({
            tag: element.tagName.toLowerCase(),
            className:
              typeof element.className === "string" ? element.className : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            text: (element.textContent ?? "").trim().slice(0, 60),
          });
        }

        const tooSmallTargets = [];
        for (const element of document.body.querySelectorAll(
          "a[href], button, summary, input, select, textarea",
        )) {
          if (isInsideClosedDialog(element)) continue;
          // 隱藏欄位與 sr-only 檔案選擇器由可見 label/button 觸發，
          // 1px 是無障礙隱藏契約，不是使用者要直接點擊的目標。
          if (
            element instanceof HTMLInputElement &&
            (element.type === "hidden" || element.classList.contains("sr-only"))
          ) {
            continue;
          }
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.height >= 43.5) continue;
          // 勾選框／單選鈕本身很小，真正的觸控目標是包住它的 label。
          if (
            element instanceof HTMLInputElement &&
            (element.type === "checkbox" || element.type === "radio")
          ) {
            const wrappingLabel = element.closest("label");
            if (
              wrappingLabel &&
              wrappingLabel.getBoundingClientRect().height >= 43.5
            ) {
              continue;
            }
          }
          tooSmallTargets.push({
            tag: element.tagName.toLowerCase(),
            height: Math.round(rect.height),
            text: (element.textContent ?? "").trim().slice(0, 40),
          });
        }

        const floorPlanIssues = [];
        for (const container of document.querySelectorAll(
          "[data-floor-plan-scroll]",
        )) {
          const styles = getComputedStyle(container);
          const board = container.querySelector("[data-board-min-width]");
          const boardMinWidth = Number(
            board?.getAttribute("data-board-min-width") ?? 0,
          );
          const locallyScrollable =
            container.scrollWidth > container.clientWidth + 1;
          const needsLocalScroll =
            boardMinWidth > 0 && container.clientWidth + 1 < boardMinWidth;
          if (needsLocalScroll) {
            if (
              !locallyScrollable ||
              (styles.overflowX !== "auto" && styles.overflowX !== "scroll")
            ) {
              floorPlanIssues.push(
                "窄螢幕場地面板未保留專屬水平捲動。",
              );
            }
          } else if (locallyScrollable) {
            floorPlanIssues.push(
              "寬螢幕場地面板不應仍需要水平捲動。",
            );
          }
        }

        return { documentOverflow, offenders, tooSmallTargets, floorPlanIssues };
      }, mode.key === "dialog-open");

      const label =
        mode.key === "closed" ? surface.name : `${surface.name}（對話框展開）`;
      if (
        report.documentOverflow > 0 ||
        report.offenders.length > 0 ||
        report.floorPlanIssues.length > 0
      ) {
        failures.push({ surface: label, width, ...report });
      } else if (width <= 414 && report.tooSmallTargets.length > 0) {
        failures.push({
          surface: label,
          width,
          documentOverflow: 0,
          offenders: [],
          tooSmallTargets: report.tooSmallTargets,
        });
      }

      await page.close();
     }
    }
  }

  await browser.close();

  if (failures.length === 0) {
    console.log(
      `RWD 稽核通過：${surfaces.length} 個畫面 × ${widths.length} 種寬度 × 對話框收合／展開，無水平溢出、無過小觸控目標。`,
    );
    return;
  }

  for (const failure of failures) {
    console.log(
      `\n✗ ${failure.surface} @ ${failure.width}px（文件溢出 ${failure.documentOverflow}px）`,
    );
    for (const offender of failure.offenders.slice(0, 8)) {
      console.log(
        `   <${offender.tag}> ${offender.left}→${offender.right} ｜ ${offender.className.slice(0, 130)}`,
      );
      if (offender.text) console.log(`      「${offender.text}」`);
    }
    for (const target of (failure.tooSmallTargets ?? []).slice(0, 6)) {
      console.log(
        `   觸控目標過小 <${target.tag}> ${target.height}px ｜ ${target.text}`,
      );
    }
    for (const issue of failure.floorPlanIssues ?? []) {
      console.log(`   場地面板：${issue}`);
    }
  }
  process.exitCode = 1;
}

await main();
