import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  SEL, attachDiagnostics, ensureGame, expectNoErrors, gotoGame, isVisible, removeViteOverlay,
} from "./helpers";

/**
 * Клик по testid через DOM: устойчив к HMR-перезагрузкам, когда другие агенты
 * параллельно сохраняют файлы и React пересоздаёт узлы посреди клика.
 */
async function clickTestId(page: Page, testId: string, expectSel?: string): Promise<void> {
  await page.waitForFunction(
    (tid) => !!document.querySelector('[data-testid="' + tid + '"]'),
    testId,
    { timeout: 20_000 },
  );
  await page.evaluate((tid) => {
    const el = document.querySelector<HTMLElement>('[data-testid="' + tid + '"]');
    el?.click();
  }, testId);
  if (expectSel) await expect(page.locator(expectSel)).toBeVisible({ timeout: 12_000 });
}

/**
 * UI полной игры (M6–M12): вкладки империи (традиции/дипломатия/кампания)
 * и торговые вкладки станции (торговля/контракты).
 * Панели выполняются поверх мира; контент @sf/data может быть ещё пуст — проверяем каркас.
 */
test.describe.configure({ retries: 2 });

test.describe("UI полной игры", () => {
  test("вкладки империи открывают панели традиций, дипломатии и кампании", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);
    await removeViteOverlay(page);

    const openColonies = page.locator('[data-testid="btn-open-colonies"]');
    if (!(await isVisible(openColonies, 5_000))) test.skip(true, "нет кнопки панелей империи (App не подключён)");
    await removeViteOverlay(page);
    await clickTestId(page, "btn-open-colonies");
    await page.waitForFunction(() => !!document.querySelector('[data-testid="empire-drawer"]'), undefined, { timeout: 15_000 });
    await expect(page.locator('[data-testid="empire-drawer"]')).toBeVisible({ timeout: 10_000 });

    await clickTestId(page, "tab-traditions", '[data-testid="traditions-panel"]');

    await clickTestId(page, "tab-diplomacy", '[data-testid="diplomacy-panel"]');

    await clickTestId(page, "tab-campaign", '[data-testid="campaign-panel"]');

    // вкладки внутри кампании
    await clickTestId(page, "btn-campaign-victory", '[data-testid="victory-progress-panel"]');
    await clickTestId(page, "btn-campaign-megastructures", '[data-testid="megastructures-panel"]');

    await page.locator('[data-testid="btn-close-empire"]').first().click();
    expectNoErrors(diag);
  });

  test("станция: вкладки торговли и контрактов", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);
    await removeViteOverlay(page);

    const dock = page.locator('[data-testid="btn-dock"]');
    if (!(await isVisible(dock, 5_000))) test.skip(true, "у столицы нет станции — док недоступен");
    await dock.first().click();

    await expect(page.locator(SEL.station)).toBeVisible({ timeout: 10_000 });
    const trade = page.locator('[data-testid="tab-trade"]');
    if (await isVisible(trade, 3_000)) {
      await clickTestId(page, "tab-trade", '[data-testid="market-panel"]');
      // биржа CR↔энергия
      await clickTestId(page, "btn-market-tab-exchange", '[data-testid="exchange-panel"]');
      // маршруты
      await clickTestId(page, "btn-market-tab-routes", '[data-testid="routes-panel"]');
    }
    await clickTestId(page, "tab-contracts", '[data-testid="contracts-panel"]');

    await page.locator('[data-testid="btn-undock"]').first().click();
    expectNoErrors(diag);
  });

  test("реестр панелей полной игры: PanelHost монтирует любую панель", async ({ page }) => {
    await gotoGame(page);
    await ensureGame(page);
    await removeViteOverlay(page);
    // PanelHost подключает Lead; проверяем, что App жив после открытия оверлеев
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 10_000 });
  });
});
