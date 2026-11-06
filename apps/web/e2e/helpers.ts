/**
 * Общие хелперы e2e. Селекторы: сначала data-testid (контракт UI), затем текстовые
 * фолбэки — чтобы тесты не падали из-за отсутствующего testid, но фиксировали пробел.
 */
import { expect, type ConsoleMessage, type Locator, type Page } from "@playwright/test";

export const SEL = {
  canvas: '[data-testid="game-canvas"]',
  menu: '[data-testid="main-menu"]',
  newGame: '[data-testid="btn-new-game"]',
  topBar: '[data-testid="top-bar"]',
  tick: '[data-testid="tick-counter"]',
  resourceEnergy: '[data-testid="resource-energy"]',
  resourceMinerals: '[data-testid="resource-minerals"]',
  systemInspector: '[data-testid="system-inspector"]',
  enterSystem: '[data-testid="btn-enter-system"]',
  flightHud: '[data-testid="flight-hud"]',
  exitToMap: '[data-testid="btn-exit-map"]',
  save: '[data-testid="btn-save"]',
  station: '[data-testid="station-screen"]',
  battle: '[data-testid="battle-overlay"]',
  mapLabel: '[data-testid="map-label"]',
} as const;

export interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
}

const IGNORED_CONSOLE: RegExp[] = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[vite\] connect/i,
  /React Router Future Flag/i,
];

export function attachDiagnostics(page: Page): Diagnostics {
  const diag: Diagnostics = { consoleErrors: [], pageErrors: [] };
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const url = msg.location().url ?? "";
    if (IGNORED_CONSOLE.some((re) => re.test(text) || re.test(url))) return;
    if (/Failed to load resource/i.test(text) && /favicon/i.test(url)) return;
    diag.consoleErrors.push(url ? `${text} @ ${url}` : text);
  });
  page.on("pageerror", (err: Error) => {
    diag.pageErrors.push(err.message);
  });
  return diag;
}

/** Открыть игру и дождаться непустого DOM (меню или canvas). */
export async function gotoGame(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 20, undefined, { timeout: 30_000 });
}

export async function isVisible(locator: Locator, timeout = 2_000): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

/** Первый видимый локатор из списка; бросает понятную ошибку, если ни один не виден. */
export async function waitForAny(
  page: Page,
  locators: Locator[],
  timeout: number,
  label: string,
): Promise<Locator> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const loc of locators) {
      if (await isVisible(loc, 300)) return loc.first();
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`Не дождались ни одного селектора: ${label} (${timeout}мс)`);
}

export async function clickAny(page: Page, locators: Locator[], timeout: number, label: string): Promise<void> {
  const loc = await waitForAny(page, locators, timeout, label);
  await loc.click();
}

/** Кнопка по testid или по тексту. */
export function btnOrText(page: Page, testId: string, text: RegExp): Locator[] {
  return [page.locator(`[data-testid="${testId}"]`), page.getByRole("button", { name: text })];
}

/**
 * DLC XIV: story-диалог автооткрывается на первом тике и перекрывает базовый UI.
 * Базовые e2e закрывают его, если сценарий не про диалоги.
 */
/**
 * Закрывает все авто-оверлеи (бой/событие/диалог/мировая политика), появившиеся за тики.
 * Используется спеками, которые прокручивают время и затем кликают базовый UI.
 */
export async function dismissAllOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const closed = await page.evaluate(() => {
      const click = (sel: string): boolean => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return false;
        el.click();
        return true;
      };
      return click('[data-testid="btn-close-battle"]') || click('[data-testid="btn-close-battle-footer"]')
        || click('[data-testid="btn-later-event"]') || click('[data-testid="btn-later-ai-event"]')
        || click('[data-testid="dialogue-close"]');
    });
    if (closed) { await page.waitForTimeout(180); continue; }
    if (await page.locator('[data-testid="overlays-root"]').count()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);
      continue;
    }
    break;
  }
}

export async function dismissDialogueOverlay(page: Page): Promise<void> {
  // DLC-диалог может открыться чуть позже старта: опрашиваем ~1.2 с и закрываем,
  // попутно убирая модалку сюжетного события, если она перехватывает клики.
  const deadline = Date.now() + 1200;
  while (Date.now() < deadline) {
    const overlay = page.locator('[data-testid="dialogue-overlay"]');
    if (await overlay.count()) {
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="dialogue-close"]')?.click());
      await page.waitForTimeout(150);
      continue;
    }
    if (await page.locator('[data-testid="narrative-event"]').count()) {
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-later-event"]')?.click());
      await page.waitForTimeout(150);
      continue;
    }
    if (await page.locator('[data-testid="ai-world-event"]').count()) {
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="btn-later-ai-event"]')?.click());
      await page.waitForTimeout(150);
      continue;
    }
    if ((await overlay.count()) === 0 && !(await page.locator('[data-testid="narrative-event"]').count())) {
      await page.waitForTimeout(100);
      if ((await overlay.count()) === 0) return;
    }
  }
}

/** Закрыть авто-диалог DLC Части XIV (такт 0): его backdrop перехватывает клики старых тестов. */
export async function dismissDlcDialogue(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (!(await isVisible(page.locator('[data-testid="dialogue-overlay"]'), 400))) return;
    const close = page.locator('[data-testid="dialogue-close"]');
    if (await isVisible(close, 400)) await close.evaluate((el) => (el as HTMLElement).click());
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
}

/** Запуск кампании: либо уже в игре, либо жмём «Новая кампания» в меню. */
export async function ensureGame(page: Page): Promise<void> {
  if (await isVisible(page.locator(SEL.topBar), 1_000)) return;
  if (await isVisible(page.locator(SEL.menu), 10_000)) {
    await clickAny(page, btnOrText(page, "btn-new-game", /Новая кампания/i), 10_000, "btn-new-game");
  }
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  await dismissDialogueOverlay(page);
}

export function canvasLocator(page: Page): Locator {
  return page
    .locator(`${SEL.canvas}, canvas.sf-canvas, canvas`)
    .first();
}

export interface CanvasInfo {
  width: number;
  height: number;
  gl: boolean;
  version: string | null;
  renderer: string | null;
}

/** Состояние canvas + реальный WebGL-контекст (getContext возвращает уже созданный контекст). */
export async function canvasInfo(page: Page): Promise<CanvasInfo | null> {
  return page.evaluate(() => {
    const c =
      document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]') ??
      document.querySelector<HTMLCanvasElement>("canvas");
    if (!c) return null;
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    return {
      width: c.width,
      height: c.height,
      gl: gl !== null,
      version: gl ? String(gl.getParameter(gl.VERSION)) : null,
      renderer: gl ? String(gl.getParameter(gl.RENDERER)) : null,
    };
  });
}

/** Клик по центру canvas — выбор системы на карте. */
export async function clickCanvasCenter(page: Page): Promise<void> {
  const canvas = canvasLocator(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas без boundingBox");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
}

/**
 * Выделить систему: клик по первой метке карты, иначе по центру canvas.
 * Возвращает true, если использовалась метка [data-testid=map-label].
 */
export async function selectSystem(page: Page): Promise<boolean> {
  const labels = page.locator(`${SEL.mapLabel}, [data-testid="system-label"]`);
  if (await isVisible(labels, 2_000)) {
    await labels.first().click();
    return true;
  }
  await clickCanvasCenter(page);
  return false;
}

/**
 * Ждём, пока закроется Vite error overlay (появляется, когда другой агент в этот момент
 * сохранил некомпилирующийся файл). В нормальном CI-прогоне его не бывает.
 */
export async function waitViteClear(page: Page, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const overlay = page.locator("vite-error-overlay");
    if (!(await isVisible(overlay, 300))) return;
    await page.waitForTimeout(400);
  }
  const text = await page.evaluate(() => document.querySelector("vite-error-overlay")?.shadowRoot?.textContent?.slice(0, 300) ?? "");
  throw new Error("Vite error overlay не исчез за " + timeout + "мс: " + text);
}

/** Убрать Vite overlay принудительно (только для скриншотов, не для приёмочных проверок). */
export async function removeViteOverlay(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("vite-error-overlay"));
    els.forEach((el) => el.remove());
    return els.length > 0;
  });
}

/** Диагностика: упасть, если были ошибки консоли/страницы. */
export function expectNoErrors(diag: Diagnostics): void {
  expect(diag.pageErrors, "pageerror: " + diag.pageErrors.join(" | ")).toEqual([]);
  expect(diag.consoleErrors, "console.error: " + diag.consoleErrors.join(" | ")).toEqual([]);
}