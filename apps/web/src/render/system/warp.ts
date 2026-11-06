/**
 * ВАРП «НАСЛЕДИЕ» (Часть XIII, docs/13_ancients_addendum.md §5, docs/13d_relic_sector.md §2/§10.4).
 * Полётная последовательность: выбор цели (≤ 60 св. лет, включая сектор) → раскрутка 60 с
 * реального времени (в SP при тактической паузе) → прыжок с визуальным эффектом.
 * Кулдаун 5 тактов, 1 заряд ядра, риск 15% привлечь Хор, точность ±1.5 а.е. — из sim-состояния.
 *
 * UI-контракт (подтверждён ui-engineer): Game.warpTelemetry + методы Game.*Warp*.
 */
import * as THREE from "three";
import { PAL, makeGlowTexture } from "./palette";
import { clamp01 } from "./util";

/** Раскрутка варпа: 60 с реального времени (13 §5). Тест-оверрайд: localStorage["sf.warpSpoolSec"]. */
export const WARP_SPOOL_SEC = 60;
/** Кулдаун между прыжками, тактов (13 §5). */
export const WARP_COOLDOWN_TICKS = 5;
/** Радиус варп-прыжка, св. лет (13 §5). */
export const WARP_RANGE_LY = 60;
/** Риск привлечь Хор, % (13 §5). */
export const WARP_RISK_PCT = 15;
/** Точность выхода, а.е. (13 §5). */
export const WARP_ACCURACY_AU = 1.5;
/**
 * Перевод карты в световые годы: в packages/sim/src/types.ts map-единицы помечены «*10 = св. год»,
 * то есть 1 условная единица карты ≈ 10 св. лет. Радиус 60 св. лет = 6 единиц карты.
 */
export const LY_PER_MAP_UNIT = 10;
/** Служебный цвет «туман Предела» (13d §1.5) и биомасса Хора. */
export const SECTOR_MIST = "#3A2B5C";
export const SECTOR_CHORUS = "#6BE08A";

export type WarpPhase = "idle" | "selecting" | "spooling" | "jumping" | "arrived" | "blocked";

/** Делегат варпа, который SystemView регистрирует в Game (UI вызывает через Game.*Warp*). */
export interface WarpControlsDelegate {
  targets(): WarpTargetInfo[];
  select(systemId: number | null): WarpTargetInfo | null;
  request(): boolean;
  cancel(): void;
}

/** Цель варпа: система галактики или сектора. */
export interface WarpTargetInfo {
  id: number;
  name: string;
  /** дистанция от текущей позиции, св. лет */
  distLy: number;
  /** true — система Реликтового Предела */
  sector: boolean;
  /** «gate» — Врата (безъядерный выход), «star» — обычная система */
  kind: "star" | "gate";
}

/** Мутабельная телеметрия варпа для HUD (читается ui-engineer каждый кадр). */
export interface WarpTelemetry {
  active: boolean;
  phase: WarpPhase;
  charges: number;
  cores: number;
  cooldownTicks: number;
  /** 0..1 прогресс раскрутки */
  spoolProgress: number;
  spoolSecondsLeft: number;
  targetSystemId: number | null;
  targetName: string;
  targetDistLy: number;
  riskPct: number;
  accuracyAu: number;
  blockedReason: string;
  inSector: boolean;
  sectorHazard: number;
  sectorStability: number;
  chorusWaveIn: number;
}

export function emptyWarpTelemetry(): WarpTelemetry {
  return {
    active: false,
    phase: "idle",
    charges: 0,
    cores: 0,
    cooldownTicks: 0,
    spoolProgress: 0,
    spoolSecondsLeft: 0,
    targetSystemId: null,
    targetName: "",
    targetDistLy: 0,
    riskPct: WARP_RISK_PCT,
    accuracyAu: WARP_ACCURACY_AU,
    blockedReason: "",
    inSector: false,
    sectorHazard: 0,
    sectorStability: 0,
    chorusWaveIn: 0,
  };
}

function readSpoolSeconds(): number {
  const fallback = WARP_SPOOL_SEC;
  try {
    const raw = localStorage.getItem("sf.warpSpoolSec");
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 1 && value <= 600 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Машина состояний варпа (без визуала и без sim-валидации).
 * Владелец: SystemView; UI вызывает методы Game, которые делегируют сюда.
 */
export class WarpSequence {
  phase: WarpPhase = "idle";
  /** 0..1 */
  spool = 0;
  blockedReason = "";
  readonly targets: WarpTargetInfo[] = [];
  selectedIndex = -1;
  private readonly spoolSec = readSpoolSeconds();
  private launched = false;

  get target(): WarpTargetInfo | null {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.targets.length) return null;
    return this.targets[this.selectedIndex] ?? null;
  }

  get spoolSecondsLeft(): number {
    return Math.max(0, this.spoolSec * (1 - this.spool));
  }

  /** Обновить список целей (сохраняет текущий выбор по id). */
  setTargets(targets: WarpTargetInfo[]): void {
    const currentId = this.target?.id ?? null;
    this.targets.length = 0;
    this.targets.push(...targets);
    if (currentId !== null) {
      const index = this.targets.findIndex((item) => item.id === currentId);
      this.selectedIndex = index >= 0 ? index : (this.targets.length > 0 ? 0 : -1);
    } else if (this.targets.length > 0 && this.selectedIndex < 0) {
      this.selectedIndex = 0;
    }
    if (this.selectedIndex >= this.targets.length) this.selectedIndex = this.targets.length - 1;
    if (this.targets.length === 0) this.selectedIndex = -1;
  }

  selectNext(): WarpTargetInfo | null {
    if (this.targets.length === 0) return null;
    this.selectedIndex = (this.selectedIndex + 1) % this.targets.length;
    this.phase = "selecting";
    this.blockedReason = "";
    return this.target;
  }

  selectById(id: number | null): WarpTargetInfo | null {
    if (id === null) {
      this.selectedIndex = -1;
      return null;
    }
    const index = this.targets.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.selectedIndex = index;
    if (this.phase !== "spooling") {
      this.phase = "selecting";
      this.blockedReason = "";
    }
    return this.target;
  }

  /** Начать раскрутку (валидация sim-условий уже выполнена владельцем). */
  request(): boolean {
    if (this.phase === "spooling" || this.phase === "jumping") return false;
    if (!this.target) {
      this.phase = "blocked";
      this.blockedReason = "Сначала выберите цель варпа (R)";
      return false;
    }
    this.phase = "spooling";
    this.spool = 0;
    this.launched = false;
    this.blockedReason = "";
    return true;
  }

  cancel(): void {
    if (this.phase === "spooling") {
      this.phase = "selecting";
      this.spool = 0;
      this.blockedReason = "Раскрутка отменена";
    }
  }

  block(reasonRu: string): void {
    this.phase = "blocked";
    this.blockedReason = reasonRu;
    this.spool = 0;
  }

  /** Возвращает true один раз, когда раскрутка дошла до 100% — момент прыжка. */
  update(dt: number): boolean {
    if (this.phase !== "spooling") return false;
    this.spool = clamp01(this.spool + dt / this.spoolSec);
    if (this.spool >= 1 && !this.launched) {
      this.launched = true;
      this.phase = "jumping";
      return true;
    }
    return false;
  }

  /** Прыжок выполнен (вид будет пересоздан хостом) или сорвался. */
  finishJump(ok: boolean, reasonRu = ""): void {
    this.phase = ok ? "arrived" : "blocked";
    this.spool = 0;
    this.blockedReason = reasonRu;
  }

  /** Сброс после входа в систему: выбор цели сохраняется для следующего прыжка. */
  resetAfterArrival(): void {
    this.phase = "idle";
    this.spool = 0;
    this.blockedReason = "";
    this.launched = false;
  }
}

/**
 * Визуальный эффект раскрутки/прыжка: радиальные штрихи-стрики, тоннельное кольцо и вспышка.
 * Всё — камера-относительные объекты сцены; уборка в dispose().
 */
export class WarpEffects {
  readonly group = new THREE.Group();
  private readonly streakGeometry = new THREE.BufferGeometry();
  private readonly streakMaterial: THREE.LineBasicMaterial;
  private readonly streakPositions: Float32Array;
  private readonly streakLines = 96;
  private readonly seeds: { angle: number; radius: number; depth: number; speed: number }[] = [];
  private readonly ring: THREE.Sprite;
  private readonly flash: THREE.Sprite;
  private readonly flashMaterial: THREE.SpriteMaterial;
  private readonly ringMaterial: THREE.SpriteMaterial;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private elapsed = 0;
  private flashTimer = 0;

  constructor(parent: THREE.Object3D, rng: { range(min: number, max: number): number }) {
    this.group.name = "warp-effects";
    parent.add(this.group);
    this.group.frustumCulled = false;

    this.streakPositions = new Float32Array(this.streakLines * 2 * 3);
    this.streakGeometry.setAttribute("position", new THREE.BufferAttribute(this.streakPositions, 3));
    this.streakMaterial = new THREE.LineBasicMaterial({
      color: PAL.text,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const streaks = new THREE.LineSegments(this.streakGeometry, this.streakMaterial);
    streaks.frustumCulled = false;
    this.group.add(streaks);
    for (let i = 0; i < this.streakLines; i++) {
      this.seeds.push({
        angle: rng.range(0, Math.PI * 2),
        radius: rng.range(6, 46),
        depth: rng.range(40, 260),
        speed: rng.range(0.6, 1.6),
      });
    }

    const ringTex = makeGlowTexture(64, [
      [0, PAL.white + "00"],
      [0.42, SECTOR_MIST + "00"],
      [0.72, PAL.shield + "aa"],
      [1, PAL.white],
    ]);
    this.ringMaterial = new THREE.SpriteMaterial({
      map: ringTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Sprite(this.ringMaterial);
    this.ring.scale.setScalar(420);
    this.group.add(this.ring);

    const flashTex = makeGlowTexture(64, [
      [0, PAL.white],
      [0.4, PAL.white],
      [0.75, PAL.shield + "88"],
      [1, PAL.white + "00"],
    ]);
    this.flashMaterial = new THREE.SpriteMaterial({
      map: flashTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Sprite(this.flashMaterial);
    this.flash.scale.setScalar(9000);
    this.group.add(this.flash);
  }

  /** Вспышка прыжка (0..1) — вызывается в момент warp-прыжка. */
  triggerFlash(): void {
    this.flashTimer = 1;
  }

  /**
   * @param spool 0..1 раскрутка
   * @param sectorIntensity 0..1 «зов»/биомасса Хора (тинт эффекта)
   */
  update(dt: number, camera: THREE.Camera, spool: number, sectorIntensity = 0): void {
    this.elapsed += dt;
    this.flashTimer = Math.max(0, this.flashTimer - dt * 1.6);
    const intensity = clamp01(spool);
    const flashAmount = clamp01(this.flashTimer);
    this.streakMaterial.opacity = Math.max(intensity * 0.55, flashAmount * 0.9);
    this.streakMaterial.color.set(intensity > 0.5 ? PAL.white : PAL.text);
    this.ringMaterial.opacity = intensity * 0.5 + flashAmount * 0.4;
    this.flashMaterial.opacity = flashAmount;

    camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, camera.up).normalize();
    this.up.crossVectors(this.right, this.forward).normalize();

    if (this.streakMaterial.opacity > 0.01) {
      const travel = this.elapsed * (14 + 220 * intensity);
      for (let i = 0; i < this.streakLines; i++) {
        const seed = this.seeds[i]!;
        const offset = (seed.depth + travel * seed.speed) % 320;
        const near = 30 + offset;
        const far = near + 30 + 260 * intensity * seed.speed;
        const px = camera.position.x + this.forward.x * near + this.right.x * Math.cos(seed.angle) * seed.radius + this.up.x * Math.sin(seed.angle) * seed.radius;
        const py = camera.position.y + this.forward.y * near + this.right.y * Math.cos(seed.angle) * seed.radius + this.up.y * Math.sin(seed.angle) * seed.radius;
        const pz = camera.position.z + this.forward.z * near + this.right.z * Math.cos(seed.angle) * seed.radius + this.up.z * Math.sin(seed.angle) * seed.radius;
        const qx = camera.position.x + this.forward.x * far;
        const qy = camera.position.y + this.forward.y * far;
        const qz = camera.position.z + this.forward.z * far;
        const base = i * 6;
        this.streakPositions[base] = px;
        this.streakPositions[base + 1] = py;
        this.streakPositions[base + 2] = pz;
        this.streakPositions[base + 3] = qx;
        this.streakPositions[base + 4] = qy;
        this.streakPositions[base + 5] = qz;
      }
      this.streakGeometry.getAttribute("position").needsUpdate = true;
    }

    const ahead = 60 + 200 * intensity;
    this.ring.position.copy(camera.position).addScaledVector(this.forward, ahead);
    this.ring.scale.setScalar(340 + 900 * intensity);
    this.flash.position.copy(camera.position).addScaledVector(this.forward, 120);
    // «зов» Хора: зелёный оттенок тоннеля
    this.ringMaterial.color.set(sectorIntensity > 0.4 ? SECTOR_CHORUS : PAL.shield);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.streakGeometry.dispose();
    this.streakMaterial.dispose();
    this.ringMaterial.map?.dispose();
    this.ringMaterial.dispose();
    this.flashMaterial.map?.dispose();
    this.flashMaterial.dispose();
  }
}
