import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://127.0.0.1:5173/";
const outDir = process.argv[3] || "docs/shots";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => { errors.push(e.message); console.log("[pageerror]", e.message.slice(0, 500)); });
const shot = async (n) => { await page.screenshot({ path: outDir + "/" + n + ".png" }); console.log("shot", n); };

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
await shot("lead-01-menu");

const ng = page.locator('[data-testid="btn-new-game"]');
if (await ng.count()) await ng.first().click();
await page.waitForTimeout(800);
let hasWorld = await page.evaluate(() => !!window.__SF_GAME__?.hasWorld);
if (!hasWorld) {
  console.log("click did not start world; calling API");
  await page.evaluate(() => window.__SF_GAME__.newGame(4242));
  await page.waitForTimeout(1200);
}
await page.waitForTimeout(2200);
await shot("lead-02-map");
console.log("mode:", await page.evaluate(() => window.__SF_GAME__.getState().mode), "labels:", await page.locator('[data-testid="map-label"]').count());

// Enter system via API (button text differs) for deterministic flow
await page.evaluate(() => {
  const g = window.__SF_GAME__;
  g.enterSystem(g.getState().selectedSystemId);
});
await page.waitForTimeout(3200);
await shot("lead-03-flight");
const hud = await page.locator('[data-testid="flight-hud"]').first().innerText().catch(() => "");
console.log("HUD:", hud.slice(0, 200).replace(/\n/g, " | "));

// Dock at station
const dock = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  const st = g.getState();
  const sys = g.world.systems.find((s) => s.id === st.activeSystemId);
  if (!sys || !sys.station) return null;
  g.dockAtStation(sys.station.id);
  return { name: sys.station.nameRu, id: sys.station.id, market: Object.keys(sys.station.market).length };
});
console.log("dock:", JSON.stringify(dock));
await page.waitForTimeout(1500);
await shot("lead-05-station");
console.log("station-screen:", await page.locator('[data-testid="station-screen"]').count());

// Force a battle report overlay using an existing battle if any
const battle = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  const w = g.world;
  if (w.battles.length === 0) return null;
  g.setBattleReport(w.battles[w.battles.length - 1]);
  return w.battles[w.battles.length - 1];
});
console.log("battle:", battle ? "shown" : "none");
if (battle) { await page.waitForTimeout(900); await shot("lead-06-battle"); await page.evaluate(() => window.__SF_GAME__.setBattleReport(null)); }

// undock, back to map, advance 10 ticks
await page.evaluate(() => window.__SF_GAME__.undock());
await page.waitForTimeout(400);
await page.evaluate(() => { const g = window.__SF_GAME__; g.exitToGalaxy(); g.setSpeed(5); });
await page.waitForTimeout(2500);
await shot("lead-07-ticks");
console.log("tick:", await page.evaluate(() => window.__SF_GAME__.getState().tick));
console.log("errors:", errors.length, errors.slice(0, 4).join(" || "));
await browser.close();
