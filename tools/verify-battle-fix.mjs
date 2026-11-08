/**
 * verify-battle-fix.mjs — независимая проверка правки боя v2 (task-4).
 * DOM по data-testid + таймлайн смены фазы (MutationObserver). Read-only.
 * Запуск: cd N:\AI\stellar-frontier ; .\node_modules\.bin\tsx.CMD tools\verify-battle-fix.mjs
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
const out = { base: BASE, startedAt: new Date().toISOString(), initial: null, confirmProbe: null, cycles: [], finalState: null, spaceProbe: null, noApProbe: null, autoBattle: [], destroyedWithHp: [], consoleErrors: [], pageErrors: [], checks: {} };
const save = () => { try { writeFileSync(RAW, JSON.stringify(out, null, 2)); } catch (e) { log("save fail", String(e)); } };

function readDom() {
  const gb = document.querySelector('[data-testid="grid-battle"]');
  const txt = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
  const btn = document.querySelector('[data-testid="grid-end-turn"]');
  const roster = [...document.querySelectorAll('[data-testid^="grid-roster-"]')].map((el) => ({
    id: el.getAttribute("data-testid"),
    name: el.querySelector(".sf-gridroster__name")?.textContent?.trim() ?? "",
    meta: el.querySelector(".sf-gridroster__meta")?.textContent?.trim() ?? "",
  }));
  const hp = roster.reduce((sum, r) => { const m = /HP\s+(\d+)/.exec(r.meta); return sum + (m ? Number(m[1]) : 0); }, 0);
  return {
    screen: gb?.getAttribute("data-screen") ?? null,
    phaseTitle: txt('[data-testid="grid-phase-title"]'),
    help: txt('[data-testid="grid-help"]'),
    hint: txt('[data-testid="grid-hint"]'),
    endTurnLabel: btn?.textContent?.trim() ?? null,
    endTurnDisabled: btn?.disabled ?? null,
    roster, hp,
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
      round: battle.round, turnSide: battle.turnSide ?? null, phase: battle.phase, firstSide: battle.firstSide ?? null,
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
  await page.waitForTimeout(150);
}

const roundFromTitle = (title) => { const m = /(\d+)\s*\/\s*\d+/.exec(title ?? ""); return m ? Number(m[1]) : null; };
const isPlayerTitle = (title) => typeof title === "string" && title.startsWith("Фаза игрока");

async function waitForPlayerDom(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(readDom);
    if (last.screen === "result") return last;
    if (isPlayerTitle(last.phaseTitle) && last.endTurnDisabled === false) return last;
    await page.waitForTimeout(100);
  }
  return last;
}

/** Наблюдаем DOM до возврата управления в следующем раунде; опционально скриншот фазы ИИ. */
async function watchCycle(page, roundBefore, timeoutMs, shotWhenEnemy = null) {
  const t0 = Date.now();
  const timeline = [];
  let enemyTitleSeen = false; let enemyTitleAtMs = null; let enemyTitleEndMs = null; let returned = false; let shotSaved = null;
  let lastTitle = null;
  while (Date.now() - t0 < timeoutMs) {
    const d = await page.evaluate(readDom);
    const ms = Date.now() - t0;
    const title = d.phaseTitle ?? "";
    const isEnemy = title.includes("ХОД ПРОТИВНИКА");
    if (isEnemy && !enemyTitleSeen) {
      enemyTitleSeen = true; enemyTitleAtMs = ms;
      if (shotWhenEnemy) { try { await page.screenshot({ path: SHOTS + shotWhenEnemy }); shotSaved = SHOTS + shotWhenEnemy; } catch (e) { /* noop */ } }
    }
    if (!isEnemy && enemyTitleSeen && enemyTitleEndMs === null) enemyTitleEndMs = ms;
    if (title !== lastTitle) { timeline.push({ ms, title, label: d.endTurnLabel, hint: d.hint, hp: d.hp, logTail: (d.logLines ?? []).slice(-3) }); lastTitle = title; }
    const roundNow = roundFromTitle(title);
    if (isPlayerTitle(title) && d.endTurnDisabled === false && roundNow !== null && roundNow > roundBefore) { returned = true; break; }
    if (d.screen === "result") { returned = true; break; }
    await page.waitForTimeout(100);
  }
  return {
    returned, enemyTitleSeen, enemyTitleAtMs, shotSaved,
    enemyTitleDurationMs: enemyTitleSeen && enemyTitleEndMs !== null ? enemyTitleEndMs - enemyTitleAtMs : null,
    timeline, elapsedMs: Date.now() - t0,
  };
}

/** Один цикл: клик-подтверждение → клик-смена фазы. Возвращает собранные наблюдения. */
async function endTurnCycle(page, index, shotWhenEnemy = null) {
  await waitForPlayerDom(page, 20_000);
  const domBefore = await page.evaluate(readDom);
  const roundBefore = roundFromTitle(domBefore.phaseTitle) ?? 1;
  const stateBefore = await page.evaluate(readBattleState);
  await page.locator('[data-testid="grid-end-turn"]').click();
  await page.waitForTimeout(250);
  const afterClick1 = await page.evaluate(readDom);
  const confirmRequested = /ПОДТВЕРДИТЬ ХОД/.test(afterClick1.endTurnLabel ?? "") && /сгорит|ПОДТВЕРДИТЬ/i.test(afterClick1.hint ?? "");
  const tClick2 = Date.now();
  await page.locator('[data-testid="grid-end-turn"]').click();
  const watch = await watchCycle(page, roundBefore, 25_000, shotWhenEnemy);
  const domAfter = await page.evaluate(readDom);
  const stateAfter = await page.evaluate(readBattleState);
  const added = (stateAfter.log ?? []).slice((stateBefore.log ?? []).length);
  const enemyAttacks = added.filter((l) => l.includes("Враг: "));
  const dead = (stateAfter.stacks ?? []).filter((s) => !s.alive && s.hp > 0 && !s.reserve && s.maxHp > 0)
    .map((s) => ({ side: s.side, name: s.name, hp: s.hp, maxHp: s.maxHp, pct: Math.round((s.hp / s.maxHp) * 100) }));
  return {
    index,
    roundBefore, roundAfter: roundFromTitle(domAfter.phaseTitle),
    labelBefore: domBefore.endTurnLabel, labelAfterClick1: afterClick1.endTurnLabel, hintAfterClick1: afterClick1.hint,
    confirmRequested,
    enemyTitleSeen: watch.enemyTitleSeen, enemyTitleAtMs: watch.enemyTitleAtMs, enemyTitleDurationMs: watch.enemyTitleDurationMs,
    returnedToPlayer: watch.returned, elapsedMs: Date.now() - tClick2, phaseTimeline: watch.timeline, enemyShot: watch.shotSaved,
    enemyAttacks: enemyAttacks.length, enemyAttackLines: enemyAttacks.slice(0, 10),
    hpPlayerBefore: domBefore.hp, hpPlayerAfter: domAfter.hp, hpPlayerDelta: domAfter.hp - domBefore.hp,
    deadWithHp: dead, addedLogCount: added.length, addedLogTail: added.slice(-10),
    hintAfter: domAfter.hint, helpAfter: domAfter.help,
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
function wire(page, label) {
  page.on("console", (m) => { if (m.type() === "error") out.consoleErrors.push({ t: ts(), label, text: m.text() }); });
  page.on("pageerror", (e) => out.pageErrors.push({ t: ts(), label, text: String(e?.message ?? e) }));
}
async function freshPage(label) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(20_000); wire(page, label);
  return { ctx, page };
}

try {
  /* ---------- 1. Основной контекст: подтверждение + 4 цикла ---------- */
  {
    const { ctx, page } = await freshPage("main");
    await openBattle(page, 7);
    const d0 = await waitForPlayerDom(page, 20_000);
    const st0 = await page.evaluate(readBattleState);
    out.initial = { round: st0.round, turnSide: st0.turnSide, firstSide: st0.firstSide, phaseTitle: d0.phaseTitle, help: d0.help, hint: d0.hint, endTurnLabel: d0.endTurnLabel, hp: d0.hp, roster: d0.roster };
    log("initial: round=" + st0.round + " turnSide=" + st0.turnSide + " firstSide=" + st0.firstSide + " title=" + JSON.stringify(d0.phaseTitle) + " hp=" + d0.hp);

    // confirm probe
    {
      const before = await page.evaluate(readDom);
      await page.locator('[data-testid="grid-end-turn"]').click();
      await page.waitForTimeout(500);
      const after = await page.evaluate(readDom);
      out.confirmProbe = {
        labelBefore: before.endTurnLabel, labelAfter1Click: after.endTurnLabel, hintAfter1Click: after.hint,
        phaseTitleAfter: after.phaseTitle,
        buttonBecameConfirm: /ПОДТВЕРДИТЬ ХОД/.test(after.endTurnLabel ?? ""),
        hintExplainsBurn: /сгорит/.test(after.hint ?? ""),
        phaseUnchanged: after.phaseTitle === before.phaseTitle,
      };
      await page.screenshot({ path: SHOTS + "fix-endturn-confirm.png" });
      log("confirm probe: label=" + JSON.stringify(after.endTurnLabel) + " unchanged=" + out.confirmProbe.phaseUnchanged);
      // доводим фазу до конца, чтобы следующий цикл начался без «залипшего» подтверждения
      await page.locator('[data-testid="grid-end-turn"]').click();
      await watchCycle(page, roundFromTitle(before.phaseTitle) ?? 1, 25_000);
      await waitForPlayerDom(page, 25_000);
    }

    for (let i = 0; i < 4; i++) {
      const cyc = await endTurnCycle(page, i + 1, i === 0 ? "fix-enemy-phase.png" : null);
      out.cycles.push(cyc);
      if (cyc.deadWithHp.length) out.destroyedWithHp.push({ cycle: cyc.index, units: cyc.deadWithHp });
      log("cycle " + cyc.index + ": round " + cyc.roundBefore + "→" + cyc.roundAfter + " confirm=" + cyc.confirmRequested +
        " enemyTitle=" + cyc.enemyTitleSeen + (cyc.enemyTitleAtMs != null ? "@" + cyc.enemyTitleAtMs + "ms/" + cyc.enemyTitleDurationMs + "ms" : "") +
        " attacks=" + cyc.enemyAttacks + " hp " + cyc.hpPlayerBefore + "→" + cyc.hpPlayerAfter + " returned=" + cyc.returnedToPlayer +
        " deadWithHp=" + cyc.deadWithHp.length + " elapsed=" + cyc.elapsedMs + "ms");
      if (!cyc.returnedToPlayer) break;
      if ((await page.evaluate(readDom)).screen === "result") break;
    }
    await page.screenshot({ path: SHOTS + "fix-after-end-turn.png" });
    const stFinal = await page.evaluate(readBattleState);
    out.finalState = { round: stFinal.round, turnSide: stFinal.turnSide, players: (stFinal.stacks ?? []).filter((s) => s.side === "player") };
    await ctx.close();
  }

  /* ---------- 2. Свежий бой: Space/Enter ---------- */
  {
    const { ctx, page } = await freshPage("space");
    await openBattle(page, 7);
    await waitForPlayerDom(page, 20_000);
    const before = await page.evaluate(readDom);
    const roundBefore = roundFromTitle(before.phaseTitle) ?? 1;
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
    const afterSpace = await page.evaluate(readDom);
    await page.keyboard.press("Enter");
    const watch = await watchCycle(page, roundBefore, 25_000, "fix-enemy-phase-space.png");
    const after = await page.evaluate(readDom);
    out.spaceProbe = {
      labelBefore: before.endTurnLabel, labelAfterSpace: afterSpace.endTurnLabel, hintAfterSpace: afterSpace.hint,
      spaceBecameConfirm: /ПОДТВЕРДИТЬ ХОД/.test(afterSpace.endTurnLabel ?? ""),
      roundBefore, roundAfter: roundFromTitle(after.phaseTitle),
      enemyTitleSeen: watch.enemyTitleSeen, returned: watch.returned,
    };
    log("space probe: labelAfterSpace=" + JSON.stringify(afterSpace.endTurnLabel) + " round " + roundBefore + "→" + out.spaceProbe.roundAfter + " enemyTitle=" + watch.enemyTitleSeen + " returned=" + watch.returned);
    await ctx.close();
  }

  /* ---------- 3. Свежий бой: один клик при AP=0 ---------- */
  {
    const { ctx, page } = await freshPage("noap");
    await openBattle(page, 7);
    await waitForPlayerDom(page, 20_000);
    const cardIds = (await page.evaluate(readDom)).roster.map((r) => r.id);
    for (const id of cardIds) {
      try { await page.locator('[data-testid="' + id + '"]').click({ timeout: 4000 }); } catch (e) { continue; }
      await page.waitForTimeout(60);
      for (let k = 0; k < 2; k++) {
        try { await page.locator('[data-testid="btn-grid-defend"]').click({ timeout: 4000 }); } catch (e) { break; }
        await page.waitForTimeout(60);
      }
    }
    const domAp = await page.evaluate(readDom);
    const stAp = await page.evaluate(readBattleState);
    const apLeft = (stAp.stacks ?? []).filter((s) => s.side === "player" && s.alive && !s.reserve).map((s) => s.ap);
    const roundBefore = roundFromTitle(domAp.phaseTitle) ?? stAp.round;
    await page.locator('[data-testid="grid-end-turn"]').click();   // ОДИН клик
    await page.waitForTimeout(120);
    const immediate = await page.evaluate(readDom);
    const watch = await watchCycle(page, roundBefore, 25_000, "fix-noap-enemy-phase.png");
    const after = await page.evaluate(readDom);
    out.noApProbe = {
      apLeftBefore: apLeft, allApSpent: apLeft.length > 0 && apLeft.every((a) => a === 0),
      labelBefore: domAp.endTurnLabel,
      labelImmediatelyAfterClick: immediate.endTurnLabel,
      didNotAskConfirm: !/ПОДТВЕРДИТЬ ХОД/.test(immediate.endTurnLabel ?? ""),
      roundBefore, roundAfter: roundFromTitle(after.phaseTitle),
      enemyTitleSeen: watch.enemyTitleSeen, returned: watch.returned, elapsedMs: watch.elapsedMs,
      phaseChanged: roundFromTitle(after.phaseTitle) !== roundBefore || watch.enemyTitleSeen,
    };
    log("no-AP probe: apLeft=" + JSON.stringify(apLeft) + " labelAfterClick=" + JSON.stringify(immediate.endTurnLabel) + " round " + roundBefore + "→" + out.noApProbe.roundAfter + " enemyTitle=" + watch.enemyTitleSeen + " returned=" + watch.returned + " " + watch.elapsedMs + "ms");
    await ctx.close();
  }

  /* ---------- 4. Авто-бой: 12 сидов ---------- */
  const seeds = [7, 42, 3, 11, 5, 1, 2, 4, 8, 9, 10, 6];
  for (const seed of seeds) {
    const { ctx, page } = await freshPage("auto-" + seed);
    try {
      await openBattle(page, seed);
      const t = Date.now();
      await page.locator('[data-testid="btn-grid-auto-battle"]').click({ timeout: 20_000 });
      let visible = false;
      try { await page.locator('[data-testid="grid-result"]').waitFor({ state: "visible", timeout: 30_000 }); visible = true; } catch (e) { /* timeout */ }
      const elapsed = Date.now() - t;
      const d = await page.evaluate(readDom);
      const st = await page.evaluate(readBattleState);
      const dead = (st.stacks ?? []).filter((s) => !s.alive && s.hp > 0 && !s.reserve && s.maxHp > 0)
        .map((s) => ({ side: s.side, name: s.name, hp: s.hp, maxHp: s.maxHp, pct: Math.round((s.hp / s.maxHp) * 100) }));
      const rec = { seed, visible, elapsedMs: elapsed, title: d.result?.title ?? null, winner: st?.result?.winner ?? null, rounds: (d.result?.body ?? "").split("·")[0]?.trim() ?? null, losses: d.result?.losses ?? null, deadWithHp: dead };
      out.autoBattle.push(rec);
      if (dead.length) out.destroyedWithHp.push({ seed, units: dead });
      if (seed === 7) await page.screenshot({ path: SHOTS + "fix-auto-result-seed7.png" });
      if (seed === 42) await page.screenshot({ path: SHOTS + "fix-auto-result-seed42.png" });
      log("auto seed " + seed + " -> " + JSON.stringify(rec.title) + " winner=" + rec.winner + " " + (rec.rounds ?? "") + " " + elapsed + "ms deadWithHp=" + dead.length);
    } catch (e) {
      out.autoBattle.push({ seed, fatal: String(e).slice(0, 400) });
      log("auto seed " + seed + " FATAL " + String(e).slice(0, 200));
    }
    save();
    try { await ctx.close(); } catch (e) { /* noop */ }
  }
} finally {
  save();
  try { await browser.close(); } catch (e) { /* noop */ }
}

/* ---- сводка ---- */
const tally = { player: 0, enemy: 0, draw: 0, unknown: 0 };
for (const r of out.autoBattle) {
  const t = r.title ?? "";
  if (t.includes("Победа")) tally.player++; else if (t.includes("Поражение")) tally.enemy++; else if (t.includes("Ничья")) tally.draw++; else tally.unknown++;
}
const cyc = out.cycles;
const enemyPhaseCycles = cyc.filter((c) => c.enemyTitleSeen);
out.checks = {
  confirmLabelShown: out.confirmProbe ? out.confirmProbe.buttonBecameConfirm : null,
  confirmHintExplainsBurn: out.confirmProbe ? out.confirmProbe.hintExplainsBurn : null,
  singleClickWithApDidNotChangePhase: out.confirmProbe ? out.confirmProbe.phaseUnchanged : null,
  enemyPhaseTitleSeen: enemyPhaseCycles.length > 0,
  enemyPhaseTitleDurationMs: enemyPhaseCycles.map((c) => c.enemyTitleDurationMs),
  enemyAttackedWithin4Cycles: cyc.reduce((n, c) => n + c.enemyAttacks, 0) > 0,
  totalEnemyAttackLines: cyc.reduce((n, c) => n + c.enemyAttacks, 0),
  playerHpDropped: cyc.some((c) => c.hpPlayerDelta < 0),
  controlReturnedEachCycle: cyc.length > 0 && cyc.every((c) => c.returnedToPlayer),
  roundsAdvancedEachCycle: cyc.length > 0 && cyc.every((c) => c.roundAfter > c.roundBefore),
  cycleRoundDeltas: cyc.map((c) => [c.roundBefore, c.roundAfter]),
  oneClickWhenNoApTransfers: out.noApProbe ? (out.noApProbe.allApSpent && out.noApProbe.didNotAskConfirm && out.noApProbe.phaseChanged && out.noApProbe.returned) : null,
  spaceConfirmWorks: out.spaceProbe ? out.spaceProbe.spaceBecameConfirm : null,
  noDestroyedStacksWithHp: out.destroyedWithHp.length === 0,
  autoBattleTally: tally,
  autoBattleNotAllSame: tally.unknown === 0 && !(tally.player === 0 || tally.enemy === 0),
  autoBattleVisibleAll: out.autoBattle.every((r) => r.visible),
  consoleErrors: out.consoleErrors.length,
  pageErrors: out.pageErrors.length,
};
console.log("\n=== VERIFY SUMMARY ===");
console.log(JSON.stringify({
  initial: out.initial,
  confirmProbe: out.confirmProbe,
  cycles: cyc.map((c) => ({ round: c.roundBefore + "→" + c.roundAfter, confirm: c.confirmRequested, enemyTitle: c.enemyTitleSeen, enemyTitleAtMs: c.enemyTitleAtMs, enemyTitleDurationMs: c.enemyTitleDurationMs, enemyAttacks: c.enemyAttacks, hp: c.hpPlayerBefore + "→" + c.hpPlayerAfter, returned: c.returnedToPlayer, elapsedMs: c.elapsedMs, deadWithHp: c.deadWithHp.length, phaseTimeline: c.phaseTimeline, enemyAttackLines: c.enemyAttackLines })),
  spaceProbe: out.spaceProbe,
  noApProbe: out.noApProbe,
  autoBattle: out.autoBattle.map((r) => ({ seed: r.seed, title: r.title, winner: r.winner, rounds: r.rounds })),
  destroyedWithHp: out.destroyedWithHp,
  checks: out.checks,
}, null, 2));
save();
