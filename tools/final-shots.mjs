import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://127.0.0.1:4173/";
const out = process.argv[3] || "docs/shots";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => { errors.push(e.message); console.log("[pageerror]", e.message.slice(0, 400)); });
const shot = async (n, vp) => { await page.screenshot({ path: out + "/" + n + ".png" }); console.log("shot", n); };

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await shot("final-01-menu");
await page.locator('[data-testid="btn-new-game"]').first().click();
await page.waitForTimeout(1500);
if (!(await page.evaluate(() => !!window.__SF_GAME__?.hasWorld))) {
  await page.evaluate(() => window.__SF_GAME__.newGame(777));
  await page.waitForTimeout(1200);
}
await page.waitForTimeout(1500);
await shot("final-02-map");
console.log("labels:", await page.locator('[data-testid="map-label"]').count());

// empire panels
const research = page.locator('[data-testid="btn-open-research"]');
if (await research.count()) { await research.first().click(); await page.waitForTimeout(900); await shot("final-03-research"); await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
const colonies = page.locator('[data-testid="btn-open-colonies"]');
if (await colonies.count()) { await colonies.first().click(); await page.waitForTimeout(900); await shot("final-04-colonies"); await page.keyboard.press("Escape"); await page.waitForTimeout(400); }

// flight
await page.evaluate(() => { const g = window.__SF_GAME__; g.enterSystem(g.getState().selectedSystemId); });
await page.waitForTimeout(3000);
await shot("final-05-flight");
// dock
await page.evaluate(() => { const g = window.__SF_GAME__; const st = g.getState(); const sys = g.world.systems.find(s => s.id === st.activeSystemId); if (sys?.station) g.dockAtStation(sys.station.id); });
await page.waitForTimeout(1200);
await shot("final-06-station");
const tabs = ["Контракты", "Верфь", "Ремонт"];
for (const tab of tabs) {
  const btn = page.getByRole("button", { name: tab }).first();
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(500); await shot("final-07-station-" + tab.toLowerCase()); }
}
// back to map and run ticks until battle
await page.evaluate(() => { const g = window.__SF_GAME__; g.undock(); setTimeout(() => { g.exitToGalaxy(); g.setSpeed(5); }, 100); });
await page.waitForTimeout(1500);
let battle = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  battle = await page.evaluate(() => window.__SF_GAME__.getState().overlay === "battle");
  if (battle) break;
}
const tickNow = await page.evaluate(() => window.__SF_GAME__.getState().tick);
console.log("battle overlay:", battle, "at tick", tickNow);
if (battle) { await shot("final-08-battle"); await page.evaluate(() => window.__SF_GAME__.setBattleReport(null)); await page.waitForTimeout(600); }
// save/load round trip
const saveOk = await page.evaluate(async () => { const g = window.__SF_GAME__; const ok = await g.saveGame(); await new Promise(r => setTimeout(r, 300)); return ok; });
console.log("save ok:", saveOk);
// 1280x720 layout
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(900);
await shot("final-09-1280x720");
console.log("errors:", errors.length, errors.slice(0, 3).join(" || "));
await browser.close();
