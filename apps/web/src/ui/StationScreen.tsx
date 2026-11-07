import { useEffect, useMemo, useState } from "react";
import { BALANCE, DESIGNS, MISSION_BY_ID } from "@sf/data";
import { RESOURCE_ORDER } from "@sf/sim";
import type { ResourceId } from "@sf/sim";
import type { Game } from "../game/Game";
import { pathfinderStockAt } from "@sf/sim";
import type { GameState } from "../game/types";
import { resourceColor, resourceIcon, resourceLabel } from "../game/format";
import { Badge, Bar, Btn, KV, Panel, Sep, TabBar } from "./controls";
import { ContractsPanel } from "./ContractsPanel";
import { MarketPanel } from "./MarketPanel";
import { ShipDesignerPanel } from "./ShipDesignerPanel";
import { DlcBoardPanel } from "./JournalPanel";
import { fgOf, L, STATION_KIND_EN, tr } from "./fg";
import {
  canAfford, costText, empireFleetPower, findStation, fleetCap, fleetsInSystem, FLEET_STATUS_RU, MISSION_RU, playerEmpire, STATION_RU, ticksRu, worldOf, intText, rnd } from "./util";

type Tab = "market" | "trade" | "contracts" | "board" | "shipyard" | "designer" | "repair";

export function StationScreen({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const found = world ? findStation(world, state.activeStationId) : null;
  const [tab, setTab] = useState<Tab>("market");
  const [qty, setQty] = useState<Record<string, number>>({});
  // Из галактики можно состыковаться напрямую (кнопка в инспекторе): тогда «отстыковка» = назад на карту.
  const undock = () => {
    if (state.activeSystemId == null) game.exitToGalaxy();
    else game.undock();
  };

  useEffect(() => {
    setQty({});
    setTab("market");
  }, [state.activeStationId]);

  if (!world || !emp || !found) {
    return (
      <div className="sf-station" data-testid="station-screen">
        <div className="sf-station-head">
          <b>{L("Станция недоступна", "Station unavailable")}</b>
          <span className="sf-spacer" />
          <Btn onClick={undock} testId="btn-undock">{tr("station.undock", undefined, "Отстыковаться")}</Btn>
        </div>
        <div className="sf-empty">{L("Станция не найдена. Вернитесь на карту и состыкуйтесь заново.", "Station not found. Return to the map and dock again.")}</div>
      </div>
    );
  }

  const { station, system } = found;
  const owner = station.ownerId === 0 ? L("Нейтральная", "Neutral") : (world.empires.find((e) => e.id === station.ownerId)?.name ?? "—");
  const fleetsHere = fleetsInSystem(game, system.id);
  const goods = (Object.keys(station.market) as ResourceId[]).sort(
    (a, b) => RESOURCE_ORDER.indexOf(a) - RESOURCE_ORDER.indexOf(b),
  );
  const commission = BALANCE.marketCommissionPct;
  const spread = BALANCE.marketSpreadPct;
  const fleetPower = empireFleetPower(world, emp.id);
  const fleetLimit = fleetCap(world, emp.id);

  const setRowQty = (id: string, next: number) => {
    setQty((prev) => ({ ...prev, [id]: Math.max(1, Math.min(10000, rnd(next))) }));
  };
  const rowQty = (id: string) => qty[id] ?? 1;

  const missions = world.missions
    .filter((m) => m.stationId === station.id || m.systemId === system.id)
    .filter((m) => !m.completed && !m.failed);
  const pathfinderStock = pathfinderStockAt(world, system.id) ? 1 : 0;
  const designs = DESIGNS.filter((d) => {
    const techOk = !d.requiredTech || emp.techs.completed.includes(d.requiredTech);
    return (techOk || (d.id === "pathfinder_ark" && pathfinderStock > 0)) && (d.classId === "flagship" ? false : true);
  });

  return (
    <div className="sf-station" data-testid="station-screen">
      <div className="sf-station-head">
        <span className="sf-gold" style={{ fontSize: "1.1em", fontWeight: 700 }}>◈ {station.nameRu}</span>
        <Badge tone="info">{L(STATION_RU[station.kind] ?? station.kind, STATION_KIND_EN[station.kind] ?? station.kind)}</Badge>
        <span className="sf-meta">{system.name} · {owner}</span>
        <div style={{ minWidth: 140 }}>
          <Bar v01={station.maxHp > 0 ? station.hp / station.maxHp : 0} tone="sf-bar--ok" thin />
        </div>
        <span className="sf-spacer" />
        <span className="sf-meta">{L("Кредиты", "Credits")}: <b className="sf-gold">{intText(emp.resources.credits ?? 0)} {L("кр.", "cr.")}</b></span>
        <Btn variant="primary" onClick={undock} testId="btn-undock">{tr("station.undock", undefined, "Отстыковаться")}</Btn>
      </div>

      <div className="sf-station-body">
        <TabBar
          value={tab}
          onChange={(id) => setTab(id as Tab)}
          testId="station-tabs"
          items={[
            { id: "market", label: tr("station.market", undefined, "Рынок"), testId: "tab-market" },
            { id: "trade", label: L("Торговля", "Trade"), testId: "tab-trade" },
            { id: "contracts", label: tr("station.missions", undefined, "Контракты"), testId: "tab-contracts" },
            { id: "board", label: L("Доска", "Board"), testId: "tab-board" },
            { id: "shipyard", label: tr("station.shipyard", undefined, "Верфь"), testId: "tab-shipyard" },
            { id: "designer", label: L("Конструктор", "Designer"), testId: "tab-designer" },
            { id: "repair", label: tr("station.repair", undefined, "Ремонт"), testId: "tab-repair" },
          ]}
        />

        <div className="sf-station-content">
          {tab === "market" && (
            <Panel title={tr("market.station", undefined, "Рынок станции")} flat testId="market-panel">
              <div className="sf-meta" style={{ marginBottom: 4 }}>
                {L("Спред", "Spread")} {spread}% · {L("комиссия", "fee")} {commission}% · {L("цены в кредитах за единицу", "prices in credits per unit")}.
              </div>
              {goods.length === 0 ? (
                <div className="sf-empty">{L("Рынок пуст: идёт блокада или торговля недоступна.", "Market empty: blockade or trading unavailable.")}</div>
              ) : (
                <table className="sf-table">
                  <thead>
                    <tr>
                      <th>{L("Ресурс", "Resource")}</th>
                      <th className="sf-num">{L("Сток", "Stock")}</th>
                      <th className="sf-num">{tr("market.price", undefined, "Цена")}</th>
                      <th>{L("Количество", "Quantity")}</th>
                      <th className="sf-num">{L("Сделка", "Deal")}</th>
                      <th>{L("Действия", "Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goods.map((good) => {
                      const g = station.market[good]!;
                      const n = rowQty(good);
                      const gross = g.price * n;
                      const fee = rnd((gross * commission) / 100);
                      const buyTotal = gross + fee;
                      const sellTotal = Math.max(0, gross - fee);
                      const canBuy = (emp.resources.credits ?? 0) >= buyTotal && g.stock >= n;
                      const canSell = (emp.resources[good] ?? 0) >= n;
                      return (
                        <tr key={good} data-testid={"market-row-" + good}>
                          <td>
                            <span style={{ color: resourceColor(good), fontWeight: 700 }}>{resourceIcon(good)}</span>{" "}
                            {resourceLabel(good)}
                          </td>
                          <td className="sf-num">{intText(g.stock)}</td>
                          <td className="sf-num">{intText(g.price)} {L("кр.", "cr.")}</td>
                          <td>
                            <div className="sf-market-actions">
                              <Btn size="sm" onClick={() => setRowQty(good, n - 100)} disabled={n <= 1} ariaLabel="−100">−100</Btn>
                              <Btn size="sm" onClick={() => setRowQty(good, n - 10)} disabled={n <= 1} ariaLabel="−10">−10</Btn>
                              <Btn size="sm" onClick={() => setRowQty(good, n - 1)} disabled={n <= 1} ariaLabel="−1">−</Btn>
                              <input
                                className="sf-input"
                                style={{ width: 64, textAlign: "right" }}
                                value={n}
                                onChange={(e) => setRowQty(good, Number(e.target.value.replace(/[^0-9]/g, "")) || 1)}
                                aria-label={L("Количество", "Quantity") + " " + resourceLabel(good)}
                                data-testid={"qty-" + good}
                              />
                              <Btn size="sm" onClick={() => setRowQty(good, n + 1)} ariaLabel="+1">+</Btn>
                              <Btn size="sm" onClick={() => setRowQty(good, n + 10)} ariaLabel="+10">+10</Btn>
                              <Btn size="sm" onClick={() => setRowQty(good, n + 100)} ariaLabel="+100">+100</Btn>
                            </div>
                          </td>
                          <td className="sf-num">
                            <div>{intText(gross)} {L("кр.", "cr.")}</div>
                            <div className="sf-meta">{L("комиссия", "fee")} {intText(fee)}</div>
                          </td>
                          <td>
                            <div className="sf-market-actions">
                              <Btn
                                size="sm"
                                variant="primary"
                                disabled={!canBuy}
                                title={canBuy ? tr("station.marketBuy", undefined, "Купить") + " " + intText(buyTotal) + " " + L("кр.", "cr.") : L("Не хватает кредитов или стока", "Not enough credits or stock")}
                                onClick={() => {
                                  game.sendCommand({ type: "trade", stationId: station.id, good, qty: n, buy: true });
                                  setRowQty(good, 1);
                                }}
                                testId={"btn-buy-" + good}
                              >
                                {tr("station.marketBuy", undefined, "Купить")} · {intText(buyTotal)}
                              </Btn>
                              <Btn
                                size="sm"
                                disabled={!canSell}
                                title={canSell ? tr("station.marketSell", undefined, "Продать") + ": " + intText(sellTotal) + " " + L("кр.", "cr.") : L("Нет товара в империи", "No goods in the empire")}
                                onClick={() => {
                                  game.sendCommand({ type: "trade", stationId: station.id, good, qty: n, buy: false });
                                  setRowQty(good, 1);
                                }}
                                testId={"btn-sell-" + good}
                              >
                                {tr("station.marketSell", undefined, "Продать")} · {intText(sellTotal)}
                              </Btn>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="sf-row" style={{ marginTop: 6 }}>
                <span className="sf-meta">{L("Империя", "Empire")}: {RESOURCE_ORDER.map((id) => (
                  <span key={id} style={{ marginRight: 8 }}>
                    <span style={{ color: resourceColor(id) }}>{resourceIcon(id)}</span> {intText(emp.resources[id] ?? 0)}
                  </span>
                ))}</span>
              </div>
            </Panel>
          )}

          {tab === "trade" && (
            <MarketPanel game={game} state={state} onClose={undock} />
          )}

          {tab === "contracts" && (
            <ContractsPanel game={game} state={state} onClose={undock} />
          )}

          {tab === "board" && <DlcBoardPanel game={game} state={state} />}

          {tab === "shipyard" && (
            <Panel title={tr("station.shipyard", undefined, "Верфь") + " · " + intText(fleetPower) + "/" + intText(fleetLimit) + " FP"} flat testId="shipyard-panel"
              right={<Btn size="sm" variant="primary" onClick={() => setTab("designer")} testId="btn-open-designer">{L("Собрать свой корабль", "Design a ship")}</Btn>}>
              {!station.hasShipyard ? (
                <div className="sf-empty">{L("У станции нет верфи. Найдите станцию с верфью.", "This station has no shipyard.")}</div>
              ) : (
                <div className="sf-list">
                  {designs.length === 0 && <div className="sf-empty">{L("Нет доступных проектов: нужны технологии.", "No available designs: technologies required.")}</div>}
                  {designs.map((d) => {
                    const techOk = !d.requiredTech || emp.techs.completed.includes(d.requiredTech);
                    const buyOnly = !techOk && d.id === "pathfinder_ark" && pathfinderStock > 0;
                    // Империя строит корабли за сплавы (канон §9.1): симуляция списывает только сплавы.
                    // Кредитная цена верфи — справочная (для свободного полёта/будущей покупки за кредиты).
                    const cost = { alloys: d.costAlloys };
                    const alloysOk = canAfford(world, emp.id, cost as Record<ResourceId, number>);
                    const capOk = fleetPower + d.fleetPower <= fleetLimit;
                    const afford = alloysOk && capOk;
                    return (
                      <div key={d.id} className="sf-line" style={{ alignItems: "flex-start" }}>
                        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                          <div className="sf-row">
                            <b className="sf-nowrap">{d.ru}</b>
                            <span className="sf-spacer" />
                            <span className="sf-meta">{d.classId} · {d.fleetPower} FP</span>
                          </div>
                          <div className="sf-meta">{d.descRu}</div>
                          <div className="sf-meta">
                            {costText(cost)} · {L("цена верфи", "shipyard price")} {intText(d.costCredits)} {L("кр.", "cr.")} · {d.buildTicks} {ticksRu(d.buildTicks)}
                            {!techOk ? " · " + L("нужна технология", "technology required") : ""}
                          </div>
                        </div>
                        <Btn
                          size="sm"
                          variant={afford && techOk ? "primary" : "default"}
                          disabled={!afford || (!techOk && !buyOnly)}
                          onClick={() => game.sendCommand({ type: "build_ship", systemId: system.id, designId: d.id, count: 1, buy: buyOnly } as never)}
                          testId={"btn-build-ship-" + d.id}
                          title={buyOnly ? L("Купить rare-корабль на верфи; строительство недоступно без технологии", "Buy a rare ship at the shipyard; construction requires technology") : afford ? L("Построить 1 корабль за сплавы", "Build 1 ship for alloys") : !capOk ? L("Лимит флота", "Fleet cap") + ": " + fleetPower + "/" + fleetLimit + " FP, +" + d.fleetPower : L("Не хватает сплавов", "Not enough alloys")}
                        >
                          {buyOnly ? L("Купить", "Buy") : L("Построить", "Build")}
                        </Btn>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {tab === "designer" && (
            <ShipDesignerPanel game={game} state={state} onClose={() => setTab("shipyard")} />
          )}

          {tab === "repair" && (
            <Panel title={tr("station.repair", undefined, "Ремонт") + " · " + L("флоты в системе", "fleets in system")} flat testId="repair-panel">
              {fleetsHere.length === 0 ? (
                <div className="sf-empty">{L("В системе нет ваших флотов для ремонта.", "No fleets to repair here.")}</div>
              ) : (
                <div className="sf-list">
                  {fleetsHere.map((f) => {
                    const avg = f.ships.length > 0
                      ? f.ships.reduce((a, s) => a + (s.hullMax > 0 ? s.hull / s.hullMax : 0), 0) / f.ships.length
                      : 0;
                    return (
                      <div key={f.id} className="sf-line" style={{ alignItems: "center" }}>
                        <span className="sf-nowrap">{f.name}</span>
                        <span className="sf-meta">{FLEET_STATUS_RU[f.status] ?? f.status}</span>
                        <span className="sf-spacer" />
                        <span className="sf-meta">{f.ships.length} {L("кор.", "ships")} · {L("корпус", "hull")} {rnd(avg * 100)}%</span>
                        <Btn
                          size="sm"
                          variant="primary"
                          onClick={() => game.sendCommand({ type: "repair_fleet", fleetId: f.id })}
                          testId={"btn-repair-" + f.id}
                        >
                          {tr("station.repair", undefined, "Ремонт")}
                        </Btn>
                      </div>
                    );
                  })}
                </div>
              )}
              <Sep />
              <div className="sf-meta">{L("Ремонт восстанавливает корпус за кредиты; цена зависит от урона.", "Repair restores hull for credits; the price depends on damage.")}</div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}