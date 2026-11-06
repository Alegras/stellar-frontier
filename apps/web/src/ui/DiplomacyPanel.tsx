import { useMemo, useState } from "react";
import type { EspionageOp, TreatyKind } from "@sf/sim";
import { attitudeFor } from "@sf/sim";
import { Badge, Bar, Btn, KV, Panel, Sep, Tip } from "./controls";
import { L, advOf, fgOf, relOf, send, tr, useLocale, type FullPanelProps, effectLabel } from "./fg";
import {
  ATTITUDE_RU, CB_RU, ESPIONAGE_LIST, ESPIONAGE_OP_RU, ESPIONAGE_ORDER, RESOLUTION_LIST,
  TREATY_OFFERABLE, TREATY_ORDER, TREATY_RU, empireColor, empireName, oddsText, opinionTone,
  resolutionRu, signedNum, systemName, treatyActive,
} from "./fg";
import { intText, num, playerEmpire, safe, worldOf } from "./util";
import { espionageChance } from "@sf/sim";

type Tab = "empires" | "war" | "council" | "espionage";

const CB_ORDER = ["conquest", "liberation", "humiliation", "vassalization", "defensive"] as const;

export function DiplomacyPanel({ game }: FullPanelProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const fg = fgOf(world);
  const adv = advOf(world, emp?.id ?? 0);
  useLocale();
  const [tab, setTab] = useState<Tab>("empires");
  const [selId, setSelId] = useState<number | null>(null);
  const [cb, setCb] = useState<string>("conquest");

  const others = useMemo(
    () => (world ? world.empires.filter((e) => !e.isPlayer && !e.dead) : []),
    [world, emp?.id],
  );
  const target = others.find((e) => e.id === selId) ?? others[0] ?? null;
  const rel = world && emp && target ? relOf(world, emp.id, target.id) : null;

  if (!world || !emp || !fg || !adv) {
    return (
      <Panel title={tr("diplomacy.title", undefined, "Дипломатия")} testId="diplomacy-panel">
        <div className="sf-empty">Мир ещё не создан.</div>
      </Panel>
    );
  }

  const myWars = fg.wars.filter((w) => w.attackerId === emp.id || w.defenderId === emp.id
    || Object.keys(w.sides).map(Number).includes(emp.id));
  const incoming = fg.offers.filter((o) => o.toEmpireId === emp.id);
  const outgoing = fg.offers.filter((o) => o.fromEmpireId === emp.id);
  const myFederation = fg.federations.find((f) => f.members.includes(emp.id)) ?? null;
  const targetWar = target ? myWars.find((w) => w.attackerId === target.id || w.defenderId === target.id) ?? null : null;

  return (
    <div className="sf-fg-panel" data-testid="diplomacy-panel">
      <div className="sf-fg-tabs" role="tablist">
        {([
          ["empires", tr("diplomacy.empires", undefined, "Империи")],
          ["war", tr("war.title", undefined, "Война") + " (" + myWars.length + ")"],
          ["council", tr("council.title", undefined, tr("council.title", undefined, "Совет"))],
          ["espionage", tr("espionage.title", undefined, "Шпионаж")],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={"sf-tab" + (tab === id ? " sf-tab--on" : "")}
            onClick={() => setTab(id)}
            data-testid={"btn-diplo-" + id}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "empires" && (
        <div className="sf-fg-grid sf-fg-grid--dip">
          <Panel title={tr("diplomacy.empires", undefined, "Империи") + " · " + others.length} tall>
            <div className="sf-list">
              {others.length === 0 && <div className="sf-empty">Других империй нет.</div>}
              {others.map((e) => {
                const r = relOf(world, emp.id, e.id);
                const mood = r?.opinion ?? 0;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={"sf-line sf-line--pick" + (target?.id === e.id ? " sf-line--sel" : "")}
                    onClick={() => setSelId(e.id)}
                    data-testid={"empire-row-" + e.id}
                  >
                    <span className="sf-dot" style={{ background: e.color }} />
                    <span className="sf-nowrap">{e.name}</span>
                    <span className="sf-spacer" />
                    <span className={"sf-meta " + opinionTone(mood)}>{signedNum(mood)}</span>
                    <span className="sf-meta">{r ? tr("diplomacy.attitude." + r.attitude, undefined, ATTITUDE_RU[r.attitude] ?? r.attitude) : "—"}</span>
                  </button>
                );
              })}
            </div>
            <Sep />
            <div className="sf-h">{L("Входящие предложения", "Incoming offers")} ({incoming.length})</div>
            {incoming.length === 0 && <div className="sf-meta">{L("Нет предложений.", "No offers.")}</div>}
            {incoming.map((o) => (
              <div key={o.id} className="sf-line">
                <span className="sf-nowrap">{empireName(world, o.fromEmpireId)}</span>
                <span className="sf-meta">предлагает «{TREATY_RU[o.treaty]}»</span>
                <span className="sf-spacer" />
                <Btn size="sm" variant="primary" onClick={() => send(game, { type: "treaty_respond", offerId: o.id, accept: true })} testId={"btn-offer-accept-" + o.id}>{tr("diplomacy.accept", undefined, "Принять")}</Btn>
                <Btn size="sm" onClick={() => send(game, { type: "treaty_respond", offerId: o.id, accept: false })} testId={"btn-offer-decline-" + o.id}>{tr("diplomacy.decline", undefined, "Отклонить")}</Btn>
              </div>
            ))}
            <div className="sf-meta">{L("Отправлено нами", "Sent by us")}: {outgoing.length}</div>
          </Panel>

          <Panel title={target ? L("Отношения", "Relations") + " · " + target.name : L("Отношения", "Relations")} tall
            right={target && <Badge tone={targetWar ? "bad" : "info"}>{targetWar ? L("война", "war") : L("мир", "peace")}</Badge>}>
            {!target ? (
              <div className="sf-empty">Выберите империю слева.</div>
            ) : (
              <>
                <div className="sf-row">
                  <span className="sf-dot" style={{ background: target.color }} />
                  <b>{target.name}</b>
                  <span className="sf-spacer" />
                  <Badge tone={(rel?.opinion ?? 0) >= 0 ? "good" : "bad"}>
                    {tr("diplomacy.attitude." + (rel?.attitude ?? attitudeFor(0)), undefined, ATTITUDE_RU[rel?.attitude ?? attitudeFor(0)])}
                  </Badge>
                </div>
                <Tip data={{
                  title: "Мнение · формула",
                  value: signedNum(rel?.opinion ?? 0),
                  lines: (rel?.breakdown?.length ? rel.breakdown : [{ label: "База", value: rel?.opinion ?? 0 }])
                    .map((b) => ({ label: b.label, value: signedNum(b.value) })),
                  note: "Аддитивная сумма модификаторов, зажим −100…+100 (GDD §12).",
                }}>
                  <div className="sf-hud-gauge" style={{ width: "100%" }}>
                    <span className="sf-meta" style={{ width: 46 }}>{tr("diplomacy.opinion", undefined, "мнение")}</span>
                    <Bar v01={((rel?.opinion ?? 0) + 100) / 200} tone={(rel?.opinion ?? 0) >= 0 ? "sf-bar--ok" : "sf-bar--bad"} />
                    <span style={{ width: 46, textAlign: "right", fontSize: ".85em" }}>{signedNum(rel?.opinion ?? 0)}</span>
                  </div>
                </Tip>
                <div className="sf-meta">{L("Границы", "Borders")}: {intText(rel?.borderSystems ?? 0)} {L("систем", "systems")} · {L("недавние действия", "recent actions")}: {intText(rel?.recentActions ?? 0)}</div>
                <Sep />
                <div className="sf-h">{tr("diplomacy.treaties", undefined, "Договоры") + " (8)"}</div>
                <div className="sf-list">
                  {TREATY_ORDER.map((kind) => {
                    const st = rel?.treaties?.[kind];
                    const active = !!st?.active;
                    const offerable = TREATY_OFFERABLE.includes(kind as TreatyKind);
                    return (
                      <div key={kind} className="sf-line">
                        <span className={active ? "sf-ok" : "sf-meta"}>{active ? "✓" : "○"}</span>
                        <span className="sf-nowrap">{tr("diplomacy.treaty." + kind, undefined, TREATY_RU[kind])}</span>
                        <span className="sf-spacer" />
                        <span className="sf-meta">
                          {active ? "с такта " + intText(st?.sinceTick ?? 0) + (st?.expiresTick ? ", до " + intText(st.expiresTick) : "") : L("не заключён", "not signed")}
                        </span>
                        {offerable && !active && !targetWar && (
                          <Btn size="sm" onClick={() => send(game, { type: "treaty_offer", targetEmpireId: target.id, treaty: kind as "nap" | "trade" | "research" | "defensive" | "alliance" | "federation" })} testId={"btn-treaty-" + kind}>
                            {tr("diplomacy.offer", undefined, "Предложить")}
                          </Btn>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Sep />
                <div className="sf-h">{tr("war.title", undefined, "Война")}</div>
                {!targetWar ? (
                  <div className="sf-row" style={{ flexWrap: "wrap", gap: 4 }}>
                    <select className="sf-select" value={cb} onChange={(e) => setCb(e.target.value)} aria-label="Casus belli" data-testid="select-cb">
                      {CB_ORDER.map((k) => <option key={k} value={k}>{tr("war.cb." + k, undefined, CB_RU[k])}</option>)}
                    </select>
                    <Btn
                      variant="danger"
                      onClick={() => send(game, { type: "declare_war", targetEmpireId: target.id, cb: cb as "conquest" | "liberation" | "humiliation" | "vassalization" | "defensive" })}
                      testId="btn-declare-war"
                    >
                      {tr("war.declare", undefined, "Объявить войну")}
                    </Btn>
                    <Btn onClick={() => send(game, { type: "claim_system", systemId: game.getState().selectedSystemId ?? 0 })} disabled={game.getState().selectedSystemId == null} testId="btn-claim-system">
                      {tr("diplomacy.claim", undefined, "Притязание на систему")}
                    </Btn>
                  </div>
                ) : (
                  <TargetWarBlock game={game} war={targetWar} playerId={emp.id} targetId={target.id} />
                )}
                <Sep />
                <div className="sf-h">{L("Федерации", "Federations")}</div>
                {myFederation ? (
                  <div className="sf-line">
                    <span className="sf-info">◆</span>
                    <span className="sf-nowrap">{myFederation.nameRu}</span>
                    <span className="sf-spacer" />
                    <span className="sf-meta">{myFederation.members.map((m) => empireName(world, m)).join(", ")}</span>
                    <Btn size="sm" onClick={() => send(game, { type: "federation_leave" })} testId="btn-federation-leave">Выйти</Btn>
                  </div>
                ) : (
                  <div className="sf-row" style={{ gap: 4 }}>
                    <Btn size="sm" onClick={() => send(game, { type: "federation_invite", targetEmpireId: target.id })} testId="btn-federation-invite">{L("Пригласить в федерацию", "Invite to federation")}</Btn>
                    <Btn size="sm" onClick={() => send(game, { type: "federation_accept", leaderEmpireId: target.id })} testId="btn-federation-accept">{L("Вступить", "Join")}</Btn>
                  </div>
                )}
                {fg.federations.length > 0 && (
                  <div className="sf-meta">
                    {L("В галактике федераций", "Federations in the galaxy")}: {fg.federations.length} · {L("участников", "members")}: {fg.federations.reduce((a, f) => a + f.members.length, 0)}
                  </div>
                )}
                <div className="sf-meta">{L("Артефакты", "Artifacts")}: {intText(adv.artifacts)} · {L("вассалы", "vassals")}: {intText(adv.vassals.length)}</div>
              </>
            )}
          </Panel>
        </div>
      )}

      {tab === "war" && (
        <Panel title={"Войны империи · " + myWars.length} testId="war-panel" tall>
          {myWars.length === 0 && (
            <div className="sf-empty">
              Активных войн нет.
              <div className="sf-meta">{L("Войну можно объявить на вкладке «Империи» (CB влияет на мнение и военный счёт).", "Declare war from the Empires tab (casus belli affects opinion and war score).")}</div>
            </div>
          )}
          {myWars.map((w) => {
            const enemyId = w.attackerId === emp.id ? w.defenderId : w.attackerId;
            const score = w.score[emp.id] ?? 0;
            const exhaust = w.exhaustion[emp.id] ?? 0;
            const mySide = w.sides[emp.id];
            const pending = w.pendingPeace;
            return (
              <div key={w.id} className="sf-fg-war" data-testid={"war-row-" + w.id}>
                <div className="sf-row">
                  <b>{empireName(world, w.attackerId)}</b>
                  <span className="sf-dim">⚔</span>
                  <b>{empireName(world, w.defenderId)}</b>
                  <span className="sf-spacer" />
                  <Badge tone="warn">{tr("war.cb." + w.cb, undefined, CB_RU[w.cb] ?? w.cb)}</Badge>
                  <span className="sf-meta">с такта {intText(w.startedTick)}</span>
                </div>
                <div className="sf-hud-gauge">
                  <span className="sf-meta" style={{ width: 120 }}>{tr("war.score", undefined, "военный счёт")}</span>
                  <Bar v01={(score + 100) / 200} tone={score >= 0 ? "sf-bar--ok" : "sf-bar--bad"} />
                  <span style={{ width: 48, textAlign: "right" }}>{signedNum(score)}</span>
                </div>
                <div className="sf-hud-gauge">
                  <span className="sf-meta" style={{ width: 120 }}>{tr("war.exhaustion", undefined, "истощение")}</span>
                  <Bar v01={num(exhaust) / 100} tone="sf-bar--warn" />
                  <span style={{ width: 48, textAlign: "right" }}>{intText(exhaust)}%</span>
                </div>
                <div className="sf-meta">
                  {L("Потери FP", "FP lost")}: {intText(mySide?.fpLost ?? 0)} · {L("оккупировано систем", "systems occupied")}: {intText((mySide?.occupiedSystems ?? []).length)}
                  {" · притязания: "}{(adv.claims ?? []).length}
                </div>
                <div className="sf-row" style={{ gap: 4, marginTop: 4 }}>
                  <Btn size="sm" variant="primary" onClick={() => send(game, { type: "make_peace", targetEmpireId: enemyId })} testId={"btn-peace-" + w.id}>{tr("war.peace", undefined, "Предложить мир")}</Btn>
                  {pending && (
                    <span className="sf-meta">
                      Ожидает конференция: {pending.byEmpireId === emp.id ? L("наши требования", "our demands") : L("требования противника", "enemy demands")}
                      {pending.demands.length > 0 ? " · " + pending.demands.map((d) => systemName(world, d)).join(", ") : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      {tab === "council" && (
        <div className="sf-fg-grid">
          <Panel title="Галактический совет" tall>
            <div className="sf-kv"><span className="sf-dim">Следующая сессия</span><b>такт {intText(fg.council.nextSessionTick)}</b></div>
            <div className="sf-kv"><span className="sf-dim">Прошлая сессия</span><b>такт {intText(fg.lastCouncilTick)}</b></div>
            <Sep />
            <div className="sf-h">Веса голосов</div>
            <div className="sf-grid2">
              {Object.entries(fg.council.weights).length === 0 && <span className="sf-meta">веса ещё не рассчитаны</span>}
              {Object.entries(fg.council.weights).map(([eid, w]) => (
                <KV key={eid} k={empireName(world, Number(eid))} v={intText(w)} />
              ))}
            </div>
            <Sep />
            <div className="sf-h">Резолюции</div>
            {fg.council.resolutions.length === 0 && <div className="sf-meta">{L("Принятых резолюций нет.", "No adopted resolutions.")}</div>}
            {fg.council.resolutions.map((r) => (
              <div key={r.id} className="sf-fg-reso" data-testid={"reso-" + r.id}>
                <div className="sf-row">
                  <b>{resolutionRu(r.type)}</b>
                  <span className="sf-spacer" />
                  <Badge tone={r.vetoed ? "bad" : "good"}>{r.vetoed ? "вето" : "принята"}</Badge>
                </div>
                <div className="sf-meta">
                  Цель: {r.targetEmpireId ? empireName(world, r.targetEmpireId) : "галактика"} · за {intText(r.votesFor)} / против {intText(r.votesAgainst)}
                  {" · такт " + intText(r.passedTick)} · {intText(r.durationTicks)} тактов
                </div>
                <div className="sf-meta">{r.effects.map((e) => effectLabel(e.target) + " " + signedNum(e.value)).join(" · ")}</div>
              </div>
            ))}
            {fg.council.pending && (
              <div className="sf-fg-reso sf-fg-reso--pending">
                <b>На голосовании: {resolutionRu(fg.council.pending.type)}</b>
                <div className="sf-meta">за {intText(fg.council.pending.votesFor)} / против {intText(fg.council.pending.votesAgainst)} · вето: {fg.council.pending.vetoed ? "да" : "нет"}</div>
                <div className="sf-row" style={{ gap: 4 }}>
                  <Btn size="sm" variant="primary" onClick={() => send(game, { type: "council_vote", resolutionId: fg.council.pending!.id, vote: true })} testId="btn-vote-for">За</Btn>
                  <Btn size="sm" variant="danger" onClick={() => send(game, { type: "council_vote", resolutionId: fg.council.pending!.id, vote: false })} testId="btn-vote-against">Против</Btn>
                </div>
              </div>
            )}
            <div className="sf-meta">Санкции: {Object.entries(fg.council.sanctions).length === 0 ? L("нет", "none") : Object.entries(fg.council.sanctions).map(([e, v]) => empireName(world, Number(e)) + " " + intText(v)).join(", ")}</div>
          </Panel>
          <Panel title={L("Предложить резолюцию", "Propose a resolution")} tall>
            {RESOLUTION_LIST.length === 0 && (
              <div className="sf-empty">
                {L("Контент резолюций ещё не загружен (@sf/data, task-12).", "Resolution content is not loaded from @sf/data yet (task-12).")}
                <div className="sf-meta">{L("Форма появится автоматически; пока доступны только голосования по уже вынесенным резолюциям.", "The form appears automatically; for now only votes on existing resolutions are available.")}</div>
              </div>
            )}
            <div className="sf-list">
              {RESOLUTION_LIST.map((r) => (
                <div key={r.id} className="sf-line">
                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <b className="sf-nowrap">{r.ru}</b>
                    <div className="sf-meta">{r.descRu}</div>
                  </div>
                  <span className="sf-meta">{intText(r.influenceCost)} вл.</span>
                  <Btn size="sm" onClick={() => send(game, { type: "council_propose", resolutionType: r.type, targetEmpireId: target?.id })} testId={"btn-propose-" + r.id}>Внести</Btn>
                </div>
              ))}
            </div>
            <Sep />
            <div className="sf-meta">{L("Влияние", "Influence")}: {intText(emp.resources.influence)} · {L("вето-кулдаун", "veto cooldown")}: {Object.entries(fg.council.vetoCooldown).length} {L("империй", "empires")}</div>
          </Panel>
        </div>
      )}

      {tab === "espionage" && (
        <Panel title="Шпионаж · 6 операций" testId="espionage-panel" tall>
          <div className="sf-row" style={{ flexWrap: "wrap", gap: 4 }}>
            <span className="sf-meta">Цель:</span>
            <select className="sf-select" value={target?.id ?? ""} onChange={(e) => setSelId(Number(e.target.value))} aria-label="Цель операции" data-testid="select-esp-target">
              {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <span className="sf-meta">разведка: уровень {intText(target ? adv.intel[target.id] ?? 0 : 0)} · влияние: {intText(emp.resources.influence)}</span>
          </div>
          <Sep />
          <div className="sf-list">
            {(ESPIONAGE_LIST.length > 0 ? ESPIONAGE_LIST.map((d) => d.id as EspionageOp) : ESPIONAGE_ORDER).map((op) => {
              const def = ESPIONAGE_LIST.find((d) => d.id === op);
              const cd = adv.espionageCooldown[op] ?? 0;
              const left = Math.max(0, cd - world.tick);
              const chance = target ? safe(() => espionageChance(world, emp.id, target.id, op), 0) : 0;
              const chanceText = def ? oddsText(def.baseChance) : chance > 0 ? oddsText(chance) : "—";
              const reason = !target ? "выберите цель" : left > 0 ? "кулдаун " + left + " такт." : emp.resources.influence < (def?.influenceCost ?? 0) ? "не хватает влияния" : "";
              return (
                <div key={op} className="sf-line" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <b className="sf-nowrap">{def?.ru ?? ESPIONAGE_OP_RU[op]}</b>
                    <div className="sf-meta">{def?.descRu ?? "Операция шпионажа: влияние и риск раскрытия."}</div>
                    <div className="sf-meta">
                      шанс {chanceText} · цена {intText(def?.influenceCost ?? 0)} вл.
                      {def?.requiresTech ? " · требует " + def.requiresTech : ""}
                      {left > 0 ? " · кулдаун " + left + " такт." : ""}
                    </div>
                  </div>
                  <Tip data={{
                    title: def?.ru ?? ESPIONAGE_OP_RU[op],
                    value: "шанс " + chanceText,
                    lines: [
                      { label: "Стоимость", value: intText(def?.influenceCost ?? 0) + " влияния" },
                      ...(def?.effects ?? []).map((e) => ({ label: e.target, value: String(e.value) })),
                      { label: "Разведка цели", value: "уровень " + intText(target ? adv.intel[target.id] ?? 0 : 0) },
                    ],
                    note: def?.descRu,
                    consequence: reason || "Можно провести операцию.",
                  }}>
                    <Btn
                      size="sm"
                      variant={!reason ? "primary" : "default"}
                      disabled={!!reason || !target}
                      onClick={() => target && send(game, { type: "espionage", targetEmpireId: target.id, op })}
                      testId={"btn-espionage-" + op}
                    >
                      Провести
                    </Btn>
                  </Tip>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      <div className="sf-meta" style={{ marginTop: 4 }}>{tr("settings.language", undefined, "Язык интерфейса переключается в настройках.")}</div>
    </div>
  );
}

function TargetWarBlock({ game, war, playerId, targetId }: {
  game: FullPanelProps["game"];
  war: import("@sf/sim").War;
  playerId: number;
  targetId: number;
}) {
  const score = war.score[playerId] ?? 0;
  return (
    <div className="sf-fg-war">
      <div className="sf-warn">{L("Идёт война с", "At war with")} {targetId}. {tr("war.score", undefined, "Военный счёт")}: {signedNum(score)}</div>
      <div className="sf-row" style={{ gap: 4 }}>
        <Btn size="sm" variant="primary" onClick={() => send(game, { type: "make_peace", targetEmpireId: targetId })}>{tr("war.peace", undefined, "Предложить мир")}</Btn>
        <Btn size="sm" onClick={() => send(game, { type: "declare_war", targetEmpireId: targetId, cb: "defensive" })}>Продолжить войну</Btn>
      </div>
    </div>
  );
}
