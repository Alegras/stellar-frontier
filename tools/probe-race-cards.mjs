import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1453, height: 850 } });
await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
const data = await page.evaluate(() => {
  const grid = document.querySelector('.sf-race-grid');
  const cards = [...document.querySelectorAll('[data-testid^="race-card-"]')];
  return {
    scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'),
    sfScale: getComputedStyle(document.documentElement).getPropertyValue('--sf-scale'),
    menu: (() => { const m=document.querySelector('.sf-menu'); const r=m?.getBoundingClientRect(); return r?{w:r.width,h:r.height,scroll:m.scrollHeight}:null; })(),
    grid: (() => { const g=grid; const r=g?.getBoundingClientRect(); return r?{w:r.width,h:r.height,scroll:g.scrollHeight,cols:getComputedStyle(g).gridTemplateColumns,rows:getComputedStyle(g).gridTemplateRows}:null; })(),
    cards: cards.map(c => { const r=c.getBoundingClientRect(); return {id:c.getAttribute('data-testid'), w:r.width,h:r.height,top:r.top,scroll:c.scrollHeight,overflow:getComputedStyle(c).overflow,font:getComputedStyle(c).fontSize,minH:getComputedStyle(c).minHeight}; }),
  };
});
console.log(JSON.stringify(data, null, 1));
await page.screenshot({ path: "docs/shots/menu-race-bug.png" });
await browser.close();
