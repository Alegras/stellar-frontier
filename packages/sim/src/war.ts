/**
 * ВОЙНЫ (M7): CB, притязания, военный счёт, истощение, оккупация, мирная конференция.
 * GDD §12.6–12.10.
 *
 * Военный счёт и истощение считаются каждый такт в warPhase детерминированно:
 * потери берутся из world.battles (отчёты авторезолва), оккупация — из присутствия
 * флотов в системах противника, блокады — из присутствия флота в системах со станциями.
 */
import { clamp, empireById, logEvent } from "./economy";
import { getEmpireFleetPower } from "./queries";
import {
  activeClaim, addRecentAction, atWarWith, claimKey, CLAIM_COST, CLAIM_TTL, mirrorTreaty, NAP_TICKS, refreshOpinion,
} from "./diplomacy";
import { advancedOf, ensureFg, pushJournal, relationOf } from "./fullgame";
import { setTruce, treatyActive, truceUntil, warSideOf, setWarSide } from "./diplomacy";
import { applyIntelVisibility } from "./espionage";
import { councilActive, councilForcedPeaceSince, resolutionEffectValue } from "./council";
import type { CBKind, War, WarSide } from "./fullgame";
import type { CommandResult, Empire, ResourceId, World } from "./types";

const PIRATE_EMPIRE_ID = 9;

/** Перемирие после мира: 120 тактов (GDD §12.9). */
export const TRUCE_TICKS = 120;
/** Оккупация: флот + «десант» в системе 5 тактов (GDD §12.10). */
export const OCCUPATION_TICKS = 5;
/** Принудительный мир при истощении 80 через 50 тактов (GDD §12.8). */
export const FORCED_PEACE_TICKS = 50;

/** Стоимость CB (GDD §12.6). Завоевание оплачивается притязаниями (25/система). */
export const CB_COST: Record<CBKind, number> = {
  conquest: 0,
  liberation: 15,
  humiliation: 10,
  vassalization: 40,
  crisis: 0,
  defensive: 0,
  none: 0,
};

/** Множитель военного счёта по CB (GDD §12.6). */
export const CB_SCORE_MULT: Record<CBKind, number> = {
  conquest: 1.0,
  liberation: 0.8,
  humiliation: 0.5,
  vassalization: 0.7,
  crisis: 1.2,
  defensive: 1.0,
  none: 1.0,
};

const PRODUCTION_RESOURCES: ResourceId[] = ["energy", "minerals", "food", "alloys", "goods"];

function deny(messageRu: string): CommandResult {
  return { ok: false, messageRu };
}

function ok(messageRu?: string): CommandResult {
  return messageRu === undefined ? { ok: true } : { ok: true, messageRu };
}

export function warOf(world: World, a: number, b: number): War | undefined {
  const fg = ensureFg(world);
  return fg.wars.find(
    (w) => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a),
  );
}

function warOfSide(world: World, empireId: number): War | undefined {
  const fg = ensureFg(world);
  return fg.wars.find((war) => war.sides[empireId] !== undefined);
}

/** Противник по войне (первая сторона на противоположной стороне). */
export function enemyOf(world: World, war: War, empireId: number): number {
  const mySide = warSideOf(world, war.id, empireId);
  if (mySide === 0) return 0;
  const enemies = Object.keys(war.sides)
    .map(Number)
    .filter((id) => warSideOf(world, war.id, id) !== 0 && warSideOf(world, war.id, id) !== mySide)
    .sort((a, b) => a - b);
  return enemies[0] ?? 0;
}

function addSide(world: World, war: War, empireId: number, side: number): void {
  if (war.sides[empireId]) return;
  const fpStart = Math.max(1, getEmpireFleetPower(world, empireId));
  const warSide: WarSide = { empireId, fpStart, fpLost: 0, claims: [], occupiedSystems: [] };
  war.sides[empireId] = warSide;
  war.score[empireId] = 0;
  war.exhaustion[empireId] = 0;
  setWarSide(world, war.id, empireId, side);
  const advanced = advancedOf(world, empireId);
  if (!advanced.warIds.includes(war.id)) advanced.warIds.push(war.id);
  // старое зеркало Relation: война
  for (const otherId of Object.keys(war.sides).map(Number)) {
    if (warSideOf(world, war.id, otherId) === side) continue;
    markHostile(world, empireId, otherId);
  }
}

function markHostile(world: World, a: number, b: number): void {
  const empireA = empireById(world, a);
  const empireB = empireById(world, b);
  if (empireA && empireA.relations[b]) {
    empireA.relations[b].treaty = "war";
    empireA.relations[b].warTicks = 0;
  }
  if (empireB && empireB.relations[a]) {
    empireB.relations[a].treaty = "war";
    empireB.relations[a].warTicks = 0;
  }
}

function joinSide(world: World, war: War, empireId: number, side: number, reasonRu: string): void {
  if (war.sides[empireId]) return;
  addSide(world, war, empireId, side);
  const empire = empireById(world, empireId);
  logEvent(world, "diplomacy", "warn", (empire?.name ?? "Империя " + empireId) + " вступает в войну (" + reasonRu + ").", undefined, empire?.isPlayer ? empireId : undefined);
}

function findOverlordOf(world: World, vassalId: number): number {
  for (const empire of world.empires) {
    if (empire.dead || empire.id === vassalId) continue;
    if (advancedOf(world, empire.id).vassals.includes(vassalId)) return empire.id;
  }
  return 0;
}

function sameFederation(world: World, a: number, b: number): boolean {
  for (const federation of ensureFg(world).federations) {
    if (federation.members.includes(a) && federation.members.includes(b)) return true;
  }
  return false;
}

function hasEspionageCb(world: World, attackerId: number, defenderId: number): boolean {
  const until = world.flags["cb:" + attackerId + ":" + defenderId];
  return typeof until === "number" && until > world.tick;
}

/** Империи на стороне войны (по возрастанию id). */
export function warMembers(world: World, war: War): number[] {
  return Object.keys(war.sides).map(Number).sort((a, b) => a - b);
}

// ------------------------------------------------------------------ объявление войны

export function declareWar(world: World, attackerId: number, defenderId: number, cb?: CBKind, claims?: number[]): CommandResult {
  const fg = ensureFg(world);
  const attacker = empireById(world, attackerId);
  const defender = empireById(world, defenderId);
  if (!attacker || !defender || attackerId === defenderId) return deny("Некорректная цель");
  if (attacker.dead || defender.dead) return deny("Империя недоступна");
  if (attackerId === PIRATE_EMPIRE_ID || defenderId === PIRATE_EMPIRE_ID) return deny("Пиратам нельзя объявить войну");
  if (warOf(world, attackerId, defenderId)) return deny("Вы уже воюете с этой империей");
  if (atWarWith(world, attackerId, defenderId)) return deny("Вы уже на противоположных сторонах войны");

  const truce = truceUntil(world, attackerId, defenderId);
  if (truce > world.tick) return deny("Перемирие действует ещё " + (truce - world.tick) + " тактов");

  const rel = relationOf(world, attackerId, defenderId);
  if (rel.treaties.nap.active && (rel.treaties.nap.expiresTick === 0 || world.tick < rel.treaties.nap.expiresTick)) {
    const left = rel.treaties.nap.expiresTick > 0 ? rel.treaties.nap.expiresTick - world.tick : NAP_TICKS;
    return deny("Пакт о ненападении действует ещё " + left + " тактов");
  }
  if (treatyActive(world, attackerId, defenderId, "alliance") || treatyActive(world, attackerId, defenderId, "defensive")) {
    return deny("Союзный договор: сначала разорвите союз");
  }

  const advanced = advancedOf(world, attackerId);
  let kind: CBKind = cb ?? "none";
  let claimList = (claims ?? []).slice().sort((a, b) => a - b);
  if (claimList.length === 0) {
    claimList = advanced.claims.filter((systemId) => world.systems[systemId]?.ownerId === defenderId).sort((a, b) => a - b);
  }
  if (kind === "none") {
    if (claimList.length > 0) kind = "conquest";
    else if (rel.opinion < -25 || hasEspionageCb(world, attackerId, defenderId)) kind = "humiliation";
    else if (getEmpireFleetPower(world, defenderId) < getEmpireFleetPower(world, attackerId) * 0.5) kind = "vassalization";
    else return deny("Нет повода к войне (casus belli): нужно притязание или враждебность");
  }

  for (const systemId of claimList) {
    const system = world.systems[systemId];
    if (!system || system.ownerId !== defenderId) return deny("Притязание должно быть на систему противника");
  }

  let cost = CB_COST[kind];
  switch (kind) {
    case "conquest": {
      if (claimList.length === 0) return deny("Для завоевания нужно притязание на систему");
      let unclaimed = 0;
      for (const systemId of claimList) if (!activeClaim(world, attackerId, systemId)) unclaimed += 1;
      cost += unclaimed * CLAIM_COST;
      break;
    }
    case "liberation": {
      if (findOverlordOf(world, defenderId) === 0) return deny("Цель не является вассалом");
      break;
    }
    case "humiliation": {
      if (rel.opinion >= -25 && !hasEspionageCb(world, attackerId, defenderId)) {
        return deny("Для унижения нужно мнение ниже −40");
      }
      break;
    }
    case "vassalization": {
      if (getEmpireFleetPower(world, defenderId) >= getEmpireFleetPower(world, attackerId) * 0.5) {
        return deny("Цель слишком сильна для вассализации (нужно FP цели < 50% вашего)");
      }
      break;
    }
    case "crisis": {
      if (!councilPassed(world, "declare_crisis")) return deny("CB «кризис» требует резолюции совета");
      break;
    }
    default:
      break;
  }
  if (attacker.resources.influence < cost) return deny("Нужно " + cost + " влияния");
  attacker.resources.influence -= cost;

  // притязания закрепляются за атакующим (неоплаченные — оплачиваются сейчас)
  for (const systemId of claimList) {
    if (activeClaim(world, attackerId, systemId)) continue;
    if (!advanced.claims.includes(systemId)) advanced.claims.push(systemId);
    advanced.claims.sort((a, b) => a - b);
    world.flags[claimKey(attackerId, systemId)] = world.tick + CLAIM_TTL;
  }

  const war: War = {
    id: fg.nextWarId++,
    attackerId,
    defenderId,
    startedTick: world.tick,
    cb: kind,
    sides: {},
    score: {},
    exhaustion: {},
    occupied: {},
    lastBattleTick: world.tick,
    pendingPeace: null,
  };
  fg.wars.push(war);
  addSide(world, war, attackerId, 1);
  addSide(world, war, defenderId, 2);
  war.sides[attackerId].claims = claimList.slice();

  // союзники/федерация/сюзерен вступают в войну
  const joiners = world.empires.filter((e) => !e.dead && e.id !== attackerId && e.id !== defenderId && e.id !== PIRATE_EMPIRE_ID).sort((a, b) => a.id - b.id);
  for (const empire of joiners) {
    if (treatyActive(world, empire.id, defenderId, "defensive")
      || treatyActive(world, empire.id, defenderId, "alliance")
      || sameFederation(world, empire.id, defenderId)
      || findOverlordOf(world, defenderId) === empire.id) {
      joinSide(world, war, empire.id, 2, "союз/федерация с защитником");
    } else if (treatyActive(world, empire.id, attackerId, "alliance")) {
      joinSide(world, war, empire.id, 1, "союз с атакующим");
    }
  }

  world.flags["hist:wars"] = (world.flags["hist:wars"] ?? 0) + 1;
  markHostile(world, attackerId, defenderId);
  for (const sideEmpireId of warMembers(world, war)) {
    for (const sideEmpireId2 of warMembers(world, war)) {
      if (warSideOf(world, war.id, sideEmpireId) === warSideOf(world, war.id, sideEmpireId2)) continue;
      markHostile(world, sideEmpireId, sideEmpireId2);
    }
  }
  refreshAll(world);
  logEvent(
    world, "diplomacy", "warn",
    attacker.name + " объявила войну " + defender.name + " (CB: " + kind + (claimList.length > 0 ? ", притязаний: " + claimList.length : "") + ").",
    undefined, attacker.isPlayer ? attackerId : defender.isPlayer ? defenderId : undefined,
  );
  pushJournal(fg, world.tick, "war", "Война: " + attacker.name + " → " + defender.name + " (" + kind + ")");
  return ok("Война объявлена (" + kind + ")");
}

function refreshAll(world: World): void {
  const empires = world.empires.filter((e) => !e.dead && e.id !== PIRATE_EMPIRE_ID).sort((a, b) => a.id - b.id);
  for (let i = 0; i < empires.length; i++) {
    for (let j = i + 1; j < empires.length; j++) {
      refreshOpinion(world, empires[i].id, empires[j].id);
    }
  }
}

function councilPassed(world: World, type: string): boolean {
  return councilActive(world, type);
}

// ------------------------------------------------------------------ мирная конференция

/** Сколько систем можно потребовать при данном военном счёте (GDD §12.7). */
export function demandsForScore(score: number, enemySystems: number): number {
  if (score >= 100) return enemySystems;
  if (score >= 75) return Math.min(5, enemySystems);
  if (score >= 50) return Math.min(3, enemySystems);
  if (score >= 30) return Math.min(1, enemySystems);
  return 0;
}

function demandsFor(world: World, war: War, empireId: number): number[] {
  const score = war.score[empireId] ?? 0;
  const enemyId = enemyOf(world, war, empireId);
  if (enemyId === 0) return [];
  const enemySystems = world.systems.filter((s) => s.ownerId === enemyId).map((s) => s.id).sort((a, b) => a - b);
  const count = demandsForScore(score, enemySystems.length);
  if (count <= 0) return [];
  const result: number[] = [];
  const occupied = (war.sides[empireId]?.occupiedSystems ?? []).filter((id) => world.systems[id]?.ownerId === enemyId).sort((a, b) => a - b);
  for (const systemId of occupied) {
    if (result.length >= count) break;
    result.push(systemId);
  }
  const capitalId = empireById(world, enemyId)?.capitalSystemId ?? 0;
  const rest = enemySystems.filter((id) => !result.includes(id));
  rest.sort((a, b) => {
    const capA = a === capitalId ? 0 : 1;
    const capB = b === capitalId ? 0 : 1;
    if (capA !== capB) return capA - capB;
    return a - b;
  });
  for (const systemId of rest) {
    if (result.length >= count) break;
    result.push(systemId);
  }
  return result.sort((a, b) => a - b);
}

function aiAcceptsPeace(world: World, war: War, targetId: number, demands: number[]): boolean {
  const targetScore = war.score[targetId] ?? 0;
  const exhaustion = war.exhaustion[targetId] ?? 0;
  const systems = world.systems.filter((s) => s.ownerId === targetId).length;
  const ratio = demands.length / Math.max(1, systems);
  const warTicks = world.tick - war.startedTick;
  if (demands.length === 0) {
    if (exhaustion >= 25) return true;
    if (targetScore <= -10) return true;
    if (warTicks >= 200 && exhaustion >= 15) return true;
    return false;
  }
  if (exhaustion >= 80) return true;
  if (exhaustion >= 40 && targetScore < -20) return true;
  if (exhaustion >= 30 && targetScore < 0 && ratio <= 0.3) return true;
  if (exhaustion >= 20 && ratio <= 0.34) return true;
  return false;
}

function transferSystem(world: World, systemId: number, toEmpireId: number): void {
  const system = world.systems[systemId];
  if (!system) return;
  const fromId = system.ownerId;
  if (fromId === toEmpireId || fromId === 0) return;
  const from = empireById(world, fromId);
  const to = empireById(world, toEmpireId);
  if (!to) return;
  if (from) from.systems = from.systems.filter((id) => id !== systemId);
  if (!to.systems.includes(systemId)) to.systems.push(systemId);
  to.systems.sort((a, b) => a - b);
  system.ownerId = toEmpireId;
  for (const planet of system.planets) {
    if (planet.ownerId === fromId) planet.ownerId = toEmpireId;
    if (!planet.colonyId) continue;
    const colony = world.colonies.find((c) => c.id === planet.colonyId);
    if (!colony || colony.empireId !== fromId) continue;
    colony.empireId = toEmpireId;
    if (from) from.colonies = from.colonies.filter((id) => id !== colony.id);
    if (!to.colonies.includes(colony.id)) to.colonies.push(colony.id);
    to.colonies.sort((a, b) => a - b);
  }
  if (system.station && system.station.ownerId === fromId) system.station.ownerId = toEmpireId;
  logEvent(world, "diplomacy", "warn", "Система «" + system.name + "» переходит под контроль " + to.name + ".", systemId, to.isPlayer ? toEmpireId : undefined);
}

function endWar(world: World, war: War, reasonRu: string): void {
  const fg = ensureFg(world);
  const index = fg.wars.findIndex((w) => w.id === war.id);
  if (index < 0) return;
  fg.wars.splice(index, 1);
  const members = warMembers(world, war);
  // перемирие между всеми противоположными сторонами
  for (const a of members) {
    for (const b of members) {
      if (a >= b) continue;
      if (warSideOf(world, war.id, a) === warSideOf(world, war.id, b)) continue;
      setTruce(world, a, b, TRUCE_TICKS);
    }
  }
  for (const empireId of members) {
    const advanced = advancedOf(world, empireId);
    advanced.warIds = advanced.warIds.filter((id) => id !== war.id);
    for (const key of Object.keys(world.flags)) {
      if (key.startsWith("occ:" + war.id + ":")) delete world.flags[key];
      if (key.startsWith("fpeace:" + war.id + ":")) delete world.flags[key];
      if (key.startsWith("warside:" + war.id + ":")) delete world.flags[key];
      if (key.startsWith("peaceoffer:" + war.id + ":")) delete world.flags[key];
    }
    const empire = empireById(world, empireId);
    if (!empire) continue;
    for (const otherId of members) {
      if (otherId === empireId) continue;
      const other = empireById(world, otherId);
      if (!other) continue;
      if (empire.relations[otherId]) empire.relations[otherId].treaty = mirrorTreaty(world, empireId, otherId);
    }
  }
  const playerInvolved = members.includes(world.playerEmpireId);
  logEvent(world, "diplomacy", "good", "Война завершена: " + reasonRu + ". Перемирие " + TRUCE_TICKS + " тактов.", undefined, playerInvolved ? world.playerEmpireId : undefined);
  pushJournal(fg, world.tick, "peace", "Мир: " + reasonRu);
}

function applyPeace(world: World, war: War, initiatorId: number, demands: number[]): void {
  const enemyId = enemyOf(world, war, initiatorId);
  if (enemyId === 0) return;
  for (const systemId of demands) transferSystem(world, systemId, initiatorId);
  const initiator = empireById(world, initiatorId);
  const loser = empireById(world, enemyId);
  const score = war.score[initiatorId] ?? 0;
  // условия по CB §12.6–12.7
  if (war.cb === "vassalization" && score >= 50 && loser && !advancedOf(world, initiatorId).vassals.includes(enemyId)) {
    advancedOf(world, initiatorId).vassals.push(enemyId);
    const rel = relationOf(world, initiatorId, enemyId);
    rel.treaties.vassal = { active: true, sinceTick: world.tick, expiresTick: 0 };
  }
  if (war.cb === "humiliation" && score >= 10) {
    const rel = relationOf(world, initiatorId, enemyId);
    rel.treaties.tribute = { active: true, sinceTick: world.tick, expiresTick: world.tick + NAP_TICKS };
    world.flags["tribute:" + enemyId + ":" + initiatorId] = 1;
  }
  addRecentAction(world, initiatorId, enemyId, -20);
  endWar(world, war, "мирный договор (" + (initiator?.name ?? initiatorId) + " — " + (loser?.name ?? enemyId) + ")");
}

export function proposePeace(world: World, empireId: number, targetId: number): CommandResult {
  const war = warOf(world, empireId, targetId);
  if (!war) return deny("Вы не в состоянии войны с этой империей");
  if (!war.sides[empireId] || !war.sides[targetId]) return deny("Империя не участвует в этой войне");
  if (warSideOf(world, war.id, empireId) === warSideOf(world, war.id, targetId)) return deny("Это ваш союзник");
  const target = empireById(world, targetId);
  const initiator = empireById(world, empireId);
  if (!target || !initiator) return deny("Империя не найдена");
  const demands = demandsFor(world, war, empireId);
  war.pendingPeace = { byEmpireId: empireId, demands: demands.slice() };
  const scoreRu = "военный счёт " + (war.score[empireId] ?? 0);
  if (target.ai && !target.isPlayer) {
    if (aiAcceptsPeace(world, war, targetId, demands)) {
      applyPeace(world, war, empireId, demands);
      return ok("Мир заключён: " + target.name + " приняла условия");
    }
    // торг: противник готов принять требования на 20% меньше (GDD §12.9 п.2);
    // белый мир через торг не предлагаем — для него есть отдельная ветка
    const bargainCount = Math.floor(demands.length * 0.8);
    const bargain = demands.slice(0, bargainCount);
    if (demands.length > 1 && bargain.length > 0 && bargain.length < demands.length
      && aiAcceptsPeace(world, war, targetId, bargain)) {
      applyPeace(world, war, empireId, bargain);
      return ok("Мир заключён на торге: " + target.name + " приняла требования на 20% меньше");
    }
    war.exhaustion[targetId] = clamp((war.exhaustion[targetId] ?? 0) + 20, 0, 100);
    war.pendingPeace = null;
    logEvent(world, "diplomacy", "warn", target.name + " отклонила мирные требования (" + scoreRu + "), истощение +20.", undefined, initiator.isPlayer ? empireId : undefined);
    return deny(target.name + " отклонила мирные требования. Истощение цели +20");
  }
  // цель — игрок: предложение ждёт ответа (решение игрока — команда make_peace)
  logEvent(
    world, "diplomacy", "info",
    "Мирное предложение от " + initiator.name + " (" + scoreRu + (demands.length > 0 ? ", систем: " + demands.length : ", белый мир") + ").",
    undefined, world.playerEmpireId,
  );
  return ok("Мирное предложение отправлено (белый мир при истощении 100)");
}

// ------------------------------------------------------------------ фаза войны

function updateOccupation(world: World, war: War): void {
  const members = warMembers(world, war);
  const sideById: Record<number, number> = {};
  for (const empireId of members) sideById[empireId] = warSideOf(world, war.id, empireId);
  // присутствие флотов по системам (по одному проходу, детерминированно)
  const presence = new Map<number, number[]>();
  for (const fleet of world.fleets) {
    if (fleet.ships.length === 0) continue;
    const list = presence.get(fleet.systemId);
    if (!list) presence.set(fleet.systemId, [fleet.empireId]);
    else if (!list.includes(fleet.empireId)) list.push(fleet.empireId);
  }
  for (const system of world.systems) {
    const ownerId = system.ownerId;
    const ownerSide = sideById[ownerId];
    if (ownerSide === undefined) continue;
    const here = presence.get(system.id) ?? [];
    const ownerFleet = here.includes(ownerId);
    for (const occupierId of members) {
      const occupierSide = sideById[occupierId];
      if (occupierSide === undefined || occupierSide === ownerSide) continue;
      {
        const key = "occ:" + war.id + ":" + system.id + ":" + occupierId;
        const occupierFleet = here.includes(occupierId);
        if (!occupierFleet || ownerFleet) {
          world.flags[key] = 0;
          if (war.occupied[system.id] === occupierId) {
            delete war.occupied[system.id];
            const side = war.sides[occupierId];
            if (side) side.occupiedSystems = side.occupiedSystems.filter((id) => id !== system.id);
          }
          continue;
        }
        const progress = (world.flags[key] ?? 0) + 1;
        if (progress < OCCUPATION_TICKS) {
          world.flags[key] = progress;
          continue;
        }
        world.flags[key] = OCCUPATION_TICKS;
        if (war.occupied[system.id] !== occupierId) {
          war.occupied[system.id] = occupierId;
          const side = war.sides[occupierId];
          if (side && !side.occupiedSystems.includes(system.id)) {
            side.occupiedSystems.push(system.id);
            side.occupiedSystems.sort((a, b) => a - b);
          }
          logEvent(world, "diplomacy", "warn", "Система «" + system.name + "» оккупирована.", system.id, empireById(world, occupierId)?.isPlayer ? occupierId : undefined);
        }
      }
    }
  }
}

/** Военный счёт стороны по формуле GDD §12.7, clamp −100..100. */
export function warScoreOf(world: World, war: War, empireId: number): number {
  const mySide = war.sides[empireId];
  if (!mySide) return 0;
  const enemyId = enemyOf(world, war, empireId);
  const enemySide = war.sides[enemyId];
  if (!enemySide) return 0;
  let destroyed = 0;
  let lost = 0;
  for (const battle of world.battles) {
    if (battle.tick < war.startedTick) continue;
    const att = battle.attacker.empireId;
    const def = battle.defender.empireId;
    if (!war.sides[att] || !war.sides[def]) continue;
    if (warSideOf(world, war.id, att) === warSideOf(world, war.id, def)) continue;
    if (att === empireId) {
      destroyed += battle.defenderLossFp;
      lost += battle.attackerLossFp;
    } else if (def === empireId) {
      destroyed += battle.attackerLossFp;
      lost += battle.defenderLossFp;
    }
  }
  mySide.fpLost = lost;
  const enemySystems = world.systems.filter((s) => s.ownerId === enemyId);
  const occupiedCount = mySide.occupiedSystems.filter((id) => world.systems[id]?.ownerId === enemyId).length;
  let tradeNodes = 0;
  let blockades = 0;
  for (const system of enemySystems) {
    if (!system.station) continue;
    tradeNodes += 1;
    const ourFleet = world.fleets.some((f) => f.empireId === empireId && f.systemId === system.id && f.ships.length > 0);
    const theirFleet = world.fleets.some((f) => f.empireId === enemyId && f.systemId === system.id && f.ships.length > 0);
    if (ourFleet && !theirFleet) blockades += 1;
  }
  const enemyStart = Math.max(1, enemySide.fpStart);
  const ownStart = Math.max(1, mySide.fpStart);
  let score = 0.5 * (destroyed / enemyStart) * 100
    + 0.3 * (occupiedCount / Math.max(1, enemySystems.length)) * 100
    + 0.2 * (blockades / Math.max(1, tradeNodes)) * 100
    - 0.4 * (lost / ownStart) * 100;
  if (warSideOf(world, war.id, empireId) === 1) {
    score *= CB_SCORE_MULT[war.cb] ?? 1;
    // «Запрет агрессии»: −50% военного счёта агрессору (значение из данных)
    if (councilPassed(world, "ban_aggression")) {
      score *= 1 + (resolutionEffectValue(world, "ban_aggression", "aggressor_war_score") ?? -0.5);
    }
  }
  return clamp(Math.round(score), -100, 100);
}

function stabilityAverage(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire || empire.colonies.length === 0) return 50;
  let sum = 0;
  let count = 0;
  for (const colonyId of empire.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (!colony) continue;
    sum += colony.stability;
    count += 1;
  }
  return count > 0 ? sum / count : 50;
}

/** Истощение по формуле GDD §12.8, clamp 0..100. */
export function exhaustionOf(world: World, war: War, empireId: number): number {
  const side = war.sides[empireId];
  if (!side) return 0;
  const ticksWar = Math.max(0, world.tick - war.startedTick);
  const lossesRatio = side.fpLost / Math.max(1, side.fpStart);
  const stability = stabilityAverage(world, empireId);
  const value = 0.4 * (ticksWar / 10) + 0.3 * lossesRatio * 100 + 0.2 * (100 - stability);
  return clamp(Math.round(value * 10) / 10, 0, 100);
}

function updateExhaustion(world: World, war: War): void {
  for (const empireId of warMembers(world, war)) {
    war.exhaustion[empireId] = exhaustionOf(world, war, empireId);
  }
}

/** Истощение режет производство: 20 → −5%, 40 → −10%, 60+ → −15% (GDD §12.8). */
function exhaustionProductionPermille(exhaustion: number): number {
  if (exhaustion >= 60) return 150;
  if (exhaustion >= 40) return 100;
  if (exhaustion >= 20) return 50;
  return 0;
}

function drainIncome(empire: Empire, permille: number): void {
  if (permille <= 0) return;
  for (const res of PRODUCTION_RESOURCES) {
    const income = empire.incomeLastTick[res];
    if (income <= 0) continue;
    const cut = Math.floor((income * permille) / 1000);
    if (cut <= 0) continue;
    empire.resources[res] = Math.max(0, empire.resources[res] - cut);
  }
}

function applyWarEconomy(world: World, war: War): void {
  for (const empireId of warMembers(world, war)) {
    const empire = empireById(world, empireId);
    if (!empire) continue;
    drainIncome(empire, exhaustionProductionPermille(war.exhaustion[empireId] ?? 0));
  }
  // оккупация: 50% дохода колоний оккупированной системы → оккупанту (GDD §12.10)
  for (const key of Object.keys(war.occupied).sort((a, b) => Number(a) - Number(b))) {
    const systemId = Number(key);
    const occupierId = war.occupied[systemId];
    const system = world.systems[systemId];
    if (!system) continue;
    const ownerId = system.ownerId;
    if (ownerId === occupierId) {
      delete war.occupied[systemId];
      continue;
    }
    const occupier = empireById(world, occupierId);
    const owner = empireById(world, ownerId);
    if (!occupier || !owner) continue;
    for (const planet of system.planets) {
      if (!planet.colonyId) continue;
      const colony = world.colonies.find((c) => c.id === planet.colonyId);
      if (!colony || colony.empireId !== ownerId) continue;
      for (const res of PRODUCTION_RESOURCES) {
        const perTick = Math.floor(colony.output[res] / 1000);
        const cut = Math.floor(perTick / 2);
        if (cut <= 0) continue;
        const real = Math.min(cut, owner.resources[res]);
        if (real <= 0) continue;
        owner.resources[res] -= real;
        occupier.resources[res] += real;
      }
    }
  }
}

function forcedPeaceCheck(world: World, war: War): void {
  // резолюция совета «принудительный мир»: войны прекращаются через N тактов (GDD §12.4)
  const since = councilForcedPeaceSince(world);
  const peaceTicks = resolutionEffectValue(world, "forced_peace", "forced_peace_ticks") ?? FORCED_PEACE_TICKS;
  if (since >= 0 && world.tick >= since + peaceTicks) {
    endWar(world, war, "принудительный мир по резолюции совета");
    return;
  }
  for (const empireId of warMembers(world, war)) {
    const exhaustion = war.exhaustion[empireId] ?? 0;
    if (exhaustion >= 100) {
      endWar(world, war, "истощение 100 — белый мир");
      return;
    }
    const key = "fpeace:" + war.id + ":" + empireId;
    if (exhaustion >= 80) {
      const counter = (world.flags[key] ?? 0) + 1;
      world.flags[key] = counter;
      if (counter >= FORCED_PEACE_TICKS) {
        endWar(world, war, "принудительный мир при истощении 80");
        return;
      }
    } else if (world.flags[key]) {
      world.flags[key] = 0;
    }
  }
}

function aiPeaceCheck(world: World, war: War): void {
  for (const empireId of warMembers(world, war)) {
    const empire = empireById(world, empireId);
    if (!empire || empire.isPlayer || !empire.ai) continue;
    const exhaustion = war.exhaustion[empireId] ?? 0;
    if (exhaustion < 60) continue;
    const enemyId = enemyOf(world, war, empireId);
    if (enemyId === 0) continue;
    const key = "peaceoffer:" + war.id + ":" + empireId;
    if ((world.flags[key] ?? 0) + 50 > world.tick) continue;
    world.flags[key] = world.tick;
    proposePeace(world, empireId, enemyId);
    if (!ensureFg(world).wars.includes(war)) return;
  }
}

export function warPhase(world: World): void {
  // разведка флотов: видимость по данным шпионажа (после фазы флотов)
  applyIntelVisibility(world);
  const fg = ensureFg(world);
  const wars = fg.wars.slice().sort((a, b) => a.id - b.id);
  for (const war of wars) {
    if (!fg.wars.includes(war)) continue;
    let broken = false;
    for (const empireId of warMembers(world, war)) {
      const empire = empireById(world, empireId);
      if (!empire || empire.dead) broken = true;
    }
    if (broken) {
      endWar(world, war, "империя пала");
      continue;
    }
    updateOccupation(world, war);
    for (const empireId of warMembers(world, war)) {
      war.score[empireId] = warScoreOf(world, war, empireId);
    }
    updateExhaustion(world, war);
    applyWarEconomy(world, war);
    forcedPeaceCheck(world, war);
    if (!fg.wars.includes(war)) continue;
    aiPeaceCheck(world, war);
  }
}

/**
 * Хук для economy/modifiers: множитель производства от истощения войны (GDD §12.8).
 * Сейчас warPhase списывает ресурсы напрямую; при подключении модификаторов
 * использовать этот множитель и убрать прямое списание в applyWarEconomy.
 */
export function warProductionMult(world: World, empireId: number): number {
  let worst = 0;
  for (const war of ensureFg(world).wars) {
    if (war.sides[empireId] === undefined) continue;
    worst = Math.max(worst, war.exhaustion[empireId] ?? 0);
  }
  return 1 - exhaustionProductionPermille(worst) / 1000;
}

/** Удобный доступ для UI: все войны империи. */
export function warsOf(world: World, empireId: number): War[] {
  return ensureFg(world).wars.filter((war) => war.sides[empireId] !== undefined).sort((a, b) => a.id - b.id);
}
