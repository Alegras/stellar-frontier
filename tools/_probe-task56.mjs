import * as data from "@sf/data";
for (const id of ["dlg_campaign_ancient_archive", "dlg_campaign_ancient_contact"]) {
  const d = data.DLC_DIALOGUES.find((x) => x.id === id);
  console.log(id, "nodes", d?.nodes.length);
  const flags = new Set(); const textKeys = new Set();
  for (const n of d?.nodes ?? []) {
    if (n.textKey) textKeys.add(n.textKey);
    for (const o of n.options ?? []) {
      if (o.requiresFlag) flags.add("req:" + o.requiresFlag);
      for (const e of o.effects ?? []) { if (e.campaignFlag) flags.add(e.campaignFlag); if (e.unlockMission) flags.add("unlock:" + e.unlockMission); if (e.endingHint) flags.add("hint:" + e.endingHint); if (e.flag) flags.add("flag:" + e.flag); }
    }
  }
  console.log(" flags:", [...flags].join(","));
  console.log(" firstKeys:", [...textKeys].slice(0, 4).join(","));
}
console.log("dialogues", data.DLC_DIALOGUES.length, "campaign", (data.DLC_DIALOGUES ?? []).filter((d) => String(d.id).startsWith("dlg_campaign")).length);
let outcomes = 0; for (const d of data.DLC_DIALOGUES ?? []) for (const n of d.nodes ?? []) if (n.outcome === true) outcomes++;
console.log("outcomes", outcomes, "l10n", Object.keys(data.L10N_RU ?? {}).length, Object.keys(data.L10N_EN ?? {}).length);
