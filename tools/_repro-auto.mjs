import * as M from "../apps/web/src/ui/grid-battle/model.ts";

function hpSide(b, side) { return b.stacks.filter(s => s.side === side && s.alive && !s.reserve).reduce((a,s)=>a+s.hp,0); }

// --- auto battle: exactly as GridBattleV2Overlay.doAutoBattle
function doAutoBattle(battle) {
  let b = M.clone(battle); let guard = 0;
  while (b.phase === "battle" && guard++ < 300) {
    if (b.turnSide === "enemy") { M.v2AiPhase(b); continue; }
    const actors = b.stacks.filter((s) => s.side === "player" && s.alive && !s.reserve && M.apOf(s) > 0);
    if (actors.length === 0) { M.v2EndPhase(b); continue; }
    for (const actor of actors) {
      let inner = 0;
      while (b.turnSide === "player" && M.apOf(actor) > 0 && b.phase === "battle") {
        if (inner++ > 20) { console.log("  !! inner loop guard hit for", actor.id); break; }
        const targets = b.stacks.filter((t) => t.side === "enemy" && t.alive && !t.reserve);
        if (!targets.length) break;
        const adj = targets.find((t) => Math.abs(t.q - actor.q) + Math.abs(t.r - actor.r) === 1);
        if (adj) { const ok = M.v2Attack(b, actor.id, adj.id, false); if (!ok) { console.log("  !! v2Attack failed melee", actor.id, adj.id); break; } continue; }
        const ranged = targets.find((t) => M.canAttack(b, actor, t, true).ok);
        if (ranged) { const ok = M.v2Attack(b, actor.id, ranged.id, true); if (!ok) { console.log("  !! v2Attack failed ranged"); break; } continue; }
        const target = [...targets].sort((x, y) => (Math.abs(x.q - actor.q) + Math.abs(x.r - actor.r)) - (Math.abs(y.q - actor.q) + Math.abs(y.r - actor.r)))[0];
        const spots = M.reachable(b, actor.id).sort((x, y) => (Math.abs(x.q - target.q) + Math.abs(x.r - target.r)) - (Math.abs(y.q - target.q) + Math.abs(y.r - target.r)));
        if (spots.length) { if (!M.v2Move(b, actor.id, spots[0].q, spots[0].r)) { console.log("  !! v2Move failed"); break; } } else break;
      }
    }
    if (b.turnSide === "player" && b.phase === "battle") M.v2EndPhase(b);
  }
  if (b.phase !== "result") M.finish(b, "draw");
  return b;
}

for (const seed of [42, 7, 8, 1, 2, 3]) {
  const b0 = M.createMockBattle({ seed });
  M.formation(b0, "line", "player");
  M.startV2(b0);
  const b = doAutoBattle(b0);
  console.log("seed", seed, "-> winner:", b.result?.winner, "round:", b.round,
    "playerHP:", hpSide(b,"player"), "enemyHP:", hpSide(b,"enemy"));
  console.log("   player alive:", b.stacks.filter(s=>s.side==="player"&&s.alive).length,
              "enemy alive:", b.stacks.filter(s=>s.side==="enemy"&&s.alive).length);
  console.log("   last 6 log:", b.log.slice(-6).map(e=>e.text).join(" | "));
}
