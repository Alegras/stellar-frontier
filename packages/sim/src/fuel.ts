/** Топливо флотов: запас, расход на гиперпрыжок, дозаправка. */
import { DESIGN_BY_ID } from "@sf/data";
import type { Fleet, World } from "./types";

export const FUEL_BASE = 90;

export function fuelCapacityOf(world: World, fleet: Fleet): number {
  const empire = world.empires.find((e) => e.id === fleet.empireId);
  let best = 0;
  for (const ship of fleet.ships) {
    const design = DESIGN_BY_ID[ship.designId];
    let cap = FUEL_BASE;
    for (const mod of design?.modules ?? []) {
      if (mod === "fuel_tank_mk2") cap += 90;
      else if (mod === "fuel_tank_mk1") cap += 45;
    }
    best = Math.max(best, cap);
  }
  const techs = empire?.techs.completed ?? [];
  let mult = 1 + Math.max(0, fleet.ships.length - 1) * 0.05;
  if (techs.includes("eng_logistics_1")) mult += 0.1;
  if (techs.includes("eng_logistics_2")) mult += 0.1;
  return Math.round((best || FUEL_BASE) * mult);
}

export function fuelOf(fleet: Fleet): number {
  return Math.max(0, Math.round(fleet.fuel ?? fleet.fuelMax ?? FUEL_BASE));
}

export function ensureFleetFuel(world: World, fleet: Fleet): void {
  fleet.fuelMax = fuelCapacityOf(world, fleet);
  if (fleet.fuel == null) fleet.fuel = fleet.fuelMax;
  fleet.fuel = Math.max(0, Math.min(fleet.fuelMax, fleet.fuel));
}

export function jumpDistance(world: World, fromId: number, toId: number): number {
  const a = world.systems[fromId];
  const b = world.systems[toId];
  if (!a || !b) return 300;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Стоимость одного прыжка; двигатели/FSD снижают расход. */
export function jumpFuelCost(world: World, fleet: Fleet, fromId: number, toId: number): number {
  const empire = world.empires.find((e) => e.id === fleet.empireId);
  const techs = empire?.techs.completed ?? [];
  let cost = 6 + jumpDistance(world, fromId, toId) / 140;
  if (techs.includes("eng_thrusters_1")) cost *= 0.9;
  if (techs.includes("eng_thrusters_2")) cost *= 0.9;
  if (techs.includes("eng_fsd_1")) cost *= 0.9;
  if (techs.includes("eng_fsd_2")) cost *= 0.9;
  return Math.max(3, Math.ceil(cost));
}

export function pathFuelCost(world: World, fleet: Fleet, path: number[]): number {
  let total = 0;
  let from = fleet.systemId;
  for (const to of path) { total += jumpFuelCost(world, fleet, from, to); from = to; }
  return total;
}

/** Скорость прыжка: лучшие двигатели сокращают число тактов. */
export function jumpTicksFor(world: World, fleet: Fleet): number {
  const empire = world.empires.find((e) => e.id === fleet.empireId);
  const techs = empire?.techs.completed ?? [];
  let ticks = world.balance.fleetSpeedTicksPerJump;
  if (techs.includes("eng_thrusters_1") || techs.includes("eng_fsd_1")) ticks -= 1;
  if (techs.includes("eng_thrusters_2") || techs.includes("eng_fsd_2")) ticks -= 1;
  return Math.max(1, Math.round(ticks));
}
