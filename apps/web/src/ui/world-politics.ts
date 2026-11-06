import * as sim from "@sf/sim";
import type { World } from "@sf/sim";
import { L } from "./fg";

/** Часть XV (task-43): мировая политика ИИ-ИИ — матрица, лента, события, влияние на игрока. */

export type AiRelationKind = "war" | "alliance" | "trade" | "federation" | "vassal" | "nap" | "neutral";
export type AiEmpireStatus = "active" | "weakened" | "collapsed" | "annexed" | "absorbed" | "accession" | "commonwealth";
export type AiNewsKind = "treaty" | "war" | "peace" | "federation" | "collapse" | "annexation" | "accession" | "centralization" | "commonwealth" | "vassalization" | "call_to_arms" | "trade_bloc" | "tribute";

export interface AiNewsItem {
  id: string;
  tick: number;
  kind: AiNewsKind | string;
  actorEmpireId: number;
  targetEmpireId?: number | null;
  actorName: string;
  targetName?: string | null;
  textRu?: string;
  textKey?: string;
  severity?: "info" | "warn" | "bad" | "good";
  playerImpact?: "ally" | "threat" | "bloc" | null;
}
export interface AiEmpireRow {
  id: number;
  name: string;
  status: AiEmpireStatus;
  power: number;
  atWarWith: number[];
  allies: number[];
  blocId?: string;
}
export interface AiRelationRow {
  a: number;
  b: number;
  kind: AiRelationKind;
  sinceTick?: number;
}
export interface AiBlocRow {
  id: string;
  nameRu?: string;
  nameKey?: string;
  kind: "federation" | "trade" | "commonwealth" | string;
  members: number[];
}
export interface AiPlayerImpact {
  allies: number[];
  blocIds: string[];
  threats: number[];
  wars: number[];
}
export interface AiWorldState {
  empires: AiEmpireRow[];
  relations: AiRelationRow[];
  blocs: AiBlocRow[];
  playerImpact: AiPlayerImpact;
  stats: { wars: number; alliances: number; federations: number; blocs: number; pendingEvents: number };
}
export interface AiWorldEventChoice {
  id: string;
  labelRu?: string;
  labelKey?: string;
  /** sim присылает строку, старый fallback — массив; UI нормализует. */
  effectsRu?: string[] | string;
}
export interface AiWorldEvent {
  id: string;
  kind: "call_to_arms" | "trade_bloc" | "annexation_demand" | "vassalization_demand" | "accession_offer" | "centralization_vote" | string;
  tick: number;
  fromEmpireId: number;
  targetEmpireId?: number | null;
  titleRu?: string;
  titleKey?: string;
  textRu?: string;
  textKey?: string;
  expiresTick?: number;
  choices: AiWorldEventChoice[];
}

export const AI_RELATION_RU: Record<string, [string, string]> = {
  war: ["война", "war"],
  alliance: ["союз", "alliance"],
  trade: ["торговля", "trade"],
  federation: ["федерация", "federation"],
  vassal: ["вассалитет", "vassal"],
  nap: ["пакт о ненападении", "non-aggression"],
  neutral: ["нейтрально", "neutral"],
};
export const AI_RELATION_ICON: Record<string, string> = {
  war: "⚔", alliance: "★", trade: "₡", federation: "◆", vassal: "▼", nap: "≈", neutral: "·",
};
export const AI_STATUS_RU: Record<string, [string, string]> = {
  active: ["активна", "active"],
  weakened: ["ослаблена", "weakened"],
  collapsed: ["распалась", "collapsed"],
  annexed: ["поглощена", "annexed"],
  absorbed: ["поглощена", "absorbed"],
  accession: ["в содружестве", "in commonwealth"],
  commonwealth: ["содружество", "commonwealth"],
};
export const AI_NEWS_KIND_RU: Record<string, [string, string]> = {
  treaty: ["договор", "treaty"],
  war: ["война", "war"],
  peace: ["мир", "peace"],
  federation: ["федерация", "federation"],
  collapse: ["распад", "collapse"],
  annexation: ["поглощение", "annexation"],
  accession: ["вхождение", "accession"],
  centralization: ["централизация", "centralization"],
  commonwealth: ["содружество", "commonwealth"],
  vassalization: ["вассализация", "vassalization"],
  call_to_arms: ["призыв союзника", "call to arms"],
  trade_bloc: ["торговый блок", "trade bloc"],
  tribute: ["дань", "tribute"],
};
export const AI_EVENT_KIND_RU: Record<string, [string, string]> = {
  call_to_arms: ["призыв к обороне", "call to arms"],
  trade_bloc: ["торговый блок", "trade bloc"],
  annexation_demand: ["требование поглощения", "annexation demand"],
  vassalization_demand: ["требование вассалитета", "vassalization demand"],
  accession_offer: ["предложение о вхождении", "accession offer"],
  centralization_vote: ["централизация объединения", "centralization vote"],
};

export interface PoliticalCapitalView {
  empireId: number;
  name: string;
  color?: string;
  systemId: number;
  systemName?: string;
  x: number;
  y: number;
  alive?: boolean;
  isPlayer?: boolean;
  status?: string;
  blocId?: string;
  vassalOf?: number;
}
export interface PoliticalMapView {
  systems: Array<{ id: number; name: string; x: number; y: number; sector?: string; ownerId?: number; capitalOf?: number | null; known?: boolean; visible?: boolean }>;
  capitals: PoliticalCapitalView[];
  relations: AiRelationRow[];
  blocs: AiBlocRow[];
  sector: { discovered: boolean; generated: boolean; visibleSystems: Array<{ id: number }> };
  playerImpact: AiPlayerImpact;
}
export function politicalMapOf(world: World | null | undefined): PoliticalMapView | null {
  if (!world) return null;
  try {
    const fn = (sim as unknown as { getPoliticalMap?: (w: World) => PoliticalMapView }).getPoliticalMap;
    if (typeof fn === "function") return fn(world);
  } catch { /* fallback ниже */ }
  const state = aiWorldStateOf(world);
  const capitals: PoliticalCapitalView[] = world.empires.filter((e) => e.id !== 0).map((e) => {
    const capId = (e as unknown as { capitalSystemId?: number }).capitalSystemId ?? 0;
    const sys = world.systems.find((s) => s.id === capId);
    return {
      empireId: e.id, name: e.name, color: (e as unknown as { color?: string }).color,
      systemId: capId, systemName: sys?.name, x: sys?.x ?? 0, y: sys?.y ?? 0,
      isPlayer: e.id === world.playerEmpireId, status: state?.empires.find((r) => r.id === e.id)?.status,
    };
  }).filter((c) => c.systemId > 0);
  return {
    systems: [],
    capitals,
    relations: state?.relations ?? [],
    blocs: state?.blocs ?? [],
    sector: { discovered: false, generated: false, visibleSystems: [] },
    playerImpact: state?.playerImpact ?? { allies: [], blocIds: [], threats: [], wars: [] },
  };
}

type SimPoliticsApi = {
  getAiNews?: (w: World, opts?: unknown) => AiNewsItem[] | undefined;
  getAiWorldState?: (w: World) => Partial<AiWorldState> | undefined;
  getAiWorldEvents?: (w: World) => AiWorldEvent[] | undefined;
};

function api(): SimPoliticsApi { return sim as unknown as SimPoliticsApi; }

export function aiRelationLabel(kind: string): string {
  const p = AI_RELATION_RU[kind] ?? [kind, kind];
  return L(p[0], p[1]);
}
export function aiStatusLabel(status: string): string {
  const p = AI_STATUS_RU[status] ?? [status, status];
  return L(p[0], p[1]);
}
export function aiNewsKindLabel(kind: string): string {
  const p = AI_NEWS_KIND_RU[kind] ?? [kind, kind];
  return L(p[0], p[1]);
}
export function aiEventKindLabel(kind: string): string {
  const p = AI_EVENT_KIND_RU[kind] ?? [kind, kind];
  return L(p[0], p[1]);
}

interface RawFg {
  empires?: Record<number, { vassals?: number[] }>;
  relations?: Record<string, { treaties?: Record<string, { active?: boolean }>; callToArms?: boolean }>;
  wars?: Array<{ attackerId: number; defenderId: number; winnerId?: number | null; startedTick?: number }>;
  federations?: Array<{ id: number; nameRu?: string; members?: number[]; name?: string }>;
  aiNews?: AiNewsItem[];
  aiWorldEvents?: AiWorldEvent[];
  aiBlocs?: AiBlocRow[];
}

function fgOf(world: World): RawFg {
  return ((world as unknown as { fg?: RawFg }).fg ?? {}) as RawFg;
}

function relationKey(a: number, b: number): string { return a < b ? a + ":" + b : b + ":" + a; }

/** Матрица/статусы: sim API (getAiWorldState) или fallback из fg.relations/wars/federations. */
export function aiWorldStateOf(world: World | null | undefined): AiWorldState | null {
  if (!world) return null;
  const fromSim = (() => { try { return api().getAiWorldState?.(world); } catch { return undefined; } })();
  if (fromSim && Array.isArray(fromSim.empires) && Array.isArray(fromSim.relations)) {
    const events = aiWorldEventsOf(world);
    const stats = (fromSim.stats ?? {}) as Record<string, number>;
    return {
      empires: fromSim.empires as AiEmpireRow[],
      relations: fromSim.relations as AiRelationRow[],
      blocs: (fromSim.blocs ?? []) as AiBlocRow[],
      playerImpact: (fromSim.playerImpact ?? { allies: [], blocIds: [], threats: [], wars: [] }) as AiPlayerImpact,
      stats: {
        wars: Number(stats.wars ?? 0), alliances: Number(stats.alliances ?? 0),
        federations: Number(stats.federations ?? 0), blocs: Number(stats.blocs ?? 0),
        pendingEvents: Number(stats.pendingEvents ?? events.length),
      },
    };
  }
  return buildFallbackWorld(world);
}

function buildFallbackWorld(world: World): AiWorldState {
  const fg = fgOf(world);
  const pid = world.playerEmpireId;
  const empires = world.empires.filter((e) => e.id !== 0);
  const wars = (fg.wars ?? []).filter((w) => w.winnerId == null);
  const feds = fg.federations ?? [];
  const fedOf = new Map<number, string>();
  for (const f of feds) for (const m of f.members ?? []) fedOf.set(m, "fed:" + f.id);
  const relOf = (a: number, b: number) => fg.relations?.[relationKey(a, b)];
  const kindOf = (a: number, b: number): AiRelationKind => {
    if (wars.some((w) => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a))) return "war";
    if (fedOf.get(a) && fedOf.get(a) === fedOf.get(b)) return "federation";
    const rel = relOf(a, b);
    const t = rel?.treaties ?? {};
    if ((fg.empires?.[b]?.vassals ?? []).includes(a) || (fg.empires?.[a]?.vassals ?? []).includes(b)) return "vassal";
    if (t.alliance?.active || t.defensive?.active) return "alliance";
    if (t.trade?.active || t.research?.active) return "trade";
    if (t.nap?.active) return "nap";
    return "neutral";
  };
  const rows: AiEmpireRow[] = empires.map((e) => {
    const atWar = wars.filter((w) => w.attackerId === e.id || w.defenderId === e.id)
      .map((w) => (w.attackerId === e.id ? w.defenderId : w.attackerId));
    const allies = empires.filter((o) => o.id !== e.id && ["alliance", "federation"].includes(kindOf(e.id, o.id))).map((o) => o.id);
    const systems = world.systems.filter((s) => s.ownerId === e.id).length;
    const status: AiEmpireStatus = systems === 0 ? "collapsed" : (atWar.length > 0 && systems < 3) ? "weakened" : "active";
    return { id: e.id, name: e.name, status, power: Math.round((e as unknown as { militaryPower?: number }).militaryPower ?? 0), atWarWith: atWar, allies, blocId: fedOf.get(e.id) };
  });
  const relations: AiRelationRow[] = [];
  for (let i = 0; i < empires.length; i++) {
    for (let j = i + 1; j < empires.length; j++) {
      const a = empires[i]!.id, b = empires[j]!.id;
      relations.push({ a, b, kind: kindOf(a, b) });
    }
  }
  const blocs: AiBlocRow[] = feds.map((f) => ({
    id: "fed:" + f.id, kind: "federation", nameRu: f.nameRu ?? ("Федерация #" + f.id), members: [...(f.members ?? [])],
  }));
  for (const b of fg.aiBlocs ?? []) blocs.push(b);
  const player = empires.find((e) => e.id === pid);
  const allies = player ? empires.filter((o) => kindOf(pid, o.id) === "alliance").map((o) => o.id) : [];
  const warsP = player ? wars.filter((w) => w.attackerId === pid || w.defenderId === pid).map((w) => (w.attackerId === pid ? w.defenderId : w.attackerId)) : [];
  const threats = [...new Set([...warsP, ...(player ? empires.filter((o) => kindOf(pid, o.id) === "war").map((o) => o.id) : [])])];
  const events = aiWorldEventsOf(world);
  return {
    empires: rows,
    relations,
    blocs,
    playerImpact: { allies, blocIds: blocs.filter((b) => b.members.includes(pid)).map((b) => b.id), threats, wars: warsP },
    stats: {
      wars: relations.filter((r) => r.kind === "war").length,
      alliances: relations.filter((r) => r.kind === "alliance").length,
      federations: blocs.filter((b) => b.kind === "federation").length,
      blocs: blocs.length,
      pendingEvents: events.length,
    },
  };
}

/** Лента мировых событий: sim getAiNews, fallback — fg.aiNews. */
export function aiNewsOf(world: World | null | undefined, limit = 60): AiNewsItem[] {
  if (!world) return [];
  let simList: AiNewsItem[] = [];
  try { simList = (api().getAiNews?.(world, { limit }) ?? []) as AiNewsItem[]; } catch { simList = []; }
  const fg = fgOf(world);
  const local = Array.isArray(fg.aiNews) ? fg.aiNews : [];
  const byId = new Map<string, AiNewsItem>();
  for (const raw of [...simList, ...local]) {
    const item = raw as unknown as Record<string, unknown>;
    if (!item || !item.id) continue;
    const id = String(item.id);
    if (byId.has(id)) continue;
    const a = Number(item.a ?? item.actorEmpireId ?? 0);
    const b = item.b != null ? Number(item.b) : (item.targetEmpireId != null ? Number(item.targetEmpireId) : null);
    byId.set(id, {
      id,
      tick: Number(item.tick ?? 0),
      kind: String(item.kind ?? "treaty"),
      actorEmpireId: a,
      targetEmpireId: b,
      actorName: String(item.actorName ?? aiEmpireName(world, a)),
      targetName: b != null ? String(item.targetName ?? aiEmpireName(world, b)) : null,
      textRu: item.textRu != null ? String(item.textRu) : (item.titleRu != null ? String(item.titleRu) : undefined),
      textKey: item.textKey != null ? String(item.textKey) : undefined,
      severity: (item.severity as AiNewsItem["severity"]) ?? "info",
      playerImpact: (item.playerImpact as AiNewsItem["playerImpact"]) ?? null,
    });
  }
  return [...byId.values()].sort((a, b) => b.tick - a.tick || String(b.id).localeCompare(String(a.id))).slice(0, limit);
}

/** События для игрока: sim getAiWorldEvents, fallback — fg.aiWorldEvents + callToArms-флаги. */
export function aiWorldEventsOf(world: World | null | undefined): AiWorldEvent[] {
  if (!world) return [];
  const pid = world.playerEmpireId;
  let simEvents: AiWorldEvent[] = [];
  try { simEvents = (api().getAiWorldEvents?.(world) ?? []) as AiWorldEvent[]; } catch { simEvents = []; }
  const fg = fgOf(world);
  const direct = Array.isArray(fg.aiWorldEvents) ? fg.aiWorldEvents : [];
  const byId = new Map<string, AiWorldEvent>();
  for (const raw of [...simEvents, ...direct]) {
    const item = raw as unknown as Record<string, unknown>;
    if (!item || !item.id || item.resolved === true) continue;
    const id = String(item.id);
    if (!byId.has(id)) byId.set(id, raw);
  }
  const events: AiWorldEvent[] = [...byId.values()];
  if (direct.length === 0 && fg.relations) {
    for (const [key, rel] of Object.entries(fg.relations)) {
      if (!rel.callToArms) continue;
      const pair = key.split(":").map(Number);
      if (!pair.includes(pid)) continue;
      const other = pair[0] === pid ? pair[1] : pair[0];
      if (!other) continue;
      events.push({
        id: "calltoarms:" + key, kind: "call_to_arms", tick: 0, fromEmpireId: other, targetEmpireId: null,
        titleRu: "Призыв к обороне", textRu: "Союзник призывает вас вступить в войну.",
        choices: [{ id: "join", labelRu: "Вступить в войну" }, { id: "decline", labelRu: "Отказаться" }],
      });
    }
  }
  return events;
}

export function aiEmpireName(world: World | null | undefined, id: number): string {
  return world?.empires.find((e) => e.id === id)?.name ?? ("#" + id);
}

/** Отправка выбора события: команда sim ai_world_event_choice (если API готово). */
export function chooseAiWorldEvent(send: (cmd: unknown) => boolean, eventId: string, choiceId: string): boolean {
  try { return send({ type: "ai_world_event_choice", eventId, choiceId }); } catch { return false; }
}