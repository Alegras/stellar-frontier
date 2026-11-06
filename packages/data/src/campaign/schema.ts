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

export interface CampaignBundle {
  acts: CampaignActDef[];
  missions: CampaignMissionDef[];
  events: NarrativeEventDef[];
  anomalies: AnomalyDef[];
  archaeology: ArchaeologyDef[];
  lore: LoreDef[];
  endings: EndingDef[];
  branches: BranchDef[];
}
