/**
 * Тактический бой M4 (docs/03_hybrid_gdd.md §10.3–10.4, docs/06 M4):
 * вражеские корабли, ИИ сближения/орбиты/стрельбы, снаряды с упреждением,
 * лазерные лучи (hitscan), эффекты попаданий и BattleRecord.
 * Числа оружия/корпусов — из packages/data (weapons.json / hulls.json).
 */
import * as THREE from "three";
import type { BattleRecord, Fleet, Ship } from "@sf/sim";
import type { DamageType, HullDef, ShipDesignDef, WeaponDef } from "@sf/data";
import { buildShip, type ShipVisual } from "./ships";
import { PAL } from "./palette";
import { applyDamage, type DamagePools } from "./flight";
import { Rng } from "./rng";
import { clamp, clamp01 } from "./util";

/**
 * Дистанция «орбиты» ИИ вокруг игрока (м). 900 м держит пиратов в эффективной
 * дальности лазеров игрока (1500–1800 м) и его кинетики (2200 м): бой идёт,
 * а не превращается в перестрелку на 2,3 км, где половина оружия не достаёт.
 */
const ENEMY_ORBIT_BAND_M = 900;
/** ИИ стреляет реже табличного ROF, иначе 3 корвета убивают фрегат за 10 с. */
const ENEMY_ROF_FACTOR = 0.45;
/** ИИ мажет чаще номинала — бой 1×2 должен выигрываться тактикой (docs/06 M4). */
const ENEMY_ACCURACY_FACTOR = 0.55;

export interface EnemyInit {
  fleet: Fleet;
  ship: Ship;
  design: ShipDesignDef;
  hull: HullDef;
  weapons: WeaponDef[];
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

function hullArmor(def: HullDef): number {
  return Math.max(1, def.armorBase);
}
function hullHp(def: HullDef): number {
  return Math.max(1, def.hullHp);
}
function hullShield(def: HullDef): number {
  return Math.max(1, def.shieldBase);
}

export class EnemyShip {
  readonly visual: ShipVisual;
  readonly mesh: THREE.Group;
  readonly pools: DamagePools;
  readonly fleet: Fleet;
  readonly ship: Ship;
  readonly design: ShipDesignDef;
  readonly hull: HullDef;
  readonly weapons: WeaponDef[];
  readonly velocity = new THREE.Vector3();
  readonly radiusM: number;
  readonly maxSpeed: number;
  readonly accel: number;
  alive = true;
  /** 1 = только что получил урон (для вспышки). */
  fireCooldown = 0;
  private hitFlash = 0;
  private readonly orbitSign: number;
  private readonly nameText: string;

  constructor(init: EnemyInit, rng: Rng) {
    this.visual = buildShip("enemy", init.hull.lengthM, rng);
    this.mesh = this.visual.group;
    this.mesh.position.copy(init.position);
    this.mesh.quaternion.copy(init.quaternion);
    this.fleet = init.fleet;
    this.ship = init.ship;
    this.design = init.design;
    this.hull = init.hull;
    this.weapons = init.weapons;
    this.radiusM = Math.max(25, init.hull.lengthM * 0.5);
    this.maxSpeed = init.hull.baseSpeed;
    // GDD §9.3: accel = thrust / mass; thrust не в данных — выводим из base_speed
    this.accel = init.hull.baseSpeed * 0.08;
    this.orbitSign = rng.sign();
    this.nameText = init.ship.name || init.design.ru;
    const shieldMax = init.ship.shieldMax > 0 ? init.ship.shieldMax : hullShield(init.hull);
    const armorMax = init.ship.armorMax > 0 ? init.ship.armorMax : hullArmor(init.hull);
    const hullMax = init.ship.hullMax > 0 ? init.ship.hullMax : hullHp(init.hull);
    this.pools = {
      shield: init.ship.shield > 0 ? init.ship.shield : shieldMax,
      shieldMax,
      armor: init.ship.armor > 0 ? init.ship.armor : armorMax,
      armorMax,
      hull: init.ship.hull > 0 ? init.ship.hull : hullMax,
      hullMax,
    };
    this.fireCooldown = rng.range(0.8, 2.4);
  }

  get name(): string {
    return this.nameText;
  }

  get hull01(): number {
    return clamp01((this.pools.armor + this.pools.hull) / Math.max(1, this.pools.armorMax + this.pools.hullMax));
  }

  get distanceToPlayer01(): number {
    return this.pools.shield / Math.max(1, this.pools.shieldMax);
  }

  get hitFlashAmount(): number {
    return this.hitFlash;
  }

  takeDamage(dmg: number, type: DamageType): number {
    const applied = applyDamage(this.pools, dmg, type);
    if (applied > 0) this.hitFlash = Math.min(1, this.hitFlash + 0.6);
    if (this.pools.armor + this.pools.hull <= 0) this.alive = false;
    return applied;
  }

  /**
   * ИИ: сближение → орбита → стрельба (docs/06 M4: «агрессор»).
   * @param onFire колбэк спавна снаряда.
   */
  update(
    dt: number,
    playerPosition: THREE.Vector3,
    playerVelocity: THREE.Vector3,
    playerAlive: boolean,
    rng: Rng,
    onFire: (from: THREE.Vector3, direction: THREE.Vector3, damage: number, type: DamageType) => void,
  ): void {
    if (!this.alive) return;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2);
    this.visual.setHitFlash(this.hitFlash);
    if (!playerAlive) {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt));
      this.mesh.position.addScaledVector(this.velocity, dt);
      return;
    }

    const toPlayer = new THREE.Vector3().subVectors(playerPosition, this.mesh.position);
    const distance = toPlayer.length();
    const dir = distance > 0.001 ? toPlayer.clone().divideScalar(distance) : new THREE.Vector3(0, 0, 1);

    let desired: THREE.Vector3;
    if (distance > ENEMY_ORBIT_BAND_M * 1.5) {
      desired = dir.clone().multiplyScalar(this.maxSpeed * 0.9);
    } else if (distance < ENEMY_ORBIT_BAND_M * 0.55) {
      desired = dir.clone().multiplyScalar(-this.maxSpeed * 0.75);
    } else {
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-4) side.set(0, 1, 0);
      side.normalize().multiplyScalar(this.orbitSign);
      desired = side.multiplyScalar(this.maxSpeed * 0.55);
    }
    const blend = 1 - Math.exp(-1.4 * dt);
    this.velocity.lerp(desired, blend);
    this.velocity.clampLength(0, this.maxSpeed);
    this.mesh.position.addScaledVector(this.velocity, dt);

    // ориентация на упреждённую точку (чтобы стрелять «в лоб» с упреждением)
    const leadPoint = playerPosition.clone().addScaledVector(playerVelocity, 0.4);
    this.mesh.lookAt(leadPoint);

    if (this.weapons.length === 0) return;
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0) return;
    const weapon = this.weapons[Math.floor(rng.next() * this.weapons.length)];
    if (!weapon) return;
    if (distance > weapon.rangeM) {
      this.fireCooldown = 0.25;
      return;
    }
    const falloff = clamp(1 - 0.6 * Math.pow(distance / Math.max(1, weapon.rangeM), 1.5), 0.35, 1);
    const from = this.mesh.position.clone().addScaledVector(dir, this.radiusM);
    const aim = leadPoint.clone().sub(from).normalize();
    if (rng.next() > weapon.accuracy * ENEMY_ACCURACY_FACTOR) {
      // промах: уводим снаряд в сторону
      aim.applyAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(-0.06, 0.06));
    }
    onFire(from, aim, weapon.dmg * falloff, weapon.dmgType);
    this.fireCooldown = 1 / Math.max(0.05, weapon.rof * ENEMY_ROF_FACTOR);
  }

  dispose(): void {
    this.visual.dispose();
    this.mesh.removeFromParent();
  }
}

// ------------------------------------------------------------ проекции/снаряды
interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  type: DamageType;
  fromPlayer: boolean;
  life: number;
}

interface Beam {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
}

export interface ProjectileContext {
  dt: number;
  playerPosition: THREE.Vector3;
  playerRadius: number;
  playerAlive: boolean;
  enemies: EnemyShip[];
  asteroids: { id: number; position: THREE.Vector3; radiusM: number }[];
  onAsteroidHit: (id: number, damage: number, type: DamageType) => void;
  onPlayerHit: (damage: number, type: DamageType) => void;
  onEnemyHit: (enemy: EnemyShip, damage: number, type: DamageType) => void;
}

function segmentHitsSphere(a: THREE.Vector3, b: THREE.Vector3, center: THREE.Vector3, radius: number): boolean {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lengthSq = ab.lengthSq();
  const t = lengthSq > 1e-9 ? clamp(new THREE.Vector3().subVectors(center, a).dot(ab) / lengthSq, 0, 1) : 0;
  const closest = new THREE.Vector3().copy(a).addScaledVector(ab, t);
  return closest.distanceToSquared(center) <= radius * radius;
}

export class ProjectileField {
  readonly group = new THREE.Group();
  private projectiles: Projectile[] = [];
  private beams: Beam[] = [];
  private readonly projectileGeo = new THREE.BoxGeometry(2.4, 2.4, 22);
  private readonly beamGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly playerMaterial: THREE.MeshBasicMaterial;
  private readonly enemyMaterial: THREE.MeshBasicMaterial;
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();

  constructor() {
    this.playerMaterial = new THREE.MeshBasicMaterial({ color: PAL.shield });
    this.enemyMaterial = new THREE.MeshBasicMaterial({ color: PAL.enemy });
    this.group.name = "combat-projectiles";
  }

  spawnProjectile(
    from: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    damage: number,
    type: DamageType,
    fromPlayer: boolean,
  ): void {
    const mesh = new THREE.Mesh(this.projectileGeo, fromPlayer ? this.playerMaterial : this.enemyMaterial);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
    this.group.add(mesh);
    this.projectiles.push({
      mesh,
      velocity: direction.clone().normalize().multiplyScalar(speed),
      damage,
      type,
      fromPlayer,
      life: 6,
    });
  }

  /** Лазерный луч (hitscan-визуал), живёт 0.12 с. */
  spawnBeam(from: THREE.Vector3, to: THREE.Vector3, colorHex: string): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const length = Math.max(1, dir.length());
    const mesh = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 }));
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    mesh.scale.set(4.5, 4.5, length);
    this.group.add(mesh);
    this.beams.push({ mesh, material: mesh.material as THREE.MeshBasicMaterial, life: 0.12 });
  }

  update(ctx: ProjectileContext): void {
    const { dt } = ctx;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      if (!projectile) continue;
      this.scratchA.copy(projectile.mesh.position);
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      projectile.life -= dt;
      let consumed = false;

      if (projectile.fromPlayer) {
        for (const enemy of ctx.enemies) {
          if (!enemy.alive) continue;
          if (segmentHitsSphere(this.scratchA, projectile.mesh.position, enemy.mesh.position, enemy.radiusM)) {
            ctx.onEnemyHit(enemy, projectile.damage, projectile.type);
            consumed = true;
            break;
          }
        }
        if (!consumed) {
          for (const asteroid of ctx.asteroids) {
            if (segmentHitsSphere(this.scratchA, projectile.mesh.position, asteroid.position, asteroid.radiusM)) {
              ctx.onAsteroidHit(asteroid.id, projectile.damage, projectile.type);
              consumed = true;
              break;
            }
          }
        }
      } else if (ctx.playerAlive) {
        if (segmentHitsSphere(this.scratchA, projectile.mesh.position, ctx.playerPosition, ctx.playerRadius)) {
          ctx.onPlayerHit(projectile.damage, projectile.type);
          consumed = true;
        }
      }

      if (consumed || projectile.life <= 0) this.releaseProjectile(i);
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const beam = this.beams[i];
      if (!beam) continue;
      beam.life -= dt;
      beam.material.opacity = Math.max(0, beam.life / 0.12) * 0.9;
      if (beam.life <= 0) {
        beam.mesh.removeFromParent();
        beam.material.dispose();
        this.beams.splice(i, 1);
      }
    }
  }

  private releaseProjectile(index: number): void {
    const projectile = this.projectiles[index];
    if (!projectile) return;
    projectile.mesh.removeFromParent();
    this.projectiles.splice(index, 1);
  }

  dispose(): void {
    for (const projectile of this.projectiles) projectile.mesh.removeFromParent();
    this.projectiles.length = 0;
    for (const beam of this.beams) {
      beam.mesh.removeFromParent();
      beam.material.dispose();
    }
    this.beams.length = 0;
    this.projectileGeo.dispose();
    this.beamGeo.dispose();
    this.playerMaterial.dispose();
    this.enemyMaterial.dispose();
    this.group.removeFromParent();
  }
}

// -------------------------------------------------------------------- эффекты
interface Effect {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  grow: number;
}

export class EffectPool {
  readonly group = new THREE.Group();
  private items: Effect[] = [];
  private readonly geo = new THREE.IcosahedronGeometry(1, 0);

  constructor() {
    this.group.name = "combat-effects";
  }

  spawnExplosion(position: THREE.Vector3, radius: number, colorHex: string): void {
    const material = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95, depthWrite: false });
    const mesh = new THREE.Mesh(this.geo, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(radius * 0.5);
    this.group.add(mesh);
    this.items.push({ mesh, material, life: 0.55, maxLife: 0.55, grow: radius * 3.4 });
  }

  spawnHit(position: THREE.Vector3, colorHex: string): void {
    const material = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(this.geo, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(22);
    this.group.add(mesh);
    this.items.push({ mesh, material, life: 0.2, maxLife: 0.2, grow: 110 });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (!item) continue;
      item.life -= dt;
      const t = 1 - item.life / item.maxLife;
      item.material.opacity = Math.max(0, 1 - t) * 0.95;
      item.mesh.scale.setScalar(22 + item.grow * t);
      if (item.life <= 0) {
        item.mesh.removeFromParent();
        item.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const item of this.items) {
      item.mesh.removeFromParent();
      item.material.dispose();
    }
    this.items.length = 0;
    this.geo.dispose();
    this.group.removeFromParent();
  }
}

// --------------------------------------------------------------- BattleRecord
export interface BattleRecordInput {
  systemId: number;
  tick: number;
  durationSec: number;
  attacker: { empireId: number; fleetId: number; fp: number; shipsBefore: number };
  defender: { empireId: number; fleetId: number; fp: number; shipsBefore: number };
  attackerLossFp: number;
  defenderLossFp: number;
  attackerShipsLost: number;
  defenderShipsLost: number;
  outcome: "attacker_win" | "defender_win" | "draw";
}

/**
 * Трофеи (docs/03_hybrid_gdd.md §10.11: «доход с трофеев/контрактов» компенсирует
 * расходы боя): 1.5 сплава и 500 Cr за каждую единицу уничтоженного FP.
 */
export function makeBattleRecord(input: BattleRecordInput): BattleRecord {
  return {
    id: `tac-${input.tick}-${input.systemId}-${Math.round(input.durationSec)}`,
    tick: input.tick,
    systemId: input.systemId,
    attacker: { ...input.attacker },
    defender: { ...input.defender },
    outcome: input.outcome,
    attackerLossFp: Math.round(input.attackerLossFp),
    defenderLossFp: Math.round(input.defenderLossFp),
    attackerShipsLost: input.attackerShipsLost,
    defenderShipsLost: input.defenderShipsLost,
    durationSec: Math.max(1, Math.round(input.durationSec)),
    spoilsAlloys: Math.round(input.defenderLossFp * 1.5),
    spoilsCredits: Math.round(input.defenderLossFp * 500),
    tactical: true,
  };
}