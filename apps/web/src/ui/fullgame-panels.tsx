import { useEffect, useRef, useState } from "react";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import { Badge, Btn, Modal, Panel, Sep } from "./controls";
import { CoopPanel, MPStatusHud, type CoopCallbacks, type CoopLobbyState } from "./CoopPanel";
import { L, dlcModalStateOf, dlcOf, fgOf, send, tr } from "./fg";
import { PANEL_IDS, PANEL_REGISTRY, PANEL_TITLES } from "./fullgame-registry";
import type { PanelId } from "./fullgame-registry";
import { DialogueOverlay } from "./DialogueOverlay";
import { AiWorldEventModal } from "./WorldPoliticsPanel";
import { BattleChoiceModal } from "./BattleChoiceModal";
import { worldOf } from "./util";
import { DLC_QUEST_BY_ID, L10N_RU } from "@sf/data";
import { GridBattleOverlay } from "./grid-battle/GridBattleOverlay";

// PanelId/PANEL_TITLES/PANEL_REGISTRY живут в fullgame-registry.ts (без JSX), чтобы
// react-refresh не ругался на смешанные экспорты. Здесь только компоненты.
export type { PanelId } from "./fullgame-registry";
// Совместимость с App: карта панелей и список кнопок меню.
export { PANEL_IDS, PANEL_REGISTRY, PANEL_TITLES } from "./fullgame-registry";

export interface PanelHostProps {
  panel: PanelId | null;
  game: Game;
  state: GameState;
  onClose: () => void;
  /** для кооп-лобби: сетевые колбэки из src/net (qa-engineer), пока стабы */
  coopCallbacks?: CoopCallbacks;
  coopLobby?: CoopLobbyState | null;
}

/** Кнопки меню «Ещё…» со стабильными data-testid="panel-open-{PanelId}" (для QA и App). */
export function PanelMenuList({ onPick, current }: { onPick: (id: PanelId) => void; current?: PanelId | null }) {
  return (
    <div className="sf-list" data-testid="full-panel-menu-list">
      {PANEL_IDS.map((id) => (
        <Btn key={id} onClick={() => onPick(id)} testId={"panel-open-" + id} active={current === id}>
          {PANEL_TITLES[id]}
        </Btn>
      ))}
    </div>
  );
}

/** Универсальный хост: модальный оверлей с любой панелью полной игры. Lead подключает в App. */
export function PanelHost({ panel, game, state, onClose, coopCallbacks, coopLobby }: PanelHostProps) {
  if (!panel) return null;
  const Comp = PANEL_REGISTRY[panel];
  if (!Comp) return null;
  return (
    <Modal
      title={PANEL_TITLES[panel] ?? panel}
      wide
      onClose={onClose}
      testId={"panel-" + panel}
      overlayTestId="overlays-root"
      closeTestId={"btn-close-panel-" + panel}
    >
      {panel === "coop" ? (
        <CoopPanel game={game} state={state} onClose={onClose} callbacks={coopCallbacks} lobby={coopLobby} />
      ) : (
        <Comp game={game} state={state} onClose={onClose} />
      )}
    </Modal>
  );
}

/**
 * Глобальные оверлеи полной игры, которые Lead монтирует один раз в App:
 * события кампании (модалка выбора), кризис-алерты, HUD мультиплеера.
 */

const RESOURCE_RU: Record<string, string> = {
  credits: "кредиты", alloys: "сплавы", energy: "энергия", minerals: "минералы", food: "пища", goods: "товары",
  influence: "влияние", unity: "единство", population: "население", stability: "стабильность колоний",
};
const EVENT_FLAG_RU: Record<string, string> = {
  pirate_paid: "пираты получили дань — торговый путь спокоен",
  pirate_attacked: "пираты атакованы — их эскадра в вашей системе",
};
function campaignEffectRu(target: string, value: number): string {
  const sign = value > 0 ? "+" : "";
  if (target.startsWith("science.")) return "наука (" + target.slice(8) + ") " + sign + value;
  if (target.startsWith("flag:")) return "флаг кампании: " + target.slice(5);
  if (target.startsWith("rep.")) return "отношения: " + target.slice(4) + " " + sign + value;
  if (target.startsWith("opinion:")) return "мнение империи " + target.slice(8) + " " + sign + value;
  if (target.startsWith("battle:")) return "начнётся бой (" + target.split(":")[1] + ")";
  return (RESOURCE_RU[target] ?? target) + " " + sign + value;
}

export function FullGameOverlays({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const fg = fgOf(world);
  // feature-flag DLC для стартов через API (меню шлёт dlc_toggle само): один раз на мир
  const dlcFlagSynced = useRef<string>("");
  useEffect(() => {
    const world = worldOf(game);
    if (!world) return;
    const d = dlcOf(world);
    if (!d) return;
    const key = world.seed + ":" + world.tick;
    if (dlcFlagSynced.current.startsWith(world.seed + ":")) return;
    let flag: string | null = null;
    try { flag = localStorage.getItem("sf.dlc"); } catch { /* noop */ }
    if (flag === "0" && d.enabled) { send(game, { type: "dlc_toggle", enabled: false } as never); dlcFlagSynced.current = key; }
    else if (flag === "1" && !d.enabled) { send(game, { type: "dlc_toggle", enabled: true } as never); dlcFlagSynced.current = key; }
    else dlcFlagSynced.current = key;
  }, [game, state.started, state.seed]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [lastPendingId, setLastPendingId] = useState<string | null>(null);
  const [gridBattle, setGridBattle] = useState<{ seed: number; coop: boolean; systemName: string; systemId?: number; pending?: { attackerFleetId: number; defenderFleetId: number; playerSide: "attacker" | "defender" } } | null>(null);

  const pending = fg?.narrative.pending ?? [];
  const eventRaw = pending.find((e) => !dismissed.includes(e.id)) ?? null;
  // Приоритет диалога: пока DLC/кампанийный диалог активен, событийные модалки не показываем
  // и их пауза не включается — очередь событий ждёт закрытия диалога.
  const dialogueActive = !!dlcOf(world)?.dialogue?.active || (dlcModalStateOf(world)?.dialogueActive ?? false);
  const event = dialogueActive ? null : eventRaw;
  const dismiss = () => {
    if (!event) return;
    send(game, { type: "event_dismiss", eventId: event.id });
    setDismissed((d) => [...d, event.id]);
  };
  useEffect(() => {
    if (event && event.id !== lastPendingId) setLastPendingId(event.id);
  }, [event, lastPendingId]);

  // Пока открыта модалка события — игровое время стоит до выбора (и очередь не растёт).
  useEffect(() => {
    game.setNarrativeModalOpen(!!event || !!gridBattle);
  }, [event?.id, gridBattle, game]);
  useEffect(() => () => game.setNarrativeModalOpen(false), [game]);

  const activeCrises = (fg?.crises ?? []).filter((c) => !c.defeated);
  const mp = fg?.multiplayer;

  useEffect(() => {
    const onGrid = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { seed?: number; coop?: boolean; systemId?: number; pending?: { attackerFleetId: number; defenderFleetId: number; playerSide: "attacker" | "defender" } } | undefined;
      let flag = "1";
      try { flag = localStorage.getItem("sf.gridBattle") ?? "0"; } catch { /* noop */ }
      if (flag === "0" && !detail?.pending) return;
      const world = worldOf(game);
      const system = world && detail?.systemId != null ? world.systems.find((s) => s.id === detail.systemId) : null;
      setGridBattle({ seed: detail?.seed ?? 42, coop: Boolean(detail?.coop), systemName: system?.name ?? "Вега-II", systemId: detail?.systemId, pending: detail?.pending });
    };
    window.addEventListener("sf:grid-battle", onGrid);
    return () => window.removeEventListener("sf:grid-battle", onGrid);
  }, [game]);


  const finishGrid = (result: { winner: "player" | "enemy" | "draw"; losses: { side: "player" | "enemy"; lost: number; fp: number }[]; spoils: { credits: number; alloys: number } }): void => {
    const pendingBattle = gridBattle?.pending;
    if (!pendingBattle) return;
    const w = worldOf(game);
    if (!w) return;
    const a = w.fleets.find((f) => f.id === pendingBattle.attackerFleetId);
    const b = w.fleets.find((f) => f.id === pendingBattle.defenderFleetId);
    if (!a || !b) return;
    const playerLoss = result.losses.filter((l) => l.side === "player").reduce((n, l) => n + l.fp, 0);
    const enemyLoss = result.losses.filter((l) => l.side === "enemy").reduce((n, l) => n + l.fp, 0);
    const playerShips = result.losses.filter((l) => l.side === "player").reduce((n, l) => n + l.lost, 0);
    const enemyShips = result.losses.filter((l) => l.side === "enemy").reduce((n, l) => n + l.lost, 0);
    const playerIsAttacker = pendingBattle.playerSide === "attacker";
    const outcome = result.winner === "draw" ? "draw" : result.winner === "player"
      ? (playerIsAttacker ? "attacker_win" : "defender_win")
      : (playerIsAttacker ? "defender_win" : "attacker_win");
    game.sendCommand({ type: "apply_battle", report: {
      id: (w.battles[w.battles.length - 1]?.id ?? 0) + 1,
      systemId: gridBattle?.systemId ?? a.systemId,
      tick: w.tick,
      durationSec: 0,
      attacker: { empireId: a.empireId, fleetId: a.id, fp: 0, shipsBefore: a.ships.length },
      defender: { empireId: b.empireId, fleetId: b.id, fp: 0, shipsBefore: b.ships.length },
      attackerLossFp: playerIsAttacker ? playerLoss : enemyLoss,
      defenderLossFp: playerIsAttacker ? enemyLoss : playerLoss,
      attackerShipsLost: playerIsAttacker ? playerShips : enemyShips,
      defenderShipsLost: playerIsAttacker ? enemyShips : playerShips,
      spoilsAlloys: result.spoils.alloys,
      spoilsCredits: result.spoils.credits,
      outcome: outcome as never,
      tactical: true,
    } } as never);
    setGridBattle(null);
  };

  return (
    <div data-testid="fullgame-overlays" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {activeCrises.length > 0 && (
        <div className="sf-crisis-alert" data-testid="crisis-alert" role="alert">
          <span className="sf-badge sf-badge--bad">{L("КРИЗИС", "CRISIS")}</span>
          {activeCrises.slice(0, 3).map((c) => (
            <span key={c.id} className="sf-nowrap">
              {c.titleRu} · {L("стадия", "stage")} {c.stage} · {Math.round(c.progress * 100)}%
            </span>
          ))}
          <span className="sf-meta">{L("подробности: Империя → Кампания → Кризисы", "details: Empire → Campaign → Crises")}</span>
        </div>
      )}
      <div style={{ pointerEvents: "auto" }}>
        <DialogueOverlay game={game} state={state} />
      </div>
      {!dialogueActive && !event && (
        <div style={{ pointerEvents: "auto" }}>
          <BattleChoiceModal game={game} state={state} />
          <QuestIntroModal game={game} state={state} />
        </div>
      )}
      {!dialogueActive && !event && (
        <div style={{ pointerEvents: "auto" }}>
          <AiWorldEventModal game={game} state={state} />
        </div>
      )}
      {mp?.enabled && (
        <div className="sf-mp-overlay" style={{ pointerEvents: "auto" }}>
          <MPStatusHud game={game} state={state} />
        </div>
      )}
      {gridBattle && (
        <div style={{ pointerEvents: "auto" }}>
          <GridBattleOverlay game={game} coop={gridBattle.coop} seed={gridBattle.seed} onFinish={finishGrid} onClose={() => setGridBattle(null)} />
        </div>
      )}
      {event && (
        <Modal
          title={tr("events.title", undefined, "Событие") + " · " + event.titleRu}
          onClose={dismiss}
          testId="narrative-event"
          overlayTestId="overlays-root"
          closeTestId="btn-close-event"
          footer={
            <Btn onClick={dismiss} testId="btn-later-event">
              {L("Отложить", "Later")}
            </Btn>
          }
        >
          <div className="sf-warn" data-testid="event-time-paused">{L("Время на паузе до выбора", "Time is paused until you choose")}</div>
          <div className="sf-fg-brief">{event.textRu}</div>
          <div className="sf-meta">
            {L("Цепочка", "Chain")} {event.chainId} · {L("шаг", "step")} {event.step} · {L("истекает на такте", "expires on tick")} {event.expiresTick}
          </div>
          <Sep />
          <div className="sf-h">{L("Ваш выбор", "Your choice")}</div>
          <div className="sf-list">
            {event.choices.map((ch) => (
              <div key={ch.id} className="sf-fg-choice" data-testid={"event-choice-" + ch.id}>
                <div className="sf-row">
                  <b className="sf-nowrap">{ch.labelRu}</b>
                  <span className="sf-spacer" />
                  <Btn
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      send(game, { type: "event_choice", eventId: event.id, choiceId: ch.id });
                      setDismissed((d) => [...d, event.id]);
                    }}
                    testId={"btn-choice-" + ch.id}
                  >
                    {L("Выбрать", "Choose")}
                  </Btn>
                </div>
                <div className="sf-meta">
                  {ch.effects.map((e) => campaignEffectRu(e.target, e.value)).join(" · ") || L("без прямых эффектов", "no direct effects")}
                  {ch.missionId ? " · " + L("новая миссия", "new mission") : ""}
                  {ch.flag ? " · " + (EVENT_FLAG_RU[ch.flag] ?? L("особый исход", "special outcome") + ": " + ch.flag) : ""}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}


/** Вступительная карточка квеста: даже если первый шаг не диалог, игрок видит историю и цель. */
function QuestIntroModal({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const fg = fgOf(world);
  const d = fg?.dlc;
  const questId = d?.activeQuestId ?? null;
  const quest = questId ? DLC_QUEST_BY_ID[questId] : null;
  const [seen, setSeen] = useState<string | null>(null);
  const open = Boolean(world && quest && d && !d.dialogue?.active && seen !== quest.id && (d.flags["quest_intro:" + quest.id] ?? 0) > 0);
  useEffect(() => {
    if (!open) return;
    game.setNarrativeModalOpen(true);
    return () => game.setNarrativeModalOpen(false);
  }, [open, game]);
  if (!world || !quest || !open) return null;
  const ru = (key?: string): string => (key ? (L10N_RU[key] ?? key) : "");
  return (
    <Modal title={L("Новый квест", "New quest") + " · " + ru(quest.titleKey)} onClose={() => setSeen(quest.id)} testId="quest-intro-modal" closeTestId="btn-close-quest-intro" footer={<Btn variant="primary" onClick={() => setSeen(quest.id)} testId="btn-quest-intro-ok">{L("К цели", "To objective")}</Btn>}>
      <div className="sf-gold" style={{ fontWeight: 700 }}>{ru(quest.titleKey)}</div>
      <div className="sf-meta" style={{ marginTop: 4 }}>{ru(quest.summaryKey)}</div>
      <Sep />
      <div className="sf-h">{L("Цели", "Objectives")}</div>
      <ol className="sf-list" style={{ margin: 0, paddingLeft: 18 }}>
        {quest.steps.map((st, i) => <li key={st.id} style={{ opacity: i === 0 ? 1 : 0.65 }}>{ru(st.titleKey)}</li>)}
      </ol>
      <div className="sf-meta" style={{ marginTop: 6 }}>{L("Открыть журнал: Империя → Квесты.", "Journal: Empire → Quests.")}</div>
    </Modal>
  );
}

/** Отдельный компактный список активных кризисов (для TopBar/панели империи). */
export function CrisisStrip({ game }: { game: Game }) {
  const world = worldOf(game);
  const fg = fgOf(world);
  const crises = (fg?.crises ?? []).filter((c) => !c.defeated);
  if (crises.length === 0) return null;
  return (
    <Panel title={tr("crisis.title", undefined, "Кризисы")} testId="crisis-strip" flat>
      {crises.map((c) => (
        <div key={c.id} className="sf-row">
          <Badge tone="bad">{c.titleRu}</Badge>
          <span className="sf-meta">{L("стадия", "stage")} {c.stage} · {L("прогресс", "progress")} {Math.round(c.progress * 100)}%</span>
          <span className="sf-spacer" />
          <span className="sf-meta">{L("систем", "systems")}: {c.systems.length}</span>
        </div>
      ))}
    </Panel>
  );
}

export { MPStatusHud };