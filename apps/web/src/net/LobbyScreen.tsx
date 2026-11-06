/**
 * LobbyScreen (M11): создание/вход в сетевую комнату, список игроков, ready/start,
 * пауза-голосование, тактический лок, чат. Управление — через NetClient (сервер-авторитет).
 *
 * data-testid: lobby, lobby-nick, lobby-mode, lobby-create, lobby-code, lobby-join,
 * lobby-players, lobby-ready, lobby-start, lobby-status, lobby-leave, lobby-close,
 * lobby-pause, lobby-chat, lobby-chat-input, lobby-chat-send, lobby-tactical.
 */
import { useEffect, useState } from "react";
import type { Game } from "../game/Game";
import type { MpState, NetClient } from "./NetClient";

export interface LobbyScreenProps {
  net: NetClient;
  game: Game;
  onClose: () => void;
}

const PHASE_RU: Record<string, string> = {
  offline: "не в сети", lobby: "лобби", connecting: "подключение…",
  active: "в игре", reconnecting: "переподключение…", error: "ошибка",
};

export function LobbyScreen({ net, game, onClose }: LobbyScreenProps) {
  const [mp, setMp] = useState<MpState>(net.state);
  const [nick, setNick] = useState("Пилот");
  const [code, setCode] = useState("");
  const [modeId, setModeId] = useState("coop");
  const [chatText, setChatText] = useState("");
  const [busy, setBusy] = useState(false);

  // Лёгкий поллинг состояния клиента (лобби — низкая частота, без лишних подписок).
  useEffect(() => {
    const id = setInterval(() => setMp({ ...net.state }), 200);
    return () => clearInterval(id);
  }, [net]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try { await fn(); } catch { /* ошибка уже в net.state */ }
    setBusy(false);
  };

  const seat = mp.seat;
  const me = mp.players.find((p) => p.seat === seat);
  const inLobby = mp.phase === "lobby" || mp.phase === "connecting" || mp.phase === "reconnecting";
  const allReady = mp.players.length > 0 && mp.players.every((p) => p.ready);

  return (
    <div className="sf-modal-backdrop" data-testid="lobby" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,8,18,.82)" }}>
      <div className="sf-panel" style={{ width: "min(760px, 94vw)", maxHeight: "92vh", overflow: "auto", padding: 16, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ color: "var(--sf-accent, #F5C542)" }}>СЕТЕВАЯ ИГРА · кооп 2–4 / MMO</b>
          <button className="sf-btn" data-testid="lobby-close" onClick={onClose}>Закрыть</button>
        </div>

        <div className="sf-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="sf-meta">Ник{" "}
            <input className="sf-input" data-testid="lobby-nick" value={nick} maxLength={24}
              onChange={(e) => setNick(e.target.value)} style={{ width: 140 }} />
          </label>
          <label className="sf-meta">Режим{" "}
            <select className="sf-input" data-testid="lobby-mode" value={modeId} onChange={(e) => setModeId(e.target.value)}>
              <option value="coop">Кооператив 2–4</option>
              <option value="mmo">MMO-сезон 30–100</option>
            </select>
          </label>
          <button className="sf-btn sf-btn--primary" data-testid="lobby-create" disabled={busy}
            onClick={() => void run(() => net.createRoom(modeId, nick.trim() || "Пилот"))}>Создать комнату</button>
        </div>

        <div className="sf-row" style={{ gap: 8 }}>
          <label className="sf-meta">Код комнаты{" "}
            <input className="sf-input" data-testid="lobby-code" value={code} placeholder="например A1B2C"
              onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: 120 }} />
          </label>
          <button className="sf-btn" data-testid="lobby-join" disabled={busy || code.trim() === ""}
            onClick={() => void run(() => net.joinRoom(code.trim(), nick.trim() || "Пилот"))}>Войти по коду</button>
          {mp.code && <span className="sf-meta">Комната: <b data-testid="lobby-room-code">{mp.code}</b> · вы seat {seat}</span>}
        </div>

        <div data-testid="lobby-status" className="sf-meta" style={{ minHeight: 20 }}>
          {mp.phase === "error" ? "Ошибка: " + (mp.error ?? "неизвестно")
            : PHASE_RU[mp.phase] + (mp.notice ? " · " + mp.notice : "") + " · такт " + mp.tick
            + (mp.paused ? " · ПАУЗА" : "") + (mp.resumed ? " · сессия восстановлена" : "")}
        </div>

        <div data-testid="lobby-players" className="sf-panel" style={{ padding: 8, display: "grid", gap: 4 }}>
          {mp.players.length === 0 && <span className="sf-meta">Игроков нет — создайте комнату или войдите по коду</span>}
          {mp.players.map((p) => (
            <div key={p.seat} className="sf-row" style={{ justifyContent: "space-between" }}>
              <span>
                <b>{p.nick}</b> · seat {p.seat}{p.seat === mp.hostSeat ? " · хост" : ""}
                {p.seat === seat ? " · вы" : ""}
              </span>
              <span className="sf-meta">{!p.connected ? "offline" : p.ready ? "готов" : "не готов"}</span>
            </div>
          ))}
        </div>

        <div className="sf-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="sf-btn" data-testid="lobby-ready" disabled={!inLobby || busy}
            onClick={() => net.ready(!me?.ready)}>{me?.ready ? "Снять готовность" : "Готов"}</button>
          <button className="sf-btn sf-btn--primary" data-testid="lobby-start"
            disabled={!inLobby || busy || !net.isHost || !allReady}
            onClick={() => net.start()}>Начать игру</button>
          <button className="sf-btn" data-testid="lobby-pause" disabled={mp.phase !== "active"}
            onClick={() => net.votePause(!mp.paused)}>{mp.paused ? "Продолжить" : "Пауза"}</button>
          <button className="sf-btn" data-testid="lobby-tactical" disabled={mp.phase !== "active"}
            onClick={() => net.tacticalLock()}>Тактический лок</button>
          <button className="sf-btn" data-testid="lobby-leave" disabled={mp.phase === "offline"}
            onClick={() => { net.leave(); }}>Выйти из комнаты</button>
        </div>

        <div className="sf-meta">
          Такт: {mp.tick} · игроков: {mp.players.length}/{mp.maxSeats} · пауза: {mp.pauseVotes.for}/{mp.pauseVotes.need}
          {mp.tacticalLock ? " · лок: seat " + mp.tacticalLock.seat + ", " + mp.tacticalLock.ticksLeft + " c" : ""}
          {net.isActive ? " · сценарий идёт на сервере" : ""}
        </div>

        <div className="sf-panel" style={{ padding: 8, display: "grid", gap: 4 }}>
          <b className="sf-meta">Чат</b>
          <div data-testid="lobby-chat" style={{ maxHeight: 120, overflow: "auto", display: "grid", gap: 2 }}>
            {mp.chat.length === 0 && <span className="sf-meta">сообщений нет</span>}
            {mp.chat.map((m, i) => <span key={"c" + i} className="sf-meta">{m.nick}: {m.text}</span>)}
          </div>
          <div className="sf-row" style={{ gap: 6 }}>
            <input className="sf-input" data-testid="lobby-chat-input" value={chatText} maxLength={256}
              onChange={(e) => setChatText(e.target.value)} placeholder="Сообщение" style={{ flex: 1 }} />
            <button className="sf-btn" data-testid="lobby-chat-send" onClick={() => { if (chatText.trim()) { net.chat(chatText.trim()); setChatText(""); } }}>Отправить</button>
          </div>
        </div>

        <div className="sf-meta">
          {game.hasWorld ? "Локальный мир получен от сервера" : "Мир появится после старта партии"}
        </div>
      </div>
    </div>
  );
}