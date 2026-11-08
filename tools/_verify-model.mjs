import * as M from "../apps/web/src/ui/grid-battle/model.ts";

let fails = 0;
const ok = (cond, name, extra) => { if (!cond) { fails++; console.log("FAIL " + name + (extra ? " — " + extra : "")); } else console.log("PASS " + name + (extra ? " — " + extra : "")); };

// ---- 1. geometry invariants
const all = [];
for (let r = 0; r < 11; r++) for (let q = 0; q < 15; q++) all.push({ q, r });
const px = (a, b) => { const c1 = M.hexCenter(a.q, a.r), c2 = M.hexCenter(b.q, b.r); return Math.hypot(c1.x - c2.x, c1.y - c2.y); };
let bad = 0, asym = 0, badSym = 0, tri = 0;
for (const a of all) {
  for (const b of all) {
    const d = M.distance(a, b);
    const nb = M.neighbors(a.q, a.r).some((n) => n.q === b.q && n.r === b.r);
    if ((d === 1) !== nb) bad++;
    if (d !== M.distance(b, a)) badSym++;
    if (d === 1 && px(a, b) > 40) asym++;
  }
}
for (const a of all) for (const b of all) for (const c of all) if (M.distance(a, c) > M.distance(a, b) + M.distance(b, c)) tri++;
ok(bad === 0, "d=1 ⟺ neighbors", "mismatches=" + bad);
ok(badSym === 0, "distance symmetric", "violations=" + badSym);
ok(asym === 0, "every neighbour is a real pixel-neighbour", "liars=" + asym);
ok(tri === 0, "triangle inequality", "violations=" + tri);
ok(M.neighbors(0, 0).length === 3 && M.neighbors(7, 5).length === 6, "neighbour count by border", "corner=" + M.neighbors(0,0).length);

// ---- 2. no unit dies with HP left
const b0 = M.createMockBattle({ seed: 7 });
M.formation(b0, "line", "player"); M.startV2(b0);
const b1 = M.clone(b0);
for (let i = 0; i < 12 && b1.phase === "battle"; i++) { M.v2ActSide(b1); M.v2EndPhase(b1); if (b1.turnSide === "enemy") M.v2AiPhase(b1); }
const ghosts = b1.stacks.filter((s) => !s.alive && s.hp > 0);
ok(ghosts.length === 0, "no stack dies with HP left", JSON.stringify(ghosts.map((g) => g.id + ":" + g.hp)));
// count must always equal ceil(hp/perShip)
const desync = b1.stacks.filter((s) => s.alive && s.count !== Math.max(1, Math.min(s.startCount, Math.ceil(s.hp / (s.maxHp / Math.max(1, s.startCount))))));
ok(desync.length === 0, "count always derived from HP", JSON.stringify(desync.map((g) => g.id)));

// ---- 3. enemy phase actually attacks (player does nothing)
for (const seed of [7, 42, 3, 11, 5]) {
  const b = M.createMockBattle({ seed });
  M.formation(b, "line", "player"); M.startV2(b);
  const hp0 = M.fpOf(b, "player");
  const attackers = new Set();
  for (let round = 0; round < 2; round++) {
    M.v2EndPhase(b);              // -> enemy
    const logStart = b.log.length;
    M.v2AiPhase(b);               // full enemy phase, returns control
    for (const e of b.log.slice(logStart)) {
      if (e.kind === "damage" && e.text.startsWith("Враг:")) {
        const m = e.text.match(/«([^»]+)»/); if (m) attackers.add(m[1]);
      }
    }
  }
  const dmg = hp0 - M.fpOf(b, "player");
  ok(dmg > 0 && attackers.size >= 2, "seed " + seed + ": enemy phase attacks with several units", "damage=" + dmg + " attackers=" + attackers.size + " round=" + b.round);
}

// ---- 4. retaliation resets every round
{
  const b = M.createMockBattle({ seed: 7 });
  M.formation(b, "line", "player"); M.startV2(b);
  // bring a player and enemy unit adjacent artificially
  const p = b.stacks.find((s) => s.side === "player")!, e = b.stacks.find((s) => s.side === "enemy")!;
  p.q = 6; p.r = 5; e.q = 7; e.r = 5;
  const round1 = M.v2Attack(b, p.id, e.id, false);
  ok(round1 && e.counterUsed === true, "round 1: defender counter-attacks", "attacked=" + round1);
  M.v2EndPhase(b); // -> enemy phase
  M.v2EndPhase(b); // -> next round
  ok(e.counterUsed === false, "counter reset after round end", "counterUsed=" + e.counterUsed);
}

// ---- 5. reachable: ally pass-through allowed, finish on occupied forbidden
{
  const b = M.createMockBattle({ seed: 7 });
  M.formation(b, "line", "player"); M.startV2(b);
  const p2 = b.stacks.find((s) => s.id === "p2")!, p4 = b.stacks.find((s) => s.id === "p4")!;
  const spots = M.reachable(b, p2.id);
  ok(!spots.some((h) => h.q === p4.q && h.r === p4.r), "cannot finish move on occupied hex");
  const far = spots.some((h) => M.distance(h, p2) >= 3);
  ok(far, "can move around allies", "maxDist=" + Math.max(...spots.map((h) => M.distance(h, p2))));
}

// ---- 6. auto battle: fair, terminates, consistent
{
  const results = { player: 0, enemy: 0, draw: 0 };
  const rounds = [];
  let hang = false;
  for (let seed = 1; seed <= 20; seed++) {
    const b = M.createMockBattle({ seed });
    M.formation(b, "line", "player"); M.startV2(b);
    const t0 = Date.now();
    M.runAutoBattle(b);
    const ms = Date.now() - t0;
    if (ms > 2000) hang = true;
    const r = b.result!;
    results[r.winner as "player" | "enemy" | "draw"]++;
    rounds.push(r.durationRounds ?? 0);
    if (r.winner === "player" && M.fpOf(b, "enemy") > 0) { fails++; console.log("FAIL winner player but enemies alive"); break; }
    if (r.winner === "enemy" && M.fpOf(b, "player") > 0) { fails++; console.log("FAIL winner enemy but players alive"); break; }
  }
  console.log("auto-battle 20 seeds:", JSON.stringify(results), "hang=" + hang);
  ok(results.player > 0 && results.enemy > 0, "auto-battle is not 100/0 (mirrored rosters + same AI)");
  console.log("result rounds:", rounds.join(","));
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : "\n" + fails + " CHECK(S) FAILED");
if (fails > 0) process.exitCode = 1;
