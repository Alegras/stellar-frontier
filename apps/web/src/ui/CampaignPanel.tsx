import { useMemo, useState } from "react";
import { Badge, Bar, Btn, Field, KV, Panel, Sep, Tip } from "./controls";
import {
  L, tr, useLocale,
  ACT_LIST, advOf, BRANCH_LIST, BRANCH_RU, BRANCH_DESC, CAMPAIGN_MISSION_LIST, CRISIS_KIND_RU,
  CRISIS_LIST, ENDING_LIST, fgOf, MEGA_LIST, MEGA_ORDER, MEGA_RU, campaignMissionList, send,
  systemName, victoryPct, type CampaignMissionView, type FullPanelProps,
} from "./fg";
import { intText, num, playerEmpire, rnd, ticksRu, worldOf } from "./util";

type Tab = "journal" | "missions" | "branches" | "anomalies" | "crises" | "megastructures" | "victory";

const STATUS_LABEL: Record<CampaignMissionView["status"], [string, string]> = {
  locked: ["закрыта", "locked"],
  available: ["доступна", "available"],
  active: ["активна", "active"],
  completed: ["завершена", "completed"],
  failed: ["провалена", "failed"],
  skipped: ["пропущена", "skipped"],
};
function statusLabel(status: CampaignMissionView["status"]): string {
  const pair = STATUS_LABEL[status] ?? [status, status];
  return L(pair[0], pair[1]);
}

export function CampaignPanel({ game }: FullPanelProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const fg = fgOf(world);
  const adv = advOf(world, emp?.id ?? 0);
  useLocale();
  const [tab, setTab] = useState<Tab>("journal");
  const [brief, setBrief] = useState<string | null>(null);

  if (!world || !emp || !fg) {
    return <Panel title={tr("campaign.title", undefined, "Кампания")} testId="campaign-panel"><div className="sf-empty">Мир ещё не создан.</div></Panel>;
  }
  const c = fg.campaign;
  const missions = campaignMissionList(c);
  const active = c.activeMissionId ? missions.find((m) => m.id === c.activeMissionId) ?? null : null;
  const act = ACT_LIST.find((a) => a.id === c.act) ?? null;

  return (
    <div className="sf-fg-panel" data-testid="campaign-panel">
      <div className="sf-fg-tabs" role="tablist">
        {([
          ["journal", L("Журнал", "Journal")],
          ["missions", tr("campaign.missions", undefined, "Миссии") + " (" + missions.filter((m) => m.status === "available" || m.status === "active").length + ")"],
          ["branches", L("Ветки", "Branches")],
          ["anomalies", tr("anomalies.title", undefined, "Аномалии") + " (" + fg.anomalies.length + ")"],
          ["crises", tr("crisis.title", undefined, "Кризисы") + " (" + fg.crises.filter((x) => !x.defeated).length + ")"],
          ["megastructures", tr("megastructure.title", undefined, "Мегаструктуры")],
          ["victory", L("Победа и концовки", "Victory and endings")],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={"sf-tab" + (tab === id ? " sf-tab--on" : "")} onClick={() => setTab(id)}
            data-testid={"btn-campaign-" + id}>{label}</button>
        ))}
      </div>

      {tab === "journal" && (
        <div className="sf-fg-grid">
          <Panel title={L("Акты", "Acts") + " · " + (c.act)} tall right={<Badge tone="info">{L("ветка", "branch")}: {tr("campaign.branch." + c.branch, undefined, BRANCH_RU[c.branch])}</Badge>}>
            <div className="sf-meta">{act ? act.ru + " · " + L("такты", "ticks") + " " + intText(act.startTick) + "–" + intText(act.endTick) : "Акт " + intText(c.act) + " (контент актов не загружен)"}</div>
            {act && <div className="sf-meta">{act.summaryRu}</div>}
            <Sep />
            <div className="sf-h">{L("Активная миссия", "Active mission")}</div>
            {active ? (
              <>
                <div className="sf-row"><b className="sf-nowrap">{active.titleRu}</b><span className="sf-spacer" /><Badge tone="good">активна</Badge></div>
                <div className="sf-meta">{active.briefingRu}</div>
                <div className="sf-list">
                  {active.objectives.map((o) => {
                    const p = o.count > 0 ? o.progress / o.count : 0;
                    return (
                      <div key={o.id} className="sf-line">
                        <span className={o.done ? "sf-ok" : "sf-meta"}>{o.done ? "✓" : "•"}</span>
                        <span className="sf-nowrap">{o.type}{o.targetSystemId ? " · " + systemName(world, o.targetSystemId) : ""}</span>
                        <div style={{ width: 120 }}><Bar v01={p} thin /></div>
                        <span className="sf-meta">{intText(o.progress)}/{intText(o.count)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : <div className="sf-meta">{L("Активной сюжетной миссии нет.", "No active story mission.")}</div>}
            <Sep />
            <div className="sf-h">{L("События кампании", "Campaign events")}</div>
            <div className="sf-scroll sf-fg-journal" data-testid="campaign-journal">
              {[...fg.journal].reverse().slice(0, 60).map((j, i) => (
                <div key={i} className="sf-fg-journal__row">
                  <span className="sf-meta">{L("такт", "tick")} {intText(j.tick)}</span>
                  <span className="sf-tag">{j.kind}</span>
                  <span>{j.textRu}</span>
                </div>
              ))}
              {fg.journal.length === 0 && <div className="sf-meta">Журнал пуст — события появятся по ходу кампании.</div>}
            </div>
            <div className="sf-meta">{L("Артефактов", "Artifacts")}: {intText(c.artifactCount)} · {L("секретная линия", "secret line")}: {intText(c.secretLine)} · {L("сюжетных локов", "story locks")}: {intText(c.locks.length)}</div>
          </Panel>
          <Panel title={L("Цели и награды", "Goals and rewards")} tall>
            <div className="sf-h">{L("Цели акта", "Act goals")}</div>
            <div className="sf-meta">{active ? L("Выполните цели активной миссии; провал не блокирует кампанию.", "Complete the active mission goals; failure does not block the campaign.") : L("Начните миссию на вкладке «Миссии».", "Start a mission from the Missions tab.")}</div>
            <Sep />
            <div className="sf-h">{L("Ветки кампании", "Campaign branches")}</div>
            {(["federation", "sovereignty", "syndicate"] as const).map((b) => (
              <div key={b} className="sf-line">
                <span className={c.branch === b ? "sf-gold" : "sf-meta"}>◆</span>
                <span className="sf-nowrap">{tr("campaign.branch." + b, undefined, BRANCH_RU[b])}</span>
                <span className="sf-spacer" />
                <div style={{ width: 100 }}><Bar v01={num(c.branchProgress[b] ?? 0)} thin tone="sf-bar--gold" /></div>
                <span className="sf-meta">{intText(c.branchProgress[b] ?? 0)}</span>
              </div>
            ))}
            <Sep />
            <div className="sf-h">{L("Концовки", "Endings")}</div>
            {(ENDING_LIST.length > 0 ? ENDING_LIST.map((e) => e.ru) : c.endings).slice(0, 8).map((e) => (
              <div key={e} className="sf-meta">• {e}</div>
            ))}
            {ENDING_LIST.length === 0 && c.endings.length === 0 && <div className="sf-meta">{L("Концовки ещё не открыты.", "No endings unlocked yet.")}</div>}
          </Panel>
        </div>
      )}

      {tab === "missions" && (
        <div className="sf-fg-grid">
          <Panel title={L("Миссии кампании", "Campaign missions") + " · " + missions.length} tall>
            {missions.length === 0 && (
              <div className="sf-empty">{L("Контент миссий кампании ещё не загружен (@sf/data, task-11).", "Campaign mission content is not loaded from @sf/data yet (task-11).")}</div>
            )}
            {missions.slice(0, 40).map((m) => {
              const status = m.status;
              return (
                <div key={m.id} className={"sf-line sf-line--pick" + (brief === m.id ? " sf-line--sel" : "")} onClick={() => setBrief(brief === m.id ? null : m.id)} data-testid={"campaign-mission-" + m.id}>
                  <span className={"sf-meta " + (status === "active" ? "sf-gold" : status === "available" ? "sf-ok" : "")}>{statusLabel(status)}</span>
                  <span className="sf-nowrap">{L("Акт", "Act")} {m.act} · {m.titleRu}</span>
                  <span className="sf-spacer" />
                  {m.secret && <Badge tone="warn">{L("секрет", "secret")}</Badge>}
                  <span className="sf-meta">{m.giver}</span>
                </div>
              );
            })}
          </Panel>
          <Panel title={tr("campaign.briefing", undefined, "Брифинг")} tall>
            {!brief && <div className="sf-empty">{L("Выберите миссию в списке.", "Select a mission in the list.")}</div>}
            {brief && (() => {
              const m = missions.find((x) => x.id === brief);
              if (!m) return <div className="sf-empty">Миссия не найдена.</div>;
              const status = m.status;
              const rewards = m.rewards;
              return (
                <div data-testid="mission-briefing">
                  <div className="sf-row"><b>{m.titleRu}</b><span className="sf-spacer" /><Badge tone={status === "active" ? "good" : "info"}>{statusLabel(status)}</Badge></div>
                  <div className="sf-meta">{L("Акт", "Act")} {m.act} · {m.giver} · {m.branchRequired ? L("ветка", "branch") + ": " + tr("campaign.branch." + m.branchRequired, undefined, BRANCH_RU[m.branchRequired as keyof typeof BRANCH_RU]) : L("без ветки", "no branch")}</div>
                  <Sep />
                  <div className="sf-fg-brief">{m.briefingRu || "Брифинг из данных кампании."}</div>
                  <Sep />
                  <div className="sf-h">{tr("campaign.objective", undefined, "Цели")}</div>
                  {m.objectives.length === 0 && <div className="sf-meta">{L("Цели из данных.", "Goals from data.")}</div>}
                  {m.objectives.map((o) => (
                    <div key={o.id} className="sf-line"><span className="sf-gold">•</span><span>{o.type}{o.targetSystemId ? " · " + systemName(world, o.targetSystemId) : ""} {o.count ? "× " + intText(o.count) : ""}</span></div>
                  ))}
                  <Sep />
                  <div className="sf-h">{L("Награды", "Rewards")}</div>
                  <div className="sf-meta">
                    {intText(rewards.credits ?? 0)} кр.
                    {rewards.alloys ? " · " + intText(rewards.alloys) + " спл." : ""}
                    {rewards.influence ? " · " + intText(rewards.influence) + " вл." : ""}
                    {rewards.reputation ? " · репутация " + intText(rewards.reputation) : ""}
                  </div>
                  {m.failCondition && <div className="sf-warn">{L("Условие провала", "Failure condition")}: {m.failCondition}</div>}
                  <div className="sf-row" style={{ marginTop: 6 }}>
                    <Btn variant="primary" disabled={status !== "available"} onClick={() => send(game, { type: "campaign_start", missionId: m.id })} testId="btn-campaign-start">
                      {status === "available" ? tr("campaign.start", undefined, "Начать миссию") : status === "active" ? L("Уже активна", "Already active") : L("Недоступна", "Unavailable")}
                    </Btn>
                  </div>
                </div>
              );
            })()}
          </Panel>
        </div>
      )}

      {tab === "branches" && (
        <div className="sf-fg-branches">
          {(BRANCH_LIST.length > 0 ? BRANCH_LIST.map((b) => ({ id: b.id, ru: b.ru, descRu: b.descRu })) : [
            { id: "federation", ru: BRANCH_RU.federation, descRu: BRANCH_DESC.federation },
            { id: "sovereignty", ru: BRANCH_RU.sovereignty, descRu: BRANCH_DESC.sovereignty },
            { id: "syndicate", ru: BRANCH_RU.syndicate, descRu: BRANCH_DESC.syndicate },
          ]).map((b) => {
            const id = b.id as "federation" | "sovereignty" | "syndicate";
            const chosen = c.branch === id;
            return (
              <Panel key={id} title={b.ru} right={chosen ? <Badge tone="good">{L("выбрана", "chosen")}</Badge> : undefined} testId={"branch-" + id}>
                <div className="sf-meta">{b.descRu}</div>
                <div className="sf-hud-gauge" style={{ marginTop: 6 }}>
                  <span className="sf-meta" style={{ width: 48 }}>{L("прогресс", "progress")}</span>
                  <Bar v01={num(c.branchProgress[id] ?? 0) / 100} tone="sf-bar--gold" />
                  <span style={{ width: 40, textAlign: "right" }}>{intText(c.branchProgress[id] ?? 0)}%</span>
                </div>
                <Btn variant={chosen ? "default" : "primary"} disabled={chosen} onClick={() => send(game, { type: "campaign_branch", branch: id })} testId={"btn-branch-" + id}>
                  {chosen ? L("Ветка выбрана", "Branch chosen") : L("Выбрать ветку", "Choose branch")}
                </Btn>
                <div className="sf-meta">Выбор фиксирует сюжетную линию и доступные концовки.</div>
              </Panel>
            );
          })}
        </div>
      )}

      {tab === "anomalies" && (
        <div className="sf-fg-grid">
          <Panel title={tr("anomalies.title", undefined, "Аномалии") + " · " + fg.anomalies.length} testId="anomalies-panel" tall>
            {fg.anomalies.length === 0 && (
              <div className="sf-empty">{L("Аномалии ещё не обнаружены.", "No anomalies discovered yet.")}
                <div className="sf-meta">{L("Сканируйте системы (V в полёте) — аномалии появятся в этом журнале.", "Scan systems (V in flight) — anomalies will appear in this log.")}</div>
              </div>
            )}
            {fg.anomalies.map((a) => (
              <div key={a.id} className="sf-line" style={{ alignItems: "flex-start" }} data-testid={"anomaly-" + a.id}>
                <span className={a.artifact ? "sf-gold" : "sf-info"}>{a.artifact ? "◆" : "◇"}</span>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div className="sf-row"><b className="sf-nowrap">{a.titleRu}</b><span className="sf-spacer" /><span className="sf-meta">{a.kind} · {systemName(world, a.systemId)}</span></div>
                  <div className="sf-meta">
                    {a.discovered ? L("обнаружена", "discovered") : L("не обнаружена", "undiscovered")} · {a.investigated ? L("исследована", "investigated") : L("не исследована", "not investigated")} · {L("шаг", "step")} {intText(a.step)}
                    {a.chainId ? " · " + L("цепочка", "chain") + " " + a.chainId : ""}
                  </div>
                </div>
                <Btn size="sm" variant="primary" disabled={!a.discovered || a.investigated} onClick={() => send(game, { type: "anomaly_investigate", anomalyId: a.id })} testId={"btn-investigate-" + a.id}>
                  {a.investigated ? tr("anomalies.investigated", undefined, "Изучено") : tr("anomalies.investigate", undefined, "Исследовать")}
                </Btn>
              </div>
            ))}
          </Panel>
          <Panel title={"Археология · " + fg.archaeology.length} tall>
            {fg.archaeology.length === 0 && <div className="sf-empty">{L("Археологических цепочек нет. Исследуйте аномалии.", "No archaeology chains. Investigate anomalies.")}</div>}
            {fg.archaeology.map((a) => (
              <div key={a.chainId} className="sf-fg-row" data-testid={"archaeology-" + a.chainId}>
                <div className="sf-row"><b className="sf-nowrap">{a.titleRu}</b><span className="sf-spacer" /><span className="sf-meta">{L("шаг", "step")} {intText(a.step)}/{intText(a.steps)}</span></div>
                <Bar v01={a.steps > 0 ? a.step / a.steps : 0} thin tone="sf-bar--gold" />
                <div className="sf-row" style={{ gap: 4, marginTop: 2 }}>
                  <Btn size="sm" disabled={a.completed} onClick={() => send(game, { type: "archaeology_step", chainId: a.chainId })} testId={"btn-archaeology-" + a.chainId}>
                    {a.completed ? L("Завершено", "Completed") : L("Следующий шаг", "Next step")}
                  </Btn>
                  <span className="sf-meta">артефакт: {a.completed ? "получен" : "в цепочке"}</span>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {tab === "crises" && (
        <div className="sf-fg-panel" data-testid="crisis-panel">
          {fg.crises.length === 0 && (
            <div className="sf-empty">
              {L("Активных кризисов нет.", "No active crises.")}
              <div className="sf-meta">Кризисы начинаются по тактам ({CRISIS_LIST.map((c2) => c2.ru + ": " + intText(c2.startTick)).join("; ") || "контент ещё не загружен"}).</div>
            </div>
          )}
          {fg.crises.map((cr) => (
            <Panel key={cr.id} title={cr.titleRu || CRISIS_KIND_RU[cr.kind]} right={<Badge tone={cr.defeated ? "good" : "bad"}>{cr.defeated ? "отражён" : "активен"}</Badge>} testId={"crisis-" + cr.id}>
              <div className="sf-grid2">
                <KV k={L("Стадия", "Stage")} v={intText(cr.stage)} />
                <KV k={L("Сила", "Strength")} v={intText(cr.strengthFp) + " FP"} />
                <KV k={L("Систем под контролем", "Systems controlled")} v={intText(cr.systems.length)} />
                <KV k={L("Узлов", "Nodes")} v={intText(cr.nodes.length)} />
                <KV k={L("Волн отбито", "Waves repelled")} v={intText(cr.wavesRepelled)} />
                <KV k={L("Логово", "Lair")} v={cr.lairSystemId ? systemName(world, cr.lairSystemId) : "—"} />
              </div>
              <div className="sf-hud-gauge" style={{ marginTop: 4 }}>
                <span className="sf-meta" style={{ width: 60 }}>{L("прогресс", "progress")}</span>
                <Bar v01={cr.progress} tone={cr.progress > 0.7 ? "sf-bar--ok" : "sf-bar--warn"} />
                <span style={{ width: 40, textAlign: "right" }}>{rnd(num(cr.progress) * 100)}%</span>
              </div>
              <div className="sf-meta">{L("Начало", "Started")}: {L("такт", "tick")} {intText(cr.startedTick)} · {L("последнее действие", "last action")}: {L("такт", "tick")} {intText(cr.lastActionTick)}</div>
            </Panel>
          ))}
        </div>
      )}

      {tab === "megastructures" && (
        <div className="sf-fg-grid">
          <Panel title={tr("megastructure.title", undefined, "Мегаструктуры") + " · " + fg.megastructures.length} testId="megastructures-panel" tall>
            {fg.megastructures.length === 0 && (
              <div className="sf-empty">
                {L("Мегаструктур нет.", "No megastructures.")}
                <div className="sf-meta">Постройте первую: нужны сплавы и открытая технология/перк.</div>
              </div>
            )}
            {fg.megastructures.map((m) => (
              <div key={m.id} className="sf-fg-row" data-testid={"mega-" + m.id}>
                <div className="sf-row">
                  <b className="sf-nowrap">{MEGA_RU[m.type] ?? m.type}</b>
                  <span className="sf-spacer" />
                  <Badge tone={m.active ? "good" : "warn"}>{m.active ? "активна" : "строится"}</Badge>
                </div>
                <div className="sf-meta">{systemName(world, m.systemId)} · HP {intText(m.hp)}/{intText(m.maxHp)} · осталось {intText(m.ticksLeft)} тактов</div>
                <Bar v01={m.totalTicks > 0 ? 1 - m.ticksLeft / m.totalTicks : 0} thin tone="sf-bar--gold" />
              </div>
            ))}
          </Panel>
          <Panel title={tr("megastructure.build", undefined, "Построить мегаструктуру")} tall>
            <MegaForm game={game} />
          </Panel>
        </div>
      )}

      {tab === "victory" && (
        <div className="sf-fg-grid">
          <Panel title={L("Условия победы", "Victory conditions")} testId="victory-progress-panel" tall>
            {(["domination", "federation", "ascension", "economy", "crisis", "score"] as const).map((k) => {
              const p = fg.victoryProgress[k];
              return (
                <div key={k} className="sf-fg-victory" data-testid={"victory-" + k}>
                  <div className="sf-row"><b>{victoryLabel(k)}</b><span className="sf-spacer" /><span className="sf-meta">{victoryPct(p)}%</span></div>
                  <Bar v01={num(p)} tone={num(p) >= 0.75 ? "sf-bar--ok" : "sf-bar--gold"} />
                </div>
              );
            })}
            <Sep />
            <div className="sf-grid2">
              <KV k={L("Счёт империи", "Empire score")} v={intText(fg.score[emp.id] ?? 0)} />
              <KV k={L("Давление финала", "Endgame pressure")} v={intText(rnd(num(fg.finalPressure) * 100)) + "%"} />
              <KV k={L("Пик FP", "Peak FP")} v={intText(adv?.peakFp ?? 0)} />
              <KV k={L("ВВП", "GDP")} v={intText(adv?.gdp ?? 0)} />
            </div>
          </Panel>
          <Panel title={L("Концовки", "Endings")} tall>
            <div className="sf-meta">
              {c.branch === "undecided" ? L("Ветка не выбрана: концовка определится позже.", "Branch not chosen: the ending will be determined later.") : L("Ветка", "Branch") + ": " + tr("campaign.branch." + c.branch, undefined, BRANCH_RU[c.branch]) + ". " + L("Доступные концовки зависят от целей и кризисов.", "Available endings depend on goals and crises.")}
            </div>
            <Sep />
            {(ENDING_LIST.length > 0 ? ENDING_LIST : []).map((e) => (
              <div key={e.id} className={"sf-line" + (c.endings.includes(e.id) ? " sf-line--sel" : "")}>
                <span className={c.endings.includes(e.id) ? "sf-ok" : "sf-meta"}>{c.endings.includes(e.id) ? "✓" : "○"}</span>
                <span className="sf-nowrap">{e.ru}</span>
                <span className="sf-spacer" />
                <span className="sf-meta">{e.secret ? "секретная" : e.condition}</span>
              </div>
            ))}
            {ENDING_LIST.length === 0 && (
              <div className="sf-meta">{L("Контент концовок ещё не загружен (@sf/data, task-11).", "Ending content is not loaded from @sf/data yet (task-11).")} {L("Открыто концовок", "Endings unlocked")}: {intText(c.endings.length)}.</div>
            )}
            <div className="sf-meta" style={{ marginTop: 6 }}>
              {L("Победа фиксируется симуляцией; экран победы открывается автоматически.", "Victory is determined by the simulation; the victory screen opens automatically.")}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function victoryLabel(k: string): string {
  const m: Record<string, [string, string]> = {
    domination: ["Доминирование (45% систем)", "Domination (45% of systems)"],
    federation: ["Федерация (60% населения)", "Federation (60% of population)"],
    ascension: ["Вознесение (технологии)", "Ascension (technology)"],
    economy: ["Экономическая гегемония (40% ВВП)", "Economic hegemony (40% of GDP)"],
    crisis: ["Выживание в кризисе", "Crisis survival"],
    score: ["Счёт на финальном такте", "Score on the final tick"],
  };
  const pair = m[k];
  return pair ? L(pair[0], pair[1]) : k;
}

function MegaForm({ game }: { game: FullPanelProps["game"] }) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const fg = fgOf(world);
  const adv = advOf(world, emp?.id ?? 0);
  const [type, setType] = useState<string>(MEGA_LIST[0]?.id ?? MEGA_ORDER[0]);
  const [systemId, setSystemId] = useState<string>("");
  const systems = world ? world.systems.filter((s) => s.ownerId === emp?.id) : [];
  const chosen = systems.find((s) => s.id === rnd(Number(systemId))) ?? systems[0] ?? null;
  const def = MEGA_LIST.find((m) => m.id === type);
  const built = fg?.megastructures.filter((m) => m.type === type).length ?? 0;
  const maxPer = def?.maxPerEmpire ?? 1;
  const costOk = emp ? emp.resources.alloys >= num(def?.costAlloys) : false;
  const techOk = !def?.requiredTech || !!emp?.techs.completed.includes(def.requiredTech);
  const perkOk = !def?.requiredPerk || !!adv?.perks.includes(def.requiredPerk);
  const reason = !emp ? "нет империи" : built >= maxPer ? "лимит по типу" : !techOk ? "нужна технология" : !perkOk ? "нужен перк" : !costOk ? "не хватает сплавов" : "";
  return (
    <div className="sf-list" data-testid="mega-form">
      {MEGA_LIST.length === 0 && (
        <div className="sf-empty">{L("Контент мегаструктур ещё не загружен (@sf/data, task-12).", "Megastructure content is not loaded from @sf/data yet (task-12).")}</div>
      )}
      <Field label={L("Тип", "Type")}>
        <select className="sf-select" value={type} onChange={(e) => setType(e.target.value)} data-testid="select-mega-type">
          {(MEGA_LIST.length > 0 ? MEGA_LIST.map((m) => ({ id: m.id, ru: m.ru })) : MEGA_ORDER.map((id) => ({ id, ru: MEGA_RU[id] }))).map((m) => (
            <option key={m.id} value={m.id}>{m.ru}</option>
          ))}
        </select>
      </Field>
      <Field label={L("Система (своя)", "System (owned)")}>
        <select className="sf-select" value={chosen?.id ?? ""} onChange={(e) => setSystemId(e.target.value)} data-testid="select-mega-system">
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {systems.length === 0 && <option value="">нет своих систем</option>}
        </select>
      </Field>
      <div className="sf-meta">
        {L("Стоимость", "Cost")}: {intText(def?.costAlloys ?? 0)} {L("спл.", "alloys")}{def?.costMinerals ? " + " + intText(def.costMinerals) + " " + L("мин.", "min.") : ""} · {L("время", "time")} {intText(def?.buildTicks ?? 0)} {L("тактов", "ticks")} · {L("построено", "built")} {intText(built)}/{intText(maxPer)}
      </div>
      <Tip data={{
        title: def?.ru ?? MEGA_RU[type as keyof typeof MEGA_RU] ?? type,
        value: intText(def?.costAlloys ?? 0) + " сплавов",
        lines: [
          { label: L("Система", "System"), value: chosen?.name ?? "—" },
          { label: L("Время", "Time"), value: intText(def?.buildTicks ?? 0) + " " + L("тактов", "ticks") },
          ...Object.entries(def?.effects ?? {}).map(([k, v]) => ({ label: k, value: String(v) })),
        ],
        note: def?.descRu,
        consequence: reason || "Можно строить.",
      }}>
        <Btn variant="primary" disabled={!!reason || !chosen} onClick={() => chosen && send(game, { type: "megastructure_build", megastructure: type as import("@sf/sim").MegastructureType, systemId: chosen.id })} testId="btn-build-mega">
          {tr("megastructure.build", undefined, "Строить")}
        </Btn>
      </Tip>
    </div>
  );
}
