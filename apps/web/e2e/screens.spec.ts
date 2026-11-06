/**
 * Скриншоты ключевых экранов → docs/shots/.
 * Реальные снимки через Playwright (Chrome, WebGL2). Недоступные экраны не создаются,
 * причина фиксируется в docs/shots/manifest.json и в выводе теста.
 *
 * Сценарий: меню → (seed 42, пауза) карта → инспектор → станция (btn-dock) → полёт (btn-enter-system)
 * → возврат на карту → снятие паузы → авто-бой на 4-м такте (сид 42) → отчёт о бое.
 */
import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, btnOrText, canvasLocator, clickAny, gotoGame, isVisible, selectSystem, waitViteClear, dismissDialogueOverlay } from "./helpers";

const shotsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
const manifestPath = path.join(shotsDir, "manifest.json");

interface ShotEntry {
  file: string;
  status: "captured" | "skipped" | "failed";
  note?: string;
  at: string;
  sha256?: string;
}

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

test.describe("Screens: снимки экранов", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  test("снять 01-menu … 06-battle (что доступно)", async ({ page }) => {
    mkdirSync(shotsDir, { recursive: true });
    const entries: ShotEntry[] = [];
    const diag = attachDiagnostics(page);

    const snap = async (file: string, note?: string): Promise<void> => {
      await waitViteClear(page);
      const abs = path.join(shotsDir, file);
      await page.screenshot({ path: abs });
      entries.push({ file, status: "captured", note, at: new Date().toISOString(), sha256: sha256File(abs) });
      console.log("[shot] " + file + (note ? " — " + note : ""));
    };
    const skip = (file: string, note: string): void => {
      entries.push({ file, status: "skipped", note, at: new Date().toISOString() });
      console.log("[skip] " + file + " — " + note);
    };
    /** Если авто-бой уже всплыл (оверлей), закрываем, чтобы не блокировал клики. */
    const dismissBattle = async (): Promise<void> => {
      const overlay = page.locator(SEL.battle);
      if (await isVisible(overlay, 250)) {
        const close = page.locator('[data-testid="btn-close-battle"], [data-testid="btn-close-battle-footer"]');
        if (await isVisible(close, 500)) await close.first().click();
        else await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    };

    await gotoGame(page);
    await page.waitForTimeout(1_000);

    // 01 · меню
    if (await isVisible(page.locator(SEL.menu), 10_000)) {
      await snap("01-menu.png");
      // Детерминированный сид 42: на 4-м такте пиратский рейд на столицу (для 06-battle).
      const seedInput = page.locator('[data-testid="input-seed"]');
      if (await isVisible(seedInput, 1_500)) await seedInput.fill("42");
      await clickAny(page, btnOrText(page, "btn-new-game", /Новая кампания/i), 10_000, "btn-new-game").catch(async () => {
        // Lead: игра доступна через window.__SF_GAME__ — детерминированный fallback.
        await page.evaluate(() => {
          const g = (window as unknown as { __SF_GAME__?: { newGame(seed?: number): void } }).__SF_GAME__;
          if (g) g.newGame(42);
        });
      });
    } else {
      skip("01-menu.png", "меню не показалось — игра сразу стартует с карты");
    }

    // 02 · карта (сразу ставим паузу, чтобы бой не всплыл раньше времени)
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await dismissDialogueOverlay(page);
    await dismissDialogueOverlay(page); // DLC XIV
    const pause = page.locator('[data-testid="btn-speed-0"]');
    if (await isVisible(pause, 3_000)) await pause.click();
    await dismissBattle();
    await page.waitForTimeout(2_500);
    await snap("02-map.png", "карта галактики после старта кампании (пауза)");

    // 03 · инспектор системы
    if (!(await isVisible(page.locator(SEL.systemInspector), 4_000))) {
      await selectSystem(page);
    }
    if (await isVisible(page.locator(SEL.systemInspector), 12_000)) {
      await page.waitForTimeout(700);
      await snap("03-system-inspector.png", "инспектор выделенной системы");
    } else {
      skip("03-system-inspector.png", "инспектор системы не найден");
    }

    // 05 · станция (из инспектора: кнопка стыковки)
    await waitViteClear(page);
    await dismissBattle();
    const dock = page.locator('[data-testid="btn-dock"]');
    if (await isVisible(dock, 4_000)) {
      await dock.click();
      if (await isVisible(page.locator(SEL.station), 8_000)) {
        await dismissBattle();
        await page.waitForTimeout(800);
        await snap("05-station.png", "экран станции L3 (док)");
        const undock = page.locator('[data-testid="btn-undock"]');
        if (await isVisible(undock, 3_000)) await undock.click();
        await page.waitForTimeout(500);
      } else {
        skip("05-station.png", "кнопка стыковки есть, но data-testid=station-screen не открылся");
      }
    } else {
      skip("05-station.png", "кнопка стыковки (btn-dock) недоступна для выбранной системы");
    }

    // 04 · полёт
    await waitViteClear(page);
    await dismissBattle();
    const enter = await Promise.race([
      page.locator(SEL.enterSystem).waitFor({ state: "visible", timeout: 5_000 }).then(() => page.locator(SEL.enterSystem)).catch(() => null),
      page.getByRole("button", { name: /войти в систему/i }).waitFor({ state: "visible", timeout: 5_000 }).then(() => page.getByRole("button", { name: /войти в систему/i })).catch(() => null),
    ]);
    if (enter) {
      await enter.click();
      if (await isVisible(page.locator(SEL.flightHud), 25_000)) {
        await dismissBattle();
        await page.waitForTimeout(2_000);
        // Убеждаемся, что HUD всё ещё на экране (мог случиться HMR-релоад от правок кода).
        expect(await isVisible(page.locator(SEL.flightHud), 2_000), "flight-hud исчез перед снимком").toBeTruthy();
        await snap("04-flight.png", "полёт L1: HUD и сцена системы");
      } else {
        skip("04-flight.png", "flight-hud не появился после входа в систему");
      }
    } else {
      skip("04-flight.png", "кнопка входа в систему не найдена");
    }

    // Назад на карту и снимаем паузу — ждём авто-бой (сид 42, ~4-й такт).
    const exit = page.locator(SEL.exitToMap);
    await waitViteClear(page);
    if (await isVisible(exit, 5_000)) await exit.click();
    await dismissBattle();
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 15_000 });
    const play = page.locator('[data-testid="btn-speed-1"]');
    if (await isVisible(play, 3_000)) await play.click();

    // 06 · бой: детерминированно через window.__SF_GAME__.
    // Вариант 1 — авторезолв при контакте (пиратский рейд / сближение), вариант 2 — сближение флагмана с врагом.
    await waitViteClear(page);
    const battleState = await page.evaluate(() => {
      const g = (window as unknown as {
        __SF_GAME__?: {
          getState(): { tick: number; overlay: string; paused: boolean };
          getPlayerEmpire(): { id: number; flagshipFleetId: number };
          world: { fleets: Array<{ id: number; empireId: number; systemId: number; ships: unknown[] }> };
          setSpeed(n: number): void;
          advance(ms: number): void;
          sendCommand(cmd: unknown): boolean;
        };
      }).__SF_GAME__;
      if (!g) return { available: false, battle: false, tick: 0 };
      g.setSpeed(5);
      for (let i = 0; i < 120 && g.getState().overlay !== "battle"; i++) g.advance(1000);
      if (g.getState().overlay !== "battle") {
        const player = g.getPlayerEmpire();
        const enemy = g.world.fleets.find((f) => f.empireId !== player.id && f.empireId > 0 && f.ships.length > 0);
        const flagship = g.world.fleets.find((f) => f.id === player.flagshipFleetId);
        if (enemy && flagship) {
          g.sendCommand({ type: "move_fleet", fleetId: flagship.id, systemId: enemy.systemId });
          for (let i = 0; i < 300 && g.getState().overlay !== "battle"; i++) g.advance(1000);
        }
      }
      return { available: true, battle: g.getState().overlay === "battle", tick: g.getState().tick };
    });
    let capturedBattle = false;
    if (battleState.battle || (await isVisible(page.locator(SEL.battle), 5_000))) {
      await page.waitForTimeout(700);
      await snap("06-battle.png", "отчёт о бое (реальный авторезолв, такт " + battleState.tick + ")");
      capturedBattle = true;
      const close = page.locator('[data-testid="btn-close-battle"], [data-testid="btn-close-battle-footer"]');
      if (await isVisible(close, 1_000)) await close.first().click();
    }
    if (!capturedBattle) {
      const reportBtn = page.locator('[data-testid="btn-open-battle"]');
      if (await isVisible(reportBtn, 1_000)) {
        await reportBtn.click();
        if (await isVisible(page.locator(SEL.battle), 4_000)) {
          await page.waitForTimeout(500);
          await snap("06-battle.png", "отчёт о бое (по кнопке из HUD)");
          capturedBattle = true;
        }
      }
    }
    if (!capturedBattle) skip("06-battle.png", "бой не наступил за отведённые такты и btn-open-battle нет");

    // Манифест снимков — доказательная база для docs/acceptance.md.
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          baseURL: test.info().project.use.baseURL,
          viewport: "1600x900",
          browser: "chrome (channel), WebGL2, без swiftshader",
          shots: entries,
          consoleErrors: diag.consoleErrors,
          pageErrors: diag.pageErrors,
        },
        null,
        2,
      ),
      "utf8",
    );

    // Обязательные снимки (01–04) должны быть реально сняты.
    for (const required of ["01-menu.png", "02-map.png", "03-system-inspector.png", "04-flight.png"]) {
      const entry = entries.find((e) => e.file === required);
      expect(entry, "нет записи для " + required).toBeTruthy();
      expect(entry!.status, required + " не снят").toBe("captured");
    }
    // Защита от HMR-флейка: полёт не должен быть пиксель-в-пиксель как меню.
    const menuSha = entries.find((e) => e.file === "01-menu.png")?.sha256;
    const flightSha = entries.find((e) => e.file === "04-flight.png")?.sha256;
    expect(flightSha, "04-flight.png идентичен 01-menu.png — снимок не отражает полёт (HMR/reload?)").not.toBe(menuSha);
    await expect(canvasLocator(page)).toBeVisible();
    expect(diag.pageErrors, "pageerror: " + diag.pageErrors.join(" | ")).toEqual([]);
  });
});