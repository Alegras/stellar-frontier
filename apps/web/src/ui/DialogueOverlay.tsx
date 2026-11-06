import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Command } from "@sf/sim";
import { DLC_DIALOGUE_BY_ID } from "@sf/data";
import type { DialogueNodeDef, DialogueOptionDef } from "@sf/data";
import { Badge, Btn } from "./controls";
import {
  EMOTION_COLOR, EMOTION_RU, L, characterOf, dlcConsequencesOf, dlcDialogueViewOf, dlcEffectLabel,
  dlcOf, dlcPreviewEffects, dlcText, questOf, send, sendFirst, type DlcEffectView,
} from "./fg";
import { intText, worldOf } from "./util";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";

/**
 * DLC XIV: единый диалоговый оверлей (DLC-линия и сюжетные диалоги кампании).
 * Auto-open только по состоянию sim (fg.dlc.dialogue.active); закрытие шлёт dlc_dialogue_end.
 * Приоритет над narrative-модалками: пока диалог активен, время на паузе.
 */
export function DialogueOverlay({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const d = dlcOf(world);
  const active = d?.dialogue?.active ? d.dialogue : null;
  const view = useMemo(() => dlcDialogueViewOf(world), [world, active?.sceneId, active?.nodeId]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localLog, setLocalLog] = useState<{ speaker: string; text: string; emotion: string }[]>([]);
  const [chosenFx, setChosenFx] = useState<DlcEffectView[]>([]);
  const [closed, setClosed] = useState(false);
  const lastScene = useRef<string | null>(null);
  const lastSeed = useRef<number | null>(null);

  // смена сцены/мира: сбрасываем локальную историю и последствия; sim сам one-shot (seenScenes)
  useEffect(() => {
    const seed = world?.seed ?? null;
    if (seed !== lastSeed.current) {
      lastSeed.current = seed;
      setLocalLog([]);
      setChosenFx([]);
      setHistoryOpen(false);
      setClosed(false);
    }
    const scene = active?.sceneId ?? null;
    if (scene !== lastScene.current) {
      lastScene.current = scene;
      setHistoryOpen(false);
      setLocalLog([]);
      setChosenFx([]);
      setClosed(false);
    }
  }, [active?.sceneId, world?.seed]);

  const def = active ? DLC_DIALOGUE_BY_ID[active.sceneId] : null;
  const node: DialogueNodeDef | null = useMemo(() => {
    if (!def || !active) return null;
    return (view?.node as DialogueNodeDef | null) ?? def.nodes.find((n) => n.id === active.nodeId) ?? def.nodes[def.nodes.length - 1] ?? null;
  }, [def, active?.nodeId, view]);

  const visible = !!d?.enabled && !!active && !!node && !closed;

  // пауза: пока диалог активен, время стоит; модалки событий не открываются (см. FullGameOverlays)
  useEffect(() => {
    if (!visible) return;
    game.setDialogueModalOpen(true);
    return () => game.setDialogueModalOpen(false);
  }, [visible, game]);

  useEffect(() => {
    if (!node) return;
    const text = dlcText(node.textKey);
    if (!text) return;
    setLocalLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.text === text) return prev;
      return [...prev.slice(-26), { speaker: node.speaker ?? "", text, emotion: node.emotion ?? "neutral" }];
    });
  }, [node]);

  // перф-метрика dlc-dialogue-open: start ставим в рендере (до коммита), end — в layout effect.
  const openScene = useRef<string | null>(null);
  if (visible && active?.sceneId && openScene.current !== active.sceneId) {
    openScene.current = active.sceneId;
    try { performance.mark("dlc-dialogue-open-start"); } catch { /* noop */ }
  }
  useLayoutEffect(() => {
    if (!visible) return;
    try {
      if (performance.getEntriesByName("dlc-dialogue-open-start").length === 0) performance.mark("dlc-dialogue-open-start");
      if (performance.getEntriesByName("dlc-dialogue-open").length > 0) return;
      performance.mark("dlc-dialogue-open-end");
      performance.measure("dlc-dialogue-open", "dlc-dialogue-open-start", "dlc-dialogue-open-end");
    } catch { /* performance API недоступен */ }
  }, [visible, active?.sceneId]);

  if (!visible || !active || !node) return null;

  const campaign = (active as unknown as { context?: string }).context === "campaign"
    || view?.context === "campaign"
    || active.sceneId.includes("campaign") || (active.questId ?? "").startsWith("story:");
  const campaignAct = (active as unknown as { campaignAct?: number }).campaignAct;
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
  const sentences = (text.match(/[^.!?…]+[.!?…]+/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
  // для комикса: при 3+ фразах пропускаем короткое вступление, берём «потери»/«обломки»
  const comicLines = sentences.length >= 3 ? [sentences[1], sentences[2]] : sentences.slice(0, 2);
  const quest = questOf(active.questId);
  const portraitId = speaker?.portrait ?? "teira_os";
  const history = view?.history?.length
    ? view.history.map((h) => ({ speaker: h.speaker ?? "", text: dlcText(h.textKey), emotion: h.emotion ?? "neutral" }))
    : localLog;
  const recentConsequences = dlcConsequencesOf(world, 3);
  const shownConsequences = chosenFx.length > 0
    ? chosenFx
    : recentConsequences.find((c) => c.sceneId === active.sceneId)?.effects ?? [];

  const advance = () => {
    if (!active) return;
    sendFirst(game, [
      { type: "dlc_dialogue_advance" },
      { type: "dlc_dialogue_choice", nodeId: node.id, choiceId: "continue" },
    ]);
  };
  const choose = (opt: DialogueOptionDef) => {
    const preview = dlcPreviewEffects(opt.effects);
    if (preview.length > 0) setChosenFx(preview);
    send(game, { type: "dlc_dialogue_choice", nodeId: node.id, choiceId: opt.id } as unknown as Command);
  };
  const close = () => {
    setClosed(true);
    // закрытие завершает сцену в sim (one-shot/seen)
    sendFirst(game, [{ type: "dlc_dialogue_end" }, { type: "dlc_dialogue_close" }]);
  };
  const optionDisabled = (requiresFlag?: string): boolean => !!requiresFlag && !(d?.flags[requiresFlag]);

  return (
    <div className="sf-dlg-layer" data-testid="dialogue-overlay" data-channel={campaign ? "campaign" : "story_message"}>
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
              {campaign && <span data-testid="dialogue-campaign"><Badge tone="warn">{L("Кампания", "Campaign") + (campaignAct ? " · акт " + campaignAct : "")}</Badge></span>}
              {node.outcome && <span data-testid="dialogue-outcome"><Badge tone="info">{L("последствие", "consequence")}</Badge></span>}
              {quest && <span data-testid="dialogue-quest"><Badge tone="info">{dlcText(quest.titleKey)}</Badge></span>}
              <Btn size="sm" variant="ghost" onClick={close} testId="dialogue-close" aria-label={L("Закрыть диалог и завершить сцену", "Close dialogue and end scene")}>✕</Btn>
            </header>
            {node.comic && (
              <div className="sf-dlg__comic-wrap" data-testid="dialogue-comic">
                <img className="sf-dlg__comic" src={"/dlc/comics/" + node.comic + ".png"} alt=""
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                {comicLines[0] && (
                  <span className="sf-dlg__comic-bubble sf-dlg__comic-bubble--1" data-testid="dialogue-comic-bubble-1">
                    {comicLines[0]}
                  </span>
                )}
                {comicLines[1] && (
                  <span className="sf-dlg__comic-bubble sf-dlg__comic-bubble--2" data-testid="dialogue-comic-bubble-2">
                    {comicLines[1]}
                  </span>
                )}
              </div>
            )}
            <p className={"sf-dlg__text" + (node.outcome ? " sf-dlg__text--outcome" : "")} id="sf-dlg-text" data-testid="dialogue-text" aria-live="polite">{text}</p>

            {shownConsequences.length > 0 && node.type !== "choice" && (
              <div className="sf-dlg__effects" data-testid="dialogue-consequences" role="status">
                <span className="sf-meta">{L("Последствия выбора:", "Choice consequences:")}</span>
                {shownConsequences.map((fx, i) => (
                  <span key={i} className="sf-badge sf-badge--info" data-testid={"dialogue-consequence-" + i}>{dlcEffectLabel(fx)}</span>
                ))}
              </div>
            )}

            {node.type === "choice" && (
              <div className="sf-dlg__options" data-testid="dialogue-options" role="group" aria-label={L("Варианты ответа", "Reply options")}>
                {(node.options ?? []).map((opt) => {
                  const disabled = optionDisabled(opt.requiresFlag);
                  const previewOpt = view?.options?.find((o) => o.id === opt.id);
                  const fx = previewOpt?.consequences ?? dlcPreviewEffects(opt.effects);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className="sf-dlg__option"
                      data-testid={"dialogue-choice-" + opt.id}
                      disabled={disabled}
                      onClick={() => choose(opt)}
                      title={disabled ? L("Нужен флаг: ", "Requires flag: ") + opt.requiresFlag : opt.check ? L("Проверка", "Check") + ": " + opt.check.stat + " DC " + opt.check.dc : undefined}
                    >
                      <span>
                        {dlcText(opt.textKey)}
                        {fx.length > 0 && (
                          <span className="sf-dlg__fx" data-testid={"dialogue-choice-fx-" + opt.id}>
                            {fx.map((f, i) => <span key={i} className="sf-meta"> · {dlcEffectLabel(f)}</span>)}
                          </span>
                        )}
                      </span>
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
                {L("История", "History")} ({history.length})
              </Btn>
              <span className="sf-spacer" />
              <span className="sf-meta">
                {d?.activeQuestId ? L("Квест", "Quest") + ": " + dlcText(questOf(d.activeQuestId)?.titleKey) : (quest ? dlcText(quest.titleKey) : "")}
                {" · "}{L("такт", "tick")} {intText(state.tick)}
                {" · "}{L("время на паузе", "time paused")}
              </span>
            </footer>
            {historyOpen && (
              <div className="sf-dlg__history" data-testid="dialogue-history" role="log">
                {history.map((h, i) => (
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
