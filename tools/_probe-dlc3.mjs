import * as data from "@sf/data";
import * as sim from "@sf/sim";
const w = sim.createWorld(51, data.MODE, data.BALANCE); sim.ensureFg(w); sim.tick(w, 1000);
const cmd = (c) => sim.applyCommand(w, c);
let g = 0;
while (g++ < 60) {
  const v = sim.getDlcDialogueView(w);
  if (!v || v.active === false) break;
  console.log(g, "node=" + v.nodeId, "type=" + (v.node?.type ?? "?"), "opts=" + (v.options ?? []).map(o => o.id).join(","));
  if (v.options?.length) cmd({ type: "dlc_dialogue_choice", nodeId: v.nodeId, choiceId: v.options[0].id });
  else cmd({ type: "dlc_dialogue_advance" });
}
console.log("ended", !sim.getDlcState(w).dialogue);
console.log("checks", JSON.stringify(sim.getDlcState(w).dialogue?.checkResults ?? {}));
