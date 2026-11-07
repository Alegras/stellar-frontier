/** task-62 · M5b «Сетка командования» — UI-модель на мок-данных с battle-контентом @sf/data (адаптер battle-grid позже). */
import { BATTLE_CLASS_BY_ID, BATTLE_TERRAIN_BY_ID } from "@sf/data";
export type Side = "player" | "enemy";
export type Phase = "deploy" | "battle" | "result";
export type Cls = "corvette" | "frigate" | "destroyer" | "cruiser" | "battleship" | "titan" | "carrier" | "colossus";
export type Terrain = "void" | "asteroid" | "nebula" | "debris" | "minefield" | "gravity_anomaly";
export type Formation = "line" | "wedge" | "echelon" | "guard";

export interface Stack { id: string; side: Side; cls: Cls; name: string; count: number; startCount: number; hp: number; maxHp: number; shield: number; maxShield: number; mp: number; maxMp: number; init: number; dmg: number; range: number; q: number; r: number; facing: number; reserve: boolean; alive: boolean; moved: boolean; waited: boolean; defended: boolean; counterUsed: boolean; kills: number; abilities?: string[] }
export interface Obstacle { q: number; r: number; kind: Terrain }
export interface LogEntry { round: number; text: string; kind: "damage" | "ability" | "system" | "death" | "move" }
export interface Loss { side: Side; cls: Cls; name: string; lost: number; fp: number }
export interface Result { winner: Side | "draw"; losses: Loss[]; spoils: { credits: number; alloys: number; samples: number }; xp: number; warScore: number; mvpName: string; mvpDamage: number; parity: { autoMin: number; autoMax: number; actual: number }; seed: number }
export interface BattleEffect { kind: "attack" | "hit" | "shield" | "move" | "death"; from: { q: number; r: number }; to: { q: number; r: number }; amount: number; shield: number; t: number; }
export interface Battle { id: string; seed: number; title: string; systemName: string; phase: Phase; coop: boolean; round: number; maxRounds: number; timerSec: number | null; stacks: Stack[]; obstacles: Obstacle[]; cursor: { q: number; r: number }; hover: { q: number; r: number } | null; activeId: string | null; order: string[]; log: LogEntry[]; result: Result | null; preset: Formation; deploymentCount: number; reserveCount: number; lastDamage: Array<{ q: number; r: number; amount: number; t: number }>; lastEffects: BattleEffect[] }

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
export function distance(a: { q: number; r: number }, b: { q: number; r: number }): number { const ax = a.q, az = a.r, ay = -ax - az, bx = b.q, bz = b.r, by = -bx - bz; return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) >> 1; }
export function neighbors(q: number, r: number): Array<{ q: number; r: number }> {
  const odd = r & 1; const dirs = odd ? [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]] : [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]];
  return dirs.map(([dq, dr]) => ({ q: q + dq, r: r + dr })).filter((h) => h.q >= 0 && h.q < COLS && h.r >= 0 && h.r < ROWS);
}
export function hexCenter(q: number, r: number): { x: number; y: number } { return { x: 28 + q * 32 + (r & 1) * 16, y: 26 + r * 27 }; }
export function pixelToHex(x: number, y: number): { q: number; r: number } { let best = { q: 0, r: 0, d: 1e9 }; for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) { const c = hexCenter(q, r), d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < best.d) best = { q, r, d }; } return { q: best.q, r: best.r }; }
export const isDeployZone = (q: number, side: Side, tactician = false): boolean => side === "player" ? q <= (tactician ? 3 : 2) : q >= (tactician ? 11 : 12);
export const terrainBlocksMove = (t: Terrain): boolean => t === "asteroid";
export const terrainBlocksLos = (t: Terrain): boolean => t === "asteroid" || t === "nebula";
export const obstacleAt = (b: Battle, q: number, r: number): Terrain => b.obstacles.find((o) => o.q === q && o.r === r)?.kind ?? "void";
export const stackAt = (b: Battle, q: number, r: number): Stack | null => b.stacks.find((s) => !s.reserve && s.alive && s.q === q && s.r === r) ?? null;

function makeStack(side: Side, cls: Cls, i: number, seed: number): Stack {
  const st = STATS[cls]; const h = hash(side + cls + i + seed); const count = Math.max(1, st.n + ((h % 3) - 1));
  return { id: (side === "player" ? "p" : "e") + (i + 1), side, cls, name: (side === "player" ? P_NAMES : E_NAMES)[i % 10]!, count, startCount: count, hp: count * st.hp, maxHp: count * st.hp, shield: count * 24, maxShield: count * 24, mp: st.mp, maxMp: st.mp, init: st.init, dmg: st.dmg, range: st.range, q: 0, r: i, facing: side === "player" ? 0 : 3, reserve: false, alive: true, moved: false, waited: false, defended: false, counterUsed: false, kills: 0 };
}
export function createMockBattle(opts: { seed?: number; systemName?: string; coop?: boolean } = {}): Battle {
  const seed = opts.seed ?? 42; const stacks: Stack[] = [];
  const cls = CLASS_ORDER.slice(0, 7);
  for (let i = 0; i < 7; i++) stacks.push(makeStack("player", cls[i]!, i, seed));
  for (let i = 0; i < 7; i++) stacks.push(makeStack("enemy", cls[(i + 3) % 7]!, i, seed + 1));
  const rnd = rngOf(hash("field" + seed)); const obstacles: Obstacle[] = [];
  for (const kind of ["asteroid", "asteroid", "nebula", "nebula", "minefield", "gravity_anomaly", "debris"] as Terrain[]) {
    for (let t = 0; t < 20; t++) { const q = 4 + Math.floor(rnd() * 7), r = Math.floor(rnd() * ROWS); if (obstacles.some((o) => o.q === q && o.r === r)) continue; obstacles.push({ q, r, kind }); break; }
  }
  const b: Battle = { id: "btl_" + seed, seed, title: "Сетка командования", systemName: opts.systemName ?? "Вега-II", phase: "deploy", coop: Boolean(opts.coop), round: 0, maxRounds: 30, timerSec: opts.coop ? 90 : null, stacks, obstacles, cursor: { q: 1, r: 5 }, hover: null, activeId: null, order: [], log: [{ round: 0, kind: "system", text: "Расстановка: 7 стэков на поле, 3 в резерве." }], result: null, preset: "line", deploymentCount: 0, reserveCount: 0, lastDamage: [], lastEffects: [] };
  formation(b, "line", "player"); formation(b, "wedge", "enemy"); return b;
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
  const s = b.stacks.find((x) => x.id === id); if (!s) return []; const out: Array<{ q: number; r: number }> = []; const q: Array<{ q: number; r: number; c: number }> = [{ q: s.q, r: s.r, c: 0 }]; const seen = new Map([[key(s.q, s.r), 0]]);
  while (q.length) { const cur = q.shift()!; if (cur.c > 0) out.push({ q: cur.q, r: cur.r }); for (const n of neighbors(cur.q, cur.r)) { if (terrainBlocksMove(obstacleAt(b, n.q, n.r)) || stackAt(b, n.q, n.r)) continue; const c = cur.c + (obstacleAt(b, n.q, n.r) === "gravity_anomaly" ? 2 : 1); if (c > s.mp) continue; if ((seen.get(key(n.q, n.r)) ?? 99) <= c) continue; seen.set(key(n.q, n.r), c); q.push({ q: n.q, r: n.r, c }); } }
  return out;
}
export function hasLos(b: Battle, a: { q: number; r: number }, t: { q: number; r: number }): boolean { const n = distance(a, t); if (n <= 1) return true; for (let i = 1; i < n; i++) { const f = i / n; const q = Math.round(a.q + (t.q - a.q) * f), r = Math.round(a.r + (t.r - a.r) * f); if (terrainBlocksLos(obstacleAt(b, q, r))) return false; } return true; }
export function canAttack(b: Battle, a: Stack, t: Stack, ranged: boolean): { ok: boolean; reason?: string } {
  if (!t || !t.alive) return { ok: false, reason: "Нет цели" }; if (t.side === a.side) return { ok: false, reason: "Свой стэк" }; const d = distance(a, t);
  if (ranged) { if (a.range <= 1) return { ok: false, reason: "Нет дальней атаки" }; if (d > a.range) return { ok: false, reason: "Цель вне дальности" }; if (!hasLos(b, a, t)) return { ok: false, reason: "Нет LOS: туманность/астероиды" }; return { ok: true }; }
  return d === 1 ? { ok: true } : { ok: false, reason: "Цель не в контакте" };
}
export function preview(b: Battle, aid: string, tid: string, ranged: boolean): { min: number; max: number; counter: number; loseMin: number; loseMax: number } {
  const a = b.stacks.find((s) => s.id === aid), t = b.stacks.find((s) => s.id === tid); if (!a || !t) return { min: 0, max: 0, counter: 0, loseMin: 0, loseMax: 0 };
  const d = distance(a, t); const pb = ranged && d === 1 ? 0.5 : 1; const flank = !ranged && d === 1 ? 1.15 : 1; const base = a.dmg * a.count * pb * flank * (t.defended ? 0.8 : 1); const per = Math.max(1, t.maxHp / t.count);
  return { min: Math.round(base * 0.9), max: Math.round(base * 1.15), counter: !ranged && d === 1 ? Math.round(base * 0.5 * (t.defended ? 1.15 : 1)) : 0, loseMin: Math.floor(base * 0.9 / per), loseMax: Math.ceil(base * 1.15 / per) };
}
export function attack(b: Battle, aid: string, tid: string, ranged: boolean): boolean {
  const a = b.stacks.find((s) => s.id === aid), t = b.stacks.find((s) => s.id === tid); if (!a || !t || !canAttack(b, a, t, ranged).ok) return false;
  const p = preview(b, aid, tid, ranged); const dmg = Math.round((p.min + p.max) / 2); const sh = Math.min(t.shield, dmg); t.shield -= sh; const hull = dmg - sh; t.hp = Math.max(0, t.hp - hull); const perShip = t.maxHp / Math.max(1, t.count); t.count = Math.max(0, t.count - Math.min(t.count, Math.ceil(hull / Math.max(1, perShip)))); a.kills += dmg;
  log(b, (a.side === "player" ? "Ваш " : "Враг: ") + CLASS_RU[a.cls] + " «" + a.name + "» → " + CLASS_RU[t.cls] + " «" + t.name + "»: " + dmg + " урона", "damage"); b.lastDamage.push({ q: t.q, r: t.r, amount: dmg, t: Date.now() });
  b.lastEffects.push({ kind: sh > 0 ? "shield" : "attack", from: { q: a.q, r: a.r }, to: { q: t.q, r: t.r }, amount: dmg, shield: sh, t: Date.now() });
  if (t.hp <= 0 || t.count <= 0) { t.alive = false; log(b, CLASS_RU[t.cls] + " «" + t.name + "» уничтожен.", "death"); }
  else if (!ranged && !t.counterUsed) { t.counterUsed = true; const c = Math.round(dmg * 0.5 * (t.defended ? 1.15 : 1)); const cs = Math.min(a.shield, c); a.shield -= cs; a.hp = Math.max(0, a.hp - (c - cs)); if (a.hp <= 0) { a.alive = false; a.count = 0; } log(b, "Ответный удар: " + CLASS_RU[t.cls] + " «" + t.name + "» → " + c, "damage"); }
  if (!checkEnd(b)) endTurn(b); return true;
}
export function wait(b: Battle): void { const a = activeStack(b); if (!a || a.side !== "player" || a.waited) return; a.waited = true; const i = b.order.indexOf(a.id); if (i >= 0) { b.order.splice(i, 1); b.order.push(a.id); } log(b, "Ожидание: " + CLASS_RU[a.cls] + " «" + a.name + "»", "system"); advanceTurn(b); }
export function defend(b: Battle): void { const a = activeStack(b); if (!a) return; a.defended = true; log(b, CLASS_RU[a.cls] + " «" + a.name + "» защищается (+20%).", "system"); endTurn(b); }
export function ability(b: Battle): void { const a = activeStack(b); if (!a || a.mp < 1) return; a.mp -= 1; const t = b.stacks.find((s) => s.side !== a.side && s.alive && !s.reserve && distance(s, a) === 1); if (t) { const d = Math.round(a.dmg * a.count * 1.4); t.hp = Math.max(0, t.hp - d); t.count = Math.max(0, t.count - 1); log(b, "Способность «Залп»: " + d + " урона по " + CLASS_RU[t.cls] + " «" + t.name + "»", "ability"); if (t.hp <= 0 || t.count <= 0) t.alive = false; } endTurn(b); }
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
export function finish(b: Battle, winner: Side | "draw"): void {
  b.phase = "result"; b.activeId = null;
  const losses: Loss[] = b.stacks.map((s) => {
    const lost = Math.max(0, Math.min(s.startCount, Math.round((s.maxHp - s.hp) / Math.max(1, s.maxHp / Math.max(1, s.startCount)))));
    return { side: s.side, cls: s.cls, name: s.name, lost, fp: Math.max(0, s.maxHp - s.hp) };
  });
  const destroyed = b.stacks.filter((s) => !s.alive).reduce((a, s) => a + s.maxHp, 0); const mvp = [...b.stacks].sort((a, c) => c.kills - a.kills)[0];
  b.result = { winner, losses, spoils: { credits: Math.round(destroyed * 0.08), alloys: Math.round(destroyed * 0.05), samples: Math.round(destroyed * 0.005) }, xp: Math.round(destroyed / 10 * (winner === "player" ? 1.2 : 0.5)), warScore: winner === "player" ? 10 : 0, mvpName: mvp ? CLASS_RU[mvp.cls] + " «" + mvp.name + "»" : "—", mvpDamage: mvp?.kills ?? 0, parity: (() => { const actual = Math.round(losses.reduce((a, l) => a + l.fp, 0) / Math.max(1, b.stacks.reduce((a, s) => a + s.maxHp, 0)) * 100); return { autoMin: Math.max(0, actual - 5), autoMax: Math.min(100, actual + 5), actual }; })(), seed: b.seed };
  const actualPct = Math.round(losses.reduce((a, l) => a + l.fp, 0) / Math.max(1, b.stacks.reduce((a, s) => a + s.maxHp, 0)) * 100);
  b.result.parity = { autoMin: Math.max(0, actualPct - 4), autoMax: Math.min(100, actualPct + 4), actual: actualPct };
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