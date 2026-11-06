import { chromium } from "@playwright/test";
const BASE = process.env.SF_BASE_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const failed = [];
page.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.trim().length > 20, undefined, { timeout: 30000 });
await page.evaluate(() => { window.__SF_GAME__.newGame(7, "campaign"); });
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('[data-testid="btn-open-more"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-testid="panel-open-journal"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await page.locator('[data-testid="journal-panel"]').waitFor({ state: "visible", timeout: 15000 });
const cards = await page.evaluate(async () => {
  const nodes = Array.from(document.querySelectorAll('.sf-journal__art'));
  const out = [];
  for (const n of nodes.slice(0, 4)) {
    const bg = getComputedStyle(n).backgroundImage;
    const m = bg.match(/url\("?([^")]+)"?\)/);
    const url = m ? m[1] : null;
    let status = null;
    if (url) status = (await fetch(url)).status;
    out.push({ bg, url, status });
  }
  return out;
});
console.log("JOURNAL CARDS:", JSON.stringify(cards));
await page.screenshot({ path: "docs/shots/dlc-ui-journal.png" });
console.log("FAILED:", JSON.stringify(failed.filter((u) => u.includes("/dlc/"))));
await browser.close();
console.log("JOURNAL-PROBE-DONE");
