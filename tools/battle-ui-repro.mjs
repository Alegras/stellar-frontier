/**
 * battle-ui-repro.mjs — ground truth для багов UI «Сетка командования v2».
 *
 * Только чтение: исходники игры не меняются. Пишет скриншоты в docs/shots/bug-*.png
 * и сырой JSON рядом с собой (tools/battle-ui-repro-raw.json).
 *
 * Запуск из корня репо:
 *   .\node_modules\.bin\tsx.CMD tools\battle-ui-repro.mjs
 * Переменные: SF_BASE_URL (по умолчанию http://127.0.0.1:5173).
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.SF_BASE_URL ?? "http://127.0.0.1:5173";
const SHOTS = fileURLToPath(new URL("../docs/shots/", import.meta.url));
const RAW = fileURLToPath(new URL("./battle-ui-repro-raw.json", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const T0 = Date.now();
const ts = () => Number(((Date.now() - T0) / 1000).toFixed(2));
const log = (...a) => console.log("[" + ts() + "s]", ...a);

const out = {
  script: "battle-ui-repro.mjs",
  base: BASE,
  startedAt: new Date().toISOString(),
  consoleErrors: [],
  consoleWarnings: [],
  pageErrors: [],
  probeA: null,
  probeB: [],
};
function save() {
  try { writeFileSync(RAW, JSON.stringify(out, null, 2)); } catch (e) { log("save failed:", String(e)); }
}

/* ------------------------------------------------------------------ DOM чтение */

function readDom() {
  const gb = document.querySelector('[data-testid="grid-battle"]');
  const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const cards = [...document.querySelectorAll('[data-testid^="grid-roster-"]')].map((el) => ({
    id: el.getAttribute("data-testid"),
    name: el.querySelector(".sf-gridroster__name")?.textContent?.trim() ?? "",
    meta: el.querySelector(".sf-gridroster__meta")?.textContent?.trim() ?? "",
  }));
  const logLines = [...document.querySelectorAll('[data-testid="grid-log"] .sf-panel-body > div > div')].map((d) => d.textContent.trim());
  return {
    screen: gb?.getAttribute("data-screen") ?? null,
    head: txt(".sf-gridbattle__head b"),
    help: txt('[data-testid="grid-help"]'),
    hint: txt('[data-testid="grid-hint"]'),
    endTurnDisabled: document.querySelector('[data-testid="grid-end-turn"]')?.disabled ?? null,
    cards,
    logLines,
    logText: txt('[data-testid="grid-log"]'),
  };
}

/** Полное состояние боя из React-fiber (только чтение; исходники не меняются). */
function readBattleState() {
  const el = document.querySelector('[data-testid="grid-battle"]');
  if (!el) return { error: "no grid-battle element" };
  const fkey = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
  if (!fkey) return { error: "no react fiber key" };
  let f = el[fkey];
  for (let depth = 0; f && depth < 60; depth++, f = f.return) {
    if (typeof f.type !== "function") continue;
    let h = f.memoizedState;
    const vals = [];
    for (let i = 0; h && i < 60; i++, h = h.next) vals.push(h.memoizedState);
    const battle = vals.find((v) => v && typeof v === "object" && Array.isArray(v.stacks) && Array.isArray(v.log));
    if (!battle) continue;
    const screenVal = vals.find((v) => typeof v === "string" && ["deploy", "battle", "result"].includes(v));
    return {
      component: f.type.name || f.type.displayName || "anonymous",
      screen: screenVal ?? null,
      phase: battle.phase,
      round: battle.round,
      maxRounds: battle.maxRounds,
      turnSide: battle.turnSide ?? null,
      activeId: battle.activeId ?? null,
      deploymentCount: battle.deploymentCount,
      log: battle.log.map((e) => "[" + e.round + "] " + e.text),
      stacks: battle.stacks.map((s) => ({
        id: s.id, side: s.side, cls: s.cls, name: s.name,
        hp: Math.round(s.hp), maxHp: s.maxHp, ap: s.ap ?? 2,
        alive: !!s.alive, reserve: !!s.reserve, q: s.q, r: s.r,
      })),
      result: battle.result
        ? { winner: battle.result.winner, losses: battle.result.losses, mvpName: battle.result.mvpName, parity: battle.result.parity }
        : null,
    };
  }
  return { error: "fiber/state not found" };
}

function readResultPanel() {
  const panel = document.querySelector('[data-testid="grid-result"]');
  if (!panel) return null;
  const body = panel.querySelector(".sf-panel-body");
  return {
    title: panel.querySelector(".sf-panel-head span")?.textContent?.trim() ?? null,
    ariaLabel: panel.getAttribute("aria-label"),
    bodyText: body?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    losses: [...panel.querySelectorAll('[data-testid="grid-result-losses"] tbody tr')].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())),
  };
}

function injectRecorder() {
  const rec = { t0: performance.now(), events: [] };
  window.__SF_REC__ = rec;
  const grab = () => {
    const gb = document.querySelector('[data-testid="grid-battle"]');
    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    return {
      screen: gb?.getAttribute("data-screen") ?? null,
      head: txt(".sf-gridbattle__head b"),
      help: txt('[data-testid="grid-help"]'),
      hint: txt('[data-testid="grid-hint"]'),
      endTurnDisabled: document.querySelector('[data-testid="grid-end-turn"]')?.disabled ?? null,
      log: [...document.querySelectorAll('[data-testid="grid-log"] .sf-panel-body > div > div')].map((d) => d.textContent.trim()),
      roster: [...document.querySelectorAll('[data-testid^="grid-roster-"]')].map((el) =>
        (el.querySelector(".sf-gridroster__name")?.textContent?.trim() ?? "") + "|" + (el.querySelector(".sf-gridroster__meta")?.textContent?.trim() ?? "")),
    };
  };
  let last = null;
  const sample = () => {
    const s = grab();
    const ser = JSON.stringify(s);
    if (ser === last) return;
    last = ser;
    rec.events.push({ t: Math.round(performance.now() - rec.t0), ...s });
  };
  sample();
  const obs = new MutationObserver(sample);
  const layer = document.querySelector('[data-testid="grid-battle"]') ?? document.body;
  obs.observe(layer, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-screen", "disabled"] });
  rec.reset = () => { rec.events = []; rec.t0 = performance.now(); last = null; sample(); };
  rec.stop = () => obs.disconnect();
}

/* ------------------------------------------------------------------ хелперы */

function summariseBattle(b) {
  if (!b || b.error) return b;
  return {
    screen: b.screen, phase: b.phase, round: b.round, turnSide: b.turnSide, activeId: b.activeId,
    player: b.stacks.filter((s) => s.side === "player").map((s) => ({ id: s.id, cls: s.cls, name: s.name, hp: s.hp, maxHp: s.maxHp, ap: s.ap, alive: s.alive, reserve: s.reserve, q: s.q, r: s.r })),
    enemy: b.stacks.filter((s) => s.side === "enemy").map((s) => ({ id: s.id, cls: s.cls, name: s.name, hp: s.hp, maxHp: s.maxHp, ap: s.ap, alive: s.alive, reserve: s.reserve, q: s.q, r: s.r })),
    logTail: b.log.slice(-14),
    logLen: b.log.length,
  };
}

function diffLogs(oldLog, newLog) {
  let common = 0;
  while (common < oldLog.length && common < newLog.length && oldLog[common] === newLog[common]) common++;
  if (common === 0 && oldLog.length > 0 && newLog.length > 0) {
    // лог обрезан по 80 — ищем якорь по последней старой записи
    const anchor = oldLog[oldLog.length - 1];
    const idx = newLog.lastIndexOf(anchor);
    if (idx >= 0) common = idx + 1;
  }
  return newLog.slice(common);
}

function parseHp(meta) {
  const m = /HP\s+(\d+)/.exec(meta ?? "");
  return m ? Number(m[1]) : null;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function attachDiagnostics(page, label) {
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    const url = msg.location?.()?.url ?? "";
    if (type === "error") {
      if (/favicon/i.test(text) || /favicon/i.test(url)) return;
      out.consoleErrors.push({ t: ts(), label, text, url });
    } else if (type === "warning") {
      out.consoleWarnings.push({ t: ts(), label, text, url });
    }
  });
  page.on("pageerror", (err) => out.pageErrors.push({ t: ts(), label, text: String(err?.message ?? err) }));
}

async function dismissAllOverlays(page) {
  for (let i = 0; i < 12; i++) {
    const closed = await page.evaluate(() => {
      const click = (sel) => {
        const el = document.querySelector(sel);
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

async function gotoGame(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => document.body.innerText.trim().length > 20, null, { timeout: 30_000 });
}

/** Полный копирайт шагов из задания: деплой → бой. */
async function openBattle(page, seed) {
  await page.evaluate(() => {
    const g = window.__SF_GAME__;
    if (!g.hasWorld) g.newGame(42);
  });
  await page.evaluate(() => { try { localStorage.setItem("sf.gridBattle", "1"); } catch (e) { /* noop */ } });
  await page.locator('[data-testid="top-bar"]').waitFor({ state: "visible", timeout: 30_000 });
  await dismissAllOverlays(page);
  await page.evaluate((s) => window.dispatchEvent(new CustomEvent("sf:grid-battle", { detail: { seed: s, coop: false } })), seed);
  await page.locator('[data-testid="grid-battle"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="grid-battle"]')?.getAttribute("data-screen") === "deploy", null, { timeout: 15_000 });
  await page.locator('[data-testid="btn-grid-auto"]').click();
  await page.waitForFunction(() => /7\/7/.test(document.querySelector('[data-testid="grid-deploy-count"]')?.textContent ?? ""), null, { timeout: 10_000 });
  await page.screenshot({ path: SHOTS + "bug-deploy.png" });
  await page.locator('[data-testid="btn-grid-fight"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="grid-battle"]')?.getAttribute("data-screen") === "battle", null, { timeout: 15_000 });
  await page.locator('[data-testid="grid-actions"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(150);
}

/* ------------------------------------------------------------------ PROBE A */

async function probeA(page) {
  log("=== PROBE A: завершение хода ===");
  await page.evaluate(injectRecorder);
  const initial = await page.evaluate(readBattleState);
  const initialDom = await page.evaluate(readDom);
  const playerNames = (initial.stacks ?? []).filter((s) => s.side === "player").map((s) => s.name);
  log("A: initial round=" + initial.round + " turnSide=" + initial.turnSide + " phase=" + initial.phase + " help=" + JSON.stringify(initialDom.help));

  const a = {
    initial: { battle: summariseBattle(initial), dom: initialDom },
    cycles: [],
    enemyAttackers: [],
    anyPlayerDamage: false,
    notes: [],
  };

  for (let i = 0; i < 3; i++) {
    const before = await page.evaluate(readBattleState);
    const beforeDom = await page.evaluate(readDom);
    if (before.error) { a.notes.push("cycle " + (i + 1) + ": cannot read battle state: " + before.error); break; }
    if (before.turnSide !== "player") { a.notes.push("cycle " + (i + 1) + ": turnSide=" + before.turnSide + " — управление не у игрока, цикл прерван"); break; }

    // клик 1 — запрос подтверждения
    await page.locator('[data-testid="grid-end-turn"]').click();
    await page.waitForTimeout(300);
    const afterClick1Dom = await page.evaluate(readDom);

    // клик 2 — собственно конец фазы; с этого момента пишем таймлайн
    await page.evaluate(() => { if (window.__SF_REC__) window.__SF_REC__.reset(); });
    const tClick2 = Date.now();
    await page.locator('[data-testid="grid-end-turn"]').click();
    if (i === 0) { try { await page.screenshot({ path: SHOTS + "bug-mid-battle.png" }); } catch (e) { a.notes.push("screenshot mid failed: " + String(e)); } }

    const samples = [];
    let sawEnemy = false;
    let playerBackAt = null;
    for (let k = 0; k < 20; k++) {
      const s = await page.evaluate(readDom);
      const ms = Date.now() - tClick2;
      const phase = s.help && s.help.includes("Ход противника") ? "enemy" : (s.screen === "battle" ? "player" : s.screen);
      samples.push({
        ms, phase, head: s.head, help: s.help, hint: s.hint,
        endTurnDisabled: s.endTurnDisabled,
        logTail: s.logLines.slice(-5),
        cards: s.cards.map((c) => c.name + " | " + c.meta),
      });
      if (phase === "enemy") sawEnemy = true;
      if (sawEnemy && phase === "player" && playerBackAt === null) playerBackAt = ms;
      if (playerBackAt !== null && ms - playerBackAt >= 400) break;
      await page.waitForTimeout(200);
    }

    const after = await page.evaluate(readBattleState);
    const afterDom = await page.evaluate(readDom);
    const recorder = await page.evaluate(() => (window.__SF_REC__?.events ?? []).map((e) => ({ t: e.t, head: e.head, help: e.help, hint: e.hint, log: e.log, roster: e.roster })));
    const added = diffLogs(before.log ?? [], after.log ?? []);
    const enemyAttacks = added.filter((l) => l.includes("Враг:"));
    const counterLines = added.filter((l) => l.includes("Ответный удар"));
    const enemyMoves = added.filter((l) => l.includes("движение") && !playerNames.some((n) => l.includes(n)));
    const playerMoves = added.filter((l) => l.includes("движение") && playerNames.some((n) => l.includes(n)));
    const enemyStackNames = (before.stacks ?? []).filter((s) => s.side === "enemy").map((s) => s.name);

    // урон игроку: по roster (видимый DOM) и по состоянию
    const hpBefore = Object.fromEntries((before.stacks ?? []).filter((s) => s.side === "player").map((s) => [s.id, s.hp]));
    const damage = [];
    for (const s of (after.stacks ?? []).filter((x) => x.side === "player")) {
      const prev = hpBefore[s.id];
      if (prev != null && s.hp < prev) damage.push({ id: s.id, name: s.name, before: prev, after: s.hp, lost: prev - s.hp });
    }
    if (damage.length) a.anyPlayerDamage = true;
    for (const line of enemyAttacks) {
      for (const n of enemyStackNames) if (line.includes(n)) { if (!a.enemyAttackers.includes(n)) a.enemyAttackers.push(n); }
    }

    const noEnemyAttack = enemyAttacks.length === 0;
    const phaseTiming = samples.reduce((acc, s) => {
      if (!acc.length || acc[acc.length - 1].phase !== s.phase) acc.push({ phase: s.phase, atMs: s.ms, help: s.help });
      return acc;
    }, []);
    const recorderHelpChanges = recorder.reduce((acc, e) => {
      if (!acc.length || acc[acc.length - 1].help !== e.help) acc.push({ t: e.t, head: e.head, help: e.help });
      return acc;
    }, []);

    const cycle = {
      index: i + 1,
      confirmRequested: /Нажмите «Завершить ход» ещё раз/.test(afterClick1Dom.hint ?? ""),
      hintAfterClick1: afterClick1Dom.hint,
      before: { round: before.round, turnSide: before.turnSide, hpPlayerTotal: sumHp(before.stacks, "player"), hpEnemyTotal: sumHp(before.stacks, "enemy"), logLen: before.log.length, logTail: before.log.slice(-6) },
      after: { round: after.round, turnSide: after.turnSide, hpPlayerTotal: sumHp(after.stacks, "player"), hpEnemyTotal: sumHp(after.stacks, "enemy"), logLen: after.log.length, logTail: after.log.slice(-10) },
      endTurnDisabledAfter: afterDom.endTurnDisabled,
      helpAfter: afterDom.help,
      samplesCount: samples.length,
      phaseTransitions: phaseTiming,
      sawEnemyPhaseText: sawEnemy,
      playerControlReturnedAtMs: playerBackAt,
      addedLogLines: added,
      enemyAttackLines: enemyAttacks,
      counterLines: counterLines,
      enemyMoveLines: enemyMoves,
      playerMoveLines: playerMoves,
      playerDamage: damage,
      recorderHelpChanges,
      samples,
    };
    a.cycles.push(cycle);
    log("A cycle " + cycle.index + ": round " + before.round + "→" + after.round + ", turnSide=" + after.turnSide +
      ", enemyPhaseSeen=" + sawEnemy + ", enemyAttacks=" + enemyAttacks.length + ", enemyMoves=" + enemyMoves.length +
      ", playerDamage=" + JSON.stringify(damage) + ", newLog=" + added.length);
    if (added.length) log("   new log: " + JSON.stringify(added));
    if (after.turnSide !== "player" || after.phase !== "battle") {
      a.notes.push("cycle " + (i + 1) + ": после фазы противника turnSide=" + after.turnSide + ", phase=" + after.phase);
      break;
    }
  }
  try { await page.screenshot({ path: SHOTS + "bug-after-end-turn.png" }); } catch (e) { a.notes.push("screenshot after failed: " + String(e)); }
  const finalState = await page.evaluate(readBattleState);
  a.final = { battle: summariseBattle(finalState), dom: await page.evaluate(readDom) };
  out.probeA = a;
  save();
  return a;
}

function sumHp(stacks, side) {
  return (stacks ?? []).filter((s) => s.side === side).reduce((n, s) => n + s.hp, 0);
}

/* ------------------------------------------------------------------ PROBE B */

async function probeB(page, seed) {
  log("=== PROBE B: авто-бой, seed=" + seed + " ===");
  await gotoGame(page);
  await openBattle(page, seed);
  const before = await page.evaluate(readBattleState);
  const errsBefore = out.consoleErrors.length;
  const warnsBefore = out.consoleWarnings.length;
  const tClick = Date.now();
  let clickError = null;
  try {
    await page.locator('[data-testid="btn-grid-auto-battle"]').click({ timeout: 20_000 });
  } catch (e) {
    clickError = String(e).slice(0, 500);
  }
  let resultVisible = false;
  try {
    await page.locator('[data-testid="grid-result"]').waitFor({ state: "visible", timeout: 30_000 });
    resultVisible = true;
  } catch (e) { /* timeout */ }
  const elapsedMs = Date.now() - tClick;
  let after = null;
  try { after = await page.evaluate(readBattleState); } catch (e) { after = { error: String(e).slice(0, 300) }; }
  let panel = null;
  try { panel = await page.evaluate(readResultPanel); } catch (e) { panel = { error: String(e).slice(0, 300) }; }
  let shot = SHOTS + "bug-auto-result-seed" + seed + ".png";
  try { await page.screenshot({ path: shot }); } catch (e) { shot = "screenshot failed: " + String(e).slice(0, 200); }

  const rec = {
    seed,
    before: { round: before.round, turnSide: before.turnSide, playerHp: sumHp(before.stacks, "player"), enemyHp: sumHp(before.stacks, "enemy"), logLen: before.log.length },
    resultVisible,
    elapsedMs,
    panelTitle: panel?.title ?? null,
    panel: panel ?? null,
    battleResult: after?.result ?? null,
    after: after && !after.error
      ? { screen: after.screen, phase: after.phase, round: after.round, turnSide: after.turnSide, playerHp: sumHp(after.stacks, "player"), enemyHp: sumHp(after.stacks, "enemy"), logTail: after.log.slice(-12) }
      : after,
    clickError,
    shot,
    consoleErrors: out.consoleErrors.slice(errsBefore),
    consoleWarnings: out.consoleWarnings.slice(warnsBefore),
  };
  out.probeB.push(rec);
  save();
  log("B seed " + seed + ": result=" + JSON.stringify(rec.panelTitle) + " visible=" + resultVisible +
    " elapsed=" + elapsedMs + "ms" + (rec.battleResult ? " winner=" + rec.battleResult.winner : ""));
  if (rec.panelTitle === null && panel?.bodyText) log("   panel body: " + panel.bodyText);
  return rec;
}

/* ------------------------------------------------------------------ main */

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  // ---------- PROBE A (один browser context, страница остаётся open)
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(25_000);
    attachDiagnostics(page, "probeA");
    await gotoGame(page);
    await openBattle(page, 7);
    await probeA(page);
    await ctx.close();
  }

  // ---------- PROBE B: по свежему контексту на seed (чтобы зависшая страница не блокировала остальные)
  for (const seed of [7, 42, 3, 11, 5]) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(25_000);
    attachDiagnostics(page, "probeB-seed" + seed);
    try {
      await probeB(page, seed);
    } catch (e) {
      out.probeB.push({ seed, fatal: String(e).slice(0, 800) });
      save();
      log("B seed " + seed + " FATAL: " + String(e).slice(0, 300));
    }
    try { await ctx.close(); } catch (e) { log("ctx close failed: " + String(e).slice(0, 200)); }
  }
} finally {
  save();
  try { await browser.close(); } catch (e) { log("browser close failed: " + String(e).slice(0, 200)); }
}

/* ------------------------------------------------------------------ итог */

const tally = { player: 0, enemy: 0, draw: 0, unknown: 0 };
for (const r of out.probeB) {
  const t = r.panelTitle;
  if (t && t.includes("Победа")) tally.player++;
  else if (t && t.includes("Поражение")) tally.enemy++;
  else if (t && t.includes("Ничья")) tally.draw++;
  else tally.unknown++;
}
const summary = {
  base: BASE,
  probeA: out.probeA ? {
    initialRound: out.probeA.initial?.battle?.round,
    cycles: out.probeA.cycles.map((c) => ({
      index: c.index,
      round: c.before.round + "→" + c.after.round,
      turnSideAfter: c.after.turnSide,
      sawEnemyPhaseText: c.sawEnemyPhaseText,
      playerControlReturnedAtMs: c.playerControlReturnedAtMs,
      enemyAttackLines: c.enemyAttackLines,
      enemyMoveLines: c.enemyMoveLines.length,
      playerMoveLines: c.playerMoveLines.length,
      playerDamage: c.playerDamage,
      newLogLines: c.addedLogLines,
    })),
    enemyAttackers: out.probeA.enemyAttackers,
    anyPlayerDamage: out.probeA.anyPlayerDamage,
    notes: out.probeA.notes,
  } : null,
  probeB: out.probeB.map((r) => ({ seed: r.seed, title: r.panelTitle, winner: r.battleResult?.winner ?? null, round: r.after?.round ?? null, elapsedMs: r.elapsedMs, resultVisible: r.resultVisible, clickError: r.clickError, fatal: r.fatal })),
  tally,
  consoleErrors: out.consoleErrors,
  consoleWarnings: out.consoleWarnings.slice(0, 20),
  pageErrors: out.pageErrors,
  raw: RAW,
};
console.log("\n=== SUMMARY ===\n" + JSON.stringify(summary, null, 2));
writeFileSync(RAW, JSON.stringify(out, null, 2));
