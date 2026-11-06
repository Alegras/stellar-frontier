/**
 * Часть XIV · DLC «Квесты и диалоги» (вертикальный срез «Первый Свет» + кампанийные сцены).
 * Данные: 8 узлов дерева, 10 рёбер, 8 DLC-квестов, 6 диалогов, персонажи, каналы выдачи.
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

/** Условные изменения квеста по DLC-флагам (Q1 → Q2/Q5/Q6 и т.п.). */
export interface QuestModifierDef {
  /** все перечисленные DLC-флаги должны быть установлены */
  flags?: string[];
  /** хотя бы один из флагов */
  anyFlags?: string[];
  /** ни один из флагов не установлен */
  notFlags?: string[];
  creditsDelta?: number;
  alloysDelta?: number;
  rep?: Record<string, number>;
  extraFlags?: string[];
  /** переопределить следующий квест (последний совпавший) */
  nextHint?: string;
  /** l10n-ключи подписей последствий для журнала */
  effectLabels?: string[];
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
  /** гейтинг: все флаги */
  requiresFlags?: string[];
  /** гейтинг: любой из флагов */
  requiresAnyFlags?: string[];
  /** условные изменения награды/репутации/следующего квеста по DLC-флагам */
  modifiers?: QuestModifierDef[];
  /** статические подписи последствий квеста */
  effectLabels?: string[];
}

export interface DialogueEffectDef {
  flag?: string;
  rep?: Record<string, number>;
  openQuest?: string;
  timeSkip?: number;
  credits?: number;
  chronicleKey?: string;
  /** флаг основной кампании (fg.campaign.flags) */
  campaignFlag?: string;
  /** дельта отношений с персонажами: CharacterDef.id -> delta */
  relation?: Record<string, number>;
  /** ветка кампании: federation | sovereignty | syndicate */
  branch?: string;
  /** путь концовки кампании: ending_seal | ending_control | ... */
  ending?: string;
  /** l10n-ключ подписи последствия для журнала/UI */
  effectLabelKey?: string;
  /** предметы-флаги (d.flags["item:"+id]) */
  items?: string[];
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
  /** l10n-ключ должности */
  titleKey?: string;
  /** l10n-ключ биографии */
  bioKey?: string;
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
