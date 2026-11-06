import { useEffect, useState } from "react";
import type {
  Attitude, CampaignBranch, CampaignState, Contract, ContractKind, CrisisKind, CrisisState,
  EmpireAdvanced, EmpireRelation, EspionageOp, ExchangeState, FullGameState, LocalMarket,
  MarketState, MegastructureState, MegastructureType, NarrativeEvent, AnomalyState, ArchaeologyState,
  TradeRoute, TreatyKind, VictoryProgress, World, Command,
} from "@sf/sim";
import { relationKey } from "@sf/sim";
import type {
  ArchaeologyDef, CampaignActDef, CampaignMissionDef, CouncilResolutionDef, CrisisDef, EndingDef,
  EspionageOpDef, MegastructureDef, NarrativeEventDef, PerkDef, TraditionTreeDef,
} from "@sf/data";
import {
  ARCHAEOLOGY, BRANCHES, CAMPAIGN_ACTS, CAMPAIGN_MISSIONS, COUNCIL_RESOLUTIONS, CRISES,
  ENDINGS, ESPIONAGE_OPS, L10N_EN, L10N_RU, MEGASTRUCTURES, NARRATIVE_EVENTS, PERKS,
  TRADITION_TREES, ANOMALIES, RACES, RACE_BY_ID, RACE_TRAITS, ANCIENTS_TECHS, ANCIENTS_QUESTS,
  ANCIENTS_CODEX, SECTOR_FACTIONS, SECTOR_POIS, SECTOR_REGIONS, SECTOR_HAZARDS, ANCIENTS_ENDINGS,
  DLC_QUESTS, DLC_DIALOGUES, DLC_CHARACTERS, DLC_CARDS, DLC_TREE,
  DLC_QUEST_BY_ID, DLC_DIALOGUE_BY_ID, DLC_CHARACTER_BY_ID, DLC_CARD_BY_QUEST,
} from "@sf/data";
import * as sfData from "@sf/data";
import * as simApi from "@sf/sim";
import type { Game } from "../game/Game";
import { num, rnd } from "./util";

// ================================================================ состояние fg
/** world.fg существует сразу после createWorld (queries.ts вызывает createFullGameState). */
export function fgOf(world: World | null | undefined): FullGameState | null {
  return world?.fg ?? null;
}

export function advOf(world: World | null | undefined, empireId: number): EmpireAdvanced | null {
  const fg = fgOf(world);
  return fg?.empires[empireId] ?? null;
}

export function relOf(world: World | null | undefined, a: number, b: number): EmpireRelation | null {
  const fg = fgOf(world);
  return fg?.relations[relationKey(a, b)] ?? null;
}

export function localMarketOf(fg: FullGameState | null, stationId: number | null): LocalMarket | null {
  if (!fg || stationId == null) return null;
  return fg.markets[stationId] ?? null;
}

export function playerIdOf(world: World | null | undefined): number {
  return world?.playerEmpireId ?? 0;
}

export interface FullPanelProps {
  game: Game;
  state: import("../game/types").GameState;
  onClose: () => void;
}

/** Пробует несколько вариантов команды (алиасы sim) до первого успешного. */
export function sendFirst(game: Game, cmds: Record<string, unknown>[]): boolean {
  for (const c of cmds) {
    try {
      if (game.sendCommand(c as unknown as Command)) return true;
    } catch { /* пробуем следующий вариант */ }
  }
  return false;
}

export function send(game: Game, cmd: Command): boolean {
  try {
    return game.sendCommand(cmd);
  } catch {
    return false;
  }
}

// ================================================================ безопасные данные
export function dataArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export const TRADITION_TREE_LIST: TraditionTreeDef[] = dataArray<TraditionTreeDef>(TRADITION_TREES);
export const PERK_LIST: PerkDef[] = dataArray<PerkDef>(PERKS);
export const MEGA_LIST: MegastructureDef[] = dataArray<MegastructureDef>(MEGASTRUCTURES);
export const CRISIS_LIST: CrisisDef[] = dataArray<CrisisDef>(CRISES);
export const RESOLUTION_LIST: CouncilResolutionDef[] = dataArray<CouncilResolutionDef>(COUNCIL_RESOLUTIONS);
export const ESPIONAGE_LIST: EspionageOpDef[] = dataArray<EspionageOpDef>(ESPIONAGE_OPS);
export const ACT_LIST: CampaignActDef[] = dataArray<CampaignActDef>(CAMPAIGN_ACTS);
export const CAMPAIGN_MISSION_LIST: CampaignMissionDef[] = dataArray<CampaignMissionDef>(CAMPAIGN_MISSIONS);
export const EVENT_LIST: NarrativeEventDef[] = dataArray<NarrativeEventDef>(NARRATIVE_EVENTS);
export const ANOMALY_LIST: import("@sf/data").AnomalyDef[] = dataArray(ANOMALIES);
export const ARCHAEOLOGY_LIST: ArchaeologyDef[] = dataArray<ArchaeologyDef>(ARCHAEOLOGY);
export const ENDING_LIST: EndingDef[] = dataArray<EndingDef>(ENDINGS);
export const BRANCH_LIST: import("@sf/data").BranchDef[] = dataArray(BRANCHES);

// ================================================================ локализация
const LOCALE_KEY = "sf.locale";
export type Locale = "ru" | "en";
const localeListeners = new Set<() => void>();

function readLocale(): Locale {
  try {
    return localStorage.getItem(LOCALE_KEY) === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}
type ContentLocaleApi = {
  applyContentLocale?: (l: Locale) => void;
  transliterateRu?: (text: string) => string;
};

/**
 * Мутирует загруженный контент @sf/data под локаль (EN-поля из l10n/content-en.auto.json)
 * и возвращает RU при обратном переключении. Вызывается ДО оповещения подписчиков,
 * чтобы React-рендер уже видел переведённые данные.
 */
function applyContent(locale: Locale): void {
  const fn = (sfData as unknown as ContentLocaleApi).applyContentLocale;
  if (typeof fn !== "function") return;
  try {
    fn(locale);
  } catch (err) {
    console.warn("[i18n] applyContentLocale failed", err);
  }
}

// ---------------------------------------------------------------- имена мира (процедурные)
// world.systems/empires/stations/… создаются из RU-данных; для EN транслитерируем их
// и запоминаем оригиналы, при возврате RU — восстанавливаем.
interface NameBinding { obj: Record<string, unknown>; prop: string; original: string; }
let nameBindings: NameBinding[] = [];
let boundWorld: unknown = null;
let worldProvider: (() => unknown) | null = null;

/** Регистрирует источник мира (Game), чтобы setLocale мог переименовать сущности. */
export function registerWorldProvider(provider: () => unknown): void {
  worldProvider = provider;
}

function currentWorld(): unknown {
  try {
    return worldProvider ? worldProvider() : null;
  } catch {
    return null;
  }
}

function bindName(bindings: NameBinding[], obj: unknown, prop: string, translit: (s: string) => string): void {
  if (!obj || typeof obj !== "object") return;
  const rec = obj as Record<string, unknown>;
  const value = rec[prop];
  if (typeof value !== "string" || !/[А-Яа-яЁё]/.test(value)) return;
  bindings.push({ obj: rec, prop, original: value });
  rec[prop] = translit(value);
}

/** Транслитерирует/восстанавливает имена систем, планет, станций, империй, флотов, кораблей, колоний. */
export function localizeWorldNames(locale: Locale = currentLocale): void {
  const world = currentWorld() as import("@sf/sim").World | null;
  const translit = (sfData as unknown as ContentLocaleApi).transliterateRu;

  if (locale !== "en") {
    for (const b of nameBindings) b.obj[b.prop] = b.original;
    nameBindings = [];
    boundWorld = null;
    return;
  }
  if (typeof translit !== "function") return;
  if (world && world === boundWorld && nameBindings.length > 0) return;
  // новый мир или повторный вызов: сначала вернуть старые, затем связать новые
  for (const b of nameBindings) b.obj[b.prop] = b.original;
  nameBindings = [];
  boundWorld = world;
  if (!world) return;
  const bindings: NameBinding[] = [];
  for (const system of world.systems) {
    bindName(bindings, system, "name", translit);
    for (const planet of system.planets) bindName(bindings, planet, "name", translit);
    if (system.station) bindName(bindings, system.station, "nameRu", translit);
    for (const poi of system.poi) bindName(bindings, poi, "nameRu", translit);
  }
  for (const empire of world.empires) bindName(bindings, empire, "name", translit);
  for (const fleet of world.fleets) {
    bindName(bindings, fleet, "name", translit);
    for (const ship of fleet.ships) bindName(bindings, ship, "name", translit);
  }
  for (const colony of world.colonies) bindName(bindings, colony, "name", translit);
  nameBindings = bindings;
}

/** Переприменить контент+имена (после newGame/loadGame, смены мира). */
export function refreshContentLocale(): void {
  applyContent(currentLocale);
  localizeWorldNames(currentLocale);
}

let currentLocale: Locale = readLocale();
applyContent(currentLocale);
if (typeof document !== "undefined") document.documentElement.lang = currentLocale;

export function getLocale(): Locale {
  return currentLocale;
}
export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  // Сначала мутируем контент и имена мира, затем оповещаем подписчиков.
  applyContent(locale);
  currentLocale = locale;
  localizeWorldNames(locale);
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch { /* noop */ }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  for (const l of localeListeners) l();
}
export function useLocale(): Locale {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((v) => v + 1);
    localeListeners.add(f);
    return () => { localeListeners.delete(f); };
  }, []);
  return currentLocale;
}
/** t(key, params, fallback): словари @sf/data, фолбэк — русская строка UI. */
export function tr(key: string, params?: Record<string, string | number>, fallback?: string): string {
  const dict = currentLocale === "en" ? L10N_EN : L10N_RU;
  let s = dict[key] ?? fallback ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split("{" + k + "}").join(String(v));
  return s;
}
export const L = (ru: string, en: string): string => (currentLocale === "en" ? en : ru);

// ================================================================ доступность/эффекты
export type ColorblindMode = "none" | "deuteranopia" | "protanopia" | "tritanopia";
const CB_KEY = "sf.colorblind";
export function getColorblind(): ColorblindMode {
  try {
    const v = localStorage.getItem(CB_KEY);
    if (v === "deuteranopia" || v === "protanopia" || v === "tritanopia") return v;
  } catch { /* noop */ }
  return "none";
}
export function applyColorblind(mode: ColorblindMode): void {
  try { localStorage.setItem(CB_KEY, mode); } catch { /* noop */ }
  if (typeof document !== "undefined") {
    if (mode === "none") delete document.documentElement.dataset.colorblind;
    else document.documentElement.dataset.colorblind = mode;
  }
}
export function initAccessibility(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = currentLocale;
  const cb = getColorblind();
  if (cb !== "none") document.documentElement.dataset.colorblind = cb;
}
export interface AccessibilityFlags {
  subtitles: boolean;
  reduceFlashes: boolean;
  highContrast: boolean;
}
const A11Y_KEY = "sf.a11y";
export function getA11yFlags(): AccessibilityFlags {
  try {
    const raw = localStorage.getItem(A11Y_KEY);
    if (raw) return { subtitles: true, reduceFlashes: false, highContrast: false, ...(JSON.parse(raw) as Partial<AccessibilityFlags>) };
  } catch { /* noop */ }
  return { subtitles: true, reduceFlashes: false, highContrast: false };
}
export function setA11yFlags(patch: Partial<AccessibilityFlags>): AccessibilityFlags {
  const next = { ...getA11yFlags(), ...patch };
  try { localStorage.setItem(A11Y_KEY, JSON.stringify(next)); } catch { /* noop */ }
  if (typeof document !== "undefined") {
    document.documentElement.dataset.reduceFlashes = next.reduceFlashes ? "1" : "0";
    document.documentElement.dataset.highContrast = next.highContrast ? "1" : "0";
  }
  return next;
}

// ================================================================ словари RU
export const TREATY_RU: Record<TreatyKind, string> = {
  nap: "Пакт о ненападении",
  trade: "Торговый договор",
  research: "Договор об исследованиях",
  defensive: "Оборонительный союз",
  alliance: "Наступательный союз",
  federation: "Федерация",
  vassal: "Вассалитет",
  tribute: "Дань",
};
export const TREATY_ORDER: TreatyKind[] = ["nap", "trade", "research", "defensive", "alliance", "federation", "vassal", "tribute"];
export const TREATY_OFFERABLE: TreatyKind[] = ["nap", "trade", "research", "defensive", "alliance", "federation"];

export const ATTITUDE_RU: Record<Attitude, string> = {
  ally: "Союзник",
  friendly: "Дружелюбно",
  neutral: "Нейтрально",
  cold: "Прохладно",
  hostile: "Враждебно",
  rival: "Соперник",
};

export const CB_RU: Record<string, string> = {
  conquest: "Завоевание",
  liberation: "Освобождение",
  humiliation: "Унижение",
  vassalization: "Вассализация",
  crisis: "Кризис",
  defensive: "Оборонительная война",
  none: "Без повода",
};

export const MARKET_STATE_RU: Record<MarketState, string> = {
  calm: "Стабильно",
  boom: "Подъём",
  bust: "Спад",
  famine: "Голод",
  war: "Военная экономика",
  blockade: "Блокада",
  plague: "Эпидемия",
  plague2: "Пандемия",
};

export const ESPIONAGE_OP_RU: Record<EspionageOp, string> = {
  fleet_recon: "Разведка флота",
  steal_tech: "Кража технологий",
  sabotage: "Саботаж",
  incite: "Подстрекательство",
  steal_map: "Кража карт",
  assassinate: "Устранение лидера",
};
export const ESPIONAGE_ORDER: EspionageOp[] = ["fleet_recon", "steal_tech", "sabotage", "incite", "steal_map", "assassinate"];

export const CONTRACT_KIND_RU: Record<ContractKind, string> = {
  delivery: "Доставка",
  bounty: "Охота за головами",
  scan: "Разведка",
  passenger: "Пассажиры",
  smuggle: "Контрабанда",
  rescue: "Спасение",
  mining: "Добыча",
  tourist: "Туризм",
  escort: "Сопровождение",
  salvage: "Спасение груза",
  hunt: "Охота",
  evacuation: "Эвакуация",
};

export const BRANCH_RU: Record<CampaignBranch, string> = {
  undecided: "Не выбрана",
  federation: "Федерация",
  sovereignty: "Суверенитет",
  syndicate: "Синдикат",
};
export const BRANCH_DESC: Record<CampaignBranch, string> = {
  undecided: "Ветка не выбрана — доступны все цели.",
  federation: "Объединение галактики договорами и советом.",
  sovereignty: "Сильная независимая империя, военное превосходство.",
  syndicate: "Торговый синдикат: рынки, шпионаж, контрабанда.",
};

export const CRISIS_KIND_RU: Record<CrisisKind, string> = {
  void_reavers: "Мародёры Пустоты",
  synthetic_revolt: "Пробуждение Соборов",
  grey_tide: "Серый Прилив",
  devourers: "Пожиратели Пустоты",
  ancient_awakening: "Пробуждение древних",
};

export const MEGA_RU: Record<MegastructureType, string> = {
  sentinel_array: "Массив стражей",
  gate: "Врата",
  star_forge: "Звёздная кузница",
  ring_habitat: "Кольцевой мир",
  dyson_sphere: "Сфера Дайсона",
  science_nexus: "Научный узел",
  beacon: "Маяк",
};
export const MEGA_ORDER: MegastructureType[] = [
  "sentinel_array", "gate", "star_forge", "ring_habitat", "dyson_sphere", "science_nexus", "beacon",
];

/** Человекочитаемый тип резолюции совета, если контент ещё не загружен. */
export function resolutionRu(type: string, fallback?: string): string {
  const map: Record<string, string> = {
    research_funding: "Финансирование науки",
    fleet_subsidy: "Субсидия флоту",
    sanctions: "Санкции",
    galactic_tax: "Галактический налог",
    peace_initiative: "Мирная инициатива",
    open_borders: "Открытые границы",
    mutual_defense: "Взаимная оборона",
    denounce: "Осуждение",
    crisis_relief: "Помощь в кризисе",
    trade_pact: "Торговый пакт",
  };
  return fallback ?? map[type] ?? type;
}

// ================================================================ DLC XIV «Первый Свет»
export type DlcState = import("@sf/sim").DlcState;
export type DlcChannel = import("@sf/sim").DlcChannel;

/** Состояние DLC через ensureDlc (экспортирован из @sf/sim), fallback — world.fg.dlc. */
export function dlcOf(world: World | null | undefined): DlcState | null {
  if (!world) return null;
  try {
    const fn = (simApi as unknown as { ensureDlc?: (w: World) => DlcState }).ensureDlc;
    if (typeof fn === "function") return fn(world);
  } catch (err) {
    console.warn("[dlc] ensureDlc failed", err);
  }
  return world.fg?.dlc ?? null;
}

/** Текст по l10n-ключу (textKey/titleKey/summaryKey), fallback — сам ключ. */
export function dlcText(key: string | null | undefined, fallback?: string): string {
  if (!key) return fallback ?? "";
  return tr(key, undefined, fallback ?? key);
}

export const DLC_CHANNEL_RU: Record<DlcChannel, string> = {
  story_message: "Сюжетное сообщение",
  board: "Доска заданий",
  rumor: "Слух",
  signal: "Сигнал",
};
export const DLC_CHANNEL_EN: Record<DlcChannel, string> = {
  story_message: "Story message",
  board: "Quest board",
  rumor: "Rumor",
  signal: "Signal",
};

export const EMOTION_RU: Record<string, string> = {
  neutral: "нейтрально",
  warm: "тепло",
  cold: "холодно",
  angry: "гнев",
  afraid: "страх",
  sad: "печаль",
};
export const EMOTION_EN: Record<string, string> = {
  neutral: "neutral",
  warm: "warm",
  cold: "cold",
  angry: "angry",
  afraid: "afraid",
  sad: "sad",
};
/** Пиксельный «портрет»: рамка + эмоция-цвет + инициал персонажа. */
export const EMOTION_COLOR: Record<string, string> = {
  neutral: "#8FA3BF", warm: "#F5C542", cold: "#4FC3F7",
  angry: "#FF5A5A", afraid: "#B06BFF", sad: "#7A8798",
};

export function characterOf(id: string | null | undefined) {
  return id ? DLC_CHARACTER_BY_ID[id] ?? null : null;
}

export function questOf(id: string | null | undefined) {
  return id ? DLC_QUEST_BY_ID[id] ?? null : null;
}

export function dlcEnabledOf(world: World | null | undefined): boolean {
  return dlcOf(world)?.enabled ?? false;
}

// ---------------------------------------------------------------- последствия диалогов (XIV)
export interface DlcEffectView {
  kind: string;
  key?: string;
  value?: number | string;
  labelKey?: string;
  labelRu?: string;
}
export interface DlcConsequenceView {
  tick: number;
  sceneId: string;
  nodeId?: string;
  choiceId?: string;
  questId?: string;
  questTitleKey?: string;
  effects: DlcEffectView[];
}
export interface DlcDialogueOptionView {
  id: string;
  textKey: string;
  requiresFlag?: string;
  available: boolean;
  check?: { stat: string; dc: number };
  consequences?: DlcEffectView[];
}
export interface DlcDialogueViewLike {
  sceneId: string;
  nodeId: string;
  node: unknown;
  speaker: import("@sf/data").CharacterDef | null;
  options: DlcDialogueOptionView[];
  history: { nodeId: string; speaker?: string; emotion?: string; textKey?: string; choiceId?: string; tick?: number }[];
  questId: string | null;
  seed: number;
  startedTick: number;
  context?: string;
  campaignAct?: number;
}

type DlcExtraApi = {
  getDlcDialogueView?: (w: World) => DlcDialogueViewLike | null;
  getDlcConsequences?: (w: World, limit?: number) => DlcConsequenceView[];
  getDlcModalState?: (w: World) => { dialogueActive: boolean; sceneId?: string; campaign?: boolean; context?: string; pendingEventId?: number | null; priority: string; paused: boolean };
  isDlcDialogueActive?: (w: World) => boolean;
};

export function dlcDialogueViewOf(world: World | null | undefined): DlcDialogueViewLike | null {
  if (!world) return null;
  try { return (simApi as unknown as DlcExtraApi).getDlcDialogueView?.(world) ?? null; } catch { return null; }
}
export function dlcConsequencesOf(world: World | null | undefined, limit = 12): DlcConsequenceView[] {
  if (!world) return [];
  try { return (simApi as unknown as DlcExtraApi).getDlcConsequences?.(world, limit) ?? []; } catch { return []; }
}
export function dlcModalStateOf(world: World | null | undefined) {
  if (!world) return null;
  try { return (simApi as unknown as DlcExtraApi).getDlcModalState?.(world) ?? null; } catch { return null; }
}

export const DLC_EFFECT_KIND_RU: Record<string, [string, string]> = {
  flag: ["флаг", "flag"],
  rep: ["репутация", "reputation"],
  relation: ["отношения", "relations"],
  openQuest: ["новый квест", "new quest"],
  branch: ["ветка сюжета", "story branch"],
  campaignFlag: ["флаг кампании", "campaign flag"],
  credits: ["кредиты", "credits"],
  timeSkip: ["сдвиг времени", "time skip"],
  chronicle: ["запись в хронику", "chronicle entry"],
  reward: ["награда", "reward"],
  endingHint: ["намёк на концовку", "ending hint"],
  unlockMission: ["открыта миссия", "mission unlocked"],
  alloys: ["сплавы", "alloys"],
  influence: ["влияние", "influence"],
  science: ["наука", "science"],
  item: ["предмет", "item"],
  effect: ["последствие", "effect"],
};
/** Подпись эффекта: labelRu/labelKey из sim, иначе RU-название kind + ключ/значение. */
export function dlcEffectLabel(e: DlcEffectView): string {
  if (e.labelRu) return e.labelRu;
  if (e.labelKey) return dlcText(e.labelKey);
  const kind = DLC_EFFECT_KIND_RU[e.kind] ?? [e.kind, e.kind];
  const base = L(kind[0], kind[1]);
  const tail = e.key && String(e.key) !== String(e.kind) ? ": " + dlcText(String(e.key), String(e.key)) : "";
  const val = e.value != null ? " " + (typeof e.value === "number" && e.value > 0 ? "+" : "") + String(e.value) : "";
  return base + tail + val;
}
export function dlcPreviewEffects(effects: unknown): DlcEffectView[] {
  if (!Array.isArray(effects)) return [];
  return effects.map((raw) => {
    const e = raw as Record<string, unknown>;
    if (e.kind) return e as unknown as DlcEffectView;
    if (typeof e.labelRu === "string") return { kind: "effect", labelRu: e.labelRu } as unknown as DlcEffectView;
    // кампанийные сцены: {campaignFlag:"camp_x"}, {relation:{target:delta}}, {credits:-1000}, {effectLabelKey:"..."}
    if (typeof e.effectLabelKey === "string") return { kind: "effect", labelKey: e.effectLabelKey } as unknown as DlcEffectView;
    const keys = Object.keys(e).filter((k) => k !== "labelKey" && k !== "labelRu");
    const kind = keys[0] ?? "effect";
    const v = e[kind];
    if (typeof e.labelKey === "string") return { kind, labelKey: e.labelKey } as unknown as DlcEffectView;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const parts = Object.entries(v as Record<string, unknown>).map(([k, n]) => k + " " + (typeof n === "number" && n > 0 ? "+" : "") + String(n));
      return { kind, key: parts.join(", ") } as unknown as DlcEffectView;
    }
    if (typeof v === "number") return { kind, value: v } as unknown as DlcEffectView;
    if (typeof v === "string") return { kind, key: v } as unknown as DlcEffectView;
    if (typeof v === "boolean") return { kind } as unknown as DlcEffectView;
    return { kind } as unknown as DlcEffectView;
  });
}

/** Сигналы в мире (для маркеров карты/HUD). */
export function dlcSignals(world: World | null | undefined) {
  const d = dlcOf(world);
  if (!d || !d.enabled) return [];
  return d.signals;
}

// ================================================================ Древние (Часть XIII)
export const RACE_TAG_RU: Record<string, string> = {
  // 8 играбельных (tag из races.json → RU в стиле 13a)
  human_adaptant: "Адаптанты",
  ansari_descendant: "Потомки Ансаров",
  silicon_conglomerate: "Кремнёвый конгломерат",
  ark_nomad: "Кочевники-ковчеги",
  depth_theocracy: "Глубинная теократия",
  freeport_syndicate: "Синдикат вольных портов",
  insectoid_hive: "Инсектоидный улей",
  crystalline_singer: "Кристаллические певцы",
  // NPC-расы
  npc_trader_guild: "Торговые гильдии",
  npc_pirates: "Пираты",
  npc_nomads: "Кочевники",
  npc_cultists: "Культисты",
  npc_mercenaries: "Наёмники",
  npc_ai_archive: "ИИ-архив",
  npc_couriers: "Курьеры",
  npc_slaver: "Работорговцы",
  npc_slavers: "Работорговцы",
  npc_guardians: "Хранители",
  npc_refugees: "Беженцы",
  npc_chorus_cult: "Культ Хора",
  npc_ansari_silent: "Ансары-остатки",
};
/** RU-название архетипа расы; EN — исходный tag. */
export function raceTagLabel(tag: string): string {
  return currentLocale === "en" ? tag : (RACE_TAG_RU[tag] ?? "раса");
}
export type AncientsState = import("@sf/sim").AncientsState;
type AncientsApi = {
  getAncientsState?: (w: World) => AncientsState;
  ensureAncients?: (w: World) => AncientsState;
  setPlayerRace?: (w: World, empireId: number, raceId: string) => unknown;
  getRaceChoices?: () => import("@sf/data").RaceDef[];
  ensureSectorGenerated?: (w: World) => import("@sf/sim").AncientsSectorState;
};

/** Состояние Части XIII через sim-аксессор (getAncientsState/ensureAncients), fallback — world.fg.ancients. */
export function ancientsOf(world: World | null | undefined): AncientsState | null {
  if (!world) return null;
  const api = simApi as unknown as AncientsApi;
  try {
    if (typeof api.getAncientsState === "function") return api.getAncientsState(world);
    if (typeof api.ensureAncients === "function") return api.ensureAncients(world);
  } catch (err) {
    console.warn("[ancients] state accessor failed", err);
  }
  return world.fg?.ancients ?? null;
}

/** Идемпотентно генерирует Реликтовый Предел (45 систем), если sim API доступен. */
export function sectorOf(world: World | null | undefined): import("@sf/sim").AncientsSectorState | null {
  const a = ancientsOf(world);
  if (!a) return null;
  const api = simApi as unknown as AncientsApi;
  try {
    if (typeof api.ensureSectorGenerated === "function") return api.ensureSectorGenerated(world!);
  } catch (err) {
    console.warn("[ancients] ensureSectorGenerated failed", err);
  }
  return a.sector;
}

/** Список рас для экрана создания империи (sim: getRaceChoices, fallback — данные). */
export function raceChoices(): import("@sf/data").RaceDef[] {
  const api = simApi as unknown as AncientsApi;
  try {
    const races = api.getRaceChoices?.();
    if (Array.isArray(races) && races.length > 0) return races;
  } catch { /* fallback */ }
  return RACES.filter((r) => r.playable !== false);
}

export function raceDefOf(raceId: string | null | undefined): import("@sf/data").RaceDef | null {
  return raceId ? RACE_BY_ID[raceId] ?? null : null;
}

/** Применяет выбранную расу: sim setPlayerRace (бонусы/валидация), fallback — мутация ancients. */
export function applyRaceChoice(game: Game, raceId: string): boolean {
  if (!game.hasWorld) return false;
  const world = game.world;
  const a = ancientsOf(world);
  const race = RACE_BY_ID[raceId];
  if (!a || !race) return false;
  const api = simApi as unknown as AncientsApi;
  let ok = false;
  try {
    if (typeof api.setPlayerRace === "function") { api.setPlayerRace(world, world.playerEmpireId, raceId); ok = true; }
  } catch (err) {
    console.warn("[ancients] setPlayerRace failed", err);
  }
  if (!ok) {
    a.playerRace = raceId;
    a.races[world.playerEmpireId] = raceId;
    a.relics = Math.max(a.relics, race.start.relics ?? 0);
    a.cores = Math.max(a.cores, race.start.cores ?? 0);
  }
  game.toast(tr("race.selected", { name: race.ru }, "Раса выбрана: " + race.ru), "info");
  return true;
}

// ---------------------------------------------------------------- названия модификаторов (RU)
const EFFECT_RU: Record<string, string> = {
  science_prod: "Наука (все школы)",
  science_flat_per_school: "Наука за школу",
  sensor_range: "Дальность сенсоров",
  anomaly_speed: "Скорость исследования аномалий",
  extra_tech_choice: "Доп. альтернатива технологий",
  science_burst: "Всплеск науки",
  science_burst_ticks: "Длительность всплеска науки",
  energy_prod: "Производство энергии",
  minerals_prod: "Добыча минералов",
  food_prod: "Производство пищи",
  alloys_prod: "Производство сплавов",
  goods_prod: "Производство товаров",
  unity_prod: "Единство",
  influence_prod: "Влияние",
  fleet_cap: "Лимит флота",
  fleet_cap_flat: "Лимит флота (плоский)",
  fleet_cap_pct: "Лимит флота (%)",
  fleet_upkeep: "Содержание флота",
  ship_cost: "Стоимость кораблей",
  build_speed: "Скорость строительства",
  pop_growth: "Рост населения",
  stability: "Стабильность",
  happiness: "Счастье",
  claim_cost: "Стоимость притязаний",
  outpost_cost: "Стоимость аутпоста",
  colony_cost: "Стоимость колонии",
  diplo_opinion: "Мнение в дипломатии",
  war_score: "Военный счёт",
  weapon_damage: "Урон оружия",
  shield: "Щиты",
  armor: "Броня",
  trade_margin: "Торговая маржа",
  megastructure_cost: "Стоимость мегаструктур",
  megastructure_unlock: "Доступ к мегаструктурам",
  invasion: "Вторжение",
  flagship_autoescape: "Автоотступление флагмана",
  research_speed: "Скорость исследований",
  unity_mult: "Множитель единства",
  influence_mult: "Множитель влияния",
  pop_food_upkeep: "Потребление пищи",
  station_rep: "Репутация на станциях",
};

/** Название эффекта-модификатора: RU-словарь, EN — исходный ключ. */
export function effectLabel(key: string): string {
  return currentLocale === "en" ? key : (EFFECT_RU[key] ?? "модификатор");
}
export function effectText(key: string, value: number): string {
  return effectLabel(key) + " " + (value > 0 ? "+" : "") + value;
}

// ================================================================ форматирование
export function opinionTone(opinion: number): "" | "sf-ok" | "sf-warn" | "sf-bad" {
  if (opinion >= 40) return "sf-ok";
  if (opinion >= 0) return "";
  if (opinion >= -40) return "sf-warn";
  return "sf-bad";
}

export function oddsText(v01: number): string {
  return rnd(num(v01) * 100) + "%";
}

export function signedNum(v: number, digits = 0): string {
  const x = num(v);
  const abs = Math.abs(x).toFixed(digits).replace(".", ",");
  return x > 0 ? "+" + abs : x < 0 ? "−" + abs : "0";
}

/** Прогресс условия победы в процентах (0..100). */
export function victoryPct(v: number): number {
  return rnd(Math.max(0, Math.min(1, num(v))) * 100);
}

export function treatyActive(rel: EmpireRelation | null, kind: TreatyKind): boolean {
  return !!rel?.treaties?.[kind]?.active;
}

export function systemName(world: World | null, id: number | null | undefined): string {
  if (!world || id == null) return "—";
  return world.systems.find((s) => s.id === id)?.name ?? "—";
}

export function empireName(world: World | null, id: number | null | undefined): string {
  if (!world || id == null) return "—";
  return world.empires.find((e) => e.id === id)?.name ?? "—";
}

export function empireColor(world: World | null, id: number | null | undefined): string {
  if (!world || id == null) return "#8FA3BF";
  return world.empires.find((e) => e.id === id)?.color ?? "#8FA3BF";
}

export interface CampaignObjectiveView {
  id: string;
  type: string;
  targetSystemId?: number;
  count: number;
  progress: number;
  done: boolean;
}
export interface CampaignMissionView {
  id: string;
  act: number;
  titleRu: string;
  briefingRu: string;
  giver: string;
  branchRequired: CampaignBranch | null;
  secret: boolean;
  objectives: CampaignObjectiveView[];
  rewards: import("@sf/sim").ContractRewards;
  status: import("@sf/sim").CampaignMission["status"];
  failCondition: string | null;
}

const GIVER_RU: Record<string, string> = {
  legacy: "Наследие",
  federation: "Федерация",
  sovereignty: "Суверенитет",
  syndicate: "Синдикат",
  council: "Совет",
  admiral: "Адмирал",
};

/** Миссии кампании: данные @sf/data + состояние симуляции в одном view-типе. */
export function campaignMissionList(campaign: CampaignState | null): CampaignMissionView[] {
  if (!campaign) return [];
  const stateById = campaign.missions;
  const ids = CAMPAIGN_MISSION_LIST.length > 0
    ? CAMPAIGN_MISSION_LIST.map((m) => m.id)
    : Object.keys(stateById);
  return ids.map((id) => {
    const def = CAMPAIGN_MISSION_LIST.find((m) => m.id === id);
    const st = stateById[id];
    const objectives: CampaignObjectiveView[] = st?.objectives?.length
      ? st.objectives.map((o) => ({ id: o.id, type: o.type, targetSystemId: o.targetSystemId, count: o.count, progress: o.progress, done: o.done }))
      : (def?.objectives ?? []).map((o, i) => ({
          id: o.id || "obj" + i,
          type: o.type,
          targetSystemId: o.targetSystemId,
          count: o.count ?? 1,
          progress: 0,
          done: false,
        }));
    const status: import("@sf/sim").CampaignMission["status"] = st?.status
      ?? ((def?.act ?? 1) <= campaign.act ? "available" : "locked");
    return {
      id,
      // тексты берём из @sf/data (переводятся applyContentLocale), а не из runtime-снимка симуляции:
      // World.fg.campaign.missions хранит RU-строки, созданные при старте мира.
      act: def?.act ?? st?.act ?? 1,
      titleRu: def?.titleRu ?? st?.titleRu ?? id,
      briefingRu: def?.briefingRu ?? st?.briefingRu ?? "",
      giver: currentLocale === "ru" ? (GIVER_RU[def?.giver ?? ""] ?? def?.giver ?? st?.giver ?? "—") : (def?.giver ?? st?.giver ?? "—"),
      branchRequired: (st?.branchRequired ?? (def?.branchRequired as CampaignBranch | null) ?? null),
      secret: st?.secret ?? def?.secret ?? false,
      objectives,
      rewards: st?.rewards ?? {
        credits: def?.rewards.credits ?? 0,
        alloys: def?.rewards.alloys,
        influence: def?.rewards.influence,
        reputation: def?.rewards.reputation,
        science: def?.rewards.science as import("@sf/sim").SciencePoints | undefined,
      },
      status,
      failCondition: st?.failCondition ?? null,
    };
  });
}

export { fgOf as fg };

/** Реактивный тик для панелей (обновляет раз в N мс, чтобы не подписываться на каждый refresh). */
export function useTickClock(intervalMs = 500): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((v) => v + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return n;
}

export type { NarrativeEvent, AnomalyState, ArchaeologyState, CrisisState, MegastructureState, Contract, TradeRoute, ExchangeState, VictoryProgress, EmpireAdvanced, EmpireRelation, LocalMarket, FullGameState };


/** EN-названия типов станций (ключей l10n для station.kind.* нет — локальная карта UI). */
export const STATION_KIND_EN: Record<string, string> = {
  outpost: "Outpost",
  shipyard: "Shipyard",
  mining: "Mining station",
  research: "Research station",
  pirate: "Pirate station",
  trade: "Trade station",
};
