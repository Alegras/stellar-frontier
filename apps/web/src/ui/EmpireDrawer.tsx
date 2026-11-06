import { useMemo, useState } from "react";
import type { Colony } from "@sf/sim";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";

import { Modal, TabBar } from "./controls";
import { CampaignPanel } from "./CampaignPanel";
import { ColonyPanel } from "./ColonyPanel";
import { DiplomacyPanel } from "./DiplomacyPanel";
import { FleetPanel } from "./FleetPanel";
import { ResearchPanel } from "./ResearchPanel";
import { TraditionsPanel } from "./TraditionsPanel";
import { playerColonies, popsOf, worldOf, intText } from "./util";
import { L, tr } from "./fg";

export type EmpireTab = "colonies" | "research" | "fleet" | "traditions" | "diplomacy" | "campaign";

export function EmpireDrawer({
  game, state, tab, onTab, onClose,
}: {
  game: Game;
  state: GameState;
  tab: EmpireTab;
  onTab: (t: EmpireTab) => void;
  onClose: () => void;
}) {
  const world = worldOf(game);
  const colonies = useMemo(() => (world ? playerColonies(world) : []), [world, state.tick]);
  const [picked, setPicked] = useState<number | null>(state.selectedPlanetId && colonies.some((c) => c.planetId === state.selectedPlanetId) ? state.selectedPlanetId : null);

  const colony: Colony | null =
    colonies.find((c) => c.planetId === (picked ?? state.selectedPlanetId)) ??
    colonies[0] ??
    null;

  return (
    <Modal
      title={L("Империя", "Empire")}
      wide
      onClose={onClose}
      testId="empire-drawer"
      overlayTestId="overlays-root"
      closeTestId="btn-close-empire"
    >
      <TabBar
        value={tab}
        onChange={(id) => onTab(id as EmpireTab)}
        items={[
          { id: "colonies", label: L("Колонии", "Colonies") + " (" + colonies.length + ")", testId: "tab-colonies" },
          { id: "research", label: tr("tech.title", undefined, "Наука"), testId: "tab-research" },
          { id: "fleet", label: tr("fleet.title", undefined, "Флот"), testId: "tab-fleet" },
          { id: "traditions", label: tr("traditions.title", undefined, "Традиции"), testId: "tab-traditions" },
          { id: "diplomacy", label: tr("diplomacy.title", undefined, "Дипломатия"), testId: "tab-diplomacy" },
          { id: "campaign", label: tr("campaign.title", undefined, "Кампания"), testId: "tab-campaign" },
        ]}
      />
      <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "flex-start" }}>
        {tab === "colonies" && (
          <>
            <div style={{ flex: "0 0 220px", maxHeight: "62vh", overflow: "auto" }} className="sf-scroll">
              {colonies.length === 0 && <div className="sf-meta">{L("Колоний нет.", "No colonies.")}</div>}
              {colonies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={"sf-line sf-line--pick" + (c.id === colony?.id ? " sf-line--sel" : "")}
                  onClick={() => setPicked(c.planetId)}
                  data-testid={"colony-row-" + c.id}
                >
                  <span className="sf-nowrap">{c.name}</span>
                  <span className="sf-spacer" />
                  <span className="sf-meta">{intText(popsOf(c))}</span>
                </button>
              ))}
            </div>
            <div style={{ flex: "1 1 auto", minWidth: 0, maxHeight: "62vh", overflow: "auto" }} className="sf-scroll">
              <ColonyPanel game={game} state={state} colony={colony} />
            </div>
          </>
        )}
        {tab === "research" && (
          <div style={{ flex: "1 1 auto", minWidth: 0, maxHeight: "66vh", overflow: "auto" }} className="sf-scroll">
            <ResearchPanel game={game} state={state} />
          </div>
        )}
        {tab === "fleet" && (
          <div style={{ flex: "1 1 auto", minWidth: 0, maxHeight: "66vh", overflow: "auto" }} className="sf-scroll">
            <FleetPanel game={game} state={state} />
          </div>
        )}
        {tab === "traditions" && (
          <div style={{ flex: "1 1 auto", minWidth: 0, maxHeight: "66vh", overflow: "auto" }} className="sf-scroll">
            <TraditionsPanel game={game} state={state} onClose={onClose} />
          </div>
        )}
        {tab === "diplomacy" && (
          <div style={{ flex: "1 1 auto", minWidth: 0, maxHeight: "66vh", overflow: "auto" }} className="sf-scroll">
            <DiplomacyPanel game={game} state={state} onClose={onClose} />
          </div>
        )}
        {tab === "campaign" && (
          <div style={{ flex: "1 1 auto", minWidth: 0, maxHeight: "66vh", overflow: "auto" }} className="sf-scroll">
            <CampaignPanel game={game} state={state} onClose={onClose} />
          </div>
        )}
      </div>
    </Modal>
  );
}
