import { useState } from "react";
import { RACES, RACE_BY_ID, RACE_TRAITS } from "@sf/data";
import type { Game } from "../game/Game";
import { Btn, Check, Field, Modal, Panel } from "./controls";
import { HelpContent } from "./HelpContent";
import { L, applyRaceChoice, raceTagLabel, tr } from "./fg";

const PLAYABLE_RACES = RACES.filter((r) => r.playable !== false);

/** Страховка для старых сборок: если Game не применил raceId — применяем вручную. */
function applyRaceIfNeeded(game: Game, raceId: string): void {
  if (!raceId) return;
  const applied = (() => {
    try {
      return (game as unknown as { world?: { fg?: { ancients?: { playerRace?: string } } } }).world?.fg?.ancients?.playerRace === raceId;
    } catch { return false; }
  })();
  if (!applied) applyRaceChoice(game, raceId);
}

export function MainMenu({ game, onOpenLobby }: { game: Game; onOpenLobby?: () => void }) {
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [demo, setDemo] = useState(true);
  const [raceId, setRaceId] = useState<string>(PLAYABLE_RACES[0]?.id ?? "");
  const [dlcOn, setDlcOn] = useState<boolean>(() => {
    try { return localStorage.getItem("sf.dlc") !== "0"; } catch { return true; }
  });
  const applyDlcFlag = () => {
    try { localStorage.setItem("sf.dlc", dlcOn ? "1" : "0"); } catch { /* noop */ }
    if (!game.hasWorld) return;
    game.sendCommand({ type: "dlc_toggle", enabled: dlcOn } as unknown as never);
  };
  const race = RACE_BY_ID[raceId] ?? null;

  const newGame = () => {
    const raw = seed.trim();
    const parsed = raw === "" ? null : Number.parseInt(raw, 10);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      game.toast(L("Seed должен быть целым неотрицательным числом", "Seed must be a non-negative integer"), "warn");
      return;
    }
    setBusy(true);
    // raceId согласуется с sim (Game.newGame(seed?, modeId?, raceId?)); fallback — applyRaceChoice.
    (game as unknown as { newGame: (seed?: number, modeId?: string, raceId?: string) => void })
      .newGame(parsed ?? undefined, "campaign", raceId || undefined);
    applyRaceIfNeeded(game, raceId);
    applyDlcFlag();
    setBusy(false);
  };

  const startMode = (modeId: string) => {
    const raw = seed.trim();
    const parsed = raw === "" ? null : Number.parseInt(raw, 10);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      game.toast(L("Seed должен быть целым неотрицательным числом", "Seed must be a non-negative integer"), "warn");
      return;
    }
    setBusy(true);
    (game as unknown as { newGame: (seed?: number, modeId?: string, raceId?: string) => void })
      .newGame(parsed ?? undefined, modeId, raceId || undefined);
    applyRaceIfNeeded(game, raceId);
    setBusy(false);
  };

  const load = async () => {
    setBusy(true);
    const ok = await game.loadGame();
    setBusy(false);
    if (!ok) game.toast(L("Сохранение не найдено. Начните новую кампанию.", "No save found. Start a new campaign."), "info");
  };

  return (
    <div className="sf-menu" data-testid="main-menu" tabIndex={0} role="region" aria-label={L("Главное меню", "Main menu")}>
      <div className="sf-menu-inner">
        <div className="sf-menu-main">
          <h1 className="sf-menu-logo">STELLAR FRONTIER</h1>
          <div className="sf-menu-tag">{L("4X-стратегия × космосимулятор", "4X strategy × space sim")}</div>

          <div className="sf-menu-actions">
            <Btn variant="primary" onClick={newGame} disabled={busy} testId="btn-new-game">▶ {tr("menu.newGame", undefined, "Новая кампания")}</Btn>
            <Btn onClick={() => void load()} disabled={busy} testId="btn-continue">{tr("menu.continue", undefined, "Продолжить")}</Btn>
            <Btn onClick={() => setHelp(true)} testId="btn-help">{tr("menu.help", undefined, "Управление")}</Btn>
          </div>

          <Panel title={tr("menu.modes", undefined, "Режимы игры")} className="sf-menu-card" testId="mode-select">
            <div className="sf-mode-grid">
              <Btn size="sm" variant="primary" onClick={() => startMode("campaign")} disabled={busy} testId="btn-mode-campaign">{tr("menu.campaign", undefined, "Кампания")}</Btn>
              <Btn size="sm" onClick={() => startMode("sandbox")} disabled={busy} testId="btn-mode-sandbox" title={L("Песочница: полная свобода, все победы выключены", "Sandbox: full freedom, all victories disabled")}>{tr("menu.sandbox", undefined, "Песочница")}</Btn>
              <Btn size="sm" onClick={() => startMode("trial")} disabled={busy} testId="btn-mode-trial" title={L("Испытание: малая галактика, победа по счёту", "Trial: small galaxy, score victory")}>{tr("menu.trial", undefined, "Испытание")}</Btn>
              <Btn size="sm" onClick={() => onOpenLobby?.()} disabled={busy} testId="btn-mode-coop" title={L("Кооператив 2–4 (общая империя)", "Co-op 2–4 (shared empire)")}>{tr("menu.coop", undefined, "Кооп 2–4")}</Btn>
              <Btn size="sm" onClick={() => onOpenLobby?.()} disabled={busy} testId="btn-mode-mmo" title={L("Персистентный мир: сезон, 30–100 игроков", "Persistent world: season, 30–100 players")}>{tr("menu.mmo", undefined, "MMO-сезон")}</Btn>
            </div>
            <p className="sf-meta">{L("Единые правила и контент: режимы — конфигурации одной игры. Кооп/MMO запускаются через лобби (сервер).", "One ruleset and content: modes are mode.json configurations. Co-op/MMO launch through the lobby (server).")}</p>
          </Panel>

          <Panel title={L("Раса империи", "Empire race")} className="sf-menu-card" testId="select-race"
            right={<span className="sf-meta">{PLAYABLE_RACES.length} {L("расы", "races")}</span>}>
            {PLAYABLE_RACES.length === 0 && (
              <div className="sf-empty">
                {L("Контент рас ещё не загружен в @sf/data.", "Race content is not loaded from @sf/data yet.")}
                <div className="sf-meta">{L("Выбор расы появится автоматически после задачи контента.", "Race selection appears after the content task.")}</div>
              </div>
            )}
            <div className="sf-race-grid">
              {PLAYABLE_RACES.map((r) => {
                const selected = r.id === raceId;
                const traits = r.traits.map((t) => RACE_TRAITS.find((x) => x.id === t)).filter(Boolean);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={"sf-race-card" + (selected ? " sf-race-card--on" : "")}
                    onClick={() => setRaceId(r.id)}
                    data-testid={"race-card-" + r.id}
                    aria-pressed={selected}
                    title={r.descRu}
                  >
                    <span className="sf-race-card__portrait" aria-hidden="true">{r.ru.slice(0, 1)}</span>
                    <span className="sf-race-card__body">
                      <b className="sf-nowrap">{r.ru}</b>
                      <span className="sf-meta sf-nowrap">{raceTagLabel(r.tag)} · {r.homeworldRu}</span>
                      <span className="sf-race-card__traits">
                        {traits.slice(0, 3).map((t) => (
                          <span key={t!.id} className={"sf-tag " + (t!.positive ? "sf-ok" : "sf-bad")}>{t!.ru}</span>
                        ))}
                      </span>
                    </span>
                    {selected && <span className="sf-race-card__check" aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>
            {race && (
              <div className="sf-race-details" data-testid="race-details" tabIndex={0}>
                <div className="sf-row"><b>{race.ru}</b><span className="sf-spacer" /><span className="sf-meta">{race.homeworldRu}</span></div>
                <div className="sf-meta">{race.descRu}</div>
                <div className="sf-h" style={{ marginTop: 4 }}>{L("Сигнатура", "Signature")}: {race.signatureRu}</div>
                <div className="sf-meta">{race.signatureDescRu}</div>
                <div className="sf-h" style={{ marginTop: 4 }}>{L("Трейты", "Traits")}</div>
                <div className="sf-list" data-testid="race-traits">
                  {race.traits.map((tid) => {
                    const t = RACE_TRAITS.find((x) => x.id === tid);
                    if (!t) return null;
                    return (
                      <div key={tid} className="sf-line">
                        <span className={t.positive ? "sf-ok" : "sf-bad"}>{t.positive ? "+" : "−"}</span>
                        <span className="sf-nowrap">{t.ru}</span>
                        <span className="sf-meta">{t.descRu}</span>
                        <span className="sf-spacer" />
                        <span className="sf-meta">{L("цена", "cost")} {t.cost}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="sf-meta" style={{ marginTop: 4 }}>
                  {L("Старт", "Start")}: {race.start.relics ? L("реликвии", "relics") + " " + race.start.relics + " · " : ""}
                  {race.start.cores ? L("ядра", "cores") + " " + race.start.cores + " · " : ""}
                  {race.start.minerals ? L("минералы", "minerals") + " " + race.start.minerals + " · " : ""}
                  {race.start.credits ? L("кредиты", "credits") + " " + race.start.credits + " · " : ""}
                  {race.start.alloys ? L("сплавы", "alloys") + " " + race.start.alloys : ""}
                </div>
                <div className="sf-meta">{L("Приветствие", "Greeting")}: «{race.greetingRu}»</div>
              </div>
            )}
          </Panel>

          <Panel title={L("Параметры кампании", "Campaign settings")} className="sf-menu-card">
            <Field
              label={L("Зерно галактики (пусто — случайное)", "Galaxy seed (empty — random)")}
              hint={L("Одно и то же зерно даёт идентичную галактику: воспроизводимость.", "The same seed gives an identical galaxy: reproducibility.")}
            >
              <input
                className="sf-input"
                data-testid="input-seed"
                inputMode="numeric"
                placeholder={L("например, 1234567", "e.g. 1234567")}
                value={seed}
                onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                onKeyDown={(e) => { if (e.key === "Enter") newGame(); }}
              />
            </Field>
            <Check label={L("DLC «Первый Свет»: квесты, диалоги, журнал, дерево", "The First Light DLC: quests, dialogues, journal, tree")}
              checked={dlcOn} onChange={setDlcOn} testId="toggle-dlc-newgame" />
            <div className="sf-row">
              <span className="sf-meta">{L("Пробел — пауза · 1/2/3/5 — скорость · F1 — помощь", "Space — pause · 1/2/3/5 — speed · F1 — help")}</span>
            </div>
          </Panel>
        </div>

        <div className="sf-menu-side">
          <Panel title={L("3 шага демо", "3 demo steps")} right={<Btn size="sm" variant="ghost" onClick={() => setDemo((v) => !v)}>{demo ? L("свернуть", "collapse") : L("развернуть", "expand")}</Btn>}>
            {demo && (
              <>
                <ol className="sf-steps">
                  <li><b>{L("Выделите систему", "Select a system")}</b> — {L("клик по метке на карте. Слева откроется инспектор.", "click a map label. The inspector opens on the left.")}</li>
                  <li><b>{L("Войдите в неё", "Enter it")}</b> — {L("двойной клик по метке или кнопка «Войти в систему».", "double-click the label or use the Enter system button.")}</li>
                  <li><b>{L("Состыкуйтесь", "Dock")}</b> — {L("в полёте подойдите к станции и нажмите «Отстыковка»/«Стыковка».", "in flight approach the station and press Dock/Undock.")}</li>
                </ol>
                <div className="sf-sep" />
                <p className="sf-meta">
                  {L("Кампания стартует с выделенной столицей: карта и панель системы видны сразу.", "The campaign starts with the capital selected: map and system panel are visible immediately.")}
                </p>
              </>
            )}
          </Panel>
          <Panel title={L("Что нового", "What is new")}>
            <p className="sf-meta">{L("Такт = 1 сутки. Полёт идёт в реальном времени, стратегическое время замирает.", "One tick = one day. Flight runs in real time, strategic time freezes.")}</p>
            <p className="sf-meta">{L("Метки карты кластеризуются («×N») при плотности; приоритеты P1–P5.", "Map labels cluster (×N) at high density; priorities P1–P5.")}</p>
          </Panel>
        </div>
      </div>

      {help && (
        <Modal title={tr("menu.help", undefined, "Управление")} wide onClose={() => setHelp(false)} testId="help-modal">
          <HelpContent />
          <div className="sf-modal-foot" style={{ marginTop: 8 }}>
            <Btn variant="primary" onClick={() => setHelp(false)}>{L("Понятно", "Got it")}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}