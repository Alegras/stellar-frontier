#!/usr/bin/env node
/**
 * Unit-тест токенов реконнекта M11: HMAC-хэш, TTL, отказ чужим токенам, admin-secret constant-time.
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/token-test.mjs
 */
import assert from "node:assert/strict";
const { DEFAULT_TOKEN_TTL_MS, generateToken, hashToken, verifySecret, verifyToken, verifyTokenHash } = await import("../apps/api/src/auth/token.ts");

let passed = 0;
const pass = (n, d) => { passed++; console.log("PASS " + n + (d ? " — " + d : "")); };
const secret = "unit-test-secret-0123456789";

const raw = generateToken();
assert.equal(raw.length >= 32, true);
const h = hashToken(raw, secret);
assert.match(h, /^[0-9a-f]{64}$/);
assert.notEqual(h, raw);
assert.equal(verifyTokenHash(raw, h, secret), true);
pass("HMAC hash/verify", "hash=" + h.slice(0, 16) + "…");

assert.equal(verifyTokenHash(raw + "x", h, secret), false);
assert.equal(verifyTokenHash(raw, hashToken(raw, "другой-секрет"), secret), false);
pass("wrong token/secret rejected");

const exp = Date.now() + DEFAULT_TOKEN_TTL_MS;
assert.equal(verifyToken(raw, h, exp, secret), true);
assert.equal(verifyToken(raw, h, Date.now() - 1, secret), false);
assert.equal(verifyToken(raw, h, 0, secret), false);
pass("TTL: expired rejected, fresh accepted", "ttl=" + DEFAULT_TOKEN_TTL_MS / 3600000 + "h");

assert.equal(verifySecret("admin", "admin"), true);
assert.equal(verifySecret("admin", "admin2"), false);
assert.equal(verifySecret(undefined, "admin"), false);
pass("admin secret constant-time compare");

const raw2 = generateToken();
assert.notEqual(hashToken(raw2, secret), h);
pass("unique tokens → unique hashes");
console.log("TOKEN TEST: " + passed + " проверок PASS");
