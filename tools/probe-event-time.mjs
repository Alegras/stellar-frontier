import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on("pageerror", e => errs.push(e.message));
await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
await page.locator('[data-testid="btn-mode-campaign"]').first().click();
await page.waitForTimeout(1800);
await page.evaluate(() => window.__SF_GAME__.setSpeed(5));
await page.waitForTimeout(2000);
// инъекция события в очередь
await page.evaluate(() => {
  const g = window.__SF_GAME__;
  const fg = g.world.fg;
  fg.narrative.pending.push({ id: "probe_evt", chainId: "probe", step: 1, titleRu: "Тест", textRu: "Тестовое событие", choices: [{ id: "a", labelRu: "Принять", effects: [] }, { id: "b", labelRu: "Отказаться", effects: [] }], tick: g.world.tick, expiresTick: g.world.tick + 200 });
  g.toast("inject");
});
await page.waitForTimeout(800);
const before = await page.evaluate(() => { const g = window.__SF_GAME__; const s = g.getState(); return { tick: s.tick, paused: s.paused, speed: s.speed, overlay: s.overlay, pending: g.world.fg.narrative.pending.length }; });
const modal = await page.locator('[data-testid="narrative-event"]').count();
await page.waitForTimeout(3000);
const after = await page.evaluate(() => { const g = window.__SF_GAME__; const s = g.getState(); return { tick: s.tick, paused: s.paused, speed: s.speed, overlay: s.overlay, pending: g.world.fg.narrative.pending.length }; });
// «Отложить»
await page.locator('[data-testid="btn-later-event"]').click();
await page.waitForTimeout(3000);
const later = await page.evaluate(() => { const g = window.__SF_GAME__; const s = g.getState(); return { tick: s.tick, paused: s.paused, speed: s.speed, pending: g.world.fg.narrative.pending.length, dismissedVisible: !!document.querySelector('[data-testid="narrative-event"]') }; });
console.log(JSON.stringify({ modal, before, after, later, errors: errs }, null, 1));
await browser.close();
