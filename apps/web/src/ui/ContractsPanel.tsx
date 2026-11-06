import { useMemo, useState } from "react";
import { MISSION_BY_ID } from "@sf/data";
import type { Command } from "@sf/sim";
import { Badge, Bar, Btn, Panel, Sep, Tip } from "./controls";
import { CONTRACT_KIND_RU, L, fgOf, send, tr, useLocale, type FullPanelProps } from "./fg";
import { findStation, intText, MISSION_RU, num, playerEmpire, rnd, ticksRu, worldOf } from "./util";
import { systemName } from "./fg";

interface ContractRow {
  key: string;
  kindLabel: string;
  title: string;
  desc: string;
  systemId: number;
  rewardsText: string;
  reputation: number;
  deadlineTick: number;
  risk: number;
  accepted: boolean;
  completed: boolean;
  failed: boolean;
  progress: number;
  objectives: { id: string; label: string; count: number; progress: number; done: boolean }[];
  accept: Command;
  abandon?: Command;
}


type Filter = "available" | "accepted" | "done";

/** Контракты (12 типов): доска станции/системы, прогресс целей, награды, сроки, репутация. */
export function ContractsPanel({ game, state }: FullPanelProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const fg = fgOf(world);
  const stationId = state.activeStationId;
  const station = world ? findStation(world, stationId)?.system ?? null : null;
  useLocale();
  const [filter, setFilter] = useState<Filter>("available");
  const [openId, setOpenId] = useState<string | null>(null);

  // Hooks должны вызываться безусловно (react-hooks/rules-of-hooks): ранний return — после useMemo.
  const fromFg: ContractRow[] = (fg?.contracts ?? []).map((c) => ({
    key: String(c.id),
    kindLabel: tr("contract.kind." + c.kind, undefined, CONTRACT_KIND_RU[c.kind] ?? c.kind),
    title: c.titleRu,
    desc: c.descRu,
    systemId: c.systemId,
    rewardsText: intText(c.rewards.credits) + " кр."
      + (c.rewards.alloys ? " + " + intText(c.rewards.alloys) + " спл." : "")
      + (c.rewards.influence ? " + " + intText(c.rewards.influence) + " вл." : ""),
    reputation: c.rewards.reputation ?? 0,
    deadlineTick: c.deadlineTick,
    risk: num(c.risk),
    accepted: c.accepted,
    completed: c.completed,
    failed: c.failed,
    progress: num(c.progress),
    objectives: c.objectives.map((o) => ({
      id: o.id,
      label: o.type + (o.targetSystemId ? " · " + systemName(world, o.targetSystemId) : ""),
      count: o.count,
      progress: o.progress,
      done: o.done,
    })),
    accept: { type: "contract_accept", contractId: c.id },
    abandon: { type: "contract_abandon", contractId: c.id },
  }));
  // Если контракты M8 ещё не сгенерированы — показываем legacy-миссии станции (@sf/sim World.missions),
  // чтобы доска не была пустой в вертикальном срезе.
  const legacyRows: ContractRow[] = fromFg.length === 0
    ? (world?.missions ?? [])
      .filter((m) => (stationId != null ? m.stationId === stationId || m.systemId === station?.id : true))
      .map((m) => {
        const def = MISSION_BY_ID[m.defId];
        return {
          key: "m" + m.id,
          kindLabel: tr("contract.kind." + m.kind, undefined, MISSION_RU[m.kind] ?? m.kind),
          title: m.titleRu,
          desc: m.descRu,
          systemId: m.systemId,
          rewardsText: intText(m.rewardCredits) + " кр.",
          reputation: def?.rewardRep ?? 0,
          deadlineTick: m.deadlineTick,
          risk: num(def?.risk ?? 0),
          accepted: m.accepted,
          completed: m.completed,
          failed: m.failed,
          progress: m.targetAmount > 0 ? m.progress / m.targetAmount : 0,
          objectives: m.targetAmount > 0
            ? [{ id: "goal", label: "Прогресс цели", count: m.targetAmount, progress: m.progress, done: m.progress >= m.targetAmount }]
            : [],
          accept: { type: "accept_mission", missionId: m.id },
          abandon: m.accepted ? { type: "abandon_mission", missionId: m.id } : undefined,
        };
      })
    : [];
  const all = [...fromFg, ...legacyRows];
  const scoped = all;
  const list = useMemo(() => scoped.filter((c) => {
    const tick = world?.tick ?? 0;
    if (filter === "available") return !c.accepted && !c.completed && !c.failed && c.deadlineTick >= tick;
    if (filter === "accepted") return c.accepted && !c.completed && !c.failed;
    return c.completed || c.failed || c.deadlineTick < tick;
  }), [scoped, filter, world?.tick]);

  if (!world || !emp || !fg) {
    return <Panel title={tr("contract.title", undefined, "Контракты")} testId="contracts-panel"><div className="sf-empty">Мир ещё не создан.</div></Panel>;
  }

  const counts = {
    available: scoped.filter((c) => !c.accepted && !c.completed && !c.failed).length,
    accepted: scoped.filter((c) => c.accepted && !c.completed && !c.failed).length,
    done: scoped.filter((c) => c.completed || c.failed).length,
  };

  return (
    <div className="sf-fg-panel" data-testid="contracts-panel">
      <div className="sf-fg-tabs" role="tablist">
        {([
          ["available", L("Доступные", "Available") + " (" + counts.available + ")"],
          ["accepted", L("Активные", "Active") + " (" + counts.accepted + ")"],
          ["done", L("Завершённые", "Done") + " (" + counts.done + ")"],
        ] as [Filter, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id}
            className={"sf-tab" + (filter === id ? " sf-tab--on" : "")} onClick={() => setFilter(id)}
            data-testid={"btn-contracts-" + id}>
            {label}
          </button>
        ))}
      </div>
      {all.length === 0 && (
        <div className="sf-empty">
          Доска контрактов пуста: контент M8 ещё не сгенерирован в этом мире.
          <div className="sf-meta">Новые контракты появляются на торговых станциях по такту; 12 типов — из @sf/data.</div>
          {station && <div className="sf-meta">Система: {station.name}</div>}
        </div>
      )}
      <div className="sf-list">
        {list.map((c) => {
          const ticksLeft = c.deadlineTick - world.tick;
          const isOpen = openId === c.key;
          const risk = Math.round(c.risk * 100);
          return (
            <div key={c.key} className="sf-fg-contract" data-testid={"contract-row-" + c.key}>
              <div className="sf-row">
                <Badge tone={c.accepted ? "info" : "good"}>{c.kindLabel}</Badge>
                <b className="sf-nowrap">{c.title}</b>
                <span className="sf-spacer" />
                <span className={"sf-meta " + (ticksLeft < 3 ? "sf-bad" : "")}>срок: {intText(ticksLeft)} {ticksRu(ticksLeft)}</span>
                <span className="sf-meta">риск {risk}%</span>
              </div>
              <div className="sf-meta">
                {systemName(world, c.systemId)} · репутация {intText(c.reputation)} · награда {c.rewardsText}
              </div>
              <div className="sf-row" style={{ gap: 4 }}>
                <Btn size="sm" variant="ghost" onClick={() => setOpenId(isOpen ? null : c.key)} testId={"btn-contract-open-" + c.key}>
                  {isOpen ? "Свернуть" : "Цели и брифинг"}
                </Btn>
                {!c.accepted && !c.completed && !c.failed && (
                  <Btn size="sm" variant="primary" onClick={() => send(game, c.accept)} testId={"btn-contract-accept-" + c.key}>{tr("contract.accept", undefined, "Принять")}</Btn>
                )}
                {c.accepted && !c.completed && !c.failed && c.abandon && (
                  <Btn size="sm" variant="danger" onClick={() => send(game, c.abandon!)} testId={"btn-contract-abandon-" + c.key}>{tr("contract.abandon", undefined, "Отказаться")}</Btn>
                )}
              </div>
              {isOpen && (
                <div className="sf-fg-contract__body">
                  <div className="sf-meta">{c.desc}</div>
                  <Sep />
                  <div className="sf-h">Цели</div>
                  {c.objectives.length === 0 && <div className="sf-meta">Цели из данных.</div>}
                  {c.objectives.map((o) => {
                    const p = o.count > 0 ? o.progress / o.count : o.done ? 1 : 0;
                    return (
                      <div key={o.id} className="sf-line">
                        <span className={o.done ? "sf-ok" : "sf-meta"}>{o.done ? "✓" : "•"}</span>
                        <span className="sf-nowrap">{o.label}</span>
                        <span className="sf-spacer" />
                        <div style={{ width: 120 }}><Bar v01={p} thin tone={o.done ? "sf-bar--ok" : ""} /></div>
                        <span className="sf-meta">{intText(o.progress)}/{intText(o.count)}</span>
                      </div>
                    );
                  })}
                  <div className="sf-meta">
                    Итоговый прогресс: {intText(rnd(num(c.progress) * 100))}% · дедлайн: такт {intText(c.deadlineTick)}
                  </div>
                  <Tip data={{
                    title: "Награда контракта",
                    value: c.rewardsText,
                    lines: [
                      { label: "Репутация", value: intText(c.reputation) },
                      { label: "Срок", value: "такт " + intText(c.deadlineTick) },
                    ],
                    note: "Награда фиксируется в момент принятия; провал срока уменьшает репутацию.",
                  }}>
                    <span className="sf-meta">награды зафиксированы</span>
                  </Tip>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {filter === "available" && list.length === 0 && all.length > 0 && (
        <div className="sf-empty">Свободных контрактов нет — проверьте другие станции или подождите такт.</div>
      )}
    </div>
  );
}