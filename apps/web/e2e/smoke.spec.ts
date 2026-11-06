/**
 * Smoke e2e: «игра запускается и играбельна» (M0–M3).
 * Полный пользовательский путь: меню → карта → инспектор системы → полёт → возврат → сохранение.
 */
import { test, expect } from "@playwright/test";
import { SEL, attachDiagnostics, btnOrText, canvasInfo, canvasLocator, clickAny, expectNoErrors, gotoGame, isVisible, selectSystem, waitForAny, dismissDialogueOverlay } from "./helpers";

test.describe("Smoke: запуск и базовый цикл", () => {
  test("01 · страница грузится без ошибок консоли", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await expect(page.locator("body")).not.toBeEmpty();
    await page.waitForTimeout(1_500);
    // Меню или сразу игра (если кампания восстанавливается из IndexedDB).
    const menu = page.locator(SEL.menu);
    const canvas = canvasLocator(page);
    expect(await isVisible(menu, 5_000) || await isVisible(page.locator(SEL.topBar), 3_000) || await isVisible(canvas, 3_000)).toBeTruthy();
    expectNoErrors(diag);
  });

  test("02 · новая кампания открывает карту с ресурсами и WebGL", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    const menu = page.locator(SEL.menu);
    if (await isVisible(menu, 8_000)) {
      await clickAny(page, btnOrText(page, "btn-new-game", /Новая кампания/i), 10_000, "btn-new-game");
    }

    // Верхняя панель и ресурсы.
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
    await dismissDialogueOverlay(page); // DLC XIV
    await expect(page.locator(SEL.resourceEnergy)).toBeVisible();
    await expect(page.locator(SEL.resourceMinerals)).toBeVisible();
    await expect(page.locator(SEL.tick)).toBeVisible();

    // Canvas существует и реально отрисован Three.js (WebGL2).
    const canvas = canvasLocator(page);
    await expect(canvas).toBeVisible();
    const info = await canvasInfo(page);
    expect(info, "canvas не найден в DOM").not.toBeNull();
    expect(info!.width).toBeGreaterThan(0);
    expect(info!.height).toBeGreaterThan(0);
    expect(info!.gl, "WebGL-контекст не создан (проверьте, что Chrome запущен без swiftshader)").toBeTruthy();
    expect(info!.version ?? "").toContain("WebGL");

    // Симуляция тикает: счётчик такта меняется на скорости 3×.
    const speed3 = page.locator('[data-testid="btn-speed-3"]');
    if (await isVisible(speed3, 2_000)) {
      await speed3.click();
      const before = await page.locator(SEL.tick).innerText();
      await page.waitForTimeout(2_500);
      const after = await page.locator(SEL.tick).innerText();
      expect(after, "такт не меняется во времени").not.toBe(before);
    } else {
      test.info().annotations.push({ type: "missing-testid", description: "btn-speed-3 отсутствует — проверка хода времени упрощена" });
    }
    expectNoErrors(diag);
  });

  test("03 · выбор системы открывает инспектор", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGameSafe(page);

    const inspector = page.locator(SEL.systemInspector);
    const enterBtn = page.locator(SEL.enterSystem);

    // Столица часто выделена сразу; если инспектора нет — кликаем по метке/центру карты.
    if (!(await isVisible(inspector, 5_000))) {
      const viaLabel = await selectSystem(page);
      test.info().annotations.push({ type: viaLabel ? "map-label" : "canvas-center", description: "выбор системы кликом" });
    }

    const panel = await waitForAny(
      page,
      [inspector, enterBtn, page.getByText(/инспектор|выбранная система/i)],
      15_000,
      "system-inspector / btn-enter-system",
    );
    await expect(panel).toBeVisible();
    test.info().annotations.push({
      type: "selector",
      description: (await isVisible(inspector, 500)) ? "data-testid=system-inspector" : "текстовый фолбэк (testid отсутствует)",
    });
    expectNoErrors(diag);
  });

  test("04 · вход в систему → полётный HUD → возврат на карту", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGameSafe(page);

    // Выделяем систему (если ещё не выделена).
    if (!(await isVisible(page.locator(SEL.systemInspector), 5_000))) {
      await selectSystem(page);
    }

    await clickAny(page, btnOrText(page, "btn-enter-system", /войти в систему|войти/i), 15_000, "btn-enter-system");
    const hud = await waitForAny(
      page,
      [page.locator(SEL.flightHud), page.getByText(/скорость|тяга|суперкруиз/i)],
      25_000,
      "flight-hud",
    );
    await expect(hud).toBeVisible();
    await expect(canvasLocator(page)).toBeVisible();
    await page.waitForTimeout(1_500);

    // Возврат на карту.
    await clickAny(page, btnOrText(page, "btn-exit-map", /на карту|к карте|карта/i), 15_000, "btn-exit-map");
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 15_000 });
    expectNoErrors(diag);
  });

  test("05 · сохранение кампании не даёт ошибок", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGameSafe(page);

    const save = page.locator(SEL.save);
    if (!(await isVisible(save, 3_000))) {
      test.info().annotations.push({ type: "missing-testid", description: "btn-save отсутствует" });
      test.skip(true, "Кнопка сохранения (data-testid=btn-save) ещё не реализована");
      return;
    }
    await save.click();
    // Ожидаем индикатор «сохранено» или хотя бы отсутствие ошибок.
    await page.waitForTimeout(1_500);
    const saved = page.getByText(/сохранено|saved/i);
    if (await isVisible(saved, 2_000)) {
      await expect(saved.first()).toBeVisible();
    } else {
      test.info().annotations.push({ type: "no-save-badge", description: "индикатор сохранения не найден, проверено отсутствие ошибок" });
    }
    expectNoErrors(diag);
  });
});

/** ensureGame с диагностическими аннотациями (testid-гэпы видны в отчёте). */
async function ensureGameSafe(page: import("@playwright/test").Page): Promise<void> {
  await clickAny(
    page,
    [page.locator(SEL.newGame), page.locator(SEL.menu).getByRole("button", { name: /Новая кампания/i })],
    15_000,
    "btn-new-game (меню)",
  ).catch(() => undefined);
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await dismissDialogueOverlay(page); // DLC XIV
}
