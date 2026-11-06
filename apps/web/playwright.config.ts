/**
 * Playwright-конфигурация QA для «Stellar Frontier».
 * Браузеры Playwright НЕ устанавливаются: используется установленный Chrome (channel "chrome"),
 * БЕЗ флагов swiftshader — иначе WebGL2 не создаётся (проверено на этой машине).
 *
 * Запуск из корня монорепо: pnpm e2e  (или: node pnpm.mjs exec playwright test -c apps/web/playwright.config.ts)
 * Сервер: vite dev @sf/web на 127.0.0.1:5173. Если сервер уже поднят — он переиспользуется.
 */
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

// Playwright сам правит process.execPath, когда запущен через node/pnpm, — берём его.
const NODE_EXE = process.env.SF_NODE ?? process.execPath;
const DEFAULT_PNPM = "C:\\Users\\vawum\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs";
const PNPM_MJS = process.env.SF_PNPM ?? DEFAULT_PNPM;

const baseURL = process.env.SF_BASE_URL ?? "http://127.0.0.1:5173";

const webServerCommand = existsSync(PNPM_MJS)
  ? `"${NODE_EXE}" "${PNPM_MJS}" --filter @sf/web dev`
  : "pnpm --filter @sf/web dev";

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.resolve(repoRoot, "test-results"),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.resolve(repoRoot, "playwright-report") }],
  ],
  use: {
    baseURL,
    viewport: { width: 1600, height: 900 },
    headless: true,
    channel: "chrome",
    launchOptions: { args: [] },
    screenshot: "only-on-failure",
    // trace выключен: артефакт trace конфликтует с параллельными прогонами/очисткой test-results (PT-013)
    trace: "off",
    video: "off",
    actionTimeout: 30_000, // запас под нагрузкой параллельных прогонов (CI/агенты)
    navigationTimeout: 30_000,
  },
  // Внешний сервер (SF_BASE_URL, напр. vite preview) не управляется Playwright:
  // иначе webServer пытается поднять второй dev-сервер/конфликтует с preview (ERR_CONNECTION_REFUSED).
  webServer: process.env.SF_BASE_URL
    ? undefined
    : {
        command: webServerCommand,
        url: baseURL,
        cwd: repoRoot,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [{ name: "chrome-webgl", use: { channel: "chrome" } }],
});