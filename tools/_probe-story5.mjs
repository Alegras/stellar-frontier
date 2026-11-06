import * as data from "@sf/data";
const dial = (data.DLC_DIALOGUES ?? []).filter((d) => String(d.id).startsWith("dlg_campaign"));
console.log("campaign dialogues:", dial.length, dial.map((d) => d.id + " nodes=" + d.nodes.length).join(", "));
let optReq = 0, nodeReq = 0; const flags = new Set();
for (const d of dial) for (const n of d.nodes ?? []) {
  if (n.requiresFlag) nodeReq++;
  for (const o of n.options ?? []) { if (o.requiresFlag) { optReq++; flags.add(o.requiresFlag); } }
}
console.log("requiresFlag options:", optReq, "nodes:", nodeReq, "flags:", [...flags].sort().join(","));
const notes = (data.DLC_DIALOGUES ?? []).map((d) => d.notes).filter(Boolean);
console.log("notes count:", notes.length, JSON.stringify(notes[0] ?? {}).slice(0, 600));
