/**
 * Часть XIV · DLC «Квесты и диалоги» (вертикальный срез «Первый Свет»).
 * Данные: 8 узлов дерева, 10 рёбер, 8 квестов, 3 диалога, персонажи, каналы выдачи.
 * Тексты — по ключам l10n (quest.*, dlg.*, char.*), без строк в коде.
 */
export interface QuestRewardDef {
  credits?: number;
  alloys?: number;
  rep?: Record<string, number>;
  flags?: string[];
  items?: string[];
}

export interface QuestStepDef {
  id: string;
  type: "dialogue" | "reach_system" | "kill" | "choice" | "dock" | "report" | "turn_in";
  target?: string;
  count?: number;
  titleKey: string;
}

export interface QuestSourceDef {
  channel: "story_message" | "board" | "rumor" | "signal";
  npc?: string;
  autoStartTick?: number;
  stationId?: string;
  systemId?: string;
  requiresQuest?: string;
  requiresFlag?: string;
  rumorLieChance?: number;
}

export interface QuestDef {
  id: string;
  type: "main" | "side" | "faction" | "personal" | "event" | "investigation" | "bounty" | "delivery";
  line: string;
  act: number;
  titleKey: string;
  summaryKey: string;
  source: QuestSourceDef;
  steps: QuestStepDef[];
  rewards: QuestRewardDef;
  failPolicy: "soft" | "hard" | "none";
  checkpoint?: boolean;
  nextHint?: string;
}

export interface DialogueEffectDef {
  flag?: string;
  rep?: Record<string, number>;
  openQuest?: string;
  timeSkip?: number;
  credits?: number;
  chronicleKey?: string;
}

export interface DialogueOptionDef {
  id: string;
  textKey: string;
  next: string;
  effects?: DialogueEffectDef[];
  requiresFlag?: string;
  check?: { stat: string; dc: number; onSuccess: string; onFail: string };
}

export interface DialogueNodeDef {
  id: string;
  type: "line" | "choice" | "check" | "effect" | "end";
  speaker?: string;
  emotion?: string;
  textKey?: string;
  next?: string;
  options?: DialogueOptionDef[];
  check?: { stat: string; dc: number; onSuccess: string; onFail: string };
  effects?: DialogueEffectDef[];
  comic?: string;
}

export interface DialogueDef {
  id: string;
  version: number;
  nodes: DialogueNodeDef[];
}

export interface CharacterDef {
  id: string;
  nameKey: string;
  portrait: string;
  /** карта эмоция → файл (относительно apps/web/public/dlc/) */
  portraits?: Record<string, string>;
  emotions: string[];
  race: string;
  role: string;
  relation: { base: number; grudgeAllowed: boolean };
}

export interface TreeQuestNodeDef {
  id: string;
  group: string;
  type: string;
  x: number;
  y: number;
}

export interface TreeEdgeDef {
  from: string;
  to: string;
  kind: "required" | "optional" | "branch" | "hidden" | "opens";
}

export interface QuestTreeDef {
  version: number;
  nodes: TreeQuestNodeDef[];
  edges: TreeEdgeDef[];
}

export interface QuestCardDef {
  id: string;
  questId: string;
  art: string;
  accent: string;
}

export interface DlcBundle {
  quests: QuestDef[];
  dialogues: DialogueDef[];
  characters: CharacterDef[];
  tree: QuestTreeDef;
  cards: QuestCardDef[];
}
