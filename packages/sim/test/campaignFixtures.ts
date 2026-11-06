/**
 * Общие фикстуры тестов кампании (M9): фабрики контента и миров.
 * Данные @sf/data могут быть пустыми — тесты подставляют каталоги параметрами фаз.
 */
import { BALANCE, MODE } from "@sf/data";
import type {
  AnomalyDef, ArchaeologyDef, BranchDef, CampaignMissionDef, EndingDef, LoreDef, NarrativeEventDef,
} from "@sf/data";
import { createWorld } from "../src/queries";
import { ensureFg } from "../src/fullgame";
import type { FullGameState } from "../src/fullgame";
import type { World } from "../src/types";

export function makeWorld(seed = 7): World {
  return createWorld(seed, MODE, BALANCE);
}

export function playerId(world: World): number {
  return world.playerEmpireId;
}

export function fgOf(world: World): FullGameState {
  return ensureFg(world);
}

export function makeMission(over: Partial<CampaignMissionDef> & { id: string }): CampaignMissionDef {
  return {
    act: 0,
    titleRu: "Миссия " + over.id,
    briefingRu: "Брифинг " + over.id,
    giver: "test_giver",
    branchRequired: null,
    secret: false,
    objectives: [],
    rewards: {},
    weight: 1,
    ...over,
  };
}

export function makeEvent(over: Partial<NarrativeEventDef> & { id: string; chainId: string; step: number }): NarrativeEventDef {
  return {
    titleRu: "Событие " + over.id,
    textRu: "Текст события " + over.id,
    choices: [
      {
        id: "accept",
        labelRu: "Принять",
        effects: [{ target: "credits", value: 500 }],
        flag: "accepted_" + over.id,
      },
      { id: "decline", labelRu: "Отказаться", effects: [] },
    ],
    weight: 1,
    ...over,
  };
}

export function makeAnomaly(over: Partial<AnomalyDef> & { id: string }): AnomalyDef {
  return {
    titleRu: "Аномалия " + over.id,
    textRu: "Описание " + over.id,
    kind: "anomaly",
    chainId: null,
    steps: 1,
    rewardCredits: 1000,
    rewardScience: 100,
    artifact: false,
    weight: 1,
    ...over,
  };
}

export function makeArchaeology(over: Partial<ArchaeologyDef> & { chainId: string }): ArchaeologyDef {
  return {
    titleRu: "Цепочка " + over.chainId,
    steps: 3,
    descRu: "Описание",
    reward: { credits: 2000, alloys: 100, science: 300 },
    artifact: true,
    ...over,
  };
}

export function makeLore(over: Partial<LoreDef> & { id: string }): LoreDef {
  return {
    titleRu: "Лор " + over.id,
    textRu: "Текст лора " + over.id,
    category: "anomaly",
    unlockCondition: "anomaly",
    ...over,
  };
}

export function makeBranch(over: Partial<BranchDef> & { id: string }): BranchDef {
  return {
    ru: "Ветка " + over.id,
    descRu: "Описание ветки",
    missions: [],
    ending: "ending_" + over.id,
    effects: {},
    ...over,
  };
}

export function makeEnding(over: Partial<EndingDef> & { id: string }): EndingDef {
  return {
    ru: "Концовка " + over.id,
    descRu: "Описание",
    condition: "",
    branch: null,
    secret: false,
    ...over,
  };
}
