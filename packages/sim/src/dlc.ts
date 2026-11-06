/**
 * Часть XIV · DLC «Квесты и диалоги» (движки квестов/диалогов/каналов).
 *
 * FSM квестов: locked → available → active → completed/failed/expired; шаги продвигаются
 * реальными действиями (dock/scan/kill/reach_system/report/turn_in/dialogue/choice).
 * Диалоги: line/choice/check/effect/end; проверки детерминированы (seed сцены в сейве —
 * перезагрузка не перебрасывает), эффекты идемпотентны.
 * Каналы: story_message (старт новой игры), board (обновление раз в 10 тактов),
 * rumor (покупка/ложь/опровержение), signal (точка в полёте, открывается входом флота).
 * Feature-flag: новые игры enabled=true; старые сейвы без fg.dlc — off с миграцией.
 */
import {
  DLC_CARDS, DLC_CHARACTERS, DLC_DIALOGUES, DLC_QUESTS, DLC_TREE,
} from "@sf/data";
import type {
  CharacterDef, DialogueDef, DialogueEffectDef, DialogueNodeDef, DialogueOptionDef, QuestCardDef,
  QuestDef, QuestStepDef, QuestTreeDef,
} from "@sf/data";
import type { CommandResult, World } from "./types";

export const DLC_VERSION = "1.0.0";
export const DLC_SCHEMA_VERSION = 2;
export const DLC_BOARD_REFRESH = 10;
export const DLC_RUMOR_COST = 500;
export const DLC_RUMOR_TTL = 600;
export const DLC_SIGNAL_TTL = 1200;
export const DLC_HINT_INTERVAL = 200;
export const DLC_HISTORY_LIMIT = 50;

export type DlcQuestStatus = "locked" | "available" | "active" | "completed" | "failed" | "expired";
export type DlcChannel = "story_message" | "board" | "rumor" | "signal";
export type DlcMode = "full" | "archive" | "off";

export interface DlcQuestState {
  id: string;
  status: DlcQuestStatus;
  step: number;
  stepProgress: Record<string, number>;
  acceptedTick: number;
  completedTick: number;
  rewardsClaimed: boolean;
  source: DlcChannel;
  flags: Record<string, number>;
}

export interface DlcHistoryEntry {
  nodeId: string;
  speaker?: string;
  emotion?: string;
  textKey?: string;
  choiceId?: string;
  tick: number;
}

export interface DlcDialogueState {
  sceneId: string;
  nodeId: string;
  active: boolean;
  history: DlcHistoryEntry[];
  checkResults: Record<string, boolean>;
  choices: Record<string, string>;
  startedTick: number;
  questId: string | null;
  seed: number;
  appliedEffects: string[];
  visited: Record<string, number>;
  nodeStartedTick: number;
}

export interface DlcRumorState {
  id: string;
  questId: string;
  lie: boolean;
  revealed: boolean;
  refuted: boolean;
  expiresTick: number;
}

export interface DlcSignalState {
  id: string;
  questId: string;
  systemId: number;
  revealed: boolean;
  expiresTick: number;
}

export interface DlcState {
  schemaVersion: number;
  version: string;
  enabled: boolean;
  mode: DlcMode;
  migratedFromVersion?: number;
  quests: Record<string, DlcQuestState>;
  activeQuestId: string | null;
  completed: string[];
  chronicle: { tick: number; textKey: string; questId?: string }[];
  dialogue: DlcDialogueState | null;
  flags: Record<string, number>;
  reputation: Record<string, number>;
  board: { stationId: number | null; questIds: string[]; refreshTick: number };
  rumors: DlcRumorState[];
  signals: DlcSignalState[];
  revealedNodes: string[];
  offersSeen: string[];
  lastHintTick: number;
  storySent: boolean;
  rumorsGenerated: boolean;
  signalsGenerated: boolean;
  stats: Record<string, number>;
}

// ------------------------------------------------------------------ каталог (override для тестов/EN)

export interface DlcCatalog {
  quests: QuestDef[];
  dialogues: DialogueDef[];
  characters: CharacterDef[];
  tree: QuestTreeDef;
  cards: QuestCardDef[];
}

let overrideCatalog: DlcCatalog | null = null;

export function setDlcCatalog(catalog: DlcCatalog | null): void {
  overrideCatalog = catalog;
}

export function dlcCatalog(): DlcCatalog {
  if (overrideCatalog) return overrideCatalog;
  return {
    quests: DLC_QUESTS, dialogues: DLC_DIALOGUES, characters: DLC_CHARACTERS,
    tree: DLC_TREE, cards: DLC_CARDS,
  };
}

function hashOf(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h >>> 0;
}

// ------------------------------------------------------------------ состояние

function makeQuestState(id: string, source: DlcChannel): DlcQuestState {
  return {
    id, status: "locked", step: 0, stepProgress: {}, acceptedTick: 0, completedTick: 0,
    rewardsClaimed: false, source, flags: {},
  };
}

export function createDlcState(world: World, enabled = true, mode: DlcMode = enabled ? "full" : "off"): DlcState {
  const catalog = dlcCatalog();
  const quests: Record<string, DlcQuestState> = {};
  for (const quest of catalog.quests) quests[quest.id] = makeQuestState(quest.id, quest.source.channel);
  if (enabled) {
    const first = catalog.quests.find((quest) => quest.source.channel === "story_message" && (quest.source.autoStartTick ?? -1) >= 0)
      ?? catalog.quests[0];
    if (first) quests[first.id]!.status = "available";
  }
  void world;
  return {
    schemaVersion: DLC_SCHEMA_VERSION,
    version: DLC_VERSION,
    enabled,
    mode,
    quests,
    activeQuestId: null,
    completed: [],
    chronicle: [],
    dialogue: null,
    flags: {},
    reputation: {},
    board: { stationId: null, questIds: [], refreshTick: 0 },
    rumors: [],
    signals: [],
    revealedNodes: [],
    offersSeen: [],
    lastHintTick: 0,
    storySent: false,
    rumorsGenerated: false,
    signalsGenerated: false,
    stats: {},
  };
}

/** Миграция старых сейвов: нет поля → off; schemaVersion 1 → добавить поля, enabled по умолчанию off. */
export function migrateDlcState(world: World, raw: Partial<DlcState> | null | undefined): DlcState {
  const base = createDlcState(world, false, "off");
  if (!raw) {
    base.migratedFromVersion = 0;
    base.flags["dlc_migration_warn"] = 1;
    return base;
  }
  const state: DlcState = { ...base, ...raw } as DlcState;
  state.schemaVersion = DLC_SCHEMA_VERSION;
  state.version = raw.version ?? DLC_VERSION;
  state.migratedFromVersion = raw.schemaVersion ?? 0;
  state.enabled = raw.enabled ?? false;
  state.mode = state.enabled ? (raw.mode === "archive" || raw.mode === "full" ? raw.mode : "full") : "off";
  state.quests = { ...base.quests };
  for (const [id, quest] of Object.entries(raw.quests ?? {})) {
    const template = base.quests[id] ?? makeQuestState(id, "board");
    state.quests[id] = { ...template, ...quest, stepProgress: { ...(quest.stepProgress ?? {}) }, flags: { ...(quest.flags ?? {}) } };
  }
  // Новые квесты из данных, которых не было в сейве.
  for (const quest of dlcCatalog().quests) {
    if (!state.quests[quest.id]) state.quests[quest.id] = makeQuestState(quest.id, quest.source.channel);
  }
  if (!Array.isArray(state.chronicle)) state.chronicle = [];
  if (!Array.isArray(state.rumors)) state.rumors = [];
  if (!Array.isArray(state.signals)) state.signals = [];
  if (!Array.isArray(state.revealedNodes)) state.revealedNodes = [];
  if (!Array.isArray(state.offersSeen)) state.offersSeen = [];
  if (!state.flags || typeof state.flags !== "object") state.flags = {};
  if (!state.reputation || typeof state.reputation !== "object") state.reputation = {};
  if (!state.stats || typeof state.stats !== "object") state.stats = {};
  if (!state.board) state.board = { stationId: null, questIds: [], refreshTick: 0 };
  state.storySent = raw.storySent ?? state.enabled; // старые сейвы не автостартуют
  state.flags["dlc_migration_warn"] = 1;
  return state;
}

export function ensureDlc(world: World): DlcState {
  if (!world.fg) return createDlcState(world, false, "off");
  if (!world.fg.dlc) {
    // Старый сейв без DLC: миграция с выключенным флагом.
    world.fg.dlc = migrateDlcState(world, null);
    return world.fg.dlc;
  }
  if (world.fg.dlc.schemaVersion !== DLC_SCHEMA_VERSION) {
    world.fg.dlc = migrateDlcState(world, world.fg.dlc);
  } else {
    // Новые квесты из данных появляются в существующем сейве заблокированными.
    for (const quest of dlcCatalog().quests) {
      if (!world.fg.dlc.quests[quest.id]) {
        world.fg.dlc.quests[quest.id] = makeQuestState(quest.id, quest.source.channel);
      }
    }
  }
  return world.fg.dlc;
}

export function getDlcState(world: World): DlcState {
  return ensureDlc(world);
}

export function getDlcSaveMeta(world: World): {
  enabled: boolean; version: string; mode: DlcMode; schemaVersion: number; migratedFromVersion?: number;
} {
  const d = ensureDlc(world);
  return {
    enabled: d.enabled, version: d.version, mode: d.mode,
    schemaVersion: d.schemaVersion, migratedFromVersion: d.migratedFromVersion,
  };
}

export function dlcQuestById(id: string): QuestDef | null {
  return dlcCatalog().quests.find((quest) => quest.id === id) ?? null;
}

export function dlcDialogueById(id: string): DialogueDef | null {
  return dlcCatalog().dialogues.find((dialogue) => dialogue.id === id) ?? null;
}

export function dlcCharacterById(id: string | null | undefined): CharacterDef | null {
  if (!id) return null;
  return dlcCatalog().characters.find((character) => character.id === id) ?? null;
}

export function dlcPlayer(world: World) {
  return world.empires.find((empire) => empire.id === world.playerEmpireId) ?? null;
}

function deny(messageRu: string): CommandResult { return { ok: false, messageRu }; }
function ok(messageRu?: string): CommandResult {
  const result: CommandResult = { ok: true };
  if (messageRu !== undefined) result.messageRu = messageRu;
  return result;
}

function chronicle(world: World, d: DlcState, textKey: string, questId?: string): void {
  d.chronicle.push({ tick: world.tick, textKey, questId: questId ?? d.activeQuestId ?? undefined });
  if (d.chronicle.length > DLC_HISTORY_LIMIT * 4) d.chronicle.splice(0, d.chronicle.length - DLC_HISTORY_LIMIT * 4);
}

// ------------------------------------------------------------------ гейты/канал

function flagSet(world: World, d: DlcState, flag: string | undefined): boolean {
  if (!flag) return true;
  return (d.flags[flag] ?? 0) > 0 || (world.flags[flag] ?? 0) > 0;
}

function questGateOpen(world: World, d: DlcState, def: QuestDef): boolean {
  if (def.source.requiresQuest) {
    const q = d.quests[def.source.requiresQuest];
    if (!q || q.status !== "completed") return false;
  }
  return flagSet(world, d, def.source.requiresFlag);
}

function makeAvailable(d: DlcState, questId: string): void {
  const state = d.quests[questId];
  if (state && state.status === "locked") {
    state.status = "available";
    if (!d.offersSeen.includes(questId)) d.offersSeen.push(questId);
  }
}

/** Диалог для квеста: id диалога может совпадать с questId или содержать его. */
function chooseDialogueForQuest(questId: string): string | null {
  const catalog = dlcCatalog();
  const exact = catalog.dialogues.find((dialogue) => dialogue.id === questId);
  if (exact) return exact.id;
  const contains = catalog.dialogues.find((dialogue) => dialogue.id.includes(questId) || questId.includes(dialogue.id));
  if (contains) return contains.id;
  const byScene = catalog.dialogues.find((dialogue) => dialogue.id.includes(questId.split("_").slice(-2).join("_")));
  return byScene?.id ?? null;
}

// ------------------------------------------------------------------ квестовый FSM

export interface DlcQuestView {
  def: QuestDef;
  state: DlcQuestState;
  currentStep: QuestStepDef | null;
  stepDone: number;
  stepNeed: number;
}

export function getDlcJournal(world: World): DlcQuestView[] {
  const d = ensureDlc(world);
  return dlcCatalog().quests
    .map((def) => {
      const state = d.quests[def.id]!;
      const currentStep = def.steps[state.step] ?? null;
      const need = currentStep?.count ?? 1;
      const done = currentStep ? Math.min(need, state.stepProgress[currentStep.id] ?? 0) : 0;
      return { def, state, currentStep, stepDone: done, stepNeed: need };
    })
    .sort((left, right) => (left.def.act - right.def.act) || (left.def.id < right.def.id ? -1 : 1));
}

export function getDlcChronicle(world: World): DlcState["chronicle"] {
  return [...ensureDlc(world).chronicle];
}

export function getDlcQuestState(world: World, questId: string): DlcQuestState | null {
  return ensureDlc(world).quests[questId] ?? null;
}

function stepMatchesAction(step: QuestStepDef, action: string, target?: string): boolean {
  const normalized = action === "reach" ? "reach_system" : action;
  if (step.type !== normalized) {
    // scan — допустимый алиас для report/turn_in (старые данные 14a)
    if (!(action === "scan" && (step.type === "report" || step.type === "turn_in"))) return false;
  }
  if (!step.target || step.target === "any") return true;
  // Цели-повествовательные (NPC, станции, пиратские флоты, POI) не совпадают с числами
  // движка: принимаем действие с любым target, чтобы квесты были проходимы из UI.
  const narrative = step.type === "dock" || step.type === "report" || step.type === "turn_in"
    || step.type === "choice" || step.type === "kill" || step.type === "dialogue";
  if (!target) return narrative;
  if (step.target === target || String(step.target) === String(target)) return true;
  return narrative;
}

/** Роли DLC-систем: цели visit/reach из данных (sys_*, poi_*, station_*) → реальные системы. */
export function ensureDlcQuestSystems(world: World): void {
  const d = ensureDlc(world);
  const catalog = dlcCatalog();
  const targets = new Set<string>();
  for (const quest of catalog.quests) {
    for (const step of quest.steps) {
      const target = step.target ?? "";
      if (!target || target === "any") continue;
      if (step.type !== "reach_system") continue;
      if (!/^\d+$/.test(target)) targets.add(target);
    }
  }
  if (targets.size === 0) return;
  const present = new Set(world.systems.map((system) => system.role).filter((role): role is string => !!role));
  const missing = [...targets].filter((target) => !present.has(target));
  if (missing.length === 0) {
    d.flags["quest_systems_assigned"] = 1;
    return;
  }
  const player = dlcPlayer(world);
  const capital = player?.capitalSystemId ?? 0;
  const candidates = world.systems
    .filter((system) => system.sector !== "relic")
    .filter((system) => system.id !== capital)
    .sort((left, right) => left.id - right.id);
  if (candidates.length === 0) return;
  for (const target of missing) {
    // Не перетираем уже назначенные роли: если свободных систем нет — оставляем как есть.
    const free = candidates.find((system) => !system.role);
    if (!free) break;
    free.role = target;
  }
  d.flags["quest_systems_assigned"] = 1;
}

/** Ближайшая к цели роль-система (для маркеров). */
export function dlcTargetSystemId(world: World, target: string | undefined): number | undefined {
  if (!target) return undefined;
  const numeric = Number(target);
  if (Number.isFinite(numeric)) return numeric;
  return world.systems.find((system) => system.role === target)?.id;
}

function advanceFailedStep(d: DlcState, def: QuestDef, state: DlcQuestState): void {
  while (state.step < def.steps.length) {
    const step = def.steps[state.step]!;
    const need = step.count ?? 1;
    if ((state.stepProgress[step.id] ?? 0) >= need) state.step += 1;
    else break;
  }
}

function completeQuest(world: World, d: DlcState, def: QuestDef): void {
  const state = d.quests[def.id];
  if (!state || state.rewardsClaimed) return;
  state.rewardsClaimed = true;
  state.status = "completed";
  state.completedTick = world.tick;
  d.completed.push(def.id);
  d.stats.completed = (d.stats.completed ?? 0) + 1;
  const player = dlcPlayer(world);
  if (player) {
    player.resources.credits += def.rewards.credits ?? 0;
    player.resources.alloys += def.rewards.alloys ?? 0;
  }
  for (const [key, value] of Object.entries(def.rewards.rep ?? {})) {
    d.reputation[key] = (d.reputation[key] ?? 0) + value;
  }
  for (const flag of def.rewards.flags ?? []) d.flags[flag] = 1;
  for (const item of def.rewards.items ?? []) d.flags["item:" + item] = 1;
  if (d.activeQuestId === def.id) d.activeQuestId = null;
  chronicle(world, d, def.titleKey, def.id);
  // Опровержение ложных слухов об этом квесте.
  for (const rumor of d.rumors) {
    if (rumor.questId === def.id && rumor.lie && !rumor.refuted) {
      rumor.refuted = true;
      d.flags["rumor_refuted:" + rumor.id] = 1;
      chronicle(world, d, "dlc.chronicle.rumor_refuted", def.id);
    }
  }
  if (def.nextHint) {
    makeAvailable(d, def.nextHint);
    if (!d.offersSeen.includes(def.nextHint)) d.offersSeen.push(def.nextHint);
  }
}

export function dlcAcceptQuest(world: World, empireId: number, questId: string, source?: DlcChannel): CommandResult {
  const d = ensureDlc(world);
  if (!d.enabled) return deny("DLC квестов выключен");
  if (empireId !== world.playerEmpireId) return deny("Квесты доступны только игроку");
  const def = dlcQuestById(questId);
  const state = d.quests[questId];
  if (!def || !state) return deny("Квест не найден");
  if (!questGateOpen(world, d, def)) return deny("Квест ещё не открыт");
  if (state.status === "active") return deny("Квест уже активен");
  if (state.status === "completed") return deny("Квест уже завершён");
  if (state.status === "failed" || state.status === "expired") return deny("Квест провален/истёк");
  if (state.status !== "available") return deny("Квест недоступен");
  state.status = "active";
  state.acceptedTick = world.tick;
  state.source = source ?? def.source.channel;
  state.step = 0;
  state.stepProgress = {};
  d.activeQuestId = d.activeQuestId ?? questId;
  if (!d.revealedNodes.includes(questId)) d.revealedNodes.push(questId);
  chronicle(world, d, def.summaryKey || def.titleKey, questId);
  // Если первый шаг — диалог, сразу открываем сцену.
  const firstStep = def.steps[0];
  if (firstStep?.type === "dialogue") {
    const explicit = firstStep.target && dlcDialogueById(firstStep.target) ? firstStep.target : null;
    const scene = explicit ?? chooseDialogueForQuest(questId);
    if (scene) startDlcDialogue(world, scene, questId);
  }
  return ok("Квест принят: " + questId);
}

/** Прогресс шага реальным действием; action — тип шага. */
export function dlcNotifyAction(world: World, action: string, target?: string): CommandResult {
  const d = ensureDlc(world);
  if (!d.enabled) return deny("DLC квестов выключен");
  const questId = d.activeQuestId;
  if (!questId) return deny("Нет активного квеста");
  const def = dlcQuestById(questId);
  const state = d.quests[questId];
  if (!def || !state) return deny("Квест не найден");
  if (state.step >= def.steps.length) {
    completeQuest(world, d, def);
    return ok("Квест завершён: " + questId);
  }
  const step = def.steps[state.step]!;
  let effectiveTarget = target;
  let reachResolved = false;
  if (step.type === "reach_system" && step.target && !/^\d+$/.test(step.target)) {
    const roleSystemId = dlcTargetSystemId(world, step.target);
    if (roleSystemId !== undefined) {
      effectiveTarget = String(roleSystemId);
      reachResolved = !target || target === String(roleSystemId) || target === step.target;
    }
  }
  if (!reachResolved && !stepMatchesAction(step, action, effectiveTarget)) {
    return deny("Действие не относится к текущему шагу (" + step.type + ")");
  }
  const need = step.count ?? 1;
  state.stepProgress[step.id] = Math.min(need, (state.stepProgress[step.id] ?? 0) + 1);
  advanceFailedStep(d, def, state);
  d.stats.actions = (d.stats.actions ?? 0) + 1;
  if (state.step >= def.steps.length) completeQuest(world, d, def);
  return ok("Шаг квеста: " + step.id + " (" + (state.stepProgress[step.id] ?? 0) + "/" + need + ")");
}

export function dlcFailQuest(world: World, empireId: number, questId: string, reasonRu?: string): CommandResult {
  const d = ensureDlc(world);
  if (empireId !== world.playerEmpireId) return deny("Только игрок");
  const def = dlcQuestById(questId);
  const state = d.quests[questId];
  if (!def || !state) return deny("Квест не найден");
  if (state.status !== "active") return deny("Квест не активен");
  state.status = "failed";
  if (d.activeQuestId === questId) d.activeQuestId = null;
  d.flags["quest_failed:" + questId] = 1;
  chronicle(world, d, "dlc.chronicle.failed:" + questId, questId);
  return ok(reasonRu ?? "Квест провален");
}

/** Хук завершения диалога → шаги dialogue/choice текущего квеста. */
function onDialogueCompleted(world: World, questId: string | null, choseOption: boolean): void {
  if (!questId) return;
  const d = ensureDlc(world);
  const def = dlcQuestById(questId);
  const state = d.quests[questId];
  if (!def || !state || state.status !== "active") return;
  const step = def.steps[state.step];
  if (!step) return;
  if (step.type === "dialogue") dlcNotifyAction(world, "dialogue", step.target);
  else if (step.type === "choice" && choseOption) dlcNotifyAction(world, "choice", step.target);
}

// ------------------------------------------------------------------ диалоги

function nodeOf(def: DialogueDef, nodeId: string): DialogueNodeDef | null {
  return def.nodes.find((node) => node.id === nodeId) ?? null;
}

function firstNodeOf(def: DialogueDef): DialogueNodeDef | null {
  return def.nodes[0] ?? null;
}

function dialogueSeed(world: World, sceneId: string, questId: string | null): number {
  return hashOf(world.seed, sceneId, world.tick, questId ?? "");
}

function statValue(world: World, d: DlcState, stat: string | undefined): number {
  const name = (stat ?? "").toLowerCase();
  if (name.startsWith("rep:")) return d.reputation[name.slice(4)] ?? 0;
  if (name === "relics") return world.fg?.ancients?.relics ?? 0;
  if (name === "cores") return world.fg?.ancients?.cores ?? 0;
  if (name === "choir_attention") return world.fg?.ancients?.flags["choir_attention"] ?? 0;
  if (name === "decipher") return world.fg?.ancients?.quest.language ?? 0;
  if (name === "rank" || name === "admiral") return 0;
  if (d.reputation[name] !== undefined) return d.reputation[name]!;
  return 0;
}

/** Детерминированная проверка: исход кэшируется в состоянии сцены (анти-save-scum). */
function resolveCheck(world: World, d: DlcState, state: DlcDialogueState, key: string, check: { stat: string; dc: number } | undefined): boolean {
  const cached = state.checkResults[key];
  if (cached !== undefined) return cached;
  const raw = statValue(world, d, check?.stat);
  const normalized = Math.max(-20, Math.min(20, Math.round(raw / 5)));
  const roll = hashOf(state.seed, key, check?.stat ?? "", check?.dc ?? 0) % 21;
  const success = 20 + normalized + roll >= (check?.dc ?? 45);
  state.checkResults[key] = success;
  return success;
}

function applyDlcEffects(world: World, d: DlcState, effects: DialogueEffectDef[] | undefined, key: string): void {
  if (!effects || effects.length === 0) return;
  if (d.dialogue) {
    if (d.dialogue.appliedEffects.includes(key)) return;
    d.dialogue.appliedEffects.push(key);
  }
  const player = dlcPlayer(world);
  for (const effect of effects) {
    if (effect.flag) d.flags[effect.flag] = 1;
    if (effect.rep) for (const [faction, value] of Object.entries(effect.rep)) d.reputation[faction] = (d.reputation[faction] ?? 0) + value;
    if (effect.openQuest) makeAvailable(d, effect.openQuest);
    if (effect.credits && player) player.resources.credits += effect.credits;
    if (effect.timeSkip && effect.timeSkip > 0) world.tick += effect.timeSkip;
    if (effect.chronicleKey) chronicle(world, d, effect.chronicleKey);
  }
}

function pushHistory(state: DlcDialogueState, node: DialogueNodeDef, world: World, choiceId?: string): void {
  state.history.push({
    nodeId: node.id, speaker: node.speaker, emotion: node.emotion, textKey: node.textKey,
    choiceId, tick: world.tick,
  });
  if (state.history.length > DLC_HISTORY_LIMIT) state.history.splice(0, state.history.length - DLC_HISTORY_LIMIT);
  state.visited[node.id] = (state.visited[node.id] ?? 0) + 1;
}

function finishDialogue(world: World, d: DlcState, state: DlcDialogueState, node: DialogueNodeDef | null, choseOption: boolean): void {
  if (node) applyDlcEffects(world, d, node.effects, state.sceneId + ":" + node.id);
  const questId = state.questId;
  d.flags["dialogue_done:" + state.sceneId] = 1;
  d.dialogue = null;
  chronicle(world, d, "dlc.chronicle.dialogue_done:" + state.sceneId, questId ?? undefined);
  onDialogueCompleted(world, questId, choseOption);
}

/** Прокрутка неинтерактивных узлов до line/choice/end. */
function runDialogue(world: World, d: DlcState): void {
  const state = d.dialogue;
  if (!state?.active) return;
  const def = dlcDialogueById(state.sceneId);
  if (!def) { d.dialogue = null; return; }
  let guard = 0;
  while (state.active && guard < 64) {
    guard += 1;
    const node = nodeOf(def, state.nodeId);
    if (!node) { d.dialogue = null; return; }
    if (node.type === "end") {
      finishDialogue(world, d, state, node, Object.keys(state.choices).length > 0);
      return;
    }
    if (node.type === "effect") {
      applyDlcEffects(world, d, node.effects, state.sceneId + ":" + node.id);
      state.nodeId = node.next ?? "";
      continue;
    }
    if (node.type === "check") {
      const key = state.sceneId + ":" + node.id;
      const success = resolveCheck(world, d, state, key, node.check);
      const next = success ? (node.check?.onSuccess ?? node.next ?? "") : (node.check?.onFail ?? node.next ?? "");
      pushHistory(state, node, world);
      state.nodeId = next;
      continue;
    }
    if (node.type === "line") {
      if ((state.visited[node.id] ?? 0) === 0) pushHistory(state, node, world);
      return;
    }
    // choice — ждём выбора
    return;
  }
  void guard;
}

export function startDlcDialogue(world: World, sceneId: string, questId: string | null = null): CommandResult {
  const d = ensureDlc(world);
  if (!d.enabled) return deny("DLC диалогов выключен");
  const def = dlcDialogueById(sceneId);
  if (!def) return deny("Диалог не найден");
  const first = firstNodeOf(def);
  if (!first) return deny("Пустой диалог");
  if (d.dialogue?.active) {
    d.flags["dialogue_interrupted"] = (d.flags["dialogue_interrupted"] ?? 0) + 1;
  }
  d.dialogue = {
    sceneId, nodeId: first.id, active: true, history: [], checkResults: {}, choices: {},
    startedTick: world.tick, questId, seed: dialogueSeed(world, sceneId, questId),
    appliedEffects: [], visited: {}, nodeStartedTick: world.tick,
  };
  d.revealedNodes.push(sceneId);
  runDialogue(world, d);
  return ok("Диалог начат");
}

export function endDlcDialogue(world: World): void {
  const d = ensureDlc(world);
  d.dialogue = null;
}

/** Продолжение диалога (line/check/effect); choice требует dlcDialogueChoose. */
export function dlcDialogueAdvance(world: World, empireId: number): CommandResult {
  const d = ensureDlc(world);
  if (empireId !== world.playerEmpireId) return deny("Диалог доступен только игроку");
  const state = d.dialogue;
  if (!state?.active) return deny("Диалог не открыт");
  const def = dlcDialogueById(state.sceneId);
  if (!def) return deny("Диалог не найден");
  const node = nodeOf(def, state.nodeId);
  if (!node) return deny("Узел не найден");
  if (node.type === "choice") return deny("Нужен выбор варианта");
  if (node.type === "line") {
    if ((state.visited[node.id] ?? 0) === 0) pushHistory(state, node, world);
    state.nodeId = node.next ?? "";
    state.nodeStartedTick = world.tick;
  }
  runDialogue(world, d);
  return ok(d.dialogue ? "Диалог продолжен" : "Диалог завершён");
}

/** Выбор варианта; nodeId — для совместимости UI (проверяем текущий узел). */
export function dlcDialogueChoose(world: World, empireId: number, nodeId: string, choiceId: string): CommandResult {
  const d = ensureDlc(world);
  if (empireId !== world.playerEmpireId) return deny("Диалог доступен только игроку");
  const state = d.dialogue;
  if (!state?.active) return deny("Диалог не открыт");
  const def = dlcDialogueById(state.sceneId);
  if (!def) return deny("Диалог не найден");
  const node = nodeOf(def, nodeId) ?? nodeOf(def, state.nodeId);
  if (!node) return deny("Узел не найден");
  if (node.type !== "choice") {
    // Выбор на line/check трактуем как «продолжить»
    if (node.type === "line" || node.type === "check" || node.type === "effect") return dlcDialogueAdvance(world, empireId);
    return deny("В этом узле нет выбора");
  }
  const option: DialogueOptionDef | undefined = node.options?.find((entry) => entry.id === choiceId);
  if (!option) return deny("Вариант не найден");
  if (state.choices[node.id]) return deny("Выбор уже сделан");
  if (option.requiresFlag && !flagSet(world, d, option.requiresFlag)) return deny("Вариант недоступен (нужен флаг)");
  state.choices[node.id] = choiceId;
  d.stats.dialogueChoices = (d.stats.dialogueChoices ?? 0) + 1;
  let next = option.next;
  if (option.check) {
    const key = state.sceneId + ":" + node.id + ":" + option.id;
    const success = resolveCheck(world, d, state, key, option.check);
    next = success ? option.check.onSuccess : option.check.onFail;
  }
  applyDlcEffects(world, d, option.effects, state.sceneId + ":" + node.id + ":" + option.id);
  pushHistory(state, node, world, choiceId);
  state.nodeId = next;
  runDialogue(world, d);
  return ok(d.dialogue ? "Диалог продолжен" : "Диалог завершён");
}

// ------------------------------------------------------------------ каналы

function findBoardStation(world: World): number | null {
  for (const system of world.systems) {
    if (system.sector === "relic") continue;
    if (system.station && (system.station.kind === "trade" || system.station.kind === "outpost" || system.station.hasMissions)) {
      return system.station.id;
    }
  }
  return null;
}

function refreshBoard(world: World, d: DlcState): void {
  if (world.tick - d.board.refreshTick < DLC_BOARD_REFRESH && d.board.questIds.length > 0) return;
  d.board.refreshTick = world.tick;
  d.board.stationId = d.board.stationId ?? findBoardStation(world);
  const ids: string[] = [];
  for (const def of dlcCatalog().quests) {
    if (def.source.channel !== "board") continue;
    if (!questGateOpen(world, d, def)) continue;
    const state = d.quests[def.id];
    if (!state) continue;
    if (state.status === "locked") makeAvailable(d, def.id);
    if (state.status === "available") ids.push(def.id);
  }
  d.board.questIds = ids.slice(0, 8);
}

function ensureRumors(world: World, d: DlcState): void {
  if (d.rumorsGenerated) return;
  d.rumorsGenerated = true;
  for (const def of dlcCatalog().quests) {
    if (def.source.channel !== "rumor") continue;
    const chance = def.source.rumorLieChance ?? 30;
    const lie = hashOf(world.seed, def.id, "rumor-lie") % 100 < chance;
    d.rumors.push({
      id: "rumor:" + def.id, questId: def.id, lie, revealed: false, refuted: false,
      expiresTick: world.tick + DLC_RUMOR_TTL,
    });
  }
}

function ensureSignals(world: World, d: DlcState): void {
  if (d.signalsGenerated) return;
  d.signalsGenerated = true;
  const galaxyIds = world.systems.filter((system) => system.sector !== "relic").map((system) => system.id);
  for (const def of dlcCatalog().quests) {
    if (def.source.channel !== "signal") continue;
    const systemId = galaxyIds.length > 0 ? galaxyIds[hashOf(world.seed, def.id, "signal") % galaxyIds.length]! : 0;
    d.signals.push({
      id: "signal:" + def.id, questId: def.id, systemId, revealed: false,
      expiresTick: world.tick + DLC_SIGNAL_TTL,
    });
  }
}

export function dlcBuyRumor(world: World, empireId: number, rumorId: string): CommandResult {
  const d = ensureDlc(world);
  if (!d.enabled) return deny("DLC квестов выключен");
  if (empireId !== world.playerEmpireId) return deny("Слухи доступны только игроку");
  const rumor = d.rumors.find((entry) => entry.id === rumorId);
  if (!rumor) return deny("Слух не найден");
  if (rumor.revealed) return deny("Слух уже куплен");
  if (world.tick > rumor.expiresTick) return deny("Слух устарел");
  const player = dlcPlayer(world);
  if (!player || player.resources.credits < DLC_RUMOR_COST) return deny("Нужно " + DLC_RUMOR_COST + " кр. за слух");
  player.resources.credits -= DLC_RUMOR_COST;
  rumor.revealed = true;
  d.stats.rumorsBought = (d.stats.rumorsBought ?? 0) + 1;
  chronicle(world, d, "dlc.chronicle.rumor:" + rumorId, rumor.questId);
  if (rumor.lie) {
    d.flags["rumor_lie:" + rumor.id] = 1;
    return ok("Слух оказался ложным…");
  }
  makeAvailable(d, rumor.questId);
  return ok("Слух подтвердился: " + rumor.questId);
}

/** Сигналы в полёте: открываются, когда флот игрока входит в систему. */
export function getDlcSignals(world: World): DlcSignalState[] {
  return ensureDlc(world).signals.map((signal) => ({ ...signal }));
}

export function getDlcRumors(world: World): DlcRumorState[] {
  return ensureDlc(world).rumors.map((rumor) => ({ ...rumor }));
}

export function getDlcBoard(world: World): DlcState["board"] {
  const d = ensureDlc(world);
  return { stationId: d.board.stationId, questIds: [...d.board.questIds], refreshTick: d.board.refreshTick };
}

// ------------------------------------------------------------------ фаза/хуки

function storyStart(world: World, d: DlcState): void {
  if (d.storySent) return;
  d.storySent = true;
  const catalog = dlcCatalog();
  const first = catalog.quests.find((quest) => quest.source.channel === "story_message") ?? catalog.quests[0];
  if (!first) return;
  makeAvailable(d, first.id);
  const accept = dlcAcceptQuest(world, world.playerEmpireId, first.id, "story_message");
  if (accept.ok) {
    d.flags["story_message"] = 1;
    chronicle(world, d, "dlc.chronicle.story_start", first.id);
    if (!d.dialogue?.active) {
      const scene = chooseDialogueForQuest(first.id);
      if (scene) startDlcDialogue(world, scene, first.id);
    }
  }
}

function discoverSignals(world: World, d: DlcState): void {
  const playerFleets = world.fleets.filter((fleet) => fleet.empireId === world.playerEmpireId && fleet.ships.length > 0);
  for (const signal of d.signals) {
    if (signal.revealed) continue;
    if (world.tick > signal.expiresTick) { signal.revealed = false; continue; }
    if (!playerFleets.some((fleet) => fleet.systemId === signal.systemId)) continue;
    signal.revealed = true;
    d.flags["signal_seen:" + signal.id] = 1;
    makeAvailable(d, signal.questId);
    chronicle(world, d, "dlc.chronicle.signal:" + signal.id, signal.questId);
  }
}

function hookReachAndKills(world: World, d: DlcState): void {
  const active = d.activeQuestId ? d.quests[d.activeQuestId] : null;
  if (!active) return;
  const def = dlcQuestById(active.id);
  if (!def) return;
  const step = def.steps[active.step];
  if (!step) return;
  if (step.type === "reach_system") {
    const playerFleets = world.fleets.filter((fleet) => fleet.empireId === world.playerEmpireId && fleet.ships.length > 0);
    for (const fleet of playerFleets) {
      const system = world.systems[fleet.systemId];
      if (!system) continue;
      const targetOk = !step.target || String(system.id) === String(step.target) || system.name === step.target || system.role === step.target;
      if (!targetOk) continue;
      const key = "reached:" + step.id + ":" + world.tick;
      if (d.flags[key]) continue;
      d.flags[key] = 1;
      dlcNotifyAction(world, "reach_system", String(system.id));
      break;
    }
  }
  if (step.type === "kill") {
    const seen = d.flags["battles_seen"] ?? 0;
    if (world.battles.length > seen) {
      for (let i = seen; i < world.battles.length; i++) {
        const battle = world.battles[i];
        if (!battle) continue;
        const playerInvolved = battle.attacker.empireId === world.playerEmpireId || battle.defender.empireId === world.playerEmpireId;
        if (!playerInvolved) continue;
        const hostileSide = battle.attacker.empireId === world.playerEmpireId ? battle.defender.empireId : battle.attacker.empireId;
        dlcNotifyAction(world, "kill", String(hostileSide));
      }
      d.flags["battles_seen"] = world.battles.length;
    }
  }
}

/** Тик DLC: старт истории, доска, слухи/сигналы, дедлайны, хуки шагов. */
export function dlcPhase(world: World): void {
  const d = ensureDlc(world);
  if (!d.enabled) return;
  ensureDlcQuestSystems(world);
  if (!d.storySent) storyStart(world, d);
  ensureRumors(world, d);
  ensureSignals(world, d);
  refreshBoard(world, d);
  discoverSignals(world, d);
  hookReachAndKills(world, d);
  // Дедлайны слухов/сигналов (не купленные/не найденные исчезают).
  if (world.tick % 50 === 0) {
    d.rumors = d.rumors.filter((rumor) => rumor.revealed || world.tick <= rumor.expiresTick);
    d.signals = d.signals.filter((signal) => signal.revealed || world.tick <= signal.expiresTick);
  }
  // Напоминание о текущей цели.
  if (d.activeQuestId && world.tick - d.lastHintTick >= DLC_HINT_INTERVAL) {
    d.lastHintTick = world.tick;
    d.flags["hint_due"] = (d.flags["hint_due"] ?? 0) + 1;
  }
}

// ------------------------------------------------------------------ feature-flag

export function dlcToggle(world: World, enabled: boolean): CommandResult {
  const d = ensureDlc(world);
  if (d.enabled === enabled) return ok(enabled ? "DLC уже включён" : "DLC уже выключен");
  if (!enabled) {
    if (d.activeQuestId) {
      const active = d.quests[d.activeQuestId];
      if (active && active.status === "active") {
        active.status = "expired";
        d.flags["dlc_off_abandoned:" + active.id] = 1;
      }
      d.activeQuestId = null;
    }
    if (d.dialogue?.active) {
      d.flags["dialogue_interrupted"] = (d.flags["dialogue_interrupted"] ?? 0) + 1;
      d.dialogue = null;
    }
    d.enabled = false;
    d.mode = "off";
    return ok("DLC квестов выключен");
  }
  d.enabled = true;
  d.mode = world.tick < 300 ? "full" : "archive";
  if (d.mode === "full" && !d.storySent) {
    d.storySent = false;
  } else {
    d.storySent = true;
  }
  const catalog = dlcCatalog();
  const first = catalog.quests.find((quest) => quest.source.channel === "story_message") ?? catalog.quests[0];
  if (first && d.mode === "full" && d.quests[first.id]?.status === "locked") d.quests[first.id]!.status = "available";
  return ok("DLC квестов включён (" + d.mode + ")");
}

// ------------------------------------------------------------------ аксессоры UI

export interface DlcDialogueView {
  sceneId: string;
  nodeId: string;
  node: DialogueNodeDef | null;
  speaker: CharacterDef | null;
  options: Array<{
    id: string; textKey: string; requiresFlag?: string; available: boolean;
    check?: { stat: string; dc: number };
  }>;
  history: DlcHistoryEntry[];
  questId: string | null;
  seed: number;
  startedTick: number;
}

export function getDlcDialogueView(world: World): DlcDialogueView | null {
  const d = ensureDlc(world);
  const state = d.dialogue;
  if (!state?.active) return null;
  const def = dlcDialogueById(state.sceneId);
  const node = def ? nodeOf(def, state.nodeId) : null;
  const speaker = dlcCharacterById(node?.speaker ?? null);
  const options = (node?.options ?? []).map((option) => ({
    id: option.id, textKey: option.textKey, requiresFlag: option.requiresFlag,
    available: !option.requiresFlag || flagSet(world, d, option.requiresFlag),
    check: option.check ? { stat: option.check.stat, dc: option.check.dc } : undefined,
  }));
  return {
    sceneId: state.sceneId, nodeId: state.nodeId, node, speaker, options,
    history: [...state.history], questId: state.questId, seed: state.seed, startedTick: state.startedTick,
  };
}

export interface DlcTreeView {
  nodes: Array<{ id: string; group: string; type: string; x: number; y: number; status: DlcQuestStatus | "unknown"; questId?: string }>;
  edges: Array<{ from: string; to: string; kind: string }>;
}

export function getDlcTree(world: World): DlcTreeView {
  const d = ensureDlc(world);
  const catalog = dlcCatalog();
  const nodes: DlcTreeView["nodes"] = [];
  if (catalog.tree.nodes.length > 0) {
    for (const node of catalog.tree.nodes) {
      const quest = catalog.quests.find((entry) => entry.id === node.id) ?? catalog.quests.find((entry) => node.id.includes(entry.id));
      const state = quest ? d.quests[quest.id] : null;
      nodes.push({ ...node, status: state?.status ?? "unknown", questId: quest?.id });
    }
    return { nodes, edges: catalog.tree.edges.map((edge) => ({ ...edge })) };
  }
  // Fallback: строим дерево из квестов/nextHint.
  catalog.quests.forEach((quest, index) => {
    nodes.push({
      id: quest.id, group: quest.line, type: quest.type, x: (quest.act - 1) * 200,
      y: index * 90, status: d.quests[quest.id]?.status ?? "unknown", questId: quest.id,
    });
  });
  const edges = catalog.quests
    .filter((quest) => quest.nextHint)
    .map((quest) => ({ from: quest.id, to: quest.nextHint!, kind: "required" }));
  return { nodes, edges };
}

export interface DlcMarker {
  kind: "quest" | "signal" | "rumor" | "board";
  id: string;
  questId: string;
  systemId?: number;
  stationId?: number;
  labelKey: string;
  revealed: boolean;
}

export function getDlcMarkers(world: World): DlcMarker[] {
  const d = ensureDlc(world);
  const markers: DlcMarker[] = [];
  if (d.board.stationId && d.board.questIds.length > 0) {
    for (const questId of d.board.questIds) {
      markers.push({ kind: "board", id: "board:" + questId, questId, stationId: d.board.stationId, labelKey: "dlc.marker.board", revealed: true });
    }
  }
  for (const signal of d.signals) {
    markers.push({ kind: "signal", id: signal.id, questId: signal.questId, systemId: signal.systemId, labelKey: "dlc.marker.signal", revealed: signal.revealed });
  }
  for (const rumor of d.rumors) {
    markers.push({ kind: "rumor", id: rumor.id, questId: rumor.questId, labelKey: "dlc.marker.rumor", revealed: rumor.revealed });
  }
  const active = d.activeQuestId ? d.quests[d.activeQuestId] : null;
  if (active) {
    const def = dlcQuestById(active.id);
    const step = def?.steps[active.step];
    const target = step?.target ?? "";
    markers.push({
      kind: "quest", id: "quest:" + active.id, questId: active.id,
      systemId: dlcTargetSystemId(world, target),
      labelKey: step?.titleKey ?? def?.titleKey ?? "dlc.marker.quest", revealed: true,
    });
  }
  return markers;
}

export function getDlcCharacters(): CharacterDef[] {
  return dlcCatalog().characters;
}
