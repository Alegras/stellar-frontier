import * as M from "../apps/web/src/ui/grid-battle/model.ts";
const all = [];
for (let r = 0; r < 11; r++) for (let q = 0; q < 15; q++) all.push({ q, r });
const px = (a, b) => { const c1 = M.hexCenter(a.q, a.r), c2 = M.hexCenter(b.q, b.r); return Math.hypot(c1.x - c2.x, c1.y - c2.y); };

let meleePhantom = [], meleeMissing = [];
for (const a of all) for (const b of all) {
  if (a === b) continue;
  const d = M.distance(a, b);
  const trueAdj = px(a, b) < 34;
  if (d === 1 && !trueAdj) meleePhantom.push([a, b, +px(a, b).toFixed(1)]);
  if (d !== 1 && trueAdj) meleeMissing.push([a, b]);
}
console.log("melee attacks allowed across NON-adjacent hexes:", meleePhantom.length, JSON.stringify(meleePhantom.slice(0,4)));
console.log("melee attacks DENIED between truly adjacent hexes:", meleeMissing.length, JSON.stringify(meleeMissing.slice(0,4)));

// reachable() teleports: is every reachable hex connected to origin via truly-adjacent steps inside the set?
const b = M.createMockBattle({ seed: 42 });
M.formation(b, "line", "player");
M.startV2(b);
for (const id of ["p1","p2","p4"]) {
  const s = b.stacks.find((x) => x.id === id);
  const reach = M.reachable(b, id);
  const set = new Set(reach.map((h) => h.q + "," + h.r)); set.add(s.q + "," + s.r);
  const seen = new Set([s.q + "," + s.r]); const st = [{ q: s.q, r: s.r }];
  while (st.length) { const cur = st.pop(); for (const n of all) { const k = n.q + "," + n.r; if (!set.has(k) || seen.has(k)) continue; if (px(cur, n) < 34) { seen.add(k); st.push(n); } } }
  const jumps = reach.filter((h) => !seen.has(h.q + "," + h.r));
  console.log(id, "at", s.q + "," + s.r, "mp", s.mp, "reachable", reach.length, "| teleport-jumps:", jumps.length, JSON.stringify(jumps.slice(0,5)));
  // how far can it actually go in one move?
  console.log("   max pixel distance from origin:", Math.max(...reach.map((h) => px(s, h))).toFixed(0), "px");
}
