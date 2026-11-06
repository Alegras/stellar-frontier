/**
 * Клиентский сетевой слой (M11): лобби по HTTP, игра по WebSocket.
 *
 * Сервер — авторитет: клиент отправляет команды, получает full_state при входе/реконнекте
 * и компактные snapshot'ы. Реконнект по токену с backoff 1/2/4 с (окно 30 с на сервере).
 *
 * Интеграция с игрой: onFullState → Game.applyRemoteWorld(json); onSnapshot → Game.applyRemoteSnapshot(snap);
 * sendCommand → сервер (клиент не считает симуляцию в coop/mmo).
 */
import type { Command } from "@sf/sim";
import type { RoomPublic, ServerMessage, PlayerSnapshot } from "@sf/protocol";

export interface SnapshotEvent { id: number; tick: number; kind: string; severity: string; messageRu: string }
export type SnapshotPlayer = PlayerSnapshot;
export interface NetSnapshot {
  tick: number;
  paused: boolean;
  speed: number;
  tacticalLock: { seat: number; ticksLeft: number } | null;
  pauseVotes: { for: number; against: number; need: number };
  victory: { achieved: string | null; winnerEmpireId: number };
  players: SnapshotPlayer[];
  events: SnapshotEvent[];
}

export type MpPhase = "offline" | "lobby" | "connecting" | "active" | "reconnecting" | "error";

export interface MpState {
  phase: MpPhase;
  code: string | null;
  seat: number;
  modeId: string;
  players: RoomPublic["players"];
  hostSeat: number;
  maxSeats: number;
  tick: number;
  paused: boolean;
  error: string | null;
  notice: string | null;
  chat: { nick: string; text: string; tick: number }[];
  tacticalLock: { seat: number; ticksLeft: number } | null;
  pauseVotes: { for: number; against: number; need: number };
  resumed: boolean;
}

export interface NetClientOptions {
  apiUrl?: string;
  onFullState: (worldJson: string, tick: number) => void;
  onSnapshot: (snap: NetSnapshot) => void;
  onState: (state: MpState) => void;
}

const EMPTY_STATE: MpState = {
  phase: "offline", code: null, seat: -1, modeId: "coop", players: [], hostSeat: 0, maxSeats: 4,
  tick: 0, paused: true, error: null, notice: null, chat: [], tacticalLock: null,
  pauseVotes: { for: 0, against: 0, need: 2 }, resumed: false,
};

function defaultApiUrl(): string {
  try {
    const q = new URLSearchParams(window.location.search).get("mpApi");
    if (q) return q.replace(/\/$/, "");
  } catch { /* ssr/no window */ }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_SF_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
}

export class NetClient {
  readonly apiUrl: string;
  state: MpState = { ...EMPTY_STATE };
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private roomCode: string | null = null;
  private seq = 0;
  private reconnectAttempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: NetClientOptions;

  constructor(opts: NetClientOptions) {
    this.opts = opts;
    this.apiUrl = (opts.apiUrl ?? defaultApiUrl()).replace(/\/$/, "");
  }

  private patch(patch: Partial<MpState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState(this.state);
  }

  // ---------------------------------------------------------------- HTTP
  async createRoom(modeId: string, nick: string): Promise<void> {
    await this.httpCreate("/rooms", { modeId, nick });
  }

  async joinRoom(code: string, nick: string): Promise<void> {
    await this.httpCreate("/rooms/" + encodeURIComponent(code.toUpperCase()) + "/join", { nick });
  }

  private async httpCreate(path: string, body: unknown): Promise<void> {
    this.closedByUser = false;
    this.patch({ phase: "connecting", error: null, notice: "Создание комнаты…" });
    let res: Response;
    try {
      res = await fetch(this.apiUrl + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.patch({ phase: "error", error: "Сервер недоступен: " + msg });
      throw e;
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = String(data.error ?? res.status);
      this.patch({ phase: "error", error: msg });
      throw new Error(msg);
    }
    this.token = String(data.token);
    this.roomCode = String(data.code);
    const room = data.room as RoomPublic;
    this.patch({
      phase: "lobby",
      code: room.code,
      seat: Number(data.seat),
      modeId: room.modeId,
      players: room.players,
      hostSeat: room.hostSeat,
      maxSeats: room.maxSeats,
      tick: room.tick,
      paused: true,
      error: null,
      notice: null,
      chat: [],
      resumed: false,
    });
    this.connect(String(data.wsUrl ?? this.apiUrl.replace(/^http/, "ws") + "/ws"));
  }

  // ---------------------------------------------------------------- WS
  private connect(url: string): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.send({ t: "hello", protocol: 1, roomCode: this.roomCode ?? undefined, token: this.token ?? undefined });
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(String(ev.data)) as ServerMessage; } catch { return; }
      this.handle(msg);
    });
    ws.addEventListener("close", () => {
      if (this.closedByUser) { this.patch({ phase: "offline" }); return; }
      if (this.state.phase === "active" || this.state.phase === "lobby" || this.state.phase === "reconnecting") {
        this.scheduleReconnect();
      }
    });
    ws.addEventListener("error", () => { /* закроется close */ });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= 3) {
      this.patch({ phase: "error", error: "Не удалось переподключиться (3 попытки)" });
      return;
    }
    const delay = 1000 * 2 ** this.reconnectAttempt;
    this.reconnectAttempt++;
    this.patch({ phase: "reconnecting", notice: "Переподключение через " + Math.round(delay / 1000) + " с…" });
    this.reconnectTimer = setTimeout(() => {
      if (!this.roomCode || !this.token) return;
      const base = this.apiUrl.replace(/^http/, "ws") + "/ws";
      this.connect(base + "?code=" + encodeURIComponent(this.roomCode) + "&token=" + encodeURIComponent(this.token));
      this.send({ t: "hello", protocol: 1, roomCode: this.roomCode, token: this.token });
    }, delay);
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        this.patch({
          phase: "lobby",
          code: msg.room.code,
          seat: msg.seat,
          modeId: msg.room.modeId,
          players: msg.room.players,
          hostSeat: msg.room.hostSeat,
          maxSeats: msg.room.maxSeats,
          tick: msg.tick,
          resumed: msg.resumed,
          error: null,
        });
        return;
      case "room":
        this.patch({
          players: msg.room.players,
          hostSeat: msg.room.hostSeat,
          code: msg.room.code,
          modeId: msg.room.modeId,
          maxSeats: msg.room.maxSeats,
          tick: msg.room.tick,
        });
        return;
      case "started":
        this.patch({ phase: "active", tick: 0, paused: false, notice: "Игра началась" });
        return;
      case "full_state": {
        this.patch({ phase: "active", tick: msg.tick, paused: msg.paused, players: msg.players.map((p) => ({ seat: p.seat, nick: p.nick, ready: true, connected: p.connected })) });
        this.opts.onFullState(msg.world, msg.tick);
        return;
      }
      case "snapshot":
        this.patch({
          tick: msg.tick, paused: msg.paused, tacticalLock: msg.tacticalLock,
          pauseVotes: msg.pauseVotes, players: this.state.players.map((p) => {
            const ps = msg.players.find((x) => x.seat === p.seat);
            return ps ? { ...p, nick: ps.nick, connected: ps.connected } : p;
          }),
        });
        this.opts.onSnapshot(msg as unknown as NetSnapshot);
        return;
      case "session":
        this.patch({ paused: msg.paused, notice: msg.reason });
        return;
      case "pause_vote":
        this.patch({ pauseVotes: { for: msg.for, against: msg.against, need: msg.need } });
        return;
      case "chat":
        this.patch({ chat: [...this.state.chat, { nick: msg.nick, text: msg.text, tick: msg.tick }].slice(-50) });
        return;
      case "tactical_lock":
        this.patch({ tacticalLock: { seat: msg.seat, ticksLeft: msg.ticksLeft }, notice: "Тактический лок: игрок " + msg.seat + ", " + msg.ticksLeft + " с" });
        return;
      case "tactical_unlock":
        this.patch({ tacticalLock: null, notice: "Тактический лок снят" });
        return;
      case "notice":
        this.patch({ notice: msg.message, error: msg.code.endsWith("failed") ? msg.message : this.state.error });
        return;
      case "error":
        this.patch({ error: msg.message, notice: msg.message });
        return;
      case "cmd_ack":
        if (!msg.ok) this.patch({ notice: "Команда отклонена: " + (msg.reason ?? "unknown") });
        return;
      case "pong":
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- API
  ready(ready: boolean): void { this.send({ t: "ready", ready }); }
  start(): void { this.send({ t: "start" }); }
  votePause(pause: boolean): void { this.send({ t: "vote_pause", pause }); }
  chat(text: string): void { this.send({ t: "chat", text }); }
  tacticalLock(systemId?: number, pvp?: boolean): void { this.send({ t: "tactical_lock", systemId, pvp }); }
  tacticalUnlock(): void { this.send({ t: "tactical_unlock" }); }
  resync(): void { this.send({ t: "resync" }); }

  /** true — команда ушла на сервер (результат придёт в snapshot/cmd_ack). */
  sendCommand(cmd: Command): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.seq++;
    this.send({ t: "cmd", seq: this.seq, cmd: cmd as unknown as Record<string, unknown> });
    return true;
  }

  leave(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.send({ t: "leave" });
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.patch({ ...EMPTY_STATE });
  }

  get isActive(): boolean { return this.state.phase === "active"; }
  get isHost(): boolean { return this.state.seat >= 0 && this.state.seat === this.state.hostSeat; }
}

/** Фабрика без состояния: LobbyScreen создаёт клиента и передаёт колбэки из Game. */
export function createNetClient(opts: NetClientOptions): NetClient {
  return new NetClient(opts);
}