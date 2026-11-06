/**
 * Верификация M10/M12 на длинном горизонте (7600 тактов, seed фиксирован).
 * Проверяет: таймлайн кризисов (2200/2600/3600/4600/5200 + forced), бои/узлы/ядра,
 * стройку и активацию мегаструктур, условия победы/счёт, финальное давление и окно победы.
 * Запуск: tsx tools/verify-endgame.ts [--seed 7777] [--ticks 7600]
 */
import * as nodeFs from "node:fs";
import { BALANCE, MODE } from "../packages/data/src/index.ts";
import {
  advancedOf, applyCommand, computeFullScore, createWorld, ensureFg, tick, victoryProgress,
} from "../packages/sim/src/index.ts";
import type { World } from "../packages/sim/src/index.ts";

const MEGA_TYPES = ["sentinel_array", "gate", "star_forge", "ring_habitat", "dyson_sphere", "science_nexus", "beacon"] as const;

const args = process.argv.slice(2);
let seed = 7777;
let ticks = 7600;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--seed") seed = Number(args[++i] ?? seed);
  if (args[i] === "--ticks") ticks = Number(args[++i] ?? ticks);
}

const world: World = createWorld(seed, MODE, BALANCE);
const player = world.empires.find((e) => e.isPlayer)!;
// ускоряем позднюю игру: Т5-технологии, перки для мегаструктур, ресурсы
player.techs.completed.push("soc_ascension_1", "phys_singularity_1", "eng_megastructure_1", "eng_hull_4");
const adv = advancedOf(world, player.id);
adv.perks.push("space_engineering", "technocracy", "ascension", "master_builder");
player.resources.alloys = 200000;
player.resources.minerals = 200000;
player.resources.credits = 500000;
player.resources.unity = 100000;
player.resources.influence = 100000;

const snapshots: Record<string, unknown> = {};
let firstVictory: { tick: number; kind: string; winner: number } | null = null;
let buildAttempts = 0;
let buildOk = 0;

for (let step = 0; step < ticks; step++) {
  // мегаструктуры: раз в 150 тактов пытаемся строить следующий тип
  if (world.tick % 150 === 0) {
    buildAttempts += 1;
    const type = MEGA_TYPES[(buildAttempts - 1) % MEGA_TYPES.length];
    const res = applyCommand(world, { type: "megastructure_build", megastructure: type, systemId: player.capitalSystemId });
    if (res.ok) buildOk += 1;
  }
  tick(world);
  if (!firstVictory && world.victory.achieved) {
    firstVictory = { tick: world.tick, kind: world.victory.achieved, winner: world.victory.winnerEmpireId };
  }
  if (world.tick % 1000 === 0) {
    const fg = ensureFg(world);
    snapshots[`t${world.tick}`] = {
      crises: fg.crises.map((c) => `${c.kind}:${c.defeated ? "defeated" : "active"}:${c.progress.toFixed(2)}`),
      crisisNodes: fg.crises.reduce((acc, c) => acc + c.nodes.length, 0),
      megastructures: fg.megastructures.length,
      activeMegas: fg.megastructures.filter((m) => m.active).length,
      battles: world.battles.length,
      playerSystems: player.systems.length,
      playerPops: player.colonies.length,
      playerScore: computeFullScore(world, player.id),
      victory: world.victory.achieved,
      finalPressure: fg.finalPressure,
    };
  }
}

const fg = ensureFg(world);
const summary = {
  seed,
  ticks: world.tick,
  firstVictory,
  crisisKinds: [...new Set(fg.crises.map((c) => c.kind))],
  crisesTotal: fg.crises.length,
  crisesDefeated: fg.crises.filter((c) => c.defeated).length,
  crisisNodes: fg.crises.reduce((acc, c) => acc + c.nodes.length, 0),
  megastructureBuildAttempts: buildAttempts,
  megastructureBuildOk: buildOk,
  megastructures: fg.megastructures.map((m) => ({ type: m.type, active: m.active, ticksLeft: m.ticksLeft, hp: m.hp })),
  battles: world.battles.length,
  finalPressure: fg.finalPressure,
  victoryWindow: world.flags["victory_window"] ?? 0,
  crisisDefeatFlag: world.flags["crisis_defeat"] ?? 0,
  finalVictory: world.victory,
  playerVictoryProgress: victoryProgress(world, player.id),
  playerScore: computeFullScore(world, player.id),
  journalTail: fg.journal.slice(-8).map((j) => `${j.tick}:${j.kind}:${j.textRu}`),
  snapshots,
};
nodeFs.writeFileSync("tools/__verify-endgame.json", JSON.stringify(summary, null, 2), "utf8");
console.log(JSON.stringify({ firstVictory, crisisKinds: summary.crisisKinds, crisesDefeated: summary.crisesDefeated, megastructures: summary.megastructures.length, active: summary.megastructures.filter((m: {active: boolean}) => m.active).length, battles: summary.battles, finalPressure: summary.finalPressure, victoryWindow: summary.victoryWindow, finalVictory: summary.finalVictory }, null, 2));
