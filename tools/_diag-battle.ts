import * as M from "../apps/web/src/ui/grid-battle/model.ts";
const b = M.createMockBattle({ seed: 1 });
M.formation(b, "line", "player"); M.startV2(b);
console.log("start fp:", M.fpOf(b, "player"), M.fpOf(b, "enemy"));
let step = 0;
while (b.phase === "battle" && step++ < 60) {
  const side = b.turnSide;
  const before = b.log.length;
  const fpBefore = { p: M.fpOf(b, "player"), e: M.fpOf(b, "enemy") };
  const hasAp = b.stacks.some((s) => s.side === side && s.alive && !s.reserve && M.apOf(s) > 0);
  if (!hasAp) M.v2EndPhase(b); else M.v2ActSide(b);
  const fpAfter = { p: M.fpOf(b, "player"), e: M.fpOf(b, "enemy") };
  const lines = b.log.slice(before);
  const atk = lines.filter((l) => l.kind === "damage");
  console.log("[" + (hasAp ? "act " : "end ") + side + "] round=" + b.round + " first=" + b.firstSide + "  fpP " + (fpBefore.p - fpAfter.p) + " fpE " + (fpBefore.e - fpAfter.e) + "  (P=" + fpAfter.p + " E=" + fpAfter.e + ") lines=" + lines.length);
  if (lines.length && step < 8) for (const l of lines.slice(0, 6)) console.log("      " + l.text);
}
console.log("phase=" + b.phase + " winner=" + (b.result && b.result.winner));
console.log("survivors player:", b.stacks.filter((s) => s.side === "player" && s.alive).map((s) => s.cls + ":" + s.count + "/" + s.startCount).join(" "));
console.log("survivors enemy :", b.stacks.filter((s) => s.side === "enemy" && s.alive).map((s) => s.cls + ":" + s.count + "/" + s.startCount).join(" "));
