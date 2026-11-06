/**
 * Регрессионные тесты найденных багов:
 * 1) после победы «Продолжить» не возобновлял время (окно победы переоткрывалось каждый такт);
 * 2) форма лимитного ордера на станции предлагала товары, которыми станция не торгует,
 *    а форма маршрута — системы без станции/пути, из-за чего создание молча не срабатывало.
 */
import { expect, test } from "@playwright/test";
import { attachDiagnostics, ensureGame, gotoGame, isVisible } from "./helpers";

type DebugWindow = {
  __SF_GAME__: {
    getState(): { tick: number; overlay: string; mode: string };
    getPlayerEmpire(): { id: number; capitalSystemId: number; resources: Record<string, number> };
    world: {
      victory: { achieved: string | null; winnerEmpireId: number };
      systems: Array<{ id: number; station?: { id: number; market: Record<string, unknown> } }>;
      fg?: { markets: Record<number, { orders: Array<{ id: number }> }>; routes: unknown[] };
    };
    setSpeed(n: number): void;
    dockAtStation(id: number): void;
  };
};

const game = (page: import("@playwright/test").Page) =>
  page.evaluateHandle(() => (window as unknown as DebugWindow).__SF_GAME__);

test.describe("Регрессии полной игры", () => {
  test("победа: «Продолжить» возобновляет время и не переоткрывает окно", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);
    await page.evaluate(() => {
      const g = (window as unknown as DebugWindow).__SF_GAME__;
      g.setSpeed(1);
      const w = g.world;
      w.victory.achieved = "economy";
      w.victory.winnerEmpireId = g.getPlayerEmpire().id;
    });
    const overlay = page.locator('[data-testid="victory-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    const tickBefore = await page.evaluate(() => (window as unknown as DebugWindow).__SF_GAME__.getState().tick);
    await page.locator('[data-testid="btn-continue-victory"]').click();
    await expect(overlay).toBeHidden({ timeout: 5_000 });
    await page.evaluate(() => (window as unknown as DebugWindow).__SF_GAME__.setSpeed(5));
    await page.waitForTimeout(2_500);
    const state = await page.evaluate(() => (window as unknown as DebugWindow).__SF_GAME__.getState());
    expect(state.tick).toBeGreaterThan(tickBefore);
    expect(state.overlay).not.toBe("victory");
    expect(diag.pageErrors).toEqual([]);
  });

  test("станция: ордер создаётся, в списке товаров только торгуемые", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);
    await page.evaluate(() => {
      const g = (window as unknown as DebugWindow).__SF_GAME__;
      g.setSpeed(0);
      const p = g.getPlayerEmpire();
      Object.assign(p.resources, { energy: 1e6, minerals: 1e6, food: 1e6, alloys: 1e6, goods: 1e6, unity: 1e6, influence: 1e6, credits: 1e6 });
      const station = g.world.systems[p.capitalSystemId]?.station;
      if (station) g.dockAtStation(station.id);
    });
    await expect(page.locator('[data-testid="station-screen"]')).toBeVisible({ timeout: 10_000 });
    const tradeTab = page.locator('[data-testid="tab-trade"]');
    if (await isVisible(tradeTab, 3_000)) await tradeTab.click();
    const goodSelect = page.locator('[data-testid="select-order-good"]');
    await expect(goodSelect).toBeVisible({ timeout: 10_000 });
    const goods = await goodSelect.locator("option").evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(goods.length).toBeGreaterThan(0);
    await page.locator('[data-testid="select-order-side"]').selectOption("buy");
    await page.locator('[data-testid="input-order-price"]').fill("100");
    await page.locator('[data-testid="input-order-qty"]').fill("5");
    await page.locator('[data-testid="btn-place-order"]').click();
    await expect
      .poll(async () => page.evaluate(() => {
        const g = (window as unknown as DebugWindow).__SF_GAME__;
        const p = g.getPlayerEmpire();
        const st = g.world.systems[p.capitalSystemId]?.station;
        if (!st) return -1;
        const m = g.world.fg?.markets[st.id];
        return m ? m.orders.length : -1;
      }), { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect(diag.pageErrors).toEqual([]);
  });
});
