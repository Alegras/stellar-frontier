import type { ComponentType } from "react";
import type { FullPanelProps } from "./fg";
import { AncientsPanel } from "./AncientsPanel";
import { CampaignPanel } from "./CampaignPanel";
import { JournalPanel } from "./JournalPanel";
import { ContractsPanel } from "./ContractsPanel";
import { CoopPanel } from "./CoopPanel";
import { DiplomacyPanel } from "./DiplomacyPanel";
import { MarketPanel } from "./MarketPanel";
import { SettingsPanelFull } from "./SettingsPanelFull";
import { TraditionsPanel } from "./TraditionsPanel";

/** Идентификаторы панелей полной игры (реестр для App/QA). */
export type PanelId =
  | "traditions" | "perks"
  | "diplomacy" | "war" | "council" | "espionage"
  | "market" | "exchange" | "routes"
  | "contracts"
  | "journal"
  | "campaign" | "anomalies" | "megastructures" | "victory"
  | "ancients"
  | "coop"
  | "settings";

export const PANEL_IDS: PanelId[] = [
  "traditions", "perks", "diplomacy", "war", "council", "espionage",
  "market", "exchange", "routes", "contracts", "journal",
  "campaign", "anomalies", "megastructures", "victory", "ancients", "coop", "settings",
];

export const PANEL_TITLES: Record<PanelId, string> = {
  traditions: "Традиции и перки",
  perks: "Перки вознесения",
  diplomacy: "Дипломатия",
  war: "Война",
  council: "Галактический совет",
  espionage: "Шпионаж",
  market: "Рынок станции",
  exchange: "Биржа CR ↔ энергия",
  routes: "Торговые маршруты",
  contracts: "Контракты",
  journal: "Журнал квестов",
  campaign: "Кампания",
  anomalies: "Аномалии и археология",
  megastructures: "Мегаструктуры",
  victory: "Победа и концовки",
  ancients: "Древние · Наследие",
  coop: "Кооператив",
  settings: "Настройки",
};

export const PANEL_REGISTRY: Record<PanelId, ComponentType<FullPanelProps>> = {
  traditions: TraditionsPanel,
  perks: TraditionsPanel,
  diplomacy: DiplomacyPanel,
  war: DiplomacyPanel,
  council: DiplomacyPanel,
  espionage: DiplomacyPanel,
  market: MarketPanel,
  exchange: MarketPanel,
  routes: MarketPanel,
  contracts: ContractsPanel,
  journal: JournalPanel,
  campaign: CampaignPanel,
  anomalies: CampaignPanel,
  megastructures: CampaignPanel,
  victory: CampaignPanel,
  ancients: AncientsPanel,
  coop: CoopPanel,
  settings: SettingsPanelFull,
};