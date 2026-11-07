import type { BattleRecord, Command, Empire, Fleet, GameEvent, Planet, StarSystem, World } from "@sf/sim";
import type { MpState } from "../net/NetClient";

export type AppMode = "menu" | "galaxy" | "system" | "station";
export type OverlayId = "none" | "help" | "save" | "battle" | "victory" | "settings" | "newgame" | "pause";
export type NoticeSeverity = "info" | "good" | "warn" | "bad";

export interface Notice {
  id: number;
  text: string;
  severity: NoticeSeverity;
  tick: number;
  /** если задано — клик по уведомлению переводит камеру/открывает экран */
  systemId?: number;
}

export interface RenderSettings {
  internalWidth: number;   // 480 | 640 | 960
  internalHeight: number;
  dither: number;          // 0..100
  palette: boolean;
  outlines: boolean;
  bloom: boolean;
  crt: boolean;
  uiScale: 1 | 1.25 | 1.5 | 2;
}

export interface GameState {
  version: number;
  mode: AppMode;
  speed: number;
  paused: boolean;
  tick: number;
  seed: number;
  /** id режима: campaign | coop | mmo | sandbox | trial */
  modeId: string;
  /** M11: статус сетевой сессии (coop/mmo); undefined в одиночной игре */
  mp?: MpState;
  selectedSystemId: number | null;
  selectedFleetId: number | null;
  selectedPlanetId: number | null;
  activeSystemId: number | null;
  activeStationId: number | null;
  overlay: OverlayId;
  notices: Notice[];
  battleReport: BattleRecord | null;
  saveStatus: "idle" | "saving" | "saved" | "loaded" | "error";
  lastSaveAt: number | null;
  started: boolean;
  settings: RenderSettings;
  /** для отладки/демо */
  fps: number;
}


/** Телеметрия полёта (пишется SystemView каждый кадр, читается HUD через polling). */
export interface FlightContact {
  name: string;
  dist: number;
  hostile: boolean;
  hull01: number;
  x: number;
  y: number;
}
export interface FlightTelemetry {
  active: boolean;
  systemName: string;
  mode: "normal" | "supercruise" | "combat";
  speed: number;
  throttle: number;
  boost: boolean;
  assist: boolean;
  shield: number;
  shieldMax: number;
  hull: number;
  hullMax: number;
  heat: number;
  overheat: boolean;
  pips: { sys: number; eng: number; wep: number };
  supercruiseSpeed: number;
  targetName: string | null;
  targetDist: number;
  targetHull01: number | null;
  navSystemId: number | null;
  navSystemName: string;
  navDistLy: number;
  stationName: string;
  stationDist: number;
  canDock: boolean;
  /** ближайшая планета в зоне высадки */
  nearPlanetId: number | null;
  nearPlanetName: string;
  nearPlanetDist: number;
  nearPlanetHabitability: number;
  canColonize: boolean;
  colonizerFleetId: number | null;
  massLocked: boolean;
  fsdCharge: number;
  contacts: FlightContact[];
  warnings: string[];
  hints: string[];
}

export const EMPTY_TELEMETRY: FlightTelemetry = {
  active: false,
  systemName: "",
  mode: "normal",
  speed: 0,
  throttle: 0,
  boost: false,
  assist: true,
  shield: 0,
  shieldMax: 1,
  hull: 0,
  hullMax: 1,
  heat: 0,
  overheat: false,
  pips: { sys: 2, eng: 2, wep: 2 },
  supercruiseSpeed: 0,
  targetName: null,
  targetDist: 0,
  targetHull01: null,
  navSystemId: null,
  navSystemName: "",
  navDistLy: 0,
  stationName: "",
  stationDist: 0,
  canDock: false,
  nearPlanetId: null,
  nearPlanetName: "",
  nearPlanetDist: 0,
  nearPlanetHabitability: 0,
  canColonize: false,
  colonizerFleetId: null,
  massLocked: false,
  fsdCharge: 0,
  contacts: [],
  warnings: [],
  hints: [],
};

export interface GameApi {
  readonly world: World;
  getState(): GameState;
  subscribe(fn: () => void): () => void;
  newGame(seed?: number): void;
  loadGame(): Promise<boolean>;
  saveGame(notify?: boolean): Promise<boolean>;
  setSpeed(speed: number): void;
  togglePause(): void;
  selectSystem(id: number | null): void;
  selectFleet(id: number | null): void;
  selectPlanet(id: number | null): void;
  enterSystem(systemId?: number): void;
  exitToGalaxy(): void;
  dockAtStation(stationId: number): void;
  undock(): void;
  setOverlay(id: OverlayId): void;
  sendCommand(cmd: Command): boolean;
  sendCommandDetailed(cmd: Command): import("@sf/sim").CommandResult;
  toast(text: string, severity?: NoticeSeverity, systemId?: number): void;
  dismissNotice(id: number): void;
  setBattleReport(report: BattleRecord | null): void;
  applyTacticalBattle(report: BattleRecord): void;
  setSettings(patch: Partial<RenderSettings>): void;
  getPlayerEmpire(): Empire;
  getSelectedSystem(): StarSystem | null;
  getPlayerFleets(): Fleet[];
  getFleetInSystem(systemId: number): Fleet[];
  getEnemyFleetsInSystem(systemId: number): Fleet[];
  getSystemOwnerName(systemId: number): string;
  getPlanet(planetId: number): Planet | null;
  getEmpire(id: number): Empire | undefined;
  getEvents(limit?: number): GameEvent[];
  /** проекция карты в экранные координаты, ставится GalaxyView */
  mapProject: ((x: number, y: number) => { x: number; y: number } | null) | null;
  mapZoom: number;
  /** текущий видимый прямоугольник камеры карты (мир. координаты) */
  mapView: { centerX: number; centerY: number; halfWidth: number; halfHeight: number } | null;
  setMapZoom(z: number): void;
  mapFocus: { systemId: number; nonce: number } | null;
  /** мутабельная телеметрия полёта (без ре-рендеров React) */
  flightTelemetry: FlightTelemetry;
  /** тик обновления HUD (счётчик), UI читает через rAF */
  hudTick: number;
  focusSystem(systemId: number): void;
}