import { useEffect, useRef, useState } from "react";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import { Btn, Modal, Sep } from "./controls";
import { L, fgOf } from "./fg";
import { worldOf } from "./util";

/** L0: бой с игроком больше не авторезолвится без выбора. */
export function BattleChoiceModal({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const fg = world ? fgOf(world) : null;
  const pb = fg?.pendingBattle ?? null;
  const sent = useRef<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const mode = typeof localStorage !== "undefined" ? (localStorage.getItem("sf.battleMode") ?? "ask") : "ask";

  useEffect(() => {
    if (!pb) { sent.current = null; setHidden(false); return; }
    const key = pb.tick + ":" + pb.systemId;
    if (sent.current === key) return;
    if (mode === "auto") { sent.current = key; game.sendCommand({ type: "resolve_pending_battle" } as never); }
  }, [pb?.tick, pb?.systemId, mode, game]);

  if (!world || !pb || hidden) return null;
  const sys = world.systems[pb.systemId];
  const a = world.fleets.find((f) => f.id === pb.attackerFleetId);
  const b = world.fleets.find((f) => f.id === pb.defenderFleetId);
  const resolve = () => { game.sendCommand({ type: "resolve_pending_battle" } as never); };
  const openGrid = () => { setHidden(true); window.dispatchEvent(new CustomEvent("sf:grid-battle", { detail: { systemId: pb.systemId, systemName: sys?.name, seed: pb.tick * 31 + pb.systemId, coop: false } })); game.sendCommand({ type: "clear_pending_battle" } as never); };
  return (
    <Modal title={L("Перед боем", "Before battle") + " · " + (sys?.name ?? "")} onClose={() => setHidden(true)} testId="battle-choice-modal" closeTestId="btn-close-battle-choice" footer={<Btn onClick={() => setHidden(true)} testId="btn-battle-later">{L("Позже", "Later")}</Btn>}>
      <div className="sf-meta">{L("Бой остановлен. Выберите, как его провести.", "Battle paused. Choose how to fight.")}</div>
      <Sep />
      <div className="sf-battle-cols">
        <div className="sf-battle-side">
          <div className="sf-h">{L("Атакующий", "Attacker")}</div>
          <b>{a?.name ?? "—"}</b>
          <div className="sf-meta">{L("флот игрока", "player fleet")}: {pb.playerSide === "attacker" ? L("да", "yes") : L("нет", "no")}</div>
        </div>
        <div className="sf-dim" style={{ alignSelf: "center", fontSize: "1.4em" }}>⚔</div>
        <div className="sf-battle-side sf-battle-side--right">
          <div className="sf-h">{L("Защитник", "Defender")}</div>
          <b>{b?.name ?? "—"}</b>
          <div className="sf-meta">{L("флот игрока", "player fleet")}: {pb.playerSide === "defender" ? L("да", "yes") : L("нет", "no")}</div>
        </div>
      </div>
      <Sep />
      <div className="sf-row" style={{ flexWrap: "wrap", gap: 6 }}>
        <Btn variant="primary" onClick={resolve} testId="btn-battle-auto">{L("Авторезолв", "Auto-resolve")}</Btn>
        <Btn onClick={openGrid} testId="btn-battle-grid">{L("Сетка командования", "Grid Command")}</Btn>
        <Btn onClick={() => { game.exitToGalaxy(); setHidden(true); }} testId="btn-battle-flight">{L("Вести бой (6DOF)", "Fight in 6DOF")}</Btn>
      </div>
      <div className="sf-meta" style={{ marginTop: 6 }}>{L("Режим по умолчанию меняется в Настройках → «Бои на карте».", "Default mode is changed in Settings → Map battles.")}</div>
    </Modal>
  );
}