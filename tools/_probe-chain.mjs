import * as data from "@sf/data";
for (const q of data.DLC_QUESTS) {
  const hint = q.nextHint;
  const mods = (q.modifiers ?? []).map(m => m.nextHint).filter(Boolean);
  console.log(q.id, "next=" + hint, "mods=" + JSON.stringify(mods), "ch=" + q.source?.channel, "req=" + q.source?.requiresQuest, "any=" + JSON.stringify(q.requiresAnyFlags));
}
const eff = [];
for (const d of data.DLC_DIALOGUES) for (const n of d.nodes) { for (const e of n.effects ?? []) if (e.openQuest) eff.push(d.id + ":" + e.openQuest); for (const o of n.options ?? []) for (const e of o.effects ?? []) if (e.openQuest) eff.push(d.id + "/" + o.id + ":" + e.openQuest); }
console.log("effects openQuest:", JSON.stringify(eff));
