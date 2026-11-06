/**
 * Фабрика персистентности: PostgreSQL при DATABASE_URL, иначе durable FileStore (.data/).
 * Redis подключается дополнительно (presence/кэш/сезон), его недоступность не критична.
 */
import path from "node:path";
import { FileStore } from "./file-store";
import { PgStore } from "./pg-store";
import { RedisSide } from "./redis-side";
import type { Store } from "./types";

export * from "./types";
export { FileStore } from "./file-store";
export { PgStore } from "./pg-store";
export { RedisSide } from "./redis-side";

export interface PersistenceOptions {
  dataDir?: string;
  databaseUrl?: string | null;
  redisUrl?: string | null;
  log?: (line: string) => void;
}

export interface Persistence {
  store: Store;
  redis: RedisSide | null;
  kind: string;
}

export function defaultDataDir(): string {
  return process.env.SF_DATA_DIR ?? path.resolve(process.cwd(), ".data");
}

export async function createPersistence(opts: PersistenceOptions = {}): Promise<Persistence> {
  const log = opts.log ?? ((line: string) => console.log("[store] " + line));
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? null;
  const redisUrl = opts.redisUrl ?? process.env.REDIS_URL ?? null;
  const dataDir = opts.dataDir ?? defaultDataDir();

  let store: Store;
  if (databaseUrl) {
    try {
      const pg = new PgStore(databaseUrl);
      await pg.init();
      store = pg;
      log("postgres connected");
    } catch (e) {
      log("postgres unavailable, fallback на file-store: " + String(e));
      const file = new FileStore(dataDir);
      await file.init();
      store = file;
    }
  } else {
    const file = new FileStore(dataDir);
    await file.init();
    store = file;
    log("file-store: " + file.dataDir + " (DATABASE_URL не задан)");
  }

  let redis: RedisSide | null = null;
  if (redisUrl) {
    redis = new RedisSide(redisUrl, log);
    await redis.init();
  }

  return { store, redis, kind: store.kind + (redis?.available ? "+redis" : "") };
}
