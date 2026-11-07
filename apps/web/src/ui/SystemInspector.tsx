import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import { Badge, Btn, KV, Panel, Sep, Tip } from "./controls";
import { L, STATION_KIND_EN, tr } from "./fg";
import {
  costText, findColonyByPlanet, findSystem, fleetsInSystem, enemyFleetsInSystem, isKnown, num, pctText, PLANET_RU, POI_RU, popsOf, playerEmpire, STATION_RU, STAR_RU, fleetCap, empireFleetPower, worldOf, intText, rnd } from "./util";

function gridBattleFlagOn(world: { flags: Record<string, number> } | null): boolean {
  try {
    const ls = localStorage.getItem("sf.gridBattle");
    if (ls === "0") return false;
    if (ls === "1") return true;
  } catch { /* noop */ }
  return (world?.flags.grid_battle ?? 1) !== 0;
}

export function SystemInspector({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const sys = world ? findSystem(world, state.selectedSystemId) : null;
  const emp = playerEmpire(game);

  if (!world || !sys || !emp) {
    return (
      <Panel title={L("Система", "System")} testId="system-inspector">
        <div className="sf-empty">
          {L("Выберите систему на карте.", "Select a system on the map.")}
          <div className="sf-meta" style={{ marginTop: 4 }}>
            {L("Колесо — зум · клик по метке — выбрать · двойной клик — войти в систему · Tab — следующая.", "Wheel — zoom · click a label — select · double click — enter system · Tab — next")}
          </div>
        </div>
      </Panel>
    );
  }

  const known = isKnown(sys, emp.id);
  const owner = sys.ownerId === 0
    ? L("Нейтральная", "Neutral")
    : (world.empires.find((e) => e.id === sys.ownerId)?.name ?? "—");
  const own = sys.ownerId === emp.id;
  const myFleets = fleetsInSystem(game, sys.id);
  const enemies = enemyFleetsInSystem(game, sys.id);
  const hostileFleets = world.fleets.filter((f) => f.systemId === sys.id && f.empireId !== emp.id && f.ships.length > 0);
  const colonizer = myFleets.find((f) => f.ships.some((s) => s.classId === "colonizer")) ?? null;
  const selectedFleet = state.selectedFleetId != null
    ? (world.fleets.find((f) => f.id === state.selectedFleetId && f.empireId === emp.id) ?? null)
    : null;
  const fleetsElsewhere = world.fleets
    .filter((f) => f.empireId === emp.id && f.ships.length > 0)
    .sort((a, b) => Math.abs(a.systemId - sys.id) - Math.abs(b.systemId - sys.id))
    .slice(0, 6);

  const canEnter = known || myFleets.length > 0;

  return (
    <Panel
      title={L("Система", "System") + " · " + sys.name}
      right={<Badge tone={own ? "good" : known ? "info" : "warn"}>{own ? L("своя", "owned") : known ? L("известна", "known") : L("туман войны", "fog of war")}</Badge>}
      testId="system-inspector"
      tall
    >
      <div className="sf-grid2">
        <KV k={L("Звезда", "Star")} v={known ? (STAR_RU[sys.star] ?? sys.star) : "?"} />
        <KV k={L("Владелец", "Owner")} v={known ? owner : "?"} />
        <KV k={L("Прыжков от столицы", "Jumps from capital")} v={intText(sys.hopsFromCapital)} />
        <KV k={L("Гиперлинии", "Hyperlanes")} v={intText(sys.links.length) + (sys.chokepoint ? " · " + L("узел", "chokepoint") : "")} />
      </div>
      {sys.station && known && (
        <>
          <Sep />
          <div className="sf-row">
            <span className="sf-info">◈</span>
            <b className="sf-nowrap">{sys.station.nameRu}</b>
            <span className="sf-spacer" />
            <span className="sf-meta">{L(STATION_RU[sys.station.kind] ?? sys.station.kind, STATION_KIND_EN[sys.station.kind] ?? sys.station.kind)}</span>
          </div>
          <div className="sf-meta">
            {L("Прочность", "HP")} {intText(sys.station.hp)}/{intText(sys.station.maxHp)} · {L("владелец", "owner")}:{" "}
            {world.empires.find((e) => e.id === sys.station!.ownerId)?.name ?? L("нейтральная", "neutral")}
            {sys.station.hasShipyard ? " · " + tr("station.shipyard", undefined, "верфь") : ""}{sys.station.hasMissions ? " · " + tr("station.missions", undefined, "контракты") : ""}
          </div>
          <div className="sf-row" style={{ marginTop: 4 }}>
            <Btn
              size="sm"
              onClick={() => game.dockAtStation(sys.station!.id)}
              title={L("Перейти к экрану станции", "Open the station screen")}
              testId="btn-dock"
            >
              {L("Стыковка", "Dock")}
            </Btn>
            <span className="sf-meta">{L("или G в полёте", "or G in flight")}</span>
          </div>
        </>
      )}

      {enemies.length > 0 && (
        <div className="sf-warn" style={{ fontSize: ".85em" }}>
          ⚠ {L("В системе враждебные флоты", "Hostile fleets in system")}: {enemies.length}
        </div>
      )}

      {myFleets.length > 0 && (enemies.length > 0 || hostileFleets.length > 0) && gridBattleFlagOn(world) && (
        <Btn size="sm" variant="primary" testId="btn-grid-battle"
          title={L("Только стратегический слой L0; 6DOF-бой в системе не меняется", "Strategic L0 only; in-system 6DOF stays unchanged")}
          onClick={() => {
            try { window.dispatchEvent(new CustomEvent("sf:grid-battle", { detail: { systemId: sys.id, systemName: sys.name, seed: sys.id * 97 + emp.id, coop: false } })); } catch { /* noop */ }
          }}>
          {L("Сетка командования", "Grid Command")}
        </Btn>
      )}

      <Sep />
      <div className="sf-h">{L("Планеты", "Planets")}</div>
      {known ? (
        <div className="sf-list">
          {sys.planets.length === 0 && <div className="sf-meta">{L("Планет нет.", "No planets.")}</div>}
          {sys.planets.map((p) => {
            const col = findColonyByPlanet(world, p.id);
            const mine = col && col.empireId === emp.id;
            const canColonize = colonizer && col === null && p.ownerId === 0 && p.habitability > 0
              && p.type !== "gas_giant" && p.type !== "asteroid_belt";
            return (
              <div key={p.id} className="sf-line" style={{ padding: ".25em 0", alignItems: "flex-start" }}>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <button
                    type="button"
                    className="sf-btn--ghost"
                    style={{ all: "unset", cursor: "pointer", color: "inherit", display: "block", maxWidth: "100%" }}
                    onClick={() => game.selectPlanet(p.id)}
                    title="Открыть планету"
                    data-testid={"planet-" + p.id}
                  >
                    <span className="sf-nowrap">{p.name}</span>
                  </button>
                  <div className="sf-meta">
                    {PLANET_RU[p.type] ?? p.type} · {L("пригодность", "habitability")} {pctText(num(p.habitability) / 100)}
                    {p.deposits.minerals > 0 ? " · " + L("мин.", "min.") + " +" + p.deposits.minerals : ""}
                    {p.deposits.energy > 0 ? " · " + L("эн.", "en.") + " +" + p.deposits.energy : ""}
                    {p.deposits.rare > 0 ? " · " + L("редк.", "rare") + " " + p.deposits.rare : ""}
                  </div>
                  {col && (
                    <div className="sf-meta" style={{ color: mine ? "#6BE675" : "#F08A24" }}>
                      {mine ? L("Колония", "Colony") + " · " + intText(popsOf(col)) + " " + L("попов", "pops") + " · " + L("стаб.", "stab.") + " " + rnd(col.stability) + "%" : L("Колония", "Colony") + ": " + (world.empires.find((e) => e.id === col.empireId)?.name ?? "—")}
                    </div>
                  )}
                </div>
                {canColonize && (
                  <Btn
                    size="sm"
                    variant="primary"
                    title={L("Колонизировать", "Colonize") + ": " + costText(world.balance.colonyCost)}
                    onClick={() => game.sendCommand({ type: "colonize", fleetId: colonizer.id, planetId: p.id })}
                    testId="btn-colonize"
                  >
                    {tr("map.colonize", undefined, "Колонизировать")}
                  </Btn>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sf-empty">
          {L("Данные скрыты туманом войны.", "Data hidden by fog of war.")}
          <div className="sf-meta">{L("Отправьте флот-разведчик или войдите в систему (если есть свой флот).", "Send a scout fleet or enter the system (if you have a fleet).")}</div>
        </div>
      )}

      {known && sys.poi.length > 0 && (
        <>
          <Sep />
          <div className="sf-h">{L("Точки интереса", "Points of interest")}</div>
          <div className="sf-list">
            {sys.poi.map((poi) => (
              <div key={poi.id} className="sf-line">
                <span className="sf-gold">◆</span>
                <span className="sf-nowrap">{poi.nameRu}</span>
                <span className="sf-spacer" />
                <span className="sf-meta">{poi.scanned ? L("изучено", "studied") : (POI_RU[poi.kind] ?? poi.kind)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <Sep />
      <div className="sf-h">{L("Флоты", "Fleets")}</div>
      {myFleets.length === 0 && <div className="sf-meta">{L("Своих флотов в системе нет.", "No own fleets here.")}</div>}
      {myFleets.map((f) => (
        <div key={f.id} className="sf-line">
          <span className="sf-info">▲</span>
          <span className="sf-nowrap">{f.name}</span>
          <span className="sf-spacer" />
          <span className="sf-meta">{f.ships.length} {L("кор.", "ships")} · {f.status}</span>
        </div>
      ))}

      <Sep />
      <div className="sf-row" style={{ flexWrap: "wrap", gap: 4 }}>
        <Tip data={{
          title: L("Вход в систему", "Enter system"),
          value: canEnter ? L("доступен", "available") : L("нет разведданных", "no intel"),
          note: known ? L("Такт замирает: тактическая пауза.", "Tick freezes: tactical pause.") : L("Нужен свой флот в системе или разведка.", "Requires your fleet or intel."),
        }}>
          <Btn
            variant="primary"
            disabled={!canEnter}
            onClick={() => game.enterSystem(sys.id)}
            testId="btn-enter-system"
          >
            {tr("map.enterSystem", undefined, "Войти в систему")}
          </Btn>
        </Tip>
        <Btn
          onClick={() => game.sendCommand({ type: "scan_system", fleetId: (myFleets[0] ?? fleetsElsewhere[0])?.id ?? 0, systemId: sys.id })}
          disabled={myFleets.length === 0 && fleetsElsewhere.length === 0}
          title={myFleets.length === 0 ? L("Нужен свой флот в системе или рядом", "Requires your fleet here or nearby") : L("Разведать систему", "Scout the system")}
          testId="btn-scout"
        >
          {L("Разведать", "Scout")}
        </Btn>
      </div>

      <Sep />
      <div className="sf-h">{L("Отправить флот", "Send fleet")}</div>
      {fleetsElsewhere.length === 0 ? (
        <div className="sf-meta">{L("Нет флотов.", "No fleets.")}</div>
      ) : (
        <div className="sf-list">
          {fleetsElsewhere.map((f) => (
            <div key={f.id} className="sf-line">
              <span className="sf-nowrap">{f.name}</span>
              <span className="sf-spacer" />
              <span className="sf-meta">{f.ships.length} {L("кор.", "ships")}</span>
              <Btn
                size="sm"
                onClick={() => game.sendCommand({ type: "move_fleet", fleetId: f.id, systemId: sys.id })}
                disabled={f.systemId === sys.id}
                title={f.systemId === sys.id ? L("Флот уже здесь", "Fleet already here") : L("Приказ движения", "move_fleet order")}
              >
                {f.systemId === sys.id ? L("здесь", "here") : L("Приказ", "Order")}
              </Btn>
            </div>
          ))}
        </div>
      )}
      {selectedFleet && (
        <div className="sf-meta" style={{ marginTop: 4 }}>
          {L("Выбран флот", "Selected fleet")} «{selectedFleet.name}»: {L("клик по метке системы отдаёт приказ движения.", "click a system label to issue a move order.")}
        </div>
      )}
      <div className="sf-meta" style={{ marginTop: 4 }}>
        FP {L("империи", "empire")} {intText(empireFleetPower(world, emp.id))} / {intText(fleetCap(world, emp.id))} · {L("такт", "tick")} {intText(state.tick)}
      </div>
    </Panel>
  );
}