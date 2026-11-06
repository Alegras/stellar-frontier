/**
 * Доступность ключевых экранов (1.0): axe-core WCAG 2.0/2.1 A+AA.
 * Сканируются: меню, карта, станция (док), панель рынка полной игры.
 * Отчёт: docs/shots/axe-report.json (violations с impact/help/selector).
 *
 * Гейт: 0 critical-нарушений; serious фиксируются как WARN (и передаются UI-владельцу).
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, gotoGame, isVisible, dismissDialogueOverlay } from "./helpers";

test.use({ trace: "off", video: "off" });

const shotsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
const report: Array<{ screen: string; violations: number; critical: number; serious: number; moderate: number; minor: number; details: Array<{ id: string; impact: string | null; help: string; nodes: number }> }> = [];

async function scan(page: Page, screen: string): Promise<{ critical: number; serious: number }> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const v = results.violations;
  const by = (impact: string) => v.filter((x) => x.impact === impact).length;
  report.push({
    screen,
    violations: v.length,
    critical: by("critical"),
    serious: by("serious"),
    moderate: by("moderate"),
    minor: by("minor"),
    details: v.map((x) => ({ id: x.id, impact: x.impact ?? null, help: x.help, nodes: x.nodes.length })),
  });
  console.log("[axe] " + screen + ": " + v.length + " violations (critical " + by("critical") + ", serious " + by("serious") + ") " + v.map((x) => x.id + "[" + x.impact + "]").join(", "));
  return { critical: by("critical"), serious: by("serious") };
}

test.describe("Accessibility (axe, M11/1.0)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test("меню/карта/станция/рынок — 0 critical, отчёт axe", async ({ page }) => {
    mkdirSync(shotsDir, { recursive: true });
    const diag = attachDiagnostics(page);
    await gotoGame(page);
    await page.waitForTimeout(800);

    if (await isVisible(page.locator(SEL.menu), 8000)) {
      await scan(page, "menu");
      // после выбора расы карточка меню раскрыта — DOM-клик надёжнее actionability
      await page.locator('[data-testid="btn-new-game"]').evaluate((el) => (el as HTMLElement).click());
    }
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await dismissDialogueOverlay(page); // DLC story-диалог перекрывает карту/станцию
    await scan(page, "map");

    // станция через инспектор (btn-dock)
    if (await isVisible(page.locator(SEL.systemInspector), 3000)) {
      const dock = page.locator('[data-testid="btn-dock"]');
      if (await isVisible(dock, 3000)) {
        await dock.click();
        if (await isVisible(page.locator(SEL.station), 8000)) {
          await page.waitForTimeout(700);
          await scan(page, "station");
          const undock = page.locator('[data-testid="btn-undock"]');
          if (await isVisible(undock, 2000)) await undock.click();
          await page.waitForTimeout(500);
        }
      }
    }

    // панель рынка полной игры через «Ещё…» (PanelMenuList)
    const more = page.locator('[data-testid="btn-open-more"]');
    if (await isVisible(more, 3000)) {
      await more.click();
      if (await isVisible(page.locator('[data-testid="full-panel-menu"]'), 4000)) {
        const marketBtn = page.locator('[data-testid="panel-open-market"]');
        if (await isVisible(marketBtn, 3000)) {
          await marketBtn.click();
          if (await isVisible(page.locator('[data-testid="panel-market"]'), 6000)) {
            await page.waitForTimeout(600);
            await scan(page, "market-panel");
            await page.keyboard.press("Escape");
          }
        }
      }
    }

    // панель Древних (Часть XIII)
    if (await isVisible(more, 2000)) {
      await more.click();
      const ancientsBtn = page.locator('[data-testid="panel-open-ancients"]');
      if (await isVisible(ancientsBtn, 3000)) {
        await ancientsBtn.click();
        if (await isVisible(page.locator('[data-testid="ancients-panel"]'), 6000)) {
          await page.waitForTimeout(500);
          await scan(page, "ancients-panel");
          await page.keyboard.press("Escape");
        }
      }
    }

    // keyboard: Tab даёт фокус, Escape закрывает оверлей
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["BUTTON", "INPUT", "SELECT", "A", "TEXTAREA"]).toContain(focused);

    writeFileSync(path.join(shotsDir, "axe-report.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      baseURL: test.info().project.use.baseURL,
      screens: report,
      consoleErrors: diag.consoleErrors,
      pageErrors: diag.pageErrors,
    }, null, 2), "utf8");

    expect(report.length).toBeGreaterThanOrEqual(2);
    for (const r of report) expect(r.critical, r.screen + ": critical a11y violations").toBe(0);
    expect(diag.pageErrors, "pageerror: " + diag.pageErrors.join(" | ")).toEqual([]);
  });
});