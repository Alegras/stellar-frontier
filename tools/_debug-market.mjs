import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.locator('[data-testid="input-seed"]').fill("42");
await page.getByRole("button", { name: /Новая кампания/i }).click();
await page.locator('[data-testid="top-bar"]').waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
await page.locator('[data-testid="btn-dock"]').click();
await page.locator('[data-testid="station-screen"]').waitFor({ timeout: 10000 });
const info = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  const st = g.getState();
  for (let i = 0; i < 220; i++) g.advance(1000);
  const fg = g.world.fg;
  const stationId = g.getState().activeStationId;
  return {
    tick: g.getState().tick,
    stationId,
    stationSystem: g.world.systems.find((s) => s.station?.id === stationId)?.id,
    contractsLen: fg?.contracts.length ?? -1,
    contracts: (fg?.contracts ?? []).slice(0, 12).map((c) => ({ id: c.id, stationId: c.stationId, accepted: c.accepted, objectives: c.objectives.map((o) => o.type), target: c.objectives[0]?.targetSystemId, credits: c.rewards.credits })),
    legacyMissions: g.world.missions.length,
    legacyKinds: g.world.missions.slice(0, 8).map((m) => m.kind + ":" + m.stationId + ":" + m.progress + "/" + m.targetAmount),
    knownStations: g.world.systems.filter((s) => s.station && s.knownBy.includes(g.getPlayerEmpire().id)).map((s) => s.id + ":" + s.station.kind),
  };
});
console.log("INFO=" + JSON.stringify(info));
await browser.close();
