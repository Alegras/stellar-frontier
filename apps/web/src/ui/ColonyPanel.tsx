import type { Colony } from "@sf/sim";
import { BUILDINGS, DISTRICTS } from "@sf/data";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import { resourceLabel } from "../game/format";
import { Badge, Bar, Btn, KV, Panel, Sep, Tip } from "./controls";
import {
  buildCost, canAfford, colonyOutput, costText, findColonyByPlanet, PLANET_RU, playerEmpire, playerColonies, popsOf, ticksRu, worldOf, intText, signedText, milliText, rnd } from "./util";
import type { ResourceId } from "@sf/sim";
import { L, tr } from "./fg";

export function ColonyPanel({
  game, state, colony: colonyProp,
}: { game: Game; state: GameState; colony?: Colony | null }) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const colony = colonyProp !== undefined
    ? colonyProp
    : world
      ? findColonyByPlanet(world, state.selectedPlanetId)
      : null;

  if (!world || !emp) {
    return <Panel title={L("Колония", "Colony")} testId="colony-panel"><div className="sf-empty">{L("Нет мира.", "No world.")}</div></Panel>;
  }

  if (!colony) {
    const list = playerColonies(world);
    return (
      <Panel title={L("Колонии", "Colonies") + " · " + list.length} testId="colony-panel" tall>
        {list.length === 0 ? (
          <div className="sf-empty">
            {L("Империя ещё не основала колоний.", "The empire has no colonies yet.")}
            <div className="sf-meta">{L("Выберите систему, отправьте колонизатор и колонизируйте планету.", "Select a system, send a colonizer and colonize a planet.")}</div>
          </div>
        ) : (
          <div className="sf-list">
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                className="sf-line sf-line--pick"
                onClick={() => game.selectPlanet(c.planetId)}
                title={L("Открыть колонию", "Open colony")}
              >
                <span className="sf-nowrap">{c.name}</span>
                <span className="sf-spacer" />
                <span className="sf-meta">{intText(popsOf(c))} {L("попов", "pops")}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  if (colony.empireId !== emp.id) {
    return (
      <Panel title="Колония" testId="colony-panel">
        <div className="sf-empty">{L("Это колония другой империи — управление недоступно.", "This colony belongs to another empire.")}</div>
      </Panel>
    );
  }

  const out = colonyOutput(world, colony);
  const totalPops = popsOf(colony);
  const housingUse = colony.housing > 0 ? totalPops / colony.housing : 0;
  const jobs = colony.jobs.reduce((a, j) => a + j.count, 0);
  const planet = world.systems.flatMap((s) => s.planets).find((p) => p.id === colony.planetId);

  const netRows = (Object.keys(out.output) as ResourceId[])
    .map((id) => ({ id, net: (out.output[id] ?? 0) - (out.upkeep[id] ?? 0), gross: out.output[id] ?? 0, up: out.upkeep[id] ?? 0 }))
    .filter((r) => r.gross !== 0 || r.up !== 0);

  return (
    <Panel
      title={colony.name}
      right={<Badge tone={colony.stability >= 50 ? "good" : colony.stability >= 25 ? "warn" : "bad"}>{rnd(colony.stability)}% {L("стаб.", "stab.")}</Badge>}
      testId="colony-panel"
      tall
    >
      <div className="sf-meta">
        {planet ? (PLANET_RU[planet.type] ?? planet.type) + " · " : ""}{L("попов", "pops")} {intText(totalPops)} · {L("жильё", "housing")} {intText(colony.housing)}
        {colony.unemployedWarn ? " · ⚠ " + L("безработные", "unemployed") : ""}
      </div>

      <div className="sf-grid2">
        <KV k={L("Рабочие", "Workers")} v={intText(colony.pops.workers)} />
        <KV k={L("Специалисты", "Specialists")} v={intText(colony.pops.specialists)} />
        <KV k={L("Правители", "Rulers")} v={intText(colony.pops.rulers)} />
        <KV k={L("Безработные", "Unemployed")} v={intText(colony.pops.unemployed)} />
        <KV k={L("Рабочих мест", "Jobs")} v={intText(jobs)} />
        <KV k={L("Преступность", "Crime")} v={rnd(colony.crime) + "%"} />
      </div>

      <Sep />
      <div className="sf-h">{L("Жильё и порядок", "Housing and order")}</div>
      <Tip data={{
        title: L("Жильё", "Housing"),
        value: totalPops + " / " + colony.housing + " " + L("попов", "pops"),
        note: "Жилой район даёт +5 жилья. Нехватка жилья останавливает рост.",
      }}>
        <div className="sf-hud-gauge" style={{ width: "100%" }}>
          <span className="sf-meta" style={{ width: 56 }}>{L("жильё", "housing")}</span>
          <Bar v01={housingUse} tone={housingUse > 1 ? "sf-bar--bad" : housingUse > 0.85 ? "sf-bar--warn" : "sf-bar--ok"} />
          <span style={{ width: 54, textAlign: "right", fontSize: ".85em" }}>{totalPops}/{colony.housing}</span>
        </div>
      </Tip>
      <div className="sf-hud-gauge" style={{ width: "100%" }}>
        <span className="sf-meta" style={{ width: 56 }}>{L("стаб.", "stab.")}</span>
        <Bar v01={colony.stability / 100} tone={colony.stability >= 50 ? "sf-bar--ok" : colony.stability >= 25 ? "sf-bar--warn" : "sf-bar--bad"} />
        <span style={{ width: 54, textAlign: "right", fontSize: ".85em" }}>{rnd(colony.stability)}%</span>
      </div>
      <div className="sf-hud-gauge" style={{ width: "100%" }}>
        <span className="sf-meta" style={{ width: 56 }}>{L("прест.", "crime")}</span>
        <Bar v01={colony.crime / 100} tone={colony.crime > 40 ? "sf-bar--bad" : colony.crime > 20 ? "sf-bar--warn" : "sf-bar--ok"} />
        <span style={{ width: 54, textAlign: "right", fontSize: ".85em" }}>{rnd(colony.crime)}%</span>
      </div>

      {netRows.length > 0 && (
        <>
          <Sep />
          <div className="sf-h">{L("Выход / потребление (за такт)", "Output / upkeep (per tick)")}</div>
          <div className="sf-grid2">
            {netRows.slice(0, 10).map((r) => (
              <Tip key={r.id} data={{
                title: resourceLabel(r.id),
                value: signedText(r.net / 1000, 1) + " " + resourceLabel(r.id).toLowerCase() + "/такт",
                lines: [
                  { label: "Производство", value: milliText(r.gross) },
                  { label: "Апкип", value: "−" + milliText(r.up) },
                ],
              }}>
                <div className="sf-kv">
                  <span className="sf-dim">{resourceLabel(r.id)}</span>
                  <b className={r.net >= 0 ? "sf-ok" : "sf-bad"}>{signedText(r.net / 1000, 1)}</b>
                </div>
              </Tip>
            ))}
          </div>
        </>
      )}

      <Sep />
      <div className="sf-h">{L("Районы", "Districts")}</div>
      <div className="sf-list">
        {DISTRICTS.map((d) => {
          const count = colony.districts[d.id] ?? 0;
          const cost = buildCost(world, "district", d.id);
          const afford = canAfford(world, emp.id, cost);
          return (
            <div key={d.id} className="sf-line" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div className="sf-row">
                  <span className="sf-nowrap">{d.ru}</span>
                  <span className="sf-spacer" />
                  <span className="sf-meta">×{count}</span>
                </div>
                <div className="sf-meta">
                  {costText(cost)} · {d.buildTicks} {ticksRu(d.buildTicks)} · жильё +{d.housing}
                  {d.upkeepEnergy > 0 ? " · апкип " + d.upkeepEnergy + " эн." : ""}
                </div>
              </div>
              <Tip data={{
                title: d.ru,
                value: costText(cost),
                lines: [
                  { label: "Время", value: d.buildTicks + " " + ticksRu(d.buildTicks) },
                  { label: "Жильё", value: "+" + d.housing },
                  { label: "Рабочие места", value: d.jobs.length > 0 ? d.jobs.join(", ") : "—" },
                  { label: "Апкип", value: d.upkeepEnergy + " эн./такт" },
                ],
                note: d.descRu,
                consequence: afford ? "Можно построить." : "Не хватает ресурсов: " + costText(cost) + ".",
              }}>
                <Btn
                  size="sm"
                  variant={afford ? "primary" : "default"}
                  disabled={!afford}
                  onClick={() => game.sendCommand({ type: "build_district", colonyId: colony.id, districtId: d.id })}
                  testId={"btn-build-" + d.id}
                >
                  {L("Построить", "Build")}
                </Btn>
              </Tip>
            </div>
          );
        })}
      </div>

      <Sep />
      <div className="sf-h">{L("Здания", "Buildings")}</div>
      <div className="sf-list">
        {BUILDINGS.map((b) => {
          const count = colony.buildings.filter((x) => x === b.id).length;
          const max = b.maxPerColony ?? 99;
          const techOk = !b.requiredTech || emp.techs.completed.includes(b.requiredTech);
          const full = count >= max;
          const cost = buildCost(world, "building", b.id);
          const afford = canAfford(world, emp.id, cost);
          const reason = !techOk ? L("Нужна технология", "Technology required") : full ? L("Достигнут лимит", "Limit reached") : !afford ? L("Не хватает ресурсов", "Not enough resources") : "";
          return (
            <div key={b.id} className="sf-line" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div className="sf-row">
                  <span className="sf-nowrap">{b.ru}</span>
                  <span className="sf-spacer" />
                  <span className="sf-meta">×{count}/{max === 99 ? "∞" : max}</span>
                </div>
                <div className="sf-meta">
                  {costText(cost)} · {b.buildTicks} {ticksRu(b.buildTicks)}
                  {b.science ? " · наука +" + Object.values(b.science).reduce((a, v) => a + (v ?? 0), 0) : ""}
                </div>
              </div>
              <Tip data={{
                title: b.ru,
                value: costText(cost),
                lines: [
                  { label: "Время", value: b.buildTicks + " " + ticksRu(b.buildTicks) },
                  { label: "Апкип", value: b.upkeepEnergy + " эн./такт" },
                  { label: "Рабочие места", value: b.jobs.length > 0 ? b.jobs.join(", ") : "—" },
                  { label: "Наука", value: b.science ? Object.entries(b.science).map(([k, v]) => k + " +" + v).join(", ") : "—" },
                ],
                note: b.descRu,
                consequence: reason || "Можно построить.",
              }}>
                <Btn
                  size="sm"
                  variant={!reason ? "primary" : "default"}
                  disabled={reason !== ""}
                  onClick={() => game.sendCommand({ type: "build_building", colonyId: colony.id, buildingId: b.id })}
                  testId={"btn-building-" + b.id}
                >
                  {techOk ? L("Строить", "Build") : L("Замок", "Locked")}
                </Btn>
              </Tip>
            </div>
          );
        })}
      </div>

      <Sep />
      <div className="sf-h">{L("Очередь стройки", "Build queue")} ({colony.queue.length})</div>
      {colony.queue.length === 0 ? (
        <div className="sf-meta">{L("Нет задач. Выберите район или здание.", "No tasks. Pick a district or building.")}</div>
      ) : (
        <div className="sf-list">
          {colony.queue.map((q, i) => (
            <div key={i} className="sf-line">
              <span className="sf-nowrap">
                {q.kind === "district" ? "Район" : q.kind === "building" ? "Здание" : "Корабль"} · {q.id}
              </span>
              <span className="sf-spacer" />
              <span className="sf-meta">{q.ticksLeft}/{q.totalTicks}</span>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => game.sendCommand({ type: "cancel_build", colonyId: colony.id, index: i })}
                title={L("Отменить", "Cancel")}
              >
                ✕
              </Btn>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}