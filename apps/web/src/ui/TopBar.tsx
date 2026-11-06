import type { ResourceId } from "@sf/sim";
import { RESOURCE_ORDER } from "@sf/sim";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import { resourceColor, resourceIcon, resourceLabel } from "../game/format";
import { Btn, Bar, Tip, type TipData } from "./controls";
import { L, ancientsOf, dlcOf, raceDefOf, tr } from "./fg";
import {
  SCIENCE_COLOR, SCIENCE_ICON, SCIENCE_ORDER, SCIENCE_RU, incomeBreakdown, incomeText, fleetCap, empireFleetPower, milliText, playerEmpire, projectedIncome, resourceConsequence, tickDate, worldOf, intText, signedText, rnd } from "./util";

const SPEEDS = [0, 1, 2, 3, 5];

function DlcSignalChip({ game }: { game: Game }) {
  const d = dlcOf(worldOf(game));
  if (!d?.enabled || d.signals.length === 0) return null;
  const open = d.signals.filter((s) => !s.revealed).length;
  return (
    <Tip data={() => ({
      title: L("Сигналы квестов", "Quest signals"),
      value: "✦ " + open,
      lines: d.signals.map((s) => ({
        label: L("Система", "System") + " #" + s.systemId,
        value: s.revealed ? L("раскрыт", "revealed") : L("ждёт исследования", "awaits investigation"),
      })),
      note: L("Сигналы ловятся флотом в системе; журнал — в меню «Ещё…» → Журнал.", "Signals are caught by a fleet in the system; the journal is in More → Journal."),
    })}>
      <div className="sf-chip" data-testid="dlc-signal-hud">
        <span className="sf-chip-ico" style={{ background: "#6BE08A" }}>✦</span>
        <span className="sf-chip-col">
          <span className="sf-chip-name">{L("Сигналы", "Signals")}</span>
          <span className="sf-chip-val">{open}</span>
        </span>
      </div>
    </Tip>
  );
}

function AncientsChip({ game, state }: { game: Game; state: GameState }) {
  const a = ancientsOf(worldOf(game));
  if (!a || !a.enabled) return null;
  const race = raceDefOf(a.playerRace);
  const warp = a.warp;
  const cooldown = Math.max(0, warp.cooldownUntil - state.tick);
  const chorus = a.sector?.chorusThreat ?? 0;
  const danger = chorus >= 50 || warp.instability >= 60 || (warp.unlocked && warp.charges <= 0);
  return (
    <Tip data={() => ({
      title: L("Наследие Ансаров", "Ansari Legacy") + (race ? " · " + race.ru : ""),
      value: "◈ " + intText(a.relics) + " · ◉ " + intText(a.cores) + " · " + L("тир", "tier") + " " + (a.tech.tier >= 0 ? "A" + a.tech.tier : "—"),
      lines: [
        { label: L("Реликвии", "Relics"), value: intText(a.relics) },
        { label: L("Ядра", "Cores"), value: intText(a.cores) },
        { label: L("Тёмная материя", "Dark matter"), value: intText(a.darkMatter) },
        { label: L("Варп", "Warp"), value: warp.unlocked ? L("открыт", "unlocked") : L("закрыт", "locked") },
        { label: L("Заряды ядра", "Core charges"), value: intText(warp.charges) + " / " + intText(warp.cores * 10) },
        { label: L("Кулдаун варпа", "Warp cooldown"), value: cooldown + " " + L("такт.", "ticks") },
        { label: L("Стадия линии", "Line stage"), value: intText(a.quest.stage) + "/12" },
        { label: L("Угроза Хора", "Chorus threat"), value: intText(chorus) + "%" },
        { label: L("Стабильность Предела", "Expanse stability"), value: intText(a.sector?.stability ?? 0) + "%" },
      ],
      note: L("Панель «Древние» — в меню «Ещё…»: линия, Наследие A0–A5, Кодекс, Предел, финал.", "The Ancients panel is in the More menu: line, Legacy A0–A5, Codex, Expanse, finale."),
      consequence: danger ? L("Внимание: Хор/нестабильность/нет зарядов ядра.", "Warning: Chorus, instability or no core charges.") : undefined,
    })}>
      <div className={"sf-chip" + (danger ? " sf-chip--danger" : "")} data-testid="ancients-hud">
        <span className="sf-chip-ico" style={{ background: "#7A5CFF" }}>◈</span>
        <span className="sf-chip-col">
          <span className="sf-chip-name">{L("Наследие", "Legacy")}</span>
          <span className="sf-chip-val">◈{intText(a.relics)} ◉{intText(a.cores)}</span>
          <span className="sf-chip-delta" style={{ color: "#C9B8FF" }}>⚡{intText(warp.charges)}{cooldown > 0 ? " · " + cooldown + "т" : ""}</span>
        </span>
      </div>
    </Tip>
  );
}

export interface TopBarProps {
  game: Game;
  state: GameState;
  onMenu: () => void;
  onHelp: () => void;
  onSave: () => void;
  onLoad: () => void;
  onSettings: () => void;
}

export function TopBar({ game, state, onMenu, onHelp, onSave, onLoad, onSettings }: TopBarProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  // Пока не прошёл первый такт, incomeLastTick нулевой — показываем прогноз (P10: факт и прогноз различимы).
  const noHistory = !!emp && RESOURCE_ORDER.every((id) => (emp.incomeLastTick[id] ?? 0) === 0);
  const projAll = world && emp ? projectedIncome(world, emp.id) : null;

  const resourceTip = (id: ResourceId): TipData => {
    if (!world || !emp) return { title: resourceLabel(id), value: L("нет данных", "no data") };
    const stock = emp.resources[id] ?? 0;
    const last = emp.incomeLastTick[id] ?? 0;
    const bd = incomeBreakdown(world, emp.id, id);
    const proj = projectedIncome(world, emp.id)[id] ?? last;
    const lines = bd.lines.length > 0
      ? bd.lines.map((l) => ({
          label: l.detailRu ? l.labelRu + " — " + l.detailRu : l.labelRu,
          value: milliText(l.valueMilli) + "/" + L("такт", "tick"),
        }))
      : [{ label: L("Доход за прошлый такт (факт)", "Income last tick (actual)"), value: incomeText(last) + "/такт" }];
    if (bd.lines.length > 0 && !noHistory) {
      lines.push({ label: L("Итого (факт)", "Total (actual)"), value: incomeText(last) + "/такт" });
    }
    lines.push({ label: noHistory ? L("Прогноз на первый такт", "First tick forecast") : L("Прогноз следующего такта", "Next tick forecast"), value: incomeText(proj) + "/такт" });
    return {
      title: resourceLabel(id) + " · " + resourceIcon(id),
      value: intText(stock) + " " + resourceLabel(id).toLowerCase(),
      lines,
      consequence: resourceConsequence(stock, last),
    };
  };

  const scienceTip = (): TipData => {
    if (!world || !emp) return { title: tr("hud.science", undefined, "Наука"), value: L("нет данных", "no data") };
    const lines = SCIENCE_ORDER.map((s) => ({
      label: SCIENCE_RU[s],
      value: intText(emp.science[s] ?? 0) + " " + L("очк.", "pts") + " · " + incomeText(emp.scienceLastTick[s] ?? 0) + "/такт",
    }));
    const total = SCIENCE_ORDER.reduce((a, s) => a + (emp.scienceLastTick[s] ?? 0), 0);
    lines.push({ label: L("Суммарно", "Total"), value: incomeText(total) + " " + L("очк./такт", "pts/tick") });
    const cur = emp.techs.progress;
    const active = SCIENCE_ORDER.filter((s) => cur[s]?.techId);
    if (active.length > 0) {
      for (const s of active) {
        const p = cur[s];
        if (!p.techId) continue;
        lines.push({
          label: L("В работе", "In progress") + ": " + (tr("tech.school." + s, undefined, SCIENCE_RU[s])),
          value: rnd((p.frac ?? 0) * 100) + "% · " + intText(p.points) + " " + L("очк.", "pts"),
        });
      }
    }
    return {
      title: L("Очки исследования · 3 школы", "Research points · 3 schools"),
      value: incomeText(total) + " " + L("очк./такт", "pts/tick"),
      lines,
      consequence: L("Выберите альтернативу в панели науки (кнопка «Наука»).", "Choose an alternative in the research panel (Research button)."),
    };
  };

  const fleetTip = (): TipData => {
    if (!world || !emp) return { title: L("Флитпауэр", "Fleet power"), value: L("нет данных", "no data") };
    const fp = empireFleetPower(world, emp.id);
    const cap = fleetCap(world, emp.id);
    const lines = [
      { label: L("Флитпауэр империи", "Empire fleet power"), value: intText(fp) + " FP" },
      { label: L("Лимит флота", "Fleet cap"), value: intText(cap) + " FP" },
      { label: L("Формула", "Formula"), value: L("база + попы + системы", "base + pops + systems") },
    ];
    if (world.fleets.some((f) => f.empireId === emp.id && f.ships.length > 0)) {
      const n = world.fleets.filter((f) => f.empireId === emp.id && f.ships.length > 0).length;
      lines.push({ label: L("Флотов", "Fleets"), value: intText(n) });
    }
    return {
      title: L("Флитпауэр / лимит флота", "Fleet power / fleet cap"),
      value: intText(fp) + " / " + intText(cap) + " FP",
      lines,
      consequence: fp > cap
        ? L("Превышен лимит: растёт апкип и штрафы к производству.", "Over cap: upkeep and production penalties rise.")
        : L("Запас лимита", "Cap headroom") + ": " + intText(Math.max(0, cap - fp)) + " FP.",
    };
  };

  return (
    <div className="sf-topbar" data-testid="top-bar" role="toolbar" aria-label={L("Верхняя панель", "Top bar")}>
      <div className="sf-topbar-group sf-topbar-group--res">
        {RESOURCE_ORDER.map((id) => {
          const stock = emp?.resources[id] ?? 0;
          const lastInc = emp?.incomeLastTick[id] ?? 0;
          const inc = lastInc !== 0 || !noHistory ? lastInc : (projAll?.[id] ?? 0);
          return (
            <Tip key={id} data={() => resourceTip(id)}>
              <div className="sf-chip" data-testid={"resource-" + id}>
                <span className="sf-chip-ico" style={{ background: resourceColor(id) }}>{resourceIcon(id)}</span>
                <span className="sf-chip-col">
                  <span className="sf-chip-name">{resourceLabel(id)}</span>
                  <span className="sf-chip-val">{intText(stock)}</span>
                </span>
                <span className={"sf-chip-delta " + (inc > 0 ? "sf-chip-delta--up" : inc < 0 ? "sf-chip-delta--down" : "")}>
                  {signedText(inc)}
                </span>
              </div>
            </Tip>
          );
        })}

        <Tip data={scienceTip}>
          <div className="sf-chip" data-testid="science-block">
            <span className="sf-chip-col">
              {SCIENCE_ORDER.map((s) => (
                <span key={s} className="sf-row" style={{ gap: 4, lineHeight: 1.05 }}>
                  <span style={{ color: SCIENCE_COLOR[s], fontWeight: 700, fontSize: "0.72em" }}>{SCIENCE_ICON[s]}</span>
                  <span style={{ fontSize: "0.82em" }}>{intText(emp?.science[s] ?? 0)}</span>
                  <span style={{ fontSize: "0.7em", color: (emp?.scienceLastTick[s] ?? 0) > 0 ? "#6BE675" : "#9AABC4" }}>
                    {signedText(emp?.scienceLastTick[s] ?? 0)}
                  </span>
                </span>
              ))}
            </span>
          </div>
        </Tip>

        <AncientsChip game={game} state={state} />
        <DlcSignalChip game={game} />

        <Tip data={fleetTip}>
          <div className="sf-chip sf-chip--lead" data-testid="fleet-cap">
            <span className="sf-chip-col">
              <span className="sf-chip-name">{L("Флот", "Fleet")} · FP</span>
              <span className="sf-chip-val">
                {intText(emp ? empireFleetPower(world!, emp.id) : 0)}
                <span className="sf-meta"> / {intText(emp ? fleetCap(world!, emp.id) : 0)}</span>
              </span>
              {emp && world && (
                <Bar
                  thin
                  v01={empireFleetPower(world, emp.id) / Math.max(1, fleetCap(world, emp.id))}
                  tone="sf-bar--gold"
                />
              )}
            </span>
          </div>
        </Tip>
      </div>

      <div className="sf-topbar-sep" />

      <div className="sf-topbar-group sf-timebox">
        <div className="sf-chip-col">
          <span className="sf-chip-val" data-testid="tick-counter">{tr("hud.tick", undefined, "Такт")} {intText(state.tick)}</span>
          <span className="sf-meta">{tickDate(state.tick)}</span>
        </div>
        <div className="sf-speed" role="group" aria-label={L("Скорость времени", "Time speed")} data-testid="speed-control">
          {SPEEDS.map((s) => (
            <Tip key={s} data={{
              title: s === 0 ? tr("hud.speed.pause", undefined, "Пауза") : L("Скорость", "Speed") + " ×" + s,
              value: s === 0 ? L("время остановлено", "time stopped") : L("1 такт = 1 сутки", "1 tick = 1 day"),
              note: L("Горячие клавиши: 1/2/3/5, Space — пауза", "Hotkeys: 1/2/3/5, Space — pause"),
            }}>
              <button
                type="button"
                className={"sf-speed-btn" + (state.speed === s && !state.paused ? " sf-speed-btn--on" : s === 0 && state.paused ? " sf-speed-btn--on" : "")}
                data-testid={"btn-speed-" + s}
                onClick={() => game.setSpeed(s)}
                aria-label={s === 0 ? tr("hud.speed.pause", undefined, "Пауза") : L("Скорость", "Speed") + " " + s}
                aria-pressed={s === 0 ? state.paused : state.speed === s && !state.paused}
              >
                {s === 0 ? "‖" : s + "×"}
              </button>
            </Tip>
          ))}
        </div>
        {state.paused && <span className="sf-paused-badge">{tr("hud.pause", undefined, "ПАУЗА")}</span>}
        {state.mode === "system" && <span className="sf-badge sf-badge--warn">{L("Тактическая пауза", "Tactical pause")}</span>}
      </div>

      <div className="sf-topbar-sep" />

      <div className="sf-topbar-group">
        <Btn size="sm" onClick={onSave} title={L("Сохранить кампанию (F5)", "Save campaign (F5)")} testId="btn-save">{L("Сохранить", "Save")}</Btn>
        <Btn size="sm" onClick={onLoad} title={L("Загрузить сохранение", "Load save")} testId="btn-load">{L("Загрузить", "Load")}</Btn>
        <Btn size="sm" onClick={onMenu} title={L("Меню / пауза (Esc)", "Menu / pause (Esc)")} testId="btn-menu">{L("Меню", "Menu")}</Btn>
        <Btn size="sm" onClick={onHelp} title={L("Помощь и управление (F1)", "Help and controls (F1)")} testId="btn-help">{L("Помощь", "Help")}</Btn>
        <Btn size="sm" onClick={onSettings} title={L("Настройки", "Settings")} ariaLabel={L("Настройки", "Settings")} testId="btn-settings">⚙</Btn>
        {state.saveStatus === "saved" && <span className="sf-badge sf-badge--good">{L("сохранено", "saved")}</span>}
        {state.saveStatus === "error" && <span className="sf-badge sf-badge--bad">{L("ошибка", "error")}</span>}
      </div>
    </div>
  );
}