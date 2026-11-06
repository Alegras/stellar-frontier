#!/usr/bin/env node
/**
 * РЕАЛЬНЫЙ интеграционный тест PostgreSQL + Redis (M11 hardening).
 * Требует: docker compose -f docker-compose.yml up -d (postgres:17, redis:7).
 *
 * Проверяет: PgStore (save/load/сезон/snapshot-retention/cleanup/stats),
 * RedisSide (presence/кэш/сезон/TTL), сервер с DATABASE_URL+REDIS_URL:
 * комната→старт→пауза→graceful shutdown→рестарт→full_state идентичен, PG-строки и Redis presence на месте.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/pg-redis-test.mjs
 * Env: SF_PG_URL, SF_REDIS_URL (по умолчанию 127.0.0.1 compose-порты).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PG_URL = process.env.SF_PG_URL ?? "postgres://sf:sf@127.0.0.1:5432/stellar_frontier";
const REDIS_URL = process.env.SF_REDIS_URL ?? "redis://127.0.0.1:6379";
const DATA_DIR = await mkdtemp(path.join(tmpdir(), "sf-pg-"));
const NODE_EXE = process.env.SF_NODE ?? process.execPath;
let passed = 0;
const pass = (name, detail) => { passed++; console.log("PASS " + name + (detail ? " — " + detail : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (pred, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const loop = async () => { try { const v = await pred(); if (v) return resolve(v); } catch (e) { return reject(e); } if (Date.now() - t0 > timeout) return reject(new Error("timeout: " + label)); setTimeout(loop, 25); };
  loop();
});

const { PgStore } = await import("../apps/api/src/store/pg-store.ts");
const { RedisSide } = await import("../apps/api/src/store/redis-side.ts");
const { createServer } = await import("../apps/api/src/server.ts");
const requireFromApi = createRequire(path.join(ROOT, "apps/api/package.json"));
const pg = requireFromApi("pg");

class WsClient {
  constructor(url) {
    this.url = url; this.inbox = []; this.waiters = [];
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      this.inbox.push(m);
      for (let i = 0; i < this.waiters.length; i++) if (this.waiters[i].pred(m)) { const w = this.waiters.splice(i, 1)[0]; w.resolve(m); break; }
    });
  }
  open(t = 8000) { return waitFor(() => this.ws.readyState === 1, t, "ws open"); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  next(pred, t = 10000, label = "msg") {
    const f = this.inbox.find(pred);
    if (f) { this.inbox.splice(this.inbox.indexOf(f), 1); return Promise.resolve(f); }
    return new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error("timeout " + label)), t); this.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); res(m); } }); });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function startApi(env) {
  const child = spawn(NODE_EXE, ["--import", "tsx", "apps/api/src/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", SF_DATA_DIR: DATA_DIR, SF_PERSISTENCE: "auto", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("API timeout")), 40000);
    let buf = "";
    const on = (c) => { buf += c.toString(); const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(buf); if (m) { clearTimeout(timer); res(m[1]); } };
    child.stdout.on("data", on); child.stderr.on("data", on);
    child.on("exit", (code) => { clearTimeout(timer); rej(new Error("API exit " + code + "\n" + buf)); });
  });
  return { child, url };
}
const post = (base, p, body, headers = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const pool = new pg.Pool({ connectionString: PG_URL, max: 3 });
let redis = null;
let api = null;
try {
  // --- 1) PgStore напрямую ---
  const store = new PgStore(PG_URL);
  await store.init();
  await pool.query("TRUNCATE sf_snapshots, sf_rooms, sf_season, sf_presence");
  pass("PgStore init", "schema OK");

  const roomRecord = {
    code: "PGTST", modeId: "mmo", seed: 42, state: "active", hostSeat: 0,
    createdAt: 1000, updatedAt: Date.now(), finishedAt: null, tick: 7,
    world: '{"schemaVersion":1,"tick":7}', seasonId: "season-1",
    seats: [{ seat: 0, nick: "Alice", tokenHash: "a".repeat(64), tokenExpiresAt: Date.now() + 3600_000, ready: true, empireId: 1 }],
  };
  await store.saveRoom(roomRecord);
  const loaded = await store.loadRooms();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].tick, 7);
  assert.deepEqual(loaded[0].seats, roomRecord.seats);
  pass("PG save/load room", "tick=" + loaded[0].tick);

  for (let i = 0; i < 8; i++) await store.saveRoom({ ...roomRecord, tick: 10 + i });
  const snap = await pool.query("SELECT count(*)::int AS n FROM sf_snapshots WHERE code='PGTST'");
  assert.equal(snap.rows[0].n, 5);
  pass("PG snapshots retention", "rows=" + snap.rows[0].n + " (limit 5)");

  const season = { seasonId: "season-pg", startedAt: Date.now(), resetAt: Date.now() + 86400_000, seed: 777, epoch: 2 };
  await store.saveSeason(season);
  assert.deepEqual(await store.getSeason(), season);
  pass("PG season roundtrip", season.seasonId);

  await store.saveRoom({ ...roomRecord, code: "OLD22", updatedAt: Date.now() - 48 * 3600_000, state: "lobby" });
  const removed = await store.cleanup(24 * 3600_000, 7 * 24 * 3600_000);
  assert.ok(removed >= 1);
  assert.equal((await store.loadRooms()).filter((r) => r.code === "OLD22").length, 0);
  pass("PG TTL cleanup", "removed=" + removed);

  const stats = await store.stats();
  assert.equal(stats.kind, "postgres");
  pass("PG stats", JSON.stringify(stats.rooms));

  // --- 2) RedisSide ---
  redis = new RedisSide(REDIS_URL, () => undefined);
  await redis.init();
  assert.equal(redis.available, true);
  await redis.setPresence({ code: "PGTST", players: 2, connected: 1, updatedAt: Date.now() });
  const presence = await redis.getPresence("PGTST");
  assert.equal(presence.players, 2);
  await redis.cacheRoom("PGTST", { code: "PGTST", tick: 5 });
  assert.equal((await redis.getCachedRoom("PGTST")).tick, 5);
  await redis.saveSeason(season);
  assert.equal((await redis.getSeason()).seasonId, "season-pg");
  await redis.dropRoom("PGTST");
  assert.equal(await redis.getPresence("PGTST"), null);
  pass("Redis presence/cache/season", "available=true");
  await redis.close();

  // --- 3) Сервер с реальными PG+Redis: graceful shutdown → рестарт ---
  await pool.query("TRUNCATE sf_snapshots, sf_rooms, sf_season, sf_presence");
  const serverEnv = { DATABASE_URL: PG_URL, REDIS_URL: REDIS_URL, SF_COOP_TICK_MS: "200", SF_COOP_SNAPSHOT_MS: "200", SF_PERSIST_INTERVAL_MS: "200", SF_TEST_PAUSE_COOLDOWN_MS: "100" };
  let a = await startApi(serverEnv);
  api = a;
  const created = await (await post(a.url, "/rooms", { modeId: "coop", nick: "Alice", seed: 42 })).json();
  const joined = await (await post(a.url, "/rooms/" + created.code + "/join", { nick: "Bob" })).json();
  const ca = new WsClient(created.wsUrl); const cb = new WsClient(joined.wsUrl);
  await ca.open(); await cb.open();
  ca.send({ t: "hello", protocol: 1, roomCode: created.code, token: created.token });
  cb.send({ t: "hello", protocol: 1, roomCode: joined.code, token: joined.token });
  await ca.next((m) => m.t === "welcome"); await cb.next((m) => m.t === "welcome");
  ca.send({ t: "ready", ready: true }); cb.send({ t: "ready", ready: true });
  await ca.next((m) => m.t === "room" && m.room.players.every((p) => p.ready), 10000, "ready");
  ca.send({ t: "start" });
  await ca.next((m) => m.t === "started", 20000, "started");
  await ca.next((m) => m.t === "full_state", 20000, "full_state");
  await waitFor(async () => { const s2 = await ca.next((m) => m.t === "snapshot", 4000, "snap"); return s2.tick >= 2 ? s2 : false; }, 20000, "ticks");
  ca.send({ t: "vote_pause", pause: true }); cb.send({ t: "vote_pause", pause: true });
  await ca.next((m) => m.t === "session" && m.paused === true, 8000, "paused");
  ca.send({ t: "resync" });
  let frozen = null;
  for (let i = 0; i < 6; i++) { const f = await ca.next((m) => m.t === "full_state", 10000, "frozen"); if (f.paused) { frozen = f; break; } }
  assert.ok(frozen && frozen.tick >= 2);
  ca.close(); cb.close();
  await sleep(700);
  const redisCheck = new RedisSide(REDIS_URL, () => undefined); await redisCheck.init();
  const presence2 = await redisCheck.getPresence(created.code);
  assert.ok(presence2 && presence2.players === 2, "presence в Redis");
  await redisCheck.close();
  pass("Redis presence от сервера", JSON.stringify(presence2));

  // graceful shutdown: комнаты должны остаться в PG
  await new Promise((res) => { a.child.once("exit", res); a.child.kill("SIGTERM"); });
  const rowsAfterClose = await pool.query("SELECT count(*)::int AS n FROM sf_rooms");
  assert.ok(rowsAfterClose.rows[0].n >= 1, "комната сохранена после graceful shutdown");
  pass("graceful shutdown сохраняет комнату", "rows=" + rowsAfterClose.rows[0].n);

  // рестарт с тем же PG/Redis
  a = await startApi(serverEnv); api = a;
  const room = await (await fetch(a.url + "/rooms/" + created.code)).json();
  assert.equal(room.state, "active");
  assert.equal(room.tick, frozen.tick);
  pass("PG restore после рестарта", "tick=" + room.tick + " players=" + room.players.length);

  const c3 = new WsClient(a.url.replace(/^http/, "ws") + "/ws?code=" + created.code + "&token=" + created.token);
  const welcome = await c3.next((m) => m.t === "welcome", 15000, "welcome");
  assert.equal(welcome.resumed, true);
  const full = await c3.next((m) => m.t === "full_state", 20000, "full");
  assert.equal(full.tick, frozen.tick);
  assert.equal(full.world, frozen.world);
  pass("PG/Redis reconnect full_state идентичен", "tick=" + full.tick + " world=" + full.world.length + "B");
  c3.close();

  const health = await (await fetch(a.url + "/health")).json();
  assert.equal(health.persistence, "postgres+redis");
  pass("health persistence", health.persistence + " season=" + health.season);

  await a.child.kill("SIGKILL");
  await sleep(300);
} catch (e) {
  console.error("FAIL:", e);
  process.exitCode = 1;
} finally {
  try { await pool.query("TRUNCATE sf_snapshots, sf_rooms, sf_season, sf_presence"); } catch { /* ignore */ }
  await pool.end().catch(() => undefined);
  if (redis) await redis.close().catch(() => undefined);
  if (api) { try { api.child.kill("SIGKILL"); } catch { /* ignore */ } }
  await rm(DATA_DIR, { recursive: true, force: true }).catch(() => undefined);
}
if (!process.exitCode) console.log("PG/REDIS TEST: " + passed + " проверок PASS");