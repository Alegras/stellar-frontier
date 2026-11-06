import { useEffect, useRef } from "react";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import { L } from "./fg";

const ICON: Record<string, string> = { info: "i", good: "✓", warn: "!", bad: "✕" };
const AUTO_HIDE_MS = 6000;

export function Notices({ game, state }: { game: Game; state: GameState }) {
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    const alive = new Set(state.notices.map((n) => n.id));
    for (const [id, t] of timers.current) {
      if (!alive.has(id)) {
        clearTimeout(t);
        timers.current.delete(id);
      }
    }
    for (const n of state.notices) {
      if (timers.current.has(n.id)) continue;
      const t = window.setTimeout(() => {
        timers.current.delete(n.id);
        game.dismissNotice(n.id);
      }, AUTO_HIDE_MS);
      timers.current.set(n.id, t);
    }
  }, [state.notices, game]);

  useEffect(() => () => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
  }, []);

  const visible = state.notices.slice(-5);
  // На карте справа сверху-вниз стоит рельс панелей империи: уведомления сдвигаем левее,
  // чтобы они не перехватывали клики по кнопкам (полёт/станция — без рельса).
  const cls = "sf-notices" + (state.mode === "galaxy" ? " sf-notices--rail" : "");
  if (visible.length === 0) return <div className={cls} data-testid="notices" aria-live="polite" />;

  return (
    <div className={cls} data-testid="notices" aria-live="polite" role="status">
      {visible.map((n) => (
        <button
          key={n.id}
          type="button"
          className={"sf-notice sf-notice--" + n.severity}
          onClick={() => {
            if (n.systemId != null) game.focusSystem(n.systemId);
            game.dismissNotice(n.id);
          }}
          title={n.systemId != null ? L("Перейти к системе и закрыть", "Go to system and close") : L("Закрыть", "Close")}
          data-testid="notice"
        >
          <span className="sf-notice__ico">{ICON[n.severity] ?? "i"}</span>
          <span className="sf-notice__txt">{n.text}</span>
        </button>
      ))}
    </div>
  );
}
