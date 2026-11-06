import * as data from "@sf/data";
for (const id of ["q_pro_02_quiet_dock","q_pro_03_salt_ash","q_pro_04_courier","q_pro_05_inspection","q_pro_06_echo_core"]) {
  const q = data.DLC_QUESTS.find(x=>x.id===id);
  console.log(id, "nextHint=" + q.nextHint, "source=" + JSON.stringify(q.source), "rewards.flags=" + JSON.stringify(q.rewards.flags));
}
