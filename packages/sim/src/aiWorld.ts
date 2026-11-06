/**
 * task-42 · Видимая мировая политика и внутренняя динамика ИИ.
 *
 * aiWorldPhase (каждые 10 тактов) наблюдает за AI-дипломатией (договоры/войны/федерации идут
 * в ai.ts), добивает редкие взаимодействия (дань/вассалитет), ведёт новостную ленту,
 * обрабатывает распады/поглощения/ассимиляцию/содружества и события для игрока.
 * Детерминизм: только id/тик/seed, без Math.random. Состояние — fg.aiWorld (save/load).
 */
import {
  activateTreaty, atWarWith, breakTreaty, opinionOf, refreshOpinion, setWarSide, treatyActive,
  warSideOf,
} from "./diplomacy";
import { applyCampaignEffect } from "./campaign";
import { empireById, logEvent } from "./economy";
import { advancedOf, ensureFg, pushJournal, relationKey, relationOf } from "./fullgame";
import { getEmpireFleetPower } from "./queries";
import { gdpShares } from "./victory";
import { clamp } from "./economy";
import type { Empire, World } from "./types";
import type {
  AiBloc, AiEmpireStatus, AiNewsItem, AiNewsKind, AiWorldEvent, AiWorldEventKind, AiWorldState, War,
} from "./fullgame";

export const AI_WORLD_INTERVAL = 10;
export const AI_NEWS_CAP = 50;
export const AI_EVENT_CAP = 20;
export const AI_EVENT_TTL = 240;
export const VASSAL_INTEGRATION_TICKS = 4000;
export const COMMONWEALTH_MIN_MEMBERS = 4;
export const COMMONWEALTH_AGE_TICKS = 5000;
export const COMMONWEALTH_UNIFY_AGE = 6500;
export const ACCESSION_AGE_TICKS = 3000;
export const COLLAPSE_EXHAUSTION = 70;
const PIRATE_EMPIRE_ID = 9;

function getGdpLeader(world: World): { leaderId: number; leaderShare: number } {
  const shares = gdpShares(world);
  return { leaderId: shares.leaderId, leaderShare: shares.leaderShare };
}

function aiWorld(world: World): AiWorldState {
  return ensureFg(world).aiWorld;
}

function nameOf(world: World, id: number): string {
  return empireById(world, id)?.name ?? ("Империя " + id);
}

function addNews(
  world: World,
  kind: AiNewsKind,
  a: number,
  b: number | undefined,
  titleRu: string,
  textRu: string,
  severity: AiNewsItem["severity"] = "info",
  playerImpact: AiNewsItem["playerImpact"] = null,
): void {
  const aw = aiWorld(world);
  const item: AiNewsItem = {
    id: aw.nextNewsId++,
    tick: world.tick,
    kind,
    titleRu,
    textRu,
    a,
    b,
    severity,
    playerImpact,
  };
  aw.news.push(item);
  if (aw.news.length > AI_NEWS_CAP) aw.news.splice(0, aw.news.length - AI_NEWS_CAP);
  const fg = ensureFg(world);
  if (kind === "war" || kind === "collapse" || kind === "annexation" || kind === "centralization") {
    pushJournal(fg, world.tick, "politics", textRu);
  }
}

function addEvent(
  world: World,
  kind: AiWorldEventKind,
  fromEmpireId: number,
  targetEmpireId: number | undefined,
  titleRu: string,
  textRu: string,
  choices: AiWorldEvent["choices"],
  extra?: { warId?: number; federationId?: number },
): AiWorldEvent | null {
  const aw = aiWorld(world);
  if (aw.events.filter((event) => !event.resolved).length >= AI_EVENT_CAP) return null;
  const event: AiWorldEvent = {
    id: aw.nextEventId++,
    kind,
    tick: world.tick,
    fromEmpireId,
    targetEmpireId,
    titleRu,
    textRu,
    expiresTick: world.tick + AI_EVENT_TTL,
    choices,
    resolved: false,
    warId: extra?.warId,
    federationId: extra?.federationId,
  };
  aw.events.push(event);
  return event;
}

function eventSeen(world: World, key: string): boolean {
  const aw = aiWorld(world);
  return (aw.flags["event:" + key] ?? 0) > 0;
}

function markEventSeen(world: World, key: string): void {
  const aw = aiWorld(world);
  aw.flags["event:" + key] = 1;
}

function setStatus(world: World, empireId: number, state: AiEmpireStatus, absorbedBy?: number): void {
  const aw = aiWorld(world);
  aw.statuses[empireId] = { state, absorbedBy };
}

// ------------------------------------------------------------------ передача активов

function removeFromFederations(world: World, empireId: number): void {
  const fg = ensureFg(world);
  for (const federation of fg.federations) {
    federation.members = federation.members.filter((id) => id !== empireId);
    delete federation.votes[empireId];
    if (federation.presidentId === empireId) federation.presidentId = federation.members.slice().sort((a, b) => a - b)[0] ?? 0;
  }
  fg.federations = fg.federations.filter((federation) => federation.members.length >= 2);
}

function endWarsOf(world: World, empireId: number): void {
  const fg = ensureFg(world);
  for (const war of fg.wars) {
    delete war.sides[empireId];
    delete war.score[empireId];
    delete war.exhaustion[empireId];
    delete war.occupied[empireId];
    setWarSide(world, war.id, empireId, 0);
  }
  fg.wars = fg.wars.filter((war) => Object.keys(war.sides).length >= 2);
}

/** Полное поглощение: системы/колонии/флоты/казна/технологии переходят к target. */
export function mergeEmpire(world: World, fromId: number, toId: number, reason: "annexation" | "accession" | "absorb" | "centralization"): void {
  const from = empireById(world, fromId);
  const to = empireById(world, toId);
  if (!from || !to || from.dead || to.dead || fromId === toId) return;
  for (const system of world.systems) {
    if (system.ownerId !== fromId) continue;
    system.ownerId = toId;
    if (!to.systems.includes(system.id)) to.systems.push(system.id);
    if (!system.knownBy.includes(toId)) system.knownBy.push(toId);
  }
  from.systems = [];
  to.systems.sort((a, b) => a - b);
  for (const colony of world.colonies) {
    if (colony.empireId !== fromId) continue;
    colony.empireId = toId;
    if (!to.colonies.includes(colony.id)) to.colonies.push(colony.id);
    const planet = world.systems[colony.systemId]?.planets.find((entry) => entry.id === colony.planetId);
    if (planet) planet.ownerId = toId;
  }
  from.colonies = [];
  to.colonies.sort((a, b) => a - b);
  for (const fleet of world.fleets) {
    if (fleet.empireId !== fromId) continue;
    fleet.empireId = toId;
    if (!to.fleets.includes(fleet.id)) to.fleets.push(fleet.id);
  }
  from.fleets = [];
  to.fleets.sort((a, b) => a - b);
  for (const key of Object.keys(from.resources) as Array<keyof Empire["resources"]>) {
    to.resources[key] += from.resources[key];
    from.resources[key] = 0;
  }
  for (const tech of from.techs.completed) {
    if (!to.techs.completed.includes(tech)) to.techs.completed.push(tech);
  }
  // Сохраняем прогресс развития (перки/традиции/земли) и уже построенные мегаструктуры.
  const fromAdv = advancedOf(world, fromId);
  const toAdv = advancedOf(world, toId);
  for (const perk of fromAdv.perks) if (!toAdv.perks.includes(perk)) toAdv.perks.push(perk);
  for (const tradition of fromAdv.traditions.unlocked) if (!toAdv.traditions.unlocked.includes(tradition)) toAdv.traditions.unlocked.push(tradition);
  for (const claim of fromAdv.claims) if (!toAdv.claims.includes(claim)) toAdv.claims.push(claim);
  const fgLocal = ensureFg(world);
  for (const mega of fgLocal.megastructures) if (mega.ownerId === fromId) mega.ownerId = toId;
  for (const other of world.empires) {
    const advanced = advancedOf(world, other.id);
    advanced.vassals = advanced.vassals.filter((id) => id !== fromId);
  }
  removeFromFederations(world, fromId);
  endWarsOf(world, fromId);
  from.dead = true;
  from.systems = [];
  from.colonies = [];
  from.fleets = [];
  from.flagshipFleetId = -1;
  const aw = aiWorld(world);
  aw.stats.annexations += 1;
  setStatus(world, fromId, reason === "accession" ? "accession" : "absorbed", toId);
  addNews(
    world, reason === "accession" ? "accession" : "annexation", toId, fromId,
    reason === "accession" ? "Добровольное вхождение" : "Поглощение империи",
    nameOf(world, fromId) + " входит в состав " + nameOf(world, toId) + " (" + reason + ").",
    "warn", null,
  );
  logEvent(world, "diplomacy", "warn", "Империя " + nameOf(world, fromId) + " прекратила существование: " + reason + ".", undefined, undefined);
}

function distributeCollapse(world: World, empireId: number): void {
  const from = empireById(world, empireId);
  if (!from) return;
  const alive = world.empires.filter((empire) => !empire.dead && empire.id !== empireId && empire.id !== PIRATE_EMPIRE_ID);
  const systems = world.systems.filter((system) => system.ownerId === empireId).sort((a, b) => a.id - b.id);
  const recipients: number[] = [];
  for (const system of systems) {
    let recipient = 0;
    for (const linked of system.links) {
      const owner = world.systems[linked]?.ownerId ?? 0;
      if (owner !== 0 && owner !== empireId && !empireById(world, owner)?.dead && owner !== PIRATE_EMPIRE_ID) {
        recipient = owner;
        break;
      }
    }
    if (recipient === 0 && alive.length > 0) {
      recipient = alive.slice().sort((a, b) => getEmpireFleetPower(world, b.id) - getEmpireFleetPower(world, a.id) || a.id - b.id)[0]!.id;
    }
    if (recipient !== 0) {
      system.ownerId = recipient;
      const target = empireById(world, recipient);
      if (target && !target.systems.includes(system.id)) target.systems.push(system.id);
      if (!recipients.includes(recipient)) recipients.push(recipient);
    }
  }
  for (const colony of world.colonies) {
    if (colony.empireId !== empireId) continue;
    const recipient = systemOwnerOr(world, colony.systemId, recipients[0] ?? 0);
    colony.empireId = recipient;
    const target = empireById(world, recipient);
    if (target && !target.colonies.includes(colony.id)) target.colonies.push(colony.id);
  }
  for (const fleet of world.fleets) {
    if (fleet.empireId !== empireId) continue;
    const recipient = recipients[0] ?? 0;
    if (recipient !== 0) {
      fleet.empireId = recipient;
      const target = empireById(world, recipient);
      if (target && !target.fleets.includes(fleet.id)) target.fleets.push(fleet.id);
    } else {
      fleet.ships = [];
    }
  }
  from.systems = [];
  from.colonies = [];
  from.fleets = [];
  from.dead = true;
  from.flagshipFleetId = -1;
  removeFromFederations(world, empireId);
  endWarsOf(world, empireId);
  const aw = aiWorld(world);
  aw.stats.collapses += 1;
  setStatus(world, empireId, "collapsed");
  addNews(
    world, "collapse", empireId, recipients[0], "Распад империи",
    "Империя " + from.name + " распалась: системы переходят соседям/пиратам.",
    "bad", null,
  );
  logEvent(world, "diplomacy", "bad", "Империя " + from.name + " распалась.", undefined, undefined);
}

function systemOwnerOr(world: World, systemId: number, fallback: number): number {
  return world.systems[systemId]?.ownerId ?? fallback;
}

function shouldCollapse(world: World, empire: Empire): boolean {
  if (empire.dead || empire.isPlayer || empire.id === PIRATE_EMPIRE_ID) return false;
  if (empire.systems.length === 0) return false; // отдельная ветка захвата
  const capitalLost = world.systems[empire.capitalSystemId]?.ownerId !== empire.id;
  const fg = ensureFg(world);
  let exhausted = false;
  for (const war of fg.wars) {
    if ((war.exhaustion[empire.id] ?? 0) >= COLLAPSE_EXHAUSTION) { exhausted = true; break; }
  }
  const stabilityLow = empire.colonies.length > 0
    && world.colonies.filter((colony) => colony.empireId === empire.id).every((colony) => colony.stability < 20);
  return (capitalLost && empire.systems.length <= 1) || (exhausted && empire.systems.length <= 1) || (stabilityLow && empire.systems.length <= 1);
}

// ------------------------------------------------------------------ новости о действиях ai.ts

function recordWarDeltas(world: World): void {
  const aw = aiWorld(world);
  const fg = ensureFg(world);
  const currentIds = fg.wars.map((war) => war.id).sort((a, b) => a - b);
  const previous = new Set(aw.lastWarIds);
  for (const war of fg.wars) {
    if (war.startedTick < aw.lastPhaseTick && previous.has(war.id)) continue;
    if (previous.has(war.id) && war.startedTick < aw.lastPhaseTick) continue;
    const playerInvolved = war.attackerId === world.playerEmpireId || war.defenderId === world.playerEmpireId;
    addNews(
      world, "war", war.attackerId, war.defenderId, "Война",
      nameOf(world, war.attackerId) + " → " + nameOf(world, war.defenderId) + " (" + war.cb + ").",
      "warn", playerInvolved ? "threat" : null,
    );
  }
  for (const warId of aw.lastWarIds) {
    if (currentIds.includes(warId)) continue;
    addNews(world, "peace", 0, undefined, "Мир", "Война #" + warId + " окончена.", "good", null);
  }
  aw.lastWarIds = currentIds;
}

function recordTreatyDeltas(world: World): void {
  const aw = aiWorld(world);
  const fg = ensureFg(world);
  for (const [key, relation] of Object.entries(fg.relations)) {
    const [aRaw, bRaw] = key.split(":");
    const a = Number(aRaw);
    const b = Number(bRaw);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    for (const kind of ["nap", "trade", "research", "defensive", "alliance", "federation", "vassal", "tribute"] as const) {
      const state = relation.treaties[kind];
      if (!state.active || state.sinceTick < aw.lastPhaseTick) continue;
      const dedupe = "news:treaty:" + key + ":" + kind + ":" + state.sinceTick;
      if (aw.flags[dedupe]) continue;
      aw.flags[dedupe] = 1;
      const playerInvolved = a === world.playerEmpireId || b === world.playerEmpireId;
      addNews(
        world, "treaty", a, b, "Договор",
        nameOf(world, a) + " и " + nameOf(world, b) + ": " + kind + ".",
        "info", playerInvolved ? "ally" : null,
      );
      if (kind === "tribute") {
        addNews(world, "tribute", a, b, "Дань", nameOf(world, b) + " платит дань " + nameOf(world, a) + ".", "warn", null);
      }
      if (kind === "vassal") {
        addNews(world, "vassalization", a, b, "Вассалитет", nameOf(world, b) + " — вассал " + nameOf(world, a) + ".", "warn", null);
      }
    }
  }
}

function recordFederationDeltas(world: World): void {
  const aw = aiWorld(world);
  const fg = ensureFg(world);
  for (const federation of fg.federations) {
    const key = "news:fed:" + federation.id + ":" + federation.members.join(",");
    if (aw.flags[key]) continue;
    aw.flags[key] = 1;
    if (federation.members.length >= 2) {
      addNews(
        world, "federation", federation.presidentId, undefined, "Федерация",
        federation.nameRu + ": " + federation.members.length + " участников.",
        "info", federation.members.includes(world.playerEmpireId) ? "ally" : null,
      );
    }
  }
}

// ------------------------------------------------------------------ редкие AI-взаимодействия

function aiPairDemands(world: World): void {
  const aw = aiWorld(world);
  const empires = world.empires.filter((empire) => !empire.dead && empire.id !== PIRATE_EMPIRE_ID && !empire.isPlayer).sort((a, b) => a.id - b.id);
  for (let i = 0; i < empires.length; i++) {
    for (let j = i + 1; j < empires.length; j++) {
      const a = empires[i]!;
      const b = empires[j]!;
      if (atWarWith(world, a.id, b.id)) continue;
      if (treatyActive(world, a.id, b.id, "federation") || treatyActive(world, a.id, b.id, "vassal") || treatyActive(world, a.id, b.id, "tribute")) continue;
      const fpA = getEmpireFleetPower(world, a.id);
      const fpB = getEmpireFleetPower(world, b.id);
      const strong = fpA >= fpB ? a : b;
      const weak = fpA >= fpB ? b : a;
      const ratio = Math.max(fpA, fpB) / Math.max(1, Math.min(fpA, fpB));
      if (ratio < 1.6) continue;
      // Анти-снежок: не усиливаем действующего лидера по ВВП (коалиция и так давит на него).
      const leader = getGdpLeader(world);
      if (leader.leaderShare > 0.4 && leader.leaderId === strong.id) continue;
      const cooldown = "aiworld:demand:" + strong.id + ":" + weak.id;
      if ((aw.flags[cooldown] ?? 0) > world.tick) continue;
      aw.flags[cooldown] = world.tick + 900;
      if (opinionOf(world, strong.id, weak.id) < -20) continue;
      const vassal = ratio >= 2.5 && strong.resources.influence >= 50;
      const result = applyTreatyOffer(world, strong.id, weak.id, vassal ? "vassal" : "tribute");
      if (!result.ok) continue;
      addNews(
        world, vassal ? "vassalization" : "tribute", strong.id, weak.id,
        vassal ? "Вассалитет" : "Требование дани",
        nameOf(world, weak.id) + " принимает " + (vassal ? "вассалитет" : "дань") + " от " + nameOf(world, strong.id) + ".",
        "warn", null,
      );
    }
  }
}

import { applyCommandAs } from "./commands";
function applyTreatyOffer(world: World, fromId: number, toId: number, kind: "vassal" | "tribute"): { ok: boolean } {
  return applyCommandAs(world, fromId, { type: "treaty_offer", targetEmpireId: toId, treaty: kind });
}

// ------------------------------------------------------------------ распады/поглощения/содружества

function processEmpireLifecycle(world: World): void {
  const aw = aiWorld(world);
  const empires = world.empires.filter((empire) => !empire.dead).sort((a, b) => a.id - b.id);
  // 1. Захват всех систем = уничтожение.
  for (const empire of empires) {
    if (empire.isPlayer || empire.id === PIRATE_EMPIRE_ID) continue;
    if (empire.systems.length > 0) continue;
    const aw2 = aiWorld(world);
    aw2.stats.annexations += 1;
    setStatus(world, empire.id, "annexed");
    empire.dead = true;
    addNews(world, "annexation", empire.id, undefined, "Уничтожение", "Империя " + empire.name + " потеряла все системы и уничтожена.", "bad", null);
  }
  // 2. Распад слабых.
  for (const empire of empires) {
    if (empire.dead || empire.isPlayer || empire.id === PIRATE_EMPIRE_ID) continue;
    if (empire.systems.length === 0) continue;
    if (!shouldCollapse(world, empire)) continue;
    distributeCollapse(world, empire.id);
  }
  // 3. Вассалы → интеграция через N тактов.
  for (const overlord of world.empires.filter((empire) => !empire.dead)) {
    const advanced = advancedOf(world, overlord.id);
    for (const vassalId of advanced.vassals.slice().sort((a, b) => a - b)) {
      const vassal = empireById(world, vassalId);
      if (!vassal || vassal.dead) continue;
      const key = "aiworld:vassal:" + overlord.id + ":" + vassalId;
      if (!aw.flags[key]) {
        aw.flags[key] = world.tick;
        continue;
      }
      if (world.tick - aw.flags[key] < VASSAL_INTEGRATION_TICKS) continue;
      if (vassal.isPlayer) {
        const eventKey = "vassal_demand:" + overlord.id + ":" + vassalId;
        if (eventSeen(world, eventKey)) continue;
        markEventSeen(world, eventKey);
        const event = addEvent(
          world, "vassalization_demand", overlord.id, vassalId,
          "Требование вассалитета",
          "Империя " + overlord.name + " требует от вас вассалитета.",
          [
            { id: "accept", labelRu: "Принять вассалитет", effectsRu: "Вассалитет, мнение +10", effects: [{ target: "treaty:vassal:" + overlord.id, value: 1 }, { target: "opinion:" + overlord.id, value: 10 }] },
            { id: "decline", labelRu: "Отказаться", effectsRu: "Мнение −20", effects: [{ target: "opinion:" + overlord.id, value: -20 }] },
            { id: "war", labelRu: "Ответить войной", effectsRu: "Война", effects: [{ target: "war:" + overlord.id, value: 1 }] },
          ],
        );
        if (event) addNews(world, "call_to_arms", overlord.id, vassalId, "Вассалитет", "Вам предъявлено требование вассалитета.", "bad", "ally");
        continue;
      }
      if (opinionOf(world, overlord.id, vassalId) < 0) continue;
      mergeEmpire(world, vassalId, overlord.id, "annexation");
    }
  }
  // 4. Добровольное вхождение слабых ИИ в сильного.
  for (const empire of empires) {
    if (empire.dead || empire.isPlayer || empire.id === PIRATE_EMPIRE_ID) continue;
    if (empire.systems.length > 2) continue;
    const strongest = world.empires
      .filter((other) => !other.dead && other.id !== empire.id && other.id !== PIRATE_EMPIRE_ID && !other.isPlayer)
      .sort((a, b) => getEmpireFleetPower(world, b.id) - getEmpireFleetPower(world, a.id) || a.id - b.id)[0];
    if (!strongest) continue;
    const ratio = getEmpireFleetPower(world, strongest.id) / Math.max(1, getEmpireFleetPower(world, empire.id));
    if (ratio < 2.5) continue;
    if (atWarWith(world, empire.id, strongest.id)) continue;
    if (opinionOf(world, empire.id, strongest.id) < 60) continue;
    const key = "aiworld:accession:" + empire.id + ":" + strongest.id;
    if (!aw.flags[key]) { aw.flags[key] = world.tick; continue; }
    if (world.tick - aw.flags[key] < ACCESSION_AGE_TICKS) continue;
    mergeEmpire(world, empire.id, strongest.id, "accession");
  }
}

function processFederations(world: World): void {
  const fg = ensureFg(world);
  const aw = aiWorld(world);
  for (const federation of fg.federations.slice().sort((a, b) => a.id - b.id)) {
    if (federation.members.length < 2) continue;
    const age = world.tick - federation.foundedTick;
    const key = "aiworld:cw:" + federation.id;
    if (!aw.flags[key] && (federation.members.length >= COMMONWEALTH_MIN_MEMBERS || age >= COMMONWEALTH_AGE_TICKS)) {
      aw.flags[key] = 1;
      aw.stats.commonwealths += 1;
      const bloc: AiBloc = {
        id: "cw:" + federation.id, nameRu: "Содружество «" + federation.nameRu + "»",
        members: federation.members.slice().sort((a, b) => a - b), kind: "commonwealth",
        formedTick: world.tick,
      };
      aw.blocs = aw.blocs.filter((entry) => entry.id !== bloc.id);
      aw.blocs.push(bloc);
      const campaign = ensureFg(world).campaign;
      campaign.flags.ai_federation = 1;
      campaign.flags.ai_commonwealth = 1;
      addNews(world, "commonwealth", federation.presidentId, undefined, "Содружество", federation.nameRu + " становится содружеством с общей казной и флотом.", "good", federation.members.includes(world.playerEmpireId) ? "bloc" : null);
      const eventKey = "cw_vote:" + federation.id;
      if (federation.members.includes(world.playerEmpireId) && !eventSeen(world, eventKey)) {
        markEventSeen(world, eventKey);
        const event = addEvent(
          world, "centralization_vote", federation.presidentId, world.playerEmpireId,
          "Централизация содружества",
          "Содружество предлагает централизацию: общая казна и флот.",
          [
            { id: "accept", labelRu: "Поддержать", effectsRu: "Флаг содружества", effects: [{ target: "flag:ai_commonwealth_member", value: 1 }, { target: "opinion:" + federation.presidentId, value: 10 }] },
            { id: "decline", labelRu: "Отказаться", effectsRu: "Выйти из федерации", effects: [{ target: "leave_federation", value: 1 }, { target: "opinion:" + federation.presidentId, value: -10 }] },
            { id: "counter", labelRu: "Контрпредложение", effectsRu: "Мнение −5", effects: [{ target: "opinion:" + federation.presidentId, value: -5 }] },
          ],
          { federationId: federation.id },
        );
        if (event) addNews(world, "call_to_arms", federation.presidentId, world.playerEmpireId, "Централизация", "Содружество ждёт вашего решения.", "info", "bloc");
      }
      continue;
    }
    if (!aw.flags[key]) continue;
    if (federation.members.includes(world.playerEmpireId)) continue;
    if (age < COMMONWEALTH_UNIFY_AGE) continue;
    const president = federation.members.slice().sort((a, b) => a - b)[0] ?? federation.presidentId;
    for (const memberId of federation.members.slice().sort((a, b) => a - b)) {
      if (memberId === president) continue;
      mergeEmpire(world, memberId, president, "centralization");
    }
    fg.federations = fg.federations.filter((entry) => entry.id !== federation.id);
    addNews(world, "centralization", president, undefined, "Единая империя", "Содружество централизовалось в единую империю.", "good", null);
  }
}

function buildTradeBlocs(world: World): AiBloc[] {
  const fg = ensureFg(world);
  const aw = aiWorld(world);
  const empires = world.empires.filter((empire) => !empire.dead && !empire.isPlayer && empire.id !== PIRATE_EMPIRE_ID).sort((a, b) => a.id - b.id);
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const empire of empires) parent.set(empire.id, empire.id);
  for (let i = 0; i < empires.length; i++) {
    for (let j = i + 1; j < empires.length; j++) {
      if (!treatyActive(world, empires[i]!.id, empires[j]!.id, "trade")) continue;
      const a = find(empires[i]!.id);
      const b = find(empires[j]!.id);
      if (a !== b) parent.set(a, b);
    }
  }
  const groups = new Map<number, number[]>();
  for (const empire of empires) {
    const root = find(empire.id);
    const list = groups.get(root) ?? [];
    list.push(empire.id);
    groups.set(root, list);
  }
  const blocs: AiBloc[] = [];
  for (const [root, members] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (members.length < 2) continue;
    members.sort((a, b) => a - b);
    const id = "trade:" + root;
    blocs.push({ id, nameRu: "Торговый блок", members, kind: "trade", formedTick: world.tick });
    const key = "aiworld:trade:" + id + ":" + members.join(",");
    if (!aw.flags[key]) {
      aw.flags[key] = 1;
      addNews(world, "trade_bloc", members[0]!, members[members.length - 1], "Торговый блок", "Сформирован торговый блок: " + members.map((id) => nameOf(world, id)).join(", ") + ".", "info", members.includes(world.playerEmpireId) ? "bloc" : null);
    }
  }
  aw.blocs = [...aw.blocs.filter((bloc) => bloc.kind !== "trade"), ...blocs];
  return blocs;
}

// ------------------------------------------------------------------ события игрока

function createPlayerEvents(world: World, tradeBlocs: AiBloc[]): void {
  const player = empireById(world, world.playerEmpireId);
  if (!player) return;
  const fg = ensureFg(world);
  const aw = aiWorld(world);
  // call-to-arms: союзник/федерация в войне
  for (const war of fg.wars) {
    for (const partner of world.empires.filter((empire) => !empire.dead && empire.id !== player.id && empire.id !== PIRATE_EMPIRE_ID).sort((a, b) => a.id - b.id)) {
      const partnerSide = warSideOf(world, war.id, partner.id);
      if (partnerSide === 0) continue;
      const allied = treatyActive(world, player.id, partner.id, "alliance")
        || treatyActive(world, player.id, partner.id, "defensive");
      if (!allied) continue;
      const key = "cta:" + war.id + ":" + partner.id;
      if (eventSeen(world, key)) continue;
      markEventSeen(world, key);
      const enemyId = war.attackerId === partner.id ? war.defenderId : war.attackerId;
      const event = addEvent(
        world, "call_to_arms", partner.id, player.id,
        "Призыв союзника",
        nameOf(world, partner.id) + " призывает вас в войну против " + nameOf(world, enemyId) + ".",
        [
          { id: "join", labelRu: "Вступить в войну", effectsRu: "Совместная война, мнение +10", effects: [{ target: "join_war:" + war.id, value: 1 }, { target: "opinion:" + partner.id, value: 10 }, { target: "flag:ai_call_to_arms", value: 1 }] },
          { id: "neutral", labelRu: "Нейтралитет", effectsRu: "Мнение −15", effects: [{ target: "opinion:" + partner.id, value: -15 }] },
          { id: "break", labelRu: "Разорвать союз", effectsRu: "Договор разорван", effects: [{ target: "break_treaty:alliance:" + partner.id, value: 1 }, { target: "opinion:" + partner.id, value: -25 }] },
        ],
        { warId: war.id },
      );
      if (event) addNews(world, "call_to_arms", partner.id, player.id, "Призыв союзника", event.textRu, "warn", "ally");
      return;
    }
  }
  // торговый блок
  for (const bloc of tradeBlocs) {
    if (!bloc.members.some((memberId) => treatyActive(world, player.id, memberId, "trade"))) continue;
    const key = "trade_bloc:" + bloc.id;
    if (eventSeen(world, key)) continue;
    markEventSeen(world, key);
    const event = addEvent(
      world, "trade_bloc", bloc.members[0]!, player.id,
      "Торговый блок",
      "Торговый блок приглашает вас присоединиться к пакту.",
      [
        { id: "join", labelRu: "Присоединиться", effectsRu: "Торговый блок, мнение +10", effects: [{ target: "flag:ai_trade_bloc", value: 1 }, { target: "opinion:" + bloc.members[0], value: 10 }] },
        { id: "decline", labelRu: "Отказаться", effectsRu: "Мнение −5", effects: [{ target: "opinion:" + bloc.members[0], value: -5 }] },
      ],
    );
    if (event) addNews(world, "trade_bloc", bloc.members[0]!, player.id, "Торговый блок", event.textRu, "info", "bloc");
    return;
  }
  // беженцы/приграничье (войны рядом)
  for (const war of fg.wars) {
    if (warSideOf(world, war.id, player.id) !== 0) continue;
    const participants = [war.attackerId, war.defenderId];
    const near = world.systems.some((system) => system.ownerId === player.id && system.links.some((linked) => participants.includes(world.systems[linked]?.ownerId ?? -1)));
    if (!near) continue;
    const key = "refugees:" + war.id;
    if (eventSeen(world, key)) continue;
    markEventSeen(world, key);
    world.flags["ai:refugees_pressure"] = world.tick;
    ensureFg(world).campaign.flags.ai_war = 1;
    const event = addEvent(
      world, "refugees", war.attackerId, player.id,
      "Беженцы на границе",
      "Война у ваших границ: поток беженцев и рост цен.",
      [
        { id: "aid", labelRu: "Принять беженцев", effectsRu: "−500 Cr, мнение +5", effects: [{ target: "credits", value: -500 }, { target: "opinion:" + war.attackerId, value: 5 }, { target: "flag:ai_refugees_aid", value: 1 }] },
        { id: "close", labelRu: "Закрыть границы", effectsRu: "Мнение −5", effects: [{ target: "opinion:" + war.attackerId, value: -5 }, { target: "flag:ai_borders_closed", value: 1 }] },
      ],
      { warId: war.id },
    );
    if (event) addNews(world, "call_to_arms", war.attackerId, player.id, "Беженцы", event.textRu, "warn", "threat");
    return;
  }
  // предложение вхождения слабого ИИ в игрока
  for (const empire of world.empires.filter((entry) => !entry.dead && !entry.isPlayer && entry.id !== PIRATE_EMPIRE_ID).sort((a, b) => a.id - b.id)) {
    if (empire.systems.length > 2) continue;
    if (getEmpireFleetPower(world, player.id) < getEmpireFleetPower(world, empire.id) * 2) continue;
    if (opinionOf(world, empire.id, player.id) < 60) continue;
    const key = "accession_offer:" + empire.id;
    if (eventSeen(world, key)) continue;
    markEventSeen(world, key);
    const event = addEvent(
      world, "accession_offer", empire.id, player.id,
      "Добровольное вхождение",
      nameOf(world, empire.id) + " просит принять её в состав вашей империи.",
      [
        { id: "accept", labelRu: "Принять", effectsRu: "Империя входит в вашу", effects: [{ target: "merge_into:" + empire.id, value: 1 }, { target: "flag:ai_accession", value: 1 }] },
        { id: "decline", labelRu: "Отказаться", effectsRu: "Мнение −10", effects: [{ target: "opinion:" + empire.id, value: -10 }] },
      ],
    );
    if (event) addNews(world, "accession", empire.id, player.id, "Вхождение", event.textRu, "good", "ally");
    return;
  }
  // требование вассалитета от сильного ИИ
  for (const empire of world.empires.filter((entry) => !entry.dead && !entry.isPlayer && entry.id !== PIRATE_EMPIRE_ID).sort((a, b) => a.id - b.id)) {
    if (getEmpireFleetPower(world, empire.id) < getEmpireFleetPower(world, player.id) * 2) continue;
    if (atWarWith(world, empire.id, player.id)) continue;
    if (treatyActive(world, empire.id, player.id, "vassal")) continue;
    const key = "vassal_demand:" + empire.id + ":" + player.id;
    if (eventSeen(world, key)) continue;
    markEventSeen(world, key);
    const event = addEvent(
      world, "vassalization_demand", empire.id, player.id,
      "Требование вассалитета",
      nameOf(world, empire.id) + " требует вассалитета.",
      [
        { id: "accept", labelRu: "Принять", effectsRu: "Вассалитет", effects: [{ target: "treaty:vassal:" + empire.id, value: 1 }, { target: "opinion:" + empire.id, value: 10 }] },
        { id: "decline", labelRu: "Отказаться", effectsRu: "Мнение −20", effects: [{ target: "opinion:" + empire.id, value: -20 }] },
        { id: "war", labelRu: "Война", effectsRu: "Война", effects: [{ target: "war:" + empire.id, value: 1 }] },
      ],
    );
    if (event) addNews(world, "vassalization", empire.id, player.id, "Вассалитет", event.textRu, "bad", "threat");
    return;
  }
  void aw;
}

// ------------------------------------------------------------------ API

export function getAiNews(world: World, opts?: { limit?: number; sinceTick?: number; kinds?: AiNewsKind[] }): AiNewsItem[] {
  const aw = ensureFg(world).aiWorld;
  let items = aw.news.slice().sort((a, b) => b.id - a.id);
  if (opts?.sinceTick !== undefined) items = items.filter((item) => item.tick >= opts.sinceTick!);
  if (opts?.kinds && opts.kinds.length > 0) items = items.filter((item) => opts.kinds!.includes(item.kind));
  const limit = Math.max(1, Math.min(AI_NEWS_CAP, opts?.limit ?? AI_NEWS_CAP));
  return items.slice(0, limit).map((item) => ({ ...item }));
}

export function getAiWorldEvents(world: World): AiWorldEvent[] {
  return ensureFg(world).aiWorld.events
    .filter((event) => !event.resolved && event.expiresTick > world.tick)
    .sort((a, b) => a.id - b.id)
    .map((event) => ({ ...event, choices: event.choices.map((choice) => ({ ...choice, effects: choice.effects.map((effect) => ({ ...effect })) })) }));
}

function treatyKindOf(world: World, a: number, b: number): string {
  for (const kind of ["war", "federation", "vassal", "alliance", "defensive", "trade", "nap"] as const) {
    if (kind === "war") { if (atWarWith(world, a, b)) return "war"; continue; }
    if (treatyActive(world, a, b, kind)) return kind;
  }
  return "neutral";
}

export interface AiRelationView { a: number; b: number; kind: string; sinceTick?: number }

export function getAiRelations(world: World): AiRelationView[] {
  const fg = ensureFg(world);
  const out: AiRelationView[] = [];
  for (const [key, relation] of Object.entries(fg.relations)) {
    const [aRaw, bRaw] = key.split(":");
    const a = Number(aRaw);
    const b = Number(bRaw);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const kind = treatyKindOf(world, a, b);
    if (kind === "neutral") continue;
    out.push({ a, b, kind, sinceTick: relation.treaties.alliance.sinceTick || undefined });
  }
  out.sort((x, y) => x.a - y.a || x.b - y.b);
  return out;
}

export function getAiWorldState(world: World): {
  empires: Array<{ id: number; name: string; color?: string; status: AiEmpireStatus; power: number; atWarWith: number[]; allies: number[]; blocId?: string }>;
  relations: AiRelationView[];
  blocs: AiBloc[];
  playerImpact: { allies: number[]; blocIds: string[]; threats: number[]; wars: number[] };
  stats: AiWorldState["stats"] & { blocs: number };
} {
  const fg = ensureFg(world);
  const aw = fg.aiWorld;
  const playerId = world.playerEmpireId;
  const empires = world.empires.map((empire) => {
    const atWarWith: number[] = [];
    for (const other of world.empires) {
      if (other.id === empire.id || other.dead) continue;
      if (atWarWithFn(world, empire.id, other.id)) atWarWith.push(other.id);
    }
    const allies: number[] = [];
    for (const other of world.empires) {
      if (other.id === empire.id) continue;
      if (treatyActive(world, empire.id, other.id, "alliance") || treatyActive(world, empire.id, other.id, "defensive") || treatyActive(world, empire.id, other.id, "federation")) allies.push(other.id);
    }
    const bloc = aw.blocs.find((entry) => entry.members.includes(empire.id));
    let status: AiEmpireStatus = empire.dead ? (aw.statuses[empire.id]?.state ?? "collapsed") : (aw.statuses[empire.id]?.state ?? "active");
    if (!empire.dead && status === "active" && (empire.systems.length <= 2 || getEmpireFleetPower(world, empire.id) < 15)) status = "weakened";
    if (!empire.dead && bloc?.kind === "commonwealth") status = "commonwealth";
    return {
      id: empire.id,
      name: empire.name,
      color: empire.color,
      status,
      power: getEmpireFleetPower(world, empire.id),
      atWarWith: atWarWith.sort((a, b) => a - b),
      allies: allies.sort((a, b) => a - b),
      blocId: bloc?.id,
    };
  });
  const playerEmpire = world.empires.find((empire) => empire.id === playerId);
  const playerImpact = {
    allies: playerEmpire ? world.empires.filter((other) => !other.dead && other.id !== playerId
      && (treatyActive(world, playerId, other.id, "alliance") || treatyActive(world, playerId, other.id, "defensive") || treatyActive(world, playerId, other.id, "federation")))
      .map((other) => other.id).sort((a, b) => a - b) : [],
    blocIds: aw.blocs.filter((bloc) => bloc.members.includes(playerId) || bloc.members.some((memberId) => treatyActive(world, playerId, memberId, "trade"))).map((bloc) => bloc.id),
    threats: playerEmpire ? world.empires.filter((other) => !other.dead && other.id !== playerId && atWarWithFn(world, playerId, other.id)).map((other) => other.id).sort((a, b) => a - b) : [],
    wars: fg.wars.filter((war) => warSideOf(world, war.id, playerId) !== 0).map((war) => war.id),
  };
  return {
    empires,
    relations: getAiRelations(world),
    blocs: aw.blocs.map((bloc) => ({ ...bloc, members: [...bloc.members] })),
    playerImpact,
    stats: { ...aw.stats, blocs: aw.blocs.length },
  };
}

function atWarWithFn(world: World, a: number, b: number): boolean {
  return atWarWith(world, a, b);
}

// ------------------------------------------------------------------ карта: системы/столицы/линии

export interface KnownSystemView {
  id: number;
  name: string;
  x: number;
  y: number;
  sector: "galaxy" | "relic";
  ownerId: number;
  /** столица какой империи (null — не столица) */
  capitalOf: number | null;
  known: boolean;
  visible: boolean;
  role?: string;
}

export interface EmpireCapitalView {
  empireId: number;
  name: string;
  color: string;
  systemId: number;
  systemName: string;
  x: number;
  y: number;
  alive: boolean;
  isPlayer: boolean;
  status: AiEmpireStatus;
  blocId?: string;
  vassalOf?: number;
}

/**
 * Системы для политической карты: галактика всегда (known/visible флагами),
 * сектор «Реликтовый Предел» — ТОЛЬКО после revealSector (миссия 10/Врата).
 */
export function getKnownSystems(world: World, empireId: number = world.playerEmpireId): KnownSystemView[] {
  const fg = ensureFg(world);
  const sectorVisible = !!fg.ancients?.sector.discovered;
  const capitals = new Map<number, number>();
  for (const empire of world.empires) {
    if (empire.dead) continue;
    capitals.set(empire.capitalSystemId, empire.id);
  }
  const out: KnownSystemView[] = [];
  for (const system of world.systems) {
    if (system.sector === "relic" && !sectorVisible) continue;
    out.push({
      id: system.id,
      name: system.name,
      x: system.x,
      y: system.y,
      sector: system.sector === "relic" ? "relic" : "galaxy",
      ownerId: system.ownerId,
      capitalOf: capitals.get(system.id) ?? null,
      known: system.knownBy.includes(empireId) || system.ownerId === empireId,
      visible: system.visibleTo.includes(empireId),
      role: system.role,
    });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/** Столицы империй и их политический статус (для узлов карты/линий). */
export function getEmpireCapitals(world: World): EmpireCapitalView[] {
  ensureFg(world);
  const state = getAiWorldState(world);
  const statusById = new Map(state.empires.map((empire) => [empire.id, empire]));
  const overlordOf = new Map<number, number>();
  for (const empire of world.empires) {
    if (empire.dead) continue;
    for (const vassalId of advancedOf(world, empire.id).vassals) overlordOf.set(vassalId, empire.id);
  }
  const out: EmpireCapitalView[] = [];
  for (const empire of world.empires.slice().sort((a, b) => a.id - b.id)) {
    const system = world.systems[empire.capitalSystemId];
    const view = statusById.get(empire.id);
    out.push({
      empireId: empire.id,
      name: empire.name,
      color: empire.color,
      systemId: empire.capitalSystemId,
      systemName: system?.name ?? "",
      x: system?.x ?? 0,
      y: system?.y ?? 0,
      alive: !empire.dead,
      isPlayer: empire.id === world.playerEmpireId,
      status: view?.status ?? (empire.dead ? "collapsed" : "active"),
      blocId: view?.blocId,
      vassalOf: overlordOf.get(empire.id),
    });
  }
  return out;
}

/** Готовый срез для политической карты: системы, столицы, линии, блоки, сектор. */
export function getPoliticalMap(world: World): {
  systems: KnownSystemView[];
  capitals: EmpireCapitalView[];
  relations: AiRelationView[];
  blocs: AiBloc[];
  sector: { discovered: boolean; generated: boolean; visibleSystems: number };
  playerImpact: ReturnType<typeof getAiWorldState>["playerImpact"];
} {
  const state = getAiWorldState(world);
  const sector = ensureFg(world).ancients?.sector;
  return {
    systems: getKnownSystems(world),
    capitals: getEmpireCapitals(world),
    relations: state.relations,
    blocs: state.blocs,
    sector: {
      discovered: !!sector?.discovered,
      generated: !!sector?.generated,
      visibleSystems: sector?.discovered ? sector.systems.length : 0,
    },
    playerImpact: state.playerImpact,
  };
}

export function getAiWorldHud(world: World): { activeWars: number; alliances: number; federations: number; pendingEvents: number; threatLevel: "low" | "medium" | "high" } {
  const state = getAiWorldState(world);
  const pendingEvents = getAiWorldEvents(world).length;
  const threatLevel = state.playerImpact.threats.length >= 2 ? "high" : state.playerImpact.threats.length === 1 || state.playerImpact.wars.length > 0 ? "medium" : "low";
  return {
    activeWars: state.stats.wars,
    alliances: state.stats.alliances,
    federations: state.stats.federations,
    pendingEvents,
    threatLevel,
  };
}

export function aiWorldEventChoice(world: World, empireId: number, eventId: number, choiceId: string): { ok: boolean; messageRu?: string } {
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Событие доступно только игроку" };
  const aw = aiWorld(world);
  const event = aw.events.find((entry) => entry.id === eventId);
  if (!event) return { ok: false, messageRu: "Событие не найдено" };
  if (event.resolved) return { ok: false, messageRu: "Событие уже решено" };
  if (event.targetEmpireId !== undefined && event.targetEmpireId !== empireId) return { ok: false, messageRu: "Событие адресовано другой империи" };
  if (event.expiresTick <= world.tick) return { ok: false, messageRu: "Событие истекло" };
  const choice = event.choices.find((entry) => entry.id === choiceId);
  if (!choice) return { ok: false, messageRu: "Вариант не найден" };
  event.resolved = true;
  event.choiceId = choiceId;
  for (const effect of choice.effects) {
    if (effect.target.startsWith("merge_into:")) {
      const fromId = Number(effect.target.slice("merge_into:".length));
      if (Number.isFinite(fromId)) mergeEmpire(world, fromId, empireId, "accession");
      continue;
    }
    if (effect.target.startsWith("war:")) {
      const targetId = Number(effect.target.slice("war:".length));
      if (Number.isFinite(targetId)) {
        applyCommandAs(world, empireId, { type: "declare_war", targetEmpireId: targetId, cb: "humiliation" });
      }
      continue;
    }
    applyCampaignEffect(world, empireId, effect.target, effect.value);
  }
  addNews(world, event.kind === "trade_bloc" ? "trade_bloc" : "call_to_arms", event.fromEmpireId, empireId, event.titleRu, "Решение игрока: " + choice.labelRu + ".", "info", event.kind === "trade_bloc" ? "bloc" : "ally");
  logEvent(world, "diplomacy", "info", "Мировая политика: " + event.titleRu + " — " + choice.labelRu + ".", undefined, empireId);
  return { ok: true, messageRu: choice.labelRu };
}

// ------------------------------------------------------------------ force API для QA

export function forceCollapse(world: World, empireId: number): boolean {
  const empire = empireById(world, empireId);
  if (!empire || empire.dead || empire.isPlayer) return false;
  distributeCollapse(world, empireId);
  return true;
}

export function forceAbsorb(world: World, strongId: number, weakId: number): boolean {
  const strong = empireById(world, strongId);
  const weak = empireById(world, weakId);
  if (!strong || !weak || strong.dead || weak.dead || weak.isPlayer) return false;
  mergeEmpire(world, weakId, strongId, "annexation");
  return true;
}

export function forceMerge(world: World, fromId: number, toId: number): boolean {
  return forceAbsorb(world, toId, fromId);
}

export function forceCentralizeFederation(world: World, federationId: number): boolean {
  const fg = ensureFg(world);
  const federation = fg.federations.find((entry) => entry.id === federationId);
  if (!federation || federation.members.length < 2) return false;
  if (federation.members.includes(world.playerEmpireId)) return false;
  const president = federation.members.slice().sort((a, b) => a - b)[0]!;
  for (const memberId of federation.members.slice().sort((a, b) => a - b)) {
    if (memberId !== president) mergeEmpire(world, memberId, president, "centralization");
  }
  fg.federations = fg.federations.filter((entry) => entry.id !== federationId);
  aiWorld(world).stats.commonwealths += 1;
  addNews(world, "centralization", president, undefined, "Единая империя", "Федерация централизовалась в единую империю.", "good", null);
  return true;
}

// ------------------------------------------------------------------ фаза

export function aiWorldPhase(world: World): void {
  if (world.tick % AI_WORLD_INTERVAL !== 0) return;
  const fg = ensureFg(world);
  const aw = fg.aiWorld;
  if (aw.lastPhaseTick === 0) aw.lastPhaseTick = Math.max(0, world.tick - AI_WORLD_INTERVAL);
  recordWarDeltas(world);
  recordTreatyDeltas(world);
  recordFederationDeltas(world);
  aiPairDemands(world);
  processEmpireLifecycle(world);
  processFederations(world);
  const tradeBlocs = buildTradeBlocs(world);
  createPlayerEvents(world, tradeBlocs);
  // Статистика и флаги кампании.
  const aiWars = fg.wars.filter((war) => {
    const a = empireById(world, war.attackerId);
    const b = empireById(world, war.defenderId);
    return (a && !a.isPlayer) || (b && !b.isPlayer);
  }).length;
  const alliances = fg.relations ? Object.values(fg.relations).filter((relation) => relation.treaties.alliance.active || relation.treaties.defensive.active).length : 0;
  aw.stats.wars = aiWars;
  aw.stats.alliances = alliances;
  aw.stats.federations = fg.federations.length;
  const campaign = fg.campaign;
  campaign.flags.ai_war = aiWars > 0 ? 1 : 0;
  campaign.flags.ai_federation = fg.federations.length > 0 ? 1 : 0;
  campaign.flags.ai_trade_bloc = tradeBlocs.length > 0 ? 1 : 0;
  aw.lastPhaseTick = world.tick;
}

export function ensureAiWorld(world: World): AiWorldState {
  return ensureFg(world).aiWorld;
}
