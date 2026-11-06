import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
for (const vp of [{ width: 1280, height: 720 }, { width: 1600, height: 900 }]) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => { const b = document.querySelector('[data-testid="btn-mode-campaign"]'); const r = document.querySelector('[data-testid="race-card-race_keransari"]'); const br = b?.getBoundingClientRect(); const rr = r?.getBoundingClientRect(); return { card: !!r, btn: br ? { x: br.x, y: br.y, w: br.width, h: br.height, visible: br.bottom <= innerHeight && br.top >= 0 } : null, cardBottom: rr?.bottom ?? null, innerHeight }; });
  console.log(vp.width + "x" + vp.height, JSON.stringify(info));
  if (info.card) { await page.locator('[data-testid="race-card-race_keransari"]').click(); await page.waitForTimeout(400); const after = await page.evaluate(() => { const b = document.querySelector('[data-testid="btn-mode-campaign"]')?.getBoundingClientRect(); return b ? { bottom: b.bottom, visible: b.bottom <= innerHeight && b.top >= 0, innerHeight } : null; }); console.log("after race:", JSON.stringify(after)); }
  await page.screenshot({ path: "docs/shots/menu-race-" + vp.width + ".png" });
  await page.close();
}
await browser.close();
