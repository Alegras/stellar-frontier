#!/usr/bin/env node
/**
 * Интеграционный тест мультиплеера M11 (2 WebSocket-клиента, реальный сервер в процессе).
 *
 * Проверяет: создание/вход в комнату по коду, hello/welcome, ready/start, full_state,
 * команды с проверкой принадлежности, rate limit, снапшоты у обоих клиентов (синхронность),
 * голосование за паузу, тактический лок, чат, реконнект по токену, HTTP health/modes.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/mp-test.mjs
 */
import assert from "node:assert/strict";

const { createServer } = await import("../apps/api/src/server.ts");

const results = [];
function pass(name, detail) { results.push({ name, ok: true, detail }); console.log("PASS " + name + (detail ? " — " + detail : "")); }
function fail(name, err) { results.push({ name, ok: false, detail: String(err && err.message ? err.message : err) }); console.log("FAIL " + name + " — " + (err && err.message ? err.message : err)); }

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      try {
        const v = predicate();
        if (v) return resolve(v);
      } catch (e) { return reject(e); }
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout: " + label));
      setTimeout(tick, 15);
    };
    tick();
  });
}

class WsClient {
  constructor(url) {
    this.url = url;
    this.ws = new WebSocket(url);
    this.inbox = [];
    this.waiters = [];
    this.closed = false;
    this.ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.inbox.push(msg);
      this.flush();
    });
    this.ws.addEventListener("close", () => { this.closed = true; this.flush(); });
  }
  flush() {
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      const idx = this.inbox.findIndex(w.pred);
      if (idx >= 0) {
        const [msg] = this.inbox.splice(idx, 1);
        this.waiters.splice(i, 1);
        i--;
        w.resolve(msg);
      }
    }
  }
  open(timeoutMs = 4000) {
    return waitFor(() => this.ws.readyState === 1, timeoutMs, "ws open");
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  next(pred, timeoutMs = 6000, label = "message") {
    const idx = this.inbox.findIndex(pred);
    if (idx >= 0) return Promise.resolve(this.inbox.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error("timeout waiting " + label + "; inbox=" + JSON.stringify(this.inbox.map((m) => m.t))));
      }, timeoutMs);
      const waiter = { pred, resolve: (m) => { clearTimeout(timer); resolve(m); } };
      this.waiters.push(waiter);
    });
  }
  async hello(roomCode, token) {
    await this.open();
    this.send({ t: "hello", protocol: 1, roomCode, token });
    return this.next((m) => m.t === "welcome", 8000, "welcome");
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const server = await createServer({
  persistence: "none", // unit-тест протокола — без записи в .data/
  coopTickMs: 120,
  coopSnapshotMs: 120,
  reconnectGraceMs: 3000,
  pauseCooldownMs: 250,
  log: () => {},
});
const base = await server.listen(0, "127.0.0.1");
const wsBase = base.replace(/^http/, "ws") + "/ws";
console.log("server:", base);
const http = (path, opts) => fetch(base + path, opts);

let a, b;
try {
  // --- HTTP: modes/health ---
  const modesRes = await http("/modes");
  const modes = await modesRes.json();
  assert.ok(Array.isArray(modes) && modes.some((m) => m.modeId === "coop") && modes.some((m) => m.modeId === "mmo"), "modes coop/mmo");
  const mmoMode = modes.find((m) => m.modeId === "mmo");
  assert.ok(mmoMode && mmoMode.playersMax >= 30 && mmoMode.playersMax <= 100, "MMO 30–100 игроков");
  pass("HTTP /modes", modes.map((m) => m.modeId + ":" + m.playersMax).join(", "));

  // MMO-комната: создаётся, лимит мест 30–100, пауза запрещена политикой
  const mmoRes = await http("/rooms", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ modeId: "mmo", nick: "Captain" }),
  });
  assert.equal(mmoRes.status, 200);
  const mmoRoom = await mmoRes.json();
  assert.ok(mmoRoom.room.maxSeats >= 30 && mmoRoom.room.maxSeats <= 100, "maxSeats MMO");
  pass("MMO room", "code=" + mmoRoom.code + " maxSeats=" + mmoRoom.room.maxSeats);

  const health0 = await (await http("/health")).json();
  assert.equal(health0.ok, true);
  pass("HTTP /health", "protocol=" + health0.protocol);

  // --- создание комнаты и вход по коду ---
  const createRes = await http("/rooms", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ modeId: "coop", nick: "Alice", seed: 42 }),
  });
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.match(created.code, /^[A-Z0-9]{4,8}$/);
  assert.equal(created.seat, 0);
  assert.ok(created.token.length > 8);
  assert.ok(created.wsUrl.includes("/ws"));
  pass("HTTP POST /rooms", "code=" + created.code + " seat=" + created.seat);

  const joinRes = await http("/rooms/" + created.code + "/join", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ nick: "Bob" }),
  });
  assert.equal(joinRes.status, 200);
  const joined = await joinRes.json();
  assert.equal(joined.seat, 1);
  pass("HTTP POST join", "seat=" + joined.seat + " code=" + joined.code);

  const info = await (await http("/rooms/" + created.code)).json();
  assert.equal(info.players.length, 2);
  assert.equal(info.state, "lobby");
  pass("HTTP GET room", "players=" + info.players.map((p) => p.nick).join(","));

  // --- WS hello ---
  a = new WsClient(created.wsUrl);
  b = new WsClient(joined.wsUrl);
  const wa = await a.hello(created.code, created.token);
  const wb = await b.hello(joined.code, joined.token);
  assert.equal(wa.seat, 0);
  assert.equal(wb.seat, 1);
  assert.equal(wa.protocol, 1);
  pass("WS hello/welcome", "seats " + wa.seat + "/" + wb.seat);

  // --- ready/start ---
  a.send({ t: "ready", ready: true });
  b.send({ t: "ready", ready: true });
  await a.next((m) => m.t === "room" && m.room.players.every((p) => p.ready), 4000, "room ready");
  a.send({ t: "start" });
  const startedA = await a.next((m) => m.t === "started", 15000, "started");
  await b.next((m) => m.t === "started", 15000, "started B");
  const fullA = await a.next((m) => m.t === "full_state", 15000, "full_state A");
  const fullB = await b.next((m) => m.t === "full_state", 15000, "full_state B");
  const world = JSON.parse(fullA.world);
  assert.ok(world.tick >= 0);
  assert.ok(world.empires.length >= 2);
  assert.equal(fullB.tick, fullA.tick);
  pass("start + full_state", "tick=" + fullA.tick + " worldEMP=" + world.empires.length + " mode=" + startedA.modeId);

  // --- команды: своя и чужая ---
  const aliceEmpire = world.empires.find((e) => e.id === (world.playerEmpireId ?? 1));
  // Кооп = shared empire (M11-lite): оба места управляют одной империей, victory по playerEmpireId корректен.
  const seatEmpires = fullA.players.map((p) => p.empireId);
  assert.ok(seatEmpires.every((id) => id === aliceEmpire.id), "coop shared empire: " + JSON.stringify(seatEmpires));
  pass("coop shared empire", "seats empire=" + JSON.stringify(seatEmpires));
  const aliceFleet = world.fleets.find((f) => f.empireId === aliceEmpire.id);
  const foreignFleet = world.fleets.find((f) => f.empireId !== aliceEmpire.id && f.empireId > 0 && f.ships.length > 0);
  assert.ok(aliceFleet && foreignFleet, "fleet for player and AI");
  const target = world.systems[aliceFleet.systemId].links[0];
  a.send({ t: "cmd", seq: 1, cmd: { type: "move_fleet", fleetId: aliceFleet.id, systemId: target } });
  const ack1 = await a.next((m) => m.t === "cmd_ack" && m.seq === 1, 5000, "ack1");
  assert.equal(ack1.ok, true, "move own fleet: " + ack1.reason);
  pass("cmd own fleet", "seq=1 ok tick=" + ack1.tick);

  const foreignTarget = world.systems[foreignFleet.systemId].links[0] ?? target;
  a.send({ t: "cmd", seq: 2, cmd: { type: "move_fleet", fleetId: foreignFleet.id, systemId: foreignTarget } });
  const ack2 = await a.next((m) => m.t === "cmd_ack" && m.seq === 2, 5000, "ack2");
  assert.equal(ack2.ok, false);
  assert.match(ack2.reason ?? "", /не ваш/i);
  pass("cmd ownership reject", "reason=" + ack2.reason);

  a.send({ t: "cmd", seq: 3, cmd: { type: "set_speed", speed: 5 } });
  const ack3 = await a.next((m) => m.t === "cmd_ack" && m.seq === 3, 5000, "ack3");
  assert.equal(ack3.ok, false);
  pass("cmd whitelist reject", "reason=" + ack3.reason);

  // --- rate limit ---
  for (let i = 10; i < 25; i++) a.send({ t: "cmd", seq: i, cmd: { type: "stop_fleet", fleetId: aliceFleet.id } });
  const acks = [];
  for (let i = 10; i < 25; i++) acks.push(await a.next((m) => m.t === "cmd_ack" && m.seq === i, 6000, "ack rate " + i));
  const limited = acks.filter((x) => !x.ok && /rate limit/i.test(x.reason ?? ""));
  assert.ok(limited.length >= 1, "rate limit должен сработать");
  pass("rate limit", limited.length + "/15 отклонено");

  // --- синхронные снапшоты ---
  const snapA = await a.next((m) => m.t === "snapshot", 4000, "snapshot A");
  const snapB = await b.next((m) => m.t === "snapshot", 4000, "snapshot B");
  assert.ok(snapA.tick >= 0);
  assert.ok(snapA.fleets.length > 0);
  // interest management: снапшот содержит только видимые системы (подмножество)
  assert.ok(snapA.systems.length > 0 && snapA.systems.length <= world.systems.length, "systems subset");
  pass("snapshot", "tick=" + snapA.tick + " fleets=" + snapA.fleets.length + " players=" + snapA.players.length);

  const tickStart = snapA.tick;
  const laterA = await a.next((m) => m.t === "snapshot" && m.tick > tickStart, 5000, "snapshot tick grow");
  const laterB = await b.next((m) => m.t === "snapshot" && m.tick >= laterA.tick, 5000, "snapshot B sync");
  assert.ok(laterA.tick >= tickStart);
  assert.ok(laterB.systems.length >= 1);
  pass("snapshots sync", "ticks " + tickStart + "->" + laterA.tick);

  // --- голосование за паузу ---
  a.send({ t: "vote_pause", pause: true });
  b.send({ t: "vote_pause", pause: true });
  const paused = await a.next((m) => m.t === "session" && m.paused === true, 5000, "pause session");
  await b.next((m) => m.t === "session" && m.paused === true, 5000, "pause session B");
  pass("pause vote", "paused: " + paused.reason);
  await waitFor(() => true, 100, "noop");
  const tickPaused = (await a.next((m) => m.t === "snapshot", 4000, "paused snapshot")).tick;
  await new Promise((r) => setTimeout(r, 400));
  const snapPaused2 = await a.next((m) => m.t === "snapshot", 4000, "paused snapshot2");
  assert.equal(snapPaused2.tick, tickPaused, "тик не идёт на паузе");
  pass("pause freezes tick", "tick=" + tickPaused);

  a.send({ t: "vote_pause", pause: false });
  b.send({ t: "vote_pause", pause: false });
  await a.next((m) => m.t === "session" && m.paused === false, 5000, "resume session");
  pass("resume vote");

  // --- тактический лок ---
  a.send({ t: "tactical_lock", systemId: aliceFleet.systemId, pvp: false });
  const lockMsg = await a.next((m) => m.t === "tactical_lock", 4000, "tactical lock");
  assert.equal(lockMsg.seat, 0);
  assert.ok(lockMsg.ticksLeft >= 85 && lockMsg.ticksLeft <= 90, "90 c лок");
  const snapLock = await a.next((m) => m.t === "snapshot" && m.tacticalLock != null, 4000, "snapshot lock");
  assert.equal(snapLock.tacticalLock.seat, 0);
  pass("tactical lock", "ticksLeft=" + lockMsg.ticksLeft);

  // Пауза во время лока должна отклоняться
  b.send({ t: "vote_pause", pause: true });
  const lockPause = await b.next((m) => m.t === "notice" && m.code === "pause_vote_failed", 3000, "pause blocked by lock");
  assert.match(lockPause.message, /лок/i);
  pass("tactical lock blocks pause", lockPause.message);

  a.send({ t: "tactical_unlock" });
  await a.next((m) => m.t === "tactical_unlock", 3000, "tactical unlock");
  pass("tactical unlock");

  // --- чат ---
  a.send({ t: "chat", text: "Привет, Боб" });
  const chatB = await b.next((m) => m.t === "chat" && m.text === "Привет, Боб", 3000, "chat B");
  assert.equal(chatB.seat, 0);
  assert.equal(chatB.nick, "Alice");
  pass("chat", chatB.nick + ": " + chatB.text);

  // --- реконнект по токену ---
  b.close();
  await new Promise((r) => setTimeout(r, 250));
  const b2 = new WsClient(joined.wsUrl + "?code=" + joined.code + "&token=" + joined.token);
  const welcome2 = await b2.next((m) => m.t === "welcome", 6000, "welcome reconnect");
  assert.equal(welcome2.seat, 1);
  assert.equal(welcome2.resumed, true);
  const full2 = await b2.next((m) => m.t === "full_state", 8000, "full_state reconnect");
  assert.ok(JSON.parse(full2.world).empires.length >= 2);
  pass("reconnect by token", "seat=" + welcome2.seat + " resumed=" + welcome2.resumed + " tick=" + full2.tick);

  // --- неверный токен ---
  const bad = new WsClient(joined.wsUrl + "?code=" + joined.code + "&token=deadbeefdeadbeef");
  const err = await bad.next((m) => m.t === "error" && m.code === "auth_failed", 4000, "auth error");
  assert.ok(err.message.length > 0);
  bad.close();
  pass("auth reject", err.message);

  // --- MMO: отдельные империи на seat, паузы нет ---
  const mmoCreate = await (await http("/rooms", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ modeId: "mmo", nick: "Neo", seed: 7 }),
  })).json();
  const mmoJoin = await (await http("/rooms/" + mmoCreate.code + "/join", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ nick: "Trinity" }),
  })).json();
  const m1 = new WsClient(mmoCreate.wsUrl);
  const m2 = new WsClient(mmoJoin.wsUrl);
  await m1.hello(mmoCreate.code, mmoCreate.token);
  await m2.hello(mmoJoin.code, mmoJoin.token);
  m1.send({ t: "ready", ready: true });
  m2.send({ t: "ready", ready: true });
  await m1.next((m) => m.t === "room" && m.room.players.every((p) => p.ready), 4000, "mmo room ready");
  m1.send({ t: "start" });
  const mmoFull = await m1.next((m) => m.t === "full_state", 20000, "mmo full_state");
  const mmoPlayers = JSON.parse(mmoFull.world).playerEmpireId;
  const ids = mmoFull.players.map((p) => p.empireId);
  assert.notEqual(ids[0], ids[1], "MMO: у мест разные империи");
  m2.send({ t: "vote_pause", pause: true });
  const mmoPause = await m2.next((m) => m.t === "notice" && m.code === "pause_vote_failed", 4000, "mmo pause reject");
  assert.match(mmoPause.message, /запрещена/i);
  pass("MMO separate empires", "seatEmpires=" + JSON.stringify(ids) + " (first=" + mmoPlayers + ")");
  pass("MMO no pause", mmoPause.message);
  m1.close();
  m2.close();

  // --- комната: занятость/неизвестная ---
  const missing = await http("/rooms/ZZZZZ");
  assert.equal(missing.status, 404);
  pass("HTTP 404 room");

  b2.close();
  a.close();
  await new Promise((r) => setTimeout(r, 150));
} catch (e) {
  fail("test", e);
} finally {
  try { a?.close(); } catch { /* ignore */ }
  try { b?.close(); } catch { /* ignore */ }
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log("");
console.log("ИТОГ: " + (results.length - failed.length) + "/" + results.length + " проверок PASS");
if (failed.length > 0) {
  console.log("FAILED: " + failed.map((f) => f.name).join(", "));
  process.exitCode = 1;
}