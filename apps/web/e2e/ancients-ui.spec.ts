import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, dismissDialogueOverlay, expectNoErrors, gotoGame } from "./helpers";

/**
 * Часть XIII UI (task-28): выбор расы, панель Древних (линия/наследие/кодекс/Предел/финал),
 * HUD наследия, слой карты Предела, запрет варпа без ядра.
 * Файл отдельный от QA-спеки ancients.spec.ts, чтобы не конфликтовать по e2e-зоне.
 */
const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (name: string): string => SHOTS + name;

async function openAncients(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="btn-open-more"]').first().click();
  await expect(page.locator('[data-testid="full-panel-menu"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="panel-open-ancients"]').click();
  await expect(page.locator('[data-testid="ancients-panel"]')).toBeVisible({ timeout: 10_000 });
}

test.describe("Часть XIII · Древние (UI)", () => {
  test.describe.configure({ retries: 1 });

  test("раса → панель → A0 → варп без ядра → слой Предела", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await expect(page.locator('[data-testid="main-menu"]')).toBeVisible({ timeout: 20_000 });

    // ---- выбор расы ----
    await expect(page.locator('[data-testid="select-race"]')).toBeVisible({ timeout: 10_000 });
    const cards = page.locator('[data-testid^="race-card-"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(8);
    const second = cards.nth(1);
    const tid = (await second.getAttribute("data-testid")) ?? "";
    const raceId = tid.replace("race-card-", "");
    await second.click();
    await expect(page.locator('[data-testid="race-details"]')).toBeVisible();
    await page.screenshot({ path: shot("ancients-race.png") });
    await page.locator('[data-testid="btn-new-game"]').click();
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
    await dismissDialogueOverlay(page);
    await expect.poll(async () => page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world?: { fg?: { ancients?: { playerRace?: string } } } } }).__SF_GAME__;
      return g?.world?.fg?.ancients?.playerRace ?? "";
    }), { timeout: 10_000 }).toBe(raceId);
    await expect(page.locator('[data-testid="ancients-hud"]')).toBeVisible({ timeout: 10_000 });

    // ---- панель ----
    await openAncients(page);
    await page.screenshot({ path: shot("ancients-line.png") });
    for (const id of ["line", "legacy", "codex", "sector", "final"]) {
      await expect(page.locator('[data-testid="btn-ancients-tab-' + id + '"]')).toBeVisible();
    }
    expect(await page.locator('[data-testid^="quest-row-"]').count()).toBeGreaterThanOrEqual(12);

    // ---- A0/A1: реликвии, исследование ----
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world?: { fg?: { ancients?: Record<string, unknown> } }; toast?: (t: string) => void } }).__SF_GAME__;
      const a = g?.world?.fg?.ancients as { relics?: number; cores?: number; quest?: { stage?: number }; tech?: { unlocked?: string[]; tier?: number } } | undefined;
      if (a) { a.relics = 999; a.cores = 99; if (a.quest) a.quest.stage = 5; if (a.tech) { a.tech.unlocked = []; a.tech.tier = -1; } }
      g?.toast?.("setup");
    });
    await page.locator('[data-testid="btn-ancients-tab-legacy"]').click();
    await page.waitForTimeout(300);
    const techBtns = page.locator('[data-testid^="btn-ancients-tech-"]:not([disabled])');
    expect(await techBtns.count()).toBeGreaterThan(0);
    await techBtns.first().click();
    await expect.poll(async () => page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world?: { fg?: { ancients?: { tech?: { unlocked?: string[] } } } } } }).__SF_GAME__;
      return g?.world?.fg?.ancients?.tech?.unlocked?.length ?? 0;
    }), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: shot("ancients-tech.png") });

    // ---- кодекс ----
    await page.locator('[data-testid="btn-ancients-tab-codex"]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid^="codex-entry-"]').count()).toBeGreaterThanOrEqual(40);
    await page.screenshot({ path: shot("ancients-codex.png") });

    // ---- варп без ядра ----
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world?: { fg?: { ancients?: { warp?: Record<string, unknown> } } }; toast?: (t: string) => void } }).__SF_GAME__;
      const w = g?.world?.fg?.ancients?.warp as Record<string, unknown> | undefined;
      if (w) { w.unlocked = true; w.charges = 0; w.cores = 0; w.cooldownUntil = 0; }
      g?.toast?.("setup");
    });
    await page.locator('[data-testid="btn-ancients-tab-sector"]').click();
    await page.waitForTimeout(300);
    const sel = page.locator('[data-testid="select-warp-target"]');
    let opt = "";
    if (await sel.count()) {
      opt = await sel.evaluate((el) => {
        for (const o of Array.from((el as HTMLSelectElement).options)) if (o.value) return o.value;
        return "";
      });
      if (opt) await sel.selectOption(opt);
      await page.locator('[data-testid="btn-warp"]').click();
      await expect(page.locator('[data-testid="warp-reason"]')).toBeVisible({ timeout: 10_000 });
      expect(await page.locator('[data-testid="warp-reason"]').innerText()).toMatch(/заряд|ядр|charge|core/i);
    }
    // Успешный варп с карты: заряды/кулдаун меняются, есть сообщение о результате.
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world?: { fg?: { ancients?: { warp?: Record<string, unknown> } } }; toast?: (t: string) => void } }).__SF_GAME__;
      const w = g?.world?.fg?.ancients?.warp as Record<string, unknown> | undefined;
      if (w) { w.unlocked = true; w.charges = 10; w.cores = 1; w.cooldownUntil = 0; }
      g?.toast?.("setup");
    });
    await page.waitForTimeout(300);
    if (opt && (await sel.count())) {
      await sel.selectOption(opt);
      const before = await page.evaluate(() => {
        const g = (window as unknown as { __SF_GAME__?: { world?: { tick?: number; fg?: { ancients?: { warp?: { charges?: number; cooldownUntil?: number } } } } } }).__SF_GAME__;
        return { charges: g?.world?.fg?.ancients?.warp?.charges ?? 0, cooldown: g?.world?.fg?.ancients?.warp?.cooldownUntil ?? 0, tick: g?.world?.tick ?? 0 };
      });
      await page.locator('[data-testid="btn-warp"]').click();
      await expect(page.locator('[data-testid="warp-result"]')).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => page.evaluate((prev) => {
        const g = (window as unknown as { __SF_GAME__?: { world?: { tick?: number; fg?: { ancients?: { warp?: { charges?: number; cooldownUntil?: number } } } } } }).__SF_GAME__;
        const w = g?.world?.fg?.ancients?.warp;
        const tick = g?.world?.tick ?? 0;
        if (!w) return false;
        return (w.charges ?? 0) < prev.charges || (w.cooldownUntil ?? 0) > Math.max(prev.cooldown, tick);
      }, before), { timeout: 10_000 }).toBe(true);
      await page.screenshot({ path: shot("ancients-warp.png") });
    }

    // ---- слой Предела ----
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world?: { fg?: { ancients?: { sector?: Record<string, unknown> } } }; toast?: (t: string) => void } }).__SF_GAME__;
      const sec = g?.world?.fg?.ancients?.sector as Record<string, unknown> | undefined;
      if (sec) {
        sec.discovered = true; sec.generated = true; sec.stability = 64; sec.chorusThreat = 22; sec.nextWaveTick = 200;
        sec.systems = [
          { id: 9001, name: "Предел-А", x: 0, y: 0, region: "ruins", faction: "neutral", poi: [], hazard: null, visited: true, controlled: false, relics: 3, cores: 1 },
          { id: 9002, name: "Предел-Б", x: 100, y: 60, region: "ruins", faction: "neutral", poi: [], hazard: null, visited: false, controlled: false, relics: 1, cores: 2 },
        ];
      }
      g?.toast?.("setup");
    });
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="ancients-panel"]')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(200);
    // DOM-клик устойчив к возможным overlay-подсказкам поверх карты
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="map-layer-sector"]')?.click());
    await expect(page.locator('[data-testid="sector-map"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('[data-testid^="sector-label-"]').count()).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: shot("ancients-sector-map.png") });
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="sector-label-9001"]')?.click());
    await expect(page.locator('[data-testid="sector-map-info"]')).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="map-layer-political"]')?.click());

    expectNoErrors(diag);
  });
});
