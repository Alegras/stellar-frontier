/**
 * Полная история 0–V (task-53): триггеры актов 0/I, outcome-узлы в UI,
 * флаги camp_relic_*, camp_voice_*, camp_hegemon_*; отношения/разлоки.
 */
import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, dismissAllOverlays, gotoGame, isVisible } from "./helpers";

test.use({ trace: "off", video: "off" });
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
const shot = (n: string) => path.join(shots, n);

type G = {
  world: {
    tick: number;
    seed: number;
    playerEmpireId: number;
    empires: Array<{ id: number; name: string }>;
    fg?: {
      dlc?: { flags: Record<string, number>; reputation: Record<string, number>; dialogue?: { sceneId: string; active: boolean; context: string } | null };
      campaign?: { missions: Record<string, { status?: string }>; flags: Record<string, number> };
      narrative?: { pending: unknown[] };
    };
  };
  getState(): { paused: boolean; tick: number };
  togglePause?(): void;
  setSpeed?(n: number): void;
  advance(ms: number): void;
  refresh?(s?: unknown): void;
  sendCommand(c: unknown): boolean;
  newGame(n?: number): void;
};

async function gameEval<T>(page: Page, fn: (g: G, arg?: unknown) => T, arg?: unknown): Promise<T> {
  return page.evaluate((payload) => {
    const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__;
    if (!g) throw new Error("window.__SF_GAME__ недоступен");
    return new Function("g", "arg", "return (" + payload.src + ")(g, arg)")(g, payload.arg) as T;
  }, { src: fn.toString(), arg: arg ?? null });
}

async function startGame(page: Page, seed = 77): Promise<void> {
  await gotoGame(page);
  if (await isVisible(page.locator(SEL.menu), 10_000)) {
    const input = page.locator('[data-testid="input-seed"]');
    if (await isVisible(input, 1000)) await input.fill(String(seed));
    await page.locator('[data-testid="btn-new-game"]').evaluate((el) => (el as HTMLElement).click());
  }
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
  await dismissAllOverlays(page);
  await expect(page.locator('[data-testid="dialogue-overlay"]')).toHaveCount(0, { timeout: 10_000 });
}

async function triggerMission(page: Page, missionId: string): Promise<void> {
  await gameEval(page, (g, id) => {
    const fg = g.world.fg as unknown as {
      dlc?: { flags: Record<string, number> };
      campaign?: { missions: Record<string, { status?: string }> };
      narrative?: { pending: unknown[] };
    };
    fg.campaign!.missions[id as string] = { ...(fg.campaign!.missions[id as string] ?? {}), status: "completed" };
    if (fg.dlc) delete fg.dlc.flags["campaign_scene:" + id];
    if (fg.narrative) fg.narrative.pending = [];
    if (g.getState().paused) g.togglePause?.();
    g.setSpeed?.(1);
    for (let i = 0; i < 8; i++) {
      if (fg.narrative) fg.narrative.pending = [];
      g.advance(1000);
      if ((fg.dlc as unknown as { dialogue?: { active?: boolean } })?.dialogue?.active) break;
    }
    g.refresh?.({});
  }, missionId);
  await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 12_000 });
}

async function choose(page: Page, id: string): Promise<void> {
  const loc = page.locator('[data-testid="dialogue-choice-' + id + '"]');
  for (let i = 0; i < 40; i++) {
    if (await loc.isVisible().catch(() => false)) break;
    const cont = page.locator('[data-testid="dialogue-continue"]');
    if (await cont.isVisible().catch(() => false)) await cont.evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(150);
  }
  await expect(loc).toBeVisible({ timeout: 10_000 });
  await loc.evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(300);
}

async function expectOutcome(page: Page): Promise<string> {
  await expect(page.locator('[data-testid="dialogue-outcome"]')).toBeVisible({ timeout: 8000 });
  const text = await page.locator('[data-testid="dialogue-text"]').innerText();
  expect(text.length).toBeGreaterThan(20);
  expect(text).not.toContain("dlg.");
  await expect(page.locator('[data-testid="dialogue-text"]')).toHaveClass(/sf-dlg__text--outcome/);
  return text;
}

test.describe("История 0–V · task-53", () => {
  test.setTimeout(180_000);

  test("акт 0: relic→outcome-узлы, флаги camp_relic_*/camp_voice_*", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await startGame(page, 77);
    await triggerMission(page, "main_00_relic");
    const scene = await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.sceneId ?? null);
    expect(scene).toBe("dlg_campaign_act0_relic");
    await choose(page, "relic_study");
    const text = await expectOutcome(page);
    expect(text.length).toBeGreaterThan(40);
    const flags = await gameEval(page, (g) => g.world.fg?.dlc?.flags ?? {});
    expect(flags.camp_relic_study, "camp_relic_study").toBe(1);
    await page.screenshot({ path: shot("story-act0-outcome.png") });
    // второй выбор: voice_answer → outcome + camp_voice_answer
    for (let i = 0; i < 20; i++) {
      const choice = page.locator('[data-testid="dialogue-choice-voice_answer"]');
      if (await choice.isVisible().catch(() => false)) break;
      const cont = page.locator('[data-testid="dialogue-continue"]');
      if (await cont.isVisible().catch(() => false)) await cont.evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(150);
    }
    await choose(page, "voice_answer");
    await expectOutcome(page);
    const flags2 = await gameEval(page, (g) => g.world.fg?.dlc?.flags ?? {});
    expect(flags2.camp_voice_answer, "camp_voice_answer").toBe(1);
    expect(diag.pageErrors, diag.pageErrors.join(" | ")).toEqual([]);
  });

  test("акт I: hegemon accept/reject, флаги, отношения, unlock", async ({ page }) => {
    await startGame(page, 78);
    const repBefore = await gameEval(page, (g) => ({ ...(g.world.fg?.dlc?.reputation ?? {}) }));
    await triggerMission(page, "main_01_hegemon");
    expect(await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.sceneId ?? null)).toBe("dlg_campaign_act1_hegemon");
    await choose(page, "hegemon_accept");
    await expectOutcome(page);
    const after = await gameEval(page, (g) => ({ flags: g.world.fg?.dlc?.flags ?? {}, rep: g.world.fg?.dlc?.reputation ?? {} }));
    expect(after.flags.camp_hegemon_vassal, "camp_hegemon_vassal").toBe(1);
    expect(Object.keys(after.rep).length).toBeGreaterThanOrEqual(Object.keys(repBefore).length);
    await page.screenshot({ path: shot("story-act1-hegemon.png") });

    // новая игра → reject: camp_hegemon_rejected + unlock main_01_rift_rumor
    await page.evaluate(() => (window as unknown as { __SF_GAME__?: { newGame: (n: number) => void } }).__SF_GAME__?.newGame(79));
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
    await dismissAllOverlays(page);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toHaveCount(0, { timeout: 10_000 });
    await triggerMission(page, "main_01_hegemon");
    await choose(page, "hegemon_reject");
    await expectOutcome(page);
    const rejected = await gameEval(page, (g) => ({
      flags: g.world.fg?.dlc?.flags ?? {},
      campaign: g.world.fg?.campaign?.flags ?? {},
      missions: g.world.fg?.campaign?.missions ?? {},
    }));
    expect(rejected.flags.camp_hegemon_rejected, "camp_hegemon_rejected").toBe(1);
    expect(rejected.missions["main_01_rift_rumor"], "unlock mission").toBeTruthy();
  });

  test("арка Тейры: триггер колонией, outcome и флаг camp_teira_arc_*", async ({ page }) => {
    await startGame(page, 80);
    await triggerMission(page, "main_01_colony");
    expect(await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.sceneId ?? null)).toBe("dlg_campaign_teira_arc");
    await choose(page, "promise_truth");
    await expectOutcome(page);
    const flags = await gameEval(page, (g) => g.world.fg?.dlc?.flags ?? {});
    expect(flags.camp_teira_arc_truth, "camp_teira_arc_truth").toBe(1);
    await page.screenshot({ path: shot("story-teira-arc.png") });
  });
});