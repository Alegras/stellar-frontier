/**
 * E2E мультиплеера M11: два независимых браузерных контекста, реальный сервер API в процессе.
 * Проверяет: лобби (создание/вход), ready/start, получение мира, одинаковый тик у обоих клиентов.
 *
 * Запуск: SF_BASE_URL=<prod preview> playwright test -c apps/web/playwright.config.ts e2e/mp.spec.ts
 * (сервер API поднимается на эфемерном порту прямо в тесте).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NODE_EXE = process.env.SF_NODE ?? process.execPath;
const PNPM_MJS = process.env.SF_PNPM ?? "C:\\Users\\vawum\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs";

let api: ChildProcess | null = null;
let apiUrl = "";

/** Сервер API поднимаем отдельным процессом (node --import tsx), как в проде; ждём строку "listening on". */
test.beforeAll(async () => {
  api = spawn(NODE_EXE, ["--import", "tsx", "apps/api/src/server.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      SF_TEST_COOP_TICK_MS: "250",
      SF_TEST_COOP_SNAPSHOT_MS: "250",
      SF_TEST_RECONNECT_GRACE_MS: "5000",
      SF_TEST_PAUSE_COOLDOWN_MS: "250",
      SF_PERSISTENCE: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("API не стартовал за 30 с")), 30_000);
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[1]!); }
    };
    api!.stdout?.on("data", onData);
    api!.stderr?.on("data", onData);
    api!.on("exit", (code) => { clearTimeout(timer); reject(new Error("API завершился: " + code + "\n" + buf)); });
  });
  apiUrl = url;
});

test.afterAll(async () => {
  if (api) {
    api.removeAllListeners("exit");
    api.kill("SIGKILL");
    api = null;
  }
});

async function openLobby(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/?lobby=1&mpApi=" + encodeURIComponent(apiUrl), { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="lobby"]')).toBeVisible({ timeout: 20_000 });
  return page;
}

async function tickOf(page: Page): Promise<number> {
  const text = await page.locator('[data-testid="tick-counter"]').innerText();
  const m = /\d+/.exec(text.replace(/\s/g, ""));
  return m ? Number(m[0]) : -1;
}

test("два браузера: лобби → start → синхронный мир", async ({ browser }) => {
  test.setTimeout(120_000);
  const alice = await openLobby(browser);
  const bob = await openLobby(browser);
  const ctxA = alice.context();
  const ctxB = bob.context();

  // Alice создаёт комнату
  await alice.locator('[data-testid="lobby-nick"]').fill("Alice");
  await alice.locator('[data-testid="lobby-create"]').click();
  await expect(alice.locator('[data-testid="lobby-room-code"]')).toBeVisible({ timeout: 20_000 });
  const code = (await alice.locator('[data-testid="lobby-room-code"]').innerText()).trim();
  expect(code.length).toBeGreaterThanOrEqual(4);

  // Bob входит по коду
  await bob.locator('[data-testid="lobby-nick"]').fill("Bob");
  await bob.locator('[data-testid="lobby-code"]').fill(code);
  await bob.locator('[data-testid="lobby-join"]').click();

  // У обоих в списке 2 игрока
  await expect(bob.locator('[data-testid="lobby-players"]')).toContainText("Alice", { timeout: 20_000 });
  await expect(alice.locator('[data-testid="lobby-players"]')).toContainText("Bob", { timeout: 20_000 });

  // ready + start
  await alice.locator('[data-testid="lobby-ready"]').click();
  await bob.locator('[data-testid="lobby-ready"]').click();
  await expect(alice.locator('[data-testid="lobby-start"]')).toBeEnabled({ timeout: 10_000 });
  await alice.locator('[data-testid="lobby-start"]').click();

  // Мир получен в обоих браузерах: полёт/карта видимы, канвас есть
  await expect(alice.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 30_000 });
  await expect(bob.locator('[data-testid="top-bar"]')).toBeVisible({ timeout: 30_000 });
  await expect(alice.locator('[data-testid="game-canvas"]')).toBeVisible();
  await expect(bob.locator('[data-testid="game-canvas"]')).toBeVisible();

  // Тики идут синхронно (дожидаемся одинакового тика)
  await expect.poll(async () => {
    const [a, b] = await Promise.all([tickOf(alice), tickOf(bob)]);
    return a > 1 && a === b;
  }, { timeout: 30_000, intervals: [400] }).toBe(true);

  const [ta, tb] = await Promise.all([tickOf(alice), tickOf(bob)]);
  console.log("[mp-e2e] code=" + code + " tick Alice=" + ta + " Bob=" + tb);
  expect(ta).toBe(tb);
  expect(ta).toBeGreaterThan(1);

  // Скриншот лобби-статуса (MP-режим) для docs/shots
  await alice.screenshot({ path: "docs/shots/07-mp-coop.png" });

  await ctxA.close();
  await ctxB.close();
});