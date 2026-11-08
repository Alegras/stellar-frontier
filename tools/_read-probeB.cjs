
const path = require('path');
const j = require(path.join(__dirname, 'battle-ui-repro-raw.json'));
const A = j.probeA;
console.log("A.cycles:", JSON.stringify(A.cycles).slice(0, 200));
console.log("A.enemyAttackers:", JSON.stringify(A.enemyAttackers));
console.log("A.notes:", JSON.stringify(A.notes));
console.log("A.anyPlayerDamage:", A.anyPlayerDamage);
console.log("\n=== task2 note: total keys of cycles entries ===");
if (Array.isArray(A.cycles) && A.cycles[0]) console.log(Object.keys(A.cycles[0]), JSON.stringify(A.cycles[0]).slice(0,1200));
console.log("\n=== probeB summary ===");
for (const run of j.probeB) {
  console.log("seed", run.seed, "->", run.panelTitle, "rounds:", run.after && run.after.round, "playerHp:", run.after && run.after.playerHp, "enemyHp:", run.after && run.after.enemyHp, "resultVisible:", run.resultVisible, "err:", run.clickError, "elapsed:", run.elapsedMs);
  console.log("   before:", JSON.stringify(run.before));
  console.log("   consoleErrors:", JSON.stringify(run.consoleErrors));
}
