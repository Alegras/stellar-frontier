#!/usr/bin/env node
/**
 * HEAP-SOAK M11/1.0: сервер под нагрузкой (MMO, 20 клиентов) с сэмплированием памяти
 * серверного процесса через /admin/stats. Пишет JSONL в docs/shots/heap-soak.jsonl.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/heap-soak.mjs --minutes 180 --clients 20
 * Анализ: node <runtime>/pnpm.mjs exec tsx tools/heap-soak.mjs --analyze
 *
 * Цель 1.0: heapUsed сервера < 150 МБ через 3 ч. Линейная экстраполяция по сэмплам после
 * прогрева (2 мин) — честная пометка: реальный прогон N минут.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "docs", "shots");
const OUT_JSONL = path.join(OUT_DIR, "heap-soak.jsonl");
const OUT_SUMMARY = path.join(OUT_DIR, "heap-soak-summary.json");
const TARGET_HEAP_MB = 150;
const ADMIN = "soak-admin-token";

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const flag = (n) => args.includes(n);
const MINUTES = arg("--minutes", 180);
const CLIENTS = arg("--clients", 20);
const SAMPLE_SEC = arg("--sample", 30);

function analyze() {
  if (!existsSync(OUT_JSONL)) { console.error("нет " + OUT_JSONL); process.exitCode = 1; return; }
  const rows = readFileSync(OUT_JSONL, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (rows.length < 3) { console.log("мало сэмплов: " + rows.length); return; }
  const t0 = rows[0].t;
  const warm = 120_000; // 2 мин прогрев
  const pts = rows.filter((r) => r.t - t0 >= warm && r.heapUsed != null).map((r) => ({ x: (r.t - t0) / 3_600_000, y: r.heapUsed / 1048576 }));
  const use = pts.length >= 3 ? pts : rows.map((r) => ({ x: (r.t - t0) / 3_600_000, y: r.heapUsed / 1048576 }));
  const n = use.length;
  const mx = use.reduce((a, p) => a + p.x, 0) / n;
  const my = use.reduce((a, p) => a + p.y, 0) / n;
  const slope = use.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / (use.reduce((a, p) => a + (p.x - mx) ** 2, 0) || 1);
  const base = my - slope * mx;
  const totalHours = Math.max(rows[rows.length - 1].t - t0, 1) / 3_600_000;
  const projected3h = base + slope * 3;
  const summary = {
    samples: rows.length,
    observedHours: Number(totalHours.toFixed(2)),
    minHeapMb: Number(Math.min(...use.map((p) => p.y)).toFixed(1)),
    maxHeapMb: Number(Math.max(...use.map((p) => p.y)).toFixed(1)),
    avgHeapMb: Number(my.toFixed(1)),
    slopeMbPerHour: Number(slope.toFixed(2)),
    projectedHeap3hMb: Number(projected3h.toFixed(1)),
    targetHeapMb: TARGET_HEAP_MB,
    projectedOk: projected3h < TARGET_HEAP_MB,
    note: totalHours >= 2.9 ? "полный 3-часовой прогон" : "частичный прогон " + totalHours.toFixed(2) + " ч + линейная экстраполяция",
  };
  writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.projectedOk) process.exitCode = 2;
}

if (flag("--analyze")) { analyze(); process.exit(0); }

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_JSONL, "");
const { createServer } = await import("../apps/api/src/server.ts");
const server = await createServer({
  persistence: "none", log: () => {},
  mmoTickMs: 1000, mmoSnapshotMs: 5000, reconnectGraceMs: 30000, pauseCooldownMs: 250,
  adminToken: ADMIN, httpRatePerMin: 100000,
});
const base = await server.listen(0, "0.0.0.0");
const port = Number(new URL(base).port);
const post = (r, p, b) => fetch("http://127.0.0." + (r + 1) + ":" + port + p, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify(b) });

class Client {
  constructor(url, seat) {
    this.seat = seat; this.messages = 0; this.closed = false;
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", () => { this.messages++; });
    this.ws.addEventListener("close", () => { this.closed = true; });
  }
  open(t = 60000) { return new Promise((res, rej) => { const t0 = Date.now(); const l = () => { if (this.ws.readyState === 1) return res(); if (this.ws.readyState >= 2) return rej(new Error("closed")); if (Date.now() - t0 > t) return rej(new Error("open timeout")); setTimeout(l, 20); }; l(); }); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const t0 = Date.now();
let clients = [];
let tickBase = 0;
const t0samples = [];
try {
  const created = await post(0, "/rooms", { modeId: "mmo", nick: "soak-host", seed: 7 }).then((r) => r.json());
  const joins = await Promise.all(Array.from({ length: CLIENTS - 1 }, (_, i) => post(0, "/rooms/" + created.code + "/join", { nick: "soak" + i }).then((r) => r.json())));
  const seats = [created, ...joins];
  clients = seats.map((s) => new Client(s.wsUrl.replace("http", "ws"), s.seat));
  for (let i = 0; i < clients.length; i += 10) {
    await Promise.all(clients.slice(i, i + 10).map(async (c) => { await c.open(); }));
    clients.slice(i, i + 10).forEach((c, k) => c.send({ t: "hello", protocol: 1, roomCode: seats[i + k].code, token: seats[i + k].token }));
    await new Promise((r) => setTimeout(r, 30));
  }
  await new Promise((r) => setTimeout(r, 500));
  clients.forEach((c) => c.send({ t: "ready", ready: true }));
  await new Promise((r) => setTimeout(r, 500));
  clients[0].send({ t: "start" });
  await new Promise((r) => setTimeout(r, 3000));
  console.log("soak started: clients=" + clients.length + " minutes=" + MINUTES);

  const deadline = Date.now() + MINUTES * 60_000;
  let sampleNo = 0;
  const sample = async () => {
    let stats = null;
    try { stats = await (await fetch(base + "/admin/stats", { headers: { "x-admin-token": ADMIN } })).json(); } catch { /* ignore */ }
    const health = await (await fetch(base + "/health")).json().catch(() => ({}));
    const row = {
      t: Date.now() - t0,
      at: new Date().toISOString(),
      sample: sampleNo,
      heapUsed: stats?.memory?.heapUsed ?? null,
      heapTotal: stats?.memory?.heapTotal ?? null,
      rss: stats?.memory?.rss ?? null,
      external: stats?.memory?.external ?? null,
      tick: health.rooms != null ? undefined : undefined,
      players: clients.filter((c) => !c.closed && c.messages > 0).length,
      closed: clients.filter((c) => c.closed).length,
      uptimeSec: stats?.uptimeSec ?? null,
    };
    appendFileSync(OUT_JSONL, JSON.stringify(row) + "\n");
    if (sampleNo % 4 === 0) console.log("[sample " + sampleNo + "] heapUsed=" + (row.heapUsed ? (row.heapUsed / 1048576).toFixed(1) + "MB" : "?") + " rss=" + (row.rss ? (row.rss / 1048576).toFixed(0) + "MB" : "?") + " closed=" + row.closed);
    sampleNo++;
    return row;
  };
  await sample();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SAMPLE_SEC * 1000));
    await sample();
  }
  console.log("soak finished");
} catch (e) {
  console.error("SOAK FAIL:", e);
  process.exitCode = 1;
} finally {
  clients.forEach((c) => c.close());
  await new Promise((r) => setTimeout(r, 300));
  await server.close();
  if (existsSync(OUT_JSONL)) analyze();
}
