import { useState } from "react";
import type { Formation } from "@sf/sim";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";

import { Badge, Bar, Btn, KV, Panel, Sep, Tip } from "./controls";
import { L, tr } from "./fg";
import {
  barTone, designName, FLEET_STATUS_RU, fleetPower, findSystem, fleetsInSystem, FORMATIONS, playerEmpire, playerFleets, worldOf, intText } from "./util";

export function FleetPanel({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const [targetId, setTargetId] = useState<string>("");

  if (!world || !emp) {
    return <Panel title={tr("fleet.title", undefined, "Флот")} testId="fleet-panel"><div className="sf-empty">{L("Нет мира.", "No world.")}</div></Panel>;
  }

  const fleets = playerFleets(game);
  const selected = state.selectedFleetId != null ? fleets.find((f) => f.id === state.selectedFleetId) ?? null : null;
  const target = targetId === "" ? null : findSystem(world, Number(targetId));
  const systems = world.systems
    .filter((s) => s.knownBy.includes(emp.id) || fleetsInSystem(game, s.id).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Panel title={tr("fleet.title", undefined, "Флот") + " · " + fleets.length} testId="fleet-panel" tall>
      {fleets.length === 0 ? (
        <div className="sf-empty">
          {L("Флотов нет.", "No fleets.")}
          <div className="sf-meta">{L("Постройте корабль на верфи станции (build_ship).", "Build a ship at a station shipyard (build_ship).")}</div>
        </div>
      ) : (
        <div className="sf-list">
          {fleets.map((f) => {
            const sys = findSystem(world, f.systemId);
            const isSel = f.id === state.selectedFleetId;
            return (
              <button
                key={f.id}
                type="button"
                className={"sf-line sf-line--pick" + (isSel ? " sf-line--sel" : "")}
                onClick={() => game.selectFleet(isSel ? null : f.id)}
                data-testid={"fleet-row-" + f.id}
                title={L("Выбрать флот", "Select fleet")}
              >
                <span className="sf-info">▲</span>
                <span className="sf-nowrap">{f.name}</span>
                <span className="sf-spacer" />
                <span className="sf-meta">{intText(fleetPower(f))} FP · {f.ships.length} {L("кор.", "ships")}</span>
                <span className="sf-badge">{FLEET_STATUS_RU[f.status] ?? f.status}</span>
                <span className="sf-meta sf-nowrap">{sys ? sys.name : "—"}</span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <>
          <Sep />
          <div className="sf-row">
            <b>{selected.name}</b>
            <span className="sf-spacer" />
            <Badge tone={selected.status === "combat" ? "bad" : selected.status === "moving" ? "warn" : "info"}>
              {FLEET_STATUS_RU[selected.status] ?? selected.status}
            </Badge>
          </div>
          <div className="sf-grid2">
            <KV k={L("Флитпауэр", "Fleet power")} v={intText(fleetPower(selected)) + " FP"} />
            <KV k={L("Кораблей", "Ships")} v={intText(selected.ships.length)} />
            <KV k={L("Система", "System")} v={findSystem(world, selected.systemId)?.name ?? "—"} />
            <KV k={L("Формация", "Formation")} v={FORMATIONS.find((x) => x.id === selected.formation)?.ru ?? selected.formation} />
            <KV k={L("Прыжков в пути", "Jumps en route")} v={intText(selected.path.length)} />
            <KV k={L("Адмирал", "Admiral")} v={selected.admiralName ?? "—"} />
          </div>

          <div className="sf-row" style={{ flexWrap: "wrap", gap: 3, marginTop: 4 }}>
            {FORMATIONS.map((fm) => (
              <Btn
                key={fm.id}
                size="sm"
                active={selected.formation === fm.id}
                onClick={() => game.sendCommand({ type: "set_formation", fleetId: selected.id, formation: fm.id as Formation })}
                testId={"btn-formation-" + fm.id}
              >
                {fm.ru}
              </Btn>
            ))}
          </div>

          <div className="sf-row" style={{ marginTop: 4, flexWrap: "wrap" }}>
            <Btn size="sm" onClick={() => game.sendCommand({ type: "repair_fleet", fleetId: selected.id })} testId="btn-repair-fleet">
              Ремонт
            </Btn>
            <Btn size="sm" onClick={() => game.sendCommand({ type: "stop_fleet", fleetId: selected.id })}>{L("Стоп", "Stop")}</Btn>
            <Btn size="sm" variant="ghost" onClick={() => game.selectFleet(null)}>{L("Снять выбор", "Deselect")}</Btn>
          </div>

          <Sep />
          <div className="sf-h">{L("Приказ движения", "Movement order")}</div>
          <div className="sf-row">
            <select
              className="sf-select"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              aria-label={L("Целевая система", "Target system")}
              data-testid="fleet-target-select"
              style={{ flex: "1 1 auto", minWidth: 0 }}
            >
              <option value="">{L("— выберите систему —", "— choose a system —")}</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.id === selected.systemId ? " (" + L("здесь", "here") + ")" : ""}</option>
              ))}
            </select>
            <Tip data={{
              title: L("Приказ флоту", "Fleet order"),
              value: target ? "→ " + target.name : L("система не выбрана", "no system selected"),
              lines: [
                { label: L("Флот", "Fleet"), value: selected.name },
                { label: L("Путь", "Path"), value: target ? Math.abs(target.hopsFromCapital - (findSystem(world, selected.systemId)?.hopsFromCapital ?? 0)) + " " + L("прыжк.", "jumps") : "—" },
              ],
              consequence: L("Альтернатива: клик по метке системы на карте при выбранном флоте.", "Alternative: click a system label on the map with the fleet selected."),
            }}>
              <Btn
                variant="primary"
                disabled={!target || target.id === selected.systemId}
                onClick={() => {
                  if (target) game.sendCommand({ type: "move_fleet", fleetId: selected.id, systemId: target.id });
                }}
                testId="btn-move-fleet"
              >
                Двигать
              </Btn>
            </Tip>
          </div>
          <div className="sf-meta">
            {L("Клик по метке на карте при выбранном флоте тоже отдаёт приказ движения.", "Clicking a map label with the fleet selected also issues a move order.")}
          </div>

          <Sep />
          <div className="sf-h">{L("Корабли", "Ships")} ({selected.ships.length})</div>
          <div className="sf-list">
            {selected.ships.map((s) => {
              const hull01 = s.hullMax > 0 ? s.hull / s.hullMax : 0;
              return (
                <div key={s.id} style={{ marginBottom: 3 }}>
                  <div className="sf-row">
                    <span className="sf-nowrap">{s.name}</span>
                    <span className="sf-spacer" />
                    <span className="sf-meta">{designName(s.designId)}</span>
                  </div>
                  <div className="sf-hud-gauge">
                    <span className="sf-meta" style={{ width: 40 }}>{L("корп.", "hull")}</span>
                    <Bar v01={hull01} tone={barTone(hull01)} thin />
                    <span style={{ width: 78, textAlign: "right", fontSize: ".8em" }}>
                      {intText(s.hull)}/{intText(s.hullMax)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
