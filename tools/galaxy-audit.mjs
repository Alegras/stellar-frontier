#!/usr/bin/env node
/**
 * Аудит генератора галактики @sf/sim (M1).
 * Для N seed'ов проверяет: связность 100%, изолированные системы, распределение степеней,
 * долю узких мест (degree 1–2), число «мостов» (articulation points), повторяемость по seed.
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/galaxy-audit.mjs --seeds 100
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const SEEDS = Number(args.seeds ?? 100);
const START = Number(args.start ?? 1);

async function loadSim() {
  for (const load of [() => import("@sf/sim"), () => import("../packages/sim/src/index.ts")]) {
    try { return await load(); } catch { /* next */ }
  }
  throw new Error("Не удалось импортировать @sf/sim");
}
async function loadData() {
  for (const load of [() => import("@sf/data"), () => import("../packages/data/src/index.ts")]) {
    try { return await load(); } catch { /* next */ }
  }
  throw new Error("Не удалось импортировать @sf/data");
}

const { createWorld, serializeWorld } = await loadSim();
const { MODE, BALANCE } = await loadData();

function connectivity(world) {
  const n = world.systems.length;
  const adj = world.systems.map((s) => s.links);
  const seen = new Uint8Array(n);
  const queue = [world.systems[0].id];
  seen[world.systems[0].id] = 1;
  let reached = 0;
  while (queue.length) {
    const id = queue.pop();
    reached++;
    for (const nx of adj[id]) {
      if (nx >= 0 && nx < n && !seen[nx]) { seen[nx] = 1; queue.push(nx); }
    }
  }
  let isolated = 0;
  for (const s of world.systems) if (s.links.length === 0) isolated++;
  const degrees = world.systems.map((s) => s.links.length);
  const chokepoints = degrees.filter((d) => d === 1 || d === 2).length;
  // мосты (articulation points) — грубая эвристика для «интересных структур»: DFS-тарджан
  let timer = 0;
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const art = new Uint8Array(n);
  const dfs = (v, parent) => {
    disc[v] = low[v] = timer++;
    let children = 0;
    for (const to of adj[v]) {
      if (to < 0 || to >= n) continue;
      if (disc[to] === -1) {
        children++;
        dfs(to, v);
        low[v] = Math.min(low[v], low[to]);
        if (parent !== -1 && low[to] >= disc[v]) art[v] = 1;
      } else if (to !== parent) {
        low[v] = Math.min(low[v], disc[to]);
      }
    }
    if (parent === -1 && children > 1) art[v] = 1;
  };
  for (let v = 0; v < n; v++) if (disc[v] === -1) dfs(v, -1);
  const articulation = art.reduce((a, b) => a + b, 0);
  return {
    systems: n,
    reached,
    connected: reached === n,
    isolated,
    avgDegree: degrees.reduce((a, b) => a + b, 0) / n,
    minDegree: Math.min(...degrees),
    maxDegree: Math.max(...degrees),
    chokepointPct: (100 * chokepoints) / n,
    articulation,
  };
}

let ok = true;
let connectedCount = 0;
let isolatedTotal = 0;
let chokepointMin = 100;
let chokepointSum = 0;
let artMin = 1e9;
const rows = [];
const hash = (w) => {
  const json = serializeWorld(w);
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, "0");
};
for (let seed = START; seed < START + SEEDS; seed++) {
  try {
    const world = createWorld(seed, MODE, BALANCE);
    const c = connectivity(world);
    connectedCount += c.connected ? 1 : 0;
    isolatedTotal += c.isolated;
    chokepointMin = Math.min(chokepointMin, c.chokepointPct);
    chokepointSum += c.chokepointPct;
    artMin = Math.min(artMin, c.articulation);
    // повторяемость
    const h1 = hash(world);
    const h2 = hash(createWorld(seed, MODE, BALANCE));
    if (h1 !== h2) { ok = false; rows.push({ seed, error: "non-deterministic " + h1 + " != " + h2 }); }
    if (!c.connected || c.isolated > 0) { ok = false; rows.push({ seed, ...c, hash: h1 }); }
  } catch (e) {
    ok = false;
    rows.push({ seed, error: String(e && e.message ? e.message : e) });
  }
}
const avgChokepoint = chokepointSum / SEEDS;
const summary = {
  seeds: SEEDS,
  seedsFrom: START,
  connectedPct: (100 * connectedCount) / SEEDS,
  isolatedTotal,
  chokepointAvgPct: Number(avgChokepoint.toFixed(2)),
  chokepointMinPct: Number(chokepointMin.toFixed(2)),
  articulationMin: artMin === 1e9 ? null : artMin,
  deterministic: ok && rows.length === 0,
  failures: rows.slice(0, 10),
};
console.log("Галактический аудит: seeds=" + SEEDS + " (" + START + ".." + (START + SEEDS - 1) + ")");
console.log(JSON.stringify(summary, null, 2));
if (!summary.deterministic) process.exitCode = 2;
if (summary.connectedPct < 100 || summary.isolatedTotal > 0) process.exitCode = 3;
if (summary.chokepointMinPct < 12) process.exitCode = 4;
