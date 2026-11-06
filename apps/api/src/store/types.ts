/**
 * Контракт слоя персистентности (M11/M12): комнаты, снапшоты мира, сезонные ключи.
 * Реализации: FileStore (.data/, dev/тесты без серверов), PgStore (PostgreSQL), RedisSide (presence/кэш).
 */
export interface StoredSeat {
  seat: number;
  nick: string;
  /** HMAC-хэш токена реконнекта (сырой токен в хранилище не пишется). */
  tokenHash: string;
  /** Время истечения токена (мс epoch). */
  tokenExpiresAt: number;
  /** Legacy-поле старых снапшотов: сырой токен; мигрируется в tokenHash при восстановлении. */
  token?: string;
  ready: boolean;
  empireId: number;
}

export interface StoredRoom {
  code: string;
  modeId: string;
  seed: number;
  state: "lobby" | "active" | "finished";
  hostSeat: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  tick: number;
  /** сериализованный мир @sf/sim (serializeWorld); null до старта партии */
  world: string | null;
  seats: StoredSeat[];
  seasonId?: string | null;
}

export interface SeasonInfo {
  seasonId: string;
  startedAt: number;
  resetAt: number;
  seed: number;
  epoch: number;
}

export interface PresenceInfo {
  code: string;
  players: number;
  connected: number;
  updatedAt: number;
}

export interface Store {
  readonly kind: "file" | "postgres";
  init(): Promise<void>;
  saveRoom(room: StoredRoom): Promise<void>;
  loadRooms(): Promise<StoredRoom[]>;
  deleteRoom(code: string): Promise<void>;
  /** Удаляет устаревшие комнаты: active/lobby старше roomMaxAgeMs, finished — старше finishedMaxAgeMs. */
  cleanup(roomMaxAgeMs: number, finishedMaxAgeMs: number): Promise<number>;
  getSeason(): Promise<SeasonInfo | null>;
  saveSeason(season: SeasonInfo): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  stats(): Promise<Record<string, unknown>>;
}

export const DEFAULT_SEASON_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
export const DEFAULT_ROOM_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // 24 часа
export const DEFAULT_FINISHED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней