import * as M from "../apps/web/src/ui/grid-battle/model.ts";

// 1) adjacency symmetry + distance consistency vs true pixel geometry
const all = [];
for (let r = 0; r < 11; r++) for (let q = 0; q < 15; q++) all.push({ q, r });
const centerOf = (h) => M.hexCenter(h.q, h.r);

// ground truth adjacency: nearest centers (centre distance < 34px => adjacent)
let mismatchN = 0, mismatchD = 0, examples = [];
for (const a of all) for (const b of all) {
  if (a.q === b.q && a.r === b.r) continue;
  const ca = centerOf(a), cb = centerOf(b);
  const px = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  const trueAdj = px < 34; // neighbour centres are ~32px or ~31.8px apart
  const nb = M.neighbors(a.q, a.r).some((n) => n.q === b.q && n.r === b.r);
  const d = M.distance(a, b);
  if (trueAdj !== nb) { mismatchN++; if (examples.length < 12) examples.push({ a, b, px: +px.toFixed(1), trueAdj, neighborsHas: nb }); }
  if ((d === 1) !== trueAdj) mismatchD++;
}
console.log("neighbors() mismatches vs pixel geometry:", mismatchN);
console.log("distance()==1 mismatches vs pixel geometry:", mismatchD);
console.log("examples:", JSON.stringify(examples, null, 1));

// 2) symmetry of neighbors & distance
let asym = 0;
for (const a of all) for (const n of M.neighbors(a.q, a.r)) {
  if (!M.neighbors(n.q, n.r).some((x) => x.q === a.q && x.r === a.r)) asym++;
}
console.log("neighbors() asymmetry count:", asym);

// 3) is distance a metric? triangle inequality + symmetry
let tri = 0, sym = 0;
for (const a of all) for (const b of all) for (const c of all) {
  if (M.distance(a, c) > M.distance(a, b) + M.distance(b, c)) tri++;
}
for (const a of all) for (const b of all) if (M.distance(a, b) !== M.distance(b, a)) sym++;
console.log("distance triangle violations:", tri, "symmetry violations:", sym);

// 4) reachable() should only produce hexes at distance >= 1 and reachable via adjacency
const b = M.createMockBattle({ seed: 42 });
M.formation(b, "line", "player");
M.startV2(b);
const s = b.stacks.find((x) => x.side === "player" && x.id === "p4");
const reach = M.reachable(b, s.id);
const bad = reach.filter((h) => M.distance(s, h) === 0);
console.log("stack", s.id, "at", s.q + "," + s.r, "reachable:", reach.length, "zero-dist:", bad.length);
console.log("reachable hexes with pixel distance > 40 from origin (jumps):", reach.filter((h) => { const a = M.hexCenter(s.q, s.r), c = M.hexCenter(h.q, h.r); return true; }).length);
const jumps = reach.filter((h) => {
  // is there a path of adjacent (pixel-adjacent) steps within reachable set?
  const set = new Set(reach.map((x) => x.q + "," + x.r)); set.add(s.q + "," + s.r);
  const seen = new Set([s.q + "," + s.r]); const stack = [{ q: s.q, r: s.r }];
  while (stack.length) { const cur = stack.pop(); for (const n of M.neighbors(cur.q, cur.r)) { const k = n.q + "," + n.r; if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(n); } } }
  return !seen.has(h.q + "," + h.r);
});
console.log("unreachable-via-adjacency inside reachable() set:", jumps.length, JSON.stringify(jumps.slice(0, 6)));
