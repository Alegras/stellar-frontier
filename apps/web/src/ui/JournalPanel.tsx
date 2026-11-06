import { useEffect, useMemo, useRef, useState } from "react";
import type { Command } from "@sf/sim";
import type { World } from "@sf/sim";
import { aiNewsKindLabel, aiNewsOf } from "./world-politics";
import { DLC_CARD_BY_QUEST, DLC_QUESTS, DLC_QUEST_BY_ID, DLC_TREE } from "@sf/data";
import type { QuestDef, QuestTreeDef, TreeEdgeDef, TreeQuestNodeDef } from "@sf/data";
import { Badge, Btn, Panel, Sep } from "./controls";
import {
  DLC_CHANNEL_EN, DLC_CHANNEL_RU, L, dlcConsequencesOf, dlcEffectLabel, dlcOf, dlcText, questOf, send, type DlcState,
} from "./fg";
import { intText, playerEmpire, worldOf } from "./util";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import type { FullPanelProps } from "./fg";

type Tab = "active" | "completed" | "chronicle" | "tree";

const STATUS_RU: Record<string, [string, string]> = {
  locked: ["закрыт", "locked"],
  available: ["доступен", "available"],
  active: ["активен", "active"],
  completed: ["завершён", "completed"],
  failed: ["провален", "failed"],
  expired: ["истёк", "expired"],
};

function statusLabel(status: string): string {
  const p = STATUS_RU[status] ?? [status, status];
  return L(p[0], p[1]);
}
function channelLabel(channel: string): string {
  const key = channel as keyof typeof DLC_CHANNEL_RU;
  return L(DLC_CHANNEL_RU[key] ?? channel, DLC_CHANNEL_EN[key] ?? channel);
}

/** S16: журнал DLC — 4 вкладки, карточки квестов, дерево. */
export function JournalPanel({ game, state }: FullPanelProps) {
  const world = worldOf(game);
  const d = dlcOf(world);
  const [tab, setTab] = useState<Tab>("active");

  if (!world || !d) {
    return <Panel title={L("Журнал", "Journal")} testId="journal-panel"><div className="sf-empty">{L("Нет мира.", "No world.")}</div></Panel>;
  }
  if (!d.enabled) {
    return (
      <Panel title={L("Журнал", "Journal")} testId="journal-panel">
        <div className="sf-empty" data-testid="journal-disabled">
          {L("DLC «Первый Свет» выключен. Включите его в настройках или при новой игре.", "The First Light DLC is disabled. Enable it in settings or when starting a new game.")}
        </div>
      </Panel>
    );
  }

  const active = DLC_QUESTS.filter((q) => d.quests[q.id]?.status === "active" || d.quests[q.id]?.status === "available");
  const completed = DLC_QUESTS.filter((q) => d.quests[q.id]?.status === "completed" || d.quests[q.id]?.status === "failed");
  const tabs: [Tab, string][] = [
    ["active", L("Активные", "Active") + " (" + active.length + ")"],
    ["completed", L("Завершённые", "Completed") + " (" + completed.length + ")"],
    ["chronicle", L("Хроника", "Chronicle") + " (" + d.chronicle.length + ")"],
    ["tree", L("Дерево", "Tree")],
  ];
  return (
    <div className="sf-fg-panel sf-journal" data-testid="journal-panel"
      style={{ maxHeight: "calc(100vh - 120px)", overflowY: "auto", overflowX: "hidden" }}>
      <div className="sf-fg-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={"sf-tab" + (tab === id ? " sf-tab--on" : "")}
            onClick={() => setTab(id)} data-testid={"btn-journal-tab-" + (id === "completed" ? "done" : id)}>{label}</button>
        ))}
      </div>
      {tab === "active" && <QuestList game={game} quests={active} emptyKey="journal-empty-active" />}
      {tab === "completed" && <QuestList game={game} quests={completed} emptyKey="journal-empty-completed" />}
      {tab === "chronicle" && <Chronicle d={d} world={world} />}
      {tab === "tree" && <QuestTree game={game} d={d} state={state} />}
    </div>
  );
}

function QuestList({ game, quests, emptyKey }: { game: Game; quests: QuestDef[]; emptyKey: string }) {
  const world = worldOf(game);
  const d = world ? dlcOf(world) : null;
  if (!d) return null;
  if (quests.length === 0) {
    return <div className="sf-empty" data-testid={emptyKey}>{L("Здесь пока пусто.", "Nothing here yet.")}</div>;
  }
  return (
    <div className="sf-journal__cards">
      {quests.map((q) => {
        const st = d.quests[q.id];
        const card = DLC_CARD_BY_QUEST[q.id];
        const questFlags = Object.keys({ ...(st?.flags ?? {}), ...(d.flags ?? {}) });
        const step = q.steps[st?.step ?? 0];
        const progress = step ? (st?.stepProgress[step.id] ?? 0) : 0;
        const need = step?.count ?? 1;
        return (
          <article key={q.id} className="sf-journal__card" data-testid={"quest-card-" + q.id} style={{ borderColor: card?.accent ?? undefined }}>
            <div className="sf-journal__art" style={{ backgroundImage: "url(/dlc/cards/" + (card?.art ?? q.id) + ".png)" }} />
            <div className="sf-journal__body">
              <div className="sf-row">
                <b>{dlcText(q.titleKey)}</b>
                <span className="sf-spacer" />
                <Badge tone={st?.status === "completed" ? "good" : st?.status === "active" ? "info" : "warn"}>{statusLabel(st?.status ?? "locked")}</Badge>
              </div>
              <div className="sf-meta">{dlcText(q.summaryKey)}</div>
              <div className="sf-meta">
                {L("тип", "type")}: {q.type} · {L("линия", "line")} {q.line} · {L("акт", "act")} {q.act} · {channelLabel(q.source.channel)}
              </div>
              {step && (
                <div className="sf-meta" data-testid={"quest-step-" + q.id}>
                  {L("шаг", "step")} {intText((st?.step ?? 0) + 1)}/{q.steps.length}: {dlcText(step.titleKey)} — <span data-testid="quest-progress">{intText(progress)}/{intText(need)}</span>
                </div>
              )}
              <div className="sf-meta" data-testid="quest-reward">
                {L("награды", "rewards")}: {q.rewards.credits ? intText(q.rewards.credits) + " " + L("кр.", "cr.") + " " : ""}
                {q.rewards.alloys ? intText(q.rewards.alloys) + " " + L("спл.", "alloys") : ""}
                {q.rewards.flags?.length ? " · " + q.rewards.flags.join(", ") : ""}
              </div>
              {q.nextHint && <div className="sf-meta" data-testid="quest-next-hint">{L("далее", "next")}: {dlcText(questOf(q.nextHint)?.titleKey)}</div>}
              {questFlags.length > 0 && (
                <div className="sf-meta" data-testid={"quest-flags-" + q.id}>
                  {L("Флаги выбора", "Choice flags")}: {questFlags.slice(0, 6).join(", ")}
                </div>
              )}
              <div className="sf-row" style={{ gap: 4, marginTop: 4 }}>
                <Btn size="sm" variant="primary" disabled={!st || st.status === "completed"}
                  onClick={() => send(game, { type: "dlc_quest_accept", questId: q.id, source: q.source.channel } as unknown as Command)}
                  testId={"btn-quest-track-" + q.id}>
                  {st?.status === "active" ? L("Взят на сопровождение", "Tracked") : L("Взять квест", "Accept quest")}
                </Btn>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Chronicle({ d, world }: { d: DlcState; world: World }) {
  const consequences = dlcConsequencesOf(world, 8);
  const aiNews = aiNewsOf(world, 8);
  if (d.chronicle.length === 0 && consequences.length === 0 && aiNews.length === 0) {
    return <div className="sf-empty" data-testid="journal-empty-chronicle">{L("Хроника пуста: записи появляются по ходу линии.", "The chronicle is empty: entries appear as the line progresses.")}</div>;
  }
  return (
    <div className="sf-journal__chronicle" data-testid="journal-chronicle">
      <div className="sf-h" data-testid="journal-ai-news">{L("Мировые события", "World events")}</div>
      {aiNews.length === 0 && <div className="sf-meta">{L("Пока тихо: ИИ-ИИ политика ещё не дала новостей.", "Quiet so far: AI-to-AI politics has no news yet.")}</div>}
      {aiNews.map((n) => (
        <div key={n.id} className="sf-line" data-testid={"ai-news-journal-" + n.id}>
          <span className="sf-meta" style={{ width: 52 }}>{"т" + intText(n.tick)}</span>
          <span className="sf-nowrap">{aiNewsKindLabel(n.kind)}</span>
          <span className="sf-meta">{n.actorName}{n.targetName ? " → " + n.targetName : ""}</span>
        </div>
      ))}
      {consequences.length > 0 && (
        <div className="sf-h" data-testid="journal-consequences">{L("Последствия диалогов", "Dialogue consequences")}</div>
      )}
      {consequences.map((c, i) => (
        <div key={"c" + i} className="sf-line" data-testid={"consequence-entry-" + i} style={{ alignItems: "flex-start" }}>
          <span className="sf-meta" style={{ width: 64 }}>{"т" + intText(c.tick)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="sf-meta">
              {c.questTitleKey ? dlcText(c.questTitleKey) : c.sceneId}
              {c.effects.length > 0 ? " · " + c.effects.map((fx) => dlcEffectLabel(fx)).join(" · ") : ""}
            </div>
          </div>
        </div>
      ))}
      {d.chronicle.map((entry, i) => (
        <div key={i} className="sf-line" data-testid={"chronicle-entry-" + i}>
          <span className="sf-meta" style={{ width: 64 }}>{"т" + intText(entry.tick)}</span>
          <span>{dlcText(entry.textKey)}</span>
          <span className="sf-spacer" />
          {entry.questId && <span className="sf-meta">{dlcText(questOf(entry.questId)?.titleKey)}</span>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ дерево 8 узлов / 10 рёбер
const TREE_W = 900;
const TREE_H = 520;

interface TreeLayout { nodes: { def: TreeQuestNodeDef; x: number; y: number }[]; edges: TreeEdgeDef[]; groups: string[] }

function layoutTree(tree: QuestTreeDef): TreeLayout {
  const nodes = tree.nodes ?? [];
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 1);
  const padX = 80, padY = 60;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return {
    nodes: nodes.map((def) => ({
      def,
      x: padX + ((def.x - minX) / spanX) * (TREE_W - padX * 2),
      y: padY + ((def.y - minY) / spanY) * (TREE_H - padY * 2),
    })),
    edges: tree.edges ?? [],
    groups: Array.from(new Set(nodes.map((n) => n.group))),
  };
}

function QuestTree({ game, d, state }: { game: Game; d: DlcState; state: GameState }) {
  const [filter, setFilter] = useState<string>("all");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // авто-fit: на открытии вкладки показываем весь граф (zoom=1, пан=0), затем кламп
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  const layout = useMemo(() => {
    // перф-метрика для приёмки M9d-0: раскладка дерева ≤2 мс/кадр (performance.measure)
    let result: TreeLayout | null = null;
    try { performance.mark("dlc-tree-layout-start"); } catch { /* noop */ }
    result = layoutTree(DLC_TREE);
    try {
      performance.mark("dlc-tree-layout-end");
      performance.measure("dlc-tree-layout", "dlc-tree-layout-start", "dlc-tree-layout-end");
    } catch { /* performance API недоступен */ }
    return result;
  }, []);
  const pos = useMemo(() => Object.fromEntries(layout.nodes.map((n) => [n.def.id, n])), [layout]);

  const nodeStatus = (id: string): string => d.quests[id]?.status ?? "locked";
  const isRevealed = (id: string): boolean =>
    d.revealedNodes.includes(id) || d.completed.includes(id) || nodeStatus(id) === "active" || nodeStatus(id) === "available";

  const visible = (def: TreeQuestNodeDef): boolean => filter === "all" || def.group === filter;
  const selQuest = selected ? questOf(selected) : null;
  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const zoomBy = (factor: number) => setZoom((z) => Math.max(0.6, Math.min(2.4, Math.round(z * factor * 100) / 100)));

  const svgRef = useRef<SVGSVGElement | null>(null);
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 0.89);
  };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Без setPointerCapture: иначе click по узлу перенаправляется на <svg> и карточка не открывается.
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d0 = drag.current;
    if (!d0 || e.buttons === 0) return;
    setPan({ x: d0.px + (e.clientX - d0.x), y: d0.py + (e.clientY - d0.y) });
  };
  const onPointerUp = () => { drag.current = null; };

  return (
    <div className="sf-tree" data-testid="quest-tree">
      <div className="sf-tree__bar">
        <span className="sf-meta">{L("Фильтр", "Filter")}:</span>
        <button type="button" className={"sf-tab" + (filter === "all" ? " sf-tab--on" : "")} onClick={() => setFilter("all")} data-testid="tree-filter-all">{L("Все", "All")}</button>
        {layout.groups.map((g) => (
          <button key={g} type="button" className={"sf-tab" + (filter === g ? " sf-tab--on" : "")}
            onClick={() => setFilter(g)} data-testid={"tree-filter-" + g}>{g}</button>
        ))}
        <span className="sf-spacer" />
        <Btn size="sm" onClick={() => zoomBy(1.15)} testId="btn-tree-zoom-in" aria-label={L("Приблизить", "Zoom in")}>+</Btn>
        <Btn size="sm" onClick={() => zoomBy(0.87)} testId="btn-tree-zoom-out" aria-label={L("Отдалить", "Zoom out")}>−</Btn>
        <Btn size="sm" variant="ghost" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} testId="btn-tree-reset">{L("Сброс", "Reset")}</Btn>
        <span className="sf-meta">{Math.round(zoom * 100)}% · {L("такт", "tick")} {intText(state.tick)}</span>
      </div>
      <div className="sf-tree__wrap" style={{ position: "relative" }}>
        <svg className="sf-tree__minimap" data-testid="tree-minimap" viewBox={"0 0 " + TREE_W + " " + TREE_H} role="img" aria-label={L("Миникарта дерева", "Tree minimap")}>
          {layout.edges.map((e, i) => {
            const a = pos[e.from], b = pos[e.to];
            if (!a || !b) return null;
            return <line key={"m" + i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="sf-tree__minimap-edge" />;
          })}
          {layout.nodes.map(({ def, x, y }) => (
            <circle key={"m" + def.id} cx={x} cy={y} r={10} className={"sf-tree__minimap-node sf-tree__minimap-node--" + (nodeStatus(def.id) === "completed" ? "done" : nodeStatus(def.id) === "active" ? "active" : "idle")} />
          ))}
          <rect
            className="sf-tree__minimap-view"
            x={Math.max(0, Math.min(TREE_W - TREE_W / zoom, TREE_W / 2 - (TREE_W / 2 + pan.x) / zoom))}
            y={Math.max(0, Math.min(TREE_H - TREE_H / zoom, TREE_H / 2 - (TREE_H / 2 + pan.y) / zoom))}
            width={Math.min(TREE_W, TREE_W / zoom)}
            height={Math.min(TREE_H, TREE_H / zoom)}
          />
        </svg>
        <svg
          ref={svgRef}
          className="sf-tree__svg"
          data-testid="quest-tree-svg"
          viewBox={"0 0 " + TREE_W + " " + TREE_H}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          role="img"
          aria-label={L("Дерево квестов: 8 узлов, 10 рёбер", "Quest tree: 8 nodes, 10 edges")}
        >
          <g transform={"translate(" + pan.x + " " + pan.y + ") scale(" + zoom + ") translate(" + (TREE_W * (1 - 1 / zoom) / 2) + " " + (TREE_H * (1 - 1 / zoom) / 2) + ")"}>
            {layout.edges.map((e, i) => {
              const a = pos[e.from], b = pos[e.to];
              if (!a || !b) return null;
              const hidden = e.kind === "hidden" && !(isRevealed(e.to) || isRevealed(e.from));
              return (
                <line
                  key={e.from + "-" + e.to + "-" + i}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  className={"sf-tree__edge sf-tree__edge--" + e.kind + (hidden ? " sf-tree__edge--fog" : "")}
                  data-testid={"tree-edge-" + e.from + "-" + e.to}
                />
              );
            })}
            {layout.nodes.filter(({ def }) => visible(def)).map(({ def, x, y }) => {
              const status = nodeStatus(def.id);
              const revealed = isRevealed(def.id);
              const q = DLC_QUEST_BY_ID[def.id];
              const tone = status === "completed" ? "done" : status === "active" ? "active" : status === "available" ? "avail" : "locked";
              return (
                <g
                  key={def.id}
                  className={"sf-tree__node sf-tree__node--" + tone + (revealed ? "" : " sf-tree__node--fog") + (selected === def.id ? " sf-tree__node--sel" : "")}
                  data-fog={revealed ? "false" : "true"}
                  transform={"translate(" + x + " " + y + ")"}
                  onClick={(ev) => { ev.stopPropagation(); setSelected(def.id); }}
                  data-testid={"tree-node-" + def.id}
                  role="button"
                  tabIndex={0}
                  aria-label={(revealed ? dlcText(q?.titleKey) : L("Туман", "Fog")) + " · " + statusLabel(status)}
                  onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setSelected(def.id); } }}
                >
                  <circle r={26} />
                  <text textAnchor="middle" dy="4" className="sf-tree__glyph">{status === "completed" ? "✓" : revealed ? "◆" : "?"}</text>
                  <text textAnchor="middle" y={44} className="sf-tree__label">{revealed ? dlcText(q?.titleKey) : L("Туман", "Fog")}</text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="sf-tree__legend" data-testid="tree-legend">
        <span><i className="sf-tree__sw sf-tree__sw--avail" />{L("доступен", "available")}</span>
        <span><i className="sf-tree__sw sf-tree__sw--active" />{L("активен", "active")}</span>
        <span><i className="sf-tree__sw sf-tree__sw--done" />{L("завершён", "completed")}</span>
        <span><i className="sf-tree__sw sf-tree__sw--fog" />{L("туман", "fog")}</span>
        <span className="sf-meta">{L("рёбра: required / optional / branch / hidden / opens; колесо — зум, перетаскивание — пан", "edges: required / optional / branch / hidden / opens; wheel — zoom, drag — pan")}</span>
      </div>
      {selQuest && (
        <div ref={cardRef}>
        <Panel title={dlcText(selQuest.titleKey)} flat testId="tree-node-card">
          <div className="sf-meta">{dlcText(selQuest.summaryKey)}</div>
          <div className="sf-meta">
            {L("статус", "status")}: {statusLabel(nodeStatus(selQuest.id))} · {L("шаги", "steps")}: {intText(selQuest.steps.length)} ·
            {" "}{L("награды", "rewards")}: {(selQuest.rewards.credits ?? 0) + " " + L("кр.", "cr.")}
          </div>
          <div className="sf-row" style={{ gap: 4, marginTop: 4 }}>
            <Btn size="sm" variant="primary" disabled={nodeStatus(selQuest.id) === "completed"}
              onClick={() => send(game, { type: "dlc_quest_accept", questId: selQuest.id, source: selQuest.source.channel } as unknown as Command)}
              testId={"btn-tree-accept-" + selQuest.id}>{L("Взять квест", "Accept quest")}</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setSelected(null)}>{L("Закрыть карточку", "Close card")}</Btn>
          </div>
        </Panel>
        </div>
      )}
      {/* a11y: альтернативный список узлов */}
      <ul className="sf-sr-only" data-testid="tree-list-fallback">
        {layout.nodes.filter(({ def }) => visible(def)).map(({ def }) => {
          const q = DLC_QUEST_BY_ID[def.id];
          const revealed = isRevealed(def.id);
          return (
            <li key={def.id}>
              <button type="button" data-testid={"tree-list-fallback-node-" + def.id} onClick={() => setSelected(def.id)}>
                {(revealed ? dlcText(q?.titleKey) : L("Туман", "Fog")) + " — " + statusLabel(nodeStatus(def.id))}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Доска заданий на станции: квесты доски + слухи (500 кр.) + сигналы. */
export function DlcBoardPanel({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const d = dlcOf(world);
  const emp = playerEmpire(game);
  if (!world || !d) return <div className="sf-empty">{L("Нет мира.", "No world.")}</div>;
  if (!d.enabled) {
    return <div className="sf-empty" data-testid="board-disabled">{L("DLC «Первый Свет» выключен.", "The First Light DLC is disabled.")}</div>;
  }
  const boardQuests = d.board.questIds.map((id) => DLC_QUEST_BY_ID[id]).filter(Boolean);
  return (
    <div className="sf-board" data-testid="board-panel">
      <div className="sf-h" data-testid="channel-board">{L("Доска заданий", "Quest board")}</div>
      {boardQuests.length === 0 && <div className="sf-meta" data-testid="board-empty">{L("Доска обновляется каждые 10 тактов.", "The board refreshes every 10 ticks.")}</div>}
      {boardQuests.map((q) => {
        const st = d.quests[q.id];
        const canAccept = st?.status === "locked" || st?.status === "available";
        return (
          <div key={q.id} className="sf-line" data-testid={"board-quest-" + q.id}>
            <Badge tone={st?.status === "active" ? "info" : "warn"}>{statusLabel(st?.status ?? "locked")}</Badge>
            <span className="sf-nowrap">{dlcText(q.titleKey)}</span>
            <span className="sf-meta">{dlcText(q.summaryKey)}</span>
            <span className="sf-spacer" />
            <Btn size="sm" variant="primary" disabled={!canAccept}
              onClick={() => send(game, { type: "dlc_quest_accept", questId: q.id, source: "board" } as unknown as Command)}
              testId={"btn-board-accept-" + q.id}>{L("Принять", "Accept")}</Btn>
          </div>
        );
      })}
      <Sep />
      <div className="sf-h" data-testid="channel-rumor">{L("Слухи", "Rumors")} <span className="sf-meta">· 500 {L("кр.", "cr.")}</span></div>
      {d.rumors.length === 0 && <div className="sf-meta" data-testid="rumor-empty">{L("Слухов пока нет.", "No rumors yet.")}</div>}
      {d.rumors.map((r) => {
        const q = DLC_QUEST_BY_ID[r.questId];
        const affordable = (emp?.resources.credits ?? 0) >= 500;
        return (
          <div key={r.id} className="sf-line" data-testid={"rumor-item-" + r.id}>
            <span className={r.lie && r.revealed ? "sf-bad" : "sf-gold"}>◇</span>
            <span className="sf-nowrap">{r.revealed ? (r.lie ? L("Ложный слух", "False rumor") : L("Подтверждённый слух", "Confirmed rumor")) : L("Слух", "Rumor")}</span>
            <span className="sf-meta">{q ? dlcText(q.titleKey) : r.questId}</span>
            <span className="sf-spacer" />
            {r.revealed
              ? <Badge tone={r.lie ? "bad" : "good"}>{r.lie ? L("ложь", "lie") : L("правда", "true")}</Badge>
              : <Btn size="sm" disabled={!affordable}
                  onClick={() => send(game, { type: "dlc_buy_rumor", rumorId: r.id } as unknown as Command)}
                  testId={"btn-buy-rumor-" + r.id}>{L("Купить 500 кр.", "Buy 500 cr.")}</Btn>}
          </div>
        );
      })}
      <Sep />
      <div className="sf-h" data-testid="channel-signal">{L("Сигналы", "Signals")}</div>
      {d.signals.length === 0 && <div className="sf-meta" data-testid="signal-empty">{L("Сигналов пока нет.", "No signals yet.")}</div>}
      {d.signals.map((s) => (
        <div key={s.id} className="sf-line" data-testid={"signal-item-" + s.id}>
          <span className="sf-gold">✦</span>
          <span className="sf-nowrap">{L("Сигнал", "Signal")} · {L("такт", "tick")} {intText(s.expiresTick)}</span>
          <span className="sf-meta">{DLC_QUEST_BY_ID[s.questId] ? dlcText(DLC_QUEST_BY_ID[s.questId].titleKey) : s.questId}</span>
          <span className="sf-spacer" />
          {s.revealed ? <Badge tone="info">{L("раскрыт", "revealed")}</Badge> : <span className="sf-meta">#{s.systemId}</span>}
        </div>
      ))}
      <div className="sf-meta" style={{ marginTop: 4 }}>
        {L("Слухи покупаются за 500 кр., сигналы ловятся в системах флотом; доска обновляется каждые 10 тактов.", "Rumors cost 500 cr., signals are caught by fleets in systems; the board refreshes every 10 ticks.")}
      </div>
    </div>
  );
}