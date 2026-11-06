import { TECHS } from "@sf/data";
import type { ScienceId } from "@sf/sim";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";

import { Badge, Bar, Btn, Panel, Sep, Tip } from "./controls";
import { L, tr } from "./fg";
import {
  playerEmpire, SCIENCE_COLOR, SCIENCE_ICON, SCIENCE_ORDER, SCIENCE_RU, techName, techOf, ticksRu, worldOf, intText, rnd } from "./util";

export function ResearchPanel({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  if (!world || !emp) {
    return <Panel title={tr("tech.title", undefined, "Наука")} testId="research-panel"><div className="sf-empty">{L("Нет мира.", "No world.")}</div></Panel>;
  }

  const completed = new Set(emp.techs.completed);

  return (
    <Panel title={tr("tech.title", undefined, "Наука") + " · 3 " + L("школы", "schools")} testId="research-panel" tall>
      <div className="sf-meta">
        {tr("hud.tick", undefined, "Такт")} {intText(state.tick)} · {L("очки копятся каждый такт. Каждая школа ведёт свою технологию; на выбор — 3 альтернативы.", "points accrue every tick. Each school runs one technology; choose from 3 alternatives.")}
      </div>
      <div className="sf-list">
        {SCIENCE_ORDER.map((school) => {
          const prog = emp.techs.progress[school];
          const offers = (emp.techs.offers[school] ?? []).filter((id) => techOf(id));
          const income = emp.scienceLastTick[school] ?? 0;
          const cur = prog?.techId ? techOf(prog.techId) : null;
          const frac = prog?.frac ?? 0;
          const remain = cur ? Math.max(0, cur.cost - (prog?.points ?? 0)) : 0;
          const eta = income > 0 ? Math.ceil(remain / income) : null;
          return (
            <div key={school} style={{ border: "1px solid #38414F", padding: ".35em .4em", marginBottom: 4 }}>
              <div className="sf-row">
                <span style={{ color: SCIENCE_COLOR[school], fontWeight: 700 }}>{SCIENCE_ICON[school]}</span>
                <b style={{ color: SCIENCE_COLOR[school] }}>{SCIENCE_RU[school]}</b>
                <span className="sf-spacer" />
                <span className="sf-meta">{intText(emp.science[school])} {L("очк.", "pts")} · {intText(income)}/{L("такт", "tick")}</span>
              </div>
              {cur ? (
                <>
                  <div className="sf-row">
                    <span className="sf-nowrap">{cur.ru}</span>
                    <span className="sf-spacer" />
                    <span className="sf-meta">{rnd(frac * 100)}% · {L("ост.", "left")} {intText(remain)}</span>
                  </div>
                  <Bar v01={frac} tone="sf-bar--gold" />
                  <div className="sf-meta">
                    {eta != null ? L("Завершится через", "Completes in") + " " + eta + " " + L("тактов", "ticks") : L("Нет очков/такт — назначьте учёных", "No points/tick — assign scientists")}
                    {" "}· T{cur.tier}
                  </div>
                </>
              ) : (
                <div className="sf-meta" style={{ marginBottom: 3 }}>{L("Технология не выбрана — выберите альтернативу ниже.", "No technology selected — choose an alternative below.")}</div>
              )}

              <div className="sf-meta" style={{ marginTop: 4 }}>{L("Альтернативы:", "Alternatives:")}</div>
              <div className="sf-list">
                {offers.length === 0 && <div className="sf-meta">{L("Пул пуст: завершите текущую технологию.", "Pool empty: finish the current technology.")}</div>}
                {offers.map((id) => {
                  const t = techOf(id)!;
                  const active = prog?.techId === id;
                  const etaOffer = income > 0 ? Math.ceil(t.cost / income) : null;
                  return (
                    <div key={id} className="sf-line" style={{ alignItems: "flex-start" }}>
                      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                        <div className="sf-row">
                          <span className="sf-nowrap">{t.ru}</span>
                          <span className="sf-spacer" />
                          <span className="sf-meta">T{t.tier} · {intText(t.cost)} {L("очк.", "pts")}</span>
                        </div>
                        <div className="sf-meta">{t.descRu}</div>
                      </div>
                      <Tip data={{
                        title: t.ru + " · " + SCIENCE_RU[school] + " T" + t.tier,
                        value: intText(t.cost) + " очков",
                        lines: [
                          ...t.effects.map((e) => ({
                            label: e.kind === "unlock" ? "Открывает" : e.kind === "flag" ? "Флаг" : "Модификатор",
                            value: e.target + (e.value !== undefined ? " " + e.value : ""),
                          })),
                          ...(t.requires ? [{ label: "Требует", value: t.requires.map(techName).join(", ") }] : []),
                        ],
                        consequence: active
                          ? "Уже в работе."
                          : etaOffer != null
                            ? "ETA ≈ " + etaOffer + " " + ticksRu(etaOffer) + "."
                            : "Назначьте учёных для очков/такт.",
                      }}>
                        <Btn
                          size="sm"
                          variant={active ? "default" : "primary"}
                          disabled={active}
                          onClick={() => game.sendCommand({ type: "research", school, techId: id })}
                          testId={"btn-research-" + id}
                        >
                          {active ? L("В работе", "In progress") : L("Выбрать", "Choose")}
                        </Btn>
                      </Tip>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <Sep />
      <div className="sf-h">{L("Дерево технологий", "Technology tree")}</div>
      <div className="sf-meta" style={{ marginBottom: 3 }}>{L("Отметка ✓ — изучено; • — доступно; × — заблокировано требованиями.", "✓ researched; • available; × locked by requirements.")}</div>
      <div className="sf-list">
        {SCIENCE_ORDER.map((school) => {
          const list = TECHS.filter((t) => t.school === school).sort((a, b) => (a.tier - b.tier) || a.ru.localeCompare(b.ru));
          return (
            <div key={school}>
              <div className="sf-row" style={{ marginTop: 3 }}>
                <span style={{ color: SCIENCE_COLOR[school] }}>{SCIENCE_ICON[school]} {SCIENCE_RU[school]}</span>
                <span className="sf-spacer" />
                <Badge>{intText(list.filter((t) => completed.has(t.id)).length) + "/" + list.length}</Badge>
              </div>
              <div className="sf-list">
                {list.map((t) => {
                  const done = completed.has(t.id);
                  const cur = emp.techs.progress[school]?.techId === t.id;
                  const locked = (t.requires ?? []).some((r) => !completed.has(r));
                  return (
                    <Tip key={t.id} data={{
                      title: "T" + t.tier + " · " + t.ru,
                      value: done ? "изучено" : locked ? "заблокировано" : cur ? "в работе" : "доступно",
                      lines: [
                        { label: "Стоимость", value: intText(t.cost) + " очков" },
                        ...t.effects.map((e) => ({ label: e.kind === "unlock" ? "Открывает" : "Эффект", value: e.target + (e.value !== undefined ? " " + e.value : "") })),
                        ...(t.requires && t.requires.length ? [{ label: "Требует", value: t.requires.map(techName).join(", ") }] : []),
                      ],
                      note: t.descRu,
                    }}>
                      <div className={"sf-line" + (cur ? " sf-line--sel" : "")}>
                        <span className={done ? "sf-ok" : locked ? "sf-bad" : "sf-gold"}>{done ? "✓" : locked ? "×" : cur ? "▸" : "•"}</span>
                        <span className="sf-nowrap" style={{ opacity: locked ? 0.55 : 1 }}>
                          T{t.tier} {t.ru}
                        </span>
                      </div>
                    </Tip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
