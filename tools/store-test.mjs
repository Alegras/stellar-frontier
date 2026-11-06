#!/usr/bin/env node
/**
 * Unit-тест FileStore (персистентность M11/M12): roundtrip комнаты/мира, сезон, TTL-очистка,
 * атомарные конкурентные записи, устойчивость к битым файлам. Без PostgreSQL/Redis.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/store-test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { FileStore } = await import("../apps/api/src/store/file-store.ts");
const { createPersistence, defaultDataDir } = await import("../apps/api/src/store/index.ts");

const dir = await mkdtemp(path.join(tmpdir(), "sf-store-"));
let passed = 0;
const pass = (name, detail) => { passed++; console.log("PASS " + name + (detail ? " — " + detail : "")); };

try {
  const store = new FileStore(dir);
  await store.init();
  assert.equal(store.kind, "file");

  const room = {
    code: "ABCDE",
    modeId: "coop",
    seed: 42,
    state: "active",
    hostSeat: 0,
    createdAt: 1000,
    updatedAt: Date.now(),
    finishedAt: null,
    tick: 17,
    world: '{"schemaVersion":1,"tick":17,"seed":42}',
    seats: [
      { seat: 0, nick: "Alice", tokenHash: "a".repeat(64), tokenExpiresAt: Date.now() + 3600_000, ready: true, empireId: 1 },
      { seat: 1, nick: "Bob", tokenHash: "b".repeat(64), tokenExpiresAt: Date.now() + 3600_000, ready: true, empireId: 2 },
    ],
    seasonId: null,
  };
  await store.saveRoom(room);
  const loaded = await store.loadRooms();
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], room);
  pass("saveRoom/loadRooms roundtrip", "tick=" + loaded[0].tick + " seats=" + loaded[0].seats.length);

  // атомарность: 20 конкурентных записей одного файла → последняя валидна
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.saveRoom({ ...room, tick: i })));
  const after = await store.loadRooms();
  assert.equal(after.length, 1);
  assert.ok(Number.isInteger(after[0].tick));
  pass("concurrent writes", "tick=" + after[0].tick);

  // сезон
  assert.equal(await store.getSeason(), null);
  const season = { seasonId: "season-1", startedAt: Date.now(), resetAt: Date.now() + 1000, seed: 777, epoch: 1 };
  await store.saveSeason(season);
  assert.deepEqual(await store.getSeason(), season);
  pass("season roundtrip", season.seasonId);

  // битый файл не ломает восстановление
  await writeFile(path.join(dir, "rooms", "BROKEN.json"), "{не json");
  const rooms2 = await store.loadRooms();
  assert.equal(rooms2.length, 1);
  pass("corrupt file skipped");

  // TTL-очистка
  await store.saveRoom({ ...room, code: "OLD11", updatedAt: Date.now() - 48 * 3600_000, state: "lobby" });
  await store.saveRoom({ ...room, code: "FIN12", state: "finished", finishedAt: Date.now() - 30 * 24 * 3600_000 });
  const removed = await store.cleanup(24 * 3600_000, 7 * 24 * 3600_000);
  const left = (await store.loadRooms()).map((x) => x.code).sort();
  assert.equal(removed, 2);
  assert.deepEqual(left, ["ABCDE"]);
  pass("TTL cleanup", "removed=" + removed + " left=" + left.join(","));

  // удаление и статистика
  await store.deleteRoom("ABCDE");
  assert.equal((await store.loadRooms()).length, 0);
  const stats = await store.stats();
  assert.equal(stats.kind, "file");
  pass("deleteRoom + stats", JSON.stringify(stats));

  // фабрика: без DATABASE_URL → file-store; defaultDataDir учитывает SF_DATA_DIR
  const persistence = await createPersistence({ dataDir: dir, databaseUrl: null, redisUrl: null, log: () => {} });
  assert.equal(persistence.store.kind, "file");
  assert.equal(persistence.redis, null);
  pass("createPersistence fallback", persistence.kind);

  process.env.SF_DATA_DIR = dir;
  assert.equal(defaultDataDir(), dir);
  pass("SF_DATA_DIR env");
} catch (e) {
  console.error("FAIL:", e);
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (!process.exitCode) console.log("STORE TEST: " + passed + " проверок PASS");