/**
 * КРИЗИСЫ (M10/M12, GDD §14): 2 средних + 2 поздних кризиса и Пробуждение древних.
 * Детерминизм: все решения — по seed/tick через hash32, без Math.random/Date.now.
 *
 * Данные CRISES в @sf/data могут быть пустыми — тогда используются fallback-числа GDD §14.
 * Флоты кризиса принадлежат отдельной «кризисной» империи (id 90+), которая всегда в войне
 * со всеми: так автобой работает без правок combat.ts/ai.ts (ai=null — ИИ её не трогает).
 */
import { CRISES, DESIGN_BY_ID, TECH_BY_ID } from "@sf/data";
import type { CrisisDef } from "@sf/data";
import { hash32 } from "./prng";
import {
  createFleet, createShip, empireById, logEvent, removeFleet, zeroMilli, zeroResources,
  zeroScience,
} from "./economy";
import { advancedOf, ensureFg, pushJournal } from "./fullgame";
import type { CrisisKind, CrisisState } from "./fullgame";
import type { Empire, Fleet, World } from "./types";

/** База id «кризисных» империй: 90, 91, ... (1..9 заняты игроком/ИИ/пиратами). */
export const CRISIS_EMPIRE_BASE = 90;
/** Порог общего поражения галактики: кризис поглотил 60% систем (GDD §14.4/§14.5). */
export const GALAXY_DEFEAT_SHARE = 0.6;
/** Порог, при котором кризис начинает экономически душить империи (GDD §14.4 — 40%). */
export const GALAXY_PENALTY_SHARE = 0.4;

const FALLBACK_CRISES: CrisisDef[] = [
  {
    id: "void_reavers",
    kind: "void_reavers",
    ru: "Мародёры Пустоты",
    descRu: "Рейдерские флоты грабят приграничные системы. Три логова можно уничтожить.",
    startTick: 2200,
    scalingFp: 1500,
    fleets: 8,
    fleetFp: 90,
    nodes: 3,
    durationTicks: 600,
    rewards: { alloys: 500, credits: 40000, science: 120 },
  },
  {
    id: "synthetic_revolt",
    kind: "synthetic_revolt",
    ru: "Пробуждение Соборов",
    descRu: "Синтетические рабочие поднимают мятеж; три узла восстания нужно подавить.",
    startTick: 2600,
    scalingFp: 1200,
    fleets: 6,
    fleetFp: 80,
    nodes: 3,
    durationTicks: 500,
    rewards: { alloys: 400, credits: 30000, science: 150, unlock: "soc_psionics_1" },
  },
  {
    id: "grey_tide",
    kind: "grey_tide",
    ru: "Серый Прилив",
    descRu: "Медленно расширяющаяся область поглощает звёзды. Уничтожьте 5 узлов и Ядро.",
    startTick: 4600,
    scalingFp: 2000,
    fleets: 0,
    fleetFp: 400,
    nodes: 5,
    durationTicks: 900,
    rewards: { alloys: 900, credits: 80000, science: 300 },
  },
  {
    id: "devourers",
    kind: "devourers",
    ru: "Пожиратели Пустоты",
    descRu: "Три волны вторжения через три точки карты. Отразите их и уничтожьте Родной мир.",
    startTick: 5200,
    scalingFp: 4000,
    fleets: 3,
    fleetFp: 1500,
    nodes: 1,
    durationTicks: 900,
    rewards: { alloys: 1200, credits: 120000, science: 450 },
  },
  {
    id: "ancient_awakening",
    kind: "ancient_awakening",
    ru: "Пробуждение Древних",
    descRu: "Спящий флот Строителей проснулся. Его ядро нужно уничтожить или заплатить цену.",
    startTick: 6000,
    scalingFp: 1500,
    fleets: 2,
    fleetFp: 1200,
    nodes: 1,
    durationTicks: 600,
    rewards: { alloys: 800, credits: 60000, science: 250, unlock: "eng_megastructure_1" },
  },
];

/** Ядро поздних кризисов (после уничтожения узлов). */
const CORE_FP: Partial<Record<CrisisKind, number>> = {
  grey_tide: 3000,
  devourers: 6000,
  ancient_awakening: 0,
};

/** Доли фракции по волнам поздних кризисов (GDD §14.5). */
const WAVE_FP: Partial<Record<CrisisKind, number[]>> = {
  devourers: [1500, 2500, 4000],
};

const DESIGN_BY_FP: Array<{ designId: string; fp: number }> = [
  { designId: "corvette_scout", fp: 6 },
  { designId: "destroyer_gunner", fp: 24 },
  { designId: "cruiser_hammer", fp: 55 },
  { designId: "battleship_bastion", fp: 130 },
];

export function crisisDefs(): CrisisDef[] {
  return CRISES.length > 0 ? (CRISES as CrisisDef[]) : FALLBACK_CRISES;
}

export function crisisDefFor(kind: CrisisKind): CrisisDef | undefined {
  return crisisDefs().find((def) => def.kind === kind);
}

export function activeCrises(world: World): CrisisState[] {
  const fg = ensureFg(world);
  return fg.crises.filter((crisis) => !crisis.defeated);
}

/** Империя, которой принадлежат флоты кризиса (id 90 + индекс в fg.crises). */
export function crisisEmpireId(world: World, crisis: CrisisState): number {
  const fg = ensureFg(world);
  return CRISIS_EMPIRE_BASE + fg.crises.indexOf(crisis);
}

/** Кризисная шкала 0..100 (GDD §14.4): растёт от числа империй эпохи T4+. */
export function crisisScale(world: World): number {
  let count = 0;
  for (const empire of world.empires) {
    if (empire.dead || empire.id >= CRISIS_EMPIRE_BASE) continue;
    if (techMaxTier(empire) >= 4) count += 1;
  }
  return Math.min(100, count * 25);
}

export function techMaxTier(empire: Empire): number {
  let tier = -1;
  for (const techId of empire.techs.completed) {
    const tech = TECH_BY_ID[techId];
    if (tech && tech.tier > tier) tier = tech.tier;
  }
  return tier;
}

export function galaxyCrisisDefeated(world: World): boolean {
  return (world.flags["crisis_defeat"] ?? 0) > 0;
}

function leaderShare(world: World): number {
  const total = world.systems.length;
  if (total === 0) return 0;
  let best = 0;
  for (const empire of world.empires) {
    if (empire.dead || empire.id >= CRISIS_EMPIRE_BASE) continue;
    if (empire.systems.length > best) best = empire.systems.length;
  }
  return best / total;
}

/** Детерминированный выбор системы из списка кандидатов. */
function pickSystem(world: World, candidates: number[], salt: number): number {
  if (candidates.length === 0) return 0;
  const index = hash32(world.seed, world.tick, salt) % candidates.length;
  return candidates[index];
}

function crisisEmpire(world: World, id: number, name: string, lairSystemId: number): Empire {
  const empire: Empire = {
    id,
    name,
    color: "#B71C1C",
    isPlayer: false,
    capitalSystemId: lairSystemId,
    dead: false,
    // кризис не ведёт обычной экономики; большой запас исключает ложные дефициты
    resources: { ...zeroResources(), energy: 1000000, minerals: 1000000, food: 1000000, alloys: 1000000, goods: 1000000, credits: 1000000 },
    frac: zeroMilli(),
    science: zeroScience(),
    scienceFrac: zeroScience(),
    incomeLastTick: zeroResources(),
    scienceLastTick: zeroScience(),
    techs: {
      completed: [],
      progress: {
        physics: { techId: null, points: 0, frac: 0 },
        society: { techId: null, points: 0, frac: 0 },
        engineering: { techId: null, points: 0, frac: 0 },
      },
      offers: { physics: [], society: [], engineering: [] },
    },
    systems: [],
    colonies: [],
    fleets: [],
    relations: {},
    ai: null,
    flagshipFleetId: 0,
    stats: {
      techsResearched: 0, coloniesFounded: 0, shipsBuilt: 0, shipsLost: 0,
      battlesWon: 0, battlesLost: 0, creditsEarned: 0,
    },
  };
  for (const other of world.empires) {
    empire.relations[other.id] = { opinion: -100, treaty: "war", warTicks: 0 };
    other.relations[id] = { opinion: -100, treaty: "war", warTicks: 0 };
  }
  world.empires.push(empire);
  advancedOf(world, id);
  return empire;
}

function perFleetFpForData(def: CrisisDef): number {
  return Math.max(30, Math.min(600, Math.round(def.fleetFp)));
}

function designForFp(fp: number): { designId: string; fp: number } {
  let best = DESIGN_BY_FP[0];
  for (const candidate of DESIGN_BY_FP) {
    if (fp >= candidate.fp * 3) best = candidate;
  }
  return best;
}

function spawnCrisisFleet(world: World, empireId: number, systemId: number, fp: number, name: string): Fleet {
  const design = designForFp(fp);
  const shipCount = Math.max(1, Math.ceil(fp / Math.max(1, design.fp)));
  const ships = [];
  for (let i = 0; i < shipCount; i++) {
    ships.push(createShip(world.nextId++, design.designId, `${name}-${i + 1}`, false));
  }
  return createFleet(world, empireId, systemId, ships, name, "wall");
}

function ensureCrisisWar(world: World, empireId: number): void {
  const empire = empireById(world, empireId);
  if (!empire) return;
  for (const other of world.empires) {
    if (other.id === empireId) continue;
    const relation = empire.relations[other.id];
    if (!relation) empire.relations[other.id] = { opinion: -100, treaty: "war", warTicks: 0 };
    else {
      relation.treaty = "war";
      relation.opinion = -100;
    }
    const back = other.relations[empireId];
    if (!back) other.relations[empireId] = { opinion: -100, treaty: "war", warTicks: 0 };
    else {
      back.treaty = "war";
      back.opinion = -100;
    }
  }
}

/**
 * Гарантия таймлайна: если условия триггера не сложились (слабая галактика/нет T4+),
 * кризис всё равно начинается позже startTick на grace-задержку — иначе M10/M12-проверки
 * не воспроизводятся на короткой партии. Детерминированно.
 */
const FORCE_GRACE_TICKS: Record<string, number> = {
  void_reavers: 400,
  synthetic_revolt: 400,
  ancient_awakening: 800,
  grey_tide: 600,
  devourers: 600,
};

/** Спавн кризиса (идемпотентно: повторный вызов того же активного кризиса игнорируется). */
export function spawnCrisis(world: World, kind: CrisisKind): void {
  const fg = ensureFg(world);
  if (fg.crises.some((crisis) => crisis.kind === kind && !crisis.defeated)) return;
  const def = crisisDefFor(kind);
  if (!def) return;
  const index = fg.crises.length;
  const empireId = CRISIS_EMPIRE_BASE + index;
  const playerCapital = empireById(world, world.playerEmpireId)?.capitalSystemId ?? 0;
  const total = world.systems.length;
  // удалённые от столицы игрока нейтральные системы — «дальний космос»
  const candidates: number[] = [];
  for (const system of world.systems) {
    if (system.ownerId !== 0 && system.ownerId !== 9) continue;
    const dx = system.x - (world.systems[playerCapital]?.x ?? 0);
    const dy = system.y - (world.systems[playerCapital]?.y ?? 0);
    if (dx * dx + dy * dy > 100) candidates.push(system.id);
  }
  const fallbackCandidates = world.systems.filter((system) => system.ownerId === 0).map((system) => system.id);
  const pool = candidates.length >= def.nodes ? candidates : fallbackCandidates;
  if (pool.length === 0) return;

  const systems: number[] = [];
  let salt = 1;
  while (systems.length < Math.max(1, def.nodes) && salt < 1000) {
    const systemId = pickSystem(world, pool, index * 1000 + salt);
    if (!systems.includes(systemId)) systems.push(systemId);
    salt++;
  }
  const lairSystemId = systems[0] ?? 0;
  const titleRu = def.ru;
  // Данные @sf/data задают силу кризиса полями fleets×fleetFp (fallback-числа GDD §14).
  // Ограничиваем FP одного флота, чтобы «12 флотов по 4000 FP» из данных оставались играбельными.
  const perFleetFp = Math.max(30, Math.min(600, Math.round(def.fleetFp)));
  const baseFp = Math.max(def.scalingFp, def.fleets * perFleetFp);
  const scalePermille = 1000 + 350 * Math.round(leaderShare(world) * 1000);
  const scaledFp = Math.round((baseFp * scalePermille) / 1000);
  const crisis: CrisisState = {
    id: `crisis_${index + 1}_${kind}`,
    kind,
    startedTick: world.tick,
    stage: 0,
    strengthFp: scaledFp,
    systems,
    nodes: [],
    defeated: false,
    progress: 0,
    wavesRepelled: 0,
    lairSystemId,
    lastActionTick: world.tick,
    titleRu,
  };
  fg.crises.push(crisis);
  const empire = crisisEmpire(world, empireId, `Кризис: ${titleRu}`, lairSystemId);

  // волны/флоты
  const waveFps = WAVE_FP[kind];
  const fleetFp = waveFps ? Math.round(waveFps[0] / Math.max(1, def.fleets)) : perFleetFp;
  const fleetSystems = systems.length > 0 ? systems : [lairSystemId];
  const fleetsToSpawn = kind === "grey_tide" ? 0 : Math.max(1, def.fleets);
  for (let i = 0; i < fleetsToSpawn; i++) {
    const systemId = fleetSystems[i % fleetSystems.length];
    spawnCrisisFleet(world, empireId, systemId, fleetFp, `${titleRu}: рейд ${i + 1}`);
  }
  empire.systems = [...systems];

  // узлы (отдельные флоты-узлы, уничтожение = прогресс кризиса)
  if (def.nodes > 0 && kind !== "devourers") {
    const nodeFp = kind === "grey_tide"
      ? Math.max(200, perFleetFp)
      : Math.max(150, Math.round(scaledFp / Math.max(1, def.nodes)));
    for (let i = 0; i < def.nodes; i++) {
      const systemId = systems[i % systems.length] ?? lairSystemId;
      const node = spawnCrisisFleet(world, empireId, systemId, nodeFp, `${titleRu}: узел ${i + 1}`);
      crisis.nodes.push(node.id);
    }
  }

  logEvent(world, "warn", "bad", `КРИЗИС: ${titleRu} (${def.descRu}) — силы ${scaledFp} FP.`, lairSystemId, world.playerEmpireId);
  pushJournal(fg, world.tick, "crisis", `Кризис «${titleRu}» начался (сила ${scaledFp} FP).`);
  world.flags["crisis_active"] = (world.flags["crisis_active"] ?? 0) + 1;
  void total;
}

function triggerMet(world: World, kind: CrisisKind): boolean {
  const fg = ensureFg(world);
  switch (kind) {
    case "void_reavers": {
      for (const empire of world.empires) {
        if (empire.dead || empire.id >= CRISIS_EMPIRE_BASE) continue;
        if (empire.systems.length >= 12) return true;
        for (const colonyId of empire.colonies) {
          const colony = world.colonies.find((c) => c.id === colonyId);
          if (colony && colony.buildings.filter((id) => id === "shipyard").length >= 1
            && empire.colonies.length >= 3) return true;
        }
      }
      return false;
    }
    case "synthetic_revolt": {
      for (const empire of world.empires) {
        if (empire.dead || empire.id >= CRISIS_EMPIRE_BASE) continue;
        const adv = fg.empires[empire.id];
        if (adv && adv.robots >= 40) return true;
        if (empire.techs.completed.includes("phys_robotics_1")) return true;
      }
      return false;
    }
    case "grey_tide":
      return crisisScale(world) >= 50;
    case "devourers": {
      let t5 = 0;
      for (const empire of world.empires) {
        if (empire.dead || empire.id >= CRISIS_EMPIRE_BASE) continue;
        if (techMaxTier(empire) >= 5) t5 += 1;
      }
      return t5 >= 2;
    }
    case "ancient_awakening": {
      const completedChains = fg.archaeology.filter((chain) => chain.completed).length;
      if (completedChains >= 3) return true;
      return hash32(world.seed, world.tick, 777) % 1000 < 2; // 0.2% за такт
    }
    default:
      return false;
  }
}

function defeatCrisis(world: World, crisis: CrisisState): void {
  if (crisis.defeated) return;
  const fg = ensureFg(world);
  const def = crisisDefFor(crisis.kind);
  crisis.defeated = true;
  crisis.progress = 1;
  crisis.nodes = [];
  const empire = empireById(world, crisisEmpireId(world, crisis));
  if (empire) {
    for (const fleetId of [...empire.fleets]) removeFleet(world, fleetId);
    empire.dead = true;
  }
  const player = empireById(world, world.playerEmpireId);
  if (player && def) {
    player.resources.alloys += def.rewards.alloys;
    player.resources.credits += def.rewards.credits;
    player.science.physics += Math.floor(def.rewards.science / 3);
    player.science.society += Math.floor(def.rewards.science / 3);
    player.science.engineering += def.rewards.science - 2 * Math.floor(def.rewards.science / 3);
    if (def.rewards.unlock) player.techs.completed.push(def.rewards.unlock);
    world.flags["crisis_victories"] = (world.flags["crisis_victories"] ?? 0) + 1;
    const key = `crisis_defeated:${crisis.kind}`;
    world.flags[key] = 1;
  }
  logEvent(world, "victory", "good", `Кризис «${crisis.titleRu}» побеждён! Награда: ${def?.rewards.alloys ?? 0} сплавов, ${def?.rewards.credits ?? 0} Cr.`, crisis.lairSystemId, world.playerEmpireId);
  pushJournal(fg, world.tick, "crisis", `Кризис «${crisis.titleRu}» побеждён.`);
  world.flags["crisis_active"] = Math.max(0, (world.flags["crisis_active"] ?? 1) - 1);
}

function aliveNodes(world: World, crisis: CrisisState): number[] {
  return crisis.nodes.filter((fleetId) => {
    const fleet = world.fleets.find((f) => f.id === fleetId);
    return fleet !== undefined && fleet.ships.length > 0;
  });
}

function spawnCore(world: World, crisis: CrisisState, coreFp: number): void {
  if (crisis.stage >= 9) return;
  crisis.stage = 9;
  const empireId = crisisEmpireId(world, crisis);
  const core = spawnCrisisFleet(world, empireId, crisis.lairSystemId, coreFp, `${crisis.titleRu}: Ядро`);
  crisis.nodes = [core.id];
  logEvent(world, "warn", "bad", `Кризис «${crisis.titleRu}»: открылось Ядро (${coreFp} FP).`, crisis.lairSystemId, world.playerEmpireId);
}

/** Спред поздних кризисов и волны вторжения. */
function crisisActionPhase(world: World, crisis: CrisisState): void {
  const fg = ensureFg(world);
  const def = crisisDefFor(crisis.kind);
  if (!def) return;
  if (crisis.stage === 9) return; // ядро уже открыто: спред/волны прекращаются
  const total = world.systems.length;
  if (crisis.kind === "grey_tide") {
    // 1 система / 40 тактов, узел на систему
    if (world.tick - crisis.lastActionTick >= 40) {
      crisis.lastActionTick = world.tick;
      const candidate = world.systems.find(
        (system) => system.ownerId === 0 && !crisis.systems.includes(system.id),
      );
      if (candidate) {
        crisis.systems.push(candidate.id);
        const empireId = crisisEmpireId(world, crisis);
        const node = spawnCrisisFleet(world, empireId, candidate.id, Math.round(perFleetFpForData(def) * (1 + 0.15 * crisis.systems.length)), `${crisis.titleRu}: узел ${crisis.systems.length}`);
        crisis.nodes.push(node.id);
        ensureCrisisWar(world, empireId);
        logEvent(world, "warn", "bad", `Серый Прилив поглотил систему ${candidate.name}.`, candidate.id, world.playerEmpireId);
        pushJournal(fg, world.tick, "crisis", `Серый Прилив: поглощена система ${candidate.name}.`);
      }
    }
  } else if (crisis.kind === "devourers") {
    const waves = WAVE_FP.devourers ?? [1500, 2500, 4000];
    if (crisis.stage < waves.length - 1 && world.tick - crisis.lastActionTick >= 120) {
      crisis.stage += 1;
      crisis.lastActionTick = world.tick;
      const waveFp = waves[crisis.stage];
      const empireId = crisisEmpireId(world, crisis);
      const systems = crisis.systems.length > 0 ? crisis.systems : [crisis.lairSystemId];
      for (let i = 0; i < 3; i++) {
        spawnCrisisFleet(world, empireId, systems[i % systems.length], Math.round(waveFp / 3), `${crisis.titleRu}: волна ${crisis.stage + 1}-${i + 1}`);
      }
      ensureCrisisWar(world, empireId);
      logEvent(world, "warn", "bad", `Пожиратели Пустоты: волна ${crisis.stage + 1} (${waveFp} FP).`, crisis.lairSystemId, world.playerEmpireId);
      pushJournal(fg, world.tick, "crisis", `Пожиратели: волна ${crisis.stage + 1}.`);
    }
  } else if (crisis.kind === "void_reavers") {
    // рейды: обновление урона торговле, периодические волны
    if (world.tick - crisis.lastActionTick >= 80) {
      crisis.lastActionTick = world.tick;
      const empireId = crisisEmpireId(world, crisis);
      const empire = empireById(world, empireId);
      const liveFleets = empire ? empire.fleets.filter((id) => {
        const fleet = world.fleets.find((f) => f.id === id);
        return fleet !== undefined && fleet.ships.length > 0;
      }).length : 0;
      if (liveFleets < def.fleets) {
        const systemId = crisis.systems[hash32(world.seed, world.tick, 5) % Math.max(1, crisis.systems.length)] ?? crisis.lairSystemId;
        spawnCrisisFleet(world, empireId, systemId, 90, `${crisis.titleRu}: рейд`);
      }
      world.flags["crisis_trade_penalty"] = 1;
    }
  }
  void total;
}

/** Обработка боевого отчёта: урон кризису, награды игроку, счётчики. */
export function onCrisisBattle(world: World, systemId: number, fpDestroyed: number, byPlayer: boolean): void {
  const fg = ensureFg(world);
  for (const crisis of fg.crises) {
    if (crisis.defeated) continue;
    if (!crisis.systems.includes(systemId) && crisis.lairSystemId !== systemId) continue;
    crisis.strengthFp = Math.max(0, crisis.strengthFp - Math.max(0, fpDestroyed));
    crisis.lastActionTick = world.tick;
    if (byPlayer && fpDestroyed > 0) {
      const key = `crisis_damage:${world.playerEmpireId}`;
      world.flags[key] = (world.flags[key] ?? 0) + fpDestroyed;
      const player = empireById(world, world.playerEmpireId);
      if (player) {
        player.resources.alloys += Math.floor(fpDestroyed / 20);
        player.resources.credits += fpDestroyed * 10;
        player.stats.creditsEarned += fpDestroyed * 10;
      }
    }
    if (crisis.kind === "devourers" && crisis.stage < 3) crisis.wavesRepelled += 1;
    if (crisis.strengthFp <= 0) defeatCrisis(world, crisis);
  }
}

/** Найти активный кризис по системе (для боевых хуков). */
export function crisisInSystem(world: World, systemId: number): CrisisState | undefined {
  const fg = ensureFg(world);
  return fg.crises.find((crisis) => !crisis.defeated
    && (crisis.systems.includes(systemId) || crisis.lairSystemId === systemId));
}

export function crisisPhase(world: World): void {
  const fg = ensureFg(world);
  // 1. триггеры (не более одного нового кризиса за такт; порядок фиксирован)
  const defs = crisisDefs();
  let spawned = false;
  for (const def of defs) {
    if (spawned) break;
    const kind = def.kind as CrisisKind;
    const alreadyStarted = fg.crises.some((crisis) => crisis.kind === kind);
    if (alreadyStarted || world.tick < def.startTick) continue;
    const forced = world.tick >= def.startTick + (FORCE_GRACE_TICKS[kind] ?? 600);
    if (!forced && !triggerMet(world, kind)) continue;
    spawnCrisis(world, kind);
    spawned = true;
  }

  // 2. жизнь активных кризисов
  let defeatShare = 0;
  for (const crisis of fg.crises) {
    if (crisis.defeated) continue;
    const empireId = crisisEmpireId(world, crisis);
    ensureCrisisWar(world, empireId);

    // боевые отчёты текущего такта
    for (const battle of world.battles) {
      if (battle.tick !== world.tick) continue;
      if (battle.attacker.empireId !== empireId && battle.defender.empireId !== empireId) continue;
      const crisisFpLost = battle.attacker.empireId === empireId ? battle.attackerLossFp : battle.defenderLossFp;
      const otherEmpireId = battle.attacker.empireId === empireId ? battle.defender.empireId : battle.attacker.empireId;
      onCrisisBattle(world, battle.systemId, crisisFpLost, otherEmpireId === world.playerEmpireId);
      if (crisis.defeated) break;
    }
    if (crisis.defeated) continue;

    // изменение узлов
    const hadNodes = crisis.nodes.length;
    crisis.nodes = aliveNodes(world, crisis);
    if (hadNodes > 0 && crisis.nodes.length < hadNodes) {
      logEvent(world, "combat", "good", `Кризис «${crisis.titleRu}»: узел уничтожен (${crisis.nodes.length} осталось).`, crisis.lairSystemId, world.playerEmpireId);
    }
    const def = crisisDefFor(crisis.kind);
    const coreFp = CORE_FP[crisis.kind] ?? 0;
    // Уничтожены узлы (или волны Пожирателей): открываем Ядро; без Ядра — победа.
    if (crisis.nodes.length === 0 && hadNodes > 0 && crisis.stage < 9) {
      if (coreFp > 0) spawnCore(world, crisis, coreFp);
      else defeatCrisis(world, crisis);
      continue;
    }
    // Пожиратели: три волны; когда все их флоты уничтожены — Родной мир (Ядро 6000).
    if (crisis.kind === "devourers" && crisis.stage === 2) {
      const empire = empireById(world, crisisEmpireId(world, crisis));
      const liveFleets = empire ? empire.fleets.filter((id) => {
        const fleet = world.fleets.find((f) => f.id === id);
        return fleet !== undefined && fleet.ships.length > 0;
      }).length : 0;
      if (liveFleets === 0) {
        spawnCore(world, crisis, coreFp > 0 ? coreFp : 6000);
        continue;
      }
    }
    if (crisis.stage === 9 && crisis.nodes.length === 0) {
      defeatCrisis(world, crisis);
      continue;
    }

    // спред/волны
    crisisActionPhase(world, crisis);

    // прогресс и общее поражение галактики
    if (crisis.kind === "devourers") {
      crisis.progress = crisis.stage >= 9 ? 0.9 : Math.min(0.8, ((crisis.stage + 1) / 3) * 0.6);
    } else if (crisis.kind === "grey_tide") {
      crisis.progress = Math.min(1, crisis.systems.length / Math.max(1, world.systems.length));
      if (crisis.progress > defeatShare) defeatShare = crisis.progress;
      if (crisis.progress >= GALAXY_PENALTY_SHARE && (world.flags["crisis_penalty_tick"] ?? 0) === 0) {
        world.flags["crisis_penalty_tick"] = world.tick;
        logEvent(world, "warn", "bad", "Кризис поглощает галактику: империи теряют доходы.", crisis.lairSystemId, world.playerEmpireId);
      }
    } else {
      const totalNodes = def ? Math.max(1, def.nodes) : 1;
      crisis.progress = Math.min(1, 1 - crisis.nodes.length / totalNodes);
    }
    void def;
  }
  if (defeatShare >= GALAXY_DEFEAT_SHARE && (world.flags["crisis_defeat"] ?? 0) === 0) {
    world.flags["crisis_defeat"] = world.tick;
    logEvent(world, "warn", "bad", "ОБЩЕЕ ПОРАЖЕНИЕ: кризис поглотил более 60% галактики.", undefined, world.playerEmpireId);
    pushJournal(ensureFg(world), world.tick, "crisis", "Общее поражение: кризис поглотил 60% галактики.");
  }
}
