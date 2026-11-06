/**
 * ИИ-ИМПЕРИИ (M7-лайт, GDD §13). Без читов: те же applyCommandAs и данные, что у игрока.
 * Поведение: наука → экономика (районы/здания) → экспансия (колонизация) → флот → войны/мир.
 * Пиратская фракция (id 9) ходит к ближайшей системе игрока (демо-угроза).
 */
import { BUILDING_BY_ID, DESIGN_BY_ID, DISTRICT_BY_ID } from "@sf/data";
import { applyCommandAs, findPath } from "./commands";
import { districtCapacity, empireById, logEvent, popsTotal } from "./economy";
import { getEmpireFleetPower, getFleetCap, getProjectedIncome } from "./queries";
import { computeHops, PIRATE_EMPIRE_ID } from "./galaxy";
import { advancedOf, ensureFg } from "./fullgame";
import { aiCouncilVote, topWeightEmpire, vetoResolution } from "./council";
import { atWarWith, opinionOf, TREATY_COST, treatyActive } from "./diplomacy";
import { federationOf, pendingFederationInvites } from "./federation";
import { enemyOf } from "./war";
import { allPerks, traditionNodeCost, traditionTrees } from "./traditions";
import {
  megastructureDefinitions, megastructureTechTier, megastructureCost,
} from "./megastructures";
import { coalitionLeader, gdpShares } from "./victory";
import type { MegastructureType } from "./fullgame";
import type { Colony, Empire, Fleet, Planet, StarSystem, World } from "./types";
import type { EspionageOp, War } from "./fullgame";

function isAtWar(empire: Empire): boolean {
  for (const key of Object.keys(empire.relations)) {
    const rel = empire.relations[Number(key)];
    if (rel && rel.treaty === "war") return true;
  }
  return false;
}

function colonyById(world: World, id: number): Colony | undefined {
  return world.colonies.find((c) => c.id === id);
}

function fleetById(world: World, id: number): Fleet | undefined {
  return world.fleets.find((f) => f.id === id);
}

function findShipyardColony(world: World, empire: Empire): Colony | undefined {
  for (const colonyId of empire.colonies) {
    const colony = colonyById(world, colonyId);
    if (colony && colony.buildings.includes("shipyard")) return colony;
  }
  return undefined;
}

function researchStep(world: World, empire: Empire): void {
  for (const school of ["physics", "society", "engineering"] as const) {
    const progress = empire.techs.progress[school];
    if (progress.techId !== null) continue;
    const offers = empire.techs.offers[school];
    if (offers.length === 0) continue;
    applyCommandAs(world, empire.id, { type: "research", school, techId: offers[0] });
  }
}

function expansionStep(world: World, empire: Empire, ai: NonNullable<Empire["ai"]>): void {
  let colonizerFleet: Fleet | undefined;
  for (const fleetId of empire.fleets) {
    const fleet = fleetById(world, fleetId);
    if (!fleet || fleet.ships.length === 0) continue;
    if (fleet.ships.some((ship) => ship.classId === "colonizer")) {
      colonizerFleet = fleet;
      break;
    }
  }
  if (!colonizerFleet) return;
  const here = world.systems[colonizerFleet.systemId];
  if (here) {
    for (const planet of here.planets) {
      if (planet.ownerId === 0 && planet.colonyId === 0 && planet.habitability >= 40) {
        const result = applyCommandAs(world, empire.id, { type: "colonize", fleetId: colonizerFleet.id, planetId: planet.id });
        if (result.ok) {
          ai.colonizeCooldown = 4;
          return;
        }
        // не застреваем: если не хватает ресурсов — копим/идём к другой цели
      }
    }
  }
  // Один BFS от флота вместо findPath на каждую систему (горячий профиль M2).
  const hops = computeHops(world.systems, colonizerFleet.systemId);
  let bestDistance = Number.MAX_SAFE_INTEGER;
  let bestSystemId = 0;
  for (const system of world.systems) {
    if (system.ownerId !== 0) continue;
    const distance = hops[system.id];
    if (distance <= 0) continue;
    let hasTarget = false;
    for (const planet of system.planets) {
      if (planet.ownerId === 0 && planet.colonyId === 0 && planet.habitability >= 40) {
        hasTarget = true;
        break;
      }
    }
    if (!hasTarget) continue;
    if (distance < bestDistance || (distance === bestDistance && system.id < bestSystemId)) {
      bestDistance = distance;
      bestSystemId = system.id;
    }
  }
  if (bestSystemId !== 0) {
    ai.targetSystemId = bestSystemId;
    ai.colonizeCooldown = 3;
    applyCommandAs(world, empire.id, { type: "move_fleet", fleetId: colonizerFleet.id, systemId: bestSystemId });
  }
  void findPath;
}

function economyStep(world: World, empire: Empire): void {
  // при активной экспансии минералы экономятся на колонии (colonyCost)
  const expansionPending = world.fleets.some(
    (fleet) => fleet.empireId === empire.id && fleet.ships.some((ship) => ship.classId === "colonizer"),
  );
  const reserve = expansionPending ? 160 : 0;
  if (empire.resources.minerals < reserve) return;
  const income = getProjectedIncome(world, empire.id);
  // Верфь — приоритет: без неё империя не строит корабли/колонизаторы (M7).
  const hasShipyard = empire.colonies.some((colonyId) => {
    const colony = colonyById(world, colonyId);
    return colony !== undefined && colony.buildings.includes("shipyard");
  });
  if (!hasShipyard) {
    for (const colonyId of empire.colonies) {
      const colony = colonyById(world, colonyId);
      if (!colony) continue;
      if (colony.buildings.includes("shipyard")) continue;
      const result = applyCommandAs(world, empire.id, { type: "build_building", colonyId: colony.id, buildingId: "shipyard" });
      if (result.ok) return;
    }
  }
  let actions = 0;
  for (const colonyId of empire.colonies) {
    if (actions >= 1) break;
    const colony = colonyById(world, colonyId);
    if (!colony || colony.queue.length >= 2) continue;
    const candidates: string[] = [];
    // GDD §5.1: лимит районов на планете — не строим сверх него (спраул бесполезен).
    let districtCount = 0;
    for (const key of Object.keys(colony.districts)) districtCount += colony.districts[key] ?? 0;
    const districtsFull = districtCount >= districtCapacity(world, colony);
    // Сплав — узкое место позднего ИИ (мегаструктуры/флот): промышленность в приоритете.
    if (!districtsFull && income.alloys < 3) candidates.push("industrial_district");
    if (!districtsFull) {
      if (income.energy < 4) candidates.push("energy_district");
      if (income.food < 4) candidates.push("agriculture_district");
      if (income.minerals < 4) candidates.push("mining_district");
      candidates.push("residential", "energy_district", "mining_district", "agriculture_district", "industrial_district");
    }
    // ТП — узкое место ИИ: при дефиците сначала фабрика ТП/промышленный район.
    if (income.goods < 3) {
      const goodsFactory = applyCommandAs(world, empire.id, { type: "build_building", colonyId: colony.id, buildingId: "goods_factory" });
      if (goodsFactory.ok) {
        actions++;
        continue;
      }
      if (!districtsFull) {
        const industrial = applyCommandAs(world, empire.id, { type: "build_district", colonyId: colony.id, districtId: "industrial_district" });
        if (industrial.ok) {
          actions++;
          continue;
        }
      }
    }
    let built = false;
    for (const districtId of candidates) {
      const def = DISTRICT_BY_ID[districtId];
      if (!def) continue;
      const result = applyCommandAs(world, empire.id, { type: "build_district", colonyId: colony.id, districtId });
      if (result.ok) {
        built = true;
        break;
      }
    }
    if (built) {
      actions++;
      continue;
    }
    for (const buildingId of ["goods_factory", "laboratory", "barracks", "temple", "shipyard"]) {
      const def = BUILDING_BY_ID[buildingId];
      if (!def) continue;
      if (colony.buildings.filter((id) => id === buildingId).length >= 2) continue;
      const result = applyCommandAs(world, empire.id, { type: "build_building", colonyId: colony.id, buildingId });
      if (result.ok) {
        actions++;
        break;
      }
    }
  }
}

function militaryStep(world: World, empire: Empire): void {
  const cap = getFleetCap(world, empire.id);
  const shipyard = findShipyardColony(world, empire);
  if (!shipyard) return;
  // M12: копим сплавы на мегаструктуру (иначе ИИ тратит всё на корветы).
  const dev = advancedOf(world, empire.id);
  const megaPlanned = megastructureTechTier(world, empire.id) >= 3
    && dev.perks.includes("space_engineering")
    && ensureFg(world).megastructures.filter((mega) => mega.ownerId === empire.id).length < 2;
  const alloysReserve = megaPlanned ? 1200 : 0;
  if (empire.resources.alloys < alloysReserve + 25) return;
  const hasColonizer = world.fleets.some(
    (fleet) => fleet.empireId === empire.id && fleet.ships.some((ship) => ship.classId === "colonizer"),
  );
  // Экспансия важнее эскорта: без колонизатора империя не растёт (даже в режиме накопления).
  if (!hasColonizer && empire.resources.alloys >= alloysReserve + 30) {
    const result = applyCommandAs(world, empire.id, {
      type: "build_ship", systemId: shipyard.systemId, designId: "colonizer_ark", count: 1,
    });
    if (result.ok) return;
  }
  if (megaPlanned) return; // копим сплавы: боевых кораблей не заказываем
  const empireFp = getEmpireFleetPower(world, empire.id);
  const atWar = isAtWar(empire);
  // Сниженные цели флота (M10-анти-снежок): апкип флота не должен съедать весь сплав.
  const targetFp = atWar ? cap * 0.45 : cap * 0.22;
  let built = false;
  if (empireFp < targetFp && empire.resources.alloys >= 25) {
    const result = applyCommandAs(world, empire.id, {
      type: "build_ship", systemId: shipyard.systemId, designId: "corvette_scout", count: 1,
    });
    built = result.ok;
  }
  // Раз в решение ИИ может позволить вторую единицу при избытке сплавов (расширение фронта).
  if (built && empire.resources.alloys >= 100) {
    applyCommandAs(world, empire.id, { type: "build_ship", systemId: shipyard.systemId, designId: "corvette_scout", count: 1 });
  }
}

// ------------------------------------------------------------------ M7: дипломатия ИИ

function warsOfEmpire(world: World, empireId: number): War[] {
  return ensureFg(world).wars.filter((war) => war.sides[empireId] !== undefined).sort((a, b) => a.id - b.id);
}

/** Кулдаун решения ИИ: true — можно действовать, флаг перезаписывается. */
function cooldownReady(world: World, key: string, ticks: number): boolean {
  const until = world.flags[key] ?? 0;
  if (until > world.tick) return false;
  world.flags[key] = world.tick + ticks;
  return true;
}

interface NeighborTarget { empireId: number; systemId: number; fp: number; coalition: boolean }

/** Самый слабый сосед (по флоту) и его приграничная система; порядок — по id. */
function findWeakNeighbor(world: World, empire: Empire): NeighborTarget | null {
  const best = new Map<number, number>();
  for (const systemId of empire.systems) {
    const system = world.systems[systemId];
    if (!system) continue;
    for (const nextId of system.links) {
      const next = world.systems[nextId];
      if (!next || next.ownerId === 0 || next.ownerId === empire.id || next.ownerId === PIRATE_EMPIRE_ID) continue;
      const other = empireById(world, next.ownerId);
      if (!other || other.dead) continue;
      const current = best.get(other.id);
      if (current === undefined || nextId < current) best.set(other.id, nextId);
    }
  }
  let target: NeighborTarget | null = null;
  for (const empireId of [...best.keys()].sort((a, b) => a - b)) {
    const fp = getEmpireFleetPower(world, empireId);
    if (!target || fp < target.fp) target = { empireId, systemId: best.get(empireId) ?? 0, fp, coalition: false };
  }
  // GDD §16.5/§19.6: при доле ВВП лидера >40% ИИ вступает в коалицию и приоритизирует его.
  const leader = coalitionLeader(world, 0.4);
  if (leader && leader.leaderId !== empire.id && best.has(leader.leaderId)) {
    return {
      empireId: leader.leaderId,
      systemId: best.get(leader.leaderId) ?? 0,
      fp: getEmpireFleetPower(world, leader.leaderId),
      coalition: true,
    };
  }
  return target;
}

/** Кулдаун «развития» ИИ (перки/традиции/мегаструктуры). */
const AI_DEVELOPMENT_TICKS = 40;

/**
 * Развитие ИИ (M6/M12): перки → традиции → мегаструктуры. Без читов: те же команды,
 * что у игрока (applyCommandAs), счёт единства/сплавов/требований проверяется симуляцией.
 */
function developmentStep(world: World, empire: Empire): void {
  const fg = ensureFg(world);
  const adv = advancedOf(world, empire.id);
  const tier = megastructureTechTier(world, empire.id);
  // 1. Перк «Космическая инженерия» (открывает мегаструктуры) — приоритет после T3.
  const megaPerks = ["space_engineering", "ring_world", "master_builder", "technocracy"];
  for (const perkId of megaPerks) {
    if (adv.perks.includes(perkId)) continue;
    const def = allPerks().find((perk) => perk.id === perkId);
    if (!def) continue;
    if (empire.resources.unity < def.cost) continue;
    const result = applyCommandAs(world, empire.id, { type: "perk_unlock", perkId });
    if (result.ok) break;
  }
  // 2. Мегаструктуры (GDD §8.7): проверяем ДО традиций, иначе трата единства на узел
  // «съедает» действие и мегаструктуры не строятся никогда.
  if (tier >= 3) {
    const owned = fg.megastructures.filter((mega) => mega.ownerId === empire.id).length;
    if (owned < 2) {
      const capital = empireById(world, empire.id)?.capitalSystemId ?? 0;
      if (capital !== 0 && world.systems[capital]?.ownerId === empire.id) {
        const defs = [...megastructureDefinitions()].sort((a, b) => a.costAlloys - b.costAlloys);
        for (const def of defs) {
          if (def.requiredPerk && !adv.perks.includes(def.requiredPerk)) continue;
          if (fg.megastructures.some((mega) => mega.systemId === capital && mega.type === def.id)) continue;
          const cost = megastructureCost(world, def.id as MegastructureType, empire.id);
          if (empire.resources.alloys < cost.alloys || empire.resources.minerals < cost.minerals) continue;
          const result = applyCommandAs(world, empire.id, {
            type: "megastructure_build", megastructure: def.id as MegastructureType, systemId: capital,
          });
          if (result.ok) return;
        }
      }
    }
  }
  // 3. Традиции: одно открытие за кулдаун, с резервом единства под перк мегаструктур.
  if (!cooldownReady(world, "ai:develop:trad:" + empire.id, AI_DEVELOPMENT_TICKS)) return;
  const perkReserve = tier >= 3 && !adv.perks.includes("space_engineering") ? 2000 : 0;
  for (const tree of traditionTrees()) {
    for (const node of tree.nodes) {
      if (adv.traditions.unlocked.includes(node.id)) continue;
      const inherited = node.index > 0 && tree.nodes[node.index - 1];
      if (inherited && !adv.traditions.unlocked.includes(inherited.id)) break;
      if (empire.resources.unity < perkReserve + traditionNodeCost(node.index)) break;
      const result = applyCommandAs(world, empire.id, { type: "tradition_unlock", treeId: tree.id, nodeId: node.id });
      if (result.ok) return;
      break;
    }
  }
}

/** Не тратим влияние ниже резерва: оно нужно на войны, совет, шпионаж и федерации. */
const TREATY_INFLUENCE_RESERVE = 90;
/** Максимум союзов у одной империи (иначе ИИ «дружит со всеми» — не как в каноне §12.1). */
const MAX_ALLIANCES = 2;

function countAlliances(world: World, empireId: number): number {
  let count = 0;
  for (const other of world.empires) {
    if (other.dead || other.id === empireId) continue;
    if (treatyActive(world, empireId, other.id, "alliance")) count += 1;
  }
  return count;
}

/** Союз/NAP/торговля: мнение определяет, какой договор ИИ предлагает (GDD §12.1–12.2). */
function treatyStep(world: World, empire: Empire): void {
  // в войне договоры с врагами невозможны, но с остальными — да (atWarWith ниже)
  const plans: { kind: "nap" | "trade" | "research" | "defensive" | "alliance"; minOpinion: number }[] = [
    { kind: "nap", minOpinion: 0 },
    { kind: "trade", minOpinion: 15 },
    { kind: "research", minOpinion: 15 },
    { kind: "alliance", minOpinion: 50 },
    { kind: "defensive", minOpinion: 35 },
  ];
  const myAlliances = countAlliances(world, empire.id);
  const others = world.empires
    .filter((other) => !other.dead && other.id !== empire.id && other.id !== PIRATE_EMPIRE_ID)
    .sort((a, b) => a.id - b.id);
  for (const other of others) {
    if (atWarWith(world, empire.id, other.id)) continue;
    const opinion = opinionOf(world, empire.id, other.id);
    for (const plan of plans) {
      if (opinion < plan.minOpinion) continue;
      if (treatyActive(world, empire.id, other.id, plan.kind)) continue;
      // союз — ограниченный ресурс; оборонительный союз избыточен при наступательном
      if (plan.kind === "alliance") {
        if (myAlliances >= MAX_ALLIANCES || countAlliances(world, other.id) >= MAX_ALLIANCES) continue;
      }
      if (plan.kind === "defensive" && treatyActive(world, empire.id, other.id, "alliance")) continue;
      const cost = TREATY_COST[plan.kind].influence;
      if (empire.resources.influence < cost + TREATY_INFLUENCE_RESERVE) continue;
      if (!cooldownReady(world, "ai:treaty:" + empire.id + ":" + other.id + ":" + plan.kind, 60)) continue;
      applyCommandAs(world, empire.id, { type: "treaty_offer", targetEmpireId: other.id, treaty: plan.kind });
      return;
    }
  }
}

/**
 * Война: агрессия + слабый сосед + доступный CB (GDD §12.6, §13.2, §16.5).
 * М10-баланс: войны должны случаться ≥3 за 100 лет, поэтому:
 *  - кулдаун 60 (вместо 120), порог агрессии 45 (вместо 55);
 *  - допускается 2-й фронт при агрессии ≥75 (GDD §13.2 избегает 2 фронтов, но не запрещает);
 *  - коалиция против лидера по ВВП (>40%) даёт +25 агрессии и приоритет цели;
 *  - при мнении <−25 доступен дешёвый CB «унижение».
 */
function warDeclarationStep(world: World, empire: Empire, ai: NonNullable<Empire["ai"]>): void {
  const activeWars = warsOfEmpire(world, empire.id).length;
  if (activeWars >= 2) return;
  if (activeWars === 1 && ai.aggression < 75) return;
  const myFp = getEmpireFleetPower(world, empire.id);
  if (myFp < 10) return;
  const target = findWeakNeighbor(world, empire);
  if (!target) return;
  const opinion = opinionOf(world, empire.id, target.empireId);
  const aggression = ai.aggression
    + (myFp > target.fp * 1.5 ? 15 : 0)
    + (target.coalition ? 25 : 0);
  if (aggression < 45) return;
  if (!target.coalition && myFp < target.fp * 0.95 && opinion > -25) return;
  if (!cooldownReady(world, "ai:war:" + empire.id, 60)) return;
  // Коалиция против лидера: сначала дешёвое «унижение» (10 влияния, мнение уже упало от коалиции).
  if (target.coalition && opinion < -25 && empire.resources.influence >= 10) {
    const result = applyCommandAs(world, empire.id, { type: "declare_war", targetEmpireId: target.empireId, cb: "humiliation" });
    if (result.ok) {
      ai.aggression = Math.max(0, ai.aggression - 10);
      return;
    }
  }
  // Вассализация при явном превосходстве (GDD §12.6: FP цели < 50%).
  if (myFp > target.fp * 2 && empire.resources.influence >= 40) {
    const result = applyCommandAs(world, empire.id, { type: "declare_war", targetEmpireId: target.empireId, cb: "vassalization" });
    if (result.ok) {
      ai.aggression = Math.max(0, ai.aggression - 15);
      return;
    }
  }
  // Притязание + CB «завоевание» (25 влияния за систему).
  if (empire.resources.influence >= 25) {
    const result = applyCommandAs(world, empire.id, {
      type: "declare_war", targetEmpireId: target.empireId, cb: "conquest", claims: [target.systemId],
    });
    if (result.ok) {
      ai.aggression = Math.max(0, ai.aggression - 15);
      return;
    }
  }
  if (opinion < -25 && empire.resources.influence >= 10) {
    const result = applyCommandAs(world, empire.id, { type: "declare_war", targetEmpireId: target.empireId, cb: "humiliation" });
    if (result.ok) ai.aggression = Math.max(0, ai.aggression - 10);
  }
}

/** Мир при истощении/проигрыше или добивание при высоком счёте (GDD §12.8–12.9). */
function peaceStep(world: World, empire: Empire, ai: NonNullable<Empire["ai"]>): void {
  for (const war of warsOfEmpire(world, empire.id)) {
    const enemyId = enemyOf(world, war, empire.id);
    if (!enemyId) continue;
    const exhaustion = war.exhaustion[empire.id] ?? 0;
    const score = war.score[empire.id] ?? 0;
    const myFp = getEmpireFleetPower(world, empire.id);
    const enemyFp = getEmpireFleetPower(world, enemyId);
    const losing = myFp < Math.max(1, enemyFp) * 0.5 && world.tick - war.startedTick > 60;
    if (exhaustion < 60 && !losing && score < 60) continue;
    if (!cooldownReady(world, "ai:peace:" + war.id + ":" + empire.id, 60)) continue;
    applyCommandAs(world, empire.id, { type: "make_peace", targetEmpireId: enemyId });
    if (exhaustion >= 60) ai.aggression = Math.max(0, ai.aggression - 10);
  }
}

/** Федерация: принять приглашение, пригласить союзников (GDD §12.3). */
function federationStep(world: World, empire: Empire): void {
  for (const leaderId of pendingFederationInvites(world, empire.id)) {
    if (opinionOf(world, empire.id, leaderId) < 40) continue;
    if (!cooldownReady(world, "ai:fedaccept:" + empire.id + ":" + leaderId, 60)) continue;
    applyCommandAs(world, empire.id, { type: "federation_accept", leaderEmpireId: leaderId });
    return;
  }
  const federation = federationOf(world, empire.id);
  if (federation && (federation.presidentId !== empire.id || federation.members.length >= 5)) return;
  if (empire.resources.influence < 100 || empire.resources.unity < 500) return;
  const others = world.empires
    .filter((other) => !other.dead && other.id !== empire.id && other.id !== PIRATE_EMPIRE_ID)
    .sort((a, b) => a.id - b.id);
  for (const other of others) {
    if (federation && federation.members.includes(other.id)) continue;
    if (federationOf(world, other.id)) continue;
    if (atWarWith(world, empire.id, other.id)) continue;
    if (opinionOf(world, empire.id, other.id) < 60) continue;
    if (!cooldownReady(world, "ai:fedinvite:" + empire.id + ":" + other.id, 90)) continue;
    // не в федерации — приглашение создаёт её (GDD §12.3: лидер + приглашения)
    applyCommandAs(world, empire.id, { type: "federation_invite", targetEmpireId: other.id });
    return;
  }
}

/** Совет: голосование, вето, редкие предложения резолюций (GDD §12.4). */
function councilStep(world: World, empire: Empire, ai: NonNullable<Empire["ai"]>): void {
  const fg = ensureFg(world);
  const pending = fg.council.pending;
  if (pending) {
    // вето, если резолюция бьёт по нам и у нас наибольший вес
    if (pending.type === "sanctions" && pending.targetEmpireId === empire.id
      && topWeightEmpire(world) === empire.id) {
      vetoResolution(world, empire.id);
      return;
    }
    if (pending.votes[empire.id] === undefined) {
      const vote = aiCouncilVote(world, empire.id, pending);
      applyCommandAs(world, empire.id, { type: "council_vote", resolutionId: pending.id, vote });
    }
    return;
  }
  if (world.tick < 200) return;
  if (!cooldownReady(world, "ai:council:" + empire.id, 300)) return;
  const rivals = world.empires
    .filter((other) => !other.dead && other.id !== empire.id && other.id !== PIRATE_EMPIRE_ID)
    .sort((a, b) => a.id - b.id)
    .filter((other) => opinionOf(world, empire.id, other.id) < -20)
    .sort((a, b) => opinionOf(world, empire.id, a.id) - opinionOf(world, empire.id, b.id));
  if (rivals.length > 0 && empire.resources.influence >= 40) {
    applyCommandAs(world, empire.id, { type: "council_propose", resolutionType: "sanctions", targetEmpireId: rivals[0].id });
    return;
  }
  if (empire.resources.influence >= 60 && fg.wars.length > 0) {
    applyCommandAs(world, empire.id, { type: "council_propose", resolutionType: "forced_peace" });
    return;
  }
  if (empire.resources.influence >= 25) {
    applyCommandAs(world, empire.id, { type: "council_propose", resolutionType: "science_exchange" });
  }
  void ai;
}

/** Шпионаж: 1 операция / 50 тактов против соперников (GDD §12.5). */
function espionageStep(world: World, empire: Empire): void {
  if (empire.resources.influence < 20) return;
  if (!cooldownReady(world, "ai:esp:" + empire.id, 50)) return;
  const rivals = world.empires
    .filter((other) => !other.dead && other.id !== empire.id && other.id !== PIRATE_EMPIRE_ID)
    .filter((other) => opinionOf(world, empire.id, other.id) < -10)
    .sort((a, b) => getEmpireFleetPower(world, b.id) - getEmpireFleetPower(world, a.id) || a.id - b.id);
  if (rivals.length === 0) return;
  const personality = advancedOf(world, empire.id).aiPersonality;
  let op: EspionageOp = "fleet_recon";
  if (personality === "militarist" || personality === "pirate") op = "sabotage";
  else if (personality === "scientist") op = "steal_tech";
  else if (personality === "trader") op = "steal_map";
  else if (personality === "expander") op = "steal_map";
  applyCommandAs(world, empire.id, { type: "espionage", targetEmpireId: rivals[0].id, op });
}

function diplomacyStep(world: World, empire: Empire, ai: NonNullable<Empire["ai"]>): void {
  peaceStep(world, empire, ai);
  // Война раньше «мягких» трат влияния: иначе ИИ уходит в договоры/совет и не воюет (M10-баланс).
  warDeclarationStep(world, empire, ai);
  // затем «крупные» траты влияния (федерация, совет), договоры с резервом, шпионаж
  federationStep(world, empire);
  councilStep(world, empire, ai);
  treatyStep(world, empire);
  espionageStep(world, empire);
}

function pirateStep(world: World, empire: Empire): void {
  // Рейд начинается не раньше 30-го такта: демо успевает показать полёт игрока (канон §3.7).
  if (world.tick < 30) return;
  const player = empireById(world, world.playerEmpireId);
  if (!player) return;
  const targets: StarSystem[] = [];
  for (const system of world.systems) if (system.ownerId === world.playerEmpireId) targets.push(system);
  if (targets.length === 0) return;
  for (const fleetId of empire.fleets) {
    const fleet = fleetById(world, fleetId);
    if (!fleet || fleet.ships.length === 0) continue;
    if (fleet.status === "moving") continue;
    const current = world.systems[fleet.systemId];
    if (!current) continue;
    // до 150-го такта пираты патрулируют у границы и не входят в системы игрока
    if (world.tick < 150 && current.links.some((id) => world.systems[id]?.ownerId === world.playerEmpireId)) continue;
    let nearestPlayerPath: number[] | null = null;
    let nearestPlayerSystem = 0;
    for (const system of targets) {
      const path = findPath(world, fleet.systemId, system.id);
      if (!path || path.length === 0) continue;
      if (nearestPlayerPath === null || path.length < nearestPlayerPath.length
        || (path.length === nearestPlayerPath.length && system.id < nearestPlayerSystem)) {
        nearestPlayerPath = path;
        nearestPlayerSystem = system.id;
      }
    }
    if (!nearestPlayerPath) continue;
    let moveTarget = nearestPlayerSystem;
    if (world.tick < 150) {
      // до 150-го такта рейд не входит в системы игрока: выходим только на «пятачок» у границы
      if (nearestPlayerPath.length < 2) continue;
      moveTarget = nearestPlayerPath[0];
      if (world.systems[moveTarget]?.ownerId === world.playerEmpireId) continue;
    }
    applyCommandAs(world, empire.id, { type: "move_fleet", fleetId: fleet.id, systemId: moveTarget });
  }
}

export function aiTurn(world: World): void {
  for (const empire of world.empires) {
    if (empire.isPlayer || empire.dead) continue;
    const ai = empire.ai;
    if (!ai) continue;
    if (world.tick < ai.nextDecisionTick) continue;
    ai.nextDecisionTick = world.tick + 9 + (empire.id % 7);
    if (empire.id === PIRATE_EMPIRE_ID) {
      pirateStep(world, empire);
      continue;
    }
    try {
      researchStep(world, empire);
      // приоритет: экспансия → флот/колонизатор → экономика (иначе ИИ «застревает» на районах)
      expansionStep(world, empire, ai);
      militaryStep(world, empire);
      economyStep(world, empire);
      developmentStep(world, empire);
      diplomacyStep(world, empire, ai);
      // агрессия ИИ растёт к слабым соседям со временем (GDD §13.2)
      ai.aggression = Math.min(100, ai.aggression + 1);
    } catch (error) {
      logEvent(world, "warn", "bad", `Ошибка ИИ империи ${empire.name}: ${(error as Error).message}`, undefined, empire.id);
    }
  }
  // Мнение теперь пересчитывается в diplomacyPhase (GDD §12.1), дрейф здесь не нужен.
}

export { popsTotal, DESIGN_BY_ID };
