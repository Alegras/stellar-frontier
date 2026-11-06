/**
 * ФЕДЕРАЦИИ (M7): создание (лидер + приглашения), 2–5 членов, председатель каждые 300,
 * общий флот 20% (лимит 300 FP), взносы 5% каждые 100 тактов, распад. GDD §12.3.
 */
import { clamp, empireById, logEvent } from "./economy";
import { getEmpireFleetPower } from "./queries";
import { hash32 } from "./prng";
import {
  activateTreaty, aiAcceptChance, atWarWith, opinionOf, refreshOpinion, treatyActive,
} from "./diplomacy";
import { ensureFg, pushJournal } from "./fullgame";
import type { Federation } from "./fullgame";
import type { CommandResult, World } from "./types";

const PIRATE_EMPIRE_ID = 9;

/** Состав федерации (GDD §12.3). */
export const FEDERATION_MIN_MEMBERS = 2;
export const FEDERATION_MAX_MEMBERS = 5;
/** Ротация председателя каждые 300 тактов (GDD §12.3). */
export const CHAIR_PERIOD = 300;
/** Взносы 5% энергии и сплавов каждые 100 тактов (GDD §12.3). */
export const CONTRIBUTION_PERIOD = 100;
export const CONTRIBUTION_RATE = 5;
/** Общий флот: 20% флотов участников, лимит 300 FP (GDD §12.3). */
export const GENERAL_FLEET_SHARE = 0.2;
export const GENERAL_FLEET_CAP = 300;
/** Стоимость создания/вступления (GDD §12.2: федерация — 100 влияния + 500 единства). */
export const FEDERATION_COST = { influence: 100, unity: 500 };
/** Срок жизни приглашения. */
export const FEDERATION_INVITE_TTL = 60;
/** Минимальное мнение для приглашения (GDD §12.1: союзники). */
export const FEDERATION_MIN_OPINION = 40;
/** Распад при мнении ниже −50 (GDD §12.3). */
export const FEDERATION_BREAK_OPINION = -50;

function deny(messageRu: string): CommandResult {
  return { ok: false, messageRu };
}

export function federationOf(world: World, empireId: number): Federation | undefined {
  return ensureFg(world).federations.find((federation) => federation.members.includes(empireId));
}

function inviteKey(leaderId: number, targetId: number): string {
  return "fedinv:" + leaderId + ":" + targetId;
}

function inviteUntil(world: World, leaderId: number, targetId: number): number {
  return world.flags[inviteKey(leaderId, targetId)] ?? 0;
}

function factionName(empire: { name: string }): string {
  return "Федерация «" + empire.name + "»";
}

/** Общий (федеративный) флот: 20% суммы флотов участников, но не более 300 FP. */
export function federationFleetPower(world: World, federation: Federation): number {
  let total = 0;
  for (const memberId of federation.members) total += getEmpireFleetPower(world, memberId);
  return Math.min(GENERAL_FLEET_CAP, Math.floor(total * GENERAL_FLEET_SHARE));
}

function computeFederalFleetIds(world: World, federation: Federation): number[] {
  const budget = federationFleetPower(world, federation);
  if (budget <= 0) return [];
  const fleets = world.fleets
    .filter((fleet) => federation.members.includes(fleet.empireId) && fleet.ships.length > 0)
    .sort((a, b) => a.id - b.id);
  const ids: number[] = [];
  let fp = 0;
  for (const fleet of fleets) {
    if (fp >= budget) break;
    for (const ship of fleet.ships) fp += ship.fleetPower;
    ids.push(fleet.id);
  }
  return ids;
}

function payFederationCost(world: World, empireId: number): boolean {
  const empire = empireById(world, empireId);
  if (!empire) return false;
  const outcast = (world.flags["sanctions:count:" + empireId] ?? 0) >= 3;
  const mult = outcast ? 1.5 : 1;
  const influence = Math.ceil(FEDERATION_COST.influence * mult);
  const unity = Math.ceil(FEDERATION_COST.unity * mult);
  if (empire.resources.influence < influence || empire.resources.unity < unity) return false;
  empire.resources.influence -= influence;
  empire.resources.unity -= unity;
  return true;
}

function canPayFederation(world: World, empireId: number): boolean {
  const empire = empireById(world, empireId);
  if (!empire) return false;
  const outcast = (world.flags["sanctions:count:" + empireId] ?? 0) >= 3;
  const mult = outcast ? 1.5 : 1;
  return empire.resources.influence >= Math.ceil(FEDERATION_COST.influence * mult)
    && empire.resources.unity >= Math.ceil(FEDERATION_COST.unity * mult);
}

function addMember(world: World, federation: Federation, empireId: number): void {
  if (federation.members.includes(empireId)) return;
  federation.members.push(empireId);
  federation.members.sort((a, b) => a - b);
  federation.votes[empireId] = 0;
  // двусторонний договор федерации со всеми членами
  for (const memberId of federation.members) {
    if (memberId === empireId) continue;
    activateTreaty(world, empireId, memberId, "federation");
    refreshOpinion(world, Math.min(empireId, memberId), Math.max(empireId, memberId));
  }
  const empire = empireById(world, empireId);
  logEvent(
    world, "diplomacy", "good",
    (empire?.name ?? "Империя " + empireId) + " вступает в " + federation.nameRu + ".",
    undefined, empire?.isPlayer ? empireId : undefined,
  );
  pushJournal(ensureFg(world), world.tick, "federation", federation.nameRu + ": принят участник " + (empire?.name ?? empireId));
}

function dissolveFederation(world: World, federation: Federation, reasonRu: string): void {
  const fg = ensureFg(world);
  const index = fg.federations.findIndex((item) => item.id === federation.id);
  if (index < 0) return;
  fg.federations.splice(index, 1);
  const members = federation.members.slice().sort((a, b) => a - b);
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      const rel = relationState(world, a, b);
      if (rel) rel.active = false;
      refreshOpinion(world, Math.min(a, b), Math.max(a, b));
    }
  }
  logEvent(world, "diplomacy", "warn", federation.nameRu + " распущена: " + reasonRu + ".", undefined, undefined);
  pushJournal(fg, world.tick, "federation", "Распад: " + federation.nameRu + " (" + reasonRu + ")");
}

function relationState(world: World, a: number, b: number) {
  const fg = ensureFg(world);
  const key = a < b ? a + ":" + b : b + ":" + a;
  return fg.relations[key]?.treaties.federation;
}

function rejectInvite(world: World, leaderId: number, targetId: number): void {
  delete world.flags[inviteKey(leaderId, targetId)];
}

export function inviteFederation(world: World, empireId: number, targetId: number): CommandResult {
  const founder = empireById(world, empireId);
  const target = empireById(world, targetId);
  if (!founder || !target || empireId === targetId) return deny("Некорректная цель");
  if (founder.dead || target.dead) return deny("Империя недоступна");
  if (empireId === PIRATE_EMPIRE_ID || targetId === PIRATE_EMPIRE_ID) return deny("Пираты не вступают в федерации");
  if (atWarWith(world, empireId, targetId)) return deny("Идёт война: федерация невозможна");
  const targetFed = federationOf(world, targetId);
  if (targetFed) return deny(target.name + " уже входит в " + targetFed.nameRu);
  let federation = federationOf(world, empireId);
  if (federation) {
    if (federation.presidentId !== empireId) return deny("Приглашать может только председатель федерации");
    if (federation.members.length >= FEDERATION_MAX_MEMBERS) return deny("В федерации уже 5 участников");
  } else {
    if (opinionOf(world, empireId, targetId) < FEDERATION_MIN_OPINION) {
      return deny("Нужно мнение ≥ " + FEDERATION_MIN_OPINION + " для приглашения в федерацию");
    }
    if (!canPayFederation(world, empireId)) {
      return deny("Нужно " + FEDERATION_COST.influence + " влияния и " + FEDERATION_COST.unity + " единства");
    }
    payFederationCost(world, empireId);
    const fg = ensureFg(world);
    federation = {
      id: fg.nextFederationId++,
      nameRu: factionName(founder),
      members: [empireId],
      presidentId: empireId,
      foundedTick: world.tick,
      treasuryEnergy: 0,
      treasuryAlloys: 0,
      fleetIds: [],
      nextChairTick: world.tick + CHAIR_PERIOD,
      votes: { [empireId]: 0 },
    };
    fg.federations.push(federation);
    fg.federations.sort((a, b) => a.id - b.id);
    logEvent(world, "diplomacy", "good", federation.nameRu + " основана (" + founder.name + ").", undefined, founder.isPlayer ? empireId : undefined);
    pushJournal(fg, world.tick, "federation", "Основана " + federation.nameRu);
  }
  if (opinionOf(world, empireId, targetId) < FEDERATION_MIN_OPINION) {
    return deny("Отношение слишком холодное для федерации (нужно мнение ≥ " + FEDERATION_MIN_OPINION + ")");
  }
  world.flags[inviteKey(empireId, targetId)] = world.tick + FEDERATION_INVITE_TTL;
  if (target.ai && !target.isPlayer) {
    if (!canPayFederation(world, targetId)) return deny(target.name + " не может оплатить вступление");
    const chance = clamp(aiAcceptChance(world, empireId, targetId, "federation") + 0.1, 0, 0.95);
    const roll = hash32(world.seed, world.tick, empireId * 101 + targetId, 7) % 1000;
    if (roll < Math.floor(chance * 1000)) {
      payFederationCost(world, targetId);
      rejectInvite(world, empireId, targetId);
      addMember(world, federation!, targetId);
      return { ok: true, messageRu: target.name + " приняла приглашение в " + federation!.nameRu };
    }
    rejectInvite(world, empireId, targetId);
    return { ok: false, messageRu: target.name + " отклонила приглашение в федерацию" };
  }
  return { ok: true, messageRu: "Приглашение в " + federation!.nameRu + " отправлено: " + target.name };
}

export function acceptFederation(world: World, empireId: number, leaderId: number): CommandResult {
  const empire = empireById(world, empireId);
  const leader = empireById(world, leaderId);
  if (!empire || !leader || empireId === leaderId) return deny("Некорректная цель");
  if (empire.dead) return deny("Империя погибла");
  if (federationOf(world, empireId)) return deny("Вы уже входите в федерацию");
  const federation = ensureFg(world).federations.find((item) => item.presidentId === leaderId);
  if (!federation) return deny("Федерация не найдена");
  if (federation.members.length >= FEDERATION_MAX_MEMBERS) return deny("В федерации уже 5 участников");
  if (inviteUntil(world, leaderId, empireId) <= world.tick) return deny("Приглашение истекло или не было отправлено");
  if (atWarWith(world, empireId, leaderId)) return deny("Идёт война: федерация невозможна");
  if (!canPayFederation(world, empireId)) {
    return deny("Нужно " + FEDERATION_COST.influence + " влияния и " + FEDERATION_COST.unity + " единства");
  }
  payFederationCost(world, empireId);
  rejectInvite(world, leaderId, empireId);
  addMember(world, federation, empireId);
  return { ok: true, messageRu: "Вы вступили в " + federation.nameRu };
}

export function leaveFederation(world: World, empireId: number): CommandResult {
  const federation = federationOf(world, empireId);
  if (!federation) return deny("Вы не входите в федерацию");
  const empire = empireById(world, empireId);
  federation.members = federation.members.filter((id) => id !== empireId);
  delete federation.votes[empireId];
  if (federation.presidentId === empireId) {
    federation.presidentId = federation.members.slice().sort((a, b) => a - b)[0] ?? 0;
  }
  for (const memberId of federation.members) {
    const rel = relationState(world, empireId, memberId);
    if (rel) rel.active = false;
    refreshOpinion(world, Math.min(empireId, memberId), Math.max(empireId, memberId));
  }
  if (federation.members.length < FEDERATION_MIN_MEMBERS) {
    dissolveFederation(world, federation, "осталось меньше 2 участников");
  } else {
    logEvent(
      world, "diplomacy", "warn",
      (empire?.name ?? "Империя " + empireId) + " покидает " + federation.nameRu + ".",
      undefined, empire?.isPlayer ? empireId : undefined,
    );
    pushJournal(ensureFg(world), world.tick, "federation", "Выход из " + federation.nameRu + ": " + (empire?.name ?? empireId));
  }
  return { ok: true, messageRu: "Вы покинули федерацию" };
}

/** Фаза федераций: председатель, взносы, общий флот, распад (GDD §12.3). */
export function federationPhase(world: World): void {
  const fg = ensureFg(world);
  for (const federation of fg.federations.slice().sort((a, b) => a.id - b.id)) {
    if (!fg.federations.includes(federation)) continue;
    federation.members = federation.members.filter((id) => {
      const empire = empireById(world, id);
      return empire !== undefined && !empire.dead;
    });
    // распад: меньше 2 участников
    if (federation.members.length < FEDERATION_MIN_MEMBERS) {
      dissolveFederation(world, federation, "меньше 2 участников");
      continue;
    }
    // выход при мнении ниже −50 с председателем
    for (const memberId of federation.members.slice()) {
      if (memberId === federation.presidentId) continue;
      if (opinionOf(world, memberId, federation.presidentId) < FEDERATION_BREAK_OPINION) {
        federation.members = federation.members.filter((id) => id !== memberId);
        delete federation.votes[memberId];
        const rel = relationState(world, memberId, federation.presidentId);
        if (rel) rel.active = false;
        refreshOpinion(world, Math.min(memberId, federation.presidentId), Math.max(memberId, federation.presidentId));
        logEvent(world, "diplomacy", "warn", "Участник покинул " + federation.nameRu + " (мнение ниже −50).", undefined, undefined);
      }
    }
    if (federation.members.length < FEDERATION_MIN_MEMBERS) {
      dissolveFederation(world, federation, "распад по мнению");
      continue;
    }
    // ротация председателя каждые 300 тактов: сильнейший по FP, тай-брейк по id
    if (world.tick >= federation.nextChairTick) {
      let best = federation.members[0];
      let bestFp = -1;
      for (const memberId of federation.members.slice().sort((a, b) => a - b)) {
        const fp = getEmpireFleetPower(world, memberId);
        if (fp > bestFp) {
          bestFp = fp;
          best = memberId;
        }
      }
      if (best !== federation.presidentId) {
        const old = empireById(world, federation.presidentId);
        const next = empireById(world, best);
        federation.presidentId = best;
        logEvent(
          world, "diplomacy", "info",
          federation.nameRu + ": председатель — " + (next?.name ?? best) + " (был " + (old?.name ?? "—") + ").",
          undefined, next?.isPlayer ? best : undefined,
        );
      }
      federation.nextChairTick = world.tick + CHAIR_PERIOD;
      federation.votes = {};
    }
    // взносы 5% каждые 100 тактов
    if (world.tick > 0 && world.tick % CONTRIBUTION_PERIOD === 0) {
      for (const memberId of federation.members) {
        const member = empireById(world, memberId);
        if (!member) continue;
        const energy = Math.floor((member.resources.energy * CONTRIBUTION_RATE) / 100);
        const alloys = Math.floor((member.resources.alloys * CONTRIBUTION_RATE) / 100);
        if (energy > 0) {
          member.resources.energy -= energy;
          federation.treasuryEnergy += energy;
        }
        if (alloys > 0) {
          member.resources.alloys -= alloys;
          federation.treasuryAlloys += alloys;
        }
      }
    }
    // общий флот: 20% флотов участников, лимит 300 FP
    federation.fleetIds = computeFederalFleetIds(world, federation);
    // флаг победы «федерация» ведёт victory.ts; здесь только доля систем союза
    let systems = 0;
    for (const memberId of federation.members) systems += empireById(world, memberId)?.systems.length ?? 0;
    world.flags["fed:systems:" + federation.id] = systems;
  }
}

/** Все федерации, где участник — эта империя (для условий победы/UI). */
export function federationsWith(world: World, empireId: number): Federation[] {
  return ensureFg(world).federations.filter((federation) => federation.members.includes(empireId));
}

/** Состоят ли империи в одной федерации. */
export function inSameFederation(world: World, a: number, b: number): boolean {
  return ensureFg(world).federations.some((federation) => federation.members.includes(a) && federation.members.includes(b));
}

/** Договор «федерация» активен для пары (для тултипов/совета). */
export function federationTreatyActive(world: World, a: number, b: number): boolean {
  return treatyActive(world, a, b, "federation") && inSameFederation(world, a, b);
}

/** Сохранённый лидер федерации (для ИИ-решений). */
export function federationLeader(world: World, empireId: number): number {
  const federation = federationOf(world, empireId);
  return federation ? federation.presidentId : 0;
}

/** Участники федерации, кроме самой империи (детерминированный порядок по id). */
export function federationAllies(world: World, empireId: number): number[] {
  const federation = federationOf(world, empireId);
  if (!federation) return [];
  return federation.members.filter((id) => id !== empireId).sort((a, b) => a - b);
}

/** Общий вклад: сколько всего ресурсов участники отдали в казну федерации. */
export function federationTreasury(world: World, federationId: number): { energy: number; alloys: number } {
  const federation = ensureFg(world).federations.find((item) => item.id === federationId);
  return federation ? { energy: federation.treasuryEnergy, alloys: federation.treasuryAlloys } : { energy: 0, alloys: 0 };
}

/** Счётчик участников федерации (для UI). */
export function federationSize(world: World, empireId: number): number {
  return federationOf(world, empireId)?.members.length ?? 0;
}

/** Голос председателя в совете: бонус федерации (GDD §12.4 — вес голоса). */
export function federationCouncilBonus(world: World, empireId: number): number {
  const federation = federationOf(world, empireId);
  if (!federation) return 0;
  return federation.presidentId === empireId ? 0.25 : 0.15;
}

/** Диагностика для ИИ: сколько приглашений ждёт ответа. */
export function pendingFederationInvites(world: World, empireId: number): number[] {
  const fg = ensureFg(world);
  const leaders: number[] = [];
  for (const federation of fg.federations) {
    if (federation.members.includes(empireId)) continue;
    if (inviteUntil(world, federation.presidentId, empireId) > world.tick) leaders.push(federation.presidentId);
  }
  return leaders.sort((a, b) => a - b);
}
