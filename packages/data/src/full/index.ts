/** Данные полной игры (M6–M12). Заполняются контент-командой; код читает через @sf/data. */
import traditionsJson from "./traditions.json";
import perksJson from "./perks.json";
import techsExtraJson from "./techs-extra.json";
import megastructuresJson from "./megastructures.json";
import crisesJson from "./crises.json";
import resolutionsJson from "./resolutions.json";
import espionageJson from "./espionage.json";
import modesJson from "./modes.json";
import ethicsJson from "./ethics.json";
import governmentsJson from "./governments.json";
import civicsJson from "./civics.json";
import focusJson from "./focus-goals.json";
import type {
  CivicDef, CouncilResolutionDef, CrisisDef, EspionageOpDef, EthicsDef, FocusGoalDef, GovernmentDef,
  MegastructureDef, ModeDefFull, PerkDef, TechExtraDef, TraditionTreeDef,
} from "./schema";

export * from "./schema";
export const TRADITION_TREES = traditionsJson as unknown as TraditionTreeDef[];
export const PERKS = perksJson as unknown as PerkDef[];
export const TECHS_EXTRA = techsExtraJson as unknown as TechExtraDef[];
export const MEGASTRUCTURES = megastructuresJson as unknown as MegastructureDef[];
export const CRISES = crisesJson as unknown as CrisisDef[];
export const COUNCIL_RESOLUTIONS = resolutionsJson as unknown as CouncilResolutionDef[];
export const ESPIONAGE_OPS = espionageJson as unknown as EspionageOpDef[];
export const MODES = modesJson as unknown as ModeDefFull[];
export const ETHICS = ethicsJson as unknown as EthicsDef[];
export const GOVERNMENTS = governmentsJson as unknown as GovernmentDef[];
export const CIVICS = civicsJson as unknown as CivicDef[];
export const FOCUS_GOALS = focusJson as unknown as FocusGoalDef[];
