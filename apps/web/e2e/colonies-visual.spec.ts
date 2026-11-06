import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, dismissAllOverlays, expectNoErrors, gotoGame } from "./helpers";

const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (n: string): string => SHOTS + n;

test.describe("Колонии · 3D-визуал (task-58)", () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(120_000);

  test("орбитальные станции/города на планетах и иконки колоний на лунах; 1280×720", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    const setup = await page.evaluate(() => {
      const g = (window as unknown as {
        __SF_GAME__?: {
          hasWorld: boolean; newGame: (n?: number) => void;
          world: {
            playerEmpireId: number;
            systems: Array<{ id: number; planets: Array<{ id: number; isMoon?: boolean; systemId: number; name: string }> }>;
            colonies: Array<Record<string, unknown>>;
          };
          refresh?: (s?: unknown) => void; toast?: (t: string) => void;
        };
      }).__SF_GAME__;
      if (!g) return null;
      if (!g.hasWorld) g.newGame(42);
      const home = g.world.colonies.find((c) => (c.systemId as number) != null);
      if (!home) return null;
      const systemId = home.systemId as number;
      const sys = g.world.systems.find((s) => s.id === systemId);
      const moon = sys?.planets.find((p) => p.isMoon);
      if (moon) {
        const id = Math.max(0, ...g.world.colonies.map((c) => c.id as number)) + 1;
        g.world.colonies.push({ ...home, id, planetId: moon.id, systemId: moon.systemId, name: "Лунная колония" });
        g.toast?.("moon colony");
      }
      return { systemId, moon: moon?.name ?? null, colonies: g.world.colonies.length };
    });
    expect(setup, "world/colony for flight").not.toBeNull();
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
    await dismissAllOverlays(page);
    await page.evaluate((systemId) => {
      const g = (window as unknown as { __SF_GAME__?: { enterSystem: (id: number) => void } }).__SF_GAME__;
      g?.enterSystem(systemId);
    }, setup!.systemId);
    await expect(page.locator('[data-testid="flight-hud"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="flight-colonies"]')).toBeVisible();
    expect(await page.locator('[data-testid="flight-colonies"] [data-testid^="flight-colony-"]').count()).toBeGreaterThan(0);
    if (setup!.moon) {
      await expect(page.locator('[data-testid="flight-colonies"]').getByText("луна").first()).toBeVisible();
    }
    // WebGL-канвас живой, сцена не падает
    expect(await page.locator("canvas").count()).toBeGreaterThan(0);
    // производительность: сцена с колониями должна выдавать кадры, а не зависать
    const frames = await page.evaluate(() => new Promise<number>((resolve) => {
      const t0 = performance.now();
      let n = 0;
      const step = (): void => {
        n++;
        if (performance.now() - t0 < 500) requestAnimationFrame(step);
        else resolve(n);
      };
      requestAnimationFrame(step);
    }));
    expect(frames).toBeGreaterThan(5);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot("flight-colonies-1280.png") });
    expectNoErrors(diag);
  });
});
