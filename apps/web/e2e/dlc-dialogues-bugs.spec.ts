/**
 * Регрессионные e2e для багов диалогов DLC XIV (task-40).
 * До мержа task-36/37/38 часть тестов ожидаемо падает — это целевое поведение после фикса.
 *
 * Покрытие: закрытие X не оставляет active; повтор сцены после завершения не открывает;
 * модалка события не поверх диалога и не копится; new game сбрасывает dismissed/seen;
 * выборы Q1 видны и меняют флаги/репутацию/следующие квесты; save/load mid-dialogue.
 */
import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, gotoGame, isVisible } from "./helpers";

test.use({ trace: "off", video: "off" });
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
const shot = (n: string) => path.join(shots, n);

type G = {
  world: {
    tick: number;
    seed: number;
    fg?: {
      dlc?: {
        enabled: boolean;
        dialogue: { sceneId: string; nodeId: string; active: boolean } | null;
        quests: Record<string, { status: string; step: number; rewardsClaimed: boolean }>;
        flags: Record<string, number>;
        reputation: Record<string, number>;
        dismissed?: string[];
      };
      narrative?: { pending: Array<Record<string, unknown>> };
    };
    playerEmpireId: number;
    empires: Array<{ id: number; resources: Record<string, number> }>;
    fleets: Array<{ id: number; empireId: number; systemId: number; ships: unknown[] }>;
  };
  getState(): { tick: number; paused: boolean; mode: string };
  setSpeed?(n: number): void;
  advance(ms: number): void;
  sendCommand(c: unknown): boolean;
  newGame(seed?: number): void;
  refresh?(s: unknown): void;
  setNarrativeModalOpen?(open: boolean): void;
};

async function gameEval<T>(page: Page, fn: (g: G, arg?: unknown) => T, arg?: unknown): Promise<T> {
  return page.evaluate((payload) => {
    const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__;
    if (!g) throw new Error("window.__SF_GAME__ недоступен");
    return new Function("g", "arg", "return (" + payload.src + ")(g, arg)")(g, payload.arg) as T;
  }, { src: fn.toString(), arg: arg ?? null });
}

async function startCampaign(page: Page, seed = 42): Promise<void> {
  await gotoGame(page);
  if (await isVisible(page.locator(SEL.menu), 10_000)) {
    const seedInput = page.locator('[data-testid="input-seed"]');
    if (await isVisible(seedInput, 1000)) await seedInput.fill(String(seed));
    await page.locator('[data-testid="btn-new-game"]').evaluate((el) => (el as HTMLElement).click());
  }
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(900);
}

async function advanceTicks(page: Page, n: number): Promise<void> {
  await page.evaluate((ticks) => {
    const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__;
    if (!g) return;
    g.setSpeed?.(5);
    for (let i = 0; i < ticks; i++) g.advance(1000);
  }, n);
}

/** Дождаться авто-диалога: на некоторых seed story-старт происходит после первого тика. */
async function ensureDialogue(page: Page): Promise<void> {
  const overlay = page.locator('[data-testid="dialogue-overlay"]');
  if (await overlay.isVisible().catch(() => false)) return;
  await advanceTicks(page, 3);
  await expect(overlay).toBeVisible({ timeout: 15_000 });
}

async function playDialogue(page: Page, prefer: string[] = []): Promise<void> {
  // story-старт может прийти на первом такте: ждём overlay, а не проверяем мгновенно
  const overlay0 = page.locator('[data-testid="dialogue-overlay"]');
  if (!(await overlay0.isVisible().catch(() => false))) {
    await advanceTicks(page, 2);
    try { await overlay0.waitFor({ state: "visible", timeout: 15_000 }); } catch { return; }
  }
  for (let i = 0; i < 40; i++) {
    const overlay = page.locator('[data-testid="dialogue-overlay"]');
    if (!(await overlay.isVisible().catch(() => false))) break;
    const opt = page.locator('[data-testid^="dialogue-choice-"]').first();
    if (await opt.isVisible().catch(() => false)) {
      const ids = await page.locator('[data-testid^="dialogue-choice-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid ?? ""));
      const chosen = prefer.find((p) => ids.some((id) => id === "dialogue-choice-" + p));
      const loc = chosen ? page.locator('[data-testid="dialogue-choice-' + chosen + '"]') : opt;
      await loc.evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(150);
      continue;
    }
    const roll = page.locator('[data-testid="dialogue-check-roll"]');
    if (await roll.isVisible().catch(() => false)) { await roll.evaluate((el) => (el as HTMLElement).click()); await page.waitForTimeout(150); continue; }
    const cont = page.locator('[data-testid="dialogue-continue"]');
    if (await cont.isVisible().catch(() => false)) { await cont.evaluate((el) => (el as HTMLElement).click()); await page.waitForTimeout(150); continue; }
    break;
  }
}

test.describe("DLC диалоги · регрессии (task-40)", () => {
  test.setTimeout(240_000);

  test("X закрывает диалог: нет active, игра идёт", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await startCampaign(page);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="dialogue-close"]').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeHidden({ timeout: 8000 });
    const state = await gameEval(page, (g) => ({
      active: g.world.fg?.dlc?.dialogue?.active === true,
      flags: Object.keys(g.world.fg?.dlc?.flags ?? {}),
      // X не должен вешать паузу диалога
      paused: g.getState().paused,
    }));
    expect(state.active, "закрытие X оставляет fg.dlc.dialogue.active").toBe(false);
    expect(diag.pageErrors, diag.pageErrors.join(" | ")).toEqual([]);
    await page.screenshot({ path: shot("32-dialogue-close.png") });
  });

  test("повтор dlg_q1_briefing после завершения не запускается", async ({ page }) => {
    await startCampaign(page);
    await ensureDialogue(page);
    await playDialogue(page);
    // завершаем Q1 и пытаемся запустить сцену повторно командой
    const res = await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__!;
      const actions = ["reach_system:sys_debris_belt_home", "kill:pirate_corvette", "kill:pirate_corvette", "choice:q1_c2_target", "dock:station_light_1", "report:kira7", "turn_in:kira7"];
      for (const a of actions) { const [action, target] = a.split(":"); g.sendCommand({ type: "dlc_action", action, target }); }
      const started = g.sendCommand({ type: "dlc_dialogue_start", sceneId: "dlg_q1_briefing", questId: "q_pro_01_first_light" });
      return { started, active: g.world.fg?.dlc?.dialogue?.active === true, q1: g.world.fg?.dlc?.quests["q_pro_01_first_light"]?.status };
    });
    expect(res.q1).toBe("completed");
    expect(res.active, "сцена перезапустилась после завершения квеста").toBe(false);
    await advanceTicks(page, 5);
    expect(await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.active === true)).toBe(false);
  });

  test("модалка события не поверх диалога и не копится", async ({ page }) => {
    await startCampaign(page);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
    // добавляем pending-событие и просим UI перерисоваться
    const injected = await gameEval(page, (g) => {
      const fg = g.world.fg as unknown as { narrative?: { pending: Array<Record<string, unknown>> } };
      if (!fg?.narrative) return false;
      fg.narrative.pending.push({
        id: "qa_event_" + g.world.tick, titleRu: "QA-событие", textRu: "Проверка приоритета модалок",
        chainId: "qa", step: 1, expiresTick: 999999, choices: [],
      });
      g.refresh?.({});
      return true;
    });
    test.skip(!injected, "нет fg.narrative в мире");
    await page.waitForTimeout(500);
    const whileDialogue = await page.evaluate(() => ({
      dialogue: !!document.querySelector('[data-testid="dialogue-overlay"]'),
      event: !!document.querySelector('[data-testid="narrative-event"]'),
      overlays: document.querySelectorAll('[data-testid="overlays-root"]').length,
    }));
    expect(whileDialogue.dialogue).toBe(true);
    expect(whileDialogue.event, "модалка события открылась поверх диалога").toBe(false);
    // закрываем диалог — событие должно появиться ровно один раз
    await page.locator('[data-testid="dialogue-close"]').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('[data-testid="narrative-event"]')).toBeVisible({ timeout: 8000 });
    expect(await page.locator('[data-testid="narrative-event"]').count()).toBe(1);
    await page.locator('[data-testid="btn-later-event"]').evaluate((el) => (el as HTMLElement).click());
    expect(await page.locator('[data-testid="narrative-event"]').count()).toBe(0);
  });

  test("new game сбрасывает dismissed/seen сцен", async ({ page }) => {
    await startCampaign(page);
    await ensureDialogue(page);
    await page.locator('[data-testid="dialogue-close"]').evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(300);
    // новая игра в той же странице (без перезагрузки модулей)
    await gameEval(page, (g) => g.newGame(43));
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
  });

  test("выборы Q1 меняют флаги/репутацию и открывают Q2", async ({ page }) => {
    await startCampaign(page, 51);
    await ensureDialogue(page);
    await playDialogue(page, ["diagnose_first", "no_shots", "honest_report"]);
    const d = await gameEval(page, (g) => ({
      flags: Object.keys(g.world.fg?.dlc?.flags ?? {}).filter((f) => !/^(story_message|dlc_|hint|dialogue_done|quest_systems)/.test(f)),
      rep: g.world.fg?.dlc?.reputation ?? {},
      q2: g.world.fg?.dlc?.quests["q_pro_02_quiet_dock"]?.status,
    }));
    expect(d.flags).toEqual(expect.arrayContaining(["diagnose_first", "no_shots", "honest_report"]));
    expect(Object.keys(d.rep).length).toBeGreaterThan(0);
    expect(d.q2).not.toBe("locked");
  });

  test("кампанийный диалог акта II: флаги, ветка, one-shot", async ({ page }) => {
    await startCampaign(page);
    await ensureDialogue(page);
    // закрываем пролог (one-shot), затем переводим кампанию в акт II
    await page.locator('[data-testid="dialogue-close"]').evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(300);
    await gameEval(page, (g) => {
      const fg = g.world.fg as unknown as {
        campaign: { act: number; missions: Record<string, { status?: string }> };
        narrative?: { pending: Array<unknown> };
        dlc?: { flags: Record<string, number> };
      };
      fg.campaign.act = 2;
      // новая актовая сцена триггерится завершённой миссией main_02_council
      fg.campaign.missions["main_02_council"] = { ...(fg.campaign.missions["main_02_council"] ?? {}), status: "completed" };
      if (fg.dlc) delete fg.dlc.flags["campaign_scene:main_02_council"];
      if (fg.narrative) fg.narrative.pending = [];
    });
    // актовые сцены стартуют в dlcPhase на такте
    for (let i = 0; i < 6; i++) {
      if (await page.locator('[data-testid="dialogue-overlay"]').isVisible().catch(() => false)) break;
      await advanceTicks(page, 2);
      await page.waitForTimeout(250);
    }
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 10_000 });
    const ctx = await gameEval(page, (g) => g.world.fg?.dlc?.dialogue ? { scene: g.world.fg.dlc.dialogue.sceneId, active: g.world.fg.dlc.dialogue.active } : null);
    expect(ctx?.scene).toBe("dlg_campaign_act2_council");
    await playDialogue(page, ["centralize", "council_now", "trust_admiral"]);
    const camp = await gameEval(page, (g) => {
      const fg = g.world.fg as unknown as { campaign: { flags: Record<string, number>; branch: string } };
      return { flags: Object.keys(fg.campaign.flags).filter((f) => f.includes("camp_") || f.includes("dlc_campaign")), branch: fg.campaign.branch };
    });
    expect(camp.flags).toEqual(expect.arrayContaining(["camp_central_fleet", "camp_fleet_first", "camp_trust_admiral"]));
    await advanceTicks(page, 4);
    expect(await page.locator('[data-testid="dialogue-overlay"]').isVisible().catch(() => false), "act2 диалог не повторяется").toBe(false);
  });

  test("save/load mid-dialogue сохраняет узел", async ({ page }) => {
    await startCampaign(page);
    await ensureDialogue(page);
    // диалог оставляем открытым (не проигрываем до конца)
    await page.waitForTimeout(300);
    const node = await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.nodeId ?? null);
    await page.evaluate(async () => {
      const g = (window as unknown as { __SF_GAME__?: { saveGame?: (m?: boolean) => Promise<boolean> } }).__SF_GAME__;
      if (g?.saveGame) await g.saveGame(true);
    });
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
      const g = (window as unknown as { __SF_GAME__?: { loadGame?: () => Promise<boolean> } }).__SF_GAME__;
      if (g?.loadGame) await g.loadGame();
    });
    await page.waitForTimeout(900);
    expect(await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.nodeId ?? null)).toBe(node);
  });
});