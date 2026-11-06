import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
await page.locator('[data-testid="btn-mode-campaign"]').first().click();
await page.waitForTimeout(1800);
await page.evaluate(() => { const g = window.__SF_GAME__; g.setSpeed(1); g.world.fg.narrative.pending = []; });
await page.waitForTimeout(500);
// одно событие
await page.evaluate(() => { const g = window.__SF_GAME__; g.world.fg.narrative.pending.push({ id: "probe_one", chainId: "p", step: 1, titleRu: "Тест", textRu: "Один", choices: [{ id: "a", labelRu: "Принять", effects: [] }], tick: g.world.tick, expiresTick: g.world.tick + 200 }); g.toast("inject"); });
await page.waitForTimeout(700);
const before = await page.evaluate(() => { const g = window.__SF_GAME__; const s = g.getState(); return { tick: s.tick, paused: s.paused, pending: g.world.fg.narrative.pending.length }; });
await page.waitForTimeout(2000);
const frozen = await page.evaluate(() => { const g = window.__SF_GAME__; const s = g.getState(); return { tick: s.tick, paused: s.paused, pending: g.world.fg.narrative.pending.length }; });
await page.locator('[data-testid="btn-choice-a"]').click();
await page.waitForTimeout(1500);
const resumed = await page.evaluate(() => { const g = window.__SF_GAME__; const s = g.getState(); return { tick: s.tick, paused: s.paused, pending: g.world.fg.narrative.pending.length, modal: !!document.querySelector('[data-testid="narrative-event"]') }; });
// второе событие + отложить
await page.evaluate(() => { const g = window.__SF_GAME__; g.world.fg.narrative.pending = []; g.world.fg.narrative.pending.push({ id: "probe_two", chainId: "p2", step: 1, titleRu: "Тест2", textRu: "Два", choices: [{ id: "a", labelRu: "Принять", effects: [] }], tick: g.world.tick, expiresTick: g.world.tick + 200 }); });
await page.waitForTimeout(700);
const beforeLater = await page.evaluate(() => { const g = window.__SF_GAME__; const s = g.getState(); return { tick: s.tick, paused: s.paused, pending: g.world.fg.narrative.pending.length }; });
await page.locator('[data-testid="btn-later-event"]').click();
await page.waitForTimeout(1500);
const afterLater = await page.evaluate(() => { const g = window.__SF_GAME__; const s = g.getState(); return { tick: s.tick, paused: s.paused, pending: g.world.fg.narrative.pending.length, modal: !!document.querySelector('[data-testid="narrative-event"]') }; });
console.log(JSON.stringify({ before, frozen, resumed, beforeLater, afterLater, errors: errs }, null, 1));
await browser.close();
