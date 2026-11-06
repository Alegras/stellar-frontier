#!/usr/bin/env node
/**
 * НАГРУЗОЧНЫЙ ТЕСТ MMO (M11): 100 WS-клиентов в одной комнате.
 * Замеряет: время входа/старта, байты на клиента (join burst + steady snapshots),
 * экстраполяцию трафика МБ/час на игрока, ошибки/дисконнекты, RSS процесса сервера.
 * Бюджет канона: ≤ 40 МБ/ч на игрока (04 §8.3).
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/load-mmo.mjs [--clients 100] [--observe 6]
 */
const { createServer } = await import("../apps/api/src/server.ts");

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : dflt; };
const CLIENTS = arg("--clients", 100);
// MMO по канону: снапшот 1 раз в 5 с (реальная настройка режима), а не 1 с.
const SNAPSHOT_MS = arg("--snapshot-ms", 5000);
const OBSERVE_S = arg("--observe", 16);
const BUDGET_MB_H = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (pred, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const loop = () => { try { const v = pred(); if (v) return resolve(v); } catch (e) { return reject(e); } if (Date.now() - t0 > timeout) return reject(new Error("timeout: " + label)); setTimeout(loop, 20); };
  loop();
});

class Client {
  constructor(url) {
    this.url = url; this.inbox = []; this.waiters = []; this.bytes = 0; this.messages = 0; this.errors = 0;
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (ev) => {
      const s = String(ev.data);
      this.bytes += Buffer.byteLength(s, "utf8");
      this.messages++;
      let m; try { m = JSON.parse(s); } catch { return; }
      // Не держим в памяти тестового процесса полные снапшоты (иначе нагрузочный тест
      // измеряет память клиентов, а не сервера) — full_state обнуляем, snapshot не храним.
      if (m.t === "full_state") { delete m.world; this.inbox.push(m); }
      else if (m.t !== "snapshot") this.inbox.push(m);
      for (let i = 0; i < this.waiters.length; i++) {
        if (this.waiters[i].pred(m)) { const w = this.waiters.splice(i, 1)[0]; w.resolve(m); break; }
      }
    });
    this.ws.addEventListener("error", () => { this.errors++; });
    this.ws.addEventListener("close", () => { this.closed = true; });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async open() { await waitFor(() => this.ws.readyState === 1, 10000, "ws open"); }
  next(pred, timeout = 30000, label = "msg") {
    const found = this.inbox.find(pred);
    if (found) { this.inbox.splice(this.inbox.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout " + label)), timeout);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const rss0 = process.memoryUsage().rss;
const server = await createServer({
  persistence: "none", // нагрузочный тест — без записи в .data/
  mmoTickMs: 1000, mmoSnapshotMs: SNAPSHOT_MS, log: () => {},
  reconnectGraceMs: 5000, pauseCooldownMs: 250,
});
const base = await server.listen(0, "127.0.0.1");
const http = (p, o) => fetch(base + p, o);
const post = (p, body) => http(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const t0 = Date.now();
const created = await (await post("/rooms", { modeId: "mmo", nick: "host", seed: 42 })).json();
const joins = await Promise.all(
  Array.from({ length: CLIENTS - 1 }, (_, i) => post("/rooms/" + created.code + "/join", { nick: "p" + (i + 1) })),
);
const rooms = [created, ...(await Promise.all(joins.map((r) => r.json()))) ];
console.log("room=" + created.code + " clients=" + rooms.length + " create+join=" + (Date.now() - t0) + "ms");

const clients = rooms.map((r) => new Client(r.wsUrl));
await Promise.all(clients.map((c, i) => c.open().then(() => {
  c.send({ t: "hello", protocol: 1, roomCode: rooms[i].code, token: rooms[i].token });
})));
await Promise.all(clients.map((c) => c.next((m) => m.t === "welcome", 30000, "welcome")));
console.log("hello/welcome: " + (Date.now() - t0) + "ms");

clients.forEach((c) => c.send({ t: "ready", ready: true }));
await clients[0].next((m) => m.t === "room" && m.room.players.every((p) => p.ready), 40000, "all ready");
const tStart = Date.now();
clients[0].send({ t: "start" });
await clients[0].next((m) => m.t === "started", 60000, "started");
await Promise.all(clients.map((c) => c.next((m) => m.t === "full_state", 90000, "full_state")));
const joinMs = Date.now() - t0;
const worldBytes = rooms[0] && clients[0] ? clients[0].inbox.length : 0;
const rss1 = process.memoryUsage().rss;
console.log("started+full_state: " + (Date.now() - tStart) + "ms; join phase total=" + joinMs + "ms; rss=" + Math.round(rss1 / 1048576) + "MB");

// Наблюдение: снапшоты MMO (1 с), считаем прирост байтов на клиента.
const bytesAfterJoin = clients.map((c) => c.bytes);
await sleep(OBSERVE_S * 1000);
const steadyBytes = clients.reduce((sum, c, i) => sum + (c.bytes - bytesAfterJoin[i]), 0);
const joinBytes = bytesAfterJoin.reduce((a, b) => a + b, 0);
const perClientSteady = steadyBytes / CLIENTS / OBSERVE_S; // bytes/sec/user
const perClientJoin = joinBytes / CLIENTS;
const mbPerHour = (perClientSteady * 3600) / 1048576;
const totalErrors = clients.reduce((n, c) => n + c.errors, 0) + clients.filter((c) => c.closed).length;
const rss2 = process.memoryUsage().rss;
const summary = {
  clients: CLIENTS,
  mode: "mmo",
  joinPhaseMs: joinMs,
  startPhaseMs: Date.now() - tStart,
  joinBytesPerClient: Math.round(perClientJoin),
  steadyBytesPerSecPerClient: Math.round(perClientSteady),
  mbPerHourPerClient: Number(mbPerHour.toFixed(2)),
  budgetMbPerHour: BUDGET_MB_H,
  budgetOk: mbPerHour <= BUDGET_MB_H,
  errors: totalErrors,
  rssBeforeMb: Math.round(rss0 / 1048576),
  rssAfterJoinMb: Math.round(rss1 / 1048576),
  rssAfterMb: Math.round(rss2 / 1048576),
  rssGrowthMb: Math.round((rss2 - rss0) / 1048576),
  snapshotMessages: clients[0]?.messages ?? 0,
};
console.log(JSON.stringify(summary, null, 2));

clients.forEach((c) => c.close());
await sleep(200);
await server.close();
if (!summary.budgetOk) { console.error("LOAD FAIL: " + mbPerHour.toFixed(1) + " МБ/ч > " + BUDGET_MB_H); process.exitCode = 1; }
else if (totalErrors > 0) { console.error("LOAD FAIL: ошибки/дисконнекты: " + totalErrors); process.exitCode = 2; }
else console.log("LOAD PASS: " + CLIENTS + " клиентов MMO, " + mbPerHour.toFixed(2) + " МБ/ч на игрока (бюджет " + BUDGET_MB_H + ")");