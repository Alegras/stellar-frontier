import type {
  Axial, BattleCommand, BattleCreateInput, BattleEvent, BattleField, BattleResult,
  BattleStack, BattleState, BattleView, Side, SideInput, StackInput, StackView, TerrainId,
} from "./types";
import { COLS, ROWS, allHexes, axialToOffset, cmpHex, hexDistance, hexKey, inBounds, inZone, neighbors, offsetToAxial, parseKey } from "./hex";
import { coverAt, generateField, hash01, hash32, hasLos, isPassable, moveCostAt, rangePenaltyAt, TERRAIN, validateField } from "./field";
import { abilityById, classById, battleClasses } from "./catalog";

const VOLLEY = 3.0;
const ROUND_CAP_DEFAULT = 25;
const ZONE_COLS: Record<Side, [number, number]> = { A: [0, 2], B: [12, 14] };

export function fieldOfState(state: BattleState): BattleField { return state.field; }
export function findStack(state: BattleState, id: string): BattleStack | undefined {
  return state.stacks.find((s) => s.id === id);
}
export function stacksOfSide(state: BattleState, side: Side): BattleStack[] {
  return state.stacks.filter((s) => s.side === side);
}
export function aliveOfSide(state: BattleState, side: Side): BattleStack[] {
  return state.stacks.filter((s) => s.side === side && !s.dead);
}
export function stackAt(state: BattleState, a: Axial): BattleStack | undefined {
  return state.stacks.find((s) => !s.dead && !s.reserve && s.pos.q === a.q && s.pos.r === a.r);
}
export function sideFp(state: BattleState, side: Side): number {
  return aliveOfSide(state, side).reduce((sum, s) => sum + s.count * s.fp, 0);
}
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function sideOpposite(side: Side): Side { return side === "A" ? "B" : "A"; }

function makeStack(side: Side, input: StackInput, index: number, state: BattleState, active: boolean): BattleStack {
  const cls = classById(input.classId);
  if (!cls) throw new Error("Неизвестный класс: " + input.classId);
  const count = clamp(Math.floor(input.count), 1, cls.maxStack);
  const ac = state.input[side === "A" ? "attacker" : "defender"];
  const passive = new Set(ac.admiralAbilities ?? []);
  const maxHp = Math.round(cls.hp * count * (passive.has("shieldsmith") ? 1.1 : 1));
  const hp = Math.max(1, Math.round(maxHp * clamp(input.hpPct ?? 1, 0.01, 1)));
  const morale = clamp((ac.morale ?? 0) + (passive.has("fortitude") ? 1 : 0), -3, 3);
  const initiative = cls.initiative + (input.flagship ? 1 : 0);
  return {
    id: input.stackId ?? side + String(index + 1),
    side, classId: cls.id, code: cls.code, count, hp, maxHp, hpPerShip: cls.hp, dps: cls.dps,
    mp: cls.mp + (passive.has("logist") ? 1 : 0), initiative,
    atk: Math.round(cls.atk * (passive.has("veteran") ? 1.05 : 1) * 100) / 100,
    def: cls.def, range: cls.range + (passive.has("sniper") ? 1 : 0), fp: cls.fp, costAlloys: cls.costAlloys,
    damageMix: { ...cls.damageMix }, pos: { q: 0, r: 0 }, reserve: !active, dead: false, waited: false, acted: false,
    defending: false, barrier: false, retaliatedRound: -1, morale, luck: clamp(ac.luck ?? 0, -3, 3),
    abilities: [...new Set([...(cls.abilities ?? []), ...(ac.admiralAbilities ?? [])])], cooldowns: {},
    buffs: { focus: 0, incoming: 0, damage: 0, def: 0, initiative: 0, roundsLeft: 0 },
    flagship: input.flagship ?? false, discovered: true, damageDealt: 0,
    mpLeft: cls.mp + (passive.has("logist") ? 1 : 0), movedThisTurn: false,
  };
}

export function createBattle(input: BattleCreateInput): BattleState {
  const field = input.field ?? generateField(input.seed, input.terrainProfile ?? "open");
  const state: BattleState = {
    battleId: input.battleId ?? "btl_" + String(input.seed), seed: input.seed, round: 0,
    roundCap: input.roundCap ?? ROUND_CAP_DEFAULT, phase: "deployment", field, stacks: [],
    reserve: { A: [], B: [] }, deployment: { A: false, B: false }, retreated: { A: false, B: false }, initiative: [], current: null, waited: [],
    ok: { A: 6, B: 6 },
    okPerRound: {
      A: 1 + ((input.attacker.admiralAbilities ?? []).includes("tactician") ? 1 : 0),
      B: 1 + ((input.defender.admiralAbilities ?? []).includes("tactician") ? 1 : 0),
    },
    log: [], commands: [], rngCounter: 0, autoRetreat: input.autoRetreat ?? false, result: null, input: { attacker: input.attacker, defender: input.defender },
  };
  for (const side of ["A", "B"] as const) {
    const sideInput = side === "A" ? input.attacker : input.defender;
    sideInput.stacks.slice(0, 10).forEach((stack, index) => {
      const made = makeStack(side, stack, index, state, index < 7);
      state.stacks.push(made);
      if (made.reserve) state.reserve[side].push(made);
    });
  }
  const errors = validateField(field);
  if (errors.length) throw new Error("Некорректное поле: " + errors.join("; "));
  return state;
}

function zoneCells(side: Side): Axial[] {
  const [lo, hi] = ZONE_COLS[side];
  const out: Axial[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = lo; col <= hi; col++) out.push(offsetToAxial(col, row));
  return out;
}
function presetOrder(state: BattleState, side: Side, preset: string): Axial[] {
  const cells = zoneCells(side).sort((a, b) => {
    const oa = axialToOffset(a), ob = axialToOffset(b);
    if (side === "A") return oa.col === ob.col ? oa.row - ob.row : ob.col - oa.col;
    return oa.col === ob.col ? oa.row - ob.row : oa.col - ob.col;
  });
  if (preset === "turtle") return cells.filter((c) => axialToOffset(c).col === (side === "A" ? 1 : 13)).sort((a, b) => axialToOffset(a).row - axialToOffset(b).row);
  if (preset === "wedge") return cells.filter((c) => axialToOffset(c).col === (side === "A" ? 2 : 12)).sort((a, b) => Math.abs(axialToOffset(a).row - 5) - Math.abs(axialToOffset(b).row - 5));
  if (preset === "screen") return cells.filter((c) => axialToOffset(c).col === (side === "A" ? 0 : 14)).sort((a, b) => axialToOffset(a).row - axialToOffset(b).row);
  return cells.slice().sort((a, b) => {
    const oa = axialToOffset(a), ob = axialToOffset(b);
    const da = Math.abs(oa.row - 5) + Math.abs(oa.col - (side === "A" ? 1 : 13));
    const db = Math.abs(ob.row - 5) + Math.abs(ob.col - (side === "A" ? 1 : 13));
    return da - db || cmpHex(a, b);
  });
}
export function deployStack(state: BattleState, side: Side, stackId: string, hex: Axial, facing = 0): BattleState {
  if (state.phase !== "deployment") throw new Error("Расстановка уже завершена");
  const stack = findStack(state, stackId);
  if (!stack || stack.side !== side) throw new Error("Стек не найден");
  if (!inBounds(hex) || !inZone(hex, side)) throw new Error("Вне зоны развёртывания");
  if (!isPassable(state.field, hex)) throw new Error("Гекс непроходим");
  if (stackAt(state, hex)) throw new Error("Гекс занят");
  stack.pos = { ...hex }; stack.reserve = false;
  state.reserve[side] = state.reserve[side].filter((s) => s.id !== stackId);
  void facing;
  return state;
}
export function moveToReserve(state: BattleState, side: Side, stackId: string): BattleState {
  if (state.phase !== "deployment") throw new Error("Расстановка уже завершена");
  const stack = findStack(state, stackId);
  if (!stack || stack.side !== side) throw new Error("Стек не найден");
  stack.reserve = true; stack.pos = { q: -1, r: -1 };
  if (!state.reserve[side].some((s) => s.id === stackId)) state.reserve[side].push(stack);
  return state;
}
export function autoDeploy(state: BattleState, side: Side, preset = "line"): BattleState {
  const active = stacksOfSide(state, side).filter((s) => !s.reserve);
  const cells = presetOrder(state, side, preset);
  const used = new Set(state.stacks.filter((s) => !s.reserve && !s.dead).map((s) => hexKey(s.pos)));
  let ci = 0;
  for (const stack of active) {
    while (ci < cells.length && used.has(hexKey(cells[ci]!))) ci++;
    const cell = cells[ci++];
    if (!cell) break;
    used.add(hexKey(cell));
    stack.pos = { ...cell };
  }
  state.deployment[side] = true;
  if (state.deployment.A && state.deployment.B) startBattle(state);
  return state;
}
export function startBattle(state: BattleState): BattleState {
  if (state.phase !== "deployment") return state;
  for (const side of ["A", "B"] as const) {
    for (const stack of stacksOfSide(state, side)) {
      if (!stack.reserve && !inBounds(stack.pos)) throw new Error("Не все стеки расставлены: " + side);
    }
  }
  state.phase = "rounds"; state.round = 1;
  state.ok.A += state.okPerRound.A; state.ok.B += state.okPerRound.B;
  buildInitiative(state); selectCurrent(state);
  return state;
}
export function buildInitiative(state: BattleState): string[] {
  state.initiative = state.stacks
    .filter((s) => !s.dead && !s.reserve)
    .map((s) => ({ id: s.id, init: s.initiative + s.buffs.initiative, tie: hash32(state.seed, s.id) }))
    .sort((a, b) => b.init - a.init || a.tie - b.tie || a.id.localeCompare(b.id))
    .map((x) => x.id);
  return state.initiative;
}
function aliveCounterpart(state: BattleState, side: Side): boolean {
  return state.stacks.some((s) => s.side === side && !s.dead);
}
function selectCurrent(state: BattleState): void {
  if (state.phase !== "rounds") return;
  const alive = state.initiative.map((id) => findStack(state, id)).filter((s): s is BattleStack => !!s && !s.dead);
  let next = alive.find((s) => !s.acted);
  if (!next) next = alive.find((s) => s.acted && s.waited);
  if (!next) { endRound(state); return; }
  if (next.acted && next.waited) next.waited = false;
  state.current = next.id;
  next.defending = false; next.barrier = false; next.mpLeft = next.mp; next.movedThisTurn = false;
  if (next.morale < 0 && hash01(state.seed, state.round, next.id, "morale", state.rngCounter++) < 0.10 * Math.abs(next.morale)) {
    state.log.push({ round: state.round, stackId: next.id, action: "morale_skip" });
    next.acted = true; selectCurrent(state);
  }
}
function endRound(state: BattleState): void {
  if (state.phase !== "rounds") return;
  if (state.round >= state.roundCap || !aliveCounterpart(state, "A") || !aliveCounterpart(state, "B")) { finishBattle(state); return; }
  state.round += 1;
  state.ok.A = Math.min(10, state.ok.A + state.okPerRound.A);
  state.ok.B = Math.min(10, state.ok.B + state.okPerRound.B);
  for (const s of state.stacks) {
    if (s.dead) continue;
    s.acted = false; s.waited = false; s.movedThisTurn = false; s.mpLeft = s.mp;
    if (s.buffs.roundsLeft > 0) s.buffs.roundsLeft -= 1;
    if (s.buffs.roundsLeft <= 0) s.buffs = { focus: 0, incoming: 0, damage: 0, def: 0, initiative: 0, roundsLeft: 0 };
  }
  buildInitiative(state); selectCurrent(state);
}
function advanceTurn(state: BattleState, actedId: string): void {
  const stack = findStack(state, actedId);
  if (stack) stack.acted = true;
  state.current = null;
  if (!aliveCounterpart(state, "A") || !aliveCounterpart(state, "B")) { finishBattle(state); return; }
  selectCurrent(state);
}
function finishBattle(state: BattleState): void {
  state.phase = "end"; state.current = null; state.result = buildResult(state);
}
function endIfSideDead(state: BattleState): boolean {
  if (!aliveCounterpart(state, "A") || !aliveCounterpart(state, "B")) { finishBattle(state); return true; }
  return false;
}

export function legalMoves(state: BattleState, stackId: string): Axial[] {
  const stack = findStack(state, stackId);
  if (!stack || stack.dead || stack.reserve) return [];
  const dist = new Map<string, number>([[hexKey(stack.pos), 0]]);
  const open: Array<{ hex: Axial; d: number }> = [{ hex: stack.pos, d: 0 }];
  while (open.length) {
    open.sort((a, b) => a.d - b.d || cmpHex(a.hex, b.hex));
    const cur = open.shift()!;
    if (cur.d > (dist.get(hexKey(cur.hex)) ?? Infinity)) continue;
    for (const next of neighbors(cur.hex)) {
      if (!inBounds(next) || !isPassable(state.field, next)) continue;
      const occupant = stackAt(state, next);
      if (occupant && occupant.side !== stack.side) continue;
      const cost = moveCostAt(state.field, next);
      const nd = cur.d + cost;
      if (nd > stack.mpLeft) continue;
      if (nd < (dist.get(hexKey(next)) ?? Infinity)) { dist.set(hexKey(next), nd); open.push({ hex: next, d: nd }); }
    }
  }
  const out: Axial[] = [];
  for (const [key, d] of dist) {
    if (d === 0) continue;
    const hex = parseKey(key);
    if (stackAt(state, hex)) continue;
    out.push(hex);
  }
  return out.sort(cmpHex);
}
export function pathTo(state: BattleState, stackId: string, goal: Axial): Axial[] {
  const stack = findStack(state, stackId);
  if (!stack) return [];
  const start = hexKey(stack.pos); const goalKey = hexKey(goal);
  const g = new Map<string, number>([[start, 0]]);
  const parent = new Map<string, string>();
  const open: Array<{ hex: Axial; f: number }> = [{ hex: stack.pos, f: hexDistance(stack.pos, goal) }];
  const gOf = (h: Axial) => g.get(hexKey(h)) ?? Infinity;
  while (open.length) {
    open.sort((a, b) => a.f - b.f || cmpHex(a.hex, b.hex));
    const cur = open.shift()!;
    if (hexKey(cur.hex) === goalKey) {
      const path: Axial[] = []; let key = goalKey;
      while (key !== start) { path.push(parseKey(key)); key = parent.get(key) ?? start; }
      path.reverse(); return path;
    }
    for (const next of neighbors(cur.hex)) {
      if (!inBounds(next) || !isPassable(state.field, next)) continue;
      const occupant = stackAt(state, next);
      if (occupant && occupant.side !== stack.side) continue;
      const ng = gOf(cur.hex) + moveCostAt(state.field, next);
      if (ng > stack.mpLeft) continue;
      if (ng < gOf(next)) { g.set(hexKey(next), ng); parent.set(hexKey(next), hexKey(cur.hex)); open.push({ hex: next, f: ng + hexDistance(next, goal) }); }
    }
  }
  return [];
}
export function moveStack(state: BattleState, stackId: string, path: Axial[]): { ok: boolean; reason?: string; events: BattleEvent[] } {
  const stack = findStack(state, stackId);
  if (!stack) return { ok: false, reason: "NOT_FOUND", events: [] };
  if (stack.reserve) return { ok: false, reason: "IN_RESERVE", events: [] };
  if (path.length === 0) return { ok: false, reason: "EMPTY_PATH", events: [] };
  const events: BattleEvent[] = []; let prev = stack.pos; let cost = 0;
  for (const step of path) {
    if (hexDistance(prev, step) !== 1) return { ok: false, reason: "PATH_NOT_ADJACENT", events: [] };
    if (!inBounds(step) || !isPassable(state.field, step)) return { ok: false, reason: "PATH_BLOCKED", events: [] };
    if (stackAt(state, step)) return { ok: false, reason: "GOAL_OCCUPIED", events: [] };
    cost += moveCostAt(state.field, step);
    if ((state.field.terrain[hexKey(step)] ?? "empty") === "mines") {
      const dmg = Math.max(1, Math.round(stack.hp * 0.08));
      applyDamageToStack(stack, dmg); events.push({ type: "mine", stackId: stack.id, damage: dmg });
    }
    prev = step;
  }
  if (cost > stack.mpLeft) return { ok: false, reason: "PATH_TOO_LONG", events: [] };
  stack.pos = { ...path[path.length - 1]! }; stack.mpLeft -= cost; stack.movedThisTurn = true;
  return { ok: true, events };
}

export function attackDamage(state: BattleState, attacker: BattleStack, defender: BattleStack, ranged: boolean, moved: boolean, abilityMult = 0): { damage: number; crit: boolean; miss: boolean; reason?: string } {
  if (defender.dead) return { damage: 0, crit: false, miss: false, reason: "DEAD" };
  const dist = hexDistance(attacker.pos, defender.pos);
  if (ranged && dist === 1) return { damage: 0, crit: false, miss: false, reason: "RANGED_AT_MELEE" };
  if (ranged && !hasLos(state.field, attacker.pos, defender.pos)) return { damage: 0, crit: false, miss: false, reason: "NO_LOS" };
  const effRange = Math.max(1, attacker.range - rangePenaltyAt(state.field, attacker.pos));
  if (ranged && dist > effRange) return { damage: 0, crit: false, miss: false, reason: "OUT_OF_RANGE" };
  let atk = attacker.atk;
  const def = defender.def * (defender.defending ? (defender.barrier ? 1.3 : 1.2) : 1);
  const aura = state.stacks.find((s) => s.side === attacker.side && !s.dead && s.abilities.includes("command_aura") && hexDistance(s.pos, attacker.pos) <= 2);
  if (aura) atk *= 1.1;
  if (attacker.buffs.damage) atk *= 1 + attacker.buffs.damage;
  const atkDefMult = clamp(1 + 0.05 * (atk - def), 0.4, 2.5);
  let base = attacker.count * attacker.fp * VOLLEY * 1.0;
  if (!ranged) base *= 0.9;
  if (ranged) { if (dist === 1) base *= 0.5; else if (moved) base *= 0.75; }
  if (attacker.abilities.includes("salvo") && !moved) base *= 1.25;
  if (attacker.abilities.includes("siege") && defender.defending) base *= 3;
  if (attacker.abilities.includes("torpedo_salvo") && !attacker.cooldowns["torpedo_used"]) { base *= 2; attacker.cooldowns["torpedo_used"] = 1; }
  if (defender.abilities.includes("heavy_armor")) base *= 1 - 0.2 * defender.damageMix.kinetic;
  const screen = state.stacks.find((s) => s.side === defender.side && !s.dead && s.abilities.includes("screen") && hexDistance(s.pos, defender.pos) <= 1 && s.id !== defender.id);
  if (screen && ranged) base *= 0.7;
  const swarm = state.stacks.find((s) => s.side === defender.side && !s.dead && s.abilities.includes("swarm") && hexDistance(s.pos, defender.pos) === 1 && s.id !== defender.id);
  if (swarm) base *= 0.85;
  const moraleMod = attacker.morale >= 1 ? 1.15 : attacker.morale <= -1 ? 0.85 : 1;
  const cover = clamp(coverAt(state.field, defender.pos), 0, 0.3);
  let mult = atkDefMult * (1 + attacker.buffs.focus) * (1 + abilityMult) * (1 - cover);
  if (attacker.buffs.incoming) mult *= 1 + attacker.buffs.incoming;
  let crit = false, miss = false;
  const roll = hash01(state.seed, state.round, attacker.id, defender.id, state.rngCounter++, "luck");
  if (attacker.luck > 0 && roll < 0.06 * attacker.luck) crit = true;
  if (attacker.luck < 0 && roll < 0.05 * Math.abs(attacker.luck)) miss = true;
  if (crit) mult *= 1.5; if (miss) mult *= 0.8;
  return { damage: Math.max(1, Math.round(base * mult * moraleMod)), crit, miss };
}
function initialHp(state: BattleState, side: Side): number {
  return stacksOfSide(state, side).reduce((sum, s) => sum + s.maxHp, 0);
}
function initialFp(state: BattleState, side: Side): number {
  const input = side === "A" ? state.input.attacker : state.input.defender;
  return input.stacks.reduce((sum, raw) => { const cls = classById(raw.classId); return sum + (cls ? cls.fp * Math.min(raw.count, cls.maxStack) : 0); }, 0);
}
/** В AI-vs-AI (parity) стороны автоматически отступают при пороге потерь; игрок решает сам. */
export function maybeAutoRetreat(state: BattleState): boolean {
  if (!state.autoRetreat || state.phase !== "rounds") return false;
  for (const side of ["A", "B"] as const) {
    if (state.retreated[side] || !aliveCounterpart(state, side)) continue;
    const start = initialHp(state, side);
    const now = stacksOfSide(state, side).reduce((sum, s) => sum + Math.max(0, s.hp), 0);
    const loss = start > 0 ? 1 - now / start : 0;
    const enemyStart = initialHp(state, side === "A" ? "B" : "A");
    const enemyNow = stacksOfSide(state, side === "A" ? "B" : "A").reduce((sum, s) => sum + Math.max(0, s.hp), 0);
    const enemyLoss = enemyStart > 0 ? 1 - enemyNow / enemyStart : 0;
    const ratio = enemyStart / Math.max(1, start);
    const threshold = Math.max(0.62, Math.min(0.90, 0.60 + 0.07 * (ratio - 1)));
    if (loss >= threshold && loss > enemyLoss + 0.10) {
      state.retreated[side] = true;
      state.log.push({ round: state.round, stackId: "-", action: "auto_retreat", note: side });
      finishBattle(state);
      return true;
    }
  }
  return false;
}
export function applyDamageToStack(stack: BattleStack, damage: number): number {
  if (stack.dead) return 0;
  const dealt = Math.min(stack.hp, damage);
  stack.hp -= dealt;
  stack.count = stack.hp <= 0 ? 0 : Math.max(1, Math.ceil(stack.hp / stack.hpPerShip));
  if (stack.count === 0) { stack.dead = true; stack.hp = 0; }
  return dealt;
}
export function performAttack(state: BattleState, attackerId: string, targetId: string, kind: "melee" | "ranged"): { ok: boolean; reason?: string; events: BattleEvent[] } {
  const attacker = findStack(state, attackerId), defender = findStack(state, targetId);
  if (!attacker || !defender) return { ok: false, reason: "NOT_FOUND", events: [] };
  if (attacker.side === defender.side) return { ok: false, reason: "SAME_SIDE", events: [] };
  if (attacker.dead || defender.dead) return { ok: false, reason: "DEAD", events: [] };
  if (attacker.id !== state.current) return { ok: false, reason: "NOT_YOUR_TURN", events: [] };
  const dist = hexDistance(attacker.pos, defender.pos);
  if (kind === "melee" && dist !== 1) return { ok: false, reason: "NOT_ADJACENT", events: [] };
  const preview = attackDamage(state, attacker, defender, kind === "ranged", attacker.movedThisTurn);
  if (preview.reason) return { ok: false, reason: preview.reason, events: [] };
  const damage = applyDamageToStack(defender, preview.damage);
  attacker.damageDealt += damage;
  const events: BattleEvent[] = [{ type: "attack", kind, attackerId, targetId, damage, crit: preview.crit, miss: preview.miss }];
  state.log.push({ round: state.round, stackId: attacker.id, action: kind + "_attack", targetId: defender.id, damage });
  if (!defender.dead && dist === 1 && defender.retaliatedRound !== state.round) {
    const counterPreview = attackDamage(state, defender, attacker, false, false);
    const counter = applyDamageToStack(attacker, Math.round(counterPreview.damage * 0.85));
    defender.damageDealt += counter; defender.retaliatedRound = state.round;
    events.push({ type: "retaliation", attackerId: defender.id, targetId: attacker.id, damage: counter });
    state.log.push({ round: state.round, stackId: defender.id, action: "retaliation", targetId: attacker.id, damage: counter });
  }
  if (!endIfSideDead(state) && !maybeAutoRetreat(state)) advanceTurn(state, attacker.id);
  return { ok: true, events };
}
export function performAbility(state: BattleState, stackId: string, abilityId: string, targetId?: string): { ok: boolean; reason?: string; events: BattleEvent[] } {
  const stack = findStack(state, stackId);
  if (!stack || stack.id !== state.current) return { ok: false, reason: "NOT_YOUR_TURN", events: [] };
  const def = abilityById(abilityId);
  if (!def || def.kind !== "active") return { ok: false, reason: "NOT_ACTIVE", events: [] };
  const cost = def.costOk ?? 0;
  if (state.ok[stack.side] < cost) return { ok: false, reason: "NOT_ENOUGH_OK", events: [] };
  if ((stack.cooldowns[abilityId] ?? 0) > 0) return { ok: false, reason: "COOLDOWN", events: [] };
  const events: BattleEvent[] = [{ type: "ability", stackId, abilityId, targetId }];
  state.ok[stack.side] -= cost; stack.cooldowns[abilityId] = def.cooldown ?? 0;
  const enemy = targetId ? findStack(state, targetId) : undefined;
  switch (abilityId) {
    case "focus_fire": stack.buffs.focus += 0.5; stack.buffs.roundsLeft = 1; break;
    case "emergency_repair": stack.hp = Math.min(stack.maxHp, stack.hp + Math.round(stack.maxHp * 0.10)); stack.count = Math.max(1, Math.ceil(stack.hp / stack.hpPerShip)); break;
    case "shield_barrier": stack.defending = true; stack.barrier = true; break;
    case "interceptors": stack.buffs.incoming = -0.4; stack.buffs.roundsLeft = 1; break;
    case "reactor_overload": for (const ally of aliveOfSide(state, stack.side)) { ally.buffs.damage += 0.25; ally.buffs.roundsLeft = 1; } break;
    case "ew_jam": if (!enemy) return { ok: false, reason: "NO_TARGET", events: [] }; enemy.buffs.initiative -= 2; enemy.buffs.damage -= 0.2; enemy.buffs.roundsLeft = 1; break;
    case "torpedo_fan": {
      const targets = aliveOfSide(state, sideOpposite(stack.side)).sort((a, b) => hexDistance(stack.pos, a.pos) - hexDistance(stack.pos, b.pos) || a.id.localeCompare(b.id)).slice(0, 3);
      for (const target of targets) { const dmg = attackDamage(state, stack, target, true, false, 0.6); const dealt = applyDamageToStack(target, dmg.damage); stack.damageDealt += dealt; events.push({ type: "ability_damage", targetId: target.id, damage: dealt }); }
      break;
    }
    case "tactical_retreat": {
      const backCol = stack.side === "A" ? 0 : COLS - 1;
      const goal = offsetToAxial(backCol, axialToOffset(stack.pos).row);
      const path = pathTo(state, stack.id, goal).slice(0, 2);
      if (path.length) moveStack(state, stack.id, path);
      stack.movedThisTurn = true; break;
    }
    case "reserve": {
      const res = state.reserve[stack.side].find((s) => !s.dead);
      if (!res) return { ok: false, reason: "NO_RESERVE", events: [] };
      const cells = zoneCells(stack.side).filter((c) => !stackAt(state, c) && isPassable(state.field, c));
      if (!cells.length) return { ok: false, reason: "NO_FREE_HEX", events: [] };
      res.pos = { ...cells[0]! }; res.reserve = false; res.acted = true;
      state.reserve[stack.side] = state.reserve[stack.side].filter((s) => s.id !== res.id);
      state.stacks.push(res); buildInitiative(state); events.push({ type: "reserve_deployed", stackId: res.id }); break;
    }
    case "boarding": {
      if (!enemy) return { ok: false, reason: "NO_TARGET", events: [] };
      if (hexDistance(stack.pos, enemy.pos) !== 1) return { ok: false, reason: "NOT_ADJACENT", events: [] };
      const chance = clamp(0.10, 0.75, 0.45 - 0.05 * (enemy.def - stack.atk) + 0.2);
      const success = hash01(state.seed, state.round, stack.id, enemy.id, "boarding") < chance;
      if (success) { enemy.count = Math.max(0, enemy.count - 1); enemy.hp = Math.min(enemy.hp, enemy.count * enemy.hpPerShip); if (enemy.count === 0) enemy.dead = true; events.push({ type: "boarding_success", targetId: enemy.id }); }
      else events.push({ type: "boarding_fail", targetId: enemy.id });
      break;
    }
    default: return { ok: false, reason: "UNIMPLEMENTED", events: [] };
  }
  state.log.push({ round: state.round, stackId, action: "ability", abilityId, targetId });
  if (!endIfSideDead(state) && !maybeAutoRetreat(state)) advanceTurn(state, stack.id);
  return { ok: true, events };
}

export function applyBattleCommand(state: BattleState, cmd: BattleCommand): { state: BattleState; events: BattleEvent[]; ok: boolean; reason?: string } {
  if (state.phase === "end") return { state, events: [], ok: false, reason: "FINISHED" };
  if (cmd.type === "auto") return { state, events: [], ok: false, reason: "AUTO_VIA_WRAPPER" };
  if (cmd.type === "place") {
    try { deployStack(state, cmd.side, cmd.stackId, cmd.at); state.commands.push(cmd); return { state, events: [{ type: "placement" }], ok: true }; }
    catch (error) { return { state, events: [], ok: false, reason: (error as Error).message }; }
  }
  if (cmd.type === "retreat") {
    state.retreated[cmd.side] = true;
    state.log.push({ round: state.round, stackId: "-", action: "retreat", note: cmd.side });
    state.commands.push(cmd); finishBattle(state); return { state, events: [{ type: "retreat", side: cmd.side }], ok: true };
  }
  const stack = findStack(state, cmd.stackId);
  if (!stack || stack.id !== state.current) return { state, events: [], ok: false, reason: "NOT_YOUR_TURN" };
  if (cmd.type === "move") { const result = moveStack(state, cmd.stackId, cmd.path); if (!result.ok) return { state, events: [], ok: false, reason: result.reason }; state.commands.push(cmd); return { state, events: result.events, ok: true }; }
  if (cmd.type === "attack" || cmd.type === "ranged") { const result = performAttack(state, cmd.stackId, cmd.targetId, cmd.type === "attack" ? "melee" : "ranged"); if (!result.ok) return { state, events: [], ok: false, reason: result.reason }; state.commands.push(cmd); return { state, events: result.events, ok: true }; }
  if (cmd.type === "wait") {
    if (stack.waited || stack.acted) return { state, events: [], ok: false, reason: "ALREADY_WAITED" };
    stack.waited = true; stack.acted = true; state.log.push({ round: state.round, stackId: stack.id, action: "wait" }); state.commands.push(cmd);
    state.current = null; selectCurrent(state);
    return { state, events: [{ type: "wait", stackId: stack.id }], ok: true };
  }
  if (cmd.type === "defend") {
    stack.defending = true; state.log.push({ round: state.round, stackId: stack.id, action: "defend" }); state.commands.push(cmd);
    advanceTurn(state, stack.id); return { state, events: [{ type: "defend", stackId: stack.id }], ok: true };
  }
  if (cmd.type === "ability") { const result = performAbility(state, cmd.stackId, cmd.abilityId, cmd.targetId); if (!result.ok) return { state, events: [], ok: false, reason: result.reason }; state.commands.push(cmd); return { state, events: result.events, ok: true }; }
  if (cmd.type === "reserve") { const result = performAbility(state, cmd.stackId, "reserve"); if (!result.ok) return { state, events: [], ok: false, reason: result.reason }; state.commands.push(cmd); return { state, events: result.events, ok: true }; }
  if (cmd.type === "endTurn") { state.log.push({ round: state.round, stackId: stack.id, action: "end_turn" }); state.commands.push(cmd); advanceTurn(state, stack.id); return { state, events: [{ type: "end_turn" }], ok: true }; }
  return { state, events: [], ok: false, reason: "UNKNOWN" };
}

export function previewAbility(state: BattleState, stackId: string, abilityId: string): { ok: boolean; costOk: number; cooldown: number; available: boolean; reason?: string } {
  const stack = findStack(state, stackId);
  const def = abilityById(abilityId);
  if (!stack || !def || def.kind !== "active") return { ok: false, costOk: 0, cooldown: 0, available: false, reason: "NOT_ACTIVE" };
  const costOk = def.costOk ?? 0;
  const cooldown = stack.cooldowns[abilityId] ?? 0;
  const available = state.current === stack.id && (state.ok[stack.side] ?? 0) >= costOk && cooldown <= 0;
  const reason = available ? undefined : state.current !== stack.id ? "NOT_YOUR_TURN" : (state.ok[stack.side] ?? 0) < costOk ? "NOT_ENOUGH_OK" : "COOLDOWN";
  return { ok: available, costOk, cooldown, available, reason };
}
export function previewAttack(state: BattleState, attackerId: string, targetId: string, kind: "melee" | "ranged"): { damageMin: number; damageMax: number; lossMin: number; lossMax: number; counter: boolean; los: boolean; reason?: string } {
  const attacker = findStack(state, attackerId), defender = findStack(state, targetId);
  if (!attacker || !defender) return { damageMin: 0, damageMax: 0, lossMin: 0, lossMax: 0, counter: false, los: false, reason: "NOT_FOUND" };
  const preview = attackDamage(state, attacker, defender, kind === "ranged", attacker.movedThisTurn);
  if (preview.reason) return { damageMin: 0, damageMax: 0, lossMin: 0, lossMax: 0, counter: false, los: false, reason: preview.reason };
  const min = Math.round(preview.damage * 0.85), max = Math.round(preview.damage * 1.15);
  return { damageMin: min, damageMax: max, lossMin: Math.floor(min / defender.hpPerShip), lossMax: Math.floor(max / defender.hpPerShip), counter: kind === "melee" || hexDistance(attacker.pos, defender.pos) === 1, los: hasLos(state.field, attacker.pos, defender.pos) };
}

export function getBattleView(state: BattleState): BattleView {
  const stackViews: StackView[] = state.stacks.map((s) => {
    const offset = axialToOffset(s.pos); const cls = classById(s.classId);
    return {
      id: s.id, side: s.side, classId: s.classId, code: s.code, nameRu: cls?.nameRu ?? s.classId,
      count: s.count, maxCount: cls?.maxStack ?? s.count, hp: s.hp, maxHp: s.maxHp,
      q: s.pos.q, r: s.pos.r, col: offset.col, row: offset.row, initiative: s.initiative, mp: s.mp,
      range: s.range, atk: s.atk, def: s.def, fp: s.fp, reserve: s.reserve, defending: s.defending,
      waited: s.waited, dead: s.dead, flagship: s.flagship, abilities: s.abilities,
    };
  });
  const active = state.current ? findStack(state, state.current) : undefined;
  return {
    battleId: state.battleId, phase: state.phase, round: state.round, roundCap: state.roundCap,
    activeStackId: state.current, currentSide: active?.side ?? null, stacks: stackViews,
    obstacles: state.field.obstacles.map((o) => ({ q: o.q, r: o.r, type: o.type })),
    initiativeOrder: state.initiative.slice(), deployment: { ...state.deployment }, log: state.log.slice(),
    winner: state.result?.winner ?? null, ok: { ...state.ok }, seed: state.seed,
  };
}
export function buildResult(state: BattleState): BattleResult {
  const fpStart = (side: Side): number => {
    const input = side === "A" ? state.input.attacker : state.input.defender;
    return input.stacks.reduce((sum, raw) => { const cls = classById(raw.classId); return sum + (cls ? cls.fp * Math.min(raw.count, cls.maxStack) : 0); }, 0);
  };
  const fpNow = (side: Side): number => aliveOfSide(state, side).reduce((sum, s) => sum + s.count * s.fp, 0);
  const shipsStart = (side: Side): number => (side === "A" ? state.input.attacker : state.input.defender).stacks.reduce((sum, raw) => sum + raw.count, 0);
  const shipsNow = (side: Side): number => aliveOfSide(state, side).reduce((sum, s) => sum + s.count, 0);
  const resultSide = (side: Side) => {
    const start = fpStart(side), after = fpNow(side);
    const sideStacks = stacksOfSide(state, side);
    const totalHp = sideStacks.reduce((sum, s) => sum + s.maxHp, 0);
    const hpNow = sideStacks.reduce((sum, s) => sum + Math.max(0, s.hp), 0);
    return { fpStart: start, fpAfter: after, fpLost: start - after, lossFraction: start > 0 ? (start - after) / start : 0, damageFraction: totalHp > 0 ? 1 - hpNow / totalHp : 0, shipsDestroyed: Math.max(0, shipsStart(side) - shipsNow(side)), shipsDamaged: aliveOfSide(state, side).filter((s) => s.hp < s.maxHp).reduce((sum, s) => sum + s.count, 0), shipsEscaped: 0, stacksAlive: aliveOfSide(state, side).length };
  };
  const lossA = resultSide("A"), lossB = resultSide("B");
  const deadA = !aliveCounterpart(state, "A") || state.retreated.A, deadB = !aliveCounterpart(state, "B") || state.retreated.B;
  const outcome = deadA && !deadB ? "victory_b" : deadB && !deadA ? "victory_a" : "draw";
  const winner = outcome === "victory_a" ? "A" : outcome === "victory_b" ? "B" : null;
  const killedB = lossB.fpLost, killedA = lossA.fpLost;
  const spoilsAlloys = Math.floor((winner === "A" ? lossB.shipsDestroyed * 30 : winner === "B" ? lossA.shipsDestroyed * 30 : 0) * 0.15);
  const mvp = state.stacks.slice().sort((a, b) => b.damageDealt - a.damageDealt)[0]?.id ?? null;
  const replayHash = hash32(JSON.stringify(state.log)).toString(16);
  return {
    battleId: state.battleId, seed: state.seed, mode: "grid", rounds: state.round, outcome, winner,
    durationRounds: state.round, losses: { A: lossA, B: lossB },
    spoils: { alloys: spoilsAlloys, alloysFrac: 0, salvageHexes: 0 },
    xp: { admiral: Math.floor((winner === "A" ? killedB : winner === "B" ? killedA : 0) / 10) * (winner ? 1.2 : 0.5), flagship: 0 },
    warScoreDelta: winner ? Math.round(0.6 * (winner === "A" ? killedB / Math.max(1, lossB.fpStart) : killedA / Math.max(1, lossA.fpStart)) * 100) / 10 : 0,
    mvpStackId: mvp, replayHash, log: state.log.slice(),
  };
}
export function battleResult(state: BattleState): BattleResult { return state.result ?? buildResult(state); }
export function serializeBattle(state: BattleState): string { return JSON.stringify(state); }
export function deserializeBattle(json: string): BattleState { return JSON.parse(json) as BattleState; }
export function battleStateHash(state: BattleState): string { return hash32(JSON.stringify(state)).toString(16); }
export function allStacks(state: BattleState): BattleStack[] { return state.stacks; }
export function abilityDefinitions() { return battleClasses().flatMap((c) => c.abilities); }
export function terrainDefinitions(): TerrainId[] { return Object.keys(TERRAIN) as TerrainId[]; }
export function allHexesList(): Axial[] { return allHexes(); }
void inZone; void inBounds;
