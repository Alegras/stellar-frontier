import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, expectNoErrors, gotoGame } from "./helpers";

/**
 * DLC XIV «Первый Свет» (task-33): story-диалог → выбор → квест → журнал/дерево,
 * доска на станции, слухи, сигнал на карте, feature-flag off.
 */
const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (name: string): string => SHOTS + name;

async function startGame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (s?: number) => void } }).__SF_GAME__;
    if (g && !g.hasWorld) g.newGame(12345);
  });
  await expect.poll(() => page.locator('[data-testid="top-bar"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  // один тик: dlcPhase/автостарт story-линии
  await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__?: { advance: (n: number) => void } }).__SF_GAME__;
    g?.advance(1);
  });
  await page.waitForTimeout(900);
}

const domClick = async (page: Page, testId: string): Promise<void> => {
  await page.evaluate((id) => document.querySelector<HTMLElement>('[data-testid="' + id + '"]')?.click(), testId);
};

async function openJournal(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.locator('[data-testid="panel-open-journal"]').count()) break;
    await domClick(page, "btn-open-more");
    await page.waitForTimeout(350);
  }
  await expect(page.locator('[data-testid="panel-open-journal"]')).toBeVisible({ timeout: 10_000 });
  await domClick(page, "panel-open-journal");
  await expect(page.locator('[data-testid="journal-panel"]')).toBeVisible({ timeout: 10_000 });
}

test.describe("DLC XIV · Первый Свет", () => {
  test.describe.configure({ retries: 1 });

  test("story-диалог → выбор → журнал/дерево → доска/слух/сигнал", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await startGame(page);

    // 1) авто-open story-диалога
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="dialogue-speaker"]')).toBeVisible();
    await expect(page.locator('[data-testid="dialogue-text"]')).not.toHaveText("");
    // эмоция показывается для character-спикеров; у рассказчика (СВЕТ) — радио-портрет без эмоции
    if (await page.locator('[data-testid="dialogue-emotion"]').count()) {
      expect((await page.locator('[data-testid="dialogue-emotion"]').innerText()).length).toBeGreaterThan(0);
    }
    await expect(page.locator('[data-testid="dialogue-portrait"]')).toBeVisible();
    const img = page.locator('[data-testid="dialogue-portrait"] img');
    if (await img.count()) {
      const state = await img.evaluate((el) => ({ natural: (el as HTMLImageElement).naturalWidth, display: getComputedStyle(el).display }));
      // арт грузится через /dlc/...; при отсутствии файла — onError прячет img и остаётся глиф
      expect(state.natural > 0 || state.display === "none").toBe(true);
    }
    await page.screenshot({ path: shot("dlc-dialogue.png") });

    // 2) до выбора: Продолжить / вариант с флагом
    for (let i = 0; i < 8; i++) {
      if (await page.locator('[data-testid^="dialogue-choice-"]').count()) break;
      if (!(await page.locator('[data-testid="dialogue-continue"]').count())) break;
      await domClick(page, "dialogue-continue");
      await page.waitForTimeout(250);
    }
    expect(await page.locator('[data-testid^="dialogue-choice-"]').count()).toBeGreaterThan(0);
    await page.screenshot({ path: shot("dlc-dialogue-choice.png") });
    if (await page.locator('[data-testid="dialogue-choice-going_now"]').count()) await domClick(page, "dialogue-choice-going_now");
    else await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid^="dialogue-choice-"]')?.click());
    await page.waitForTimeout(400);
    // диалог закрывается после цепочки; закрываем оверлей, если ещё открыт
    for (let i = 0; i < 16; i++) {
      if (!(await page.locator('[data-testid="dialogue-overlay"]').count())) break;
      if (await page.locator('[data-testid="dialogue-continue"]').count()) await domClick(page, "dialogue-continue");
      else if (await page.locator('[data-testid^="dialogue-choice-"]').count()) {
        await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid^="dialogue-choice-"]')?.click());
      } else if (await page.locator('[data-testid="dialogue-close"]').count()) await domClick(page, "dialogue-close");
      await page.waitForTimeout(220);
    }

    // 3) журнал: активный квест и дерево 8/10
    await openJournal(page);
    const cards = page.locator('[data-testid^="quest-card-"]');
    expect(await cards.count()).toBeGreaterThan(0);
    await page.screenshot({ path: shot("dlc-journal.png") });
    await page.locator('[data-testid="btn-journal-tab-tree"]').click();
    await expect(page.locator('[data-testid="quest-tree-svg"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('[data-testid^="tree-node-"]').count()).toBe(8);
    expect(await page.locator('[data-testid^="tree-edge-"]').count()).toBe(10);
    expect(await page.locator('[data-testid="tree-list-fallback"] li').count()).toBe(8);
    await page.locator('[data-testid^="tree-list-fallback-node-"]').first().evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('[data-testid="tree-node-card"]')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: shot("dlc-tree.png") });
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="journal-panel"]')).toHaveCount(0, { timeout: 10_000 });

    // 4) станция: вкладка «Доска» + слухи
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await domClick(page, "btn-dock");
    await expect(page.locator('[data-testid="station-screen"]')).toBeVisible({ timeout: 10_000 });
    await domClick(page, "tab-board");
    await expect(page.locator('[data-testid="board-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="channel-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="channel-rumor"]')).toBeVisible();
    await expect(page.locator('[data-testid="channel-signal"]')).toBeVisible();
    await page.screenshot({ path: shot("dlc-board.png") });

    // 5) сигнал на карте + маркер HUD
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world?: { fg?: { dlc?: Record<string, unknown> } }; toast?: (t: string) => void } }).__SF_GAME__;
      const d = g?.world?.fg?.dlc as { signals?: unknown[]; enabled?: boolean } | undefined;
      if (d) {
        d.enabled = true;
        d.signals = [{ id: "signal:test", questId: "q_pro_02_quiet_dock", systemId: 0, revealed: false, expiresTick: 9999 }];
      }
      g?.toast?.("setup");
    });
    await domClick(page, "btn-undock");
    await page.waitForTimeout(600);
    await expect(page.locator('[data-testid="dlc-signal-hud"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="quest-marker-signal:test"]')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: shot("dlc-signal.png") });

    expectNoErrors(diag);
  });

  test("feature-flag off: нет диалога/журнала", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("sf.dlc", "0"); } catch { /* noop */ } });
    await gotoGame(page);
    await startGame(page);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toHaveCount(0);
    await openJournal(page);
    await expect(page.locator('[data-testid="journal-disabled"]')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: shot("dlc-flag-off.png") });
  });
});