/**
 * FileStore: durable JSON-хранилище (.data/) для dev и тестов без PostgreSQL/Redis.
 * Атомарная запись (tmp + rename), последовательная очередь на файл, устойчивость к битым файлам.
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SeasonInfo, Store, StoredRoom } from "./types";

interface FileMeta { kind: "file-store"; version: number; createdAt: number; updatedAt: number }

export class FileStore implements Store {
  readonly kind = "file" as const;
  readonly dataDir: string;
  private readonly roomsDir: string;
  private readonly cacheDir: string;
  private readonly writes = new Map<string, Promise<void>>();
  private meta: FileMeta | null = null;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.roomsDir = path.join(this.dataDir, "rooms");
    this.cacheDir = path.join(this.dataDir, "cache");
  }

  async init(): Promise<void> {
    await mkdir(this.roomsDir, { recursive: true });
    await mkdir(this.cacheDir, { recursive: true });
    try {
      this.meta = JSON.parse(await readFile(path.join(this.dataDir, "meta.json"), "utf8")) as FileMeta;
    } catch {
      this.meta = { kind: "file-store", version: 1, createdAt: Date.now(), updatedAt: Date.now() };
      await this.atomicWrite(path.join(this.dataDir, "meta.json"), JSON.stringify(this.meta, null, 2));
    }
  }

  private roomFile(code: string): string {
    if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new Error("Некорректный код комнаты: " + code);
    return path.join(this.roomsDir, code + ".json");
  }

  private async atomicWrite(file: string, data: string): Promise<void> {
    const tmp = file + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
    await writeFile(tmp, data, "utf8");
    await rename(tmp, file);
  }

  /** Сериализуем записи в один файл, чтобы параллельные saveRoom не перетирали друг друга. */
  private enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.writes.get(key) ?? Promise.resolve();
    const next = prev.then(task, task).catch(() => undefined);
    this.writes.set(key, next);
    return next;
  }

  async saveRoom(room: StoredRoom): Promise<void> {
    const file = this.roomFile(room.code);
    await this.enqueue(room.code, async () => {
      await this.atomicWrite(file, JSON.stringify(room));
    });
  }

  async loadRooms(): Promise<StoredRoom[]> {
    let names: string[] = [];
    try { names = await readdir(this.roomsDir); } catch { return []; }
    const out: StoredRoom[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(await readFile(path.join(this.roomsDir, name), "utf8")) as StoredRoom;
        if (!raw || typeof raw.code !== "string" || !Array.isArray(raw.seats) || typeof raw.modeId !== "string") {
          continue;
        }
        out.push(raw);
      } catch {
        // битый файл (например, kill -9 во время записи) пропускаем, не валим восстановление
      }
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  async deleteRoom(code: string): Promise<void> {
    const file = this.roomFile(code);
    await this.enqueue(code, async () => {
      try { await unlink(file); } catch { /* уже нет */ }
    });
  }

  async cleanup(roomMaxAgeMs: number, finishedMaxAgeMs: number): Promise<number> {
    const now = Date.now();
    const rooms = await this.loadRooms();
    let removed = 0;
    for (const room of rooms) {
      const finishedOld = room.state === "finished" && room.finishedAt != null && now - room.finishedAt > finishedMaxAgeMs;
      const stale = now - room.updatedAt > roomMaxAgeMs;
      if (finishedOld || stale) {
        await this.deleteRoom(room.code);
        removed++;
      }
    }
    return removed;
  }

  async getSeason(): Promise<SeasonInfo | null> {
    try {
      const raw = JSON.parse(await readFile(path.join(this.dataDir, "season.json"), "utf8")) as SeasonInfo;
      return raw && typeof raw.seasonId === "string" ? raw : null;
    } catch {
      return null;
    }
  }

  async saveSeason(season: SeasonInfo): Promise<void> {
    await this.atomicWrite(path.join(this.dataDir, "season.json"), JSON.stringify(season, null, 2));
  }

  async flush(): Promise<void> {
    await Promise.all([...this.writes.values()]);
  }

  async close(): Promise<void> {
    await this.flush();
  }

  async stats(): Promise<Record<string, unknown>> {
    const rooms = await this.loadRooms();
    return {
      kind: this.kind,
      dataDir: this.dataDir,
      rooms: rooms.length,
      active: rooms.filter((r) => r.state === "active").length,
      lobby: rooms.filter((r) => r.state === "lobby").length,
      finished: rooms.filter((r) => r.state === "finished").length,
    };
  }
}
