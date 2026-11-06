/**
 * Комната мультиплеера (M11): сервер-авторитет, тик-луп, снапшоты, голосование за паузу,
 * тактический лок, реконнект по токену, чат. Состояние симуляции — packages/sim (@sf/sim).
 *
 * Режимы: coop 2–4 (тик 1 с, пауза голосованием) и mmo 30–100 (тик 15 мин, паузы нет).
 * Клиент отправляет только команды; всё состояние меняет сервер.
 */
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import * as sim from "@sf/sim";
import type { Command, World } from "@sf/sim";
import { BALANCE, MODE } from "@sf/data";
import {
  BUILTIN_MODES, MAX_PAUSES_PER_HOUR, MAX_WS_MESSAGE_BYTES,
  type ModeLimits, type PlayerSnapshot, type RoomPublic, type ServerMessage,
} from "@sf/protocol";
import type { StoredRoom } from "./store/types";
import { DEFAULT_TOKEN_TTL_MS, generateToken, hashToken, verifyToken } from "./auth/token";

const COMMAND_TYPES = new Set<string>([
  "move_fleet", "stop_fleet", "colonize", "build_ship", "build_district", "build_building",
  "cancel_build", "research", "trade", "scan_system", "accept_mission", "abandon_mission",
  "declare_war", "make_peace", "repair_fleet", "set_formation", "flagship_jump", "join_battle",
]);

const CMD_RATE = 5;
const CMD_BURST = 10;
const CHAT_RATE_MS = 1000;

export interface Seat {
  seat: number;
  nick: string;
  /** Сырой токен: только в памяти (нужен для welcome), в хранилище не пишется. */
  token: string;
  /** HMAC-SHA256(raw, SF_TOKEN_SECRET) — хранится в .data/PostgreSQL. */
  tokenHash: string;
  tokenExpiresAt: number;
  socket: WebSocket | null;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  empireId: number;
  /** token bucket команд */
  tokens: number;
  tokensAt: number;
  lastChatAt: number;
  lastMsgAt: number;
  lastCmdSeq: number;
  vote: boolean | null;
  lockTimes: number[];
}

export interface RoomOptions {
  reconnectGraceMs: number;
  pauseCooldownMs: number;
  /** для тестов: детерминированные коды/токены */
  rng?: () => number;
  /** Вызывается при изменениях, требующих сохранения (сервер сам дебаунсит запись). */
  onPersist?: () => void;
  /** После восстановления из хранилища место «отключено» и не вычищается дольше обычного grace. */
  restoreGraceMs?: number;
  /** Секрет HMAC для токенов реконнекта; сервер резолвит SF_TOKEN_SECRET/файл. */
  tokenSecret?: string;
  tokenTtlMs?: number;
}

export function modeLimits(modeId: string): ModeLimits {
  const base = BUILTIN_MODES[modeId] ?? BUILTIN_MODES["coop"]!;
  return { ...base, modeId: modeId as ModeLimits["modeId"] };
}

export class Room {
  readonly code: string;
  readonly mode: ModeLimits;
  readonly seed: number;
  createdAt = Date.now();
  readonly opts: RoomOptions;
  state: "lobby" | "active" | "finished" = "lobby";
  hostSeat = 0;
  seats: Seat[] = [];
  world: World | null = null;
  finishedAt: number | null = null;
  /** Сезон MMO (для снапшотов/сезонного сброса); null в кооп/SP. */
  seasonId: string | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private snapTimer: NodeJS.Timeout | null = null;
  private logCursor = 0;
  private lastSnapshotAt = 0;
  private pauseTimes: number[] = [];
  private pauseCooldownUntil = 0;
  private tactical: { seat: number; until: number; pvp: boolean } | null = null;
  private onDestroy: () => void;
  private onChanged: () => void;

  constructor(code: string, mode: ModeLimits, seed: number, opts: RoomOptions, onDestroy: () => void, onChanged: () => void) {
    this.code = code;
    this.mode = mode;
    this.seed = seed;
    this.opts = opts;
    this.onDestroy = onDestroy;
    this.onChanged = onChanged;
  }

  // ---------------------------------------------------------------- лобби
  addSeat(nick: string): Seat {
    const used = new Set(this.seats.map((s) => s.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    const raw = generateToken();
    const secret = this.opts.tokenSecret ?? process.env.SF_TOKEN_SECRET ?? "sf-dev-insecure-secret";
    const ttl = this.opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    const s: Seat = {
      seat, nick, token: raw, tokenHash: hashToken(raw, secret), tokenExpiresAt: Date.now() + ttl,
      socket: null, ready: false, connected: false,
      disconnectedAt: null, empireId: seat + 1, tokens: CMD_BURST, tokensAt: Date.now(),
      lastChatAt: 0, lastMsgAt: 0, lastCmdSeq: -1, vote: null, lockTimes: [],
    };
    this.seats.push(s);
    return s;
  }

  /**
   * Поиск места по сырому токену: сверяем HMAC-хэш constant-time и TTL.
   * Сырой токен не хранится в персистентности, поэтому после рестарта он восстанавливается
   * в памяти только для успешно прошедшего проверку места.
   */
  findSeatByToken(token: string): Seat | undefined {
    if (!token) return undefined;
    const secret = this.opts.tokenSecret ?? process.env.SF_TOKEN_SECRET ?? "sf-dev-insecure-secret";
    let found: Seat | undefined;
    for (const seat of this.seats) {
      if (verifyToken(token, seat.tokenHash, seat.tokenExpiresAt, secret)) {
        if (!found) found = seat;
      }
    }
    if (found) found.token = token;
    return found;
  }

  seatOf(socket: WebSocket): Seat | undefined {
    return this.seats.find((s) => s.socket === socket);
  }

  publicRoom(): RoomPublic {
    return {
      code: this.code,
      modeId: this.mode.modeId,
      state: this.state,
      players: this.seats.map((s) => ({ seat: s.seat, nick: s.nick, ready: s.ready, connected: s.connected })),
      maxSeats: this.mode.playersMax,
      hostSeat: this.hostSeat,
      tick: this.world?.tick ?? 0,
      createdAt: this.createdAt,
    };
  }

  broadcast(msg: ServerMessage, exceptSeat?: number): void {
    const raw = JSON.stringify(msg);
    for (const s of this.seats) {
      if (s.seat === exceptSeat) continue;
      this.sendRaw(s, raw);
    }
  }

  sendTo(seat: number, msg: ServerMessage | unknown): void {
    const s = this.seats.find((x) => x.seat === seat);
    if (s) this.sendRaw(s, JSON.stringify(msg));
  }

  private sendRaw(seat: Seat, raw: string): void {
    if (!seat.socket || seat.socket.readyState !== 1) return;
    try { seat.socket.send(raw); } catch { /* сокет закрывается */ }
  }

  // ---------------------------------------------------------------- start
  setReady(seat: Seat, ready: boolean): void {
    if (this.state !== "lobby") return;
    seat.ready = ready;
    this.onChanged();
    this.opts.onPersist?.();
  }

  start(bySeat: Seat): { ok: boolean; error?: string } {
    if (this.state !== "lobby") return { ok: false, error: "Комната уже запущена" };
    if (bySeat.seat !== this.hostSeat) return { ok: false, error: "Запускать может только хост" };
    if (this.seats.length === 0) return { ok: false, error: "В комнате нет игроков" };
    const notReady = this.seats.filter((s) => !s.ready).map((s) => s.nick);
    if (notReady.length > 0) return { ok: false, error: "Не готовы: " + notReady.join(", ") };

    const modeCfg = { ...MODE, modeId: this.mode.modeId } as typeof MODE;
    const world = sim.createWorld(this.seed, modeCfg, BALANCE);
    const humans = this.seats.slice().sort((a, b) => a.seat - b.seat);
    // Кооп/кампания/песочница/испытание: все места управляют ОДНОЙ империей (shared empire),
    // поэтому victory по world.playerEmpireId корректен (M11-lite). MMO: у каждого места своя империя.
    const sharedEmpire = this.mode.modeId !== "mmo";
    if (sharedEmpire) {
      const playerEmpire = world.empires.find((e) => e.id === world.playerEmpireId) ?? world.empires[0]!;
      playerEmpire.isPlayer = true;
      for (const s of humans) s.empireId = playerEmpire.id;
      world.playerEmpireId = playerEmpire.id;
    } else {
      humans.forEach((s, i) => {
        const empire = world.empires[i] ?? world.empires[0]!;
        s.empireId = empire.id;
        empire.isPlayer = true;
        empire.ai = null;
      });
      world.playerEmpireId = humans[0]!.empireId;
    }
    world.paused = false;
    world.speed = 1;
    try {
      const fg = sim.ensureFg(world);
      fg.multiplayer = {
        enabled: true,
        players: humans.length,
        tacticalLockTicks: this.mode.tacticalLockS,
        pauseVotes: {},
        pauseCooldown: 0,
        tacticalLockedBy: 0,
        tacticalLockUntil: 0,
      };
    } catch { /* fullgame недоступен — не блокирует MP */ }
    this.world = world;
    this.logCursor = world.log.length > 0 ? world.log[world.log.length - 1]!.id : 0;
    this.state = "active";
    this.onChanged();
    this.opts.onPersist?.();
    this.broadcast({
      t: "started",
      seed: this.seed,
      modeId: this.mode.modeId,
      tickMs: this.mode.tickMs,
      empireId: humans[0]!.empireId,
      players: this.publicRoom().players,
    });
    this.broadcastFullState();
    this.startTimers();
    return { ok: true };
  }

  // ---------------------------------------------------------------- таймеры
  private startTimers(): void {
    this.stopTimers();
    this.tickTimer = setInterval(() => this.tickOnce(), this.mode.tickMs);
    this.snapTimer = setInterval(() => this.broadcastSnapshot(), this.mode.snapshotMs);
    if (typeof this.tickTimer.unref === "function") this.tickTimer.unref();
    if (typeof this.snapTimer.unref === "function") this.snapTimer.unref();
  }

  private stopTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.snapTimer) clearInterval(this.snapTimer);
    this.tickTimer = null;
    this.snapTimer = null;
  }

  private tickOnce(): void {
    if (this.state !== "active" || !this.world) return;
    if (this.world.paused) return;
    try {
      sim.tick(this.world);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.world.paused = true;
      this.broadcast({ t: "notice", code: "tick_error", message: "Ошибка симуляции: " + msg });
      this.broadcast({ t: "session", paused: true, reason: "Ошибка симуляции" });
      return;
    }
    this.opts.onPersist?.();
    if (this.world.victory?.achieved) {
      this.state = "finished";
      this.finishedAt = Date.now();
      this.stopTimers();
      this.broadcast({ t: "notice", code: "victory", message: "Победа: " + String(this.world.victory.achieved) });
      this.onDestroy();
    }
  }

  // ---------------------------------------------------------------- снапшоты
  broadcastFullState(): void {
    if (!this.world) return;
    const world = sim.serializeWorld(this.world);
    const players = this.seats.map((x) => this.playerSnapshot(x));
    const tick = this.world.tick;
    const paused = this.world.paused;
    // Рассылка чанками через setImmediate: 300 холодных full_state не блокируют event loop
    // (иначе heartbeat/команды других игроков получают ложные таймауты).
    const seats = this.seats.slice();
    let i = 0;
    const step = (): void => {
      const batch = seats.slice(i, i + 5);
      i += 5;
      for (const s of batch) {
        this.sendTo(s.seat, { t: "full_state", tick, paused, players, world });
      }
      if (i < seats.length) setImmediate(step);
    };
    step();
  }

  private playerSnapshot(s: Seat): PlayerSnapshot {
    const w = this.world!;
    const empire = w.empires.find((e) => e.id === s.empireId);
    const fleetPower = empire ? safe(() => sim.getEmpireFleetPower(w, empire.id), 0) : 0;
    const score = empire ? safe(() => sim.getScore(w, empire.id).total, 0) : 0;
    return {
      seat: s.seat,
      nick: s.nick,
      empireId: s.empireId,
      connected: s.connected,
      resources: { ...(empire?.resources ?? {}) },
      income: { ...(empire?.incomeLastTick ?? {}) },
      science: { ...(empire?.science ?? {}) },
      colonies: w.colonies.filter((c) => c.empireId === s.empireId).length,
      systems: w.systems.filter((sys) => sys.ownerId === s.empireId).length,
      fleetPower,
      score,
    };
  }

  /**
   * Interest management: каждый seat получает только свои/видимые системы и флоты,
   * свои события + глобальные. Полный список игроков (компактный) остаётся общим для HUD.
   */
  broadcastSnapshot(): void {
    if (!this.world || this.state === "lobby") return;
    const w = this.world;
    this.checkTacticalUnlock();
    const events = w.log.filter((e) => e.id > this.logCursor).slice(-30);
    if (events.length > 0) this.logCursor = events[events.length - 1]!.id;
    const lock = this.tactical
      ? { seat: this.tactical.seat, ticksLeft: Math.max(0, Math.ceil((this.tactical.until - Date.now()) / 1000)) }
      : null;
    const votes = this.voteCounts();
    this.lastSnapshotAt = Date.now();
    const players = this.seats.map((s) => this.playerSnapshot(s));
    const victory = { achieved: w.victory?.achieved ?? null, winnerEmpireId: w.victory?.winnerEmpireId ?? 0 };
    const visibleByEmpire = new Map<number, Set<number>>();
    for (const seat of this.seats) {
      const empireId = seat.empireId;
      let visible = visibleByEmpire.get(empireId);
      if (!visible) {
        visible = new Set<number>();
        for (const sys of w.systems) {
          if (sys.ownerId === empireId || sys.knownBy.includes(empireId) || sys.visibleTo.includes(empireId)) visible.add(sys.id);
        }
        visibleByEmpire.set(empireId, visible);
      }
      const visibleSystems = visible;
      const fleets = w.fleets
        .filter((f) => f.empireId === empireId || visibleSystems.has(f.systemId))
        .map((f) => [f.id, f.empireId, f.systemId, f.ships.length, f.status] as [number, number, number, number, string]);
      const systems = w.systems.filter((sys) => visibleSystems.has(sys.id)).map((sys) => sys.ownerId);
      const seatEvents = events.filter((e) => e.empireId == null || e.empireId === empireId);
      this.sendTo(seat.seat, {
        t: "snapshot",
        tick: w.tick,
        paused: w.paused,
        speed: w.speed,
        tacticalLock: lock,
        pauseVotes: votes,
        victory,
        players,
        fleets,
        systems,
        events: seatEvents.map((e) => ({ id: e.id, tick: e.tick, kind: e.kind, severity: e.severity, messageRu: e.messageRu })),
      });
    }
  }

  // ---------------------------------------------------------------- команды
  handleCommand(seat: Seat, seq: number, rawCmd: Record<string, unknown>): { ok: boolean; reason?: string } {
    const w = this.world;
    if (!w || this.state !== "active") return { ok: false, reason: "Игра не запущена" };
    if (w.paused) return { ok: false, reason: "Игра на паузе" };
    const type = String(rawCmd.type ?? "");
    if (!COMMAND_TYPES.has(type)) return { ok: false, reason: "Команда запрещена в мультиплеере: " + type };
    if (seq <= seat.lastCmdSeq) return { ok: false, reason: "Повторный seq" };

    // token bucket
    const now = Date.now();
    seat.tokens = Math.min(CMD_BURST, seat.tokens + ((now - seat.tokensAt) / 1000) * CMD_RATE);
    seat.tokensAt = now;
    if (seat.tokens < 1) return { ok: false, reason: "Слишком много команд (rate limit)" };
    seat.tokens -= 1;

    const ownership = this.validateOwnership(seat, rawCmd);
    if (ownership) return { ok: false, reason: ownership };

    let result: sim.CommandResult;
    try {
      // applyCommandAs — валидация команды от имени конкретной империи места (без подмены playerEmpireId).
      result = sim.applyCommandAs(w, seat.empireId, rawCmd as unknown as Command);
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    seat.lastCmdSeq = seq;
    if (result.ok) this.opts.onPersist?.();
    return result.ok ? { ok: true } : { ok: false, reason: result.messageRu ?? "команда отклонена" };
  }

  private validateOwnership(seat: Seat, cmd: Record<string, unknown>): string | null {
    const w = this.world!;
    const empireId = seat.empireId;
    const fleetId = typeof cmd.fleetId === "number" ? cmd.fleetId : null;
    if (fleetId != null) {
      const fleet = w.fleets.find((f) => f.id === fleetId);
      if (!fleet) return "Флот не найден";
      if (fleet.empireId !== empireId) return "Флот не ваш";
    }
    const colonyId = typeof cmd.colonyId === "number" ? cmd.colonyId : null;
    if (colonyId != null) {
      const colony = w.colonies.find((c) => c.id === colonyId);
      if (!colony) return "Колония не найдена";
      if (colony.empireId !== empireId) return "Колония не ваша";
    }
    if (cmd.type === "build_ship" && typeof cmd.systemId === "number") {
      const system = w.systems.find((s) => s.id === cmd.systemId);
      if (!system || system.ownerId !== empireId) return "Верфь не в вашей системе";
    }
    if (cmd.type === "trade" && typeof cmd.stationId === "number") {
      const station = w.systems.find((s) => s.station?.id === cmd.stationId)?.station;
      if (!station) return "Станция не найдена";
    }
    if (cmd.type === "declare_war" || cmd.type === "make_peace") {
      const target = typeof cmd.targetEmpireId === "number" ? cmd.targetEmpireId : null;
      if (target == null || target === empireId) return "Неверная цель дипломатии";
    }
    return null;
  }

  // ---------------------------------------------------------------- пауза
  votePause(seat: Seat, pause: boolean): { ok: boolean; error?: string } {
    const w = this.world;
    if (!w || this.state !== "active") return { ok: false, error: "Игра не запущена" };
    if (this.mode.pausePolicy === "none") return { ok: false, error: "В этом режиме пауза запрещена" };
    if (this.mode.pausePolicy === "free") {
      w.paused = pause;
      this.broadcast({ t: "session", paused: pause, reason: "Пауза игрока" });
      return { ok: true };
    }
    const now = Date.now();
    if (this.tactical) return { ok: false, error: "Тактический лок активен" };
    if (now < this.pauseCooldownUntil) return { ok: false, error: "Кулдаун голосования" };
    if (w.paused === pause) return { ok: false, error: pause ? "Уже на паузе" : "Игра не на паузе" };
    seat.vote = pause;
    this.onChanged();
    this.broadcastSnapshot();
    const needed = this.neededVotes();
    const votes = this.voteCounts();
    const passed = pause ? votes.for >= needed : votes.against >= needed;
    this.broadcast({ t: "pause_vote", for: votes.for, against: votes.against, need: needed, bySeat: seat.seat, pause });
    if (passed) {
      if (pause) {
        this.pauseTimes = this.pauseTimes.filter((t) => now - t < 3_600_000);
        if (this.pauseTimes.length >= MAX_PAUSES_PER_HOUR) {
          this.seats.forEach((s) => { s.vote = null; });
          return { ok: false, error: "Лимит пауз: " + MAX_PAUSES_PER_HOUR + " в час" };
        }
        this.pauseTimes.push(now);
      }
      w.paused = pause;
      this.pauseCooldownUntil = now + this.opts.pauseCooldownMs;
      this.seats.forEach((s) => { s.vote = null; });
      this.broadcast({ t: "session", paused: pause, reason: pause ? "Голосование: пауза" : "Голосование: продолжить", votes });
      this.opts.onPersist?.();
      this.broadcastSnapshot();
    }
    return { ok: true };
  }

  neededVotes(): number {
    const n = this.seats.length;
    return n <= 1 ? 1 : Math.max(2, Math.ceil(n / 2));
  }

  voteCounts(): { for: number; against: number; need: number } {
    const voters = this.seats.filter((s) => s.vote != null);
    return {
      for: voters.filter((s) => s.vote === true).length,
      against: voters.filter((s) => s.vote === false).length,
      need: this.neededVotes(),
    };
  }

  // ---------------------------------------------------------------- тактический лок
  tacticalLock(seat: Seat, pvp: boolean): { ok: boolean; error?: string; until?: number } {
    if (this.state !== "active") return { ok: false, error: "Игра не запущена" };
    const now = Date.now();
    this.checkTacticalUnlock();
    if (this.tactical) return { ok: false, error: "Тактический лок уже активен" };
    seat.lockTimes = seat.lockTimes.filter((t) => now - t < 3_600_000);
    if (seat.lockTimes.length >= 12) return { ok: false, error: "Слишком много тактических локов" };
    const seconds = pvp ? this.mode.tacticalLockPvpS : this.mode.tacticalLockS;
    const until = now + seconds * 1000;
    this.tactical = { seat: seat.seat, until, pvp };
    seat.lockTimes.push(now);
    this.broadcast({ t: "tactical_lock", seat: seat.seat, until, ticksLeft: seconds, pvp });
    this.broadcastSnapshot();
    return { ok: true, until };
  }

  tacticalUnlock(seat: Seat): { ok: boolean; error?: string } {
    if (!this.tactical) return { ok: false, error: "Лока нет" };
    if (this.tactical.seat !== seat.seat) return { ok: false, error: "Лок держит другой игрок" };
    this.tactical = null;
    this.broadcast({ t: "tactical_unlock" });
    return { ok: true };
  }

  private checkTacticalUnlock(): void {
    if (this.tactical && Date.now() >= this.tactical.until) {
      this.tactical = null;
      this.broadcast({ t: "tactical_unlock" });
    }
  }

  tacticalState(): { seat: number; ticksLeft: number } | null {
    if (!this.tactical) return null;
    return { seat: this.tactical.seat, ticksLeft: Math.max(0, Math.ceil((this.tactical.until - Date.now()) / 1000)) };
  }

  // ---------------------------------------------------------------- чат / соединение
  chat(seat: Seat, text: string): { ok: boolean; error?: string } {
    const now = Date.now();
    if (now - seat.lastChatAt < CHAT_RATE_MS) return { ok: false, error: "Слишком часто (чат 1/с)" };
    seat.lastChatAt = now;
    this.broadcast({ t: "chat", seat: seat.seat, nick: seat.nick, text, tick: this.world?.tick ?? 0 });
    return { ok: true };
  }

  attach(seat: Seat, socket: WebSocket): void {
    if (seat.socket && seat.socket !== socket && seat.socket.readyState === 1) {
      try { seat.socket.close(4001, "Заменён новым соединением"); } catch { /* ignore */ }
    }
    seat.socket = socket;
    seat.connected = true;
    seat.disconnectedAt = null;
    seat.lastMsgAt = Date.now();
    this.onChanged();
    this.opts.onPersist?.();
  }

  detach(seat: Seat): void {
    seat.socket = null;
    seat.connected = false;
    seat.disconnectedAt = Date.now();
    this.onChanged();
    this.opts.onPersist?.();
  }

  /** Удаление отключённых дольше grace; возвращает true, если места не осталось. */
  sweepDisconnected(): boolean {
    const now = Date.now();
    const expired = this.seats.filter((s) => !s.connected && s.disconnectedAt != null && now - s.disconnectedAt > this.opts.reconnectGraceMs);
    for (const s of expired) {
      this.seats = this.seats.filter((x) => x.seat !== s.seat);
      if (this.hostSeat === s.seat && this.seats.length > 0) this.hostSeat = this.seats[0]!.seat;
      this.broadcast({ t: "room", room: this.publicRoom() });
    }
    return this.seats.length === 0;
  }

  destroy(): void {
    this.stopTimers();
    for (const s of this.seats) {
      if (s.socket && s.socket.readyState === 1) {
        try { s.socket.close(4000, "Комната закрыта"); } catch { /* ignore */ }
      }
    }
    this.seats = [];
    this.world = null;
    this.onDestroy();
  }

  // ---------------------------------------------------------------- персистентность
  /** Снимок комнаты для хранилища (world — serialized @sf/sim, null до старта). */
  toRecord(): StoredRoom {
    return {
      code: this.code,
      modeId: this.mode.modeId,
      seed: this.seed,
      state: this.state,
      hostSeat: this.hostSeat,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      finishedAt: this.finishedAt,
      tick: this.world?.tick ?? 0,
      world: this.world ? sim.serializeWorld(this.world) : null,
      seats: this.seats.map((s) => ({ seat: s.seat, nick: s.nick, tokenHash: s.tokenHash, tokenExpiresAt: s.tokenExpiresAt, ready: s.ready, empireId: s.empireId })),
      seasonId: this.seasonId,
    };
  }

  /** Восстановление комнаты из хранилища: мир, места, состояние, таймеры (active). */
  static fromRecord(
    record: StoredRoom,
    opts: RoomOptions,
    onDestroy: () => void,
    onChanged: () => void,
  ): Room {
    const room = new Room(record.code, modeLimits(record.modeId), record.seed, opts, onDestroy, onChanged);
    room.createdAt = record.createdAt;
    room.hostSeat = record.hostSeat;
    room.state = record.state;
    room.finishedAt = record.finishedAt;
    room.seasonId = record.seasonId ?? null;
    const restoreGrace = opts.restoreGraceMs ?? 5 * 60_000;
    const disconnectedAt = Date.now() - opts.reconnectGraceMs + restoreGrace;
    const secret = opts.tokenSecret ?? process.env.SF_TOKEN_SECRET ?? "sf-dev-insecure-secret";
    const ttl = opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    room.seats = record.seats.map((seat) => {
      // backward compat: старые снапшоты хранили сырой token → мигрируем в хэш при восстановлении.
      const legacyToken = (seat as unknown as { token?: string }).token;
      const tokenHash = seat.tokenHash ?? (legacyToken ? hashToken(legacyToken, secret) : "");
      const tokenExpiresAt = seat.tokenExpiresAt ?? Date.now() + ttl;
      return {
      seat: seat.seat,
      nick: seat.nick,
      token: "",
      tokenHash,
      tokenExpiresAt,
      socket: null,
      ready: seat.ready,
      connected: false,
      disconnectedAt,
      empireId: seat.empireId,
      tokens: CMD_BURST,
      tokensAt: Date.now(),
      lastChatAt: 0,
      lastMsgAt: 0,
      lastCmdSeq: -1,
      vote: null,
      lockTimes: [],
      };
    });
    if (record.world) {
      try {
        room.world = sim.deserializeWorld(record.world);
        room.logCursor = room.world.log.length > 0 ? room.world.log[room.world.log.length - 1]!.id : 0;
      } catch {
        room.world = null;
        if (room.state === "active") room.state = "lobby";
      }
    }
    if (room.state === "active" && room.world) room.startTimers();
    return room;
  }

  // ---------------------------------------------------------------- сводка
  tickRate(): number { return this.mode.tickMs; }
  snapshotRate(): number { return this.mode.snapshotMs; }
  lastSnapshot(): number { return this.lastSnapshotAt; }
  maxMessageBytes(): number { return MAX_WS_MESSAGE_BYTES; }
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}