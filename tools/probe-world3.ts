import { createWorld, tick, serializeWorld, deserializeWorld } from "../packages/sim/src/index.ts";
import { MODE, BALANCE } from "../packages/data/src/index.ts";

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const t0 = performance.now();
const a = createWorld(777, MODE, BALANCE);
for (let i = 0; i < 300; i++) tick(a);
const ms = performance.now() - t0;
const sa = serializeWorld(a);
const b = createWorld(777, MODE, BALANCE);
for (let i = 0; i < 300; i++) tick(b);
const sb = serializeWorld(b);
console.log("determinism 300 ticks:", sa === sb, "hash:", hash(sa), "ms:", ms.toFixed(0), "ms/tick:", ((ms - 0) / 300).toFixed(2));
const c = deserializeWorld(sa);
const sc = serializeWorld(c);
console.log("save round-trip identical:", sa === sc, "bytes:", sa.length);
const player = a.empires.find(e => e.isPlayer)!;
console.log("player:", player.name, "systems:", player.systems.length, "colonies:", player.colonies.length, "techs:", player.techs.completed.length, "pops:", a.colonies.filter(c2 => c2.empireId === player.id).reduce((s, c2) => s + c2.pops.workers + c2.pops.specialists + c2.pops.rulers + c2.pops.unemployed, 0));
console.log("resources:", JSON.stringify(player.resources), "income:", JSON.stringify(player.incomeLastTick));
console.log("battles:", a.battles.length, "missions:", a.missions.length, "log:", a.log.length);
console.log("empires:", a.empires.map(e => e.id + ":" + e.name.slice(0,14) + ":" + e.systems.length + "s/" + e.colonies.length + "c/" + e.fleets.length + "f").join(" | "));
