import type { BattleCommand, BattleStack, BattleState, Side } from "./types";
import { abilityById } from "./catalog";
import { applyBattleCommand, autoDeploy, findStack, getBattleView, legalMoves, pathTo, startBattle, aliveOfSide } from "./engine";
import { classById } from "./catalog";
import { hexDistance, hexKey } from "./hex";
import { hasLos } from "./field";
import { BATTLE_CONTENT } from "./catalog";

export type AiDifficulty = "easy" | "normal" | "hard";

export interface AiOptions {
  difficulty?: AiDifficulty;
  profileId?: string;
  preset?: string;
}

function profileWeights(profileId?: string): Record<string, number> {
  const profile = BATTLE_CONTENT.profiles.find((p) => p.id === profileId) ?? BATTLE_CONTENT.profiles.find((p) => p.id === "aggressor");
  if (!profile) return { damage: 1, kill: 1, threatReduction: 0.5, cover: 0.5, keyCell: 0.5, reserve: 0.2, counterPenalty: -0.5, overkillPenalty: -0.3, flagshipBonus: 0 };
  const w = profile.weights;
  return { damage: w.damage, kill: w.kill, threatReduction: w.threatReduction, cover: w.cover, keyCell: w.keyCell, reserve: w.reserve, counterPenalty: w.counterPenalty, overkillPenalty: w.overkillPenalty, flagshipBonus: w.flagshipBonus };
}

export function aiPreset(state: BattleState, side: Side, profileId?: string): string {
  const own = aliveOfSide(state, side).reduce((sum, s) => sum + s.fp * s.count, 0);
  const enemy = aliveOfSide(state, side === "A" ? "B" : "A").reduce((sum, s) => sum + s.fp * s.count, 0);
  if (profileId === "kiter") return "screen";
  if (profileId === "defender") return own < enemy * 1.3 ? "turtle" : "line";
  if (own > enemy * 1.2) return "wedge";
  if (own < enemy * 0.8) return "turtle";
  return "line";
}
export function aiDeploy(state: BattleState, side: Side, options: AiOptions = {}): BattleState {
  return autoDeploy(state, side, options.preset ?? aiPreset(state, side, options.profileId));
}
function targetScore(state: BattleState, stack: BattleStack, target: BattleStack, weights: Record<string, number>): number {
  const dist = hexDistance(stack.pos, target.pos);
  const reach = dist <= stack.mp + stack.range ? 1 : 0;
  const kill = target.hp <= stack.count * stack.dps * 3 ? 1 : 0;
  const flagship = target.flagship ? weights.flagshipBonus ?? 0 : 0;
  return reach * 2 + kill * (weights.kill ?? 1) * 3 + weights.damage - dist * 0.1 + flagship * 4 - target.hp / Math.max(1, target.maxHp);
}
function chooseTarget(state: BattleState, stack: BattleStack, difficulty: AiDifficulty, weights: Record<string, number>): BattleStack | undefined {
  const enemies = aliveOfSide(state, stack.side === "A" ? "B" : "A");
  if (!enemies.length) return undefined;
  const scored = enemies.map((e) => ({ e, score: targetScore(state, stack, e, weights) + (difficulty === "hard" ? 0 : (hash01Local(state.seed, state.round, stack.id, e.id) - 0.5) * (difficulty === "easy" ? 2 : 1)) }))
    .sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id));
  return scored[0]?.e;
}
function hash01Local(...parts: Array<number | string>): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) { const s = String(part); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } }
  return h / 4294967296;
}
function useBestAbility(state: BattleState, stack: BattleStack, target: BattleStack | undefined, difficulty: AiDifficulty): boolean {
  const rate = difficulty === "easy" ? 0.3 : difficulty === "normal" ? 0.7 : 1;
  const candidates = stack.abilities.filter((id) => abilityById(id)?.kind === "active");
  if (!candidates.length || hash01Local(state.seed, state.round, stack.id, "ability") > rate) return false;
  const usable = candidates.filter((id) => (abilityById(id)?.costOk ?? 0) <= state.ok[stack.side] && (stack.cooldowns[id] ?? 0) <= 0);
  const prefer = usable.find((id) => id === "emergency_repair" && stack.hp < stack.maxHp * 0.5)
    ?? usable.find((id) => id === "shield_barrier" && stack.hp < stack.maxHp * 0.6)
    ?? usable.find((id) => id === "focus_fire")
    ?? usable[0];
  if (!prefer) return false;
  const needsTarget = ["ew_jam", "boarding"].includes(prefer);
  const result = applyBattleCommand(state, { type: "ability", stackId: stack.id, abilityId: prefer, targetId: needsTarget ? target?.id : undefined });
  return result.ok;
}
export function aiTakeTurn(state: BattleState, options: AiOptions = {}) {
  if (state.phase !== "rounds" || !state.current) return { state, events: [], ok: false, reason: "NO_TURN" };
  const stack = findStack(state, state.current);
  if (!stack) return { state, events: [], ok: false, reason: "NO_STACK" };
  const difficulty = options.difficulty ?? "normal";
  const weights = profileWeights(options.profileId);
  const target = chooseTarget(state, stack, difficulty, weights);
  if (!target) return applyBattleCommand(state, { type: "endTurn", stackId: stack.id });
  // 1. способность
  if (useBestAbility(state, stack, target, difficulty)) return { state, events: [{ type: "ai_ability" }], ok: true };
  // 2. атака на месте
  const dist = hexDistance(stack.pos, target.pos);
  if (dist === 1) return applyBattleCommand(state, { type: "attack", stackId: stack.id, targetId: target.id });
  if (hasLos(state.field, stack.pos, target.pos) && dist <= stack.range) {
    return applyBattleCommand(state, { type: "ranged", stackId: stack.id, targetId: target.id });
  }
  // 3. движение к цели, затем возможная атака
  const reach = legalMoves(state, stack.id);
  if (reach.length) {
    const bestCell = reach.slice().sort((a, b) => hexDistance(a, target.pos) - hexDistance(b, target.pos) || a.q - b.q || a.r - b.r)[0]!;
    const path = pathTo(state, stack.id, bestCell);
    if (path.length) {
      const moveResult = applyBattleCommand(state, { type: "move", stackId: stack.id, path });
      if (moveResult.ok && !stack.dead && state.current === stack.id) {
        const afterDist = hexDistance(stack.pos, target.pos);
        if (afterDist === 1) return applyBattleCommand(state, { type: "attack", stackId: stack.id, targetId: target.id });
        if (hasLos(state.field, stack.pos, target.pos) && afterDist <= stack.range) return applyBattleCommand(state, { type: "ranged", stackId: stack.id, targetId: target.id });
        return applyBattleCommand(state, { type: "endTurn", stackId: stack.id });
      }
      return moveResult;
    }
  }
  return applyBattleCommand(state, { type: "defend", stackId: stack.id });
}
export function runAiBattle(state: BattleState, a: AiOptions = {}, b: AiOptions = {}): BattleState {
  state.autoRetreat = true;
  if (state.phase === "deployment") {
    aiDeploy(state, "A", a);
    aiDeploy(state, "B", b);
  }
  if (state.phase === "deployment") startBattle(state);
  let guard = 0;
  const initialFp = (side: "A" | "B") => (side === "A" ? state.input.attacker : state.input.defender).stacks.reduce((sum, raw) => {
    const cls = classById(raw.classId); return sum + (cls ? cls.fp * Math.min(raw.count, cls.maxStack) : 0);
  }, 0);
  const lossOf = (side: "A" | "B") => {
    const start = initialFp(side);
    const now = aliveOfSide(state, side).reduce((sum, s) => sum + s.count * s.fp, 0);
    return start > 0 ? 1 - now / start : 0;
  };
  while (state.phase === "rounds" && guard < 5000) {
    guard++;
    if (state.phase !== "rounds") break;
    const side = getBattleView(state).currentSide;
    if (!side) break;
    const result = aiTakeTurn(state, side === "A" ? a : b);
    if (!result.ok) {
      const stack = state.current ? findStack(state, state.current) : undefined;
      if (stack) applyBattleCommand(state, { type: "defend", stackId: stack.id });
      else break;
    }
  }
  return state;
}
export function aiCommand(state: BattleState, options: AiOptions = {}): BattleCommand | null {
  const stack = state.current ? findStack(state, state.current) : null;
  if (!stack) return null;
  void options;
  return { type: "defend", stackId: stack.id };
}
void hexKey;
