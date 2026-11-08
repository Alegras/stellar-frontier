import * as M from "../apps/web/src/ui/grid-battle/model.ts";

function runFor(seed: number, forceFirst?: "player" | "enemy") {
  const b = M.createMockBattle({ seed });
  M.formation(b, "line", "player");
  M.startV2(b);
  if (forceFirst) { b.turnSide = forceFirst; b.firstSide = forceFirst; }
  M.runAutoBattle(b);
  return b.result!.winner;
}
for (const force of [undefined, "player", "enemy"] as const) {
  const w: Record<string, number> = { player: 0, enemy: 0, draw: 0 };
  for (let seed = 1; seed <= 40; seed++) { w[runFor(seed, force)] = (w[runFor(seed, force)] ?? 0) + 1; }
  console.log("firstSide=" + (force ?? "hash-tie-break") + " ->", JSON.stringify(w));
}
