/**
 * E2E торгового цикла M8: док → купля/продажа на рынке станции → лимитный ордер →
 * биржа CR↔энергия → торговый маршрут (если доступен) → контракт → награда.
 * Seed 42, production preview, Chrome/WebGL2. Недоступные срезу шаги помечаются skip-аннотацией.
 */
import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, gotoGame, isVisible, dismissDialogueOverlay } from "./helpers";

const shotsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");

test.use({ trace: "off", video: "off" });

type GameHandle = {
  getState(): { mode: string; paused: boolean; activeStationId: number | null; selectedSystemId: number | null };
  setSpeed?(n: number): void;
  setBattleReport?(report: null): void;
  setOverlay?(id: "none"): void;
  getPlayerEmpire(): { id: number; resources: Record<string, number>; flagshipFleetId: number };
  world: {
    systems: Array<{ id: number; station: { id: number } | null; links: number[] }>;
    fleets: Array<{ id: number; empireId: number; systemId: number; ships: unknown[] }>;
    fg?: {
      contracts: Array<{
        id: number; accepted: boolean; completed: boolean; failed: boolean;
        objectives: Array<{ type: string; targetSystemId?: number; progress?: number; count?: number }>;
        rewards: { credits: number };
      }>;
      routes: unknown[];
      exchange: { orders: unknown[]; volume: number; history: unknown[] };
    };
  };
  sendCommand(cmd: unknown): boolean;
  advance(ms: number): void;
};

async function gameEval<T>(page: Page, fn: (g: GameHandle) => T): Promise<T> {
  return page.evaluate((src) => {
    const g = (window as unknown as { __SF_GAME__?: GameHandle }).__SF_GAME__;
    if (!g) throw new Error("window.__SF_GAME__ недоступен");
    // eslint-disable-next-line no-new-func
    return new Function("g", "return (" + src + ")(g)")(g) as T;
  }, fn.toString());
}

/** Закрыть авто-паузы/оверлеи (отчёт боя, событие кампании), появившиеся во время прокрутки тактов. */
async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const battle = page.locator('[data-testid="btn-close-battle"], [data-testid="btn-close-battle-footer"]');
    if (await isVisible(battle, 300)) { await battle.first().click(); await page.waitForTimeout(200); continue; }
    const later = page.locator('[data-testid="btn-later-event"]');
    if (await isVisible(later, 300)) { await later.click(); await page.waitForTimeout(200); continue; }
    const modal = page.locator('[data-testid="overlays-root"]');
    if (await isVisible(modal, 300)) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); continue; }
    break;
  }
}

async function resources(page: Page): Promise<{ credits: number; energy: number }> {
  return gameEval(page, (g) => {
    const e = g.getPlayerEmpire();
    return { credits: e.resources.credits, energy: e.resources.energy };
  });
}

test.describe("M8 · торговый цикл и контракты", () => {
  test.setTimeout(180_000);

  test("док → торговля → ордер → биржа → маршрут → контракт → награда", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    if (await isVisible(page.locator(SEL.menu), 8000)) {
      const seed = page.locator('[data-testid="input-seed"]');
      if (await isVisible(seed, 1500)) await seed.fill("42"); // детерминированная галактика/контракты
      await page.getByRole("button", { name: /Новая кампания/i }).click();
    }
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
    await dismissDialogueOverlay(page);
    await page.waitForTimeout(800);
    await dismissDialogueOverlay(page); // DLC XIV

    // --- док через инспектор ---
    const dock = page.locator('[data-testid="btn-dock"]');
    await expect(dock).toBeVisible({ timeout: 8000 });
    await dock.click();
    await expect(page.locator(SEL.station)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="market-row-energy"]')).toBeVisible({ timeout: 10_000 });
    const before = await resources(page);

    // --- 1) купля/продажа на рынке станции (UI) ---
    const qtyEnergy = page.locator('[data-testid="qty-energy"]');
    await qtyEnergy.fill("10");
    await page.locator('[data-testid="btn-buy-energy"]').click();
    await expect.poll(async () => (await resources(page)).energy, { timeout: 8000 }).toBe(before.energy + 10);
    const afterBuy = await resources(page);
    expect(afterBuy.credits).toBeLessThan(before.credits);

    // после сделки UI сбрасывает количество — выставляем 10 снова
    await page.locator('[data-testid="qty-energy"]').fill("10");
    await page.locator('[data-testid="btn-sell-energy"]').click();
    // тик идёт параллельно (+18/turn), поэтому точное равенство неверно: продали 10, доход добавился
    await expect.poll(async () => (await resources(page)).energy, { timeout: 8000 }).toBeLessThanOrEqual(afterBuy.energy - 5);
    const afterSell = await resources(page);
    expect(afterSell.energy).toBeLessThan(afterBuy.energy);
    expect(afterSell.credits).toBeGreaterThan(afterBuy.credits);
    expect(afterSell.credits).toBeLessThan(before.credits); // round-trip со спредом/комиссией убыточен
    console.log("[market] buy/sell energy: credits " + before.credits + " -> " + afterBuy.credits + " -> " + afterSell.credits);
    await page.screenshot({ path: path.join(shotsDir, "17-station-market.png") });

    // --- 2) лимитный ордер на станции (вкладка «Торговля» → MarketPanel) ---
    await page.locator('[data-testid="tab-trade"]').click();
    await expect(page.locator('[data-testid="market-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="order-book"]')).toBeVisible({ timeout: 8000 });
    await page.locator('[data-testid="select-order-good"]').selectOption("energy");
    await page.locator('[data-testid="select-order-side"]').selectOption("buy");
    await page.locator('[data-testid="input-order-price"]').fill("90");
    await page.locator('[data-testid="input-order-qty"]').fill("10");
    await page.locator('[data-testid="btn-place-order"]').click();
    await expect.poll(async () => page.locator('[data-testid^="my-order-"]').count(), { timeout: 8000 }).toBeGreaterThan(0);
    const orderCount = await page.locator('[data-testid^="my-order-"]').count();
    await page.locator('[data-testid^="btn-order-cancel-"]').first().click();
    await expect.poll(async () => page.locator('[data-testid^="my-order-"]').count(), { timeout: 8000 }).toBeLessThan(orderCount);
    console.log("[market] limit order placed/cancelled");

    // --- 3) биржа CR↔энергия ---
    await page.locator('[data-testid="btn-market-tab-exchange"]').click();
    await expect(page.locator('[data-testid="exchange-panel"]')).toBeVisible({ timeout: 8000 });
    const exBefore = await gameEval(page, (g) => ({
      volume: g.world.fg?.exchange.volume ?? 0,
      history: g.world.fg?.exchange.history.length ?? 0,
      credits: g.getPlayerEmpire().resources.credits,
      energy: g.getPlayerEmpire().resources.energy,
    }));
    await page.locator('[data-testid="input-exchange-qty"]').fill("10");
    await page.locator('[data-testid="btn-exchange-buy"]').click();
    // биржа может исполнять лимитный ордер сразу (встречный поток) либо ставить в стакан —
    // фиксируем любое наблюдаемое изменение: объём, история курса или баланс игрока.
    await expect.poll(async () => gameEval(page, (g) => {
      const fg = g.world.fg;
      const e = g.getPlayerEmpire();
      const volume = fg?.exchange.volume ?? 0;
      const history = fg?.exchange.history.length ?? 0;
      const orderCount = fg?.exchange.orders.length ?? 0;
      return volume > 0 || history > exBefore.history || orderCount > 0
        || e.resources.credits !== exBefore.credits || e.resources.energy !== exBefore.energy;
    }), { timeout: 8000 }).toBe(true);
    const exAfter = await gameEval(page, (g) => ({
      volume: g.world.fg?.exchange.volume ?? 0,
      orders: g.world.fg?.exchange.orders.length ?? 0,
      history: g.world.fg?.exchange.history.length ?? 0,
    }));
    console.log("[market] exchange: volume=" + exAfter.volume + " orders=" + exAfter.orders + " history=" + exAfter.history);

    // --- 4) торговый маршрут ---
    await page.locator('[data-testid="btn-market-tab-routes"]').click();
    await expect(page.locator('[data-testid="routes-panel"]')).toBeVisible({ timeout: 8000 });
    const routeBtn = page.locator('[data-testid="btn-route-create"]');
    const routeEnabled = await routeBtn.isEnabled().catch(() => false);
    if (routeEnabled) {
      const routesBefore = await gameEval(page, (g) => g.world.fg?.routes.length ?? 0);
      await page.locator('[data-testid="input-route-qty"]').fill("5");
      await routeBtn.click();
      await expect.poll(async () => gameEval(page, (g) => g.world.fg?.routes.length ?? 0), { timeout: 8000 }).toBeGreaterThan(routesBefore);
      console.log("[market] route created");
    } else {
      const reason = await routeBtn.getAttribute("title");
      test.info().annotations.push({ type: "route-skip", description: "маршрут недоступен на старте: " + (reason ?? "disabled") });
      console.log("[market] route skipped: " + reason);
    }

    // --- 5) контракт: принять и выполнить → награда ---
    // В доке такт заморожен, пул контрактов генерируется contractsPhase раз в 10 тактов:
    // отстыковываемся, прокручиваем 150 тактов, снова стыкуемся и открываем контракты.
    await page.locator('[data-testid="btn-undock"]').click();
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { advance(ms: number): void; setSpeed(n: number): void } }).__SF_GAME__;
      if (g) { g.setSpeed(1); for (let i = 0; i < 150; i++) g.advance(1000); }
    });
    await dismissOverlays(page);
    await page.locator('[data-testid="btn-dock"]').click();
    await expect(page.locator(SEL.station)).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="tab-contracts"]').click();
    await expect(page.locator('[data-testid="contracts-panel"]')).toBeVisible({ timeout: 10_000 });
    const contract = await gameEval(page, (g) => {
      const fg = g.world.fg;
      const player = g.getPlayerEmpire();
      const fleet = g.world.fleets.find((f) => f.empireId === player.id && f.ships.length > 0);
      const candidates = (fg?.contracts ?? []).filter((c) => !c.accepted && !c.completed && !c.failed
        && c.objectives.some((o) => o.type === "dock" || o.type === "jump" || o.type === "deliver"));
      // Приоритет — dock/jump (не требуют груза); deliver только как fallback.
      const c = candidates.find((x) => x.objectives.some((o) => o.type === "dock" || o.type === "jump")) ?? candidates[0];
      if (!c) return null;
      return { id: c.id, target: c.objectives[0]?.targetSystemId ?? null, reward: c.rewards.credits, fleetId: fleet?.id ?? null };
    });
    expect(contract, "нет доступного контракта dock/jump/deliver").not.toBeNull();
    const creditsBeforeContract = (await resources(page)).credits;
    await page.locator('[data-testid="btn-contract-accept-' + contract!.id + '"]').click();
    await expect.poll(async () => gameEval(page, (g) => (g.world.fg?.contracts ?? []).filter((c) => c.accepted).length), { timeout: 8000 }).toBeGreaterThan(0);
    // выполнить: отправить флагман в целевую систему и прокрутить такты (контракты проверяются в фазе такта)
    // выполнить: отстыковаться (в доке такт заморожен), отправить флагман в целевую систему,
    // прокрутить такты — contractsPhase засчитает прибытие и выдаст награду.
    await page.locator('[data-testid="btn-undock"]').click();
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 10_000 });
    await dismissOverlays(page);
    const completion = await gameEval(page, (g) => {
      const player = g.getPlayerEmpire();
      (g as unknown as { setSpeed(n: number): void }).setSpeed(1);
      const fg = g.world.fg;
      const c = (fg?.contracts ?? []).find((x) => x.accepted && !x.completed);
      if (!c) return { ok: false, why: "contract not accepted" };
      const objective = c.objectives[0];
      const target = objective?.targetSystemId ?? null;
      const fleet = g.world.fleets.find((f) => f.id === player.flagshipFleetId) ?? g.world.fleets.find((f) => f.empireId === player.id && f.ships.length > 0);
      if (!fleet) return { ok: false, why: "no fleet" };
      const fleetStart = fleet.systemId;
      let cmdOk = null;
      if (target != null && fleet.systemId !== target) cmdOk = g.sendCommand({ type: "move_fleet", fleetId: fleet.id, systemId: target });
      let ticks = 0;
      for (let i = 0; i < 500 && !c.completed && !c.failed; i++) {
        g.advance(1000);
        ticks++;
        // бой/событие ставят авто-паузу — снимаем, иначе флот «зависает» в пути
        if (g.getState().paused) { g.setBattleReport?.(null); g.setOverlay?.("none"); g.setSpeed?.(1); }
      }
      return {
        ok: c.completed,
        why: c.completed ? "completed" : c.failed ? "failed" : "not completed",
        objectiveType: objective?.type ?? null, target, fleetStart, fleetNow: fleet.systemId, cmdOk, ticks,
        progress: objective?.progress ?? null, count: objective?.count ?? null,
        credits: player.resources.credits,
      };
    });
    console.log("[market] contract completion debug: " + JSON.stringify(completion));
    expect(completion.ok, "контракт не завершён: " + completion.why).toBe(true);
    const creditsAfterContract = (await resources(page)).credits;
    expect(creditsAfterContract - creditsBeforeContract).toBeGreaterThanOrEqual(Math.floor(contract!.reward * 0.5));
    console.log("[market] contract #" + contract!.id + " completed: credits +" + (creditsAfterContract - creditsBeforeContract) + " (reward " + contract!.reward + ")");
    await page.screenshot({ path: path.join(shotsDir, "18-contract-completed.png") });

    expect(diag.pageErrors, "pageerror: " + diag.pageErrors.join(" | ")).toEqual([]);
  });
});