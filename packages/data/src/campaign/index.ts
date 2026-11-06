/** Контент кампании. Заполняется контент-командой; код читает через @sf/data. */
import actsJson from "./acts.json";
import missionsJson from "./missions.json";
import eventsJson from "./events.json";
import anomaliesJson from "./anomalies.json";
import archaeologyJson from "./archaeology.json";
import loreJson from "./lore.json";
import endingsJson from "./endings.json";
import branchesJson from "./branches.json";
import chronicleJson from "./chronicle.json";
import storyScriptJson from "./story-script.json";
import bridgesJson from "./bridges.json";
import type {
  AnomalyDef, ArchaeologyDef, BranchDef, CampaignActDef, CampaignMissionDef, ChronicleChapterDef, EndingDef, LoreDef, NarrativeEventDef, StoryBridgeDef, StoryScriptDef,
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
export const CAMPAIGN_CHRONICLE = chronicleJson as unknown as ChronicleChapterDef[];
/** Литературный сценарий кампании (акты II–V, развилки, 4 директивы, 8 эпилогов). */
export const CAMPAIGN_STORY_SCRIPT = storyScriptJson as unknown as StoryScriptDef;
/** Мостики актов 0→I … IV→V: тексты для журнала/хроники при смене акта. */
export const CAMPAIGN_BRIDGES = (bridgesJson as unknown as { version: number; bridges: StoryBridgeDef[] }).bridges;