import { useState } from "react";
import { Btn, Check, Field, Panel, Sep } from "./controls";
import { applyColorblind, dlcOf, getA11yFlags, getColorblind, L, send, setLocale, tr, useLocale, type ColorblindMode, type FullPanelProps } from "./fg";
import { worldOf } from "./util";
import { intText } from "./util";

/** Настройки/локализация/доступность: язык, дальтонизм, масштаб UI, эффекты, субтитры. */
export function SettingsPanelFull({ game, state }: FullPanelProps) {
  const locale = useLocale();
  const s = state.settings;
  const [cb, setCb] = useState<ColorblindMode>(getColorblind());
  const [a11y, setA11y] = useState(getA11yFlags());
  const [scale, setScale] = useState<number>(s.uiScale);
  const [battleMode, setBattleModeState] = useState<string>(() => { try { return localStorage.getItem("sf.battleMode") ?? "ask"; } catch { return "ask"; } });
  const dlcState = dlcOf(worldOf(game));
  const [dlcOn, setDlcOn] = useState<boolean>(dlcState?.enabled ?? true);
  const changeDlc = (enabled: boolean) => {
    setDlcOn(enabled);
    try { localStorage.setItem("sf.dlc", enabled ? "1" : "0"); } catch { /* noop */ }
    send(game, { type: "dlc_toggle", enabled } as never);
  };

  const changeScale = (v: number) => {
    setScale(v as 1 | 1.25 | 1.5 | 2);
    game.setSettings({ uiScale: v as 1 | 1.25 | 1.5 | 2 });
  };
  const changeCb = (mode: ColorblindMode) => {
    setCb(mode);
    applyColorblind(mode);
  };
  const changeA11y = (patch: Partial<typeof a11y>) => {
    const next = { ...a11y, ...patch };
    setA11y(next);
    try { localStorage.setItem("sf.a11y", JSON.stringify(next)); } catch { /* noop */ }
    if (typeof document !== "undefined") {
      document.documentElement.dataset.reduceFlashes = next.reduceFlashes ? "1" : "0";
      document.documentElement.dataset.highContrast = next.highContrast ? "1" : "0";
    }
  };

  return (
    <div className="sf-fg-panel" data-testid="settings-panel">
      <div className="sf-fg-grid">
        <Panel title={tr("settings.interface", undefined, "Интерфейс")} tall>
          <Field label={tr("settings.language", undefined, "Язык")}>
            <select className="sf-select" value={locale} onChange={(e) => setLocale(e.target.value === "en" ? "en" : "ru")} data-testid="select-locale">
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </Field>
          <div className="sf-meta">{L("Словари переводов (русский и английский). Тексты панелей переключаются сразу.", "Translation dictionaries (Russian and English). Panel texts switch immediately.")}</div>
          <Sep />
          <Field label={L("Масштаб интерфейса", "UI scale")}>
            <select className="sf-select" value={scale} onChange={(e) => changeScale(Number(e.target.value))} data-testid="select-ui-scale">
              <option value={1}>100%</option>
              <option value={1.25}>125%</option>
              <option value={1.5}>150%</option>
              <option value={2}>200%</option>
            </select>
          </Field>
          <Field label={L("Внутреннее разрешение", "Internal resolution")}>
            <select className="sf-select" value={s.internalWidth} data-testid="select-resolution" onChange={(e) => {
              const w = Number(e.target.value);
              game.setSettings({ internalWidth: w, internalHeight: Math.round((w * 9) / 16) });
            }}>
              <option value={480}>480×270</option>
              <option value={640}>640×360</option>
              <option value={960}>960×540</option>
              <option value={1280}>1280×720</option>
              <option value={1920}>1920×1080</option>
            </select>
          </Field>
          <div className="sf-meta">{L("Внутреннее разрешение растягивается на весь экран; FHD — 1920×1080.", "Internal resolution fills the screen; FHD is 1920×1080.")}</div>
          <Field label={L("Бои на карте", "Map battles")}>
            <select className="sf-select" value={battleMode} data-testid="select-battle-mode" onChange={(e) => { const v = e.target.value; setBattleModeState(v); try { localStorage.setItem("sf.battleMode", v); } catch { /* noop */ } }}>
              <option value="ask">{L("Спрашивать перед боем", "Ask before battle")}</option>
              <option value="auto">{L("Авторезолв по умолчанию", "Auto-resolve by default")}</option>
            </select>
          </Field>
          <Btn size="sm" onClick={() => { const el = document.documentElement; if (document.fullscreenElement) void document.exitFullscreen?.(); else void el.requestFullscreen?.(); }} testId="btn-fullscreen">{L("На весь экран", "Fullscreen")}</Btn>
        </Panel>

        <Panel title={tr("settings.accessibility", undefined, "Доступность")} tall>
          <Field label={L("Режим дальтонизма", "Colorblind mode")}>
            <select className="sf-select" value={cb} onChange={(e) => changeCb(e.target.value as ColorblindMode)} data-testid="select-colorblind">
              <option value="none">{L("Обычный", "Default")}</option>
              <option value="deuteranopia">{L("Дейтеранопия", "Deuteranopia")}</option>
              <option value="protanopia">{L("Протанопия", "Protanopia")}</option>
              <option value="tritanopia">{L("Тританопия", "Tritanopia")}</option>
            </select>
          </Field>
          <div className="sf-legend" style={{ gap: 8 }}>
            <span><i style={{ background: "#6BE675" }} />друг</span>
            <span><i style={{ background: "#FF5A5A" }} />враг</span>
            <span><i style={{ background: "#F08A24" }} />тревога</span>
            <span className="sf-meta">формы дублируют цвет</span>
          </div>
          <Sep />
          <Check label="Высокий контраст" checked={a11y.highContrast} onChange={(v) => changeA11y({ highContrast: v })} testId="chk-high-contrast" />
          <Check label="Уменьшить вспышки" checked={a11y.reduceFlashes} onChange={(v) => changeA11y({ reduceFlashes: v })} testId="chk-reduce-flashes" />
          <Check label={tr("settings.subtitles", undefined, "Субтитры радиопереговоров")} checked={a11y.subtitles} onChange={(v) => changeA11y({ subtitles: v })} testId="chk-subtitles" />
          <div className="sf-meta">Субтитры включены по умолчанию; вспышки снижаются без потери информации (WCAG 2.3.1).</div>
        </Panel>

        <Panel title={L("DLC «Первый Свет»", "The First Light DLC")} tall testId="dlc-settings">
          <Check label={L("Квесты и диалоги DLC включены", "DLC quests and dialogues enabled")} checked={dlcOn} onChange={changeDlc} testId="toggle-dlc-quests" />
          <div className="sf-meta" data-testid="dlc-disabled-note">
            {dlcOn
              ? L("Сюжетная линия, журнал S16, дерево квестов и каналы выдачи активны.", "The story line, S16 journal, quest tree and offer channels are active.")
              : L("DLC выключен: диалоги, журнал и каналы не открываются. Можно включить позже.", "DLC is disabled: dialogues, journal and channels stay closed. You can enable it later.")}
          </div>
        </Panel>

        <Panel title={tr("settings.graphics", undefined, "Графика")} tall>
          <Check label="Палитра (≤32 цветов)" checked={s.palette} onChange={(v) => game.setSettings({ palette: v })} testId="chk-palette" />
          <Check label="Контуры по глубине" checked={s.outlines} onChange={(v) => game.setSettings({ outlines: v })} testId="chk-outlines" />
          <Check label={L("Свечение", "Bloom")} checked={s.bloom} onChange={(v) => game.setSettings({ bloom: v })} testId="chk-bloom" />
          <Check label={L("ЭЛТ-фильтр", "CRT filter")} checked={s.crt} onChange={(v) => game.setSettings({ crt: v })} testId="chk-crt" />
          <Field label={"Дизеринг: " + intText(s.dither) + "%"}>
            <input type="range" min={0} max={100} step={5} value={s.dither} style={{ width: "100%", accentColor: "#F5C542" }}
              onChange={(e) => game.setSettings({ dither: Number(e.target.value) })} data-testid="range-dither" />
          </Field>
          <div className="sf-meta">Эффекты применяются без перезапуска; при просадке FPS отключаются автоматически.</div>
        </Panel>
      </div>
      <div className="sf-meta" style={{ marginTop: 6 }}>
        {L("Настройки интерфейса и доступности сохраняются локально в браузере.", "Interface and accessibility settings are saved locally in the browser.")}
        {L("Данные", "Data")}: {intText(state.tick)} {tr("hud.tick", undefined, "такт")} · {L("зерно", "seed")} {intText(state.seed)}.
      </div>
    </div>
  );
}