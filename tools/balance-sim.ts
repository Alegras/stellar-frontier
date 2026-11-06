#!/usr/bin/env node
/**
 * HEADLESS-АВТОБАЛАНС M10/M12 (GDD §13, docs/balance-log.md §7).
 *
 * Прогон: N сидов × 3 стратегии игрока × T тактов. Метрики:
 *  - соотношение «лидер/медиана» по счёту (цель ≤ 2×),
 *  - войны / союзы / федерации, кризисы (спавн/виды/победы), общее поражение галактики,
 *  - распределение победителей, средний счёт игрока, попы, мегаструктуры, традиции/перки.
 *
 * Параллельный прогон (24 ядра):
 *   tsx tools/balance-sim.ts --games 210 --ticks 2200 --parts 6 --part 0 --out tools/__bal0.json
 *   ... part 5 ...
 *   tsx tools/balance-sim.ts --merge tools/__bal0.json,tools/__bal1.json,... --append-doc
 *
 * Полный аудит: --games 1000 --ticks 7200 (часы; запускать частями).
 */
import * as nodeFs from "node:fs";
import { BALANCE, MODE, PERKS, TRADITION_TREES } from "../packages/data/src/index.ts";
import { districtCapacity } from "../packages/sim/src/economy.ts";
import {
  applyCommand, computeFullScore, createWorld, ensureFg, gdpShares, serializeWorld, tick,
} from "../packages/sim/src/index.ts";
import type { Command, World } from "../packages/sim/src/index.ts";

type StrategyId = "industrial" | "science" | "military";
const STRATEGIES: StrategyId[] = ["industrial", "science", "military"];
const MEGA_TYPES = ["sentinel_array", "gate", "star_forge", "ring_habitat", "dyson_sphere", "science_nexus", "beacon"] as const;

interface Args {
  games: number;
  ticks: number;
  seed: number;
  quick: boolean;
  json: boolean;
  appendDoc: boolean;
  quiet: boolean;
  parts: number;
  part: number;
  out: string | null;
  merge: string[] | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    games: 100, ticks: 1200, seed: 1000, quick: false, json: false, appendDoc: false,
    quiet: false, parts: 1, part: 0, out: null, merge: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--quick") args.quick = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--append-doc") args.appendDoc = true;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--games") args.games = Math.max(1, Number(argv[++i] ?? args.games));
    else if (arg === "--ticks") args.ticks = Math.max(50, Number(argv[++i] ?? args.ticks));
    else if (arg === "--seed") args.seed = Number(argv[++i] ?? args.seed);
    else if (arg === "--parts") args.parts = Math.max(1, Number(argv[++i] ?? args.parts));
    else if (arg === "--part") args.part = Math.max(0, Number(argv[++i] ?? args.part));
    else if (arg === "--out") args.out = argv[++i] ?? null;
    else if (arg === "--merge") args.merge = (argv[++i] ?? "").split(",").filter(Boolean);
  }
  if (args.quick) {
    args.games = 24;
    args.ticks = 600;
  }
  if (args.part >= args.parts) args.part = args.parts - 1;
  return args;
}

function playerColonies(world: World): number[] {
  const player = world.empires.find((e) => e.isPlayer);
  return player ? [...player.colonies] : [];
}

function strategyTick(world: World, strategy: StrategyId): void {
  const player = world.empires.find((e) => e.isPlayer);
  if (!player || player.dead) return;
  const command = (cmd: Command): boolean => applyCommand(world, cmd).ok;

  // 1. наука: закрываем пустые школы
  const schoolOrder = strategy === "science"
    ? (["physics", "society", "engineering"] as const)
    : strategy === "industrial"
      ? (["engineering", "society", "physics"] as const)
      : (["engineering", "physics", "society"] as const);
  for (const school of schoolOrder) {
    const progress = player.techs.progress[school];
    if (progress.techId !== null) continue;
    const offer = player.techs.offers[school][0];
    if (offer) command({ type: "research", school, techId: offer });
  }

  // 2. экономика/инфраструктура (не более одного действия за вызов)
  const colonies = playerColonies(world);
  for (const colonyId of colonies.slice(0, 3)) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (!colony || colony.queue.length >= 2) continue;
    const districts = strategy === "science"
      ? ["agriculture_district", "energy_district", "residential"]
      : strategy === "industrial"
        ? ["mining_district", "industrial_district", "energy_district", "agriculture_district", "residential"]
        : ["industrial_district", "mining_district", "energy_district", "agriculture_district"];
    // GDD §5.1: лимит районов = planet_size + 4; сверх лимита не строим (анти-спраул).
    let districtCount = 0;
    for (const key of Object.keys(colony.districts)) districtCount += colony.districts[key] ?? 0;
    let acted = false;
    if (districtCount < districtCapacity(world, colony)) {
      for (const districtId of districts) {
        if (command({ type: "build_district", colonyId, districtId })) {
          acted = true;
          break;
        }
      }
    }
    if (!acted) {
      const buildingId = strategy === "science" ? "laboratory" : "goods_factory";
      command({ type: "build_building", colonyId, buildingId });
    }
    break;
  }

  // 3. флот
  const shipyardColony = world.colonies.find(
    (c) => c.empireId === player.id && c.buildings.includes("shipyard"),
  );
  if (shipyardColony) {
    const alloys = player.resources.alloys;
    const wantShip = strategy === "military" ? alloys >= 30 : alloys >= 120;
    if (wantShip) {
      command({ type: "build_ship", systemId: shipyardColony.systemId, designId: "corvette_scout", count: 1 });
    }
  }

  // 4. традиции и перки (M6): раз в 50 тактов пробуем открыть доступное
  if (world.tick % 50 === 0) {
    // Наука — сначала перки (нужны для мегаструктур), затем традиции; иначе единство уходит в древо
    if (strategy === "science") {
      for (const perk of PERKS) command({ type: "perk_unlock", perkId: perk.id });
    }
    for (const tree of TRADITION_TREES) {
      for (const node of tree.nodes) {
        command({ type: "tradition_unlock", treeId: tree.id, nodeId: node.id });
      }
    }
    if (strategy !== "science") {
      for (const perk of PERKS) command({ type: "perk_unlock", perkId: perk.id });
    }
  }

  // 5. мегаструктуры (M12): science-стратегия вкладывается в поздние мегапроекты
  if (strategy === "science" && world.tick % 100 === 0 && player.resources.alloys >= 1200) {
    for (const megaType of MEGA_TYPES) {
      if (command({ type: "megastructure_build", megastructure: megaType, systemId: player.capitalSystemId })) break;
    }
  }
}

interface GameResult {
  seed: number;
  strategy: StrategyId;
  winner: string;
  winnerEmpireId: number;
  leaderRatio: number;
  leaderShare: number;
  leaderEmpireId: number;
  playerIsLeader: boolean;
  wars: number;
  warsActive: number;
  alliances: number;
  federations: number;
  crises: number;
  crisesDefeated: number;
  crisisKinds: string;
  galaxyDefeat: boolean;
  playerScore: number;
  playerPops: number;
  megastructures: number;
  traditions: number;
  perks: number;
  ticks: number;
}

function countAlliances(world: World): number {
  const fg = ensureFg(world);
  let count = 0;
  for (const key of Object.keys(fg.relations)) {
    const relation = fg.relations[key];
    if (relation.treaties.alliance.active) count += 1;
  }
  return count;
}

function playerPops(world: World): number {
  const player = world.empires.find((e) => e.isPlayer);
  if (!player) return 0;
  let pops = 0;
  for (const colonyId of player.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (colony) pops += colony.pops.workers + colony.pops.specialists + colony.pops.rulers;
  }
  return pops;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function playGame(seed: number, strategy: StrategyId, ticks: number): GameResult {
  const world = createWorld(seed, MODE, BALANCE);
  const strategyEvery = 10;
  for (let i = 0; i < ticks; i++) {
    if (world.tick % strategyEvery === 0) {
      try {
        strategyTick(world, strategy);
      } catch (error) {
        // стратегия не должна ронять прогон: логируем один раз на игру
        if (!(world as unknown as { __strategyError?: boolean }).__strategyError) {
          (world as unknown as { __strategyError?: boolean }).__strategyError = true;
          process.stderr.write(`strategy error: ${(error as Error).message}\n`);
        }
      }
    }
    tick(world);
    if (world.victory.achieved) break;
  }
  const fg = ensureFg(world);
  const playable = world.empires.filter((e) => !e.dead && e.id !== 9 && e.id < 90);
  const scored = playable.map((e) => ({ id: e.id, score: computeFullScore(world, e.id) }));
  const scores = scored.map((entry) => entry.score);
  const leaderEntry = scored.reduce((best, entry) => (entry.score > best.score ? entry : best), scored[0] ?? { id: 0, score: 0 });
  const best = scores.length > 0 ? Math.max(...scores) : 0;
  const med = Math.max(1, median(scores));
  const player = world.empires.find((e) => e.isPlayer)!;
  const adv = fg.empires[player.id];
  const crisisKinds = fg.crises.map((c) => `${c.kind}${c.defeated ? "+" : ""}`).join("|");
  return {
    seed,
    strategy,
    winner: world.victory.achieved ?? "none",
    winnerEmpireId: world.victory.winnerEmpireId,
    leaderRatio: best / Math.max(1, med),
    leaderShare: gdpShares(world).leaderShare,
    leaderEmpireId: leaderEntry.id,
    playerIsLeader: leaderEntry.id === player.id,
    wars: world.flags["hist:wars"] ?? 0,
    warsActive: fg.wars.length,
    alliances: countAlliances(world),
    federations: fg.federations.length,
    crises: fg.crises.length,
    crisesDefeated: fg.crises.filter((c) => c.defeated).length,
    crisisKinds,
    galaxyDefeat: (world.flags["crisis_defeat"] ?? 0) > 0,
    playerScore: computeFullScore(world, player.id),
    playerPops: playerPops(world),
    megastructures: fg.megastructures.length,
    traditions: adv ? adv.traditions.unlocked.length : 0,
    perks: adv ? adv.perks.length : 0,
    ticks: world.tick,
  };
}

interface Aggregate {
  strategy: StrategyId;
  games: number;
  wins: Record<string, number>;
  avgLeaderRatio: number;
  avgLeaderShare: number;
  playerLeaderRate: number;
  p95LeaderRatio: number;
  avgWars: number;
  avgWarsActive: number;
  avgAlliances: number;
  avgFederations: number;
  avgCrises: number;
  avgCrisesDefeated: number;
  crisisKinds: Record<string, number>;
  galaxyDefeatRate: number;
  avgPlayerScore: number;
  medianPlayerPops: number;
  avgMegastructures: number;
  avgTraditions: number;
  avgPerks: number;
  avgTicks: number;
}

function topKinds(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "—";
  return entries.map(([kind, count]) => `${kind}:${count}`).join(", ");
}

function aggregate(strategy: StrategyId, results: GameResult[]): Aggregate {
  const wins: Record<string, number> = {};
  const crisisKinds: Record<string, number> = {};
  for (const result of results) {
    wins[result.winner] = (wins[result.winner] ?? 0) + 1;
    if (result.crisisKinds) {
      for (const kind of result.crisisKinds.split("|")) crisisKinds[kind] = (crisisKinds[kind] ?? 0) + 1;
    }
  }
  const ratios = results.map((r) => r.leaderRatio).sort((a, b) => a - b);
  const p95 = ratios.length > 0 ? ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.95))] : 0;
  const avg = (fn: (r: GameResult) => number): number =>
    results.length > 0 ? results.reduce((acc, r) => acc + fn(r), 0) / results.length : 0;
  return {
    strategy,
    games: results.length,
    wins,
    avgLeaderRatio: avg((r) => r.leaderRatio),
    avgLeaderShare: avg((r) => r.leaderShare),
    playerLeaderRate: avg((r) => (r.playerIsLeader ? 1 : 0)),
    p95LeaderRatio: p95,
    avgWars: avg((r) => r.wars),
    avgWarsActive: avg((r) => r.warsActive),
    avgAlliances: avg((r) => r.alliances),
    avgFederations: avg((r) => r.federations),
    avgCrises: avg((r) => r.crises),
    avgCrisesDefeated: avg((r) => r.crisesDefeated),
    crisisKinds,
    galaxyDefeatRate: avg((r) => (r.galaxyDefeat ? 1 : 0)),
    avgPlayerScore: avg((r) => r.playerScore),
    medianPlayerPops: median(results.map((r) => r.playerPops)),
    avgMegastructures: avg((r) => r.megastructures),
    avgTraditions: avg((r) => r.traditions),
    avgPerks: avg((r) => r.perks),
    avgTicks: avg((r) => r.ticks),
  };
}

function winnerSummary(wins: Record<string, number>, games: number): string {
  const entries = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  return entries.map(([kind, count]) => `${kind}: ${count}/${games}`).join(", ") || "—";
}

function verdicts(aggregates: Aggregate[]): Array<{ metric: string; target: string; value: string; status: "PASS" | "WARN" }> {
  const worstRatio = Math.max(...aggregates.map((a) => a.avgLeaderRatio));
  const avg = (fn: (a: Aggregate) => number): number =>
    aggregates.reduce((acc, a) => acc + fn(a), 0) / Math.max(1, aggregates.length);
  // Войны нормируются на 100 лет (5600 тактов), т.к. прогоны могут быть короче/длиннее.
  const warsPer100y = avg((a) => a.avgWars * (5600 / Math.max(1, a.avgTicks)));
  const warsActive = avg((a) => a.avgWarsActive);
  const leaderShare = avg((a) => a.avgLeaderShare);
  const totalFederations = avg((a) => a.avgFederations);
  const crises = avg((a) => a.avgCrises);
  const defeatRate = avg((a) => a.galaxyDefeatRate);
  const megas = avg((a) => a.avgMegastructures);
  return [
    { metric: "Лидер/медиана по счёту", target: "≤ 2.0×", value: `${worstRatio.toFixed(2)}×`, status: worstRatio <= 2 ? "PASS" : "WARN" },
    { metric: "Доля ВВП лидера (анти-снежок)", target: "≤ 40%", value: `${Math.round(leaderShare * 100)}%`, status: leaderShare <= 0.4 ? "PASS" : "WARN" },
    { metric: "Войны за 100 лет (старт)", target: "≥ 3", value: `${warsPer100y.toFixed(1)} (актив. ${warsActive.toFixed(1)})`, status: warsPer100y >= 3 ? "PASS" : "WARN" },
    { metric: "Федерации за партию", target: "≥ 1 в части партий", value: totalFederations.toFixed(2), status: totalFederations >= 0.5 ? "PASS" : "WARN" },
    { metric: "Кризисы за партию", target: "1–3", value: crises.toFixed(2), status: crises >= 1 ? "PASS" : "WARN" },
    { metric: "Мегаструктуры за партию", target: "≥ 0.1 в поздних прогонах", value: megas.toFixed(2), status: megas >= 0.1 ? "PASS" : "WARN" },
    { metric: "Общее поражение галактики", target: "≤ 40% партий", value: `${Math.round(defeatRate * 100)}%`, status: defeatRate <= 0.4 ? "PASS" : "WARN" },
  ];
}

function toMarkdown(args: Args, aggregates: Aggregate[], verdictRows: ReturnType<typeof verdicts>, deterministic: boolean, elapsedMs: number): string {
  const head = [
    `### Прогон: ${args.games} игр (сиды ${args.seed}..${args.seed + args.games - 1}) × ${STRATEGIES.length} стратегии × ${args.ticks} тактов${args.parts > 1 ? ` (часть ${args.part + 1}/${args.parts})` : ""}`,
    "",
    `Детерминизм (двойной прогон первого сида): **${deterministic ? "OK" : "FAIL"}**; время ${(elapsedMs / 1000).toFixed(1)} с.`,
    "",
    "| Стратегия | Победители | Лидер/медиана | Доля лидера | Войны старт/актив | Союзы | Федерации | Кризисы (побеждено) | Виды кризисов | Мегаструктуры | Традиции/перки | Поражение галактики | Счёт игрока | Попы |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const agg of aggregates) {
    head.push(
      `| ${agg.strategy} | ${winnerSummary(agg.wins, agg.games)} | ${agg.avgLeaderRatio.toFixed(2)}× | ${Math.round(agg.avgLeaderShare * 100)}% (${Math.round(agg.playerLeaderRate * 100)}% игрок) | ${agg.avgWars.toFixed(1)}/${agg.avgWarsActive.toFixed(1)} | ${agg.avgAlliances.toFixed(1)} | ${agg.avgFederations.toFixed(2)} | ${agg.avgCrises.toFixed(2)} (${agg.avgCrisesDefeated.toFixed(2)}) | ${topKinds(agg.crisisKinds)} | ${agg.avgMegastructures.toFixed(2)} | ${agg.avgTraditions.toFixed(1)}/${agg.avgPerks.toFixed(1)} | ${Math.round(agg.galaxyDefeatRate * 100)}% | ${Math.round(agg.avgPlayerScore)} | ${agg.medianPlayerPops.toFixed(0)} |`,
    );
  }
  head.push("", "**Вердикты:**", "", "| Метрика | Цель | Факт | Статус |", "|---|---|---|---|");
  for (const row of verdictRows) head.push(`| ${row.metric} | ${row.target} | ${row.value} | ${row.status} |`);
  return head.join("\n");
}

interface ResultFile {
  params: { games: number; ticks: number; seed: number; strategies: StrategyId[] };
  deterministic: boolean;
  elapsedMs: number;
  aggregates: Aggregate[];
  verdicts: ReturnType<typeof verdicts>;
  games: GameResult[];
}

function appendToDoc(markdown: string): boolean {
  const path = "docs/balance-log.md";
  if (!nodeFs.existsSync(path)) return false;
  const stamp = new Date().toISOString().slice(0, 10);
  const section = `\n## 8. M10 · Поздний баланс: анти-снежок, войны, мегаструктуры ИИ (автобаланс ${stamp})\n\n${markdown}\n\n> Полный аудит: \`tsx tools/balance-sim.ts --games 1000 --ticks 7200 --parts N --part i\` + \`--merge\`.\n`;
  nodeFs.appendFileSync(path, section, "utf8");
  return true;
}

function mergeFiles(files: string[], args: Args): void {
  const games: GameResult[] = [];
  let ticks = 0;
  let seedMin = Number.MAX_SAFE_INTEGER;
  let seedMax = 0;
  let deterministic = true;
  for (const file of files) {
    const parsed = JSON.parse(nodeFs.readFileSync(file, "utf8")) as ResultFile;
    games.push(...parsed.games);
    ticks = Math.max(ticks, parsed.params.ticks);
    seedMin = Math.min(seedMin, parsed.params.seed);
    seedMax = Math.max(seedMax, parsed.params.seed + parsed.params.games - 1);
    deterministic = deterministic && parsed.deterministic;
  }
  const aggregates = STRATEGIES.map((strategy) => aggregate(strategy, games.filter((g) => g.strategy === strategy)));
  const mergedArgs: Args = { ...args, games: games.length, ticks, seed: seedMin };
  const rows = verdicts(aggregates);
  const markdown = toMarkdown(mergedArgs, aggregates, rows, deterministic, 0);
  console.log(markdown);
  if (args.appendDoc) console.log(appendToDoc(markdown) ? "docs/balance-log.md обновлён" : "docs/balance-log.md не найден");
  void seedMax;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.merge && args.merge.length > 0) {
    mergeFiles(args.merge, args);
    return;
  }
  const started = Date.now();
  const determinismRun = (): string => {
    const world = createWorld(args.seed, MODE, BALANCE);
    for (let i = 0; i < Math.min(args.ticks, 300); i++) tick(world);
    return serializeWorld(world);
  };
  const deterministic = determinismRun() === determinismRun();

  const seeds: number[] = [];
  for (let i = 0; i < args.games; i++) {
    if (args.parts > 1 && i % args.parts !== args.part) continue;
    seeds.push(args.seed + i);
  }
  const aggregates: Aggregate[] = [];
  const allResults: GameResult[] = [];
  for (const strategy of STRATEGIES) {
    const results: GameResult[] = [];
    for (const seed of seeds) results.push(playGame(seed, strategy, args.ticks));
    aggregates.push(aggregate(strategy, results));
    allResults.push(...results);
    if (!args.quiet) process.stderr.write(`[${strategy}] ${results.length} партий готово\n`);
  }
  const elapsedMs = Date.now() - started;
  const rows = verdicts(aggregates);
  const markdown = toMarkdown({ ...args, games: seeds.length }, aggregates, rows, deterministic, elapsedMs);
  const result: ResultFile = {
    params: { games: args.games, ticks: args.ticks, seed: args.seed, strategies: STRATEGIES },
    deterministic,
    elapsedMs,
    aggregates,
    verdicts: rows,
    games: allResults,
  };
  if (args.out) {
    nodeFs.writeFileSync(args.out, JSON.stringify(result), "utf8");
  } else if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(markdown);
  }
  if (args.appendDoc && !args.out) console.log(appendToDoc(markdown) ? "docs/balance-log.md обновлён" : "docs/balance-log.md не найден");
}

main();
