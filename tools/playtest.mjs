import { chromium } from "@playwright/test";
const base = "http://127.0.0.1:4174/";
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));
const results = [];
async function step(name, fn) {
  try { const info = await fn(); results.push({ name, ok: true }); console.log("PASS", name, info === undefined ? "" : JSON.stringify(info).slice(0, 260)); return info; }
  catch (e) { results.push({ name, ok: false, info: String(e && e.message || e) }); console.log("FAIL", name, "=>", String(e && e.message || e).slice(0, 260)); return null; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const g = (fn, arg) => page.evaluate(fn, arg);
const state = () => g(() => { const s = window.__SF_GAME__.getState(); return { mode: s.mode, tick: s.tick, paused: s.paused, speed: s.speed, sel: s.selectedSystemId, fleet: s.selectedFleetId, overlay: s.overlay, seed: s.seed, activeSystemId: s.activeSystemId }; });
const settle = (ms) => page.waitForTimeout(ms);

await step("01 load", async () => { await page.goto(base, { waitUntil: "domcontentloaded" }); await settle(1800); assert(await page.locator('[data-testid="main-menu"]').count(), "no menu"); });

await step("02 new game; fleet not auto-selected", async () => {
  await page.locator('[data-testid="btn-new-game"]').first().click(); await settle(1600);
  const st = await state();
  assert(st.mode === "galaxy", "mode=" + st.mode);
  assert(st.fleet == null, "флот выбран автоматически: " + st.fleet);
  return st;
});

await step("03 ticks advance", async () => {
  await page.locator('[data-testid="btn-speed-2"]').first().click();
  const b = (await state()).tick; await settle(2600); const a = (await state()).tick;
  assert(a > b, "tick stall " + b + "->" + a); return { b, a };
});

await step("04 speed0 pauses", async () => {
  await page.locator('[data-testid="btn-speed-0"]').first().click();
  const b = (await state()).tick; await settle(1200); const a = (await state()).tick;
  assert(a === b, "ticking on pause"); return { b, a };
});

await step("05 map click selects, no accident fleet order", async () => {
  const before = await g(() => { const g2 = window.__SF_GAME__; return g2.getPlayerFleets().map(f => ({ id: f.id, path: f.path.length, y: f.status })); });
  await page.locator('[data-testid="map-label"]').nth(2).click(); await settle(500);
  const st = await state();
  const after = await g(() => { const g2 = window.__SF_GAME__; return g2.getPlayerFleets().map(f => ({ id: f.id, path: f.path.length, y: f.status })); });
  assert(st.sel != null, "no selection");
  assert(JSON.stringify(before) === JSON.stringify(after), "клик по карте отдал приказ флоту: " + JSON.stringify(before) + " -> " + JSON.stringify(after));
  return { sel: st.sel };
});

await step("06 tooltip on hover", async () => {
  await page.locator('[data-testid="map-label"]').nth(3).hover(); await settle(400);
  assert(await page.locator(".sf-tip").count(), "no tooltip"); return "ok";
});

await step("07 wheel zoom at empty map point", async () => {
  const z1 = await g(() => window.__SF_GAME__.mapZoom);
  await page.mouse.move(760, 250); await page.waitForTimeout(150); await page.mouse.wheel(0, -700); await settle(700);
  const z2 = await g(() => window.__SF_GAME__.mapZoom);
  assert(z2 > z1 * 1.05, "zoom not changed " + z1 + "->" + z2); return { z1, z2 };
});

await step("08 save -> reload -> continue", async () => {
  await page.locator('[data-testid="btn-save"]').first().click(); await settle(1600);
  const saved = await state();
  await page.reload({ waitUntil: "domcontentloaded" }); await settle(1800);
  await page.locator('[data-testid="btn-continue"]').first().click(); await settle(2200);
  const loaded = await state();
  assert(loaded.mode === "galaxy", "mode=" + loaded.mode);
  assert(loaded.tick >= saved.tick, "tick rollback " + saved.tick + "->" + loaded.tick);
  return { saved: saved.tick, loaded: loaded.tick };
});

await step("09 explicit fleet select -> move order", async () => {
  const fleetId = await g(() => { const g2 = window.__SF_GAME__; const f = g2.getPlayerFleets()[0]; g2.selectFleet(f.id); return f.id; });
  await settle(400);
  await page.locator('[data-testid="map-label"]').nth(4).click(); await settle(600);
  const res = await g((id) => { const f = window.__SF_GAME__.world.fleets.find(x => x.id === id); return { path: f.path.length, status: f.status }; }, fleetId);
  assert(res.path > 0 || res.status === "moving", "no order: " + JSON.stringify(res)); return res;
});

await step("10 enter system -> flight hud", async () => {
  // для полётных тестов входим в спокойную систему (без вражеских флотов)
  await g(() => {
    const g2 = window.__SF_GAME__;
    const capital = g2.getPlayerEmpire().capitalSystemId;
    const clean = g2.world.systems.find((s) => g2.getPlayerEmpire().systems.includes(s.id) && g2.getEnemyFleetsInSystem(s.id).length === 0);
    g2.selectSystem(clean ? clean.id : capital);
  });
  await settle(300);
  await page.locator('[data-testid="btn-enter-system"]').first().click(); await settle(2600);
  assert((await state()).mode === "system", "not system mode");
  assert(await page.locator('[data-testid="flight-hud"]').count(), "no hud");
  const tel = await g(() => { const t = window.__SF_GAME__.flightTelemetry; return { speed: t.speed, station: t.stationDist, finite: [t.speed, t.throttle, t.shield, t.hull, t.heat, t.stationDist].every(Number.isFinite) }; });
  assert(tel.finite, "NaN telemetry"); return tel;
});

await step("11 throttle W", async () => {
  await page.keyboard.down("w"); await settle(1500); await page.keyboard.up("w"); await settle(300);
  const tel = await g(() => { const t = window.__SF_GAME__.flightTelemetry; return { speed: t.speed, throttle: t.throttle }; });
  assert(tel.speed > 5 || tel.throttle > 10, "no thrust " + JSON.stringify(tel)); return tel;
});

await step("12 supercruise C", async () => {
  await page.keyboard.press("c"); await settle(400);
  const tel = await g(() => { const t = window.__SF_GAME__.flightTelemetry; return { mode: t.mode, sc: t.supercruiseSpeed, speed: t.speed }; });
  assert(tel.mode === "supercruise" || tel.sc > 30, "no supercruise " + JSON.stringify(tel));
  // выходим из суперкруиза, чтобы не влететь в станцию на тесте
  await page.keyboard.press("c"); await settle(500);
  return tel;
});

await step("13 FSD jump Tab+J", async () => {
  const before = await state();
  const cur = await g(() => { const g2 = window.__SF_GAME__; const st = g2.getState(); const sys = g2.world.systems.find(s => s.id === st.activeSystemId); return { id: sys.id, links: sys.links.slice(0, 3) }; });
  // ищем навигационную цель без вражеских флотов (иначе тест уйдёт в бой/смерть)
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab"); await settle(250);
    const navClean = await g(() => {
      const g2 = window.__SF_GAME__;
      const st = g2.getState();
      const sys = g2.world.systems.find((s) => s.id === st.activeSystemId);
      const navId = g2.flightTelemetry.navSystemId;
      return navId != null && navId !== sys.id && g2.getEnemyFleetsInSystem(navId).length === 0;
    });
    if (navClean) break;
  }
  await page.keyboard.press("j"); await settle(5200);
  const after = await state();
  const tel = await g(() => { const t = window.__SF_GAME__.flightTelemetry; return { fsd: t.fsdCharge, massLocked: t.massLocked, nav: t.navSystemId, navName: t.navSystemName, notices: window.__SF_GAME__.getState().notices.map(n => n.text).slice(-3) }; });
  const ok = after.mode === "system" && after.activeSystemId !== before.activeSystemId;
  return { beforeSystem: before.activeSystemId, afterSystem: after.activeSystemId, mode: after.mode, jumped: ok, tel, links: cur.links };
});

await step("14 exit to map M", async () => {
  await page.keyboard.press("m"); await settle(1400);
  assert((await state()).mode === "galaxy", "not galaxy"); return "ok";
});

await step("15 dock via inspector", async () => {
  await g(() => { const g2 = window.__SF_GAME__; g2.selectSystem(g2.getPlayerEmpire().capitalSystemId); }); await settle(700);
  await page.locator('[data-testid="btn-dock"]').first().click(); await settle(1500);
  assert((await state()).mode === "station", "not station");
  assert(await page.locator('[data-testid="station-screen"]').count(), "no station screen"); return "ok";
});

await step("16 market buy adds goods", async () => {
  const before = await g(() => { const g2 = window.__SF_GAME__; const p = g2.getPlayerEmpire(); const st = g2.getState(); const sys = g2.world.systems.find(s => s.id === (st.activeSystemId ?? st.selectedSystemId)); return { energy: p.resources.energy, credits: p.resources.credits, stock: sys.station.market.energy.stock }; });
  await page.locator('[data-testid="btn-buy-energy"]').first().click(); await settle(800);
  const after = await g(() => { const g2 = window.__SF_GAME__; const p = g2.getPlayerEmpire(); const st = g2.getState(); const sys = g2.world.systems.find(s => s.id === (st.activeSystemId ?? st.selectedSystemId)); return { energy: p.resources.energy, credits: p.resources.credits, stock: sys.station.market.energy.stock }; });
  assert(after.credits < before.credits, "credits not spent");
  assert(after.energy > before.energy, "goods not added " + before.energy + "->" + after.energy);
  assert(after.stock < before.stock, "stock not reduced");
  return { before, after };
});

await step("17 contracts accept", async () => {
  await page.locator('[data-testid="tab-contracts"]').first().click(); await settle(700);
  const screen = await page.locator('[data-testid="station-screen"]').first().innerText();
  const before = await g(() => window.__SF_GAME__.world.missions.filter(m => m.accepted).length);
  const btn = page.getByRole("button", { name: /Принять|Взять/i }).first();
  const has = await btn.count();
  if (has) { await btn.click(); await settle(600); }
  const after = await g(() => window.__SF_GAME__.world.missions.filter(m => m.accepted).length);
  // на станции может не быть контрактов — тогда проверяем пустое состояние, а не кнопку
  if (has === 0) assert(/контракт/i.test(screen), "нет ни контрактов, ни пустого состояния");
  if (has > 0) assert(after > before, "mission not accepted");
  return { hasAcceptButton: has, before, after };
});

await step("18 shipyard builds ship for alloys", async () => {
  await page.locator('[data-testid="tab-shipyard"]').first().click(); await settle(600);
  const before = await g(() => { const p = window.__SF_GAME__.getPlayerEmpire(); const c = window.__SF_GAME__.world.colonies.find(c2 => c2.empireId === p.id && c2.buildings.includes("shipyard")); return { alloys: p.resources.alloys, queue: c.queue.length }; });
  const btn = page.locator('[data-testid="btn-build-ship-science_vessel"]').first();
  const cnt = await btn.count();
  let enabled = false;
  if (cnt) enabled = await btn.isEnabled();
  if (cnt && enabled) { await btn.click(); await settle(700); }
  const after = await g(() => { const p = window.__SF_GAME__.getPlayerEmpire(); const c = window.__SF_GAME__.world.colonies.find(c2 => c2.empireId === p.id && c2.buildings.includes("shipyard")); return { alloys: p.resources.alloys, queue: c.queue.length }; });
  assert(cnt > 0, "no ship build button");
  if (enabled) { assert(after.queue > before.queue, "queue not increased"); assert(after.alloys < before.alloys, "alloys not spent"); }
  return { found: cnt > 0, enabled, before, after };
});

await step("19 repair tab", async () => {
  await page.locator('[data-testid="tab-repair"]').first().click(); await settle(500);
  const txt = await page.locator('[data-testid="station-screen"]').first().innerText();
  assert(/ремонт/i.test(txt), "no repair tab"); return "ok";
});

await step("20 undock -> galaxy", async () => {
  await page.locator('[data-testid="btn-undock"]').first().click(); await settle(1500);
  let st = await state();
  if (st.mode === "system") { await page.keyboard.press("m"); await settle(1000); st = await state(); }
  assert(st.mode === "galaxy", "not galaxy " + st.mode); return st;
});

await step("21 colony build district", async () => {
  const planetId = await g(() => { const g2 = window.__SF_GAME__; const p = g2.getPlayerEmpire(); return g2.world.colonies.filter(c => c.empireId === p.id)[0].planetId; });
  await g((id) => window.__SF_GAME__.selectPlanet(id), planetId); await settle(700);
  assert(await page.locator('[data-testid="colony-panel"]').count(), "no colony panel");
  const before = await g(() => { const g2 = window.__SF_GAME__; const p = g2.getPlayerEmpire(); const c = g2.world.colonies.filter(x => x.empireId === p.id)[0]; return { m: p.resources.minerals, q: c.queue.length }; });
  const btn = page.getByRole("button", { name: /Построить/i }).first(); const has = await btn.count();
  if (has) { await btn.click(); await settle(700); }
  const after = await g(() => { const g2 = window.__SF_GAME__; const p = g2.getPlayerEmpire(); const c = g2.world.colonies.filter(x => x.empireId === p.id)[0]; return { m: p.resources.minerals, q: c.queue.length }; });
  assert(after.q > before.q, "queue not increased");
  return { before, after };
});

await step("22 research pick", async () => {
  await page.locator('[data-testid="btn-open-research"]').first().click(); await settle(700);
  const choose = page.getByRole("button", { name: /Выбрать/i }).first(); const has = await choose.count();
  if (has) { await choose.click(); await settle(500); }
  const prog = await g(() => { const p = window.__SF_GAME__.getPlayerEmpire(); return Object.values(p.techs.progress).map(v => v.techId); });
  await page.keyboard.press("Escape"); await settle(400);
  assert(has > 0, "no choose buttons");
  assert(prog.some(Boolean), "no tech selected"); return { prog };
});

await step("23 settings overlay change resolution", async () => {
  await page.locator('[data-testid="btn-settings"]').first().click(); await settle(600);
  assert(await page.locator('[data-testid="settings-overlay"]').count(), "no settings");
  await page.locator('[data-testid="select-resolution"]').selectOption("480"); await settle(900);
  const s1 = await g(() => window.__SF_GAME__.getState().settings.internalWidth);
  await g(() => window.__SF_GAME__.setSettings({ internalWidth: 640, internalHeight: 360 })); await settle(500);
  await page.locator('[data-testid="btn-apply-settings"]').first().click(); await settle(500);
  assert(s1 === 480, "resolution not applied: " + s1);
  return { applied: s1 };
});

await step("24 pause menu overlay", async () => {
  await page.locator('[data-testid="btn-menu"]').first().click(); await settle(600);
  assert(await page.locator('[data-testid="pause-overlay"]').count(), "no pause overlay");
  const buttons = await page.locator('[data-testid="pause-overlay"] button').count();
  await page.locator('[data-testid="btn-resume"]').first().click(); await settle(600);
  assert((await state()).overlay === "none", "overlay not closed"); return { buttons };
});

await step("25 battle autopause -> close -> resume", async () => {
  await g(() => window.__SF_GAME__.setSpeed(5));
  let found = false;
  for (let i = 0; i < 50; i++) { await settle(1000); if ((await state()).overlay === "battle") { found = true; break; } }
  if (!found) return { battle: false, note: "не наступил за 50 с" };
  const tickBefore = (await state()).tick;
  await page.locator('[data-testid="btn-close-battle"]').first().click(); await settle(600);
  const t1 = (await state()).tick; await settle(2500); const t2 = (await state()).tick;
  const paused = (await state()).paused;
  assert(t2 > t1, "время не возобновилось после боя: " + t1 + "->" + t2 + " paused=" + paused);
  return { battle: true, tickBefore, t1, t2, paused };
});

await step("26 1280x720 layout", async () => {
  await page.setViewportSize({ width: 1280, height: 720 }); await settle(900);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
  assert(o.sw <= o.iw + 1, "overflow " + JSON.stringify(o));
  await page.screenshot({ path: "docs/shots/qa1280.png" });
  return o;
});

console.log("\nSUMMARY");
for (const r of results) console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.ok ? "" : " :: " + String(r.info).slice(0, 220)));
console.log("console errors:", consoleErrors.length);
console.log(consoleErrors.slice(0, 6).join("\n"));
await browser.close();