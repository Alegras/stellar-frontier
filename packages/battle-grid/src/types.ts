/** M5b · Grid Command: чистые типы детерминированной битвы 15×11. */
export type Side = "A" | "B";
export type BattlePhase = "deployment" | "rounds" | "end";
export type TerrainId = "empty" | "asteroid" | "nebula" | "mines" | "gravity" | "wreck" | "dust";

export interface Axial { q: number; r: number }

export interface HexCell {
  q: number;
  r: number;
  col: number;
  row: number;
}

export interface UnitClassDef {
  id: string;
  code: string;
  nameRu: string;
  hp: number;
  dps: number;
  accuracyBp: number;
  initiative: number;
  mp: number;
  atk: number;
  def: number;
  range: number;
  fp: number;
  maxStack: number;
  costAlloys: number;
  damageMix: { kinetic: number; energy: number };
  abilities: string[];
}

export interface TerrainDef {
  id: TerrainId;
  nameRu: string;
  passable: boolean;
  moveCost: number;
  losBlock: boolean;
  cover: number;
  damagePct: number;
  rangePenalty: number;
}

export interface AbilityDef {
  id: string;
  nameRu: string;
  kind: "active" | "passive";
  source: "admiral" | "class";
  costOk?: number;
  cooldown?: number;
  target?: "self" | "enemy" | "line" | "reserve" | "all_allies";
  effect: Record<string, number | boolean | string>;
}

export interface AbilitySlot { id: string; cooldownLeft: number; used: boolean }

export interface StackInput {
  classId: string;
  count: number;
  hpPct?: number;
  stackId?: string;
  flagship?: boolean;
}

export interface SideInput {
  empireId?: number;
  fleetId?: number;
  stacks: StackInput[];
  admiralLevel?: number;
  admiralAbilities?: string[];
  morale?: number;
  luck?: number;
  doctrine?: string;
  station?: boolean;
}

export interface BattleStack {
  id: string;
  side: Side;
  classId: string;
  code: string;
  count: number;
  hp: number;
  maxHp: number;
  hpPerShip: number;
  dps: number;
  mp: number;
  initiative: number;
  atk: number;
  def: number;
  range: number;
  fp: number;
  costAlloys: number;
  damageMix: { kinetic: number; energy: number };
  pos: Axial;
  reserve: boolean;
  dead: boolean;
  waited: boolean;
  acted: boolean;
  defending: boolean;
  barrier: boolean;
  retaliatedRound: number;
  morale: number;
  luck: number;
  abilities: string[];
  cooldowns: Record<string, number>;
  mpLeft: number;
  movedThisTurn: boolean;
  buffs: { focus: number; incoming: number; damage: number; def: number; initiative: number; roundsLeft: number };
  flagship: boolean;
  discovered: boolean;
  damageDealt: number;
}

export interface BattleField {
  cols: number;
  rows: number;
  terrain: Record<string, TerrainId>;
  obstacles: Array<{ q: number; r: number; type: TerrainId; mirrorOf: string | null }>;
  profile: string;
}

export interface BattleLogEntry {
  round: number;
  stackId: string;
  action: string;
  targetId?: string;
  path?: Axial[];
  damage?: number;
  counter?: number;
  abilityId?: string;
  hex?: Axial;
  note?: string;
}

export type BattleCommand =
  | { type: "move"; stackId: string; path: Axial[] }
  | { type: "attack"; stackId: string; targetId: string }
  | { type: "ranged"; stackId: string; targetId: string }
  | { type: "wait"; stackId: string }
  | { type: "defend"; stackId: string }
  | { type: "ability"; stackId: string; abilityId: string; targetId?: string; targetHex?: Axial }
  | { type: "reserve"; stackId: string; at?: Axial }
  | { type: "endTurn"; stackId: string }
  | { type: "retreat"; side: Side }
  | { type: "place"; stackId: string; at: Axial; side: Side }
  | { type: "auto" };

export interface BattleEvent { type: string; [key: string]: unknown }

export interface BattleSideResult {
  fpStart: number;
  fpAfter: number;
  fpLost: number;
  lossFraction: number;
  damageFraction: number;
  shipsDestroyed: number;
  shipsDamaged: number;
  shipsEscaped: number;
  stacksAlive: number;
}

export interface BattleResult {
  battleId: string;
  seed: number;
  mode: "grid";
  rounds: number;
  outcome: "victory_a" | "victory_b" | "draw";
  winner: Side | null;
  durationRounds: number;
  losses: { A: BattleSideResult; B: BattleSideResult };
  spoils: { alloys: number; alloysFrac: number; salvageHexes: number };
  xp: { admiral: number; flagship: number };
  warScoreDelta: number;
  mvpStackId: string | null;
  replayHash: string;
  log: BattleLogEntry[];
}

export interface BattleState {
  battleId: string;
  seed: number;
  round: number;
  roundCap: number;
  phase: BattlePhase;
  field: BattleField;
  stacks: BattleStack[];
  reserve: { A: BattleStack[]; B: BattleStack[] };
  deployment: { A: boolean; B: boolean };
  retreated: { A: boolean; B: boolean };
  initiative: string[];
  current: string | null;
  waited: string[];
  ok: { A: number; B: number };
  okPerRound: { A: number; B: number };
  log: BattleLogEntry[];
  commands: BattleCommand[];
  rngCounter: number;
  autoRetreat: boolean;
  result: BattleResult | null;
  input: { attacker: SideInput; defender: SideInput };
}

export interface StackView {
  id: string;
  side: Side;
  classId: string;
  code: string;
  nameRu: string;
  count: number;
  maxCount: number;
  hp: number;
  maxHp: number;
  q: number;
  r: number;
  col: number;
  row: number;
  initiative: number;
  mp: number;
  range: number;
  atk: number;
  def: number;
  fp: number;
  reserve: boolean;
  defending: boolean;
  waited: boolean;
  dead: boolean;
  flagship: boolean;
  abilities: string[];
}

export interface BattleView {
  battleId: string;
  phase: BattlePhase;
  round: number;
  roundCap: number;
  activeStackId: string | null;
  currentSide: Side | null;
  stacks: StackView[];
  obstacles: Array<{ q: number; r: number; type: TerrainId }>;
  initiativeOrder: string[];
  deployment: { A: boolean; B: boolean };
  log: BattleLogEntry[];
  winner: Side | null;
  ok: { A: number; B: number };
  seed: number;
}

export interface BattleCreateInput {
  seed: number;
  battleId?: string;
  attacker: SideInput;
  defender: SideInput;
  field?: BattleField;
  terrainProfile?: string;
  roundCap?: number;
  autoRetreat?: boolean;
}
