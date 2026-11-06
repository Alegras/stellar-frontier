import { useEffect, useState } from "react";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import { Btn, Key } from "./controls";
import { L } from "./fg";

const SKIP_KEY = "sf.tutorial.skipped";

export function Tutorial({ game, state }: { game: Game; state: GameState }) {
  const [skipped, setSkipped] = useState<boolean>(() => {
    try { return localStorage.getItem(SKIP_KEY) === "1"; } catch { return false; }
  });

  const step1 = state.selectedSystemId != null || state.mode !== "galaxy";
  const step2 = state.activeSystemId != null || state.mode === "system" || state.mode === "station";
  const step3 = state.mode === "station";
  const done = step1 && step2 && step3;
  const doneCount = [step1, step2, step3].filter(Boolean).length;

  useEffect(() => {
    if (!done) return;
    setSkipped(true);
    try { localStorage.setItem(SKIP_KEY, "1"); } catch { /* noop */ }
  }, [done]);

  if (skipped || done) return null;

  const skip = () => {
    setSkipped(true);
    try { localStorage.setItem(SKIP_KEY, "1"); } catch { /* noop */ }
    game.toast(L("Обучение пропущено. Повтор — в меню «Управление».", "Tutorial skipped. Replay it from the Controls menu."), "info");
  };

  return (
    <div className="sf-tutorial" data-testid="tutorial" role="note" aria-label={L("Пролог: 3 шага", "Prologue: 3 steps")}>
      <div className="sf-tut-progress">
        <span>{L("ПРОЛОГ", "PROLOGUE")}</span>
        <span className="sf-spacer" />
        <span>{doneCount}/3</span>
        <span className="sf-tut-pip sf-tut-pip--on" style={{ opacity: step1 ? 1 : 0.25 }} />
        <span className="sf-tut-pip" style={{ opacity: step2 ? 1 : 0.25 }} />
        <span className="sf-tut-pip" style={{ opacity: step3 ? 1 : 0.25 }} />
      </div>
      <div className={"sf-tut-step" + (step1 ? " sf-tut-step--done" : " sf-tut-step--now")}>
        <span className="sf-tut-key">1</span>
        <span>{L("Выделите систему на карте", "Select a system on the map")} <Key>{L("клик", "click")}</Key></span>
      </div>
      <div className={"sf-tut-step" + (step2 ? " sf-tut-step--done" : step1 ? " sf-tut-step--now" : "")}>
        <span className="sf-tut-key">2</span>
        <span>{L("Войдите в неё", "Enter it")} <Key>{L("двойной клик", "double click")}</Key></span>
      </div>
      <div className={"sf-tut-step" + (step3 ? " sf-tut-step--done" : step1 && step2 ? " sf-tut-step--now" : "")}>
        <span className="sf-tut-key">3</span>
        <span>{L("Состыкуйтесь со станцией", "Dock at a station")}</span>
      </div>
      <div className="sf-tut-actions">
        <span className="sf-meta">F1 — {L("помощь", "help")}</span>
        <Btn size="sm" variant="ghost" onClick={skip} testId="btn-skip-tutorial">{L("Пропустить", "Skip")}</Btn>
      </div>
    </div>
  );
}
