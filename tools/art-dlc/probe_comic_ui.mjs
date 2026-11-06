import { chromium } from "@playwright/test";
const BASE = process.env.SF_BASE_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const failed = [];
page.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.trim().length > 20, undefined, { timeout: 30000 });
await page.evaluate(() => { window.__SF_GAME__.newGame(42, "campaign"); });
await page.locator('[data-testid="dialogue-overlay"]').waitFor({ state: "visible", timeout: 15000 });
let comicInfo = null;
for (let i = 0; i < 40; i++) {
  comicInfo = await page.evaluate(() => {
    const img = document.querySelector("img.sf-dlg__comic");
    return img ? { src: img.getAttribute("src"), w: img.naturalWidth, h: img.naturalHeight } : null;
  });
  if (comicInfo && comicInfo.w > 0) break;
  const hasChoices = await page.evaluate(() => document.querySelectorAll('[data-testid^="dialogue-choice-"]').length > 0);
  if (hasChoices) {
    await page.evaluate(() => { const b = document.querySelector('[data-testid^="dialogue-choice-"]'); b && b.click(); });
  } else {
    await page.evaluate(() => { window.__SF_GAME__.sendCommand({ type: "dlc_dialogue_advance" }); });
  }
  await page.waitForTimeout(320);
}
console.log("COMIC:", JSON.stringify(comicInfo));
if (comicInfo) await page.screenshot({ path: "docs/shots/dlc-ui-comic.png" });
console.log("FAILED:", JSON.stringify(failed.filter((u) => u.includes("/dlc/"))));
await browser.close();
console.log("COMIC-PROBE-DONE");
