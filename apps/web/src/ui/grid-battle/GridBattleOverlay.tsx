import { useCallback, useEffect, useMemo, useState } from "react";
import type { Game } from "../../game/Game";
import { Badge, Btn, Panel, Sep } from "../controls";
import { L } from "../fg";
import { BATTLE_ABILITY_BY_ID, BATTLE_CLASS_BY_ID } from "@sf/data";
import { HexField } from "./HexField";
import { CLASS_RU, COLS, ROWS, attackObstacle, obstacleAt, stackAt, type Battle, type Formation, type Result, type Stack } from "./model";
import {
  ability, activeStack, aiTurn, attack, autoBattle, canAttack, checkEnd, clone, createMockBattle,
  defend, deploy, formation, moveActive, preview, reachable, resetDeploy, start, wait,
} from "./adapter";

type Screen = "deploy" | "battle" | "result";
const FORMATIONS: Array<{ id: Formation; ru: string; hint: string }> = [
  { id: "line", ru: "Линия", hint: "танки впереди, стрелки за ними" },
  { id: "wedge", ru: "Клин", hint: "тяжёлые в центре, лёгкие на флангах" },
  { id: "echelon", ru: "Эшелон", hint: "ступенчатая линия" },
  { id: "guard", ru: "Охрана", hint: "стрелки под прикрытием" },
];
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => { const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)"); if (!mq) return; const on = () => setReduced(mq.matches); on(); mq.addEventListener?.("change", on); return () => mq.removeEventListener?.("change", on); }, []);
  return reduced;
}

/** S30 расстановка / S31 бой / S32 итог — модальный слой L0 (мок-провайдер до battle-grid). */
export function GridBattleOverlay({ game, onClose, onFinish, coop = false, seed = 42 }: { game: Game; onClose: () => void; onFinish?: (result: Result) => void; coop?: boolean; seed?: number }) {
  const [battle, setBattle] = useState<Battle>(() => createMockBattle({ coop, seed }));
  const [screen, setScreen] = useState<Screen>("deploy");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetObstacle, setTargetObstacle] = useState<{ q: number; r: number } | null>(null);
  const [listMode, setListMode] = useState(false);
  const [hint, setHint] = useState(L("Расставьте стэки в 3 колонках слева или нажмите «Авто».", "Deploy stacks in the 3 left columns or press Auto."));
  const [hover, setHover] = useState<{ q: number; r: number } | null>(null);
  const [abilityOpen, setAbilityOpen] = useState(false);
  const [timer, setTimer] = useState(90);
  const reduced = useReducedMotion();
  const update = useCallback((next: Battle) => setBattle(next), []);
  const active = activeStack(battle);
  const selected = battle.stacks.find((s) => s.id === selectedId) ?? active;
  useEffect(() => { setTargetId(null); setTargetObstacle(null); }, [battle.activeId]);
  const playerStacks = battle.stacks.filter((s) => s.side === "player");
  const enemyStacks = battle.stacks.filter((s) => s.side === "enemy");
  const toast = (text: string): void => { try { game.toast(text, "info"); } catch { /* noop */ } };
  const close = (): void => {
    try { game.setNarrativeModalOpen?.(false); } catch { /* noop */ }
    if (battle.phase === "result" && battle.result && onFinish) onFinish(battle.result);
    onClose();
  };

  const reach = useMemo(() => (screen === "battle" && active?.side === "player" ? reachable(battle, active.id) : []), [battle, active, screen]);
  const targets = useMemo(() => (screen === "battle" && active?.side === "player" ? battle.stacks.filter((s) => s.side === "enemy" && s.alive && !s.reserve) : [] as Stack[]), [battle, active, screen]);

  useEffect(() => { if (!battle.coop || screen !== "deploy") return; const id = window.setInterval(() => setTimer((v) => { if (v <= 1) { window.clearInterval(id); const b = autoBattle(start(clone(battle))); setBattle(b); setScreen("result"); return 0; } return v - 1; }), 1000); return () => window.clearInterval(id); }, [battle, screen]);
  useEffect(() => { if (screen !== "battle" || battle.phase !== "battle") return; const a = activeStack(battle); if (!a || a.side !== "enemy") return; const id = window.setTimeout(() => { setBattle((prev) => { if (prev.phase !== "battle" || activeStack(prev)?.side !== "enemy") return prev; const next = aiTurn(prev); if (next.phase === "result") setScreen("result"); return next; }); }, reduced ? 60 : 520); return () => window.clearTimeout(id); }, [battle, screen, reduced]);
  useEffect(() => { if (battle.phase === "result" && screen !== "result") setScreen("result"); }, [battle.phase, screen]);

  const showHint = (text: string): void => setHint(text);
  const doAction = (kind: string): void => {
    if (kind === "autoDeploy") { const b = clone(battle); formation(b, "line", "player"); autoPlace(b); update(b); showHint(L("Авто-расстановка применена.", "Auto deployment applied.")); return; }
    if (kind === "reset") { update(resetDeploy(clone(battle))); setSelectedId(null); return; }
    if (kind === "fight") { if (battle.deploymentCount < 1) { showHint(L("Нужен хотя бы 1 стэк на поле.", "At least 1 stack on the field.")); return; } const b = start(clone(battle)); setBattle(b); setScreen("battle"); showHint(L("Раунд 1. Ход по инициативе.", "Round 1. Initiative order.")); return; }
    if (kind === "auto") { const b = autoBattle(clone(battle)); setBattle(b); setScreen("result"); return; }
    if (screen !== "battle" || !active || active.side !== "player") return;
    const b = clone(battle);
    if (kind === "wait") wait(b); else if (kind === "defend") defend(b); else if (kind === "ability") ability(b);
    setBattle(b); if (b.phase === "result") setScreen("result");
  };
  const useAbility = (abilityId: string): void => {
    if (!active || active.side !== "player") return;
    const b = clone(battle); ability(b, abilityId); setBattle(b); setAbilityOpen(false);
    if (b.phase === "result") setScreen("result");
  };

  const doAttack = (): void => {
    if (!active || active.side !== "player") return;
    if (targetObstacle) {
      const b = clone(battle); if (attackObstacle(b, targetObstacle.q, targetObstacle.r)) { setBattle(b); setTargetObstacle(null); showHint(L("Препятствие обстреляно.", "Obstacle hit.")); }
      return;
    }
    const target = targetId ? battle.stacks.find((s) => s.id === targetId) : null;
    if (!target || !target.alive) return;
    const ranged = active.range > 1 && canAttack(battle, active, target, true).ok;
    const res = canAttack(battle, active, target, ranged);
    if (!res.ok) { showHint(res.reason ?? L("Цель недоступна", "Target unavailable")); return; }
    const b = clone(battle); attack(b, active.id, target.id, ranged); setBattle(b); setTargetId(null); if (b.phase === "result") setScreen("result");
  };
  const onHex = (q: number, r: number): void => {
    if (screen === "deploy") {
      if (selectedId && battle.stacks.find((s) => s.id === selectedId)?.side === "player" && battle.stacks.find((s) => s.id === selectedId)?.reserve) {
        const res = deploy(clone(battle), selectedId, q, r); if (!res.ok) { showHint(res.reason ?? "Нельзя"); return; } const b = clone(battle); deploy(b, selectedId, q, r); setBattle(b); setSelectedId(null); showHint(L("Поставлено.", "Deployed.")); return;
      }
      const s = stackAt(battle, q, r); if (s && s.side === "player") setSelectedId(s.id);
      return;
    }
    if (screen !== "battle" || !active || active.side !== "player") return;
    const target = stackAt(battle, q, r);
    if (target && target.side === "enemy") {
      setTargetId(target.id); setTargetObstacle(null);
      const ranged = active.range > 1 && canAttack(battle, active, target, true).ok;
      const ok = canAttack(battle, active, target, ranged).ok;
      const p = preview(battle, active.id, target.id, ranged);
      showHint(ok ? L("Цель: ", "Target: ") + target.name + " · " + L("прогноз", "forecast") + " " + p.min + "–" + p.max + L(" урона. Нажмите «Атака».", " damage. Press Attack.") : (canAttack(battle, active, target, true).reason ?? L("Цель недоступна", "Target unavailable")));
      return;
    }
    if (reach.some((h) => h.q === q && h.r === r)) { const b = clone(battle); moveActive(b, q, r); setBattle(b); setTargetId(null); setTargetObstacle(null); return; }
    const obs = battle.obstacles.find((o) => o.q === q && o.r === r && (o.kind === "asteroid" || o.kind === "debris"));
    if (obs) { setTargetObstacle({ q, r }); setTargetId(null); showHint(L("Препятствие: ", "Obstacle: ") + (obs.kind === "asteroid" ? "астероид" : "обломки") + " — «Атака» разрушит."); return; }
    const s = stackAt(battle, q, r); if (s) setSelectedId(s.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab" && e.altKey) { e.preventDefault(); setListMode((v) => !v); return; }
      if (screen === "battle") {
        if (e.key === " " || e.key === "1") { e.preventDefault(); doAction("wait"); }
        else if (e.key.toLowerCase() === "d") { e.preventDefault(); doAction("defend"); }
        else if (e.key.toLowerCase() === "e") { e.preventDefault(); doAction("ability"); }
        else if (e.key.toLowerCase() === "a") { e.preventDefault(); doAction("auto"); }
      } else if (screen === "deploy") {
        if (e.key.toLowerCase() === "f") { e.preventDefault(); doAction("autoDeploy"); }
        else if (e.key === "Enter") { e.preventDefault(); doAction("fight"); }
      }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!navigator.getGamepads) return; let raf = 0; let last = 0;
    const tick = (now: number) => { raf = requestAnimationFrame(tick); if (now - last < 200) return; last = now; const gp = navigator.getGamepads()[0]; if (!gp) return;
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0; let q = battle.cursor.q, r = battle.cursor.r;
      if (ax < -0.5 || gp.buttons[14]?.pressed) q -= 1; else if (ax > 0.5 || gp.buttons[15]?.pressed) q += 1;
      else if (ay < -0.5 || gp.buttons[12]?.pressed) r -= 1; else if (ay > 0.5 || gp.buttons[13]?.pressed) r += 1;
      if (q !== battle.cursor.q || r !== battle.cursor.r) update({ ...battle, cursor: { q: Math.max(0, Math.min(COLS - 1, q)), r: Math.max(0, Math.min(ROWS - 1, r)) } });
      if (gp.buttons[0]?.pressed) onHex(battle.cursor.q, battle.cursor.r);
      if (gp.buttons[2]?.pressed) doAction("ability");
      if (gp.buttons[8]?.pressed) doAction("wait");
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  });

  const listModeToggle = (): void => setListMode((v) => !v);
  return (
    <div className="sf-gridbattle-layer" data-testid="grid-battle" data-screen={screen} data-reduced={reduced ? "1" : "0"}>
      <div className="sf-gridbattle" role="dialog" aria-modal="true" aria-label={L("Сетка командования", "Grid Command")}>
        <header className="sf-gridbattle__head">
          <b className="sf-gold">{screen === "deploy" ? L("Перед боем · расстановка", "Pre-battle · deployment") : screen === "battle" ? L("Бой · ", "Battle · ") + battle.round + "/30" : L("Итог боя", "Battle result")}</b>
          <span className="sf-meta">{battle.systemName} · {battle.title}</span>
          <Badge tone="info">{L("Сетка · L0", "Grid · L0")}</Badge>
          {battle.coop && <Badge tone="warn">{L("Кооп · таймер", "Co-op · timer")}</Badge>}
          <span className="sf-spacer" />
          {screen === "deploy" && <span className={"sf-gridtimer" + (battle.coop && timer <= 10 ? " sf-gridtimer--low" : "")} data-testid="grid-timer">{battle.coop ? L("до авто: ", "auto in ") + timer + L(" с", " s") : L("время не ограничено", "no time limit")}</span>}
          <Btn size="sm" variant="ghost" onClick={listModeToggle} testId="grid-toggle-list">{listMode ? L("Показать поле", "Show field") : L("Списком", "As list")}</Btn>
          <Btn size="sm" variant="ghost" onClick={close} testId="grid-close">{L("На карту", "To map")}</Btn>
        </header>

        {screen !== "result" && (
          <div className="sf-gridbattle__body">
            <aside className="sf-gridbattle__left">
              <Panel title={L("Ростер", "Roster")} testId="grid-roster">
                <div className="sf-meta" data-testid="grid-deploy-count">{L("На поле", "On field")}: {battle.deploymentCount}/7 · {L("резерв", "reserve")}: {battle.reserveCount}/3</div>
                <div className="sf-gridroster">{playerStacks.map((s) => (
                  <button key={s.id} type="button" data-testid={"grid-roster-" + s.id} className={"sf-gridroster__card" + (selectedId === s.id ? " sf-gridroster__card--on" : "") + (s.reserve ? " sf-gridroster__card--reserve" : "")} onClick={() => { setSelectedId(s.id); showHint(L("Выберите гекс в зоне слева.", "Choose a hex in the left zone.")); }}>
                    <span className="sf-gridroster__icon">●</span><span className="sf-gridroster__name">{CLASS_RU[s.cls]} «{s.name}»</span>
                    <span className="sf-gridroster__meta">{s.count} · HP {Math.round(s.hp)}/{s.maxHp} · {s.reserve ? L("резерв", "reserve") : "q" + s.q + ",r" + s.r}</span>
                  </button>))}</div>
                <Sep />
                {screen === "deploy" && <div className="sf-gridrow" style={{ flexWrap: "wrap", marginTop: 6 }}>
                  <Btn size="sm" variant="primary" onClick={() => doAction("autoDeploy")} testId="btn-grid-auto">{L("Авто", "Auto")}</Btn>
                  <Btn size="sm" onClick={() => doAction("reset")} testId="btn-grid-reset">{L("Сброс", "Reset")}</Btn>
                  <Btn size="sm" variant="primary" disabled={battle.deploymentCount === 0} onClick={() => doAction("fight")} testId="btn-grid-fight">{L("В бой ▶", "To battle ▶")}</Btn>
                </div>}
              </Panel>
            </aside>

            <main className="sf-gridbattle__center">
              <div className="sf-gridhelp" data-testid="grid-help">
                {screen === "deploy"
                  ? L("1) Выберите корабль в ростере слева. 2) Кликните гекс в голубой зоне. 3) «В бой».", "1) Pick a ship in the roster. 2) Click a hex in the blue zone. 3) To battle.")
                  : L("Жёлтый — ваш активный стэк. Синие гексы — ход. Клик по врагу — атака; наведите для прогноза.", "Yellow is your active stack. Blue hexes are moves. Click an enemy to attack; hover for forecast.")}
              </div>
              {listMode ? <BattleList battle={battle} onSelect={setSelectedId} onAttack={(tid) => { if (!active || active.side !== "player") return; const target = battle.stacks.find((s) => s.id === tid); if (!target) return; const b = clone(battle); attack(b, active.id, target.id, active.range > 1 && canAttack(battle, active, target, true).ok); setBattle(b); if (b.phase === "result") setScreen("result"); }} />
                : <HexField battle={battle} reach={reach} targets={targets} selectedTargetId={targetId} targetObstacle={targetObstacle} onHexClick={onHex} onHover={(q, r) => setHover({ q, r })} reducedMotion={reduced} />}
              {screen === "battle" && <div className="sf-gridactions" data-testid="grid-actions">
                <Btn size="sm" variant={targetId || targetObstacle ? "primary" : "default"} disabled={!active || active.side !== "player" || (!targetId && !targetObstacle)} onClick={doAttack} testId="btn-grid-attack">{L("Атака", "Attack")} [F]</Btn>
                <Btn size="sm" variant="primary" disabled={!active || active.side !== "player"} onClick={() => doAction("wait")} testId="btn-grid-wait">{L("Ждать", "Wait")} [Space]</Btn>
                <Btn size="sm" disabled={!active || active.side !== "player"} onClick={() => doAction("defend")} testId="btn-grid-defend">{L("Защита", "Defend")} [D]</Btn>
                <Btn size="sm" disabled={!active || active.side !== "player" || active.mp < 1} onClick={() => { setAbilityOpen((v) => !v); }} testId="btn-grid-ability">{L("Способность", "Ability")} [E]</Btn>
                <Btn size="sm" onClick={() => doAction("auto")} testId="btn-grid-auto-battle">{L("Авто-бой", "Auto battle")} [A]</Btn>
                <Btn size="sm" variant="danger" onClick={close} testId="btn-grid-retreat">{L("Отступить", "Retreat")}</Btn>
              </div>}
              {abilityOpen && active && active.side === "player" && (
                <div className="sf-gridabilities" data-testid="grid-ability-menu">
                  {(active.abilities ?? []).map((id) => BATTLE_ABILITY_BY_ID[id]).filter((ab) => ab && ab.kind === "active").map((ab) => (
                    <Btn key={ab!.id} size="sm" title={ab!.descRu} onClick={() => useAbility(ab!.id)} testId={"grid-ability-" + ab!.id}>{ab!.titleRu}</Btn>
                  ))}
                  {(active.abilities ?? []).filter((id) => BATTLE_ABILITY_BY_ID[id]?.kind === "active").length === 0 && <span className="sf-meta">{L("Нет активных способностей (пассив класса).", "No active abilities (class passive).")}</span>}
                </div>
              )}
              {(() => {
                if (screen !== "battle" || !hover || !active || active.side !== "player") return null;
                const target = stackAt(battle, hover.q, hover.r);
                if (!target || target.side !== "enemy") return null;
                const ranged = active.range > 1 && canAttack(battle, active, target, true).ok;
                const melee = canAttack(battle, active, target, false).ok;
                if (!ranged && !melee) return null;
                const p = preview(battle, active.id, target.id, ranged);
                return <div className="sf-gridpreview" data-testid="grid-damage-preview">{L("Прогноз", "Forecast")}: {p.min}–{p.max} {L("урона", "damage")} · {L("потери", "losses")} {p.loseMin}–{p.loseMax} {L("корп.", "ships")}{p.counter > 0 ? " · " + L("ответ", "counter") + " " + p.counter : ""}{ranged ? " · " + L("стрельба", "ranged") : " · " + L("контакт", "melee")}</div>;
              })()}
              <div className="sf-meta sf-gridbattle__hint" data-testid="grid-hint">{hint}</div>
            </main>

            <aside className="sf-gridbattle__right">
              {screen === "deploy" ? <>
                <Panel title={L("Формации", "Formations")} testId="grid-formations">
                  <div className="sf-gridrow" style={{ flexWrap: "wrap" }}>{FORMATIONS.map((f) => <Btn key={f.id} size="sm" title={f.hint} onClick={() => { const b = clone(battle); formation(b, f.id, "player"); update(b); showHint(L("Формация: ", "Formation: ") + f.ru); }} testId={"btn-grid-formation-" + f.id}>{f.ru}</Btn>)}</div>
                </Panel>
                <Panel title={L("Разведка о враге", "Enemy intel")} testId="grid-intel">
                  <div className="sf-meta">{L("Стэков", "Stacks")}: {enemyStacks.length} · FP ≈ {enemyStacks.reduce((a, s) => a + s.maxHp, 0)}</div>
                  <div className="sf-gridrow" style={{ flexWrap: "wrap" }}>{enemyStacks.slice(0, 7).map((s) => <span key={s.id} className="sf-ui-chip">▲ {CLASS_RU[s.cls]}</span>)}</div>
                </Panel>
                <Btn size="sm" variant="ghost" onClick={close} testId="btn-grid-cancel">{L("Отмена", "Cancel")}</Btn>
              </> : <>
                <Panel title={L("Инициатива", "Initiative")} testId="grid-initiative"><div className="sf-gridinit">{battle.order.slice(0, 14).map((id) => { const s = battle.stacks.find((x) => x.id === id); if (!s) return null; return <span key={id} className={"sf-gridinit__tok" + (id === battle.activeId ? " sf-gridinit__tok--on" : "")} data-testid={"grid-init-" + id}>{s.side === "player" ? "●" : "▲"} {CLASS_RU[s.cls].slice(0, 3)} {s.count}</span>; })}</div></Panel>
                {selected && <StackCard stack={selected} />}
                <Panel title={L("Журнал боя", "Combat log")} testId="grid-log" right={<Badge tone="info">{battle.log.length}</Badge>}><div className="sf-gridlog">{battle.log.slice(-8).reverse().map((l, i) => <div key={i} className={"sf-gridlog__line sf-gridlog__line--" + l.kind}>[{l.round}] {l.text}</div>)}</div></Panel>
              </>}
            </aside>
          </div>
        )}

        {screen === "result" && battle.result && (
          <div className="sf-gridresult" data-testid="grid-result">
            <h2>{battle.result.winner === "player" ? L("Победа", "Victory") : battle.result.winner === "enemy" ? L("Поражение", "Defeat") : L("Пат", "Draw")} · {battle.systemName}</h2>
            <div className="sf-gridresult__cols">
              <Panel title={L("Потери", "Losses")} testId="grid-result-losses"><table className="sf-gridtable"><thead><tr><th>{L("Сторона", "Side")}</th><th>{L("Стэк", "Stack")}</th><th>{L("Потеряно", "Lost")}</th><th>FP</th></tr></thead><tbody>{battle.result.losses.map((l, i) => <tr key={i}><td>{l.side === "player" ? "●" : "▲"}</td><td>{CLASS_RU[l.cls]} «{l.name}»</td><td>{l.lost}</td><td>{Math.round(l.fp)}</td></tr>)}</tbody></table></Panel>
              <Panel title={L("Трофеи и опыт", "Spoils & XP")} testId="grid-result-rewards">
                <div className="sf-kv"><span>{L("Кредиты", "Credits")}</span><b>{battle.result.spoils.credits}</b></div>
                <div className="sf-kv"><span>{L("Сплавы", "Alloys")}</span><b>{battle.result.spoils.alloys}</b></div>
                <div className="sf-kv"><span>{L("Образцы", "Samples")}</span><b>{battle.result.spoils.samples}</b></div>
                <div className="sf-kv"><span>XP</span><b>{battle.result.xp}</b></div>
                <div className="sf-kv"><span>{L("Военный счёт", "War score")}</span><b>+{battle.result.warScore}</b></div>
                <Sep /><div className="sf-meta">MVP: {battle.result.mvpName} · {Math.round(battle.result.mvpDamage)} {L("урона", "damage")}</div>
                <div className="sf-meta" data-testid="grid-parity">{L("≈ авторезолв: потери", "≈ auto-resolve losses")} {battle.result.parity.autoMin}–{battle.result.parity.autoMax}% ({L("ваши", "yours")}: {battle.result.parity.actual}%) · seed {battle.result.seed}</div>
              </Panel>
            </div>
            <div className="sf-gridrow" style={{ justifyContent: "flex-end", marginTop: 10 }}>
              <Btn onClick={() => { setBattle(start(createMockBattle({ coop, seed }))); setScreen("battle"); }} testId="btn-grid-replay">{L("Повторить просмотр", "Replay")}</Btn>
              <Btn onClick={() => toast(L("Отчёт добавлен в журнал.", "Report added to journal."))} testId="btn-grid-journal">{L("В журнал", "To journal")}</Btn>
              <Btn onClick={() => { void navigator.clipboard?.writeText("seed:" + battle.result!.seed); toast(L("Seed скопирован.", "Seed copied.")); }} testId="btn-grid-share">{L("Поделиться seed", "Share seed")}</Btn>
              <Btn variant="primary" onClick={close} testId="btn-grid-to-map">{L("На карту", "To map")}</Btn>
            </div>
          </div>
        )}
        <div className="sf-meta sf-gridbattle__foot">{L("Клавиатура: 1, Space, D, E, A, Esc · Tab+Alt — список · геймпад: LS/DPad, A, X, View", "Keyboard: 1, Space, D, E, A, Esc · Tab+Alt list · gamepad: LS/DPad, A, X, View")}</div>
      </div>
    </div>
  );
}

function autoPlace(b: Battle): void {
  const free: Array<{ q: number; r: number }> = [];
  for (let q = 0; q <= 2; q++) for (let r = 0; r < ROWS; r++) if (obstacleAt(b, q, r) === "void" && !stackAt(b, q, r)) free.push({ q, r });
  for (const s of b.stacks.filter((x) => x.side === "player" && x.reserve)) { const spot = free.shift(); if (!spot) break; s.q = spot.q; s.r = spot.r; s.reserve = false; }
  for (const s of b.stacks.filter((x) => x.side === "player" && !x.reserve).slice(7)) s.reserve = true;
}
function StackCard({ stack }: { stack: Stack }) {
  return <Panel title={L("Стэк", "Stack")} testId="grid-stack-card">
    <div className="sf-row"><b>{CLASS_RU[stack.cls]} «{stack.name}»</b><span className="sf-spacer" /><Badge tone={stack.side === "player" ? "info" : "warn"}>{stack.side === "player" ? "●" : "▲"}</Badge></div>
    <div className="sf-meta">{L("кораблей", "ships")}: {stack.count} · MP {stack.mp}/{stack.maxMp}</div>
    <div className="sf-gridbar"><span style={{ width: Math.max(0, Math.min(100, stack.hp / stack.maxHp * 100)) + "%" }} /></div>
    <div className="sf-meta">HP {Math.round(stack.hp)}/{stack.maxHp} · {L("щит", "shield")} {Math.round(stack.shield)} · {L("урон", "damage")} {stack.dmg} · {L("дальн.", "range")} {stack.range}</div>
    <div className="sf-meta">{stack.defended ? L("защищается (+20%)", "defending (+20%)") : stack.waited ? L("ожидает", "waiting") : L("готов", "ready")}{stack.moved ? " · " + L("ходил", "acted") : ""}</div>
    {(() => { const def = BATTLE_CLASS_BY_ID[stack.cls]; const pas = def?.passiveAbilityId ? BATTLE_ABILITY_BY_ID[def.passiveAbilityId] : null; return pas ? <div className="sf-meta" data-testid="grid-stack-passive">{L("пассив", "passive")}: {pas.titleRu} — {pas.descRu}</div> : null; })()}
  </Panel>;
}
function BattleList({ battle, onSelect, onAttack }: { battle: Battle; onSelect: (id: string) => void; onAttack: (id: string) => void }) {
  const active = battle.stacks.find((s) => s.id === battle.activeId);
  return <div className="sf-gridlist" data-testid="grid-list"><table className="sf-gridtable"><thead><tr><th>{L("Сторона", "Side")}</th><th>{L("Стэк", "Stack")}</th><th>N</th><th>HP</th><th>{L("Гекс", "Hex")}</th><th>{L("Состояние", "State")}</th><th>{L("Действия", "Actions")}</th></tr></thead><tbody>{battle.stacks.filter((s) => s.alive && !s.reserve).map((s) => <tr key={s.id} data-testid={"grid-list-row-" + s.id} className={s.id === battle.activeId ? "sf-gridtable__active" : ""}><td>{s.side === "player" ? "●" : "▲"}</td><td>{CLASS_RU[s.cls]} «{s.name}»</td><td>{s.count}</td><td>{Math.round(s.hp)}</td><td>q{s.q},r{s.r}</td><td>{s.defended ? L("защита", "defend") : s.waited ? L("ожидает", "wait") : s.moved ? L("ходил", "acted") : L("готов", "ready")}</td><td><button type="button" className="sf-btn sf-btn--sm" onClick={() => onSelect(s.id)}>{L("Выбрать", "Select")}</button>{active?.side === "player" && s.side === "enemy" && <button type="button" className="sf-btn sf-btn--sm" onClick={() => onAttack(s.id)}>{L("Атака", "Attack")}</button>}</td></tr>)}</tbody></table></div>;
}