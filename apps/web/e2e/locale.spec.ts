import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dismissDialogueOverlay } from "./helpers";

// Скриншоты всегда в docs/shots репозитория (независимо от cwd запуска e2e).
const SHOTS = fileURLToPath(new URL("../../../docs/shots/", import.meta.url));
const shot = (name: string): string => SHOTS + name;
import { attachDiagnostics, expectNoErrors, gotoGame } from "./helpers";

/**
 * Локализация: RU — дефолт и основной язык; EN — опция.
 * Проверяем:
 *  - RU-экраны без англоязычных подписей (кроме канонических FP/FSD/Mk/CR/L1–L3/SYS/ENG/WEP
 *    и названия игры STELLAR FRONTIER, клавиш и служебных терминов);
 *  - переход RU→EN без перезагрузки: панели/станция/меню на EN без кириллицы;
 *  - обратно EN→RU: возвращается кириллица и снова нет английских подписей.
 */
const CYR = /[А-Яа-яЁё]/;
const ALLOWED_EN = [
  "STELLAR FRONTIER", "FP", "FSD", "Mk", "CR", "L1", "L2", "L3", "SYS", "ENG", "WEP",
  "MMO", "IndexedDB", "English", "Space", "Esc", "Tab", "Shift", "F1", "F5", "F9",
  "Q", "W", "A", "S", "D", "C", "J", "G", "X", "Z", "M", "V", "E", "I", "U", "F", "P", "K",
];

function stripAllowed(line: string): string {
  let out = line;
  for (const token of ALLOWED_EN) out = out.split(token).join(" ");
  out = out.replace(/\b[A-Za-z]\b/g, " "); // одиночные латинские буквы — клавиши/иконки
  out = out.replace(/[0-9]+[×x][0-9]+/g, " ");
  return out;
}

async function cyrLines(page: import("@playwright/test").Page, sel: string): Promise<string[]> {
  const text = await page.locator(sel).first().innerText().catch(() => "");
  return text.split("\n").map((s) => s.trim()).filter((s) => s.length > 1 && CYR.test(s));
}

async function englishLines(page: import("@playwright/test").Page, sel: string): Promise<string[]> {
  const text = await page.locator(sel).first().innerText().catch(() => "");
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .map((s) => stripAllowed(s))
    .filter((s) => /[A-Za-z]{2,}/.test(s));
}

async function openPanelMenu(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="btn-open-more"]').click({ timeout: 15_000 });
  await expect(page.locator('[data-testid="full-panel-menu"]')).toBeVisible({ timeout: 10_000 });
}

async function setLocale(page: import("@playwright/test").Page, locale: "en" | "ru"): Promise<void> {
  await openPanelMenu(page);
  await page.locator('[data-testid="panel-open-settings"]').click();
  await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="select-locale"]').selectOption(locale);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="settings-panel"]')).toHaveCount(0, { timeout: 10_000 });
}

test.describe("locale RU default ↔ EN option", () => {
  test.describe.configure({ retries: 1 });

  test("RU→EN→RU без перезагрузки; RU без англоязычных подписей", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoGame(page);

    // ---------- RU (дефолт) ----------
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("ru");
    await expect(page.locator('[data-testid="main-menu"]')).toBeVisible({ timeout: 20_000 });
    expect(await englishLines(page, '[data-testid="main-menu"]')).toEqual([]);
    await page.screenshot({ path: shot("ru-menu.png") });

    // Детерминированный старт через API (HMR от параллельных правок может сбросить DOM).
    await page.evaluate(() => {
      const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (seed?: number) => void } }).__SF_GAME__;
      if (g && !g.hasWorld) g.newGame(12345);
    });
    await expect.poll(() => page.locator('[data-testid="top-bar"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    await dismissDialogueOverlay(page); // DLC story-диалог автооткрывается на старте

    await page.locator('[data-testid="btn-open-traditions"]').click();
    await expect(page.locator('[data-testid="traditions-panel"]')).toBeVisible({ timeout: 10_000 });
    expect(await englishLines(page, '[data-testid="traditions-panel"]')).toEqual([]);
    await page.screenshot({ path: shot("ru-traditions.png") });
    await page.keyboard.press("Escape");

    await page.locator('[data-testid="btn-open-diplomacy"]').click();
    await expect(page.locator('[data-testid="diplomacy-panel"]')).toBeVisible({ timeout: 10_000 });
    expect(await englishLines(page, '[data-testid="diplomacy-panel"]')).toEqual([]);
    await page.screenshot({ path: shot("ru-diplomacy.png") });
    await page.keyboard.press("Escape");

    // станция + рынок
    const dock = page.locator('[data-testid="btn-dock"]');
    if (await dock.count()) {
      await dock.first().click();
      await expect(page.locator('[data-testid="station-screen"]')).toBeVisible({ timeout: 10_000 });
      expect(await englishLines(page, '[data-testid="station-screen"]')).toEqual([]);
      await page.screenshot({ path: shot("ru-station.png") });
      await page.locator('[data-testid="tab-trade"]').click();
      await expect(page.locator('[data-testid="market-panel"]')).toBeVisible({ timeout: 10_000 });
      expect(await englishLines(page, '[data-testid="market-panel"]')).toEqual([]);
      await page.screenshot({ path: shot("ru-market.png") });
      await page.locator('[data-testid="btn-undock"]').first().click();
      await page.waitForTimeout(500);
    }

    // полёт
    const enter = page.locator('[data-testid="btn-enter-system"]');
    if (await enter.count()) {
      await enter.first().click();
      await page.waitForTimeout(1200);
      expect(await englishLines(page, '[data-testid="flight-hud"]')).toEqual([]);
      await page.screenshot({ path: shot("ru-flight.png") });
      await page.locator('[data-testid="btn-exit-map"]').first().click();
      await page.waitForTimeout(500);
    }

    // настройки (панель через меню «Ещё…»)
    await openPanelMenu(page);
    await page.locator('[data-testid="panel-open-settings"]').click();
    await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 10_000 });
    expect(await englishLines(page, '[data-testid="settings-panel"]')).toEqual([]);
    await page.screenshot({ path: shot("ru-settings.png") });
    await page.keyboard.press("Escape");

    // ---------- EN ----------
    await setLocale(page, "en");
    await page.locator('[data-testid="btn-open-traditions"]').click();
    await expect(page.locator('[data-testid="traditions-panel"]')).toBeVisible({ timeout: 10_000 });
    expect(await cyrLines(page, '[data-testid="traditions-panel"]')).toEqual([]);
    await page.screenshot({ path: shot("en-traditions.png") });
    await page.keyboard.press("Escape");

    await page.locator('[data-testid="btn-open-diplomacy"]').click();
    await expect(page.locator('[data-testid="diplomacy-panel"]')).toBeVisible({ timeout: 10_000 });
    expect(await cyrLines(page, '[data-testid="diplomacy-panel"]')).toEqual([]);
    await page.screenshot({ path: shot("en-diplomacy.png") });
    await page.keyboard.press("Escape");

    // ---------- снова RU ----------
    await setLocale(page, "ru");
    await page.locator('[data-testid="btn-open-traditions"]').click();
    await expect(page.locator('[data-testid="traditions-panel"]')).toBeVisible({ timeout: 10_000 });
    expect((await cyrLines(page, '[data-testid="traditions-panel"]')).length).toBeGreaterThan(0);
    expect(await englishLines(page, '[data-testid="traditions-panel"]')).toEqual([]);
    await page.keyboard.press("Escape");

    // RU-меню после перезагрузки (локаль сохраняется)
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    await expect(page.locator('[data-testid="main-menu"]')).toBeVisible({ timeout: 20_000 });
    expect(await englishLines(page, '[data-testid="main-menu"]')).toEqual([]);
    await page.screenshot({ path: shot("ru-menu-reload.png") });

    expectNoErrors(diag);
  });
});
