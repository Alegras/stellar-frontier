/**
 * verify-battle-fix.mjs — проверка ПОСЛЕ правки боя v2 (task-4).
 * Читает DOM по data-testid + состояние боя из React-fiber (read-only).
 * Пишет docs/shots/fix-*.png и tools/verify-battle-fix-raw.json.
 *
 * Запуск из корня: .\node_modules\.bin\tsx.CMD tools\verify-battle-fix.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.SF_BASE_URL ?? "http://127.0.0.1:5173";
const SHOTS = fileURLToPath(new URL("../docs/shots/", import.meta.url));
const RAW = fileURLToPath(new URL("./verify-battle-fix-raw.json", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const T0 = Date.now();
const ts = () => Number(((Date.now() - T0) / 1000).toFixed(2));
const log = (...a) => console.log("[" + ts() + "s]", ...a);
const out = { base: BASE, startedAt: new Date().toISOString(), singleClick: null, endTurnCycles: [], destroyedWithHp: [], autoBattle: [], autoAfterIdle: null, consoleErrors: [], pageErrors: [], checks: {} };
const save = () => { try { writeFileSync(RAW, JSON.stringify(out, null, 2)); } catch (e) { log("save fail", String(e)); } };

function readDom() {
  const gb = document.querySelector('[data-testid="grid-battle"]');
  const txt = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
  return {
    screen: gb?.getAttribute("data-screen") ?? null,
    head: txt(".sf-gridbattle__head b"),
    help: txt('[data-testid="grid-help"]'),
    hint: txt('[data-testid="grid-hint"]'),
    endTurnDisabled: document.querySelector('[data-testid="grid-end-turn"]')?.disabled ?? null,
    roster: [...document.querySelectorAll('[data-testid^="grid-roster-"]')].map((el) => ({
      name: el.querySelector(".sf-gridroster__name")?.textContent?.trim() ?? "",
      meta: el.querySelector(".sf-gridroster__meta")?.textContent?.trim() ?? "",
    })),
    logLines: [...document.querySelectorAll('[data-testid="grid-log"] .sf-panel-body > div > div')].map((d) => d.textContent.trim()),
    result: (() => {
      const p = document.querySelector('[data-testid="grid-result"]');
      if (!p) return null;
      return {
        title: p.querySelector(".sf-panel-head span")?.textContent?.trim() ?? null,
        body: p.querySelector(".sf-panel-body")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
        losses: [...p.querySelectorAll('[data-testid="grid-result-losses"] tbody tr')].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())),
      };
    })(),
  };
}

function readBattleState() {
  const el = document.querySelector('[data-testid="grid-battle"]');
  if (!el) return { error: "no grid-battle" };
  const fkey = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
  if (!fkey) return { error: "no fiber key" };
  let f = el[fkey];
  for (let depth = 0; f && depth < 60; depth++, f = f.return) {
    if (typeof f.type !== "function") continue;
    let h = f.memoizedState; const vals = [];
    for (let i = 0; h && i < 60; i++, h = h.next) vals.push(h.memoizedState);
    const battle = vals.find((v) => v && typeof v === "object" && Array.isArray(v.stacks) && Array.isArray(v.log));
    if (!battle) continue;
    return {
      round: battle.round, turnSide: battle.turnSide ?? null, phase: battle.phase,
      log: battle.log.map((e) => "[" + e.round + "] " + e.text),
      result: battle.result ? { winner: battle.result.winner } : null,
      stacks: battle.stacks.map((s) => ({ id: s.id, side: s.side, name: s.name, hp: Math.round(s.hp), maxHp: s.maxHp, ap: s.ap ?? 2, alive: !!s.alive, reserve: !!s.reserve })),
    };
  }
  return { error: "state not found" };
}

async function dismissAllOverlays(page) {
  for (let i = 0; i < 12; i++) {
    const closed = await page.evaluate(() => {
      const click = (s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; };
      return click('[data-testid="btn-close-battle"]') || click('[data-testid="btn-close-battle-footer"]')
        || click('[data-testid="btn-later-event"]') || click('[data-testid="btn-later-ai-event"]')
        || click('[data-testid="dialogue-close"]');
    });
    if (closed) { await page.waitForTimeout(180); continue; }
    if (await page.locator('[data-testid="overlays-root"]').count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(180); continue; }
    break;
  }
}

async function openBattle(page, seed, coop = false) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => document.body.innerText.trim().length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => { const g = window.__SF_GAME__; if (!g.hasWorld) g.newGame(42); });
  await page.evaluate(() => { try { localStorage.setItem("sf.gridBattle", "1"); } catch (e) { /* noop */ } });
  await page.locator('[data-testid="top-bar"]').waitFor({ state: "visible", timeout: 30_000 });
  await dismissAllOverlays(page);
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent("sf:grid-battle", { detail: d })), { seed, coop });
  await page.locator('[data-testid="grid-battle"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="grid-battle"]')?.getAttribute("data-screen") === "deploy", null, { timeout: 15_000 });
  await page.locator('[data-testid="btn-grid-auto"]').click();
  await page.waitForFunction(() => /7\/7/.test(document.querySelector('[data-testid="grid-deploy-count"]')?.textContent ?? ""), null, { timeout: 10_000 });
  await page.locator('[data-testid="btn-grid-fight"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="grid-battle"]')?.getAttribute("data-screen") === "battle", null, { timeout: 15_000 });
  await page.locator('[data-testid="grid-actions"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(120);
}

/** Один полный цикл «конец хода»: 1-й клик — подтверждение, 2-й — смена фазы. */
async function endTurnCycle(page) {
  const before = await page.evaluate(readBattleState);
  const beforeDom = await page.evaluate(readDom);
  await page.locator('[data-testid="grid-end-turn"]').click();
  await page.waitForTimeout(300);
  const afterClick1 = await page.evaluate(readDom);
  const t = Date.now();
  await page.locator('[data-testid="grid-end-turn"]').click();
  let back = false; let sawEnemy = false; let lastState = null;
  for (let k = 0; k < 30; k++) {
    const s = await page.evaluate(readDom);
    if (s.help && s.help.includes("Ход противника")) sawEnemy = true;
    const st = await page.evaluate(readBattleState);
    lastState = st;
    if (st.turnSide === "player" && st.phase === "battle" && st.round > before.round) { back = true; break; }
    await page.waitForTimeout(200);
  }
  const afterDom = await page.evaluate(readDom);
  const after = lastState ?? await page.evaluate(readBattleState);
  const added = (after.log ?? []).slice((before.log ?? []).length);
  const attacks = added.filter((l) => l.includes("Враг:"));
  const playerDamage = (after.stacks ?? []).filter((s) => s.side === "player")
    .map((s) => ({ name: s.name, hp: s.hp, before: (before.stacks ?? []).find((x) => x.id === s.id)?.hp }))
    .filter((x) => x.before != null && x.hp < x.before).map((x) => ({ name: x.name, lost: x.before - x.hp, hpAfter: x.hp }));
  const deadWithHp = (after.stacks ?? []).filter((s) => !s.alive && s.hp > 0 && s.maxHp > 0)
    .map((s) => ({ side: s.side, name: s.name, hp: s.hp, maxHp: s.maxHp, pct: Math.round((s.hp / s.maxHp) * 100) }));
  return {
    roundBefore: before.round, roundAfter: after.round,
    enemyPhaseSeen: sawEnemy, controlReturned: back,
    enemyAttacks: attacks.length, enemyAttackLines: attacks,
    playerDamage, deadWithHp,
    click1Hint: afterClick1.hint,
    confirmRequested: /Нажмите|подтверд|ещё раз|повторн/i.test(afterClick1.hint ?? ""),
    afterHelp: afterDom.help, afterHead: afterDom.head,
    roster: afterDom.roster.length,
    ms: Date.now() - t,
  };
}

async function autoBattle(page) {
  const t = Date.now();
  await page.locator('[data-testid="btn-grid-auto-battle"]').click({ timeout: 20_000 });
  let visible = false;
  try { await page.locator('[data-testid="grid-result"]').waitFor({ state: "visible", timeout: 30_000 }); visible = true; } catch (e) { /* timeout */ }
  const elapsed = Date.now() - t;
  return { visible, elapsed, dom: await page.evaluate(readDom), state: await page.evaluate(readBattleState) };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
function wire(page, label) {
  page.on("console", (m) => { if (m.type() === "error") out.consoleErrors.push({ t: ts(), label, text: m.text() }); });
  page.on("pageerror", (e) => out.pageErrors.push({ t: ts(), label, text: String(e?.message ?? e) }));
}
try {
  /* 1. A: конец хода (seed 7) + проверка «уничтожен при HP > 0» */
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(25_000); wire(page, "A");
    await openBattle(page, 7);
    const initDom = await page.evaluate(readDom);
    const initState = await page.evaluate(readBattleState);
    out.init = { help: initDom.help, hint: initDom.hint, roster: initDom.roster, round: initState.round, turnSide: initState.turnSide };

    // одиночный клик — только подтверждение, фаза не меняется
    await page.locator('[data-testid="grid-end-turn"]').click();
    await page.waitForTimeout(1200);
    const one = await page.evaluate(readDom);
    const oneState = await page.evaluate(readBattleState);
    out.singleClick = { round: oneState.round, turnSide: oneState.turnSide, hint: one.hint, logLen: (oneState.log ?? []).length };
    await page.screenshot({ path: SHOTS + "fix-endturn-confirm.png" });

    for (let i = 0; i < 3; i++) {
      const c = await endTurnCycle(page);
      out.endTurnCycles.push(c);
      if (c.deadWithHp.length) out.destroyedWithHp.push({ cycle: i + 1, units: c.deadWithHp });
      log("fix A cycle " + (i + 1) + ": round " + c.roundBefore + "→" + c.roundAfter + " enemyPhase=" + c.enemyPhaseSeen +
        " attacks=" + c.enemyAttacks + " returned=" + c.controlReturned + " ms=" + c.ms + " deadWithHp=" + c.deadWithHp.length);
      if (!c.controlReturned) break;
    }
    await page.screenshot({ path: SHOTS + "fix-after-end-turn.png" });
    const fin = await page.evaluate(readBattleState);
    out.finalState = { round: fin.round, turnSide: fin.turnSide, players: (fin.stacks ?? []).filter((s) => s.side === "player") };
    await ctx.close();
  }

  /* 2. B: авто-бой — запрошенные сиды + свип 1..20 */
  for (const seed of [7, 42, 3, 11, 5, ...Array.from({ length: 15 }, (_, i) => i + 1)]) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(25_000); wire(page, "B-" + seed);
    try {
      await openBattle(page, seed);
      const b = await autoBattle(page);
      const rec = { seed, title: b.dom.result?.title ?? null, visible: b.visible, elapsedMs: b.elapsed, rounds: (b.dom.result?.body ?? "").split("·")[0]?.trim() ?? null, winner: b.state?.result?.winner ?? null };
      out.autoBattle.push(rec);
      if (seed === 7) await page.screenshot({ path: SHOTS + "fix-auto-result-seed7.png" });
      log("fix B seed " + seed + " -> " + JSON.stringify(rec.title) + " (" + rec.rounds + ", " + rec.elapsedMs + "ms)");
    } catch (e) {
      out.autoBattle.push({ seed, fatal: String(e).slice(0, 400) });
      log("fix B seed " + seed + " FATAL " + String(e).slice(0, 200));
    }
    save();
    try { await ctx.close(); } catch (e) { /* noop */ }
  }

  /* 3. авто-бой после 3 пропущенных ходов (seed 7) */
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(25_000); wire(page, "idle");
    await openBattle(page, 7);
    for (let i = 0; i < 3; i++) await endTurnCycle(page);
    const pre = await page.evaluate(readBattleState);
    const b = await autoBattle(page);
    out.autoAfterIdle = { title: b.dom.result?.title ?? null, rounds: (b.dom.result?.body ?? "").split("·")[0]?.trim() ?? null, preRound: pre.round, prePlayerAlive: (pre.stacks ?? []).filter((s) => s.side === "player" && s.alive).length };
    await page.screenshot({ path: SHOTS + "fix-auto-after-idle-seed7.png" }).catch(() => {});
    log("fix B idle seed7 -> " + JSON.stringify(out.autoAfterIdle.title));
    await ctx.close();
  }
} finally {
  save();
  try { await browser.close(); } catch (e) { /* noop */ }
}

/* ---- сводка/проверки ---- */
const winTally = { player: 0, enemy: 0, draw: 0, unknown: 0 };
for (const r of out.autoBattle) {
  const t = r.title ?? "";
  if (t.includes("Победа")) winTally.player++; else if (t.includes("Поражение")) winTally.enemy++; else if (t.includes("Ничья")) winTally.draw++; else winTally.unknown++;
}
const cycles = out.endTurnCycles;
out.checks = {
  singleClickOnlyConfirms: out.singleClick ? out.singleClick.round === 1 && out.singleClick.turnSide === "player" : null,
  enemyPhaseRanInEveryCycle: cycles.length > 0 && cycles.every((c) => c.enemyPhaseSeen),
  enemyAttackedInEveryCycle: cycles.length > 0 && cycles.every((c) => c.enemyAttacks > 0),
  controlReturnedInEveryCycle: cycles.length > 0 && cycles.every((c) => c.controlReturned),
  roundsAdvanced: cycles.length > 0 && cycles.every((c) => c.roundAfter > c.roundBefore),
  noDestroyedStacksWithHp: out.destroyedWithHp.length === 0,
  autoBattleTally: winTally,
  autoBattleNotDeterministic: winTally.unknown === 0 && (winTally.player > 0 || winTally.enemy > 0),
  consoleErrors: out.consoleErrors.length,
  pageErrors: out.pageErrors.length,
};
console.log("\n=== VERIFY SUMMARY ===");
console.log(JSON.stringify({ singleClick: out.singleClick, cycles: cycles.map((c) => ({ round: c.roundBefore + "→" + c.roundAfter, enemyPhaseSeen: c.enemyPhaseSeen, enemyAttacks: c.enemyAttacks, controlReturned: c.controlReturned, ms: c.ms, deadWithHp: c.deadWithHp.length })), destroyedWithHp: out.destroyedWithHp, autoBattle: out.autoBattle, autoAfterIdle: out.autoAfterIdle, checks: out.checks }, null, 2));
save();
