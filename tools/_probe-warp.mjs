import * as data from "@sf/data";
import * as sim from "@sf/sim";
const w = sim.createWorld(42, data.MODE, data.BALANCE);
sim.ensureFg(w); const a = sim.ensureAncients(w);
for (let i=0;i<1210;i++) sim.tick(w, 1000);
// пройти линию
for (let i=0;i<40 && a.quest.stage<12;i++) { if (a.quest.activeMissionId) sim.completeAncientsMission(w, a.quest.activeMissionId); else sim.acceptAncientsMission(w, w.playerEmpireId); }
a.warp.unlocked = true; a.sector.discovered = true;
const p = w.empires.find(e=>e.id===w.playerEmpireId); const f = w.fleets.find(ff=>ff.empireId===p.id && ff.ships.length>0);
console.log("stage", a.quest.stage, "warp", a.warp.unlocked, "radius", sim.warpRadiusLy ? sim.warpRadiusLy(w) : "?");
console.log("systems", w.systems.length, "sector systems", w.systems.filter(s=>s.sector==="relic").length);
const origin = w.systems[f.systemId];
console.log("origin", origin.id, origin.sector);
let tried = 0;
for (let i=0;i<5;i++) {
  a.warp.charges = 10; a.warp.cooldownUntil = 0;
  const target = w.systems.find(ss => ss.id !== f.systemId && (ss.sector !== "relic"));
  console.log("target", target?.id, target?.sector, "distLy", target ? sim.distanceLy(w, origin, target).toFixed(1) : "?");
  const res = sim.warpJump(w, p.id, target.id);
  console.log("jump", i, JSON.stringify(res));
  w.tick += 10; tried++;
}
console.log("lastRisk", a.warp.lastRiskTriggered);
