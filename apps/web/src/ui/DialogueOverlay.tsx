import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Command } from "@sf/sim";
import { DLC_DIALOGUE_BY_ID } from "@sf/data";
import type { DialogueNodeDef } from "@sf/data";
import { Badge, Btn } from "./controls";
import {
  EMOTION_COLOR, EMOTION_RU, L, characterOf, dlcOf, dlcText, questOf, send, sendFirst,
} from "./fg";
import { intText, worldOf } from "./util";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";

/** Закрытые пользователем сцены: переживают remount (смена локали/панели), чтобы диалог не открывался снова. */
const dismissedScenes = new Set<string>();

/**
 * DLC XIV: диалоговый оверлей. Auto-open при fg.dlc.dialogue.active,
 * портрет с эмоцией, текст по l10n-ключу, варианты/проверки, история, закрытие.
 */
export function DialogueOverlay({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const d = dlcOf(world);
  const active = d?.dialogue?.active ? d.dialogue : null;
  const [hidden, setHidden] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [log, setLog] = useState<{ speaker: string; text: string; emotion: string }[]>([]);
  const lastScene = useRef<string | null>(null);

  useEffect(() => {
    const scene = active?.sceneId ?? null;
    if (scene !== lastScene.current) {
      lastScene.current = scene;
      setHidden(false);
      setHistoryOpen(false);
      setLog([]);
    }
  }, [active?.sceneId]);

  const def = active ? DLC_DIALOGUE_BY_ID[active.sceneId] : null;
  const node: DialogueNodeDef | null = useMemo(() => {
    if (!def || !active) return null;
    return def.nodes.find((n) => n.id === active.nodeId) ?? def.nodes[def.nodes.length - 1] ?? null;
  }, [def, active?.nodeId, active]);

  useEffect(() => {
    if (!node) return;
    const text = dlcText(node.textKey);
    if (!text) return;
    setLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.text === text) return prev;
      return [...prev.slice(-26), { speaker: node.speaker ?? "", text, emotion: node.emotion ?? "neutral" }];
    });
  }, [node]);

  const visible = !!d?.enabled && !!active && !!node && !hidden && !(active.sceneId && dismissedScenes.has(active.sceneId));
  // перф-метрика M9d-0: от старта auto-open до коммита оверлея (performance.measure "dlc-dialogue-open")
  useLayoutEffect(() => {
    if (!visible) return;
    try {
      const started = performance.getEntriesByName("dlc-dialogue-open-start").length > 0;
      const measured = performance.getEntriesByName("dlc-dialogue-open").length > 0;
      if (!started || measured) return;
      performance.mark("dlc-dialogue-open-end");
      performance.measure("dlc-dialogue-open", "dlc-dialogue-open-start", "dlc-dialogue-open-end");
    } catch { /* performance API недоступен */ }
  }, [visible, active?.sceneId]);

  if (!visible) return null;

  const defaultSpeaker = active.sceneId.includes("station") ? "kira7" : "teira_os";
  const speaker = characterOf(node.speaker ?? defaultSpeaker);
  const narrator: Record<string, [string, string]> = {
    svet: ["СВЕТ (ИИ)", "SVET (AI)"],
    narrator: ["Рассказчик", "Narrator"],
  };
  const narratorName = node.speaker ? narrator[node.speaker] : undefined;
  const speakerName = speaker
    ? dlcText(speaker.nameKey)
    : narratorName
      ? L(narratorName[0], narratorName[1])
      : L("Голос", "Voice");
  const emotion = node.emotion ?? "neutral";
  const emotionColor = EMOTION_COLOR[emotion] ?? EMOTION_COLOR.neutral;
  const text = dlcText(node.textKey);
  const quest = questOf(active.questId);
  const portraitId = speaker?.portrait ?? "teira_os";

  const advance = () => {
    if (!active) return;
    sendFirst(game, [
      { type: "dlc_dialogue_advance" },
      { type: "dlc_dialogue_choice", nodeId: node.id, choiceId: "continue" },
    ]);
  };
  const choose = (choiceId: string) => {
    send(game, { type: "dlc_dialogue_choice", nodeId: node.id, choiceId } as unknown as Command);
  };
  const close = () => { setHidden(true); if (active.sceneId) dismissedScenes.add(active.sceneId); };
  const optionDisabled = (requiresFlag?: string): boolean => !!requiresFlag && !(d?.flags[requiresFlag]);

  return (
    <div className="sf-dlg-layer" data-testid="dialogue-overlay" data-channel="story_message">
      <div className="sf-dlg-backdrop" onClick={close} />
      <section
        className="sf-dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sf-dlg-title"
        aria-describedby="sf-dlg-text"
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
      >
        <div className="sf-dlg__stage">
          <div className="sf-dlg__portrait" data-testid="dialogue-portrait" style={{ borderColor: emotionColor }}>
            <span className="sf-dlg__portrait-fallback" style={{ color: emotionColor }} aria-hidden="true">
              {speakerName.slice(0, 1).toUpperCase()}
            </span>
            <img
              src={speaker ? "/dlc/portraits/" + portraitId + "/" + emotion + ".png" : "/dlc/voices/svet_wave.png"}
              alt=""
              draggable={false}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            {speaker && (
              <span className="sf-dlg__emotion" data-testid="dialogue-emotion" style={{ color: emotionColor }}>
                {L(EMOTION_RU[emotion] ?? emotion, emotion)}
              </span>
            )}
          </div>
          <div className="sf-dlg__main">
            <header className="sf-dlg__head">
              <b id="sf-dlg-title" data-testid="dialogue-speaker">{speakerName}</b>
              {speaker?.role && <span className="sf-meta">{dlcText(speaker.role)}</span>}
              <span className="sf-spacer" />
              {quest && <Badge tone="info" data-testid="dialogue-quest">{dlcText(quest.titleKey)}</Badge>}
              <Btn size="sm" variant="ghost" onClick={close} testId="dialogue-close" aria-label={L("Закрыть диалог", "Close dialogue")}>✕</Btn>
            </header>
            {node.comic && (
              <img className="sf-dlg__comic" src={"/dlc/comics/" + node.comic + ".png"} alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            )}
            <p className="sf-dlg__text" id="sf-dlg-text" data-testid="dialogue-text" aria-live="polite">{text}</p>

            {node.type === "choice" && (
              <div className="sf-dlg__options" data-testid="dialogue-options" role="group" aria-label={L("Варианты ответа", "Reply options")}>
                {(node.options ?? []).map((opt) => {
                  const disabled = optionDisabled(opt.requiresFlag);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className="sf-dlg__option"
                      data-testid={"dialogue-choice-" + opt.id}
                      disabled={disabled}
                      onClick={() => choose(opt.id)}
                      title={disabled ? L("Нужен флаг: ", "Requires flag: ") + opt.requiresFlag : opt.check ? L("Проверка", "Check") + ": " + opt.check.stat + " DC " + opt.check.dc : undefined}
                    >
                      <span>{dlcText(opt.textKey)}</span>
                      {opt.check && <span className="sf-dlg__check" data-testid="dialogue-check-result">⚄ {opt.check.stat} · DC {opt.check.dc}</span>}
                      {opt.requiresFlag && <span className="sf-meta">[{opt.requiresFlag}]</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {node.type === "check" && node.check && (
              <div className="sf-dlg__check-block">
                <span data-testid="dialogue-check-result">⚄ {node.check.stat} · DC {node.check.dc}</span>
                <Btn variant="primary" onClick={advance} testId="dialogue-check-roll">{L("Бросок", "Roll")}</Btn>
              </div>
            )}

            {(node.type === "line" || node.type === "effect" || node.type === "check") && (
              <div className="sf-dlg__actions">
                <Btn variant="primary" onClick={advance} testId="dialogue-continue">{L("Продолжить", "Continue")}</Btn>
              </div>
            )}

            <footer className="sf-dlg__foot">
              <Btn size="sm" variant="ghost" onClick={() => setHistoryOpen((v) => !v)} testId="dialogue-history-toggle">
                {L("История", "History")} ({log.length})
              </Btn>
              <span className="sf-spacer" />
              <span className="sf-meta">
                {d?.activeQuestId ? L("Квест", "Quest") + ": " + dlcText(questOf(d.activeQuestId)?.titleKey) : (quest ? dlcText(quest.titleKey) : "")}
                {" · "}{L("такт", "tick")} {intText(state.tick)}
              </span>
            </footer>
            {historyOpen && (
              <div className="sf-dlg__history" data-testid="dialogue-history" role="log">
                {log.map((h, i) => (
                  <div key={i} className="sf-dlg__history-line">
                    <span className="sf-meta">{h.speaker ? dlcText(characterOf(h.speaker)?.nameKey) : "…"}:</span> {h.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Auto-open story-сообщение такта 0 (fallback, если sim ещё не запустил линию сам). */
export function useDlcAutoStart(game: Game, state: GameState): void {
  const done = useRef<string>("");
  useEffect(() => {
    const world = worldOf(game);
    const d = world ? dlcOf(world) : null;
    if (!world || !d?.enabled) return;
    if (d.dialogue?.active) return;
    const first = Object.values(d.quests).find((q) => q.status === "available");
    if (!first) return;
    const key = world.seed + ":" + world.tick;
    if (done.current === key) return;
    done.current = key;
    if (state.tick > 3 && !d.chronicle.length) return;
    const scene = Object.values(DLC_DIALOGUE_BY_ID).find((dlg) => dlg.id === "dlg_q1_briefing") ?? Object.values(DLC_DIALOGUE_BY_ID)[0];
    if (!scene) return;
    try { performance.mark("dlc-dialogue-open-start"); } catch { /* noop */ }
    send(game, { type: "dlc_quest_accept", questId: first.id, source: "story_message" } as unknown as Command);
    send(game, { type: "dlc_dialogue_start", sceneId: scene.id, questId: first.id } as unknown as Command);
  }, [game, state.tick]);
}