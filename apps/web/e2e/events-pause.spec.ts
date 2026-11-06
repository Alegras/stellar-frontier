/**
 * Случайные события: пока игрок не выбрал, время стоит; после выбора/«Отложить»
 * время идёт, а событие не остаётся в очереди (не копится).
 */
import { expect, test } from "@playwright/test";
import { attachDiagnostics, ensureGame, gotoGame } from "./helpers";

type G = {
  __SF_GAME__: {
    getState(): { tick: number; paused: boolean };
    setSpeed(n: number): void;
    world: { fg: { narrative: { pending: unknown[] } }; tick: number };
  };
};

test.describe("События и время", () => {
  test("модалка ставит время на паузу; выбор/отложить убирают событие и возобновляют ход", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);
    await page.evaluate(() => {
      const w = (window as unknown as G).__SF_GAME__;
      w.setSpeed(1);
      w.world.fg.narrative.pending = [];
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const w = (window as unknown as G).__SF_GAME__;
      w.world.fg.narrative.pending.push({ id: "e2e_event", chainId: "e2e", step: 1, titleRu: "Тест", textRu: "Тест", choices: [{ id: "a", labelRu: "Принять", effects: [] }], tick: w.world.tick, expiresTick: w.world.tick + 200 });
    });
    await expect(page.locator('[data-testid="narrative-event"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="event-time-paused"]')).toBeVisible();
    const before = await page.evaluate(() => { const w = (window as unknown as G).__SF_GAME__; return { tick: w.getState().tick, paused: w.getState().paused }; });
    expect(before.paused).toBe(true);
    await page.waitForTimeout(1_600);
    const frozen = await page.evaluate(() => { const w = (window as unknown as G).__SF_GAME__; return { tick: w.getState().tick, paused: w.getState().paused }; });
    expect(frozen.tick).toBe(before.tick);
    expect(frozen.paused).toBe(true);

    await page.locator('[data-testid="btn-choice-a"]').click();
    await expect(page.locator('[data-testid="narrative-event"]')).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(async () => page.evaluate(() => (window as unknown as G).__SF_GAME__.getState().paused), { timeout: 5_000 }).toBe(false);
    await expect.poll(async () => page.evaluate(() => (window as unknown as G).__SF_GAME__.getState().tick), { timeout: 5_000 }).toBeGreaterThan(frozen.tick);
    expect(await page.evaluate(() => (window as unknown as G).__SF_GAME__.world.fg.narrative.pending.length)).toBe(0);

    // «Отложить» не оставляет событие в очереди
    await page.evaluate(() => {
      const w = (window as unknown as G).__SF_GAME__;
      w.world.fg.narrative.pending = [];
      w.world.fg.narrative.pending.push({ id: "e2e_event2", chainId: "e2e2", step: 1, titleRu: "Тест2", textRu: "Тест2", choices: [{ id: "a", labelRu: "Принять", effects: [] }], tick: w.world.tick, expiresTick: w.world.tick + 200 });
    });
    await expect(page.locator('[data-testid="narrative-event"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="btn-later-event"]').click();
    await expect(page.locator('[data-testid="narrative-event"]')).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(async () => page.evaluate(() => (window as unknown as G).__SF_GAME__.getState().paused), { timeout: 5_000 }).toBe(false);
    expect(await page.evaluate(() => (window as unknown as G).__SF_GAME__.world.fg.narrative.pending.length)).toBe(0);

    expect(diag.pageErrors).toEqual([]);
  });
});
