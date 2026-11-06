import * as data from "@sf/data";
import * as sim from "@sf/sim";
const w = sim.createWorld(61, data.MODE, data.BALANCE); sim.ensureFg(w);
const fg = w.fg; fg.campaign.act = 2;
sim.maybeStartCampaignDialogue(w);
const cmd = (c) => sim.applyCommand(w, c);
let g = 0;
while (g++ < 60) { const v = sim.getDlcDialogueView(w); if (!v || !v.active) break; if (v.options?.length) cmd({ type: "dlc_dialogue_choice", nodeId: v.nodeId, choiceId: v.options[0].id }); else cmd({ type: "dlc_dialogue_advance" }); }
const d = sim.getDlcState(w);
console.log("dlc flags", Object.keys(d.flags).filter(f=>f.includes("camp")||f.includes("dlg")||f.includes("branch")));
console.log("campaign flags", Object.keys(fg.campaign.flags).filter(f=>f.includes("dlc")||f.includes("camp")||f.includes("branch")||f.includes("ending")));
console.log("seen", d.seenScenes, "consequences", JSON.stringify(sim.getDlcConsequences?.(w)));
console.log("act2 data options", JSON.stringify(data.DLC_DIALOGUES.find(x=>x.id==="dlg_campaign_act2")?.nodes.filter(n=>n.options?.length).map(n=>({id:n.id, opts:n.options.map(o=>({id:o.id,effects:o.effects}))}))));
