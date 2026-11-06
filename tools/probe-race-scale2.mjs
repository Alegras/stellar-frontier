import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
for (const scale of [1.25, 1.5]) {
  const page = await browser.newPage({ viewport: { width: 1453, height: 850 } });
  await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.evaluate((s) => { const g = window.__SF_GAME__; g.setSettings({ uiScale: s }); }, scale);
  await page.waitForTimeout(700);
  const d = await page.evaluate(() => {
    const g = document.querySelector('.sf-race-grid'); const gr = g?.getBoundingClientRect();
    const ui = document.querySelector('.sf-ui');
    const cards = [...document.querySelectorAll('[data-testid^="race-card-"]')].map(c => { const r=c.getBoundingClientRect(); const body=c.querySelector('.sf-race-card__body'); const br=body?.getBoundingClientRect(); return { id:c.getAttribute('data-testid'), h:Math.round(r.height), top:Math.round(r.top), w:Math.round(r.width), bodyH: br?Math.round(br.height):0, scroll:c.scrollHeight, overflow:getComputedStyle(c).overflow, font:getComputedStyle(c).fontSize}; });
    return { scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'), uiFont: ui?getComputedStyle(ui).fontSize:null, grid: gr?{top:Math.round(gr.top),h:Math.round(gr.height),scroll:g.scrollHeight,rows:getComputedStyle(g).gridTemplateRows,cols:getComputedStyle(g).gridTemplateColumns}:null, cards };
  });
  console.log("SCALE", scale, JSON.stringify(d));
  await page.screenshot({ path: "docs/shots/menu-race-settings-" + scale + ".png" });
  await page.close();
}
await browser.close();
