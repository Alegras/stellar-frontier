/**
 * Токены реконнекта M11: генерация, HMAC-хэш (SHA-256 + SF_TOKEN_SECRET), TTL и
 * constant-time сравнение. Сырой токен отдаётся клиенту один раз (HTTP create/join);
 * в памяти и в хранилище держим только хэш — утечка .data/БД не даёт угнать сессию.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 ч
const DEV_SECRET_FALLBACK = "sf-dev-insecure-secret";

export function generateToken(): string {
  return randomUUID();
}

export function hashToken(raw: string, secret: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

/** Constant-time сравнение хэшей (равная длина после hex→Buffer). */
export function verifyTokenHash(raw: string, expectedHash: string, secret: string): boolean {
  if (!expectedHash) return false;
  const actual = Buffer.from(hashToken(raw, secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function verifyToken(raw: string, expectedHash: string, expiresAt: number, secret: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  return verifyTokenHash(raw, expectedHash, secret);
}

/** Constant-time проверка admin-токена (сравниваем SHA-256, чтобы не текла длина). */
export function verifySecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Стабильный секрет токенов: SF_TOKEN_SECRET → файл <dataDir>/token-secret (создаётся один раз),
 * иначе dev-fallback. Файл делает реконнект через рестарт сервера (file-store) рабочим.
 */
export function resolveTokenSecret(explicit?: string, dataDir?: string): string {
  if (explicit && explicit.length >= 8) return explicit;
  const env = process.env.SF_TOKEN_SECRET;
  if (env && env.length >= 8) return env;
  const dir = dataDir ?? process.env.SF_DATA_DIR ?? path.resolve(process.cwd(), ".data");
  try {
    const file = path.join(dir, "token-secret");
    if (existsSync(file)) {
      const saved = readFileSync(file, "utf8").trim();
      if (saved.length >= 32) return saved;
    }
    mkdirSync(dir, { recursive: true });
    const secret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
    return secret;
  } catch {
    return process.env.SF_TOKEN_SECRET && process.env.SF_TOKEN_SECRET.length >= 8
      ? process.env.SF_TOKEN_SECRET
      : DEV_SECRET_FALLBACK;
  }
}
