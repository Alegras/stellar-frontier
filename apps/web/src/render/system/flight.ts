/**
 * 6DOF-модель полёта (docs/03_hybrid_gdd.md §10.1–10.7).
 * Инерция, assist on/off, тяга 0–100%, форсаж, пипсы SYS/ENG/WEP, тепло/перегрев,
 * щит с регенерацией через 4 с после попадания, суперкруиз с гравитационными колодцами.
 */
import * as THREE from "three";
import type { DamageType } from "@sf/data";
import { RESIST } from "./palette";
import { clamp, clamp01, degToRad, moveTowards } from "./util";

/** 1c в игровых единицах (м/с). Система сжата до 12–220 км, поэтому классические
 *  3e8 м/с дали бы «мгновенный» перелёт (GDD §10.2: суперкруиз 30–600 c). */
export const C_UNITS_M_S = 50;
export const SUPERCRUISE_MIN_C = 30;
export const SUPERCRUISE_MAX_C = 600;
/** GDD §10.2: разгон 8 с, торможение 6 с до/от максимума. */
const SUPERCRUISE_ACCEL_C_PER_S = (SUPERCRUISE_MAX_C - SUPERCRUISE_MIN_C) / 8;
const SUPERCRUISE_BRAKE_C_PER_S = (SUPERCRUISE_MAX_C - SUPERCRUISE_MIN_C) / 6;
/** GDD §10.5: порог перегрева и принудительное охлаждение. */
const OVERHEAT_AT = 100;
const OVERHEAT_SEC = 3;
/** GDD §10.6: регенерация начинается через 4 с после последнего попадания. */
const SHIELD_REGEN_DELAY_SEC = 4;
/** GDD §10.1: форсаж 5 с и +40 тепла за рывок. */
const BOOST_DURATION_SEC = 5;
const BOOST_HEAT_PER_SEC = 40 / BOOST_DURATION_SEC;
const BOOST_RECHARGE_PER_SEC = 1 / 9;
/** GDD §10.5: heat sink — мгновенно −50 ед., 1 заряд/бой. */
const HEAT_SINK_AMOUNT = 50;
/** GDD §10.2: у поверхности планеты гравитация режет максимальную скорость до −60%. */
const GRAVITY_SLOWDOWN = 0.6;

export interface FlightStats {
  maxSpeed: number;
  boostSpeed: number;
  accel: number;
  pitchDegS: number;
  yawDegS: number;
  rollDegS: number;
  shieldMax: number;
  armorMax: number;
  hullMax: number;
  shieldRegenPerSec: number;
  heatDissipation: number;
  lengthM: number;
}

export interface DamagePools {
  shield: number;
  shieldMax: number;
  armor: number;
  armorMax: number;
  hull: number;
  hullMax: number;
}

/**
 * Порядок списания: щит → броня → корпус, остаток переносится полностью (GDD §10.4).
 * Возвращает фактически снятый «сырой» урон (для вспышек/логов).
 */
export function applyDamage(pools: DamagePools, dmg: number, type: DamageType, shieldResistBonus = 0): number {
  const resist = RESIST[type] ?? RESIST.kinetic;
  let remaining = dmg;
  const poolsList: { key: "shield" | "armor" | "hull"; max: number; resist: number }[] = [
    { key: "shield", max: pools.shieldMax, resist: resist.shield + shieldResistBonus },
    { key: "armor", max: pools.armorMax, resist: resist.armor },
    { key: "hull", max: pools.hullMax, resist: resist.hull },
  ];
  for (const pool of poolsList) {
    if (remaining <= 0) break;
    if (pools[pool.key] <= 0.001) continue;
    const effective = remaining * (1 - pool.resist);
    if (effective <= pools[pool.key]) {
      pools[pool.key] -= effective;
      remaining = 0;
    } else {
      const rawUsed = pools[pool.key] / Math.max(0.01, 1 - pool.resist);
      pools[pool.key] = 0;
      remaining -= rawUsed;
    }
  }
  return Math.max(0, dmg - Math.max(0, remaining));
}

export interface FlightControls {
  throttleDelta: number; // −1..1 в секунду
  stop: boolean;
  boost: boolean;
}

export class FlightModel {
  readonly stats: FlightStats;
  readonly pools: DamagePools;
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();

  throttle = 0;
  assist = true;
  pips = { sys: 2, eng: 2, wep: 2 };
  mode: "normal" | "supercruise" = "normal";
  supercruiseC = SUPERCRUISE_MIN_C;
  heat = 0;
  overheat = false;
  overheatTimer = 0;
  heatSinkCharges = 1;
  boostFuel = 1;
  boost = false;
  /** 1 = поверхность тела (гравитационный колодец). */
  gravityProximity = 0;
  gravityBodyName = "";
  time = 0;
  private lastHitAt = -999;
  private flash = 0;

  constructor(stats: FlightStats, spawn: THREE.Vector3, spawnQuaternion: THREE.Quaternion) {
    this.stats = stats;
    this.position.copy(spawn);
    this.quaternion.copy(spawnQuaternion);
    this.pools = {
      shield: stats.shieldMax,
      shieldMax: stats.shieldMax,
      armor: stats.armorMax,
      armorMax: stats.armorMax,
      hull: stats.hullMax,
      hullMax: stats.hullMax,
    };
  }

  get shield(): number {
    return this.pools.shield;
  }
  get shieldMax(): number {
    return this.pools.shieldMax;
  }
  get armor(): number {
    return this.pools.armor;
  }
  get armorMax(): number {
    return this.pools.armorMax;
  }
  get hull(): number {
    return this.pools.hull;
  }
  get hullMax(): number {
    return this.pools.hullMax;
  }
  get isDead(): boolean {
    return this.pools.hull <= 0;
  }
  get hull01(): number {
    return clamp01((this.pools.armor + this.pools.hull) / Math.max(1, this.pools.armorMax + this.pools.hullMax));
  }
  get shield01(): number {
    return clamp01(this.pools.shield / Math.max(1, this.pools.shieldMax));
  }
  get hitFlash(): number {
    return this.flash;
  }
  get speed(): number {
    return this.velocity.length();
  }
  /** GDD §10.7: eng_mult = 0.7 + 0.075 × pips. */
  get engMult(): number {
    return clamp(0.7 + 0.075 * this.pips.eng, 0.7, 1);
  }
  /** GDD §10.7: wep_mult = 0.5 + 0.125 × pips. */
  get wepMult(): number {
    return clamp(0.5 + 0.125 * this.pips.wep, 0.5, 1);
  }
  /** GDD §10.7: regen_mult = 0.6 + 0.2 × pips. */
  get sysMult(): number {
    return clamp(0.6 + 0.2 * this.pips.sys, 0.6, 1.4);
  }
  get canFire(): boolean {
    return !this.overheat;
  }
  get maxSpeedNow(): number {
    if (this.mode === "supercruise") return this.supercruiseC * C_UNITS_M_S;
    return (this.boost ? this.stats.boostSpeed : this.stats.maxSpeed) * this.engMult;
  }
  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
  }

  get pipTotal(): number {
    return this.pips.sys + this.pips.eng + this.pips.wep;
  }

  rotate(pitchAngle: number, yawAngle: number, rollAngle: number): void {
    const euler = new THREE.Euler(pitchAngle, yawAngle, rollAngle, "YXZ");
    this.quaternion.multiply(new THREE.Quaternion().setFromEuler(euler)).normalize();
  }

  setThrottleDelta(delta: number, dt: number): void {
    this.throttle = clamp01(this.throttle + delta * dt);
  }

  toggleAssist(): boolean {
    this.assist = !this.assist;
    return this.assist;
  }

  /** GDD §10.1: X — полный стоп-тормоз. */
  fullStop(): void {
    this.throttle = 0;
    this.velocity.multiplyScalar(0.05);
  }

  addHeat(amount: number): void {
    if (this.overheat) return;
    this.heat = clamp(this.heat + amount, 0, OVERHEAT_AT);
    if (this.heat >= OVERHEAT_AT) {
      this.overheat = true;
      this.overheatTimer = OVERHEAT_SEC;
    }
  }

  useHeatSink(): boolean {
    if (this.heatSinkCharges <= 0) return false;
    this.heatSinkCharges -= 1;
    this.heat = Math.max(0, this.heat - HEAT_SINK_AMOUNT);
    this.overheat = false;
    this.overheatTimer = 0;
    return true;
  }

  /** GDD §10.7: смена пипса с проверкой бюджета 6 единиц. */
  setPip(sector: "sys" | "eng" | "wep", delta: number): boolean {
    const next = clamp(this.pips[sector] + delta, 0, 4);
    if (next === this.pips[sector]) return false;
    const total = this.pipTotal - this.pips[sector] + next;
    if (total > 6) return false;
    this.pips[sector] = next;
    return true;
  }

  toggleSupercruise(blockedReason: string | null): { ok: boolean; message: string } {
    if (this.mode === "supercruise") {
      this.exitSupercruise();
      return { ok: true, message: "Выход из суперкруиза" };
    }
    if (blockedReason) return { ok: false, message: blockedReason };
    this.mode = "supercruise";
    this.supercruiseC = Math.max(SUPERCRUISE_MIN_C, this.supercruiseC);
    this.throttle = Math.max(this.throttle, 0.1);
    return { ok: true, message: "Суперкруиз включён" };
  }

  exitSupercruise(applyTransition = true): void {
    if (this.mode !== "supercruise") return;
    this.mode = "normal";
    this.supercruiseC = SUPERCRUISE_MIN_C;
    if (applyTransition) {
      // переход 3 с уязвимости (GDD §10.2): скорость падает до субсветовой
      const dir = this.forward;
      const exitSpeed = Math.min(this.stats.maxSpeed * 2.2, 1200);
      this.velocity.copy(dir).multiplyScalar(exitSpeed);
      this.throttle = 0.5;
    }
  }

  takeDamage(dmg: number, type: DamageType): number {
    const applied = applyDamage(this.pools, dmg, type, 0.05 * (this.pips.sys - 2));
    if (applied > 0) {
      this.lastHitAt = this.time;
      this.flash = Math.min(1, this.flash + 0.35 + applied / 120);
      this.addHeat(applied * 0.15);
    }
    return applied;
  }

  /**
   * @param hostiles в системе есть живые враги (реген щита в бою 50%, GDD §10.6).
   */
  update(dt: number, controls: FlightControls, gravityProximity: number, gravityName: string, hostiles: boolean): void {
    this.time += dt;
    this.gravityProximity = clamp01(gravityProximity);
    this.gravityBodyName = gravityName;
    this.flash = Math.max(0, this.flash - dt * 2.2);

    const effectiveGravity = this.gravityProximity;
    const forward = this.forward;
    // тяга и тормоз доступны в обоих режимах (в суперкруизе меняют целевую скорость 30–600 c)
    this.throttle = clamp01(this.throttle + controls.throttleDelta * dt);
    if (controls.stop) this.throttle = 0;

    if (this.mode === "supercruise") {
      // Гравитационный колодец режет максимальную скорость на 25–60% (GDD §10.2)
      const wellLimit = SUPERCRUISE_MIN_C + (SUPERCRUISE_MAX_C - SUPERCRUISE_MIN_C) * (1 - GRAVITY_SLOWDOWN * effectiveGravity);
      const targetC = clamp(
        SUPERCRUISE_MIN_C + (SUPERCRUISE_MAX_C - SUPERCRUISE_MIN_C) * this.throttle,
        SUPERCRUISE_MIN_C,
        wellLimit,
      );
      const rate = targetC > this.supercruiseC ? SUPERCRUISE_ACCEL_C_PER_S : SUPERCRUISE_BRAKE_C_PER_S;
      this.supercruiseC = moveTowards(this.supercruiseC, targetC, rate * dt);
      this.velocity.copy(forward).multiplyScalar(this.supercruiseC * C_UNITS_M_S);
      if (effectiveGravity > 0.88) {
        // слишком близко к телу — автовыход, чтобы не «влететь» в планету на 600 c
        this.exitSupercruise();
      }
    } else {
      if (controls.stop) {
        this.throttle = 0;
        this.velocity.multiplyScalar(Math.max(0, 1 - 6 * dt));
      }
      this.boost = controls.boost && this.boostFuel > 0.01;
      if (this.boost) {
        this.boostFuel = clamp01(this.boostFuel - dt / BOOST_DURATION_SEC);
        this.addHeat(BOOST_HEAT_PER_SEC * dt);
      } else {
        this.boostFuel = clamp01(this.boostFuel + BOOST_RECHARGE_PER_SEC * dt);
      }
      const maxSpeed = (this.boost ? this.stats.boostSpeed : this.stats.maxSpeed) * this.engMult;
      const accel = this.stats.accel * (this.boost ? 1.7 : 1);
      if (this.throttle > 0.001) {
        this.velocity.addScaledVector(forward, accel * this.throttle * dt);
      }
      if (this.assist) {
        const speed = this.velocity.length();
        if (this.throttle < 0.02) {
          this.velocity.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
        } else if (speed > 1) {
          // автокомпенсация сноса: вектор скорости подтягивается к носу
          const target = forward.clone().multiplyScalar(speed);
          this.velocity.lerp(target, 1 - Math.exp(-3.5 * dt));
        }
      }
      this.velocity.clampLength(0, maxSpeed);
    }

    this.position.addScaledVector(this.velocity, dt);

    // --- тепло (GDD §10.5)
    if (this.overheat) {
      this.overheatTimer -= dt;
      this.heat = Math.max(0, this.heat - 45 * dt * 2.5);
      if (this.overheatTimer <= 0) {
        this.overheat = false;
        this.heat = Math.min(this.heat, 55);
      }
    } else {
      const dissipation = this.stats.heatDissipation * (1 + 0.15 * this.pips.wep);
      this.heat = clamp(this.heat - dissipation * dt, 0, OVERHEAT_AT);
    }

    // --- щит (GDD §10.6)
    if (this.time - this.lastHitAt > SHIELD_REGEN_DELAY_SEC && this.pools.shield < this.pools.shieldMax) {
      const regen = this.stats.shieldRegenPerSec * this.sysMult * (hostiles ? 0.5 : 1);
      this.pools.shield = Math.min(this.pools.shieldMax, this.pools.shield + regen * dt);
    }
  }

  resetAfterRevive(): void {
    this.pools.shield = this.pools.shieldMax;
    this.pools.armor = this.pools.armorMax;
    this.pools.hull = this.pools.hullMax;
    this.heat = 0;
    this.overheat = false;
    this.heatSinkCharges = 1;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this.mode = "normal";
  }
}

/** Вспомогательные углы (rad/s) из статов корпуса (GDD §9.3 / UX §5.4). */
export function turnRates(stats: FlightStats, assist: boolean): { pitch: number; yaw: number; roll: number } {
  const boost = assist ? 1 : 1.15;
  return {
    pitch: degToRad(stats.pitchDegS) * boost,
    yaw: degToRad(stats.yawDegS) * boost,
    roll: degToRad(stats.rollDegS),
  };
}
