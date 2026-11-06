/**
 * PgStore: PostgreSQL-хранилище комнат, игроков (в JSONB seats) и снапшотов мира.
 * Включается при DATABASE_URL; при недоступности БД createPersistence откатывается на FileStore.
 */
import pg from "pg";
import type { SeasonInfo, Store, StoredRoom } from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sf_rooms (
  code TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL,
  seed BIGINT NOT NULL,
  state TEXT NOT NULL,
  host_seat INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  finished_at BIGINT,
  tick INTEGER NOT NULL DEFAULT 0,
  season_id TEXT,
  world TEXT,
  seats JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS sf_snapshots (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL REFERENCES sf_rooms(code) ON DELETE CASCADE,
  tick INTEGER NOT NULL,
  world TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sf_snapshots_code_tick ON sf_snapshots(code, tick DESC);
CREATE TABLE IF NOT EXISTS sf_season (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sf_presence (
  code TEXT PRIMARY KEY,
  players INTEGER NOT NULL,
  connected INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

const SNAPSHOT_RETENTION = 5;

export class PgStore implements Store {
  readonly kind = "postgres" as const;
  private pool: pg.Pool;

  constructor(private readonly url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async saveRoom(room: StoredRoom): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO sf_rooms (code, mode_id, seed, state, host_seat, created_at, updated_at, finished_at, tick, season_id, world, seats)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (code) DO UPDATE SET
           mode_id=EXCLUDED.mode_id, seed=EXCLUDED.seed, state=EXCLUDED.state, host_seat=EXCLUDED.host_seat,
           updated_at=EXCLUDED.updated_at, finished_at=EXCLUDED.finished_at, tick=EXCLUDED.tick,
           season_id=EXCLUDED.season_id, world=EXCLUDED.world, seats=EXCLUDED.seats`,
        [room.code, room.modeId, room.seed, room.state, room.hostSeat, room.createdAt, room.updatedAt,
          room.finishedAt, room.tick, room.seasonId ?? null, room.world, JSON.stringify(room.seats)],
      );
      if (room.world) {
        await client.query(
          "INSERT INTO sf_snapshots (code, tick, world, created_at) VALUES ($1,$2,$3,$4)",
          [room.code, room.tick, room.world, Date.now()],
        );
        await client.query(
          "DELETE FROM sf_snapshots WHERE id IN (SELECT id FROM sf_snapshots WHERE code=$1 ORDER BY tick DESC OFFSET $2)",
          [room.code, SNAPSHOT_RETENTION],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async loadRooms(): Promise<StoredRoom[]> {
    const res = await this.pool.query("SELECT * FROM sf_rooms ORDER BY created_at ASC");
    return res.rows.map((row) => ({
      code: String(row.code),
      modeId: String(row.mode_id),
      seed: Number(row.seed),
      state: row.state as StoredRoom["state"],
      hostSeat: Number(row.host_seat),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      tick: Number(row.tick),
      world: row.world == null ? null : String(row.world),
      seats: (typeof row.seats === "string" ? JSON.parse(row.seats) : row.seats) as StoredRoom["seats"],
      seasonId: row.season_id == null ? null : String(row.season_id),
    }));
  }

  async deleteRoom(code: string): Promise<void> {
    await this.pool.query("DELETE FROM sf_rooms WHERE code=$1", [code]);
  }

  async cleanup(roomMaxAgeMs: number, finishedMaxAgeMs: number): Promise<number> {
    const now = Date.now();
    const stale = await this.pool.query("DELETE FROM sf_rooms WHERE updated_at < $1 RETURNING code", [now - roomMaxAgeMs]);
    const finished = await this.pool.query(
      "DELETE FROM sf_rooms WHERE state='finished' AND finished_at IS NOT NULL AND finished_at < $1 RETURNING code",
      [now - finishedMaxAgeMs],
    );
    return (stale.rowCount ?? 0) + (finished.rowCount ?? 0);
  }

  async getSeason(): Promise<SeasonInfo | null> {
    const res = await this.pool.query("SELECT value FROM sf_season WHERE key='current'");
    if (res.rowCount === 0) return null;
    const value = res.rows[0]!.value as SeasonInfo;
    return value && typeof value.seasonId === "string" ? value : null;
  }

  async saveSeason(season: SeasonInfo): Promise<void> {
    await this.pool.query(
      "INSERT INTO sf_season (key, value, updated_at) VALUES ('current', $1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at",
      [JSON.stringify(season), Date.now()],
    );
  }

  async flush(): Promise<void> { /* каждый saveRoom коммитится сразу */ }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async stats(): Promise<Record<string, unknown>> {
    const rooms = await this.pool.query("SELECT state, count(*)::int AS n FROM sf_rooms GROUP BY state");
    const snapshots = await this.pool.query("SELECT count(*)::int AS n FROM sf_snapshots");
    return { kind: this.kind, rooms: rooms.rows, snapshots: snapshots.rows[0]?.n ?? 0 };
  }
}