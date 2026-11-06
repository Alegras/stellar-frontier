/**
 * SystemView — режим полёта (M3/M4, docs/03_hybrid_gdd.md §10).
 * Сцена системы (звезда/планеты/пояс/станция/фон), 6DOF-полёт, суперкруиз, стыковка,
 * FSD-прыжок по гиперлинии, тактический бой с BattleRecord и HUD-телеметрия.
 *
 * Вся уборка — в dispose(): слушатели, геометрии, материалы, текстуры, renderer.
 * Рендер — только через PixelPipeline (новых WebGLRenderer не создаём).
 */
import * as THREE from "three";
import { DESIGN_BY_ID, HULL_BY_ID, WEAPON_BY_ID } from "@sf/data";
import type { HullDef, ShipDesignDef, WeaponDef } from "@sf/data";
import type { AncientsSectorSystem, Fleet, Ship, StarSystem, World } from "@sf/sim";
import { sectorDeathReturn as simSectorDeathReturn, warpRadiusLy, warpStatus } from "@sf/sim";
import type { FlightTelemetry, GameApi, RenderSettings } from "../../game/types";
import type { SceneView } from "../contracts";
import { PixelPipeline, type PixelOptions } from "../PixelPipeline";
import { EnemyShip, EffectPool, ProjectileField, makeBattleRecord } from "./combat";
import { FlightModel, turnRates } from "./flight";
import type { FlightStats } from "./flight";
import { InputController } from "./input";
import { PAL } from "./palette";
import { Rng } from "./rng";
import { SCENE_FAR_M, SystemScene } from "./scene";
import { buildShip, type ShipVisual } from "./ships";
import { clamp, clamp01, damp, formatDist, safeNum } from "./util";
import {
  WarpEffects, WarpSequence, WARP_ACCURACY_AU, WARP_RISK_PCT,
  type WarpTelemetry, type WarpTargetInfo,
} from "./warp";
import {
  resolveSectorSystem, sectorMeta, sectorSpawn, sectorVariantFor, warpTargetsAround,
  type SectorVariant,
} from "./sector";

/** Стыковка (GDD §10.1 / docs/05_ux_ui_spec.md §5.2): ≤ 2,5 км и скорость < 120 м/с. */
const DOCK_RANGE_M = 2500;
const DOCK_SPEED_M_S = 120;
/**
 * Автопилот-помощник стыковки (docs/06 M3: «стыковка: запрос, коридор, автопилот-помощник»).
 * G в радиусе 12 км включает подлёт к станции; ручной ввод мгновенно его отменяет.
 */
const DOCK_APPROACH_RANGE_M = 12000;
const DOCK_APPROACH_SPEED_M_S = 320;
const DOCK_FINAL_RANGE_M = 2800;
const DOCK_FINAL_SPEED_M_S = 90;
/** Касание станции на такой скорости = автостыковка (быстрее — отскок и урон). */
const AUTO_DOCK_SPEED_M_S = 800;
/** Сколько вражеских кораблей спавним в тактическом бою (docs/06 M4: «бой с 3 пиратами»). */
const MAX_ENEMY_SHIPS = 3;
/** Дистанция спавна игрока от станции, м (лид: 3–8 км, чтобы док был достижим за 20–40 с). */
const SPAWN_DISTANCE_M = 5000;
/** Время зарядки FSD (GDD §10.8: 15 с вне боя; для вертикального среза ускоряем). */
const FSD_CHARGE_SEC = 3.5;
/** Чувствительность «мыши-штурвала» (рад на пиксель движения). */
const MOUSE_RAD_PER_PX = 0.0022;
/** Масса-лок: враг или тело ближе этой дистанции блокирует FSD (приближение GDD §10.8). */
const MASS_LOCK_RANGE_M = 2500;
/** Скорость кинетических снарядов игрока, м/с (данные оружия speed не содержат). */
const KINETIC_PROJECTILE_SPEED = 2600;

interface TargetRef {
  kind: "enemy" | "station";
  name: string;
  position: THREE.Vector3;
  hull01: number | null;
  enemy: EnemyShip | null;
}

const UP = new THREE.Vector3(0, 1, 0);

export class SystemView implements SceneView {
  private readonly canvas: HTMLCanvasElement;
  private readonly game: GameApi;
  private readonly systemId: number;
  private readonly rng: Rng;
  private readonly pipeline: PixelPipeline;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sysScene: SystemScene;
  private readonly system: StarSystem;
  private readonly input: InputController;
  private readonly flight: FlightModel;
  private readonly playerShip: ShipVisual;
  private readonly projectileField = new ProjectileField();
  private readonly effectPool = new EffectPool();
  private readonly enemyShips: EnemyShip[] = [];

  private readonly shipLengthM: number;
  private readonly laserWeapons: WeaponDef[] = [];
  private readonly kineticWeapons: WeaponDef[] = [];
  private readonly laserCooldowns: number[] = [];
  private readonly kineticCooldowns: number[] = [];
  private readonly navIds: number[] = [];
  private readonly playerFleet: Fleet | null;
  private readonly enemyFleet: Fleet | null;

  private appliedOptions: PixelOptions;
  private appliedSettings: RenderSettings;
  private targetIndex = 0;
  private navIndex = -1;
  private fsdCharge = 0;
  private fsdJumping = false;
  private brakeTimer = 0;
  private wepEnergy = 100;
  private time = 0;
  private disposed = false;
  private frozen = false;
  private reportSent = false;
  private deathHandled = false;
  private exitAt = 0;
  private battleStartedAt = 0;
  private stationDistanceM = Number.POSITIVE_INFINITY;
  private massLocked = false;
  private frameCalls = 0;
  private frameTriangles = 0;
  private lastCrashAt = -999;
  private lastMode: string = "system";
  private autoDockBlockedUntil = 0;
  /** Автопилот стыковки активен (G в радиусе подлёта). */
  private dockApproach = false;
  private dockApproachStationId = 0;
  private readonly dockDir = new THREE.Vector3();
  private readonly dockOrigin = new THREE.Vector3();
  private readonly dockQuat = new THREE.Quaternion();
  private readonly dockMatrix = new THREE.Matrix4();
  private lastCrashName: string | null = null;
  private readonly prevPosition = new THREE.Vector3();
  private readonly colPoint = new THREE.Vector3();
  private readonly colNormal = new THREE.Vector3();
  private readonly colScratch = new THREE.Vector3();
  private readonly attackerFp: number;
  private readonly attackerShipsBefore: number;
  private readonly defenderFp: number;
  private readonly defenderShipsBefore: number;
  private readonly contactScratch = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  // -------------------------------------------------- Часть XIII: варп и Предел
  /** Метаданные секторной системы (fg.ancients.sector.systems) или null в галактике. */
  private readonly sectorMeta: AncientsSectorSystem | null;
  /** Вариант сцены Реликтового Предела (холодная палитра/опасности). */
  private readonly sectorVariant: SectorVariant | null;
  private readonly warpSequence = new WarpSequence();
  private readonly warpEffects: WarpEffects;

  constructor(canvas: HTMLCanvasElement, game: GameApi, systemId: number) {
    this.canvas = canvas;
    this.game = game;
    this.systemId = systemId;
    const worldSeed = this.safeWorldSeed();
    this.rng = new Rng(worldSeed ^ (systemId * 0x9e3779b1));

    this.system = this.resolveSystem(systemId);
    const world = this.safeWorld();
    this.sectorMeta = world ? sectorMeta(world, systemId) : null;
    this.sectorVariant = world && this.sectorMeta ? sectorVariantFor(world, this.sectorMeta) : null;
    this.playerFleet = this.resolvePlayerFleet();

    const story = this.resolveShipLoadout(this.playerFleet);
    this.shipLengthM = story.hull.lengthM;
    this.laserWeapons = story.lasers;
    this.kineticWeapons = story.kinetics;
    for (let i = 0; i < this.laserWeapons.length; i++) this.laserCooldowns.push(0);
    for (let i = 0; i < this.kineticWeapons.length; i++) this.kineticCooldowns.push(0);

    // --- палитра/рендер
    this.appliedSettings = game.getState().settings;
    this.appliedOptions = {
      internalWidth: this.appliedSettings.internalWidth,
      internalHeight: this.appliedSettings.internalHeight,
      dither: this.appliedSettings.dither,
      palette: this.appliedSettings.palette,
      outlines: this.appliedSettings.outlines,
      crt: this.appliedSettings.crt,
      bloom: this.appliedSettings.bloom,
    };
    this.pipeline = new PixelPipeline(canvas, this.appliedOptions);
    // draw calls считаем по всему кадру (сцена + палитровый пост-проход), см. drawCalls
    this.pipeline.renderer.info.autoReset = false;
    this.scene.background = new THREE.Color(PAL.space);

    const aspect = this.appliedOptions.internalWidth / Math.max(1, this.appliedOptions.internalHeight);
    this.camera = new THREE.PerspectiveCamera(70, aspect, 5, SCENE_FAR_M);

    // --- сцена системы (в Реликтовом Пределе — холодная палитра и опасности)
    this.sysScene = new SystemScene(this.scene, this.system, this.rng, this.sectorVariant);
    this.scene.add(this.sysScene.root);
    // --- варп «Наследие»: визуал раскрутки/прыжка
    this.warpEffects = new WarpEffects(this.scene, this.rng);

    // --- корабль игрока
    const spawn = this.resolveSpawn();
    this.playerShip = buildShip("player", this.shipLengthM, this.rng);
    this.playerShip.group.position.copy(spawn.position);
    this.playerShip.group.lookAt(spawn.lookAt);
    this.scene.add(this.playerShip.group);

    const stats: FlightStats = {
      maxSpeed: story.hull.baseSpeed,
      boostSpeed: story.hull.boostSpeed,
      // GDD §10.2: accel корвета 42 при base_speed 480, фрегата 34 при 420 → ≈ 0.08 × base_speed
      accel: story.hull.baseSpeed * 0.08,
      pitchDegS: story.hull.pitchDegS,
      yawDegS: story.hull.pitchDegS * 0.7,
      rollDegS: 110,
      shieldMax: story.shieldMax,
      armorMax: story.armorMax,
      hullMax: story.hullMax,
      // GDD §10.6: полное восстановление щита вне боя 20–45 с → берём 30 с
      shieldRegenPerSec: story.shieldMax / 30,
      heatDissipation: 26,
      lengthM: story.hull.lengthM,
    };
    this.flight = new FlightModel(stats, spawn.position, this.playerShip.group.quaternion.clone());
    this.flight.pips.sys = 2;
    this.flight.pips.eng = 2;
    this.flight.pips.wep = 2;

    // --- навигация по гиперлиниям
    for (const id of this.system.links ?? []) {
      if (this.systemExists(id)) this.navIds.push(id);
    }
    if (this.navIds.length > 0) this.navIndex = 0;

    // --- враги / бой
    const enemyFleet = this.safeEnemyFleets()[0] ?? null;
    this.enemyFleet = enemyFleet;
    this.spawnEnemies(enemyFleet);
    this.defenderShipsBefore = enemyFleet ? enemyFleet.ships.length : 0;
    this.defenderFp = this.sumFp(enemyFleet ? enemyFleet.ships.slice(0, MAX_ENEMY_SHIPS) : []);
    this.attackerFp = this.playerFleet ? this.sumFp(this.playerFleet.ships) : 1;
    this.attackerShipsBefore = this.playerFleet ? this.playerFleet.ships.length : 1;

    this.scene.add(this.projectileField.group);
    this.scene.add(this.effectPool.group);

    // --- камера сразу за кораблём (без рывка из начала координат)
    this.camera.position.copy(this.desiredCameraPosition(this.flight.position, this.flight.quaternion));
    this.camera.lookAt(this.flight.position.clone().addScaledVector(this.flight.forward, this.shipLengthM));

    // --- ввод
    this.input = new InputController(canvas, {
      onSupercruise: () => this.toggleSupercruise(),
      onAssist: () => this.toggleAssist(),
      onStop: () => {
        this.brakeTimer = 1.2;
        this.flight.fullStop();
      },
      onHeatSink: () => this.useHeatSink(),
      onJump: () => this.onJumpKey(),
      onCycleNav: () => this.cycleNav(),
      onCycleTarget: () => this.cycleTarget(),
      onDock: () => this.tryDock(),
      onExit: () => this.requestExit(),
      onPip: (sector, delta) => this.changePip(sector, delta),
      onLockChange: () => undefined,
      onWarp: () => this.cycleWarpTarget(),
      onWarpConfirm: () => this.requestWarpSequence(),
      onWarpCancel: () => this.cancelWarpSequence(),
    });

    // --- цели варпа: системы в радиусе 60 св. лет (включая вход в Предел/выход из него)
    this.warpSequence.setTargets(this.computeWarpTargets());
    this.bindWarpControls();

    this.pipeline.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
    this.writeTelemetry();
    this.exposeDebug();
  }

  // ================================================================ жизненный цикл
  resize(cssWidth: number, cssHeight: number): void {
    if (this.disposed) return;
    this.pipeline.resize(cssWidth, cssHeight);
  }

  /** Отладочный доступ для e2e/ручной проверки коллизий (SP-клиент; не влияет на симуляцию). */
  private exposeDebug(): void {
    if (typeof window === "undefined") return;
    const self = this;
    (window as unknown as { __SF_SYSTEM__: unknown }).__SF_SYSTEM__ = {
      teleport(x: number, y: number, z: number): void {
        self.flight.position.set(x, y, z);
        self.prevPosition.copy(self.flight.position);
        self.playerShip.group.position.copy(self.flight.position);
      },
      setVelocity(x: number, y: number, z: number): void {
        self.flight.velocity.set(x, y, z);
      },
      /** Тест/отладка мягкой смерти в полёте (в секторе — возврат в столицу, сейв не ломается). */
      damage(amount: number): void {
        self.flight.takeDamage(amount, "thermal");
      },
      state() {
        return {
          position: { x: self.flight.position.x, y: self.flight.position.y, z: self.flight.position.z },
          speed: self.flight.speed,
          hull: self.flight.pools.hull,
          mode: self.flight.mode,
          systemId: self.systemId,
        };
      },
      planetPoints() {
        return self.sysScene.bodies.map((b) => ({ name: b.planet.name, radiusM: b.radiusM, position: { x: b.position.x, y: b.position.y, z: b.position.z } }));
      },
      station() {
        const st = self.sysScene.station;
        return st ? { id: st.id, name: st.name, radiusM: st.radiusM, position: { x: st.group.position.x, y: st.group.position.y, z: st.group.position.z } } : null;
      },
      star() {
        return { radiusM: self.sysScene.starRadiusM, position: { x: self.sysScene.starPosition.x, y: self.sysScene.starPosition.y, z: self.sysScene.starPosition.z } };
      },
      asteroids() {
        return self.sysScene.asteroidColliders.slice(0, 5).map((a) => ({ radiusM: a.radiusM, position: { x: a.position.x, y: a.position.y, z: a.position.z } }));
      },
      warp() {
        const target = self.warpSequence.target;
        return {
          phase: self.warpSequence.phase,
          spoolProgress: self.warpSequence.spool,
          spoolSecondsLeft: self.warpSequence.spoolSecondsLeft,
          targets: self.computeWarpTargets(),
          target: target ? { id: target.id, name: target.name, distLy: target.distLy, sector: target.sector } : null,
          inSector: Boolean(self.sectorVariant),
          sectorDanger: self.sectorVariant ? self.sectorVariant.danger : 0,
          hazard: self.sysScene.sectorHazardLabel,
        };
      },
      sectorMarkers() {
        return self.sysScene.sectorMarkers.map((marker) => ({ kind: marker.kind, name: marker.name }));
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.dispose();
    for (const enemy of this.enemyShips) enemy.dispose();
    this.enemyShips.length = 0;
    this.playerShip.dispose();
    this.playerShip.group.removeFromParent();
    this.projectileField.dispose();
    this.effectPool.dispose();
    this.warpEffects.dispose();
    this.sysScene.dispose();
    this.scene.clear();
    this.pipeline.dispose();
    // отвязываем варп-контроллер и гасим HUD-индикатор (следующий вид привяжет свой)
    const host = this.gameWarpHost();
    if (host?.bindWarpControls) host.bindWarpControls(null);
    const warpTelemetry = host?.warpTelemetry;
    if (warpTelemetry) {
      warpTelemetry.phase = "idle";
      warpTelemetry.spoolProgress = 0;
      warpTelemetry.spoolSecondsLeft = 0;
      warpTelemetry.blockedReason = "";
    }
    if (typeof window !== "undefined") delete (window as unknown as { __SF_SYSTEM__?: unknown }).__SF_SYSTEM__;
    const telemetry = this.game.flightTelemetry;
    telemetry.active = false;
    telemetry.contacts.length = 0;
    telemetry.warnings.length = 0;
    telemetry.hints.length = 0;
  }

  update(dtSec: number): void {
    if (this.disposed || this.frozen) return;
    const dt = Math.min(0.1, Math.max(0, dtSec));
    this.time += dt;

    const state = this.game.getState();
    this.applySettings(state.settings);
    // После отстыковки отводим корабль из зоны станции, иначе он тут же «автостыкуется» обратно.
    if (this.lastMode !== state.mode) {
      if (this.lastMode === "station" && state.mode === "system") {
        const st = this.sysScene.station;
        if (st) {
          const dir = this.tmpVec.subVectors(this.flight.position, st.group.position);
          if (dir.lengthSq() < 1) dir.set(0, 1, 0);
          dir.normalize();
          this.flight.position.copy(st.group.position).addScaledVector(dir, st.radiusM + 900);
          this.flight.velocity.set(0, 0, 0);
          this.prevPosition.copy(this.flight.position);
          this.stationDistanceM = this.sysScene.stationDistance(this.flight.position);
        }
        this.autoDockBlockedUntil = this.time + 2.5;
      }
      this.lastMode = state.mode;
    }
    const controlsOn = state.mode === "system" && state.overlay === "none";

    // ---------------------------------------------------------------- ввод/поворот
    const mouse = this.input.consumeMouse();
    if (controlsOn) {
      const rates = turnRates(this.flight.stats, this.flight.assist);
      const pitchAngle = clamp(mouse.dy * MOUSE_RAD_PER_PX, -rates.pitch * dt, rates.pitch * dt);
      const yawAngle = clamp(-mouse.dx * MOUSE_RAD_PER_PX, -rates.yaw * dt, rates.yaw * dt);
      const rollAxis = (this.input.rollRight ? 1 : 0) - (this.input.rollLeft ? 1 : 0);
      this.flight.rotate(pitchAngle, yawAngle, rollAxis * rates.roll * dt);
    }

    // ------------------------------------------- автопилот-помощник стыковки (M3)
    if (this.dockApproach && controlsOn) {
      const manualInput =
        this.input.throttleUp || this.input.throttleDown || this.input.boost ||
        this.input.rollLeft || this.input.rollRight || this.input.firePrimary || this.input.fireSecondary ||
        Math.abs(mouse.dx) > 6 || Math.abs(mouse.dy) > 6;
      if (manualInput) {
        this.cancelDockApproach("Автопилот стыковки отключён: ручное управление");
      } else {
        this.updateDockApproach(dt);
      }
    }

    // ------------------------------------------------------------------- полёт
    const gravity = this.sysScene.gravityAt(this.flight.position);
    const hostiles = this.aliveEnemies().length > 0;
    this.brakeTimer = Math.max(0, this.brakeTimer - dt);
    this.prevPosition.copy(this.flight.position);
    this.flight.update(
      dt,
      {
        throttleDelta: controlsOn ? (this.input.throttleUp ? 1 : 0) - (this.input.throttleDown ? 1 : 0) : 0,
        stop: controlsOn && this.brakeTimer > 0,
        boost: controlsOn && this.input.boost,
      },
      gravity.proximity,
      gravity.bodyName,
      hostiles,
    );
    this.resolveCollisions(this.prevPosition, this.flight.position);
    this.playerShip.group.position.copy(this.flight.position);
    this.playerShip.group.quaternion.copy(this.flight.quaternion);
    this.playerShip.setThrust(this.flight.boost ? 1 : this.flight.throttle);
    this.playerShip.setHitFlash(this.flight.hitFlash);

  // --------------------------------------------------------------- масс-лок
    const hostileNear = this.aliveEnemies().some(
      (enemy) => enemy.mesh.position.distanceToSquared(this.flight.position) < MASS_LOCK_RANGE_M * MASS_LOCK_RANGE_M,
    );
    this.massLocked = gravity.proximity > 0.9 || hostileNear;
    this.stationDistanceM = this.sysScene.stationDistance(this.flight.position);

    // -------------------------------------------------------------------- бой
    if (controlsOn && this.enemiesAliveCount() > 0 && this.battleStartedAt === 0) this.battleStartedAt = this.time;
    if (controlsOn) this.updateCombat(dt);
    this.resolveEnemyCollisions();
    this.updateWeaponCooldowns(dt);

    if (controlsOn && !this.flight.isDead) {
      if (this.input.firePrimary) this.fireLasers();
      if (this.input.fireSecondary) this.fireKinetics();
    }

    // -------------------------------------------------------------- FSD-прыжок
    if (this.fsdJumping) {
      this.fsdCharge = Math.min(1, this.fsdCharge + dt / FSD_CHARGE_SEC);
      if (this.fsdCharge >= 1) this.performJump();
    }

    // ------------------------------------------------------------------ финал
    if (this.enemiesAliveCount() === 0 && this.enemyShips.length > 0 && !this.reportSent && !this.flight.isDead) {
      this.finishBattle();
    }
    if (this.flight.isDead) this.handlePlayerDeath();
    if (this.exitAt > 0 && this.time >= this.exitAt) this.requestExit();
    if (this.frozen) return;

    // -------------------------------------------------------------- сцена/камера
    this.sysScene.update(dt, this.time);
    this.updateCamera(dt);
    this.updateWarp(dt);
    const renderInfo = this.pipeline.renderer.info;
    renderInfo.reset();
    this.pipeline.render(this.scene, this.camera, this.time);
    this.frameCalls = renderInfo.render.calls;
    this.frameTriangles = renderInfo.render.triangles;

    // ------------------------------------------------------------- телеметрия HUD
    this.writeTelemetry();
    this.game.hudTick = (this.game.hudTick + 1) >>> 0;
  }

  /**
   * Столкновения: свип-тест отрезка «прошлая→новая позиция» по сферам —
   * так на больших скоростях (суперкруиз) корабль не «протыкает» тела.
   * Тела: звезда (смерть), планеты, станция (автостыковка), астероиды.
   * Урон без game over (GDD §10.10).
   */
  private resolveCollisions(from: THREE.Vector3, to: THREE.Vector3): void {
    if (this.flight.isDead) return;
    const shipR = this.shipLengthM * 0.5;
    // --- звезда: мгновенная мягкая смерть
    if (this.sweepT(from, to, this.sysScene.starPosition, this.sysScene.starRadiusM + shipR) >= 0) {
      this.flight.takeDamage(100000, "thermal");
      this.game.toast("Корабль сгорел в звезде", "bad");
      return;
    }
    // --- станция: касание на умеренной скорости = автостыковка
    const station = this.sysScene.station;
    if (station) {
      const tHit = this.sweepT(from, to, station.group.position, station.radiusM + shipR + 60);
      if (tHit >= 0) {
        const state = this.game.getState();
        const speed = this.flight.speed;
        if (state.mode === "system" && speed < AUTO_DOCK_SPEED_M_S && this.time > this.autoDockBlockedUntil) {
          this.flight.fullStop();
          this.game.toast("Автостыковка: " + station.name, "good");
          try {
            this.game.dockAtStation(station.id);
          } catch {
            /* noop */
          }
          return;
        }
        if (speed >= AUTO_DOCK_SPEED_M_S) {
          this.bounceFrom(from, to, station.group.position, station.radiusM + shipR + 60, "станция: слишком быстро для стыковки", 1.4);
          return;
        }
      }
    }
    // --- планеты
    for (const body of this.sysScene.bodies) {
      if (this.bounceFrom(from, to, body.position, body.radiusM + shipR, body.planet.name, 1)) return;
    }
    // --- астероиды
    for (const ast of this.sysScene.asteroidColliders) {
      if (this.bounceFrom(from, to, ast.position, ast.radiusM + shipR, "астероид", 0.6)) return;
    }
    // --- столкновение с вражескими кораблями (взаимное расталкивание)
    for (const enemy of this.enemyShips) {
      if (!enemy.alive) continue;
      const minDist = enemy.radiusM + shipR;
      const d = this.colScratch.subVectors(this.flight.position, enemy.mesh.position);
      const dist = d.length();
      if (dist < minDist) {
        if (dist < 0.01) d.set(0, 1, 0);
        else d.divideScalar(dist);
        this.flight.position.copy(enemy.mesh.position).addScaledVector(d, minDist + 2);
        const approach = Math.max(0, -this.flight.velocity.dot(d));
        this.flight.velocity.multiplyScalar(0.4);
        enemy.mesh.position.addScaledVector(d, -2);
        if (approach > 40 && this.time - this.lastCrashAt > 0.9) {
          this.lastCrashAt = this.time;
          this.lastCrashName = "вражеский корабль";
          this.flight.takeDamage(Math.min(600, approach * 0.4), "explosive");
          enemy.takeDamage(Math.min(600, approach * 0.5), "explosive");
          this.effectPool.spawnExplosion(this.flight.position.clone(), 120, PAL.enemy);
          this.game.toast("Столкновение с вражеским кораблём", "warn");
        }
        return;
      }
    }
  }

  /** Точка пересечения отрезка со сферой: параметр t в [0..1] или -1. */
  private sweepT(from: THREE.Vector3, to: THREE.Vector3, center: THREE.Vector3, radius: number): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const fx = from.x - center.x;
    const fy = from.y - center.y;
    const fz = from.z - center.z;
    const a = dx * dx + dy * dy + dz * dz;
    const c = fx * fx + fy * fy + fz * fz - radius * radius;
    if (a < 1e-6) return c <= 0 ? 0 : -1;
    const b = 2 * (fx * dx + fy * dy + fz * dz);
    let disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    disc = Math.sqrt(disc);
    let tHit = (-b - disc) / (2 * a);
    if (tHit < 0) {
      if (c <= 0) tHit = 0;
      else return -1;
    }
    if (tHit > 1) return -1;
    return tHit;
  }

  /** Выталкивание из сферы + урон по скорости удара. Возвращает true, если было столкновение. */
  private bounceFrom(
    from: THREE.Vector3, to: THREE.Vector3, center: THREE.Vector3,
    radius: number, label: string, damageScale: number,
  ): boolean {
    const tHit = this.sweepT(from, to, center, radius);
    if (tHit < 0) return false;
    this.colPoint.copy(from).lerp(to, tHit);
    this.colNormal.subVectors(this.colPoint, center);
    if (this.colNormal.lengthSq() < 1e-6) this.colNormal.copy(this.flight.velocity).multiplyScalar(-1);
    this.colNormal.normalize();
    const approach = Math.max(0, -this.flight.velocity.dot(this.colNormal));
    // любое касание тела в суперкруизе = аварийный выход из него (и щит/корпус получают урон ниже)
    if (this.flight.mode === "supercruise") this.flight.exitSupercruise(false);
    // всегда ставим корабль НА поверхность сферы (radius уже включает радиус корабля):
    // корректно и когда корабль проткнул тело за кадр, и когда оказался внутри
    this.flight.position.copy(center).addScaledVector(this.colNormal, radius + 2);
    // гасим нормальную составляющую, остаётся скольжение вдоль поверхности
    const vn = this.flight.velocity.dot(this.colNormal);
    if (vn < 0) this.flight.velocity.addScaledVector(this.colNormal, -vn * 1.35);
    this.flight.velocity.multiplyScalar(0.5);

    if (approach > 25 && this.time - this.lastCrashAt > 0.9) {
      this.lastCrashAt = this.time;
      this.lastCrashName = label;
      const supercruiseHit = this.flight.mode === "supercruise";
      if (supercruiseHit) this.flight.exitSupercruise(false);
      // Урон в долях от полного пула корабля: одно столкновение не убивает флагман
      // (смерть — только звезда/бой), но ощутимо бьёт по щиту/броне/корпусу.
      const pool = this.flight.stats.shieldMax + this.flight.stats.armorMax + this.flight.stats.hullMax;
      const frac = supercruiseHit
        ? clamp(0.18 + approach / 20000, 0.18, 0.45)
        : clamp((approach / 4000) * damageScale, 0.02, 0.3);
      const dmg = Math.max(25, pool * frac);
      this.flight.takeDamage(dmg, "kinetic");
      this.effectPool.spawnExplosion(this.colPoint.clone(), Math.max(60, Math.min(420, approach * 0.35)), PAL.warn);
      this.game.toast(
        (supercruiseHit ? "Экстренный выход из суперкруиза: " : "Столкновение: ") + label,
        "warn",
      );
    }
    return true;
  }

  /** Мягкое расталкивание вражеских кораблей с телами (без урона) — чтобы не «протыкали» станцию/планеты. */
  private resolveEnemyCollisions(): void {
    const station = this.sysScene.station;
    for (const enemy of this.enemyShips) {
      if (!enemy.alive) continue;
      const pos = enemy.mesh.position;
      const push = (center: THREE.Vector3, radius: number): void => {
        const d = this.colScratch.subVectors(pos, center);
        const dist = d.length();
        const minDist = radius + enemy.radiusM;
        if (dist < minDist) {
          if (dist < 0.01) d.set(0, 1, 0);
          else d.divideScalar(dist);
          pos.copy(center).addScaledVector(d, minDist + 1);
        }
      };
      push(this.sysScene.starPosition, this.sysScene.starRadiusM);
      for (const body of this.sysScene.bodies) push(body.position, body.radiusM);
      if (station) push(station.group.position, station.radiusM);
    }
  }

  // ================================================================ доступ/резолв
  private safeWorldSeed(): number {
    try {
      return this.game.world.seed;
    } catch {
      return 1;
    }
  }

  private resolveSystem(id: number): StarSystem {
    try {
      const world = this.game.world;
      // Система галактики или сектора (после task-27 секторные системы — обычные world.systems).
      const resolved = resolveSectorSystem(world, id);
      if (resolved) return resolved;
    } catch {
      /* мир ещё не создан */
    }
    // безопасный фолбэк: пустая система со звездой (вид не должен падать)
    return {
      id,
      name: "Неизвестная система",
      x: 0,
      y: 0,
      star: "yellow",
      planets: [],
      links: [],
      ownerId: 0,
      knownBy: [],
      visibleTo: [],
      poi: [],
      station: null,
      chokepoint: false,
      hopsFromCapital: 0,
    };
  }

  private systemExists(id: number): boolean {
    try {
      return this.game.world.systems.some((s) => s.id === id);
    } catch {
      return false;
    }
  }

  private resolvePlayerFleet(): Fleet | null {
    try {
      const world = this.game.world;
      const empire = world.empires.find((e) => e.isPlayer);
      const byId = empire ? world.fleets.find((f) => f.id === empire.flagshipFleetId) : undefined;
      const inSystem = this.game.getFleetInSystem(this.systemId);
      const withFlagship = inSystem.find((f) => f.ships.some((s) => s.isFlagship));
      const fallback = inSystem[0];
      const ordered = [byId, withFlagship, fallback];
      for (const fleet of ordered) {
        if (fleet && fleet.ships.length > 0) return fleet;
      }
      return byId ?? null;
    } catch {
      return null;
    }
  }

  private resolveShipLoadout(fleet: Fleet | null): {
    design: ShipDesignDef;
    hull: HullDef;
    ship: Ship | null;
    lasers: WeaponDef[];
    kinetics: WeaponDef[];
    shieldMax: number;
    armorMax: number;
    hullMax: number;
  } {
    const ship = fleet?.ships.find((s) => s.isFlagship) ?? fleet?.ships[0] ?? null;
    const designId = ship?.designId ?? "player_flagship";
    const design: ShipDesignDef | undefined = DESIGN_BY_ID[designId] ?? DESIGN_BY_ID["player_flagship"];
    const hull: HullDef | undefined = design ? HULL_BY_ID[design.hullId] : HULL_BY_ID["hull_frigate"];
    const fallbackHull = HULL_BY_ID["hull_frigate"];
    const safeDesign = design ?? {
      id: "player_flagship",
      ru: "Флагман",
      classId: "frigate",
      hullId: "hull_frigate",
      weapons: [],
      modules: [],
      fleetPower: 16,
      costCredits: 0,
      costAlloys: 0,
      buildTicks: 0,
      requiredTech: null,
      role: "flagship",
      descRu: "",
    };
    const safeHull = hull ?? fallbackHull ?? {
      id: "hull_frigate",
      ru: "Корпус",
      classId: "frigate",
      mass: 140,
      maxMass: 210,
      hullHp: 340,
      armorBase: 90,
      shieldBase: 160,
      slots: { small: 3, medium: 1, large: 0, utility: 4, internal: 2 },
      costAlloys: 25,
      baseSpeed: 420,
      boostSpeed: 540,
      pitchDegS: 36,
      buildTicks: 5,
      requiredTech: null,
      roles: [],
      lengthM: 110,
    };

    const weapons = safeDesign.weapons
      .map((id) => WEAPON_BY_ID[id] as WeaponDef | undefined)
      .filter((w): w is WeaponDef => Boolean(w && w.dmg > 0));
    const lasers = weapons.filter((w) => w.dmgType === "energy" || w.dmgType === "thermal");
    const kinetics = weapons.filter((w) => w.dmgType === "kinetic" || w.dmgType === "explosive");
    // страховка: корабль без оружия всё равно может отстреливаться базовым лазером (данные, не магия)
    if (lasers.length === 0 && kinetics.length === 0) {
      const fallbackLaser = WEAPON_BY_ID["laser_s_mk1"] as WeaponDef | undefined;
      if (fallbackLaser) lasers.push(fallbackLaser);
    }
    // если в дизайне нет кинетики/ракет, вторая группа (ПКМ) дублирует первую —
    // иначе ПКМ «мёртвая» на стартовом флагмане, у которого только лазеры
    if (kinetics.length === 0) kinetics.push(...lasers.slice(0, 2));

    const shieldMax = Math.max(1, ship?.shieldMax && ship.shieldMax > 0 ? ship.shieldMax : safeHull.shieldBase);
    const armorMax = Math.max(1, ship?.armorMax && ship.armorMax > 0 ? ship.armorMax : safeHull.armorBase);
    const hullMax = Math.max(1, ship?.hullMax && ship.hullMax > 0 ? ship.hullMax : safeHull.hullHp);
    return { design: safeDesign, hull: safeHull, ship, lasers, kinetics, shieldMax, armorMax, hullMax };
  }

  /**
   * Стартовая позиция: игрок между звездой и станцией, в 5 км от неё, лицом к станции.
   * Тогда в кадре сразу: станция (5 км), планета-якорь за ней (10–25 км) и её дневная сторона.
   */
  private resolveSpawn(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    // Реликтовый Предел: выход у края системы, лицом к звезде/Вратам
    if (this.sectorVariant) {
      const spawnPoint = sectorSpawn();
      return {
        position: new THREE.Vector3(spawnPoint.position.x, spawnPoint.position.y, spawnPoint.position.z),
        lookAt: new THREE.Vector3(spawnPoint.lookAt.x, spawnPoint.lookAt.y, spawnPoint.lookAt.z),
      };
    }
    const station = this.sysScene?.station;
    if (station) {
      const radial = station.group.position.clone();
      radial.y = 0;
      if (radial.lengthSq() < 1) radial.set(1, 0, 0);
      radial.normalize();
      const position = station.group.position.clone().addScaledVector(radial, -SPAWN_DISTANCE_M);
      position.y += 700;
      return { position, lookAt: station.group.position.clone() };
    }
    const position = new THREE.Vector3(22_000, 900, 4000);
    return { position, lookAt: new THREE.Vector3(0, 0, 0) };
  }

  private safeEnemyFleets(): Fleet[] {
    try {
      return this.game.getEnemyFleetsInSystem(this.systemId);
    } catch {
      return [];
    }
  }

  private sumFp(ships: Ship[]): number {
    let total = 0;
    for (const ship of ships) {
      const design = DESIGN_BY_ID[ship.designId] as ShipDesignDef | undefined;
      total += ship.fleetPower > 0 ? ship.fleetPower : design?.fleetPower ?? 1;
    }
    return Math.max(1, total);
  }

  // ================================================================ враги/бой
  private spawnEnemies(fleet: Fleet | null): void {
    if (!fleet) return;
    const ships = fleet.ships.slice(0, MAX_ENEMY_SHIPS);
    ships.forEach((ship, index) => {
      const design: ShipDesignDef | undefined = DESIGN_BY_ID[ship.designId];
      if (!design) return;
      const hull: HullDef | undefined = HULL_BY_ID[design.hullId];
      if (!hull) return;
      const weapons = design.weapons
        .map((id) => WEAPON_BY_ID[id] as WeaponDef | undefined)
        .filter((w): w is WeaponDef => Boolean(w));
      const angle = (index / Math.max(1, ships.length)) * Math.PI * 2 + this.rng.range(0, 1);
      const offset = new THREE.Vector3(
        Math.cos(angle) * this.rng.range(2800, 4200),
        this.rng.range(-250, 350),
        Math.sin(angle) * this.rng.range(2800, 4200),
      );
      const enemy = new EnemyShip(
        {
          fleet,
          ship,
          design,
          hull,
          weapons,
          position: this.flight.position.clone().add(offset),
          quaternion: new THREE.Quaternion(),
        },
        this.rng,
      );
      enemy.mesh.lookAt(this.flight.position);
      this.scene.add(enemy.mesh);
      this.enemyShips.push(enemy);
    });
    if (this.enemyShips.length > 0) {
      this.game.toast(`В системе вражеский флот: ${this.enemyShips.length}`, "warn");
    }
  }

  private aliveEnemies(): EnemyShip[] {
    return this.enemyShips.filter((enemy) => enemy.alive);
  }

  private enemiesAliveCount(): number {
    let count = 0;
    for (const enemy of this.enemyShips) if (enemy.alive) count += 1;
    return count;
  }

  private updateCombat(dt: number): void {
    const playerAlive = !this.flight.isDead;
    for (const enemy of this.enemyShips) {
      enemy.update(dt, this.flight.position, this.flight.velocity, playerAlive, this.rng, (from, direction, damage, type) => {
        this.projectileField.spawnProjectile(from, direction, 2200, damage, type, false);
      });
    }
    this.projectileField.update({
      dt,
      playerPosition: this.flight.position,
      playerRadius: this.shipLengthM * 0.45,
      playerAlive,
      enemies: this.enemyShips,
      onPlayerHit: (damage, type) => {
        const applied = this.flight.takeDamage(damage, type);
        if (applied > 0) this.effectPool.spawnHit(this.flight.position.clone(), PAL.enemy);
      },
      onEnemyHit: (enemy, damage, type) => {
        const applied = enemy.takeDamage(damage, type);
        this.effectPool.spawnHit(enemy.mesh.position.clone(), PAL.warn);
        if (applied > 0 && !enemy.alive) this.onEnemyDestroyed(enemy);
      },
    });
    this.effectPool.update(dt);
  }

  private onEnemyDestroyed(enemy: EnemyShip): void {
    this.effectPool.spawnExplosion(enemy.mesh.position.clone(), enemy.radiusM * 2.4, PAL.warn);
    this.effectPool.spawnExplosion(enemy.mesh.position.clone(), enemy.radiusM * 1.2, PAL.enemy);
    enemy.mesh.visible = false;
    this.game.toast(`Уничтожен: ${enemy.name}`, "good");
    if (this.targetIndex >= this.targetList().length) this.targetIndex = 0;
  }

  private updateWeaponCooldowns(dt: number): void {
    for (let i = 0; i < this.laserCooldowns.length; i++) {
      this.laserCooldowns[i] = Math.max(0, (this.laserCooldowns[i] ?? 0) - dt);
    }
    for (let i = 0; i < this.kineticCooldowns.length; i++) {
      this.kineticCooldowns[i] = Math.max(0, (this.kineticCooldowns[i] ?? 0) - dt);
    }
    // GDD §10.7: wep_mult = 0.5 + 0.125 × pips — от него зависит скорость восстановления энергии оружия
    const regen = 18 * this.flight.wepMult;
    this.wepEnergy = clamp(this.wepEnergy + regen * dt, 0, 100);
  }

  /** ЛКМ: лазеры — hitscan с falloff и точностью (GDD §10.4). */
  private fireLasers(): void {
    if (!this.flight.canFire) return;
    const target = this.aimEnemy();
    const origin = this.flight.position.clone().addScaledVector(this.flight.forward, this.shipLengthM * 0.45);
    for (let i = 0; i < this.laserWeapons.length; i++) {
      const weapon = this.laserWeapons[i];
      if (!weapon) continue;
      if ((this.laserCooldowns[i] ?? 0) > 0) continue;
      if (this.wepEnergy < weapon.power * 0.6) continue;
      this.wepEnergy -= weapon.power * 0.6;
      this.laserCooldowns[i] = 1 / Math.max(0.05, weapon.rof);
      this.flight.addHeat(weapon.heat);
      this.effectPool.spawnHit(origin, PAL.white);
      if (!target) {
        this.projectileField.spawnBeam(origin, origin.clone().addScaledVector(this.flight.forward, weapon.rangeM * 0.45), PAL.shieldDark);
        continue;
      }
      const distance = origin.distanceTo(target.mesh.position);
      const falloff = clamp(1 - 0.6 * Math.pow(distance / Math.max(1, weapon.rangeM), 1.5), 0.35, 1);
      const hitChance = clamp(weapon.accuracy * (0.55 + 0.45 * falloff), 0.05, 0.98);
      if (distance <= weapon.rangeM && this.rng.next() <= hitChance) {
        const damage = weapon.dmg * falloff * this.flight.wepMult;
        const applied = target.takeDamage(damage, weapon.dmgType);
        this.projectileField.spawnBeam(origin, target.mesh.position.clone(), PAL.shield);
        this.effectPool.spawnHit(target.mesh.position.clone(), PAL.warn);
        if (applied > 0 && !target.alive) this.onEnemyDestroyed(target);
      } else {
        const miss = target.mesh.position.clone();
        miss.x += this.rng.range(-80, 80);
        miss.y += this.rng.range(-80, 80);
        this.projectileField.spawnBeam(origin, miss, PAL.shieldDark);
      }
    }
  }

  /** ПКМ: кинетика — снаряды с упреждением (GDD §10.3/§10.4). */
  private fireKinetics(): void {
    if (!this.flight.canFire) return;
    const target = this.aimEnemy();
    const origin = this.flight.position.clone().addScaledVector(this.flight.forward, this.shipLengthM * 0.45);
    for (let i = 0; i < this.kineticWeapons.length; i++) {
      const weapon = this.kineticWeapons[i];
      if (!weapon) continue;
      if ((this.kineticCooldowns[i] ?? 0) > 0) continue;
      if (this.wepEnergy < weapon.power * 0.6) continue;
      this.wepEnergy -= weapon.power * 0.6;
      this.kineticCooldowns[i] = 1 / Math.max(0.05, weapon.rof);
      this.flight.addHeat(weapon.heat);
      let direction = this.flight.forward.clone();
      let damage = weapon.dmg * this.flight.wepMult;
      if (target) {
        const travel = origin.distanceTo(target.mesh.position) / KINETIC_PROJECTILE_SPEED;
        const aim = target.mesh.position.clone().addScaledVector(target.velocity, travel);
        direction = aim.sub(origin).normalize();
        const distance = origin.distanceTo(target.mesh.position);
        const falloff = clamp(1 - 0.6 * Math.pow(distance / Math.max(1, weapon.rangeM), 1.5), 0.35, 1);
        damage *= falloff;
        if (this.rng.next() > weapon.accuracy) {
          direction.applyAxisAngle(UP, this.rng.range(-0.02, 0.02));
        }
      }
      this.projectileField.spawnProjectile(origin, direction, KINETIC_PROJECTILE_SPEED, damage, weapon.dmgType, true);
    }
  }

  private aimEnemy(): EnemyShip | null {
    const target = this.currentTarget();
    if (target && target.enemy && target.enemy.alive) return target.enemy;
    // ближайший враг в передней полусфере
    let best: EnemyShip | null = null;
    let bestDot = 0.75;
    const forward = this.flight.forward;
    for (const enemy of this.enemyShips) {
      if (!enemy.alive) continue;
      const toEnemy = this.tmpVec.subVectors(enemy.mesh.position, this.flight.position).normalize();
      const dot = toEnemy.dot(forward);
      if (dot > bestDot) {
        bestDot = dot;
        best = enemy;
      }
    }
    return best;
  }

  private finishBattle(): void {
    this.reportSent = true;
    const flightTime = this.battleStartedAt > 0 ? this.time - this.battleStartedAt : this.time;
    const killed = this.enemyShips.filter((enemy) => !enemy.alive);
    const defenderLossFp = killed.reduce((sum, enemy) => {
      const design = DESIGN_BY_ID[enemy.ship.designId] as ShipDesignDef | undefined;
      return sum + (enemy.ship.fleetPower > 0 ? enemy.ship.fleetPower : design?.fleetPower ?? 1);
    }, 0);
    const report = makeBattleRecord({
      systemId: this.systemId,
      tick: this.safeTick(),
      durationSec: flightTime,
      attacker: {
        empireId: this.safePlayerEmpireId(),
        fleetId: this.playerFleet?.id ?? 0,
        fp: this.attackerFp,
        shipsBefore: this.attackerShipsBefore,
      },
      defender: {
        empireId: this.enemyFleet?.empireId ?? 0,
        fleetId: this.enemyFleet?.id ?? 0,
        fp: this.defenderFp,
        shipsBefore: this.defenderShipsBefore,
      },
      attackerLossFp: 0,
      defenderLossFp,
      attackerShipsLost: 0,
      defenderShipsLost: killed.length,
      outcome: "attacker_win",
    });
    try {
      this.game.applyTacticalBattle(report);
    } catch {
      this.game.toast("Не удалось применить результат боя", "bad");
    }
    this.game.toast(`Бой выигран: уничтожено ${killed.length}, трофеи ${report.spoilsCredits} Cr`, "good");
    this.exitAt = this.time + 2;
  }

  private handlePlayerDeath(): void {
    if (this.deathHandled) return;
    this.deathHandled = true;
    this.effectPool.spawnExplosion(this.flight.position.clone(), this.shipLengthM * 2.4, PAL.warn);
    this.warpSequence.cancel();
    if (this.sectorVariant) {
      // 13d §2.5: смерть в Пределе возвращает флоты в столицу (капсула), прогресс/реликвии — в сейве.
      try {
        const world = this.safeWorld();
        if (world) simSectorDeathReturn(world);
      } catch {
        /* sim может быть не инициализирован */
      }
      this.game.toast("Флагман уничтожен в Пределе. Капсула вернула вас в столицу.", "bad");
      void this.game.saveGame();
    } else {
      this.game.toast("Флагман уничтожен. Пилот спасён в капсуле — возврат на карту.", "bad");
    }
    this.exitAt = this.time + 1.6;
  }

  private safeTick(): number {
    try {
      return this.game.world.tick;
    } catch {
      return 0;
    }
  }

  private safePlayerEmpireId(): number {
    try {
      return this.game.getPlayerEmpire().id;
    } catch {
      return 0;
    }
  }

  // ================================================================ действия
  private toggleSupercruise(): void {
    if (!this.controlsEnabled()) return;
    const blocked = this.flight.isDead
      ? "Корабль уничтожен"
      : this.enemiesAliveCount() > 0
        ? "Суперкруиз недоступен в бою"
        : this.massLocked
          ? "Суперкруиз: масса-лок"
          : null;
    const result = this.flight.toggleSupercruise(blocked);
    if (result.ok) this.game.toast(result.message, "info");
    else this.game.toast(result.message, "warn");
  }

  private toggleAssist(): void {
    if (!this.controlsEnabled()) return;
    const assist = this.flight.toggleAssist();
    this.game.toast(assist ? "Assist включён" : "Assist выключен (6DOF)", "info");
  }

  private changePip(sector: "sys" | "eng" | "wep", delta: number): void {
    if (!this.controlsEnabled()) return;
    const ok = this.flight.setPip(sector, delta);
    if (!ok) this.game.toast("Пипсы: сумма не может превысить 6 (или канал 0–4)", "warn");
  }

  private useHeatSink(): void {
    if (!this.controlsEnabled()) return;
    if (this.flight.useHeatSink()) this.game.toast("Heat sink: сброс тепла", "good");
    else this.game.toast("Heat sink израсходован", "warn");
  }

  private cycleTarget(): void {
    if (!this.controlsEnabled()) return;
    const list = this.targetList();
    if (list.length === 0) {
      this.game.toast("Целей нет", "info");
      return;
    }
    // В бою Q циклит только врагов (список общих целей начинается с врагов,
    // поэтому индексы 0..enemies-1 валидны и для HUD-цели); станция — цель вне боя.
    const enemyCount = this.aliveEnemies().length;
    if (enemyCount > 0) {
      this.targetIndex = (this.targetIndex + 1) % enemyCount;
    } else {
      this.targetIndex = (this.targetIndex + 1) % list.length;
    }
    const target = list[this.targetIndex];
    if (target) this.game.toast(`Цель: ${target.name} · ${formatDist(this.flight.position.distanceTo(target.position))}`, "info");
  }

  private cycleNav(): void {
    if (!this.controlsEnabled()) return;
    if (this.navIds.length === 0) {
      this.game.toast("Гиперлиний нет — прыжок недоступен", "warn");
      return;
    }
    this.navIndex = (this.navIndex + 1) % this.navIds.length;
    const nav = this.navSystem;
    if (nav) this.game.toast(`Навигация: ${nav.name} · ${this.navDistanceLy(nav).toFixed(1)} св. лет · J — прыжок`, "info");
  }

  private onJumpKey(): void {
    if (!this.controlsEnabled()) return;
    const nav = this.navSystem;
    if (!nav) {
      this.game.toast("Нет цели прыжка: Tab — выбрать систему", "warn");
      return;
    }
    if (this.fsdJumping) {
      this.fsdJumping = false;
      this.fsdCharge = 0;
      this.game.toast("Прыжок отменён", "warn");
      return;
    }
    if (this.massLocked) {
      this.game.toast("FSD: масса-лок — отойдите от целей и тел", "warn");
      return;
    }
    if (this.flight.isDead) return;
    this.fsdJumping = true;
    this.fsdCharge = 0;
    this.game.toast(`FSD: зарядка до ${nav.name}`, "info");
  }

  private performJump(): void {
    const nav = this.navSystem;
    this.fsdJumping = false;
    this.fsdCharge = 0;
    this.dockApproach = false;
    if (!nav) return;
    this.flight.exitSupercruise(false);
    let ok = false;
    try {
      ok = this.game.sendCommand({ type: "flagship_jump", systemId: nav.id });
    } catch {
      ok = false;
    }
    this.game.toast(ok ? `Прыжок: ${nav.name}` : `FSD: ${nav.name} (приказ флоту не принят)`, ok ? "good" : "warn");
    // SceneHost пересоздаст вид после смены activeSystemId
    try {
      this.game.enterSystem(nav.id);
    } catch {
      return;
    }
    const state = this.game.getState();
    if (state.activeSystemId !== this.systemId) this.frozen = true;
  }

  private tryDock(): void {
    if (!this.controlsEnabled()) return;
    const station = this.sysScene.station;
    if (!station) {
      this.game.toast("В системе нет станции — стыковка недоступна", "warn");
      return;
    }
    const distance = this.sysScene.stationDistance(this.flight.position);
    this.stationDistanceM = distance;
    // повторный G по активному автопилоту — отмена
    if (this.dockApproach) {
      this.cancelDockApproach("Автопилот стыковки отменён");
      return;
    }
    if (distance > DOCK_RANGE_M) {
      if (distance > DOCK_APPROACH_RANGE_M) {
        this.game.toast(`Станция далеко: ${formatDist(distance)} (автопилот доступен ближе 12 км)`, "warn");
        return;
      }
      if (this.enemiesAliveCount() > 0) {
        this.game.toast("Стыковка недоступна в бою: оторвитесь от пиратов", "warn");
        return;
      }
      if (this.flight.mode === "supercruise") this.flight.exitSupercruise();
      this.dockApproach = true;
      this.dockApproachStationId = station.id;
      this.game.toast(`Автопилот стыковки: курс на ${station.name} (${formatDist(distance)})`, "info");
      return;
    }
    if (this.flight.speed >= DOCK_SPEED_M_S) {
      // уже у станции, но быстро — включаем тормозящий автопилот вместо сухого отказа
      this.dockApproach = true;
      this.dockApproachStationId = station.id;
      this.game.toast(`Автопилот стыковки: торможение (${Math.round(this.flight.speed)} м/с)`, "info");
      return;
    }
    this.completeDock(station);
  }

  /** Завершение стыковки: остановка, тост, экран станции (L3). */
  private completeDock(station: { id: number; name: string }): void {
    this.dockApproach = false;
    this.flight.fullStop();
    this.game.toast(`Стыковка разрешена: ${station.name}`, "good");
    try {
      this.game.dockAtStation(station.id);
    } catch {
      /* вид продолжит работу, если стыковка не удалась */
    }
  }

  private cancelDockApproach(reasonRu: string): void {
    if (!this.dockApproach) return;
    this.dockApproach = false;
    this.game.toast(reasonRu, "info");
  }

  /**
   * Автопилот-помощник: доворачивает корабль на станцию и ведёт его по профилю скорости
   * (крейсер до 2,8 км, затем финальное сближение < 120 м/с), после чего вызывает стыковку.
   * Управление тягой/поворотом — прямое, поэтому игрок может отменить его любым вводом.
   */
  private updateDockApproach(dt: number): void {
    const station = this.sysScene.station;
    if (!station) {
      this.cancelDockApproach("Автопилот стыковки отменён: станция потеряна");
      return;
    }
    const distance = this.sysScene.stationDistance(this.flight.position);
    this.stationDistanceM = distance;
    if (this.enemiesAliveCount() > 0) {
      this.cancelDockApproach("Автопилот стыковки отменён: в системе бой");
      return;
    }
    if (distance <= DOCK_RANGE_M && this.flight.speed < DOCK_SPEED_M_S) {
      this.completeDock(station);
      return;
    }
    // направление на станцию и доворот с ограничением угловой скорости корпуса
    this.dockDir.subVectors(station.group.position, this.flight.position);
    if (this.dockDir.lengthSq() < 1) return;
    this.dockDir.normalize();
    this.dockMatrix.lookAt(this.dockDir, this.dockOrigin, UP);
    this.dockQuat.setFromRotationMatrix(this.dockMatrix);
    const rates = turnRates(this.flight.stats, this.flight.assist);
    const maxTurn = Math.max(rates.pitch, rates.yaw) * 1.4;
    this.flight.quaternion.rotateTowards(this.dockQuat, maxTurn * dt);
    this.flight.quaternion.normalize();

    const angleError = this.flight.forward.angleTo(this.dockDir);
    const cruise = distance > DOCK_FINAL_RANGE_M ? DOCK_APPROACH_SPEED_M_S : DOCK_FINAL_SPEED_M_S;
    const desiredSpeed = Math.min(cruise, Math.max(25, distance * 0.3));
    // если смотрим не на станцию — не разгоняемся (сначала доворот)
    this.flight.throttle = angleError > 0.6 ? 0 : clamp01(desiredSpeed / Math.max(1, this.flight.stats.maxSpeed));
    // активное торможение при превышении профиля (аналог X, но плавнее) — подходим к станции на <120 м/с
    if (this.flight.speed > desiredSpeed * 1.1) {
      this.flight.velocity.multiplyScalar(Math.max(0, 1 - 1.1 * dt));
    }
  }

  private requestExit(): void {
    if (this.disposed) return;
    // Esc/M в полёте: App уже обрабатывает выход по режимам (станция → undock, оверлей → закрыть).
    // Здесь выходим, только если мы действительно в полёте без оверлея — иначе двойная обработка.
    const state = this.game.getState();
    if (state.mode !== "system" || state.overlay !== "none") return;
    this.cancelDockApproach("Автопилот стыковки отменён");
    if (this.warpSequence.phase === "spooling") this.warpSequence.cancel();
    this.frozen = true;
    try {
      this.game.exitToGalaxy();
    } catch {
      this.frozen = false;
      this.game.toast("Не удалось выйти на карту", "bad");
    }
  }

  private controlsEnabled(): boolean {
    if (this.disposed || this.frozen) return false;
    const state = this.game.getState();
    return state.mode === "system" && state.overlay === "none";
  }

  // ================================================================ цели/навигация
  private targetList(): TargetRef[] {
    const list: TargetRef[] = [];
    for (const enemy of this.enemyShips) {
      if (!enemy.alive) continue;
      list.push({ kind: "enemy", name: enemy.name, position: enemy.mesh.position, hull01: enemy.hull01, enemy });
    }
    const station = this.sysScene.station;
    if (station) {
      list.push({ kind: "station", name: station.name, position: station.group.position, hull01: null, enemy: null });
    }
    return list;
  }

  private currentTarget(): TargetRef | null {
    const list = this.targetList();
    if (list.length === 0) return null;
    if (this.targetIndex < 0 || this.targetIndex >= list.length) this.targetIndex = 0;
    return list[this.targetIndex] ?? null;
  }

  private get navSystem(): StarSystem | null {
    if (this.navIndex < 0 || this.navIndex >= this.navIds.length) return null;
    const id = this.navIds[this.navIndex];
    if (id == null) return null;
    try {
      return this.game.world.systems.find((s) => s.id === id) ?? null;
    } catch {
      return null;
    }
  }

  private navDistanceLy(nav: StarSystem): number {
    // карта: 1 единица = 10 св. лет (packages/sim/src/types.ts: x,y — целые, *10 = св. год)
    return Math.hypot(nav.x - this.system.x, nav.y - this.system.y) / 10;
  }

  // ================================================================ камера
  private desiredCameraPosition(shipPosition: THREE.Vector3, shipQuaternion: THREE.Quaternion): THREE.Vector3 {
    const offset = new THREE.Vector3(0, 0.42, -1.55).multiplyScalar(this.shipLengthM);
    return offset.applyQuaternion(shipQuaternion).add(shipPosition);
  }

  private updateCamera(dt: number): void {
    const desired = this.desiredCameraPosition(this.flight.position, this.flight.quaternion);
    const followRate = this.flight.mode === "supercruise" ? 6 : 9;
    this.camera.position.lerp(desired, 1 - Math.exp(-followRate * dt));
    const shipUp = this.tmpVec.copy(UP).applyQuaternion(this.flight.quaternion);
    this.camera.up.copy(UP).lerp(shipUp, 0.65).normalize();
    this.cameraTarget.copy(this.flight.position).addScaledVector(this.flight.forward, this.shipLengthM * 0.9);
    this.camera.lookAt(this.cameraTarget);
    const targetFov = this.flight.mode === "supercruise" ? 78 : 70;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private applySettings(settings: RenderSettings): void {
    if (this.appliedSettings === settings) return;
    this.appliedSettings = settings;
    this.appliedOptions = {
      ...this.appliedOptions,
      internalWidth: settings.internalWidth,
      internalHeight: settings.internalHeight,
      dither: settings.dither,
      palette: settings.palette,
      outlines: settings.outlines,
      crt: settings.crt,
      bloom: settings.bloom,
    };
    this.pipeline.setOptions(this.appliedOptions);
    this.camera.aspect = settings.internalWidth / Math.max(1, settings.internalHeight);
    this.camera.updateProjectionMatrix();
  }

  // ================================================================ варп (Часть XIII)
  /**
   * Полётная часть варпа «Наследие» (13 §5, 13d §2/§10.4): выбор цели в радиусе 60 св. лет
   * (включая Реликтовый Предел), раскрутка 60 с реального времени, прыжок, отмена, риск Хора.
   * Симуляция владеет зарядами/кулдауном/проверкой радиуса — здесь только последовательность и HUD.
   */
  private safeWorld(): World | null {
    try {
      return this.game.world;
    } catch {
      return null;
    }
  }

  private worldTick(): number {
    const world = this.safeWorld();
    return world ? world.tick : 0;
  }

  /** Доступ к полям Game (варп-телеметрия/якорь) без расширения GameApi. */
  private gameWarpHost(): { warpTelemetry?: WarpTelemetry; warpAnchorSystemId?: number | null; bindWarpControls?: (controls: unknown) => void } | null {
    return this.game as unknown as { warpTelemetry?: WarpTelemetry; warpAnchorSystemId?: number | null; bindWarpControls?: (controls: unknown) => void };
  }

  private ancientsWarpState(): {
    unlocked: boolean;
    charges: number;
    cores: number;
    capacity: number;
    cooldownTicks: number;
    riskPct: number;
    sectorReady: boolean;
    instability: number;
    chorusAttention: number;
    lastRiskTriggered: boolean;
    choirWaveTick: number;
  } | null {
    const world = this.safeWorld();
    if (!world) return null;
    try {
      return warpStatus(world);
    } catch {
      return null;
    }
  }

  private sectorDiscovered(): boolean {
    const world = this.safeWorld();
    const sector = world?.fg?.ancients?.sector;
    return Boolean(sector && sector.discovered && sector.systems.length > 0);
  }

  /** Цели варпа: системы в радиусе 60 св. лет; из галактики — вход в Предел, из Предела — выход. */
  private computeWarpTargets(): WarpTargetInfo[] {
    const world = this.safeWorld();
    if (!world) return [];
    try {
      const sector = world.fg?.ancients?.sector;
      // карта/варп-панель: если сектор открыт, но системы ещё не сгенерированы — генерируем (sim)
      if (sector?.discovered && !sector.generated) {
        (this.gameWarpHost() as { ensureSectorVisible?: () => number } | null)?.ensureSectorVisible?.();
      }
      const range = Math.min(200, Math.max(1, warpRadiusLy(world)));
      return warpTargetsAround(world, this.systemId, range);
    } catch {
      return [];
    }
  }

  private bindWarpControls(): void {
    const host = this.gameWarpHost();
    if (!host?.bindWarpControls) return;
    host.bindWarpControls({
      targets: () => this.computeWarpTargets(),
      select: (systemId: number | null) => this.selectWarpTargetById(systemId),
      request: () => this.requestWarpSequence(),
      cancel: () => this.cancelWarpSequence(),
    });
  }

  private selectWarpTargetById(systemId: number | null): WarpTargetInfo | null {
    this.warpSequence.setTargets(this.computeWarpTargets());
    const target = this.warpSequence.selectById(systemId);
    if (target) {
      this.game.toast(`Варп-цель: ${target.name} · ${target.distLy.toFixed(1)} св. лет`, "info");
    }
    return target;
  }

  /** R: следующая варп-цель (системы в радиусе 60 св. лет, включая сектор). */
  private cycleWarpTarget(): void {
    if (!this.controlsEnabled()) return;
    if (this.warpSequence.phase === "spooling") {
      this.game.toast("Идёт раскрутка: Backspace — отмена", "warn");
      return;
    }
    this.warpSequence.setTargets(this.computeWarpTargets());
    const target = this.warpSequence.selectNext();
    if (!target) {
      this.game.toast("Варп: нет целей в радиусе 60 св. лет", "warn");
      return;
    }
    this.game.toast(
      `Варп-цель: ${target.name} · ${target.distLy.toFixed(1)} св. лет · риск Хора ${WARP_RISK_PCT}% · ±${WARP_ACCURACY_AU} а.е.`,
      "info",
    );
  }

  /** Enter: подтвердить раскрутку к выбранной цели (с проверкой условий sim). */
  private requestWarpSequence(): boolean {
    if (!this.controlsEnabled()) return false;
    this.warpSequence.setTargets(this.computeWarpTargets());
    if (this.warpSequence.phase === "spooling") {
      this.game.toast("Раскрутка уже идёт — Backspace для отмены", "info");
      return false;
    }
    let target = this.warpSequence.target;
    if (!target) {
      target = this.warpSequence.selectNext();
    }
    if (!target) {
      this.warpSequence.block("Нет цели: R — выбрать систему");
      this.game.toast("Варп: нет целей в радиусе 60 св. лет", "warn");
      return false;
    }
    const warp = this.ancientsWarpState();
    const block = (reason: string): boolean => {
      this.warpSequence.block(reason);
      this.writeWarpTelemetry();
      this.game.toast("Варп: " + reason, "warn");
      return false;
    };
    const isSectorExit = Boolean(this.sectorVariant) && target.kind === "gate";
    // Тактическая пауза SP не двигает такты, поэтому кулдаун варпа (5 тактов) в полёте не истекает.
    // Внутри Предела перелёт идёт через sector_enter (если sim отклонит warp_jump), поэтому
    // кулдаун/заряды здесь не блокируют выбор цели — цена прыжка остаётся на sim.
    const isSectorTransit = Boolean(this.sectorVariant) && target.sector;
    if (!warp && !isSectorExit) return block("линия Наследия не открыта");
    if (warp && !warp.unlocked && !isSectorExit && !isSectorTransit) return block("варп «Наследие» не открыт (миссия 9 линии)");
    // Выход из Предела (Врата бесплатны при Стабильности ≥ 25, иначе аварийный варп) — sim решит сам
    if (!isSectorExit && !isSectorTransit && warp) {
      if (warp.cooldownTicks > 0) return block(`кулдаун ${warp.cooldownTicks} такт(ов)`);
      if (warp.charges <= 0) return block("нет зарядов ядра (1 прыжок = 1 заряд; 2 реликвии = +1 заряд)");
    }
    if (!this.warpSequence.request()) return false;
    this.writeWarpTelemetry();
    this.game.toast(`Раскрутка варпа: ${target.name} (${Math.round(this.warpSequence.spoolSecondsLeft)} с)`, "info");
    return true;
  }

  /** Backspace: отменить раскрутку (цель сохраняется, заряды не тратятся). */
  private cancelWarpSequence(): void {
    if (this.warpSequence.phase !== "spooling") return;
    this.warpSequence.cancel();
    this.game.toast("Раскрутка варпа отменена", "info");
  }

  private updateWarp(dt: number): void {
    if (!this.controlsEnabled()) {
      this.warpEffects.update(dt, this.camera, 0, this.sectorVariant ? 1 : 0);
      return;
    }
    const launched = this.warpSequence.update(dt);
    if (launched) this.performWarpLaunch();
    const sectorIntensity = this.sectorVariant ? Math.min(1, this.sectorVariant.danger / 4) : 0;
    const spool = this.warpSequence.phase === "spooling" || this.warpSequence.phase === "jumping" ? this.warpSequence.spool : 0;
    this.warpEffects.update(dt, this.camera, spool, sectorIntensity);
  }

  /** Момент прыжка: команда sim, вспышка, вход в систему (SceneHost пересоздаст вид). */
  private performWarpLaunch(): void {
    const target = this.warpSequence.target;
    if (!target) {
      this.warpSequence.finishJump(false, "Цель потеряна");
      return;
    }
    const host = this.gameWarpHost();

    // Выход из Предела: Врата (если Стабильность ≥ 25) или аварийный варп — команда sector_exit.
    if (this.sectorVariant && target.kind === "gate") {
      let exited = false;
      try {
        exited = this.game.sendCommand({ type: "sector_exit" });
      } catch {
        exited = false;
      }
      if (!exited) {
        this.warpSequence.finishJump(false, "выход из Предела отклонён");
        return;
      }
      const world = this.safeWorld();
      const player = world?.empires.find((empire) => empire.isPlayer);
      const fleet = world?.fleets.find((item) => item.empireId === player?.id && item.ships.length > 0);
      const destination = fleet ? fleet.systemId : (player?.capitalSystemId ?? this.systemId);
      if (host) host.warpAnchorSystemId = null;
      this.warpSequence.finishJump(true);
      this.warpEffects.triggerFlash();
      this.game.toast("Варп: выход из Реликтового Предела", "good");
      try {
        this.game.enterSystem(destination);
      } catch {
        /* вид пересоздаст хост */
      }
      const stateAfterExit = this.game.getState();
      if (stateAfterExit.activeSystemId !== this.systemId) this.frozen = true;
      return;
    }

    // Внутри Предела при активном кулдауне не дёргаем warp_jump (он ответит «Варп остывает»
    // и покажет лишний тост) — сразу перелёт sector_enter: такты на тактической паузе не идут.
    let ok = false;
    const sectorTransit = Boolean(this.sectorVariant) && target.sector && (this.ancientsWarpState()?.cooldownTicks ?? 0) > 0;
    if (sectorTransit) {
      try {
        ok = this.game.sendCommand({ type: "sector_enter", systemId: target.id });
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      try {
        ok = this.game.sendCommand({ type: "warp_jump", targetSystemId: target.id });
      } catch {
        ok = false;
      }
    }
    let transitFallback = false;
    if (!ok && target.sector) {
      // Тактическая пауза в SP не двигает такты, поэтому кулдаун варпа (5 тактов) не истекает
      // в полёте. Внутри Предела даём «перелёт» той же командой sector_enter (без заряда/кулдауна,
      // sim проверяет discovered и переносит флот) — иначе игрок заперт в одной системе.
      try {
        transitFallback = this.game.sendCommand({ type: "sector_enter", systemId: target.id });
      } catch {
        transitFallback = false;
      }
    }
    if (!ok && !transitFallback) {
      this.warpSequence.finishJump(false, "симуляция отклонила прыжок");
      this.game.toast("Варп: " + target.name + " — отказ (см. сообщение выше)", "warn");
      return;
    }
    if (transitFallback) ok = true;
    if (host) host.warpAnchorSystemId = target.sector ? this.systemId : null;
    if (target.sector) {
      // sim: warp_jump переносит флот, но флаг «в секторе» ставит sector_enter —
      // без него sector_exit отказывает («Вы не в секторе»). Команда идемпотентна.
      try {
        this.game.sendCommand({ type: "sector_enter", systemId: target.id });
      } catch {
        /* noop */
      }
    }
    this.warpSequence.finishJump(true);
    this.warpEffects.triggerFlash();
    this.game.toast(`Варп: прибытие в ${target.name}`, "good");
    try {
      this.game.enterSystem(target.id);
    } catch {
      /* SceneHost пересоздаст вид после смены activeSystemId */
    }
    const state = this.game.getState();
    if (state.activeSystemId !== this.systemId) this.frozen = true;
  }



  /** Пишет WarpTelemetry для HUD (мутирует объект Game, как flightTelemetry). */
  private writeWarpTelemetry(): void {
    const telemetry = this.gameWarpHost()?.warpTelemetry;
    if (!telemetry) return;
    const warp = this.ancientsWarpState();
    const target = this.warpSequence.target;
    telemetry.active = Boolean(warp?.unlocked);
    telemetry.phase = this.warpSequence.phase;
    telemetry.charges = warp?.charges ?? 0;
    telemetry.cores = warp?.cores ?? 0;
    telemetry.cooldownTicks = warp?.cooldownTicks ?? 0;
    telemetry.spoolProgress = clamp01(this.warpSequence.spool);
    telemetry.spoolSecondsLeft = Math.max(0, this.warpSequence.spoolSecondsLeft);
    telemetry.targetSystemId = target ? target.id : null;
    telemetry.targetName = target ? target.name : "";
    telemetry.targetDistLy = target ? Math.round(target.distLy * 10) / 10 : 0;
    telemetry.riskPct = warp?.riskPct ?? WARP_RISK_PCT;
    telemetry.accuracyAu = WARP_ACCURACY_AU;
    telemetry.blockedReason = this.warpSequence.blockedReason;
    telemetry.inSector = Boolean(this.sectorVariant);
    telemetry.sectorHazard = this.sectorVariant ? this.sectorVariant.danger : 0;
    telemetry.sectorStability = this.sectorVariant ? this.sectorVariant.stability : 0;
    const choirWave = warp?.choirWaveTick ?? 0;
    const choirIn = choirWave > 0 ? Math.max(0, choirWave - this.worldTick()) : 0;
    telemetry.chorusWaveIn = Math.max(this.sectorVariant ? this.sectorVariant.chorusWaveIn : 0, choirIn);
  }

  /** Подсказки/предупреждения HUD по варпу и Пределу (13d §7/§10). */
  private appendWarpLines(hints: string[], warnings: string[]): void {
    const target = this.warpSequence.target;
    const warp = this.ancientsWarpState();
    if (this.sectorVariant) {
      const hazardLabel = this.sysScene.sectorHazardLabel;
      if (hazardLabel) warnings.push(`ПРЕДЕЛ: ${hazardLabel} — ${this.sysScene.sectorHazardEffect}`);
      warnings.push(`Опасность ${this.sectorVariant.danger}/4 · Стабильность ${Math.round(this.sectorVariant.stability)}/100`);
      if (this.sectorVariant.chorusWaveIn > 0 && this.sectorVariant.chorusWaveIn <= 60) {
        warnings.push(`Волна Хора через ${this.sectorVariant.chorusWaveIn} тактов`);
      }
      if (this.sectorVariant.stability < 25) warnings.push("Врата нестабильны: Стабильность < 25");
      if (this.sectorVariant.hazard && this.sysScene.sectorSensorFactor < 1) {
        warnings.push(`Сенсоры −${Math.round((1 - this.sysScene.sectorSensorFactor) * 100)}%`);
      }
      if (this.warpSequence.phase === "spooling") {
        hints.push(`Раскрутка варпа ${Math.ceil(this.warpSequence.spoolSecondsLeft)} с · Backspace — отмена`);
      } else if (target && target.kind === "gate") {
        hints.push("Выход из Предела: Врата (бесплатно при Стабильности ≥ 25) · Enter — выбор");
      } else if (target) {
        const cd = warp?.cooldownTicks ?? 0;
        hints.push(`Варп по Пределу: ${target.name} · ${target.distLy.toFixed(1)} св. лет · Enter — перелёт${cd > 0 ? ` (кулдаун ${cd} такт. — на паузе)` : ""}`);
      } else {
        hints.push("Предел: нет целей варпа — проверьте ядра/кулдаун");
      }
      return;
    }
    if (!warp || !warp.unlocked) return;
    const cooldown = warp.cooldownTicks;
    if (warp.lastRiskTriggered) {
      const choirIn = Math.max(0, warp.choirWaveTick - this.worldTick());
      warnings.push(choirIn > 0 ? `Хор услышал варп: волна через ${choirIn} тактов` : "Хор услышал варп");
    }
    if (this.warpSequence.phase === "spooling") {
      hints.push(`Раскрутка варпа ${Math.ceil(this.warpSequence.spoolSecondsLeft)} с · Backspace — отмена`);
      return;
    }
    const targetText = target ? `${target.name} · ${target.distLy.toFixed(0)} св. лет` : "нет цели";
    if (cooldown > 0) {
      hints.push(`R — варп (${targetText}) · кулдаун ${cooldown} такт.`);
    } else if (warp.charges <= 0) {
      hints.push("R — варп: нет зарядов ядра (2 реликвии = +1 заряд)");
    } else {
      hints.push(`R — варп: ${targetText} · Enter — раскрутка (зарядов ${warp.charges})`);
    }
  }

  // ================================================================ телеметрия
  private writeTelemetry(): void {
    const t: FlightTelemetry = this.game.flightTelemetry;
    const flight = this.flight;
    const target = this.currentTarget();
    const nav = this.navSystem;
    const station = this.sysScene.station;
    const canDock = Boolean(station) && this.stationDistanceM < DOCK_RANGE_M && flight.speed < DOCK_SPEED_M_S && !flight.isDead;

    // Все числовые поля прогоняем через safeNum: HUD не должен показывать «не число».
    t.active = true;
    t.systemName = this.system.name;
    t.mode = this.enemiesAliveCount() > 0 ? "combat" : flight.mode === "supercruise" ? "supercruise" : "normal";
    t.speed = Math.max(0, Math.round(safeNum(flight.speed)));
    t.throttle = Math.round(clamp01(safeNum(flight.throttle)) * 100);
    t.boost = flight.boost;
    t.assist = flight.assist;
    t.shield = Math.max(0, Math.round(safeNum(flight.shield)));
    t.shieldMax = Math.max(1, Math.round(safeNum(flight.shieldMax, 1)));
    t.hull = Math.max(0, Math.round(safeNum(flight.armor + flight.hull)));
    t.hullMax = Math.max(1, Math.round(safeNum(flight.armorMax + flight.hullMax, 1)));
    t.heat = Math.max(0, Math.round(safeNum(flight.heat)));
    t.overheat = flight.overheat;
    t.pips.sys = Math.round(safeNum(flight.pips.sys, 2));
    t.pips.eng = Math.round(safeNum(flight.pips.eng, 2));
    t.pips.wep = Math.round(safeNum(flight.pips.wep, 2));
    t.supercruiseSpeed = flight.mode === "supercruise" ? Math.round(safeNum(flight.supercruiseC)) : 0;

    t.targetName = target ? target.name : null;
    t.targetDist = target ? Math.round(safeNum(this.flight.position.distanceTo(target.position))) : 0;
    t.targetHull01 = target && target.hull01 != null ? clamp01(safeNum(target.hull01)) : null;

    t.navSystemId = nav ? nav.id : null;
    t.navSystemName = nav ? nav.name : "";
    t.navDistLy = nav ? Math.round(safeNum(this.navDistanceLy(nav)) * 10) / 10 : 0;

    t.stationName = station ? station.name : "";
    t.stationDist = Math.round(safeNum(this.stationDistanceM));
    t.canDock = canDock;
    t.massLocked = this.massLocked;
    t.fsdCharge = this.fsdJumping ? clamp01(safeNum(this.fsdCharge)) : 0;

    // contacts: x,y — экранные координаты в долях вьюпорта (0..1, от левого верхнего угла)
    const contacts = t.contacts;
    contacts.length = 0;
    const pushContact = (name: string, position: THREE.Vector3, hostile: boolean, hull01: number): void => {
      if (contacts.length >= 6) return;
      this.contactScratch.copy(position).project(this.camera);
      let x = (this.contactScratch.x + 1) / 2;
      let y = (1 - this.contactScratch.y) / 2;
      if (this.contactScratch.z > 1) {
        x = 1 - clamp01(x);
        y = 1 - clamp01(y);
      }
      contacts.push({
        name,
        dist: Math.round(safeNum(this.flight.position.distanceTo(position))),
        hostile,
        hull01: clamp01(safeNum(hull01)),
        x: clamp01(safeNum(x)),
        y: clamp01(safeNum(y)),
      });
    };
    // Сектор: сенсоры ограничены (13d §7.5) — контакты за пределами не показываем
    const sensorRangeM = this.sectorVariant ? 90000 * this.sysScene.sectorSensorFactor : Number.POSITIVE_INFINITY;
    for (const enemy of this.enemyShips) {
      if (!enemy.alive) continue;
      if (this.flight.position.distanceTo(enemy.mesh.position) > sensorRangeM) continue;
      pushContact(enemy.name, enemy.mesh.position, true, enemy.hull01);
    }
    if (station) pushContact(station.name, station.group.position, false, 1);
    if (this.sectorVariant) {
      for (const marker of this.sysScene.sectorMarkers) {
        if (this.flight.position.distanceTo(marker.position) > sensorRangeM) continue;
        pushContact(marker.name, marker.position, false, 1);
      }
    }

    const warnings = t.warnings;
    warnings.length = 0;
    if (flight.overheat) warnings.push("ПЕРЕГРЕВ: оружие отключено");
    else if (flight.heat > 80) warnings.push("ТЕПЛО > 80%");
    if (this.massLocked) warnings.push("МАССА-ЛОК: FSD недоступен");
    if (flight.shield <= 0.001) warnings.push("ЩИТ ПРОБИТ");
    else if (flight.shield01 < 0.25) warnings.push("ЩИТ < 25%");
    if (flight.hull01 < 0.3) warnings.push("КОРПУС КРИТИЧЕСКИЙ");
    const aliveCount = this.enemiesAliveCount();
    if (aliveCount > 0) warnings.push("БОЙ: " + aliveCount + " целей");
    if (!station && !this.sectorVariant) warnings.push("Станция отсутствует");

    const hints = t.hints;
    hints.length = 0;
    if (!this.input.pointerLocked) hints.push("Клик по экрану — захват мыши");
    if (this.dockApproach) {
      hints.push("G — отмена автопилота стыковки · X — стоп");
    } else if (canDock) {
      hints.push("G — стыковка: " + (station ? station.name : ""));
    } else if (station && Number.isFinite(this.stationDistanceM) && this.stationDistanceM <= DOCK_APPROACH_RANGE_M) {
      hints.push("G — автопилот стыковки: " + station.name + " · " + formatDist(this.stationDistanceM));
    }
    if (this.sectorVariant) {
      hints.push("Предел: гиперлиний нет — только варп");
    } else if (nav) {
      hints.push("J — прыжок: " + nav.name + " · Tab — выбор");
    } else {
      hints.push("Tab — выбрать систему для прыжка");
    }
    if (flight.mode === "supercruise") hints.push("C — выход из суперкруиза");
    else if (aliveCount === 0) hints.push("C — суперкруиз");
    hints.push("W/S — тяга · Shift — форсаж · X — стоп · Z — assist");
    hints.push("ЛКМ — лазеры · ПКМ — кинетика · Q — цель");
    hints.push("M/Esc — карта галактики");
    // Часть XIII: варп «Наследие» и Реликтовый Предел
    this.appendWarpLines(hints, warnings);
    this.writeWarpTelemetry();
  }

  /** Публичный снимок телеметрии для отладки/тестов (не создаёт новых объектов в игре). */
  get telemetry(): FlightTelemetry {
    return this.game.flightTelemetry;
  }

  /** Корабль игрока (для отладки). */
  get shipVisual(): ShipVisual {
    return this.playerShip;
  }

  /** Количество врагов в бою (для отладки). */
  get enemies(): number {
    return this.enemiesAliveCount();
  }
}
