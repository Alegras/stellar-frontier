/**
 * АНОМАЛИИ И АРХЕОЛОГИЯ (M9): 60 аномалий, 6 археологических цепочек, артефакты «Шёпота»,
 * первокрытие, лор-записи. docs/11_campaign_and_free_flight.md §5, GDD §5.6, §14.8–14.9.
 *
 * Правила:
 *  - детерминизм: раскладка аномалий — локальный PRNG от (seed мира, соль), глобальный rngState не трогаем;
 *  - данные могут быть пустыми — тогда фаза пассивна (тесты/контент подставляют каталог);
 *  - награды и артефакты выдаются ровно один раз (investigated/completed);
 *  - первокрытие: первое исследование аномалии даёт бонус и запись в журнал.
 */
import { ANOMALIES, ARCHAEOLOGY, LORE, TECH_BY_ID } from "@sf/data";
import type { AnomalyDef, ArchaeologyDef, LoreDef } from "@sf/data";
import type { AnomalyState, ArchaeologyState } from "./fullgame";
import { ensureFg, pushJournal } from "./fullgame";
import { empireById, logEvent } from "./economy";
import { hash32, splitmix32 } from "./prng";
import { SECRET_ARTIFACTS, applyCampaignEffect } from "./campaign";
import type { Empire, World } from "./types";

// ------------------------------------------------------------------ константы

/** Сколько аномалий раскладывается по галактике за кампанию (док 11 §9: 60). */
export const ANOMALY_TARGET_COUNT = 60;
/** Проверка обнаружения раз в N тактов (дешево и детерминированно). */
export const ANOMALY_PHASE_INTERVAL = 4;
/** Доля бонуса первокрытия (50% от награды Credits). */
const FIRST_DISCOVERY_BONUS_PCT = 50;
/** Распределение «безымянных» очков науки по школам (док GDD §14.9: 60/25/15). */
const SCIENCE_SPLIT = { physics: 60, society: 25, engineering: 15 } as const;

export interface AnomalyCatalog {
  anomalies: readonly AnomalyDef[];
  archaeology: readonly ArchaeologyDef[];
  lore: readonly LoreDef[];
}

export function defaultAnomalyCatalog(): AnomalyCatalog {
  return { anomalies: ANOMALIES, archaeology: ARCHAEOLOGY, lore: LORE };
}

function resolveCatalog(override?: Partial<AnomalyCatalog>): AnomalyCatalog {
  const base = defaultAnomalyCatalog();
  return {
    anomalies: override?.anomalies ?? base.anomalies,
    archaeology: override?.archaeology ?? base.archaeology,
    lore: override?.lore ?? base.lore,
  };
}

// ------------------------------------------------------------------ утилиты

function playerEmpireOf(world: World): Empire | undefined {
  return empireById(world, world.playerEmpireId);
}

function fleetPresence(world: World, empireId: number, systemId: number): boolean {
  return world.fleets.some((fleet) => fleet.empireId === empireId && fleet.systemId === systemId && fleet.ships.length > 0);
}

function isScienceSchool(value: string): boolean {
  return value === "physics" || value === "society" || value === "engineering";
}

/** Раскладывает «безымянные» очки науки по трём школам (целочисленно, без потерь). */
function grantScience(world: World, empireId: number, amount: number): void {
  if (amount <= 0) return;
  const totalWeight = SCIENCE_SPLIT.physics + SCIENCE_SPLIT.society + SCIENCE_SPLIT.engineering;
  let assigned = 0;
  const schools: [keyof typeof SCIENCE_SPLIT, number][] = [
    ["physics", Math.floor((amount * SCIENCE_SPLIT.physics) / totalWeight)],
    ["society", Math.floor((amount * SCIENCE_SPLIT.society) / totalWeight)],
    ["engineering", 0],
  ];
  for (const [, value] of schools) assigned += value;
  schools[2] = ["engineering", amount - assigned];
  for (const [school, value] of schools) {
    if (value > 0) applyCampaignEffect(world, empireId, "science." + school, value);
  }
}

// ------------------------------------------------------------------ генерация

function shuffleDeterministic<T>(rnd: () => number, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** Раскладка аномалий по системам (детерминированно от seed мира). */
function generateAnomalies(world: World, catalog: AnomalyCatalog): void {
  const fg = ensureFg(world);
  if (catalog.anomalies.length === 0) return;
  if (world.systems.length === 0) return;
  // splitmix32 отдаёт uint32 → нормализуем в [0,1) для индексов и перемешивания
  const seedFn = splitmix32(hash32(world.seed, 0xa40a1e, world.systems.length));
  const rnd = (): number => seedFn() / 4294967296;
  const systems = shuffleDeterministic(rnd, [...world.systems]);
  const target = Math.min(ANOMALY_TARGET_COUNT, systems.length);
  for (let index = 0; index < target; index++) {
    const system = systems[index]!;
    const def = catalog.anomalies[Math.floor(rnd() * catalog.anomalies.length)]!;
    const planet = system.planets.length > 0 ? system.planets[Math.floor(rnd() * system.planets.length)] : null;
    const anomaly: AnomalyState = {
      id: def.id + "@" + system.id,
      systemId: system.id,
      planetId: planet ? planet.id : null,
      titleRu: def.titleRu,
      kind: def.kind,
      discovered: false,
      investigated: false,
      chainId: def.chainId,
      step: 0,
      rewardCredits: def.rewardCredits,
      rewardScience: def.rewardScience,
      artifact: def.artifact,
    };
    fg.anomalies.push(anomaly);
  }
  fg.journal.push({ tick: world.tick, kind: "anomaly", textRu: "В галактике зафиксированы сигнатуры аномалий: " + target + "." });
  logEvent(world, "anomaly", "info", "В галактике зафиксированы сигнатуры аномалий: " + target + ".", undefined, world.playerEmpireId);
}

/** Обнаружение: аномалия в системе, которую игрок знает (скан/прыжок). */
function discoverKnownAnomalies(world: World, catalog: AnomalyCatalog): void {
  const fg = ensureFg(world);
  const empire = playerEmpireOf(world);
  if (!empire) return;
  for (const anomaly of fg.anomalies) {
    if (anomaly.discovered) continue;
    const system = world.systems.find((item) => item.id === anomaly.systemId);
    if (!system) continue;
    if (!system.knownBy.includes(empire.id)) continue;
    anomaly.discovered = true;
    pushJournal(fg, world.tick, "anomaly", "Обнаружена аномалия: " + anomaly.titleRu + " (" + system.name + ").");
    logEvent(world, "anomaly", "info", "Обнаружена аномалия: " + anomaly.titleRu + " в системе " + system.name + ".", system.id, empire.id);
    unlockLore(world, catalog, (def) => matchesLore(def, anomaly.kind, anomaly.chainId));
  }
}

/**
 * Лор-записи (150): выдаются по unlockCondition/category, каждая ровно один раз.
 * Поддерживаем подстроки: "anomaly", "archaeology", "derelict", "silent_star", chainId, "discovery".
 */
function matchesLore(def: LoreDef, kind: string, chainId: string | null): boolean {
  const condition = (def.unlockCondition ?? "").toLowerCase();
  if (condition.length === 0) return true;
  if (condition.includes(kind)) return true;
  if (chainId && condition.includes(chainId.toLowerCase())) return true;
  if (condition.includes("discovery") || condition.includes("anomal")) return true;
  if (def.category && condition.includes(def.category.toLowerCase())) return true;
  return false;
}

/** Максимальный тир исследованных технологий империи (для условий лора tech_tier>=N). */
function maxTechTier(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  let best = 0;
  for (const techId of empire.techs.completed) {
    const tier = TECH_BY_ID[techId]?.tier ?? 0;
    if (tier > best) best = tier;
  }
  return best;
}

/**
 * Условия авто-выдачи лора из данных: "start", "tick>=N", "tech_tier>=N".
 * События аномалий/археологии выдаются отдельно через matchesLore.
 */
function loreConditionMet(world: World, def: LoreDef): boolean {
  const condition = (def.unlockCondition ?? "").toLowerCase();
  if (condition.length === 0) return false;
  if (condition === "start") return true;
  const comparison = /^([a-z_]+)\s*(>=|<=|==|=|>|<)\s*(-?\d+)$/.exec(condition);
  if (!comparison) return false;
  const name = comparison[1]!;
  const op = comparison[2]!;
  const raw = Number.parseInt(comparison[3]!, 10);
  const value = name === "tick" ? world.tick
    : name === "tech_tier" ? maxTechTier(world, world.playerEmpireId)
      : name === "artifacts" ? ensureFg(world).campaign.artifactCount
        : Number.NaN;
  if (!Number.isFinite(value)) return false;
  return op === ">=" ? value >= raw
    : op === "<=" ? value <= raw
      : op === ">" ? value > raw
        : op === "<" ? value < raw
          : value === raw;
}

function unlockLore(world: World, catalog: AnomalyCatalog, predicate: (def: LoreDef) => boolean): void {
  if (catalog.lore.length === 0) return;
  const fg = ensureFg(world);
  let unlocked = 0;
  for (const def of catalog.lore) {
    if ((fg.campaign.flags["lore." + def.id] ?? 0) > 0) continue;
    if (!predicate(def)) continue;
    fg.campaign.flags["lore." + def.id] = 1;
    pushJournal(fg, world.tick, "lore", def.titleRu + ": " + def.textRu);
    unlocked += 1;
    if (unlocked >= 3) break; // не заваливаем журнал за один такт
  }
}

// ------------------------------------------------------------------ фаза

/** Фаза аномалий: раскладка (один раз), обнаружение, авто-выдача лора. */
export function anomalyPhase(world: World, override?: Partial<AnomalyCatalog>): void {
  const fg = ensureFg(world);
  const catalog = resolveCatalog(override);

  if (catalog.anomalies.length > 0) {
    if (fg.anomalies.length === 0) generateAnomalies(world, catalog);
    if (world.tick % ANOMALY_PHASE_INTERVAL === 0) discoverKnownAnomalies(world, catalog);
  }

  // Лор по условиям данных (start/tick/tech_tier) — не зависит от аномалий.
  if (catalog.lore.length > 0 && world.tick % ANOMALY_PHASE_INTERVAL === 0) {
    unlockLore(world, catalog, (def) => loreConditionMet(world, def));
  }
}

/** Аномалии конкретной системы (для UI/тестов). */
export function anomaliesInSystem(world: World, systemId: number): AnomalyState[] {
  return ensureFg(world).anomalies.filter((anomaly) => anomaly.systemId === systemId);
}

/** Аномалии, которые можно исследовать прямо сейчас (обнаружены, не исследованы). */
export function investigatableAnomalies(world: World): AnomalyState[] {
  return ensureFg(world).anomalies.filter((anomaly) => anomaly.discovered && !anomaly.investigated);
}

export function archaeologyState(world: World, chainId: string): ArchaeologyState | null {
  return ensureFg(world).archaeology.find((entry) => entry.chainId === chainId) ?? null;
}

// ------------------------------------------------------------------ исследование

/** Исследование аномалии: награды, первокрытие, артефакт, старт археологии. */
export function investigateAnomaly(
  world: World,
  empireId: number,
  anomalyId: string,
  override?: Partial<AnomalyCatalog>,
): { ok: boolean; messageRu?: string } {
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Исследование доступно только игроку" };
  const fg = ensureFg(world);
  const catalog = resolveCatalog(override);
  const anomaly = fg.anomalies.find((item) => item.id === anomalyId);
  if (!anomaly) return { ok: false, messageRu: "Аномалия не найдена" };
  if (!anomaly.discovered) return { ok: false, messageRu: "Аномалия ещё не обнаружена" };
  if (anomaly.investigated) return { ok: false, messageRu: "Аномалия уже исследована" };
  if (!fleetPresence(world, empireId, anomaly.systemId)) {
    return { ok: false, messageRu: "Нужен корабль в системе аномалии" };
  }

  anomaly.investigated = true;
  // «Первокрытие»: бонус за первую исследованную аномалию партии (в симуляции исследует только игрок)
  const firstDiscovery = (fg.campaign.flags["firstAnomalyInvestigated"] ?? 0) === 0;
  fg.campaign.flags["firstAnomalyInvestigated"] = 1;
  fg.campaign.flags["firstDiscovery." + anomaly.id] = 1;

  let credits = anomaly.rewardCredits;
  if (firstDiscovery && credits > 0) credits += Math.round((credits * FIRST_DISCOVERY_BONUS_PCT) / 100);
  applyCampaignEffect(world, empireId, "credits", credits);
  grantScience(world, empireId, anomaly.rewardScience);

  if (anomaly.artifact) {
    fg.campaign.artifactCount += 1;
    fg.campaign.secretLine = Math.max(fg.campaign.secretLine, Math.min(SECRET_ARTIFACTS, fg.campaign.secretLine + 1));
    pushJournal(fg, world.tick, "artifact", "Найден артефакт Предтеч: " + anomaly.titleRu + ".");
    logEvent(world, "anomaly", "good", "Найден артефакт Предтеч: " + anomaly.titleRu + ".", anomaly.systemId, empireId);
  }

  // старт археологической цепочки, если она привязана к аномалии
  if (anomaly.chainId) {
    const existing = fg.archaeology.find((entry) => entry.chainId === anomaly.chainId);
    if (!existing) {
      const def = catalog.archaeology.find((item) => item.chainId === anomaly.chainId);
      if (def) {
        fg.archaeology.push({
          chainId: def.chainId,
          titleRu: def.titleRu,
          step: 0,
          steps: Math.max(1, def.steps),
          startedTick: world.tick,
          completed: false,
          anomalyId: anomaly.id,
        });
        pushJournal(fg, world.tick, "archaeology", "Начата археологическая цепочка: " + def.titleRu + ".");
      }
    }
  }

  unlockLore(world, catalog, (def) => matchesLore(def, anomaly.kind, anomaly.chainId));
  pushJournal(
    fg,
    world.tick,
    "anomaly",
    "Аномалия исследована: " + anomaly.titleRu + " (+" + credits + " Cr" + (firstDiscovery ? ", первокрытие" : "") + ").",
  );
  logEvent(world, "anomaly", "good", "Аномалия исследована: " + anomaly.titleRu + " (+" + credits + " Cr).", anomaly.systemId, empireId);
  return { ok: true, messageRu: anomaly.titleRu };
}

// ------------------------------------------------------------------ археология

/** Шаг археологической цепочки: шаги, награды, артефакт, завершение. */
export function archaeologyStep(
  world: World,
  empireId: number,
  chainId: string,
  override?: Partial<AnomalyCatalog>,
): { ok: boolean; messageRu?: string } {
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Археология доступна только игроку" };
  const fg = ensureFg(world);
  const catalog = resolveCatalog(override);
  const def = catalog.archaeology.find((item) => item.chainId === chainId);
  if (!def) return { ok: false, messageRu: "Археологическая цепочка не найдена" };

  let entry = fg.archaeology.find((item) => item.chainId === chainId);
  if (!entry) {
    // цепочку можно начать только у обнаруженной аномалии
    const anomaly = fg.anomalies.find((item) => item.chainId === chainId && item.discovered);
    if (!anomaly) return { ok: false, messageRu: "Нужна обнаруженная аномалия этой цепочки" };
    if (!fleetPresence(world, empireId, anomaly.systemId)) {
      return { ok: false, messageRu: "Нужен корабль в системе аномалии" };
    }
    entry = {
      chainId: def.chainId,
      titleRu: def.titleRu,
      step: 0,
      steps: Math.max(1, def.steps),
      startedTick: world.tick,
      completed: false,
      anomalyId: anomaly.id,
    };
    fg.archaeology.push(entry);
    pushJournal(fg, world.tick, "archaeology", "Начата археологическая цепочка: " + def.titleRu + ".");
  }
  if (entry.completed) return { ok: false, messageRu: "Цепочка уже завершена" };
  const anchor = fg.anomalies.find((item) => item.id === entry.anomalyId);
  if (anchor && !fleetPresence(world, empireId, anchor.systemId)) {
    return { ok: false, messageRu: "Нужен корабль в системе раскопок" };
  }

  entry.step = Math.min(entry.steps, entry.step + 1);
  if (entry.step >= entry.steps) {
    entry.completed = true;
    const reward = def.reward;
    applyCampaignEffect(world, empireId, "credits", reward?.credits ?? 0);
    applyCampaignEffect(world, empireId, "alloys", reward?.alloys ?? 0);
    if ((reward?.science ?? 0) > 0) grantScience(world, empireId, reward!.science);
    if (reward?.unlock) fg.campaign.flags["unlock." + reward.unlock] = 1;
    if (def.artifact) {
      fg.campaign.artifactCount += 1;
      fg.campaign.secretLine = Math.max(fg.campaign.secretLine, Math.min(SECRET_ARTIFACTS, fg.campaign.secretLine + 1));
      pushJournal(fg, world.tick, "artifact", "Артефакт «Шёпота»: " + def.titleRu + ".");
    }
    unlockLore(world, catalog, (lore) => matchesLore(lore, "archaeology", chainId));
    pushJournal(fg, world.tick, "archaeology", "Археология завершена: " + def.titleRu + ".");
    logEvent(world, "anomaly", "good", "Археологическая цепочка завершена: " + def.titleRu + ".", anchor ? anchor.systemId : undefined, empireId);
    return { ok: true, messageRu: def.titleRu };
  }

  pushJournal(fg, world.tick, "archaeology", "Археология «" + def.titleRu + "»: шаг " + entry.step + "/" + entry.steps + ".");
  logEvent(world, "anomaly", "info", "Археология «" + def.titleRu + "»: шаг " + entry.step + "/" + entry.steps + ".", anchor ? anchor.systemId : undefined, empireId);
  return { ok: true, messageRu: entry.step + "/" + entry.steps };
}
