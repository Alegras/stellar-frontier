import * as data from "@sf/data";
const payoff = [];
for (const d of data.DLC_DIALOGUES ?? []) {
  for (const n of d.nodes ?? []) for (const o of n.options ?? []) {
    if (o.requiresFlag) payoff.push({ scene: d.id, node: n.id, opt: o.id, flag: o.requiresFlag });
  }
}
console.log("requiresFlag options:", payoff.length, JSON.stringify(payoff.slice(0, 30)));
const campOnly = payoff.filter((p) => p.flag && p.flag.startsWith("camp_"));
console.log("camp_ requiresFlag:", campOnly.length, [...new Set(campOnly.map((p) => p.flag))].join(","));
