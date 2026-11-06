#!/usr/bin/env node
/**
 * ПАРИТЕТ SP vs DEDICATED (M11/M12, 09 §9): одинаковые seed + команды должны давать
 * идентичный serializeWorld после 500 тактов.
 *
 * Мир A (SP):     sim.applyCommand(worldA, cmd)        — команда от world.playerEmpireId
 * Мир B (dedicated): sim.applyCommandAs(worldB, id, cmd) — та же команда от имени империи
 * + sim.tick обоим одинаково. Команды ставятся по тактам из детерминированного сценария.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/parity-test.mjs [--ticks 500]
 */
import { MODE, BALANCE } from "@sf/data";
import { applyCommand, applyCommandAs, createWorld, serializeWorld, tick } from "@sf/sim";

const args = process.argv.slice(2);
const num = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const TICKS = num("--ticks", 500);
const SEED = num("--seed", 42);

function stateHash(world) {
  const json = serializeWorld(world);
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return { hash: h.toString(16).padStart(8, "0"), bytes: json.length };
}

const playerId = createWorld(SEED, MODE, BALANCE).playerEmpireId;
console.log("parity: seed=" + SEED + " ticks=" + TICKS + " playerEmpire=" + playerId);

/** Кандидаты команд на такте t (одинаковые для обоих миров). */
function candidates(t, world) {
  const out = [];
  if (t % 25 === 0) {
    const fleet = world.fleets.find((f) => f.empireId === playerId && f.ships.length > 0);
    if (fleet) {
      const sys = world.systems[fleet.systemId];
      const links = sys?.links ?? [];
      const target = links.length > 0 ? links[(t / 25) % links.length] : null;
      if (target != null && target !== fleet.systemId) out.push({ type: "move_fleet", fleetId: fleet.id, systemId: target });
      if (target != null) out.push({ type: "scan_system", fleetId: fleet.id, systemId: target });
    }
  }
  if (t % 40 === 0) {
    const emp = world.empires.find((e) => e.id === playerId);
    const off = emp?.techs.offers?.physics?.[0] ?? emp?.techs.offers?.engineering?.[0];
    if (off) out.push({ type: "research", school: emp.techs.offers.physics?.[0] ? "physics" : "engineering", techId: off });
  }
  if (t % 60 === 0) {
    const colony = world.colonies.find((c) => c.empireId === playerId);
    if (colony) out.push({ type: "build_district", colonyId: colony.id, districtId: "residential" });
  }
  if (t % 75 === 0) {
    const fleet = world.fleets.find((f) => f.empireId === playerId && f.ships.length > 0);
    if (fleet) out.push({ type: "repair_fleet", fleetId: fleet.id });
  }
  return out;
}

// Фаза 1: эталонный прогон — запоминаем команды, которые РЕАЛЬНО применяются (не отклонены sim).
const ref = createWorld(SEED, MODE, BALANCE);
const script = [];
for (let t = 1; t <= TICKS; t++) {
  for (const cmd of candidates(t, ref)) {
    try { if (applyCommandAs(ref, playerId, cmd).ok) script.push({ t, cmd }); } catch { /* отклонена */ }
  }
  tick(ref);
}
console.log("parity: valid commands from reference run = " + script.length);

// Фаза 2: два мира с одинаковым seed и одинаковыми командами: SP (applyCommand) vs dedicated (applyCommandAs).
const A = createWorld(SEED, MODE, BALANCE);
const B = createWorld(SEED, MODE, BALANCE);
let mismatches = 0;
let applied = 0;
let rejected = 0;
for (let t = 1; t <= TICKS; t++) {
  for (const step of script.filter((x) => x.t === t)) {
    let ra, rb;
    try { ra = applyCommand(A, step.cmd); } catch (e) { ra = { ok: false, messageRu: String(e) }; }
    try { rb = applyCommandAs(B, playerId, step.cmd); } catch (e) { rb = { ok: false, messageRu: String(e) }; }
    if (ra.ok) applied++; else rejected++;
    if (ra.ok !== rb.ok || (ra.messageRu ?? "") !== (rb.messageRu ?? "")) {
      mismatches++;
      if (mismatches <= 5) console.log("[mismatch] tick " + t + " " + JSON.stringify(step.cmd) + " A=" + JSON.stringify(ra) + " B=" + JSON.stringify(rb));
    }
  }
  tick(A);
  tick(B);
  const ha = stateHash(A);
  const hb = stateHash(B);
  if (ha.hash !== hb.hash) {
    mismatches++;
    if (mismatches <= 5) console.log("[diverge] tick " + t + " A=" + ha.hash + " B=" + hb.hash);
    break;
  }
}

const ha = stateHash(A);
const hb = stateHash(B);
const jsonA = serializeWorld(A);
const jsonB = serializeWorld(B);
const equal = jsonA === jsonB;
const result = {
  seed: SEED,
  ticks: TICKS,
  worldBytes: ha.bytes,
  hashSP: ha.hash,
  hashDedicated: hb.hash,
  commandSteps: script.length,
  applied,
  rejected,
  mismatches,
  serializeEqual: equal,
  determinism: ha.hash === hb.hash ? "OK (bit-identical)" : "FAIL",
};
console.log(JSON.stringify(result, null, 2));
if (!equal) {
  console.error("PARITY FAIL: SP и dedicated разошлись");
  process.exitCode = 1;
} else {
  console.log("PARITY PASS: SP == dedicated на " + TICKS + " тактах, sha-hash " + ha.hash);
}