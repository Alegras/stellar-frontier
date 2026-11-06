import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { game } from "./game/instance";
import { useGameState } from "./game/useGame";
import { SceneHost } from "./render/SceneHost";
import "./styles/ui.css";
import { Btn, Modal } from "./ui/controls";
import { FullGameOverlays, MPStatusHud, PanelHost, PanelMenuList, type PanelId } from "./ui/fullgame-panels";
import type { CoopCallbacks, CoopLobbyState } from "./ui/CoopPanel";
import { ColonyPanel } from "./ui/ColonyPanel";
import { EmpireDrawer, type EmpireTab } from "./ui/EmpireDrawer";
import { FlightHUD } from "./ui/FlightHUD";
import { MainMenu } from "./ui/MainMenu";
import { MapLabels, Minimap } from "./ui/MapLabels";
import { Notices } from "./ui/Notices";
import { Overlays } from "./ui/Overlays";
import { PoliticalMap } from "./ui/PoliticalMap";
import { StationScreen } from "./ui/StationScreen";
import { SystemInspector } from "./ui/SystemInspector";
import { TopBar } from "./ui/TopBar";
import { Tutorial } from "./ui/Tutorial";
import { findColonyByPlanet, worldOf } from "./ui/util";
import { refreshContentLocale, registerWorldProvider, useLocale } from "./ui/fg";
import { createNetClient, type MpState } from "./net/NetClient";
import { LobbyScreen } from "./net/LobbyScreen";

/**
 * Корневой компонент: режимы menu → MainMenu; иначе 3D-сцена + слой UI.
 * Клавиатура: Space — пауза, 1/2/3/5 — скорость, Esc — оверлей/выход,
 * M — карта, Tab — следующая система, F1 — помощь, F5/F9 — сейв/лоад.
 */
// Провайдер мира для i18n: транслитерация процедурных имён при EN.
registerWorldProvider(() => (game.hasWorld ? game.world : null));

export function App() {
  const state = useGameState(game);
  const locale = useLocale();

  // Мир/сохранение могли появиться после инициализации локали — переименовать сущности.
  useEffect(() => {
    refreshContentLocale();
  }, [state.started, state.mode, locale]);
  const [empireTab, setEmpireTab] = useState<EmpireTab | null>(null);
  const [fullPanel, setFullPanel] = useState<PanelId | null>(null);
  const [panelMenu, setPanelMenu] = useState(false);
  // карта может попросить открыть панель (клик по столице/легенде мировой политики)
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const id = (ev as CustomEvent).detail as PanelId | undefined;
      if (id === "politics") { setPanelMenu(false); setFullPanel("politics"); }
    };
    window.addEventListener("sf:open-panel", onOpen);
    return () => window.removeEventListener("sf:open-panel", onOpen);
  }, []);
  const [mp, setMp] = useState<MpState | null>(null);
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const netRef = useRef<ReturnType<typeof createNetClient> | null>(null);

  // Сетевой клиент живёт всё время жизни App; сервер-авторитет (M11).
  useEffect(() => {
    const net = createNetClient({
      onFullState: (json) => game.applyRemoteWorld(json),
      onSnapshot: (snap) => game.applyRemoteSnapshot(snap),
      onState: (next) => { setMp(next); game.setMpState(next); },
    });
    netRef.current = net;
    game.setNet(net);
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("lobby") === "1") setLobbyOpen(true);
    } catch { /* нет window (SSR/тест) */ }
    return () => {
      game.setNet(null);
      net.leave();
      netRef.current = null;
    };
  }, []);

  // Вошли в сетевую партию — прячем лобби, играем (кнопка «Сеть» остаётся).
  useEffect(() => {
    if (mp?.phase === "active") setLobbyOpen(false);
  }, [mp?.phase]);

  const handlePick = useCallback((systemId: number) => {
    const st = game.getState();
    if (st.selectedFleetId != null) {
      const fleet = game.getPlayerFleets().find((f) => f.id === st.selectedFleetId);
      if (fleet && fleet.systemId !== systemId) {
        game.sendCommand({ type: "move_fleet", fleetId: fleet.id, systemId });
      }
    }
    game.selectSystem(systemId);
  }, []);

  const handleEnter = useCallback((systemId: number) => {
    game.selectSystem(systemId);
    game.enterSystem(systemId);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inField = !!el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");

      if (e.key === "Escape") {
        if (fullPanel) { setFullPanel(null); e.preventDefault(); return; }
        if (panelMenu) { setPanelMenu(false); e.preventDefault(); return; }
        if (state.overlay !== "none") { game.setOverlay("none"); e.preventDefault(); return; }
        if (empireTab) { setEmpireTab(null); e.preventDefault(); return; }
        if (state.mode === "station") {
          if (state.activeSystemId == null) game.exitToGalaxy();
          else game.undock();
          e.preventDefault();
          return;
        }
        if (state.mode === "system") { game.exitToGalaxy(); e.preventDefault(); return; }
        if (state.mode === "galaxy") { game.setOverlay("pause"); e.preventDefault(); return; }
        return;
      }
      if (inField) return;
      if (state.overlay !== "none" || empireTab || fullPanel || panelMenu) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          game.togglePause();
          break;
        case "0":
          game.setSpeed(0);
          break;
        case "1":
          game.setSpeed(1);
          break;
        case "2":
          game.setSpeed(2);
          break;
        case "3":
          game.setSpeed(3);
          break;
        case "5":
          game.setSpeed(5);
          break;
        case "m":
        case "M":
          if (state.mode !== "galaxy") game.exitToGalaxy();
          break;
        case "Tab": {
          // В полёте Tab перехватывает SystemView (навигация по системам), здесь — только карта.
          if (state.mode !== "galaxy") break;
          // Tab по умолчанию — навигация фокуса (a11y). Следующая система — только когда фокус на корне.
          const ae = document.activeElement;
          if (ae && ae !== document.body) break;
          e.preventDefault();
          const world = worldOf(game);
          if (!world) break;
          const systems = world.systems;
          if (systems.length === 0) break;
          const idx = systems.findIndex((s) => s.id === state.selectedSystemId);
          const next = systems[(idx + 1 + systems.length) % systems.length];
          if (next) game.focusSystem(next.id);
          break;
        }
        case "F1":
          e.preventDefault();
          game.setOverlay("help");
          break;
        case "F5":
          e.preventDefault();
          void game.saveGame();
          break;
        case "F9":
          e.preventDefault();
          void game.loadGame();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.mode, state.overlay, state.selectedSystemId, empireTab, fullPanel, panelMenu]);

  // M11: мост CoopPanel (src/ui) ↔ NetClient (src/net). UI зовёт колбэки, реализация — в net-слое.
  const coopCallbacks = useMemo<CoopCallbacks>(() => ({
    create: (mode) => { void netRef.current?.createRoom(mode, "Адмирал"); },
    join: (code) => { void netRef.current?.joinRoom(code, "Адмирал"); },
    leave: () => { netRef.current?.leave(); },
    setReady: (ready) => { netRef.current?.ready(ready); },
    start: () => { netRef.current?.start(); },
  }), []);

  const coopLobby = useMemo<CoopLobbyState | null>(() => {
    if (!mp || !mp.code) return null;
    return {
      code: mp.code,
      hostId: mp.hostSeat,
      players: mp.players.map((p) => ({ id: p.seat, name: p.nick, ready: p.ready, isHost: p.seat === mp.hostSeat })),
      mode: mp.modeId === "mmo" ? "mmo" : "coop",
      connected: mp.phase !== "offline" && mp.phase !== "error",
    };
  }, [mp]);

  const netUi = (
    <>
      <button
        className="sf-btn"
        data-testid="btn-open-lobby"
        title="Сетевая игра: кооп 2–4 / MMO"
        onClick={() => setLobbyOpen(true)}
        style={{ position: "fixed", right: 10, bottom: 10, zIndex: 60 }}
      >
        Сеть{mp && mp.phase !== "offline" ? " · " + mp.phase : ""}
      </button>
      {lobbyOpen && netRef.current && <LobbyScreen net={netRef.current} game={game} onClose={() => setLobbyOpen(false)} />}
      {state.mode !== "menu" && mp && mp.phase !== "offline" && <MPStatusHud game={game} state={state} />}
    </>
  );

  if (state.mode === "menu") {
    return (
      <>
        {netUi}
        <MainMenu game={game} onOpenLobby={() => setLobbyOpen(true)} />
      </>
    );
  }

  const world = worldOf(game);
  const selectedColony = world ? findColonyByPlanet(world, state.selectedPlanetId) : null;
  const showColonyInline = !!selectedColony && selectedColony.empireId === world?.playerEmpireId;

  return (
    <div className="sf-root">
      <SceneHost game={game} state={state} />
      <div className="sf-ui" key={locale}>
        <TopBar
          game={game}
          state={state}
          onMenu={() => game.setOverlay("pause")}
          onHelp={() => game.setOverlay("help")}
          onSave={() => void game.saveGame()}
          onLoad={() => void game.loadGame()}
          onSettings={() => game.setOverlay("settings")}
        />

        {state.mode === "galaxy" && (
          <>
            <MapLabels game={game} state={state} onPick={handlePick} onEnter={handleEnter} />
            <div className="sf-col-left sf-scroll">
              <SystemInspector game={game} state={state} />
              {showColonyInline && <ColonyPanel game={game} state={state} />}
            </div>
            <div className="sf-empire-rail" data-testid="empire-rail">
              <Btn size="sm" onClick={() => setEmpireTab("colonies")} title="Колонии империи" testId="btn-open-colonies">Колонии</Btn>
              <Btn size="sm" onClick={() => setEmpireTab("research")} title="Наука и технологии" testId="btn-open-research">Наука</Btn>
              <Btn size="sm" onClick={() => setEmpireTab("fleet")} title="Флоты и приказы" testId="btn-open-fleet">Флот</Btn>
              <Btn size="sm" onClick={() => setEmpireTab("traditions")} title="Традиции и перки" testId="btn-open-traditions">Традиции</Btn>
              <Btn size="sm" onClick={() => setEmpireTab("diplomacy")} title="Дипломатия, войны, совет" testId="btn-open-diplomacy">Дипломатия</Btn>
              <Btn size="sm" onClick={() => setEmpireTab("campaign")} title="Кампания и события" testId="btn-open-campaign">Кампания</Btn>
              <Btn size="sm" onClick={() => setPanelMenu(true)} title="Рынок, контракты, кризисы, победа, кооп" testId="btn-open-more">Ещё…</Btn>
            </div>
            <Minimap game={game} state={state} />
            <PoliticalMap game={game} state={state} />
            <Tutorial game={game} state={state} />
          </>
        )}

        {state.mode === "system" && <FlightHUD game={game} state={state} />}
        {state.mode === "station" && <StationScreen game={game} state={state} />}

        {empireTab && (
          <EmpireDrawer
            game={game}
            state={state}
            tab={empireTab}
            onTab={setEmpireTab}
            onClose={() => setEmpireTab(null)}
          />
        )}

        <Notices game={game} state={state} />
        <FullGameOverlays game={game} state={state} />
        <PanelHost panel={fullPanel} game={game} state={state} onClose={() => setFullPanel(null)} coopCallbacks={coopCallbacks} coopLobby={coopLobby} />
        {panelMenu && (
          <Modal
            title="Панели полной игры"
            small
            onClose={() => setPanelMenu(false)}
            testId="full-panel-menu"
            overlayTestId="overlays-root"
            closeTestId="btn-close-panel-menu"
          >
            <PanelMenuList
              current={fullPanel}
              onPick={(id) => { setPanelMenu(false); setFullPanel(id); }}
            />
          </Modal>
        )}
        <Overlays game={game} state={state} />
        {netUi}
      </div>
    </div>
  );
}