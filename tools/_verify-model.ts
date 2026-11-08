import * as M from "../apps/web/src/ui/grid-battle/model.ts";

let fails = 0;
const ok = (cond: boolean, name: string, extra?: string) => { if (!cond) { fails++; console.log("FAIL " + name + (extra ? " — " + extra : "")); } else console.log("PASS " + name + (extra ? " — " + extra : "")); };

const all: Array<{ q: number; r: number }> = [];
for (let r = 0; r < 11; r++) for (let q = 0; q < 15; q++) all.push({ q, r });
const px = (a: { q: number; r: number }, b: { q: number; r: number }): number => { const c1 = M.hexCenter(a.q, a.r), c2 = M.hexCenter(b.q, b.r); return Math.hypot(c1.x - c2.x, c1.y - c2.y); };
let bad = 0, badSym = 0, asym = 0, tri = 0;
for (const a of all) for (const b of all) {
  const d = M.distance(a, b);
  const nb = M.neighbors(a.q, a.r).some((n) => n.q === b.q && n.r === b.r);
  if ((d === 1) !== nb) bad++;
  if (d !== M.distance(b, a)) badSym++;
  if (d === 1 && px(a, b) > 40) asym++;
}
for (const a of all) for (const b of all) for (const c of all) if (M.distance(a, c) > M.distance(a, b) + M.distance(b, c)) tri++;
ok(bad === 0, "d=1 ⟺ neighbors", "mismatches=" + bad);
ok(badSym === 0, "distance symmetric", "violations=" + badSym);
ok(asym === 0, "every neighbour is a real pixel-neighbour", "liars=" + asym);
ok(tri === 0, "triangle inequality", "violations=" + tri);
ok(M.neighbors(0, 0).length === 2 && M.neighbors(7, 5).length === 6, "neighbour count by border", "corner=" + M.neighbors(0, 0).length);

// no ghosts / no hp-count desync over a long AI-vs-AI game
{
  const b = M.createMockBattle({ seed: 7 }); M.formation(b, "line", "player"); M.startV2(b); M.runAutoBattle(b);
  const ghosts = b.stacks.filter((s) => !s.alive && s.hp > 0);
  ok(ghosts.length === 0, "no stack dies with HP left", JSON.stringify(ghosts.map((g) => g.id + ":" + g.hp)));
  const desync = b.stacks.filter((s) => s.alive && s.count !== Math.max(1, Math.min(s.startCount, Math.ceil(s.hp / (s.maxHp / Math.max(1, s.startCount))))));
  ok(desync.length === 0, "count always derived from HP", JSON.stringify(desync.map((g) => g.id)));
}

// player clicks "end turn" repeatedly and never acts: the AI must fight, not just shuffle
for (const seed of [7, 42, 3, 11, 5]) {
  const b = M.createMockBattle({ seed }); M.formation(b, "line", "player"); M.startV2(b);
  const hp0 = M.fpOf(b, "player"); const attackers = new Set<string>();
  for (let step = 0; step < 8 && b.phase === "battle"; step++) {
    if (b.turnSide === "player") { M.v2EndPhase(b); continue; }
    const start = b.log.length; M.v2AiPhase(b);
    for (const e of b.log.slice(start)) if (e.kind === "damage" && e.text.startsWith("Враг:")) { const m = e.text.match(/«([^»]+)»/); if (m && m[1]) attackers.add(m[1]); }
  }
  const dmg = hp0 - M.fpOf(b, "player");
  ok(dmg > 0 && attackers.size >= 3, "seed " + seed + ": enemy attacks with many units while player idles", "damage=" + dmg + " attackers=" + attackers.size + " round=" + b.round + " phase=" + b.phase);
  ok(!b.stacks.some((s) => s.side === "enemy" && !s.alive && s.hp > 0), "no ghost enemy stacks");
}

// retaliation: once per round, 100% melee / 50% point-blank
{
  const b = M.createMockBattle({ seed: 7 }); M.formation(b, "line", "player"); M.startV2(b);
  const p = b.stacks.find((s) => s.side === "player")!, e = b.stacks.find((s) => s.side === "enemy")!;
  p.q = 6; p.r = 5; e.q = 7; e.r = 5;
  const hpBefore = p.hp;
  ok(M.v2Attack(b, p.id, e.id, false) && e.counterUsed, "round 1: defender counter-attacks");
  const counterDmg = hpBefore - p.hp;
  ok(counterDmg > 0, "counter actually damages the attacker", "dmg=" + counterDmg);
  M.v2EndPhase(b); // -> enemy
  M.v2AiPhase(b); // full enemy phase(s) -> back to player, new round
  ok(e.counterUsed === false, "counter resets after the round", "phase=" + b.phase + " round=" + b.round);
}

// movement rules
{
  const b = M.createMockBattle({ seed: 7 }); M.formation(b, "line", "player"); M.startV2(b);
  const p2 = b.stacks.find((s) => s.id === "p2")!, p4 = b.stacks.find((s) => s.id === "p4")!;
  const spots = M.reachable(b, p2.id);
  ok(!spots.some((h) => h.q === p4.q && h.r === p4.r), "cannot finish move on occupied hex");
  ok(spots.some((h) => M.distance(h, p2) >= 3), "can move around allies", "maxDist=" + Math.max(...spots.map((h) => M.distance(h, p2))));
}

// auto battle: fair, terminates, consistent, both sides can win
{
  const results: Record<string, number> = { player: 0, enemy: 0, draw: 0 };
  const rounds: number[] = []; let slow = false; let inconsistent = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const b = M.createMockBattle({ seed }); M.formation(b, "line", "player"); M.startV2(b);
    const t0 = Date.now(); M.runAutoBattle(b); if (Date.now() - t0 > 2000) slow = true;
    const r = b.result!;
    results[r.winner] = (results[r.winner] ?? 0) + 1;
    rounds.push(b.round);
    if (b.phase !== "result") inconsistent++;
    // winner must be decided by annihilation OR capitulation (loser may keep damaged units)
    if (r.winner === "player" && M.fpOf(b, "enemy") >= M.fpOf(b, "player")) inconsistent++;
    if (r.winner === "enemy" && M.fpOf(b, "player") >= M.fpOf(b, "enemy")) inconsistent++;
  }
  console.log("auto-battle 60 mirrored seeds:", JSON.stringify(results), "slow=" + slow, "inconsistent=" + inconsistent);
  console.log("rounds:", rounds.join(","));
  ok(inconsistent === 0, "winner agrees with remaining strength");
  ok((results.player ?? 0) >= 10 && (results.enemy ?? 0) >= 10, "auto-battle not lopsided (mirrored rosters + shared AI)", JSON.stringify(results));
  ok(!slow, "auto-battle is fast");
}
console.log(fails === 0 ? "\nALL CHECKS PASSED" : "\n" + fails + " CHECK(S) FAILED");
if (fails > 0) process.exitCode = 1;
