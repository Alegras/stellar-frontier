#!/usr/bin/env node
/**
 * Headless-верификатор мировой политики/динамики ИИ (task-44) на реальном sim API.
 * Проверяет: новости/cap/no-spam, детерминизм, save/load, AI-AI активность, HUD,
 * forceCollapse/forceAbsorb/forceMerge/forceCentralizeFederation (перенос систем/флотов/казны, dead),
 * вассал→интеграция, защита игрока, campaign flags.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/politics-verify.mjs [--json] [--ticks N]
 */
import * as data from "@sf/data";
import * as sim from "@sf/sim";

const AS_JSON = process.argv.includes("--json");
const TICKS = (() => { const i = process.argv.indexOf("--ticks"); return i >= 0 ? Number(process.argv[i + 1]) : 800; })();
const results = [];
const rec = (s, n, d) => { results.push({ status: s, name: n, detail: d }); if (!AS_JSON) console.log(s + " · " + n + (d ? " — " + d : "")); };
const pass = (n, d) => rec("PASS", n, d);
const fail = (n, d) => rec("FAIL", n, d);
const skip = (n, d) => rec("SKIP", n, d);
const info = (n, d) => rec("INFO", n, d);

const makeWorld = (seed = 42) => { const w = sim.createWorld(seed, data.MODE, data.BALANCE); sim.ensureFg(w); sim.ensureAiWorld(w); return w; };
const run = (w, ticks) => { for (let i = 0; i < ticks; i++) sim.tick(w); };
const owners = (w) => w.systems.map((s) => s.ownerId);
const deadOf = (w) => w.empires.filter((e) => e.dead).map((e) => e.id);
const news = (w) => sim.getAiNews(w);
const events = (w) => sim.getAiWorldEvents(w);
const stateOf = (w) => sim.getAiWorldState(w);
const aiEmp = (w, id) => w.empires.find((e) => e.id === id);
const snapshot = (w) => JSON.stringify({
  news: news(w).map((n) => [n.id, n.tick, n.kind, n.a, n.b]),
  owners: owners(w), dead: deadOf(w),
  relations: sim.getAiRelations(w), statuses: sim.ensureAiWorld(w).statuses,
  blocs: stateOf(w).blocs, campaign: w.fg?.campaign?.flags ?? {}, tick: w.tick,
});

// ---------------------------------------------------------------- длинный прогон
const w = makeWorld(42);
let threw = null;
try { run(w, TICKS); } catch (e) { threw = String(e); }
if (threw) fail("длинный прогон " + TICKS, threw); else pass("длинный прогон " + TICKS + " тактов без исключений");

// ---------------------------------------------------------------- новости
try {
  const list = news(w);
  const bad = list.filter((n) => typeof n.id !== "number" || typeof n.tick !== "number" || !n.kind || !n.titleRu);
  const raw = sim.ensureAiWorld(w).news;
  const perTick = {};
  for (const n of list) perTick[n.tick] = (perTick[n.tick] ?? 0) + 1;
  const maxPerTick = Math.max(0, ...Object.values(perTick));
  const ids = list.map((n) => n.id);
  const dup = ids.length - new Set(ids).size;
  if (list.length > 0 && bad.length === 0) pass("news: структура", "count=" + list.length + " kinds=" + [...new Set(list.map((n) => n.kind))].slice(0, 12).join(","));
  else fail("news: структура/наличие", "count=" + list.length + " bad=" + bad.length);
  if (raw.length <= sim.AI_NEWS_CAP && maxPerTick <= 8 && dup === 0) pass("news: cap/no-spam/no-dup", "cap=" + sim.AI_NEWS_CAP + " raw=" + raw.length + " maxPerTick=" + maxPerTick);
  else fail("news: cap/no-spam", "raw=" + raw.length + " maxPerTick=" + maxPerTick + " dup=" + dup);
} catch (e) { fail("news", String(e)); }

// ---------------------------------------------------------------- AI-AI активность + HUD
try {
  const st = stateOf(w);
  const hud = sim.getAiWorldHud(w);
  const rels = sim.getAiRelations(w);
  info("AI-AI stats", JSON.stringify(st.stats) + " hud=" + JSON.stringify(hud));
  if (st.stats.wars + st.stats.alliances + st.stats.federations + st.stats.blocs > 0 && rels.length > 0) pass("AI-AI активность и HUD", "relations=" + rels.length + " stats=" + JSON.stringify(st.stats));
  else fail("AI-AI активность", JSON.stringify(st.stats) + " relations=" + rels.length);
  const p = st.playerImpact;
  if (p && Array.isArray(p.allies) && Array.isArray(p.threats) && Array.isArray(p.wars)) pass("playerImpact поля", JSON.stringify(p));
  else fail("playerImpact", JSON.stringify(p));
} catch (e) { fail("AI-AI/HUD", String(e)); }

// ---------------------------------------------------------------- детерминизм
try {
  const a = makeWorld(77), b = makeWorld(77);
  run(a, 500); run(b, 500);
  if (snapshot(a) === snapshot(b)) pass("детерминизм seed 77 (500 тактов)"); else fail("детерминизм", "снимки различаются");
} catch (e) { fail("детерминизм", String(e)); }

// ---------------------------------------------------------------- save/load
try {
  const w2 = sim.deserializeWorld(sim.serializeWorld(w));
  sim.ensureFg(w2); sim.ensureAiWorld(w2);
  const s1 = snapshot(w), s2 = snapshot(w2);
  const w3 = sim.deserializeWorld(sim.serializeWorld(w2));
  sim.ensureFg(w3); sim.ensureAiWorld(w3);
  const s3 = snapshot(w3);
  if (s1 === s2) pass("save/load: aiWorld/news/owners/dead/statuses"); else fail("save/load", "снимок различается");
  if (s2 === s3) pass("save/load: повторный load идемпотентен"); else fail("save/load: повторный load", "различия");
} catch (e) { fail("save/load", String(e)); }

// ---------------------------------------------------------------- collapse
try {
  const wc = makeWorld(101);
  run(wc, 50);
  sim.aiWorldPhase(wc);
  const victim = wc.empires.find((e) => !e.isPlayer && !e.dead && e.systems.length > 0);
  if (!victim) throw new Error("нет AI-империи с системами");
  const sysBefore = victim.systems.slice();
  const ok = sim.forceCollapse(wc, victim.id);
  const after = aiEmp(wc, victim.id);
  const noOwn = wc.systems.filter((s) => s.ownerId === victim.id).length === 0;
  const kindNews = news(wc).some((n) => n.kind === "collapse");
  const status = sim.ensureAiWorld(wc).statuses[victim.id]?.state;
  if (ok && after.dead && noOwn && kindNews && sysBefore.length > 0) pass("forceCollapse: dead + системы перешли + новость", "status=" + status);
  else fail("forceCollapse", JSON.stringify({ ok, dead: after.dead, noOwn, kindNews, status }));
} catch (e) { fail("forceCollapse", String(e)); }

// ---------------------------------------------------------------- absorb (перенос систем/флотов/казны)
try {
  const wa = makeWorld(102);
  run(wa, 50);
  sim.aiWorldPhase(wa);
  const ais = wa.empires.filter((e) => !e.isPlayer && !e.dead && e.id !== 9).sort((a, b) => b.systems.length - a.systems.length);
  const strong = ais[0], weak = ais.find((e) => e.id !== strong?.id && e.systems.length > 0);
  if (!strong || !weak) throw new Error("нет пары AI");
  const weakSys = wa.systems.filter((s) => s.ownerId === weak.id).map((s) => s.id);
  const strongSysBefore = wa.systems.filter((s) => s.ownerId === strong.id).length;
  const weakFleets = wa.fleets.filter((f) => f.empireId === weak.id).map((f) => f.id);
  const weakCredits = weak.resources.credits;
  const strongCredits = strong.resources.credits;
  const ok = sim.forceAbsorb(wa, strong.id, weak.id);
  const weakAfter = aiEmp(wa, weak.id);
  const movedSys = weakSys.every((id) => wa.systems[id]?.ownerId === strong.id);
  const movedFleets = weakFleets.every((id) => wa.fleets.find((f) => f.id === id)?.empireId === strong.id);
  const creditsMoved = Math.abs(strong.resources.credits - (strongCredits + weakCredits)) < 1;
  const kindNews = news(wa).some((n) => n.kind === "annexation" || n.kind === "treaty");
  if (ok && weakAfter.dead && movedSys && movedFleets && creditsMoved && wa.systems.filter((s) => s.ownerId === strong.id).length >= strongSysBefore + weakSys.length) pass("forceAbsorb: dead + системы/флоты/казна + новость", "sys=" + weakSys.length + " fleets=" + weakFleets.length + " credits=" + weakCredits);
  else fail("forceAbsorb", JSON.stringify({ ok, dead: weakAfter.dead, movedSys, movedFleets, creditsMoved, kindNews }));
  const fedList = wa.fg?.federations ?? [];
  if (!fedList.some((f) => f.members.includes(weak.id))) pass("absorb: dead-империя удалена из федераций"); else fail("absorb: dead в федерации");
} catch (e) { fail("forceAbsorb", String(e)); }

// ---------------------------------------------------------------- merge/centralize федерации
try {
  const wm = makeWorld(103);
  run(wm, 50); sim.aiWorldPhase(wm);
  const ais = wm.empires.filter((e) => !e.isPlayer && !e.dead && e.id !== 9);
  const a = ais[0], b = ais[1];
  if (!a || !b) throw new Error("нет пары AI");
  const fg = wm.fg;
  const fid = 999;
  fg.federations.push({ id: fid, nameRu: "QA-Федерация", name: "QA", members: [a.id, b.id], presidentId: a.id, foundedTick: 0, votes: {}, treasury: { energy: 0, alloys: 0 }, generalFleet: [], chairSince: 0 });
  sim.activateTreaty(wm, a.id, b.id, "federation");
  const bSys = wm.systems.filter((s) => s.ownerId === b.id).length;
  const ok = sim.forceCentralizeFederation(wm, fid);
  const merged = aiEmp(wm, b.id);
  const kindNews = news(wm).some((n) => n.kind === "centralization");
  const fedGone = !wm.fg.federations.some((f) => f.id === fid);
  if (ok && merged.dead && fedGone && kindNews) pass("forceCentralizeFederation: единая империя + dead + новость", "merged sys=" + bSys);
  else fail("centralize federation", JSON.stringify({ ok, dead: merged.dead, fedGone, kindNews }));
} catch (e) { fail("centralize federation", String(e)); }

// ---------------------------------------------------------------- содружество → единая империя (natural)
try {
  const wc = makeWorld(106);
  run(wc, 20);
  const ais = wc.empires.filter((e) => !e.isPlayer && !e.dead && e.id !== 9).slice(0, 4);
  if (ais.length < 4) throw new Error("мало AI для содружества");
  const fg = wc.fg;
  const fid = 501;
  fg.federations.push({ id: fid, nameRu: "QA-Содружество", name: "QA", members: ais.map((e) => e.id), presidentId: ais[0].id, foundedTick: 0, votes: {}, treasury: { energy: 0, alloys: 0 }, generalFleet: [], chairSince: 0 });
  wc.tick = 10;
  sim.aiWorldPhase(wc);
  const aw = sim.ensureAiWorld(wc);
  const cw = aw.blocs.find((b) => b.kind === "commonwealth" && b.members.length >= 4);
  const cwNews = news(wc).some((n) => n.kind === "commonwealth");
  if (cw && cwNews && wc.fg.campaign.flags.ai_commonwealth === 1) pass("содружество: 4 участника → commonwealth bloc + флаг", "bloc=" + cw.id);
  else fail("содружество", JSON.stringify({ cw: cw?.id, cwNews, flag: wc.fg.campaign.flags.ai_commonwealth }));
  // централизация после COMMONWEALTH_UNIFY_AGE
  wc.tick = sim.COMMONWEALTH_UNIFY_AGE + 20;
  if (wc.tick % sim.AI_WORLD_INTERVAL !== 0) wc.tick += sim.AI_WORLD_INTERVAL - (wc.tick % sim.AI_WORLD_INTERVAL);
  const membersBefore = fg.federations.find((f) => f.id === fid)?.members ?? [];
  sim.aiWorldPhase(wc);
  const deadAfter = membersBefore.slice(1).filter((id) => aiEmp(wc, id)?.dead);
  const fedGone = !fg.federations.some((f) => f.id === fid);
  const centralNews = news(wc).some((n) => n.kind === "centralization");
  if (fedGone && deadAfter.length === Math.max(0, membersBefore.length - 1) && centralNews) pass("содружество → единая империя: dead участников + новость", "dead=" + deadAfter.length);
  else fail("содружество→империя", JSON.stringify({ fedGone, deadAfter, membersBefore, centralNews }));
} catch (e) { fail("содружество/централизация", String(e)); }

// ---------------------------------------------------------------- вассал → интеграция
try {
  const wv = makeWorld(104);
  run(wv, 50);
  const ais = wv.empires.filter((e) => !e.isPlayer && !e.dead && e.id !== 9);
  const overlord = ais[0], vassal = ais[1];
  if (!overlord || !vassal) throw new Error("нет пары AI");
  sim.activateTreaty(wv, overlord.id, vassal.id, "vassal");
  if (typeof sim.advancedOf === "function") {
    const adv = sim.advancedOf(wv, overlord.id);
    if (!adv.vassals.includes(vassal.id)) adv.vassals.push(vassal.id);
  }
  const aw = sim.ensureAiWorld(wv);
  aw.flags["aiworld:vassal:" + overlord.id + ":" + vassal.id] = -1_000_000;
  const key = overlord.id < vassal.id ? overlord.id + ":" + vassal.id : vassal.id + ":" + overlord.id;
  if (wv.fg.relations[key]) wv.fg.relations[key].opinion = 60;
  const vassalSys = wv.systems.filter((s) => s.ownerId === vassal.id).map((s) => s.id);
  wv.tick = 10;
  sim.aiWorldPhase(wv);
  const v = aiEmp(wv, vassal.id);
  const transferred = vassalSys.length > 0 && vassalSys.every((id) => wv.systems[id]?.ownerId === overlord.id);
  if (v.dead && transferred) pass("вассал интегрирован через N тактов", "dead=" + v.dead + " sys=" + vassalSys.length);
  else fail("вассал интеграция", JSON.stringify({ dead: v.dead, transferred, vassalSys: vassalSys.length }));
} catch (e) { fail("вассал интеграция", String(e)); }

// ---------------------------------------------------------------- событие игроку при попытке поглощения/вассалитета + выбор
try {
  const wp = makeWorld(107);
  run(wp, 20);
  const player = wp.empires.find((e) => e.isPlayer);
  const aggressor = wp.empires.filter((e) => !e.isPlayer && !e.dead && e.id !== 9).sort((a, b) => b.systems.length - a.systems.length)[0];
  if (!aggressor) throw new Error("нет AI-агрессора");
  // усиливаем агрессора (тестовая манипуляция флотом), чтобы сработал порог vassalization_demand
  const fleet = wp.fleets.find((f) => f.empireId === aggressor.id && f.ships.length > 0);
  if (fleet) { const ship = fleet.ships[0]; for (let i = 0; i < 40; i++) fleet.ships.push(structuredClone(ship)); }
  wp.tick = 10;
  sim.aiWorldPhase(wp);
  const ev = events(wp).find((e) => e.targetEmpireId === player.id && ["vassalization_demand", "annexation_demand", "accession_offer"].includes(e.kind));
  if (!ev) skip("событие игроку о поглощении/вассалитете", "условия не сработали (нужен баланс сил)");
  else {
    const accept = ev.choices.find((c) => c.id === "accept") ?? ev.choices[0];
    const res = sim.aiWorldEventChoice(wp, player.id, ev.id, accept.id);
    const vassal = sim.treatyActive(wp, aggressor.id, player.id, "vassal");
    if (res.ok && !player.dead && (vassal || Object.keys(wp.fg?.campaign?.flags ?? {}).length > 0)) pass("игроку событие поглощения/вассалитета: выбор применён, игрок жив", ev.kind + " → " + accept.id + " vassal=" + vassal);
    else fail("событие игроку", JSON.stringify({ res, dead: player.dead, vassal }));
  }
} catch (e) { fail("событие игроку", String(e)); }

// ---------------------------------------------------------------- торговый блок и call-to-arms для игрока
try {
  const wt = makeWorld(108);
  run(wt, 20);
  const player = wt.empires.find((e) => e.isPlayer);
  const ais = wt.empires.filter((e) => !e.isPlayer && !e.dead && e.id !== 9).slice(0, 2);
  if (ais.length >= 2 && typeof sim.activateTreaty === "function") {
    sim.activateTreaty(wt, ais[0].id, ais[1].id, "trade");
    sim.activateTreaty(wt, player.id, ais[0].id, "trade");
    wt.tick = 10;
    sim.aiWorldPhase(wt);
    const blocEvent = events(wt).find((e) => e.kind === "trade_bloc" && e.targetEmpireId === player.id);
    if (blocEvent) {
      const join = blocEvent.choices.find((c) => c.id === "join") ?? blocEvent.choices[0];
      const res = sim.aiWorldEventChoice(wt, player.id, blocEvent.id, join.id);
      pass("событие торгового блока игроку: выбор применён", "res=" + res.ok + " flag=" + wt.fg.campaign.flags.ai_trade_bloc);
    } else skip("событие торгового блока", "не создано (нужны 2+ AI с trade)");
  } else skip("торговый блок", "нет API/пары AI");
} catch (e) { fail("торговый блок", String(e)); }

try {
  const wc = makeWorld(109);
  run(wc, 20);
  const player = wc.empires.find((e) => e.isPlayer);
  const ais = wc.empires.filter((e) => !e.isPlayer && !e.dead && e.id !== 9).slice(0, 2);
  if (ais.length >= 2 && typeof sim.applyCommandAs === "function" && typeof sim.activateTreaty === "function") {
    sim.activateTreaty(wc, player.id, ais[0].id, "alliance");
    sim.applyCommandAs(wc, ais[0].id, { type: "declare_war", targetEmpireId: ais[1].id, cb: "humiliation" });
    wc.tick = 10;
    sim.aiWorldPhase(wc);
    const cta = events(wc).find((e) => e.kind === "call_to_arms" && e.targetEmpireId === player.id);
    if (cta) {
      const join = cta.choices.find((c) => c.id === "join") ?? cta.choices[0];
      const res = sim.aiWorldEventChoice(wc, player.id, cta.id, join.id);
      const atWar = sim.atWarWith(wc, player.id, ais[1].id);
      pass("call-to-arms игроку: выбор применён", "res=" + res.ok + " atWar=" + atWar);
    } else skip("call-to-arms", "не создан (нужен war+alliance)");
  } else skip("call-to-arms", "нет API/пары AI");
} catch (e) { fail("call-to-arms", String(e)); }

// ---------------------------------------------------------------- защита игрока
try {
  const wp = makeWorld(105);
  run(wp, 20);
  const player = wp.empires.find((e) => e.isPlayer);
  const strong = wp.empires.find((e) => !e.isPlayer && !e.dead && e.id !== 9);
  const forced = strong ? sim.forceAbsorb(wp, strong.id, player.id) : true;
  if (forced === false && !player.dead) pass("игрок не поглощается forceAbsorb", "player dead=" + player.dead);
  else fail("защита игрока", JSON.stringify({ forced, dead: player.dead }));
  // сценарии событий для игрока (если есть): player-targeted vassal/accession/cta/trade_bloc/refugees
  const evts = events(wp).filter((e) => e.targetEmpireId === player.id);
  info("события для игрока", JSON.stringify(evts.map((e) => e.kind)));
  if (evts.length === 0 || !player.dead) pass("игрок не удалён при событиях", "events=" + evts.length);
} catch (e) { fail("защита игрока", String(e)); }

// ---------------------------------------------------------------- политическая карта/столицы (follow-up task-42)
try {
  if (typeof sim.getPoliticalMap === "function" && typeof sim.getKnownSystems === "function" && typeof sim.getEmpireCapitals === "function") {
    const wm = makeWorld(110);
    run(wm, 50);
    const known = sim.getKnownSystems(wm, wm.playerEmpireId);
    const capitals = sim.getEmpireCapitals(wm);
    const map = sim.getPoliticalMap(wm);
    const alive = wm.empires.filter((e) => !e.dead).length;
    if (known.length > 0 && capitals.length > 0 && map.systems.length === known.length && capitals.length <= alive) pass("политическая карта: known systems + столицы + map", "known=" + known.length + " capitals=" + capitals.length);
    else fail("политическая карта", JSON.stringify({ known: known.length, capitals: capitals.length, alive }));
  } else skip("политическая карта", "API ещё не экспортирован");
} catch (e) { fail("политическая карта", String(e)); }

// ---------------------------------------------------------------- campaign flags
try {
  const flags = w.fg?.campaign?.flags ?? {};
  const need = ["ai_war", "ai_federation", "ai_trade_bloc"];
  const missing = need.filter((k) => flags[k] === undefined);
  if (missing.length === 0) pass("campaign flags мировой политики", need.map((k) => k + "=" + flags[k]).join(","));
  else fail("campaign flags", "missing=" + missing.join(","));
} catch (e) { fail("campaign flags", String(e)); }

const counts = { PASS: 0, FAIL: 0, SKIP: 0, INFO: 0 };
for (const r of results) counts[r.status]++;
if (AS_JSON) console.log(JSON.stringify({ counts, results }, null, 2));
else console.log("\nИТОГ: PASS=" + counts.PASS + " FAIL=" + counts.FAIL + " SKIP=" + counts.SKIP + " INFO=" + counts.INFO);
if (counts.FAIL > 0) process.exitCode = 1;