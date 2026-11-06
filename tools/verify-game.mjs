#!/usr/bin/env node
/**
 * Headless-прогон симуляции «Stellar Frontier» (без браузера, без DOM).
 *
 * Создаёт мир по seed, прокручивает N тактов и печатает:
 *   tick, ресурсы игрока, доход/такт, число флотов/колоний, длительность такта (мс),
 *   JSON-хэш состояния (sha256 от канонического JSON) — доказательство детерминизма.
 *
 * Запуск (из корня монорепо):
 *   node <...>/node.exe <...>/pnpm.mjs exec tsx tools/verify-game.mjs
 *   ... --seed 42 --ticks 200 --every 50
 *   ... --json   (только итоговый JSON, удобно для CI)
 *
 * Скрипт намеренно не зависит от Playwright и от UI.
 */
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const SEED = Number(args.seed ?? 42);
const TICKS = Number(args.ticks ?? 200);
const EVERY = Math.max(1, Number(args.every ?? 50));
const AS_JSON = Boolean(args.json);

/** Импорт @sf/sim: сначала bare-specifier (работает при запуске из workspace),
 *  затем относительный путь к исходникам — устойчиво к отсутствию линка в корне. */
async function loadSim() {
  const errors = [];
  for (const load of [() => import("@sf/sim"), () => import("../packages/sim/src/index.ts")]) {
    try { return await load(); } catch (e) { errors.push(e.message); }
  }
  throw new Error("Не удалось импортировать @sf/sim: " + errors.join(" | "));
}

async function loadData() {
  const errors = [];
  for (const load of [() => import("@sf/data"), () => import("../packages/data/src/index.ts")]) {
    try { return await load(); } catch (e) { errors.push(e.message); }
  }
  throw new Error("Не удалось импортировать @sf/data: " + errors.join(" | "));
}

/** Канонический JSON: стабильный порядок ключей, чтобы хэш не зависел от порядка вставки. */
function canonicalJson(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const keys = Object.keys(v).sort();
    const obj = {};
    for (const k of keys) obj[k] = walk(v[k]);
    return obj;
  };
  return JSON.stringify(walk(value));
}

function stateHash(world) {
  return createHash("sha256").update(canonicalJson(world)).digest("hex");
}

function playerOf(world) {
  return world.empires.find((e) => e.isPlayer) ?? world.empires[0];
}

function resourcesLine(emp) {
  const order = ["energy", "minerals", "food", "alloys", "goods", "unity", "influence", "credits"];
  return order.map((k) => k + "=" + (emp?.resources?.[k] ?? 0)).join(" ");
}

function incomeLine(emp) {
  const order = ["energy", "minerals", "food", "alloys", "goods", "unity", "influence", "credits"];
  return order.map((k) => k + "=" + (emp?.incomeLastTick?.[k] ?? 0)).join(" ");
}

function fmtRow(r) {
  return [
    String(r.tick).padStart(4),
    String(r.energy).padStart(7),
    String(r.minerals).padStart(7),
    String(r.food).padStart(7),
    String(r.alloys).padStart(6),
    String(r.goods).padStart(6),
    String(r.unity).padStart(5),
    String(r.infl).padStart(6),
    String(r.incomeEnergy).padStart(6),
    String(r.fleets).padStart(3),
    String(r.colonies).padStart(3),
    r.ms.toFixed(2).padStart(8),
    r.hash.slice(0, 16),
  ].join("  ");
}

async function main() {
  const sim = await loadSim();
  const data = await loadData();
  const createWorld = sim.createWorld;
  const tick = sim.tick;
  const MODE = data.MODE;
  const BALANCE = data.BALANCE;
  if (typeof createWorld !== "function" || typeof tick !== "function") {
    throw new Error("В @sf/sim нет createWorld/tick (API не реализован)");
  }

  const modeId = MODE?.modeId ?? "?";
  console.log(`Stellar Frontier · headless sim · seed=${SEED} ticks=${TICKS} mode=${modeId}`);

  const world = createWorld(SEED, MODE, BALANCE);
  const rows = [];
  const durations = [];
  let lastHash = stateHash(world);

  const snapshot = (t, ms, hash) => {
    const emp = playerOf(world);
    rows.push({
      tick: t,
      energy: emp?.resources?.energy ?? 0,
      minerals: emp?.resources?.minerals ?? 0,
      food: emp?.resources?.food ?? 0,
      alloys: emp?.resources?.alloys ?? 0,
      goods: emp?.resources?.goods ?? 0,
      unity: emp?.resources?.unity ?? 0,
      infl: emp?.resources?.influence ?? 0,
      incomeEnergy: emp?.incomeLastTick?.energy ?? 0,
      fleets: (world.fleets ?? []).filter((f) => f.empireId === emp?.id && (f.ships?.length ?? 0) > 0).length,
      colonies: (world.colonies ?? []).filter((c) => c.empireId === emp?.id).length,
      ms,
      hash,
    });
  };

  snapshot(0, 0, lastHash);

  const tStart = performance.now();
  for (let i = 1; i <= TICKS; i++) {
    const t0 = performance.now();
    tick(world);
    const ms = performance.now() - t0;
    durations.push(ms);
    if (world.tick !== i) {
      console.warn(`[warn] world.tick=${world.tick} после ${i} вызовов tick()`);
    }
    lastHash = stateHash(world);
    if (i % EVERY === 0 || i === TICKS) snapshot(i, ms, lastHash);
  }
  const totalMs = performance.now() - tStart;

  // Детерминизм: второй прогон того же seed должен дать тот же хэш.
  let determinism = "n/a";
  let secondHash = null;
  try {
    const w2 = createWorld(SEED, MODE, BALANCE);
    for (let i = 0; i < TICKS; i++) tick(w2);
    secondHash = stateHash(w2);
    determinism = secondHash === lastHash ? "OK (bit-identical)" : "FAIL (hash mismatch)";
  } catch (e) {
    determinism = "n/a (" + e.message + ")";
  }

  const emp = playerOf(world);
  const summary = {
    seed: SEED,
    ticks: TICKS,
    mode: modeId,
    tick: world.tick,
    resources: emp?.resources ?? null,
    incomeLastTick: emp?.incomeLastTick ?? null,
    fleets: (world.fleets ?? []).filter((f) => f.empireId === emp?.id).length,
    colonies: (world.colonies ?? []).filter((c) => c.empireId === emp?.id).length,
    systems: (world.systems ?? []).filter((s) => s.ownerId === emp?.id).length,
    battles: (world.battles ?? []).length,
    lastBattle: (() => {
      const b = (world.battles ?? [])[(world.battles ?? []).length - 1];
      return b ? { tick: b.tick, outcome: b.outcome, attacker: b.attacker.empireId, defender: b.defender.empireId } : null;
    })(),
    stateHash: lastHash,
    determinism,
    secondHash,
    tickMs: {
      avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      min: durations.length ? Math.min(...durations) : 0,
      max: durations.length ? Math.max(...durations) : 0,
      total: totalMs,
    },
  };

  if (AS_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("");
    console.log("tick   energy  minerals     food  alloys   goods  unity    infl  inc.E  flt  col        ms  state-hash(16)");
    for (const r of rows) console.log(fmtRow(r));
    console.log("");
    console.log("Ресурсы игрока (итог): " + resourcesLine(emp));
    console.log("Доход/такт (итог):     " + incomeLine(emp));
    console.log("Флоты: " + summary.fleets + " · Колонии: " + summary.colonies + " · Системы: " + summary.systems);
    console.log("Боёв: " + summary.battles + (summary.lastBattle ? " · последний: такт " + summary.lastBattle.tick + " " + summary.lastBattle.outcome + " (" + summary.lastBattle.attacker + " vs " + summary.lastBattle.defender + ")" : ""));
    console.log(
      "Такт, мс: avg=" + summary.tickMs.avg.toFixed(3) +
      " min=" + summary.tickMs.min.toFixed(3) +
      " max=" + summary.tickMs.max.toFixed(3) +
      " total=" + summary.tickMs.total.toFixed(1),
    );
    console.log("JSON-хэш состояния: " + lastHash);
    console.log("Детерминизм: " + determinism);
  }

  if (determinism.startsWith("FAIL")) process.exitCode = 2;
}

main().catch((e) => {
  console.error("[verify-game] ОШИБКА: " + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});