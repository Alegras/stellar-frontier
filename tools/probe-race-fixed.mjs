import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
for (const vp of [{width:1453,height:850},{width:1280,height:720},{width:1920,height:1080}]) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const data = await page.evaluate(() => {
    const grid=document.querySelector('.sf-race-grid'); const cards=[...document.querySelectorAll('[data-testid^="race-card-"]')];
    const btn=document.querySelector('[data-testid="btn-mode-campaign"]')?.getBoundingClientRect();
    return { grid: grid?{h:grid.scrollHeight,client:grid.clientHeight,cols:getComputedStyle(grid).gridTemplateColumns,rows:getComputedStyle(grid).gridTemplateRows}:null, cards: cards.map(c=>{const r=c.getBoundingClientRect();return {id:c.getAttribute('data-testid'),h:Math.round(r.height),top:Math.round(r.top),scroll:c.scrollHeight,font:getComputedStyle(c).fontSize};}), btn: btn?{top:Math.round(btn.top),bottom:Math.round(btn.bottom),visible:btn.top>=0&&btn.bottom<=innerHeight}:null, innerHeight };
  });
  console.log(vp.width+'x'+vp.height, JSON.stringify(data));
  await page.screenshot({ path: "docs/shots/menu-race-fixed-"+vp.width+".png" });
  await page.close();
}
await browser.close();
