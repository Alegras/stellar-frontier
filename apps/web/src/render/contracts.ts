import type { GameApi } from "../game/types";

/** Общий интерфейс 3D-вида (карта галактики / полёт в системе). */
export interface SceneView {
  /** dtSec — секунды с прошлого кадра. */
  update(dtSec: number): void;
  resize(cssWidth: number, cssHeight: number): void;
  dispose(): void;
}

export interface ViewInit {
  canvas: HTMLCanvasElement;
  game: GameApi;
}

/** Единая палитра (docs/10_art_direction.md §3): <= 32 цветов. */
export const PALETTE_HEX: string[] = [
  "#05070E", "#0A1020", "#101A2E", "#142038", "#1B2A4A", "#233A5C", "#2E4A70", "#38414F",
  "#5C6878", "#8C99A8", "#B7C2D0", "#E8EEF7", "#FFFFFF", "#F5C542", "#B8862A", "#6BE675",
  "#3FA35A", "#4FC3F7", "#2A7CA8", "#7A5CFF", "#FF5A5A", "#A33030", "#F08A24", "#FFCF6B",
];

export function paletteVec3(): [number, number, number][] {
  return PALETTE_HEX.map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  });
}
