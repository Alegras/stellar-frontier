import { useMemo, useState } from "react";
import { Badge, Btn, Field, KV, Panel, Sep, Tip } from "./controls";
import { L, fgOf, playerIdOf, send, tr, useLocale, type FullPanelProps } from "./fg";
import { intText, playerEmpire, rnd, worldOf } from "./util";

export interface CoopLobbyPlayer {
  id: number;
  name: string;
  ready: boolean;
  empire?: string;
  isHost?: boolean;
}
export interface CoopLobbyState {
  code?: string;
  hostId?: number;
  players: CoopLobbyPlayer[];
  mode: "coop" | "mmo";
  connected: boolean;
}
/** Контракт для src/net (qa-engineer): UI зовёт колбэки, реализацию подключает Lead. */
export interface CoopCallbacks {
  create?: (mode: "coop" | "mmo") => void;
  join?: (code: string) => void;
  leave?: () => void;
  setReady?: (ready: boolean) => void;
  start?: () => void;
}
export const COOP_NOOP: CoopCallbacks = {};

export function CoopPanel({
  game, state, callbacks = COOP_NOOP, lobby,
}: FullPanelProps & { callbacks?: CoopCallbacks; lobby?: CoopLobbyState | null }) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const fg = fgOf(world);
  useLocale();
  const [mode, setMode] = useState<"coop" | "mmo">("coop");
  const [code, setCode] = useState("");

  const players = useMemo<CoopLobbyPlayer[]>(() => {
    if (lobby?.players?.length) return lobby.players;
    return [{
      id: playerIdOf(world),
      name: emp?.name ?? "Адмирал",
      ready: true,
      empire: emp?.name,
      isHost: true,
    }];
  }, [lobby, world, emp]);

  const isHost = lobby ? lobby.hostId === playerIdOf(world) : true;
  const readyCount = players.filter((p) => p.ready).length;
  const mp = fg?.multiplayer;
  const tacticalLeft = mp && mp.tacticalLockUntil > (world?.tick ?? 0)
    ? mp.tacticalLockUntil - (world?.tick ?? 0)
    : 0;

  return (
    <div className="sf-fg-panel" data-testid="coop-lobby">
      <div className="sf-fg-grid">
        <Panel title="Лобби · кооп 2–4 / MMO" tall
          right={<Badge tone={lobby?.connected ? "good" : "warn"}>{lobby?.connected ? "онлайн" : "локально"}</Badge>}>
          <div className="sf-fg-modes">
            {([
              ["coop", tr("modes.coop", undefined, "Кооператив 2–4"), L("Совместная галактика против ИИ, пауза — голосование", "Shared PvE galaxy, pause by vote")],
              ["mmo", tr("modes.mmo", undefined, "MMO-сезон"), L("Тик 15 минут, пауз нет, сезонные цели", "15-minute tick, no pause, seasonal goals")],
            ] as ["coop" | "mmo", string, string][]).map(([id, title, desc]) => (
              <button key={id} type="button" className={"sf-fg-mode" + (mode === id ? " sf-fg-mode--on" : "")}
                onClick={() => setMode(id)} data-testid={"coop-mode-" + id}>
                <b>{title}</b>
                <span className="sf-meta">{desc}</span>
              </button>
            ))}
          </div>
          <div className="sf-row" style={{ marginTop: 6, flexWrap: "wrap", gap: 4 }}>
            <Btn variant="primary" onClick={() => callbacks.create?.(mode)} testId="btn-coop-create">{L("Создать лобби", "Create lobby")}</Btn>
            <input className="sf-input" style={{ width: 120 }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
              placeholder="КОД" aria-label="Код лобби" data-testid="input-coop-code" />
            <Btn onClick={() => callbacks.join?.(code)} disabled={code.length < 4} testId="btn-coop-join">{L("Войти по коду", "Join by code")}</Btn>
            <Btn variant="ghost" onClick={() => callbacks.leave?.()} testId="btn-coop-leave">{L("Покинуть", "Leave")}</Btn>
          </div>
          <Sep />
          <div className="sf-h">Игроки {readyCount}/{players.length}</div>
          <div className="sf-fg-slots">
            {Array.from({ length: 4 }).map((_, i) => {
              const p = players[i];
              return (
                <div key={i} className={"sf-fg-slot" + (p ? "" : " sf-fg-slot--empty")} data-testid={"coop-slot-" + i}>
                  <span className="sf-meta">Слот {i + 1}</span>
                  {p ? (
                    <>
                      <b className="sf-nowrap">{p.name}</b>
                      <span className="sf-meta">{p.isHost ? "хост" : p.empire ?? "—"}</span>
                      <Badge tone={p.ready ? "good" : "warn"}>{p.ready ? "готов" : "не готов"}</Badge>
                    </>
                  ) : <span className="sf-meta">свободно</span>}
                </div>
              );
            })}
          </div>
          <div className="sf-row" style={{ marginTop: 6, gap: 4 }}>
            <Btn onClick={() => callbacks.setReady?.(true)} testId="btn-coop-ready">{L("Я готов", "Ready")}</Btn>
            <Btn variant="primary" disabled={!isHost || readyCount < players.length} onClick={() => callbacks.start?.()} testId="btn-coop-start">{L("Начать игру", "Start game")}</Btn>
            <span className="sf-meta">Старт доступен хосту при готовности всех.</span>
          </div>
          <div className="sf-meta">
            {L("Сетевой слой подключается через колбэки клиента. Без него панель работает в локальном режиме.", "The network layer is wired via client callbacks (create / join / leave / setReady / start). Without it the panel runs locally.")}
          </div>
        </Panel>

        <Panel title="Статус мультиплеера" tall testId="mp-status">
          <div className="sf-grid2">
            <KV k={L("Режим", "Mode")} v={mode === "coop" ? "Кооп 2–4" : "MMO-сезон"} />
            <KV k={L("Игроков", "Players")} v={intText(mp?.players ?? 1)} />
            <KV k={L("Локальный", "Local")} v={mp?.enabled ? "нет" : "да"} />
            <KV k={L("Тактический лок", "Tactical lock")} v={tacticalLeft > 0 ? tacticalLeft + " такт." : "нет"} />
            <KV k={L("Голосов за паузу", "Pause votes")} v={intText(Object.values(mp?.pauseVotes ?? {}).filter(Boolean).length) + "/" + intText(mp?.players ?? 1)} />
            <KV k={L("Кулдаун паузы", "Pause cooldown")} v={intText(mp?.pauseCooldown ?? 0)} />
          </div>
          <Sep />
          <div className="sf-h">Пауза-голосование</div>
          <div className="sf-row" style={{ gap: 4 }}>
            <Btn size="sm" variant="primary" onClick={() => send(game, { type: "pause_vote", vote: true })} testId="btn-pause-vote-yes">{L("Голос за паузу", "Vote pause")}</Btn>
            <Btn size="sm" onClick={() => send(game, { type: "pause_vote", vote: false })} testId="btn-pause-vote-no">{L("Против", "Against")}</Btn>
          </div>
          <div className="sf-meta">
            В кооперативе пауза требует ≥50% голосов (мин. 2 игрока); в MMO паузы нет — только меню.
            Тактический лок: 90 секунд реального времени.
          </div>
          <Sep />
          <Tip data={{
            title: "Пинг и задержка",
            value: "—",
            lines: [{ label: "Источник", value: "src/net/NetClient (подключается Lead)" }],
            note: "До подключения сетевого слоя игрок один: пинг не отображается.",
          }}>
            <span className="sf-meta">Пинг: — (нет соединения)</span>
          </Tip>
          <div className="sf-meta">GM-счётчик такта: {intText(world?.tick ?? 0)} · seed: {intText(state.seed)}</div>
        </Panel>
      </div>
    </div>
  );
}

/** Компактный HUD мультиплеера для верхней панели (Lead подключает в App). */
export function MPStatusHud({ game, state }: Omit<FullPanelProps, "onClose">) {
  const world = worldOf(game);
  const fg = fgOf(world);
  const mp = fg?.multiplayer;
  const pid = playerIdOf(world);
  const votes = Object.values(mp?.pauseVotes ?? {}).filter(Boolean).length;
  const total = mp?.players ?? 1;
  const left = mp && mp.tacticalLockUntil > (world?.tick ?? 0) ? mp.tacticalLockUntil - (world?.tick ?? 0) : 0;
  return (
    <div className="sf-mp-hud" data-testid="mp-status-hud" role="status" aria-live="polite">
      <span className="sf-badge sf-badge--info">{mp?.enabled ? L("СЕТЬ", "MP") : L("ЛОК", "SP")}</span>
      <span className="sf-meta">{intText(total)} игр.</span>
      {left > 0 && <span className="sf-badge sf-badge--warn">лок {intText(left)}</span>}
      {votes > 0 && <span className="sf-badge">пауза {votes}/{total}</span>}
      <span className="sf-meta">такт {intText(state.tick)}</span>
      <span className="sf-meta">{L("№", "id")} {intText(pid)}</span>
    </div>
  );
}

export function mpPingLabel(pingMs: number | null | undefined): string {
  const p = rnd(pingMs ?? -1);
  if (p < 0) return "—";
  return p < 60 ? "● " + p + " мс" : p <= 140 ? "◐ " + p + " мс" : "○ " + p + " мс";
}
