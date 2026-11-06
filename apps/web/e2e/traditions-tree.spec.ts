import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, dismissAllOverlays, expectNoErrors, gotoGame } from "./helpers";

const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (n: string): string => SHOTS + n;

test.describe("Традиции · RPG-древо (task-58)", () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(120_000);

  test("корень, 7 ветвей, карточки/линии, зум/пан, клик unlock, перки; 1280×720", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (n?: number) => void } }).__SF_GAME__!;
      if (!g.hasWorld) g.newGame(42);
    });
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 20_000 });
    await dismissAllOverlays(page);
    await page.locator('[data-testid="btn-open-traditions"]').click();
    await expect(page.locator('[data-testid="traditions-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="tradition-tree-canvas"]')).toBeVisible();
    expect(await page.locator('[data-testid^="trad-branch-"]').count()).toBe(7);
    expect(await page.locator('[data-testid^="btn-tradition-"]').count()).toBeGreaterThan(35);
    await expect(page.locator('[data-testid="perks-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="tradition-tree-discovery"]')).toBeVisible();

    // зум/пан
    const zoomText = async (): Promise<string> => (await page.locator('[data-testid="tradtree-zoom"]').innerText()).trim();
    const z0 = await zoomText();
    await page.locator('[data-testid="tradtree-zoom-in"]').click();
    expect(await zoomText()).not.toBe(z0);
    await page.waitForTimeout(150);
    await page.screenshot({ path: shot("traditions-tree-1280.png") });
    await page.locator('[data-testid="tradtree-fit"]').click();

    // выделение другой ветви
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="trad-branch-expansion"]')?.click());
    await expect(page.locator('[data-testid="trad-branch-expansion"]')).toHaveClass(/sf-tradbranch--on/);

    // клик по узлу = unlock (даём единство и открываем корневой узел discovery)
    const unlocked = await page.evaluate(() => {
      const g = (window as unknown as {
        __SF_GAME__?: {
          world: { playerEmpireId: number; empires: Array<{ id: number; resources: Record<string, number> }> };
          toast?: (t: string) => void;
        };
      }).__SF_GAME__;
      if (!g) return false;
      const emp = g.world.empires.find((e) => e.id === g.world.playerEmpireId);
      if (!emp) return false;
      emp.resources.unity = Math.max(emp.resources.unity ?? 0, 20_000);
      g.toast?.("unity");
      return true;
    });
    expect(unlocked).toBe(true);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-tradition-dis_1"]')?.click());
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { world: { playerEmpireId: number; fg: { empires?: Record<number, { traditions: { unlocked: string[] } }> } } } }).__SF_GAME__;
      const adv = g?.world.fg.empires?.[g.world.playerEmpireId];
      return { opened: adv?.traditions.unlocked.includes("dis_1") ?? false };
    });
    expect(state.opened, "node dis_1 unlocked").toBe(true);
    await expect(page.locator('[data-testid="btn-tradition-dis_1"]')).toHaveClass(/sf-tradnode--unlocked/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expectNoErrors(diag);
  });
});
