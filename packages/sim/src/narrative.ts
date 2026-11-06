/**
 * СОБЫТИЯ И ЦЕПОЧКИ (M9): 120 событий / 40 цепочек, выборы с ценой, флаги, последствия.
 * docs/11_campaign_and_free_flight.md §4, GDD §14.7.
 *
 * Правила:
 *  - пул без повторов: каждое событие срабатывает один раз (NarrativeState.fired);
 *  - триггеры: такт/акт/условия/ветка; проверка пула раз в EVENT_CHECK_INTERVAL тактов;
 *  - цепочки: шаг N+1 доступен после выбора в шаге N (chainStep), с кулдауном;
 *  - детерминизм: выбор — по локальному PRNG от (seed мира, такт), глобальный rngState не трогаем.
 */
import { NARRATIVE_EVENTS } from "@sf/data";
import type { EventChoiceDef, NarrativeEventDef } from "@sf/data";
import type { NarrativeEvent } from "./fullgame";
import { isDlcDialogueActive } from "./dlc";
import { ensureFg, pushJournal } from "./fullgame";
import { empireById, logEvent } from "./economy";
import { hash32, splitmix32 } from "./prng";
import { applyCampaignEffect, startCampaignMission } from "./campaign";
import type { Empire, World } from "./types";

// ------------------------------------------------------------------ константы

/** Проверка пула событий раз в N тактов (детерминированно, дешево). */
export const EVENT_CHECK_INTERVAL = 5;
/** Сколько событий может «висеть» одновременно. */
export const MAX_PENDING_EVENTS = 2;
/** Срок жизни необработанного события. */
export const EVENT_TTL_TICKS = 150;
/** Минимальный интервал между новыми событиями. */
export const EVENT_COOLDOWN_TICKS = 120;
/** Минимальный интервал между шагами цепочки. */
export const CHAIN_COOLDOWN_TICKS = 60;

export interface NarrativeCatalog {
  events: readonly NarrativeEventDef[];
}

export function defaultNarrativeCatalog(): NarrativeCatalog {
  return { events: NARRATIVE_EVENTS };
}

function resolveCatalog(override?: Partial<NarrativeCatalog>): NarrativeCatalog {
  const base = defaultNarrativeCatalog();
  return { events: override?.events ?? base.events };
}

// ------------------------------------------------------------------ условия

function playerEmpireOf(world: World): Empire | undefined {
  return empireById(world, world.playerEmpireId);
}

function fleetPowerOf(world: World, empireId: number): number {
  let total = 0;
  for (const fleet of world.fleets) {
    if (fleet.empireId !== empireId) continue;
    for (const ship of fleet.ships) total += ship.fleetPower;
  }
  return total;
}

/** Условия события: {kind, target?, value?}. Неизвестные типы нейтральны. */
export function eventConditionsMet(world: World, event: NarrativeEventDef): boolean {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  if (event.minAct !== undefined && campaign.act < event.minAct) return false;
  const empire = playerEmpireOf(world);
  for (const condition of event.conditions ?? []) {
    const value = condition.value ?? 1;
    const target = condition.target ?? "";
    switch (condition.kind) {
      case "act":
        if (campaign.act < value) return false;
        break;
      case "tick":
        if (world.tick < value) return false;
        break;
      case "flag":
        if ((campaign.flags[target] ?? 0) < value) return false;
        break;
      case "resource": {
        const key = target as keyof Empire["resources"];
        if (!empire || (empire.resources[key] ?? 0) < value) return false;
        break;
      }
      case "science": {
        const key = target as keyof Empire["science"];
        if (!empire || (empire.science[key] ?? 0) < value) return false;
        break;
      }
      case "systems":
        if (!empire || empire.systems.length < value) return false;
        break;
      case "colonies":
        if (!empire || empire.colonies.length < value) return false;
        break;
      case "branch":
        if (campaign.branch !== target) return false;
        break;
      case "crisis":
        if (fg.crises.length < value) return false;
        break;
      case "federation":
        if (fg.federations.length < value) return false;
        break;
      case "fleet_power":
        if (fleetPowerOf(world, world.playerEmpireId) < value) return false;
        break;
      case "relation": {
        if (!empire) return false;
        // отношения хранятся в empire.relations (мнение о других империях)
        const opinions = Object.values(empire.relations ?? {}).map((relation) => relation.opinion);
        if (Math.max(0, ...opinions) < value) return false;
        break;
      }
      default:
        break;
    }
  }
  return true;
}

// ------------------------------------------------------------------ выбор из пула

interface EventCandidate {
  def: NarrativeEventDef;
  weight: number;
}

function firstStepByChain(events: readonly NarrativeEventDef[]): Record<string, number> {
  const steps: Record<string, number> = {};
  for (const def of events) {
    const current = steps[def.chainId];
    if (current === undefined || def.step < current) steps[def.chainId] = def.step;
  }
  return steps;
}

function pickWeighted(rnd: () => number, candidates: EventCandidate[]): EventCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0));
  let total = 0;
  for (const candidate of sorted) total += Math.max(0, candidate.weight);
  if (total <= 0) return sorted[0] ?? null;
  let roll = rnd() * total;
  for (const candidate of sorted) {
    roll -= Math.max(0, candidate.weight);
    if (roll < 0) return candidate;
  }
  return sorted[sorted.length - 1] ?? null;
}

function snapshotEvent(def: NarrativeEventDef, tick: number): NarrativeEvent {
  return {
    id: def.id,
    chainId: def.chainId,
    step: def.step,
    titleRu: def.titleRu,
    textRu: def.textRu,
    choices: def.choices.map((choice) => ({
      id: choice.id,
      labelRu: choice.labelRu,
      effects: choice.effects.map((effect) => ({ target: effect.target, value: effect.value })),
      flag: choice.flag,
      missionId: choice.missionId,
    })),
    triggeredTick: tick,
    expiresTick: tick + EVENT_TTL_TICKS,
  };
}

// ------------------------------------------------------------------ фаза

/**
 * Фаза событий: истёкшие pending, продолжение цепочек, новые события из пула.
 * Пустой контент → фаза ничего не делает (тесты подставляют каталог).
 */
export function narrativePhase(world: World, override?: Partial<NarrativeCatalog>): void {
  const catalog = resolveCatalog(override);
  const fg = ensureFg(world);
  const narrative = fg.narrative;

  // 1. Истечение pending
  if (narrative.pending.length > 0) {
    const expired = narrative.pending.filter((event) => event.expiresTick <= world.tick);
    if (expired.length > 0) {
      narrative.pending = narrative.pending.filter((event) => event.expiresTick > world.tick);
      for (const event of expired) {
        pushJournal(fg, world.tick, "event", "Событие истекло: " + event.titleRu + ".");
      }
    }
  }

  // Пока открыт диалог DLC, новые события не всплывают (модалка-приоритет: диалог > событие).
  if (isDlcDialogueActive(world)) return;

  if (catalog.events.length === 0) return;
  if (world.tick % EVENT_CHECK_INTERVAL !== 0) return;
  if (narrative.pending.length >= MAX_PENDING_EVENTS) return;
  if ((narrative.cooldown["global"] ?? 0) > world.tick) return;

  // splitmix32 отдаёт uint32 → нормализуем в [0,1) для взвешенного выбора
  const seedFn = splitmix32(hash32(world.seed, world.tick, 0x5eed5eed));
  const rnd = (): number => seedFn() / 4294967296;
  const firstStep = firstStepByChain(catalog.events);
  const candidates: EventCandidate[] = [];

  for (const def of catalog.events) {
    if (narrative.fired[def.id] !== undefined) continue;
    if (narrative.pending.some((event) => event.id === def.id)) continue;
    const chainStep = narrative.chainStep[def.chainId];
    const chainFirst = firstStep[def.chainId] ?? 1;
    const isChainStart = def.step === chainFirst;
    // шаг цепочки продолжается только после выбора предыдущего шага
    if (!isChainStart && (chainStep === undefined || def.step > chainStep + 1 || def.step <= chainStep)) continue;
    if ((narrative.cooldown[def.chainId] ?? 0) > world.tick) continue;
    if (!eventConditionsMet(world, def)) continue;
    candidates.push({ def, weight: Math.max(0, def.weight ?? 1) });
  }

  const picked = pickWeighted(rnd, candidates);
  if (!picked) return;

  const event = snapshotEvent(picked.def, world.tick);
  narrative.pending.push(event);
  narrative.fired[picked.def.id] = world.tick;
  narrative.cooldown["global"] = world.tick + EVENT_COOLDOWN_TICKS;
  pushJournal(fg, world.tick, "event", "Событие: " + event.titleRu + ".");
  logEvent(world, "good", "info", "Событие: " + event.titleRu + ".", undefined, world.playerEmpireId);
}

// ------------------------------------------------------------------ выбор

export function pendingNarrativeEvents(world: World): NarrativeEvent[] {
  return [...ensureFg(world).narrative.pending];
}

export function narrativeEvent(world: World, eventId: string): NarrativeEvent | null {
  const fg = ensureFg(world);
  return fg.narrative.pending.find((event) => event.id === eventId) ?? null;
}

function choiceOf(event: NarrativeEvent, choiceId: string): EventChoiceDef | null {
  return event.choices.find((choice) => choice.id === choiceId) ?? null;
}

/** Выбор в событии: эффекты/флаги/миссия/шаг цепочки. Повторный выбор отклоняется. */
export function chooseEvent(
  world: World,
  empireId: number,
  eventId: string,
  choiceId: string,
): { ok: boolean; messageRu?: string } {
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "События доступны только игроку" };
  const fg = ensureFg(world);
  const narrative = fg.narrative;
  const event = narrative.pending.find((item) => item.id === eventId);
  if (!event) {
    if (narrative.fired[eventId] !== undefined) return { ok: false, messageRu: "Событие уже обработано" };
    return { ok: false, messageRu: "Событие не найдено или истекло" };
  }
  const choice = choiceOf(event, choiceId);
  if (!choice) return { ok: false, messageRu: "Неизвестный вариант выбора" };

  for (const effect of choice.effects) applyCampaignEffect(world, empireId, effect.target, effect.value);
  if (choice.flag) fg.campaign.flags[choice.flag] = 1;
  if (choice.missionId) {
    const missionResult = startCampaignMission(world, empireId, choice.missionId);
    if (missionResult.ok) pushJournal(fg, world.tick, "mission", "Событие открыло миссию: " + choice.missionId, choice.missionId);
  }
  narrative.chainStep[event.chainId] = Math.max(narrative.chainStep[event.chainId] ?? 0, event.step);
  narrative.cooldown[event.chainId] = world.tick + CHAIN_COOLDOWN_TICKS;
  narrative.cooldown["global"] = world.tick + EVENT_COOLDOWN_TICKS;
  narrative.pending = narrative.pending.filter((item) => item.id !== eventId);
  pushJournal(fg, world.tick, "choice", "Выбор: «" + choice.labelRu + "» (" + event.titleRu + ").");
  logEvent(world, "good", "info", "Событие «" + event.titleRu + "»: «" + choice.labelRu + "».", undefined, empireId);
  return { ok: true, messageRu: choice.labelRu };
}

/** Отложить событие без выбора: убирает из очереди (без эффектов), чтобы pending не копились. */
export function dismissEvent(
  world: World,
  empireId: number,
  eventId: string,
): { ok: boolean; messageRu?: string } {
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "События доступны только игроку" };
  const fg = ensureFg(world);
  const narrative = fg.narrative;
  const event = narrative.pending.find((item) => item.id === eventId);
  if (!event) return { ok: false, messageRu: "Событие не найдено или истекло" };
  narrative.pending = narrative.pending.filter((item) => item.id !== eventId);
  narrative.fired[eventId] = world.tick;
  narrative.cooldown["global"] = world.tick + EVENT_COOLDOWN_TICKS;
  pushJournal(fg, world.tick, "choice", "Событие отложено: " + event.titleRu + ".");
  return { ok: true, messageRu: "Событие отложено" };
}

/** Принудительный триггер события (отладка/другие системы): ставит в pending. */
export function triggerEvent(
  world: World,
  eventId: string,
  empireId?: number,
  override?: Partial<NarrativeCatalog>,
): void {
  const catalog = resolveCatalog(override);
  const fg = ensureFg(world);
  const narrative = fg.narrative;
  const def = catalog.events.find((item) => item.id === eventId);
  if (!def) return;
  if (empireId !== undefined && empireId !== world.playerEmpireId) return;
  if (narrative.pending.some((event) => event.id === eventId)) return;
  narrative.pending.push(snapshotEvent(def, world.tick));
  narrative.fired[eventId] = world.tick;
  pushJournal(fg, world.tick, "event", "Событие: " + def.titleRu + ".");
  logEvent(world, "good", "info", "Событие: " + def.titleRu + ".", undefined, world.playerEmpireId);
}