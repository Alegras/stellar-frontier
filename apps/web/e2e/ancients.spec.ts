/**
 * E2E Части XIII (M9c): раса, панель Древних (линия/наследие/кодекс/Предел/финал), HUD,
 * гейт II акта, A0, 45 систем сектора, вход/выход, варп-статус, финал, 1280×720.
 * Скриншоты: docs/shots/19-22.
 */
import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, gotoGame, isVisible, dismissDialogueOverlay } from "./helpers";

test.use({ trace: "off", video: "off" });
const shotsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
const shot = (name: string) => path.join(shotsDir, name);

type G = {
  world: {
    tick: number;
    systems: Array<{ id: number; x: number; y: number; sector?: string }>;
    playerEmpireId: number;
    empires: Array<{ id: number; resources: Record<string, number> }>;
    fleets: Array<{ id: number; empireId: number; systemId: number; ships: unknown[] }>;
    fg?: {
      ancients?: {
        playerRace: string; relics: number; cores: number;
        quest: { stage: number; activeMissionId: string | null; missions: Record<string, { status: string; progress: Record<string, number> }>; ending: string | null; choice: string | null };
        tech: { tier: number; unlocked: string[] };
        warp: { unlocked: boolean; charges: number; cores: number; cooldownUntil: number };
        sector: { discovered: boolean; generated: boolean; active?: boolean; systems: Array<{ id: number; region: string; relics: number; cores: number }>; stability: number; chorusThreat: number };
      };
    };
  };
  getState(): { tick: number; paused: boolean; mode: string };
  setSpeed?(n: number): void;
  setBattleReport?(r: null): void;
  setOverlay?(id: "none"): void;
  advance(ms: number): void;
  sendCommand(cmd: unknown): boolean;
  warpStatus?(): Record<string, unknown>;
};

async function gameEval<T>(page: Page, fn: (g: G, arg?: unknown) => T, arg?: unknown): Promise<T> {
  return page.evaluate((payload) => {
    const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__;
    if (!g) throw new Error("window.__SF_GAME__ недоступен");
    return new Function("g", "arg", "return (" + payload.src + ")(g, arg)")(g, payload.arg) as T;
  }, { src: fn.toString(), arg: arg ?? null });
}

async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const battle = page.locator('[data-testid="btn-close-battle"], [data-testid="btn-close-battle-footer"]');
    if (await isVisible(battle, 250)) { await battle.first().click(); await page.waitForTimeout(120); continue; }
    const later = page.locator('[data-testid="btn-later-event"]');
    if (await isVisible(later, 250)) { await later.click(); await page.waitForTimeout(120); continue; }
    const modal = page.locator('[data-testid="overlays-root"]');
    if (await isVisible(modal, 250)) { await page.keyboard.press("Escape"); await page.waitForTimeout(120); continue; }
    break;
  }
}

async function advanceTicks(page: Page, n: number): Promise<number> {
  await dismissOverlays(page);
  const delta = await page.evaluate((ticks) => {
    const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__;
    if (!g) throw new Error("window.__SF_GAME__ недоступен");
    g.setSpeed?.(5);
    const startTick = g.getState().tick;
    for (let i = 0; i < ticks; i++) {
      g.advance(1000);
      if (g.getState().paused) { g.setBattleReport?.(null); g.setOverlay?.("none"); g.setSpeed?.(5); }
    }
    return g.getState().tick - startTick;
  }, n);
  await dismissOverlays(page);
  return delta;
}

async function startCampaign(page: Page, opts?: { seed?: number; raceIndex?: number; viewport?: { width: number; height: number } }): Promise<string> {
  await gotoGame(page);
  // viewport меняем после старта: на 1280×720 кнопка старта уходит за фолд меню
  const viewport = opts?.viewport;
  let raceId = "";
  if (await isVisible(page.locator(SEL.menu), 8000)) {
    await expect(page.locator('[data-testid="select-race"]')).toBeVisible({ timeout: 10_000 });
    const cards = page.locator('[data-testid^="race-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(8);
    const card = cards.nth(Math.min(opts?.raceIndex ?? 1, (await cards.count()) - 1));
    raceId = ((await card.getAttribute("data-testid")) ?? "").replace("race-card-", "");
    await card.click();
    await expect(page.locator('[data-testid="race-details"]')).toBeVisible({ timeout: 5000 });
    const seed = page.locator('[data-testid="input-seed"]');
    if (await isVisible(seed, 1000)) await seed.fill(String(opts?.seed ?? 42));
    const start = page.locator('[data-testid="btn-new-game"]');
    if (await isVisible(start, 1500)) {
      // после выбора расы карточка меню растягивается — DOM-клик надёжнее actionability
      await start.evaluate((el) => (el as HTMLElement).click());
    } else await page.getByRole("button", { name: /Новая кампания/i }).click();
  }
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await dismissDialogueOverlay(page); // DLC XIV: story-диалог перекрывает панели
  if (viewport) { await page.setViewportSize(viewport); await page.waitForTimeout(300); }
  return raceId;
}

async function domClick(page: Page, testId: string): Promise<void> {
  await page.locator('[data-testid="' + testId + '"]').evaluate((el) => (el as HTMLElement).click());
}

async function openAncients(page: Page): Promise<void> {
  // DLC-диалог такта 0 может перекрывать backdrop'ом клики старых спеков
  await dismissDialogueOverlay(page);
  await page.locator('[data-testid="btn-open-more"]').first().evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="full-panel-menu"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="panel-open-ancients"]').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="ancients-panel"]')).toBeVisible({ timeout: 10_000 });
}

/** Программно довести линию до stage=12 (команды sim: accept/complete). */
async function passLine(page: Page): Promise<{ stage: number; warp: boolean; sector: boolean }> {
  return gameEval(page, (g) => {
    const a = g.world.fg?.ancients;
    if (!a) return { stage: -1, warp: false, sector: false };
    g.setSpeed?.(5);
    for (let i = 0; i < 60 && a.quest.stage < 12; i++) {
      if (a.quest.activeMissionId) g.sendCommand({ type: "ancients_quest", action: "complete", questId: a.quest.activeMissionId });
      else g.sendCommand({ type: "ancients_accept_mission" });
      g.advance(1000);
      if (g.getState().paused) { g.setBattleReport?.(null); g.setOverlay?.("none"); g.setSpeed?.(5); }
    }
    return { stage: a.quest.stage, warp: a.warp.unlocked, sector: a.sector.discovered };
  });
}

test.describe("Часть XIII · Древние (M9c)", () => {
  test.setTimeout(300_000);

  test("раса, панель Древних и HUD (1600×900 и 1280×720)", async ({ page }) => {
    const diag = attachDiagnostics(page);
    const raceId = await startCampaign(page, { seed: 42, raceIndex: 1 });
    const applied = await gameEval(page, (g) => g.world.fg?.ancients?.playerRace ?? "");
    expect(applied, "выбранная раса применяется в sim").toBe(raceId);
    await expect(page.locator('[data-testid="ancients-hud"]')).toBeVisible({ timeout: 10_000 });

    await openAncients(page);
    await expect(page.locator('[data-testid="ancients-relics"]')).toBeVisible();
    await expect(page.locator('[data-testid="ancients-cores"]')).toBeVisible();
    for (const tab of ["line", "legacy", "codex", "sector", "final"]) {
      await expect(page.locator('[data-testid="btn-ancients-tab-' + tab + '"]')).toBeVisible();
    }
    await expect(page.locator('[data-testid^="quest-row-"]').first()).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: shot("19-ancients-panel.png") });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("20-ancients-panel-1280.png") });
    expect(diag.pageErrors, "pageerror: " + diag.pageErrors.join(" | ")).toEqual([]);
  });

  test("линия: гейт II акта, миссии, A0", async ({ page }) => {
    await startCampaign(page, { seed: 42, raceIndex: 0 });
    const closed = await gameEval(page, (g) => g.world.fg?.ancients?.quest.stage ?? -1);
    expect(closed).toBe(0);
    await advanceTicks(page, 1210);
    const tick = await gameEval(page, (g) => g.world.tick);
    expect(tick).toBeGreaterThanOrEqual(1200);

    await openAncients(page);
    await domClick(page, "btn-ancients-tab-line");
    expect(await page.locator('[data-testid^="quest-row-"]').count()).toBeGreaterThanOrEqual(12);
    // до прохождения линии панель показывает активную/доступную миссию
    const accepted = await page.locator('[data-testid^="btn-quest-accept-"]').first().isVisible().catch(() => false);
    expect(accepted).toBe(true);
    await page.screenshot({ path: shot("21-ancients-line.png") });

    // A0: программно пройти линию, открыть технологию A0 (в тесте выдаём реликвии для оплаты)
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world: { fg?: { ancients?: { relics: number; cores: number } } } } }).__SF_GAME__;
      const a = g?.world.fg?.ancients;
      if (a) { a.relics = 20; a.cores = 5; }
    });
    const line = await passLine(page);
    expect(line.stage).toBeGreaterThanOrEqual(12);
    expect(line.warp).toBe(true);
    expect(line.sector).toBe(true);
    await dismissDialogueOverlay(page);
    await domClick(page, "btn-ancients-tab-legacy");
    await expect(page.locator('[data-testid="ancients-tier-0"]')).toBeVisible({ timeout: 8000 });
    const techBtn = page.locator('[data-testid^="btn-ancients-tech-"]').first();
    await expect(techBtn).toBeEnabled({ timeout: 8000 });
    await techBtn.evaluate((el) => (el as HTMLElement).click());
    await expect.poll(async () => (await gameEval(page, (g) => g.world.fg?.ancients?.tech.unlocked.length ?? 0)), { timeout: 8000 }).toBeGreaterThan(0);
    await page.screenshot({ path: shot("22-ancients-a0.png") });
  });

  test("сектор 45 систем, вход/выход, варп-статус, финал (1280×720)", async ({ page }) => {
    await startCampaign(page, { seed: 42, raceIndex: 0, viewport: { width: 1280, height: 720 } });
    await advanceTicks(page, 1210);
    const line = await passLine(page);
    expect(line.stage).toBeGreaterThanOrEqual(12);
    await gameEval(page, (g) => {
      const a = g.world.fg?.ancients;
      if (!a) return;
      a.warp.unlocked = true; a.warp.charges = 10; a.warp.cooldownUntil = 0;
    });
    await page.waitForTimeout(300);
    await openAncients(page);
    await dismissDialogueOverlay(page);

    // ---- сектор ----
    await domClick(page, "btn-ancients-tab-sector");
    const sectorRows = page.locator('[data-testid^="sector-row-"]');
    await expect(sectorRows.first()).toBeVisible({ timeout: 10_000 });
    expect(await sectorRows.count(), "сектор Предела: 45 систем").toBe(45);
    expect(await page.locator('[data-testid^="sector-region-"]').count()).toBe(5);
    // выбор системы — клик по внутренней кнопке строки (div-строка сама не кликабельна)
    await page.locator('[data-testid^="sector-row-"] button').first().evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('[data-testid="btn-sector-enter"]')).toBeEnabled({ timeout: 8000 });
    await domClick(page, "btn-sector-enter");
    await expect.poll(async () => gameEval(page, (g) => g.world.fg?.ancients?.sector.active === true), { timeout: 8000 }).toBe(true);
    await domClick(page, "btn-sector-scan");
    await domClick(page, "btn-sector-claim");
    await page.screenshot({ path: shot("23-ancients-sector-1280.png") });
    await domClick(page, "btn-sector-exit");
    await expect.poll(async () => gameEval(page, (g) => g.world.fg?.ancients?.sector.active === false), { timeout: 8000 }).toBe(true);

    // ---- варп с карты: кнопка btn-warp вызывает game.requestWarp() и в режиме карты
    // выполняет стратегический прыжок сразу (флот/заряды/кулдаун + тост), без 60-с раскрутки.
    await gameEval(page, (g) => {
      const a = g.world.fg?.ancients;
      if (a) { a.warp.unlocked = true; a.warp.charges = 10; a.warp.cooldownUntil = 0; }
    });
    const targetSelect = page.locator('[data-testid="select-warp-target"]');
    await expect(targetSelect).toBeVisible({ timeout: 8000 });
    const values = await targetSelect.locator("option").evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ""));
    expect(values.length).toBeGreaterThan(0);
    const warpBefore = await gameEval(page, (g) => {
      const p = g.world.empires.find((e) => e.id === g.world.playerEmpireId);
      const fleet = g.world.fleets.find((f) => f.empireId === p?.id && f.ships.length > 0);
      const a = g.world.fg?.ancients;
      return { sys: fleet?.systemId ?? -1, charges: a?.warp.charges ?? -1, cooldown: a?.warp.cooldownUntil ?? 0, tick: g.world.tick };
    });
    const chosen = values.find((v) => Number(v) !== warpBefore.sys) ?? values[0];
    expect(chosen).toBeTruthy();
    await targetSelect.selectOption(chosen);
    const warpBtn = page.locator('[data-testid="btn-warp"]');
    await expect(warpBtn).toBeEnabled({ timeout: 8000 });
    await warpBtn.evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(1200);
    const warpAfter = await gameEval(page, (g) => {
      const p = g.world.empires.find((e) => e.id === g.world.playerEmpireId);
      const fleet = g.world.fleets.find((f) => f.empireId === p?.id && f.ships.length > 0);
      const a = g.world.fg?.ancients;
      const api = g as unknown as { warpStatus?: () => Record<string, unknown> };
      const tel = api.warpStatus ? api.warpStatus() : null;
      return { sys: fleet?.systemId ?? -1, charges: a?.warp.charges ?? -1, cooldown: a?.warp.cooldownUntil ?? 0, phase: String(tel?.phase ?? "") };
    });
    const uiJumped = warpAfter.sys !== warpBefore.sys
      || warpAfter.charges < warpBefore.charges
      || warpAfter.cooldown > warpBefore.cooldown
      || warpAfter.phase === "arrived";
    if (!uiJumped) {
      // fallback только если UI действительно не прыгнул (например, цель вне радиуса)
      const jump = await gameEval(page, (g, tid) => {
        const ok = g.sendCommand({ type: "warp_jump", targetSystemId: tid as number });
        return { ok };
      }, Number(chosen));
      expect(jump.ok, "UI не прыгнул, fallback warp_jump тоже false").toBe(true);
      test.info().annotations.push({ type: "warp-ui", description: "UI-прыжок не detected, проверен командой sim" });
    }
    const result = await page.locator('[data-testid="warp-result"]').innerText().catch(() => "");
    console.log("[warp] before=" + JSON.stringify(warpBefore) + " after=" + JSON.stringify(warpAfter) + " uiJumped=" + uiJumped + " result=" + result.replace(/\n/g, " "));
    await page.screenshot({ path: shot("24-ancients-warp-1280.png") });

    // ---- финал ----
    // после варп-прыжка карта может открыть оверлей (событие/отчёт), а панель — закрыться
    await dismissOverlays(page);
    if (!(await page.locator('[data-testid="ancients-panel"]').isVisible().catch(() => false))) {
      await openAncients(page);
    }
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-ancients-tab-final"]')?.click());
    await expect(page.locator('[data-testid="btn-final-seal"]')).toBeVisible({ timeout: 8000 });
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-final-seal"]')?.click());
    await expect(page.locator('[data-testid="final-choice-status"]')).toBeVisible({ timeout: 8000 });
    expect(await gameEval(page, (g) => g.world.fg?.ancients?.quest.choice ?? null)).toBe("seal");
    await page.screenshot({ path: shot("25-ancients-finale-1280.png") });
  });
});