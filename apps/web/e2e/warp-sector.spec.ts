/**
 * Часть XIII: полётный варп «Наследие» и Реликтовый Предел (task-29).
 *
 * Проверяем:
 * 1) HUD-индикатор варпа (ядра/заряды/кулдаун/раскрутка) + выбор цели (галактика и сектор)
 *    + подтверждение/отмена + раскрутка (2 с в тесте) + прыжок в секторную систему;
 *    сцена Предела: холодная палитра, аномалии/опасности, сенсорные ограничения.
 * 2) Опасная система (haz_choir_wave): предупреждения «Волна Хора / Опасность N/4 / Сенсоры −70%»,
 *    выход через Врата, смерть в секторе → возврат в столицу, сохранение/загрузка не ломаются.
 *
 * Заряды/кулдаун/риск считает sim (@sf/sim ancients.ts); клиент владеет последовательностью
 * и визуалом (render/system/warp.ts, sector.ts, SystemView.ts). Харнесс открывает сектор
 * (миссия 10 — длинная сюжетная цепочка, отдельно покрыта тестами sim).
 */
import { expect, test } from "@playwright/test";
import { attachDiagnostics, expectNoErrors, gotoGame, SEL } from "./helpers";

const ARTIFACTS = "apps/web/e2e/artifacts";
const SPOOL_SEC = 2;

// Параллельные прогоны агентов делят test-results (PT-013): trace/video конфликтуют.
test.use({ trace: "off", video: "off" });

interface FlightRead {
  mode: string;
  activeSystemId: number | null;
  flag: string | null;
  tick: number;
  warp: {
    phase: string;
    inSector: boolean;
    charges: number;
    cooldownTicks: number;
    spoolProgress: number;
    targetName: string;
    sectorHazard: number;
    blockedReason: string;
  };
  targets: { id: number; name: string; sector: boolean; kind: string }[];
  warnings: string[];
  hints: string[];
  sector: { active: boolean; systems: number } | null;
}

async function readFlight(page: import("@playwright/test").Page): Promise<FlightRead | null> {
  return page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__?: Record<string, any> }).__SF_GAME__;
    if (!g || !g.hasWorld) return null;
    const telemetry = g.flightTelemetry;
    const warp = g.warpTelemetry;
    const state = g.getState();
    const system = state.activeSystemId != null
      ? (g.world.systems as Array<{ id: number; sector?: string }>).find((s) => s.id === state.activeSystemId) ?? null
      : null;
    const sector = g.world.fg?.ancients?.sector ?? null;
    return {
      mode: state.mode,
      activeSystemId: state.activeSystemId,
      flag: system?.sector ?? null,
      tick: g.world.tick,
      warp: {
        phase: warp.phase,
        inSector: warp.inSector,
        charges: warp.charges,
        cooldownTicks: warp.cooldownTicks,
        spoolProgress: warp.spoolProgress,
        targetName: warp.targetName,
        sectorHazard: warp.sectorHazard,
        blockedReason: warp.blockedReason,
      },
      targets: g.warpTargets().map((t: { id: number; name: string; sector: boolean; kind: string }) => ({
        id: t.id, name: t.name, sector: t.sector, kind: t.kind,
      })),
      warnings: [...telemetry.warnings],
      hints: [...telemetry.hints],
      sector: sector ? { active: Boolean(sector.active), systems: sector.systems.length } : null,
    };
  });
}

/** Новая кампания через API + открытие сектора/варпа (миссия 10 вне теста полёта). */
async function startFlightWithWarp(page: import("@playwright/test").Page): Promise<{ gateId: number; hazard: { id: number; name: string; hazard: string } | null }> {
  await page.addInitScript((spool: string) => {
    try { localStorage.setItem("sf.warpSpoolSec", spool); } catch { /* приватный режим */ }
  }, String(SPOOL_SEC));
  await gotoGame(page);
  const started = await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
    g.newGame(42, "campaign");
    const fg = g.world.fg;
    fg.ancients.warp.unlocked = true;
    fg.ancients.warp.charges = 6;
    fg.ancients.cores = 3;
    fg.ancients.warp.cooldownUntil = 0;
    fg.ancients.sector.discovered = true;
    g.ensureSectorVisible();
    const metas = fg.ancients.sector.systems as Array<{ id: number; name: string; hazard?: string | null; region: string }>;
    const hazard = metas.find((m) => (m.hazard ?? "").includes("choir")) ?? metas.find((m) => m.hazard) ?? null;
    const gateId = (fg.ancients.sector.gates as number[])[0] ?? metas[0]!.id;
    g.enterSystem(g.getState().selectedSystemId);
    return {
      gateId,
      hazard: hazard ? { id: hazard.id, name: hazard.name, hazard: hazard.hazard ?? "" } : null,
    };
  });
  await page.locator(SEL.flightHud).waitFor({ state: "visible", timeout: 30_000 });
  await expect.poll(async () => (await readFlight(page))?.warp.charges, { timeout: 15_000 }).toBe(6);
  await expect.poll(async () => (await readFlight(page))?.targets.some((t) => t.sector), { timeout: 15_000 }).toBe(true);
  return started;
}

/** Вход в Предел варпом: выбор цели через API (контракт UI) + подтверждение клавишей Enter. */
async function warpIntoSector(page: import("@playwright/test").Page): Promise<number> {
  const gateId = await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
    const target = g.warpTargets().find((t: { sector: boolean }) => t.sector) as { id: number } | undefined;
    if (!target) return null;
    g.selectWarpTarget(target.id);
    return target.id;
  });
  if (gateId == null) throw new Error("в списке целей варпа нет входа в Предел");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await readFlight(page))?.warp.phase, { timeout: 10_000 }).toBe("spooling");
  await expect.poll(async () => (await readFlight(page))?.activeSystemId, { timeout: 25_000 }).toBe(gateId);
  const flight = await readFlight(page);
  expect(flight?.flag).toBe("relic");
  expect(flight?.warp.inSector).toBe(true);
  expect(flight?.warp.charges).toBe(5);
  return gateId;
}

test.describe("Часть XIII: варп «Наследие» и Реликтовый Предел", () => {
  test("раскрутка, прыжок в сектор, холодная сцена и выход Вратами", async ({ page }) => {
    test.setTimeout(150_000);
    const diag = attachDiagnostics(page);
    await startFlightWithWarp(page);
    // выбор цели (контракт UI) + подтверждение клавишей Enter → раскрутка с экранным эффектом
    const gateId = await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
      const target = g.warpTargets().find((t: { sector: boolean }) => t.sector) as { id: number } | undefined;
      if (!target) return null;
      g.selectWarpTarget(target.id);
      return target.id;
    });
    if (gateId == null) throw new Error("в списке целей варпа нет входа в Предел");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readFlight(page))?.warp.phase, { timeout: 10_000 }).toBe("spooling");
    await expect.poll(async () => (await readFlight(page))?.warp.spoolProgress, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: `${ARTIFACTS}/warp-spool.png` });
    await expect.poll(async () => (await readFlight(page))?.activeSystemId, { timeout: 25_000 }).toBe(gateId);
    const flight = await readFlight(page);
    expect(flight).not.toBeNull();
    expect(flight!.flag).toBe("relic");
    expect(flight!.warp.inSector).toBe(true);
    expect(flight!.warp.charges).toBe(5);
    // сцена Предела: холодная палитра + индикатор опасности (13d §1.5, §10.2)
    expect(flight!.warnings.some((w) => /ПРЕДЕЛ|Опасность/i.test(w))).toBe(true);
    expect(flight!.hints.some((h) => /Предел: гиперлиний нет/i.test(h))).toBe(true);
    expect(flight!.sector?.systems).toBe(45);
    expect(flight!.sector?.active).toBe(true);
    await page.screenshot({ path: `${ARTIFACTS}/warp-sector.png` });

    // выход через Врата: стабильность 50 ≥ 25 — бесплатно, без заряда
    const chargesBefore = flight!.warp.charges;
    const exitTarget = flight!.targets.find((t) => t.kind === "gate");
    expect(exitTarget).toBeTruthy();
    const exitRequested = await page.evaluate((id) => {
      const g = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
      g.selectWarpTarget(id);
      return g.requestWarp() as boolean;
    }, exitTarget!.id);
    expect(exitRequested).toBe(true);
    await expect.poll(async () => (await readFlight(page))?.flag ?? null, { timeout: 25_000 }).toBeNull();
    const back = await readFlight(page);
    expect(back!.warp.inSector).toBe(false);
    expect(back!.warp.charges).toBe(chargesBefore);
    expect(diag.pageErrors).toEqual([]);
    expectNoErrors(diag);
    void gateId;
  });

  test("опасная система Предела, смерть в секторе и сейв/загрузка", async ({ page }) => {
    test.setTimeout(180_000);
    const diag = attachDiagnostics(page);
    const { hazard } = await startFlightWithWarp(page);
    await warpIntoSector(page);
    // «сканируем» системы Предела: варп к опасной (haz_choir_wave)
    const target = hazard ?? null;
    if (target) {
      const requested = await page.evaluate((id) => {
        const g = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
        for (const meta of g.world.fg.ancients.sector.systems) meta.visited = true;
        g.selectWarpTarget(id);
        return g.requestWarp();
      }, target.id);
      expect(requested, "sim отклонил варп к опасной системе").toBe(true);
      await expect.poll(async () => (await readFlight(page))?.activeSystemId, { timeout: 25_000 }).toBe(target.id);
      const hazardFlight = await readFlight(page);
      expect(hazardFlight!.warp.sectorHazard).toBeGreaterThanOrEqual(2);
      expect(hazardFlight!.warnings.some((w) => /Волна Хора|Зов|Радиация|Ловушка POI/i.test(w))).toBe(true);
      expect(hazardFlight!.warnings.some((w) => /Сенсоры −/i.test(w))).toBe(true);
      await page.screenshot({ path: `${ARTIFACTS}/warp-hazard.png` });
    }

    // смерть в секторе: капсула возвращает в столицу, сейв остаётся валидным
    await page.evaluate(() => {
      const debug = (window as unknown as { __SF_SYSTEM__?: { damage: (n: number) => void } }).__SF_SYSTEM__;
      debug?.damage(1_000_000);
    });
    await expect.poll(async () => (await readFlight(page))?.mode, { timeout: 20_000 }).toBe("galaxy");
    const saved = await page.evaluate(async () => {
      const g = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
      const ok = await g.saveGame();
      const loaded = await g.loadGame();
      const player = g.world.empires.find((e: { isPlayer: boolean }) => e.isPlayer);
      return {
        ok,
        loaded,
        mode: g.getState().mode,
        sectorSystems: g.world.fg?.ancients?.sector?.systems?.length ?? 0,
        fleets: g.world.fleets.filter((f: { empireId: number; ships: unknown[] }) => f.empireId === player?.id && f.ships.length > 0).length,
      };
    });
    expect(saved).toMatchObject({ ok: true, loaded: true, mode: "galaxy", sectorSystems: 45 });
    expect(saved.fleets).toBeGreaterThan(0);
    expectNoErrors(diag);
  });

  test("варп с карты (без полётного вида): цели, выбор, прыжок и HUD-телеметрия", async ({ page }) => {
    test.setTimeout(120_000);
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    const info = await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
      g.newGame(77, "campaign");
      const fg = g.world.fg;
      fg.ancients.warp.unlocked = true;
      fg.ancients.warp.charges = 5;
      fg.ancients.warp.cooldownUntil = 0;
      fg.ancients.sector.discovered = true;
      g.ensureSectorVisible();
      const target = g.warpTargets().find((t: { sector: boolean }) => t.sector) as { id: number };
      const selectedTarget = g.selectWarpTarget(target.id);
      const selected = g.warpStatus();
      const ok = g.requestWarp();
      const player = g.world.empires.find((e: { isPlayer: boolean }) => e.isPlayer);
      const fleet = g.world.fleets.find((f: { id: number; empireId: number; ships: unknown[] }) => f.id === player.flagshipFleetId && f.ships.length > 0)
        ?? g.world.fleets.find((f: { empireId: number; ships: unknown[] }) => f.empireId === player.id && f.ships.length > 0);
      const status = g.warpStatus();
      return {
        targetId: target.id as number,
        selectedTargetId: (selectedTarget?.id ?? selected.targetSystemId) as number | null,
        ok: ok as boolean,
        mode: g.getState().mode as string,
        fleetSystemId: (fleet as { systemId: number } | undefined)?.systemId ?? null,
        charges: status.charges as number,
        cooldown: status.cooldownTicks as number,
        sectorSystems: fg.ancients.sector.systems.length as number,
      };
    });
    // карта: варп стратегический — сразу переносит флот, но остаётся режим карты
    expect(info.mode).toBe("galaxy");
    expect(info.selectedTargetId).toBe(info.targetId);
    expect(info.ok).toBe(true);
    expect(info.fleetSystemId).toBe(info.targetId);
    expect(info.charges).toBe(4);
    expect(info.cooldown).toBeGreaterThan(0);
    expect(info.sectorSystems).toBe(45);
    await page.screenshot({ path: `${ARTIFACTS}/warp-map.png` });
    // кулдаун истёк (6 тактов на карте) — HUD больше не показывает причину отказа
    const afterCooldown = await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
      g.world.tick += 6;
      const status = g.warpStatus();
      return { blocked: status.blockedReason as string, cooldown: status.cooldownTicks as number, active: status.active as boolean };
    });
    expect(afterCooldown.cooldown).toBe(0);
    expect(afterCooldown.blocked).toBe("");
    expect(afterCooldown.active).toBe(true);
    expectNoErrors(diag);
  });
});

