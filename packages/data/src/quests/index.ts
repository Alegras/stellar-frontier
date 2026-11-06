/** Часть XIV · DLC «Квесты и диалоги» — данные. */
import questsJson from "./quests.json";
import dialoguesJson from "./dialogues.json";
import charactersJson from "./characters.json";
import cardsJson from "./cards.json";
import treeJson from "./tree.json";
import type {
  CharacterDef, DialogueDef, DlcBundle, QuestCardDef, QuestDef, QuestTreeDef,
} from "./schema";

export * from "./schema";
export const DLC_QUESTS = questsJson as unknown as QuestDef[];
export const DLC_DIALOGUES = dialoguesJson as unknown as DialogueDef[];
export const DLC_CHARACTERS = charactersJson as unknown as CharacterDef[];
export const DLC_CARDS = cardsJson as unknown as QuestCardDef[];
export const DLC_TREE = treeJson as unknown as QuestTreeDef;

export const DLC_QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(DLC_QUESTS.map((q) => [q.id, q]));
export const DLC_DIALOGUE_BY_ID: Record<string, DialogueDef> = Object.fromEntries(DLC_DIALOGUES.map((d) => [d.id, d]));
export const DLC_CHARACTER_BY_ID: Record<string, CharacterDef> = Object.fromEntries(DLC_CHARACTERS.map((c) => [c.id, c]));
export const DLC_CARD_BY_QUEST: Record<string, QuestCardDef> = Object.fromEntries(DLC_CARDS.map((c) => [c.questId, c]));
export const DLC_BUNDLE: DlcBundle = {
  quests: DLC_QUESTS, dialogues: DLC_DIALOGUES, characters: DLC_CHARACTERS,
  tree: DLC_TREE, cards: DLC_CARDS,
};
