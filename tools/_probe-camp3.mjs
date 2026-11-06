import * as data from "@sf/data";
import * as sim from "@sf/sim";
const w = sim.createWorld(61, data.MODE, data.BALANCE); sim.ensureFg(w);
w.fg.campaign.act = 2;
sim.maybeStartCampaignDialogue(w);
const cmd = (c) => sim.applyCommand(w, c);
let g = 0;
while (g++ < 30) {
  const v = sim.getDlcDialogueView(w);
  const st = sim.getDlcState(w).dialogue;
  console.log(g, "view=" + (v ? v.sceneId + "/" + v.nodeId + " opts=" + (v.options??[]).map(o=>o.id).join(",") : "null"), "state=" + (st ? st.sceneId + "/" + st.nodeId + "/active=" + st.active : "null"));
  if (!v || !v.active) break;
  if (v.options?.length) { const res = cmd({ type: "dlc_dialogue_choice", nodeId: v.nodeId, choiceId: v.options[0].id }); console.log("  choice ->", JSON.stringify(res)); }
  else { const res = cmd({ type: "dlc_dialogue_advance" }); console.log("  advance ->", JSON.stringify(res)); }
}
console.log("final dlc", JSON.stringify({ dialogue: sim.getDlcState(w).dialogue, seen: sim.getDlcState(w).seenScenes, flags: Object.keys(sim.getDlcState(w).flags) }));
