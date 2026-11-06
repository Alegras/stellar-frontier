/**
 * M3: стыковка из стартовой позиции в системе (PT-010).
 * Сценарий: новая кампания → вход в систему → G из 5 км → автопилот-помощник
 * доводит корабль к станции → экран станции; Esc возвращает в полёт (не на карту).
 */
import { expect, test } from "@playwright/test";
import { attachDiagnostics, ensureGame, expectNoErrors, gotoGame } from "./helpers";

interface FlightState {
  mode: string;
  overlay: string;
  telemetryActive: boolean;
  stationDist: number;
  canDock: boolean;
  speed: number;
  hints: string[];
  stationVisible: boolean;
}

async function flightState(page: import("@playwright/test").Page): Promise<FlightState> {
  return page.evaluate(() => {
    const game = (window as unknown as { __SF_GAME__: { getState: () => { mode: string; overlay: string }; flightTelemetry: Record<string, unknown> } }).__SF_GAME__;
    const state = game.getState();
    const telemetry = game.flightTelemetry as unknown as {
      active: boolean; stationDist: number; canDock: boolean; speed: number; hints: string[];
    };
    return {
      mode: state.mode,
      overlay: state.overlay,
      telemetryActive: telemetry.active,
      stationDist: telemetry.stationDist,
      canDock: telemetry.canDock,
      speed: telemetry.speed,
      hints: Array.isArray(telemetry.hints) ? [...telemetry.hints] : [],
      stationVisible: Boolean(document.querySelector('[data-testid="station-screen"]')),
    };
  });
}

const hintsOf = (state: FlightState): string => state.hints.join(" | ");

test.use({ trace: "off", video: "off" });

test.describe("M3: стыковка G из стартовой позиции", () => {
  test.setTimeout(150_000);

  test("G включает автопилот, открывает станцию; Esc — отстыковка в полёт; повторный G — мгновенная стыковка", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);

    // Входим в систему через инспектор — штатный UI-путь.
    await page.locator('[data-testid="btn-enter-system"]').first().click();
    await page.locator('[data-testid="flight-hud"]').waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const start = await flightState(page);
    expect(start.mode).toBe("system");
    expect(start.telemetryActive).toBe(true);
    // стартовая позиция: 3–8 км до станции (лид: док достижим за 20–40 с)
    expect(start.stationDist).toBeGreaterThan(2500);
    expect(start.stationDist).toBeLessThan(9000);
    expect(hintsOf(start)).toMatch(/автопилот стыковки/i);

    // G из стартовой позиции: включается автопилот-помощник (а не сухой отказ)
    await page.keyboard.press("g");
    await expect.poll(async () => hintsOf(await flightState(page)), { timeout: 10_000 })
      .toMatch(/отмена автопилота стыковки/i);

    // Автопилот доводит до станции и открывает L3
    const station = page.locator('[data-testid="station-screen"]');
    await expect(station).toBeVisible({ timeout: 90_000 });
    const docked = await flightState(page);
    expect(docked.mode).toBe("station");
    expect(docked.stationVisible).toBe(true);
    const stationText = await station.first().innerText();
    expect(stationText).toMatch(/Отстыковаться|Рынок/);

    // Esc на станции — отстыковка в полёт (а не выход на карту)
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="flight-hud"]')).toBeVisible({ timeout: 20_000 });
    const undocked = await flightState(page);
    expect(undocked.mode).toBe("system");
    expect(undocked.stationDist).toBeLessThan(2500);
    expect(undocked.speed).toBeLessThan(120);

    // Из зоны дока второй G — стыковка без автопилота
    await page.keyboard.press("g");
    await expect(station).toBeVisible({ timeout: 25_000 });
    expect((await flightState(page)).mode).toBe("station");

    expectNoErrors(diag);
  });

  test("ручной ввод отменяет автопилот стыковки, второй G снова включает", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);
    await page.locator('[data-testid="btn-enter-system"]').first().click();
    await page.locator('[data-testid="flight-hud"]').waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1600);

    await page.keyboard.press("g");
    await expect.poll(async () => hintsOf(await flightState(page)), { timeout: 10_000 })
      .toMatch(/отмена автопилота стыковки/i);

    // ручная тяга — автопилот должен отключиться с понятным уведомлением
    await page.keyboard.down("w");
    await page.waitForTimeout(1200);
    await page.keyboard.up("w");
    await expect.poll(async () => hintsOf(await flightState(page)), { timeout: 10_000 })
      .not.toMatch(/отмена автопилота стыковки/i);
    const manual = await flightState(page);
    expect(manual.mode).toBe("system");
    expect(manual.speed).toBeGreaterThan(5);

    // повторный G снова включает помощника
    await page.keyboard.press("g");
    await expect.poll(async () => hintsOf(await flightState(page)), { timeout: 10_000 })
      .toMatch(/отмена автопилота стыковки/i);

    expectNoErrors(diag);
  });
});
