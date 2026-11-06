/**
 * DLC XIV · перф-приёмка M9d-0 (критерий 12):
 *  - открытие диалога ≤50 мс (от команды dlc_dialogue_start до появления dialogue-overlay);
 *  - раскладка дерева квестов ≤2 мс/кадр (performance.measure "dlc-tree-layout");
 *  - зум/обновление дерева: время кадра (advisory).
 * Пишет docs/shots/dlc-perf.json.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, gotoGame, isVisible } from "./helpers";

test.use({ trace: "off", video: "off" });
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
const SHOT = (n: string) => path.join(shots, n);

test("DLC перф: диалог ≤50 мс, дерево ≤2 мс", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  await gotoGame(page);
  if (await isVisible(page.locator(SEL.menu), 10_000)) {
    await page.locator('[data-testid="btn-new-game"]').evaluate((el) => (el as HTMLElement).click());
  }
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(900);

  // авто-диалог уже открыт на старте; latency измерена приложением (см. DialogueOverlay)
  await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15000 });
  const openLatency = await page.evaluate(() => {
    const list = performance.getEntriesByName("dlc-dialogue-open") as PerformanceMeasure[];
    return list.length ? [list[0]!.duration] : [];
  });
  expect(openLatency.length, "performance.measure dlc-dialogue-open").toBeGreaterThan(0);
  const maxOpen = Math.max(...openLatency);
  const avgOpen = openLatency.reduce((a, b) => a + b, 0) / openLatency.length;
  expect(maxOpen, "открытие диалога ≤50 мс: " + maxOpen.toFixed(2)).toBeLessThanOrEqual(50);

  // журнал → дерево: читаем performance.measure раскладки
  if (await isVisible(page.locator('[data-testid="dialogue-close"]'), 600)) await page.locator('[data-testid="dialogue-close"]').evaluate((el) => (el as HTMLElement).click());
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="btn-open-more"]').first().evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="full-panel-menu"]')).toBeVisible({ timeout: 8000 });
  await page.locator('[data-testid="panel-open-journal"]').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="journal-panel"]')).toBeVisible({ timeout: 8000 });
  await page.locator('[data-testid="btn-journal-tab-tree"]').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="quest-tree"]')).toBeVisible({ timeout: 8000 });
  const layoutMs = await page.evaluate(() => {
    const list = performance.getEntriesByName("dlc-tree-layout") as PerformanceMeasure[];
    return list.length ? list[list.length - 1]!.duration : -1;
  });
  expect(layoutMs, "раскладка дерева ≤2 мс").toBeGreaterThanOrEqual(0);
  expect(layoutMs, "раскладка дерева ≤2 мс: " + layoutMs.toFixed(2)).toBeLessThanOrEqual(2);

  // зум: время кадра (advisory, не критерий)
  const frameMs = await page.evaluate(async () => {
    const t0 = performance.now();
    document.querySelector<HTMLElement>('[data-testid="btn-tree-zoom-in"]')?.click();
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return performance.now() - t0;
  });
  await page.screenshot({ path: SHOT("31-dlc-perf-tree.png") });
  writeFileSync(path.join(shots, "dlc-perf.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    dialogueOpenMsSamples: openLatency.map((v) => Number(v.toFixed(2))),
    dialogueOpenMaxMs: Number(maxOpen.toFixed(2)),
    dialogueOpenAvgMs: Number(avgOpen.toFixed(2)),
    treeLayoutMs: Number(layoutMs.toFixed(3)),
    zoomFrameMs: Number(frameMs.toFixed(2)),
    budget: { dialogueOpenMs: 50, treeLayoutMs: 2 },
  }, null, 2), "utf8");
  console.log("[perf] dialogue open max=" + maxOpen.toFixed(1) + "ms avg=" + avgOpen.toFixed(1) + "ms; tree layout=" + layoutMs.toFixed(2) + "ms; zoom frame=" + frameMs.toFixed(1) + "ms");
});