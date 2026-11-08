/**
 * battle-ui-repro-extra.mjs — дополнительные сценарии к battle-ui-repro.mjs.
 * Выясняет, при каких условиях симптом «Авто-бой → поражение» может воспроизвестись.
 * Только чтение; пишет docs/shots/bug-*.png и tools/battle-ui-repro-extra-raw.json.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.SF_BASE_URL ?? "http://127.0.0.1:5173";
const SHOTS = fileURLToPath(new URL("../docs/shots/", import.meta.url));
const RAW = fileURLToPath(new URL("./battle-ui-repro-extra-raw.json", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const T0 = Date.now();
const ts = () => Number(((Date.now() - T0) / 1000).toFixed(2));
const log = (...a) => console.log("[" + ts() + "s]", ...a);
const out = { base: BASE, startedAt: new Date().toISOString(), consoleErrors: [], pageErrors: [], e1: null, e2: [], e3: [], e4: null };
const save = () => { try { writeFileSync(RAW, JSON.stringify(out, null, 2)); } catch (e) { log("save fail", String(e)); } };

function readDom() {
  const gb = document.querySelector('[data-testid="grid-battle"]');
  const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  return {
    screen: gb?.getAttribute("data-screen") ?? null,
    head: txt(".sf-gridbattle__head b"),
    help: txt('[data-testid="grid-help"]'),
    hint: txt('[data-testid="grid-hint"]'),
    endTurnDisabled: document.querySelector('[data-testid="grid-end-turn"]')?.disabled ?? null,
    cards: [...document.querySelectorAll('[data-testid^="grid-roster-"]')].map((el) => ({
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
        losses: [...p.querySelectorAll('[data-testid="grid-result-losses"] tbody tr')].map((tr) =>
          [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())),
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
      result: battle.result ? { winner: battle.result.winner, losses: battle.result.losses } : null,
      stacks: battle.stacks.map((s) => ({ id: s.id, side: s.side, name: s.name, hp: Math.round(s.hp), maxHp: s.maxHp, ap: s.ap ?? 2, alive: !!s.alive })),
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

/** Полный цикл «конец хода»: 1-й клик — подтверждение, 2-й — смена фазы; ждём возврата управления. */
async function endTurnCycle(page) {
  await page.locator('[data-testid="grid-end-turn"]').click();
  await page.waitForTimeout(300);
  const afterClick1 = await page.evaluate(readDom);
  await page.locator('[data-testid="grid-end-turn"]').click();
  const t = Date.now();
  let back = null;
  for (let k = 0; k < 20; k++) {
    const s = await page.evaluate(readDom);
    const ms = Date.now() - t;
    if (s.help && s.help.includes("Ход противника")) back = "enemy-phase";
    const st = await page.evaluate(readBattleState);
    if (st.turnSide === "player" && st.round > 1) return { afterClick1, ms, state: st, help: s.help };
    await page.waitForTimeout(200);
  }
  return { afterClick1, ms: Date.now() - t, state: await page.evaluate(readBattleState), help: null };
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
  /* E1: поведение ОДНОГО клика «ЗАВЕРШИТЬ ХОД» */
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(25_000); wire(page, "E1");
    await openBattle(page, 7);
    const before = await page.evaluate(readDom);
    const stBefore = await page.evaluate(readBattleState);
    await page.locator('[data-testid="grid-end-turn"]').click();  // один клик
    await page.waitForTimeout(1500);
    const afterOne = await page.evaluate(readDom);
    const stOne = await page.evaluate(readBattleState);
    await page.screenshot({ path: SHOTS + "bug-endturn-confirm.png" });
    // второй клик
    await page.locator('[data-testid="grid-end-turn"]').click();
    await page.waitForTimeout(1500);
    const afterTwo = await page.evaluate(readDom);
    const stTwo = await page.evaluate(readBattleState);
    out.e1 = {
      before: { round: stBefore.round, turnSide: stBefore.turnSide, hint: before.hint, help: before.help, logLen: stBefore.log.length },
      afterOneClick: { round: stOne.round, turnSide: stOne.turnSide, help: afterOne.help, hint: afterOne.hint, logLen: stOne.log.length, logTail: stOne.log.slice(-4) },
      afterTwoClicks: { round: stTwo.round, turnSide: stTwo.turnSide, help: afterTwo.help, hint: afterTwo.hint, logTail: stTwo.log.slice(-8) },
      enemyAttacksAfter2nd: stTwo.log.slice(stOne.log.length).filter((l) => l.includes("Враг:")),
      shot: SHOTS + "bug-endturn-confirm.png",
    };
    save();
    log("E1 single-click: turnSide=" + out.e1.afterOneClick.turnSide + " round=" + out.e1.afterOneClick.round + " hint=" + JSON.stringify(out.e1.afterOneClick.hint));
    log("E1 after 2nd click: round=" + out.e1.afterTwoClicks.round + " turnSide=" + out.e1.afterTwoClicks.turnSide + " enemyAttacks=" + out.e1.enemyAttacksAfter2nd.length);
    await ctx.close();
  }

  /* E2: авто-бой ПОСЛЕ нескольких «пустых» ходов (игрок уже получил урон) */
  for (const [seed, cycles] of [[7, 3], [42, 3], [7, 1]]) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(25_000); wire(page, "E2-" + seed + "-" + cycles);
    await openBattle(page, seed);
    const rounds = [];
    for (let i = 0; i < cycles; i++) {
      const r = await endTurnCycle(page);
      rounds.push({ round: r.state?.round, turnSide: r.state?.turnSide, hpPlayer: (r.state?.stacks ?? []).filter((s) => s.side === "player" && s.alive).reduce((a, s) => a + s.hp, 0), enemyAttacks: (r.state?.log ?? []).filter((l) => l.includes("Враг:")).length });
    }
    const pre = await page.evaluate(readBattleState);
    const beta = await autoBattle(page);
    const shot = SHOTS + "bug-auto-after-idle-seed" + seed + "-" + cycles + ".png";
    await page.screenshot({ path: shot }).catch(() => {});
    out.e2.push({
      seed, idleCycles: cycles, idleRounds: rounds,
      preAuto: { round: pre.round, turnSide: pre.turnSide, playerAlive: (pre.stacks ?? []).filter((s) => s.side === "player" && s.alive).length, enemyAlive: (pre.stacks ?? []).filter((s) => s.side === "enemy" && s.alive).length },
      visible: beta.visible, elapsedMs: beta.elapsed,
      title: beta.dom.result?.title ?? null,
      body: beta.dom.result?.body ?? null,
      losses: beta.dom.result?.losses ?? null,
      winner: beta.state?.result?.winner ?? null,
      round: beta.state?.round ?? null,
      shot,
    });
    save();
    log("E2 seed=" + seed + " idle=" + cycles + " -> title=" + JSON.stringify(beta.dom.result?.title) + " winner=" + (beta.state?.result?.winner ?? null));
    await ctx.close();
  }

  /* E3: авто-бой СРАЗУ после начала боя, сиды 1..20 */
  for (let seed = 1; seed <= 20; seed++) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(25_000); wire(page, "E3-" + seed);
    try {
      await openBattle(page, seed);
      const before = await page.evaluate(readBattleState);
      const b = await autoBattle(page);
      out.e3.push({ seed, title: b.dom.result?.title ?? null, winner: b.state?.result?.winner ?? null, round: b.state?.round ?? null, elapsedMs: b.elapsed, before: { round: before.round, turnSide: before.turnSide } });
      log("E3 seed " + seed + " -> " + JSON.stringify(b.dom.result?.title) + " (winner=" + (b.state?.result?.winner ?? null) + ", round=" + (b.state?.round ?? null) + ")");
    } catch (e) {
      out.e3.push({ seed, fatal: String(e).slice(0, 300) });
      log("E3 seed " + seed + " FATAL " + String(e).slice(0, 200));
    }
    save();
    try { await ctx.close(); } catch (e) { /* noop */ }
  }

  /* E4: coop:true, авто-бой сразу */
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(25_000); wire(page, "E4");
    await openBattle(page, 7, true);
    const b = await autoBattle(page);
    out.e4 = { title: b.dom.result?.title ?? null, winner: b.state?.result?.winner ?? null, round: b.state?.round ?? null, elapsedMs: b.elapsed };
    save();
    log("E4 coop seed=7 -> " + JSON.stringify(b.dom.result?.title) + " winner=" + (b.state?.result?.winner ?? null));
    await ctx.close();
  }
} finally {
  save();
  try { await browser.close(); } catch (e) { /* noop */ }
}

const tally3 = { player: 0, enemy: 0, draw: 0, unknown: 0 };
for (const r of out.e3) {
  const t = r.title ?? "";
  if (t.includes("Победа")) tally3.player++; else if (t.includes("Поражение")) tally3.enemy++; else if (t.includes("Ничья")) tally3.draw++; else tally3.unknown++;
}
console.log("\n=== EXTRA SUMMARY ===");
console.log(JSON.stringify({
  e1: out.e1 ? { afterOneClick: out.e1.afterOneClick, afterTwoClicks: out.e1.afterTwoClicks, enemyAttacksAfter2nd: out.e1.enemyAttacksAfter2nd } : null,
  e2: out.e2.map((r) => ({ seed: r.seed, idleCycles: r.idleCycles, preAuto: r.preAuto, title: r.title, winner: r.winner, round: r.round, body: r.body })),
  e3: out.e3,
  tally3,
  e4: out.e4,
  consoleErrors: out.consoleErrors,
  pageErrors: out.pageErrors,
}, null, 2));
save();
