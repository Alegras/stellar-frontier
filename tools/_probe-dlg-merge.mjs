import * as data from "@sf/data";
import * as sim from "@sf/sim";
for (const id of ["q_pro_02_quiet_dock","q_pro_05_inspection","q_pro_06_echo_core"]) {
  const q = data.DLC_QUESTS.find((x) => x.id === id);
  console.log(id, JSON.stringify({ requiresAnyFlags: q?.requiresAnyFlags, modifiers: q?.modifiers?.map((m) => ({ flags: m.requiresAnyFlags, label: m.effectLabels })) }));
}
for (const d of data.DLC_DIALOGUES.filter((x) => x.id.startsWith("dlg_campaign"))) {
  const effs = [];
  for (const n of d.nodes) for (const e of (n.effects ?? [])) effs.push(e);
  console.log(d.id, "nodes=" + d.nodes.length, "effects=" + JSON.stringify(effs.slice(0, 4)));
}
console.log("getDlcConsequences:", typeof sim.getDlcConsequences, "getDlcState fields:", Object.keys(sim.getDlcState(sim.createWorld(1, data.MODE, data.BALANCE)) ?? {}));
