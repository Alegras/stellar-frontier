import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, expectNoErrors, gotoGame } from "./helpers";

/**
 * Часть XII · адаптив DLC XIV: 1280×720, 1600×900, 1920×1080, 2560×1440 и zoom 80–150%.
 * Проверяем: панели вписываются, нет горизонтального скролла, узлы дерева не накладываются,
 * миникарта/зум присутствуют, длинные RU/EN тексты не ломают карточки.
 */
const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (name: string): string => SHOTS + name;
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

const domClick = async (page: Page, testId: string): Promise<void> => {
  await page.evaluate((id) => document.querySelector<HTMLElement>('[data-testid="' + id + '"]')?.click(), testId);
};

async function startGameAt(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (s?: number) => void; advance: (n: number) => void } }).__SF_GAME__;
    if (g && !g.hasWorld) g.newGame(12345);
    g?.advance(1);
  });
  await expect.poll(() => page.locator('[data-testid="top-bar"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(700);
}

async function closeDialog(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (!(await page.locator('[data-testid="dialogue-overlay"]').count())) return;
    if (await page.locator('[data-testid="dialogue-close"]').count()) await domClick(page, "dialogue-close");
    else break;
    await page.waitForTimeout(120);
  }
}

async function openJournal(page: Page): Promise<void> {
  await closeDialog(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.locator('[data-testid="panel-open-journal"]').count()) break;
    await domClick(page, "btn-open-more");
    await page.waitForTimeout(300);
  }
  await domClick(page, "panel-open-journal");
  await expect(page.locator('[data-testid="journal-panel"]')).toBeVisible({ timeout: 10_000 });
}

async function assertFits(page: Page, testId: string, label: string): Promise<void> {
  const box = await page.locator('[data-testid="' + testId + '"]').boundingBox();
  expect(box, label).not.toBeNull();
  if (!box) return;
  const vp = page.viewportSize()!;
  expect(box.x, label + " left").toBeGreaterThanOrEqual(-2);
  expect(box.y, label + " top").toBeGreaterThanOrEqual(-2);
  expect(box.x + box.width, label + " right").toBeLessThanOrEqual(vp.width + 2);
  expect(box.y + box.height, label + " bottom").toBeLessThanOrEqual(vp.height + 2);
}

async function assertTreeNodesInside(page: Page, label: string): Promise<void> {
  const wrap = await page.locator(".sf-tree__wrap").boundingBox();
  expect(wrap, label + " wrap").not.toBeNull();
  const vp = page.viewportSize()!;
  // высота контейнера должна оставлять дерево в видимой области (с учётом zoom и 4K)
  expect(wrap!.height, label + " wrap height").toBeLessThanOrEqual(vp.height * 0.95);
  const nodes = await page.locator('[data-testid^="tree-node-"]:not([data-testid="tree-node-card"])').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  expect(nodes.length).toBe(8);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    expect(n.x, label + " node" + i + " left").toBeGreaterThanOrEqual(wrap!.x - 2);
    expect(n.y, label + " node" + i + " top").toBeGreaterThanOrEqual(wrap!.y - 2);
    expect(n.x + n.w, label + " node" + i + " right").toBeLessThanOrEqual(wrap!.x + wrap!.width + 2);
    expect(n.y + n.h, label + " node" + i + " bottom").toBeLessThanOrEqual(wrap!.y + wrap!.height + 2);
    // узлы должны быть в видимой области (modal не обрезает дерево за фолд)
    expect(n.x + n.w / 2, label + " node" + i + " center in viewport").toBeLessThanOrEqual(vp.width);
    expect(n.y + n.h / 2, label + " node" + i + " center in viewport").toBeLessThanOrEqual(vp.height);
  }
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const over = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - window.innerWidth;
  });
  expect(over, label + " horizontal overflow").toBeLessThanOrEqual(2);
}

test.describe("Часть XII · адаптив DLC", () => {
  test.describe.configure({ retries: 1 });

  test("диалог/журнал/дерево вписываются на 4 разрешениях и zoom 80–150%", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);

    for (const vp of VIEWPORTS) {
      await startGameAt(page, vp.width, vp.height);
      // --- диалог ---
      const dialog = page.locator('[data-testid="dialogue-overlay"]');
      if (await dialog.count()) {
        await assertFits(page, "dialogue-overlay", "dialog " + vp.width);
        await expect(page.locator('[data-testid="dialogue-text"]')).toBeVisible();
        await page.screenshot({ path: shot("dlc-dialog-" + vp.width + ".png") });
      }
      // --- перф диалога: клик → следующий кадр (бюджет ≤50 мс) ---
      if (await page.locator('[data-testid="dialogue-continue"]').count()) {
        const dialogMs = await page.evaluate(async () => {
          const t0 = performance.now();
          document.querySelector<HTMLElement>('[data-testid="dialogue-continue"]')?.click();
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          return performance.now() - t0;
        });
        test.info().annotations.push({ type: "perf-dialog", description: vp.width + "×" + vp.height + ": " + dialogMs.toFixed(1) + " ms" });
        expect(dialogMs).toBeLessThan(50);
      }
      // --- журнал ---
      await openJournal(page);
      await assertFits(page, "journal-panel", "journal " + vp.width);
      await assertNoHorizontalOverflow(page, "journal " + vp.width);
      await page.screenshot({ path: shot("dlc-journal-" + vp.width + ".png") });
      // длинные EN-тексты не ломают карточки
      const cardOverflow = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="quest-card-"]'));
        return cards.map((c) => c.scrollWidth - c.clientWidth).filter((v) => v > 2);
      });
      expect(cardOverflow, "card overflow " + vp.width).toEqual([]);
      // --- дерево ---
      await domClick(page, "btn-journal-tab-tree");
      await expect(page.locator('[data-testid="quest-tree-svg"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="tree-minimap"]')).toBeVisible();
      await assertFits(page, "journal-panel", "tree " + vp.width);
      await assertTreeNodesInside(page, "tree " + vp.width);
      await page.screenshot({ path: shot("dlc-tree-" + vp.width + ".png") });
      // клик по узлу → карточка видна и не перекрывает/не уходит за фолд
      await page.locator('[data-testid^="tree-node-"]:not([data-testid="tree-node-card"])').first().click({ force: true });
      await expect(page.locator('[data-testid="tree-node-card"]')).toBeVisible({ timeout: 10_000 });
      await assertFits(page, "tree-node-card", "tree card " + vp.width);
      await page.screenshot({ path: shot("dlc-tree-card-" + vp.width + ".png") });
      const nodes = page.locator('[data-testid^="tree-node-"]:not([data-testid="tree-node-card"])');
      expect(await nodes.count()).toBe(8);
      const boxes = await nodes.evaluateAll((els) => els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(overlap, "tree nodes overlap " + vp.width + " " + i + "/" + j).toBe(false);
        }
      }
      const treeMs = await page.evaluate(async () => {
        const t0 = performance.now();
        document.querySelector<HTMLElement>('[data-testid="btn-tree-zoom-in"]')?.click();
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        return performance.now() - t0;
      });
      test.info().annotations.push({ type: "perf-tree", description: vp.width + "×" + vp.height + ": " + treeMs.toFixed(1) + " ms/frame" });
      expect(treeMs).toBeLessThan(50);
      await expect(page.locator('[data-testid="tree-minimap"]')).toBeVisible();
      // после зума часть графа может уходить за кромку — это штатный clip; проверяем, что зум применился
      await expect(page.locator(".sf-tree__bar")).toContainText("%");
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-testid="journal-panel"]')).toHaveCount(0, { timeout: 10_000 });

      // --- zoom 125%/150%: диалог заново + журнал ---
      for (const zoom of ["0.8", "1.25", "1.5"]) {
        await page.evaluate((z) => { document.documentElement.style.zoom = z; }, zoom);
        await page.waitForTimeout(250);
        await openJournal(page);
        await assertNoHorizontalOverflow(page, "zoom " + zoom + " " + vp.width);
        await assertFits(page, "journal-panel", "zoom " + zoom + " journal " + vp.width);
        await domClick(page, "btn-journal-tab-tree");
        await expect(page.locator('[data-testid="quest-tree-svg"]')).toBeVisible({ timeout: 10_000 });
        await assertTreeNodesInside(page, "zoom " + zoom + " tree " + vp.width);
        await page.keyboard.press("Escape");
        await expect(page.locator('[data-testid="journal-panel"]')).toHaveCount(0, { timeout: 10_000 });
        await page.evaluate(() => { document.documentElement.style.zoom = ""; });
      }
    }
    expectNoErrors(diag);
  });
});
