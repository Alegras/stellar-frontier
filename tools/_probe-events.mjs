import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://127.0.0.1:5175/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
if (await page.locator('[data-testid="menu-screen"]').isVisible().catch(() => false)) {
  const input = page.locator('[data-testid="input-seed"]');
  if (await input.isVisible().catch(() => false)) await input.fill("44");
  await page.locator('[data-testid="btn-new-game"]').evaluate((el) => el.click());
}
await page.waitForSelector('[data-testid="top-bar"]', { timeout: 30000 });
await page.waitForSelector('[data-testid="dialogue-overlay"]', { timeout: 15000 });
console.log("dialogue visible");
const evId = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  const fg = g.world.fg;
  const aw = fg.aiWorld;
  const id = 777001;
  if (fg.narrative) fg.narrative.pending = [];
  aw.events.push({ id, tick: g.world.tick, kind: "call_to_arms", fromEmpireId: 2, targetEmpireId: g.world.playerEmpireId, titleRu: "QA призыв", textRu: "QA", expiresTick: g.world.tick + 240, resolved: false, choices: [{ id: "join", labelRu: "Вступить", effects: [{ target: "flag:ai_call_to_arms", value: 1 }] }] });
  aw.nextEventId = 777002;
  g.refresh?.({});
  return id;
});
console.log("injected", evId);
await page.waitForTimeout(500);
await page.locator('[data-testid="dialogue-close"]').evaluate((el) => el.click());
await page.waitForTimeout(800);
const state = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  const fg = g.world.fg;
  const aw = fg.aiWorld;
  return {
    dialogueActive: !!fg.dlc?.dialogue?.active,
    pending: (fg.narrative?.pending ?? []).map((e) => e.id),
    eventsLen: aw.events.length,
    event: aw.events.find((e) => e.id === 777001),
    nowTick: g.world.tick,
    modalOpen: !!window.__SF_GAME__.__modal,
  };
});
console.log("state", JSON.stringify(state));
console.log("ai-world-event count", await page.locator('[data-testid="ai-world-event"]').count());
console.log("narrative-event visible", await page.locator('[data-testid="narrative-event"]').isVisible().catch(() => false));
// open panel events tab via DOM
await page.locator('[data-testid="btn-open-more"]').first().evaluate((el) => el.click());
await page.waitForTimeout(300);
await page.locator('[data-testid="panel-open-politics"]').evaluate((el) => el.click());
await page.waitForSelector('[data-testid="politics-panel"]', { timeout: 8000 });
await page.locator('[data-testid="btn-politics-tab-events"]').evaluate((el) => el.click());
await page.waitForTimeout(400);
console.log("panel event cards", await page.locator('[data-testid^="event-"]').count());
console.log("panel html has QA призыв", (await page.locator('[data-testid="politics-panel"]').innerText()).includes("QA призыв"));
console.log("ai-world-event count after panel", await page.locator('[data-testid="ai-world-event"]').count());
await page.screenshot({ path: "docs/shots/_debug-politics-event.png" });
await browser.close();
