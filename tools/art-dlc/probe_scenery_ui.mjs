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
// продвигаем диалог до узла с комиксом
let comicInfo = null;
for (let i = 0; i < 24; i++) {
  comicInfo = await page.evaluate(() => {
    const img = document.querySelector("img.sf-dlg__comic");
    return img ? { src: img.getAttribute("src"), w: img.naturalWidth, h: img.naturalHeight, shown: getComputedStyle(img).display } : null;
  });
  if (comicInfo && comicInfo.w > 0) break;
  await page.evaluate(() => { window.__SF_GAME__.sendCommand({ type: "dlc_dialogue_advance" }); });
  await page.waitForTimeout(350);
}
console.log("COMIC:", JSON.stringify(comicInfo));
if (comicInfo) await page.screenshot({ path: "docs/shots/dlc-ui-comic.png" });
// журнал с карточками (dispatch click, обход флейка overlay)
await page.evaluate(() => { document.querySelector('[data-testid="dialogue-close"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await page.waitForTimeout(400);
await page.evaluate(() => { document.querySelector('[data-testid="btn-open-more"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await page.waitForTimeout(400);
await page.evaluate(() => { document.querySelector('[data-testid="panel-open-journal"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await page.waitForTimeout(1200);
const journal = await page.evaluate(() => {
  const panel = document.querySelector('[data-testid="journal-panel"]');
  const art = document.querySelector('.sf-journal__art');
  return { visible: !!panel, bg: art ? getComputedStyle(art).backgroundImage.slice(0, 120) : null };
});
console.log("JOURNAL:", JSON.stringify(journal));
if (journal.visible) await page.screenshot({ path: "docs/shots/dlc-ui-cards.png" });
console.log("FAILED:", JSON.stringify(failed.filter((u) => u.includes("/dlc/"))));
await browser.close();
console.log("SCENERY-UI-PROBE-DONE");
