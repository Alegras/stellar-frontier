/**
 * RedisSide: presence/кэш комнат/сезонные ключи (опционально, при REDIS_URL).
 * Любая ошибка/недоступность Redis не валит сервер: available=false, вызовы no-op.
 */
import { createClient, type RedisClientType } from "redis";
import type { PresenceInfo, SeasonInfo } from "./types";

const PRESENCE_TTL_SEC = 60;
const ROOM_CACHE_TTL_SEC = 30;
const SEASON_KEY = "sf:season";
const PRESENCE_KEY = (code: string) => "sf:presence:" + code;
const ROOM_KEY = (code: string) => "sf:room:" + code;

export class RedisSide {
  available = false;
  private client: RedisClientType | null = null;

  constructor(private readonly url: string, private readonly log: (line: string) => void = () => undefined) {}

  async init(): Promise<void> {
    try {
      const client = createClient({ url: this.url });
      client.on("error", (e) => { this.available = false; this.log("redis error: " + String(e)); });
      await client.connect();
      this.client = client as RedisClientType;
      this.available = true;
      this.log("redis connected");
    } catch (e) {
      this.available = false;
      this.log("redis unavailable, продолжаем без кэша: " + String(e));
    }
  }

  private safe<T>(fn: (c: RedisClientType) => Promise<T>, fallback: T): Promise<T> {
    if (!this.client || !this.available) return Promise.resolve(fallback);
    return fn(this.client).catch((e) => {
      this.available = false;
      this.log("redis op failed: " + String(e));
      return fallback;
    });
  }

  async setPresence(info: PresenceInfo): Promise<void> {
    await this.safe(async (c) => {
      await c.set(PRESENCE_KEY(info.code), JSON.stringify(info), { EX: PRESENCE_TTL_SEC });
    }, undefined as void);
  }

  async getPresence(code: string): Promise<PresenceInfo | null> {
    const raw = await this.safe(async (c) => c.get(PRESENCE_KEY(code)), null);
    if (!raw) return null;
    try { return JSON.parse(raw) as PresenceInfo; } catch { return null; }
  }

  async cacheRoom(code: string, data: unknown): Promise<void> {
    await this.safe(async (c) => {
      await c.set(ROOM_KEY(code), JSON.stringify(data), { EX: ROOM_CACHE_TTL_SEC });
    }, undefined as void);
  }

  async getCachedRoom(code: string): Promise<unknown | null> {
    const raw = await this.safe(async (c) => c.get(ROOM_KEY(code)), null);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async saveSeason(season: SeasonInfo): Promise<void> {
    await this.safe(async (c) => { await c.set(SEASON_KEY, JSON.stringify(season)); }, undefined as void);
  }

  async getSeason(): Promise<SeasonInfo | null> {
    const raw = await this.safe(async (c) => c.get(SEASON_KEY), null);
    if (!raw) return null;
    try { return JSON.parse(raw) as SeasonInfo; } catch { return null; }
  }

  async dropRoom(code: string): Promise<void> {
    await this.safe(async (c) => { await c.del(ROOM_KEY(code)); await c.del(PRESENCE_KEY(code)); }, undefined as void);
  }

  async close(): Promise<void> {
    if (this.client && this.available) {
      try { await this.client.quit(); } catch { /* ignore */ }
    }
    this.client = null;
    this.available = false;
  }
}