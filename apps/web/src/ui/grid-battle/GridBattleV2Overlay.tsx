import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Game } from "../../game/Game";
import type { GameState } from "../../game/types";
import { Badge, Btn, Panel, Sep } from "../controls";
import { L } from "../fg";
import { HexField } from "./HexField";
import {
  CLASS_RU, apOf, attackObstacle, canAttack, clone, createMockBattle, deploy, formation,
  distance, preview, reachable, runAutoBattle, stackAt, startV2, v2AiPhase, v2Attack,
  v2Defend, v2EndPhase, v2Move, v2Overwatch, type Battle, type Result, type Stack,
} from "./model";

type Screen = "deploy" | "battle" | "result";
const FORMATIONS = [
  { id: "line", ru: "Линия" }, { id: "wedge", ru: "Клин" }, { id: "echelon", ru: "Эшелон" }, { id: "guard", ru: "Охрана" },
] as const;

/** Бой v2 (16b/16c): фаза + 2 AP, любой свой юнит, end turn, overwatch. */
export function GridBattleV2Overlay({ game, onClose, onFinish, seed = 42 }: {
  game: Game;
  onClose: () => void;
  onFinish?: (result: Result) => void;
  seed?: number;
}) {
  const [battle, setBattle] = useState<Battle>(() => createMockBattle({ seed }));
  const [screen, setScreen] = useState<Screen>("deploy");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetObstacle, setTargetObstacle] = useState<{ q: number; r: number } | null>(null);
  const [hint, setHint] = useState(L("Расставьте юниты слева или нажмите «Авто».", "Deploy units on the left or press Auto."));
  const [confirmEnd, setConfirmEnd] = useState(false);
  const battleRef = useRef<Battle>(battle);
  useEffect(() => { battleRef.current = battle; }, [battle]);
  // Баннер фазы (16c §6.6): игрок должен видеть «ВАША ФАЗА / ФАЗА ПРОТИВНИКА», иначе переход
  // «Завершить ход → сразу снова моя фаза» (игрок закрывал вторую фазу раунда) выглядит как баг.
  const [phaseBanner, setPhaseBanner] = useState<string | null>(null);
  useEffect(() => {
    if (screen !== "battle" || battle.phase !== "battle" || !battle.turnSide) { setPhaseBanner(null); return; }
    setPhaseBanner(battle.turnSide === "enemy"
      ? L("ФАЗА ПРОТИВНИКА", "ENEMY PHASE")
      : L("ВАША ФАЗА", "YOUR PHASE") + " · " + L("Раунд", "Round") + " " + battle.round);
    const id = window.setTimeout(() => setPhaseBanner(null), 900);
    return () => window.clearTimeout(id);
  }, [screen, battle.turnSide, battle.round, battle.phase]);
  const playerStacks = battle.stacks.filter((s) => s.side === "player" && s.alive);
  const selected = selectedId ? battle.stacks.find((s) => s.id === selectedId) ?? null : null;
  const active = selected ?? battle.stacks.find((s) => s.id === battle.activeId) ?? null;
  const isPlayerPhase = screen === "battle" && battle.turnSide !== "enemy";
  const reach = useMemo(() => (screen === "battle" && isPlayerPhase && active?.side === "player" ? reachable(battle, active.id) : []), [battle, active, screen, isPlayerPhase]);
  const targets = useMemo(() => (screen === "battle" && isPlayerPhase && active?.side === "player" ? battle.stacks.filter((s) => s.side === "enemy" && s.alive && !s.reserve) : [] as Stack[]), [battle, active, screen, isPlayerPhase]);
  const selectedTarget = targetId ? battle.stacks.find((s) => s.id === targetId) ?? null : null;

  const refresh = useCallback((next: Battle): void => {
    battleRef.current = next;
    setBattle(next);
    setConfirmEnd(false);
    if (next.phase === "result") setScreen("result");
  }, []);
  const close = (): void => {
    try { game.setNarrativeModalOpen?.(false); } catch { /* noop */ }
    if (battle.phase === "result" && battle.result && onFinish) onFinish(battle.result);
    onClose();
  };
  useEffect(() => { game.setNarrativeModalOpen?.(true); return () => game.setNarrativeModalOpen?.(false); }, [game]);

  // Фаза противника: баннер 700 мс → ИИ отыгрывает свои фазы → управление возвращается игроку.
  useEffect(() => {
    if (screen !== "battle" || battle.phase !== "battle" || battle.turnSide !== "enemy") return;
    const id = window.setTimeout(() => {
      const current = battleRef.current;
      // защита от гонки: таймер не должен затирать более свежее состояние (например, авто-бой/результат)
      if (current.phase !== "battle" || current.turnSide !== "enemy") return;
      let next = clone(current);
      try {
        next = v2AiPhase(next);
      } catch {
        next = clone(current);
        try { v2EndPhase(next); } catch { /* noop */ }
      }
      setSelectedId(null); setTargetId(null); setTargetObstacle(null);
      setHint(L("Фаза игрока. Выберите юнит с AP.", "Player phase. Pick a unit with AP."));
      refresh(next);
    }, 700);
    return () => window.clearTimeout(id);
  }, [screen, battle, refresh]);

  // Выбор первого юнита с AP.
  useEffect(() => {
    if (screen !== "battle" || battle.turnSide === "enemy") return;
    if (selectedId && battle.stacks.find((s) => s.id === selectedId)?.side === "player" && apOf(battle.stacks.find((s) => s.id === selectedId)!) > 0) return;
    const first = battle.stacks.find((s) => s.side === "player" && s.alive && !s.reserve && apOf(s) > 0) ?? null;
    setSelectedId(first?.id ?? null);
    setBattle((b) => ({ ...b, activeId: first?.id ?? null }));
  }, [battle, screen, selectedId]);

  const pick = (s: Stack): void => {
    if (screen !== "battle" || battle.turnSide === "enemy") return;
    setSelectedId(s.id); setTargetId(null); setTargetObstacle(null);
    setBattle((b) => ({ ...b, activeId: s.id }));
    setHint(s.side === "player" && apOf(s) > 0 ? L("Юнит выбран. AP: ", "Unit selected. AP: ") + apOf(s) : L("У юнита нет AP в этой фазе.", "No AP this phase."));
  };

  const onHex = (q: number, r: number): void => {
    if (screen === "deploy") {
      if (!selectedId) return;
      const b = clone(battle);
      const res = deploy(b, selectedId, q, r);
      if (!res.ok) { setHint(res.reason ?? "Нельзя"); return; }
      refresh(b); setSelectedId(null); setHint(L("Поставлено.", "Deployed.")); return;
    }
    if (screen !== "battle" || !active || active.side !== "player" || !isPlayerPhase) return;
    const other = stackAt(battle, q, r);
    if (other?.side === "enemy") {
      setTargetId(other.id); setTargetObstacle(null);
      const melee = distance(active, other) === 1;
      const legal = canAttack(battle, active, other, !melee);
      if (!legal.ok) { setHint(L("Цель: ", "Target: ") + other.name + " · " + (legal.reason ?? L("атака недоступна", "cannot attack"))); return; }
      const p = preview(battle, active.id, other.id, !melee && active.range > 1);
      setHint(L("Цель: ", "Target: ") + other.name + " · " + p.min + "–" + p.max + L(" урона", " damage") + (melee ? L(" (ближний бой, возможен ответ)", " (melee, possible counter)") : ""));
      return;
    }
    const obs = battle.obstacles.find((o) => o.q === q && o.r === r && (o.kind === "asteroid" || o.kind === "debris"));
    if (obs) { setTargetObstacle({ q, r }); setTargetId(null); setHint(L("Препятствие можно разрушить атакой.", "Obstacle can be destroyed by attack.")); return; }
    if (reach.some((h) => h.q === q && h.r === r)) {
      const b = clone(battle); if (v2Move(b, active.id, q, r)) { refresh(b); setHint(L("Движение выполнено (1 AP).", "Moved (1 AP).")); } else setHint(L("Недостаточно AP или путь закрыт.", "Not enough AP or blocked.")); return;
    }
    if (other?.side === "player") pick(other);
  };

  /** В контакте бьём ближним боем (полный урон), иначе — дальней, если достаём. */
  const pickRanged = (a: Stack, t: Stack): boolean =>
    distance(a, t) > 1 && a.range > 1 && canAttack(battle, a, t, true).ok;
  const doAttack = (): void => {
    if (!active || active.side !== "player" || !isPlayerPhase) return;
    if (targetObstacle) { const b = clone(battle); if (attackObstacle(b, targetObstacle.q, targetObstacle.r)) { refresh(b); setTargetObstacle(null); setHint(L("Обстрел препятствия (1 AP).", "Obstacle hit (1 AP).")); } return; }
    const target = selectedTarget; if (!target) { setHint(L("Сначала выберите цель.", "Select a target first.")); return; }
    if (!canAttack(battle, active, target, distance(active, target) > 1).ok) {
      setHint(canAttack(battle, active, target, distance(active, target) > 1).reason ?? L("Атака недоступна.", "Attack unavailable."));
      return;
    }
    const b = clone(battle);
    if (v2Attack(b, active.id, target.id, pickRanged(active, target))) { refresh(b); setTargetId(null); setHint(L("Атака выполнена (1 AP).", "Attack done (1 AP).")); }
    else setHint(L("Атака недоступна (нужен 1 AP и валидная цель).", "Attack unavailable (needs 1 AP and a valid target)."));
  };
  const doDefend = (): void => { if (!active) return; const b = clone(battle); if (v2Defend(b, active.id)) { refresh(b); setHint(L("Защита +20% (1 AP).", "Defend +20% (1 AP).")); } };
  const doOverwatch = (): void => { if (!active) return; const b = clone(battle); if (v2Overwatch(b, active.id)) { refresh(b); setHint(L("Наблюдение включено (2 AP).", "Overwatch set (2 AP).")); } else setHint(L("Нужно 2 AP.", "Requires 2 AP.")); };
  const doEndPhase = (): void => {
    if (screen !== "battle" || !isPlayerPhase) return;
    const remaining = battle.stacks.filter((s) => s.side === "player" && s.alive && !s.reserve && apOf(s) > 0).length;
    if (remaining > 0 && !confirmEnd) {
      setConfirmEnd(true);
      setHint(L("Осталось AP у " , "AP remains on ") + remaining + L(" юнитов — остаток сгорит. Нажмите «ПОДТВЕРДИТЬ ХОД», чтобы передать ход противнику.", " units — remaining AP will burn. Press CONFIRM to hand the turn to the enemy."));
      return;
    }
    const b = clone(battle); v2EndPhase(b, "player"); refresh(b); setSelectedId(null); setTargetId(null);
    setHint(b.turnSide === "enemy"
      ? L("Фаза противника — ИИ отыгрывает свои действия.", "Enemy phase — the AI is acting.")
      : L("Вы закрыли вторую фазу раунда — раунд ", "You closed the second phase of the round — round ") + b.round + L(" начинаете вы (противник ходил вторым).", " starts with you (the enemy moved second)."));
  };

  const doAutoBattle = (): void => {
    // Один и тот же ИИ за обе стороны (runAutoBattle) — честный паритет вместо
    // отдельного «штрафного» ИИ игрока с манхэттенским соседством.
    const b = clone(battle);
    runAutoBattle(b);
    refresh(b);
    setSelectedId(null); setTargetId(null); setTargetObstacle(null);
  };
  const endPhaseRef = useRef(doEndPhase);
  endPhaseRef.current = doEndPhase;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.code !== "Space" && ev.code !== "Enter") return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (screen !== "battle" || !isPlayerPhase) return;
      ev.preventDefault();
      endPhaseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, isPlayerPhase]);

  const gotoBattle = (): void => {
    const b = clone(battle); if (b.deploymentCount < 1) { setHint(L("Нужен хотя бы 1 юнит на поле.", "Deploy at least 1 unit.")); return; }
    startV2(b); battleRef.current = b; setBattle(b); setScreen("battle"); setSelectedId(null); setTargetId(null);
    setHint(b.turnSide === "enemy" ? L("Фаза противника.", "Enemy phase.") : L("Фаза игрока. Выберите юнит с AP.", "Player phase. Pick a unit with AP."));
  };

  if (screen === "result" && battle.result) {
    return (
      <div className="sf-gridbattle-layer" data-testid="grid-battle" data-screen="result">
        <div className="sf-gridbattle" role="dialog" aria-modal="true">
          <header className="sf-gridbattle__head"><b className="sf-gold">{L("Итог боя", "Battle result")}</b><span className="sf-meta">{battle.systemName}</span><span className="sf-spacer" /><Btn size="sm" variant="ghost" onClick={close} testId="btn-grid-to-map">{L("На карту", "To map")}</Btn></header>
          <Panel title={battle.result.winner === "player" ? L("Победа", "Victory") : battle.result.winner === "enemy" ? L("Поражение", "Defeat") : L("Ничья", "Draw")} testId="grid-result">
            <div className="sf-meta">{L("Ходов", "Rounds")}: {battle.round} · MVP: {battle.result.mvpName}</div>
            <div className="sf-meta" data-testid="grid-parity">
              {L("≈ авторезолв по потерям", "≈ auto-resolve losses")}: {battle.result.parity.autoMin}–{battle.result.parity.autoMax}% · {L("факт", "actual")}: {battle.result.parity.actual}%
            </div>
            <table className="sf-gridtable" data-testid="grid-result-losses"><thead><tr><th>{L("Сторона", "Side")}</th><th>{L("Потери", "Losses")}</th><th>FP</th></tr></thead><tbody>{battle.result.losses.map((l, i) => <tr key={i}><td>{l.side === "player" ? "●" : "▲"} {CLASS_RU[l.cls]}</td><td>{l.lost}</td><td>{Math.round(l.fp)}</td></tr>)}</tbody></table>
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="sf-gridbattle-layer" data-testid="grid-battle" data-screen={screen}>
      {phaseBanner && (
        <div data-testid="grid-phase-banner" style={{ position: "absolute", top: "18%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", zIndex: 5 }}>
          <span style={{ display: "inline-block", padding: "8px 22px", border: "1px solid #F5C542", background: "rgba(6,10,20,.88)", color: "#F5C542", fontWeight: 700, letterSpacing: ".14em", fontSize: 20 }}>{phaseBanner}</span>
        </div>
      )}
      <div className="sf-gridbattle" role="dialog" aria-modal="true" aria-label={L("Сетка командования v2", "Grid Command v2")}>
        <header className="sf-gridbattle__head">
          <b className="sf-gold" data-testid="grid-phase-title">
            {screen === "deploy"
              ? L("Расстановка", "Deployment")
              : (battle.phase === "result" ? L("Итог", "Result") : battle.turnSide === "enemy" ? L("ХОД ПРОТИВНИКА", "ENEMY TURN") : L("Фаза игрока", "Player phase")) + " · " + battle.round + "/" + battle.maxRounds}
          </b>
          <span className="sf-meta">{battle.systemName}</span><Badge tone="info">v2 · AP</Badge><span className="sf-spacer" />
          <Btn size="sm" variant="ghost" onClick={close} testId="grid-close">{L("На карту", "To map")}</Btn>
        </header>
        <div className="sf-gridhelp" data-testid="grid-help">
          {screen === "deploy" ? L("Выберите юнит слева, поставьте в голубой зоне. Затем «В бой».", "Pick a unit, place in the blue zone, then To battle.") : battle.turnSide === "enemy" ? L("Ход противника: ИИ двигается и атакует. Управление вернётся в новом раунде.", "Enemy turn: the AI moves and attacks. Control returns next round.") : L("Любой юнит с AP: движение/атака/защита/наблюдение. «Завершить ход» — конец фазы.", "Any unit with AP: move/attack/defend/overwatch. End turn closes the phase.")}
        </div>
        <div className="sf-gridbattle__body">
          <aside className="sf-gridbattle__left">
            <Panel title={L("Отряд", "Squad")} testId="grid-roster">
              <div className="sf-meta" data-testid="grid-deploy-count">{L("На поле", "On field")}: {battle.deploymentCount}/7</div>
              <div className="sf-gridroster">{playerStacks.map((s) => (
                <button key={s.id} type="button" data-testid={"grid-roster-" + s.id} className={"sf-gridroster__card" + (selectedId === s.id ? " sf-gridroster__card--on" : "") + (s.reserve ? " sf-gridroster__card--reserve" : "")} onClick={() => pick(s)}>
                  <span className="sf-gridroster__icon">{"●".repeat(Math.max(0, Math.min(3, apOf(s)))) || "○"}</span>
                  <span className="sf-gridroster__name">{CLASS_RU[s.cls]} «{s.name}»</span>
                  <span className="sf-gridroster__meta">{s.count} · AP {apOf(s)}/2 · HP {Math.round(s.hp)}</span>
                </button>))}</div>
              <Sep />
              {screen === "deploy" ? <div className="sf-gridrow" style={{ flexWrap: "wrap" }}>
                <Btn size="sm" variant="primary" onClick={() => { const b = clone(battle); formation(b, "line", "player"); refresh(b); setHint(L("Авто-расстановка.", "Auto deployed.")); }} testId="btn-grid-auto">{L("Авто", "Auto")}</Btn>
                <Btn size="sm" variant="primary" disabled={battle.deploymentCount === 0} onClick={gotoBattle} testId="btn-grid-fight">{L("В бой ▶", "To battle ▶")}</Btn>
              </div> : <div className="sf-meta">{L("AP: движение 1 · атака 1 · защита 1 · наблюдение 2", "AP: move 1 · attack 1 · defend 1 · overwatch 2")}</div>}
            </Panel>
          </aside>
          <main className="sf-gridbattle__center">
            <HexField battle={battle} reach={reach} targets={targets} selectedTargetId={targetId} targetObstacle={targetObstacle} onHexClick={onHex} onHover={() => { /* tooltip */ }} reducedMotion={false} />
            {screen === "battle" && (
              <div className="sf-gridactions" data-testid="grid-actions">
                <Btn size="sm" variant="primary" disabled={!isPlayerPhase || !targetId && !targetObstacle} onClick={doAttack} testId="btn-grid-attack">{L("Атака", "Attack")} 1 AP</Btn>
                <Btn size="sm" disabled={!isPlayerPhase} onClick={doDefend} testId="btn-grid-defend">{L("Защита", "Defend")} 1 AP</Btn>
                <Btn size="sm" disabled={!isPlayerPhase} onClick={doOverwatch} testId="btn-grid-overwatch">{L("Наблюдение", "Overwatch")} 2 AP</Btn>
                <Btn size="sm" onClick={doAutoBattle} testId="btn-grid-auto-battle">{L("Авто-бой", "Auto battle")}</Btn>
                <Btn size="sm" variant={confirmEnd ? "danger" : "primary"} disabled={!isPlayerPhase} onClick={doEndPhase} testId="grid-end-turn">
                  {confirmEnd ? L("ПОДТВЕРДИТЬ ХОД", "CONFIRM TURN") : L("ЗАВЕРШИТЬ ХОД", "END TURN")} [Space]
                </Btn>
              </div>
            )}
            <div className="sf-meta" data-testid="grid-hint">{hint}</div>
          </main>
          <aside className="sf-gridbattle__right">
            <Panel title={L("Выбранный юнит", "Selected unit")} testId="grid-selected">
              {active ? <>
                <div className="sf-h">{CLASS_RU[active.cls]} «{active.name}»</div>
                <div className="sf-meta">AP {apOf(active)}/2 · {L("атак", "attacks")}: {active.attackedThisPhase ?? 0}</div>
                <div className="sf-meta">HP {Math.round(active.hp)}/{active.maxHp} · {L("урон", "damage")} {active.dmg} · {L("дальность", "range")} {active.range}</div>
              </> : <div className="sf-meta">{L("Никто не выбран.", "Nothing selected.")}</div>}
            </Panel>
            <Panel title={L("Боевой журнал", "Combat log")} testId="grid-log"><div className="sf-meta" style={{ maxHeight: 160, overflow: "auto" }}>{battle.log.slice(-8).map((e, i) => <div key={i}>[{e.round}] {e.text}</div>)}</div></Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}