import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, dismissAllOverlays, expectNoErrors, gotoGame } from "./helpers";

/** task-43: AI-ИИ линии на политической карте + слой Предела только после открытия/туман. */
const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (n: string): string => SHOTS + n;
const domClick = async (page: Page, testId: string): Promise<void> => {
  await page.evaluate((id) => document.querySelector<HTMLElement>('[data-testid="' + id + '"]')?.click(), testId);
};

test.describe("Карта · мировая политика и Предел", () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(120_000);

  test("линии ИИ-ИИ, статусы/фильтры, Предел скрыт до открытия и туман после", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (n?: number) => void } }).__SF_GAME__!;
      if (!g.hasWorld) g.newGame(42);
    });
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
    await dismissAllOverlays(page);

    // до открытия сектора кнопки слоя Предела нет
    await expect(page.locator('[data-testid="map-layer-sector"]')).toHaveCount(0);

    // детерминированно создаём отношения ИИ-ИИ: союз + торговля
    const injected = await page.evaluate(() => {
      const g = (window as unknown as {
        __SF_GAME__?: {
          world: { empires: Array<{ id: number; dead?: boolean }>; fg: { relations?: Record<string, unknown> } };
          toast?: (t: string) => void;
        };
      }).__SF_GAME__!;
      const ids = g.world.empires.filter((e) => e.id !== 0 && !e.dead).map((e) => e.id);
      if (ids.length < 3 || !g.world.fg.relations) return false;
      const state = (on: boolean) => ({ active: on, sinceTick: 0, expiresTick: 99999 });
      const mk = (alliance: boolean, trade: boolean) => ({
        opinion: 20, attitude: "neutral",
        treaties: {
          nap: state(false), trade: state(trade), research: state(false), defensive: state(false),
          alliance: state(alliance), federation: state(false), vassal: state(false), tribute: state(false),
        },
        recentActions: 0, borderSystems: 0, callToArms: false, breakdown: [],
      });
      const a = ids[0], b = ids[1], c = ids[2];
      const key = (x: number, y: number) => (x < y ? x + ":" + y : y + ":" + x);
      g.world.fg.relations[key(a, b)] = mk(true, false);
      g.world.fg.relations[key(b, c)] = mk(false, true);
      g.toast?.("politics map setup");
      return true;
    });
    expect(injected).toBe(true);
    await page.waitForTimeout(600);
    expect(await page.locator('[data-testid^="map-pol-capital-"]').count()).toBeGreaterThan(1);
    await expect(page.locator('[data-testid="map-pol-legend"]')).toBeVisible();
    const lines = await page.locator('[data-testid^="map-pol-line-"]').count();
    expect(lines).toBeGreaterThan(0);
    // чистим setup-уведомления и возможные модалки, чтобы скрин карты был чистым
    await page.evaluate(() => {
      const g = (window as unknown as {
        __SF_GAME__?: { getState: () => { notices: Array<{ id: number }> }; dismissNotice: (id: number) => void };
      }).__SF_GAME__;
      const st = g?.getState();
      if (g && st) for (const n of st.notices) g.dismissNotice(n.id);
    });
    await dismissAllOverlays(page);
    await page.evaluate(() => {
      const g = (window as unknown as {
        __SF_GAME__?: { getState: () => { paused: boolean; notices: Array<{ id: number }> }; togglePause: () => void; dismissNotice: (id: number) => void };
      }).__SF_GAME__;
      if (!g) return;
      if (!g.getState().paused) g.togglePause();
      for (const n of g.getState().notices) g.dismissNotice(n.id);
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: shot("politics-map-1280.png") });

    // фильтр: выключаем союзы — зелёная линия исчезает
    const allianceLines = page.locator(".sf-map-pol-line--alliance");
    const before = await allianceLines.count();
    expect(before).toBeGreaterThan(0);
    await domClick(page, "map-pol-filter-alliance");
    await page.waitForTimeout(300);
    expect(await page.locator(".sf-map-pol-line--alliance").count()).toBeLessThan(before);
    await domClick(page, "map-pol-filter-alliance");

    // клик по легенде (и двойной клик по столице) → панель мировой политики
    await page.locator('[data-testid^="map-pol-capital-"]').first().dblclick().catch(() => undefined);
    await domClick(page, "map-pol-open-panel");
    await expect(page.locator('[data-testid="politics-panel"]')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="politics-panel"]')).toHaveCount(0, { timeout: 10_000 });

    // открываем сектор (как revealSector после миссии 10): кнопка/слой появляются, системы под туманом
    await page.evaluate(() => {
      const g = (window as unknown as {
        __SF_GAME__?: {
          world: { fg: { ancients?: { sector: Record<string, unknown> } }; tick: number };
          toast?: (t: string) => void;
        };
      }).__SF_GAME__!;
      const a = g.world.fg.ancients;
      if (!a) return;
      const sys = (id: number, visited: boolean) => ({
        id, name: "Предел-" + id, x: id * 10, y: id * 7, region: "ruins", faction: "wardens",
        poi: [], hazard: null, visited, controlled: false, relics: visited ? 2 : 0, cores: visited ? 1 : 0,
      });
      a.sector.discovered = true;
      a.sector.generated = true;
      a.sector.systems = [sys(1, true), sys(2, false), sys(3, false), sys(4, false), sys(5, true)];
      a.sector.stability = 50;
      a.sector.chorusThreat = 10;
      a.sector.nextWaveTick = g.world.tick + 100;
      g.toast?.("sector setup");
    });
    await expect(page.locator('[data-testid="map-layer-sector"]')).toBeVisible({ timeout: 10_000 });
    await domClick(page, "map-layer-sector");
    await expect(page.locator('[data-testid="sector-map"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('[data-testid^="sector-label-"]').count()).toBe(5);
    expect(await page.locator('[data-testid^="sector-label-"][data-fog="true"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid^="sector-label-"][data-fog="false"]').count()).toBeGreaterThan(0);
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { getState: () => { paused: boolean; notices: Array<{ id: number }> }; togglePause: () => void; dismissNotice: (id: number) => void } }).__SF_GAME__;
      if (!g) return;
      if (!g.getState().paused) g.togglePause();
      for (const n of g.getState().notices) g.dismissNotice(n.id);
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: shot("politics-sector-map-1280.png") });

    expectNoErrors(diag);
  });
});
