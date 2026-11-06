/** Схемы контента кампании (M9): акты, миссии, события, аномалии, археология, лор, концовки. */
import type { ResourceId, ScienceId } from "../schema";

export interface CampaignActDef {
  id: number;
  ru: string;
  startTick: number;
  endTick: number;
  summaryRu: string;
}

export interface MissionObjectiveDef {
  id: string;
  type: string;
  targetSystemId?: number;
  targetKind?: string;
  count?: number;
  timeLimitTicks?: number;
}

export interface CampaignMissionDef {
  id: string;
  act: number;
  titleRu: string;
  briefingRu: string;
  giver: string;
  branchRequired: string | null;
  secret: boolean;
  objectives: MissionObjectiveDef[];
  rewards: {
    credits?: number;
    alloys?: number;
    influence?: number;
    science?: Partial<Record<ScienceId, number>>;
    reputation?: number;
    unlock?: string;
    flag?: string;
  };
  prerequisites?: string[];
  branch?: string;
  ending?: string;
  weight: number;
}

export interface EventChoiceDef {
  id: string;
  labelRu: string;
  effects: { target: string; value: number }[];
  flag?: string;
  missionId?: string;
}

export interface NarrativeEventDef {
  id: string;
  chainId: string;
  step: number;
  titleRu: string;
  textRu: string;
  choices: EventChoiceDef[];
  weight: number;
  minAct?: number;
  conditions?: { kind: string; target?: string; value?: number }[];
}

export interface AnomalyDef {
  id: string;
  titleRu: string;
  textRu: string;
  kind: "anomaly" | "archaeology" | "derelict" | "silent_star";
  chainId: string | null;
  steps: number;
  rewardCredits: number;
  rewardScience: number;
  artifact: boolean;
  weight: number;
}

export interface ArchaeologyDef {
  chainId: string;
  titleRu: string;
  steps: number;
  descRu: string;
  reward: { credits: number; alloys: number; science: number; unlock?: string };
  artifact: boolean;
}

export interface LoreDef {
  id: string;
  titleRu: string;
  textRu: string;
  category: string;
  unlockCondition: string;
}

export interface EndingDef {
  id: string;
  ru: string;
  descRu: string;
  condition: string;
  branch: string | null;
  secret: boolean;
}

export interface BranchDef {
  id: string;
  ru: string;
  descRu: string;
  missions: string[];
  ending: string;
  effects: Record<string, number>;
}

export interface ChronicleChapterDef {
  id: string;
  titleRu: string;
  paragraphs: string[];
  /** акт, с которого глава доступна; 99 — только после концовки */
  unlockAct: number;
  requiresEnding?: boolean;
}

export interface CampaignBundle {
  acts: CampaignActDef[];
  missions: CampaignMissionDef[];
  events: NarrativeEventDef[];
  anomalies: AnomalyDef[];
  archaeology: ArchaeologyDef[];
  lore: LoreDef[];
  endings: EndingDef[];
  branches: BranchDef[];
  chronicle: ChronicleChapterDef[];
}
// ===== Часть XIV/DLC: литературный сценарий кампании (акты II–V) =====
export interface StoryRelationDef {
  /** CharacterDef.id: admiral_kain | counselor_selen | teira_os | kira7 */
  target: string;
  delta: number;
}

export interface StoryOptionDef {
  id: string;
  titleRu: string;
  /** действие/развитие событий (что делает игрок) */
  directRu?: string;
  /** реакции команды/последствия (несколько абзацев) */
  effectsRu?: string[];
  /** итог/смысл/посвящение */
  outcomeRu?: string;
  flags: string[];
  relations: StoryRelationDef[];
  /** миссия, которую открывает вариант */
  unlockMission?: string | null;
  /** подсказка концовки (ending_*) */
  endingHint?: string | null;
  /** переход в ветку кампании */
  branch?: string | null;
}

export interface StoryForkDef {
  id: string;
  titleRu: string;
  options: StoryOptionDef[];
}

export interface StorySceneDef {
  id: string;
  act: number;
  /** scene | bridge | arc | ancient */
  kind?: "scene" | "bridge" | "arc" | "ancient";
  titleRu: string;
  chronoRu?: string;
  bodyRu: string;
  forks?: StoryForkDef[];
  flags?: string[];
}

export interface StoryActDef {
  act: number;
  id: string;
  titleRu: string;
  scenes: StorySceneDef[];
}

export interface StoryDirectiveDef {
  id: string;
  titleRu: string;
  flag: string;
  /** ending_seal | ending_control | ending_release | ending_whisper */
  endingId: string;
  actionRu: string;
}

export interface StoryEpilogueCompanionDef {
  name: string;
  ru: string;
}

export interface StoryEpilogueDef {
  endingId: string;
  titleRu: string;
  toneRu?: string;
  conditionRu?: string;
  bodyRu: string;
  companions?: StoryEpilogueCompanionDef[];
}

export interface StoryFinalMessageDef {
  kind: "warning" | "gift";
  textRu: string;
}

export interface StoryScriptDef {
  version: number;
  titleRu: string;
  acts: StoryActDef[];
  directives: StoryDirectiveDef[];
  epilogues: StoryEpilogueDef[];
  finalPointRu?: string;
  finalMessages?: StoryFinalMessageDef[];
}

/** Мостик акта: запись журнала/хроники при смене акта. */
export interface StoryBridgeDef {
  id: string;
  fromAct: number;
  toAct: number;
  titleRu: string;
  chronoRu: string;
  bodyRu: string;
}
