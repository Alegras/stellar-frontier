import * as data from "@sf/data";
import * as sim from "@sf/sim";
const w = sim.createWorld(42, data.MODE, data.BALANCE); sim.ensureFg(w); sim.tick(w, 1000);
const cmd = (c) => sim.applyCommand(w, c);
let g = 0;
while (g++ < 40) { const v = sim.getDlcDialogueView(w); if (!v || v.active === false) break; if (v.options?.length) cmd({ type: "dlc_dialogue_choice", nodeId: v.nodeId, choiceId: v.options[0].id }); else cmd({ type: "dlc_dialogue_advance" }); }
const def = sim.dlcQuestById("q_pro_01_first_light");
console.log("after dialogue", JSON.stringify(sim.getDlcState(w).quests["q_pro_01_first_light"]));
for (const step of def.steps) {
  const n = step.count ?? 1;
  for (let i = 0; i < n; i++) {
    const r = cmd({ type: "dlc_action", action: step.type, target: step.target });
    console.log(step.id, step.type, "target=" + step.target, "→", JSON.stringify(r));
  }
}
console.log("final", JSON.stringify(sim.getDlcState(w).quests["q_pro_01_first_light"]));
console.log("active", sim.getDlcState(w).activeQuestId);
