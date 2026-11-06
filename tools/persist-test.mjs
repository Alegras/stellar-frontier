#!/usr/bin/env node
/**
 * Интеграционный тест персистентности MMO/кооп (M11/M12) — file-store, без PostgreSQL/Redis.
 *
 * Сценарий: поднять API с SF_DATA_DIR=tmp, создать комнату, стартовать, протикать, поставить паузу,
 * дождаться записи снапшота в .data/rooms/<code>.json, убить процесс SIGKILL, поднять снова,
 * по токену получить welcome(resumed)+full_state с ТЕМ ЖЕ тиком и ТЕМ ЖЕ миром.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/persist-test.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NODE_EXE = process.env.SF_NODE ?? process.execPath;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = await mkdtemp(path.join(tmpdir(), "sf-persist-"));
const log = (line) => console.log(line);
let passed = 0;
const pass = (name, detail) => { passed++; console.log("PASS " + name + (detail ? " — " + detail : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (pred, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const loop = async () => {
    try { const v = await pred(); if (v) return resolve(v); } catch (e) { return reject(e); }
    if (Date.now() - t0 > timeout) return reject(new Error("timeout: " + label));
    setTimeout(loop, 25);
  };
  loop();
});

class WsClient {
  constructor(url) {
    this.url = url; this.inbox = []; this.waiters = []; this.closed = false;
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      this.inbox.push(m);
      for (let i = 0; i < this.waiters.length; i++) if (this.waiters[i].pred(m)) { const w = this.waiters.splice(i, 1)[0]; w.resolve(m); break; }
    });
    this.ws.addEventListener("close", () => { this.closed = true; });
  }
  open(timeout = 8000) { return waitFor(() => this.ws.readyState === 1, timeout, "ws open"); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  next(pred, timeout = 10000, label = "msg") {
    const found = this.inbox.find(pred);
    if (found) { this.inbox.splice(this.inbox.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout " + label + "; inbox=" + JSON.stringify(this.inbox.map((m) => m.t)))), timeout);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

function startApi() {
  const child = spawn(NODE_EXE, ["--import", "tsx", "apps/api/src/server.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      SF_PERSISTENCE: "file",
      SF_DATA_DIR: DATA_DIR,
      SF_COOP_TICK_MS: "200",
      SF_COOP_SNAPSHOT_MS: "200",
      SF_PERSIST_INTERVAL_MS: "200",
      SF_RECONNECT_GRACE_MS: "30000",
      SF_PAUSE_COOLDOWN_MS: "100",
      SF_ADMIN_TOKEN: "test-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("API не стартовал за 40 с")), 40_000);
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error("API завершился: " + code + "\n" + buf)); });
  });
  return { child, ready };
}

async function http(base, path, opts) {
  const res = await fetch(base + path, opts);
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const children = [];
try {
  log("data dir: " + DATA_DIR);
  let api = startApi();
  children.push(api.child);
  let base = await api.ready;
  pass("API #1 запущен", base);

  // создать комнату и второго игрока
  const created = (await http(base, "/rooms", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ modeId: "coop", nick: "Alice", seed: 42 }),
  })).json;
  const joined = (await http(base, "/rooms/" + created.code + "/join", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ nick: "Bob" }),
  })).json;
  assert.ok(created.code && created.token && joined.token);

  const a = new WsClient(created.wsUrl);
  const b = new WsClient(joined.wsUrl);
  await a.open(); await b.open();
  a.send({ t: "hello", protocol: 1, roomCode: created.code, token: created.token });
  b.send({ t: "hello", protocol: 1, roomCode: joined.code, token: joined.token });
  await a.next((m) => m.t === "welcome");
  await b.next((m) => m.t === "welcome");
  pass("ws hello", "code=" + created.code);

  a.send({ t: "ready", ready: true });
  b.send({ t: "ready", ready: true });
  await a.next((m) => m.t === "room" && m.room.players.every((p) => p.ready), 8000, "ready");
  a.send({ t: "start" });
  await a.next((m) => m.t === "started", 20000, "started");
  await a.next((m) => m.t === "full_state", 20000, "full_state #1");
  pass("start + full_state");

  // дождаться нескольких тактов
  await waitFor(async () => {
    const snap = await a.next((m) => m.t === "snapshot", 5000, "snap tick");
    return snap.tick >= 3 ? snap : false;
  }, 20000, "ticks >= 3");
  pass("ticks advance", ">=3");

  // пауза голосованием (2/2) → тик замирает
  a.send({ t: "vote_pause", pause: true });
  b.send({ t: "vote_pause", pause: true });
  await a.next((m) => m.t === "session" && m.paused === true, 8000, "paused");
  a.send({ t: "resync" });
  // resync может вернуть full_state, отправленный до паузы — ждём именно paused-снимок
  let frozen = null;
  for (let i = 0; i < 10; i++) {
    const candidate = await a.next((m) => m.t === "full_state", 10000, "full_state frozen");
    if (candidate.paused === true) { frozen = candidate; break; }
  }
  assert.ok(frozen, "не получили paused full_state");
  const frozenTick = frozen.tick;
  const frozenWorld = frozen.world;
  console.log("frozen: tick=" + frozenTick + " world=" + frozenWorld.length + " paused=" + frozen.paused);
  assert.ok(frozenTick >= 3);
  assert.ok(frozenWorld.length > 1000);
  pass("frozen state", "tick=" + frozenTick + " world=" + frozenWorld.length + "B");

  // снапшот должен лечь в файл (debounce 200 мс)
  const roomFile = path.join(DATA_DIR, "rooms", created.code + ".json");
  const saved = await waitFor(async () => {
    try {
      const rec = JSON.parse(await readFile(roomFile, "utf8"));
      return rec.tick === frozenTick && rec.world === frozenWorld ? rec : false;
    } catch { return false; }
  }, 10000, "file snapshot");
  assert.equal(saved.state, "active");
  assert.equal(saved.seats.length, 2);
  assert.equal(saved.tick, frozenTick);
  pass("file-store snapshot", "file=" + path.basename(roomFile) + " bytes=" + saved.world.length);

  // kill -9 (без graceful flush): данные должны пережить
  a.close(); b.close();
  await sleep(150);
  api.child.kill("SIGKILL");
  await waitFor(() => api.child.killed || api.child.exitCode !== null, 10000, "api #1 exit");
  pass("API #1 убит (SIGKILL)");

  // поднять заново с тем же data dir
  api = startApi();
  children.push(api.child);
  base = await api.ready;
  pass("API #2 запущен", base);

  const room = (await http(base, "/rooms/" + created.code)).json;
  assert.equal(room.state, "active");
  assert.equal(room.players.length, 2);
  assert.equal(room.tick, frozenTick);
  pass("room восстановлена", "state=" + room.state + " players=" + room.players.length + " tick=" + room.tick);

  // join по токену → welcome(resumed)+full_state с тем же тиком/миром
  // wsUrl из первого процесса указывает на старый порт — строим адрес от нового base.
  const wsBase = base.replace(/^http/, "ws") + "/ws";
  const c = new WsClient(wsBase + "?code=" + joined.code + "&token=" + joined.token);
  const welcome = await c.next((m) => m.t === "welcome", 15000, "welcome resume");
  assert.equal(welcome.resumed, true);
  assert.equal(welcome.seat, 1);
  const full = await c.next((m) => m.t === "full_state", 20000, "full_state resume");
  assert.equal(full.tick, frozenTick, "тик после рестарта совпадает");
  assert.equal(full.world, frozenWorld, "мир после рестарта идентичен (serializeWorld)");
  pass("reconnect after restart", "seat=" + welcome.seat + " tick=" + full.tick + " world identical");
  c.close();

  // админ-статистика и flush
  const stats = await http(base, "/admin/stats", { headers: { "x-admin-token": "test-token" } });
  assert.equal(stats.status, 200);
  assert.equal(stats.json.persistence, "file");
  assert.ok(stats.json.rooms >= 1);
  const flush = await http(base, "/admin/flush", { method: "POST", headers: { "x-admin-token": "test-token" } });
  assert.equal(flush.status, 200);
  const denied = await http(base, "/admin/flush", { method: "POST" });
  assert.equal(denied.status, 403);
  pass("admin stats/flush/guard", "stats.rooms=" + stats.json.rooms);

  // сезон
  const season = await http(base, "/season");
  assert.equal(season.status, 200);
  assert.equal(season.json.season, null);
  const reset = await http(base, "/season/reset", { method: "POST", headers: { "x-admin-token": "test-token" } });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.season.epoch, 1);
  pass("season reset", reset.json.season.seasonId);

  // Второй рестарт: комната удалена сезонным сбросом? (reset удаляет только mmo) — комната coop осталась
  const room2 = (await http(base, "/rooms/" + created.code)).json;
  assert.equal(room2.code, created.code);
  pass("coop room survived season reset");

  c.close?.();
} catch (e) {
  console.error("FAIL:", e);
  process.exitCode = 1;
} finally {
  for (const child of children) {
    try { child.removeAllListeners("exit"); child.kill("SIGKILL"); } catch { /* ignore */ }
  }
  await sleep(200);
  await rm(DATA_DIR, { recursive: true, force: true }).catch(() => undefined);
}

if (!process.exitCode) console.log("PERSIST TEST: " + passed + " проверок PASS");