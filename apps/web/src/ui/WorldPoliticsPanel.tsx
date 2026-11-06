import { useEffect, useMemo, useState } from "react";
import { Badge, Btn, Modal, Panel, Sep } from "./controls";
import { L, send, type FullPanelProps } from "./fg";
import { intText, worldOf } from "./util";
import {
  AI_RELATION_ICON, aiEmpireName, aiEventKindLabel, aiNewsKindLabel, aiNewsOf, aiRelationLabel,
  aiStatusLabel, aiWorldEventsOf, aiWorldStateOf, chooseAiWorldEvent, type AiNewsItem, type AiWorldEvent,
} from "./world-politics";

type Tab = "overview" | "matrix" | "news" | "events" | "history";

/** task-43: «Мировая политика» — ИИ-ИИ отношения, лента, фракции, влияние на игрока, события. */
export function WorldPoliticsPanel({ game, state }: FullPanelProps) {
  const world = worldOf(game);
  const [tab, setTab] = useState<Tab>("overview");
  const [filter, setFilter] = useState<string>("all");
  const [hiddenEvents, setHiddenEvents] = useState<string[]>([]);
  const [historyEmpireId, setHistoryEmpireId] = useState<number | null>(null);
  const [historySystemId, setHistorySystemId] = useState<number | null>(null);
  const pol = useMemo(() => (world ? aiWorldStateOf(world) : null), [world, state.tick]);
  const news = useMemo(() => (world ? aiNewsOf(world, 60) : []), [world, state.tick, game]);
  const events = useMemo(() => (world ? aiWorldEventsOf(world) : []), [world, state.tick]);
  const eventLog = useMemo(() => game.getEvents(300), [game, state.tick]);

  if (!world || !pol) return <Panel title={L("Мировая политика", "World politics")} testId="world-politics-panel"><div className="sf-empty">{L("Нет мира.", "No world.")}</div></Panel>;

  const pid = world.playerEmpireId;
  const byId = new Map(pol.empires.map((e) => [e.id, e]));
  const playerRow = byId.get(pid);
  const kinds = ["all", "war", "treaty", "federation", "annexation", "call_to_arms", "trade_bloc"];
  const filterMatches = (n: AiNewsItem): boolean => {
    if (filter === "all") return true;
    if (filter === "treaty") return ["treaty", "peace", "tribute"].includes(n.kind);
    if (filter === "federation") return ["federation", "commonwealth", "centralization", "collapse"].includes(n.kind);
    if (filter === "annexation") return ["annexation", "accession", "vassalization"].includes(n.kind);
    return n.kind === filter;
  };
  const shownNews = news.filter(filterMatches);
  const pending = events.filter((e) => !hiddenEvents.includes(e.id));
  const tabs: [Tab, string][] = [
    ["overview", L("Обзор", "Overview")],
    ["matrix", L("Матрица", "Matrix") + " (" + pol.empires.length + ")"],
    ["news", L("Лента", "Feed") + " (" + news.length + ")"],
    ["events", L("События", "Events") + " (" + pending.length + ")"],
    ["history", L("История", "History")],
  ];
  const tabBtn = (id: Tab, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id}
      className={"sf-tab" + (tab === id ? " sf-tab--on" : "")}
      onClick={() => setTab(id)} data-testid={"btn-politics-tab-" + id}>{label}</button>
  );

  return (
    <div className="sf-fg-panel sf-politics" data-testid="politics-panel">
      <div className="sf-politics__head">
        <b>{L("Мировая политика", "World politics")}</b>
        <span className="sf-badge sf-badge--bad" data-testid="politics-wars">⚔ {L("войн", "wars")}: {intText(pol.stats.wars)}</span>
        <span className="sf-badge sf-badge--info" data-testid="politics-alliances">★ {L("союзов", "alliances")}: {intText(pol.stats.alliances)}</span>
        <span className="sf-badge sf-badge--info" data-testid="politics-federations">◆ {L("федераций", "federations")}: {intText(pol.stats.federations)}</span>
        <span className="sf-badge sf-badge--warn" data-testid="politics-blocs">▣ {L("блоков", "blocs")}: {intText(pol.stats.blocs)}</span>
        {pending.length > 0 && <span className="sf-badge sf-badge--warn" data-testid="politics-pending">⚑ {L("событий", "events")}: {intText(pending.length)}</span>}
        <span className="sf-spacer" />
        <span className="sf-meta">{L("такт", "tick")} {intText(state.tick)}</span>
      </div>
      <div className="sf-fg-tabs" role="tablist">{tabs.map(([id, label]) => tabBtn(id, label))}</div>

      {tab === "overview" && (
        <div className="sf-fg-grid">
          <Panel title={L("Фракции и объединения", "Factions and unions")} tall>
            <div className="sf-meta">{L("Статус: активна / ослаблена / распалась / поглощена / в содружестве", "Status: active / weakened / collapsed / annexed / in commonwealth")}</div>
            <Sep />
            {pol.empires.map((e) => (
              <div key={e.id} className="sf-line" data-testid={"politics-empire-row-" + e.id}>
                <span className="sf-dot" style={{ background: e.id === pid ? "#F5C542" : "#8FA3BF" }} />
                <span className="sf-nowrap" data-testid={"empire-link-" + e.id}>{e.name}{e.id === pid ? L(" (вы)", " (you)") : ""}</span>
                <span data-testid={"faction-status-" + e.id}><Badge tone={e.status === "active" ? "good" : e.status === "weakened" ? "warn" : "bad"}>{aiStatusLabel(e.status)}</Badge></span>
                <span className="sf-meta">⚔ {e.atWarWith.length} · ★ {e.allies.length}{e.blocId ? " · ◆" : ""}</span>
                <span className="sf-spacer" />
                <span className="sf-meta">{L("сила", "power")}: {intText(e.power)}</span>
              </div>
            ))}
            {pol.blocs.length > 0 && (
              <>
                <Sep />
                <div className="sf-h">{L("Блоки", "Blocs")}</div>
                {pol.blocs.map((b) => (
                  <div key={b.id} className="sf-line" data-testid={"politics-bloc-" + b.id}>
                    <span className="sf-gold">◆</span>
                    <span className="sf-nowrap">{b.nameKey ? L(b.nameKey, b.nameKey) : (b.nameRu ?? b.id)}</span>
                    <span className="sf-meta">{b.kind}</span>
                    <span className="sf-spacer" />
                    <span className="sf-meta">{b.members.map((m) => aiEmpireName(world, m)).join(", ")}</span>
                  </div>
                ))}
              </>
            )}
          </Panel>
          <Panel title={L("Влияние на вас", "Impact on you")} tall>
            {playerRow ? (
              <div className="sf-grid2">
                <div><div className="sf-h">{L("Союзники", "Allies")}</div><div className="sf-meta" data-testid="politics-player-allies">{pol.playerImpact.allies.map((id) => aiEmpireName(world, id)).join(", ") || "—"}</div></div>
                <div><div className="sf-h">{L("Угрозы", "Threats")}</div><div className="sf-meta sf-bad" data-testid="politics-player-threats">{pol.playerImpact.threats.map((id) => aiEmpireName(world, id)).join(", ") || "—"}</div></div>
                <div><div className="sf-h">{L("Блоки", "Blocs")}</div><div className="sf-meta" data-testid="politics-player-blocs">{pol.playerImpact.blocIds.map((id) => pol.blocs.find((b) => b.id === id)?.nameRu ?? id).join(", ") || "—"}</div></div>
                <div><div className="sf-h">{L("Войны", "Wars")}</div><div className="sf-meta sf-bad" data-testid="politics-player-wars">{pol.playerImpact.wars.map((id) => aiEmpireName(world, id)).join(", ") || "—"}</div></div>
              </div>
            ) : <div className="sf-meta">{L("Нет данных об империи игрока.", "No player empire data.")}</div>}
            <Sep />
            <div className="sf-meta">
              {L("Мировая политика идёт без вашего участия; ваши договоры и блоки — ниже.", "World politics runs without you; your treaties and blocs are highlighted.")}
            </div>
            <div className="sf-row" style={{ flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              <Btn size="sm" onClick={() => setTab("matrix")} testId="btn-politics-open-matrix">{L("Матрица отношений", "Relations matrix")}</Btn>
              <Btn size="sm" onClick={() => setTab("news")} testId="btn-politics-open-news">{L("Лента событий", "Event feed")}</Btn>
            </div>
          </Panel>
        </div>
      )}

      {tab === "matrix" && (
        <Panel title={L("Матрица отношений ИИ-ИИ", "AI-to-AI relations matrix")} tall>
          <div className="sf-meta">
            {L("⚔ война · ★ союз · ◆ федерация · ▼ вассалитет · ₡ торговля · ≈ пакт · · нейтрально", "⚔ war · ★ alliance · ◆ federation · ▼ vassal · ₡ trade · ≈ NAP · · neutral")}
          </div>
          <div className="sf-politics__matrix-wrap">
            <table className="sf-politics__matrix" data-testid="politics-matrix">
              <thead>
                <tr><th />
                  {pol.empires.map((e) => <th key={e.id} className={e.id === pid ? "sf-politics__me" : ""} title={e.name}>{e.name.slice(0, 10)}</th>)}
                </tr>
              </thead>
              <tbody>
                {pol.empires.map((row) => (
                  <tr key={row.id} data-testid={"politics-matrix-row-" + row.id}>
                    <th className={row.id === pid ? "sf-politics__me" : ""} title={row.name}>{row.name.slice(0, 14)}</th>
                    {pol.empires.map((col) => {
                      if (row.id === col.id) return <td key={col.id} className="sf-politics__cell sf-politics__cell--self">•</td>;
                      const rel = pol.relations.find((r) => (r.a === row.id && r.b === col.id) || (r.a === col.id && r.b === row.id));
                      const kind = rel?.kind ?? "neutral";
                      return (
                        <td key={col.id}
                          className={"sf-politics__cell sf-politics__cell--" + kind}
                          data-testid={"politics-relation-" + row.id + "-" + col.id}
                          title={row.name + " — " + col.name + ": " + aiRelationLabel(kind)}>
                          {AI_RELATION_ICON[kind] ?? "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sf-meta" style={{ marginTop: 4 }}>
            {L("Строки — агрессор/инициатор, столбцы — цель; цвет и символ показывают текущее отношение.", "Rows are the actor, columns the target; color and icon show the current relation.")}
          </div>
        </Panel>
      )}

      {tab === "news" && (
        <Panel title={L("Лента мировых событий", "World events feed")} tall right={<Badge>{intText(shownNews.length)}</Badge>}>
          <div className="sf-row" style={{ flexWrap: "wrap", gap: 3 }}>
            {kinds.map((k) => (
              <Btn key={k} size="sm" active={filter === k} onClick={() => setFilter(k)} testId={"ai-news-filter-" + k}
                title={k === "all" ? L("Все", "All") : aiNewsKindLabel(k)}>
                {k === "all" ? L("Все", "All") : aiNewsKindLabel(k)}
              </Btn>
            ))}
          </div>
          <Sep />
          <div data-testid="ai-news-feed">
          {shownNews.length === 0 && <div className="sf-empty" data-testid="politics-news-empty">{L("Мировых событий пока нет — ИИ-ИИ политика появится по ходу партии.", "No world events yet — AI-to-AI politics appear as the game progresses.")}</div>}
          {shownNews.map((n) => (
            <div key={n.id} className="sf-line" data-testid={"ai-news-item-" + n.id}>
              <span className="sf-meta" style={{ width: 52 }}>{"т" + intText(n.tick)}</span>
              <Badge tone={n.severity === "bad" ? "bad" : n.severity === "warn" ? "warn" : n.severity === "good" ? "good" : "info"}>{aiNewsKindLabel(n.kind)}</Badge>
              <span className="sf-nowrap">{n.actorName}{n.targetName ? " → " + n.targetName : ""}</span>
              <span className="sf-meta">{n.textRu ?? (n.textKey ? L(n.textKey, n.textKey) : "")}</span>
              <span className="sf-spacer" />
              {n.playerImpact && <Badge tone={n.playerImpact === "ally" ? "good" : n.playerImpact === "threat" ? "bad" : "info"}>{n.playerImpact === "ally" ? L("союзник", "ally") : n.playerImpact === "threat" ? L("угроза", "threat") : L("блок", "bloc")}</Badge>}
            </div>
          ))}
          </div>
        </Panel>
      )}

      {tab === "history" && (() => {
        const empireId = historyEmpireId ?? pid;
        const factionNews = news.filter((n) => n.actorEmpireId === empireId || n.targetEmpireId === empireId);
        const factionLog = eventLog.filter((e) => e.empireId === empireId);
        const systemLog = historySystemId != null ? eventLog.filter((e) => e.systemId === historySystemId) : [];
        const rows = [
          ...factionNews.map((n) => ({ key: "n" + n.id, tick: n.tick, kind: n.kind, text: (n.actorName ?? "") + (n.targetName ? " → " + n.targetName : "") + (n.textRu ? " · " + n.textRu : ""), tone: n.severity ?? "info" })),
          ...factionLog.map((e) => ({ key: "e" + e.id, tick: e.tick, kind: e.kind, text: e.messageRu, tone: e.severity })),
          ...systemLog.map((e) => ({ key: "s" + e.id, tick: e.tick, kind: e.kind, text: e.messageRu, tone: e.severity })),
        ].sort((a, b) => b.tick - a.tick).slice(0, 150);
        return (
          <Panel title={L("История фракции и системы", "Faction and system history")} tall>
            <div className="sf-row" style={{ flexWrap: "wrap", gap: 6 }}>
              <label className="sf-meta">{L("Фракция", "Faction")}{" "}
                <select data-testid="history-empire" value={empireId} onChange={(e) => setHistoryEmpireId(Number(e.target.value))}>
                  {world.empires.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.id === pid ? " (вы)" : ""}</option>)}
                </select>
              </label>
              <label className="sf-meta">{L("Система", "System")}{" "}
                <select data-testid="history-system" value={historySystemId ?? 0} onChange={(e) => setHistorySystemId(Number(e.target.value) || null)}>
                  <option value={0}>{L("вся галактика", "whole galaxy")}</option>
                  {world.systems.filter((sys) => sys.knownBy.includes(pid)).slice(0, 120).map((sys) => <option key={sys.id} value={sys.id}>{sys.name}</option>)}
                </select>
              </label>
              <span className="sf-spacer" />
              <span className="sf-meta" data-testid="history-count">{intText(rows.length)}</span>
            </div>
            <Sep />
            <div className="sf-list" data-testid="politics-history">
              {rows.length === 0 && <div className="sf-empty">{L("Пока нет действий по этой фракции/системе.", "No actions for this faction/system yet.")}</div>}
              {rows.map((row) => (
                <div className="sf-line" key={row.key} data-testid={"history-row-" + row.key}>
                  <span className="sf-meta" style={{ width: 52 }}>{"т" + intText(row.tick)}</span>
                  <Badge tone={row.tone === "bad" ? "bad" : row.tone === "warn" ? "warn" : row.tone === "good" ? "good" : "info"}>{row.kind}</Badge>
                  <span className="sf-meta" style={{ minWidth: 0 }}>{row.text}</span>
                </div>
              ))}
            </div>
          </Panel>
        );
      })()}

      {tab === "events" && (
        <Panel title={L("События для вас", "Events for you")} tall>
          {pending.length === 0 && <div className="sf-empty" data-testid="politics-events-empty">{L("Нет активных событий.", "No active events.")}</div>}
          {pending.map((ev) => (
            <EventCard key={ev.id} ev={ev} world={world} onChoose={(choiceId) => {
              chooseAiWorldEvent((cmd) => game.sendCommand(cmd as never), ev.id, choiceId);
              setHiddenEvents((prev) => [...prev, ev.id]);
            }} />
          ))}
        </Panel>
      )}
    </div>
  );
}

export function AiWorldEventModal({ game, state }: { game: FullPanelProps["game"]; state: FullPanelProps["state"] }) {
  const world = worldOf(game);
  const [hidden, setHidden] = useState<string[]>([]);
  const events = useMemo(() => (world ? aiWorldEventsOf(world) : []), [world, state.tick]);
  const MODAL_KINDS = ["call_to_arms", "accession_offer", "vassalization_demand", "centralization_vote"];
  const ev = events.find((e) => !hidden.includes(e.id) && MODAL_KINDS.includes(e.kind));
  useEffect(() => {
    if (!ev) return;
    game.setNarrativeModalOpen(true);
    return () => game.setNarrativeModalOpen(false);
  }, [ev?.id, game]);
  if (!ev) return null;
  return (
    <Modal
      title={L("Мировая политика", "World politics") + " · " + (ev.titleRu ?? (ev.titleKey ? L(ev.titleKey, ev.titleKey) : aiEventKindLabel(ev.kind)))}
      onClose={() => setHidden((p) => [...p, ev.id])}
      testId="ai-world-event"
      closeTestId="btn-close-ai-event"
      footer={<Btn onClick={() => setHidden((p) => [...p, ev.id])} testId="btn-later-ai-event">{L("Отложить", "Later")}</Btn>}
    >
      <div className="sf-fg-brief">{ev.textRu ?? (ev.textKey ? L(ev.textKey, ev.textKey) : "")}</div>
      <div className="sf-meta">
        {aiEventKindLabel(ev.kind)} · {L("от", "from")} {aiEmpireName(world, ev.fromEmpireId)}
        {ev.expiresTick ? " · " + L("истекает на такте", "expires on tick") + " " + intText(ev.expiresTick) : ""}
      </div>
      <Sep />
      <div className="sf-h">{L("Ваше решение", "Your decision")}</div>
      <div className="sf-list">
        {ev.choices.map((c) => (
          <div key={c.id} className="sf-line">
            <span className="sf-nowrap">{c.labelRu ?? (c.labelKey ? L(c.labelKey, c.labelKey) : c.id)}</span>
            <span className="sf-meta">{(Array.isArray(c.effectsRu) ? c.effectsRu : c.effectsRu ? [c.effectsRu] : []).join(" · ")}</span>
            <span className="sf-spacer" />
            <Btn size="sm" variant="primary" testId={"ai-event-choice-" + c.id}
              onClick={() => { chooseAiWorldEvent((cmd) => game.sendCommand(cmd as never), ev.id, c.id); setHidden((p) => [...p, ev.id]); }}>
              {L("Выбрать", "Choose")}
            </Btn>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function EventCard({ ev, world, onChoose }: { ev: AiWorldEvent; world: NonNullable<ReturnType<typeof worldOf>>; onChoose: (choiceId: string) => void }) {
  return (
    <div className="sf-politics__event" data-testid={"event-" + ev.kind + "-" + ev.id}>
      <div className="sf-row">
        <Badge tone="warn">{aiEventKindLabel(ev.kind)}</Badge>
        <b className="sf-nowrap">{ev.titleRu ?? (ev.titleKey ? L(ev.titleKey, ev.titleKey) : ev.kind)}</b>
        <span className="sf-spacer" />
        <span className="sf-meta">{L("от", "from")} {aiEmpireName(world, ev.fromEmpireId)}</span>
      </div>
      <div className="sf-meta">{ev.textRu ?? (ev.textKey ? L(ev.textKey, ev.textKey) : "")}</div>
      <div className="sf-row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>
        {ev.choices.map((c) => (
          <Btn key={c.id} size="sm" variant="primary" onClick={() => onChoose(c.id)} testId={"event-choice-" + c.id}>
            {c.labelRu ?? (c.labelKey ? L(c.labelKey, c.labelKey) : c.id)}
          </Btn>
        ))}
      </div>
    </div>
  );
}