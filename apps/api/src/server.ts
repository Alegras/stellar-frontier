/**
 * Авторитетный сервер «Stellar Frontier» (M11, Fastify + WebSocket).
 *
 * HTTP — только лобби (создать/войти/инфо/health/modes). Вся игра — WSS:
 * команды клиента → валидация (zod + принадлежность + rate limit) → @sf/sim.
 *
 * Сервер — единственный источник истины: клиенты получают full_state при входе/реконнекте
 * и компактные snapshot'ы с частотой режима.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  BUILTIN_MODES, CreateRoomRequestSchema, JoinRoomRequestSchema, MAX_WS_MESSAGE_BYTES,
  PROTOCOL_VERSION, ROOM_CODE_REGEX, generateRoomCode, safeParseClientMessage,
  type ModeLimits, type ServerMessage,
} from "@sf/protocol";
import { MODES } from "@sf/data";
import { DEFAULT_TOKEN_TTL_MS, resolveTokenSecret, verifySecret } from "./auth/token";
import { Room, modeLimits, type Seat } from "./room";
import {
  createPersistence, defaultDataDir, DEFAULT_FINISHED_MAX_AGE_MS, DEFAULT_ROOM_MAX_AGE_MS, DEFAULT_SEASON_TTL_MS,
  type Persistence, type SeasonInfo,
} from "./store/index";

export interface ServerOptions {
  host?: string;
  port?: number;
  /** переопределение тика/снапшотов для тестов */
  coopTickMs?: number;
  mmoTickMs?: number;
  coopSnapshotMs?: number;
  mmoSnapshotMs?: number;
  reconnectGraceMs?: number;
  pauseCooldownMs?: number;
  maxRooms?: number;
  roomTtlMs?: number;
  rng?: () => number;
  log?: (line: string) => void;
  /** "none" — без персистентности (unit/e2e-тесты), "auto" — PG при DATABASE_URL, иначе file-store. */
  persistence?: "auto" | "file" | "postgres" | "none";
  dataDir?: string;
  databaseUrl?: string | null;
  redisUrl?: string | null;
  /** интервал дебаунса записи снапшота, мс */
  persistIntervalMs?: number;
  /** восстанавливать комнаты при listen() */
  restore?: boolean;
  roomMaxAgeMs?: number;
  finishedMaxAgeMs?: number;
  restoreGraceMs?: number;
  seasonTtlMs?: number;
  /** токен для /admin/* и /season/reset (если пусто — эндпоинты недоступны) */
  adminToken?: string;
  /** секрет HMAC токенов реконнекта (иначе SF_TOKEN_SECRET / .data/token-secret) */
  tokenSecret?: string;
  tokenTtlMs?: number;
  /** CORS allowlist; "*" или пусто — dev-режим */
  corsOrigins?: string[];
  /** HTTP rate limit на мутирующие запросы (на IP в минуту) */
  httpRatePerMin?: number;
  /** максимум одновременных WS-соединений */
  wsMaxConnections?: number;
}

export interface ApiServer {
  app: FastifyInstance;
  listen: (port?: number, host?: string) => Promise<string>;
  address: () => string | null;
  close: () => Promise<void>;
  rooms: Map<string, Room>;
  persistence: Persistence | null;
  options: Required<Pick<ServerOptions, "reconnectGraceMs" | "pauseCooldownMs" | "maxRooms">>;
}

const DEFAULT_OPTS = {
  reconnectGraceMs: 30_000,
  pauseCooldownMs: 5_000,
  maxRooms: 200,
  roomTtlMs: 10 * 60_000,
  persistIntervalMs: 1_500,
  roomMaxAgeMs: DEFAULT_ROOM_MAX_AGE_MS,
  finishedMaxAgeMs: DEFAULT_FINISHED_MAX_AGE_MS,
  seasonTtlMs: DEFAULT_SEASON_TTL_MS,
  restoreGraceMs: 5 * 60_000,
  log: (line: string) => console.log("[api] " + line),
};

/** Спецификация M11: кооп 2–4, MMO 30–100 (даже если контент задаёт другое). */
export function clampPlayersMax(modeId: string, playersMax: number): number {
  if (modeId === "coop") return Math.min(4, Math.max(2, playersMax));
  if (modeId === "mmo") return Math.min(100, Math.max(30, playersMax));
  return 1;
}

/** Слияние режимов @sf/data (MODES) с встроенными лимитами; пустые данные не ломают лобби. */
export function listModes(): ModeLimits[] {
  const out = new Map<string, ModeLimits>();
  for (const [id, m] of Object.entries(BUILTIN_MODES)) out.set(id, m);
  for (const m of MODES as unknown as Array<Record<string, unknown>>) {
    const id = String(m.modeId ?? "");
    if (!id) continue;
    const base = out.get(id) ?? modeLimits(id);
    out.set(id, {
      ...base,
      displayRu: typeof m.displayRu === "string" ? m.displayRu : base.displayRu,
      playersMax: clampPlayersMax(id, typeof m.playersMax === "number" ? m.playersMax : base.playersMax),
      tickMs: typeof m.tickSeconds === "number" ? Math.max(100, m.tickSeconds * 1000) : base.tickMs,
      pausePolicy: m.pausePolicy === "free" || m.pausePolicy === "none" || m.pausePolicy === "vote" ? m.pausePolicy : base.pausePolicy,
      tacticalLockS: typeof m.tacticalLockTicks === "number" ? m.tacticalLockTicks : base.tacticalLockS,
    });
  }
  return [...out.values()];
}

export async function createServer(options: ServerOptions = {}): Promise<ApiServer> {
  const opts = { ...DEFAULT_OPTS, ...options };
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: true });
  // perMessageDeflate: сжатие снапшотов/full_state (бюджет 1.5 МБ gzip на join).
  await app.register(websocket, {
    options: {
      maxPayload: MAX_WS_MESSAGE_BYTES,
      // level 1: компрессия full_state в разы быстрее, сжатый размер всё равно ≪ 1.5 МБ
      perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 1 } },
    },
  });

  const rooms = new Map<string, Room>();
  const rng = opts.rng ?? Math.random;
  const log = opts.log;
  let boundAddress: string | null = null;
  const persistence = opts.persistence === "none"
    ? null
    : await createPersistence({
        dataDir: opts.dataDir,
        databaseUrl: opts.databaseUrl,
        redisUrl: opts.redisUrl,
        log,
      });
  if (persistence) log("persistence: " + persistence.kind);
  const dataDir = opts.dataDir ?? process.env.SF_DATA_DIR ?? defaultDataDir();
  const tokenSecret = opts.tokenSecret && opts.tokenSecret.length >= 8
    ? opts.tokenSecret
    : persistence ? resolveTokenSecret(undefined, dataDir) : randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const tokenTtlMs = opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
  const corsOrigins = (opts.corsOrigins ?? (process.env.SF_CORS_ORIGINS ? process.env.SF_CORS_ORIGINS.split(",").map((x) => x.trim()).filter(Boolean) : [])).filter(Boolean);
  const httpRatePerMin = opts.httpRatePerMin ?? 240;
  const wsMaxConnections = opts.wsMaxConnections ?? 1200;
  const rateBuckets = new Map<string, { tokens: number; at: number }>();
  let wsConnections = 0;

  const clientIp = (request: FastifyRequest): string => String(request.ip ?? "unknown");
  /** Token bucket на HTTP-мутации: httpRatePerMin/мин, burst = 2×. */
  const allowHttp = (request: FastifyRequest): boolean => {
    const ip = clientIp(request);
    const now = Date.now();
    const bucket = rateBuckets.get(ip) ?? { tokens: httpRatePerMin * 2, at: now };
    bucket.tokens = Math.min(httpRatePerMin * 2, bucket.tokens + ((now - bucket.at) / 60000) * httpRatePerMin);
    bucket.at = now;
    if (bucket.tokens < 1) { rateBuckets.set(ip, bucket); return false; }
    bucket.tokens -= 1;
    rateBuckets.set(ip, bucket);
    return true;
  };
  const persistTimers = new Map<string, NodeJS.Timeout>();
  let seasonInfo: SeasonInfo | null = null;
  /** true во время graceful shutdown: комнаты сохраняются в store, но не удаляются из него. */
  let closing = false;

  const saveRoomNow = async (room: Room): Promise<void> => {
    if (!persistence) return;
    try {
      await persistence.store.saveRoom(room.toRecord());
      await persistence.redis?.setPresence({
        code: room.code,
        players: room.seats.length,
        connected: room.seats.filter((x) => x.connected).length,
        updatedAt: Date.now(),
      });
      await persistence.redis?.cacheRoom(room.code, room.publicRoom());
    } catch (e) {
      log("persist failed for " + room.code + ": " + String(e));
    }
  };

  const schedulePersist = (room: Room): void => {
    if (!persistence) return;
    if (persistTimers.has(room.code)) return;
    const timer = setTimeout(() => {
      persistTimers.delete(room.code);
      void saveRoomNow(room);
    }, opts.persistIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
    persistTimers.set(room.code, timer);
  };

  const flushAll = async (): Promise<void> => {
    for (const timer of persistTimers.values()) clearTimeout(timer);
    persistTimers.clear();
    if (!persistence) return;
    for (const room of rooms.values()) await saveRoomNow(room);
    await persistence.store.flush();
  };

  const ensureSeason = async (): Promise<SeasonInfo> => {
    if (!persistence) {
      seasonInfo ??= { seasonId: "local", startedAt: Date.now(), resetAt: Date.now() + opts.seasonTtlMs, seed: Math.floor(Math.random() * 2_000_000_000), epoch: 1 };
      return seasonInfo;
    }
    const current = (await persistence.store.getSeason()) ?? (await persistence.redis?.getSeason()) ?? null;
    if (!current || Date.now() - current.startedAt > opts.seasonTtlMs) {
      const epoch = (current?.epoch ?? 0) + 1;
      const next: SeasonInfo = {
        seasonId: "season-" + epoch,
        startedAt: Date.now(),
        resetAt: Date.now() + opts.seasonTtlMs,
        seed: Math.floor(rng() * 2_000_000_000),
        epoch,
      };
      await persistence.store.saveSeason(next);
      await persistence.redis?.saveSeason(next);
      seasonInfo = next;
      log("season started: " + next.seasonId + " seed=" + next.seed);
      return next;
    }
    seasonInfo = current;
    return current;
  };

  const newCode = (): string => {
    for (let i = 0; i < 32; i++) {
      const code = generateRoomCode(5, rng);
      if (!rooms.has(code)) return code;
    }
    throw new Error("Не удалось выделить код комнаты");
  };

  const baseSeed = (): number => Math.floor(rng() * 2_000_000_000);

  const applyLimits = (mode: ModeLimits): ModeLimits => ({
    ...mode,
    playersMax: clampPlayersMax(mode.modeId, mode.playersMax),
    tickMs: mode.modeId === "coop" ? (opts.coopTickMs ?? mode.tickMs) : mode.modeId === "mmo" ? (opts.mmoTickMs ?? mode.tickMs) : mode.tickMs,
    snapshotMs: mode.modeId === "coop" ? (opts.coopSnapshotMs ?? mode.snapshotMs) : mode.modeId === "mmo" ? (opts.mmoSnapshotMs ?? mode.snapshotMs) : mode.snapshotMs,
  });

  const deletePersistedRoom = (code: string): void => {
    const timer = persistTimers.get(code);
    if (timer) { clearTimeout(timer); persistTimers.delete(code); }
    void persistence?.store.deleteRoom(code).catch(() => undefined);
    void persistence?.redis?.dropRoom(code);
  };

  const createRoom = async (modeId: string, nick: string, seed?: number): Promise<{ room: Room; seat: Seat } | { error: string; status: number }> => {
    if (rooms.size >= opts.maxRooms) return { error: "Слишком много комнат, попробуйте позже", status: 503 };
    const mode = applyLimits(modeLimits(modeId));
    if (mode.playersMax > 100) return { error: "Неверный режим", status: 400 };
    const season = mode.modeId === "mmo" ? await ensureSeason() : null;
    const code = newCode();
    let roomRef: Room | null = null;
    const room = new Room(code, mode, seed ?? season?.seed ?? baseSeed(), {
      reconnectGraceMs: opts.reconnectGraceMs,
      pauseCooldownMs: opts.pauseCooldownMs,
      rng,
      restoreGraceMs: opts.restoreGraceMs,
      tokenSecret,
      tokenTtlMs,
      onPersist: () => { if (roomRef) schedulePersist(roomRef); },
    }, () => {
      // onDestroy: удаляем пустые/завершённые комнаты из менеджера; в хранилище — только не при shutdown
      rooms.delete(code);
      if (!closing) deletePersistedRoom(code);
      log("room " + code + " destroyed");
    }, () => {
      // onChanged: рассылаем публичное состояние лобби
      roomRef?.broadcast({ t: "room", room: roomRef.publicRoom() });
    });
    roomRef = room;
    room.seasonId = season?.seasonId ?? null;
    rooms.set(code, room);
    const seat = room.addSeat(nick);
    room.hostSeat = seat.seat;
    log("room " + code + " created mode=" + mode.modeId + " host=" + nick + (season ? " season=" + season.seasonId : ""));
    if (persistence) void saveRoomNow(room);
    return { room, seat };
  };

  const joinRoom = async (code: string, nick: string): Promise<{ room: Room; seat: Seat } | { error: string; status: number }> => {
    const room = rooms.get(code);
    if (!room) return { error: "Комната не найдена", status: 404 };
    if (room.state !== "lobby") return { error: "Игра уже идёт", status: 409 };
    if (room.seats.length >= room.mode.playersMax) return { error: "Комната заполнена", status: 409 };
    const seat = room.addSeat(nick);
    room.broadcast({ t: "room", room: room.publicRoom() });
    log("room " + code + " join " + nick + " seat=" + seat.seat);
    if (persistence) void saveRoomNow(room);
    return { room, seat };
  };

  const wsUrlFor = (request: FastifyRequest): string => {
    const host = request.headers.host ?? ("127.0.0.1:" + (options.port ?? 8787));
    const proto = (request.headers["x-forwarded-proto"] as string | undefined) === "https" ? "wss" : "ws";
    return proto + "://" + host + "/ws";
  };

  // Security headers + CORS allowlist + HTTP rate limit на мутации.
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "geolocation=(), microphone=(), camera=()");
    reply.header("cross-origin-resource-policy", "same-site");
    reply.header("cache-control", "no-store");
    const origin = request.headers.origin;
    if (origin) {
      const allowed = corsOrigins.length === 0 || corsOrigins.includes("*") || corsOrigins.includes(origin);
      if (allowed) {
        reply.header("access-control-allow-origin", corsOrigins.includes("*") ? "*" : origin);
        reply.header("vary", "origin");
      }
    }
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "content-type,x-admin-token");
    reply.header("access-control-max-age", "600");
    if (request.method === "OPTIONS") { reply.code(204).send(); return; }
    if (request.method === "POST" && !allowHttp(request)) {
      reply.code(429).send({ error: "rate limit", retryAfterSec: 1 });
      return;
    }
    done();
  });

  const isAdmin = (request: FastifyRequest): boolean =>
    verifySecret(request.headers["x-admin-token"] as string | undefined, opts.adminToken);

  app.get("/health", async () => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    rooms: rooms.size,
    players: [...rooms.values()].reduce((n, r) => n + r.seats.length, 0),
    persistence: persistence?.kind ?? "none",
    redis: persistence?.redis?.available ?? false,
    season: seasonInfo?.seasonId ?? null,
    uptimeMs: Math.round(process.uptime() * 1000),
  }));

  app.get("/modes", async () => listModes());

  app.get("/season", async () => ({
    season: seasonInfo ?? (persistence ? await persistence.store.getSeason() : null),
    ttlMs: opts.seasonTtlMs,
    persistence: persistence?.kind ?? "none",
  }));

  app.post("/season/reset", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ error: "forbidden" });
    let removed = 0;
    for (const [code, room] of [...rooms.entries()]) {
      if (room.mode.modeId === "mmo") { room.destroy(); rooms.delete(code); removed++; }
    }
    const epoch = (seasonInfo?.epoch ?? 0) + 1;
    const next: SeasonInfo = {
      seasonId: "season-" + epoch,
      startedAt: Date.now(),
      resetAt: Date.now() + opts.seasonTtlMs,
      seed: Math.floor(rng() * 2_000_000_000),
      epoch,
    };
    await persistence?.store.saveSeason(next);
    await persistence?.redis?.saveSeason(next);
    seasonInfo = next;
    log("season reset: " + next.seasonId + " removed mmo rooms=" + removed);
    return { ok: true, season: next, removedRooms: removed };
  });

  app.post("/admin/flush", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ error: "forbidden" });
    await flushAll();
    return { ok: true, rooms: rooms.size };
  });

  app.get("/admin/stats", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ error: "forbidden" });
    return {
      persistence: persistence?.kind ?? "none",
      redis: persistence?.redis?.available ?? false,
      rooms: rooms.size,
      store: persistence ? await persistence.store.stats() : null,
      season: await (persistence ? persistence.store.getSeason() : null),
      memory: process.memoryUsage(),
      uptimeSec: Math.round(process.uptime()),
    };
  });

  app.get("/rooms/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const room = rooms.get(code.toUpperCase());
    if (!room) return reply.code(404).send({ error: "Комната не найдена" });
    return room.publicRoom();
  });

  app.post("/rooms", async (request, reply) => {
    const parsed = CreateRoomRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Неверный запрос", issues: parsed.error.issues });
    const { modeId, nick, seed } = parsed.data;
    const result = await createRoom(modeId, nick, seed);
    if ("error" in result) return reply.code(result.status).send({ error: result.error });
    const { room, seat } = result;
    return {
      code: room.code,
      seat: seat.seat,
      token: seat.token,
      room: room.publicRoom(),
      wsUrl: wsUrlFor(request),
    };
  });

  app.post("/rooms/:code/join", async (request, reply) => {
    const { code } = request.params as { code: string };
    const parsed = JoinRoomRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Неверный запрос", issues: parsed.error.issues });
    if (!ROOM_CODE_REGEX.test(code)) return reply.code(400).send({ error: "Неверный код комнаты" });
    const result = await joinRoom(code.toUpperCase(), parsed.data.nick);
    if ("error" in result) return reply.code(result.status).send({ error: result.error });
    const { room, seat } = result;
    return {
      code: room.code,
      seat: seat.seat,
      token: seat.token,
      room: room.publicRoom(),
      wsUrl: wsUrlFor(request),
    };
  });

  // ---------------------------------------------------------------- WebSocket
  interface WsSession {
    room: Room | null;
    seat: Seat | null;
    alive: boolean;
    helloDeadline: NodeJS.Timeout | null;
    pingTimer: NodeJS.Timeout | null;
  }

  const send = (socket: WebSocket, msg: ServerMessage | Record<string, unknown>): void => {
    if (socket.readyState !== 1) return;
    try { socket.send(JSON.stringify(msg)); } catch { /* ignore */ }
  };

  const authFromHello = (roomCode: string | undefined, token: string | undefined): { room: Room; seat: Seat } | { error: string } => {
    if (!roomCode || !token) return { error: "Нужны roomCode и token" };
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) return { error: "Комната не найдена" };
    const seat = room.findSeatByToken(token);
    if (!seat) return { error: "Токен не найден (истекло окно реконнекта?)" };
    return { room, seat };
  };

  app.get("/ws", { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    if (wsConnections >= wsMaxConnections) {
      try { socket.close(4029, "server full"); } catch { /* ignore */ }
      return;
    }
    wsConnections++;
    socket.on("close", () => { wsConnections = Math.max(0, wsConnections - 1); });
    const session: WsSession = { room: null, seat: null, alive: true, helloDeadline: null, pingTimer: null };
    const query = request.query as Record<string, string | undefined>;

    const closeWith = (code: number, reason: string): void => {
      try { socket.close(code, reason); } catch { /* ignore */ }
    };

    const onAuthed = (room: Room, seat: Seat, resumed: boolean): void => {
      session.room = room;
      session.seat = seat;
      if (session.helloDeadline) { clearTimeout(session.helloDeadline); session.helloDeadline = null; }
      room.attach(seat, socket);
      send(socket, {
        t: "welcome",
        protocol: PROTOCOL_VERSION,
        room: room.publicRoom(),
        seat: seat.seat,
        token: seat.token,
        resumed,
        tick: room.world?.tick ?? 0,
      });
      if (room.state === "active" || room.state === "finished") room.broadcastFullState();
      room.broadcast({ t: "room", room: room.publicRoom() });
    };

    // Быстрый путь: /ws?code=XXX&token=... (реконнект без hello)
    if (query.code && query.token) {
      const auth = authFromHello(query.code, query.token);
      if ("error" in auth) { send(socket, { t: "error", code: "auth_failed", message: auth.error }); closeWith(4003, auth.error); return; }
      onAuthed(auth.room, auth.seat, true);
    } else {
      session.helloDeadline = setTimeout(() => {
        send(socket, { t: "error", code: "hello_timeout", message: "Не получен hello" });
        closeWith(4008, "hello timeout");
      }, 5_000);
      if (typeof session.helloDeadline.unref === "function") session.helloDeadline.unref();
    }

    socket.on("pong", () => { session.alive = true; });
    let lastPingAt = Date.now();
    session.pingTimer = setInterval(() => {
      const now = Date.now();
      const drift = now - lastPingAt;
      lastPingAt = now;
      // Если event loop был заблокирован (например, рассылка 300 full_state),
      // не наказываем клиентов ложным ping-timeout: пропускаем проверку и переармируемся.
      if (drift > 3_000) { session.alive = true; try { socket.ping(); } catch { /* ignore */ } return; }
      if (!session.alive) { closeWith(4009, "ping timeout"); return; }
      session.alive = false;
      try { socket.ping(); } catch { /* ignore */ }
    }, 5_000);
    if (typeof session.pingTimer.unref === "function") session.pingTimer.unref();

    socket.on("message", (data: Buffer | string) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      if (raw.length > MAX_WS_MESSAGE_BYTES) { closeWith(1009, "too big"); return; }
      if (session.seat) session.seat.lastMsgAt = Date.now();
      let json: unknown;
      try { json = JSON.parse(raw); } catch { send(socket, { t: "error", code: "bad_json", message: "Невалидный JSON" }); return; }
      const parsed = safeParseClientMessage(json);
      if (!parsed.ok) { send(socket, { t: "error", code: "bad_message", message: parsed.error }); return; }
      const msg = parsed.message;

      if (msg.t === "hello") {
        if (msg.protocol < PROTOCOL_VERSION) { send(socket, { t: "error", code: "protocol", message: "Обновите клиент (protocol " + PROTOCOL_VERSION + ")" }); closeWith(4002, "protocol"); return; }
        const auth = authFromHello(msg.roomCode, msg.token);
        if ("error" in auth) { send(socket, { t: "error", code: "auth_failed", message: auth.error }); closeWith(4003, auth.error); return; }
        onAuthed(auth.room, auth.seat, true);
        return;
      }

      const room = session.room;
      const seat = session.seat;
      if (!room || !seat) { send(socket, { t: "error", code: "unauthorized", message: "Сначала hello" }); return; }

      switch (msg.t) {
        case "ping":
          send(socket, { t: "pong", ts: msg.ts });
          return;
        case "resync":
          if (room.state !== "lobby") room.broadcastFullState();
          return;
        case "ready":
          room.setReady(seat, msg.ready);
          return;
        case "start": {
          const res = room.start(seat);
          if (!res.ok) send(socket, { t: "notice", code: "start_failed", message: res.error ?? "Не удалось начать игру", seat: seat.seat });
          else if (persistence) void saveRoomNow(room);
          return;
        }
        case "leave": {
          room.detach(seat);
          room.seats = room.seats.filter((s) => s.seat !== seat.seat);
          room.broadcast({ t: "room", room: room.publicRoom() });
          if (room.seats.length === 0) room.destroy();
          else if (persistence) void saveRoomNow(room);
          closeWith(4000, "leave");
          return;
        }
        case "cmd": {
          const res = room.handleCommand(seat, msg.seq, msg.cmd as Record<string, unknown>);
          send(socket, { t: "cmd_ack", seq: msg.seq, ok: res.ok, tick: room.world?.tick ?? 0, reason: res.reason });
          if (res.ok) room.broadcastSnapshot();
          return;
        }
        case "vote_pause": {
          const res = room.votePause(seat, msg.pause);
          if (!res.ok) send(socket, { t: "notice", code: "pause_vote_failed", message: res.error ?? "Голос не принят", seat: seat.seat });
          return;
        }
        case "chat": {
          const res = room.chat(seat, msg.text);
          if (!res.ok) send(socket, { t: "notice", code: "chat_failed", message: res.error ?? "Сообщение не отправлено", seat: seat.seat });
          return;
        }
        case "tactical_lock": {
          const res = room.tacticalLock(seat, msg.pvp ?? false);
          if (!res.ok) send(socket, { t: "notice", code: "tactical_lock_failed", message: res.error ?? "Лок не получен", seat: seat.seat });
          return;
        }
        case "tactical_unlock": {
          const res = room.tacticalUnlock(seat);
          if (!res.ok) send(socket, { t: "notice", code: "tactical_unlock_failed", message: res.error ?? "Лок не снят", seat: seat.seat });
          return;
        }
        default:
          send(socket, { t: "error", code: "unknown_message", message: "Неизвестный тип сообщения" });
      }
    });

    const debugWs = process.env.SF_DEBUG_WS === "1";
    socket.on("close", (code: number, reason: Buffer) => {
      if (debugWs) console.error("[ws-close] code=" + code + " reason=" + String(reason) + " seat=" + (session.seat?.seat ?? "-"));
      if (session.pingTimer) clearInterval(session.pingTimer);
      if (session.helloDeadline) clearTimeout(session.helloDeadline);
      if (session.room && session.seat) {
        const room = session.room;
        const seat = session.seat;
        if (seat.socket === socket) {
          room.detach(seat);
          room.broadcast({ t: "room", room: room.publicRoom() });
          if (persistence) void saveRoomNow(room);
        }
      }
    });

    socket.on("error", () => { /* закрытие обработает close */ });
  });

  // ---------------------------------------------------------------- очистка
  const sweeper = setInterval(() => {
    for (const [code, room] of [...rooms.entries()]) {
      if (room.state === "finished" && room.finishedAt != null && Date.now() - room.finishedAt > opts.roomTtlMs) {
        room.destroy();
        rooms.delete(code);
        continue;
      }
      const empty = room.sweepDisconnected();
      if (empty) {
        room.destroy();
        rooms.delete(code);
        log("room " + code + " removed (empty)");
      }
    }
  }, 5_000);
  if (typeof sweeper.unref === "function") sweeper.unref();

  const restoreRooms = async (): Promise<number> => {
    if (!persistence || opts.restore === false) return 0;
    try {
      await persistence.store.cleanup(opts.roomMaxAgeMs, opts.finishedMaxAgeMs);
      const records = await persistence.store.loadRooms();
      let restored = 0;
      for (const record of records) {
        if (rooms.has(record.code)) continue;
        let roomRef: Room | null = null;
        const roomOpts = {
          reconnectGraceMs: opts.reconnectGraceMs,
          pauseCooldownMs: opts.pauseCooldownMs,
          rng,
          restoreGraceMs: opts.restoreGraceMs,
          tokenSecret,
          tokenTtlMs,
          onPersist: () => { if (roomRef) schedulePersist(roomRef); },
        };
        const restoredRoom = Room.fromRecord(record, roomOpts, () => {
          rooms.delete(record.code);
          if (!closing) deletePersistedRoom(record.code);
        }, () => { roomRef?.broadcast({ t: "room", room: roomRef.publicRoom() }); });
        roomRef = restoredRoom;
        rooms.set(record.code, restoredRoom);
        restored++;
        log("restored room " + record.code + " mode=" + record.modeId + " state=" + record.state + " tick=" + record.tick);
      }
      return restored;
    } catch (e) {
      log("restore failed: " + String(e));
      return 0;
    }
  };

  const listen = async (port = options.port ?? 8787, host = options.host ?? "127.0.0.1"): Promise<string> => {
    if (persistence) {
      const restored = await restoreRooms();
      if (restored > 0) log("restored rooms: " + restored);
    }
    await app.listen({ port, host });
    const addr = app.server.address();
    boundAddress = typeof addr === "object" && addr ? host + ":" + addr.port : String(addr);
    log("listening on http://" + boundAddress);
    return "http://" + boundAddress;
  };

  const close = async (): Promise<void> => {
    clearInterval(sweeper);
    closing = true;
    await flushAll();
    for (const room of rooms.values()) room.destroy();
    rooms.clear();
    if (persistence) {
      await persistence.store.close();
      await persistence.redis?.close();
    }
    await app.close();
  };

  return {
    app,
    listen,
    address: () => boundAddress,
    close,
    rooms,
    persistence,
    options: { reconnectGraceMs: opts.reconnectGraceMs, pauseCooldownMs: opts.pauseCooldownMs, maxRooms: opts.maxRooms },
  };
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const num = (v: string | undefined): number | undefined => {
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const persistence = (process.env.SF_PERSISTENCE as "auto" | "file" | "postgres" | "none" | undefined) ?? "auto";
  createServer({
    coopTickMs: num(process.env.SF_COOP_TICK_MS ?? process.env.SF_TEST_COOP_TICK_MS),
    coopSnapshotMs: num(process.env.SF_COOP_SNAPSHOT_MS ?? process.env.SF_TEST_COOP_SNAPSHOT_MS),
    mmoTickMs: num(process.env.SF_MMO_TICK_MS),
    mmoSnapshotMs: num(process.env.SF_MMO_SNAPSHOT_MS),
    reconnectGraceMs: num(process.env.SF_RECONNECT_GRACE_MS ?? process.env.SF_TEST_RECONNECT_GRACE_MS),
    pauseCooldownMs: num(process.env.SF_PAUSE_COOLDOWN_MS ?? process.env.SF_TEST_PAUSE_COOLDOWN_MS),
    persistence,
    dataDir: process.env.SF_DATA_DIR,
    databaseUrl: process.env.DATABASE_URL ?? null,
    redisUrl: process.env.REDIS_URL ?? null,
    persistIntervalMs: num(process.env.SF_PERSIST_INTERVAL_MS),
    seasonTtlMs: num(process.env.SF_SEASON_TTL_MS),
    adminToken: process.env.SF_ADMIN_TOKEN,
    tokenSecret: process.env.SF_TOKEN_SECRET,
    tokenTtlMs: num(process.env.SF_TOKEN_TTL_MS),
    corsOrigins: process.env.SF_CORS_ORIGINS ? process.env.SF_CORS_ORIGINS.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
    httpRatePerMin: num(process.env.SF_HTTP_RATE_PER_MIN),
    wsMaxConnections: num(process.env.SF_WS_MAX_CONNECTIONS),
  })
    .then(async (server) => {
      await server.listen(port, host);
      const shutdown = (signal: string) => {
        console.log("[api] " + signal + " — graceful shutdown (flush store)");
        void server.close().then(() => process.exit(0)).catch(() => process.exit(1));
      };
      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));
    })
    .catch((e) => { console.error("[api] failed to start:", e); process.exitCode = 1; });
}