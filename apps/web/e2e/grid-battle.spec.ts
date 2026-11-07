import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, dismissAllOverlays, expectNoErrors, gotoGame } from "./helpers";

const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (n: string): string => SHOTS + n;

async function openGrid(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (n?: number) => void } }).__SF_GAME__!;
    if (!g.hasWorld) g.newGame(42);
  });
  await page.evaluate(() => { try { localStorage.setItem("sf.gridBattle", "1"); } catch { /* noop */ } });
  await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
  await dismissAllOverlays(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sf:grid-battle", { detail: { seed: 7, coop: true } })));
  await expect(page.locator('[data-testid="grid-battle"]')).toBeVisible({ timeout: 10_000 });
}

test.describe("M5b · Сетка командования (UI)", () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(120_000);

  test("S30 расстановка → S31 бой → S32 итог, 1280×720", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    await openGrid(page);
    await expect(page.locator('[data-testid="grid-battle"]')).toHaveAttribute("data-screen", "deploy");
    await expect(page.locator('[data-testid="grid-hex-canvas"]')).toBeVisible();
    expect(await page.locator('[data-testid^="grid-roster-"]').count()).toBe(7);
    await page.screenshot({ path: shot("grid-deploy-1280.png") });

    // авто + формация + бой
    await page.locator('[data-testid="btn-grid-auto"]').click();
    await expect(page.locator('[data-testid="grid-deploy-count"]')).toContainText("7/7");
    await page.locator('[data-testid="btn-grid-fight"]').click();
    await expect(page.locator('[data-testid="grid-battle"]')).toHaveAttribute("data-screen", "battle");
    await expect(page.locator('[data-testid="grid-actions"]')).toBeVisible();
    await expect(page.locator('[data-testid="grid-log"]')).toBeVisible();
    await page.screenshot({ path: shot("grid-battle-1280.png") });

    // авто-бой до итога
    await page.locator('[data-testid="btn-grid-auto-battle"]').click();
    await expect(page.locator('[data-testid="grid-result"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="grid-result-losses"]')).toBeVisible();
    await expect(page.locator('[data-testid="grid-parity"]')).toContainText("авторезолв");
    await page.screenshot({ path: shot("grid-result-1280.png") });
    await page.locator('[data-testid="btn-grid-to-map"]').click();
    await expect(page.locator('[data-testid="grid-battle"]')).toHaveCount(0);
    expectNoErrors(diag);
  });

  test("вход с L0: combat-флот в системе → кнопка сетки", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    await page.evaluate(() => { try { localStorage.setItem("sf.gridBattle", "1"); } catch { /* noop */ } });
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (n?: number) => void } }).__SF_GAME__!;
      if (!g.hasWorld) g.newGame(42);
    });
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
    await dismissAllOverlays(page);
    const setup = await page.evaluate(() => {
      const g = (window as unknown as {
        __SF_GAME__?: {
          world: { playerEmpireId: number; empires: Array<{ id: number }>; fleets: Array<Record<string, unknown>>; systems: Array<{ id: number }> };
          selectSystem?: (id: number) => void; refresh?: (s?: unknown) => void;
        };
      }).__SF_GAME__;
      if (!g) return null;
      const playerFleet = g.world.fleets.find((f) => f.empireId === g.world.playerEmpireId && ((f.ships as unknown[])?.length ?? 0) > 0);
      const enemy = g.world.empires.find((e) => e.id !== g.world.playerEmpireId);
      if (!playerFleet || !enemy) return null;
      const maxId = Math.max(0, ...g.world.fleets.map((f) => (f.id as number) ?? 0));
      g.world.fleets.push({ ...playerFleet, id: maxId + 1, empireId: enemy.id, status: "combat" });
      g.selectSystem?.(playerFleet.systemId as number);
      g.refresh?.({});
      return { systemId: playerFleet.systemId as number };
    });
    expect(setup).not.toBeNull();
    const setupData = setup as { systemId: number };
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="btn-grid-battle"]')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: shot("grid-entry-1280.png") });
    await page.locator('[data-testid="btn-grid-battle"]').click();
    await expect(page.locator('[data-testid="grid-battle"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="grid-close"]').click();
    void setupData;
  });

  test("reduced-motion и feature-flag off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    await openGrid(page);
    await page.locator('[data-testid="grid-close"]').click();
    await page.evaluate(() => { try { localStorage.setItem("sf.gridBattle", "0"); } catch { /* noop */ } });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("sf:grid-battle", { detail: { seed: 8 } })));
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="grid-battle"]')).toHaveCount(0);
  });
});