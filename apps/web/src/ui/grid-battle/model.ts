/** task-62 · M5b «Сетка командования» — UI-модель на мок-данных с battle-контентом @sf/data (адаптер battle-grid позже). */
import { BATTLE_CLASS_BY_ID, BATTLE_TERRAIN_BY_ID } from "@sf/data";
export type Side = "player" | "enemy";
export type Phase = "deploy" | "battle" | "result";
export type Cls = "corvette" | "frigate" | "destroyer" | "cruiser" | "battleship" | "titan" | "carrier" | "colossus";
export type Terrain = "void" | "asteroid" | "nebula" | "debris" | "minefield" | "gravity_anomaly";
export type Formation = "line" | "wedge" | "echelon" | "guard";

export interface Stack { id: string; side: Side; cls: Cls; name: string; count: number; startCount: number; hp: number; maxHp: number; shield: number; maxShield: number; mp: number; maxMp: number; init: number; dmg: number; range: number; q: number; r: number; facing: number; reserve: boolean; alive: boolean; moved: boolean; waited: boolean; defended: boolean; counterUsed: boolean; kills: number; abilities?: string[]; ap?: number; attackedThisPhase?: number; movedThisPhase?: boolean; damagedThisRound?: boolean; }
export interface Obstacle { q: number; r: number; kind: Terrain; hp?: number; maxHp?: number }
export interface LogEntry { round: number; text: string; kind: "damage" | "ability" | "system" | "death" | "move" }
export interface Loss { side: Side; cls: Cls; name: string; lost: number; fp: number }
export interface Result { winner: Side | "draw"; losses: Loss[]; spoils: { credits: number; alloys: number; samples: number }; xp: number; warScore: number; mvpName: string; mvpDamage: number; parity: { autoMin: number; autoMax: number; actual: number }; seed: number; lossFraction?: { player: number; enemy: number } }
export interface BattleEffect { kind: "attack" | "hit" | "shield" | "move" | "death"; from: { q: number; r: number }; to: { q: number; r: number }; amount: number; shield: number; t: number; }
export interface Battle { id: string; seed: number; title: string; systemName: string; phase: Phase; coop: boolean; round: number; maxRounds: number; timerSec: number | null; stacks: Stack[]; obstacles: Obstacle[]; cursor: { q: number; r: number }; hover: { q: number; r: number } | null; activeId: string | null; order: string[]; log: LogEntry[]; result: Result | null; preset: Formation; deploymentCount: number; reserveCount: number; lastDamage: Array<{ q: number; r: number; amount: number; t: number }>; lastEffects: BattleEffect[]; turnSide?: Side; firstSide?: Side; overwatch?: Record<string, boolean>; startFp?: { player: number; enemy: number } }

export const COLS = 15, ROWS = 11, FIELD_W = 544, FIELD_H = 350, HEX_W = 32, HEX_H = 36;
export const CLASS_RU: Record<Cls, string> = Object.fromEntries((["corvette", "frigate", "destroyer", "cruiser", "battleship", "carrier", "titan", "colossus"] as Cls[]).map((id) => [id, BATTLE_CLASS_BY_ID[id]?.titleRu ?? id])) as Record<Cls, string>;
export const CLASS_ORDER: Cls[] = ["corvette", "frigate", "destroyer", "cruiser", "battleship", "carrier", "titan", "colossus"];
export const TERRAIN_RU: Record<Terrain, string> = Object.fromEntries((["void", "asteroid", "nebula", "debris", "minefield", "gravity_anomaly"] as Terrain[]).map((id) => [id, BATTLE_TERRAIN_BY_ID[id]?.titleRu ?? id])) as Record<Terrain, string>;
const STATS_FALLBACK: Record<Cls, { n: number; hp: number; init: number; dmg: number; range: number; mp: number; name: string }> = {
  corvette: { n: 18, hp: 130, init: 19, dmg: 52, range: 1, mp: 6, name: "Клинок" },
  frigate: { n: 10, hp: 210, init: 17, dmg: 86, range: 1, mp: 5, name: "Страж" },
  destroyer: { n: 8, hp: 280, init: 15, dmg: 118, range: 2, mp: 4, name: "Молот" },
  cruiser: { n: 5, hp: 400, init: 13, dmg: 170, range: 3, mp: 4, name: "Копьё" },
  battleship: { n: 3, hp: 620, init: 10, dmg: 240, range: 3, mp: 3, name: "Тень" },
  carrier: { n: 2, hp: 520, init: 12, dmg: 150, range: 2, mp: 4, name: "Улей" },
  titan: { n: 1, hp: 1200, init: 8, dmg: 320, range: 4, mp: 3, name: "Колосс" },
  colossus: { n: 1, hp: 1600, init: 7, dmg: 420, range: 4, mp: 3, name: "Молчащий" },
};
const STATS: Record<Cls, { n: number; hp: number; init: number; dmg: number; range: number; mp: number; name: string }> = Object.fromEntries((Object.keys(STATS_FALLBACK) as Cls[]).map((id) => {
  const d = BATTLE_CLASS_BY_ID[id];
  return [id, d
    ? { n: Math.max(1, d.maxStack), hp: Math.max(1, d.hpStack), init: d.initiative, dmg: Math.max(1, d.damageStack), range: d.range, mp: d.mp, name: STATS_FALLBACK[id].name }
    : STATS_FALLBACK[id]];
})) as Record<Cls, { n: number; hp: number; init: number; dmg: number; range: number; mp: number; name: string }>;
const P_NAMES = ["Заря", "Молот", "Стрела", "Тень", "Улей", "Вихрь", "Копьё", "Щит", "Клинок", "Сокол"];
const E_NAMES = ["Хищник", "Коготь", "Пепел", "Рёв", "Стрекоза", "Гнев", "Клык", "Терн", "Туман", "Гарпун"];
const KEY = "abcdefghijklmnopqrstuvwxyz";
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rngOf = (seed: number): (() => number) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; };

export const key = (q: number, r: number): string => q + "," + r;
/**
 * Единственный источник истины по геометрии поля.
 * Экран рисует "odd-r" offset-гексы (q = колонка, r = ряд, нечётные ряды сдвинуты вправо),
 * а правила (соседство/дистанция/LOS) считаются в cube-координатах. Раньше offset путали
 * с axial — из-за этого соседство и дистанция не совпадали с нарисованной сеткой
 * (можно было атаковать не соседний гекс и нельзя было атаковать реального соседа).
 */
export function offsetToCube(q: number, r: number): { x: number; y: number; z: number } {
  const x = q - Math.floor(r / 2); const z = r; return { x, y: -x - z, z };
}
export function cubeToOffset(x: number, z: number): { q: number; r: number } {
  return { q: x + Math.floor(z / 2), r: z };
}
const CUBE_DIRS: ReadonlyArray<readonly [number, number, number]> = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
export function cubeRound(x: number, y: number, z: number): { x: number; y: number; z: number } {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}
export function distance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const ca = offsetToCube(a.q, a.r), cb = offsetToCube(b.q, b.r);
  return Math.max(Math.abs(ca.x - cb.x), Math.abs(ca.y - cb.y), Math.abs(ca.z - cb.z));
}
export function neighbors(q: number, r: number): Array<{ q: number; r: number }> {
  const c = offsetToCube(q, r); const out: Array<{ q: number; r: number }> = [];
  for (const [dx, , dz] of CUBE_DIRS) {
    const h = cubeToOffset(c.x + dx, c.z + dz);
    if (h.q >= 0 && h.q < COLS && h.r >= 0 && h.r < ROWS) out.push(h);
  }
  return out;
}
/** Все гексы на линии a→b (включая концы) с cube-округлением — для LOS. */
export function lineHexes(a: { q: number; r: number }, b: { q: number; r: number }): Array<{ q: number; r: number }> {
  const n = distance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const ca = offsetToCube(a.q, a.r), cb = offsetToCube(b.q, b.r); const out: Array<{ q: number; r: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = cubeRound(ca.x + (cb.x - ca.x) * t, ca.y + (cb.y - ca.y) * t, ca.z + (cb.z - ca.z) * t);
    out.push(cubeToOffset(p.x, p.z));
  }
  return out;
}
export function hexCenter(q: number, r: number): { x: number; y: number } { return { x: 28 + q * 32 + (r & 1) * 16, y: 26 + r * 27 }; }
export function pixelToHex(x: number, y: number): { q: number; r: number } { let best = { q: 0, r: 0, d: 1e9 }; for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) { const c = hexCenter(q, r), d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < best.d) best = { q, r, d }; } return { q: best.q, r: best.r }; }
export const isDeployZone = (q: number, side: Side, tactician = false): boolean => side === "player" ? q <= (tactician ? 3 : 2) : q >= (tactician ? 11 : 12);
export const terrainBlocksMove = (t: Terrain): boolean => t === "asteroid";
export const terrainBlocksLos = (t: Terrain): boolean => t === "asteroid" || t === "nebula";
export const obstacleAt = (b: Battle, q: number, r: number): Terrain => b.obstacles.find((o) => o.q === q && o.r === r)?.kind ?? "void";
export const stackAt = (b: Battle, q: number, r: number): Stack | null => b.stacks.find((s) => !s.reserve && s.alive && s.q === q && s.r === r) ?? null;

function makeStack(side: Side, cls: Cls, i: number, seed: number): Stack {
  const st = STATS[cls]; const h = hash(cls + i + seed); const count = Math.max(1, st.n + ((h % 3) - 1));
  return { id: (side === "player" ? "p" : "e") + (i + 1), side, cls, name: (side === "player" ? P_NAMES : E_NAMES)[i % 10]!, count, startCount: count, hp: count * st.hp, maxHp: count * st.hp, shield: count * 24, maxShield: count * 24, mp: st.mp, maxMp: st.mp, init: st.init, dmg: st.dmg, range: st.range, q: 0, r: i, facing: side === "player" ? 0 : 3, reserve: false, alive: true, moved: false, waited: false, defended: false, counterUsed: false, kills: 0 };
}
export function createMockBattle(opts: { seed?: number; systemName?: string; coop?: boolean } = {}): Battle {
  const seed = opts.seed ?? 42; const stacks: Stack[] = [];
  const cls = CLASS_ORDER.slice(0, 7);
  // Зеркальный состав: раньше враг получал сдвинутый (более сильный) набор классов —
  // это был скрытый перевес, из-за которого авто-бой систематически склонялся к поражению игрока.
  for (let i = 0; i < 7; i++) stacks.push(makeStack("player", cls[i]!, i, seed));
  for (let i = 0; i < 7; i++) stacks.push(makeStack("enemy", cls[i]!, i, seed));
  const rnd = rngOf(hash("field" + seed)); const obstacles: Obstacle[] = [];
  for (const kind of ["asteroid", "asteroid", "nebula", "nebula", "minefield", "gravity_anomaly", "debris"] as Terrain[]) {
    for (let t = 0; t < 20; t++) { const q = 4 + Math.floor(rnd() * 7), r = Math.floor(rnd() * ROWS); if (obstacles.some((o) => o.q === q && o.r === r)) continue; obstacles.push({ q, r, kind }); break; }
  }
  const b: Battle = { id: "btl_" + seed, seed, title: "Сетка командования", systemName: opts.systemName ?? "Вега-II", phase: "deploy", coop: Boolean(opts.coop), round: 0, maxRounds: 30, timerSec: opts.coop ? 90 : null, stacks, obstacles, cursor: { q: 1, r: 5 }, hover: null, activeId: null, order: [], log: [{ round: 0, kind: "system", text: "Расстановка: 7 стэков на поле, 3 в резерве." }], result: null, preset: "line", deploymentCount: 0, reserveCount: 0, lastDamage: [], lastEffects: [] };
  // Обе стороны строятся одинаково (зеркально) — раньше враг стоял «клином», что давало
  // ему скрытое преимущество в размене и ломало паритет авто-боя.
  formation(b, "line", "player"); formation(b, "line", "enemy"); return b;
}
export function clone(b: Battle): Battle { return { ...b, stacks: b.stacks.map((s) => ({ ...s })), obstacles: b.obstacles.map((o) => ({ ...o })), cursor: { ...b.cursor }, order: [...b.order], log: [...b.log], result: b.result, lastDamage: b.lastDamage.map((x) => ({ ...x })), lastEffects: b.lastEffects.map((x) => ({ ...x, from: { ...x.from }, to: { ...x.to } })) }; }
function log(b: Battle, text: string, kind: LogEntry["kind"]): void { b.log.push({ round: b.round, text, kind }); if (b.log.length > 80) b.log.splice(0, b.log.length - 80); }
function rowsOrder(): number[] { return [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10]; }
export function recount(b: Battle): void { b.deploymentCount = b.stacks.filter((s) => s.side === "player" && !s.reserve && s.alive).length; b.reserveCount = b.stacks.filter((s) => s.side === "player" && s.reserve && s.alive).length; }
export function formation(b: Battle, preset: Formation, side: Side): Battle {
  b.preset = preset; const ss = b.stacks.filter((s) => s.side === side); const rows = rowsOrder(); const baseQ = side === "player" ? 2 : 12; const dir = side === "player" ? -1 : 1; const clampQ = (q: number) => side === "player" ? Math.max(0, Math.min(2, q)) : Math.max(12, Math.min(14, q));
  ss.forEach((s, i) => {
    let q = baseQ, r = rows[i % rows.length]!;
    if (preset === "wedge") { q = clampQ(baseQ + (i % 3 === 0 ? 0 : dir)); r = 5 + (i % 2 === 0 ? Math.min(5, i) : -Math.min(5, i)); }
    else if (preset === "echelon") { q = clampQ(baseQ + Math.min(2, Math.floor(i / 3))); }
    else if (preset === "guard") { q = clampQ(baseQ + (s.range > 1 ? 0 : -dir)); }
    s.q = q; s.r = Math.max(0, Math.min(10, r)); s.facing = side === "player" ? 0 : 3; s.reserve = false; s.alive = true; s.hp = s.maxHp; s.shield = s.maxShield; s.mp = s.maxMp; s.moved = s.waited = s.defended = s.counterUsed = false;
  });
  const occupied = new Set(ss.map((s) => key(s.q, s.r)));
  for (const s of ss) if (occupied.has(key(s.q, s.r)) && ss.filter((o) => o.q === s.q && o.r === s.r).length > 1) s.reserve = true;
  recount(b); return b;
}
export function resetDeploy(b: Battle): Battle { for (const s of b.stacks) if (s.side === "player") { s.reserve = true; s.q = 0; s.r = 0; } b.phase = "deploy"; b.result = null; b.log = [{ round: 0, kind: "system", text: "Расстановка сброшена — все стэки в резерве." }]; recount(b); return b; }
export function deploy(b: Battle, id: string, q: number, r: number): { ok: boolean; reason?: string } {
  const s = b.stacks.find((x) => x.id === id); if (!s || s.side !== "player") return { ok: false, reason: "Стэк недоступен" };
  const t = obstacleAt(b, q, r); if (terrainBlocksMove(t)) return { ok: false, reason: "Астероидное поле: непроходимо" };
  if (!isDeployZone(q, "player")) return { ok: false, reason: "Ставить можно только в 3 колонках слева" };
  if (stackAt(b, q, r)) return { ok: false, reason: "Гекс занят" };
  if (s.reserve && b.deploymentCount >= 7) return { ok: false, reason: "На поле уже 7 стэков — этот уйдёт в резерв" };
  s.q = q; s.r = r; s.reserve = false; recount(b); return { ok: true };
}
export function reserve(b: Battle, id: string): void { const s = b.stacks.find((x) => x.id === id); if (s && s.side === "player") { s.reserve = true; recount(b); } }
export function start(b: Battle): Battle {
  b.phase = "battle"; b.round = 1; for (const s of b.stacks) { s.hp = s.maxHp; s.shield = s.maxShield; s.alive = true; s.moved = s.waited = s.defended = s.counterUsed = false; }
  for (const s of b.stacks) s.startCount = s.count;
  b.order = b.stacks.filter((s) => s.alive && !s.reserve).sort((a, c) => c.init - a.init || (a.side === "enemy" ? -1 : 1)).map((s) => s.id); b.activeId = b.order[0] ?? null; log(b, "Бой начался. Раунд 1.", "system"); return b;
}
export const activeStack = (b: Battle): Stack | null => b.stacks.find((s) => s.id === b.activeId) ?? null;
export function reachable(b: Battle, id: string): Array<{ q: number; r: number }> {
  const s = b.stacks.find((x) => x.id === id); if (!s || !s.alive) return [];
  const out: Array<{ q: number; r: number }> = [];
  const queue: Array<{ q: number; r: number; c: number }> = [{ q: s.q, r: s.r, c: 0 }];
  const seen = new Map([[key(s.q, s.r), 0]]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.c > 0 && !stackAt(b, cur.q, cur.r)) out.push({ q: cur.q, r: cur.r });
    for (const n of neighbors(cur.q, cur.r)) {
      if (terrainBlocksMove(obstacleAt(b, n.q, n.r))) continue;
      const occ = stackAt(b, n.q, n.r);
      // сквозь союзника идти можно (финиш в занятом гексе запрещён), сквозь врага — нельзя
      if (occ && occ.side !== s.side) continue;
      const terr = obstacleAt(b, n.q, n.r);
      const c = cur.c + (terr === "gravity_anomaly" ? 2 : terr === "nebula" ? 2 : 1);
      if (c > s.mp) continue;
      if ((seen.get(key(n.q, n.r)) ?? 99) <= c) continue;
      seen.set(key(n.q, n.r), c); queue.push({ q: n.q, r: n.r, c });
    }
  }
  return out;
}
export function hasLos(b: Battle, a: { q: number; r: number }, t: { q: number; r: number }): boolean {
  if (distance(a, t) <= 1) return true;
  const cells = lineHexes(a, t);
  for (let i = 1; i < cells.length - 1; i++) { const c = cells[i]!; if (terrainBlocksLos(obstacleAt(b, c.q, c.r))) return false; }
  return true;
}
export function canAttack(b: Battle, a: Stack, t: Stack, ranged: boolean): { ok: boolean; reason?: string } {
  if (!t || !t.alive) return { ok: false, reason: "Нет цели" }; if (t.side === a.side) return { ok: false, reason: "Свой стэк" }; const d = distance(a, t);
  if (ranged) { if (a.range <= 1) return { ok: false, reason: "Нет дальней атаки" }; if (d > a.range) return { ok: false, reason: "Цель вне дальности" }; if (!hasLos(b, a, t)) return { ok: false, reason: "Нет LOS: туманность/астероиды" }; return { ok: true }; }
  return d === 1 ? { ok: true } : { ok: false, reason: "Цель не в контакте" };
}
export function preview(b: Battle, aid: string, tid: string, ranged: boolean): { min: number; max: number; counter: number; loseMin: number; loseMax: number } {
  const a = b.stacks.find((s) => s.id === aid), t = b.stacks.find((s) => s.id === tid); if (!a || !t) return { min: 0, max: 0, counter: 0, loseMin: 0, loseMax: 0 };
  const d = distance(a, t); const pb = ranged && d === 1 ? 0.5 : 1; const flank = !ranged && d === 1 ? 1.15 : 1; const base = a.dmg * a.count * pb * flank * (t.defended ? 0.8 : 1); const per = Math.max(1, perShipHp(t));
  const counterBase = !ranged && d === 1 ? Math.round(base * 0.5 * (t.defended ? 1.15 : 1)) : 0;
  return { min: Math.round(base * 0.9), max: Math.round(base * 1.15), counter: counterBase, loseMin: Math.floor((base * 0.9) / per), loseMax: Math.ceil((base * 1.15) / per) };
}
export function perShipHp(s: Stack): number { return s.maxHp / Math.max(1, s.startCount); }
/**
 * Единственная точка нанесения урона. HP — источник истины, count ВСЕГДА пересчитывается из HP.
 * Раньше count уменьшали на ceil(урон/прочность) и убивали стэк при count === 0 — юниты
 * гибли с 20-60% HP (в бою видно «уничтожен», хотя полоска HP ещё заполнена).
 */
export function applyDamage(s: Stack, raw: number): { damage: number; killed: boolean } {
  if (!s.alive || raw <= 0) return { damage: 0, killed: false };
  const dmg = Math.max(1, Math.round(raw));
  const absorbed = Math.min(s.shield, dmg);
  s.shield -= absorbed;
  s.hp = Math.max(0, s.hp - (dmg - absorbed));
  if (s.hp <= 0) { s.hp = 0; s.count = 0; s.alive = false; return { damage: dmg, killed: true }; }
  s.count = Math.max(1, Math.min(s.startCount, Math.ceil(s.hp / perShipHp(s))));
  s.damagedThisRound = true;
  return { damage: dmg, killed: false };
}
export function attack(b: Battle, aid: string, tid: string, ranged: boolean, advance = true, damageMult = 1): boolean {
  const a = b.stacks.find((s) => s.id === aid), t = b.stacks.find((s) => s.id === tid);
  if (!a || !t || !a.alive || !t.alive || a.side === t.side || !canAttack(b, a, t, ranged).ok) return false;
  const p = preview(b, aid, tid, ranged);
  const dmg = Math.max(1, Math.round(((p.min + p.max) / 2) * damageMult));
  const shieldBefore = t.shield;
  const hit = applyDamage(t, dmg);
  const absorbed = Math.max(0, Math.min(shieldBefore, hit.damage));
  a.kills += hit.damage;
  log(b, (a.side === "player" ? "Ваш " : "Враг: ") + CLASS_RU[a.cls] + " «" + a.name + "» → " + CLASS_RU[t.cls] + " «" + t.name + "»: " + hit.damage + " урона", "damage");
  b.lastDamage.push({ q: t.q, r: t.r, amount: hit.damage, t: Date.now() });
  b.lastEffects.push({ kind: absorbed > 0 ? "shield" : "attack", from: { q: a.q, r: a.r }, to: { q: t.q, r: t.r }, amount: hit.damage, shield: absorbed, t: Date.now() });
  if (hit.killed) log(b, CLASS_RU[t.cls] + " «" + t.name + "» уничтожен.", "death");
  else if (distance(a, t) === 1 && !t.counterUsed) {
    // 16b §4.4: ответ 1 раз за раунд — 100% урона в ближнем бою, 50% при стрельбе в упор.
    t.counterUsed = true;
    const ratio = ranged ? 0.5 : 1;
    const counter = Math.max(1, Math.round(hit.damage * ratio * (t.defended ? 1.15 : 1)));
    const back = applyDamage(a, counter);
    log(b, "Ответный удар: " + CLASS_RU[t.cls] + " «" + t.name + "» → " + CLASS_RU[a.cls] + " «" + a.name + "»: " + back.damage, "damage");
    if (back.killed) log(b, CLASS_RU[a.cls] + " «" + a.name + "» уничтожен.", "death");
  }
  if (!checkEnd(b) && advance) endTurn(b);
  return true;
}

export function attackObstacle(b: Battle, q: number, r: number): boolean {
  const a = activeStack(b); if (!a || a.side !== "player" || !a.alive) return false;
  // В бою v2 обстрел препятствия — обычное действие за 1 AP; нельзя путать с ходом v1 (endTurn),
  // иначе выстрел по астероиду завершал раунд и пропускал фазу противника.
  const v2 = Boolean(b.turnSide);
  if (v2 && (b.turnSide !== a.side || apOf(a) < 1)) return false;
  const idx = b.obstacles.findIndex((o) => o.q === q && o.r === r); if (idx < 0) return false;
  const o = b.obstacles[idx]!; if (o.kind !== "asteroid" && o.kind !== "debris") return false;
  o.maxHp = o.maxHp ?? (o.kind === "asteroid" ? 120 : 80); o.hp = o.hp ?? o.maxHp;
  const dmg = Math.round(a.dmg * a.count * 0.6); o.hp = Math.max(0, o.hp - dmg);
  b.lastDamage.push({ q, r, amount: dmg, t: Date.now() });
  b.lastEffects.push({ kind: "hit", from: { q: a.q, r: a.r }, to: { q, r }, amount: dmg, shield: 0, t: Date.now() });
  log(b, "Обстрел " + (o.kind === "asteroid" ? "астероида" : "обломков") + ": " + dmg + " урона", "damage");
  if (o.hp <= 0) { b.obstacles.splice(idx, 1); log(b, "Препятствие разрушено.", "system"); }
  if (v2) { spendAp(a, 1); b.activeId = a.id; } else endTurn(b);
  return true;
}
export function wait(b: Battle): void { const a = activeStack(b); if (!a || a.side !== "player" || a.waited) return; a.waited = true; const i = b.order.indexOf(a.id); if (i >= 0) { b.order.splice(i, 1); b.order.push(a.id); } log(b, "Ожидание: " + CLASS_RU[a.cls] + " «" + a.name + "»", "system"); advanceTurn(b); }
export function defend(b: Battle): void { const a = activeStack(b); if (!a) return; a.defended = true; log(b, CLASS_RU[a.cls] + " «" + a.name + "» защищается (+20%).", "system"); endTurn(b); }
export function ability(b: Battle): void { const a = activeStack(b); if (!a || a.mp < 1) return; a.mp -= 1; const t = b.stacks.find((s) => s.side !== a.side && s.alive && !s.reserve && distance(s, a) === 1); if (t) { const hit = applyDamage(t, Math.round(a.dmg * a.count * 1.4)); log(b, "Способность «Залп»: " + hit.damage + " урона по " + CLASS_RU[t.cls] + " «" + t.name + "»", "ability"); if (hit.killed) log(b, CLASS_RU[t.cls] + " «" + t.name + "» уничтожен.", "death"); } endTurn(b); }
export function apOf(s: Stack): number { return Math.max(0, s.ap ?? 2); }
export function fpOf(b: Battle, side: Side): number { return b.stacks.filter((s) => s.side === side && s.alive && !s.reserve).reduce((sum, s) => sum + s.hp, 0); }
export function startV2(b: Battle): Battle {
  const avgInit = (side: Side): number => {
    const list = b.stacks.filter((s) => s.side === side && !s.reserve);
    return list.length ? list.reduce((sum, s) => sum + s.init, 0) / list.length : 0;
  };
  const initA = avgInit("player"), initB = avgInit("enemy");
  const firstSide: Side = initA > initB ? "player" : initB > initA ? "enemy" : (hash(String(b.seed) + ":first-side") % 2 === 0 ? "player" : "enemy");
  b.phase = "battle"; b.round = 1; b.turnSide = firstSide; b.firstSide = firstSide; b.activeId = null; b.overwatch = {};
  for (const s of b.stacks) { s.hp = s.maxHp; s.shield = s.maxShield; s.alive = true; s.moved = false; s.waited = false; s.defended = false; s.counterUsed = false; s.ap = 2; s.attackedThisPhase = 0; s.movedThisPhase = false; s.damagedThisRound = false; }
  b.startFp = { player: fpOf(b, "player"), enemy: fpOf(b, "enemy") };
  for (const s of b.stacks) s.ap = 2;
  log(b, "Бой v2: первая фаза — " + (b.firstSide === "player" ? "игрок" : "противник") + ". У каждого юнита 2 AP.", "system");
  return b;
}
export function v2Cost(b: Battle, id: string, cost: number): boolean {
  const s = b.stacks.find((x) => x.id === id);
  if (!s || !s.alive || s.side !== b.turnSide || apOf(s) < cost) return false;
  s.ap = apOf(s) - cost; if (apOf(s) === 0) s.moved = true; return true;
}
function spendAp(s: Stack, cost: number): void { s.ap = Math.max(0, apOf(s) - cost); if (apOf(s) === 0) s.moved = true; }
export function v2Attack(b: Battle, aid: string, tid: string, ranged: boolean): boolean {
  const a = b.stacks.find((s) => s.id === aid), t = b.stacks.find((s) => s.id === tid);
  if (!a || !t || !a.alive || !t.alive || a.side !== b.turnSide || apOf(a) < 1) return false;
  const movedPenalty = ranged && a.movedThisPhase ? 0.75 : 1;
  const secondPenalty = (a.attackedThisPhase ?? 0) > 0 ? 0.85 : 1;
  if (!attack(b, aid, tid, ranged, false, movedPenalty * secondPenalty)) return false;
  b.activeId = aid; a.attackedThisPhase = (a.attackedThisPhase ?? 0) + 1; spendAp(a, 1); return true;
}

function overwatchReaction(b: Battle, mover: Stack): void {
  for (const shooter of b.stacks) {
    if (shooter.side === mover.side || !shooter.alive || !b.overwatch?.[shooter.id]) continue;
    if (!canAttack(b, shooter, mover, shooter.range > 1).ok) continue;
    const dmg = Math.max(1, Math.round(shooter.dmg * shooter.count * 0.75));
    const shieldBefore = mover.shield;
    const hit = applyDamage(mover, dmg);
    const absorbed = Math.max(0, Math.min(shieldBefore, hit.damage));
    b.lastEffects.push({ kind: "attack", from: { q: shooter.q, r: shooter.r }, to: { q: mover.q, r: mover.r }, amount: hit.damage, shield: absorbed, t: Date.now() });
    b.lastDamage.push({ q: mover.q, r: mover.r, amount: hit.damage, t: Date.now() });
    log(b, "Overwatch: " + CLASS_RU[shooter.cls] + " «" + shooter.name + "» → " + CLASS_RU[mover.cls] + " «" + mover.name + "»: " + hit.damage, "damage");
    b.overwatch![shooter.id] = false;
    if (hit.killed) { log(b, CLASS_RU[mover.cls] + " «" + mover.name + "» уничтожен.", "death"); checkEnd(b); }
    break;
  }
}
export function v2Move(b: Battle, id: string, q: number, r: number): boolean {
  const a = b.stacks.find((s) => s.id === id);
  if (!a || !a.alive || a.side !== b.turnSide || apOf(a) < 1) return false;
  if (!reachable(b, id).some((h) => h.q === q && h.r === r)) return false;
  const before = { q: a.q, r: a.r };
  a.q = q; a.r = r; b.activeId = id;
  b.lastEffects.push({ kind: "move", from: before, to: { q, r }, amount: 0, shield: 0, t: Date.now() });
  log(b, CLASS_RU[a.cls] + " «" + a.name + "»: движение", "move");
  if (obstacleAt(b, q, r) === "minefield" && a.alive) {
    const mine = Math.max(1, Math.round(a.maxHp * 0.08));
    const hit = applyDamage(a, mine);
    log(b, "Мины: " + hit.damage + " урона " + CLASS_RU[a.cls] + " «" + a.name + "»", "damage");
    if (hit.killed) { log(b, CLASS_RU[a.cls] + " «" + a.name + "» уничтожен.", "death"); checkEnd(b); }
  }
  spendAp(a, 1); a.movedThisPhase = true; overwatchReaction(b, a); return true;
}
export function v2Defend(b: Battle, id: string): boolean { const s = b.stacks.find((x) => x.id === id); if (!s || !s.alive || s.side !== b.turnSide || apOf(s) < 1) return false; s.defended = true; spendAp(s, 1); log(b, CLASS_RU[s.cls] + " «" + s.name + "» защищается.", "system"); return true; }
export function v2Overwatch(b: Battle, id: string): boolean { const s = b.stacks.find((x) => x.id === id); if (!s || !s.alive || s.side !== b.turnSide || apOf(s) < 2) return false; b.overwatch = { ...(b.overwatch ?? {}), [id]: true }; spendAp(s, 2); log(b, "Наблюдение: " + s.name, "system"); return true; }
export function v2EndPhase(b: Battle, expectedSide?: Side): void {
  if (b.phase !== "battle") return;
  if (expectedSide && b.turnSide && b.turnSide !== expectedSide) return;
  const first: Side = b.firstSide ?? "player";
  const second: Side = first === "player" ? "enemy" : "player";
  const closing: Side = b.turnSide ?? first;
  const burned = b.stacks.filter((s) => s.side === closing && s.alive && !s.reserve && apOf(s) > 0).reduce((n, s) => n + apOf(s), 0);
  if (burned > 0) log(b, (closing === "player" ? "Сожжено AP: " : "Сожжено AP противника: ") + burned, "system");
  if (closing !== second) {
    // первая фаза раунда окончена — ходит вторая сторона
    b.turnSide = second; b.activeId = null;
    for (const s of b.stacks) if (s.side === second) { s.ap = 2; s.attackedThisPhase = 0; s.movedThisPhase = false; }
    log(b, second === "player" ? "Фаза игрока." : "Фаза противника.", "system");
    return;
  }
  if (checkCapitulation(b)) return;
  // Конец раунда (16b §1.5): тик статусов, реген щита, сброс реакций/флагов.
  for (const s of b.stacks) {
    if (!s.alive) continue;
    s.ap = 2; s.defended = false; s.attackedThisPhase = 0; s.counterUsed = false; s.movedThisPhase = false;
    if (!s.damagedThisRound && s.shield < s.maxShield) s.shield = Math.min(s.maxShield, s.shield + Math.round(s.maxShield * 0.03));
    s.damagedThisRound = false;
  }
  b.overwatch = {};
  b.round += 1;
  if (b.round > b.maxRounds) {
    // 16b §8.2/§8.7: кап раундов — не «ничья», а решение по остатку сил.
    const pl = fpOf(b, "player"), en = fpOf(b, "enemy");
    log(b, "Кап раундов: решение по остатку сил.", "system");
    finish(b, pl > en ? "player" : en > pl ? "enemy" : "draw");
    return;
  }
  // 16b §1.3: кто ходил вторым в раунде — открывает следующий. Без этого одна сторона
  // всегда ходит первой и систематически проигрывает (первый ход = расход AP на сближение).
  const nextFirst: Side = second;
  b.firstSide = nextFirst; b.turnSide = nextFirst; b.activeId = null;
  log(b, "Раунд " + b.round + ". " + (nextFirst === "player" ? "Фаза игрока." : "Фаза противника."), "system");
}
/** 16b §8.1: капитуляция — перевес по живучести ≥70% и раунд ≥ 3. */
export function checkCapitulation(b: Battle): boolean {
  if (b.phase !== "battle" || b.round < 3 || !b.startFp) return false;
  const pl = fpOf(b, "player"), en = fpOf(b, "enemy");
  const plStart = Math.max(1, b.startFp.player), enStart = Math.max(1, b.startFp.enemy);
  if (en <= 0 || pl <= 0) return false;
  const plLost = 1 - pl / plStart, enLost = 1 - en / enStart;
  if (enLost - plLost >= 0.7 && enLost >= 0.7) { log(b, "Противник капитулирует.", "system"); finish(b, "player"); return true; }
  if (plLost - enLost >= 0.7 && plLost >= 0.7) { log(b, "Ваш флот вынужден отступить.", "system"); finish(b, "enemy"); return true; }
  return false;
}
/** Выбор цели: ближе, добить, добить раненого, убрать опасного. */
export function aiPickTarget(b: Battle, actor: Stack): Stack | null {
  const targets = b.stacks.filter((s) => s.side !== actor.side && s.alive && !s.reserve);
  if (!targets.length) return null;
  const score = (t: Stack): number => {
    const d = distance(actor, t);
    const killable = t.hp <= actor.dmg * actor.count * 1.1 ? -6 : 0;
    const wounded = t.hp / Math.max(1, t.maxHp);
    const threat = (t.dmg * t.count) / 1000;
    return d * 10 + killable + wounded * 4 - threat + (t.defended ? 2 : 0);
  };
  return targets.slice().sort((x, y) => score(x) - score(y) || x.id.localeCompare(y.id))[0] ?? null;
}
/** Один тактический шаг ИИ: атака (контакт/дальняя) → сближение → защита. true, если действие выполнено. */
export function aiAct(b: Battle, actor: Stack): boolean {
  if (b.phase !== "battle" || !actor.alive || actor.side !== b.turnSide || apOf(actor) < 1) return false;
  const target = aiPickTarget(b, actor);
  if (!target) return false;
  if (canAttack(b, actor, target, false).ok) return v2Attack(b, actor.id, target.id, false);
  if (canAttack(b, actor, target, true).ok) return v2Attack(b, actor.id, target.id, true);
  const spots = reachable(b, actor.id);
  if (spots.length) {
    const ranked = spots.map((h) => {
      const d = distance(h, target);
      const canMelee = d === 1;
      const canRanged = !canMelee && actor.range > 1 && d <= actor.range && hasLos(b, h, target);
      // 0 — стрелять с максимальной дистанции (без ответного удара), 1 — контакт, 2 — сближение
      return { h, grade: canRanged ? 0 : canMelee ? 1 : 2, d };
    }).sort((x, y) => {
      if (x.grade !== y.grade) return x.grade - y.grade;
      if (x.grade === 0) return y.d - x.d; // дальше = безопаснее
      return x.d - y.d;
    });
    const best = ranked[0]!;
    if (v2Move(b, actor.id, best.h.q, best.h.r)) return true;
  }
  if (apOf(actor) >= 2 && v2Overwatch(b, actor.id)) return true;
  if (v2Defend(b, actor.id)) return true;
  return false;
}
/** Действует текущая сторона, пока у её юнитов есть AP. Фазу не завершает. */
export function v2ActSide(b: Battle): Battle {
  let guard = 0;
  while (b.phase === "battle" && guard++ < 400) {
    const side = b.turnSide; if (!side) break;
    const actor = b.stacks.find((s) => s.side === side && s.alive && !s.reserve && apOf(s) > 0);
    if (!actor) break;
    if (!aiAct(b, actor)) actor.ap = 0;
  }
  return b;
}
/**
 * Фаза ИИ (кнопка «Завершить ход»): отыгрывает ВСЕ фазы противника подряд (при чередовании
 * первого хода их может быть две) и гарантированно возвращает управление игроку.
 */
export function v2AiPhase(b: Battle): Battle {
  if (b.phase !== "battle") return b;
  let guard = 0;
  while (b.phase === "battle" && b.turnSide === "enemy" && guard++ < 6) {
    v2ActSide(b);
    if (b.phase !== "battle") break;
    v2EndPhase(b);
  }
  return b;
}
/** Авто-бой: ОДИН и тот же ИИ за обе стороны — честный паритет, без «поддавков» одной из сторон. */
export function runAutoBattle(b: Battle): Battle {
  let guard = 0;
  while (b.phase === "battle" && guard++ < 400) {
    const side = b.turnSide;
    const hasAp = b.stacks.some((s) => s.side === side && s.alive && !s.reserve && apOf(s) > 0);
    if (!hasAp) v2EndPhase(b); else v2ActSide(b);
  }
  if (b.phase !== "result") finish(b, "draw");
  return b;
}
export function endTurn(b: Battle): void { const a = activeStack(b); if (a) a.moved = true; advanceTurn(b); }
function advanceTurn(b: Battle): void {
  if (b.phase !== "battle") return;
  const alive = new Set(b.stacks.filter((s) => s.alive && !s.reserve).map((s) => s.id)); b.order = b.order.filter((id) => alive.has(id) && id !== b.activeId);
  if (b.order.length === 0) { nextRound(b); return; } b.activeId = b.order[0]!; const a = activeStack(b); if (a) { a.moved = false; a.defended = false; }
}
function nextRound(b: Battle): void {
  b.round += 1; if (b.round > b.maxRounds) { finish(b, "draw"); return; }
  for (const s of b.stacks) { s.moved = s.waited = s.counterUsed = s.defended = false; s.mp = s.maxMp; s.shield = Math.min(s.maxShield, s.shield + Math.round(s.maxShield * 0.15)); }
  b.order = b.stacks.filter((s) => s.alive && !s.reserve).sort((a, c) => c.init - a.init).map((s) => s.id); b.activeId = b.order[0] ?? null; log(b, "Раунд " + b.round + ".", "system");
}
export function checkEnd(b: Battle): boolean { const p = b.stacks.some((s) => s.side === "player" && s.alive && !s.reserve), e = b.stacks.some((s) => s.side === "enemy" && s.alive && !s.reserve); if (p && e) return false; finish(b, p ? "player" : e ? "enemy" : "draw"); return true; }
export function lossFraction(b: Battle, side: Side): number {
  if (!b.startFp) return 0;
  const start = Math.max(1, b.startFp[side]);
  return Math.max(0, Math.min(1, 1 - fpOf(b, side) / start));
}
/** GDD §11.6 — та же формула, что у авторезолва sim: ожидаемые доли потерь от соотношения FP. */
export function autoResolveLossFraction(fpA: number, fpB: number): { a: number; b: number } {
  const ratio = fpA / Math.max(1, fpB);
  const clampM = (v: number): number => Math.max(0, Math.min(1000, Math.round(v)));
  if (ratio > 1.08) return { a: clampM(Math.max(20, Math.min(550, 550 * Math.pow(1 / ratio, 1.5)))) / 1000, b: clampM(Math.max(250, Math.min(950, 950 - 450 * (1 / ratio)))) / 1000 };
  if (ratio < 0.92) return { a: clampM(Math.max(250, Math.min(950, 950 - 450 * ratio))) / 1000, b: clampM(Math.max(20, Math.min(550, 550 * Math.pow(ratio, 1.5)))) / 1000 };
  return { a: 0.3, b: 0.3 };
}
export function finish(b: Battle, winner: Side | "draw"): void {
  if (b.phase === "result") return;
  b.phase = "result"; b.activeId = null;
  const losses: Loss[] = b.stacks.map((s) => {
    const lost = Math.max(0, Math.min(s.startCount, s.startCount - s.count));
    return { side: s.side, cls: s.cls, name: s.name, lost, fp: Math.max(0, s.maxHp - s.hp) };
  });
  const destroyed = b.stacks.filter((s) => !s.alive).reduce((a, s) => a + s.maxHp, 0);
  const mvp = b.stacks.slice().sort((a, c) => c.kills - a.kills || a.id.localeCompare(c.id))[0];
  const plLost = lossFraction(b, "player"), enLost = lossFraction(b, "enemy");
  const ref = b.startFp ? autoResolveLossFraction(b.startFp.player, b.startFp.enemy) : { a: 0, b: 0 };
  // «≈ авторезолв по потерям» считается из формулы авторезолва, а не подгоняется под факт (16e §5.4: скрытая коррекция запрещена).
  const expected = Math.round(((ref.a + ref.b) / 2) * 100);
  const actual = Math.round(((plLost + enLost) / 2) * 100);
  b.result = {
    winner, losses,
    spoils: { credits: Math.round(destroyed * 0.08), alloys: Math.round(destroyed * 0.05), samples: Math.round(destroyed * 0.005) },
    xp: Math.round((destroyed / 10) * (winner === "player" ? 1.2 : 0.5)),
    warScore: winner === "player" ? 10 : 0,
    mvpName: mvp ? CLASS_RU[mvp.cls] + " «" + mvp.name + "»" : "—",
    mvpDamage: mvp?.kills ?? 0,
    parity: { autoMin: Math.max(0, expected - 10), autoMax: Math.min(100, expected + 10), actual },
    seed: b.seed,
    lossFraction: { player: plLost, enemy: enLost },
  };
  log(b, winner === "player" ? "Победа!" : winner === "enemy" ? "Поражение." : "Ничья (истощение).", "system");
}
export function aiTurn(b: Battle): Battle {
  if (b.phase !== "battle") return b; const a = activeStack(b); if (!a || a.side !== "enemy") return b; const targets = b.stacks.filter((s) => s.side === "player" && s.alive && !s.reserve); if (targets.length === 0) { checkEnd(b); return b; }
  const adj = targets.find((t) => distance(a, t) === 1); if (adj) { attack(b, a.id, adj.id, false); return b; }
  const ranged = targets.find((t) => canAttack(b, a, t, true).ok); if (ranged) { attack(b, a.id, ranged.id, true); return b; }
  const target = [...targets].sort((x, y) => distance(a, x) - distance(a, y))[0]!; const spots = reachable(b, a.id).sort((x, y) => distance(x, target) - distance(y, target)); if (spots.length) { const fromPos = { q: a.q, r: a.r }; a.q = spots[0]!.q; a.r = spots[0]!.r; b.lastEffects.push({ kind: "move", from: fromPos, to: { q: a.q, r: a.r }, amount: 0, shield: 0, t: Date.now() }); log(b, "Враг: " + CLASS_RU[a.cls] + " «" + a.name + "» → q" + a.q + ",r" + a.r, "move"); const hit = targets.find((t) => distance(a, t) === 1); if (hit) attack(b, a.id, hit.id, false); else endTurn(b); } else endTurn(b); return b;
}
export function autoBattle(b: Battle): Battle {
  let guard = 0; while (b.phase === "battle" && guard++ < 500) { const a = activeStack(b); if (!a) break; if (a.side === "enemy") { aiTurn(b); continue; } const targets = b.stacks.filter((s) => s.side === "enemy" && s.alive && !s.reserve); if (targets.length === 0) break; const adj = targets.find((t) => distance(a, t) === 1); if (adj) { attack(b, a.id, adj.id, false); continue; } const target = [...targets].sort((x, y) => distance(a, x) - distance(a, y))[0]!; const spots = reachable(b, a.id).sort((x, y) => distance(x, target) - distance(y, target)); if (spots.length) { a.q = spots[0]!.q; a.r = spots[0]!.r; } const hit = targets.find((t) => distance(a, t) === 1); if (hit) attack(b, a.id, hit.id, false); else endTurn(b); }
  if (b.phase !== "result") finish(b, "draw"); return b;
}
export function moveActive(b: Battle, q: number, r: number): boolean {
  const a = activeStack(b); if (!a || a.side !== "player") return false; if (!reachable(b, a.id).some((h) => h.q === q && h.r === r)) return false;
  const from = "q" + a.q + ",r" + a.r; const fromPos = { q: a.q, r: a.r }; a.q = q; a.r = r; b.lastEffects.push({ kind: "move", from: fromPos, to: { q, r }, amount: 0, shield: 0, t: Date.now() }); log(b, CLASS_RU[a.cls] + " «" + a.name + "»: " + from + " → q" + q + ",r" + r, "move");
  if (obstacleAt(b, q, r) === "minefield") { const d = 30; a.hp = Math.max(0, a.hp - d); log(b, "Мины: " + d + " урона " + CLASS_RU[a.cls] + " «" + a.name + "»", "damage"); if (a.hp <= 0) a.alive = false; if (checkEnd(b)) return true; }
  endTurn(b); return true;
}