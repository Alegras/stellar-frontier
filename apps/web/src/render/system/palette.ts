/**
 * Палитра и общие цветовые/боевые константы сцены.
 * docs/10_art_direction.md §3: все цвета — из единого PALETTE_HEX (≤32 цвета, без текстур).
 */
import * as THREE from "three";
import type { PlanetType, StarType } from "@sf/sim";
import type { DamageType } from "@sf/data";
import { PALETTE_HEX } from "../contracts";

function idx(i: number): string {
  return PALETTE_HEX[i] ?? "#FFFFFF";
}

/** Именованные роли палитры (индексы — по порядку PALETTE_HEX). */
export const PAL = {
  space: idx(0),
  spaceDeep: idx(1),
  spaceFar: idx(2),
  hullShade: idx(3),
  nebula1: idx(4),
  nebula2: idx(5),
  nebula3: idx(6),
  metalShadow: idx(7),
  metal2: idx(8),
  metal1: idx(9),
  text2: idx(10),
  text: idx(11),
  white: idx(12),
  gold: idx(13),
  goldDark: idx(14),
  ok: idx(15),
  okDark: idx(16),
  shield: idx(17),
  shieldDark: idx(18),
  psi: idx(19),
  enemy: idx(20),
  enemyDark: idx(21),
  warn: idx(22),
  warnLight: idx(23),
} as const;

const STAR_COLORS: Record<StarType, string> = {
  yellow: PAL.gold,
  orange: PAL.warn,
  red: PAL.enemy,
  blue: PAL.shield,
  white: PAL.text,
  binary: PAL.gold,
  trinary: PAL.gold,
  neutron: PAL.text2,
  pulsar: PAL.psi,
  blackhole: PAL.spaceDeep,
  nebula: PAL.nebula2,
};

export function starColor(type: StarType): string {
  return STAR_COLORS[type] ?? PAL.gold;
}

/** Радиус звезды в метрах (сжатый масштаб системы: 1 unit = 1 м). */
export function starRadiusM(type: StarType): number {
  switch (type) {
    case "blackhole":
      return 1800;
    case "neutron":
      return 900;
    case "pulsar":
      return 1200;
    case "white":
      return 3200;
    case "blue":
      return 4200;
    case "red":
      return 3000;
    default:
      return 4000;
  }
}

/** 2–3 цвета поверхности планеты по типу (docs/03_hybrid_gdd.md §4.5). */
const PLANET_COLORS: Record<PlanetType, readonly [string, string, string]> = {
  continental: [PAL.okDark, PAL.ok, PAL.shieldDark],
  ocean: [PAL.shieldDark, PAL.shield, PAL.text2],
  desert: [PAL.goldDark, PAL.gold, PAL.warnLight],
  tundra: [PAL.metal2, PAL.text2, PAL.white],
  arctic: [PAL.text2, PAL.white, PAL.metal1],
  savanna: [PAL.okDark, PAL.goldDark, PAL.gold],
  tropical: [PAL.ok, PAL.okDark, PAL.shieldDark],
  arid: [PAL.goldDark, PAL.warn, PAL.gold],
  volcanic: [PAL.enemyDark, PAL.warn, PAL.metalShadow],
  gas_giant: [PAL.nebula2, PAL.metal2, PAL.nebula3],
  barren: [PAL.metalShadow, PAL.metal2, PAL.metal1],
  asteroid_belt: [PAL.metal2, PAL.metalShadow, PAL.metal1],
};

export function planetColors(type: PlanetType): readonly [string, string, string] {
  return PLANET_COLORS[type] ?? PLANET_COLORS.barren;
}

/** Таблица резистов (docs/03_hybrid_gdd.md §10.4): «+» — снижение урона, «−» — уязвимость. */
export interface ResistSet {
  shield: number;
  armor: number;
  hull: number;
}

export const RESIST: Record<DamageType, ResistSet> = {
  kinetic: { shield: 0.25, armor: -0.15, hull: 0.1 },
  energy: { shield: -0.2, armor: 0.25, hull: 0.05 },
  explosive: { shield: 0.1, armor: 0.1, hull: 0.2 },
  thermal: { shield: 0.05, armor: 0.05, hull: 0.1 },
};

/**
 * Красит геометрию плоским vertex color (конвертирует в non-indexed ради flat shading).
 * Исходная indexed-геометрия освобождается.
 */
export function paintGeometry(geo: THREE.BufferGeometry, colorHex: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const position = g.getAttribute("position");
  const count = position.count;
  const c = new THREE.Color(colorHex);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Пиксельный спрайт-градиент (CanvasTexture — единственный допустимый «ассет»). */
export function makeGlowTexture(
  size: number,
  stops: readonly (readonly [number, string])[],
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    for (const [offset, color] of stops) grad.addColorStop(offset, color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
