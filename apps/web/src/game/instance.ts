import { Game } from "./Game";

/** Синглтон игры (в SP клиент = сервер, канон §IX-b: тот же код). */
export const game = new Game();
export type { Game as GameType };
// Для e2e/отладки: доступ к экземпляру игры из консоли и Playwright.
if (typeof window !== "undefined") {
  (window as unknown as { __SF_GAME__: Game }).__SF_GAME__ = game;
}
