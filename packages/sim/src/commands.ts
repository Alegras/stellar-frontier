/**
 * КОМАНДЫ ИГРОКА И ИИ. Все мутации мира — через applyCommand (валидируемо, детерминированно).
 * Проверки: принадлежность флота/колонии/системы, стоимость, лимит флота, достижимость пути.
 * AI использует ту же точку входа через applyCommandAs (без читов).
 */
import { BUILDING_BY_ID, DESIGN_BY_ID, DISTRICT_BY_ID, RESOURCE_BY_ID, TECH_BY_ID } from "@sf/data";
import type { BuildingDef, DistrictDef, TechDef } from "@sf/data";
import {
  canColonizePlanet, clamp, createColony, createFleet, empireById, findPlanet, logEvent, removeFleet, zeroResources,
} from "./economy";
import { applyBattleRecord, autoResolve } from "./combat";
import { canAfford, getBuildCost, getEmpireFleetPower, getFleetCap } from "./queries";
import { unlockTradition, unlockPerk } from "./traditions";
import { offerTreaty, respondTreaty, claimSystem, diplomacyPhase } from "./diplomacy";
import { declareWar as declareWarCommand, proposePeace as proposePeaceCommand } from "./war";
import { inviteFederation, acceptFederation, leaveFederation } from "./federation";
import { proposeResolution, voteResolution, vetoResolution } from "./council";
import { runEspionage } from "./espionage";
import { placeMarketOrder, cancelMarketOrder, exchangeTrade } from "./market";
import { createRoute, cancelRoute } from "./routes";
import { acceptContract, abandonContract } from "./contracts";
import { startCampaignMission, chooseBranch } from "./campaign";
import { chooseEvent, dismissEvent } from "./narrative";
import {
  acceptAncientsMission, ancientsFinalChoice, ancientsResearchTech, completeAncientsMission,
  recordAncientsStat,
  sectorClaim, sectorEnter, sectorExit, sectorScan, warpJump, warpRecharge,
} from "./ancients";
import {
  revealDlcSignal, dlcAcceptQuest, dlcBuyRumor, dlcDialogueAdvance, dlcDialogueChoose, dlcDialogueEnd, dlcNotifyAction,
  dlcToggle, startDlcDialogue,
} from "./dlc";
import { investigateAnomaly, archaeologyStep } from "./anomalies";
import { buildMegastructure } from "./megastructures";
import { createDesign, deleteDesign, findCustomDesign, saveDesign, updateDesign } from "./designs";
import { aiWorldEventChoice } from "./aiWorld";
import { consumePathfinderStock, ensureFg, pathfinderStockAt } from "./fullgame";
import { onContractScan, onContractJump } from "./contracts";
import { empireModifiers } from "./modifiers";
import { colonyCostFor, outpostCostFor } from "./economy";
import { onCampaignScan, onCampaignJump, onCampaignBattle } from "./campaign";
import { SCIENCE_ORDER } from "./types";
import type {
  BattleRecord, BuildItem, Colony, Command, CommandResult, Empire, Fleet, Formation, Planet,
  ResourceId, ScienceId, Ship, StarSystem, Station, World,
} from "./types";

const PIRATE_EMPIRE_ID = 9;

interface CostMap { [key: string]: number }

function ok(createdId?: number): CommandResult {
  return createdId === undefined ? { ok: true } : { ok: true, createdId };
}
function deny(messageRu: string): CommandResult {
  return { ok: false, messageRu };
}

export function findFleet(world: World, fleetId: number): Fleet | undefined {
  for (const fleet of world.fleets) if (fleet.id === fleetId) return fleet;
  return undefined;
}

export function findColony(world: World, colonyId: number): Colony | undefined {
  for (const colony of world.colonies) if (colony.id === colonyId) return colony;
  return undefined;
}

function findStation(world: World, stationId: number): Station | undefined {
  for (const system of world.systems) {
    if (system.station && system.station.id === stationId) return system.station;
  }
  return undefined;
}

function payCost(empire: Empire, cost: Partial<Record<ResourceId, number>>): void {
  for (const key of Object.keys(cost)) {
    const res = key as ResourceId;
    const value = cost[res];
    if (typeof value === "number" && value > 0) empire.resources[res] -= value;
  }
}

function refundCost(empire: Empire, cost: Partial<Record<ResourceId, number>>, ratio: number): void {
  for (const key of Object.keys(cost)) {
    const res = key as ResourceId;
    const value = cost[res];
    if (typeof value === "number" && value > 0) empire.resources[res] += Math.floor(value * ratio);
  }
}

/** BFS по гиперлиниям. Возвращает список будущих систем (без текущей), либо null. */
export function findPath(world: World, fromSystemId: number, toSystemId: number): number[] | null {
  if (fromSystemId === toSystemId) return [];
  const from = world.systems[fromSystemId];
  const to = world.systems[toSystemId];
  if (!from || !to) return null;
  const prev: number[] = new Array(world.systems.length).fill(-1);
  const visited: boolean[] = new Array(world.systems.length).fill(false);
  visited[fromSystemId] = true;
  const queue: number[] = [fromSystemId];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const system = world.systems[cur];
    if (!system) continue;
    const links = system.links;
    for (const next of links) {
      if (visited[next]) continue;
      visited[next] = true;
      prev[next] = cur;
      if (next === toSystemId) {
        const path: number[] = [];
        let cursor = next;
        while (cursor !== fromSystemId && cursor >= 0) {
          path.push(cursor);
          cursor = prev[cursor];
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}


export function applyCommand(world: World, cmd: Command): CommandResult {
  // Команды UI всегда от имени игрока; ИИ использует applyCommandAs.
  return applyCommandAs(world, world.playerEmpireId, cmd);
}

/** Та же валидация команд, но от имени конкретной империи (используется ИИ). */
export function applyCommandAs(world: World, empireId: number, cmd: Command): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire) return deny("Империя не найдена");

  switch (cmd.type) {
    case "move_fleet": {
      const fleet = findFleet(world, cmd.fleetId);
      if (!fleet) return deny("Флот не найден");
      if (fleet.empireId !== empireId) return deny("Это не ваш флот");
      if (!world.systems[cmd.systemId]) return deny("Система не найдена");
      if (fleet.systemId === cmd.systemId) return deny("Флот уже в этой системе");
      const path = findPath(world, fleet.systemId, cmd.systemId);
      if (!path || path.length === 0) return deny("Нет гиперлинии до целевой системы");
      fleet.path = path;
      fleet.pathIndex = 0;
      fleet.jumpTicksLeft = Math.max(1, world.balance.fleetSpeedTicksPerJump);
      fleet.status = "moving";
      const target = world.systems[cmd.systemId];
      if (empire.isPlayer) {
        logEvent(world, "fleet", "info", `Флот «${fleet.name}» направлен в систему ${target.name} (${path.length} прыжк.).`, fleet.systemId, empireId);
      }
      return ok();
    }
    case "stop_fleet": {
      const fleet = findFleet(world, cmd.fleetId);
      if (!fleet) return deny("Флот не найден");
      if (fleet.empireId !== empireId) return deny("Это не ваш флот");
      fleet.path = [];
      fleet.pathIndex = 0;
      fleet.jumpTicksLeft = 0;
      fleet.status = "idle";
      return ok();
    }
    case "colonize": {
      const fleet = findFleet(world, cmd.fleetId);
      if (!fleet) return deny("Флот не найден");
      if (fleet.empireId !== empireId) return deny("Это не ваш флот");
      const planet = findPlanet(world, cmd.planetId);
      if (!planet) return deny("Планета не найдена");
      if (planet.systemId !== fleet.systemId) return deny("Флот не в этой системе");
      const colonizeCheck = canColonizePlanet(world, empireId, planet);
      if (!colonizeCheck.ok) return deny(colonizeCheck.reasonRu ?? "Колонизация невозможна");
      const colonizer = fleet.ships.find((ship) => ship.classId === "colonizer");
      if (!colonizer) return deny("Нужен корабль-колонизатор");
      const cost = colonyCostFor(world, empireId);
      if (!canAfford(world, empireId, cost)) return deny("Не хватает ресурсов на колонию");
      payCost(empire, cost);
      fleet.ships = fleet.ships.filter((ship) => ship.id !== colonizer.id);
      const colony = createColony(world, empire, planet, { pops: { workers: 3, specialists: 0, rulers: 0 }, districts: {}, buildings: [] });
      empire.stats.coloniesFounded += 1;
      if (fleet.ships.length === 0) removeFleet(world, fleet.id);
      logEvent(world, "colony", "good", `Колония «${planet.name}» основана (${empire.name}).`, planet.systemId, empireId);
      return ok(colony.id);
    }
    case "build_ship": {
      const system = world.systems[cmd.systemId];
      if (!system) return deny("Система не найдена");
      if (system.ownerId !== empireId) return deny("Система не принадлежит вам");
      // M5/M12: поддерживаются и готовые шаблоны @sf/data, и пользовательские дизайны.
      const custom = findCustomDesign(world, cmd.designId);
      const stock = custom ? undefined : DESIGN_BY_ID[cmd.designId];
      if (!custom && !stock) return deny("Неизвестный проект корабля");
      if (custom && custom.ownerId !== empireId) return deny("Это не ваш дизайн");
      const designName = custom ? custom.nameRu : stock!.ru;
      const designFleetPower = custom ? custom.fleetPower : stock!.fleetPower;
      const designCostAlloys = custom ? custom.costAlloys : stock!.costAlloys;
      const designBuildTicks = custom ? custom.buildTicks : stock!.buildTicks;
      if (stock && stock.requiredTech && !empire.techs.completed.includes(stock.requiredTech)) {
        const canBuy = Boolean(cmd.buy) && stock.id === "pathfinder_ark" && pathfinderStockAt(world, cmd.systemId);
        if (!canBuy) return deny("Технология корабля не исследована; на этой верфи нет редкого «Путевода»");
        consumePathfinderStock(world, cmd.systemId);
      }
      const count = Math.floor(cmd.count);
      if (!Number.isFinite(count) || count < 1) return deny("Некорректное количество");
      if (count > 50) return deny("Максимум 50 кораблей за заказ");
      const colony = world.colonies.find((c) => c.systemId === cmd.systemId && c.empireId === empireId && c.buildings.includes("shipyard"));
      if (!colony) return deny("Нужна верфь в системе");
      const currentFp = getEmpireFleetPower(world, empireId);
      const cap = getFleetCap(world, empireId);
      if (currentFp + designFleetPower * count > cap) return deny("Превышен лимит флота");
      const mods = empireModifiers(world, empireId);
      const cost: CostMap = { alloys: Math.max(1, Math.round(designCostAlloys * count * mods.shipCostMult)) };
      if (!canAfford(world, empireId, cost)) return deny("Не хватает сплавов");
      payCost(empire, cost);
      for (let i = 0; i < count; i++) {
        const item: BuildItem = {
          kind: "ship", id: cmd.designId, ticksLeft: designBuildTicks, totalTicks: designBuildTicks,
        };
        colony.queue.push(item);
      }
      if (empire.isPlayer) {
        logEvent(world, "fleet", "info", `Заказано кораблей «${designName}»: ${count}.`, system.id, empireId);
      }
      return ok();
    }
    case "create_design": {
      return createDesign(world, empireId, {
        nameRu: cmd.nameRu, hullId: cmd.hullId, weapons: cmd.weapons, modules: cmd.modules,
      });
    }
    case "update_design": {
      return updateDesign(world, empireId, cmd.designId, {
        nameRu: cmd.nameRu, hullId: cmd.hullId, weapons: cmd.weapons, modules: cmd.modules,
      });
    }
    case "delete_design": {
      return deleteDesign(world, empireId, cmd.designId);
    }
    case "save_design": {
      return saveDesign(world, empireId, cmd.design, cmd.designId);
    }
    case "build_district": {
      const colony = findColony(world, cmd.colonyId);
      if (!colony) return deny("Колония не найдена");
      if (colony.empireId !== empireId) return deny("Это не ваша колония");
      const def: DistrictDef | undefined = DISTRICT_BY_ID[cmd.districtId];
      if (!def) return deny("Неизвестный район");
      if (!canAfford(world, empireId, def.cost)) return deny("Не хватает ресурсов");
      payCost(empire, def.cost);
      colony.queue.push({ kind: "district", id: def.id, ticksLeft: def.buildTicks, totalTicks: def.buildTicks });
      if (empire.isPlayer) logEvent(world, "colony", "info", `Начато строительство: ${def.ru} на «${colony.name}».`, colony.systemId, empireId);
      return ok();
    }
    case "build_building": {
      const colony = findColony(world, cmd.colonyId);
      if (!colony) return deny("Колония не найдена");
      if (colony.empireId !== empireId) return deny("Это не ваша колония");
      const def: BuildingDef | undefined = BUILDING_BY_ID[cmd.buildingId];
      if (!def) return deny("Неизвестное здание");
      if (def.requiredTech && !empire.techs.completed.includes(def.requiredTech)) return deny("Требуется исследованная технология");
      const built = colony.buildings.filter((id) => id === def.id).length;
      const queued = colony.queue.filter((item) => item.kind === "building" && item.id === def.id).length;
      if (def.maxPerColony && built + queued >= def.maxPerColony) return deny("Достигнут лимит зданий этого типа");
      if (!canAfford(world, empireId, def.cost)) return deny("Не хватает ресурсов");
      payCost(empire, def.cost);
      colony.queue.push({ kind: "building", id: def.id, ticksLeft: def.buildTicks, totalTicks: def.buildTicks });
      if (empire.isPlayer) logEvent(world, "colony", "info", `Начато строительство: ${def.ru} на «${colony.name}».`, colony.systemId, empireId);
      return ok();
    }
    case "cancel_build": {
      const colony = findColony(world, cmd.colonyId);
      if (!colony) return deny("Колония не найдена");
      if (colony.empireId !== empireId) return deny("Это не ваша колония");
      const index = Math.floor(cmd.index);
      if (index < 0 || index >= colony.queue.length) return deny("Нет такого пункта очереди");
      const item = colony.queue[index];
      const cost = getBuildCost(world, item.kind, item.id);
      refundCost(empire, cost, 0.5);
      colony.queue.splice(index, 1);
      if (empire.isPlayer) logEvent(world, "colony", "info", `Строительство отменено (возврат 50%).`, colony.systemId, empireId);
      return ok();
    }
    case "research_branch": {
      const tech = TECH_BY_ID[cmd.techId];
      if (!tech || !tech.branch) return deny("Это не технология отдельной ветки");
      const empire = empireById(world, empireId);
      if (!empire) return deny("Империя не найдена");
      if (empire.techs.completed.includes(tech.id)) return deny("Технология уже исследована");
      const missing = (tech.requires ?? []).filter((id) => !empire.techs.completed.includes(id));
      if (missing.length > 0) return deny("Не выполнены требования ветки: " + missing.join(", "));
      empire.techs.progress[tech.school] = { techId: tech.id, points: 0, frac: 0 };
      if (empire.isPlayer) logEvent(world, "research", "info", "Ветка «Гиперпрокладка»: исследование " + tech.ru + ".", undefined, empireId);
      return { ok: true, messageRu: "Исследование начато: " + tech.ru };
    }
    case "research": {
      if (!SCIENCE_ORDER.includes(cmd.school)) return deny("Неизвестная школа науки");
      const tech: TechDef | undefined = TECH_BY_ID[cmd.techId];
      if (!tech) return deny("Неизвестная технология");
      if (tech.school !== cmd.school) return deny("Технология другой школы");
      if (empire.techs.completed.includes(tech.id)) return deny("Технология уже исследована");
      if (!empire.techs.offers[cmd.school].includes(tech.id)) return deny("Технология не в списке предложений");
      empire.techs.progress[cmd.school] = { techId: tech.id, points: 0, frac: 0 };
      if (empire.isPlayer) logEvent(world, "research", "info", `Исследование: ${tech.ru} (${cmd.school}).`, undefined, empireId);
      return ok();
    }
    case "trade": {
      const station = findStation(world, cmd.stationId);
      if (!station) return deny("Станция не найдена");
      const good = station.market[cmd.good];
      if (!good) return deny("Товар не торгуется на станции");
      const qty = Math.floor(cmd.qty);
      if (!Number.isFinite(qty) || qty < 1) return deny("Некорректное количество");
      const maxQty = Math.max(1, Math.floor(good.stock * 0.08));
      if (qty > maxQty) return deny(`Сделка слишком крупная: максимум ${maxQty} ед. за такт`);
      const spread = Math.round(world.balance.marketSpreadPct * 100);
      const commission = Math.round(world.balance.marketCommissionPct * 100);
      // Глубина и проскальзывание цены (0..20%): крупная сделка двигает рынок.
      const depth = Math.max(50, Math.floor(good.stock * 0.2));
      // clamp(n, min, max): проскальзывание цены в десятых долях процента, максимум 20%
      const impact = clamp(Math.floor((qty * 1000) / depth), 0, 200);
      if (cmd.buy) {
        const price = Math.round((good.price * (10000 + spread + commission)) / 10000);
        const total = price * qty;
        if (empire.resources.credits < total) return deny("Не хватает кредитов");
        empire.resources.credits -= total;
        empire.resources[cmd.good] += qty;
        good.stock = Math.max(0, good.stock - qty);
        good.price = Math.max(1, Math.round((good.price * (1000 + impact)) / 1000));
        world.tradeVolume += total;
        if (empire.isPlayer) logEvent(world, "economy", "info", `Куплено ${qty} ед. ${RESOURCE_BY_ID[cmd.good]?.ru ?? cmd.good} за ${total} Cr.`, station.systemId, empireId);
      } else {
        if (empire.resources[cmd.good] < qty) return deny("Недостаточно товара на складе");
        // Цена исполнения считается ПОСЛЕ просадки от объёма продажи:
        // так обратная сделка на одном рынке всегда убыточна (нет «печати денег»).
        const nextBase = Math.max(1, Math.round((good.price * (1000 - impact)) / 1000));
        const price = Math.round((nextBase * (10000 - spread - commission)) / 10000);
        const total = price * qty;
        empire.resources[cmd.good] -= qty;
        empire.resources.credits += total;
        empire.stats.creditsEarned += total;
        good.stock += qty;
        good.price = nextBase;
        world.tradeVolume += total;
        if (empire.isPlayer) logEvent(world, "economy", "info", `Продано ${qty} ед. ${RESOURCE_BY_ID[cmd.good]?.ru ?? cmd.good} за ${total} Cr.`, station.systemId, empireId);
      }
      return ok();
    }
    case "scan_system": {
      const fleet = findFleet(world, cmd.fleetId);
      if (!fleet) return deny("Флот не найден");
      if (fleet.empireId !== empireId) return deny("Это не ваш флот");
      const system = world.systems[cmd.systemId];
      if (!system) return deny("Система не найдена");
      const inRange = fleet.systemId === system.id || system.links.includes(fleet.systemId);
      if (!inRange) return deny("Система вне зоны сенсоров флота");
      const wasKnown = system.knownBy.includes(empireId);
      const lines: string[] = [
        "Планет: " + system.planets.length + " · POI: " + system.poi.length,
      ];
      if (!wasKnown) {
        system.knownBy.push(empireId);
        system.visibleTo.push(empireId);
        lines.push("Новая система: " + system.name);
      }
      let newPlanets = 0;
      for (const planet of system.planets) {
        if (!planet.scanned) { planet.scanned = true; newPlanets += 1; }
      }
      if (newPlanets > 0) lines.push("Изучено планет: " + newPlanets + " (" + system.planets.length + " в системе)");
      let newPois = 0;
      let rewardCredits = 0;
      let rewardScience = 0;
      for (const poi of system.poi) {
        if (poi.scanned) continue;
        poi.scanned = true;
        newPois += 1;
        if (poi.rewardCredits > 0) {
          empire.resources.credits += poi.rewardCredits;
          empire.stats.creditsEarned += poi.rewardCredits;
          rewardCredits += poi.rewardCredits;
        }
        if (poi.rewardScience > 0) {
          const per = Math.floor(poi.rewardScience / 3);
          empire.science.physics += per;
          empire.science.society += per;
          empire.science.engineering += poi.rewardScience - per * 2;
          rewardScience += poi.rewardScience;
        }
        lines.push("Найдено: " + poi.nameRu);
      }
      if (rewardCredits > 0) lines.push("Кредиты: +" + rewardCredits);
      if (rewardScience > 0) lines.push("Наука: +" + rewardScience);
      for (const mission of world.missions) {
        if (!mission.accepted || mission.completed || mission.failed) continue;
        if (mission.kind === "scan" && mission.systemId === system.id) {
          const before = mission.progress;
          mission.progress = Math.min(mission.targetAmount, mission.progress + 1);
          if (mission.progress !== before) lines.push("Миссия «" + mission.titleRu + "»: " + mission.progress + "/" + mission.targetAmount);
        }
      }
      if (newPlanets === 0 && newPois === 0) lines.push("Новых объектов нет: данные системы уже актуальны.");
      if (!wasKnown) logEvent(world, "system", "good", "Обнаружена система " + system.name + " (" + newPois + " POI).", system.id, empireId);
      else if (empire.isPlayer) logEvent(world, "system", "info", "Сканирование " + system.name + ": " + lines.join(" · "), system.id, empireId);
      const scanReport = { titleRu: system.name, tick: world.tick, lines };
      return { ...ok(), messageRu: "Скан «" + system.name + "»: " + lines.join(" · "), scanReport };
    }
    case "accept_mission": {
      const mission = world.missions.find((m) => m.id === cmd.missionId);
      if (!mission) return deny("Контракт не найден");
      if (mission.completed || mission.failed) return deny("Контракт уже закрыт");
      if (mission.accepted) return deny("Контракт уже принят");
      mission.accepted = true;
      logEvent(world, "mission", "good", `Контракт принят: ${mission.titleRu}.`, mission.systemId, empireId);
      return ok();
    }
    case "abandon_mission": {
      const mission = world.missions.find((m) => m.id === cmd.missionId);
      if (!mission) return deny("Контракт не найден");
      if (!mission.accepted) return deny("Контракт не принят");
      mission.accepted = false;
      logEvent(world, "mission", "warn", `Контракт abandon: ${mission.titleRu}.`, mission.systemId, empireId);
      return ok();
    }
    case "declare_war": {
      // M7: война через модуль войн (CB, притязания, NAP/перемирие, союзники)
      return declareWarCommand(world, empireId, cmd.targetEmpireId, cmd.cb, cmd.claims);
    }
    case "make_peace": {
      // M7: мирная конференция (требования по военному счёту, перемирие 120 тактов)
      return proposePeaceCommand(world, empireId, cmd.targetEmpireId);
    }
    case "repair_fleet": {
      const fleet = findFleet(world, cmd.fleetId);
      if (!fleet) return deny("Флот не найден");
      if (fleet.empireId !== empireId) return deny("Это не ваш флот");
      const system = world.systems[fleet.systemId];
      if (!system || system.ownerId !== empireId) return deny("Ремонт возможен только в своей системе");
      let missing = 0;
      for (const ship of fleet.ships) missing += Math.max(0, ship.hullMax - ship.hull);
      if (missing <= 0) return deny("Флот не нуждается в ремонте");
      const cost: CostMap = { minerals: missing };
      if (!canAfford(world, empireId, cost)) return deny("Не хватает минералов на ремонт");
      payCost(empire, cost);
      for (const ship of fleet.ships) {
        ship.hull = ship.hullMax;
        ship.armor = ship.armorMax;
        ship.shield = ship.shieldMax;
      }
      if (empire.isPlayer) logEvent(world, "fleet", "good", `Флот «${fleet.name}» отремонтирован (-${missing} мин.).`, fleet.systemId, empireId);
      return ok();
    }
    case "set_formation": {
      const fleet = findFleet(world, cmd.fleetId);
      if (!fleet) return deny("Флот не найден");
      if (fleet.empireId !== empireId) return deny("Это не ваш флот");
      const formations: Formation[] = ["wedge", "wall", "sphere", "swarm", "echelon", "ambush", "caravan"];
      if (!formations.includes(cmd.formation)) return deny("Неизвестная формация");
      fleet.formation = cmd.formation;
      return ok();
    }
    case "apply_battle": {
      if (!cmd.report || typeof cmd.report !== "object") return deny("Некорректный отчёт боя");
      const report = cmd.report as BattleRecord;
      applyBattleRecord(world, report);
      try {
        const playerWon = report.attacker.empireId === empireId
          ? report.outcome === "attacker_win"
          : report.outcome === "defender_win";
        onCampaignBattle(world, empireId, report.systemId, playerWon);
      } catch {
        /* noop */
      }
      return ok();
    }
    case "set_speed": {
      const speed = Math.floor(cmd.speed);
      if (!Number.isFinite(speed) || speed < 0 || speed > 5) return deny("Некорректная скорость");
      world.speed = speed;
      world.paused = speed === 0;
      return ok();
    }
    case "flagship_jump": {
      const system = world.systems[cmd.systemId];
      if (!system) return deny("Система не найдена");
      let fleet = findFleet(world, empire.flagshipFleetId);
      if (!fleet || fleet.empireId !== empireId) {
        fleet = world.fleets.find((f) => f.empireId === empireId && f.ships.some((ship) => ship.isFlagship));
      }
      if (!fleet) return deny("Флагманский флот не найден");
      const current = world.systems[fleet.systemId];
      if (!current) return deny("Флот вне пространства");
      if (!current.links.includes(system.id)) return deny("FSD-прыжок возможен только в смежную систему");
      fleet.systemId = system.id;
      fleet.path = [];
      fleet.pathIndex = 0;
      fleet.jumpTicksLeft = 0;
      fleet.status = "idle";
      if (!system.knownBy.includes(empireId)) system.knownBy.push(empireId);
      if (!system.visibleTo.includes(empireId)) system.visibleTo.push(empireId);
      for (const next of system.links) {
        const nextSystem = world.systems[next];
        if (nextSystem && !nextSystem.knownBy.includes(empireId)) nextSystem.knownBy.push(empireId);
      }
      logEvent(world, "fleet", "info", `Флагман совершил FSD-прыжок в систему ${system.name}.`, system.id, empireId);
      try {
        onContractJump(world, empireId, system.id);
        onCampaignJump(world, empireId, system.id);
      } catch {
        /* noop */
      }
      return ok();
    }
    case "auto_resolve": {
      const system = world.systems[cmd.systemId];
      if (!system) return deny("Система не найдена");
      const own = world.fleets.find((f) => f.systemId === system.id && f.empireId === empireId && f.ships.length > 0);
      const enemy = world.fleets.find((f) => f.systemId === system.id && f.empireId !== empireId && f.ships.length > 0);
      if (!own) return deny("В системе нет вашего флота");
      if (!enemy) return deny("В системе нет вражеских флотов");
      const record = autoResolve(world, own.id, enemy.id);
      return { ok: true, messageRu: "Авторезолв: " + (record.outcome === "attacker_win" ? "победа" : record.outcome === "defender_win" ? "поражение" : "ничья") + " (потери: " + Math.round(record.attackerLossFp) + " / " + Math.round(record.defenderLossFp) + " FP)" };
    }
    case "collect_salvage": {
      const credits = Math.max(0, Math.min(5000, Math.floor(cmd.credits)));
      const alloys = Math.max(0, Math.min(200, Math.floor(cmd.alloys)));
      const empire = empireById(world, empireId);
      if (!empire) return deny("Империя не найдена");
      empire.resources.credits += credits;
      empire.resources.alloys += alloys;
      if (credits > 0) empire.stats.creditsEarned += credits;
      if (credits > 0 || alloys > 0) logEvent(world, "economy", "good", "Собран salvage: +" + credits + " Cr, +" + alloys + " сплавов.", undefined, empireId);
      return { ok: true, messageRu: "Salvage: +" + credits + " Cr, +" + alloys + " сплавов" };
    }
    case "resolve_pending_battle": {
      const fg = ensureFg(world);
      const pb = fg.pendingBattle;
      if (!pb) return deny("Нет ожидающего боя");
      const a = world.fleets.find((f) => f.id === pb.attackerFleetId && f.ships.length > 0);
      const b = world.fleets.find((f) => f.id === pb.defenderFleetId && f.ships.length > 0);
      if (!a || !b) { fg.pendingBattle = null; return deny("Флоты боя больше не существуют"); }
      const record = autoResolve(world, a.id, b.id);
      fg.pendingBattle = null;
      return { ok: true, battleReport: record, messageRu: "Авторезолв: " + (record.outcome === "attacker_win" ? "победа атакующего" : record.outcome === "defender_win" ? "победа защитника" : "ничья") };
    }
    case "dlc_signal_reach":
      return revealDlcSignal(world, cmd.signalId);
    case "escape_battle": {
      const fg = ensureFg(world);
      const pb = fg.pendingBattle;
      if (!pb) return deny("Нет боя, от которого можно уйти");
      const playerFleet = world.fleets.find((f) => f.id === (pb.playerSide === "attacker" ? pb.attackerFleetId : pb.defenderFleetId));
      const enemyFleet = world.fleets.find((f) => f.id === (pb.playerSide === "attacker" ? pb.defenderFleetId : pb.attackerFleetId));
      if (!playerFleet || !enemyFleet) { fg.pendingBattle = null; return deny("Флоты боя больше не существуют"); }
      const fpOf = (fl: typeof playerFleet): number => fl.ships.reduce((n, sh) => n + (DESIGN_BY_ID[sh.designId]?.fleetPower ?? 1), 0);
      const playerFp = Math.max(1, fpOf(playerFleet));
      const enemyFp = Math.max(1, fpOf(enemyFleet));
      if (enemyFp >= playerFp * 2.2) return deny("Атакующий слишком силён: он блокирует отход");
      const from = world.systems[playerFleet.systemId];
      const candidates = (from?.links ?? []).map((id) => world.systems[id]).filter((s) => s && s.ownerId !== enemyFleet.empireId && s.ownerId !== PIRATE_EMPIRE_ID);
      const dest = candidates.find((s) => s.ownerId === empireId) ?? candidates[0];
      if (!dest) return deny("Нет безопасной системы для отхода");
      const free = playerFp >= enemyFp * 0.8;
      const frac = free ? 0 : Math.max(0.15, Math.min(0.4, 0.15 + 0.25 * ((enemyFp - playerFp) / enemyFp)));
      const keep = Math.max(0, playerFleet.ships.length - Math.max(free ? 0 : 1, Math.floor(playerFleet.ships.length * frac)));
      const lost = playerFleet.ships.length - keep;
      if (lost > 0) playerFleet.ships = playerFleet.ships.filter((sh) => sh.isFlagship).concat(playerFleet.ships.filter((sh) => !sh.isFlagship).slice(0, Math.max(0, keep - playerFleet.ships.filter((sh) => sh.isFlagship).length)));
      if (playerFleet.ships.length === 0) { removeFleet(world, playerFleet.id); }
      else { playerFleet.systemId = dest.id; playerFleet.path = []; playerFleet.pathIndex = 0; playerFleet.jumpTicksLeft = 0; playerFleet.status = "idle"; }
      fg.pendingBattle = null;
      logEvent(world, "fleet", "warn", "Отход из боя в " + dest.name + (lost > 0 ? ", потеряно кораблей: " + lost : ", без потерь") + ".", dest.id, empireId);
      return { ok: true, messageRu: free ? "Отход без потерь в " + dest.name : "Отход с потерями (" + lost + ") в " + dest.name };
    }
    case "clear_pending_battle": {
      ensureFg(world).pendingBattle = null;
      return ok();
    }
    case "join_battle": {
      const system = world.systems[cmd.systemId];
      if (!system) return deny("Система не найдена");
      const enemies = world.fleets.filter((f) => f.systemId === system.id && f.empireId !== empireId && f.ships.length > 0);
      if (enemies.length === 0) return deny("В системе нет вражеских флотов");
      logEvent(world, "combat", "warn", `Адмирал вступает в бой в системе ${system.name}.`, system.id, empireId);
      return ok();
    }
    case "plot_hyperlane": {
      const fleet = findFleet(world, cmd.fleetId);
      if (!fleet || fleet.empireId !== empireId) return deny("Флот не найден");
      const from = world.systems[fleet.systemId];
      const target = world.systems[cmd.targetSystemId];
      if (!from || !target) return deny("Система не найдена");
      if (from.id === target.id) return deny("Выберите другую систему");
      if (from.links.includes(target.id)) return deny("Гиперпуть уже существует");
      const hasPathfinder = fleet.ships.some((ship) => {
        const design = DESIGN_BY_ID[ship.designId];
        return design?.role === "pathfinder" || design?.modules.includes("hyperlane_projector_mk1")
;
      });
      if (!hasPathfinder) return deny("Нужен гиперпрокладчик «Путевод» с модулем «Разлом»");
      const dist = Math.hypot(from.x - target.x, from.y - target.y);
      const maxDist = empire.techs.completed.includes("eng_fsd_2") ? 1800 : 1200;
      if (dist > maxDist) return deny("Система вне дальности прокладки");
      const cost = { alloys: empire.techs.completed.includes("eng_fsd_2") ? 20 : 32, credits: 5000 };
      if (!canAfford(world, empireId, cost)) return deny("Не хватает сплавов/кредитов на прокладку");
      payCost(empire, cost);
      from.links.push(target.id);
      target.links.push(from.id);
      if (!target.knownBy.includes(empireId)) target.knownBy.push(empireId);
      if (!target.visibleTo.includes(empireId)) target.visibleTo.push(empireId);
      logEvent(world, "fleet", "good", "Проложен новый гиперпуть: " + from.name + " ↔ " + target.name + ".", from.id, empireId);
      return { ok: true, messageRu: "Новый гиперпуть: " + from.name + " ↔ " + target.name };
    }
    // ================================================================ M6–M12
    case "tradition_unlock":
      return unlockTradition(world, empireId, cmd.treeId, cmd.nodeId);
    case "perk_unlock":
      return unlockPerk(world, empireId, cmd.perkId);
    case "treaty_offer":
      return offerTreaty(world, empireId, cmd.targetEmpireId, cmd.treaty);
    case "treaty_respond":
      return respondTreaty(world, empireId, cmd.offerId, cmd.accept);
    case "claim_system":
      return claimSystem(world, empireId, cmd.systemId);
    case "federation_invite":
      return inviteFederation(world, empireId, cmd.targetEmpireId);
    case "federation_accept":
      return acceptFederation(world, empireId, cmd.leaderEmpireId);
    case "federation_leave":
      return leaveFederation(world, empireId);
    case "council_propose":
      return proposeResolution(world, empireId, cmd.resolutionType, cmd.targetEmpireId);
    case "council_vote":
      return voteResolution(world, empireId, cmd.resolutionId, cmd.vote);
    case "council_veto":
      return vetoResolution(world, empireId, cmd.resolutionId);
    case "espionage":
      return runEspionage(world, empireId, cmd.targetEmpireId, cmd.op);
    case "market_order":
      return placeMarketOrder(world, empireId, cmd.stationId, cmd.good, cmd.side, cmd.price, cmd.qty);
    case "market_cancel":
      return cancelMarketOrder(world, empireId, cmd.stationId, cmd.orderId);
    case "exchange_trade":
      return exchangeTrade(world, empireId, cmd.side, cmd.qty, cmd.limitRate);
    case "route_create":
      return createRoute(world, empireId, cmd.fromSystemId, cmd.toSystemId, cmd.good, cmd.qty, cmd.sellAtDest);
    case "route_cancel":
      return cancelRoute(world, empireId, cmd.routeId);
    case "contract_accept":
      return acceptContract(world, empireId, cmd.contractId);
    case "contract_abandon":
      return abandonContract(world, empireId, cmd.contractId);
    case "campaign_start":
      return startCampaignMission(world, empireId, cmd.missionId);
    case "campaign_branch":
      return chooseBranch(world, empireId, cmd.branch);
    case "event_choice":
      return chooseEvent(world, empireId, cmd.eventId, cmd.choiceId);
    case "event_dismiss":
      return dismissEvent(world, empireId, cmd.eventId);
    case "ancients_tech":
      return ancientsResearchTech(world, empireId, cmd.techId);
    case "warp_jump":
      return warpJump(world, empireId, cmd.targetSystemId);
    case "warp_recharge":
      return warpRecharge(world, empireId);
    case "sector_scan":
      return sectorScan(world, empireId, cmd.systemId);
    case "sector_claim":
      return sectorClaim(world, empireId, cmd.systemId);
    case "ancients_final":
      return ancientsFinalChoice(world, empireId, cmd.choice);
    case "dlc_quest_accept":
      return dlcAcceptQuest(world, empireId, cmd.questId, cmd.source);
    case "dlc_dialogue_start":
      return startDlcDialogue(world, cmd.sceneId, cmd.questId ?? null);
    case "dlc_dialogue_choice":
      return dlcDialogueChoose(world, empireId, cmd.nodeId, cmd.choiceId);
    case "dlc_dialogue_advance":
      return dlcDialogueAdvance(world, empireId);
    case "dlc_dialogue_end":
      return dlcDialogueEnd(world, empireId);
    case "ai_world_event_choice":
      return aiWorldEventChoice(world, empireId, cmd.eventId, cmd.choiceId);
    case "dlc_action":
      return dlcNotifyAction(world, cmd.action, cmd.target);
    case "dlc_buy_rumor":
      return dlcBuyRumor(world, empireId, cmd.rumorId);
    case "dlc_toggle":
      return dlcToggle(world, cmd.enabled);
    case "ancients_accept_mission":
      return acceptAncientsMission(world, empireId, cmd.questId);
    case "ancients_quest":
      return cmd.action === "complete"
        ? completeAncientsMission(world, cmd.questId)
        : acceptAncientsMission(world, empireId, cmd.questId);
    case "ancients_sector_enter":
    case "sector_enter":
      return sectorEnter(world, empireId, cmd.systemId);
    case "ancients_sector_exit":
    case "sector_exit":
      return sectorExit(world, empireId);
    case "anomaly_investigate": {
      const result = investigateAnomaly(world, empireId, cmd.anomalyId);
      if (result.ok) {
        recordAncientsStat(world, "scans", 1);
        dlcNotifyAction(world, "scan", cmd.anomalyId);
      }
      return result;
    }
    case "archaeology_step": {
      const result = archaeologyStep(world, empireId, cmd.chainId);
      if (result.ok) recordAncientsStat(world, "scans", 1);
      return result;
    }
    case "megastructure_build":
      return buildMegastructure(world, empireId, cmd.megastructure, cmd.systemId);
    case "pause_vote": {
      const fg = ensureFg(world);
      fg.multiplayer.pauseVotes[empireId] = cmd.vote;
      return ok();
    }
    default:
      return deny("Неизвестная команда");
  }
}

export { zeroResources };