/**
 * ГАЛАКТИЧЕСКИЙ СОВЕТ (M7): 8 резолюций, веса голосов, сессии каждые 300 тактов,
 * вето (1/300 тактов, −15 мнения всем), санкции/изгой, эффекты через доход/модификаторы.
 * GDD §12.4.
 */
import { COUNCIL_RESOLUTIONS } from "@sf/data";
import { empireById, logEvent, popsTotal } from "./economy";
import { getEmpireFleetPower, getFleetCap } from "./queries";
import { addRecentAction, opinionOf, refreshOpinion } from "./diplomacy";
import { federationCouncilBonus, federationOf } from "./federation";
import { ensureFg, pushJournal } from "./fullgame";
import type { CouncilResolution } from "./fullgame";
import type { CommandResult, ResourceId, World } from "./types";

const PIRATE_EMPIRE_ID = 9;
/** Сессия совета каждые 300 тактов (GDD §12.4). */
export const COUNCIL_SESSION_PERIOD = 300;
/** Вето: 1 раз за 300 тактов, −15 мнения ко всем (GDD §12.4). */
export const VETO_COOLDOWN = 300;
export const VETO_OPINION = -15;
/** Санкции на 300 тактов, при 3+ санкциях — «изгой» (GDD §12.4). */
export const SANCTIONS_DURATION = 300;
export const OUTCAST_SANCTION_COUNT = 3;

export interface ResolutionSpec {
  type: string;
  ru: string;
  influenceCost: number;
  vetoable: boolean;
  durationTicks: number;
  effects: { target: string; value: number }[];
}

/** 8 резолюций канона (GDD §12.4). Данные @sf/data имеют приоритет. */
export const FALLBACK_RESOLUTIONS: ResolutionSpec[] = [
  {
    type: "ban_aggression",
    ru: "Запрет агрессии",
    influenceCost: 20,
    vetoable: true,
    durationTicks: 300,
    effects: [{ target: "aggressor_war_score", value: -0.5 }],
  },
  {
    type: "free_trade",
    ru: "Свободная торговля",
    influenceCost: 15,
    vetoable: false,
    durationTicks: 300,
    effects: [{ target: "trade_margin", value: 0.1 }, { target: "tariff", value: -0.2 }],
  },
  {
    type: "common_market",
    ru: "Общий рынок",
    influenceCost: 30,
    vetoable: true,
    durationTicks: 300,
    effects: [{ target: "common_market_radius", value: 5 }],
  },
  {
    type: "sanctions",
    ru: "Санкции против империи",
    influenceCost: 40,
    vetoable: true,
    durationTicks: SANCTIONS_DURATION,
    effects: [{ target: "target_income", value: -0.2 }, { target: "target_science", value: -0.1 }],
  },
  {
    type: "fleet_limit",
    ru: "Ограничение флота",
    influenceCost: 50,
    vetoable: true,
    durationTicks: 200,
    effects: [{ target: "fleet_cap_pct", value: 0.6 }],
  },
  {
    type: "science_exchange",
    ru: "Научный обмен",
    influenceCost: 25,
    vetoable: false,
    durationTicks: 300,
    effects: [{ target: "science", value: 0.1 }, { target: "tech2_cost", value: -0.1 }],
  },
  {
    type: "forced_peace",
    ru: "Принудительный мир",
    influenceCost: 60,
    vetoable: true,
    durationTicks: 0,
    effects: [{ target: "peace_ticks", value: 50 }],
  },
  {
    type: "declare_crisis",
    ru: "Объявление кризиса",
    influenceCost: 40,
    vetoable: false,
    durationTicks: 300,
    effects: [{ target: "crisis_war", value: 1 }, { target: "fp_bonus", value: 0.2 }],
  },
];

const RESOLUTION_BY_TYPE: Record<string, ResolutionSpec> = Object.fromEntries(
  FALLBACK_RESOLUTIONS.map((spec) => [spec.type, spec]),
);

/** Псевдонимы типов: канон GDD ↔ имена в @sf/data (resolutions.json). */
export const RESOLUTION_ALIASES: Record<string, string> = {
  ban_aggression: "ban_aggression",
  aggression_ban: "ban_aggression",
  declare_crisis: "declare_crisis",
  crisis_declaration: "declare_crisis",
};

/** Канонический тип резолюции (единый для состояния, ИИ и эффектов). */
export function normalizeResolutionType(type: string): string {
  return RESOLUTION_ALIASES[type] ?? type;
}

/** Спецификация резолюции: сначала данные контент-пакета, затем fallback канона. */
export function resolutionSpec(type: string): ResolutionSpec | undefined {
  const canonical = normalizeResolutionType(type);
  const data = COUNCIL_RESOLUTIONS.find(
    (def) => normalizeResolutionType(def.type) === canonical || def.id === type || def.id === canonical,
  );
  if (data) {
    return {
      type: canonical,
      ru: data.ru,
      influenceCost: data.influenceCost,
      vetoable: data.vetoable,
      durationTicks: data.durationTicks,
      effects: data.effects.map((effect) => ({ ...effect })),
    };
  }
  const fallback = RESOLUTION_BY_TYPE[canonical];
  return fallback ? { ...fallback, effects: fallback.effects.map((effect) => ({ ...effect })) } : undefined;
}

/** Значение эффекта принятой резолюции (данные @sf/data); undefined — резолюция не активна. */
export function resolutionEffectValue(world: World, type: string, target: string): number | undefined {
  const canonical = normalizeResolutionType(type);
  const resolutions = ensureFg(world).council.resolutions;
  for (const resolution of resolutions) {
    if (resolution.vetoed) continue;
    if (normalizeResolutionType(resolution.type) !== canonical) continue;
    if (resolution.durationTicks > 0 && world.tick >= resolution.passedTick + resolution.durationTicks) continue;
    const effect = resolution.effects.find((item) => item.target === target);
    if (effect) return effect.value;
  }
  return undefined;
}

export function isOutcast(world: World, empireId: number): boolean {
  return (world.flags["sanctions:count:" + empireId] ?? 0) >= OUTCAST_SANCTION_COUNT;
}

function livingEmpires(world: World): number[] {
  return world.empires.filter((empire) => !empire.dead && empire.id !== PIRATE_EMPIRE_ID).map((empire) => empire.id).sort((a, b) => a - b);
}

/** Вес голоса = 0.5 + доля населения + бонус федерации (GDD §12.4). */
export function councilWeights(world: World): Record<number, number> {
  const fg = ensureFg(world);
  const empires = livingEmpires(world);
  const popsById: Record<number, number> = {};
  let totalPops = 0;
  for (const empireId of empires) {
    const empire = empireById(world, empireId);
    let pops = 0;
    if (empire) {
      for (const colonyId of empire.colonies) {
        const colony = world.colonies.find((c) => c.id === colonyId);
        if (colony) pops += popsTotal(colony.pops);
      }
    }
    popsById[empireId] = pops;
    totalPops += pops;
  }
  const weights: Record<number, number> = {};
  for (const empireId of empires) {
    const share = totalPops > 0 ? popsById[empireId] / totalPops : 0;
    weights[empireId] = Math.round((0.5 + share + federationCouncilBonus(world, empireId)) * 100) / 100;
  }
  fg.council.weights = weights;
  return weights;
}

/** Империя с наибольшим весом (может вето). */
export function topWeightEmpire(world: World): number {
  const weights = world.fg?.council.weights ?? councilWeights(world);
  let best = 0;
  let bestWeight = -1;
  for (const empireId of livingEmpires(world)) {
    const weight = weights[empireId] ?? 0;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = empireId;
    }
  }
  return best;
}

/** Активна ли принятая резолюция данного типа (с учётом срока действия). */
export function councilActive(world: World, type: string): boolean {
  const canonical = normalizeResolutionType(type);
  const resolutions = ensureFg(world).council.resolutions;
  for (const resolution of resolutions) {
    if (normalizeResolutionType(resolution.type) !== canonical || resolution.vetoed) continue;
    if (resolution.durationTicks <= 0) return true;
    if (world.tick < resolution.passedTick + resolution.durationTicks) return true;
  }
  return false;
}

/** Санкции/изгой: множитель дохода цели (данные: target_income_mult 0.8). */
export function councilIncomeMult(world: World, empireId: number): number {
  const until = ensureFg(world).council.sanctions[empireId] ?? 0;
  if (until <= world.tick) return 1;
  return resolutionEffectValue(world, "sanctions", "target_income_mult") ?? 0.8;
}

/** Ограничение флота: множитель лимита (данные: fleet_cap_pct −0.4 → 0.6). */
export function councilFleetCapMult(world: World, empireId: number): number {
  void empireId;
  const delta = resolutionEffectValue(world, "fleet_limit", "fleet_cap_pct");
  return delta === undefined ? 1 : Math.max(0, 1 + delta);
}

/** Кризис объявлен советом (читает crisis.ts через этот хелпер). */
export function councilCrisisActive(world: World): boolean {
  return councilActive(world, "declare_crisis");
}

/** Принудительный мир: такт, с которого войны завершатся, либо −1 (нет резолюции). */
export function councilForcedPeaceSince(world: World): number {
  for (const resolution of ensureFg(world).council.resolutions) {
    if (normalizeResolutionType(resolution.type) === "forced_peace" && !resolution.vetoed) return resolution.passedTick;
  }
  return -1;
}

function recomputeVotes(world: World, resolution: CouncilResolution): void {
  const weights = world.fg?.council.weights ?? councilWeights(world);
  let votesFor = 0;
  let votesAgainst = 0;
  for (const key of Object.keys(resolution.votes)) {
    const empireId = Number(key);
    if (resolution.votes[empireId]) votesFor += weights[empireId] ?? 0.5;
    else votesAgainst += weights[empireId] ?? 0.5;
  }
  resolution.votesFor = Math.round(votesFor * 100) / 100;
  resolution.votesAgainst = Math.round(votesAgainst * 100) / 100;
}

/** Политика голосования ИИ (детерминированная, без PRNG). */
export function aiCouncilVote(world: World, empireId: number, resolution: CouncilResolution): boolean {
  const fg = ensureFg(world);
  const targetId = resolution.targetEmpireId;
  switch (normalizeResolutionType(resolution.type)) {
    case "ban_aggression": {
      // агрессор против, все остальные за
      for (const war of fg.wars) {
        if (war.attackerId === empireId) return false;
      }
      return true;
    }
    case "free_trade":
    case "common_market":
      return true;
    case "sanctions": {
      if (targetId === 0 || targetId === empireId) return false;
      if (federationOf(world, targetId) && federationOf(world, empireId)
        && federationOf(world, targetId)!.id === federationOf(world, empireId)!.id) return false;
      return opinionOf(world, empireId, targetId) < -20;
    }
    case "fleet_limit": {
      const empire = empireById(world, empireId);
      if (!empire) return true;
      const atWar = fg.wars.some((war) => war.sides[empireId] !== undefined);
      if (atWar) return false;
      const aggression = empire.ai?.aggression ?? 0;
      return aggression < 60;
    }
    case "science_exchange":
      return true;
    case "forced_peace": {
      const atWar = fg.wars.some((war) => war.sides[empireId] !== undefined);
      if (!atWar) return true;
      let exhaustion = 0;
      for (const war of fg.wars) {
        if (war.sides[empireId] === undefined) continue;
        exhaustion = Math.max(exhaustion, war.exhaustion[empireId] ?? 0);
      }
      return exhaustion >= 30;
    }
    case "declare_crisis": {
      return fg.crises.length > 0;
    }
    default:
      return true;
  }
}

function applyPassedResolution(world: World, resolution: CouncilResolution): void {
  const fg = ensureFg(world);
  resolution.passedTick = world.tick;
  fg.council.resolutions.push(resolution);
  const spec = resolutionSpec(resolution.type);
  if (!spec) return;
  switch (normalizeResolutionType(resolution.type)) {
    case "sanctions": {
      const targetId = resolution.targetEmpireId;
      if (targetId === 0 || !empireById(world, targetId)) break;
      const until = world.tick + Math.max(1, spec.durationTicks);
      fg.council.sanctions[targetId] = until;
      world.flags["sanctions:count:" + targetId] = (world.flags["sanctions:count:" + targetId] ?? 0) + 1;
      const target = empireById(world, targetId);
      if (target) {
        logEvent(world, "diplomacy", "bad", "Совет ввёл санкции против " + target.name + ".", undefined, target.isPlayer ? targetId : undefined);
      }
      break;
    }
    case "declare_crisis": {
      world.flags["council:crisis"] = world.tick + Math.max(1, spec.durationTicks);
      break;
    }
    case "fleet_limit": {
      world.flags["council:fleet_limit"] = world.tick + Math.max(1, spec.durationTicks);
      break;
    }
    case "forced_peace": {
      world.flags["council:forced_peace"] = world.tick;
      break;
    }
    default:
      break;
  }
  world.flags["hist:resolutions"] = (world.flags["hist:resolutions"] ?? 0) + 1;
  logEvent(world, "diplomacy", "good", "Совет принял резолюцию: " + spec.ru + ".", undefined, undefined);
  pushJournal(fg, world.tick, "council", "Резолюция принята: " + spec.ru);
}

function resolvePending(world: World): void {
  const fg = ensureFg(world);
  const pending = fg.council.pending;
  if (!pending) return;
  const weights = councilWeights(world);
  for (const empireId of livingEmpires(world)) {
    if (pending.votes[empireId] !== undefined) continue;
    const empire = empireById(world, empireId);
    if (!empire || empire.isPlayer) continue;
    pending.votes[empireId] = aiCouncilVote(world, empireId, pending);
  }
  recomputeVotes(world, pending);
  // вето империи с наибольшим весом (GDD §12.4)
  const top = topWeightEmpire(world);
  const spec = resolutionSpec(pending.type);
  if (spec?.vetoable && pending.votes[top] === false && pending.votesFor > pending.votesAgainst) {
    const cooldown = fg.council.vetoCooldown[top] ?? 0;
    if (cooldown <= world.tick && (weights[top] ?? 0) > 0) {
      pending.vetoed = true;
      pending.passedTick = world.tick;
      fg.council.vetoCooldown[top] = world.tick + VETO_COOLDOWN;
      for (const empireId of livingEmpires(world)) {
        if (empireId === top) continue;
        addRecentAction(world, empireId, top, VETO_OPINION);
        addRecentAction(world, top, empireId, VETO_OPINION);
        refreshOpinion(world, Math.min(empireId, top), Math.max(empireId, top));
      }
      fg.council.resolutions.push(pending);
      world.flags["hist:vetoes"] = (world.flags["hist:vetoes"] ?? 0) + 1;
      const vetoer = empireById(world, top);
      logEvent(
        world, "diplomacy", "bad",
        (vetoer?.name ?? "Империя " + top) + " наложила вето на резолюцию «" + (spec.ru) + "» (−15 мнения всем).",
        undefined, vetoer?.isPlayer ? top : undefined,
      );
      pushJournal(fg, world.tick, "veto", "Вето: " + (vetoer?.name ?? top));
      fg.council.pending = null;
      return;
    }
  }
  if (!pending.vetoed && pending.votesFor > pending.votesAgainst) {
    applyPassedResolution(world, pending);
  } else {
    const spec2 = resolutionSpec(pending.type);
    logEvent(world, "diplomacy", "info", "Резолюция совета отклонена: «" + (spec2?.ru ?? pending.type) + "».", undefined, undefined);
  }
  fg.council.pending = null;
}

/** Фаза совета: веса, сессии каждые 300, истечение эффектов, экономические эффекты. */
export function councilPhase(world: World): void {
  const fg = ensureFg(world);
  councilWeights(world);
  if (world.tick >= fg.council.nextSessionTick) {
    resolvePending(world);
    while (fg.council.nextSessionTick <= world.tick) fg.council.nextSessionTick += COUNCIL_SESSION_PERIOD;
    fg.lastCouncilTick = world.tick;
  }
  // истечение резолюций (forced_peace живёт на такт дольше — его применяет warPhase)
  fg.council.resolutions = fg.council.resolutions.filter((resolution) => {
    if (resolution.vetoed) return world.tick < resolution.passedTick + 300;
    const extra = normalizeResolutionType(resolution.type) === "forced_peace" ? 1 : 0;
    return resolution.durationTicks <= 0 || world.tick < resolution.passedTick + resolution.durationTicks + extra;
  });
  // истечение санкций
  for (const key of Object.keys(fg.council.sanctions)) {
    const targetId = Number(key);
    if ((fg.council.sanctions[targetId] ?? 0) <= world.tick) delete fg.council.sanctions[targetId];
  }
  applyCouncilEconomy(world);
}

const INCOME_RESOURCES: ResourceId[] = ["energy", "minerals", "food", "alloys", "goods", "credits"];

/** Экономические эффекты резолюций (страховка до подключения модификаторов в economy.ts). */
function applyCouncilEconomy(world: World): void {
  const fg = ensureFg(world);
  const freeTradeMargin = resolutionEffectValue(world, "free_trade", "trade_margin") ?? 0;
  const scienceBonus = resolutionEffectValue(world, "science_exchange", "science_prod") ?? 0;
  const fleetCapMult = councilFleetCapMult(world, 0);
  for (const empireId of livingEmpires(world)) {
    const empire = empireById(world, empireId);
    if (!empire) continue;
    // санкции: −20% дохода цели (данные: target_income_mult)
    const sanctionUntil = fg.council.sanctions[empireId] ?? 0;
    if (sanctionUntil > world.tick) {
      const cutPermille = Math.round((1 - councilIncomeMult(world, empireId)) * 1000);
      for (const res of INCOME_RESOURCES) {
        const income = empire.incomeLastTick[res];
        if (income <= 0) continue;
        const cut = Math.floor((income * cutPermille) / 1000);
        if (cut > 0) empire.resources[res] = Math.max(0, empire.resources[res] - cut);
      }
    }
    // свободная торговля: бонус к кредитному доходу (прокси маржи до подключения market-хука)
    if (freeTradeMargin > 0 && empire.incomeLastTick.credits > 0) {
      empire.resources.credits += Math.floor(empire.incomeLastTick.credits * freeTradeMargin);
    }
    // научный обмен: +10% науки
    if (scienceBonus > 0) {
      for (const school of ["physics", "society", "engineering"] as const) {
        const gain = Math.floor((empire.scienceLastTick[school] ?? 0) * scienceBonus);
        if (gain > 0) empire.science[school] += gain;
      }
    }
    // ограничение флота: сверх лимита резолюции — доп. содержание
    if (fleetCapMult < 1) {
      const cap = Math.floor(getFleetCap(world, empireId) * fleetCapMult);
      const fp = getEmpireFleetPower(world, empireId);
      const over = Math.max(0, fp - cap);
      if (over > 0) {
        const upkeep = Math.floor(over / 10);
        if (upkeep > 0) {
          empire.resources.energy = Math.max(0, empire.resources.energy - upkeep);
          empire.resources.alloys = Math.max(0, empire.resources.alloys - Math.floor(upkeep / 2));
        }
      }
    }
  }
}

function newResolutionId(world: World): string {
  const next = (world.flags["council:resCounter"] ?? 0) + 1;
  world.flags["council:resCounter"] = next;
  return "res_" + next;
}

export function proposeResolution(world: World, empireId: number, type: string, targetEmpireId?: number): CommandResult {
  const fg = ensureFg(world);
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return { ok: false, messageRu: "Империя недоступна" };
  if (empireId === PIRATE_EMPIRE_ID) return { ok: false, messageRu: "Пираты не заседают в совете" };
  const spec = resolutionSpec(type);
  if (!spec) return { ok: false, messageRu: "Неизвестная резолюция: " + type };
  if (fg.council.pending) return { ok: false, messageRu: "Совет уже рассматривает резолюцию" };
  let target = targetEmpireId ?? 0;
  if (type === "sanctions") {
    if (target === 0 || target === empireId) return { ok: false, messageRu: "Нужна цель санкций" };
    const targetEmpire = empireById(world, target);
    if (!targetEmpire || targetEmpire.dead || target === PIRATE_EMPIRE_ID) {
      return { ok: false, messageRu: "Некорректная цель санкций" };
    }
  } else {
    target = targetEmpireId ?? 0;
  }
  const mult = isOutcast(world, empireId) ? 1.5 : 1;
  const cost = Math.ceil(spec.influenceCost * mult);
  if (empire.resources.influence < cost) {
    return { ok: false, messageRu: "Нужно " + cost + " влияния для резолюции" };
  }
  empire.resources.influence -= cost;
  const resolution: CouncilResolution = {
    id: newResolutionId(world),
    type: spec.type,
    targetEmpireId: target,
    votesFor: 0,
    votesAgainst: 0,
    vetoed: false,
    passedTick: 0,
    durationTicks: spec.durationTicks,
    effects: spec.effects.map((effect) => ({ ...effect })),
    votes: { [empireId]: true },
  };
  recomputeVotes(world, resolution);
  fg.council.pending = resolution;
  logEvent(
    world, "diplomacy", "info",
    empire.name + " внесла резолюцию «" + spec.ru + "» (голосование на сессии совета такт " + fg.council.nextSessionTick + ").",
    undefined, empire.isPlayer ? empireId : undefined,
  );
  pushJournal(fg, world.tick, "council", "Резолюция предложена: " + spec.ru);
  return { ok: true, createdId: undefined, messageRu: "Резолюция внесена" };
}

export function voteResolution(world: World, empireId: number, resolutionId: string, vote: boolean): CommandResult {
  const fg = ensureFg(world);
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return { ok: false, messageRu: "Империя недоступна" };
  const resolution = fg.council.pending;
  if (!resolution) return { ok: false, messageRu: "Нет активного голосования" };
  if (resolution.id !== resolutionId) return { ok: false, messageRu: "Резолюция не найдена" };
  resolution.votes[empireId] = vote;
  recomputeVotes(world, resolution);
  return { ok: true, messageRu: vote ? "Голос «за» учтён" : "Голос «против» учтён" };
}

/** Вето: только империя с наибольшим весом, 1 раз за 300 тактов, −15 мнения всем. */
export function vetoResolution(world: World, empireId: number, resolutionId?: string): CommandResult {
  const fg = ensureFg(world);
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return { ok: false, messageRu: "Империя недоступна" };
  if (topWeightEmpire(world) !== empireId) return { ok: false, messageRu: "Вето доступно только империи с наибольшим весом" };
  const cooldown = fg.council.vetoCooldown[empireId] ?? 0;
  if (cooldown > world.tick) return { ok: false, messageRu: "Вето можно применить через " + (cooldown - world.tick) + " тактов" };
  const pending = fg.council.pending;
  if (!pending) return { ok: false, messageRu: "Нет активного голосования" };
  if (resolutionId !== undefined && pending.id !== resolutionId) return { ok: false, messageRu: "Резолюция не найдена" };
  const spec = resolutionSpec(pending.type);
  if (!spec || !spec.vetoable) return { ok: false, messageRu: "Эта резолюция не подлежит вето" };
  pending.vetoed = true;
  pending.passedTick = world.tick;
  fg.council.vetoCooldown[empireId] = world.tick + VETO_COOLDOWN;
  fg.council.resolutions.push(pending);
  fg.council.pending = null;
  for (const otherId of livingEmpires(world)) {
    if (otherId === empireId) continue;
    addRecentAction(world, otherId, empireId, VETO_OPINION);
    addRecentAction(world, empireId, otherId, VETO_OPINION);
    refreshOpinion(world, Math.min(empireId, otherId), Math.max(empireId, otherId));
  }
  logEvent(world, "diplomacy", "bad", empire.name + " наложила вето на «" + spec.ru + "» (−15 мнения всем).", undefined, empire.isPlayer ? empireId : undefined);
  pushJournal(fg, world.tick, "veto", "Вето: " + empire.name);
  return { ok: true, messageRu: "Вето наложено" };
}

/** Сводка для UI: активные резолюции. */
export function activeResolutions(world: World): CouncilResolution[] {
  const fg = ensureFg(world);
  return fg.council.resolutions
    .filter((resolution) => !resolution.vetoed && (resolution.durationTicks <= 0 || world.tick < resolution.passedTick + resolution.durationTicks))
    .slice()
    .sort((a, b) => b.passedTick - a.passedTick || a.id.localeCompare(b.id));
}

/** Сколько раз империи вводили санкции (для «изгоя»). */
export function sanctionCount(world: World, empireId: number): number {
  return world.flags["sanctions:count:" + empireId] ?? 0;
}

/** Голос председателя федерации в совете (для UI). */
export function councilVotePower(world: World, empireId: number): number {
  return world.fg?.council.weights[empireId] ?? 0.5;
}
