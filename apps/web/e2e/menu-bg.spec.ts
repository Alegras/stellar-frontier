import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { attachDiagnostics, expectNoErrors, gotoGame } from "./helpers";

const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (n: string): string => SHOTS + n;

test.describe("Главное меню · анимированный фон", () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(90_000);

  test("постер placeholder → GIF, object-fit cover, 1280×720", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    await expect(page.locator('[data-testid="main-menu"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="menu-bg"]')).toBeVisible();
    const poster = page.locator('[data-testid="menu-bg-poster"]');
    const gif = page.locator('[data-testid="menu-bg-gif"]');
    await expect(poster).toBeVisible();
    // оба ассета отдаются и декодируются
    for (const url of ["/menu/stellar-battle-poster.png", "/menu/stellar-battle.gif"]) {
      const res = await page.request.get(url);
      expect(res.status(), url).toBe(200);
      expect((await res.body()).length, url).toBeGreaterThan(20_000);
    }
    await expect.poll(async () => gif.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0), { timeout: 15_000 }).toBe(true);
    await expect(gif).toHaveClass(/sf-menu-bg__gif--ready/);
    // вписан как фон без искажений
    const fit = await gif.evaluate((el) => getComputedStyle(el).objectFit);
    expect(fit).toBe("cover");
    await page.screenshot({ path: shot("menu-bg-1280.png") });
    expectNoErrors(diag);
  });

  test("prefers-reduced-motion: остаётся только постер", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoGame(page);
    await expect(page.locator('[data-testid="main-menu"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="menu-bg-poster"]')).toBeVisible();
    await expect(page.locator('[data-testid="menu-bg-gif"]')).toBeHidden();
    await page.screenshot({ path: shot("menu-bg-reduced-1280.png") });
  });
});
