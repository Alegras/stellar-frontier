import { expect, test } from "@playwright/test";
import { attachDiagnostics, dismissDialogueOverlay, expectNoErrors, gotoGame } from "./helpers";

/**
 * Конструктор кораблей (task-25): валидный дизайн → сохранить → построить;
 * невалидная конфигурация блокируется, доступность (fieldset/labels/alert).
 */
async function startAndDock(page: import("@playwright/test").Page): Promise<boolean> {
  await gotoGame(page);
  await page.evaluate(() => {
    const g = (window as unknown as { __SF_GAME__?: { hasWorld: boolean; newGame: (seed?: number) => void } }).__SF_GAME__;
    if (g && !g.hasWorld) g.newGame(12345);
  });
  await expect.poll(() => page.locator('[data-testid="top-bar"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await dismissDialogueOverlay(page);
  const dock = page.locator('[data-testid="btn-dock"]');
  if (!(await dock.count())) return false;
  await dock.first().click();
  await expect(page.locator('[data-testid="station-screen"]')).toBeVisible({ timeout: 10_000 });
  return true;
}

async function openDesigner(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="tab-designer"]').click();
  await expect(page.locator('[data-testid="constructor-panel"]')).toBeVisible({ timeout: 10_000 });
}

async function pickOption(page: import("@playwright/test").Page, testId: string, allowEmpty = false): Promise<string | null> {
  const sel = page.locator('[data-testid="' + testId + '"]');
  if (!(await sel.count())) return null;
  const value = await sel.evaluate((el, allow) => {
    const s = el as HTMLSelectElement;
    for (const o of Array.from(s.options)) {
      if (o.disabled) continue;
      if (!allow && !o.value) continue;
      return o.value;
    }
    return "";
  }, allowEmpty);
  if (!value) return null;
  await sel.selectOption(value);
  return value;
}

test.describe("Конструктор кораблей", () => {
  test.describe.configure({ retries: 1 });

  test("валидный дизайн сохраняется и строится; невалидный блокируется", async ({ page }) => {
    const diag = attachDiagnostics(page);
    if (!(await startAndDock(page))) test.skip(true, "нет станции для дока");

    await openDesigner(page);

    // Доступность: секции — fieldset/legend, у селектов есть aria-label, ошибки — role=alert.
    expect(await page.locator('[data-testid="constructor-panel"] fieldset').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid="constructor-panel"] legend').count()).toBeGreaterThan(0);
    const hullAria = await page.locator('[data-testid="select-hull"]').getAttribute("aria-label");
    expect(hullAria && hullAria.length > 0).toBeTruthy();

    // 1) валидная конфигурация: корпус + хотя бы одно оружие в боевой слот
    const hullValue = await pickOption(page, "select-hull");
    expect(hullValue).toBeTruthy();
    const weaponSlot = page.locator('[data-testid^="weapon-slot-"]').first();
    if (await weaponSlot.count()) {
      const opt = await weaponSlot.evaluate((el) => {
        const s = el as HTMLSelectElement;
        for (const o of Array.from(s.options)) if (!o.disabled && o.value) return o.value;
        return "";
      });
      if (opt) await weaponSlot.selectOption(opt);
    }
    await expect(page.locator('[data-testid="design-errors"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('[data-testid="design-valid"]')).toBeVisible({ timeout: 10_000 });

    const rowsBefore = await page.locator('[data-testid^="design-row-"]').count();
    const saveBtn = page.locator('[data-testid="btn-save-design"]');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect.poll(() => page.locator('[data-testid^="design-row-"]').count(), { timeout: 15_000 }).toBeGreaterThan(rowsBefore);

    // 2) постройка сохранённого дизайна
    const buildBtn = page.locator('[data-testid^="btn-build-design-"]').first();
    await expect(buildBtn).toBeVisible({ timeout: 10_000 });
    const bodyBefore = await page.locator("body").innerText();
    await buildBtn.click();
    await expect
      .poll(async () => ((await page.locator("body").innerText()) !== bodyBefore ? "changed" : "same"), { timeout: 10_000 })
      .toBe("changed");
    const after = await page.locator("body").innerText();
    expect(/залож|постро|очеред|корабл|shipyard|queue|laid/i.test(after)).toBeTruthy();

    // 3) невалидно: убираем всё оружие — сохранение блокируется, ошибки видимы
    const weaponSlots = page.locator('[data-testid^="weapon-slot-"]');
    const slotCount = await weaponSlots.count();
    for (let i = 0; i < slotCount; i++) await weaponSlots.nth(i).selectOption("");
    await expect(page.locator('[data-testid="design-errors"]')).toBeVisible({ timeout: 10_000 });
    const errText = await page.locator('[data-testid="design-errors"]').innerText();
    expect(errText.length).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="btn-save-design"]')).toBeDisabled();
    const rowsAfterInvalid = await page.locator('[data-testid^="design-row-"]').count();
    expect(rowsAfterInvalid).toBeGreaterThanOrEqual(rowsBefore + 1);

    expectNoErrors(diag);
  });
});
