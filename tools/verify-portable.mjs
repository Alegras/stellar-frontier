#!/usr/bin/env node
/**
 * Проверка портативной сборки (gift): открывает StellarFrontier.html через file://
 * в Chrome, проверяет загрузку без ошибок, WebGL2, старт кампании и снимает скриншот.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/verify-portable.mjs [путь.html]
 * По умолчанию проверяет корневой StellarFrontier.html и gift/StellarFrontier.html (сравнение хэшей).
 */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "StellarFrontier.html");
const giftFile = path.join(ROOT, "gift", "StellarFrontier.html");
const shots = path.join(ROOT, "docs", "shots");
mkdirSync(shots, { recursive: true });

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
let passed = 0;
const pass = (n, d) => { passed++; console.log("PASS " + n + (d ? " — " + d : "")); };
const fail = (n, d) => { console.log("FAIL " + n + (d ? " — " + d : "")); process.exitCode = 1; };

if (!existsSync(target)) { fail("файл сборки", target + " не найден"); process.exit(1); }
console.log("checking " + target + " (" + (readFileSync(target).length / 1048576).toFixed(2) + " MB)");
if (existsSync(giftFile)) {
  if (sha(target) === sha(giftFile)) pass("gift/StellarFrontier.html идентичен корню", "sha256=" + sha(target).slice(0, 16));
  else fail("gift/StellarFrontier.html отличается от корня", "нужно пересобрать make-gift");
} else {
  fail("gift/StellarFrontier.html", "нет файла (make-gift)");
}

const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
try {
  await page.goto(pathToFileURL(target).href, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const menu = page.locator('[data-testid="main-menu"]');
  await menu.waitFor({ timeout: 20000 });
  pass("file://: меню загрузилось");

  const gl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("webgl2") ?? c.getContext("webgl");
    return ctx ? String(ctx.getParameter(ctx.VERSION)) : null;
  });
  if (gl) pass("file://: WebGL доступен", gl); else fail("file://: WebGL", "контекст не создан");
  await page.screenshot({ path: path.join(shots, "portable-file-menu.png") });

  // Часть XIII: выбор расы
  const raceCards = page.locator('[data-testid^="race-card-"]');
  const raceCount = await raceCards.count();
  if (raceCount >= 8) pass("file://: выбор расы", raceCount + " карточек"); else fail("file://: выбор расы", "карточек=" + raceCount);
  const seed = page.locator('[data-testid="input-seed"]');
  if (await seed.isVisible().catch(() => false)) await seed.fill("42");
  // выбранная раса раскрывает карточку меню — кнопка может уйти за фолд, кликаем через DOM
  await page.locator('[data-testid="btn-new-game"]').evaluate((el) => el.click());
  await page.locator('[data-testid="top-bar"]').waitFor({ timeout: 30000 });
  pass("file://: старт кампании (top-bar)");
  const canvas = page.locator('[data-testid="game-canvas"]');
  await canvas.waitFor({ timeout: 15000 });
  const info = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="game-canvas"]');
    return c ? { w: c.width, h: c.height } : null;
  });
  if (info && info.w > 0) pass("file://: canvas отрисован", info.w + "x" + info.h); else fail("file://: canvas", "нет размеров");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, "portable-file-map.png") });

  // Часть XIV: story-диалог DLC открывается на старте
  try {
    await page.locator('[data-testid="dialogue-overlay"]').waitFor({ timeout: 10000 });
    pass("file://: DLC-диалог на старте");
    const close = page.locator('[data-testid="dialogue-close"]');
    if (await close.isVisible().catch(() => false)) await close.evaluate((el) => el.click());
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } catch (e) {
    fail("file://: DLC-диалог на старте", String(e).slice(0, 150));
  }

  // Часть XIV: журнал 4 вкладки
  try {
    await page.locator('[data-testid="btn-open-more"]').first().evaluate((el) => el.click());
    await page.locator('[data-testid="panel-open-journal"]').evaluate((el) => el.click());
    await page.locator('[data-testid="journal-panel"]').waitFor({ timeout: 10000 });
    const tabs = await page.locator('[data-testid^="btn-journal-tab-"]').count();
    if (tabs >= 4) pass("file://: журнал DLC", tabs + " вкладки"); else fail("file://: журнал DLC", "вкладок=" + tabs);
    await page.screenshot({ path: path.join(shots, "portable-file-journal.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } catch (e) {
    fail("file://: журнал DLC", String(e).slice(0, 150));
  }

  // Часть XIII: панель Древних в портативной сборке
  try {
    await page.locator('[data-testid="btn-open-more"]').first().evaluate((el) => el.click());
    await page.locator('[data-testid="panel-open-ancients"]').click();
    await page.locator('[data-testid="ancients-panel"]').waitFor({ timeout: 10000 });
    const tabs = await page.locator('[data-testid^="btn-ancients-tab-"]').count();
    if (tabs >= 5) pass("file://: панель Древних", tabs + " вкладок"); else fail("file://: панель Древних", "вкладок=" + tabs);
    await page.screenshot({ path: path.join(shots, "portable-file-ancients.png") });
    await page.keyboard.press("Escape");
  } catch (e) {
    fail("file://: панель Древних", String(e).slice(0, 200));
  }

  // M5b: арт сетки /battle/** (манифест через fetch-шим + PNG как data URI)
  try {
    const battle = await page.evaluate(async () => {
      const res = await fetch("/battle/manifest.json");
      const man = await res.json();
      const assets = window.__SF_BATTLE_ASSETS__ || {};
      const first = Object.values(assets)[0];
      const img = await new Promise((resolve) => {
        const i = new Image();
        i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
        i.onerror = () => resolve(null);
        i.src = first;
      });
      return { ready: man.ready, tiles: Object.keys(man.tiles ?? {}).length, units: Object.keys(man.units ?? {}).length, effects: Object.keys(man.effects ?? {}).length, bg: Object.keys(man.backgrounds ?? {}).length, assets: Object.keys(assets).length, first: img };
    });
    if ((battle.tiles >= 6 || battle.units >= 2) && battle.assets >= 28 && battle.first && battle.first.w > 0) pass("file://: арт сетки M5b (28+ ассетов, манифест, decode)", "tiles=" + battle.tiles + " units=" + battle.units + " effects=" + battle.effects + " bg=" + battle.bg);
    else fail("file://: арт сетки M5b", JSON.stringify(battle));
  } catch (e) { fail("file://: арт сетки M5b", String(e).slice(0, 160)); }

  const critic = errors.filter((e) => !/favicon|404/i.test(e));
  if (critic.length === 0) pass("file://: без ошибок консоли"); else fail("file://: ошибки консоли", critic.slice(0, 3).join(" | "));
} catch (e) {
  fail("file:// smoke", String(e).slice(0, 300));
} finally {
  await browser.close();
}
console.log("PORTABLE CHECK: " + passed + " проверок PASS" + (process.exitCode ? " (есть FAIL)" : ""));