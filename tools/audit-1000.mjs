import { spawn } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
const PARTS = Number(process.env.SF_PARTS ?? 20);
const GAMES = Number(process.env.SF_GAMES ?? 1000);
const TICKS = Number(process.env.SF_TICKS ?? 7200);
const SEED = Number(process.env.SF_SEED ?? 5000);
const files = [];
let done = 0, failed = 0;
const t0 = Date.now();
function runPart(i) {
  return new Promise((resolve) => {
    const out = "tools/__audit_1000_" + i + ".json";
    files.push(out);
    const args = ["--import", "tsx", "tools/balance-sim.ts", "--games", String(GAMES), "--ticks", String(TICKS), "--parts", String(PARTS), "--part", String(i), "--seed", String(SEED), "--out", out, "--quiet"];
    const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      done++;
      if (code !== 0) { failed++; console.error("part", i, "failed code", code); }
      else console.log("part", i, "done", ((Date.now() - t0) / 1000).toFixed(0) + "s", done + "/" + PARTS);
      resolve();
    });
  });
}
await Promise.all(Array.from({ length: PARTS }, (_, i) => runPart(i)));
const mergeArgs = ["--import", "tsx", "tools/balance-sim.ts", "--merge", files.join(","), "--out", "tools/audit-1000.json", "--quiet"];
const code = await new Promise((resolve) => {
  const child = spawn(process.execPath, mergeArgs, { stdio: "inherit", env: process.env });
  child.on("exit", resolve);
});
const report = { games: GAMES, ticks: TICKS, seed: SEED, parts: PARTS, failed, mergeExit: code, elapsedSec: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() };
writeFileSync("tools/audit-1000-status.json", JSON.stringify(report, null, 1));
console.log("AUDIT-1000 DONE", JSON.stringify(report));
