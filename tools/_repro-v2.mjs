import * as M from "../apps/web/src/ui/grid-battle/model.ts";

function dump(b, label) {
  const alive = (side) => b.stacks.filter(s => s.side === side && s.alive && !s.reserve);
  console.log("\n== " + label + " == round=" + b.round + " turnSide=" + b.turnSide + " phase=" + b.phase);
  console.log("player alive:", alive("player").length, "hp=" + alive("player").reduce((a,s)=>a+s.hp,0));
  console.log("enemy  alive:", alive("enemy").length, "hp=" + alive("enemy").reduce((a,s)=>a+s.hp,0));
  console.log("last log:");
  for (const e of b.log.slice(-8)) console.log("  ["+e.round+"] "+e.text);
}

// --- flow 1: player ends turn -> enemy phase -> AI
const b = M.createMockBattle({ seed: 42 });
M.formation(b, "line", "player");
M.startV2(b);
dump(b, "start");
console.log("enemy APs:", b.stacks.filter(s=>s.side==="enemy").map(s=>s.id+":"+(s.ap)).join(" "));
M.v2EndPhase(b);
dump(b, "after v2EndPhase#1 (should be enemy turn)");
const enemyHpBefore = b.stacks.filter(s=>s.side==="enemy").reduce((a,s)=>a+s.hp,0);
const playerHpBefore = b.stacks.filter(s=>s.side==="player" && s.alive).reduce((a,s)=>a+s.hp,0);
M.v2AiPhase(b);
dump(b, "after v2AiPhase");
const playerHpAfter = b.stacks.filter(s=>s.side==="player" && s.alive).reduce((a,s)=>a+s.hp,0);
console.log("player hp delta from enemy phase:", playerHpAfter - playerHpBefore);
