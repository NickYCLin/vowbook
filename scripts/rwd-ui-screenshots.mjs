import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const browserRoot = path.join(process.cwd(), ".playwright-browsers");
const directories = await readdir(browserRoot).catch(() => []);
const installed = directories.filter((name) => name.startsWith("chromium_headless_shell-")).sort().at(-1);
const browser = await chromium.launch(installed ? {
  executablePath: path.join(browserRoot, installed, "chrome-headless-shell-linux64", "chrome-headless-shell"),
} : {});
const output = path.join(process.cwd(), ".rwd-audit", "ui-evidence");
await mkdir(output, { recursive: true });
const comparisons = [];
try {
  for (const width of [390, 520]) {
    for (const surface of ["home", "dashboard", "guests", "guests-viewer", "tables", "tables-guest-actions", "tables-viewer", "cakes", "cakes-editor", "budget", "budget-viewer", "guest-form-ui-reference", "receipts-ui-reference"]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
      await page.route("**/*", (route) => route.abort());
      await page.setContent(await readFile(path.join(".rwd-audit", `${surface}.html`), "utf8"));
      if (surface === "guest-form-ui-reference") {
        await page.locator("dialog").evaluate((dialog) => dialog.showModal());
      }
      if (surface === "cakes-editor") {
        const dialog = page.locator("dialog");
        if (await dialog.count()) await dialog.evaluate((element) => element.showModal());
      }
      await page.screenshot({ path: path.join(output, `${surface}-${width}.png`), animations: "disabled" });
      if (surface === "home") await page.locator('nav[aria-label="資料與支援"]').screenshot({ path: path.join(output, `home-links-${width}.png`) });
      if (surface === "cakes") await page.locator('label').filter({ has: page.locator('input[type="checkbox"]') }).first().screenshot({ path: path.join(output, `cake-hit-area-${width}.png`) });
      if (surface === "budget" || surface === "budget-viewer") await page.locator('[data-budget-status-filter="pills"]').screenshot({ path: path.join(output, `${surface}-filters-${width}.png`) });
      const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
      const amounts = await page.locator('[data-budget-summary-digits]').evaluateAll((elements) => elements.map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return { text: element.textContent, lines: range.getClientRects().length };
      }));
      if (amounts.some((amount) => amount.lines !== 1)) throw new Error(`Wrapped summary amount: ${surface} @ ${width}`);
      const targets = await page.locator('nav[aria-label="資料與支援"] a, [data-budget-status-filter="pills"] button, label:has(input[type="checkbox"])').evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: element.textContent.trim().slice(0, 40), width: rect.width, height: rect.height };
      }));
      comparisons.push({ surface, viewport: { width, height: 844 }, overflow, targets, amounts });
      console.log(`${surface} @ ${width}x844: horizontal overflow ${overflow}px`);
      await page.close();
    }
  }
  await writeFile(path.join(output, "comparison.json"), JSON.stringify({ synthetic: true, networkBlocked: true, hydrated: false, comparisons }, null, 2));
} finally {
  await browser.close();
}
