/**
 * M4: живой L2-бой (docs/06 M4): войти в систему с пиратами, сблизиться, открыть огонь,
 * уничтожить врагов, получить отчёт о бое и вернуться на карту.
 * Проверяются также щит/корпус игрока (получает урон) и тепло оружия (перегрев/остывание).
 */
import { expect, test, type Page } from "@playwright/test";
import { attachDiagnostics, ensureGame, expectNoErrors, gotoGame, isVisible } from "./helpers";

interface Telemetry {
  mode: string;
  overlay: string;
  combat: string;
  speed: number;
  shield: number;
  shieldMax: number;
  hull: number;
  hullMax: number;
  heat: number;
  throttle: number;
  pips: { sys: number; eng: number; wep: number };
  targetName: string | null;
  targetDist: number;
  hostile: number;
  contacts: { name: string; hostile: boolean; hull01: number }[];
  battleVisible: boolean;
  report: { outcome: string; defenderShipsLost: number; spoilsCredits: number; durationSec: number; tactical: boolean } | null;
}

async function read(page: Page): Promise<Telemetry> {
  return page.evaluate(() => {
    const game = (window as unknown as { __SF_GAME__: { getState: () => Record<string, unknown>; flightTelemetry: Record<string, unknown> } }).__SF_GAME__;
    const state = game.getState() as unknown as {
      mode: string; overlay: string;
      battleReport: { outcome: string; defenderShipsLost: number; spoilsCredits: number; durationSec: number; tactical: boolean } | null;
    };
    const telemetry = game.flightTelemetry as unknown as {
      mode: string; speed: number; shield: number; shieldMax: number; hull: number; hullMax: number;
      heat: number; throttle: number; pips: { sys: number; eng: number; wep: number };
      targetName: string | null; targetDist: number; contacts: { hostile: boolean }[];
    };
    return {
      mode: state.mode,
      overlay: state.overlay,
      combat: telemetry.mode,
      speed: telemetry.speed,
      shield: telemetry.shield,
      shieldMax: telemetry.shieldMax,
      hull: telemetry.hull,
      hullMax: telemetry.hullMax,
      heat: telemetry.heat,
      throttle: telemetry.throttle,
      pips: { ...telemetry.pips },
      targetName: telemetry.targetName,
      targetDist: telemetry.targetDist,
      hostile: telemetry.contacts.filter((contact) => contact.hostile).length,
      contacts: telemetry.contacts.map((contact) => ({
        name: (contact as unknown as { name: string }).name,
        hostile: contact.hostile,
        hull01: (contact as unknown as { hull01: number }).hull01,
      })),
      battleVisible: Boolean(document.querySelector('[data-testid="battle-overlay"]')),
      report: state.battleReport
        ? {
          outcome: state.battleReport.outcome,
          defenderShipsLost: state.battleReport.defenderShipsLost,
          spoilsCredits: state.battleReport.spoilsCredits,
          durationSec: state.battleReport.durationSec,
          tactical: state.battleReport.tactical,
        }
        : null,
    };
  });
}

test.use({ trace: "off", video: "off" });

test.describe("M4: живой L2-бой с пиратами", () => {
  test.setTimeout(210_000);

  test("вход к пирату → сближение → огонь → уничтожение → отчёт → возврат на карту", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);

    // Выбираем систему с пиратским флотом (приоритет — соседняя со столицей, вход по UI-метке).
    const target = await page.evaluate(() => {
      const game = (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__;
      const world = game.world;
      const playerId = world.playerEmpireId;
      const player = world.empires.find((empire: any) => empire.isPlayer);
      const capitalId = player ? player.capitalSystemId : world.systems[0].id;
      const capital = world.systems.find((system: any) => system.id === capitalId);
      const hostileShips = new Map<number, number>();
      for (const fleet of world.fleets) {
        if (fleet.empireId === playerId || fleet.ships.length === 0) continue;
        hostileShips.set(fleet.systemId, (hostileShips.get(fleet.systemId) ?? 0) + fleet.ships.length);
      }
      const withEnemies = world.systems.filter((system: any) => hostileShips.has(system.id));
      const isPirate = (system: any): boolean => world.fleets.some((fleet: any) => fleet.systemId === system.id && fleet.empireId === 9 && fleet.ships.length > 0);
      const adjacent = withEnemies.filter((system: any) => capital && capital.links.includes(system.id));
      const chosen = adjacent.filter(isPirate)[0] ?? adjacent[0] ?? withEnemies.filter(isPirate)[0] ?? withEnemies[0];
      if (!chosen) return null;
      // тест-харнесс: система должна быть известна, иначе вход запрещён правилами симуляции
      if (!chosen.knownBy.includes(playerId)) chosen.knownBy.push(playerId);
      game.focusSystem(chosen.id);
      return { id: chosen.id as number, name: chosen.name as string, ships: hostileShips.get(chosen.id) as number };
    });
    expect(target, "в галактике нет систем с вражескими флотами").toBeTruthy();

    await page.waitForTimeout(600);
    // Штатный путь: двойной клик по метке системы на карте; фолбэк — API, если метка скрыта плотностью.
    const label = page.locator('[data-testid="map-label"][data-system-id="' + target!.id + '"]');
    if (await isVisible(label, 2_000)) {
      await label.first().dblclick();
    } else {
      await page.evaluate((id) => (window as unknown as { __SF_GAME__: Record<string, any> }).__SF_GAME__.enterSystem(id), target!.id);
    }
    await page.locator('[data-testid="flight-hud"]').waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2200);

    // Бой: враги появляются сразу при входе в систему с враждебным флотом.
    await expect.poll(async () => (await read(page)).hostile, { timeout: 25_000 }).toBeGreaterThan(0);
    const entered = await read(page);
    expect(entered.mode).toBe("system");
    expect(entered.combat).toBe("combat");

    // Тактика M4: перераспределяем пипсы в WEP (4), оружие — лазеры + кинетика.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await read(page)).pips.wep, { timeout: 5_000 }).toBeGreaterThanOrEqual(4);

    // Захват мыши + выбор цели + сближение до эффективной дистанции.
    await page.keyboard.press("q");
    const canvas = page.locator('[data-testid="game-canvas"]');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(300);
    await expect.poll(async () => (await read(page)).targetName, { timeout: 20_000 }).not.toBeNull();
    await page.waitForTimeout(500);
    await expect.poll(async () => {
      const state = await read(page);
      return state.targetDist > 0 && state.targetDist < 1700;
    }, { timeout: 30_000, intervals: [300, 500, 750] }).toBe(true);

    // Огонь с контролем тепла (не допускаем перегрева ≥100).
    let firing = false;
    const setFire = async (on: boolean): Promise<void> => {
      if (on === firing) return;
      firing = on;
      if (on) await page.mouse.down();
      else await page.mouse.up();
    };
    let minShield = entered.shield;
    let maxHeat = 0;
    let result: "battle" | "death" | "timeout" = "timeout";
    let heatPaused = false;
    const hostileNames = (state: Telemetry): string[] => state.contacts.filter((contact) => contact.hostile).map((contact) => contact.name);
    for (let step = 0; step < 400; step++) {
      await page.waitForTimeout(250);
      const state = await read(page);
      if (state.mode !== "system") { result = "death"; break; }
      if (state.battleVisible || state.overlay === "battle") { result = "battle"; break; }
      minShield = Math.min(minShield, state.shield);
      maxHeat = Math.max(maxHeat, state.heat);
      // цель должна быть врагом (иначе Q выбирает станцию и огонь уходит в пустоту)
      const enemies = hostileNames(state);
      if (state.hostile > 0 && (state.targetName === null || !enemies.includes(state.targetName))) {
        await page.keyboard.press("q");
      }
      // гистерезис тепла: не допускаем перегрева (100 → 3 с без оружия)
      if (state.heat > 88) heatPaused = true;
      else if (state.heat < 55) heatPaused = false;
      await setFire(!heatPaused && state.targetDist > 0 && state.targetDist < 1900);
    }
    await setFire(false);
    if (result === "death") {
      const dead = await read(page);
      throw new Error("Игрок погиб до уничтожения пиратов: " + JSON.stringify(dead));
    }
    expect(result, "бой не завершился отчётом за отведённое время").toBe("battle");
    // L2-элементы: игрок стрелял (тепло росло) и получал урон (щит падал)
    expect(maxHeat).toBeGreaterThan(0);
    expect(minShield).toBeLessThanOrEqual(entered.shieldMax);
    expect(minShield < entered.shieldMax || (await read(page)).hull < entered.hullMax).toBe(true);

    // Отчёт о бое: победа игрока, потери врага, трофеи, тактический бой.
    const overlay = page.locator('[data-testid="battle-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    const report = (await read(page)).report;
    expect(report).not.toBeNull();
    expect(report!.outcome).toBe("attacker_win");
    expect(report!.defenderShipsLost).toBeGreaterThanOrEqual(1);
    expect(report!.spoilsCredits).toBeGreaterThan(0);
    expect(report!.tactical).toBe(true);
    // живой бой пишет реальную длительность тактического боя (может быть < 60 с канонных)
    expect(report!.durationSec).toBeGreaterThan(0);
    expect(report!.durationSec).toBeLessThanOrEqual(600);
    const overlayText = await overlay.first().innerText();
    expect(overlayText).toMatch(/Победа/i);
    expect(overlayText).toMatch(/Трофеи/i);

    // Закрываем отчёт — вид сам возвращает игрока на карту галактики.
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await read(page)).mode, { timeout: 20_000 }).toBe("galaxy");
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 10_000 });
    expectNoErrors(diag);
  });
});
