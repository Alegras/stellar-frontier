/**
 * ДИПЛОМАТИЯ (M7): мнение (с разбивкой), отношение, 8 договоров, предложения с истечением,
 * притязания на системы. GDD §12.1–12.2, §12.6.
 *
 * Числа формулы мнения — канон GDD §12.1. Таблицы стоимости договоров пока живут здесь
 * (в @sf/data нет соответствующих JSON — задача контент-команде); когда данные появятся,
 * их нужно читать через @sf/data.
 */
import { ETHICS } from "@sf/data";
import { clamp, empireById, logEvent } from "./economy";
import { empireModifiers } from "./modifiers";
import { getEmpireFleetPower } from "./queries";
import { gdpShares } from "./victory";
import { advancedOf, ensureFg, pushJournal, relationOf } from "./fullgame";
import type { Attitude, DiplomaticOffer, EmpireRelation, TreatyKind } from "./fullgame";
import type { CommandResult, World } from "./types";

const PIRATE_EMPIRE_ID = 9;

// ------------------------------------------------------------------ константы (GDD §12.1/12.2/12.6)

/** NAP: 200 тактов нельзя объявить войну (GDD §12.2). */
export const NAP_TICKS = 200;
/** Притязание стоит 25 влияния и сгорает через 120 тактов (GDD §12.6). */
export const CLAIM_COST = 25;
export const CLAIM_TTL = 120;
/** Срок жизни дипломатического предложения (канон не задаёт — 40 тактов). */
export const OFFER_TTL = 40;

/** Бонус мнения от активных договоров (GDD §12.1: NAP +10, торговля +15, иссл. +15, союз +30). */
export const TREATY_OPINION: Record<TreatyKind, number> = {
  nap: 10,
  trade: 15,
  research: 15,
  defensive: 20,
  alliance: 30,
  federation: 30,
  vassal: 10,
  tribute: 5,
};
export const TREATY_ORDER: TreatyKind[] = [
  "nap", "trade", "research", "defensive", "alliance", "federation", "vassal", "tribute",
];

/** Стоимость заключения договора (GDD §12.2). */
export const TREATY_COST: Record<TreatyKind, { influence: number; unity: number }> = {
  nap: { influence: 10, unity: 0 },
  trade: { influence: 15, unity: 0 },
  research: { influence: 25, unity: 0 },
  defensive: { influence: 40, unity: 100 },
  alliance: { influence: 60, unity: 200 },
  federation: { influence: 100, unity: 500 },
  vassal: { influence: 50, unity: 0 },
  tribute: { influence: 30, unity: 0 },
};

/** Штраф мнения за разрыв договора (GDD §12.2 «Разрыв»). */
export const TREATY_BREAK_OPINION: Record<TreatyKind, number> = {
  nap: -40,
  trade: -25,
  research: -30,
  defensive: -60,
  alliance: -80,
  federation: -100,
  vassal: -70,
  tribute: -50,
};

/** Минимальное мнение, при котором доступен договор (GDD §12.1, таблица отношений). */
export const TREATY_MIN_OPINION: Record<TreatyKind, number> = {
  nap: -10,
  trade: -10,
  research: -10,
  defensive: 10,
  alliance: 40,
  federation: 75,
  vassal: -100,
  tribute: -100,
};

/** Смещение базовой вероятности согласия ИИ по типу договора (GDD §12.2 даёт формулу для союза). */
const AI_ACCEPT_BIAS: Record<TreatyKind, number> = {
  nap: 0.2,
  trade: 0.15,
  research: 0.05,
  defensive: -0.1,
  alliance: -0.15,
  federation: -0.25,
  vassal: -0.35,
  tribute: -0.45,
};

// ------------------------------------------------------------------ этики

/** Оси этик: fallback, если контент-пакет ещё не заполнен. */
const FALLBACK_ETHICS_AXIS: Record<string, string> = {
  materialist: "mind",
  spiritualist: "mind",
  egalitarian: "authority",
  authoritarian: "authority",
  xenophile: "outlook",
  xenophobe: "outlook",
  militarist: "war",
  pacifist: "war",
};

/** Ось этики: из @sf/data (ETHICS), иначе — встроенный fallback. */
export function ethicsAxisOf(ethicId: string): string {
  const def = ETHICS.find((e) => e.id === ethicId);
  if (def) return def.axis;
  return FALLBACK_ETHICS_AXIS[ethicId] ?? "other:" + ethicId;
}

/** Совпадение этик: +10 за каждую общую, −15 за конфликт по оси (GDD §12.1). */
export function ethicsAffinity(world: World, a: number, b: number): number {
  const ethicsA = advancedOf(world, a).ethics;
  const ethicsB = advancedOf(world, b).ethics;
  let sum = 0;
  for (const ethic of ethicsA) {
    if (ethicsB.includes(ethic)) {
      sum += 10;
      continue;
    }
    const axis = ethicsAxisOf(ethic);
    let conflict = false;
    for (const other of ethicsB) {
      if (other !== ethic && ethicsAxisOf(other) === axis) {
        conflict = true;
        break;
      }
    }
    if (conflict) sum -= 15;
  }
  return sum;
}

/** Ксенофобия/ксенофилия партнёра: −20..+20 (GDD §12.1). */
export function xenophobiaMod(world: World, otherId: number): number {
  let mod = 0;
  for (const ethic of advancedOf(world, otherId).ethics) {
    if (ethic.includes("xenophobe")) mod -= 20;
    else if (ethic.includes("xenophile")) mod += 10;
  }
  return clamp(mod, -20, 20);
}

// ------------------------------------------------------------------ сила и границы

/** Приграничные системы пары (симметрично): −0.5 каждая, максимум −25 (GDD §12.1). */
export function borderSystems(world: World, a: number, b: number): number {
  let count = 0;
  for (const system of world.systems) {
    if (system.ownerId !== a) continue;
    for (const link of system.links) {
      if (world.systems[link]?.ownerId === b) {
        count += 1;
        break;
      }
    }
  }
  for (const system of world.systems) {
    if (system.ownerId !== b) continue;
    for (const link of system.links) {
      if (world.systems[link]?.ownerId === a) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** Относительная сила: −20 если мы сильнее на 50%+, +5 если слабее (GDD §12.1). */
export function relativePowerMod(world: World, a: number, b: number): number {
  const fpA = getEmpireFleetPower(world, a);
  const fpB = getEmpireFleetPower(world, b);
  if (fpA <= 0 && fpB <= 0) return 0;
  if (fpA >= fpB * 1.5) return -20;
  if (fpA <= fpB * 0.85) return 5;
  return 0;
}

/** Сколько взаимных притязаний у пары (GDD §12.1: −10 за каждое). */
export function claimsConflict(world: World, a: number, b: number): number {
  const claimsA = advancedOf(world, a).claims;
  const claimsB = advancedOf(world, b).claims;
  let count = 0;
  for (const systemId of claimsA) {
    const system = world.systems[systemId];
    if (!system) continue;
    if (system.ownerId === b || claimsB.includes(systemId)) count += 1;
  }
  for (const systemId of claimsB) {
    const system = world.systems[systemId];
    if (system && system.ownerId === a) count += 1;
  }
  return count;
}

// ------------------------------------------------------------------ войны (общие помощники)

export function warSideKey(warId: number, empireId: number): string {
  return "warside:" + warId + ":" + empireId;
}

/** 1 — сторона атакующего, 2 — сторона защитника, 0 — не участвует. */
export function warSideOf(world: World, warId: number, empireId: number): number {
  const side = world.flags[warSideKey(warId, empireId)];
  return typeof side === "number" ? side : 0;
}

export function setWarSide(world: World, warId: number, empireId: number, side: number): void {
  world.flags[warSideKey(warId, empireId)] = side;
}

/** Империи воюют друг с другом (участвуют в одной войне на разных сторонах). */
export function atWarWith(world: World, a: number, b: number): boolean {
  if (a === b) return false;
  const fg = ensureFg(world);
  for (const war of fg.wars) {
    const sideA = warSideOf(world, war.id, a);
    const sideB = warSideOf(world, war.id, b);
    if (sideA !== 0 && sideB !== 0 && sideA !== sideB) return true;
  }
  return false;
}

/** Перемирие после мирной конференции: 120 тактов нельзя объявить войну (GDD §12.9). */
export function truceKey(a: number, b: number): string {
  return a < b ? "truce:" + a + ":" + b : "truce:" + b + ":" + a;
}

export function truceUntil(world: World, a: number, b: number): number {
  return world.flags[truceKey(a, b)] ?? 0;
}

export function setTruce(world: World, a: number, b: number, ticks: number): void {
  world.flags[truceKey(a, b)] = world.tick + ticks;
}

// ------------------------------------------------------------------ договоры

export function treatyActive(world: World, a: number, b: number, kind: TreatyKind): boolean {
  const state = relationOf(world, a, b).treaties[kind];
  if (!state.active) return false;
  if (state.expiresTick > 0 && world.tick >= state.expiresTick) return false;
  return true;
}

export function treatySince(world: World, a: number, b: number, kind: TreatyKind): number {
  return relationOf(world, a, b).treaties[kind].sinceTick;
}

/** Маска старого Relation.treaty для совместимости со старым кодом (combat/economy/UI). */
export function mirrorTreaty(world: World, a: number, b: number): "none" | "nap" | "trade" | "alliance" | "war" {
  if (atWarWith(world, a, b)) return "war";
  if (treatyActive(world, a, b, "alliance")
    || treatyActive(world, a, b, "defensive")
    || treatyActive(world, a, b, "federation")) return "alliance";
  if (treatyActive(world, a, b, "nap")) return "nap";
  if (treatyActive(world, a, b, "trade")) return "trade";
  return "none";
}

function mirrorOldRelations(world: World, a: number, b: number): void {
  const rel = relationOf(world, a, b);
  const empireA = empireById(world, a);
  const empireB = empireById(world, b);
  const treaty = mirrorTreaty(world, a, b);
  if (empireA && empireA.relations[b]) {
    empireA.relations[b].opinion = rel.opinion;
    empireA.relations[b].treaty = treaty;
  }
  if (empireB && empireB.relations[a]) {
    empireB.relations[a].opinion = rel.opinion;
    empireB.relations[a].treaty = treaty;
  }
}

/** Пересчёт мнения и отношения пары по формуле §12.1. */
export function refreshOpinion(world: World, a: number, b: number): EmpireRelation {
  const rel = relationOf(world, a, b);
  rel.breakdown = opinionBreakdown(world, a, b);
  let total = 0;
  for (const line of rel.breakdown) total += line.value;
  rel.opinion = clamp(Math.round(total), -100, 100);
  rel.attitude = attitudeFor(rel.opinion);
  rel.borderSystems = borderSystems(world, a, b);
  mirrorOldRelations(world, a, b);
  return rel;
}

export function opinionOf(world: World, a: number, b: number): number {
  return relationOf(world, a, b).opinion;
}

/** Недавние действия (подарки/нарушения): временный сдвиг мнения, затухает на 1/такт. */
export function addRecentAction(world: World, a: number, b: number, delta: number): void {
  const rel = relationOf(world, a, b);
  rel.recentActions = clamp(rel.recentActions + delta, -100, 100);
  refreshOpinion(world, a, b);
}

// ------------------------------------------------------------------ мнение

export function attitudeFor(opinion: number): Attitude {
  if (opinion >= 75) return "ally";
  if (opinion >= 40) return "friendly";
  if (opinion >= 10) return "neutral";
  if (opinion >= -10) return "cold";
  if (opinion >= -40) return "hostile";
  return "rival";
}

export function opinionBreakdown(world: World, a: number, b: number): { label: string; value: number }[] {
  if (a === b || !empireById(world, a) || !empireById(world, b)) return [];
  const rel = relationOf(world, a, b);
  const lines: { label: string; value: number }[] = [];

  const ethics = ethicsAffinity(world, a, b);
  if (ethics !== 0) lines.push({ label: "Совпадение/конфликт этик", value: ethics });

  let treaties = 0;
  for (const kind of TREATY_ORDER) if (treatyActive(world, a, b, kind)) treaties += TREATY_OPINION[kind];
  if (treaties !== 0) lines.push({ label: "Договоры", value: treaties });

  const borders = borderSystems(world, a, b);
  if (borders > 0) {
    lines.push({ label: "Приграничные системы (" + borders + ")", value: -Math.min(25, borders * 0.5) });
  }

  const power = relativePowerMod(world, a, b);
  if (power !== 0) lines.push({ label: "Относительная сила", value: power });

  if (rel.recentActions !== 0) lines.push({ label: "Недавние действия", value: rel.recentActions });

  if (atWarWith(world, a, b)) lines.push({ label: "Война", value: -60 });

  const xeno = xenophobiaMod(world, b);
  if (xeno !== 0) lines.push({ label: "Ксенофобия/ксенофилия", value: xeno });

  const claims = claimsConflict(world, a, b);
  if (claims > 0) lines.push({ label: "Взаимные притязания (" + claims + ")", value: -10 * claims });

  // GDD §16.5/§19.6: коалиция против лидера — при доле ВВП >40% остальные получают −40 мнения.
  const shares = gdpShares(world);
  if (shares.leaderShare >= 0.4 && (a === shares.leaderId || b === shares.leaderId)) {
    lines.push({ label: "Коалиция против лидера (" + Math.round(shares.leaderShare * 100) + "% ВВП)", value: -40 });
  }

  return lines;
}

// ------------------------------------------------------------------ фаза дипломатии

function expireTreaty(world: World, a: number, b: number, kind: TreatyKind): void {
  const rel = relationOf(world, a, b);
  const state = rel.treaties[kind];
  if (!state.active) return;
  state.active = false;
  state.expiresTick = 0;
  if (kind === "tribute") {
    delete world.flags["tribute:" + a + ":" + b];
    delete world.flags["tribute:" + b + ":" + a];
  }
  if ((kind === "vassal" || kind === "federation") && world.tick > 0) {
    const advanced = advancedOf(world, a);
    advanced.vassals = advanced.vassals.filter((id) => id !== b);
    const advancedB = advancedOf(world, b);
    advancedB.vassals = advancedB.vassals.filter((id) => id !== a);
  }
  mirrorOldRelations(world, a, b);
  logEvent(world, "diplomacy", "info", "Договор (" + kind + ") истёк: " + a + " — " + b + ".", undefined, undefined);
}

/** Синхронизация зеркала pendingOffers в EmpireAdvanced (контракт fullgame.ts). */
function syncPendingOffers(world: World, fg: ReturnType<typeof ensureFg>): void {
  for (const empire of world.empires) {
    const advanced = advancedOf(world, empire.id);
    advanced.pendingOffers = fg.offers
      .filter((offer) => offer.toEmpireId === empire.id)
      .sort((x, y) => x.id - y.id);
  }
}

function removeOffer(world: World, offerId: number): void {
  const fg = ensureFg(world);
  const index = fg.offers.findIndex((offer) => offer.id === offerId);
  if (index >= 0) fg.offers.splice(index, 1);
}

/** 15% дохода вассала → сюзерену, 10% дани → получателю (GDD §12.2). */
function transferTributeIncome(world: World): void {
  const transfers: { from: number; to: number; rate: number }[] = [];
  const empires = world.empires.filter((e) => !e.dead && e.id !== PIRATE_EMPIRE_ID).sort((x, y) => x.id - y.id);
  for (const empire of empires) {
    for (const vassalId of advancedOf(world, empire.id).vassals.slice().sort((x, y) => x - y)) {
      if (vassalId === empire.id) continue;
      if (!empireById(world, vassalId)) continue;
      transfers.push({ from: vassalId, to: empire.id, rate: 15 });
    }
  }
  for (let i = 0; i < empires.length; i++) {
    for (let j = i + 1; j < empires.length; j++) {
      const a = empires[i].id;
      const b = empires[j].id;
      if (!treatyActive(world, a, b, "tribute")) continue;
      const flag = world.flags["tribute:" + a + ":" + b];
      if (flag === 1) transfers.push({ from: b, to: a, rate: 10 });
      else if (flag === 2) transfers.push({ from: a, to: b, rate: 10 });
    }
  }
  for (const transfer of transfers) {
    const from = empireById(world, transfer.from);
    const to = empireById(world, transfer.to);
    if (!from || !to) continue;
    for (const res of ["energy", "minerals", "alloys", "credits"] as const) {
      const income = from.incomeLastTick[res];
      if (income <= 0) continue;
      const cut = Math.floor((income * transfer.rate) / 100);
      if (cut <= 0) continue;
      const real = Math.min(cut, from.resources[res]);
      if (real <= 0) continue;
      from.resources[res] -= real;
      to.resources[res] += real;
    }
  }
}

/** Фаза дипломатии (каждый такт): мнения, отношения, истечение договоров/предложений/притязаний. */
export function diplomacyPhase(world: World): void {
  const fg = ensureFg(world);
  const empires = world.empires.filter((e) => !e.dead && e.id !== PIRATE_EMPIRE_ID).sort((x, y) => x.id - y.id);

  // 1. предложения с истечением
  for (const offer of fg.offers.slice().sort((x, y) => x.id - y.id)) {
    if (world.tick >= offer.expiresTick) removeOffer(world, offer.id);
  }

  // 2. договоры и затухание недавних действий
  for (let i = 0; i < empires.length; i++) {
    for (let j = i + 1; j < empires.length; j++) {
      const a = empires[i].id;
      const b = empires[j].id;
      const rel = relationOf(world, a, b);
      for (const kind of TREATY_ORDER) {
        const state = rel.treaties[kind];
        if (state.active && state.expiresTick > 0 && world.tick >= state.expiresTick) expireTreaty(world, a, b, kind);
      }
      if (rel.recentActions > 0) rel.recentActions = Math.max(0, rel.recentActions - 1);
      else if (rel.recentActions < 0) rel.recentActions = Math.min(0, rel.recentActions + 1);
    }
  }

  // 3. притязания: сгорают через 120 тактов
  for (const empire of empires) {
    const advanced = advancedOf(world, empire.id);
    if (advanced.claims.length === 0) continue;
    advanced.claims = advanced.claims.filter((systemId) => {
      const until = world.flags[claimKey(empire.id, systemId)];
      return typeof until === "number" && until > world.tick;
    });
  }

  // 4. мнение и отношение
  for (let i = 0; i < empires.length; i++) {
    for (let j = i + 1; j < empires.length; j++) refreshOpinion(world, empires[i].id, empires[j].id);
  }

  // 5. зеркало предложений в EmpireAdvanced
  syncPendingOffers(world, fg);

  // 6. дань/вассалитет: доля дохода сюзерену
  transferTributeIncome(world);

  // 7. эффекты договоров (GDD §12.2): торговый пакт +5% маржи, исследования +15% науки.
  // Прокси до подключения модификаторов в economy/market (см. отчёт Lead'у).
  for (const empire of empires) {
    if (!empire.dead) applyTreatyEconomy(world, empire);
  }
}

/** Экономические эффекты пактов: +5% маржи торговли и +15% науки (GDD §12.2). */
export const TRADE_PACT_CREDITS_BONUS = 0.05;
export const RESEARCH_PACT_SCIENCE_BONUS = 0.15;

function applyTreatyEconomy(world: World, empire: { id: number; resources: { credits: number }; incomeLastTick: { credits: number }; science: Record<string, number>; scienceLastTick: Record<string, number> }): void {
  let trade = false;
  let research = false;
  for (const other of world.empires) {
    if (other.dead || other.id === empire.id) continue;
    if (!trade && treatyActive(world, empire.id, other.id, "trade")) trade = true;
    if (!research && treatyActive(world, empire.id, other.id, "research")) research = true;
    if (trade && research) break;
  }
  if (trade && empire.incomeLastTick.credits > 0) {
    empire.resources.credits += Math.floor(empire.incomeLastTick.credits * TRADE_PACT_CREDITS_BONUS);
  }
  if (research) {
    for (const school of ["physics", "society", "engineering"] as const) {
      const gain = Math.floor((empire.scienceLastTick[school] ?? 0) * RESEARCH_PACT_SCIENCE_BONUS);
      if (gain > 0) empire.science[school] += gain;
    }
  }
}

// ------------------------------------------------------------------ притязания

export function claimKey(empireId: number, systemId: number): string {
  return "claim:" + empireId + ":" + systemId;
}

export function activeClaim(world: World, empireId: number, systemId: number): boolean {
  const until = world.flags[claimKey(empireId, systemId)];
  return typeof until === "number" && until > world.tick && advancedOf(world, empireId).claims.includes(systemId);
}

export function claimSystem(world: World, empireId: number, systemId: number): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire) return { ok: false, messageRu: "Империя не найдена" };
  if (empire.dead) return { ok: false, messageRu: "Империя погибла" };
  const system = world.systems[systemId];
  if (!system) return { ok: false, messageRu: "Система не найдена" };
  if (system.ownerId === empireId) return { ok: false, messageRu: "Система уже принадлежит вам" };
  if (activeClaim(world, empireId, systemId)) return { ok: false, messageRu: "Притязание уже заявлено" };
  const cost = Math.max(1, Math.round(CLAIM_COST * empireModifiers(world, empireId).claimCostMult));
  if (empire.resources.influence < cost) {
    return { ok: false, messageRu: "Нужно " + cost + " влияния для притязания" };
  }
  empire.resources.influence -= cost;
  const advanced = advancedOf(world, empireId);
  if (!advanced.claims.includes(systemId)) advanced.claims.push(systemId);
  advanced.claims.sort((x, y) => x - y);
  world.flags[claimKey(empireId, systemId)] = world.tick + CLAIM_TTL;
  if (system.ownerId !== 0) refreshOpinion(world, Math.min(empireId, system.ownerId), Math.max(empireId, system.ownerId));
  logEvent(
    world, "diplomacy", "info",
    empire.name + " заявила притязание на систему «" + system.name + "» (−" + cost + " влияния).",
    systemId, empire.isPlayer ? empireId : undefined,
  );
  pushJournal(ensureFg(world), world.tick, "claim", "Притязание: " + system.name);
  return { ok: true };
}

// ------------------------------------------------------------------ договоры: команды

function outcastCount(world: World, empireId: number): number {
  return world.flags["sanctions:count:" + empireId] ?? 0;
}

function treatyCostFor(world: World, a: number, b: number, treaty: TreatyKind): { influence: number; unity: number } {
  const base = TREATY_COST[treaty];
  const outcast = outcastCount(world, a) >= 3 || outcastCount(world, b) >= 3;
  const mult = outcast ? 1.5 : 1;
  return { influence: Math.ceil(base.influence * mult), unity: Math.ceil(base.unity * mult) };
}

function canPayTreaty(empire: { resources: { influence: number; unity: number } }, cost: { influence: number; unity: number }): boolean {
  return empire.resources.influence >= cost.influence && empire.resources.unity >= cost.unity;
}

function payTreaty(empire: { resources: { influence: number; unity: number } }, cost: { influence: number; unity: number }): void {
  empire.resources.influence -= cost.influence;
  empire.resources.unity -= cost.unity;
}

function refoundedTreatyCostText(cost: { influence: number; unity: number }): string {
  return cost.unity > 0 ? cost.influence + " влияния + " + cost.unity + " единства" : cost.influence + " влияния";
}

function commonThreat(world: World, a: number, b: number): boolean {
  for (const empire of world.empires) {
    if (empire.dead || empire.id === a || empire.id === b || empire.id === PIRATE_EMPIRE_ID) continue;
    if (atWarWith(world, a, empire.id) && atWarWith(world, b, empire.id)) return true;
  }
  return false;
}

/** Вероятность согласия ИИ на договор (GDD §12.2 + смещения по типу). */
export function aiAcceptChance(world: World, fromId: number, toId: number, treaty: TreatyKind): number {
  const rel = relationOf(world, fromId, toId);
  const fpFrom = getEmpireFleetPower(world, fromId);
  const fpTo = getEmpireFleetPower(world, toId);
  const relativePower = fpFrom / Math.max(1, fpTo);
  const threat = commonThreat(world, fromId, toId) ? 1 : 0;
  let chance = 0.5 + 0.01 * (rel.opinion - 50) - 0.3 * (relativePower - 1) + 0.2 * threat;
  chance += AI_ACCEPT_BIAS[treaty];
  return clamp(chance, 0, 0.95);
}

/** Детерминированный бросок принятия (не тратит world.rngState — статистика не сдвигает галактику). */
function aiAcceptRoll(world: World, fromId: number, toId: number, treaty: TreatyKind, chance: number): boolean {
  const kindIndex = TREATY_ORDER.indexOf(treaty);
  const roll = hashLike(world.seed, world.tick, fromId * 31 + toId, kindIndex) % 1000;
  return roll < Math.floor(chance * 1000);
}

function hashLike(seed: number, ...vals: number[]): number {
  let h = seed >>> 0;
  for (const v of vals) {
    h = (Math.imul(h ^ (v >>> 0), 0x01000193) + 0x811c9dc5) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** Активация договора после согласия (NAP живёт 200 тактов). */
export function activateTreaty(world: World, a: number, b: number, treaty: TreatyKind): void {
  const rel = relationOf(world, a, b);
  const sinceTick = world.tick;
  rel.treaties[treaty] = {
    active: true,
    sinceTick,
    expiresTick: treaty === "nap" ? sinceTick + NAP_TICKS : 0,
  };
  if (treaty === "defensive" || treaty === "alliance") {
    rel.callToArms = true;
  }
  if (treaty === "vassal") {
    const advanced = advancedOf(world, a);
    if (!advanced.vassals.includes(b)) advanced.vassals.push(b);
  }
  if (treaty === "tribute") {
    world.flags["tribute:" + b + ":" + a] = 1;
  }
  if (treaty === "alliance" || treaty === "federation") {
    world.flags["hist:alliances"] = (world.flags["hist:alliances"] ?? 0) + 1;
  }
  addRecentAction(world, a, b, 5);
  refreshOpinion(world, a, b);
  mirrorOldRelations(world, a, b);
  const empireA = empireById(world, a);
  const empireB = empireById(world, b);
  logEvent(
    world, "diplomacy", "good",
    "Договор заключён: " + (empireA?.name ?? a) + " и " + (empireB?.name ?? b) + " (" + treaty + ").",
    undefined, empireA?.isPlayer ? a : empireB?.isPlayer ? b : undefined,
  );
  pushJournal(ensureFg(world), world.tick, "treaty", "Договор (" + treaty + "): " + (empireA?.name ?? a) + " — " + (empireB?.name ?? b));
}

/** Расторжение договора с штрафом мнения (GDD §12.2). */
export function breakTreaty(world: World, a: number, b: number, treaty: TreatyKind, reasonRu?: string): void {
  const rel = relationOf(world, a, b);
  if (!rel.treaties[treaty].active) return;
  expireTreaty(world, a, b, treaty);
  addRecentAction(world, a, b, TREATY_BREAK_OPINION[treaty]);
  const empireA = empireById(world, a);
  const empireB = empireById(world, b);
  logEvent(
    world, "diplomacy", "bad",
    "Договор разорван: " + (empireA?.name ?? a) + " и " + (empireB?.name ?? b) + " (" + treaty + ")"
      + (reasonRu ? ": " + reasonRu : "") + ". Мнение " + TREATY_BREAK_OPINION[treaty] + ".",
    undefined, empireA?.isPlayer ? a : empireB?.isPlayer ? b : undefined,
  );
  pushJournal(ensureFg(world), world.tick, "treaty_break", "Разрыв договора (" + treaty + ")");
}

function offerTargetIsAi(world: World, targetId: number): boolean {
  const target = empireById(world, targetId);
  return target !== undefined && target.ai !== null && !target.isPlayer;
}

export function offerTreaty(world: World, empireId: number, targetId: number, treaty: TreatyKind): CommandResult {
  const from = empireById(world, empireId);
  const to = empireById(world, targetId);
  if (!from || !to || from.id === to.id) return { ok: false, messageRu: "Некорректная цель" };
  if (from.dead || to.dead) return { ok: false, messageRu: "Империя недоступна для переговоров" };
  if (targetId === PIRATE_EMPIRE_ID || empireId === PIRATE_EMPIRE_ID) {
    return { ok: false, messageRu: "Пираты не ведут переговоров" };
  }
  if (treaty === "federation") {
    return { ok: false, messageRu: "Для федерации используйте приглашение (federation_invite)" };
  }
  if (atWarWith(world, empireId, targetId)) return { ok: false, messageRu: "Идёт война: сначала заключите мир" };
  const rel = relationOf(world, empireId, targetId);
  if (rel.treaties[treaty].active) return { ok: false, messageRu: "Договор уже действует" };
  if (rel.opinion < TREATY_MIN_OPINION[treaty]) {
    return {
      ok: false,
      messageRu: "Отношение слишком плохое для этого договора (мнение " + rel.opinion + ", нужно "
        + TREATY_MIN_OPINION[treaty] + ")",
    };
  }
  if (treaty === "vassal" || treaty === "tribute") {
    const myFp = getEmpireFleetPower(world, empireId);
    const targetFp = getEmpireFleetPower(world, targetId);
    if (myFp < targetFp * 1.25) return { ok: false, messageRu: "Для вассалитета/дани нужно военное превосходство" };
  }
  const cost = treatyCostFor(world, empireId, targetId, treaty);
  if (!canPayTreaty(from, cost)) {
    return { ok: false, messageRu: "Нужно " + refoundedTreatyCostText(cost) };
  }
  payTreaty(from, cost);
  const fg = ensureFg(world);
  const offer = {
    id: fg.nextOfferId++,
    fromEmpireId: empireId,
    toEmpireId: targetId,
    treaty,
    createdTick: world.tick,
    expiresTick: world.tick + OFFER_TTL,
  };
  fg.offers.push(offer);
  fg.offers.sort((x, y) => x.id - y.id);
  syncPendingOffers(world, fg);
  logEvent(
    world, "diplomacy", "info",
    from.name + " предлагает " + to.name + " договор (" + treaty + "), цена: " + refoundedTreatyCostText(cost) + ".",
    undefined, from.isPlayer ? empireId : to.isPlayer ? targetId : undefined,
  );
  // ИИ отвечает сразу (детерминированно); игрок отвечает через respondTreaty.
  if (offerTargetIsAi(world, targetId)) {
    const chance = aiAcceptChance(world, empireId, targetId, treaty);
    if (aiAcceptRoll(world, empireId, targetId, treaty, chance)) {
      removeOffer(world, offer.id);
      activateTreaty(world, empireId, targetId, treaty);
      syncPendingOffers(world, fg);
      return { ok: true, messageRu: to.name + " приняла договор (" + treaty + ")" };
    }
    removeOffer(world, offer.id);
    syncPendingOffers(world, fg);
    addRecentAction(world, targetId, empireId, -3);
    return { ok: false, messageRu: to.name + " отклонила договор (" + treaty + "), шанс был " + Math.round(chance * 100) + "%" };
  }
  return { ok: true, messageRu: "Предложение отправлено: " + to.name + " (" + treaty + ")" };
}

export function respondTreaty(world: World, empireId: number, offerId: number, accept: boolean): CommandResult {
  const fg = ensureFg(world);
  const offer = fg.offers.find((item) => item.id === offerId);
  if (!offer) return { ok: false, messageRu: "Предложение не найдено" };
  if (offer.toEmpireId !== empireId) return { ok: false, messageRu: "Это предложение адресовано другой империи" };
  if (world.tick >= offer.expiresTick) {
    removeOffer(world, offerId);
    syncPendingOffers(world, fg);
    return { ok: false, messageRu: "Срок предложения истёк" };
  }
  if (!accept) {
    removeOffer(world, offerId);
    syncPendingOffers(world, fg);
    addRecentAction(world, offer.fromEmpireId, empireId, -2);
    return { ok: true, messageRu: "Предложение отклонено" };
  }
  if (atWarWith(world, offer.fromEmpireId, empireId)) {
    removeOffer(world, offerId);
    syncPendingOffers(world, fg);
    return { ok: false, messageRu: "Идёт война: договор невозможен" };
  }
  removeOffer(world, offerId);
  activateTreaty(world, offer.fromEmpireId, empireId, offer.treaty);
  syncPendingOffers(world, fg);
  return { ok: true, messageRu: "Договор заключён (" + offer.treaty + ")" };
}

/** Опрос предложений для UI/ИИ. */
export function pendingOffersFor(world: World, empireId: number): DiplomaticOffer[] {
  return ensureFg(world).offers.filter((offer) => offer.toEmpireId === empireId).sort((x, y) => x.id - y.id);
}

/** Хуки для economy/market: множители от пактов (GDD §12.2). Прокси-начисления — в diplomacyPhase. */
export function treatyScienceMult(world: World, empireId: number): number {
  for (const other of world.empires) {
    if (other.dead || other.id === empireId) continue;
    if (treatyActive(world, empireId, other.id, "research")) return 1 + RESEARCH_PACT_SCIENCE_BONUS;
  }
  return 1;
}

export function treatyTradeMargin(world: World, empireId: number): number {
  for (const other of world.empires) {
    if (other.dead || other.id === empireId) continue;
    if (treatyActive(world, empireId, other.id, "trade")) return TRADE_PACT_CREDITS_BONUS;
  }
  return 0;
}

/** Суммарный вес «мягкой» дипломатии для UI: сколько договоров активно. */
export function activeTreatyCount(world: World, a: number, b: number): number {
  let count = 0;
  for (const kind of TREATY_ORDER) if (treatyActive(world, a, b, kind)) count += 1;
  return count;
}
