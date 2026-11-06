import * as data from "@sf/data";
const dial = (data.DLC_DIALOGUES ?? []).filter((d) => String(d.id).includes("campaign") || String(d.id).includes("camp_"));
console.log("campaign dialogues:", dial.map((d) => d.id + " nodes=" + d.nodes.length).join(", "));
const effects = [];
for (const d of data.DLC_DIALOGUES ?? []) for (const n of d.nodes ?? []) {
  for (const e of n.effects ?? []) effects.push([d.id, e]);
  for (const o of n.options ?? []) for (const e of o.effects ?? []) effects.push([d.id, e]);
}
const keys = new Set();
for (const [, e] of effects) for (const k of Object.keys(e ?? {})) keys.add(k);
console.log("effect keys:", [...keys].sort().join(","));
const kinds = effects.map(([, e]) => e).filter((e) => e.endingHint || e.unlockMission || e.payoffFlag || e.ending || e.branch);
console.log("story effects count:", kinds.length, JSON.stringify(kinds.slice(0, 8)));
const flags = new Set();
for (const [, e] of effects) { if (e.flag) flags.add(e.flag); if (e.payoffFlag) flags.add("payoff:" + e.payoffFlag); }
console.log("payoff/story flags:", [...flags].filter((f) => /payoff|act|ending|branch|campaign/i.test(f)).slice(0, 40).join(","));
