import { describe, expect, it } from "vitest";
import { BALANCE, HULL_BY_ID, MODE } from "@sf/data";
import {
  applyCommand, applyCommandAs, createWorld, deserializeWorld, ensureFg,
  getAvailableShipParts, getBuildCost, getCustomDesigns, getDesignById, getDesignPreview,
  serializeWorld, tick, validateShipDesign,
} from "../src/index";
import type { DesignDraft, World } from "../src/index";

const CORVETTE: DesignDraft = {
  nameRu: "Тестовый корвет",
  hullId: "hull_corvette",
  weapons: ["kinetic_s_mk1", "laser_s_mk1", "laser_m_mk1"],
  modules: ["shield_gen_mk1", "heat_sink_mk1", "reactor_mk2", "thruster_mk1"],
};

const TECH_BASE = [
  "eng_kinetics_1", "phys_lasers_1", "phys_reactor_1", "phys_shields_1",
];

function fresh(): World {
  return createWorld(42, MODE, BALANCE);
}

function withTechs(world: World, techs: string[] = TECH_BASE): void {
  const player = world.empires[0];
  for (const tech of techs) if (!player.techs.completed.includes(tech)) player.techs.completed.push(tech);
}

describe("конструктор кораблей: валидация и статы (GDD §9.1–9.4)", () => {
  it("валидный дизайн корвета: FP ~6, стоимость/масса/мощность считаются", () => {
    const world = fresh();
    withTechs(world);
    const result = validateShipDesign(world, 1, CORVETTE);
    expect(result.ok, result.errors.map((e) => e.messageRu).join("; ")).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.stats.mass).toBeGreaterThan(0);
    expect(result.stats.mass).toBeLessThanOrEqual(HULL_BY_ID.hull_corvette.maxMass);
    expect(result.stats.powerUse).toBeLessThanOrEqual(result.stats.powerMax);
    expect(result.stats.fleetPower).toBeGreaterThanOrEqual(4);
    expect(result.stats.fleetPower).toBeLessThanOrEqual(12);
    expect(result.stats.costAlloys).toBeGreaterThan(0);
    expect(result.stats.costCredits).toBeGreaterThan(0);
    expect(result.stats.buildTicks).toBe(HULL_BY_ID.hull_corvette.buildTicks);
  });

  it("getDesignPreview отдаёт контракт для UI (errorsRu/warningsRu/stats)", () => {
    const world = fresh();
    withTechs(world);
    const preview = getDesignPreview(world, 1, CORVETTE);
    expect(preview.ok).toBe(true);
    expect(preview.errorsRu).toEqual([]);
    expect(Array.isArray(preview.warningsRu)).toBe(true);
    for (const key of ["fleetPower", "costAlloys", "costCredits", "buildTicks", "mass", "powerDraw", "powerOutput", "heatNet"] as const) {
      expect(typeof preview.stats[key], key).toBe("number");
    }
    expect(preview.stats.slotsUsed.total).toBeGreaterThan(0);
    // getAvailableShipParts учитывает технологии
    const parts = getAvailableShipParts(world, 1);
    expect(parts.hulls.some((hull) => hull.id === "hull_corvette")).toBe(true);
    expect(parts.weapons.some((weapon) => weapon.id === "kinetic_s_mk1")).toBe(true);
    expect(parts.weapons.some((weapon) => weapon.id === "railgun_l_mk1")).toBe(false);
  });

  it("конструктор доступен со старта: стартовые технологии оружия/корпуса/модулей", () => {
    const world = fresh();
    const player = world.empires[0];
    expect(player.techs.completed.length).toBe(0); // технологии не выдаются: T0 доступны по правилу конструктора
    const parts = getAvailableShipParts(world, 1);
    expect(parts.weapons.some((weapon) => weapon.id === "kinetic_s_mk1")).toBe(true);
    expect(parts.weapons.some((weapon) => weapon.id === "laser_s_mk1")).toBe(true);
    expect(parts.hulls.some((hull) => hull.id === "hull_frigate")).toBe(true);
    // простейший стартовый дизайн без поздних технологий
    const starter: DesignDraft = {
      nameRu: "Стартовый корвет",
      hullId: "hull_corvette",
      weapons: ["kinetic_s_mk1", "laser_s_mk1"],
      modules: ["shield_gen_mk1", "heat_sink_mk1", "reactor_mk1", "thruster_mk1"],
    };
    const result = validateShipDesign(world, 1, starter);
    expect(result.ok, result.errors.map((error) => error.messageRu).join("; ")).toBe(true);
    expect(applyCommand(world, { type: "create_design", ...starter }).ok).toBe(true);
  });

  it("неизвестный корпус и неисследованные технологии — ошибки с кодами", () => {
    const world = fresh();
    const unknown = validateShipDesign(world, 1, { ...CORVETTE, hullId: "hull_unknown" });
    expect(unknown.ok).toBe(false);
    expect(unknown.errors[0].code).toBe("unknown_hull");
    // реактор_mk2 требует phys_reactor_1 — не стартовая технология
    const noTech = validateShipDesign(world, 1, CORVETTE);
    expect(noTech.ok).toBe(false);
    const codes = noTech.errors.map((error) => error.code);
    expect(codes).toContain("module_tech");
    // оружие позднего тира требует технологии
    const weaponTech = validateShipDesign(world, 1, {
      ...CORVETTE, weapons: ["laser_l_mk1"],
      modules: ["shield_gen_mk1", "reactor_mk1", "thruster_mk1"],
    });
    expect(weaponTech.errors.some((error) => error.code === "weapon_tech")).toBe(true);
    // эсминец требует eng_hull_2 (фрегат уже доступен со старта)
    const destroyer = validateShipDesign(world, 1, { ...CORVETTE, nameRu: "Эсминец", hullId: "hull_destroyer" });
    expect(destroyer.errors.some((error) => error.code === "hull_tech")).toBe(true);
    expect(destroyer.requiredTechs).toContain("eng_hull_2");
  });

  it("мощность, слоты, масса, обязательные модули и оружие", () => {
    const world = fresh();
    withTechs(world, [
      ...TECH_BASE, "phys_reactor_2", "eng_hull_2", "eng_armor_3", "eng_kinetics_3",
      "phys_singularity_1", "eng_thrusters_2", "eng_fsd_2",
    ]);
    // мощность: 2 лазера S + M + щит > reactor_mk1 (32)
    const power = validateShipDesign(world, 1, {
      ...CORVETTE,
      modules: ["shield_gen_mk1", "reactor_mk1", "thruster_mk1"],
    });
    expect(power.errors.some((error) => error.code === "power")).toBe(true);
    // без реактора
    const noReactor = validateShipDesign(world, 1, {
      ...CORVETTE,
      modules: ["shield_gen_mk1", "thruster_mk1"],
    });
    expect(noReactor.errors.some((error) => error.code === "no_reactor")).toBe(true);
    // без двигателя
    const noEngine = validateShipDesign(world, 1, {
      ...CORVETTE,
      modules: ["shield_gen_mk1", "reactor_mk2"],
    });
    expect(noEngine.errors.some((error) => error.code === "no_thruster")).toBe(true);
    // без оружия на боевом корпусе
    const noWeapon = validateShipDesign(world, 1, { ...CORVETTE, weapons: [] });
    expect(noWeapon.errors.some((error) => error.code === "no_weapon")).toBe(true);
    // слоты: 3 средних оружия в корвет (1 medium, 0 large)
    const slots = validateShipDesign(world, 1, {
      ...CORVETTE,
      weapons: ["kinetic_m_mk1", "kinetic_m_mk1", "kinetic_m_mk1"],
    });
    expect(slots.errors.some((error) => error.code === "weapon_slots")).toBe(true);
    // масса: эсминец с тяжёлой бронёй и рельсотроном
    const mass = validateShipDesign(world, 1, {
      nameRu: "Перегруз",
      hullId: "hull_destroyer",
      weapons: ["kinetic_l_mk1", "kinetic_m_mk1", "kinetic_m_mk1"],
      modules: ["armor_plating_mk3", "armor_plating_mk3", "armor_plating_mk3", "armor_plating_mk3", "armor_plating_mk3", "reactor_mk4", "thruster_mk3", "fsd_mk3"],
    });
    expect(mass.errors.some((error) => error.code === "mass")).toBe(true);
  });
});

describe("конструктор: команды create/update/delete/save + лимиты", () => {
  it("create_design сохраняет дизайн; дубликат имени и лимит 20", () => {
    const world = fresh();
    withTechs(world);
    const create = applyCommand(world, { type: "create_design", ...CORVETTE });
    expect(create.ok, create.messageRu).toBe(true);
    const designs = getCustomDesigns(world, 1);
    expect(designs.length).toBe(1);
    expect(designs[0].ownerId).toBe(1);
    expect(designs[0].nameRu).toBe(CORVETTE.nameRu);
    expect(designs[0].fleetPower).toBeGreaterThan(0);
    // дубликат названия
    expect(applyCommand(world, { type: "create_design", ...CORVETTE }).ok).toBe(false);
    // 19 ещё — до лимита 20
    for (let i = 2; i <= 20; i++) {
      const result = applyCommand(world, { type: "create_design", ...CORVETTE, nameRu: "Корвет-" + i });
      expect(result.ok, result.messageRu).toBe(true);
    }
    expect(getCustomDesigns(world, 1).length).toBe(20);
    const over = applyCommand(world, { type: "create_design", ...CORVETTE, nameRu: "Корвет-21" });
    expect(over.ok).toBe(false);
    expect(over.messageRu).toContain("Лимит");
  });

  it("update/delete/save_design: принадлежность и обновление статов", () => {
    const world = fresh();
    withTechs(world);
    applyCommand(world, { type: "create_design", ...CORVETTE });
    const design = getCustomDesigns(world, 1)[0];
    const update = applyCommand(world, {
      type: "update_design", designId: design.id, nameRu: "Обновлённый",
      weapons: ["kinetic_s_mk1", "laser_s_mk1", "laser_m_mk1"],
    });
    expect(update.ok, update.messageRu).toBe(true);
    expect(getCustomDesigns(world, 1)[0].nameRu).toBe("Обновлённый");
    // чужой дизайн
    const foreign = applyCommandAs(world, 2, { type: "update_design", designId: design.id, nameRu: "Чужой" });
    expect(foreign.ok).toBe(false);
    // save_design — создание и обновление
    const created = applyCommand(world, {
      type: "save_design",
      design: { ...CORVETTE, nameRu: "Через save" },
    });
    expect(created.ok, created.messageRu).toBe(true);
    const saved = getCustomDesigns(world, 1).find((entry) => entry.nameRu === "Через save")!;
    expect(saved).toBeDefined();
    const viaSave = applyCommand(world, {
      type: "save_design", designId: saved.id,
      design: { ...CORVETTE, nameRu: "Через save 2" },
    });
    expect(viaSave.ok).toBe(true);
    // удаление
    expect(applyCommand(world, { type: "delete_design", designId: saved.id }).ok).toBe(true);
    expect(getCustomDesigns(world, 1).some((entry) => entry.id === saved.id)).toBe(false);
  });

  it("build_ship поддерживает custom designId: очередь → флот с нужным FP", () => {
    const world = fresh();
    withTechs(world);
    const player = world.empires[0];
    player.resources.alloys = 5000;
    // освобождаем стартовые флоты, чтобы лимит флота позволил заказ
    world.fleets = world.fleets.filter((fleet) => fleet.empireId !== 1);
    player.fleets = [];
    const create = applyCommand(world, { type: "create_design", ...CORVETTE });
    expect(create.ok, create.messageRu).toBe(true);
    const design = getCustomDesigns(world, 1)[0];
    const cost = getBuildCost(world, "ship", design.id);
    expect(cost.alloys).toBe(design.costAlloys);
    const build = applyCommand(world, {
      type: "build_ship", systemId: player.capitalSystemId, designId: design.id, count: 1,
    });
    expect(build.ok, build.messageRu).toBe(true);
    const colony = world.colonies.find((c) => c.systemId === player.capitalSystemId && c.empireId === 1)!;
    expect(colony.queue.length).toBe(1);
    for (let i = 0; i < 6; i++) tick(world);
    const ship = world.fleets.flatMap((fleet) => fleet.ships).find((entry) => entry.designId === design.id);
    expect(ship).toBeDefined();
    expect(ship!.fleetPower).toBe(design.fleetPower);
    expect(getDesignById(world, design.id)).toBeDefined();
  });
});

describe("конструктор: save/load и детерминизм", () => {
  it("save → load → save идентичен, дизайны сохраняются", () => {
    const world = fresh();
    withTechs(world);
    applyCommand(world, { type: "create_design", ...CORVETTE });
    const json = serializeWorld(world);
    const loaded = deserializeWorld(json);
    expect(serializeWorld(loaded)).toBe(json);
    expect(loaded.customDesigns.length).toBe(1);
    expect(loaded.customDesigns[0].nameRu).toBe(CORVETTE.nameRu);
    expect(loaded.customDesigns[0].fleetPower).toBe(world.customDesigns[0].fleetPower);
  });

  it("детерминизм: одинаковые команды → идентичный мир", () => {
    const run = (): string => {
      const world = fresh();
      withTechs(world);
      applyCommand(world, { type: "create_design", ...CORVETTE });
      const design = getCustomDesigns(world, 1)[0];
      world.empires[0].resources.alloys = 1000;
      applyCommand(world, { type: "build_ship", systemId: world.empires[0].capitalSystemId, designId: design.id, count: 1 });
      for (let i = 0; i < 5; i++) tick(world);
      return serializeWorld(world);
    };
    expect(run()).toBe(run());
  });
});
