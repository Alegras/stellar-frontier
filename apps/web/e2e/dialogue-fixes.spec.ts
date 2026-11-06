import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, dismissAllOverlays, expectNoErrors, gotoGame } from "./helpers";

/**
 * task-38: единый диалоговый оверлей — приоритет модалок, закрытие через sim,
 * последствия выбора, кампанийный контекст, пауза, сброс сцен при новой игре.
 */
const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (n: string): string => SHOTS + n;

type G = {
  world: {
    seed: number; tick: number;
    fg?: {
      dlc?: {
        enabled: boolean;
        dialogue: { sceneId: string; nodeId: string; active: boolean; context?: string; campaignAct?: number } | null;
        quests: Record<string, { status: string; step: number }>;
        flags: Record<string, number>;
        reputation: Record<string, number>;
        consequences?: unknown[];
        seenScenes?: string[];
      };
      narrative?: { pending: Array<Record<string, unknown>> };
      campaign?: { flags: Record<string, number> };
    };
  };
  getState(): { tick: number; paused: boolean; speed: number; mode: string };
  setSpeed?(n: number): void;
  advance(ms: number): void;
  sendCommand(c: unknown): boolean;
  newGame(seed?: number): void;
  refresh?(s?: unknown): void;
};

async function gameEval<T>(page: Page, fn: (g: G) => T): Promise<T> {
  return page.evaluate((src) => {
    const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__;
    if (!g) throw new Error("нет __SF_GAME__");
    return new Function("g", "return (" + src + ")(g)")(g) as T;
  }, fn.toString());
}

async function startGame(page: Page, seed = 42): Promise<void> {
  await gotoGame(page);
  await page.evaluate((s) => {
    const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (n?: number) => void } }).__SF_GAME__!;
    if (!g.hasWorld) g.newGame(s);
  }, seed);
  await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
}

async function play(page: Page, prefer: string[] = []): Promise<void> {
  let idle = 0;
  for (let i = 0; i < 50; i++) {
    if (!(await page.locator('[data-testid="dialogue-overlay"]').count())) {
      idle++;
      if (idle >= 4) return;
      await page.waitForTimeout(200);
      continue;
    }
    idle = 0;
    const ids = await page.locator('[data-testid^="dialogue-choice-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid ?? "")).catch(() => [] as string[]);
    if (ids.length > 0) {
      const want = prefer.find((p) => ids.includes("dialogue-choice-" + p));
      const target = want ? "dialogue-choice-" + want : ids.find((id) => !id.includes("-fx-")) ?? ids[0];
      await page.evaluate((id) => document.querySelector<HTMLElement>('[data-testid="' + id + '"]')?.click(), target);
      await page.waitForTimeout(180);
      continue;
    }
    const cont = page.locator('[data-testid="dialogue-continue"]');
    if (await cont.count()) { await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="dialogue-continue"]')?.click()); await page.waitForTimeout(160); continue; }
    const roll = page.locator('[data-testid="dialogue-check-roll"]');
    if (await roll.count()) { await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="dialogue-check-roll"]')?.click()); await page.waitForTimeout(160); continue; }
    await page.waitForTimeout(220);
  }
}

const closeDialog = async (page: Page): Promise<void> => {
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="dialogue-close"]')?.click());
};

test.describe("Диалоги · task-38", () => {
  test.describe.configure({ retries: 1 });

  test("закрытие X завершает сцену в sim, снимает паузу; повторно сцена не стартует", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await startGame(page);
    const tickBefore = await gameEval(page, (g) => g.getState().tick);
    expect(await gameEval(page, (g) => g.getState().paused)).toBe(true);
    await closeDialog(page);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(async () => gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.active === true), { timeout: 10_000 }).toBe(false);
    expect(await gameEval(page, (g) => g.getState().paused)).toBe(false);

    // повторный запуск той же сцены отклоняется one-shot
    const restarted = await gameEval(page, (g) => g.sendCommand({ type: "dlc_dialogue_start", sceneId: "dlg_q1_briefing", questId: "q_pro_01_first_light" }));
    expect(restarted).toBe(false);
    expect(await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.active === true)).toBe(false);

    // время идёт после закрытия, диалог не возвращается
    await gameEval(page, (g) => { g.setSpeed?.(3); for (let i = 0; i < 3; i++) g.advance(1000); });
    await page.waitForTimeout(500);
    expect(await gameEval(page, (g) => g.getState().tick)).toBeGreaterThan(tickBefore);
    expect(await page.locator('[data-testid="dialogue-overlay"]').count()).toBe(0);
    await page.screenshot({ path: shot("dialogue-closed.png") });
    expectNoErrors(diag);
  });

  test("narrative-модалка не поверх диалога и появляется один раз после закрытия", async ({ page }) => {
    await startGame(page);
    const injected = await gameEval(page, (g) => {
      const fg = g.world.fg as unknown as { narrative?: { pending: Array<Record<string, unknown>> } };
      if (!fg?.narrative) return false;
      fg.narrative.pending.push({
        id: "qa_dlg_event", titleRu: "Событие во время диалога", textRu: "Должно ждать закрытия",
        chainId: "qa", step: 1, expiresTick: 999999, choices: [],
      });
      g.refresh?.({});
      return true;
    });
    test.skip(!injected, "нет fg.narrative");
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="narrative-event"]')).toHaveCount(0);
    // во время диалога пауза, такт не растёт
    const tick = await gameEval(page, (g) => g.getState().tick);
    await page.waitForTimeout(1400);
    expect(await gameEval(page, (g) => g.getState().tick)).toBe(tick);

    await closeDialog(page);
    await expect(page.locator('[data-testid="narrative-event"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('[data-testid="narrative-event"]').count()).toBe(1);
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-later-event"]')?.click());
    await expect(page.locator('[data-testid="narrative-event"]')).toHaveCount(0);
    await page.screenshot({ path: shot("dialogue-modal-priority.png") });
  });

  test("выборы показывают последствия и видны в журнале", async ({ page }) => {
    await startGame(page);
    await play(page, ["diagnose_first", "no_shots", "honest_report"]);
    const st = await gameEval(page, (g) => ({
      flags: Object.keys(g.world.fg?.dlc?.flags ?? {}),
      rep: g.world.fg?.dlc?.reputation ?? {},
      q2: g.world.fg?.dlc?.quests["q_pro_02_quiet_dock"]?.status,
      cons: g.world.fg?.dlc?.consequences?.length ?? 0,
    }));
    expect(st.flags).toEqual(expect.arrayContaining(["diagnose_first", "no_shots", "honest_report"]));
    expect(Object.keys(st.rep).length).toBeGreaterThan(0);
    expect(st.q2).not.toBe("locked");
    // последствия в журнале (после диалога или в процессе)
    await dismissAllOverlays(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-later-event"]')?.click());
    await page.waitForTimeout(200);
    for (let i = 0; i < 3; i++) {
      if (await page.locator('[data-testid="panel-open-journal"]').count()) break;
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-open-more"]')?.click());
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="panel-open-journal"]')?.click());
    await expect(page.locator('[data-testid="journal-panel"]')).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-journal-tab-chronicle"]')?.click());
    await expect(page.locator('[data-testid="journal-consequences"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('[data-testid^="consequence-entry-"]').count()).toBeGreaterThan(0);
    await page.screenshot({ path: shot("dialogue-consequences.png") });
  });

  test("new game сбрасывает закрытые/seen сцены", async ({ page }) => {
    await startGame(page, 42);
    await closeDialog(page);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toHaveCount(0, { timeout: 10_000 });
    await page.evaluate(() => (window as unknown as { __SF_GAME__?: { newGame: (n: number) => void } }).__SF_GAME__?.newGame(43));
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
    expect(await gameEval(page, (g) => g.world.seed)).toBe(43);
  });
  test("новые кампанийные сцены триггерятся завершёнными миссиями и берут текст из l10n", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await startGame(page, 42);
    await closeDialog(page);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toHaveCount(0, { timeout: 10_000 });
    const check = async (missionId: string, sceneId: string, first: boolean, outcome = false): Promise<void> => {
      await page.evaluate((id) => {
        const g = (window as unknown as {
          __SF_GAME__?: {
            world: { fg?: { dlc?: { flags: Record<string, number> }; campaign?: { missions: Record<string, { status?: string }> }; narrative?: { pending: unknown[] } } };
            getState?: () => { paused: boolean }; togglePause?: () => void; setSpeed?: (n: number) => void;
            advance: (ms: number) => void; refresh?: (s?: unknown) => void;
          };
        }).__SF_GAME__;
        if (!g?.world.fg) return;
        const fg = g.world.fg;
        fg.campaign!.missions[id] = { ...(fg.campaign!.missions[id] ?? {}), status: "completed" };
        if (fg.dlc) delete fg.dlc.flags["campaign_scene:" + id];
        if (fg.narrative) fg.narrative.pending = [];
        if (g.getState?.().paused) g.togglePause?.();
        g.setSpeed?.(1);
        for (let i = 0; i < 4; i++) {
          if (fg.narrative) fg.narrative.pending = [];
          g.advance(1000);
          if (g.world.fg?.dlc && (g.world.fg.dlc as unknown as { dialogue?: { active?: boolean } }).dialogue?.active) break;
        }
        g.refresh?.({});
      }, missionId);
      await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 10_000 });
      const st = await gameEval(page, (g) => ({ scene: g.world.fg?.dlc?.dialogue?.sceneId ?? null, context: g.world.fg?.dlc?.dialogue?.context ?? null }));
      expect(st.scene, missionId).toBe(sceneId);
      expect(st.context).toBe("campaign");
      const text = await page.locator('[data-testid="dialogue-text"]').innerText();
      expect(text.length, sceneId + " текст из l10n").toBeGreaterThan(40);
      expect(text).not.toContain("dlg.campaign");
      await expect(page.locator('[data-testid="dialogue-campaign"]')).toBeVisible();
      if (outcome) {
        // доходим до варианта, выбираем первый и проверяем подсветку узла-исхода
        for (let i = 0; i < 8; i++) {
          const options = page.locator('[data-testid="dialogue-options"]');
          if (await options.isVisible().catch(() => false)) {
            await page.locator('[data-testid^="dialogue-choice-"]').first().click();
            break;
          }
          const cont = page.locator('[data-testid="dialogue-continue"]');
          if (await cont.isVisible().catch(() => false)) { await cont.click(); await page.waitForTimeout(200); continue; }
          break;
        }
        for (let i = 0; i < 8; i++) {
          if (await page.locator('[data-testid="dialogue-outcome"]').isVisible().catch(() => false)) break;
          const cont = page.locator('[data-testid="dialogue-continue"]');
          if (await cont.isVisible().catch(() => false)) { await cont.click(); await page.waitForTimeout(200); continue; }
          break;
        }
        await expect(page.locator('[data-testid="dialogue-outcome"]'), sceneId + " outcome").toBeVisible();
        await expect(page.locator('[data-testid="dialogue-text"]')).toHaveClass(/sf-dlg__text--outcome/);
        await page.screenshot({ path: shot("dialogue-outcome.png") });
      }
      if (first) await page.screenshot({ path: shot("dialogue-campaign.png") });
      await closeDialog(page);
      await expect(page.locator('[data-testid="dialogue-overlay"]')).toHaveCount(0, { timeout: 10_000 });
    };

    await check("main_00_relic", "dlg_campaign_act0_relic", false, true);
    await check("main_01_hegemon", "dlg_campaign_act1_hegemon", false, true);
    await check("main_01_colony", "dlg_campaign_teira_arc", false, true);
    await check("main_02_first_crisis", "dlg_campaign_kira_arc", false, true);
    await check("main_01_rift_rumor", "dlg_campaign_ancient_archive", false, true);
    await check("main_02_council", "dlg_campaign_act2_council", true);
    // порядок в CAMPAIGN_MISSION_DIALOGUES: сначала линия Древних, затем act3_truth
    await check("main_03_truth", "dlg_campaign_ancient_contact", false, true);
    await check("main_03_truth", "dlg_campaign_act3_truth", false);
  });

});
