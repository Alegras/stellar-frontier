/**
 * task-62 · адаптер packages/battle-grid → UI-модель.
 * Реальный движок — основа; при любой ошибке/недоступности данных — мок-провайдер.
 */
import * as BG from "@sf/battle-grid";
import { BATTLE_CLASSES } from "@sf/data";
import * as mock from "./model";
import type { Battle, Cls, Formation, Result, Stack, Terrain } from "./model";

const RAWS = new Map<string, BG.BattleState>();
const TERRAIN_IN: Record<string, Terrain> = {
  empty: "void", dust: "void", asteroid: "asteroid", nebula: "nebula", mines: "minefield", gravity: "gravity_anomaly", wreck: "debris",
};
const CLASS_BY_ID = new Map<string, (typeof BATTLE_CLASSES)[number]>(BATTLE_CLASSES.map((c) => [c.id, c] as const));
const NAME_RU: Record<string, string> = Object.fromEntries(BATTLE_CLASSES.map((c) => [c.id, c.titleRu]));
const PRESET: Record<Formation, string> = { line: "line", wedge: "wedge", echelon: "screen", guard: "turtle" };

function sideOf(side: BG.Side): "player" | "enemy" { return side === "A" ? "player" : "enemy"; }
function offsetOf(a: BG.Axial): { q: number; r: number } { const o = BG.axialToOffset(a); return { q: o.col, r: o.row }; }

function createRaw(seed: number): BG.BattleState {
  const classes = BATTLE_CLASSES.slice(0, 7);
  const side = (off: number): BG.SideInput => ({ stacks: classes.map((c, i) => ({ classId: c.id, count: Math.max(2, Math.min(c.maxStack, 12 - i)), hpPct: 1 })), morale: 0, luck: 0, empireId: off, admiralLevel: 4, admiralAbilities: ["focus_fire", "shield_barrier", "interceptor"] });
  const raw = BG.createBattle({ seed, battleId: "btl_" + seed, attacker: side(1), defender: side(2), terrainProfile: "open", roundCap: 30 });
  BG.autoDeploy(raw, "A", "line"); BG.autoDeploy(raw, "B", "wedge");
  return raw;
}

function logLines(raw: BG.BattleState): Battle["log"] {
  return raw.log.slice(-30).map((e, i) => {
    const who = raw.stacks.find((s) => s.id === e.stackId);
    const target = e.targetId ? raw.stacks.find((s) => s.id === e.targetId) : null;
    const whoName = who ? who.code + " «" + (NAME_RU[who.classId] ?? who.classId) + "»" : "?";
    const targetName = target ? target.code + " «" + (NAME_RU[target.classId] ?? target.classId) + "»" : "";
    let text = whoName + " · " + e.action;
    if (targetName) text += " → " + targetName;
    if (e.damage) text += ": " + e.damage + " урона";
    if (e.note) text += " (" + e.note + ")";
    const kind: Battle["log"][number]["kind"] = e.damage ? "damage" : e.action === "death" ? "death" : e.abilityId ? "ability" : e.path ? "move" : "system";
    return { round: e.round, text, kind };
  }).map((l, i) => ({ ...l, text: "[" + (raw.log[raw.log.length - Math.min(raw.log.length, 30) + i]?.round ?? 0) + "] " + l.text }));
}

function battleFromRaw(base: Battle, raw: BG.BattleState): Battle {
  const view = BG.getBattleView(raw);
  const stacks: Stack[] = view.stacks.map((v) => {
    const cls = CLASS_BY_ID.get(v.classId);
    return {
      id: v.id, side: sideOf(v.side), cls: v.classId as Cls,
      name: "Эск." + v.code,
      count: v.count, startCount: v.maxCount, hp: v.hp, maxHp: v.maxHp,
      shield: 0, maxShield: 0, mp: v.mp, maxMp: v.mp, init: v.initiative,
      dmg: Math.round((cls?.damageStack ?? 100) ?? 100), range: v.range,
      q: v.col, r: v.row, facing: v.side === "A" ? 0 : 3, reserve: v.reserve,
      alive: !v.dead, moved: false, waited: v.waited, defended: v.defending, counterUsed: false, kills: 0, abilities: [...v.abilities],
    };
  });
  const obstacles = view.obstacles.map((o) => { const off = BG.axialToOffset(o); return { q: off.col, r: off.row, kind: TERRAIN_IN[o.type] ?? "void" as Terrain }; });
  const result = view.phase === "end" ? mapResult(base, raw) : null;
  return {
    ...base, phase: view.phase === "deployment" ? "deploy" : view.phase === "rounds" ? "battle" : "result",
    round: view.round, activeId: view.activeStackId, order: [...view.initiativeOrder], stacks, obstacles,
    log: raw.log.length > 0 ? logLines(raw) : base.log, result,
    deploymentCount: stacks.filter((s) => s.side === "player" && !s.reserve && s.alive).length,
    reserveCount: stacks.filter((s) => s.side === "player" && s.reserve && s.alive).length,
  };
}
function mapResult(base: Battle, raw: BG.BattleState): Result {
  const r = BG.battleResult(raw);
  const winner = r.winner === "A" ? "player" : r.winner === "B" ? "enemy" : "draw";
  const losses = r.log.length >= 0 ? raw.stacks.map((s) => ({ side: sideOf(s.side), cls: s.classId as Cls, name: "Эск." + s.code, lost: Math.max(0, Math.round((s.maxHp - s.hp) / Math.max(1, s.maxHp / Math.max(1, s.count)))), fp: Math.max(0, s.maxHp - s.hp) })) : [];
  const actual = Math.round(r.losses.A.lossFraction * 100);
  return {
    winner, losses,
    spoils: { credits: Math.round(r.spoils.alloys * 4), alloys: r.spoils.alloys, samples: 0 },
    xp: r.xp.admiral, warScore: r.warScoreDelta,
    mvpName: r.mvpStackId ? (raw.stacks.find((s) => s.id === r.mvpStackId)?.classId ?? "—") : "—",
    mvpDamage: raw.stacks.find((s) => s.id === r.mvpStackId)?.damageDealt ?? 0,
    parity: { autoMin: Math.max(0, actual - 4), autoMax: Math.min(100, actual + 4), actual },
    seed: r.seed,
  };
}
function withRaw(b: Battle, fn: (raw: BG.BattleState) => void): Battle {
  const raw = RAWS.get(b.id); if (!raw) return mock.clone(b);
  fn(raw);
  // Синхронизируем UI-модель на месте: иначе клон в оверлее остаётся со старыми позициями/HP.
  Object.assign(b, battleFromRaw(b, raw));
  return b;
}

export function createMockBattle(opts: { seed?: number; systemName?: string; coop?: boolean } = {}): Battle {
  const seed = opts.seed ?? 42;
  const base = mock.createMockBattle(opts);
  try {
    const raw = createRaw(seed);
    RAWS.set(base.id, raw);
    return battleFromRaw(base, raw);
  } catch { return base; }
}
export const clone = (b: Battle): Battle => mock.clone(b);
export function deploy(b: Battle, id: string, q: number, r: number): { ok: boolean; reason?: string } {
  const raw = RAWS.get(b.id); if (!raw) { const res = mock.deploy(b, id, q, r); return res; }
  const ax = BG.offsetToAxial(q, r);
  const res = BG.applyCommand(raw, { type: "place", stackId: id, at: ax, side: "A" });
  if (res.ok) Object.assign(b, battleFromRaw(b, raw));
  return { ok: res.ok, reason: res.reason };
}
export function resetDeploy(b: Battle): Battle {
  const raw = RAWS.get(b.id);
  if (raw) {
    const fresh = createRaw(b.seed);
    for (const st of BG.getBattleView(fresh).stacks.filter((s) => s.side === "A" && !s.reserve)) BG.moveToReserve(fresh, "A", st.id);
    RAWS.set(b.id, fresh);
    return battleFromRaw(b, fresh);
  }
  return mock.resetDeploy(mock.clone(b));
}
export function formation(b: Battle, preset: Formation, side: "player" | "enemy"): Battle {
  if (side === "player") return withRaw(b, (raw) => { BG.autoDeploy(raw, "A", PRESET[preset] ?? "line"); });
  return mock.formation(mock.clone(b), preset, side);
}
export function start(b: Battle): Battle { return withRaw(b, (raw) => { BG.startBattle(raw); }); }
export function activeStack(b: Battle): Stack | null { return b.stacks.find((s) => s.id === b.activeId) ?? null; }
export function reachable(b: Battle, id: string): Array<{ q: number; r: number }> {
  const raw = RAWS.get(b.id); if (!raw) return mock.reachable(b, id);
  return BG.legalMoves(raw, id).map(offsetOf);
}
export function canAttack(b: Battle, a: Stack, t: Stack, ranged: boolean): { ok: boolean; reason?: string } {
  const raw = RAWS.get(b.id); if (!raw) return mock.canAttack(b, a, t, ranged);
  const p = BG.previewAttack(raw, a.id, t.id, ranged ? "ranged" : "melee");
  return p.reason ? { ok: false, reason: p.reason } : { ok: true };
}
export function preview(b: Battle, aid: string, tid: string, ranged: boolean): { min: number; max: number; counter: number; loseMin: number; loseMax: number } {
  const raw = RAWS.get(b.id); if (!raw) return mock.preview(b, aid, tid, ranged);
  const p = BG.previewAttack(raw, aid, tid, ranged ? "ranged" : "melee");
  return { min: p.damageMin, max: p.damageMax, counter: p.counter ? p.damageMin : 0, loseMin: p.lossMin, loseMax: p.lossMax };
}
export function attack(b: Battle, aid: string, tid: string, ranged: boolean): boolean {
  const raw = RAWS.get(b.id); if (!raw) return mock.attack(mock.clone(b), aid, tid, ranged);
  const res = BG.applyCommand(raw, { type: ranged ? "ranged" : "attack", stackId: aid, targetId: tid });
  if (res.ok) Object.assign(b, battleFromRaw(b, raw));
  return res.ok;
}
export function moveActive(b: Battle, q: number, r: number): boolean {
  const raw = RAWS.get(b.id); if (!raw) return mock.moveActive(mock.clone(b), q, r);
  const active = raw.stacks.find((s) => s.id === raw.current); if (!active) return false;
  const path = BG.pathTo(raw, raw.current!, BG.offsetToAxial(q, r));
  if (path.length === 0) return false;
  const res = BG.applyCommand(raw, { type: "move", stackId: raw.current!, path });
  if (res.ok) Object.assign(b, battleFromRaw(b, raw));
  return res.ok;
}
export function wait(b: Battle): void { withRaw(b, (raw) => { if (raw.current) BG.applyCommand(raw, { type: "wait", stackId: raw.current }); }); }
export function defend(b: Battle): void { withRaw(b, (raw) => { if (raw.current) BG.applyCommand(raw, { type: "defend", stackId: raw.current }); }); }
export function ability(b: Battle, abilityId?: string): void {
  withRaw(b, (raw) => {
    const s = raw.stacks.find((x) => x.id === raw.current); if (!s) return;
    const id = abilityId ?? s.abilities.find((x) => { const d = BG.BATTLE_CONTENT?.abilities?.find?.((ab: { id: string }) => ab.id === x); return d?.kind === "active"; }) ?? s.abilities[0];
    if (!id) return;
    const active = BG.BATTLE_CONTENT?.abilities?.find?.((ab: { id: string; kind: string }) => ab.id === id);
    const target = active?.target === "enemy" || active?.target === "line"
      ? raw.stacks.find((x) => x.side !== s.side && !x.dead && BG.hexDistance(x.pos, s.pos) <= Math.max(1, s.range))
      : undefined;
    BG.applyCommand(raw, { type: "ability", stackId: s.id, abilityId: id, targetId: target?.id });
  });
}
export function aiTurn(b: Battle): Battle { return withRaw(b, (raw) => { BG.applyCommand(raw, { type: "auto" }); }); }
export function autoBattle(b: Battle): Battle {
  return withRaw(b, (raw) => {
    if (raw.phase === "deployment") BG.startBattle(raw);
    try { BG.runAiBattle(raw, {}, {}); } catch { /* fallback ниже */ }
    let guard = 0;
    while (raw.phase !== "end" && guard++ < 400) {
      const before = raw.log.length + ":" + raw.round;
      BG.applyCommand(raw, { type: "auto" });
      if (raw.log.length + ":" + raw.round === before) break;
    }
  });
}
export function checkEnd(b: Battle): boolean { return b.phase === "result"; }
export function endTurn(b: Battle): void { withRaw(b, (raw) => { if (raw.current) BG.applyCommand(raw, { type: "endTurn", stackId: raw.current }); }); }
export function battleResult(b: Battle): Result | null { return b.result; }