#!/usr/bin/env node
/**
 * Замер FPS и проверка переходов/стыковки в реальном браузере (Chrome, WebGL2) — M0/M3.
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/measure-fps.mjs [baseURL]
 * По умолчанию http://127.0.0.1:5174 (production preview; dev-сервер тоже подойдёт).
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? process.env.SF_BASE_URL ?? "http://127.0.0.1:5174";
const WINDOW_MS = 3000;
const browser = await chromium.launch({ channel: "chrome", args: [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const started = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  if (!g) return false;
  g.newGame(42);
  return true;
});
if (!started) {
  const btn = page.getByRole("button", { name: /Новая кампания/i });
  if (await btn.isVisible().catch(() => false)) await btn.click();
}
await page.waitForTimeout(2000);

/** Считает кадры через requestAnimationFrame за WINDOW_MS. */
async function measure(label) {
  const r = await page.evaluate(
    (windowMs) => new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      const t0 = last;
      const loop = (now) => {
        frames.push(now - last);
        last = now;
        if (now - t0 >= windowMs) {
          const sum = frames.reduce((a, b) => a + b, 0);
          resolve({
            frames: frames.length,
            avgFps: Math.round((frames.length * 1000) / sum),
            avgFrameMs: Number((sum / frames.length).toFixed(2)),
            maxFrameMs: Number(Math.max(...frames).toFixed(1)),
            p95FrameMs: Number(frames.slice().sort((a, b) => a - b)[Math.floor(frames.length * 0.95)].toFixed(1)),
          });
        } else {
          requestAnimationFrame(loop);
        }
      };
      requestAnimationFrame(loop);
    }),
    WINDOW_MS,
  );
  console.log(label + ": " + JSON.stringify(r));
  return r;
}

const canvasOk = await page.evaluate(() => {
  const c = document.querySelector('canvas[data-testid="game-canvas"]');
  if (!c) return null;
  const gl = c.getContext("webgl2") ?? c.getContext("webgl");
  return { w: c.width, h: c.height, gl: !!gl, version: gl ? String(gl.getParameter(gl.VERSION)) : null };
});
console.log("canvas: " + JSON.stringify(canvasOk));

const map = await measure("FPS карта (L0)");

// Вход в систему и замер в полёте
const enterTiming = await page.evaluate(() => {
  const g = window.__SF_GAME__;
  if (!g) return null;
  const t0 = performance.now();
  const st = g.getState();
  g.enterSystem(st.selectedSystemId ?? undefined);
  return { ms: Math.round(performance.now() - t0), mode: g.getState().mode };
});
await page.waitForTimeout(1500);
console.log("вход в систему: " + JSON.stringify(enterTiming));
const flight = await measure("FPS полёт (L1)");

// Стыковка в полёте: клавиша G (SystemView) — у станции корабль стартует рядом.
await page.keyboard.press("g");
await page.waitForTimeout(1500);
const dockVisible = await page.locator('[data-testid="station-screen"]').isVisible().catch(() => false);
const mode = await page.evaluate(() => window.__SF_GAME__?.getState().mode ?? null);
console.log("стыковка по G: station-screen=" + dockVisible + " mode=" + mode);

// Возврат на карту
await page.evaluate(() => window.__SF_GAME__?.exitToGalaxy());
await page.waitForTimeout(800);
const backMode = await page.evaluate(() => window.__SF_GAME__?.getState().mode ?? null);
console.log("возврат на карту: mode=" + backMode);

const summary = { base, canvas: canvasOk, map, flight, dockVisible, mode, backMode, errors };
console.log("SUMMARY " + JSON.stringify(summary));
await browser.close();
if (errors.length) process.exitCode = 2;
