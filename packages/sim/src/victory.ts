/**
 * ПОБЕДА И СЧЁТ (M10/M12, GDD §16): 6 условий, таймлайн финала, поражения,
 * финальный счёт §16.2 и звания §16.2.
 *
 * Условия проверяются с такта 4000; таймлайн: 4600/5200 (поздние кризисы — зона crisis.ts),
 * 6200 (финальное давление), 7000 (окно победы), 7200 (счёт).
 * Победа записывается в world.victory; legacy getVictory() уважает уже достигнутую победу.
 */
import { RESOURCE_BY_ID, TECH_BY_ID } from "@sf/data";
import {
  empireById, logEvent, milliOf, mulMilli, popsTotal, projectEmpire,
} from "./economy";
import { advancedOf, ensureFg, pushJournal } from "./fullgame";
import type { VictoryProgress } from "./fullgame";
import { RESOURCE_ORDER } from "./types";
import type { Empire, VictoryKind, World } from "./types";
import { createFleet, createShip } from "./economy";

/** С какого такта открываются проверки победы (GDD §16.1). */
export const VICTORY_CHECKS_FROM = 4000;
/** Таймлайн финала (GDD §16.3). */
export const TIMELINE = {
  firstLateCrisis: 4600,
  secondLateCrisis: 5200,
  finalPressure: 6200,
  victoryWindow: 7000,
  end: 7200,
};

const PIRATE_EMPIRE_ID = 9;
const CRISIS_EMPIRE_BASE = 90;

function isPlayableEmpire(empire: Empire): boolean {
  return !empire.dead && empire.id !== PIRATE_EMPIRE_ID && empire.id < CRISIS_EMPIRE_BASE;
}

function aliveEmpires(world: World): Empire[] {
  return world.empires.filter(isPlayableEmpire);
}

function systemsOwned(world: World, empireId: number): number {
  let count = 0;
  for (const system of world.systems) if (system.ownerId === empireId) count += 1;
  return count;
}

export function empirePops(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  let pops = 0;
  for (const colonyId of empire.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (colony) pops += popsTotal(colony.pops);
  }
  return pops;
}

function totalPops(world: World): number {
  let total = 0;
  for (const colony of world.colonies) total += popsTotal(colony.pops);
  return total;
}

export function empireGdp(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  const projection = projectEmpire(world, empire);
  let milli = 0;
  for (const res of RESOURCE_ORDER) {
    if (projection.income[res] <= 0) continue;
    milli += mulMilli(projection.income[res], milliOf(RESOURCE_BY_ID[res].wholesale));
  }
  return Math.floor(milli / 1000);
}

export interface GdpShares {
  tick: number;
  byId: Record<number, number>;
  total: number;
  leaderId: number;
  leaderShare: number;
}

const GDP_CACHE = new WeakMap<World, GdpShares>();

/**
 * ВВП всех играбельных империй и лидер — ОДИН раз на такт (GDD §16.5/§19.6: коалиция
 * против лидера при доле ВВП >40%). Кэш нужен, чтобы victory/diplomacy/AI не считали
 * дорогие проекции экономики по несколько раз за такт.
 */
export function gdpShares(world: World): GdpShares {
  const cached = GDP_CACHE.get(world);
  if (cached && cached.tick === world.tick) return cached;
  const byId: Record<number, number> = {};
  let total = 0;
  let leaderId = 0;
  let leaderGdp = -1;
  for (const empire of aliveEmpires(world)) {
    const gdp = empireGdp(world, empire.id);
    byId[empire.id] = gdp;
    total += gdp;
    if (gdp > leaderGdp || (gdp === leaderGdp && empire.id < leaderId)) {
      leaderGdp = gdp;
      leaderId = empire.id;
    }
  }
  const snapshot: GdpShares = {
    tick: world.tick,
    byId,
    total,
    leaderId,
    leaderShare: total > 0 ? Math.max(0, leaderGdp) / total : 0,
  };
  GDP_CACHE.set(world, snapshot);
  return snapshot;
}

/** Доля ВВП империи (0..1). */
export function gdpShare(world: World, empireId: number): number {
  const shares = gdpShares(world);
  return shares.total > 0 ? (shares.byId[empireId] ?? 0) / shares.total : 0;
}

/** Лидер по ВВП с долей >= threshold (коалиция GDD §16.5). */
export function coalitionLeader(world: World, threshold = 0.4): { leaderId: number; share: number } | null {
  const shares = gdpShares(world);
  if (shares.leaderShare < threshold || shares.leaderId === 0) return null;
  return { leaderId: shares.leaderId, share: shares.leaderShare };
}

/** Империя — «лидер, против которого собирается коалиция» (GDD §16.5). */
export function isCoalitionLeader(world: World, empireId: number, threshold = 0.4): boolean {
  const leader = coalitionLeader(world, threshold);
  return leader !== null && leader.leaderId === empireId;
}

function peakFleetPower(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  let fp = 0;
  for (const fleetId of empire.fleets) {
    const fleet = world.fleets.find((f) => f.id === fleetId);
    if (!fleet) continue;
    for (const ship of fleet.ships) fp += ship.fleetPower;
  }
  return fp;
}

function megastructuresOwned(world: World, empireId: number): number {
  const fg = ensureFg(world);
  let count = 0;
  for (const mega of fg.megastructures) {
    if (mega.ownerId === empireId && mega.active) count += 1;
  }
  return count;
}

function liveFleets(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  let count = 0;
  for (const fleetId of empire.fleets) {
    const fleet = world.fleets.find((f) => f.id === fleetId);
    if (fleet && fleet.ships.length > 0) count += 1;
  }
  return count;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Прогресс вознесения: T5-технология, Т5-мегаструктура и «возвышения» (перки/традиции). */
function ascensionProgress(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  const adv = advancedOf(world, empireId);
  const fg = ensureFg(world);
  const techDone = empire.techs.completed.includes("soc_ascension_1")
    || (empire.techs.completed.includes("phys_singularity_1") && empire.techs.completed.includes("eng_megastructure_1"));
  const t5Mega = fg.megastructures.some(
    (mega) => mega.ownerId === empireId && mega.active
      && (mega.type === "dyson_sphere" || mega.type === "science_nexus"),
  );
  const ascensionPerks = adv.perks.length >= 3
    || adv.traditions.finishers.length >= 2
    || adv.traditions.unlocked.length >= 15;
  let score = 0;
  if (techDone) score += 1;
  if (t5Mega) score += 1;
  if (ascensionPerks) score += 1;
  return score / 3;
}

/** Доля населения, контролируемая федерацией (условие «Федерация», GDD §16.1). */
function federationProgress(world: World, empireId: number): { share: number; members: number } {
  const fg = ensureFg(world);
  const total = Math.max(1, totalPops(world));
  let bestShare = 0;
  let bestMembers = 0;
  for (const federation of fg.federations) {
    let members = 0;
    let pops = 0;
    for (const memberId of federation.members) {
      const member = empireById(world, memberId);
      if (!member || member.dead) continue;
      members += 1;
      pops += empirePops(world, memberId);
      void member;
    }
    const share = pops / total;
    if (share > bestShare) bestShare = share;
    if (members > bestMembers) bestMembers = members;
  }
  void empireId;
  return { share: bestShare, members: bestMembers };
}

function lateCrisesDefeated(world: World): { total: number; defeated: number } {
  const fg = ensureFg(world);
  const late: string[] = ["grey_tide", "devourers"];
  let defeated = 0;
  for (const kind of late) {
    const key = `crisis_defeated:${kind}`;
    if ((world.flags[key] ?? 0) > 0) defeated += 1;
    else if (fg.crises.some((crisis) => crisis.kind === kind && crisis.defeated)) defeated += 1;
  }
  return { total: late.length, defeated };
}

function economyHeldTicks(world: World, empireId: number): number {
  return world.flags[`econ_since:${empireId}`] ?? 0;
}

/** Итоговый счёт по GDD §16.2 (целые очки). */
export function computeFullScore(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  const fg = ensureFg(world);
  const adv = advancedOf(world, empireId);
  const systems = systemsOwned(world, empireId);
  const pops = empirePops(world, empireId);
  const techs = empire.stats.techsResearched;
  const peakFp = Math.max(adv.peakFp, peakFleetPower(world, empireId));
  const gdp = Math.max(adv.gdp, empireGdp(world, empireId));
  const traditions = adv.traditions.unlocked.length + adv.traditions.finishers.length;
  const megas = megastructuresOwned(world, empireId);
  const crisisDamage = world.flags[`crisis_damage:${empireId}`] ?? 0;
  const vassals = adv.vassals.length;
  const popsLost = world.flags[`pops_lost:${empireId}`] ?? 0;
  void fg;
  const total = systems * 8
    + pops * 0.4
    + techs * 3 * 0.8
    + peakFp * 0.15 * 0.7
    + gdp * 0.5 * 0.6
    + traditions * 12 * 0.5
    + megas * 150 * 0.5
    + crisisDamage * 0.02 * 0.4
    + vassals * 40 * 0.3
    - popsLost * 0.3 * 0.5;
  return Math.floor(total);
}

/** Звание по счёту (GDD §16.2). */
export function scoreTitle(total: number): string {
  if (total >= 25000) return "Легенда Веретена";
  if (total >= 18000) return "Владыка Дорог";
  if (total >= 12000) return "Адмирал Фронтира";
  if (total >= 7000) return "Капитан";
  return "Выживший";
}

/** Прогресс 6 условий победы (0..1) для UI; economySince — сколько тактов держится 40% ВВП. */
export function victoryProgress(world: World, empireId: number): VictoryProgress {
  const empire = empireById(world, empireId);
  if (!empire) {
    return { domination: 0, federation: 0, ascension: 0, economy: 0, crisis: 0, score: 0, economySince: 0 };
  }
  const domination = systemsOwned(world, empireId) / Math.max(1, world.systems.length);
  const federation = federationProgress(world, empireId);
  const federationIn = (ensureFg(world).federations.some(
    (fed) => fed.members.includes(empireId) && fed.members.length >= 3,
  )) ? federation.share : 0;
  const ascension = ascensionProgress(world, empireId);
  const economy = gdpShare(world, empireId);

  const late = lateCrisesDefeated(world);
  const crisis = late.total > 0 ? late.defeated / late.total : 0;
  const scoreValue = computeFullScore(world, empireId);
  return {
    domination: round3(clamp01(domination)),
    federation: round3(clamp01(federationIn)),
    ascension: round3(clamp01(ascension)),
    economy: round3(clamp01(economy)),
    crisis: round3(clamp01(crisis)),
    score: round3(clamp01(scoreValue / 25000)),
    economySince: economyHeldTicks(world, empireId),
  };
}

function setVictory(world: World, kind: VictoryKind, winnerEmpireId: number): void {
  if (world.victory.achieved) return;
  world.victory = { achieved: kind, tickAchieved: world.tick, winnerEmpireId };
  const empire = empireById(world, winnerEmpireId);
  const title = kind === "domination" ? "Доминирование"
    : kind === "federation" ? "Федерация"
    : kind === "ascension" ? "Вознесение"
    : kind === "economy" ? "Экономическая гегемония"
    : kind === "crisis" ? "Выживание в кризисе" : "Победа по счёту";
  logEvent(world, "victory", "good", `ПОБЕДА: ${empire?.name ?? "империя"} — ${title} (такт ${world.tick}).`, empire?.capitalSystemId, winnerEmpireId);
  pushJournal(ensureFg(world), world.tick, "victory", `Победа «${title}»: ${empire?.name ?? "империя"}.`);
}

/** Проверка условий победы и таймлайна финала. */
export function victoryPhase(world: World): void {
  const fg = ensureFg(world);
  const playerId = world.playerEmpireId;
  const player = empireById(world, playerId);
  const alive = aliveEmpires(world);

  // 0. ВВП считается ОДИН раз за такт (кэш из gdpShares, проекции экономики дорогие)
  const gdpSnapshot = gdpShares(world);
  const totalGdp = gdpSnapshot.total;
  for (const empire of alive) {
    const gdp = gdpSnapshot.byId[empire.id] ?? 0;
    const adv = advancedOf(world, empire.id);
    const fp = peakFleetPower(world, empire.id);
    if (fp > adv.peakFp) adv.peakFp = fp;
    adv.gdp = gdp;
  }
  const shareOf = (id: number): number => (totalGdp > 0 ? (gdpSnapshot.byId[id] ?? 0) / totalGdp : 0);

  // 1. экономическая гегемония: 40% ВВП подряд 300 тактов
  for (const empire of alive) {
    const key = `econ_since:${empire.id}`;
    world.flags[key] = shareOf(empire.id) >= 0.4 ? (world.flags[key] ?? 0) + 1 : 0;
  }

  // 2. прогресс для HUD и счёт обновляем реже (раз в 10 тактов), условия — каждый такт
  if (world.tick % 10 === 0) {
    fg.victoryProgress = victoryProgress(world, playerId);
    for (const empire of alive) fg.score[empire.id] = computeFullScore(world, empire.id);
  }

  // 3. проверки условий победы — с такта 4000, игрок в приоритете
  if (world.tick >= VICTORY_CHECKS_FROM && !world.victory.achieved) {
    const order: Empire[] = [];
    if (player && !player.dead) order.push(player);
    for (const empire of alive) if (empire.id !== playerId) order.push(empire);
    const late = lateCrisesDefeated(world);
    for (const empire of order) {
      if (systemsOwned(world, empire.id) / Math.max(1, world.systems.length) >= 0.45) {
        setVictory(world, "domination", empire.id);
        break;
      }
      const federation = federationProgress(world, empire.id);
      const inFederation = fg.federations.some((fed) => fed.members.includes(empire.id) && fed.members.length >= 3);
      if (inFederation && federation.share >= 0.6) {
        setVictory(world, "federation", empire.id);
        break;
      }
      if (ascensionProgress(world, empire.id) >= 1) {
        setVictory(world, "ascension", empire.id);
        break;
      }
      if (shareOf(empire.id) >= 0.4 && economyHeldTicks(world, empire.id) >= 300) {
        setVictory(world, "economy", empire.id);
        break;
      }
      if (world.tick >= TIMELINE.finalPressure && late.defeated >= late.total) {
        setVictory(world, "crisis", empire.id);
        break;
      }
    }
  }

  // 4. таймлайн финала (GDD §16.3)
  if (world.tick === TIMELINE.finalPressure && (fg.finalPressure ?? 0) === 0) {
    fg.finalPressure = 1;
    for (const empire of world.empires) {
      if (!empire.ai) continue;
      empire.ai.aggression = Math.min(100, Math.round(empire.ai.aggression * 1.5));
    }
    world.flags["final_pressure"] = 1;
    logEvent(world, "warn", "warn", "Финальное давление: доходы −20%, агрессия ИИ +50%. Империи должны ускориться.", undefined, playerId);
    pushJournal(fg, world.tick, "finale", "Финальное давление: доходы −20%, агрессия ИИ +50%.");
  }
  if (world.tick === TIMELINE.victoryWindow && (world.flags["victory_window"] ?? 0) === 0) {
    world.flags["victory_window"] = 1;
    logEvent(world, "warn", "info", "Окно победы открыто: чужие условия можно сорвать.", undefined, playerId);
    pushJournal(fg, world.tick, "finale", "Окно победы открыто (такт 7000).");
  }

  // 5. финальный счёт на такте 7200
  const endTick = Math.min(TIMELINE.end, world.balance.maxTicks);
  if (world.tick >= endTick && !world.victory.achieved) {
    let bestId = 0;
    let bestScore = -1;
    for (const empire of aliveEmpires(world)) {
      const score = computeFullScore(world, empire.id);
      if (score > bestScore) {
        bestScore = score;
        bestId = empire.id;
      }
    }
    setVictory(world, "score", bestId);
  }

  // 6. поражения и «последний шанс» (GDD §16.4)
  if (player && !player.dead) {
    const colonies = player.colonies.length;
    const fleets = liveFleets(world, playerId);
    if (colonies === 0 && fleets === 0) {
      world.flags[`defeat:${playerId}`] = world.tick;
      if ((world.flags["defeat_logged"] ?? 0) === 0) {
        world.flags["defeat_logged"] = 1;
        logEvent(world, "warn", "bad", "Империя игрока потеряла все колонии и флоты — мягкое поражение (партия продолжается).", undefined, playerId);
        pushJournal(fg, world.tick, "defeat", "Игрок потерял все колонии и флоты (мягкое поражение).");
      }
    } else if (colonies <= 1 && fleets === 0 && world.tick >= TIMELINE.finalPressure - 200
      && (world.flags["last_chance_used"] ?? 0) === 0) {
      // «последний шанс»: бесплатный флот 50 FP и грант 500 кредитов
      world.flags["last_chance_used"] = 1;
      const capitalId = player.capitalSystemId;
      const ships = [];
      let fp = 0;
      while (fp < 50) {
        ships.push(createShip(world.nextId++, "corvette_scout", "Последний шанс", false));
        fp += 6;
      }
      const fleet = createFleet(world, playerId, capitalId, ships, "Флот последнего шанса", "wall");
      player.flagshipFleetId = player.flagshipFleetId || fleet.id;
      player.resources.credits += 500;
      logEvent(world, "good", "good", "Последний шанс: бесплатный флот 50 FP и 500 кредитов.", capitalId, playerId);
      pushJournal(fg, world.tick, "defeat", "Сработал «последний шанс».");
    }
  }
}

export { TECH_BY_ID };
