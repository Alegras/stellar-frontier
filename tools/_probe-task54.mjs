import * as data from "@sf/data";
const camp = (data.DLC_DIALOGUES ?? []).filter((d) => String(d.id).startsWith("dlg_campaign"));
let outcomes = 0;
for (const d of camp) for (const n of d.nodes ?? []) if (n.outcome === true) outcomes++;
console.log("dialogues", data.DLC_DIALOGUES.length, "campaign", camp.length, "outcomes", outcomes);
console.log("exports bridges:", Object.keys(data).filter((k) => /BRIDGE|bridge/i.test(k)).join(","));
const b = data.CAMPAIGN_BRIDGES ?? [];
console.log("bridges:", b.length, JSON.stringify(b.slice(0, 2)));
for (const id of ["dlg_campaign_teira_arc", "dlg_campaign_kira_arc"]) {
  const d = data.DLC_DIALOGUES.find((x) => x.id === id);
  console.log(id, "nodes", d?.nodes.length);
  for (const n of d?.nodes ?? []) if (n.type === "choice") console.log(" choice", n.id, n.options.map((o) => o.id + "->" + o.next + ":" + (o.effects ?? []).map((e) => e.campaignFlag ?? "").filter(Boolean).join(",")).join(" | "));
}
