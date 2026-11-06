import * as data from "@sf/data";
const flags = new Set();
for (const d of data.DLC_DIALOGUES ?? []) for (const n of d.nodes ?? []) {
  for (const e of n.effects ?? []) { if (e.campaignFlag) flags.add(e.campaignFlag); if (e.flag) flags.add(e.flag); }
  for (const o of n.options ?? []) for (const e of o.effects ?? []) { if (e.campaignFlag) flags.add(e.campaignFlag); if (e.flag) flags.add(e.flag); }
}
console.log("campaign/flag effects count:", flags.size, [...flags].sort().join(","));
const missions = data.CAMPAIGN_MISSIONS ?? [];
console.log("missions:", missions.length, missions.slice(0, 12).map(m => m.id + ":" + (m.act ?? "?")).join(","));
const mFlags = new Set();
for (const m of missions) for (const k of Object.keys(m.flags ?? {})) mFlags.add(k);
console.log("mission flag keys:", mFlags.size, [...mFlags].slice(0, 20).join(","));
