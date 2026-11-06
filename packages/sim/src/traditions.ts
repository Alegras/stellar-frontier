/**
 * ТРАДИЦИИ И ПЕРКИ (M6, GDD §8.5–8.6). 7 древ × 5 узлов + финишеры, 12 перков, 8 слотов.
 *
 * Числа (стоимость/эффекты) — в @sf/data (TRADITION_TREES/PERKS). Пока контент-команда
 * не заполнила JSON, используются детерминированные fallback-наборы ниже — они повторяют
 * GDD §8.5–8.6 и не блокируют симуляцию. Как только массивы @sf/data непусты, fallback
 * полностью игнорируется (источник истины — данные).
 *
 * Стоимость узла: 400 × 1.5^index (index 0..4 → 400/600/900/1350/2025 единства).
 */
import { PERKS, TECH_BY_ID, TRADITION_TREES } from "@sf/data";
import type { PerkDef, TraditionNodeDef, TraditionTreeDef } from "@sf/data";
import type { CommandResult, World } from "./types";
import { advancedOf, pushJournal } from "./fullgame";

/** GDD §8.6: базовое число слотов перков. */
export const BASE_PERK_SLOTS = 8;

/** GDD §8.5: стоимость узла традиции (fallback, если в данных нет cost). */
export function traditionNodeCost(index: number): number {
  return Math.round(400 * Math.pow(1.5, index));
}

// ------------------------------------------------------------------ fallback-контент (GDD §8.5)

interface FallbackNode {
  ru: string;
  descRu: string;
  effects: Record<string, number>;
}

function buildFallbackTree(
  id: string,
  ru: string,
  descRu: string,
  color: string,
  nodes: FallbackNode[],
  finisherRu: string,
  finisherDescRu: string,
  finisherEffects: Record<string, number>,
): TraditionTreeDef {
  const nodeDefs: TraditionNodeDef[] = nodes.map((node, index) => ({
    id: id + "_" + (index + 1),
    treeId: id,
    index,
    ru: node.ru,
    descRu: node.descRu,
    cost: traditionNodeCost(index),
    requires: index > 0 ? [id + "_" + index] : [],
    effects: node.effects,
  }));
  return {
    id,
    ru,
    descRu,
    color,
    nodes: nodeDefs,
    finisher: { id: id + "_finisher", ru: finisherRu, descRu: finisherDescRu, effects: finisherEffects },
  };
}

/** Fallback-древа по таблице GDD §8.5 (пока TRADITION_TREES пуст). */
const FALLBACK_TREES: TraditionTreeDef[] = [
  buildFallbackTree("discovery", "Открытие", "Наука, сенсоры и альтернативы исследований", "#4FC3F7", [
    { ru: "Пытливый разум", descRu: "+10% науки.", effects: { science_prod: 0.1 } },
    { ru: "Научные кадры", descRu: "Дополнительные исследователи (+5% науки).", effects: { science_prod: 0.05 } },
    { ru: "Дальний обзор", descRu: "+1 прыжок сенсоров.", effects: { sensor_range: 1 } },
    { ru: "Полевые лаборатории", descRu: "+10% науки.", effects: { science_prod: 0.1 } },
    { ru: "Научный плюрализм", descRu: "+1 альтернатива в науке.", effects: { extra_tech_choice: 1 } },
  ], "Первопроходец", "Бонусы науки и сенсоров после открытия систем.", { science_prod: 0.05, sensor_range: 1 }),
  buildFallbackTree("expansion", "Экспансия", "Колонизация, жильё и рост населения", "#AED581", [
    { ru: "Колониальная администрация", descRu: "−15% стоимость колонизации.", effects: { colony_cost: -0.15 } },
    { ru: "Гибкое жильё", descRu: "+5% роста населения.", effects: { pop_growth: 0.05 } },
    { ru: "Демографический натиск", descRu: "+10% роста населения.", effects: { pop_growth: 0.1 } },
    { ru: "Фронтирные аутпосты", descRu: "−20% стоимость аутпоста.", effects: { outpost_cost: -0.2 } },
    { ru: "Административный охват", descRu: "+10% влияния.", effects: { influence_prod: 0.1 } },
  ], "Фронтир", "Новые колонии стартуют сильнее (+5% роста).", { pop_growth: 0.05 }),
  buildFallbackTree("domination", "Доминирование", "Флот, урон и военный счёт", "#F06292", [
    { ru: "Флотская доктрина", descRu: "+5% флотского лимита.", effects: { fleet_cap_pct: 0.05 } },
    { ru: "Точный огонь", descRu: "+10% урона оружия.", effects: { weapon_damage: 0.1 } },
    { ru: "Штабные офицеры", descRu: "+1 флотского лимита.", effects: { fleet_cap_flat: 1 } },
    { ru: "Логистика войны", descRu: "−15% апкип флота.", effects: { fleet_upkeep: -0.15 } },
    { ru: "Военная машина", descRu: "+5% флотского лимита.", effects: { fleet_cap_pct: 0.05 } },
  ], "Тотальная война", "+25% военного счёта.", { war_score: 0.25 }),
  buildFallbackTree("prosperity", "Процветание", "Энергия, минералы, ТП и строительство", "#FFD54F", [
    { ru: "Энергосеть", descRu: "+10% энергии.", effects: { energy_prod: 0.1 } },
    { ru: "Глубокие шахты", descRu: "+10% минералов.", effects: { minerals_prod: 0.1 } },
    { ru: "Промышленный стандарт", descRu: "+10% товаров.", effects: { goods_prod: 0.1 } },
    { ru: "Строительные бригады", descRu: "+10% скорости строительства.", effects: { build_speed: 0.1 } },
    { ru: "Общественное согласие", descRu: "+15 стабильности.", effects: { stability: 15 } },
  ], "Золотой век", "+10% ко всем потокам.", { all_prod: 0.1 }),
  buildFallbackTree("harmony", "Гармония", "Счастье, стабильность и рост", "#4DB6AC", [
    { ru: "Мягкое правление", descRu: "+5 счастья.", effects: { happiness: 5 } },
    { ru: "Правопорядок", descRu: "+5 стабильности.", effects: { stability: 5 } },
    { ru: "Семейные программы", descRu: "+10% роста населения.", effects: { pop_growth: 0.1 } },
    { ru: "Гражданские институты", descRu: "+5 стабильности.", effects: { stability: 5 } },
    { ru: "Общее благо", descRu: "+15 стабильности.", effects: { stability: 15 } },
  ], "Единство", "Восстания невозможны 200 тактов (+10 стабильности).", { stability: 10 }),
  buildFallbackTree("supremacy", "Превосходство", "Щиты, скорость и мощь флота", "#BA68C8", [
    { ru: "Развёртывание", descRu: "+1 флотского лимита за каждые 10 систем.", effects: { fleet_cap_per_10_systems: 1 } },
    { ru: "Щитовые матрицы", descRu: "+10% щитов.", effects: { shield: 0.1 } },
    { ru: "Форсажные двигатели", descRu: "+10% скорости строительства.", effects: { build_speed: 0.1 } },
    { ru: "Оружейные слоты", descRu: "+10% урона оружия.", effects: { weapon_damage: 0.1 } },
    { ru: "Несокрушимость", descRu: "+15% мощи флота.", effects: { fleet_power_mult: 1.15 } },
  ], "Несокрушимость", "Флагман автоматически уходит из проигранного боя (1 раз).", { flagship_autoescape: 1 }),
  buildFallbackTree("enlightenment", "Просвещение", "Единство, перки и наука", "#90A4AE", [
    { ru: "Философия единства", descRu: "+10% единства.", effects: { unity_prod: 0.1 } },
    { ru: "Академии", descRu: "+5% науки.", effects: { science_prod: 0.05 } },
    { ru: "Просвещённые эдикты", descRu: "+5% влияния.", effects: { influence_prod: 0.05 } },
    { ru: "Право на перк", descRu: "+1 слот перка.", effects: { perk_slot: 1 } },
    { ru: "Научный расцвет", descRu: "+15% науки.", effects: { science_prod: 0.15 } },
  ], "Вознесение", "−25% стоимость перков.", { perk_cost: -0.25 }),
];

/** Fallback-перки по таблице GDD §8.6 (пока PERKS пуст). */
const FALLBACK_PERKS: PerkDef[] = [
  {
    id: "cosmic_engineering", ru: "Космическая инженерия", descRu: "Открывает мегаструктуры.", cost: 2000,
    requires: ["tier:3"], effects: { megastructure_cost: -0.1 }, unlocks: ["megastructure"],
  },
  {
    id: "ring_world", ru: "Мир-кольцо", descRu: "Позволяет строить кольцевые миры.", cost: 3000,
    requires: ["tier:4", "perk:cosmic_engineering"], effects: { megastructure_cost: -0.1 }, unlocks: ["ring_habitat"],
  },
  {
    id: "genetic_ascension", ru: "Генетическое возвышение", descRu: "+15% роста населения.", cost: 3500,
    requires: ["tier:3"], effects: { pop_growth: 0.15 },
  },
  {
    id: "synthetic_ascension", ru: "Синтетическое возвышение", descRu: "+10% ко всем потокам.", cost: 3500,
    requires: ["tier:3"], effects: { all_prod: 0.1 },
  },
  {
    id: "psionic_ascension", ru: "Псионическое возвышение", descRu: "+20% единства.", cost: 4000,
    requires: ["tier:3"], effects: { unity_prod: 0.2 },
  },
  {
    id: "diplomatic_grace", ru: "Галантная дипломатия", descRu: "+20 мнения, −25% стоимость договоров.", cost: 2500,
    requires: [], effects: { diplo_opinion: 20, treaty_cost: -0.25 },
  },
  {
    id: "imperial_army", ru: "Имперская армия", descRu: "+20% армии, −15% стоимость десанта.", cost: 2500,
    requires: [], effects: { invasion: 0.2, army_cost: -0.15 },
  },
  {
    id: "technocracy", ru: "Технократия", descRu: "+1 альтернатива в науке.", cost: 3000,
    requires: [], effects: { extra_tech_choice: 1 },
  },
  {
    id: "divine_mandate", ru: "Божественный мандат", descRu: "+20 легитимности (+5 стабильности).", cost: 3000,
    requires: ["government:theocracy"], effects: { legitimacy: 20 },
  },
  {
    id: "trade_empire", ru: "Торговая империя", descRu: "+25% торговой маржи (≥3 маршрута).", cost: 3000,
    requires: ["routes:3"], effects: { trade_margin: 0.25 },
  },
  {
    id: "master_builder", ru: "Мастер-строитель", descRu: "−25% стоимость мегаструктур.", cost: 4500,
    requires: ["perk:cosmic_engineering"], effects: { megastructure_cost: -0.25 },
  },
  {
    id: "ascension", ru: "Вознесение", descRu: "Условие победы «Технологическое вознесение».", cost: 8000,
    requires: ["perk:genetic_ascension", "perk:synthetic_ascension", "perk:psionic_ascension"],
    effects: { ascension: 1 },
  },
];

// ------------------------------------------------------------------ доступ к контенту

/** Древа традиций: данные @sf/data, иначе fallback GDD §8.5. */
export function traditionTrees(): TraditionTreeDef[] {
  return TRADITION_TREES.length > 0 ? TRADITION_TREES : FALLBACK_TREES;
}

/** Перки: данные @sf/data, иначе fallback GDD §8.6. */
export function allPerks(): PerkDef[] {
  return PERKS.length > 0 ? PERKS : FALLBACK_PERKS;
}

export function findTraditionTree(treeId: string): TraditionTreeDef | undefined {
  for (const tree of traditionTrees()) if (tree.id === treeId) return tree;
  return undefined;
}

export function findTraditionNode(treeId: string, nodeId: string): { tree: TraditionTreeDef; node: TraditionNodeDef } | undefined {
  const tree = findTraditionTree(treeId);
  if (!tree) return undefined;
  for (const node of tree.nodes) if (node.id === nodeId) return { tree, node };
  // Допускаем сокращённую запись "1"…"5" (индекс с 1) — удобно для UI/тестов.
  const index = Number(nodeId) - 1;
  if (Number.isInteger(index) && index >= 0 && index < tree.nodes.length) {
    return { tree, node: tree.nodes[index] };
  }
  return undefined;
}

export function findPerk(perkId: string): PerkDef | undefined {
  for (const perk of allPerks()) if (perk.id === perkId) return perk;
  return undefined;
}

export function findFinisher(finisherId: string): { tree: TraditionTreeDef; effects: Record<string, number> } | undefined {
  for (const tree of traditionTrees()) {
    if (tree.finisher.id === finisherId) return { tree, effects: tree.finisher.effects };
  }
  return undefined;
}

function empireOf(world: World, empireId: number) {
  for (const empire of world.empires) if (empire.id === empireId) return empire;
  return undefined;
}

// ------------------------------------------------------------------ производные бонусы

function effectsSum(effectsList: Array<Record<string, number>>, keys: string[]): number {
  let total = 0;
  for (const effects of effectsList) {
    for (const key of Object.keys(effects)) {
      if (!keys.includes(key)) continue;
      const value = effects[key];
      if (typeof value === "number" && Number.isFinite(value)) total += value;
    }
  }
  return total;
}

function unlockedEffects(world: World, empireId: number): Array<Record<string, number>> {
  const fg = world.fg;
  const adv = fg ? fg.empires[empireId] : undefined;
  if (!adv) return [];
  const out: Array<Record<string, number>> = [];
  for (const nodeId of adv.traditions.unlocked) {
    for (const tree of traditionTrees()) {
      const node = tree.nodes.find((n) => n.id === nodeId);
      if (node) { out.push(node.effects); break; }
    }
  }
  for (const finisherId of adv.traditions.finishers) {
    const finisher = findFinisher(finisherId);
    if (finisher) out.push(finisher.effects);
  }
  return out;
}

/** Слоты перков: база 8 + бонусы узлов/финишеров традиций (GDD §8.5 «+1 перк»). */
export function perkSlotsFor(world: World, empireId: number): number {
  const bonus = effectsSum(unlockedEffects(world, empireId), ["perk_slot", "perk_slots", "extra_perk"]);
  return BASE_PERK_SLOTS + Math.max(0, Math.round(bonus));
}

/** Множитель стоимости перков (финишер Просвещения «Вознесение»: −25%). */
export function perkCostMultiplier(world: World, empireId: number): number {
  let mult = 1;
  for (const effects of unlockedEffects(world, empireId)) {
    for (const key of Object.keys(effects)) {
      const value = effects[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (key === "perk_cost") mult *= 1 + value;
      else if (key === "perk_cost_mult") mult *= value;
    }
  }
  return Math.max(0.25, mult);
}

/**
 * Стоимость узла с учётом эффектов технологий "tradition_cost" (GDD §8.3: скидки школы
 * общества). Значения эффектов — доли: −0.05 = −5%.
 */
export function traditionCostFor(world: World, empireId: number, node: TraditionNodeDef): number {
  const empire = empireOf(world, empireId);
  let delta = 0;
  if (empire) {
    for (const techId of empire.techs.completed) {
      const tech = TECH_BY_ID[techId];
      if (!tech) continue;
      for (const effect of tech.effects) {
        if (effect.kind === "modifier" && effect.target === "tradition_cost" && typeof effect.value === "number") {
          delta += effect.value;
        }
      }
    }
  }
  const base = node.cost > 0 ? node.cost : traditionNodeCost(node.index);
  return Math.max(0, Math.round(base * Math.max(0.25, 1 + delta)));
}

/** Прогресс древа: открытые узлы и признак финишера. */
export function treeProgress(world: World, empireId: number, treeId: string): { unlocked: number; total: number; finished: boolean } {
  const tree = findTraditionTree(treeId);
  if (!tree) return { unlocked: 0, total: 0, finished: false };
  const fg = world.fg;
  const adv = fg ? fg.empires[empireId] : undefined;
  if (!adv) return { unlocked: 0, total: tree.nodes.length, finished: false };
  let unlocked = 0;
  for (const node of tree.nodes) if (adv.traditions.unlocked.includes(node.id)) unlocked += 1;
  return { unlocked, total: tree.nodes.length, finished: adv.traditions.finishers.includes(tree.finisher.id) };
}

// ------------------------------------------------------------------ такт

/**
 * Фаза 8b такта (M6): обслуживание кэша традиций/перков.
 * Пассивные эффекты живут в empireModifiers(), здесь только дешёвая ревизия:
 * пересчёт счётчиков древ, авто-финишеры при 5/5 и кэш слотов перков.
 */
export function traditionPhase(world: World): void {
  const fg = world.fg;
  if (!fg) return;
  for (const empire of world.empires) {
    const adv = fg.empires[empire.id];
    if (!adv) continue;
    let changed = false;
    for (const tree of traditionTrees()) {
      let count = 0;
      for (const node of tree.nodes) if (adv.traditions.unlocked.includes(node.id)) count += 1;
      if ((adv.traditions.trees[tree.id] ?? 0) !== count) {
        adv.traditions.trees[tree.id] = count;
        changed = true;
      }
      if (count >= tree.nodes.length && !adv.traditions.finishers.includes(tree.finisher.id)) {
        adv.traditions.finishers.push(tree.finisher.id);
        changed = true;
      }
    }
    const slots = perkSlotsFor(world, empire.id);
    if (adv.perkSlots !== slots) {
      adv.perkSlots = slots;
      changed = true;
    }
    if (changed) fg.revision += 1;
  }
}

// ------------------------------------------------------------------ команды

export function unlockTradition(world: World, empireId: number, treeId: string, nodeId: string): CommandResult {
  const empire = empireOf(world, empireId);
  if (!empire) return { ok: false, messageRu: "Империя не найдена" };
  if (empire.dead) return { ok: false, messageRu: "Империя пала — традиции недоступны" };
  const found = findTraditionNode(treeId, nodeId);
  if (!found) return { ok: false, messageRu: "Узел традиции не найден" };
  const { tree, node } = found;
  const adv = advancedOf(world, empireId);
  if (adv.traditions.unlocked.includes(node.id)) {
    return { ok: false, messageRu: "Этот узел традиции уже открыт" };
  }

  // Пререквизит — предыдущий узел древа (M6: строго последовательное открытие).
  const required: string[] = [];
  if (node.index > 0 && tree.nodes[node.index - 1]) required.push(tree.nodes[node.index - 1].id);
  for (const req of node.requires) if (!required.includes(req)) required.push(req);
  for (const req of required) {
    if (adv.traditions.unlocked.includes(req)) continue;
    let reqName = req;
    for (const n of tree.nodes) if (n.id === req) reqName = n.ru;
    return { ok: false, messageRu: "Сначала откройте предыдущий узел: " + reqName };
  }

  const cost = traditionCostFor(world, empireId, node);
  if (empire.resources.unity < cost) {
    return { ok: false, messageRu: "Не хватает единства: нужно " + cost + ", есть " + empire.resources.unity };
  }
  empire.resources.unity -= cost;
  adv.traditions.unitySpent += cost;
  adv.traditions.unlocked.push(node.id);
  const count = (adv.traditions.trees[tree.id] ?? 0) + 1;
  adv.traditions.trees[tree.id] = count;

  let finished = false;
  if (count >= tree.nodes.length && !adv.traditions.finishers.includes(tree.finisher.id)) {
    adv.traditions.finishers.push(tree.finisher.id);
    finished = true;
  }
  pushJournal(
    world.fg!,
    world.tick,
    "tradition",
    "Традиция «" + node.ru + "» открыта (древо «" + tree.ru + "», " + cost + " единства)."
      + (finished ? " Финишер: «" + tree.finisher.ru + "»." : ""),
  );
  const messageRu = finished
    ? "Древо «" + tree.ru + "» завершено! Финишер «" + tree.finisher.ru + "» активирован."
    : "Традиция «" + node.ru + "» открыта за " + cost + " единства (" + count + "/" + tree.nodes.length + ").";
  return { ok: true, messageRu };
}

interface RequirementContext {
  world: World;
  empireId: number;
  completedTechs: string[];
  perks: string[];
  government: string;
  ethics: string[];
  civics: string[];
}

function techTier(techId: string): number {
  return TECH_BY_ID[techId]?.tier ?? 0;
}

function requirementMet(ctx: RequirementContext, raw: string): boolean {
  const req = raw.trim();
  if (req.length === 0) return true;
  if (req.startsWith("tech:")) return ctx.completedTechs.includes(req.slice(5));
  const tierMatch = /^(?:tier|T)(\d+)$/i.exec(req);
  if (tierMatch) {
    const minTier = Number(tierMatch[1]);
    for (const techId of ctx.completedTechs) if (techTier(techId) >= minTier) return true;
    return false;
  }
  if (req.startsWith("perk:")) return ctx.perks.includes(req.slice(5));
  if (req.startsWith("tradition:")) {
    const fg = ctx.world.fg;
    const adv = fg ? fg.empires[ctx.empireId] : undefined;
    if (!adv) return false;
    const id = req.slice(10);
    return adv.traditions.unlocked.includes(id) || adv.traditions.finishers.includes(id);
  }
  if (req.startsWith("government:")) return ctx.government === req.slice(11);
  if (req.startsWith("ethics:")) return ctx.ethics.includes(req.slice(7));
  if (req.startsWith("civic:")) return ctx.civics.includes(req.slice(6));
  const countMatch = /^(routes|colonies|megastructures|ascensions):(\d+)$/.exec(req);
  if (countMatch) {
    const need = Number(countMatch[2]);
    const fg = ctx.world.fg;
    if (!fg) return need === 0;
    if (countMatch[1] === "routes") {
      return fg.routes.filter((route) => route.empireId === ctx.empireId && route.active).length >= need;
    }
    if (countMatch[1] === "colonies") {
      const empire = empireOf(ctx.world, ctx.empireId);
      return (empire?.colonies.length ?? 0) >= need;
    }
    if (countMatch[1] === "megastructures") {
      return fg.megastructures.filter((m) => m.ownerId === ctx.empireId && m.active).length >= need;
    }
    // ascensions: перки с флагом вознесения
    let ascensions = 0;
    for (const perkId of ctx.perks) {
      const perk = findPerk(perkId);
      if (perk && (perk.effects.ascension ?? 0) > 0) ascensions += 1;
    }
    return ascensions >= need;
  }
  // Голый идентификатор: перк, технология или узел традиции.
  if (findPerk(req)) return ctx.perks.includes(req);
  if (TECH_BY_ID[req]) return ctx.completedTechs.includes(req);
  const fg = ctx.world.fg;
  const adv = fg ? fg.empires[ctx.empireId] : undefined;
  return adv ? adv.traditions.unlocked.includes(req) || adv.traditions.finishers.includes(req) : false;
}

/** Проверка требований перка/узла (экспорт — для UI-тултипов). */
export function perkRequirementsMet(world: World, empireId: number, perkId: string): boolean {
  const perk = findPerk(perkId);
  const empire = empireOf(world, empireId);
  if (!perk || !empire) return false;
  const adv = advancedOf(world, empireId);
  const ctx: RequirementContext = {
    world, empireId,
    completedTechs: empire.techs.completed,
    perks: adv.perks,
    government: adv.government,
    ethics: adv.ethics,
    civics: adv.civics,
  };
  for (const req of perk.requires) if (!requirementMet(ctx, req)) return false;
  return true;
}

export function unlockPerk(world: World, empireId: number, perkId: string): CommandResult {
  const empire = empireOf(world, empireId);
  if (!empire) return { ok: false, messageRu: "Империя не найдена" };
  if (empire.dead) return { ok: false, messageRu: "Империя пала — перки недоступны" };
  const perk = findPerk(perkId);
  if (!perk) return { ok: false, messageRu: "Перк не найден" };
  const adv = advancedOf(world, empireId);
  if (adv.perks.includes(perk.id)) return { ok: false, messageRu: "Этот перк уже открыт" };

  const slots = Math.max(adv.perkSlots, perkSlotsFor(world, empireId));
  if (adv.perks.length >= slots) {
    return { ok: false, messageRu: "Все слоты перков заняты (" + slots + "). Завершите древо Просвещения, чтобы получить ещё слот." };
  }

  const ctx: RequirementContext = {
    world, empireId,
    completedTechs: empire.techs.completed,
    perks: adv.perks,
    government: adv.government,
    ethics: adv.ethics,
    civics: adv.civics,
  };
  for (const req of perk.requires) {
    if (requirementMet(ctx, req)) continue;
    return { ok: false, messageRu: "Требование перка не выполнено: " + req };
  }

  const cost = Math.max(0, Math.round(perk.cost * perkCostMultiplier(world, empireId)));
  if (empire.resources.unity < cost) {
    return { ok: false, messageRu: "Не хватает единства: нужно " + cost + ", есть " + empire.resources.unity };
  }
  empire.resources.unity -= cost;
  adv.perks.push(perk.id);
  const isAscension = (perk.effects.ascension ?? 0) > 0
    || (perk.effects.ascension_victory ?? 0) > 0
    || perk.id === "ascension";
  if (isAscension) {
    // Флаг для victory.ts: победа «Технологическое вознесение» (GDD §16.1).
    world.flags["ascension_perk:" + empireId] = 1;
  }
  pushJournal(
    world.fg!,
    world.tick,
    "perk",
    "Перк «" + perk.ru + "» открыт за " + cost + " единства (" + adv.perks.length + "/" + slots + ")."
      + (isAscension ? " Открыт путь к Технологическому вознесению." : ""),
  );
  return {
    ok: true,
    messageRu: isAscension
      ? "Перк «" + perk.ru + "» открыт! Путь к победе «Технологическое вознесение» разблокирован."
      : "Перк «" + perk.ru + "» открыт за " + cost + " единства (" + adv.perks.length + "/" + slots + ").",
  };
}
