import type { Game } from "../game/Game";
import type { GameState } from "../game/types";

import { Btn, Check, Field, KV, Modal, Sep } from "./controls";
import { HelpContent } from "./HelpContent";
import { playerEmpire, STATION_RU, worldOf, intText, rnd } from "./util";
import { L, tr } from "./fg";

const VICTORY_RU: Record<string, string> = {
  domination: "Доминирование",
  federation: "Федерация",
  ascension: "Технологическое вознесение",
  economy: "Экономическая гегемония",
  crisis: "Выживание в кризисе",
  score: "Победа по счёту",
};

export function Overlays({ game, state }: { game: Game; state: GameState }) {
  const world = worldOf(game);
  const emp = playerEmpire(game);
  const close = () => game.setOverlay("none");

  if (state.overlay === "help") {
    return (
      <Modal
        title={L("Управление и помощь", "Controls and help")}
        wide
        onClose={close}
        testId="help-overlay"
        overlayTestId="overlays-root"
        closeTestId="btn-close-help"
      >
        <HelpContent />
        <div className="sf-modal-foot" style={{ marginTop: 8 }}>
          <Btn variant="primary" onClick={close} testId="btn-help-overlay">{L("Понятно", "Got it")}</Btn>
        </div>
      </Modal>
    );
  }

  if (state.overlay === "settings") {
    const s = state.settings;
    return (
      <Modal
        title={tr("settings.title", undefined, "Настройки")}
        onClose={close}
        testId="settings-overlay"
        overlayTestId="overlays-root"
        closeTestId="btn-close-settings"
      >
        <div className="sf-grid2">
          <Field label={L("Внутреннее разрешение", "Internal resolution")}>
            <select
              className="sf-select"
              value={s.internalWidth}
              data-testid="select-resolution"
              onChange={(e) => {
                const w = Number(e.target.value);
                const h = rnd((w * 9) / 16);
                game.setSettings({ internalWidth: w, internalHeight: h });
              }}
            >
              <option value={480}>480×270 ({L("низкое", "low")})</option>
              <option value={640}>640×360 ({L("по умолчанию", "default")})</option>
              <option value={960}>960×540 ({L("высокое", "high")})</option>
            </select>
          </Field>
          <Field label={L("Масштаб интерфейса", "UI scale")}>
            <select
              className="sf-select"
              value={s.uiScale}
              data-testid="select-uiscale"
              onChange={(e) => game.setSettings({ uiScale: Number(e.target.value) as 1 | 1.25 | 1.5 | 2 })}
            >
              <option value={1}>100%</option>
              <option value={1.25}>125%</option>
              <option value={1.5}>150%</option>
              <option value={2}>200%</option>
            </select>
          </Field>
        </div>
        <Field label={L("Дизеринг", "Dithering") + ": " + s.dither + "%"}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={s.dither}
            style={{ width: "100%", accentColor: "#F5C542" }}
            onChange={(e) => game.setSettings({ dither: Number(e.target.value) })}
            data-testid="range-dither"
          />
        </Field>
        <Sep />
        <div className="sf-grid2">
          <Check label={L("Палитра (квантование ≤32 цветов)", "Palette (quantize to ≤32 colors)")} checked={s.palette} onChange={(v) => game.setSettings({ palette: v })} testId="chk-palette" />
          <Check label={L("Контуры по глубине", "Depth outlines")} checked={s.outlines} onChange={(v) => game.setSettings({ outlines: v })} testId="chk-outlines" />
          <Check label={L("Свечение", "Bloom")} checked={s.bloom} onChange={(v) => game.setSettings({ bloom: v })} testId="chk-bloom" />
          <Check label={L("ЭЛТ-фильтр", "CRT filter")} checked={s.crt} onChange={(v) => game.setSettings({ crt: v })} testId="chk-crt" />
        </div>
        <Sep />
        <div className="sf-meta">
          {L("Все настройки применяются сразу и сохраняются локально. Пиксельный стиль: целочисленный масштаб, ближайший сосед.", "All settings apply immediately and are saved locally. Pixel style: integer scaling, nearest-neighbor.")}
        </div>
        <div className="sf-modal-foot" style={{ marginTop: 8, padding: 0, background: "none", border: "none" }}>
          <Btn
            onClick={() => game.setSettings({
              internalWidth: 640, internalHeight: 360, dither: 60, palette: true,
              outlines: true, bloom: false, crt: false, uiScale: 1,
            })}
            testId="btn-reset-settings"
          >
            {L("Сбросить", "Reset")}
          </Btn>
          <Btn variant="primary" onClick={close} testId="btn-apply-settings">{L("Готово", "Done")}</Btn>
        </div>
      </Modal>
    );
  }

  if (state.overlay === "battle" && state.battleReport) {
    const b = state.battleReport;
    const atk = world?.empires.find((e) => e.id === b.attacker.empireId);
    const def = world?.empires.find((e) => e.id === b.defender.empireId);
    const outcome = b.outcome === "attacker_win" ? L("Победа атакующего", "Attacker victory")
      : b.outcome === "defender_win" ? L("Победа защитника", "Defender victory") : L("Ничья", "Draw");
    const sys = world?.systems.find((s) => s.id === b.systemId);
    return (
      <Modal
        title={L("Отчёт о бое", "Battle report") + " · " + (sys?.name ?? L("система", "system") + " " + b.systemId)}
        onClose={() => game.setBattleReport(null)}
        testId="battle-overlay"
        overlayTestId="overlays-root"
        closeTestId="btn-close-battle"
        footer={
          <Btn variant="primary" onClick={() => game.setBattleReport(null)} testId="btn-close-battle-footer">
            {L("Закрыть отчёт", "Close report")}
          </Btn>
        }
      >
        <div className="sf-battle-outcome sf-gold">{outcome}</div>
        <div className="sf-meta" style={{ textAlign: "center", marginBottom: 6 }}>
          {tr("hud.tick", undefined, "Такт")} {intText(b.tick)} · {L("длительность", "duration")} {rnd(b.durationSec)} {L("с", "s")} · {b.tactical ? L("тактический бой", "tactical battle") : L("авторезолв", "auto-resolve")}
        </div>
        <div className="sf-battle-cols">
          <div className="sf-battle-side">
            <div className="sf-h" style={{ color: atk?.color ?? "#4FC3F7" }}>{atk?.name ?? L("Атакующий", "Attacker")}</div>
            <div className="sf-battle-fp">{intText(b.attacker.fp)} FP</div>
            <KV k={L("Кораблей до боя", "Ships before")} v={intText(b.attacker.shipsBefore)} />
            <KV k={L("Потеряно FP", "FP lost")} v={intText(b.attackerLossFp)} className="sf-bad" />
            <KV k={L("Потеряно кораблей", "Ships lost")} v={intText(b.attackerShipsLost)} className="sf-bad" />
          </div>
          <div className="sf-dim" style={{ alignSelf: "center", fontSize: "1.4em" }}>⚔</div>
          <div className="sf-battle-side sf-battle-side--right">
            <div className="sf-h" style={{ color: def?.color ?? "#FF5A5A" }}>{def?.name ?? L("Защитник", "Defender")}</div>
            <div className="sf-battle-fp">{intText(b.defender.fp)} FP</div>
            <KV k="Кораблей до боя" v={intText(b.defender.shipsBefore)} />
            <KV k="Потеряно FP" v={intText(b.defenderLossFp)} className="sf-bad" />
            <KV k="Потеряно кораблей" v={intText(b.defenderShipsLost)} className="sf-bad" />
          </div>
        </div>
        <Sep />
        <div className="sf-grid2">
          <KV k={L("Трофеи: сплавы", "Spoils: alloys")} v={intText(b.spoilsAlloys)} className="sf-gold" />
          <KV k={L("Трофеи: кредиты", "Spoils: credits")} v={intText(b.spoilsCredits)} className="sf-gold" />
        </div>
        <div className="sf-meta" style={{ marginTop: 6 }}>
          {L("Бой остановил время (авто-пауза). Проверьте флот, ремонт и приказы перед продолжением.", "The battle paused time (auto-pause). Check your fleet, repairs and orders before continuing.")}
        </div>
      </Modal>
    );
  }

  if (state.overlay === "victory") {
    const v = world?.victory;
    const winner = world?.empires.find((e) => e.id === v?.winnerEmpireId);
    return (
      <Modal
        title={L("Победа", "Victory") + " · " + (v?.achieved ? (VICTORY_RU[v.achieved] ?? v.achieved) : "—")}
        onClose={close}
        testId="victory-overlay"
        overlayTestId="overlays-root"
        closeTestId="btn-close-victory"
        footer={
          <>
            <Btn onClick={() => game.newGame()} testId="btn-new-campaign">{L("Новая кампания", "New campaign")}</Btn>
            <Btn variant="primary" onClick={close} testId="btn-continue-victory">{L("Продолжить", "Continue")}</Btn>
          </>
        }
      >
        <div className="sf-battle-outcome sf-gold" style={{ fontSize: "1.4em" }}>
          {winner?.name ?? emp?.name ?? L("Империя", "Empire")} {L("одержала победу", "achieved victory")}
        </div>
        <div className="sf-meta" style={{ textAlign: "center" }}>
          {L("Условие", "Condition")}: {v?.achieved ? (VICTORY_RU[v.achieved] ?? v.achieved) : "—"} · {tr("hud.tick", undefined, "такт")} {intText(v?.tickAchieved ?? state.tick)}
        </div>
        <Sep />
        <div className="sf-grid2">
          <KV k={tr("hud.tick", undefined, "Такт")} v={intText(state.tick)} />
          <KV k={L("Систем", "Systems")} v={intText(emp?.systems.length ?? 0)} />
          <KV k={L("Колоний", "Colonies")} v={intText(emp?.colonies.length ?? 0)} />
          <KV k={L("Изучено технологий", "Technologies researched")} v={intText(emp?.stats.techsResearched ?? 0)} />
          <KV k={L("Кораблей построено", "Ships built")} v={intText(emp?.stats.shipsBuilt ?? 0)} />
          <KV k={L("Боёв выиграно", "Battles won")} v={intText(emp?.stats.battlesWon ?? 0)} />
        </div>
      </Modal>
    );
  }

  if (state.overlay === "pause") {
    const last = state.lastSaveAt ? new Date(state.lastSaveAt).toLocaleTimeString() : L("нет", "none");
    return (
      <Modal
        title={tr("hud.pause", undefined, "Пауза") + " · " + tr("hud.tick", undefined, "такт") + " " + intText(state.tick)}
        small
        onClose={close}
        testId="pause-overlay"
        overlayTestId="overlays-root"
        closeTestId="btn-resume"
      >
        <div className="sf-list">
          <Btn variant="primary" onClick={close} testId="btn-resume">{L("Продолжить", "Continue")}</Btn>
          <Btn onClick={() => void game.saveGame()} testId="btn-pause-save">{L("Сохранить", "Save")}</Btn>
          <Btn onClick={() => void game.loadGame()} testId="btn-pause-load">{L("Загрузить", "Load")}</Btn>
          <Btn onClick={() => game.setOverlay("settings")} testId="btn-pause-settings">{tr("settings.title", undefined, "Настройки")}</Btn>
          <Btn onClick={() => game.setOverlay("help")} testId="btn-pause-help">{L("Управление", "Controls")}</Btn>
          <Btn
            variant="danger"
            onClick={async () => {
              await game.saveGame();
              window.location.reload();
            }}
            testId="btn-exit-menu"
          >
            {L("Выйти в меню", "Exit to menu")}
          </Btn>
        </div>
        <div className="sf-meta" style={{ marginTop: 8 }}>
          {L("Последнее сохранение", "Last save")}: {last} · {L("режим", "mode")}: {L("кампания", "campaign")} · {L("зерно", "seed")} {intText(state.seed)}
        </div>
        <div className="sf-meta">
          {L("Режим: кампания · сохранение — локальное (IndexedDB) · горячие клавиши: F5 / F9.", "Mode: campaign · save: local (IndexedDB) · hotkeys: F5 / F9.")}
        </div>
      </Modal>
    );
  }

  return null;
}