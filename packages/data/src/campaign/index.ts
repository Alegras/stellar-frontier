/** Контент кампании. Заполняется контент-командой; код читает через @sf/data. */
import actsJson from "./acts.json";
import missionsJson from "./missions.json";
import eventsJson from "./events.json";
import anomaliesJson from "./anomalies.json";
import archaeologyJson from "./archaeology.json";
import loreJson from "./lore.json";
import endingsJson from "./endings.json";
import branchesJson from "./branches.json";
import type {
  AnomalyDef, ArchaeologyDef, BranchDef, CampaignActDef, CampaignMissionDef, EndingDef, LoreDef, NarrativeEventDef,
} from "./schema";

export * from "./schema";
export const CAMPAIGN_ACTS = actsJson as unknown as CampaignActDef[];
export const CAMPAIGN_MISSIONS = missionsJson as unknown as CampaignMissionDef[];
export const NARRATIVE_EVENTS = eventsJson as unknown as NarrativeEventDef[];
export const ANOMALIES = anomaliesJson as unknown as AnomalyDef[];
export const ARCHAEOLOGY = archaeologyJson as unknown as ArchaeologyDef[];
export const LORE = loreJson as unknown as LoreDef[];
export const ENDINGS = endingsJson as unknown as EndingDef[];
export const BRANCHES = branchesJson as unknown as BranchDef[];
