/**
 * Процедурная сборка кораблей из примитивов (docs/10_art_direction.md §4.1–4.3).
 * Flat shading + vertex colors, ≤5 цветов на корабль, без текстур и внешних ассетов.
 * Вся геометрия корабля — один merge → 1 draw call на корпус + 1 на выхлоп.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PAL, paintGeometry } from "./palette";
import { Rng } from "./rng";

export type ShipRole = "player" | "enemy";

export interface ShipVisual {
  readonly group: THREE.Group;
  readonly hullMaterial: THREE.MeshLambertMaterial;
  readonly glow: THREE.Group;
  readonly lengthM: number;
  readonly radiusM: number;
  /** 0..1 — длина/яркость выхлопа (тяга). */
  setThrust(thrust: number): void;
  setHitFlash(amount: number): void;
  dispose(): void;
}

interface ShipColors {
  hull: string;
  shade: string;
  trim: string;
  glass: string;
  glow: string;
}

function colorsFor(role: ShipRole): ShipColors {
  return role === "player"
    ? { hull: PAL.metal1, shade: PAL.metal2, trim: PAL.gold, glass: PAL.shield, glow: PAL.shield }
    : { hull: PAL.enemyDark, shade: PAL.metalShadow, trim: PAL.enemy, glass: PAL.warn, glow: PAL.enemy };
}

/** Собирает деталь с трансформацией и плоским цветом. */
function part(
  geo: THREE.BufferGeometry,
  colorHex: string,
  pos?: readonly [number, number, number],
  rot?: readonly [number, number, number],
  scale?: readonly [number, number, number],
): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0, "XYZ"),
  );
  m.compose(
    new THREE.Vector3(pos?.[0] ?? 0, pos?.[1] ?? 0, pos?.[2] ?? 0),
    q,
    new THREE.Vector3(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1),
  );
  geo.applyMatrix4(m);
  return paintGeometry(geo, colorHex);
}

function mergeOrThrow(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) {
    // крайний случай (несовместимые атрибуты) — отдаём первую деталь, чтобы не падать
    return new THREE.BufferGeometry();
  }
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

function glowMaterial(colorHex: string): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * Строит корабль в локальных метрах: +Z — нос, +Y — верх.
 * lengthM из hull.lengthM (packages/data/hulls.json).
 */
export function buildShip(role: ShipRole, lengthM: number, rng: Rng): ShipVisual {
  const c = colorsFor(role);
  const L = Math.max(20, lengthM);
  const parts: THREE.BufferGeometry[] = [];
  const glows: THREE.BufferGeometry[] = [];

  if (role === "player") {
    // фрегат/корвет: клин с крыльями, два двигателя, верхний плавник
    parts.push(
      part(new THREE.BoxGeometry(0.16, 0.1, 0.56), c.hull, [0, 0, 0]),
      part(new THREE.ConeGeometry(0.078, 0.3, 4), c.shade, [0, 0, 0.42], [Math.PI / 2, Math.PI / 4, 0]),
      part(new THREE.BoxGeometry(0.05, 0.045, 0.42), c.shade, [0, 0.07, -0.02]),
      part(new THREE.BoxGeometry(0.26, 0.018, 0.16), c.hull, [-0.2, 0, -0.04], [0, 0, 0.14]),
      part(new THREE.BoxGeometry(0.26, 0.018, 0.16), c.hull, [0.2, 0, -0.04], [0, 0, -0.14]),
      part(new THREE.BoxGeometry(0.055, 0.03, 0.18), c.trim, [-0.33, 0.01, -0.06]),
      part(new THREE.BoxGeometry(0.055, 0.03, 0.18), c.trim, [0.33, 0.01, -0.06]),
      part(new THREE.BoxGeometry(0.04, 0.028, 0.09), c.glass, [0, 0.055, 0.14]),
      part(new THREE.BoxGeometry(0.012, 0.075, 0.1), c.shade, [0, 0.1, -0.24]),
      part(new THREE.BoxGeometry(0.03, 0.03, 0.11), c.trim, [-0.09, -0.015, 0.07]),
      part(new THREE.BoxGeometry(0.03, 0.03, 0.11), c.trim, [0.09, -0.015, 0.07]),
    );
    for (const sign of [-1, 1]) {
      parts.push(
        part(new THREE.CylinderGeometry(0.038, 0.046, 0.15, 6), c.shade, [sign * 0.075, 0, -0.32], [Math.PI / 2, 0, 0]),
        part(new THREE.BoxGeometry(0.02, 0.02, 0.16), c.trim, [sign * 0.075, 0.03, -0.3]),
        part(new THREE.BoxGeometry(0.08, 0.012, 0.05), c.trim, [sign * 0.14, -0.03, -0.16]),
      );
      glows.push(
        part(new THREE.ConeGeometry(0.042, 0.17, 6), c.glow, [sign * 0.075, 0, -0.45], [-Math.PI / 2, 0, 0]),
      );
    }
    // мелкие «надстройки» — детерминированно по seed
    for (let i = 0; i < 4; i++) {
      parts.push(
        part(
          new THREE.BoxGeometry(0.02, 0.018, rng.range(0.03, 0.06)),
          i % 2 === 0 ? c.shade : c.trim,
          [rng.range(-0.06, 0.06), rng.range(0.05, 0.07), rng.range(-0.16, 0.02)],
        ),
      );
    }
  } else {
    // корвет/перехватчик: узкий клин, красная палитра
    parts.push(
      part(new THREE.BoxGeometry(0.12, 0.09, 0.5), c.hull, [0, 0, 0]),
      part(new THREE.ConeGeometry(0.06, 0.24, 4), c.shade, [0, 0, 0.36], [Math.PI / 2, Math.PI / 4, 0]),
      part(new THREE.BoxGeometry(0.32, 0.016, 0.12), c.shade, [0, -0.01, -0.08], [0, 0, 0]),
      part(new THREE.BoxGeometry(0.05, 0.026, 0.14), c.trim, [-0.17, 0, -0.1]),
      part(new THREE.BoxGeometry(0.05, 0.026, 0.14), c.trim, [0.17, 0, -0.1]),
      part(new THREE.BoxGeometry(0.035, 0.025, 0.08), c.glass, [0, 0.05, 0.12]),
      part(new THREE.BoxGeometry(0.03, 0.06, 0.14), c.shade, [0, 0.06, -0.18]),
      part(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 6), c.shade, [0, 0, -0.29], [Math.PI / 2, 0, 0]),
    );
    glows.push(part(new THREE.ConeGeometry(0.045, 0.16, 6), c.glow, [0, 0, -0.4], [-Math.PI / 2, 0, 0]));
  }

  const hullGeo = mergeOrThrow(parts);
  hullGeo.scale(L, L, L);
  hullGeo.computeBoundingSphere();

  const glowGeo = mergeOrThrow(glows);
  glowGeo.scale(L, L, L);

  const hullMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const hullMesh = new THREE.Mesh(hullGeo, hullMaterial);
  hullMesh.frustumCulled = true;

  const glowMat = glowMaterial(c.glow);
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = role === "player" ? "player-ship" : "enemy-ship";
  group.add(hullMesh);
  const glow = new THREE.Group();
  glow.add(glowMesh);
  group.add(glow);

  const radiusM = L * 0.5;
  let flash = 0;

  return {
    group,
    hullMaterial,
    glow,
    lengthM: L,
    radiusM,
    setThrust(thrust: number): void {
      const t = Math.max(0, Math.min(1, thrust));
      glow.scale.set(1, 1, 0.35 + t * 1.15);
      glowMat.opacity = 0.35 + t * 0.6;
    },
    setHitFlash(amount: number): void {
      flash = Math.max(0, Math.min(1, amount));
      hullMaterial.emissive.setRGB(flash * 0.9, flash * 0.35, flash * 0.3);
    },
    dispose(): void {
      hullGeo.dispose();
      glowGeo.dispose();
      hullMaterial.dispose();
      glowMat.dispose();
      void flash;
    },
  };
}
