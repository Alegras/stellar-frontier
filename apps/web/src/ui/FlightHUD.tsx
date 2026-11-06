import { useEffect, useState } from "react";
import type { Game } from "../game/Game";
import type { GameState, FlightTelemetry } from "../game/types";
import { EMPTY_TELEMETRY } from "../game/types";

import { Badge, Bar, Btn, Key, Panel, Sep } from "./controls";
import { barTone, distText, intText, num, rnd } from "./util";
import { L, dlcOf, tr } from "./fg";

const MODE_RU: Record<string, string> = {
  normal: L("СУБСВЕТ", "SUBLIGHT"),
  supercruise: L("СУПЕРКРУИЗ", "SUPERCRUISE"),
  combat: L("БОЙ", "COMBAT"),
};

export function FlightHUD({ game, state }: { game: Game; state: GameState }) {
  const [tel, setTel] = useState<FlightTelemetry>(() => ({ ...EMPTY_TELEMETRY }));

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 100) return; // троттлинг 10 Гц: HUD не рендерится 60 раз/с
      last = now;
      const t = game.flightTelemetry;
      setTel({
        ...t,
        pips: { ...t.pips },
        contacts: t.contacts,
        warnings: t.warnings,
        hints: t.hints,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  const dlcSignalsHere = (() => {
    const world = game.hasWorld ? game.world : null;
    const d = world ? dlcOf(world) : null;
    if (!d?.enabled || state.activeSystemId == null) return [];
    return d.signals.filter((s) => s.systemId === state.activeSystemId);
  })();

  const shield01 = tel.shieldMax > 0 ? tel.shield / tel.shieldMax : 0;
  const hull01 = tel.hullMax > 0 ? tel.hull / tel.hullMax : 0;
  const heat01 = Math.max(0, Math.min(1.2, tel.heat / 100));

  return (
    <div className="sf-hud" data-testid="flight-hud">
      {/* Маркеры контактов: x/y — доли вьюпорта 0..1 (контракт SystemView) */}
      <div className="sf-contact-markers" aria-hidden="true">
        {tel.contacts.slice(0, 6).map((c, i) => (
          <div
            key={i}
            className={"sf-contact-marker" + (c.hostile ? " sf-contact-marker--hostile" : "")}
            style={{ left: (num(c.x) * 100).toFixed(2) + "%", top: (num(c.y) * 100).toFixed(2) + "%" }}
          >
            <span className="sf-contact-marker__box" />
            <span className="sf-contact-marker__name">{c.name}</span>
            <span className="sf-contact-marker__dist">{distText(c.dist)}</span>
          </div>
        ))}
      </div>
      <div className="sf-hud-block sf-hud-block--back">
        <Btn onClick={() => game.exitToGalaxy()} title={L("Вернуться на карту (Esc)", "Back to map (Esc)")} testId="btn-exit-map">
          « {tr("system.exit", undefined, "На карту")}
        </Btn>
      </div>

      <div className="sf-hud-block sf-hud-block--warnings">
        {tel.warnings.length > 0 && (
          <div className="sf-warn-strip">
            {tel.warnings.slice(0, 3).map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}
        {dlcSignalsHere.length > 0 && (
          <div className="sf-warn-strip sf-dlc-signal" data-testid="flight-signal" style={{ marginTop: 4 }}>
            ✦ {L("Сигнал квеста", "Quest signal")}: {dlcSignalsHere.length} · {L("подойдите и нажмите F — скан", "approach and press F to scan")}
          </div>
        )}
        {tel.mode === "combat" && (
          <div className="sf-warn-strip" style={{ marginTop: 4 }}>{L("БОЙ · тактическая пауза: глобальный такт остановлен", "COMBAT · tactical pause: global tick frozen")}</div>
        )}
      </div>

      <div className="sf-hud-block sf-hud-block--contacts">
        <Panel title={tr("hud.contacts", undefined, "Контакты") + " · " + tel.contacts.length} testId="contacts-panel">
          <div className="sf-list">
            {tel.contacts.length === 0 && <div className="sf-meta">{L("Сенсоры чисты.", "Sensors clear.")}</div>}
            {tel.contacts.slice(0, 8).map((c, i) => (
              <div key={i} className="sf-line">
                <span className={c.hostile ? "sf-bad" : "sf-ok"}>{c.hostile ? "◆" : "▲"}</span>
                <span className="sf-nowrap">{c.name}</span>
                <span className="sf-spacer" />
                <span className="sf-meta">{distText(c.dist)}</span>
                <span className="sf-meta">{rnd(c.hull01 * 100)}%</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="sf-hud-block sf-hud-block--target">
        <Panel title={L("Цель и навигация", "Target and navigation")}>
          {tel.targetName ? (
            <>
              <div className="sf-row">
                <b className="sf-nowrap">{tel.targetName}</b>
                <span className="sf-spacer" />
                <span className="sf-info">{distText(tel.targetDist)}</span>
              </div>
              {tel.targetHull01 != null && (
                <div className="sf-hud-gauge">
                  <span className="sf-meta" style={{ width: 52 }}>{tr("hud.hull", undefined, "корпус")}</span>
                  <Bar v01={tel.targetHull01} tone={barTone(tel.targetHull01)} thin />
                  <span style={{ width: 40, textAlign: "right", fontSize: ".8em" }}>{rnd(tel.targetHull01 * 100)}%</span>
                </div>
              )}
            </>
          ) : (
            <div className="sf-meta">{L("Цель не выбрана.", "No target selected.")}</div>
          )}
          <Sep />
          <div className="sf-kv"><span className="sf-dim">FSD →</span><b className="sf-nowrap">{tel.navSystemName || "—"}</b></div>
          <div className="sf-kv"><span className="sf-dim">{L("Дистанция", "Distance")}</span><b>{num(tel.navDistLy).toFixed(1)} {" "}{L("св. лет", "ly")}</b></div>
          <div className="sf-kv"><span className="sf-dim">{L("Заряд FSD", "FSD charge")}</span><b className={tel.fsdCharge > 0 && tel.fsdCharge < 1 ? "sf-gold" : undefined}>{rnd(tel.fsdCharge * 100)}%</b></div>
          {tel.fsdCharge > 0 && tel.fsdCharge < 1 && <Bar v01={tel.fsdCharge} tone="sf-bar--gold" thin />}

        </Panel>
      </div>

      <div className="sf-hud-block sf-hud-block--instruments">
        <Panel title={L("Полёт", "Flight")}>
          <div className="sf-row" style={{ alignItems: "flex-end" }}>
            <div className="sf-hud-num">{intText(tel.speed)}</div>
            <div className="sf-chip-col">
              <span className="sf-hud-label">{L("м/с", "m/s")}</span>
              <Badge tone={tel.mode === "combat" ? "bad" : "info"}>{MODE_RU[tel.mode] ?? tel.mode}</Badge>
            </div>
            <span className="sf-spacer" />
            <div className="sf-meta" style={{ textAlign: "right" }}>
              <div>{tr("hud.throttle", undefined, "тяга")} {rnd(tel.throttle * 100)}%</div>
              <div>{tel.boost ? L("ФОРСАЖ", "BOOST") : tel.assist ? L("ассист вкл.", "assist on") : L("ассист выкл.", "assist off")}</div>
            </div>
          </div>
          <Bar v01={tel.throttle} tone={tel.throttle > 0.8 ? "sf-bar--warn" : "sf-bar--gold"} />
          <div className="sf-hud-gauge" style={{ marginTop: 4 }}>
            <span className="sf-meta" style={{ width: 46 }}>{tr("hud.heat", undefined, "тепло")}</span>
            <Bar v01={heat01 / 1.2} tone={heat01 > 1 ? "sf-bar--bad" : heat01 > 0.8 ? "sf-bar--warn" : "sf-bar--ok"} />
            <span style={{ width: 44, textAlign: "right", fontSize: ".8em" }}>{rnd(tel.heat)}%</span>
          </div>
          <div className="sf-row" style={{ marginTop: 4 }}>
            <span className="sf-meta">{L("Пипсы", "Pips")}</span>
            <span className="sf-pips" title="SYS">
              {Array.from({ length: 4 }).map((_, i) => <span key={i} className={"sf-pip" + (i < tel.pips.sys ? " sf-pip--on" : "")} />)}
            </span>
            <span className="sf-meta">ENG</span>
            <span className="sf-pips">
              {Array.from({ length: 4 }).map((_, i) => <span key={i} className={"sf-pip" + (i < tel.pips.eng ? " sf-pip--on" : "")} />)}
            </span>
            <span className="sf-meta">WEP</span>
            <span className="sf-pips">
              {Array.from({ length: 4 }).map((_, i) => <span key={i} className={"sf-pip" + (i < tel.pips.wep ? " sf-pip--on" : "")} />)}
            </span>
          </div>
          {tel.hints.length > 0 && (
            <div className="sf-hint-strip" style={{ marginTop: 4 }}>
              {tel.hints.slice(0, 3).join(" · ")}
            </div>
          )}
        </Panel>
      </div>

      <div className="sf-hud-block sf-hud-block--ship">
        <Panel title={L("Корабль", "Ship")} right={state.battleReport ? (
          <Btn size="sm" variant="danger" onClick={() => game.setBattleReport(state.battleReport)} testId="btn-open-battle">{L("Отчёт боя", "Battle report")}</Btn>
        ) : undefined}>
          <div className="sf-hud-gauge">
            <span className="sf-meta" style={{ width: 46 }}>{tr("hud.shield", undefined, "щит")}</span>
            <Bar v01={shield01} tone={shield01 > 0.25 ? "sf-bar--ok" : "sf-bar--warn"} />
            <span style={{ width: 74, textAlign: "right", fontSize: ".82em" }}>{intText(tel.shield)}/{intText(tel.shieldMax)}</span>
          </div>
          <div className="sf-hud-gauge">
            <span className="sf-meta" style={{ width: 46 }}>{tr("hud.hull", undefined, "корпус")}</span>
            <Bar v01={hull01} tone={hull01 > 0.3 ? "sf-bar--ok" : "sf-bar--bad"} />
            <span style={{ width: 74, textAlign: "right", fontSize: ".82em" }}>{intText(tel.hull)}/{intText(tel.hullMax)}</span>
          </div>
          <div className="sf-kv" style={{ marginTop: 4 }}>
            <span className="sf-dim">{L("Станция", "Station")}</span>
            <b className="sf-nowrap">{tel.stationName || "—"}</b>
          </div>
          <div className="sf-kv">
            <span className="sf-dim">{L("До станции", "To station")}</span>
            <b>{tel.stationName ? distText(tel.stationDist) : "—"}</b>
          </div>
          <div className="sf-kv">
            <span className="sf-dim">{L("Стыковка", "Docking")}</span>
            <b className={tel.canDock ? "sf-ok" : "sf-warn"}>{tel.canDock ? L("разрешена", "granted") : tel.massLocked ? L("масса-лок", "mass locked") : L("нет", "no")}</b>
          </div>
          {tel.overheat && <div className="sf-bad">{L("ПЕРЕГРЕВ — сбросьте тепло", "OVERHEAT — dump heat")}</div>}
          <div className="sf-hint-strip" style={{ marginTop: 4 }}>
            <Key>Space</Key> {tr("hud.pause", undefined, "пауза")} · <Key>Esc</Key> {tr("system.exit", undefined, "на карту")} · <Key>F1</Key> {L("помощь", "help")}
          </div>
        </Panel>
      </div>

      <div className="sf-hud-block sf-hud-block--center-bottom">
        <div className="sf-hint-strip">
          <Key>W</Key>/<Key>S</Key> {tr("hud.throttle", undefined, "тяга")} · {L("мышь — руль", "mouse — steer")} · <Key>A</Key>/<Key>D</Key> {L("крен", "roll")} · <Key>Shift</Key> {L("форсаж", "boost")} ·{" "}
          <Key>Z</Key> {L("ассист", "assist")} · <Key>X</Key> {L("стоп", "stop")} · <Key>C</Key> {L("суперкруиз", "supercruise")} · <Key>Tab</Key> {L("цель", "target")} ·{" "}
          <Key>J</Key> {L("прыжок", "jump")} · <Key>G</Key> {L("стыковка", "dock")} · {L("ЛКМ/ПКМ огонь", "LMB/RMB fire")} · <Key>M</Key> {tr("hud.map", undefined, "карта")}
        </div>
      </div>
    </div>
  );
}