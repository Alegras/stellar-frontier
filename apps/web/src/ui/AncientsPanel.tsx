import { useMemo, useState } from "react";
import {
  ANCIENTS_CODEX, ANCIENTS_ENDINGS, ANCIENTS_QUESTS, ANCIENTS_TECHS, RACE_TRAITS,
  SECTOR_FACTIONS, SECTOR_HAZARDS, SECTOR_POIS, SECTOR_REGIONS,
} from "@sf/data";
import type { AncientsEndingDef, AncientsQuestDef, AncientsTechDef, CodexEntryDef, RaceDef, RaceTraitDef } from "@sf/data";
import { Badge, Bar, Btn, Field, KV, Panel, Sep, Tip } from "./controls";
import { L, ancientsOf, raceDefOf, sectorOf, send, sendFirst, tr, type FullPanelProps } from "./fg";
import { intText, playerEmpire, rnd, worldOf } from "./util";

type Tab = "line" | "legacy" | "codex" | "sector" | "final";

interface WarpTelemetry {
  active: boolean;
  phase: "idle" | "selecting" | "spooling" | "jumping" | "arrived" | "blocked";
  charges: number;
  cores: number;
  cooldownTicks: number;
  spoolProgress: number;
  spoolSecondsLeft: number;
  targetSystemId: number | null;
  targetName: string;
  targetDistLy: number;
  riskPct: number;
  accuracyAu: number;
  blockedReason: string;
  inSector: boolean;
  sectorHazard: number;
  sectorStability: number;
  chorusWaveIn: number;
}
interface GameWarpApi {
  warpTelemetry?: WarpTelemetry;
  warpStatus?: () => WarpTelemetry;
  warpTargets?: () => { id: number; name: string; distLy: number; sector: boolean }[];
  selectWarpTarget?: (id: number | null) => void;
  requestWarp?: () => boolean | void;
  cancelWarp?: () => void;
}

const TIER_NAMES = ["A0", "A1", "A2", "A3", "A4", "A5"];

export function AncientsPanel({ game, state }: FullPanelProps) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const a = ancientsOf(world);
  const [tab, setTab] = useState<Tab>("line");
  const [codexFilter, setCodexFilter] = useState<string>("all");
  const [sectorSel, setSectorSel] = useState<number | null>(null);
  const [warpTarget, setWarpTarget] = useState<string>("");
  const [warpMsg, setWarpMsg] = useState<string>("");
  const race = a ? raceDefOf(a.playerRace) : null;
  const sector = useMemo(() => sectorOf(world), [world, state.tick]);

  if (!world || !emp || !a) {
    return <Panel title={L("Древние", "The Ancients")} testId="ancients-panel"><div className="sf-empty">{L("Нет мира.", "No world.")}</div></Panel>;
  }

  const warpApi = game as unknown as GameWarpApi;
  const tel = warpApi.warpStatus?.() ?? warpApi.warpTelemetry ?? null;
  const targets = warpApi.warpTargets?.() ?? [];
  const quests: AncientsQuestDef[] = ANCIENTS_QUESTS.length > 0
    ? ANCIENTS_QUESTS
    : Object.keys(a.quest.missions).map((id, i) => ({
        id, index: i + 1, act: Math.floor(i / 2) + 1, titleRu: id, briefingRu: "",
        objectives: [], rewards: {}, unlocks: [],
      } as AncientsQuestDef));
  const activeQuest = a.quest.activeMissionId ? a.quest.missions[a.quest.activeMissionId] : undefined;
  const activeDef = activeQuest ? quests.find((q) => q.id === activeQuest.id) : null;
  const codexCats = useMemo(() => ["all", ...Array.from(new Set(ANCIENTS_CODEX.map((c) => c.category)))], []);
  const codex = useMemo(() => ANCIENTS_CODEX.filter((c) => codexFilter === "all" || c.category === codexFilter), [codexFilter]);
  const unlockedCodex = new Set(a.codex);

  const tabBtn = (id: Tab, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id}
      className={"sf-tab" + (tab === id ? " sf-tab--on" : "")}
      onClick={() => setTab(id)} data-testid={"btn-ancients-tab-" + id}>{label}</button>
  );

  const tryCommand = (cmd: Record<string, unknown>): boolean => send(game, cmd as never);

  return (
    <div className="sf-fg-panel sf-ancients" data-testid="ancients-panel">
      <div className="sf-ancients__head">
        <span className="sf-ancients__glyph" aria-hidden="true">◈</span>
        <div className="sf-ancients__title">
          <b>{L("Древние", "The Ancients")}</b>
          <span className="sf-meta">
            {race ? race.ru : a.playerRace} · {L("тир", "tier")} {a.tech.tier >= 0 ? TIER_NAMES[a.tech.tier] : "—"} ·
            {" "}{L("стадия линии", "line stage")} {intText(a.quest.stage)}/12
          </span>
        </div>
        <span className="sf-spacer" />
        <span className="sf-badge sf-badge--info" data-testid="ancients-relics">◈ {L("реликвии", "relics")}: {intText(a.relics)}</span>
        <span className="sf-badge sf-badge--info" data-testid="ancients-cores">◉ {L("ядра", "cores")}: {intText(a.cores)}</span>
        <span className="sf-badge" data-testid="ancients-darkmatter">✶ {L("тёмная материя", "dark matter")}: {intText(a.darkMatter)}</span>
        {sector && <span className="sf-badge sf-badge--warn">{L("стабильность", "stability")}: {intText(sector.stability)}%</span>}
        {sector && sector.chorusThreat > 0 && (
          <span className="sf-badge sf-badge--bad" data-testid="ancients-chorus">{L("Хор", "Chorus")}: {intText(sector.chorusThreat)}%</span>
        )}
      </div>

      <div className="sf-fg-tabs" role="tablist">
        {tabBtn("line", L("Линия", "Line") + " (" + a.quest.stage + "/12)")}
        {tabBtn("legacy", L("Наследие", "Legacy") + " A0–A5")}
        {tabBtn("codex", L("Кодекс", "Codex") + " (" + intText(a.codex.length) + ")")}
        {tabBtn("sector", L("Предел", "Expanse"))}
        {tabBtn("final", L("Финал", "Finale"))}
      </div>

      {tab === "line" && (
        <div className="sf-fg-grid">
          <Panel title={L("Линия «Наследие Ансаров» · 12 миссий", "Ancestral Line · 12 missions")} tall>
            {quests.length === 0 && <div className="sf-empty">{L("Контент линии не загружен.", "Line content not loaded.")}</div>}
            {quests.map((q) => {
              const st = a.quest.missions[q.id];
              const status = st?.status ?? "locked";
              const tone = status === "completed" ? "good" : status === "active" ? "info" : status === "available" ? "warn" : "bad";
              return (
                <div key={q.id} className="sf-line" data-testid={"quest-row-" + q.index}>
                  <span className="sf-meta" style={{ width: 28 }}>{q.index}.</span>
                  <Badge tone={tone}>{statusRu(status)}</Badge>
                  <span className="sf-nowrap">{q.titleRu}</span>
                  <span className="sf-spacer" />
                  <span className="sf-meta">{L("акт", "act")} {q.act}{q.unlocks.length ? " · " + q.unlocks.join(", ") : ""}</span>
                  {(status === "available" || status === "active") && (
                    <Btn size="sm" variant="ghost" onClick={() => tryCommand({ type: "ancients_accept_mission", questId: q.id }) || tryCommand({ type: "ancients_quest", questId: q.id })} testId={"btn-quest-accept-" + q.id}>
                      {status === "active" ? L("активна", "active") : L("принять", "accept")}
                    </Btn>
                  )}
                  <span className="sf-meta" data-testid="quest-gate">{q.unlocks[0] ?? "—"}</span>
                </div>
              );
            })}
            <div className="sf-meta">{L("Линия ведётся автоматически: миссия открывается после предыдущей и стартует по целям.", "The line advances automatically: missions unlock after the previous one and start by objectives.")}</div>
          </Panel>
          <Panel title={L("Активная миссия", "Active mission")} tall>
            {activeDef ? (
              <>
                <div className="sf-row"><b>{activeDef.titleRu}</b><span className="sf-spacer" /><Badge tone="info">{L("активна", "active")}</Badge></div>
                <div className="sf-fg-brief">{activeDef.briefingRu}</div>
                <Sep />
                <div className="sf-h">{L("Цели", "Objectives")}</div>
                {(activeDef.objectives ?? []).map((o) => {
                  const p = activeQuest?.progress?.[o.id] ?? 0;
                  const n = o.count ?? 1;
                  return (
                    <div key={o.id} className="sf-line">
                      <span className={p >= n ? "sf-ok" : "sf-meta"}>{p >= n ? "✓" : "•"}</span>
                      <span className="sf-nowrap">{o.type}{o.target ? " · " + o.target : ""}</span>
                      <span className="sf-spacer" />
                      <div style={{ width: 110 }}><Bar v01={n > 0 ? p / n : 0} thin /></div>
                      <span className="sf-meta" data-testid="quest-progress">{intText(p)}/{intText(n)}</span>
                    </div>
                  );
                })}
                <Sep />
                <div className="sf-h">{L("Награды", "Rewards")}</div>
                <div className="sf-meta">
                  {activeDef.rewards?.relics ? "◈ +" + activeDef.rewards.relics + " " : ""}
                  {activeDef.rewards?.cores ? "◉ +" + activeDef.rewards.cores + " " : ""}
                  {activeDef.rewards?.credits ? intText(activeDef.rewards.credits) + " " + L("кр.", "cr.") + " " : ""}
                  {activeDef.rewards?.tech ? L("технология", "tech") + ": " + activeDef.rewards.tech + " " : ""}
                  {activeDef.rewards?.codex?.length ? L("кодекс", "codex") + " +" + activeDef.rewards.codex.length : ""}
                </div>
                <div className="sf-meta">{L("Открывает", "Unlocks")}: {activeDef.unlocks.length ? activeDef.unlocks.join(", ") : "—"}</div>
                {a.quest.choice && <div className="sf-warn">{L("Финал выбран", "Finale chosen")}: {a.quest.choice}</div>}
              </>
            ) : (
              <div className="sf-meta">
                {L("Активной миссии нет. Линия начнётся на такте", "No active mission. The line starts on tick")} {intText(1200)}
                {a.quest.stage >= 11 ? " · " + L("доступен финальный выбор", "final choice is available") : ""}
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "legacy" && (
        <Panel title={L("Ветвь Наследия A0–A5", "Legacy branch A0–A5")} tall>
          <div className="sf-meta">
            {L("Открыто технологий", "Technologies unlocked")}: {intText(a.tech.unlocked.length)} · {L("макс. тир", "max tier")} {a.tech.tier >= 0 ? TIER_NAMES[a.tech.tier] : "—"} ·
            {" "}◈ {intText(a.relics)} · ◉ {intText(a.cores)}
          </div>
          <Sep />
          {ANCIENTS_TECHS.length === 0 && (
            <div className="sf-empty">
              {L("Контент технологий Наследия ещё не загружен (@sf/data).", "Legacy tech content is not loaded from @sf/data yet.")}
              <div className="sf-meta">{L("Состояние из sim всё равно показано выше.", "Simulation state is still shown above.")}</div>
            </div>
          )}
          {[0, 1, 2, 3, 4, 5].map((tier) => {
            const list = ANCIENTS_TECHS.filter((t) => t.tier === tier);
            if (list.length === 0) return null;
            return (
              <div key={tier} className="sf-ancients__tier" data-testid={"ancients-tier-" + tier}>
                <div className="sf-row"><b className="sf-gold">{TIER_NAMES[tier]}</b><span className="sf-spacer" /><span className="sf-meta">{L("миссия-гейт", "gate mission")}: {list[0]?.gateMission ?? 0}</span></div>
                {list.map((tech) => <TechRow key={tech.id} tech={tech} a={a} onResearch={() => tryCommand({ type: "ancients_tech", techId: tech.id })} />)}
              </div>
            );
          })}
        </Panel>
      )}

      {tab === "codex" && (
        <Panel title={L("Кодекс Ансаров", "Ansari Codex")} tall right={<Badge>{intText(a.codex.length)} / {intText(ANCIENTS_CODEX.length)}</Badge>}>
          <div className="sf-row" style={{ flexWrap: "wrap", gap: 3 }}>
            {codexCats.map((cat) => (
              <Btn key={cat} size="sm" active={codexFilter === cat} onClick={() => setCodexFilter(cat)} testId={"codex-filter-" + cat}>
                {cat === "all" ? L("Все", "All") : cat}
              </Btn>
            ))}
          </div>
          <Sep />
          {codex.length === 0 && <div className="sf-empty">{L("Записей кодекса нет (контент ещё не загружен).", "No codex entries (content not loaded).")}</div>}
          {codex.map((entry) => (
            <CodexRow key={entry.id} entry={entry} unlocked={unlockedCodex.has(entry.id) || entry.unlock === "start"} />
          ))}
        </Panel>
      )}

      {tab === "sector" && (
        <div className="sf-fg-grid">
          <Panel title={L("Реликтовый Предел · 45 систем", "Relic Expanse · 45 systems")} tall
            right={<Badge tone={sector?.invasion ? "bad" : "info"}>{sector?.invasion ? L("вторжение", "invasion") : L("спокойно", "calm")}</Badge>}>
            {!sector || !sector.discovered || sector.systems.length === 0 ? (
              <div className="sf-empty" data-testid="sector-locked">
                {L("Предел не открыт. Достигните миссии 10 / технологии A3 и откройте варп.", "The Expanse is not open yet. Reach mission 10 / A3 tech and unlock warp.")}
                <div className="sf-meta">{L("Сектор сгенерируется детерминированно от seed при открытии.", "The sector is generated deterministically from the seed when opened.")}</div>
                {sector && <div className="sf-meta">{L("Флаг открытия", "Open flag")}: {sector.generated ? L("есть", "yes") : L("нет", "no")}</div>}
              </div>
            ) : (
              <>
                <div className="sf-grid2">
                  <KV k={L("Стабильность", "Stability")} v={intText(sector.stability) + "%"} className={sector.stability < 35 ? "sf-bad" : "sf-ok"} />
                  <KV k={L("Угроза Хора", "Chorus threat")} v={intText(sector.chorusThreat) + "%"} className={sector.chorusThreat > 50 ? "sf-bad" : ""} />
                  <KV k={L("Волна через", "Wave in")} v={intText(Math.max(0, sector.nextWaveTick - world.tick)) + " " + L("такт.", "ticks")} />
                  <KV k={L("Посещено систем", "Systems visited")} v={intText(sector.visited.length)} />
                </div>
                <Sep />
                <div className="sf-h">{L("Системы Предела", "Expanse systems")}</div>
                {sector.systems.slice(0, 60).map((sys) => {
                  const region = SECTOR_REGIONS.find((r) => r.id === sys.region);
                  const faction = SECTOR_FACTIONS.find((f) => f.id === sys.faction);
                  const hazard = sys.hazard ? SECTOR_HAZARDS.find((h) => h.id === sys.hazard) : null;
                  return (
                    <div key={sys.id} className={"sf-line" + (sectorSel === sys.id ? " sf-line--sel" : "")} data-testid={"sector-row-" + sys.id}>
                      <span className="sf-dot" style={{ background: region?.color ?? faction?.color ?? "#3A2B5C" }} />
                      <button type="button" className="sf-btn--ghost" style={{ all: "unset", cursor: "pointer", color: "inherit" }} onClick={() => setSectorSel(sys.id)}>
                        <span className="sf-nowrap">{sys.name}</span>
                      </button>
                      <span className="sf-meta">{region?.ru ?? sys.region}</span>
                      {faction && <Badge tone={faction.hostile ? "bad" : "info"}>{faction.ru}</Badge>}
                      {hazard && <Badge tone="warn">{hazard.ru}</Badge>}
                      <span className="sf-spacer" />
                      <span className="sf-meta">◈ {intText(sys.relics)} · ◉ {intText(sys.cores)}</span>
                      {sys.controlled && <Badge tone="good">{L("контроль", "controlled")}</Badge>}
                      <Btn size="sm" onClick={() => tryCommand({ type: "sector_scan", systemId: sys.id })} testId={"btn-sector-scan-" + sys.id}>{L("Скан", "Scan")}</Btn>
                      <Btn size="sm" variant="primary" onClick={() => tryCommand({ type: "sector_claim", systemId: sys.id })} testId={"btn-sector-claim-" + sys.id}>{L("Захват", "Claim")}</Btn>
                    </div>
                  );
                })}
                <div className="sf-meta">{L("Фракции Предела", "Expanse factions")}: {Object.entries(a.factions).map(([id, f]) => {
                  const def = SECTOR_FACTIONS.find((x) => x.id === id);
                  return (def?.ru ?? id) + " " + (f.met ? intText(f.relation) : L("не встречена", "unmet"));
                }).join(" · ") || "—"}</div>
              </>
            )}
          </Panel>
          <div className="sf-designer__side">
            <Panel title={L("Варп и вход", "Warp and entry")} testId="warp-panel">
              <div className="sf-grid2">
                <KV k={L("Варп", "Warp")} v={a.warp.unlocked ? L("открыт", "unlocked") : L("закрыт", "locked")} />
                <KV k={L("Заряды", "Charges")} v={intText(a.warp.charges)} />
                <KV k={L("Ядра", "Cores")} v={intText(a.warp.cores)} />
                <KV k={L("Кулдаун", "Cooldown")} v={Math.max(0, a.warp.cooldownUntil - world.tick) + " " + L("такт.", "ticks")} />
                <KV k={L("Нестабильность", "Instability")} v={intText(a.warp.instability) + "%"} className={a.warp.instability > 40 ? "sf-bad" : ""} />
                <KV k={L("Тир", "Tier")} v={a.tech.tier >= 0 ? TIER_NAMES[a.tech.tier] : "—"} />
              </div>
              <Sep />
              <Field label={L("Цель варпа", "Warp target")}>
                <select className="sf-select" value={warpTarget} onChange={(e) => { setWarpTarget(e.target.value); warpApi.selectWarpTarget?.(e.target.value ? Number(e.target.value) : null); }} data-testid="select-warp-target" aria-label={L("Цель варпа", "Warp target")}>
                  <option value="">{L("— выберите систему —", "— choose a system —")}</option>
                  {targets.length > 0
                    ? targets.map((t) => <option key={t.id} value={t.id} data-testid={"warp-target-" + t.id}>{t.name} · {t.distLy.toFixed(1)} {L("св. лет", "ly")}{t.sector ? " · " + L("Предел", "Expanse") : ""}</option>)
                    : world.systems.filter((s) => s.knownBy.includes(emp.id)).slice(0, 60).map((s) => <option key={s.id} value={s.id} data-testid={"warp-target-" + s.id}>{s.name}</option>)}
                </select>
              </Field>
              {tel && (
                <div className="sf-meta" data-testid="warp-status">
                  {L("Фаза", "Phase")}: {tel.phase} · {L("раскрутка", "spool")} {rnd(tel.spoolProgress * 100)}%
                  {tel.spoolSecondsLeft > 0 ? " · " + tel.spoolSecondsLeft + " " + L("с", "s") : ""}
                  {tel.blockedReason ? " · " + tel.blockedReason : ""}
                </div>
              )}
              <div className="sf-row" style={{ flexWrap: "wrap", gap: 4 }}>
                <Btn variant="primary" disabled={!warpTarget}
                  onClick={() => {
                    let ok: boolean | undefined;
                    if (warpApi.requestWarp) {
                      ok = warpApi.requestWarp() === true;
                    } else if (warpTarget) {
                      ok = tryCommand({ type: "warp_jump", targetSystemId: Number(warpTarget) });
                    }
                    const st = warpApi.warpStatus?.() ?? warpApi.warpTelemetry;
                    if (ok) {
                      setWarpMsg(L("Прыжок выполнен: ", "Jump complete: ") + (st?.targetName || (warpTarget ? "#" + warpTarget : "")));
                      game.toast(L("Варп: ", "Warp: ") + (st?.targetName || warpTarget), "good");
                    } else {
                      const reason = st?.blockedReason || L("прыжок невозможен", "jump impossible");
                      setWarpMsg(L("Варп невозможен: ", "Warp impossible: ") + reason);
                      game.toast(L("Варп невозможен: ", "Warp impossible: ") + reason, "warn");
                    }
                    if (warpTarget) game.selectSystem?.(Number(warpTarget));
                  }}
                  testId="btn-warp">
                  {L("Варп-прыжок", "Warp jump")}
                </Btn>
                <Btn size="sm" onClick={() => warpApi.cancelWarp?.()} testId="btn-warp-cancel">{L("Отмена", "Cancel")}</Btn>
                <Btn size="sm" onClick={() => tryCommand({ type: "ancients_sector_enter", systemId: sectorSel ?? 0 }) || tryCommand({ type: "sector_enter", systemId: sectorSel ?? 0 })} disabled={sectorSel == null} testId="btn-sector-enter">
                  {L("Войти в Предел", "Enter Expanse")}
                </Btn>
                <Btn size="sm" onClick={() => tryCommand({ type: "sector_scan", systemId: sectorSel ?? 0 })} disabled={sectorSel == null} testId="btn-sector-scan">{L("Скан", "Scan")}</Btn>
                <Btn size="sm" onClick={() => tryCommand({ type: "sector_claim", systemId: sectorSel ?? 0 })} disabled={sectorSel == null} testId="btn-sector-claim">{L("Захват", "Claim")}</Btn>
                <Btn size="sm" variant="ghost" onClick={() => tryCommand({ type: "ancients_sector_exit" }) || tryCommand({ type: "sector_exit" })} testId="btn-sector-exit">{L("Выйти из Предела", "Exit Expanse")}</Btn>
              </div>
              <div className="sf-meta">
                {L("Варп требует заряд ядра (1 ядро = 10 зарядов), кулдаун 5 тактов, риск Хора 15%.", "Warp needs a core charge (1 core = 10 charges), 5-tick cooldown, 15% Chorus risk.")}
              </div>
              {!a.warp.unlocked && <div className="sf-warn">{L("Варп закрыт: исследуйте технологию A3.", "Warp locked: research A3 technology.")}</div>}
              {warpMsg && <div className={warpMsg.includes(L("невозможен", "impossible")) ? "sf-warn" : "sf-ok"} data-testid="warp-result" role="status">{warpMsg}</div>}
              {(tel?.blockedReason || (!a.warp.unlocked ? L("Варп не открыт", "Warp not unlocked") : a.warp.charges <= 0 ? L("Нет зарядов ядра", "No core charges") : Math.max(0, a.warp.cooldownUntil - world.tick) > 0 ? L("Кулдаун варпа", "Warp cooldown") : "")) && (
                <div className="sf-warn" data-testid="warp-reason" role="status">
                  {tel?.blockedReason || (!a.warp.unlocked ? L("Варп не открыт (миссия 9 / A3).", "Warp is locked (mission 9 / A3).")
                    : a.warp.charges <= 0 ? L("Нет зарядов ядра: добывайте ядра в Пределе или исследуйте A-технологии.", "No core charges: gather cores in the Expanse or research A-tech.")
                    : L("Варп остывает", "Warp is cooling down"))}
                  {a.warp.charges <= 0 && <Btn size="sm" variant="ghost" onClick={() => setTab("legacy")} testId="btn-warp-to-tech">{L("к технологиям A", "to A-tech")}</Btn>}
                </div>
              )}
            </Panel>
            <Panel title={L("Подрегионы", "Subregions")} tall>
              {SECTOR_REGIONS.length === 0 && <div className="sf-meta">{L("Контент подрегионов не загружен.", "Subregion content not loaded.")}</div>}
              {SECTOR_REGIONS.map((r) => (
                <div key={r.id} className="sf-line" data-testid={"sector-region-" + r.id}>
                  <span className="sf-dot" style={{ background: r.color }} />
                  <span className="sf-nowrap">{r.ru}</span>
                  <span className="sf-spacer" />
                  <span className="sf-meta">{r.systemCount} {L("систем", "systems")}{r.hazard ? " · " + r.hazard : ""}</span>
                </div>
              ))}
              <div className="sf-meta" style={{ marginTop: 4 }}>{L("Легенда: ◈ реликвии, ◉ ядра; цвета — по подрегионам.", "Legend: ◈ relics, ◉ cores; colors by subregion.")}</div>
            </Panel>
          </div>
        </div>
      )}

      {tab === "final" && (
        <Panel title={L("Финал линии: судьба Ансаров", "Finale: the fate of the Ansari")} tall testId="ancients-final">
          <div className="sf-meta">
            {L("Доступен после миссии 12.", "Available after mission 12.")} {L("Текущий выбор", "Current choice")}: {a.quest.choice ?? "—"} ·
            {" "}{L("концовка", "ending")}: {a.quest.ending ?? "—"} · {L("стадия", "stage")} {intText(a.quest.stage)}/12
          </div>
          <Sep />
          {ANCIENTS_ENDINGS.length === 0 && (
            <div className="sf-empty">
              {L("Контент концовок Наследия не загружен (@sf/data).", "Legacy ending content is not loaded from @sf/data yet.")}
              <div className="sf-meta">{L("Кнопки появятся автоматически; сейчас доступен только просмотр состояния.", "Buttons appear automatically; for now you can inspect the state.")}</div>
            </div>
          )}
          <div className="sf-fg-branches">
            {(ANCIENTS_ENDINGS.length > 0 ? ANCIENTS_ENDINGS : FALLBACK_ENDINGS).map((e) => (
              <Panel key={e.id} title={e.ru} right={a.quest.choice === e.choice ? <Badge tone="good">{L("выбрано", "chosen")}</Badge> : undefined} testId={"ending-" + e.choice}>
                <div className="sf-fg-brief">{e.descRu}</div>
                <div className="sf-meta">{L("эффекты", "effects")}: {Object.entries(e.effects ?? {}).map(([k, v]) => k + " " + v).join(" · ") || "—"}</div>
                <div className="sf-meta">{L("связь с кампанией", "campaign link")}: {e.campaignEnding}</div>
                <Btn variant="primary" disabled={a.quest.stage < 11 || a.quest.choice === e.choice}
                  onClick={() => tryCommand({ type: "ancients_final", choice: e.choice })}
                  testId={"btn-final-" + e.choice}>
                  {a.quest.choice === e.choice ? L("Выбрано", "Chosen") : L("Сделать выбор", "Choose")}
                </Btn>
              </Panel>
            ))}
          </div>
          <div className="sf-meta" data-testid="final-choice-status" style={{ marginTop: 6 }}>
            {L("Выбор фиксирует концовку и эффекты; доступен при стадии 12/12.", "The choice fixes the ending and effects; available at stage 12/12.")}
          </div>
        </Panel>
      )}
    </div>
  );
}

const FALLBACK_ENDINGS: AncientsEndingDef[] = [
  { id: "ending_seal", ru: "Запечатать Разлом", descRu: "Безопасность галактики ценой утраты наследия.", choice: "seal", campaignEnding: "ending_seal", effects: {} },
  { id: "ending_use", ru: "Использовать силу", descRu: "Взять наследие Ансаров себе.", choice: "use", campaignEnding: "ending_use", effects: {} },
  { id: "ending_give", ru: "Отдать галактике", descRu: "Поделиться наследием со всеми.", choice: "give", campaignEnding: "ending_give", effects: {} },
];

function TechRow({ tech, a, onResearch }: { tech: AncientsTechDef; a: import("@sf/sim").AncientsState; onResearch: () => void }) {
  const unlocked = a.tech.unlocked.includes(tech.id);
  const tierOk = tech.tier <= a.tech.tier + 1;
  const gateOk = tech.gateMission <= a.quest.stage;
  const reqOk = tech.requires.every((r) => a.tech.unlocked.includes(r));
  const relicsOk = a.relics >= tech.costRelics;
  const coresOk = a.cores >= tech.costCores;
  const reason = unlocked ? L("Уже открыта", "Already unlocked")
    : !tierOk ? L("Сначала откройте предыдущий тир", "Unlock the previous tier first")
    : !gateOk ? L("Нужен прогресс линии", "Line progress required")
    : !reqOk ? L("Не открыты предыдущие технологии", "Previous technologies required")
    : !relicsOk ? L("Не хватает реликвий", "Not enough relics")
    : !coresOk ? L("Не хватает ядер", "Not enough cores") : "";
  return (
    <div className={"sf-line sf-ancients__tech" + (unlocked ? " sf-line--sel" : "")} style={{ alignItems: "flex-start" }} data-testid={"tech-line-" + tech.id}>
      <span className={unlocked ? "sf-ok" : gateOk ? "sf-gold" : "sf-bad"}>{unlocked ? "✓" : gateOk ? "•" : "×"}</span>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div className="sf-row"><b className="sf-nowrap">{tech.ru}</b><span className="sf-spacer" /><span className="sf-meta">◈ {intText(tech.costRelics)} · ◉ {intText(tech.costCores)}</span></div>
        <div className="sf-meta">{tech.descRu}</div>
        <div className="sf-meta">
          {Object.entries(tech.effects ?? {}).map(([k, v]) => k + " " + (v > 0 ? "+" : "") + v).join(" · ") || "—"}
          {tech.unlocks.length ? " · " + L("открывает", "unlocks") + ": " + tech.unlocks.join(", ") : ""}
          {tech.requires.length ? " · " + L("требует", "requires") + ": " + tech.requires.join(", ") : ""}
        </div>
      </div>
      <Tip data={{
        title: tech.ru,
        value: "◈ " + intText(tech.costRelics) + " · ◉ " + intText(tech.costCores),
        lines: [
          { label: L("Тир", "Tier"), value: TIER_NAMES[tech.tier] ?? String(tech.tier) },
          { label: L("Гейт-миссия", "Gate mission"), value: String(tech.gateMission) },
          { label: L("Требует", "Requires"), value: tech.requires.join(", ") || "—" },
        ],
        consequence: reason || L("Можно исследовать.", "Can be researched."),
      }}>
        <Btn size="sm" variant={!reason ? "primary" : "default"} disabled={!!reason} onClick={onResearch} testId={"btn-ancients-tech-" + tech.id}>
          {unlocked ? L("Открыта", "Unlocked") : L("Исследовать", "Research")}
        </Btn>
      </Tip>
    </div>
  );
}

function CodexRow({ entry, unlocked }: { entry: CodexEntryDef; unlocked: boolean }) {
  return (
    <div className={"sf-line" + (unlocked ? "" : " sf-ancients__locked")} style={{ alignItems: "flex-start" }} data-testid={"codex-entry-" + entry.id}>
      <span className={unlocked ? "sf-gold" : "sf-meta"}>{unlocked ? "◆" : "?"}</span>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div className="sf-row"><b className="sf-nowrap">{unlocked ? entry.titleRu : "████████"}</b><span className="sf-spacer" /><span className="sf-meta">{entry.category}</span></div>
        {unlocked
          ? <div className="sf-meta">{entry.textRu}</div>
          : <div className="sf-meta">{L("Заблокировано", "Locked")}: {entry.unlock}</div>}
      </div>
    </div>
  );
}

function statusRu(status: string): string {
  const map: Record<string, [string, string]> = {
    locked: ["закрыта", "locked"],
    available: ["доступна", "available"],
    active: ["активна", "active"],
    completed: ["завершена", "completed"],
    failed: ["провалена", "failed"],
  };
  const p = map[status] ?? [status, status];
  return L(p[0], p[1]);
}