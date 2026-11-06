import * as data from "@sf/data";
for (const id of ["dlg_campaign_act0_relic", "dlg_campaign_act1_hegemon"]) {
  const d = data.DLC_DIALOGUES.find((x) => x.id === id);
  console.log("SCENE", id, "nodes", d.nodes.length);
  for (const n of d.nodes) {
    if (n.type === "choice") {
      console.log(" choice", n.id, n.textKey, n.options.map((o) => o.id + "->" + o.next + ":" + (o.effects ?? []).map((e) => Object.keys(e).join("+")).join(",")).join(" | "));
    }
    if (n.outcome) console.log(" outcome", n.id, n.textKey);
  }
}
const g = "dlg_campaign_act1_hegemon";
const d = data.DLC_DIALOGUES.find((x) => x.id === g);
const flags = new Set(); const rel = {};
for (const n of d.nodes) for (const o of n.options ?? []) for (const e of o.effects ?? []) { if (e.campaignFlag) flags.add(e.campaignFlag); if (e.relation) Object.assign(rel, e.relation); if (e.unlockMission) flags.add("unlock:" + e.unlockMission); }
console.log("act1 flags:", [...flags].join(","), "relations:", JSON.stringify(rel));
