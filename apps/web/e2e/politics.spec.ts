import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, expectNoErrors, gotoGame } from "./helpers";

/** task-43: «Мировая политика» — матрица, лента, фракции, влияние, события, HUD, 1280×720. */
const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (n: string): string => SHOTS + n;

type G = {
  world: {
    tick: number;
    playerEmpireId: number;
    fg?: {
      aiNews?: unknown[];
      aiWorldEvents?: unknown[];
      relations?: Record<string, { callToArms?: boolean }>;
    };
  };
  getState(): { tick: number; paused: boolean };
  refresh?(s?: unknown): void;
  toast?(t: string): void;
};

const domClick = async (page: Page, testId: string): Promise<void> => {
  await page.evaluate((id) => document.querySelector<HTMLElement>('[data-testid="' + id + '"]')?.click(), testId);
};

async function startGame(page: Page): Promise<void> {
  await gotoGame(page);
  await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (n?: number) => void } }).__SF_GAME__!;
    if (!g.hasWorld) g.newGame(42);
  });
  await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
}

async function inject(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__?: G & { toast?: (t: string) => void } }).__SF_GAME__!;
    const fg = (g.world.fg ??= {});
    fg.aiNews = [
      { id: "n-war", tick: 12, kind: "war", actorEmpireId: 1, targetEmpireId: 2, actorName: "Империя А", targetName: "Империя Б", textRu: "объявила войну", severity: "bad", playerImpact: "threat" },
      { id: "n-treaty", tick: 11, kind: "treaty", actorEmpireId: 2, targetEmpireId: 3, actorName: "Империя Б", targetName: "Империя В", textRu: "заключили торговый договор", severity: "info" },
      { id: "n-fed", tick: 10, kind: "federation", actorEmpireId: 3, targetEmpireId: 1, actorName: "Империя В", targetName: "Империя А", textRu: "создали федерацию", severity: "good", playerImpact: "bloc" },
      { id: "n-annex", tick: 9, kind: "annexation", actorEmpireId: 1, targetEmpireId: 4, actorName: "Империя А", targetName: "Империя Г", textRu: "поглотила соседа", severity: "warn" },
    ];
    fg.aiWorldEvents = [
      { id: "ev-call", kind: "call_to_arms", tick: 12, fromEmpireId: 2, titleRu: "Призыв к обороне", textRu: "Союзник призывает вас вступить в войну.", choices: [{ id: "join", labelRu: "Вступить в войну", effectsRu: ["война с Империей А"] }, { id: "decline", labelRu: "Отказаться", effectsRu: ["−10 отношения"] }] },
      { id: "ev-absorb", kind: "annexation_demand", tick: 12, fromEmpireId: 3, titleRu: "Требование поглощения", textRu: "Вас принуждают войти в состав объединения.", choices: [{ id: "accept", labelRu: "Принять" }, { id: "refuse", labelRu: "Отказаться" }] },
    ];
    g.toast?.("politics setup");
  });
}

async function openPanel(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) {
    if (await page.locator('[data-testid="panel-open-politics"]').count()) break;
    await domClick(page, "btn-open-more");
    await page.waitForTimeout(300);
  }
  await expect(page.locator('[data-testid="panel-open-politics"]')).toBeVisible({ timeout: 10_000 });
  await domClick(page, "panel-open-politics");
  await expect(page.locator('[data-testid="politics-panel"]')).toBeVisible({ timeout: 10_000 });
}

test.describe("Мировая политика · task-43", () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(180_000);

  test("панель/матрица/лента/событие/журнал/HUD на 1280×720", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await startGame(page);
    await inject(page);

    // приоритет диалога: событие ИИ не открывается поверх
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-world-event"]')).toHaveCount(0);

    // закрываем ТОЛЬКО диалог/narrative (AI-событие должно остаться и открыться)
    for (let i = 0; i < 6; i++) {
      if (await page.locator('[data-testid="dialogue-overlay"]').count()) {
        await domClick(page, "dialogue-close");
        await page.waitForTimeout(250);
        continue;
      }
      if (await page.locator('[data-testid="narrative-event"]').count()) {
        await domClick(page, "btn-later-event");
        await page.waitForTimeout(250);
        continue;
      }
      break;
    }
    await expect(page.locator('[data-testid="ai-world-event"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="ai-world-event"]')).toHaveCount(1);
    await page.screenshot({ path: shot("politics-event-1280.png") });
    // очередь событий: откладываем все, чтобы модалка не висела
    for (let i = 0; i < 4 && (await page.locator('[data-testid="ai-world-event"]').count()); i++) {
      await domClick(page, "btn-later-ai-event");
      await page.waitForTimeout(250);
    }
    await expect(page.locator('[data-testid="ai-world-event"]')).toHaveCount(0);

    // HUD-индикаторы
    await expect(page.locator('[data-testid="ai-world-hud"]')).toBeVisible();
    await expect(page.locator('[data-testid="world-war-hud"]')).toBeVisible();
    await expect(page.locator('[data-testid="world-bloc-hud"]')).toBeVisible();

    await openPanel(page);
    await expect(page.locator('[data-testid="politics-wars"]')).toBeVisible();
    await page.screenshot({ path: shot("politics-overview-1280.png") });
    const empireRows = await page.locator('[data-testid^="politics-empire-row-"]').count();
    expect(empireRows).toBeGreaterThan(1);
    expect(await page.locator('[data-testid^="empire-link-"]').count()).toBeGreaterThan(1);
    expect(await page.locator('[data-testid^="faction-status-"]').count()).toBeGreaterThan(1);
    await expect(page.locator('[data-testid="politics-player-allies"]')).toBeVisible();
    await expect(page.locator('[data-testid="politics-player-threats"]')).toBeVisible();

    // матрица
    await domClick(page, "btn-politics-tab-matrix");
    await expect(page.locator('[data-testid="politics-matrix"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('[data-testid^="politics-relation-"]').count()).toBeGreaterThan(1);
    await page.screenshot({ path: shot("politics-matrix-1280.png") });

    // лента + фильтры
    await domClick(page, "btn-politics-tab-news");
    await expect(page.locator('[data-testid="ai-news-feed"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="ai-news-item-n-war"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-news-item-n-treaty"]')).toBeVisible();
    await domClick(page, "ai-news-filter-war");
    await expect(page.locator('[data-testid="ai-news-item-n-war"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-news-item-n-treaty"]')).toHaveCount(0);
    await domClick(page, "ai-news-filter-all");
    await page.screenshot({ path: shot("politics-news-1280.png") });

    // события в панели
    await domClick(page, "btn-politics-tab-events");
    await expect(page.locator('[data-testid^="event-call_to_arms-"]').first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: shot("politics-events-1280.png") });

    // журнал
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="politics-panel"]')).toHaveCount(0, { timeout: 10_000 });
    for (let i = 0; i < 3; i++) {
      if (await page.locator('[data-testid="panel-open-journal"]').count()) break;
      await domClick(page, "btn-open-more");
      await page.waitForTimeout(300);
    }
    await domClick(page, "panel-open-journal");
    await expect(page.locator('[data-testid="journal-panel"]')).toBeVisible({ timeout: 10_000 });
    await domClick(page, "btn-journal-tab-chronicle");
    await expect(page.locator('[data-testid="journal-ai-news"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('[data-testid^="ai-news-journal-"]').count()).toBeGreaterThan(0);

    expectNoErrors(diag);
  });
});
