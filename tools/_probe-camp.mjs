import * as data from "@sf/data";
import * as sim from "@sf/sim";
const w = sim.createWorld(61, data.MODE, data.BALANCE); sim.ensureFg(w);
const fg = w.fg;
console.log("campaign keys", Object.keys(fg.campaign ?? {}), JSON.stringify({ act: fg.campaign?.act, branch: fg.campaign?.branch, endings: fg.campaign?.endings }));
fg.campaign.act = 2;
const r = sim.maybeStartCampaignDialogue?.(w);
console.log("maybe", JSON.stringify(r), "dialogue", JSON.stringify(sim.getDlcState(w).dialogue && { scene: sim.getDlcState(w).dialogue.sceneId, ctx: sim.getDlcState(w).dialogue.context }));
const cmd = (c) => sim.applyCommand(w, c);
let g = 0;
while (g++ < 50) { const v = sim.getDlcDialogueView(w); if (!v || !v.active) break; if (v.options?.length) cmd({ type: "dlc_dialogue_choice", nodeId: v.nodeId, choiceId: v.options[0].id }); else cmd({ type: "dlc_dialogue_advance" }); }
console.log("after act2", JSON.stringify({ flags: Object.keys(fg.campaign.flags).filter(f=>f.includes("dlc")), consequences: sim.getDlcConsequences?.(w)?.length }));
