/**
 * E2E DLC XIV (M9d-0 «Первый Свет»): старт-диалог на такте 0 → 3 выбора → Q1/Q2,
 * журнал 4 вкладки, дерево 8 узлов/10 рёбер (туман/фильтр/fallback), каналы board/rumor/signal,
 * feature-flag off, save/load mid-dialogue, 1280×720.
 */
import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, gotoGame, isVisible, dismissAllOverlays } from "./helpers";

test.use({ trace: "off", video: "off" });
const shotsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
const shot = (n: string) => path.join(shotsDir, n);

type G = {
  world: {
    tick: number;
    fg?: {
      dlc?: {
        enabled: boolean; mode: string; storySent: boolean;
        quests: Record<string, { status: string; step: number }>;
        dialogue: { sceneId: string; nodeId: string; active: boolean; seed: number } | null;
        flags: Record<string, number>;
        board: { questIds: string[]; refreshTick: number };
        rumors: Array<{ id: string; questId: string; revealed: boolean; lie: boolean }>;
        signals: Array<{ id: string; questId: string; systemId: number; revealed: boolean }>;
        activeQuestId: string | null;
      };
    };
    playerEmpireId: number;
    empires: Array<{ id: number; resources: Record<string, number> }>;
    fleets: Array<{ id: number; empireId: number; systemId: number; ships: unknown[] }>;
  };
  getState(): { tick: number; paused: boolean; mode: string };
  setSpeed?(n: number): void;
  setBattleReport?(r: null): void;
  setOverlay?(id: "none"): void;
  advance(ms: number): void;
  sendCommand(cmd: unknown): boolean;
};

async function gameEval<T>(page: Page, fn: (g: G, arg?: unknown) => T, arg?: unknown): Promise<T> {
  return page.evaluate((payload) => {
    const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__;
    if (!g) throw new Error("window.__SF_GAME__ недоступен");
    return new Function("g", "arg", "return (" + payload.src + ")(g, arg)")(g, payload.arg) as T;
  }, { src: fn.toString(), arg: arg ?? null });
}

/** Клик через DOM: обходит перехват backdrop'ом от игровых оверлеев (известный флейк). */
async function domClick(locator: import("@playwright/test").Locator): Promise<void> {
  await locator.evaluate((el) => (el as HTMLElement).click());
}

async function dismissOverlays(page: Page): Promise<void> {
  await dismissAllOverlays(page);
  return;
  for (let i = 0; i < 6; i++) {
    const battle = page.locator('[data-testid="btn-close-battle"], [data-testid="btn-close-battle-footer"]');
    if (await isVisible(battle, 250)) { await battle.first().click(); await page.waitForTimeout(120); continue; }
    const modal = page.locator('[data-testid="overlays-root"]');
    if (await isVisible(modal, 200)) { await page.keyboard.press("Escape"); await page.waitForTimeout(120); continue; }
    break;
  }
}

async function advanceTicks(page: Page, n: number): Promise<void> {
  await page.evaluate((ticks) => {
    const g = (window as unknown as { __SF_GAME__?: G }).__SF_GAME__;
    if (!g) throw new Error("window.__SF_GAME__ недоступен");
    g.setSpeed?.(5);
    for (let i = 0; i < ticks; i++) {
      g.advance(1000);
      if (g.getState().paused) { g.setBattleReport?.(null); g.setOverlay?.("none"); g.setSpeed?.(5); }
    }
  }, n);
  await dismissOverlays(page);
}

async function startCampaign(page: Page, opts?: { seed?: number; dlc?: boolean }): Promise<void> {
  await gotoGame(page);
  if (await isVisible(page.locator(SEL.menu), 10000)) {
    const toggle = page.locator('[data-testid="toggle-dlc-newgame"]');
    if (await isVisible(toggle, 1500)) {
      const checked = await toggle.isChecked().catch(() => true);
      if (opts?.dlc === false && checked) await toggle.uncheck();
      if (opts?.dlc !== false && !checked) await toggle.check();
    }
    const seed = page.locator('[data-testid="input-seed"]');
    if (await isVisible(seed, 1000)) await seed.fill(String(opts?.seed ?? 42));
    await page.locator('[data-testid="btn-new-game"]').evaluate((el) => (el as HTMLElement).click());
  }
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(900);
}

async function openPanel(page: Page, panelId: string, testId: string): Promise<void> {
  // известный флейк PT-012: «Ещё…» может перехватываться backdrop — жмём DOM-кликом
  await dismissOverlays(page);
  await page.locator('[data-testid="btn-open-more"]').first().evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="full-panel-menu"]')).toBeVisible({ timeout: 8000 });
  await page.locator('[data-testid="panel-open-' + panelId + '"]').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="' + testId + '"]')).toBeVisible({ timeout: 8000 });
}

/** Пройти открытый диалог: выбирать варианты, бросать проверку, продолжать. */
async function playDialogue(page: Page, preferCheck = true): Promise<number> {
  let choices = 0;
  for (let i = 0; i < 30; i++) {
    const overlay = page.locator('[data-testid="dialogue-overlay"]');
    if (!(await overlay.isVisible().catch(() => false))) break;
    const option = page.locator('[data-testid^="dialogue-choice-"]').first();
    if (await option.isVisible().catch(() => false)) {
      await domClick(option);
      choices++;
      await page.waitForTimeout(200);
      continue;
    }
    const check = page.locator('[data-testid="dialogue-check-roll"]');
    if (await check.isVisible().catch(() => false)) {
      await domClick(check);
      await page.waitForTimeout(200);
      continue;
    }
    const cont = page.locator('[data-testid="dialogue-continue"]');
    if (await cont.isVisible().catch(() => false)) { await domClick(cont); await page.waitForTimeout(200); continue; }
    break;
  }
  return choices;
}

/** Программно пройти цепочку Q1→Q4 и открыть доску Q5 (как в headless-тесте). */
async function unlockBoard(page: Page): Promise<{ q2: string; q3: string; q4: string; board: string[] }> {
  return gameEval(page, (g) => {
    const d = g.world.fg?.dlc;
    if (!d) return { q2: "no-dlc", q3: "no-dlc", q4: "no-dlc", board: [] };
    const cmd = (c: unknown) => g.sendCommand(c);
    const player = g.world.empires.find((e) => e.id === g.world.playerEmpireId);
    if (player) player.resources.credits = Math.max(player.resources.credits, 50000);
    // цепочка действий по данным квестов через известные шаги
    const run = (steps: Array<[string, string, number?]>) => { for (const [action, target, count] of steps) for (let i = 0; i < (count ?? 1); i++) cmd({ type: "dlc_action", action, target }); };
    // сначала завершаем Q1 (диалог уже пройден): 7 шагов
    run([["reach_system", "sys_debris_belt_home"], ["kill", "pirate_corvette", 2], ["choice", "q1_c2_target"], ["dock", "station_light_1"], ["report", "kira7"], ["turn_in", "kira7"]]);
    cmd({ type: "dlc_quest_accept", questId: "q_pro_02_quiet_dock" });
    run([["dock", "station_light_1"], ["choice", "q2_c1_dock"], ["choice", "q2_c2_meds"], ["report", "kira7"], ["turn_in", "kira7"]]);
    const rumor = (d.rumors ?? []).find((r) => r.questId === "q_pro_03_salt_ash" && !r.revealed);
    if (rumor) cmd({ type: "dlc_buy_rumor", rumorId: rumor.id });
    cmd({ type: "dlc_quest_accept", questId: "q_pro_03_salt_ash" });
    run([["reach_system", "poi_belt_ring7"], ["choice", "q3_c1_relics"], ["choice", "q3_c2_ash"], ["turn_in", "ort"]]);
    cmd({ type: "dlc_quest_accept", questId: "q_pro_04_courier" });
    run([["reach_system", "sys_courier_route_1"], ["reach_system", "sys_courier_route_2"], ["choice", "q4_c2_patrol"], ["turn_in", "maev"]]);
    g.setSpeed?.(5);
    for (let i = 0; i < 12; i++) g.advance(1000);
    return {
      q2: d.quests["q_pro_02_quiet_dock"]?.status ?? "?",
      q3: d.quests["q_pro_03_salt_ash"]?.status ?? "?",
      q4: d.quests["q_pro_04_courier"]?.status ?? "?",
      board: d.board?.questIds ?? [],
    };
  });
}

test.describe("DLC XIV · Первый Свет (M9d-0)", () => {
  test.setTimeout(240_000);

  test("такт 0: диалог Кира-7 → 3 выбора → Q1/Q2", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await startCampaign(page, { seed: 42 });
    const overlay = page.locator('[data-testid="dialogue-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="dialogue-speaker"]')).toBeVisible();
    await expect(page.locator('[data-testid="dialogue-text"]')).toBeVisible();
    await expect(page.locator('[data-testid="dialogue-portrait"]')).toBeVisible();
    // первые узлы — реплики: жмём «Продолжить», пока не появятся варианты
    const firstOptions = page.locator('[data-testid^="dialogue-choice-"]');
    for (let i = 0; i < 12; i++) {
      if (await firstOptions.first().isVisible().catch(() => false)) break;
      const cont = page.locator('[data-testid="dialogue-continue"]');
      const roll = page.locator('[data-testid="dialogue-check-roll"]');
      if (await cont.isVisible().catch(() => false)) { await domClick(cont); await page.waitForTimeout(200); continue; }
      if (await roll.isVisible().catch(() => false)) { await domClick(roll); await page.waitForTimeout(200); continue; }
      break;
    }
    await expect(firstOptions.first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: shot("26-dlc-dialogue.png") });

    const choices = await playDialogue(page);
    expect(choices).toBeGreaterThanOrEqual(3);
    await expect(overlay).toBeHidden({ timeout: 15000 });
    const state = await gameEval(page, (g) => {
      const d = g.world.fg?.dlc;
      return {
        groups: [
          ["going_now", "diagnose_first"],
          ["leader_first", "escort_first", "no_shots"],
          ["honest_report", "hide_core", "teira_only"],
        ].filter((group) => group.some((flag) => d?.flags[flag])).length,
        q1: d?.quests["q_pro_01_first_light"]?.status ?? "?",
        q2: d?.quests["q_pro_02_quiet_dock"]?.status ?? "?",
      };
    });
    expect(state.groups, "3 значимых выбора применены").toBe(3);
    expect(state.q2).not.toBe("locked");
    await page.screenshot({ path: shot("27-dlc-after-dialogue.png") });
    expect(diag.pageErrors, "pageerror: " + diag.pageErrors.join(" | ")).toEqual([]);
  });

  test("журнал 4 вкладки и дерево 8/10 (1280×720)", async ({ page }) => {
    await startCampaign(page, { seed: 42 });
    await playDialogue(page).catch(() => 0);
    await openPanel(page, "journal", "journal-panel");
    for (const [tab, id] of [["active", "btn-journal-tab-active"], ["done", "btn-journal-tab-done"], ["chronicle", "btn-journal-tab-chronicle"], ["tree", "btn-journal-tab-tree"]]) {
      await expect(page.locator('[data-testid="' + id + '"]'), tab).toBeVisible();
    }
    await expect(page.locator('[data-testid="quest-card-q_pro_01_first_light"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="quest-progress"]').first()).toBeVisible();
    await page.screenshot({ path: shot("28-dlc-journal.png") });

    await page.locator('[data-testid="btn-journal-tab-tree"]').click();
    await expect(page.locator('[data-testid="quest-tree"]')).toBeVisible({ timeout: 8000 });
    const nodes = page.locator('[data-testid^="tree-node-"]');
    const edges = page.locator('[data-testid^="tree-edge-"]');
    expect(await nodes.count()).toBe(8);
    expect(await edges.count()).toBe(10);
    await expect(page.locator('[data-testid="tree-list-fallback"]')).toBeAttached();
    await expect(page.locator('[data-testid="tree-legend"]')).toBeVisible();
    await expect(page.locator('[data-testid="tree-minimap"]')).toBeVisible();
    // выбор узла через доступный список (кнопка надёжнее, чем SVG-узел под backdrop)
    await page.locator('[data-testid^="tree-list-fallback-node-"]').first().evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('[data-testid="tree-node-card"]')).toBeVisible({ timeout: 8000 });
    await page.locator('[data-testid="tree-filter-all"]').evaluate((el) => (el as HTMLElement).click());
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("29-dlc-tree-1280.png") });
  });

  test("каналы: доска Q5, слух 500 кр., сигнал", async ({ page }) => {
    await startCampaign(page, { seed: 42 });
    await playDialogue(page).catch(() => 0);
    const chain = await unlockBoard(page);
    expect(chain.q2).toBe("completed");
    expect(chain.q3).toBe("completed");
    expect(chain.q4).toBe("completed");
    expect(chain.board.length).toBeGreaterThan(0);

    // доска на станции: после прокрутки тактов могли открыться бой/событие — закрываем
    await dismissOverlays(page);
    const dock = page.locator('[data-testid="btn-dock"]');
    if (await isVisible(dock, 5000)) await dock.evaluate((el) => (el as HTMLElement).click());
    await dismissOverlays(page);
    await expect(page.locator(SEL.station)).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="tab-board"]').click();
    await expect(page.locator('[data-testid="board-panel"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="channel-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="board-quest-q_pro_05_inspection"]')).toBeVisible({ timeout: 8000 });
    const q5Status = await gameEval(page, (g) => g.world.fg?.dlc?.quests["q_pro_05_inspection"]?.status ?? "?");
    if (q5Status !== "active") {
      await page.locator('[data-testid="btn-board-accept-q_pro_05_inspection"]').evaluate((el) => (el as HTMLElement).click());
    }
    await expect.poll(async () => gameEval(page, (g) => g.world.fg?.dlc?.quests["q_pro_05_inspection"]?.status ?? "?"), { timeout: 8000 }).toBe("active");
    // слух
    const rumor = page.locator('[data-testid^="btn-buy-rumor-"]').first();
    if (await isVisible(rumor, 3000)) {
      const rumorId = (await rumor.getAttribute("data-testid"))!.replace("btn-buy-rumor-", "");
      await rumor.click();
      await expect.poll(async () => gameEval(page, (g, id) => (g.world.fg?.dlc?.rumors ?? []).find((x) => x.id === id)?.revealed === true, rumorId), { timeout: 8000 }).toBe(true);
    }
    await page.screenshot({ path: shot("30-dlc-board.png") });
    await page.locator('[data-testid="btn-undock"]').click().catch(() => undefined);

    // сигнал: маркер на карте + раскрытие входом флота в систему
    const signal = await gameEval(page, (g) => (g.world.fg?.dlc?.signals ?? []).find((s) => !s.revealed) ?? null);
    if (signal) {
      await expect(page.locator('[data-testid="quest-marker-' + signal.id + '"]')).toBeAttached({ timeout: 8000 });
      await gameEval(page, (g, sid) => {
        const p = g.world.empires.find((e) => e.id === g.world.playerEmpireId);
        const fleet = g.world.fleets.find((f) => f.empireId === p?.id && f.ships.length > 0);
        if (fleet) fleet.systemId = sid as number;
        g.setSpeed?.(5);
        for (let i = 0; i < 3; i++) g.advance(1000);
      }, signal.systemId);
      await expect.poll(async () => gameEval(page, (g, id) => (g.world.fg?.dlc?.signals ?? []).find((s) => s.id === id)?.revealed === true, signal.id), { timeout: 8000 }).toBe(true);
    }
  });

  test("flag off: без DLC прежнее поведение; save/load mid-dialogue", async ({ page }) => {
    await startCampaign(page, { seed: 42, dlc: false });
    await page.waitForTimeout(1500);
    expect(await page.locator('[data-testid="dialogue-overlay"]').isVisible().catch(() => false), "без флага диалог не открывается").toBe(false);
    await openPanel(page, "journal", "journal-panel");
    await expect(page.locator('[data-testid="journal-disabled"]')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press("Escape");

    // save/load mid-dialogue (с включённым DLC)
    await startCampaign(page, { seed: 43 });
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 15000 });
    const nodeBefore = await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.nodeId ?? null);
    // сохраняем через API: топ-бар перекрыт backdrop диалога
    await page.evaluate(async () => {
      const g = (window as unknown as { __SF_GAME__?: { saveGame?: (manual?: boolean) => Promise<boolean> } }).__SF_GAME__;
      if (g?.saveGame) await g.saveGame(true);
    });
    await page.waitForTimeout(700);
    // сдвигаем диалог и загружаем сохранение
    const cont = page.locator('[data-testid="dialogue-continue"]');
    if (await isVisible(cont, 1500)) await cont.click();
    await page.evaluate(async () => {
      const g = (window as unknown as { __SF_GAME__?: { loadGame?: () => Promise<boolean> } }).__SF_GAME__;
      if (g?.loadGame) await g.loadGame();
    });
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="dialogue-overlay"]')).toBeVisible({ timeout: 10000 });
    const nodeAfter = await gameEval(page, (g) => g.world.fg?.dlc?.dialogue?.nodeId ?? null);
    expect(nodeAfter).toBe(nodeBefore);
  });
});