
const path = require('path');
const j = require(path.join(__dirname, 'battle-ui-repro-raw.json'));
const A = j.probeA;
console.log("probeA keys:", Object.keys(A));
for (const k of Object.keys(A)) {
  const v = A[k];
  if (k === "initial") continue;
  if (Array.isArray(v)) {
    console.log("\n--- " + k + " (" + v.length + " samples) ---");
    for (const s of v) {
      const d = s.dom || s;
      console.log([s.t ?? s.at ?? "", "head=" + (d.head ?? ""), "help=" + String(d.help ?? "").slice(0,30), "hint=" + String(d.hint ?? "").slice(0,60)].join(" | "));
      if (s.battle) console.log("      state: round=" + s.battle.round + " turnSide=" + s.battle.turnSide + " pAlive=" + (s.battle.player||[]).filter(x=>x.alive).length + " eAlive=" + (s.battle.enemy||[]).filter(x=>x.alive).length);
      const tail = (d.logLines || []).slice(-3);
      if (tail.length) console.log("      log: " + tail.join(" || "));
    }
  } else {
    console.log("\n--- " + k + " ---");
    console.log(JSON.stringify(v).slice(0, 2000));
  }
}
console.log("\n=== probeB ===");
console.log(JSON.stringify(j.probeB).slice(0, 3000));
