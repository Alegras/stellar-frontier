/**
 * Политическая карта галактики: панель рядом с миникартой.
 * Проверяем отображение, легенду империй, клик по системе и сворачивание.
 */
import { expect, test } from "@playwright/test";
import { attachDiagnostics, ensureGame, gotoGame } from "./helpers";

test.describe("Политическая карта", () => {
  test("отображается рядом с миникартой, клик меняет систему, сворачивается", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await ensureGame(page);

    const panel = page.locator('[data-testid="political-map"]');
    const canvas = page.locator('[data-testid="political-map-canvas"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(canvas).toBeVisible();
    await expect(page.locator('[data-testid="minimap"]')).toBeVisible();

    const legend = page.locator('[data-testid^="political-legend-"]');
    await expect.poll(async () => legend.count(), { timeout: 10_000 }).toBeGreaterThan(0);

    const before = await page.evaluate(() => (window as unknown as { __SF_GAME__: { getState(): { selectedSystemId: number | null } } }).__SF_GAME__.getState().selectedSystemId);
    // Клик по строке легенды другой империи надёжнее клика по точке: фокусирует её столицу.
    if ((await legend.count()) > 1) {
      await legend.last().click();
    } else {
      const box = await canvas.boundingBox();
      if (!box) throw new Error("canvas без boundingBox");
      await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.2 } });
    }
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __SF_GAME__: { getState(): { selectedSystemId: number | null } } }).__SF_GAME__.getState().selectedSystemId), { timeout: 5_000 }).not.toBe(before);

    await page.screenshot({ path: "docs/shots/political-map.png" });

    await page.locator('[data-testid="btn-toggle-political-map"]').click();
    await expect(canvas).toHaveCount(0);
    await page.locator('[data-testid="btn-toggle-political-map"]').click();
    await expect(canvas).toBeVisible();

    expect(diag.pageErrors).toEqual([]);
  });
});