/**
 * РЕЛИКТОВЫЙ ПРЕДЕЛ в полёте (Часть XIII, docs/13d_relic_sector.md §1.5, §2, §3, §7).
 * Секторные системы приходят из sim (fg.ancients.sector.systems: id/name/x/y/region/faction/poi/
 * hazard/relics/cores). Если они ещё не добавлены в world.systems, собираем синтетический
 * StarSystem для рендера (холодная палитра, аномалии, опасности), не мутируя sim-мир.
 */
import type { AncientsSectorSystem, Planet, PlanetType, Poi, PoiKind, StarSystem, StarType, World } from "@sf/sim";
import { SECTOR_CHORUS, SECTOR_MIST, WARP_RANGE_LY } from "./warp";
import { hash01 } from "./util";

export { SECTOR_MIST, SECTOR_CHORUS };

/** Вариант сцены «Реликтовый Предел» для SystemScene/SystemView. */
export interface SectorVariant {
  sector: true;
  region: string;
  faction: string;
  hazard: string | null;
  /** 0..4 — индикатор опасности (13d §10.2) */
  danger: number;
  stability: number;
  chorusThreat: number;
  /** тактов до волны Хора (0 — нет таймера) */
  chorusWaveIn: number;
  relics: number;
  cores: number;
}

export interface HazardInfo {
  /** ключ нормализованного hazard */
  key: string;
  labelRu: string;
  effectRu: string;
  /** множитель дальности сенсоров (13d §7.5) */
  sensorFactor: number;
  /** служебный цвет тинта сцены */
  tint: string;
  danger: number;
}

/**
 * Таблица опасностей сектора (сокращённо по 13d §7.3): признаки и эффекты для полёта.
 * Ключи — подстроки поля hazard из данных (рус/англ, нижний регистр).
 */
export const HAZARDS: readonly HazardInfo[] = [
  // --- id из packages/data/ancients/hazards.json (точные совпадения)
  { key: "haz_choir_wave", labelRu: "Волна Хора", effectRu: "осада системы, затем гаснет звезда", sensorFactor: 0.3, tint: SECTOR_CHORUS, danger: 3 },
  { key: "haz_call", labelRu: "Зов", effectRu: "HUD искажается, тянет к гнезду; контрмеры: heat sink / молчание / уйти на 25+ св. лет", sensorFactor: 0.4, tint: SECTOR_CHORUS, danger: 3 },
  { key: "haz_anomaly", labelRu: "Аномалия", effectRu: "15% авария, −10% корпуса", sensorFactor: 0.7, tint: "#7A5CFF", danger: 2 },
  { key: "haz_warden", labelRu: "Стражи", effectRu: "испытание или бой (500–2000 FP)", sensorFactor: 1, tint: "#F5C542", danger: 3 },
  { key: "haz_sensor_degradation", labelRu: "Сенсорная деградация", effectRu: "немая звезда гасит сенсоры: карта пуста", sensorFactor: 0.4, tint: SECTOR_MIST, danger: 1 },
  { key: "haz_radiation", labelRu: "Радиация", effectRu: "−30% щита и −5% корпуса без экранирования", sensorFactor: 0.85, tint: "#FF5A5A", danger: 2 },
  { key: "haz_fallen_raid", labelRu: "Рейд Отступников", effectRu: "рейд на форпост (−4 стабильности)", sensorFactor: 1, tint: "#F08A24", danger: 2 },
  { key: "haz_poi_trap", labelRu: "Ловушка POI", effectRu: "скрытая ловушка: 10–25% корпуса, снимается сканом", sensorFactor: 1, tint: "#F08A24", danger: 2 },
  { key: "haz_blackhole_masslock", labelRu: "Масс-лок чёрной дыры", effectRu: "FSD/варп заряжаются вдвое дольше", sensorFactor: 0.7, tint: "#7A5CFF", danger: 3 },
  // --- эвристики по описаниям (если придут другие ключи)
  {
    key: "chorus",
    labelRu: "Хор рядом",
    effectRu: "биомасса Хора, сенсоры −70%, шанс «зова»",
    sensorFactor: 0.3,
    tint: SECTOR_CHORUS,
    danger: 3,
  },
  {
    key: "хор",
    labelRu: "Хор рядом",
    effectRu: "биомасса Хора, сенсоры −70%, шанс «зова»",
    sensorFactor: 0.3,
    tint: SECTOR_CHORUS,
    danger: 3,
  },
  {
    key: "radiation",
    labelRu: "Радиация",
    effectRu: "щит −30% при длительном пребывании",
    sensorFactor: 0.8,
    tint: "#FF5A5A",
    danger: 2,
  },
  {
    key: "радиац",
    labelRu: "Радиация",
    effectRu: "щит −30% при длительном пребывании",
    sensorFactor: 0.8,
    tint: "#FF5A5A",
    danger: 2,
  },
  {
    key: "silent",
    labelRu: "Немая звезда",
    effectRu: "сенсоры −40%, «зов» +1",
    sensorFactor: 0.45,
    tint: SECTOR_MIST,
    danger: 1,
  },
  {
    key: "нем",
    labelRu: "Немая звезда",
    effectRu: "сенсоры −40%, «зов» +1",
    sensorFactor: 0.45,
    tint: SECTOR_MIST,
    danger: 1,
  },
  {
    key: "dead",
    labelRu: "Погасшая звезда",
    effectRu: "нет света, только ИК-подсветка",
    sensorFactor: 0.5,
    tint: "#233A5C",
    danger: 3,
  },
  {
    key: "погас",
    labelRu: "Погасшая звезда",
    effectRu: "нет света, только ИК-подсветка",
    sensorFactor: 0.5,
    tint: "#233A5C",
    danger: 3,
  },
  {
    key: "blackhole",
    labelRu: "Чёрная дыра",
    effectRu: "масса-лок ×2, FSD-отступление +50%",
    sensorFactor: 0.6,
    tint: "#7A5CFF",
    danger: 3,
  },
  {
    key: "gravity",
    labelRu: "Гравитационные искажения",
    effectRu: "аномалии: 15% авария при подходе",
    sensorFactor: 0.7,
    tint: "#7A5CFF",
    danger: 2,
  },
  {
    key: "anomaly",
    labelRu: "Аномальная зона",
    effectRu: "15% авария, −10% корпуса",
    sensorFactor: 0.7,
    tint: "#7A5CFF",
    danger: 2,
  },
  {
    key: "guardian",
    labelRu: "Стражи",
    effectRu: "испытание или бой (2 000 FP)",
    sensorFactor: 1,
    tint: "#F5C542",
    danger: 3,
  },
  {
    key: "отступник",
    labelRu: "Отступники",
    effectRu: "рейды на форпосты",
    sensorFactor: 1,
    tint: "#F08A24",
    danger: 2,
  },
];

/** Нормализованная опасность системы сектора (или null). */
export function hazardInfo(hazard: string | null | undefined): HazardInfo | null {
  if (!hazard) return null;
  const normalized = hazard.toLowerCase();
  for (const info of HAZARDS) if (normalized.includes(info.key)) return info;
  return null;
}

export function sectorState(world: World) {
  const fg = world.fg;
  return fg && fg.ancients ? fg.ancients.sector : null;
}

export function sectorMeta(world: World, systemId: number): AncientsSectorSystem | null {
  const sector = sectorState(world);
  if (!sector || sector.systems.length === 0) return null;
  return sector.systems.find((system) => system.id === systemId) ?? null;
}

export function isSectorSystem(world: World, systemId: number): boolean {
  return sectorMeta(world, systemId) !== null;
}

/** Индикатор опасности 0..4 (13d §10.2): опасность системы + активные угрозы сектора. */
export function sectorDanger(meta: AncientsSectorSystem, sector: { chorusThreat: number; invasion: boolean; discovered: boolean } | null): number {
  let danger = hazardInfo(meta.hazard)?.danger ?? 0;
  if (meta.region.toLowerCase().includes("rift") || meta.region.toLowerCase().includes("разлом")) danger = Math.max(danger, 2);
  if (sector) {
    if (sector.chorusThreat >= 80) danger += 1;
    if (sector.chorusThreat >= 100) danger += 1;
    if (sector.invasion) danger += 1;
  }
  return Math.max(0, Math.min(4, danger));
}

/** Собирает вариант сцены сектора для текущей системы. */
export function sectorVariantFor(world: World, meta: AncientsSectorSystem): SectorVariant {
  const sector = sectorState(world);
  const waveIn = sector && sector.nextWaveTick > 0 ? Math.max(0, sector.nextWaveTick - world.tick) : 0;
  return {
    sector: true,
    region: meta.region,
    faction: meta.faction,
    hazard: meta.hazard,
    danger: sectorDanger(meta, sector),
    stability: sector ? sector.stability : 50,
    chorusThreat: sector ? sector.chorusThreat : 0,
    chorusWaveIn: waveIn,
    relics: meta.relics,
    cores: meta.cores,
  };
}

/** Тип звезды сектора (13d §3.3) — детерминированно от региона/опасности/id. */
export function sectorStarType(meta: AncientsSectorSystem): StarType {
  const hazard = hazardInfo(meta.hazard);
  const key = hazard ? hazard.key : "";
  const region = meta.region.toLowerCase();
  if (key === "dead" || key === "погас") return "blackhole";
  if (key === "radiation" || key === "радиац") return "neutron";
  if (key === "silent" || key === "нем") return "pulsar";
  if (key === "chorus" || key === "хор") return "pulsar";
  if (region.includes("garden") || region.includes("сад")) return "blue";
  if (region.includes("ruin") || region.includes("руин")) return "white";
  if (region.includes("gate") || region.includes("врат")) return "binary";
  if (region.includes("silent") || region.includes("тих")) return "neutron";
  if (region.includes("rift") || region.includes("разлом")) return "pulsar";
  const cold: StarType[] = ["white", "blue", "red", "binary", "neutron"];
  return cold[Math.floor(hash01(meta.id * 131 + 7) * cold.length)] ?? "white";
}

const SECTOR_PLANETS: readonly PlanetType[] = ["arctic", "tundra", "barren", "volcanic", "ocean", "gas_giant"];

/** Паттерн POI сектора: строка из данных → PoiKind + награда (детерминированно). */
function poiKindOf(label: string): PoiKind {
  const value = label.toLowerCase();
  if (value.includes("derelict") || value.includes("облом") || value.includes("заброш")) return "derelict";
  if (value.includes("pirate") || value.includes("пират") || value.includes("chorus") || value.includes("хор")) return "pirate_base";
  if (value.includes("mining") || value.includes("шахт") || value.includes("добыч")) return "mining_platform";
  if (value.includes("research") || value.includes("науч") || value.includes("архив")) return "research_station";
  if (value.includes("trade") || value.includes("торг") || value.includes("ансар")) return "trade_hub";
  return "anomaly";
}

function buildSectorPlanets(meta: AncientsSectorSystem): Planet[] {
  const count = 1 + Math.floor(hash01(meta.id * 17 + 3) * 4);
  const planets: Planet[] = [];
  for (let index = 0; index < count; index++) {
    const type = SECTOR_PLANETS[Math.floor(hash01(meta.id * 31 + index * 7 + 1) * SECTOR_PLANETS.length)] ?? "barren";
    planets.push({
      id: meta.id * 100 + index + 1,
      systemId: meta.id,
      name: meta.name + " " + (index + 1),
      type,
      size: 1 + Math.floor(hash01(meta.id + index * 13) * 5),
      orbit: index + 1,
      orbitRadius: 0,
      habitability: type === "ocean" || type === "tundra" ? 30 : 0,
      deposits: {
        minerals: Math.floor(hash01(meta.id * 3 + index) * 5),
        energy: Math.floor(hash01(meta.id * 5 + index) * 4),
        rare: Math.floor(hash01(meta.id * 7 + index) * 3),
      },
      ownerId: 0,
      colonyId: 0,
      anomaly: "",
      scanned: true,
    });
  }
  return planets;
}

function buildSectorPoi(meta: AncientsSectorSystem): Poi[] {
  return (meta.poi ?? []).map((label, index) => {
    const kind = poiKindOf(label);
    return {
      id: meta.id * 1000 + index + 1,
      kind,
      nameRu: label,
      systemId: meta.id,
      scanned: true,
      rewardCredits: 40 + index * 20,
      rewardScience: kind === "anomaly" ? 25 : 0,
    } satisfies Poi;
  });
}

/**
 * Синтетический StarSystem для сектора: используется рендером, если sim ещё не положил
 * секторные системы в world.systems. Не мутирует мир (кроме чтения).
 */
export function buildSectorStarSystem(world: World, meta: AncientsSectorSystem): StarSystem {
  const playerId = world.playerEmpireId;
  return {
    id: meta.id,
    name: meta.name,
    x: meta.x,
    y: meta.y,
    star: sectorStarType(meta),
    planets: buildSectorPlanets(meta),
    links: [],
    ownerId: 0,
    knownBy: [playerId],
    visibleTo: [playerId],
    poi: buildSectorPoi(meta),
    station: null,
    chokepoint: false,
    hopsFromCapital: 0,
    sector: "relic",
  };
}

/** Галактическая система по id или синтетическая секторная (для входа в L1). */
export function resolveSectorSystem(world: World, systemId: number): StarSystem | null {
  const direct = world.systems.find((system) => system.id === systemId);
  if (direct) return direct;
  const meta = sectorMeta(world, systemId);
  return meta ? buildSectorStarSystem(world, meta) : null;
}

/** Точка появления в секторной системе: на подходе к звезде, лицом к ней. */
export function sectorSpawn(): { position: { x: number; y: number; z: number }; lookAt: { x: number; y: number; z: number } } {
  return { position: { x: 32000, y: 6200, z: 9000 }, lookAt: { x: 0, y: 0, z: 0 } };
}

/**
 * Цели варпа из текущей системы: системы своего слоя в радиусе (60 св. лет по умолчанию).
 * Из галактики в список входит вход в Реликтовый Предел (после открытия сектора),
 * из Предела — системы сектора и «Выход из Предела» (Врата/аварийный варп, id = -1).
 */
export function warpTargetsAround(
  world: World,
  fromSystemId: number,
  rangeLy: number = WARP_RANGE_LY,
): { id: number; name: string; distLy: number; sector: boolean; kind: "star" | "gate" }[] {
  const sector = sectorState(world);
  const currentIsSector = sectorMeta(world, fromSystemId) !== null;
  const targets: { id: number; name: string; distLy: number; sector: boolean; kind: "star" | "gate" }[] = [];

  if (currentIsSector) {
    const current = sectorMeta(world, fromSystemId)!;
    for (const meta of sector?.systems ?? []) {
      if (meta.id === fromSystemId) continue;
      if (!meta.visited && !meta.controlled) {
        // неразведанные системы Предела видны на карте, но варп к ним — после скана
        continue;
      }
      // Внутри Предела sim не проверяет дистанцию (13d §3.5: любые две системы ≤ 2 прыжка);
      // координаты сектора — в своих единицах, поэтому показываем их как «св. лет Предела».
      const distLy = Math.hypot(meta.x - current.x, meta.y - current.y);
      targets.push({ id: meta.id, name: meta.name, distLy, sector: true, kind: "star" });
    }
    targets.push({ id: -1, name: "Выход из Предела (Врата/варп)", distLy: 0, sector: false, kind: "gate" });
    targets.sort((a, b) => a.distLy - b.distLy);
    return targets;
  }

  void rangeLy;
  const current = world.systems.find((system) => system.id === fromSystemId);
  for (const system of world.systems) {
    if (system.id === fromSystemId) continue;
    if (system.sector === "relic") continue;
    const distLy = Math.hypot(system.x - (current?.x ?? 0), system.y - (current?.y ?? 0)) * 10;
    if (distLy <= rangeLy) targets.push({ id: system.id, name: system.name, distLy, sector: false, kind: "star" });
  }
  // Вход в Предел: только после открытия сектора; цель — Врата-1 (sim игнорирует дистанцию для сектора).
  if (sector && sector.discovered) {
    const sectorWorldSystems = world.systems.filter((system) => system.sector === "relic");
    const gateSystem = sectorWorldSystems.find((system) => sector.gates.includes(system.id)) ?? sectorWorldSystems[0];
    // Вход в Предел: sim не проверяет дистанцию для секторных целей, а по канону anchor→Врата-1 ≤ 60 св. лет,
    // поэтому в HUD показываем не «сырые» координаты сектора, а предел радиуса варпа.
    if (gateSystem) {
      const distLy = Math.hypot(gateSystem.x - (current?.x ?? 0), gateSystem.y - (current?.y ?? 0)) * 10;
      targets.push({ id: gateSystem.id, name: "Врата-1 · " + gateSystem.name, distLy: Math.min(rangeLy, Number.isFinite(distLy) ? distLy : rangeLy), sector: true, kind: "star" });
    } else if (sector.systems.length > 0) {
      const gateMeta = sector.systems.find((meta) => sector.gates.includes(meta.id)) ?? sector.systems[0]!;
      const distLy = Math.hypot(gateMeta.x - (current?.x ?? 0), gateMeta.y - (current?.y ?? 0)) * 10;
      targets.push({ id: gateMeta.id, name: "Врата-1 · " + gateMeta.name, distLy: Math.min(rangeLy, Number.isFinite(distLy) ? distLy : rangeLy), sector: true, kind: "star" });
    }
  }
  targets.sort((a, b) => a.distLy - b.distLy);
  return targets;
}
