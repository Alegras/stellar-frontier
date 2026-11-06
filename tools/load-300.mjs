#!/usr/bin/env node
/**
 * Нагрузочный тест MMO 300 CCU (M11/1.0): 3 комнаты × 100 WS-клиентов.
 * Метрики: join/start, ошибки, interest management (видимые системы < всех),
 * gzip-размер full_state (бюджет 1.5 МБ) и снапшота, steady-трафик, RSS.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/load-300.mjs [--clients 300] [--observe 8]
 */
import { gzipSync } from "node:zlib";
const { createServer } = await import("../apps/api/src/server.ts");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const CLIENTS = arg("--clients", 300);
const ROOMS = arg("--rooms", 3);
const OBSERVE_S = arg("--observe", 8);
const PER_ROOM = Math.ceil(CLIENTS / ROOMS);
const BUDGET_GZIP = 1.5 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (pred, timeout, label) => new Promise((res, rej) => {
  const t0 = Date.now();
  const loop = async () => {
    try { const v = await pred(); if (v) return res(v); } catch (e) { return rej(e); }
    if (Date.now() - t0 > timeout) return rej(new Error("timeout: " + label));
    setTimeout(loop, 20);
  };
  loop();
});

class Client {
  constructor(url, seat, room) {
    this.seat = seat; this.room = room; this.bytes = 0; this.messages = 0; this.errors = 0; this.closed = false;
    this.firstSnapshot = null; this.fullState = null; this.snapshotSamples = 0;
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (ev) => {
      const s = String(ev.data);
      this.bytes += Buffer.byteLength(s, "utf8");
      this.messages++;
      let m; try { m = JSON.parse(s); } catch { return; }
      if (m.t === "full_state") {
        this.fullState = { tick: m.tick, world: this.seat === 0 ? m.world : undefined, rawBytes: Buffer.byteLength(s, "utf8") };
      } else if (m.t === "snapshot") {
        this.snapshotSamples++;
        if (!this.firstSnapshot) this.firstSnapshot = m;
      }
    });
    this.ws.addEventListener("error", (ev) => {
      this.errors++;
      this.errorDetail = (ev && ev.error && ev.error.message) || ev.message || ev.type;
      if (this.errors <= 3) console.error("[ws-error] seat=" + this.seat + " room=" + this.room + " detail=" + this.errorDetail);
    });
    this.closeCode = 0; this.closeReason = "";
    this.ws.addEventListener("close", (ev) => {
      this.closed = true; this.closeCode = ev.code; this.closeReason = ev.reason;
      if (this.messages === 0) console.error("[close-before-open] seat=" + this.seat + " room=" + this.room + " code=" + ev.code);
    });
  }
  open(t = 60000) { return waitFor(() => this.ws.readyState === 1, t, "ws open"); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const rss0 = process.memoryUsage().rss;
const server = await createServer({
  persistence: "none", log: () => {},
  mmoTickMs: 1000, mmoSnapshotMs: 1000, reconnectGraceMs: 5000, pauseCooldownMs: 250,
  httpRatePerMin: 100000,
});
const listenUrl = await server.listen(0, "0.0.0.0");
const port = Number(new URL(listenUrl).port);
// Node WebSocket-клиент держит пул соединений на origin (~200) — для 300 CCU раскладываем
// клиентов по loopback-адресам 127.0.0.N (один и тот же сервер, разные origin).
const roomBase = (r) => "http://127.0.0." + (r + 1) + ":" + port;
const postRoom = (r, p, b) => fetch(roomBase(r) + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

const rooms = [];
const clients = [];
const t0 = Date.now();
try {
  for (let r = 0; r < ROOMS; r++) {
    const created = await (await postRoom(r, "/rooms", { modeId: "mmo", nick: "host" + r, seed: 100 + r })).json();
    if (!created.wsUrl) throw new Error("room create failed: " + JSON.stringify(created));
    const joins = await Promise.all(Array.from({ length: PER_ROOM - 1 }, (_, i) =>
      postRoom(r, "/rooms/" + created.code + "/join", { nick: "p" + r + "_" + i }).then((x) => x.json())));
    for (const j of joins) if (!j.wsUrl) throw new Error("join failed: " + JSON.stringify(j));
    rooms.push({ created, joins });
  }
  const createMs = Date.now() - t0;
  console.log("rooms=" + ROOMS + " clients/room=" + PER_ROOM + " create+join=" + createMs + "ms");

  const entries = [];
  for (let r = 0; r < ROOMS; r++) {
    const seats = [rooms[r].created, ...rooms[r].joins];
    for (const seat of seats) entries.push({ client: new Client(seat.wsUrl.replace("http", "ws"), seat.seat, r), seat });
  }
  clients.push(...entries.map((e) => e.client));
  // волнами; hello шлём сразу после open, иначе сервер закроет по helloDeadline (5 c) под нагрузкой.
  let openDone = 0;
  for (let i = 0; i < entries.length; i += 20) {
    const wave = entries.slice(i, i + 20);
    await Promise.all(wave.map(async ({ client, seat }) => {
      try {
        await client.open(60000);
        client.send({ t: "hello", protocol: 1, roomCode: seat.code, token: seat.token });
        openDone++;
      } catch (e) {
        console.error("[open-fail] seat=" + client.seat + " room=" + client.room + " readyState=" + client.ws.readyState);
        throw e;
      }
    }));
    await sleep(30);
  }
  console.log("opened+hello sent=" + openDone + "/" + entries.length);
  const helloMs = Date.now() - t0;
  await waitFor(() => clients.every((c) => c.messages > 0), 30000, "welcome");
  for (let r = 0; r < ROOMS; r++) clients.slice(r * PER_ROOM, (r + 1) * PER_ROOM).forEach((c) => c.send({ t: "ready", ready: true }));
  await sleep(500);
  for (let r = 0; r < ROOMS; r++) clients[r * PER_ROOM].send({ t: "start" });
  await waitFor(() => clients.every((c) => c.fullState !== null), 90000, "full_state all");
  const startMs = Date.now() - t0;
  console.log("hello=" + helloMs + "ms start+full_state=" + startMs + "ms");

  const full = clients[0].fullState;
  if (!full || !full.world) throw new Error("full_state world не сохранён у клиента seat 0");
  const gzFull = gzipSync(full.world).length;
  await waitFor(() => clients.some((c) => c.firstSnapshot), 15000, "snapshot");
  const snap = clients.find((c) => c.firstSnapshot).firstSnapshot;
  const gzSnap = gzipSync(JSON.stringify(snap)).length;
  const worldSystems = JSON.parse(full.world).systems.length;
  const visible = snap.systems.length;
  console.log("full_state gzip=" + (gzFull / 1024).toFixed(1) + "KB (budget 1536KB), snapshot gzip=" + (gzSnap / 1024).toFixed(2) + "KB");
  console.log("interest management: visible systems=" + visible + "/" + worldSystems);

  const before = clients.map((c) => c.bytes);
  await sleep(OBSERVE_S * 1000);
  const steady = clients.reduce((sum, c, k) => sum + (c.bytes - before[k]), 0);
  const rawPerClientSec = steady / clients.length / OBSERVE_S;
  const gzBytesPerHour = gzSnap * 3600;
  const errors = clients.reduce((n, c) => n + c.errors, 0) + clients.filter((c) => c.closed).length;
  const rss1 = process.memoryUsage().rss;

  const summary = {
    clients: clients.length,
    rooms: ROOMS,
    createJoinMs: createMs,
    startFullStateMs: startMs,
    fullStateGzipKB: Number((gzFull / 1024).toFixed(1)),
    fullStateBudgetKB: 1536,
    fullStateBudgetOk: gzFull <= BUDGET_GZIP,
    snapshotGzipKB: Number((gzSnap / 1024).toFixed(2)),
    visibleSystems: visible,
    totalSystems: worldSystems,
    interestOk: visible > 0 && visible < worldSystems,
    rawMBPerHourPerClient: Number(((rawPerClientSec * 3600) / 1048576).toFixed(1)),
    gzipSnapshotMBPerHourPerClient: Number((gzBytesPerHour / 1048576).toFixed(1)),
    errors,
    rssBeforeMB: Math.round(rss0 / 1048576),
    rssAfterMB: Math.round(rss1 / 1048576),
    rssGrowthMB: Math.round((rss1 - rss0) / 1048576),
  };
  console.log(JSON.stringify(summary, null, 2));
  const ok = summary.fullStateBudgetOk && summary.interestOk && errors === 0 && summary.startFullStateMs < 60000;
  console.log(ok ? "LOAD-300 PASS" : "LOAD-300 WARN/FAIL");
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error("LOAD-300 FAIL:", e);
  process.exitCode = 1;
} finally {
  clients.forEach((c) => c.close());
  await sleep(300);
  await server.close();
}