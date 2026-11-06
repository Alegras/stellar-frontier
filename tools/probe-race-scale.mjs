import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
for (const scale of [1.25, 1.5, 2]) {
  const page = await browser.newPage({ viewport: { width: 1453, height: 850 } });
  await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.evaluate((s) => document.documentElement.style.setProperty('--ui-scale', String(s)), scale);
  await page.waitForTimeout(600);
  const d = await page.evaluate(() => {
    const g = document.querySelector('.sf-race-grid'); const gr = g?.getBoundingClientRect();
    const cards = [...document.querySelectorAll('[data-testid^="race-card-"]')].map(c => { const r=c.getBoundingClientRect(); const body=c.querySelector('.sf-race-card__body'); const br=body?.getBoundingClientRect(); return { id:c.getAttribute('data-testid'), h:Math.round(r.height), top:Math.round(r.top), w:Math.round(r.width), bodyH: br?Math.round(br.height):0, scroll:c.scrollHeight, overflow:getComputedStyle(c).overflow, font:getComputedStyle(c).fontSize}; });
    return { grid: gr?{top:Math.round(gr.top),h:Math.round(gr.height),scroll:g.scrollHeight,rows:getComputedStyle(g).gridTemplateRows,cols:getComputedStyle(g).gridTemplateColumns}:null, cards };
  });
  console.log("SCALE", scale, JSON.stringify(d));
  await page.screenshot({ path: "docs/shots/menu-race-scale-" + scale + ".png" });
  await page.close();
}
await browser.close();
