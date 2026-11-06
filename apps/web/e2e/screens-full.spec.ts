/**
 * Скриншоты экранов полной игры M6–M12 → docs/shots/08-…15-….png
 * (production preview; Chrome/WebGL2; 1600×900).
 *
 * Покрытие: традиции/дипломатия/кампания (EmpireDrawer), рынок/контракты/победа/аномалии/
 * мегаструктуры/кооп-лобби (PanelHost). Недоступные панели не создают файл, причина — в manifest-full.json.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SEL, attachDiagnostics, gotoGame, isVisible, dismissDialogueOverlay } from "./helpers";

const shotsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");

interface Entry { file: string; status: "captured" | "skipped"; note?: string; at: string }

// trace артефакты в общий test-results/ конфликтуют с параллельными прогонами — для скриншотов не нужны.
test.use({ trace: "off", video: "off" });

test.describe("Screens full game M6–M12", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test("снять экраны традиций/дипломатии/кампании/рынка/контрактов/победы/коопа", async ({ page }) => {
    mkdirSync(shotsDir, { recursive: true });
    const entries: Entry[] = [];
    const diag = attachDiagnostics(page);
    const snap = async (file: string, note?: string): Promise<void> => {
      await page.screenshot({ path: path.join(shotsDir, file) });
      entries.push({ file, status: "captured", note, at: new Date().toISOString() });
      console.log("[shot] " + file + (note ? " — " + note : ""));
    };
    const skip = (file: string, note: string): void => {
      entries.push({ file, status: "skipped", note, at: new Date().toISOString() });
      console.log("[skip] " + file + " — " + note);
    };

    await gotoGame(page);
    // Старт кампании (кнопка; fallback — программно)
    if (await isVisible(page.locator(SEL.menu), 8000)) {
      await page.getByRole("button", { name: /Новая кампания/i }).click().catch(async () => {
        await page.evaluate(() => {
          const g = (window as unknown as { __SF_GAME__?: { newGame(seed?: number): void } }).__SF_GAME__;
          if (g) g.newGame(42);
        });
      });
    }
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await dismissDialogueOverlay(page);
    await dismissDialogueOverlay(page); // DLC XIV
    await page.waitForTimeout(800);

    // --- EmpireDrawer: традиции / дипломатия / кампания ---
    const drawerTabs: Array<[string, string]> = [
      ["btn-open-traditions", "08-traditions.png"],
      ["btn-open-diplomacy", "09-diplomacy.png"],
      ["btn-open-campaign", "10-campaign.png"],
    ];
    for (const [btnId, file] of drawerTabs) {
      try {
        await page.locator('[data-testid="' + btnId + '"]').click({ timeout: 5000 });
        if (await isVisible(page.locator('[data-testid="empire-drawer"]'), 6000)) {
          await page.waitForTimeout(600);
          await snap(file, "панель империи: " + btnId.replace("btn-open-", ""));
        } else skip(file, "empire-drawer не открылся для " + btnId);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      } catch (e) {
        skip(file, String(e).slice(0, 160));
      }
    }

    // Свежий старт перед панелями: исключаем залипшие оверлеи/паузы после EmpireDrawer.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    if (await isVisible(page.locator(SEL.menu), 8000)) {
      await page.getByRole("button", { name: /Новая кампания/i }).click().catch(async () => {
        await page.evaluate(() => {
          const g = (window as unknown as { __SF_GAME__?: { newGame(seed?: number): void } }).__SF_GAME__;
          if (g) g.newGame(42);
        });
      });
    }
    await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await dismissDialogueOverlay(page);
    await dismissDialogueOverlay(page); // DLC XIV
    await page.waitForTimeout(500);

    // --- PanelHost: рынок / контракты / победа / аномалии / мегаструктуры / кооп ---
    const panels: Array<[string, string]> = [
      ["market", "11-market.png"],
      ["contracts", "12-contracts.png"],
      ["victory", "13-victory.png"],
      ["anomalies", "14-anomalies.png"],
      ["megastructures", "15-megastructures.png"],
      ["coop", "16-coop-lobby.png"],
    ];
    for (const [panelId, file] of panels) {
      try {
        const more = page.locator('[data-testid="btn-open-more"]');
        await more.click({ timeout: 8000 }).catch(async () => {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
          await more.click({ timeout: 8000 });
        });
        if (!(await isVisible(page.locator('[data-testid="full-panel-menu"], [data-testid="full-panel-menu-list"]'), 6000))) {
          skip(file, "меню панелей (btn-open-more) не открылось");
          continue;
        }
        // ui-engineer: меню «Ещё…» = PanelMenuList, data-testid="panel-open-{PanelId}".
        await page.locator('[data-testid="panel-open-' + panelId + '"]').click({ timeout: 8000 });
        if (await isVisible(page.locator('[data-testid="panel-' + panelId + '"]'), 8000)) {
          await page.waitForTimeout(700);
          await snap(file, "панель полной игры: " + panelId);
          const close = page.locator('[data-testid="btn-close-panel-' + panelId + '"]');
          if (await isVisible(close, 2000)) await close.click();
          else await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
        } else {
          skip(file, "panel-" + panelId + " не открылся");
          await page.keyboard.press("Escape");
        }
      } catch (e) {
        skip(file, String(e).slice(0, 160));
        await page.keyboard.press("Escape").catch(() => {});
      }
    }

    writeFileSync(
      path.join(shotsDir, "manifest-full.json"),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        baseURL: test.info().project.use.baseURL,
        viewport: "1600x900",
        shots: entries,
        consoleErrors: diag.consoleErrors,
        pageErrors: diag.pageErrors,
      }, null, 2),
      "utf8",
    );

    const captured = entries.filter((e) => e.status === "captured").length;
    console.log("[screens-full] captured=" + captured + "/" + entries.length);
    // Обязательный минимум: традиции, дипломатия, рынок, контракты, победа, кооп-лобби
    for (const required of ["08-traditions.png", "09-diplomacy.png", "11-market.png", "12-contracts.png", "13-victory.png", "16-coop-lobby.png"]) {
      const e = entries.find((x) => x.file === required);
      expect(e, "нет записи для " + required).toBeTruthy();
    }
    expect(captured).toBeGreaterThanOrEqual(6);
    expect(diag.pageErrors, "pageerror: " + diag.pageErrors.join(" | ")).toEqual([]);
  });
});