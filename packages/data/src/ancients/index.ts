/** Часть XIII · данные Древних, рас и Реликтового Предела. */
import racesJson from "./races.json";
import traitsJson from "./traits.json";
import techsJson from "./techs.json";
import questsJson from "./quests.json";
import codexJson from "./codex.json";
import factionsJson from "./factions.json";
import poisJson from "./pois.json";
import regionsJson from "./regions.json";
import hazardsJson from "./hazards.json";
import endingsJson from "./endings.json";
import namesJson from "./names.json";
import sectorMegastructuresJson from "./sector-megastructures.json";
import archaeologyChainsJson from "./archaeology-chains.json";
import wardenTrialsJson from "./warden-trials.json";
import relicShipsJson from "./relic-ships.json";
import sectorEventsJson from "./sector-events.json";
import type {
  AncientsBundle, AncientsEndingDef, AncientsQuestDef, AncientsTechDef,
  ArchaeologyChainDef, CodexEntryDef, RaceDef, RaceTraitDef, RelicShipDef,
  SectorEventDef, SectorFactionDef, SectorHazardDef, SectorMegastructureDef,
  SectorNameBank, SectorPoiDef, SectorRegionDef, WardenTrialDef,
} from "./schema";

export * from "./schema";
export const RACES = racesJson as unknown as RaceDef[];
export const RACE_TRAITS = traitsJson as unknown as RaceTraitDef[];
export const ANCIENTS_TECHS = techsJson as unknown as AncientsTechDef[];
export const ANCIENTS_QUESTS = questsJson as unknown as AncientsQuestDef[];
export const ANCIENTS_CODEX = codexJson as unknown as CodexEntryDef[];
export const SECTOR_FACTIONS = factionsJson as unknown as SectorFactionDef[];
export const SECTOR_POIS = poisJson as unknown as SectorPoiDef[];
export const SECTOR_REGIONS = regionsJson as unknown as SectorRegionDef[];
export const SECTOR_HAZARDS = hazardsJson as unknown as SectorHazardDef[];
export const ANCIENTS_ENDINGS = endingsJson as unknown as AncientsEndingDef[];
export const SECTOR_NAMES = namesJson as unknown as SectorNameBank;
/** Расширение Части XIII (опциональные массивы): объекты и события Предела. */
export const SECTOR_MEGASTRUCTURES = sectorMegastructuresJson as unknown as SectorMegastructureDef[];
export const ARCHAEOLOGY_CHAINS = archaeologyChainsJson as unknown as ArchaeologyChainDef[];
export const WARDEN_TRIALS = wardenTrialsJson as unknown as WardenTrialDef[];
export const RELIC_SHIPS = relicShipsJson as unknown as RelicShipDef[];
export const SECTOR_EVENTS = sectorEventsJson as unknown as SectorEventDef[];

export const RACE_BY_ID: Record<string, RaceDef> = Object.fromEntries(RACES.map((r) => [r.id, r]));
export const RACE_TRAIT_BY_ID: Record<string, RaceTraitDef> = Object.fromEntries(RACE_TRAITS.map((t) => [t.id, t]));
export const ANCIENT_TECH_BY_ID: Record<string, AncientsTechDef> = Object.fromEntries(ANCIENTS_TECHS.map((t) => [t.id, t]));
export const ANCIENTS_QUEST_BY_ID: Record<string, AncientsQuestDef> = Object.fromEntries(ANCIENTS_QUESTS.map((q) => [q.id, q]));
export const CODEX_BY_ID: Record<string, CodexEntryDef> = Object.fromEntries(ANCIENTS_CODEX.map((c) => [c.id, c]));
export const SECTOR_FACTION_BY_ID: Record<string, SectorFactionDef> = Object.fromEntries(SECTOR_FACTIONS.map((f) => [f.id, f]));
export const SECTOR_POI_BY_ID: Record<string, SectorPoiDef> = Object.fromEntries(SECTOR_POIS.map((p) => [p.id, p]));
export const SECTOR_MEGASTRUCTURE_BY_ID: Record<string, SectorMegastructureDef> = Object.fromEntries(SECTOR_MEGASTRUCTURES.map((m) => [m.id, m]));
export const ARCHAEOLOGY_CHAIN_BY_ID: Record<string, ArchaeologyChainDef> = Object.fromEntries(ARCHAEOLOGY_CHAINS.map((a) => [a.id, a]));
export const WARDEN_TRIAL_BY_ID: Record<string, WardenTrialDef> = Object.fromEntries(WARDEN_TRIALS.map((t) => [t.id, t]));
export const RELIC_SHIP_BY_ID: Record<string, RelicShipDef> = Object.fromEntries(RELIC_SHIPS.map((s) => [s.id, s]));
export const SECTOR_EVENT_BY_ID: Record<string, SectorEventDef> = Object.fromEntries(SECTOR_EVENTS.map((e) => [e.id, e]));
export const ANCIENTS_BUNDLE: AncientsBundle = {
  races: RACES, traits: RACE_TRAITS, techs: ANCIENTS_TECHS, quests: ANCIENTS_QUESTS,
  codex: ANCIENTS_CODEX, factions: SECTOR_FACTIONS, pois: SECTOR_POIS,
  regions: SECTOR_REGIONS, names: SECTOR_NAMES, hazards: SECTOR_HAZARDS, endings: ANCIENTS_ENDINGS,
  sectorMegastructures: SECTOR_MEGASTRUCTURES,
  archaeologyChains: ARCHAEOLOGY_CHAINS,
  wardenTrials: WARDEN_TRIALS,
  relicShips: RELIC_SHIPS,
  sectorEvents: SECTOR_EVENTS,
};
