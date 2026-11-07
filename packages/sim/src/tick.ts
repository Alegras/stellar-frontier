/**
 * ТАКТ (M0/M2). 12 фаз в фиксированном порядке (GDD §7.3):
 * population → jobs → production → research → construction → upkeep → deficits →
 * stability → fleets → diplomacy/AI → events → score/victory.
 * Один такт = 1 игровые сутки. Детерминизм: только порядок по id, никаких Math.random/Date.now.
 */
import { DESIGN_BY_ID, RESOURCE_BY_ID } from "@sf/data";
import { aiTurn } from "./ai";
import { aiWorldPhase } from "./aiWorld";
import { areFleetsHostile, autoResolve } from "./combat";
import {
  accrue, accrueUpkeep, applyDeficits, computeScience, createFleet, createShip, empireById,
  invalidateProjection,
  growPopulation, logEvent, milliOf, mulMilli, projectEmpire, recomputeColony, removeFleet,
  updateStability,
} from "./economy";
import { generateTechOffers, getVictory } from "./queries";
import { diplomacyPhase } from "./diplomacy";
import { federationPhase } from "./federation";
import { councilPhase } from "./council";
import { espionagePhase } from "./espionage";
import { warPhase } from "./war";
import { marketExtPhase } from "./market";
import { routesPhase } from "./routes";
import { contractsPhase, onContractJump } from "./contracts";
import { ensureFleetFuel, fuelOf, jumpFuelCost, jumpTicksFor } from "./fuel";
import { ensureFg, refreshPathfinderStock } from "./fullgame";
import { ancientsPhase } from "./ancients";
import { dlcPhase } from "./dlc";
import { campaignPhase } from "./campaign";
import { narrativePhase } from "./narrative";
import { anomalyPhase } from "./anomalies";
import { crisisPhase } from "./crisis";
import { victoryPhase } from "./victory";
import { megastructurePhase } from "./megastructures";
import { findCustomDesign } from "./designs";
import { traditionPhase } from "./traditions";
import { RESOURCE_ORDER, SCIENCE_ORDER } from "./types";
import type { Empire, ResourceId, World } from "./types";
import { TECH_BY_ID } from "@sf/data";

// ------------------------------------------------------------------ фаза 4: наука

function researchPhase(world: World): void {
  for (const empire of world.empires) {
    if (empire.dead) continue;
    const science = computeScience(world, empire);
    for (const school of SCIENCE_ORDER) {
      const total = empire.scienceFrac[school] + science[school];
      const points = Math.floor(total / 1000);
      empire.scienceFrac[school] = total - points * 1000;
      empire.science[school] = Math.min(20000, empire.science[school] + points);
      empire.scienceLastTick[school] = points;
    }
    for (const school of SCIENCE_ORDER) {
      const progress = empire.techs.progress[school];
      if (!progress.techId) continue;
      const tech = TECH_BY_ID[progress.techId];
      if (!tech) {
        progress.techId = null;
        progress.points = 0;
        continue;
      }
      progress.points += empire.science[school];
      empire.science[school] = 0;
      if (progress.points >= tech.cost) {
        empire.techs.completed.push(tech.id);
        empire.stats.techsResearched += 1;
        progress.techId = null;
        progress.points = 0;
        progress.frac = 0;
        empire.techs.offers[school] = generateTechOffers(world, empire, school);
        logEvent(world, "research", "good", `Исследование завершено: ${tech.ru} (${empire.name}).`, undefined, empire.id);
      }
    }
  }
}

// ------------------------------------------------------------------ фаза 5: строительство

function constructionPhase(world: World): void {
  for (const colony of world.colonies) {
    if (colony.queue.length === 0) continue;
    const empire = empireById(world, colony.empireId);
    if (!empire || empire.dead) continue;
    if ((world.flags[`def:${empire.id}:minerals`] ?? 0) > 0) continue; // дефицит минералов стопорит стройку
    const item = colony.queue[0];
    if (item.ticksLeft > 0) {
      item.ticksLeft -= 1;
      if (item.ticksLeft > 0) continue;
    }
    if (item.kind === "district") {
      colony.districts[item.id] = (colony.districts[item.id] ?? 0) + 1;
      recomputeColony(world, colony);
      updateStability(world, colony);
      if (empire.isPlayer) logEvent(world, "colony", "good", `Район построен на «${colony.name}».`, colony.systemId, empire.id);
    } else if (item.kind === "building") {
      colony.buildings.push(item.id);
      recomputeColony(world, colony);
      updateStability(world, colony);
      if (empire.isPlayer) logEvent(world, "colony", "good", `Здание построено на «${colony.name}».`, colony.systemId, empire.id);
    } else {
      // M5/M12: готовый шаблон @sf/data или пользовательский дизайн из конструктора.
      const stock = DESIGN_BY_ID[item.id];
      const custom = stock ? undefined : findCustomDesign(world, item.id);
      const designName = stock ? stock.ru : custom?.nameRu;
      if (designName !== undefined) {
        const ship = createShip(world.nextId++, item.id, designName, false, world);
        let fleet = world.fleets.find(
          (f) => f.empireId === empire.id && f.systemId === colony.systemId && f.status !== "moving",
        );
        if (!fleet) fleet = createFleet(world, empire.id, colony.systemId, [], "Новая эскадра", "wall");
        fleet.ships.push(ship);
        invalidateProjection(world, empire.id);
        empire.stats.shipsBuilt += 1;
        if (empire.isPlayer) logEvent(world, "fleet", "good", `Корабль «${designName}» построен в системе.`, colony.systemId, empire.id);
      }
    }
    colony.queue.shift();
  }
}

// ------------------------------------------------------------------ фаза 9: флоты

function fleetsPhase(world: World): void {
  for (const system of world.systems) system.visibleTo = [];
  for (const fleet of world.fleets) {
    if (fleet.ships.length === 0) continue;
    if (fleet.status === "moving" && fleet.path.length > 0) {
      if (fleet.jumpTicksLeft > 0) fleet.jumpTicksLeft -= 1;
      if (fleet.jumpTicksLeft <= 0) {
        const nextId = fleet.path[fleet.pathIndex];
        const nextSystem = nextId !== undefined ? world.systems[nextId] : undefined;
        if (nextSystem) {
          ensureFleetFuel(world, fleet);
          const fuelCost = jumpFuelCost(world, fleet, fleet.systemId, nextId);
          if (fuelOf(fleet) < fuelCost) {
            fleet.path = [];
            fleet.pathIndex = 0;
            fleet.status = "idle";
            if (fleet.empireId === world.playerEmpireId) logEvent(world, "fleet", "warn", "Флот «" + fleet.name + "» остался без топлива в системе " + (world.systems[fleet.systemId]?.name ?? "") + ".", fleet.systemId, fleet.empireId);
            continue;
          }
          fleet.fuel = fuelOf(fleet) - fuelCost;
          fleet.systemId = nextId;
          try {
            onContractJump(world, fleet.empireId, nextId);
          } catch {
            /* noop */
          }
          fleet.pathIndex += 1;
          if (fleet.pathIndex >= fleet.path.length) {
            fleet.path = [];
            fleet.pathIndex = 0;
            fleet.status = "idle";
          } else {
            fleet.jumpTicksLeft = jumpTicksFor(world, fleet);
          }
        } else {
          fleet.path = [];
          fleet.pathIndex = 0;
          fleet.status = "idle";
        }
      }
    }
    ensureFleetFuel(world, fleet);
    const system = world.systems[fleet.systemId];
    if (!system) continue;
    // ИИ сам дозаправляется на станциях; игрок — вручную.
    if (fleet.empireId !== world.playerEmpireId && fleet.status !== "moving" && system.station && fuelOf(fleet) < (fleet.fuelMax ?? 0)) {
      fleet.fuel = fleet.fuelMax;
    }
    if (!system.visibleTo.includes(fleet.empireId)) system.visibleTo.push(fleet.empireId);
    if (!system.knownBy.includes(fleet.empireId)) {
      system.knownBy.push(fleet.empireId);
      logEvent(world, "system", "good", `Империя ${fleet.empireId} обнаружила систему ${system.name}.`, system.id, fleet.empireId);
    }
    for (const nextId of system.links) {
      const next = world.systems[nextId];
      if (next && !next.knownBy.includes(fleet.empireId)) next.knownBy.push(fleet.empireId);
    }
  }
  for (const system of world.systems) {
    if (system.ownerId !== 0 && !system.visibleTo.includes(system.ownerId)) system.visibleTo.push(system.ownerId);
  }
  refreshPathfinderStock(world);
  // автобой при контакте враждебных флотов; бой с игроком ждёт выбора режима (L0).
  const fgTick = ensureFg(world);
  if (fgTick.pendingBattle) {
    const pb = fgTick.pendingBattle;
    const a = world.fleets.find((f) => f.id === pb.attackerFleetId && f.ships.length > 0);
    const b = world.fleets.find((f) => f.id === pb.defenderFleetId && f.ships.length > 0);
    if (!a || !b || a.systemId !== pb.systemId || b.systemId !== pb.systemId) fgTick.pendingBattle = null;
  }
  for (const system of world.systems) {
    const fleetsIn = world.fleets
      .filter((f) => f.systemId === system.id && f.ships.length > 0)
      .sort((a, b) => a.id - b.id);
    if (fleetsIn.length < 2) continue;
    let battleHappened = false;
    for (let i = 0; i < fleetsIn.length && !battleHappened; i++) {
      for (let j = i + 1; j < fleetsIn.length; j++) {
        const a = world.fleets.find((f) => f.id === fleetsIn[i].id);
        const b = world.fleets.find((f) => f.id === fleetsIn[j].id);
        if (!a || !b || a.ships.length === 0 || b.ships.length === 0) continue;
        if (!areFleetsHostile(world, a, b)) continue;
        const playerInvolved = a.empireId === world.playerEmpireId || b.empireId === world.playerEmpireId;
        if (playerInvolved) {
          if (!fgTick.pendingBattle) {
            fgTick.pendingBattle = {
              systemId: system.id,
              attackerFleetId: a.id,
              defenderFleetId: b.id,
              playerSide: a.empireId === world.playerEmpireId ? "attacker" : "defender",
              tick: world.tick,
            };
          }
          battleHappened = true;
          break;
        }
        autoResolve(world, a.id, b.id);
        battleHappened = true;
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ фаза 11: события и миссии

function missionsPhase(world: World): void {
  const playerId = world.playerEmpireId;
  for (const mission of world.missions) {
    if (mission.completed || mission.failed) continue;
    if (mission.deadlineTick > 0 && world.tick > mission.deadlineTick) {
      if (mission.accepted) logEvent(world, "mission", "warn", `Контракт провален: ${mission.titleRu}.`, mission.systemId, playerId);
      mission.failed = true;
      mission.accepted = false;
      continue;
    }
    if (!mission.accepted) continue;
    if (mission.kind === "delivery" || mission.kind === "passenger" || mission.kind === "smuggle" || mission.kind === "rescue") {
      const arrived = world.fleets.some(
        (fleet) => fleet.empireId === playerId && fleet.systemId === mission.systemId && fleet.ships.length > 0,
      );
      if (arrived) mission.progress = Math.min(mission.targetAmount, mission.progress + 1);
    }
    if (mission.kind === "bounty") {
      const battle = world.battles.find(
        (b) => b.tick === world.tick && b.systemId === mission.systemId
          && (b.attacker.empireId === playerId || b.defender.empireId === playerId),
      );
      if (battle) mission.progress = Math.min(mission.targetAmount, mission.progress + 1);
    }
    if (mission.progress >= mission.targetAmount) {
      mission.completed = true;
      mission.accepted = false;
      const player = empireById(world, playerId);
      if (player) {
        player.resources.credits += mission.rewardCredits;
        player.stats.creditsEarned += mission.rewardCredits;
      }
      logEvent(world, "mission", "good", `Контракт выполнен: ${mission.titleRu} (+${mission.rewardCredits} Cr).`, mission.systemId, playerId);
    }
  }
}

function marketPhase(world: World): void {
  if (world.tick % 30 !== 0) return;
  for (const system of world.systems) {
    const station = system.station;
    if (!station) continue;
    const regionFactor = 900 + (system.id % 5) * 50;
    for (const key of Object.keys(station.market)) {
      const res = key as ResourceId;
      const good = station.market[res];
      const def = RESOURCE_BY_ID[res];
      if (!good || !def) continue;
      const target = Math.round((def.retail * regionFactor) / 1000);
      good.price += Math.round(((target - good.price) * 45) / 1000);
      if (good.price < 1) good.price = 1;
      const targetStock = 400 + (system.id % 4) * 200;
      good.stock += Math.round(((targetStock - good.stock) * 60) / 1000);
      if (good.stock < 50) good.stock = 50;
    }
    station.marketTick = world.tick;
  }
}

// ------------------------------------------------------------------ фаза 12: счёт и победа

function gdpOf(world: World, empire: Empire): number {
  const projection = projectEmpire(world, empire);
  let milli = 0;
  for (const res of RESOURCE_ORDER) {
    if (projection.income[res] <= 0) continue;
    milli += mulMilli(projection.income[res], milliOf(RESOURCE_BY_ID[res].wholesale));
  }
  return Math.floor(milli / 1000);
}

function scorePhase(world: World): void {
  let totalGdp = 0;
  const gdps: number[] = [];
  for (const empire of world.empires) {
    if (empire.dead) {
      gdps.push(0);
      continue;
    }
    const gdp = gdpOf(world, empire);
    gdps.push(gdp);
    totalGdp += gdp;
  }
  for (let i = 0; i < world.empires.length; i++) {
    const empire = world.empires[i];
    if (empire.dead) continue;
    const share = totalGdp > 0 ? gdps[i] / totalGdp : 0;
    const key = `econ_share_ticks:${empire.id}`;
    world.flags[key] = share >= 0.4 ? (world.flags[key] ?? 0) + 1 : 0;
  }
  // «мягкая смерть» ИИ: нет колоний и живых флотов
  for (const empire of world.empires) {
    if (empire.isPlayer || empire.dead) continue;
    const hasFleets = empire.fleets.some((fleetId) => {
      const fleet = world.fleets.find((f) => f.id === fleetId);
      return fleet !== undefined && fleet.ships.length > 0;
    });
    if (empire.colonies.length === 0 && !hasFleets) {
      empire.dead = true;
      logEvent(world, "system", "bad", `Империя ${empire.name} пала.`, undefined, empire.id);
    }
  }
  world.victory = getVictory(world);
}

// ------------------------------------------------------------------ такт

export function tick(world: World): void {
  world.tick += 1;
  // снимок казны: incomeLastTick = фактическое изменение запаса за такт (HUD/тултипы)
  const snapshot: Array<Record<string, number>> = [];
  for (const empire of world.empires) snapshot.push({ ...empire.resources });
  // 1. население
  for (const colony of world.colonies) growPopulation(world, colony);
  // 2. назначение на работу
  for (const colony of world.colonies) recomputeColony(world, colony);
  // 3. производство
  for (const empire of world.empires) {
    if (empire.dead) continue;
    accrue(world, empire);
  }
  // 4. наука
  researchPhase(world);
  // 5. строительство
  constructionPhase(world);
  // 6. апкип
  for (const empire of world.empires) {
    if (empire.dead) continue;
    accrueUpkeep(world, empire);
  }
  // incomeLastTick — чистое изменение до клампа (используется дефицитами и HUD)
  for (let i = 0; i < world.empires.length; i++) {
    const empire = world.empires[i];
    if (empire.dead) continue;
    for (const res of RESOURCE_ORDER) {
      empire.incomeLastTick[res] = empire.resources[res] - snapshot[i][res];
    }
  }
  // 7. дефициты
  for (const empire of world.empires) {
    if (empire.dead) continue;
    applyDeficits(world, empire);
  }
  // фактическое изменение после клампа (совпадает с ростом запаса в HUD)
  for (let i = 0; i < world.empires.length; i++) {
    const empire = world.empires[i];
    if (empire.dead) continue;
    for (const res of RESOURCE_ORDER) {
      empire.incomeLastTick[res] = empire.resources[res] - snapshot[i][res];
    }
  }
  // 8. стабильность и преступность
  for (const colony of world.colonies) updateStability(world, colony);
  // 8b. традиции/перки, дипломатия, совет, шпионаж (M6/M7)
  traditionPhase(world);
  diplomacyPhase(world);
  federationPhase(world);
  councilPhase(world);
  espionagePhase(world);
  // 9. флоты: движение, обнаружение, автобой
  fleetsPhase(world);
  // 9b. войны: счёт, истощение, оккупация, мир (M7)
  warPhase(world);
  // 10. дипломатия и ИИ
  aiTurn(world);
  // 10b. видимая мировая политика: новости, распады/поглощения, события игрока (task-42)
  aiWorldPhase(world);
  // 11. события, миссии, рынок
  missionsPhase(world);
  marketPhase(world);
  // 11b. рынок с ордерами, биржа, маршруты, контракты (M8)
  marketExtPhase(world);
  routesPhase(world);
  contractsPhase(world);
  // 11c. кризисы, кампания, события, аномалии, мегаструктуры (M9/M10/M12)
  crisisPhase(world);
  campaignPhase(world);
  ancientsPhase(world);
  dlcPhase(world);
  narrativePhase(world);
  anomalyPhase(world);
  megastructurePhase(world);
  // 11d. условия победы (M10/M12)
  victoryPhase(world);
  // 12. счёт и победа
  scorePhase(world);
}

export { removeFleet };