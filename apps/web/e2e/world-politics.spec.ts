/**
 * E2E XV · Мировая политика ИИ-ИИ (task-44): панель/матрица/лента/HUD/события игрока/статусы
 * фракций (collapse/absorb/accession/commonwealth), приоритет к диалогу, 1280×720.
 * Данные для детерминизма инжектируются в fg.aiNews/aiWorldEvents/aiBlocs (fallback UI),
 * после мержа sim-API используется как основной источник.
 */
import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, dismissDialogueOverlay, gotoGame, isVisible } from "./helpers";

test.use({ trace: "off", video: "off" });
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
const shot = (n: string) => path.join(shots, n);

type G = {
  world: {
    tick: number;
    seed: number;
    playerEmpireId: number;
    empires: Array<{ id: number; name: string; dead?: boolean }>;
    systems: Array<{ id: number; ownerId: number; name?: string }>;
    fg?: Record<string, unknown> & {
      aiNews?: Array<Record<string, unknown>>;
      aiWorldEvents?: Array<Record<string, unknown>>;
      aiBlocs?: Array<Record<string, unknown>>;
      dlc?: { enabled: boolean; dialogue: { active: boolean } | null };
      narrative?: { pending: Array<unknown> };
    };
  };
  getState(): { tick: number; paused: boolean; mode: string };
  setSpeed?(n: number): void;
  advance(ms: number): void;
  sendCommand(c: unknown): boolean;
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
    const input = page.locator('[data-testid="input-seed"]');
    if (await isVisible(input, 1000)) await input.fill(String(seed));
    await page.locator('[data-testid="btn-new-game"]').evaluate((el) => (el as HTMLElement).click());
  }
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await dismissDialogueOverlay(page);
  await page.waitForTimeout(400);
}

async function openPolitics(page: Page): Promise<void> {
  await dismissDialogueOverlay(page);
  await page.locator('[data-testid="btn-open-more"]').first().evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="full-panel-menu"]')).toBeVisible({ timeout: 8000 });
  await page.locator('[data-testid="panel-open-politics"]').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="politics-panel"]')).toBeVisible({ timeout: 8000 });
}

async function domClick(page: Page, testId: string): Promise<void> {
  await page.locator('[data-testid="' + testId + '"]').evaluate((el) => (el as HTMLElement).click());
}

async function inject(page: Page, data: Partial<Record<"aiNews" | "aiWorldEvents" | "aiBlocs", unknown[]>>): Promise<void> {
  await gameEval(page, (g, payload) => {
    const fg = (g.world.fg ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) fg[k] = v;
    g.refresh?.({});
  }, data);
  await page.waitForTimeout(300);
}

test.describe("XV · Мировая политика ИИ (task-44)", () => {
  test.setTimeout(180_000);

  test("панель: обзор/матрица/лента/HUD, статусы фракций, 1280×720", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await startCampaign(page);
    // HUD виден на карте (не под модалкой панели)
    await expect(page.locator('[data-testid="ai-world-hud"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="world-war-hud"]')).toBeVisible();
    await expect(page.locator('[data-testid="world-bloc-hud"]')).toBeVisible();
    await openPolitics(page);
    for (const tab of ["overview", "matrix", "news", "events"]) {
      await expect(page.locator('[data-testid="btn-politics-tab-' + tab + '"]')).toBeVisible();
    }
    const rows = page.locator('[data-testid^="politics-empire-row-"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-testid^="faction-status-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="politics-wars"]')).toBeVisible();
    await expect(page.locator('[data-testid="politics-alliances"]')).toBeVisible();
    await page.screenshot({ path: shot("33-politics-overview.png") });

    await domClick(page, "btn-politics-tab-matrix");
    await expect(page.locator('[data-testid="politics-matrix"]')).toBeVisible({ timeout: 8000 });
    expect(await page.locator('[data-testid^="politics-matrix-row-"]').count()).toBeGreaterThanOrEqual(2);
    expect(await page.locator('[data-testid^="politics-relation-"]').count()).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: shot("34-politics-matrix.png") });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot("35-politics-matrix-1280.png") });
    await page.keyboard.press("Escape");
    expect(diag.pageErrors, diag.pageErrors.join(" | ")).toEqual([]);
  });

  test("лента: события treaty/war/collapse/annexation/commonwealth и фильтры", async ({ page }) => {
    await startCampaign(page);
    const kinds = ["treaty", "war", "federation", "collapse", "annexation", "accession", "centralization", "commonwealth", "call_to_arms", "trade_bloc"];
    await inject(page, {
      aiNews: kinds.map((kind, i) => ({
        id: "qa-news-" + i, tick: 10 + i, kind,
        actorEmpireId: 2, targetEmpireId: 3, actorName: "QA-A", targetName: "QA-B",
        textRu: "QA событие: " + kind,
      })),
    });
    await openPolitics(page);
    await domClick(page, "btn-politics-tab-news");
    await expect(page.locator('[data-testid="ai-news-feed"]')).toBeVisible({ timeout: 8000 });
    expect(await page.locator('[data-testid^="ai-news-item-"]').count()).toBeGreaterThanOrEqual(kinds.length);
    for (const kind of ["treaty", "war", "federation", "annexation", "call_to_arms", "trade_bloc"]) {
      await expect(page.locator('[data-testid="ai-news-filter-' + kind + '"]')).toBeVisible();
    }
    await domClick(page, "ai-news-filter-war");
    await expect.poll(async () => page.locator('[data-testid^="ai-news-item-"]').count()).toBeLessThan(kinds.length);
    await expect(page.locator('[data-testid="ai-news-item-qa-news-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-news-item-qa-news-3"]')).toHaveCount(0);
    await page.screenshot({ path: shot("36-politics-news.png") });
  });

  test("событие игрока: call-to-arms рендерится/выбор скрывает, эффект sim применяется", async ({ page }) => {
    await startCampaign(page);
    await inject(page, { aiWorldEvents: [{
      id: "qa-event-call", kind: "call_to_arms", tick: 5, fromEmpireId: 2, targetEmpireId: null,
      titleRu: "Призыв к обороне", textRu: "Союзник зовёт на войну.",
      choices: [{ id: "join", labelRu: "Вступить" }, { id: "decline", labelRu: "Отказаться" }],
    }] });
    await expect(page.locator('[data-testid="ai-world-event"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="ai-event-choice-join"]')).toBeVisible();
    await domClick(page, "ai-event-choice-join");
    await expect(page.locator('[data-testid="ai-world-event"]')).toBeHidden({ timeout: 8000 });
    // эффект: та же sim-команда, что шлёт кнопка UI (событие из fg.aiWorld.events)
    const evId = await gameEval(page, (g) => {
      const fg = g.world.fg as unknown as { aiWorld: { events: Array<Record<string, unknown>>; nextEventId: number } };
      const id = 930001;
      fg.aiWorld.events.push({
        id, tick: g.world.tick, kind: "call_to_arms", fromEmpireId: 2, targetEmpireId: g.world.playerEmpireId,
        titleRu: "QA", textRu: "QA", expiresTick: g.world.tick + 240, resolved: false,
        choices: [{ id: "join", labelRu: "Вступить", effects: [{ target: "flag:ai_call_to_arms", value: 1 }] }],
      });
      fg.aiWorld.nextEventId = id + 1;
      const ok = g.sendCommand({ type: "ai_world_event_choice", eventId: id, choiceId: "join" });
      return { id, ok };
    });
    expect(evId.ok, "команда выбора принята").toBe(true);
    const result = await gameEval(page, (g, id) => {
      const fg = g.world.fg as unknown as { aiWorld: { events: Array<{ id: number; resolved?: boolean; choiceId?: string }> }; campaign: { flags: Record<string, number> } };
      const ev = fg.aiWorld.events.find((e) => e.id === id);
      return { resolved: ev?.resolved === true, choice: ev?.choiceId ?? null, flag: fg.campaign.flags.ai_call_to_arms ?? 0 };
    }, evId.id);
    expect(result.resolved, "событие обработано sim").toBe(true);
    expect(result.choice).toBe("join");
    expect(result.flag).toBe(1);
  });

  test("AI-событие не открывается поверх DLC-диалога", async ({ page }) => {
    await gotoGame(page);
    if (await isVisible(page.locator(SEL.menu), 10_000)) {
      const input = page.locator('[data-testid="input-seed"]');
      if (await isVisible(input, 1000)) await input.fill("45");
      await page.locator('[data-testid="btn-new-game"]').evaluate((el) => (el as HTMLElement).click());
    }
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15_000 });
    const playerId = await gameEval(page, (g) => g.world.playerEmpireId);
    await gameEval(page, (g, pid) => {
      const fg = g.world.fg as unknown as { aiWorld: { events: Array<Record<string, unknown>> }; aiWorldEvents?: unknown[] };
      const event = { id: 920001, tick: g.world.tick, kind: "call_to_arms", fromEmpireId: 2, targetEmpireId: pid, titleRu: "QA", textRu: "QA", expiresTick: g.world.tick + 240, resolved: false, choices: [{ id: "join", labelRu: "Вступить" }] };
      fg.aiWorld.events.push(event);
      fg.aiWorldEvents = [event];
      g.refresh?.({});
    }, playerId);
    await page.waitForTimeout(500);
    expect(await page.locator('[data-testid="ai-world-event"]').isVisible().catch(() => false), "AI-событие поверх диалога").toBe(false);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible();
  });

  test("статусы распада/поглощения/содружества в обзоре", async ({ page }) => {
    await startCampaign(page);
    await inject(page, {
      aiNews: [
        { id: "qa-collapse", tick: 20, kind: "collapse", actorEmpireId: 2, targetEmpireId: 2, actorName: "QA", textRu: "Фракция распалась" },
        { id: "qa-annex", tick: 21, kind: "annexation", actorEmpireId: 3, targetEmpireId: 2, actorName: "QA-C", targetName: "QA-B", textRu: "Поглощение" },
        { id: "qa-accession", tick: 22, kind: "accession", actorEmpireId: 3, targetEmpireId: 4, actorName: "QA-C", targetName: "QA-D", textRu: "Вхождение" },
        { id: "qa-central", tick: 23, kind: "centralization", actorEmpireId: 3, targetEmpireId: 3, actorName: "QA-C", textRu: "Централизация" },
        { id: "qa-common", tick: 24, kind: "commonwealth", actorEmpireId: 3, targetEmpireId: 3, actorName: "QA-C", textRu: "Содружество" },
      ],
    });
    await openPolitics(page);
    await domClick(page, "btn-politics-tab-news");
    for (const id of ["qa-collapse", "qa-annex", "qa-accession", "qa-central", "qa-common"]) {
      await expect(page.locator('[data-testid="ai-news-item-' + id + '"]')).toBeVisible();
    }
    await domClick(page, "btn-politics-tab-overview");
    await expect(page.locator('[data-testid^="faction-status-"]').first()).toBeVisible();
    await page.screenshot({ path: shot("37-politics-status.png") });
  });
});