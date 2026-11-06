/**
 * Сетевой протокол «Stellar Frontier» (M11): единый контракт клиента, сервера и тестов.
 * Транспорт: JSON over WebSocket для лобби/команд/снапшотов; HTTP — только лобби (создание/вход/инфо).
 * Входящие сообщения обеих сторон валидируются zod; исходящие типизируются из тех же схем.
 *
 * Упрощения среза (см. docs/mp-protocol.md):
 * - снапшоты JSON, а не бинарные (полные Colyseus-схемы — M12); частота и поля ограничены.
 * - interest management не реализован: снапшот содержит владельцев систем/флоты без тумана войны.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MIN_VERSION = 1;
export const MAX_NICK_LEN = 24;
export const MAX_CHAT_LEN = 256;
export const MAX_COMMAND_BYTES = 4096;
export const ROOM_CODE_REGEX = /^[A-Z0-9]{4,8}$/;
export const DEFAULT_RECONNECT_GRACE_MS = 30_000;
export const DEFAULT_TACTICAL_LOCK_S = 90;
export const DEFAULT_TACTICAL_LOCK_PVP_S = 120;
export const MAX_TACTICAL_LOCKS_PER_HOUR = 12;
export const MAX_PAUSES_PER_HOUR = 3;
export const PAUSE_VOTE_COOLDOWN_MS = 5_000;
export const CMD_RATE_PER_SEC = 5;
export const CMD_BURST = 10;
export const CHAT_RATE_PER_SEC = 1;
export const MAX_WS_MESSAGE_BYTES = 64 * 1024;

export type GameModeId = "campaign" | "coop" | "mmo" | "sandbox" | "trial";

export interface ModeLimits {
  modeId: GameModeId;
  displayRu: string;
  playersMax: number;
  tickMs: number;
  snapshotMs: number;
  pausePolicy: "free" | "vote" | "none";
  tacticalLockS: number;
  tacticalLockPvpS: number;
}

export const BUILTIN_MODES: Record<string, ModeLimits> = {
  coop: {
    modeId: "coop", displayRu: "Кооператив", playersMax: 4, tickMs: 1000, snapshotMs: 1000,
    pausePolicy: "vote", tacticalLockS: DEFAULT_TACTICAL_LOCK_S, tacticalLockPvpS: DEFAULT_TACTICAL_LOCK_PVP_S,
  },
  mmo: {
    modeId: "mmo", displayRu: "MMO-сезон", playersMax: 100, tickMs: 900_000, snapshotMs: 5000,
    pausePolicy: "none", tacticalLockS: DEFAULT_TACTICAL_LOCK_S, tacticalLockPvpS: DEFAULT_TACTICAL_LOCK_PVP_S,
  },
  campaign: {
    modeId: "campaign", displayRu: "Кампания", playersMax: 1, tickMs: 1000, snapshotMs: 1000,
    pausePolicy: "free", tacticalLockS: DEFAULT_TACTICAL_LOCK_S, tacticalLockPvpS: DEFAULT_TACTICAL_LOCK_PVP_S,
  },
  sandbox: {
    modeId: "sandbox", displayRu: "Песочница", playersMax: 1, tickMs: 1000, snapshotMs: 1000,
    pausePolicy: "free", tacticalLockS: DEFAULT_TACTICAL_LOCK_S, tacticalLockPvpS: DEFAULT_TACTICAL_LOCK_PVP_S,
  },
  trial: {
    modeId: "trial", displayRu: "Испытание", playersMax: 1, tickMs: 1000, snapshotMs: 1000,
    pausePolicy: "none", tacticalLockS: DEFAULT_TACTICAL_LOCK_S, tacticalLockPvpS: DEFAULT_TACTICAL_LOCK_PVP_S,
  },
};

// ------------------------------------------------------------------ лобби

export const RoomPublicSchema = z.object({
  code: z.string(),
  modeId: z.string(),
  state: z.enum(["lobby", "active", "finished"]),
  players: z.array(z.object({
    seat: z.number().int().nonnegative(),
    nick: z.string(),
    ready: z.boolean(),
    connected: z.boolean(),
  })),
  maxSeats: z.number().int().positive(),
  hostSeat: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  createdAt: z.number(),
});
export type RoomPublic = z.infer<typeof RoomPublicSchema>;

export const CreateRoomRequestSchema = z.object({
  modeId: z.enum(["coop", "mmo"]).default("coop"),
  nick: z.string().trim().min(1).max(MAX_NICK_LEN),
  seed: z.number().int().nonnegative().optional(),
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const JoinRoomRequestSchema = z.object({
  nick: z.string().trim().min(1).max(MAX_NICK_LEN),
});
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>;

export const CreateRoomResponseSchema = z.object({
  code: z.string(),
  seat: z.number().int().nonnegative(),
  token: z.string(),
  room: RoomPublicSchema,
  wsUrl: z.string(),
});
export const JoinRoomResponseSchema = CreateRoomResponseSchema;
export type CreateRoomResponse = z.infer<typeof CreateRoomResponseSchema>;
export type JoinRoomResponse = z.infer<typeof JoinRoomResponseSchema>;

// ------------------------------------------------------------------ C → S

export const ClientHelloSchema = z.object({
  t: z.literal("hello"),
  protocol: z.number().int().min(PROTOCOL_MIN_VERSION).max(PROTOCOL_VERSION),
  roomCode: z.string().regex(ROOM_CODE_REGEX).optional(),
  token: z.string().min(8).max(128).optional(),
  nick: z.string().trim().min(1).max(MAX_NICK_LEN).optional(),
  lastAckTick: z.number().int().nonnegative().optional(),
});
export const ClientReadySchema = z.object({ t: z.literal("ready"), ready: z.boolean() });
export const ClientStartSchema = z.object({ t: z.literal("start") });
export const ClientLeaveSchema = z.object({ t: z.literal("leave") });
export const ClientCmdSchema = z.object({
  t: z.literal("cmd"),
  seq: z.number().int().min(0).max(1_000_000),
  cmd: z.object({ type: z.string().min(1).max(40) }).passthrough(),
});
export const ClientVotePauseSchema = z.object({ t: z.literal("vote_pause"), pause: z.boolean() });
export const ClientChatSchema = z.object({
  t: z.literal("chat"),
  text: z.string().trim().min(1).max(MAX_CHAT_LEN),
});
export const ClientTacticalLockSchema = z.object({
  t: z.literal("tactical_lock"),
  systemId: z.number().int().nonnegative().optional(),
  pvp: z.boolean().optional(),
});
export const ClientTacticalUnlockSchema = z.object({ t: z.literal("tactical_unlock") });
export const ClientPingSchema = z.object({ t: z.literal("ping"), ts: z.number().int().nonnegative() });
export const ClientResyncSchema = z.object({ t: z.literal("resync") });

export const ClientMessageSchema = z.discriminatedUnion("t", [
  ClientHelloSchema,
  ClientReadySchema,
  ClientStartSchema,
  ClientLeaveSchema,
  ClientCmdSchema,
  ClientVotePauseSchema,
  ClientChatSchema,
  ClientTacticalLockSchema,
  ClientTacticalUnlockSchema,
  ClientPingSchema,
  ClientResyncSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ClientMessageType = ClientMessage["t"];

// ------------------------------------------------------------------ S → C

export const PlayerSnapshotSchema = z.object({
  seat: z.number().int().nonnegative(),
  nick: z.string(),
  empireId: z.number().int().nonnegative(),
  connected: z.boolean(),
  resources: z.record(z.string(), z.number()),
  income: z.record(z.string(), z.number()),
  science: z.record(z.string(), z.number()),
  colonies: z.number().int().nonnegative(),
  systems: z.number().int().nonnegative(),
  fleetPower: z.number(),
  score: z.number(),
});
export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>;

export const ServerWelcomeSchema = z.object({
  t: z.literal("welcome"),
  protocol: z.number().int(),
  room: RoomPublicSchema,
  seat: z.number().int().nonnegative(),
  token: z.string(),
  resumed: z.boolean(),
  tick: z.number().int().nonnegative(),
});
export const ServerRoomSchema = z.object({
  t: z.literal("room"),
  room: RoomPublicSchema,
  youSeat: z.number().int().nonnegative().optional(),
});
export const ServerStartedSchema = z.object({
  t: z.literal("started"),
  seed: z.number().int().nonnegative(),
  modeId: z.string(),
  tickMs: z.number().int().positive(),
  empireId: z.number().int().nonnegative(),
  players: z.array(RoomPublicSchema.shape.players.element),
});
export const ServerFullStateSchema = z.object({
  t: z.literal("full_state"),
  tick: z.number().int().nonnegative(),
  paused: z.boolean(),
  players: z.array(PlayerSnapshotSchema),
  world: z.string(),
});
export const ServerSnapshotSchema = z.object({
  t: z.literal("snapshot"),
  tick: z.number().int().nonnegative(),
  paused: z.boolean(),
  speed: z.number(),
  tacticalLock: z.object({ seat: z.number(), ticksLeft: z.number() }).nullable(),
  pauseVotes: z.object({ for: z.number(), against: z.number(), need: z.number() }),
  victory: z.object({ achieved: z.string().nullable(), winnerEmpireId: z.number() }),
  players: z.array(PlayerSnapshotSchema),
  fleets: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.string()])),
  systems: z.array(z.number()),
  events: z.array(z.object({ id: z.number(), tick: z.number(), kind: z.string(), severity: z.string(), messageRu: z.string() })),
});
export const ServerCmdAckSchema = z.object({
  t: z.literal("cmd_ack"),
  seq: z.number().int().nonnegative(),
  ok: z.boolean(),
  tick: z.number().int().nonnegative(),
  reason: z.string().optional(),
});
export const ServerSessionSchema = z.object({
  t: z.literal("session"),
  paused: z.boolean(),
  reason: z.string(),
  votes: z.object({ for: z.number(), against: z.number(), need: z.number() }).optional(),
});
export const ServerPauseVoteSchema = z.object({
  t: z.literal("pause_vote"),
  for: z.number(),
  against: z.number(),
  need: z.number(),
  bySeat: z.number(),
  pause: z.boolean(),
});
export const ServerChatSchema = z.object({
  t: z.literal("chat"),
  seat: z.number(),
  nick: z.string(),
  text: z.string(),
  tick: z.number(),
});
export const ServerTacticalLockSchema = z.object({
  t: z.literal("tactical_lock"),
  seat: z.number(),
  until: z.number(),
  ticksLeft: z.number(),
  pvp: z.boolean(),
});
export const ServerTacticalUnlockSchema = z.object({ t: z.literal("tactical_unlock") });
export const ServerNoticeSchema = z.object({
  t: z.literal("notice"),
  code: z.string(),
  message: z.string(),
  seat: z.number().optional(),
});
export const ServerPongSchema = z.object({ t: z.literal("pong"), ts: z.number() });
export const ServerErrorSchema = z.object({
  t: z.literal("error"),
  code: z.string(),
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion("t", [
  ServerWelcomeSchema,
  ServerRoomSchema,
  ServerStartedSchema,
  ServerFullStateSchema,
  ServerSnapshotSchema,
  ServerCmdAckSchema,
  ServerSessionSchema,
  ServerPauseVoteSchema,
  ServerChatSchema,
  ServerTacticalLockSchema,
  ServerTacticalUnlockSchema,
  ServerNoticeSchema,
  ServerPongSchema,
  ServerErrorSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ------------------------------------------------------------------ утилиты

export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessageSchema.parse(raw);
}

export function safeParseClientMessage(raw: unknown):
  | { ok: true; message: ClientMessage }
  | { ok: false; error: string } {
  const parsed = ClientMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ") };
  }
  return { ok: true, message: parsed.data };
}

/** Компактный код комнаты (4–8 символов A-Z0-9), криптостойкость не требуется. */
export function generateRoomCode(length = 5, rnd: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(rnd() * alphabet.length)];
  return out;
}

export const PROTOCOL_DOC = {
  version: PROTOCOL_VERSION,
  transport: "WSS JSON (лобби/команды/снапшоты), HTTP (лобби)",
  serverMessages: ServerMessageSchema.options.map((o) => o.shape.t.value),
  clientMessages: ClientMessageSchema.options.map((o) => o.shape.t.value),
} as const;
