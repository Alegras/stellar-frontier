import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
await page.locator('[data-testid="btn-mode-campaign"]').first().click();
await page.waitForTimeout(1800);
await page.evaluate(() => { const g = window.__SF_GAME__; g.setSpeed(0); const a = g.world.fg.ancients; a.warp.unlocked = true; a.warp.charges = 10; a.warp.cooldownUntil = 0; a.quest.stage = 12; });
await page.locator('[data-testid="btn-open-more"]').first().click(); await page.waitForTimeout(250);
await page.locator('[data-testid="panel-open-ancients"]').first().click(); await page.waitForTimeout(800);
// вкладка сектора
for (const t of ["sector", "line", "legacy"]) { const b = page.locator('[data-testid="btn-ancients-tab-' + t + '"]'); if (await b.count()) { await b.click(); await page.waitForTimeout(300); if (t === "sector") break; } }
const sel = page.locator('[data-testid="select-warp-target"]');
console.log("select", await sel.count());
const options = await sel.locator("option").all();
console.log("options", options.length);
let chosen = null;
for (const o of options) { const v = await o.getAttribute("value"); if (v) { chosen = v; break; } }
if (chosen) await sel.selectOption(chosen);
const btn = page.locator('[data-testid="btn-warp"]');
console.log("warp btn", await btn.count(), "enabled", await btn.isEnabled().catch(()=>false));
const before = await page.evaluate(() => { const g = window.__SF_GAME__; const p = g.getPlayerEmpire(); const f = g.world.fleets.find(x => x.empireId === p.id && x.ships.length); return { sys: f?.systemId, charges: g.world.fg.ancients.warp.charges, cooldown: g.world.fg.ancients.warp.cooldownUntil }; });
if (await btn.count() && await btn.isEnabled()) await btn.click();
await page.waitForTimeout(1200);
const after = await page.evaluate(() => { const g = window.__SF_GAME__; const p = g.getPlayerEmpire(); const f = g.world.fleets.find(x => x.empireId === p.id && x.ships.length); return { sys: f?.systemId, charges: g.world.fg.ancients.warp.charges, cooldown: g.world.fg.ancients.warp.cooldownUntil, result: document.querySelector('[data-testid="warp-result"]')?.textContent ?? null, status: document.querySelector('[data-testid="warp-status"]')?.textContent ?? null, phase: g.warpStatus?.().phase ?? null }; });
console.log(JSON.stringify({ before, after, chosen, errs }, null, 1));
await page.screenshot({ path: "docs/shots/ancients-warp-ui.png" });
await browser.close();
