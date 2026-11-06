import * as sim from "@sf/sim";
import type { BattleRecord, Command, Empire, Fleet, GameEvent, Planet, StarSystem, World } from "@sf/sim";
import { BALANCE, MODE, MODE_MAP } from "@sf/data";
import { EMPTY_TELEMETRY } from "./types";
import type { AppMode, FlightTelemetry, GameApi, GameState, Notice, NoticeSeverity, OverlayId, RenderSettings } from "./types";
import { loadWorld, saveWorld } from "./storage";
import type { MpState, NetClient, NetSnapshot } from "../net/NetClient";
// Часть XIII: варп «Наследие» — контракт HUD подтверждён ui-engineer (см. docs/playtest-log).
import { emptyWarpTelemetry } from "../render/system/warp";
import type { WarpControlsDelegate, WarpTargetInfo, WarpTelemetry } from "../render/system/warp";
import { warpTargetsAround } from "../render/system/sector";

const SETTINGS_KEY = "sf.renderSettings";

const DEFAULT_SETTINGS: RenderSettings = {
  internalWidth: 640,
  internalHeight: 360,
  dither: 60,
  palette: true,
  outlines: true,
  bloom: false,
  crt: false,
  uiScale: 1,
};

function loadSettings(): RenderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<RenderSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const INITIAL_STATE: GameState = {
  version: 0,
  mode: "menu",
  speed: 1,
  paused: true,
  tick: 0,
  seed: 0,
  modeId: "campaign",
  selectedSystemId: null,
  selectedFleetId: null,
  selectedPlanetId: null,
  activeSystemId: null,
  activeStationId: null,
  overlay: "none",
  notices: [],
  battleReport: null,
  saveStatus: "idle",
  lastSaveAt: null,
  started: false,
  settings: DEFAULT_SETTINGS,
  fps: 0,
};

export class Game implements GameApi {
  /** Клиент сетевой сессии (coop/mmo). null — одиночная игра. */
  net: NetClient | null = null;
  private w: World | null = null;
  private snapshot: GameState;
  private listeners = new Set<() => void>();
  private accMs = 0;
  private nextNoticeId = 1;
  private trackedLogLength = 0;
  private trackedBattles = 0;
  private lastAutoSaveTick = -999;
  private autoSaveEnabled = true;
  /** авто-пауза от боя: после закрытия отчёта возвращаем прежнее состояние */
  private pausedByBattle = false;
  /** Победа уже показана и закрыта игроком — не переоткрывать окно каждый такт. */
  private victoryAcknowledged = false;
  private pauseBeforeBattle = false;
  /** пауза вызвана открытым меню паузы */
  private overlayPausedGame = false;
  /** пауза из-за модалки случайного события: время стоит, пока игрок не выберет */
  private pausedByEvent = false;
  /** пауза из-за активного диалога DLC/кампании: у диалога приоритет над событиями */
  private pausedByDialogue = false;
  /** было ли время на паузе до открытия модалки/диалога */
  private pauseBeforeModal = false;
  /** откуда состыковались: с карты (демо-кнопка) или из полёта */
  private stationOrigin: "galaxy" | "system" = "system";
  private savedPlayMode: AppMode = "galaxy";

  mapProject: ((x: number, y: number) => { x: number; y: number } | null) | null = null;
  flightTelemetry: FlightTelemetry = { ...EMPTY_TELEMETRY, pips: { ...EMPTY_TELEMETRY.pips }, contacts: [], warnings: [], hints: [] };
  /** Телеметрия варпа (XIII): пишет SystemView каждый кадр, читает HUD ui-engineer. */
  warpTelemetry: WarpTelemetry = emptyWarpTelemetry();
  /** Галактическая система-якорь: куда возвращает варп из Реликтового Предела. */
  warpAnchorSystemId: number | null = null;
  /** Делегат полётных действий варпа (выставляет SystemView; UI использует методы ниже). */
  warpControls: WarpControlsDelegate | null = null;
  /** Выбранная цель варпа на карте (когда в полёте нет SystemView-делегата). */
  warpSelectedTargetId: number | null = null;
  hudTick = 0;
  mapZoom = 1;
  mapFocus: { systemId: number; nonce: number } | null = null;
  private focusNonce = 0;

  constructor() {
    const settings = loadSettings();
    this.snapshot = { ...INITIAL_STATE, settings };
    document.documentElement.style.setProperty("--ui-scale", String(settings.uiScale));
  }

  // ------------------------------------------------------------------ world
  get world(): World {
    if (!this.w) throw new Error("Мир ещё не создан");
    return this.w;
  }
  get hasWorld(): boolean {
    return this.w !== null;
  }

  getState(): GameState {
    return this.snapshot;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private refresh(patch: Partial<GameState> = {}): void {
    this.snapshot = { ...this.snapshot, ...patch, version: this.snapshot.version + 1 };
    for (const l of this.listeners) l();
  }

  // --------------------------------------------------------------- lifecycle
  newGame(seed?: number, modeId: string = "campaign"): void {
    if (this.net?.isActive) {
      this.toast("В сетевой игре мир создаёт сервер", "warn");
      return;
    }
    const s = seed ?? Math.floor(Math.random() * 2_000_000_000);
    const modeConfig = MODE_MAP[modeId] ?? MODE;
    try {
      const world = sim.createWorld(s, modeConfig, BALANCE);
      // DLC XIV: синхронный запуск story-диалога Q1 (идемпотентно, sim one-shot).
      try { sim.bootstrapDlcStory(world); } catch { /* DLC может быть выключен/старая сборка */ }
      this.w = world;
      this.accMs = 0;
      this.victoryAcknowledged = false;
      this.pausedByEvent = false;
      this.pausedByDialogue = false;
      this.pauseBeforeModal = false;
      this.trackedLogLength = 0;
      this.trackedBattles = 0;
      this.lastAutoSaveTick = -999;
      const player = world.empires.find((e) => e.isPlayer);
      const capital = player?.capitalSystemId ?? world.systems[0]?.id ?? 0;
      this.snapshot = {
        ...this.snapshot,
        mode: "galaxy",
        started: true,
        seed: s,
        tick: world.tick,
        modeId: world.modeId,
        speed: 1,
        paused: false,
        selectedSystemId: capital,
        // Флот НЕ выбираем автоматически: иначе первый клик по карте отдаёт приказ флоту.
        selectedFleetId: null,
        selectedPlanetId: null,
        activeSystemId: null,
        activeStationId: null,
        overlay: "none",
        notices: [],
        battleReport: null,
        saveStatus: "idle",
        settings: this.snapshot.settings,
      };
      this.mapFocus = { systemId: capital, nonce: ++this.focusNonce };
      this.captureNewEvents();
      this.toast("Кампания начата. Выберите систему на карте.", "good");
      this.refresh();
    } catch (e) {
      this.toast("Ошибка создания мира: " + (e as Error).message, "bad");
      this.refresh();
    }
  }

  async loadGame(): Promise<boolean> {
    const data = await loadWorld("campaign");
    if (!data) return false;
    try {
      this.w = sim.deserializeWorld(data.json);
      this.snapshot = {
        ...this.snapshot,
        mode: "galaxy",
        started: true,
        seed: this.w.seed,
        modeId: this.w.modeId,
        tick: this.w.tick,
        speed: this.w.speed || 1,
        paused: true,
        selectedSystemId: this.w.empires.find((e) => e.isPlayer)?.capitalSystemId ?? null,
        selectedFleetId: null,
        selectedPlanetId: null,
        activeSystemId: null,
        activeStationId: null,
        overlay: "none",
        notices: [],
        battleReport: null,
        saveStatus: "loaded",
        lastSaveAt: data.meta.savedAt,
      };
      this.accMs = 0;
      this.trackedLogLength = this.w.log.length;
      this.trackedBattles = this.w.battles.length;
      const capital = this.snapshot.selectedSystemId;
      if (capital != null) this.mapFocus = { systemId: capital, nonce: ++this.focusNonce };
      this.toast("Сохранение загружено", "good");
      this.refresh();
      return true;
    } catch (e) {
      this.toast("Не удалось загрузить сохранение: " + (e as Error).message, "bad");
      this.refresh();
      return false;
    }
  }

  async saveGame(notify = true): Promise<boolean> {
    if (!this.w) return false;
    this.refresh({ saveStatus: "saving" });
    try {
      const json = sim.serializeWorld(this.w);
      const player = this.getPlayerEmpire();
      const ok = await saveWorld("campaign", json, {
        savedAt: Date.now(),
        tick: this.w.tick,
        seed: this.w.seed,
        empireName: player?.name ?? "",
      });
      this.refresh({ saveStatus: ok ? "saved" : "error", lastSaveAt: ok ? Date.now() : this.snapshot.lastSaveAt });
      if (notify) this.toast(ok ? "Игра сохранена" : "Ошибка сохранения", ok ? "good" : "bad");
      return ok;
    } catch (e) {
      this.refresh({ saveStatus: "error" });
      this.toast("Ошибка сохранения: " + (e as Error).message, "bad");
      return false;
    }
  }

  // ------------------------------------------------------------------- time
  setSpeed(speed: number): void {
    const s = Math.max(0, Math.min(5, Math.round(speed)));
    this.accMs = 0;
    if (this.w) {
      this.w.speed = s;
      this.w.paused = s === 0;
    }
    this.refresh({ speed: s, paused: s === 0 });
  }

  togglePause(): void {
    const paused = !this.snapshot.paused;
    if (this.w) this.w.paused = paused;
    this.refresh({ paused, speed: paused ? Math.max(1, this.snapshot.speed) : this.snapshot.speed });
  }

  /** Вызывается из requestAnimationFrame слоя рендера. */
  advance(dtMs: number): void {
    if (!this.w) return;
    const st = this.snapshot;
    if (st.mode !== "galaxy" || st.paused || st.speed === 0 || st.overlay === "victory") {
      this.accMs = 0;
      return;
    }
    const interval = 1000 / st.speed;
    this.accMs += Math.min(dtMs, 250);
    let guard = 0;
    while (this.accMs >= interval && guard < 12) {
      this.accMs -= interval;
      guard++;
      try {
        sim.tick(this.w);
      } catch (e) {
        this.toast("Ошибка симуляции: " + (e as Error).message, "bad");
        this.refresh({ paused: true });
        return;
      }
      this.afterTick();
      if (this.snapshot.paused) break;
    }
    if (guard > 0) this.refresh({ tick: this.w.tick });
  }

  private afterTick(): void {
    const w = this.w!;
    this.captureNewEvents();
    // автопауза на бой игрока / победу
    const newBattles = w.battles.slice(this.trackedBattles);
    if (newBattles.length > 0) {
      this.trackedBattles = w.battles.length;
      const player = this.getPlayerEmpire();
      for (const b of newBattles) {
        if (player && (b.attacker.empireId === player.id || b.defender.empireId === player.id)) {
          if (!this.pausedByBattle) {
            this.pauseBeforeBattle = this.snapshot.paused;
            this.pausedByBattle = true;
          }
          this.snapshot = { ...this.snapshot, battleReport: b, paused: true, overlay: "battle" };
          if (w) w.paused = true;
          break;
        }
      }
    }
    if (w.victory.achieved && !this.victoryAcknowledged) {
      this.snapshot = { ...this.snapshot, paused: true, overlay: "victory" };
      w.paused = true;
    }
    if (this.autoSaveEnabled && w.tick - this.lastAutoSaveTick >= 30 && !this.snapshot.paused) {
      this.lastAutoSaveTick = w.tick;
      void this.saveGame(false);
    }
  }

  private captureNewEvents(): void {
    const w = this.w!;
    if (w.log.length <= this.trackedLogLength) {
      this.trackedLogLength = w.log.length;
      return;
    }
    const fresh = w.log.slice(this.trackedLogLength);
    this.trackedLogLength = w.log.length;
    const playerId = this.getPlayerEmpire()?.id;
    let shown = 0;
    for (const ev of fresh) {
      const mine = ev.empireId === playerId || ev.empireId === undefined;
      if (!mine) continue;
      if (ev.severity !== "info" || ev.kind === "combat" || ev.kind === "colony" || ev.kind === "research") {
        if (shown >= 3) break;
        this.pushNotice(ev.messageRu, ev.severity, ev.systemId);
        shown++;
      }
    }
  }

  // -------------------------------------------------------------- selection
  selectSystem(id: number | null): void {
    this.refresh({ selectedSystemId: id, selectedPlanetId: null });
  }

  selectFleet(id: number | null): void {
    this.refresh({ selectedFleetId: id });
  }

  selectPlanet(id: number | null): void {
    this.refresh({ selectedPlanetId: id });
  }

  focusSystem(systemId: number): void {
    this.mapFocus = { systemId, nonce: ++this.focusNonce };
    this.refresh({ selectedSystemId: systemId, selectedPlanetId: null });
  }

  setMapZoom(z: number): void {
    this.mapZoom = Math.max(0.4, Math.min(8, z));
  }

  // ---------------------------------------------------------------- screens
  enterSystem(systemId?: number): void {
    if (!this.w) return;
    const id = systemId ?? this.snapshot.selectedSystemId;
    if (id == null) {
      this.toast("Сначала выберите систему на карте", "warn");
      return;
    }
    const sys = this.w.systems.find((s) => s.id === id);
    if (!sys) return;
    const player = this.getPlayerEmpire();
    const known = player ? sys.knownBy.includes(player.id) : false;
    const ownFleet = this.getFleetInSystem(id).length > 0;
    if (!known && !ownFleet) {
      this.toast("Система не разведана. Отправьте флот или исследователя.", "warn", id);
      return;
    }
    this.savedPlayMode = this.snapshot.mode;
    this.refresh({
      mode: "system",
      activeSystemId: id,
      activeStationId: null,
      paused: true,
      selectedSystemId: id,
      overlay: "none",
    });
    if (this.w) this.w.paused = true;
    this.toast("Тактическая пауза: такт остановлен, пока вы в полёте", "info", id);
  }

  exitToGalaxy(): void {
    this.releasePointerLock();
    this.resetWarpTelemetry();
    this.refresh({ mode: "galaxy", activeSystemId: null, activeStationId: null, paused: this.snapshot.paused, overlay: "none" });
    if (this.w) this.w.paused = this.snapshot.paused;
    this.accMs = 0;
  }

  dockAtStation(stationId: number): void {
    if (!this.w) return;
    this.releasePointerLock();
    // Если стыковка запущена с карты (демо-кнопка в инспекторе) — привязываем систему станции,
    // иначе 3D-сцена за экраном станции показывала бы случайную систему.
    this.stationOrigin = this.snapshot.mode === "galaxy" ? "galaxy" : "system";
    let activeSystemId = this.snapshot.activeSystemId;
    if (activeSystemId == null) {
      const sys = this.w.systems.find((s) => s.station && s.station.id === stationId);
      if (sys) activeSystemId = sys.id;
    }
    this.refresh({ mode: "station", activeSystemId, activeStationId: stationId, paused: true, overlay: "none" });
    if (this.w) this.w.paused = true;
    try {
      sim.onContractDock(this.w, this.w.playerEmpireId, stationId);
      sim.onCampaignDock(this.w, this.w.playerEmpireId, stationId);
    } catch {
      /* расширенные подсистемы могут быть не инициализированы */
    }
  }

  undock(): void {
    // Возвращаемся туда, откуда состыковались: из полёта — в полёт, с карты — на карту.
    if (this.stationOrigin === "galaxy") {
      this.exitToGalaxy();
      return;
    }
    this.refresh({ mode: "system", activeStationId: null, paused: true });
  }

  // ------------------------------------------------- ВАРП «НАСЛЕДИЕ» (Часть XIII)
  /**
   * Привязка полётного контроллера варпа. Вызывает SystemView в конструкторе и
   * отвязывает в dispose; UI пользуется методами ниже, не зная о рендере.
   */
  bindWarpControls(controls: WarpControlsDelegate | null): void {
    this.warpControls = controls;
  }

  /** Система игрока (флагман/любой флот), от которой считаются цели варпа на карте. */
  private warpFromSystemId(): number | null {
    if (!this.w) return null;
    const player = this.getPlayerEmpire();
    if (!player) return null;
    const flagship = this.w.fleets.find((fleet) => fleet.id === player.flagshipFleetId && fleet.ships.length > 0);
    const anyFleet = flagship ?? this.w.fleets.find((fleet) => fleet.empireId === player.id && fleet.ships.length > 0);
    if (anyFleet) return anyFleet.systemId;
    return player.capitalSystemId ?? this.snapshot.selectedSystemId ?? null;
  }

  /** Системы в радиусе 60 св. лет (включая вход в Предел), отсортированные по дистанции. */
  warpTargets(): WarpTargetInfo[] {
    if (this.warpControls) {
      try {
        return this.warpControls.targets();
      } catch {
        return [];
      }
    }
    if (!this.w) return [];
    const from = this.warpFromSystemId();
    if (from == null) return [];
    try {
      const sector = this.w.fg?.ancients?.sector;
      if (sector?.discovered && !sector.generated) sim.ensureSectorGenerated(this.w);
      const range = sim.warpRadiusLy(this.w);
      return warpTargetsAround(this.w, from, range);
    } catch {
      return [];
    }
  }

  /** Выбрать цель варпа (null — снять выбор). На карте работает без полётного вида. */
  selectWarpTarget(systemId: number | null): WarpTargetInfo | null {
    if (this.warpControls) {
      try {
        return this.warpControls.select(systemId);
      } catch {
        return null;
      }
    }
    this.warpSelectedTargetId = systemId;
    this.syncWarpTelemetry();
    const target = this.warpTargets().find((item) => item.id === systemId) ?? null;
    if (target) this.toast(`Варп-цель: ${target.name} · ${target.distLy.toFixed(1)} св. лет`, "info", target.id);
    return target;
  }

  /**
   * Подтвердить варп. В полёте — раскрутка 60 с и визуальный прыжок (SystemView-делегат);
   * на карте — стратегический прыжок сразу (sim проверяет радиус 60 св. лет, заряды и кулдаун).
   */
  requestWarp(): boolean {
    if (this.warpControls) {
      try {
        return this.warpControls.request();
      } catch {
        return false;
      }
    }
    if (!this.w) {
      this.toast("Мир ещё не создан", "warn");
      return false;
    }
    if (this.warpSelectedTargetId == null) {
      this.toast("Варп: сначала выберите цель на карте", "warn");
      return false;
    }
    const from = this.warpFromSystemId();
    const target = this.warpTargets().find((item) => item.id === this.warpSelectedTargetId);
    if (!target) {
      this.toast("Варп: цель вне радиуса 60 св. лет", "warn");
      this.syncWarpTelemetry();
      return false;
    }
    const ok = this.sendCommand({ type: "warp_jump", targetSystemId: target.id });
    if (ok) {
      this.warpAnchorSystemId = target.sector ? from : null;
      this.toast(`Варп: ${target.name}`, "good", target.id);
      this.mapFocus = { systemId: target.id, nonce: ++this.focusNonce };
      this.refresh({ selectedSystemId: target.id });
    }
    this.syncWarpTelemetry();
    return ok;
  }

  /** Отменить раскрутку/выбор цели. */
  cancelWarp(): void {
    if (this.warpControls) {
      try {
        this.warpControls.cancel();
        return;
      } catch {
        /* noop */
      }
    }
    this.warpSelectedTargetId = null;
    this.syncWarpTelemetry();
  }

  /** Заполняет warp-телеметрию на карте (в полёте её пишет SystemView каждый кадр). */
  private syncWarpTelemetry(): void {
    if (this.warpControls || !this.w) return;
    let status: ReturnType<typeof sim.warpStatus> | null = null;
    try {
      status = sim.warpStatus(this.w);
    } catch {
      status = null;
    }
    const sector = this.w.fg?.ancients?.sector ?? null;
    const target = this.warpSelectedTargetId != null
      ? this.warpTargets().find((item) => item.id === this.warpSelectedTargetId) ?? null
      : null;
    const t = this.warpTelemetry;
    t.active = Boolean(status?.unlocked);
    t.phase = "idle";
    t.charges = status?.charges ?? 0;
    t.cores = status?.cores ?? 0;
    t.cooldownTicks = status?.cooldownTicks ?? 0;
    t.spoolProgress = 0;
    t.spoolSecondsLeft = 0;
    t.targetSystemId = target ? target.id : null;
    t.targetName = target ? target.name : "";
    t.targetDistLy = target ? Math.round(target.distLy * 10) / 10 : 0;
    t.riskPct = status?.riskPct ?? t.riskPct;
    t.blockedReason = !status?.unlocked
      ? "варп «Наследие» не открыт (миссия 9 линии)"
      : (status?.cooldownTicks ?? 0) > 0
        ? `кулдаун ${status?.cooldownTicks} такт(ов)`
        : (status?.charges ?? 0) <= 0
          ? "нет зарядов ядра"
          : "";
    t.inSector = Boolean(sector?.active);
    t.sectorHazard = 0;
    t.sectorStability = sector ? sector.stability : 0;
    const choirWave = status?.choirWaveTick ?? 0;
    t.chorusWaveIn = choirWave > 0 ? Math.max(0, choirWave - this.w.tick) : 0;
  }

  /** Снимок варп-телеметрии для HUD/панели Древних (карта и полёт). */
  warpStatus(): WarpTelemetry {
    this.syncWarpTelemetry();
    return this.warpTelemetry;
  }

  /**
   * Ленивая генерация сектора «Реликтовый Предел» (детерминированно от seed мира).
   * Нужна UI-карте сектора и панели варпа: до первого входа системы сектора ещё не в world.systems.
   * Возвращает число систем сектора (0 — сектор не открыт/ошибка).
   */
  ensureSectorVisible(): number {
    if (!this.w) return 0;
    try {
      const sector = sim.ensureSectorGenerated(this.w);
      return sector.systems.length;
    } catch {
      return 0;
    }
  }

  /** Сброс варп-индикаторов (при выходе на карту/новой игре). */
  resetWarpTelemetry(): void {
    Object.assign(this.warpTelemetry, emptyWarpTelemetry());
    this.warpAnchorSystemId = null;
  }

  setOverlay(id: OverlayId): void {
    if (id !== "none") this.releasePointerLock();
    // Закрытие окна победы = «Продолжить»: запоминаем, что победа принята,
    // и снимаем автопаузу, иначе afterTick снова откроет окно и время замрёт.
    if (id === "none" && this.snapshot.overlay === "victory") {
      this.victoryAcknowledged = true;
      if (this.w) {
        this.w.paused = false;
        this.w.speed = this.snapshot.speed || 1;
      }
      this.refresh({ overlay: "none", paused: false });
      return;
    }
    // Меню паузы действительно останавливает время; закрытие — возвращает ход.
    if (id === "pause" && !this.snapshot.paused) {
      this.overlayPausedGame = true;
      if (this.w) this.w.paused = true;
      this.refresh({ overlay: id, paused: true });
      return;
    }
    if (id === "none" && this.overlayPausedGame) {
      this.overlayPausedGame = false;
      if (this.w) this.w.paused = false;
      this.refresh({ overlay: id, paused: false });
      return;
    }
    this.refresh({ overlay: id });
  }

  /**
   * Модалка случайного события: пока игрок не выбрал вариант, время стоит.
   * Запоминаем прежнюю паузу, чтобы не «разбудить» игру, если она была на паузе/в бою.
   */
  setNarrativeModalOpen(open: boolean): void {
    if (open === this.pausedByEvent) return;
    if (open && !this.pausedByDialogue) this.pauseBeforeModal = this.snapshot.paused;
    this.pausedByEvent = open;
    this.applyModalPause();
  }

  /**
   * Диалог DLC/кампании: пока он активен, время стоит, а модалки событий
   * не открываются (приоритет у диалога). Отдельный флаг от событий, чтобы
   * закрытие одного оверлея не «будило» игру при другом открытом.
   */
  setDialogueModalOpen(open: boolean): void {
    if (open === this.pausedByDialogue) return;
    if (open && !this.pausedByEvent) this.pauseBeforeModal = this.snapshot.paused;
    this.pausedByDialogue = open;
    this.applyModalPause();
  }

  private applyModalPause(): void {
    if (this.pausedByEvent || this.pausedByDialogue) {
      if (this.w) this.w.paused = true;
      this.refresh({ paused: true });
      return;
    }
    const keepPaused = this.pauseBeforeModal || this.snapshot.overlay !== "none"
      || this.snapshot.mode !== "galaxy" || this.snapshot.speed === 0;
    if (this.w) this.w.paused = keepPaused;
    this.refresh({ paused: keepPaused });
  }

  // --------------------------------------------------------------- сеть (M11)
  /** Подключить/отключить сетевой клиент; в coop/mmo команды уходят на сервер. */
  setNet(net: NetClient | null): void {
    this.net = net;
  }

  /** MP-статус в общем GameState (единый HUD: фаза/комната/игроки/пауза/лок). */
  setMpState(mp: MpState | null): void {
    this.refresh({ mp: mp ?? undefined });
  }

  /** full_state от сервера: заменяем локальный мир авторитетным снимком. */
  applyRemoteWorld(json: string): void {
    try {
      const world = sim.deserializeWorld(json);
      this.w = world;
      this.accMs = 0;
      this.victoryAcknowledged = false;
      this.trackedLogLength = world.log.length;
      this.trackedBattles = world.battles.length;
      this.lastAutoSaveTick = -999;
      const player = world.empires.find((e) => e.isPlayer);
      const capital = player?.capitalSystemId ?? world.systems[0]?.id ?? 0;
      this.snapshot = {
        ...this.snapshot,
        mode: "galaxy",
        started: true,
        seed: world.seed,
        tick: world.tick,
        modeId: world.modeId,
        speed: world.speed || 1,
        paused: world.paused,
        selectedSystemId: capital,
        selectedFleetId: null,
        selectedPlanetId: null,
        activeSystemId: null,
        activeStationId: null,
        overlay: "none",
        notices: [],
        battleReport: null,
        saveStatus: "idle",
        settings: this.snapshot.settings,
      };
      this.mapFocus = { systemId: capital, nonce: ++this.focusNonce };
      this.toast("Сетевая партия: мир получен от сервера", "good");
      this.refresh();
    } catch (e) {
      this.toast("Ошибка сетевого мира: " + (e as Error).message, "bad");
    }
  }

  /** Компактный snapshot сервера: тик/пауза/ресурсы игрока + значимые события. */
  applyRemoteSnapshot(snap: NetSnapshot): void {
    if (!this.w) return;
    const world = this.w;
    world.tick = snap.tick;
    world.paused = snap.paused;
    world.speed = snap.speed;
    const me = snap.players.find((p) => p.empireId === world.playerEmpireId);
    const empire = world.empires.find((e) => e.id === world.playerEmpireId);
    if (me && empire) {
      for (const [k, v] of Object.entries(me.resources)) {
        (empire.resources as Record<string, number>)[k] = v;
      }
      for (const [k, v] of Object.entries(me.income)) {
        (empire.incomeLastTick as Record<string, number>)[k] = v;
      }
      for (const [k, v] of Object.entries(me.science)) {
        (empire.science as Record<string, number>)[k] = v;
      }
    }
    for (const ev of snap.events ?? []) {
      if (ev.kind === "combat" || ev.severity === "warn" || ev.severity === "bad" || ev.severity === "good") {
        this.pushNotice(ev.messageRu, ev.severity as NoticeSeverity);
      }
    }
    this.refresh({ tick: snap.tick, paused: snap.paused, speed: snap.speed });
  }

  // --------------------------------------------------------------- commands
  sendCommand(cmd: Command): boolean {
    if (this.net?.isActive) {
      const sent = this.net.sendCommand(cmd);
      if (!sent) this.toast("Нет соединения с сервером", "bad");
      return sent;
    }
    if (!this.w) return false;
    let result: sim.CommandResult;
    try {
      result = sim.applyCommand(this.w, cmd);
    } catch (e) {
      this.toast("Команда не выполнена: " + (e as Error).message, "bad");
      this.refresh();
      return false;
    }
    if (!result.ok) {
      if (result.messageRu) this.toast(result.messageRu, "warn");
      this.refresh();
      return false;
    }
    this.afterTick();
    this.refresh({ tick: this.w.tick });
    return true;
  }

  applyTacticalBattle(report: BattleRecord): void {
    this.sendCommand({ type: "apply_battle", report });
    this.refresh({ battleReport: report, overlay: "battle", paused: true });
  }

  setBattleReport(report: BattleRecord | null): void {
    if (report) {
      this.releasePointerLock();
      if (!this.pausedByBattle) {
        this.pauseBeforeBattle = this.snapshot.paused;
        this.pausedByBattle = true;
      }
      if (this.w) this.w.paused = true;
      this.refresh({ battleReport: report, overlay: "battle", paused: true });
      return;
    }
    // Закрыли отчёт: это явное действие «продолжить» — снимаем авто-паузу.
    // (Если игрок сам выставил скорость 0, остаёмся на паузе.)
    const resume = this.snapshot.speed > 0;
    this.pausedByBattle = false;
    this.pauseBeforeBattle = false;
    if (this.w) this.w.paused = !resume;
    this.accMs = 0;
    this.refresh({ battleReport: null, overlay: "none", paused: !resume });
  }

  /** Освободить захват мыши: при смене режима/открытии оверлеев курсор должен вернуться. */
  private releasePointerLock(): void {
    try {
      if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
    } catch {
      /* noop */
    }
  }

  // ------------------------------------------------------------------ misc
  toast(text: string, severity: NoticeSeverity = "info", systemId?: number): void {
    this.pushNotice(text, severity, systemId);
    this.refresh();
  }

  private pushNotice(text: string, severity: NoticeSeverity, systemId?: number): void {
    const notice: Notice = { id: this.nextNoticeId++, text, severity, tick: this.snapshot.tick, systemId };
    this.snapshot = { ...this.snapshot, notices: [...this.snapshot.notices, notice].slice(-6) };
  }

  dismissNotice(id: number): void {
    this.refresh({ notices: this.snapshot.notices.filter((n) => n.id !== id) });
  }

  setSettings(patch: Partial<RenderSettings>): void {
    const settings = { ...this.snapshot.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* noop */
    }
    document.documentElement.style.setProperty("--ui-scale", String(settings.uiScale));
    this.refresh({ settings });
  }

  getPlayerEmpire(): Empire {
    if (!this.w) throw new Error("Нет мира");
    const p = this.w.empires.find((e) => e.isPlayer);
    if (!p) throw new Error("Нет игрока");
    return p;
  }

  getSelectedSystem(): StarSystem | null {
    if (!this.w || this.snapshot.selectedSystemId == null) return null;
    return this.w.systems.find((s) => s.id === this.snapshot.selectedSystemId) ?? null;
  }

  getFleetInSystem(systemId: number): Fleet[] {
    if (!this.w) return [];
    const playerId = this.w.playerEmpireId;
    return this.w.fleets.filter((f) => f.systemId === systemId && f.empireId === playerId && f.ships.length > 0);
  }

  getPlayerFleets(): Fleet[] {
    if (!this.w) return [];
    const playerId = this.w.playerEmpireId;
    return this.w.fleets.filter((f) => f.empireId === playerId && f.ships.length > 0);
  }

  getEnemyFleetsInSystem(systemId: number): Fleet[] {
    if (!this.w) return [];
    const playerId = this.w.playerEmpireId;
    return this.w.fleets.filter((f) => f.systemId === systemId && f.empireId !== playerId && f.ships.length > 0);
  }

  getSystemOwnerName(systemId: number): string {
    if (!this.w) return "";
    const sys = this.w.systems.find((s) => s.id === systemId);
    if (!sys || sys.ownerId === 0) return "Нейтральная";
    return this.w.empires.find((e) => e.id === sys.ownerId)?.name ?? "—";
  }

  getPlanet(planetId: number): Planet | null {
    if (!this.w) return null;
    for (const sys of this.w.systems) {
      const p = sys.planets.find((x) => x.id === planetId);
      if (p) return p;
    }
    return null;
  }

  getEmpire(id: number): Empire | undefined {
    return this.w?.empires.find((e) => e.id === id);
  }

  getEvents(limit = 50): GameEvent[] {
    if (!this.w) return [];
    return this.w.log.slice(-limit).reverse();
  }
}