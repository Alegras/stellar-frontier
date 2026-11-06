import * as data from "@sf/data";
const camp = (data.DLC_DIALOGUES ?? []).filter((d) => String(d.id).startsWith("dlg_campaign"));
const outs = [];
for (const d of camp) for (const n of d.nodes ?? []) if (n.outcome === true) outs.push({ scene: d.id, node: n.id, textKey: n.textKey, sample: n.id });
console.log("count", outs.length, JSON.stringify(outs.slice(0, 5)));
