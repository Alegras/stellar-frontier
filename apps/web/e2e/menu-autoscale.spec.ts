/**
 * Автомасштабирование меню выбора расы: тайлы читаемы, текст не выходит
 * за карточку, карточки не наезжают друг на друга, кнопка старта видна.
 */
import { expect, test } from "@playwright/test";
import { gotoGame } from "./helpers";

const VIEWPORTS = [
  { width: 1453, height: 850 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

for (const vp of VIEWPORTS) {
  test("меню рас " + vp.width + "×" + vp.height + ": тайлы без обрезки и наложений", async ({ page }) => {
    await page.setViewportSize(vp);
    await gotoGame(page);
    const cards = page.locator('[data-testid^="race-card-"]');
    await expect(cards).toHaveCount(8, { timeout: 10_000 });
    await expect(page.locator('[data-testid="btn-mode-campaign"]')).toBeVisible();

    // контент каждой карточки помещается в её рамку (scrollHeight <= clientHeight + 1)
    const overflow = await cards.evaluateAll((els) => els.map((el) => ({
      id: (el as HTMLElement).dataset.testid,
      scroll: (el as HTMLElement).scrollHeight,
      client: (el as HTMLElement).clientHeight,
      w: el.getBoundingClientRect().width,
    })));
    for (const c of overflow) {
      expect(c.scroll, c.id + " overflow").toBeLessThanOrEqual(c.client + 1);
      expect(c.w, c.id + " width").toBeGreaterThan(150);
    }

    // карточки не пересекаются (ни по вертикали, ни по горизонтали)
    const boxes = await cards.evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX > 1 && overlapY > 1, "race cards " + i + "/" + j + " overlap").toBe(false);
      }
    }
    await page.screenshot({ path: "docs/shots/menu-race-autoscale-" + vp.width + ".png" });
  });
}
