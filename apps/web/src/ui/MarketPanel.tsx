import { useEffect, useMemo, useState } from "react";
import type { ResourceId } from "@sf/sim";
import { findPath, reputationPriceMult, stationReputation, stationPrice } from "@sf/sim";
import { BALANCE } from "@sf/data";
import { Badge, Bar, Btn, Field, KV, Panel, Sep, Tip } from "./controls";
import { L, advOf, fgOf, localMarketOf, MARKET_STATE_RU, send, tr, useLocale, type FullPanelProps } from "./fg";
import { resourceColor, resourceIcon, resourceLabel } from "../game/format";
import { costText, findStation, intText, num, playerEmpire, rnd, safe, worldOf } from "./util";
import { systemName } from "./fg";

type Tab = "market" | "exchange" | "routes";

const GOODS: ResourceId[] = ["energy", "minerals", "food", "alloys", "goods", "unity", "influence", "credits"];

export function MarketPanel({ game, state }: FullPanelProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const fg = fgOf(world);
  const adv = advOf(world, emp?.id ?? 0);
  const stationId = state.activeStationId;
  const station = world ? findStation(world, stationId)?.station ?? null : null;
  const market = localMarketOf(fg, stationId);
  useLocale();
  const [tab, setTab] = useState<Tab>("market");

  if (!world || !emp || !fg) {
    return <Panel title="Рынок" testId="market-panel"><div className="sf-empty">Мир ещё не создан.</div></Panel>;
  }

  const rep = stationId != null ? safe(() => stationReputation(world, emp.id, stationId), 0) : 0;
  const priceMult = reputationPriceMult(rep);
  return (
    <div className="sf-fg-panel" data-testid="market-panel">
      <div className="sf-fg-tabs" role="tablist">
        {([
          ["market", L("Стакан рынка", "Order book")],
          ["exchange", tr("market.galactic", undefined, "Биржа CR ↔ энергия")],
          ["routes", tr("routes.title", undefined, "Торговые маршруты") + " (" + fg.routes.filter((r) => r.empireId === emp.id).length + ")"],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={"sf-tab" + (tab === id ? " sf-tab--on" : "")} onClick={() => setTab(id)}
            data-testid={"btn-market-tab-" + id}>
            {label}
          </button>
        ))}
      </div>

      {tab === "market" && (
        !station || !market ? (
          <div className="sf-empty">
            Нужна станция: откройте экран станции (док).
            <div className="sf-meta">{L("Стакан ордеров и капитал доступны на торговых станциях.", "Order book and capital are available at trade stations.")}</div>
          </div>
        ) : (
          <div className="sf-fg-grid">
            <Panel title={L("Стакан", "Order book") + " · " + station.nameRu} tall
              right={<Badge tone={market.state === "calm" ? "good" : market.state === "boom" ? "info" : "warn"}>{tr("market.state." + market.state, undefined, MARKET_STATE_RU[market.state] ?? market.state)}</Badge>}>
              <div className="sf-grid2">
                <KV k={L("Капитал станции", "Station capital")} v={intText(market.capital) + " " + L("кр.", "cr.")} />
                <KV k={L("Состояние до такта", "State until tick")} v={intText(market.stateUntil)} />
                <KV k={L("Репутация", "Reputation")} v={intText(rep)} className={rep >= 0 ? "sf-ok" : "sf-bad"} />
                <KV k={L("Множитель цены", "Price multiplier")} v={num(priceMult).toFixed(2).replace(".", ",")} />
              </div>
              <Sep />
              <OrderBook market={market} emp={emp.id} world={world} stationId={station.id} game={game} />
            </Panel>
            <Panel title={L("Разместить лимитный ордер", "Place a limit order")} tall>
              <OrderForm game={game} market={market} station={station} empId={emp.id} world={world} />
              <Sep />
              <div className="sf-h">{L("Товары станции", "Station goods")}</div>
              <div className="sf-list">
                {GOODS.filter((g) => market.goods[g] || station.market[g]).map((g) => {
                  const gs = market.goods[g];
                  const sq = station.market[g];
                  const price = safe(() => stationPrice(world, station.id, g, true, emp.id), 0) || sq?.price || 0;
                  return (
                    <div key={g} className="sf-line">
                      <span style={{ color: resourceColor(g), fontWeight: 700 }}>{resourceIcon(g)}</span>
                      <span className="sf-nowrap">{resourceLabel(g)}</span>
                      <span className="sf-spacer" />
                      <span className="sf-meta">{L("кол-во", "qty")} {intText(gs?.qty ?? sq?.stock ?? 0)} · Q* {intText(gs?.eq ?? 0)}</span>
                      <span className="sf-meta">{L("спрос", "demand")} {intText(gs?.demand ?? 0)} / {L("предложение", "supply")} {intText(gs?.supply ?? 0)}</span>
                      <span className="sf-gold">{intText(price)} {L("кр.", "cr.")}</span>
                    </div>
                  );
                })}
              </div>
              <div className="sf-meta" style={{ marginTop: 4 }}>
                {L("Комиссия рынка", "Market fee")} {BALANCE.marketCommissionPct}%, {L("спред", "spread")} {BALANCE.marketSpreadPct}%. {L("Ордер исполняется встречным потоком/капиталом станции.", "Orders execute against counter-flow and station capital.")}
              </div>
            </Panel>
          </div>
        )
      )}

      {tab === "exchange" && <ExchangeView game={game} world={world} empId={emp.id} />}
      {tab === "routes" && (
        <RoutesView game={game} world={world} empId={emp.id} />
      )}
      <div className="sf-meta" style={{ marginTop: 4 }}>
        {L("Капитал империи", "Empire capital")}: {intText(emp.resources.credits)} {L("кр.", "cr.")} · {L("энергия", "energy")}: {intText(emp.resources.energy)} · {L("маршрутов", "routes")}: {intText(fg.routes.length)}
      </div>
    </div>
  );
}

function OrderBook({ market, emp, world, stationId, game }: {
  market: import("@sf/sim").LocalMarket;
  emp: number;
  world: import("@sf/sim").World;
  stationId: number;
  game: FullPanelProps["game"];
}) {
  const asks = useMemo(() => {
    const map = new Map<number, number>();
    for (const o of market.orders) if (o.side === "sell") map.set(o.price, (map.get(o.price) ?? 0) + o.qty);
    return [...map.entries()].sort((a, b) => a[0] - b[0]).slice(0, 6);
  }, [market.orders]);
  const bids = useMemo(() => {
    const map = new Map<number, number>();
    for (const o of market.orders) if (o.side === "buy") map.set(o.price, (map.get(o.price) ?? 0) + o.qty);
    return [...map.entries()].sort((a, b) => b[0] - a[0]).slice(0, 6);
  }, [market.orders]);
  const bestAsk = asks[0]?.[0] ?? 0;
  const bestBid = bids[0]?.[0] ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? ((bestAsk - bestBid) / Math.max(1, bestAsk)) * 100 : 0;
  const mine = market.orders.filter((o) => o.empireId === emp);

  return (
    <div data-testid="order-book">
      <div className="sf-grid2">
        <KV k={L("Лучшая покупка", "Best bid")} v={intText(bestBid) + " " + L("кр.", "cr.")} className="sf-ok" />
        <KV k={L("Лучшая продажа", "Best ask")} v={intText(bestAsk) + " " + L("кр.", "cr.")} className="sf-warn" />
        <KV k={L("Спред", "Spread")} v={spread.toFixed(1).replace(".", ",") + "%"} />
        <KV k={L("Моих ордеров", "My orders")} v={intText(mine.length)} />
      </div>
      <div className="sf-fg-book">
        <div className="sf-fg-book__col">
          <div className="sf-h" style={{ color: "#6BE675" }}>{L("Заявки на покупку", "BID (buy)")}</div>
          {bids.length === 0 && <div className="sf-meta">{L("пусто", "empty")}</div>}
          {bids.map(([price, qty]) => (
            <div key={"b" + price} className="sf-fg-book__row"><span>{intText(price)}</span><span>{intText(qty)}</span></div>
          ))}
        </div>
        <div className="sf-fg-book__col">
          <div className="sf-h" style={{ color: "#FF5A5A" }}>{L("Заявки на продажу", "ASK (sell)")}</div>
          {asks.length === 0 && <div className="sf-meta">{L("пусто", "empty")}</div>}
          {asks.map(([price, qty]) => (
            <div key={"a" + price} className="sf-fg-book__row"><span>{intText(price)}</span><span>{intText(qty)}</span></div>
          ))}
        </div>
      </div>
      <Sep />
      <div className="sf-h">{L("Мои ордера", "My orders")}</div>
      {mine.length === 0 && <div className="sf-meta">{L("Нет размещённых ордеров.", "No orders placed.")}</div>}
      {mine.map((o) => (
        <div key={o.id} className="sf-line" data-testid={"my-order-" + o.id}>
          <Badge tone={o.side === "buy" ? "good" : "bad"}>{o.side === "buy" ? L("ПОКУПКА", "BID") : L("ПРОДАЖА", "ASK")}</Badge>
          <span className="sf-nowrap">{intText(o.price)} {L("кр.", "cr.")} × {intText(o.qty)}</span>
          <span className="sf-meta">с такта {intText(o.createdTick)}</span>
          <span className="sf-spacer" />
          <Btn size="sm" variant="danger" onClick={() => send(game, { type: "market_cancel", stationId, orderId: o.id })} testId={"btn-order-cancel-" + o.id}>{L("Отменить", "Cancel")}</Btn>
        </div>
      ))}
      <div className="sf-meta">{L("Биржа станции", "Station exchange")}: {intText(market.orders.length)} {L("ордеров", "orders")} · {L("капитал", "capital")} {intText(market.capital)} {L("кр.", "cr.")} · {L("такт", "tick")} {world.tick}</div>
    </div>
  );
}

function OrderForm({ game, market, station, empId }: {
  game: FullPanelProps["game"];
  market: import("@sf/sim").LocalMarket;
  station: import("@sf/sim").Station;
  empId: number;
  world: import("@sf/sim").World;
}) {
  const tradeGoods = GOODS.filter((g) => station.market[g]);
  const [good, setGood] = useState<ResourceId>(tradeGoods[0] ?? "energy");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("100");
  const [qty, setQty] = useState("10");
  const p = Math.max(1, rnd(Number(price)));
  const q = Math.max(1, rnd(Number(qty)));
  const goodPrice = station.market[good]?.price ?? 100;
  return (
    <div className="sf-list">
      <Field label={L("Товар", "Good")}>
        <select className="sf-select" value={good} onChange={(e) => setGood(e.target.value as ResourceId)} data-testid="select-order-good">
          {tradeGoods.map((g) => <option key={g} value={g}>{resourceLabel(g)}</option>)}
        </select>
      </Field>
      <Field label={L("Сторона", "Side")}>
        <select className="sf-select" value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")} data-testid="select-order-side">
          <option value="buy">{L("Покупка", "BID — buy")}</option>
          <option value="sell">{L("Продажа", "ASK — sell")}</option>
        </select>
      </Field>
      <div className="sf-grid2">
        <Field label={L("Цена, кр.", "Price, cr.")}><input className="sf-input" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} data-testid="input-order-price" /></Field>
        <Field label={L("Количество", "Quantity")}><input className="sf-input" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} data-testid="input-order-qty" /></Field>
      </div>
      <div className="sf-meta">{L("Ориентир станции", "Station reference")}: {intText(goodPrice)} {L("кр.", "cr.")} · {L("итог ордера", "order total")} {intText(p * q)} {L("кр.", "cr.")}</div>
      <Tip data={{
        title: "Лимитный ордер",
        value: (side === "buy" ? L("ПОКУПКА", "BID") : L("ПРОДАЖА", "ASK")) + " " + intText(p) + " × " + intText(q),
        lines: [
          { label: L("Товар", "Good"), value: resourceLabel(good) },
          { label: L("Номинал", "Notional"), value: intText(p * q) + " " + L("кр.", "cr.") },
          { label: L("Исполнение", "Execution"), value: L("против встречных ордеров и капитала станции", "against counter-orders and station capital") },
        ],
        note: L("Лимитная цена — ваша граница сделки; исполняется по лучшей встречной цене.", "The limit price is your trade boundary; execution happens at the best counter price."),
      }}>
        <Btn variant="primary" onClick={() => send(game, { type: "market_order", stationId: station.id, good, side, price: p, qty: q })} testId="btn-place-order">
          {L("Разместить ордер", "Place order")}
        </Btn>
      </Tip>
      <div className="sf-meta">{L("Свободный капитал", "Available capital")}: {intText(market.capital)} {L("кр. станции", "station cr.")} · {L("игрок", "player")}: {empId}</div>
    </div>
  );
}

function ExchangeView({ game, world, empId }: { game: FullPanelProps["game"]; world: import("@sf/sim").World; empId: number }) {
  const fg = fgOf(world);
  const exchange = fg?.exchange;
  const emp = world.empires.find((e) => e.id === empId);
  const [qty, setQty] = useState("10");
  const [limit, setLimit] = useState("");
  const q = Math.max(1, rnd(Number(qty)));
  const rate = num(exchange?.rate ?? 1);
  const history = exchange?.history ?? [];
  if (!exchange || !emp) {
    return <Panel title="Биржа"><div className="sf-empty">Нет данных биржи.</div></Panel>;
  }
  const maxHist = Math.max(...history, 1.2);
  return (
    <div className="sf-fg-grid" data-testid="exchange-panel">
      <Panel title={tr("market.galactic", undefined, "Биржа CR ↔ энергия")} tall
        right={<Badge tone={rate >= 1 ? "good" : "warn"}>{rate.toFixed(2).replace(".", ",")}</Badge>}>
        <div className="sf-row" style={{ alignItems: "baseline" }}>
          <span className="sf-hud-num">{rate.toFixed(2).replace(".", ",")}</span>
          <span className="sf-meta">кр. за 1 энергию · коридор 0.80…1.20</span>
        </div>
        <div className="sf-fg-spark" data-testid="exchange-chart" aria-label="История курса">
          {history.slice(-30).map((v, i) => {
            const h = Math.max(4, Math.min(100, (num(v) / maxHist) * 100));
            return <i key={i} style={{ height: h + "%", background: num(v) >= 1 ? "#6BE675" : "#F08A24" }} />;
          })}
          {history.length === 0 && <span className="sf-meta">история ещё не накоплена</span>}
        </div>
        <div className="sf-grid2">
          <KV k={L("Объём", "Volume")} v={intText(exchange.volume)} />
          <KV k={L("Ордеров", "Orders")} v={intText(exchange.orders.length)} />
          <KV k={L("Кредиты", "Credits")} v={intText(emp.resources.credits)} />
          <KV k={L("Энергия", "Energy")} v={intText(emp.resources.energy)} />
        </div>
        <Sep />
        <div className="sf-row" style={{ flexWrap: "wrap", gap: 4 }}>
          <input className="sf-input" style={{ width: 90 }} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} aria-label={L("Количество для биржи", "Exchange quantity")} data-testid="input-exchange-qty" />
          <input className="sf-input" style={{ width: 90 }} value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={L("лимит", "limit")} aria-label={L("Лимит курса", "Rate limit")} data-testid="input-exchange-limit" />
          <Btn variant="primary" onClick={() => send(game, { type: "exchange_trade", side: "buy", qty: q, limitRate: limit ? num(Number(limit)) : undefined })} testId="btn-exchange-buy">
            {L("Купить энергию", "Buy energy")}
          </Btn>
          <Btn onClick={() => send(game, { type: "exchange_trade", side: "sell", qty: q, limitRate: limit ? num(Number(limit)) : undefined })} testId="btn-exchange-sell">
            {L("Продать энергию", "Sell energy")}
          </Btn>
        </div>
        <div className="sf-meta">
          {L("Сделка", "Trade")} {intText(q)} {L("ед.", "u.")} ≈ {intText(q * rate)} {L("кр.", "cr.")} · {L("лимит защищает от проскальзывания курса.", "the limit protects against rate slippage.")}
        </div>
      </Panel>
      <Panel title={L("Как работает биржа", "How the exchange works")} tall>
        <div className="sf-meta">
          {L("Курс колеблется в коридоре 0.8…1.2 вокруг паритета 1 кредит = 1 энергия.", "The rate fluctuates within 0.8…1.2 around parity 1 credit = 1 energy.")}
          {L("Арбитраж между станциями и биржей — легальная стратегия.", "Arbitrage between stations and the exchange is a legal strategy.")}
        </div>
        <Sep />
        <div className="sf-list">
          {exchange.orders.slice(0, 8).map((o) => (
            <div key={o.id} className="sf-line">
              <Badge tone={o.side === "buy" ? "good" : "bad"}>{o.side === "buy" ? L("ПОКУПКА", "BUY") : L("ПРОДАЖА", "SELL")}</Badge>
              <span>{intText(o.qty)} ед. по {num(o.price).toFixed(2).replace(".", ",")}</span>
              <span className="sf-spacer" />
              <span className="sf-meta">{L("до такта", "until tick")} {intText(o.expiresTick)}</span>
            </div>
          ))}
          {exchange.orders.length === 0 && <div className="sf-meta">{L("Ордеров нет.", "No orders.")}</div>}
        </div>
      </Panel>
    </div>
  );
}

function RoutesView({ game, world, empId }: { game: FullPanelProps["game"]; world: import("@sf/sim").World; empId: number }) {
  const fg = fgOf(world);
  const routes = (fg?.routes ?? []).filter((r) => r.empireId === empId);
  const known = world.systems.filter((s) => s.knownBy.includes(empId));
  const owned = known.filter((s) => s.ownerId === empId);
  const capitalId = world.empires.find((e) => e.id === empId)?.capitalSystemId ?? owned[0]?.id ?? known[0]?.id ?? 0;
  const tradeGoods = GOODS.filter((g) => known.some((s) => s.station?.market[g]));
  const [good, setGood] = useState<ResourceId>(tradeGoods[0] ?? "minerals");
  const [from, setFrom] = useState<string>(String(capitalId));
  const destSystems = known.filter((s) => s.station?.market[good] && s.id !== rnd(Number(from))
    && (findPath(world, rnd(Number(from)), s.id)?.length ?? 0) > 0);
  const [to, setTo] = useState<string>(String(destSystems[0]?.id ?? ""));
  const [qty, setQty] = useState("20");
  const [sellAtDest, setSellAtDest] = useState(true);
  useEffect(() => {
    if (!destSystems.some((s) => s.id === rnd(Number(to)))) setTo(String(destSystems[0]?.id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [good, from]);
  const fromSys = world.systems.find((s) => s.id === rnd(Number(from)));
  const toSys = world.systems.find((s) => s.id === rnd(Number(to)));
  const risk = fromSys && toSys ? Math.min(90, Math.abs((toSys.hopsFromCapital ?? 0) - (fromSys.hopsFromCapital ?? 0)) * 6) : 0;
  return (
    <div className="sf-fg-grid" data-testid="routes-panel">
      <Panel title={tr("routes.title", undefined, "Маршруты") + " · " + routes.length} tall>
        {routes.length === 0 && (
          <div className="sf-empty">
            {L("Маршрутов нет.", "No routes.")}
            <div className="sf-meta">{L("Создайте маршрут справа: груз идёт по системам, прибыль начисляется на такте.", "Create a route on the right: cargo travels between systems and profit accrues each tick.")}</div>
          </div>
        )}
        {routes.map((r) => (
          <div key={r.id} className="sf-fg-route" data-testid={"route-row-" + r.id}>
            <div className="sf-row">
              <b className="sf-nowrap">{systemName(world, r.fromSystemId)} → {systemName(world, r.toSystemId)}</b>
              <span className="sf-spacer" />
              <Badge tone={r.active ? "good" : "warn"}>{r.active ? L("активен", "active") : L("в пути", "en route")}</Badge>
            </div>
            <div className="sf-meta">
              {resourceLabel(r.good)} · {intText(r.qty)} ед. · {r.sellAtDest ? "продажа в точке Б" : "доставка"} ·
              {" "}{L("тактов осталось", "ticks left")} {intText(r.ticksLeft)} · {L("профит", "profit")} {intText(r.profitLast)} {L("кр./такт", "cr./tick")}
            </div>
            <div className="sf-row" style={{ gap: 4 }}>
              <Btn size="sm" variant="danger" onClick={() => send(game, { type: "route_cancel", routeId: r.id })} testId={"btn-route-cancel-" + r.id}>{L("Отменить", "Cancel")}</Btn>
            </div>
          </div>
        ))}
      </Panel>
      <Panel title={tr("routes.create", undefined, "Новый маршрут")} tall>
        <Field label={L("Откуда", "From")}>
          <select className="sf-select" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="select-route-from">
            {owned.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={L("Куда", "To")}>
          <select className="sf-select" value={to} onChange={(e) => setTo(e.target.value)} data-testid="select-route-to">
            {destSystems.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.station?.nameRu ?? "станция"}</option>)}
          </select>
        </Field>
        <Field label={L("Товар", "Good")}>
          <select className="sf-select" value={good} onChange={(e) => setGood(e.target.value as ResourceId)} data-testid="select-route-good">
            {tradeGoods.map((g) => <option key={g} value={g}>{resourceLabel(g)}</option>)}
          </select>
        </Field>
        <div className="sf-grid2">
          <Field label={L("Количество", "Quantity")}><input className="sf-input" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} data-testid="input-route-qty" /></Field>
          <Field label={L("Продавать в Б", "Sell at B")}>
            <select className="sf-select" value={sellAtDest ? "1" : "0"} onChange={(e) => setSellAtDest(e.target.value === "1")} data-testid="select-route-sell">
              <option value="1">{L("да", "yes")}</option>
              <option value="0">{L("нет", "no")}</option>
            </select>
          </Field>
        </div>
        <div className="sf-meta">
          {L("Оценка риска", "Risk estimate")}: {intText(risk)}% ({L("пираты и дальность", "pirates and distance")}) · {L("систем в прыжках", "systems in jumps")}: {intText(Math.abs((toSys?.hopsFromCapital ?? 0) - (fromSys?.hopsFromCapital ?? 0)))}
        </div>
        {owned.length === 0 && <div className="sf-warn">Нужна своя система-источник (столица или колония).</div>}
        {owned.length > 0 && destSystems.length === 0 && <div className="sf-warn">Нет известной станции, торгующей этим товаром. Выберите другой товар или исследуйте системы.</div>}
        <Tip data={{
          title: "Торговый маршрут",
          value: fromSys && toSys ? fromSys.name + " → " + toSys.name : "выберите системы",
          lines: [
            { label: "Товар", value: resourceLabel(good) + " × " + intText(rnd(Number(qty))) },
            { label: "Риск", value: intText(risk) + "%" },
            { label: "Прибыль", value: "считается по ценам точек А/Б на такте" },
          ],
          note: "Маршрут занимает флот/груз и приносит прибыль каждый такт.",
          consequence: fromSys?.id === toSys?.id ? "Точки А и Б должны различаться." : "Можно создать маршрут.",
        }}>
          <Btn variant="primary" disabled={!fromSys || !toSys || fromSys.id === toSys.id}
            title={owned.length === 0 ? L("Нужна своя система-источник", "A source system is required") : destSystems.length === 0 ? L("Нет известной станции, торгующей этим товаром", "No known station trades this good") : L("Создать маршрут", "Create route")}
            onClick={() => send(game, { type: "route_create", fromSystemId: fromSys?.id ?? 0, toSystemId: toSys?.id ?? 0, good, qty: Math.max(1, rnd(Number(qty))), sellAtDest })}
            testId="btn-route-create">
            {tr("routes.create", undefined, "Создать маршрут")}
          </Btn>
        </Tip>
        <div className="sf-meta" style={{ marginTop: 6 }}>
          {L("Всего маршрутов в галактике", "Routes in the galaxy")}: {intText(fg?.routes.length ?? 0)} · {L("ваших", "yours")}: {intText(routes.length)}
        </div>
      </Panel>
    </div>
  );
}
