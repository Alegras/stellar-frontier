import { useEffect, useMemo, useRef, useState } from "react";
import type { Fleet, World } from "@sf/sim";
import { findPath, fuelOf, pathFuelCost } from "@sf/sim";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";

import { SECTOR_FACTIONS, SECTOR_HAZARDS, SECTOR_REGIONS } from "@sf/data";
import { ancientsOf, dlcOf, sectorOf } from "./fg";
import { politicalMapOf, AI_RELATION_ICON } from "./world-politics";
import { findSystem, isKnown, STATION_RU, STAR_RU, intText, rnd } from "./util";
import type { TipData } from "./controls";
import { L } from "./fg";

const CELL = 64;          // сетка конфликтов, docs/12 §4
const CLUSTER_R = 48;     // радиус кластеризации, docs/12 §4
const MAX_LABELS = 400;

type Prio = 1 | 2 | 3 | 4 | 5;

interface Cand {
  id: number;
  name: string;
  x: number;
  y: number;
  prio: Prio;
  known: boolean;
  own: boolean;
  capital: boolean;
  selected: boolean;
  battle: boolean;
  star: string;
  planets: number;
  fleets: number;
}

interface LabelItem {
  key: string;
  kind: "system" | "cluster";
  systemId: number;
  ids: number[];
  name: string;
  x: number;
  y: number;
  prio: Prio;
  selected: boolean;
  battle: boolean;
  unknown: boolean;
  own: boolean;
  capital: boolean;
  /** маленькая точка без подписи (неизвестная система) */
  dot?: boolean;
}

function labelWidth(text: string): number {
  return Math.min(210, 16 + Math.max(0, text.length) * 6.4);
}

const OFFSETS: { ox: number; oy: number }[] = (() => {
  const dirs: [number, number][] = [
    [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];
  const radii = [22, 44, 66, 88, 110];
  const out: { ox: number; oy: number }[] = [{ ox: 0, oy: 0 }];
  for (const r of radii) {
    for (const [dx, dy] of dirs) {
      if (dx === 0 && dy === 0) continue;
      out.push({ ox: dx * r, oy: dy * r });
    }
  }
  return out;
})();

function levelFor(count: number, cur: number): number {
  const up = [200, 120, 60];
  const want = count > up[0] ? 2 : count > up[1] ? 3 : count > up[2] ? 4 : 5;
  if (want === cur) return cur;
  if (want < cur) {
    const boundary = up[want - 2];
    return boundary !== undefined && count > boundary * 1.08 ? want : cur;
  }
  const boundary = up[want - 3];
  return boundary !== undefined && count < boundary * 0.92 ? want : cur;
}

function collectCandidates(world: World, proj: (x: number, y: number) => { x: number; y: number } | null, state: GameState, W: number, H: number): Cand[] {
  const playerId = world.playerEmpireId;
  const player = world.empires.find((e) => e.id === playerId);
  const fleetsBySystem = new Map<number, Fleet[]>();
  for (const f of world.fleets) {
    if (f.ships.length === 0) continue;
    const arr = fleetsBySystem.get(f.systemId);
    if (arr) arr.push(f);
    else fleetsBySystem.set(f.systemId, [f]);
  }
  const out: Cand[] = [];
  for (const sys of world.systems) {
    // системы Реликтового Предела живут в отдельном слое/галактике и не входят в политическую карту
    if ((sys as { sector?: string }).sector === "relic") continue;
    const p = proj(sys.x, sys.y);
    if (!p) continue;
    if (p.x < -80 || p.x > W + 80 || p.y < 24 || p.y > H + 80) continue;
    const known = isKnown(sys, playerId);
    const own = sys.ownerId === playerId;
    const capital = player?.capitalSystemId === sys.id;
    const selected = sys.id === state.selectedSystemId;
    const fl = fleetsBySystem.get(sys.id) ?? [];
    const battle = fl.some((f) => f.status === "combat");
    let prio: Prio = 5;
    if (battle || capital || selected) prio = battle || capital ? 1 : 2;
    else if (own) prio = 2;
    else if (known) prio = 3;
    else if (sys.hopsFromCapital <= 2) prio = 4;
    out.push({
      id: sys.id,
      name: sys.name,
      x: p.x,
      y: p.y,
      prio,
      known,
      own,
      capital,
      selected,
      battle,
      star: sys.star,
      planets: sys.planets.length,
      fleets: fl.length,
    });
  }
  out.sort((a, b) => a.prio - b.prio);
  return out.slice(0, MAX_LABELS);
}

function layoutLabels(cands: Cand[], W: number, H: number, level: number, topPad: number): LabelItem[] {
  const centerDist = (c: Cand) => Math.hypot(c.x - W / 2, c.y - H / 2);
  // 1) фильтр по уровню плотности (P4–P5 скрываются первыми)
  const base = cands.filter((c) => c.prio <= level);
  // На минимальном зуме карта не должна выглядеть пустой: показываем до 14 подписей —
  // столица/свои/выбранная + ближайшие известные системы (docs/12 §2: сначала P1–P2, затем P3).
  const extraKnown: Cand[] = [];
  if (level <= 2) {
    const need = Math.max(0, 14 - base.length);
    extraKnown.push(
      ...cands
        .filter((c) => c.prio === 3)
        .sort((a, b) => centerDist(a) - centerDist(b))
        .slice(0, need),
    );
  }
  // …и до 12 точек неизвестных систем без подписей (кликабельны, тултип «неизвестная»).
  // Дубли в радиусе 16 px схлопываются: раньше точки ставились без проверки занятости и
  // наслаивались белыми квадратами (M1).
  const seenDots = new Set<string>();
  const dotCands: Cand[] = level <= 2
    ? cands
        .filter((c) => c.prio >= 4)
        .sort((a, b) => centerDist(a) - centerDist(b))
        .filter((c) => {
          const key = Math.floor(c.x / 16) + ":" + Math.floor(c.y / 16);
          if (seenDots.has(key)) return false;
          seenDots.add(key);
          return true;
        })
        .slice(0, 10)
    : [];
  const shown = [...base, ...extraKnown];

  // 2) кластеризация: > 3 меток в радиусе 48px (ячейка 48px), P1–P2 не кластеризуются
  const buckets = new Map<string, Cand[]>();
  for (const c of shown) {
    const key = Math.floor(c.x / CLUSTER_R) + ":" + Math.floor(c.y / CLUSTER_R);
    const arr = buckets.get(key);
    if (arr) arr.push(c);
    else buckets.set(key, [c]);
  }
  const singles: Cand[] = [];
  const clusters: { ids: number[]; x: number; y: number; prio: Prio; name: string }[] = [];
  for (const arr of buckets.values()) {
    const high = arr.filter((c) => c.prio <= 2);
    const low = arr.filter((c) => c.prio > 2);
    singles.push(...high);
    if (low.length > 3) {
      clusters.push({
        ids: low.map((c) => c.id),
        x: low.reduce((a, c) => a + c.x, 0) / low.length,
        y: low.reduce((a, c) => a + c.y, 0) / low.length,
        prio: 3,
        name: "×" + low.length,
      });
    } else {
      singles.push(...low);
    }
  }

  // 3) жадное размещение по сетке 64px
  const cols = Math.ceil(W / CELL) + 2;
  const rows = Math.ceil(H / CELL) + 2;
  const grid = new Uint8Array(cols * rows);
  const cx = W / 2;
  const cy = H / 2;

  const occupied = (x: number, y: number, w: number, h: number): boolean => {
    const x0 = Math.floor((x - w / 2) / CELL) + 1;
    const x1 = Math.floor((x + w / 2) / CELL) + 1;
    const y0 = Math.floor((y - h / 2) / CELL) + 1;
    const y1 = Math.floor((y + h / 2) / CELL) + 1;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return true;
        if (grid[gy * cols + gx]) return true;
      }
    }
    return false;
  };
  const occupy = (x: number, y: number, w: number, h: number): void => {
    const x0 = Math.floor((x - w / 2) / CELL) + 1;
    const x1 = Math.floor((x + w / 2) / CELL) + 1;
    const y0 = Math.floor((y - h / 2) / CELL) + 1;
    const y1 = Math.floor((y + h / 2) / CELL) + 1;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
        grid[gy * cols + gx] = 1;
      }
    }
  };

  type Work = { kind: "system" | "cluster"; prio: Prio; x: number; y: number; w: number; h: number; id: number; ids: number[]; name: string; c?: Cand; dot?: boolean };
  const work: Work[] = [
    ...singles.map<Work>((c) => ({
      kind: "system", prio: c.prio, x: c.x, y: c.y, w: labelWidth(c.name), h: 18, id: c.id, ids: [c.id], name: c.name, c,
    })),
    ...clusters.map<Work>((cl) => ({
      kind: "cluster", prio: 3, x: cl.x, y: cl.y, w: labelWidth(cl.name), h: 18, id: cl.ids[0] ?? 0, ids: cl.ids, name: cl.name,
    })),
  ];
  work.sort((a, b) => a.prio - b.prio || Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));

  const result: LabelItem[] = [];
  for (const w of work) {
    let placed: { x: number; y: number } | null = null;
    // Точка неизвестной системы стоит ровно на своей звезде (без смещений) и только
    // если ячейка свободна — иначе пропускается, чтобы не наезжать на подписи и друг друга.
    const offsets = w.dot ? [{ ox: 0, oy: 0 }] : OFFSETS;
    for (const o of offsets) {
      const x = Math.max(20, Math.min(W - 20, w.x + o.ox));
      const y = Math.max(topPad, Math.min(H - 24, w.y + o.oy));
      if (!occupied(x, y, w.w, w.h)) {
        occupy(x, y, w.w, w.h);
        placed = { x, y };
        break;
      }
    }
    if (!placed) {
      if (w.prio <= 2) {
        placed = {
          x: Math.max(20, Math.min(W - 20, w.x)),
          y: Math.max(topPad, Math.min(H - 24, w.y)),
        };
        occupy(placed.x, placed.y, w.w, w.h);
      } else {
        continue; // P3+ скрывается при плотности
      }
    }
    const c = w.c;
    result.push({
      key: w.kind + ":" + w.id,
      kind: w.kind,
      systemId: w.id,
      ids: w.ids,
      name: w.name,
      x: placed.x,
      y: placed.y,
      prio: w.prio,
      selected: c?.selected ?? false,
      battle: c?.battle ?? false,
      unknown: c ? !c.known : false,
      own: c?.own ?? false,
      capital: c?.capital ?? false,
      dot: w.dot ?? false,
    });
  }
  // 4) точки неизвестных систем: отдельная мягкая проверка (маленькие, не по сетке 64px),
  // чтобы не наезжали на подписи и друг на друга (M1: белые квадраты/наложения).
  for (const c of dotCands) {
    const x = Math.max(10, Math.min(W - 10, c.x));
    const y = Math.max(topPad, Math.min(H - 10, c.y));
    if (result.some((l) => Math.hypot(l.x - x, l.y - y) < 22)) continue;
    if (result.some((l) => l.dot && Math.hypot(l.x - x, l.y - y) < 12)) continue;
    result.push({
      key: "system:" + c.id, kind: "system", systemId: c.id, ids: [c.id], name: "",
      x, y, prio: 5, selected: false, battle: false, unknown: true, own: false, capital: false, dot: true,
    });
  }
  return result;
}

export interface MapLabelsProps {
  game: Game;
  state: GameState;
  onPick: (systemId: number) => void;
  onEnter: (systemId: number) => void;
}

export function MapLabels({ game, state, onPick, onEnter }: MapLabelsProps) {
  const [items, setItems] = useState<LabelItem[]>([]);
  const [hover, setHover] = useState<{ item: LabelItem; left: number; top: number; above: boolean } | null>(null);
  const [layer, setLayer] = useState<"political" | "sector">("political");
  const [sectorSel, setSectorSel] = useState<number | null>(null);
  const [polFilters, setPolFilters] = useState<string[]>(["war", "alliance", "federation", "trade", "vassal"]);
  const prevSector = useRef(false);
  const levelRef = useRef(3);
  const sigRef = useRef("");

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 90) return;
      last = now;
      const proj = game.mapProject;
      const st = game.getState();
      if (!proj || !game.hasWorld || st.mode !== "galaxy" || layer !== "political") {
        if (sigRef.current !== "none") {
          sigRef.current = "none";
          setItems((prev) => (prev.length === 0 ? prev : []));
        }
        return;
      }
      const W = window.innerWidth;
      const H = window.innerHeight;
      const cands = collectCandidates(game.world, proj, st, W, H);
      levelRef.current = levelFor(cands.length, levelRef.current);
      const topPad = W <= 1560 ? 96 : 64;
      const layout = layoutLabels(cands, W, H, levelRef.current, topPad);
      const sig = layout
        .map((l) => l.key + "@" + rnd(l.x / 8) + "," + rnd(l.y / 8) + (l.selected ? "s" : "") + (l.battle ? "b" : ""))
        .join("|");
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setItems(layout);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game, state.mode, state.selectedSystemId, state.selectedFleetId, layer]);

  const tooltip = useMemo(() => {
    if (!hover) return null;
    const world = game.hasWorld ? game.world : null;
    if (!world) return null;
    const { item } = hover;
    if (item.kind === "cluster") {
      const names = item.ids
        .map((id) => findSystem(world, id)?.name ?? "—")
        .slice(0, 8);
      const data: TipData = {
        title: L("Кластер", "Cluster") + " · " + item.ids.length + " " + L("систем", "systems"),
        value: "×" + item.ids.length,
        lines: names.map((n) => ({ label: n, value: "" })),
        note: L("Клик — приблизить. Метки кластеризуются при плотности (docs/12 §4).", "Click to zoom in. Labels cluster at high density (docs/12 §4)."),
      };
      return data;
    }
    const sys = findSystem(world, item.systemId);
    if (!sys) return null;
    const playerId = world.playerEmpireId;
    const known = isKnown(sys, playerId);
    const owner = sys.ownerId === 0
      ? L("Нейтральная", "Neutral")
      : world.empires.find((e) => e.id === sys.ownerId)?.name ?? "—";
    const st = game.getState();
    const fleets = world.fleets.filter((f) => f.systemId === sys.id && f.ships.length > 0);
    const data: TipData = {
      title: sys.name,
      value: known ? (STAR_RU[sys.star] ?? sys.star) : L("Неизвестная система", "Unknown system"),
      lines: known
        ? [
            { label: L("Владелец", "Owner"), value: owner },
            { label: L("Планет", "Planets"), value: String(sys.planets.length) },
            { label: L("Станция", "Station"), value: sys.station ? (STATION_RU[sys.station.kind] ?? "—") : L("нет", "none") },
            { label: L("Флотов", "Fleets"), value: String(fleets.length) },
            { label: L("Прыжков от столицы", "Jumps from capital"), value: String(sys.hopsFromCapital) },
          ]
        : [{ label: L("Нужен флот-разведчик", "Scout fleet required"), value: L("скан", "scan") }],
      consequence: st.selectedFleetId != null
        ? L("Клик — приказ флоту. Двойной клик — войти в систему.", "Click issues a fleet order. Double click enters the system.")
        : L("Клик — выбрать. Двойной клик — войти в систему.", "Click selects. Double click enters the system."),
    };
    return data;
  }, [hover, game]);

  const world = game.hasWorld ? game.world : null;
  const ancients = ancientsOf(world);
  const sectorAvailable = ancients?.sector?.discovered === true;
  const sector = layer === "sector" && world ? sectorOf(world) : null;
  const polMap = layer === "political" && world ? politicalMapOf(world) : null;
  useEffect(() => {
    if (sectorAvailable && !prevSector.current) {
      game.toast(L("Реликтовый Предел открыт: слой карты доступен.", "The Relic Expanse is open: map layer available."), "good");
    }
    prevSector.current = sectorAvailable;
  }, [sectorAvailable, game]);
  useEffect(() => {
    if (layer === "sector" && !sectorAvailable) setLayer("political");
  }, [layer, sectorAvailable]);
  const W = typeof window !== "undefined" ? window.innerWidth : 1600;
  const H = typeof window !== "undefined" ? window.innerHeight : 900;
  // сектор рисуем левее плавающих панелей карты (политическая карта/миникарта справа)
  const sectorBox = { x: 344, y: 170, w: Math.min(460, Math.max(360, W - 900)), h: Math.min(H - 320, 480) };
  const sectorPos = (() => {
    const systems = sector?.systems ?? [];
    if (systems.length === 0) return [] as { sys: NonNullable<typeof sector>["systems"][number]; x: number; y: number }[];
    const xs = systems.map((v) => v.x);
    const ys = systems.map((v) => v.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
    // координаты ОТНОСИТЕЛЬНО контейнера .sf-sector-map (он смещён на x-8/y-54)
    return systems.map((sys) => ({
      sys,
      x: 8 + ((sys.x - minX) / spanX) * sectorBox.w,
      y: 54 + ((sys.y - minY) / spanY) * sectorBox.h,
    }));
  })();
  const sectorSelSys = sectorSel != null ? sector?.systems.find((v) => v.id === sectorSel) ?? null : null;

  return (
    <div className="sf-map-layer" data-testid="map-labels" aria-label={L("Метки систем", "System labels")}>
      <div className="sf-map-layer-toggle" role="group" aria-label={L("Слой карты", "Map layer")}>
        <button type="button" className={"sf-map-layer-btn" + (layer === "political" ? " sf-map-layer-btn--on" : "")}
          onClick={() => setLayer("political")} data-testid="map-layer-political" aria-pressed={layer === "political"}>
          {L("Политическая", "Political")}
        </button>
        {sectorAvailable && (
          <button type="button" className={"sf-map-layer-btn" + (layer === "sector" ? " sf-map-layer-btn--on" : "")}
            onClick={() => setLayer("sector")} data-testid="map-layer-sector" aria-pressed={layer === "sector"}>
            {L("Предел", "Expanse")}
          </button>
        )}
      </div>
      {layer === "political" && polMap && (() => {
        const proj = game.mapProject;
        if (!proj) return null;
        const capitals = new Map(polMap.capitals.map((c) => [c.empireId, c]));
        const lines = polMap.relations
          .filter((r) => polFilters.includes(r.kind))
          .map((r) => {
            const a = capitals.get(r.a), b = capitals.get(r.b);
            if (!a || !b) return null;
            const pa = proj(a.x, a.y), pb = proj(b.x, b.y);
            if (!pa || !pb) return null;
            return { r, pa, pb };
          })
          .filter((v): v is { r: typeof polMap.relations[number]; pa: { x: number; y: number }; pb: { x: number; y: number } } => v !== null);
        return (
          <>
            <svg className="sf-map-pol-lines" aria-hidden="true">
              {lines.map(({ r, pa, pb }) => (
                <line key={r.a + "-" + r.b} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                  className={"sf-map-pol-line sf-map-pol-line--" + r.kind}
                  data-testid={"map-pol-line-" + r.a + "-" + r.b} />
              ))}
            </svg>
            {polMap.capitals.map((c) => {
              const pt = proj(c.x, c.y);
              if (!pt) return null;
              return (
                <button key={c.empireId} type="button"
                  className={"sf-map-pol-capital sf-map-pol-capital--" + (c.status ?? "active") + (c.isPlayer ? " sf-map-pol-capital--player" : "")}
                  style={{ left: pt.x, top: pt.y, borderColor: c.color }}
                  data-testid={"map-pol-capital-" + c.empireId}
                  title={c.name + " · " + (c.systemName ?? "") + " · " + (c.status ?? "")}
                  aria-label={c.name + " · " + (c.status ?? "")}
                  onClick={() => onPick(c.systemId)}
                  onDoubleClick={() => window.dispatchEvent(new CustomEvent("sf:open-panel", { detail: "politics" }))}
                >
                  <span className="sf-map-pol-capital__dot" style={{ background: c.color }} />
                  <span className="sf-map-pol-capital__name">{c.name}</span>
                  <span className="sf-map-pol-capital__status" data-testid={"map-pol-status-" + c.empireId}>{c.status ?? "active"}</span>
                </button>
              );
            })}
            <div className="sf-map-pol-legend" data-testid="map-pol-legend">
              <b>{L("Мировая политика", "World politics")}</b>
              {(["war", "alliance", "federation", "trade", "vassal"] as const).map((kind) => {
                const label: Record<string, [string, string]> = {
                  war: ["война", "war"], alliance: ["союз", "alliance"], federation: ["федерация", "federation"],
                  trade: ["торговля", "trade"], vassal: ["вассалитет", "vassal"],
                };
                return (
                  <button key={kind} type="button"
                    className={"sf-map-pol-filter" + (polFilters.includes(kind) ? " sf-map-pol-filter--on" : "")}
                    data-testid={"map-pol-filter-" + kind}
                    aria-pressed={polFilters.includes(kind)}
                    onClick={() => setPolFilters((prev) => prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind])}>
                    {AI_RELATION_ICON[kind]} {L(label[kind][0], label[kind][1])}
                  </button>
                );
              })}
              <button type="button" className="sf-map-pol-open" data-testid="map-pol-open-panel"
                onClick={() => window.dispatchEvent(new CustomEvent("sf:open-panel", { detail: "politics" }))}>
                {L("Открыть панель", "Open panel")}
              </button>
            </div>
          </>
        );
      })()}
      {layer === "political" && world && (() => {
        const proj = game.mapProject;
        if (!proj) return null;
        const pid = world.playerEmpireId;
        const jumpTicks = Math.max(1, world.balance?.fleetSpeedTicksPerJump ?? 1);
        const selectedFleetId = (game.getState?.() as { selectedFleetId?: number | null } | undefined)?.selectedFleetId ?? null;
        const visibleFleets = world.fleets.filter((f) => f.ships.length > 0 && (f.empireId === pid || world.systems[f.systemId]?.visibleTo.includes(pid)));
        if (visibleFleets.length === 0) return null;
        const own = visibleFleets.filter((f) => f.empireId === pid);
        const enemy = visibleFleets.filter((f) => f.empireId !== pid);
        const selected = selectedFleetId != null ? own.find((f) => f.id === selectedFleetId) ?? null : null;
        const fuelReach = new Set<number>();
        if (selected) {
          for (const sys of world.systems) {
            const path = findPath(world, selected.systemId, sys.id);
            if (path && path.length > 0 && pathFuelCost(world, selected, path) <= fuelOf(selected)) fuelReach.add(sys.id);
          }
        }
        const marker = (f: Fleet, x: number, y: number, label: string, cls: string) => (
          <g key={"fleet-" + f.id} data-testid={"map-fleet-" + f.id} className={cls}>
            <circle cx={x} cy={y} r={9} className="sf-map-fleet-halo" />
            <polygon points={x + "," + (y - 7) + " " + (x + 6) + "," + (y + 6) + " " + (x - 6) + "," + (y + 6)} className="sf-map-fleet-icon" />
            <text x={x + 11} y={y + 4} className="sf-map-fleet-label">{label}</text>
          </g>
        );
        return (
          <svg className="sf-map-fleet-lines" aria-hidden="true" data-testid="map-fleets">
            {[...fuelReach].map((id) => {
              const sys = world.systems[id]; if (!sys) return null;
              const p = proj(sys.x, sys.y); if (!p) return null;
              return <circle key={"fuel-" + id} cx={p.x + 10} cy={p.y - 18} r={4} className="sf-map-fuel-dot" />;
            })}
            {own.map((f) => {
              const current = world.systems[f.systemId]; if (!current) return null;
              let x = 0, y = 0, label = "▲ " + f.name + " · ⛽ " + fuelOf(f) + "/" + (f.fuelMax ?? "?");
              if (f.status === "moving" && f.path.length > 0) {
                const target = world.systems[f.path[Math.min(f.pathIndex, f.path.length - 1)]];
                if (!target) return null;
                const p0 = proj(current.x, current.y), p1 = proj(target.x, target.y);
                if (!p0 || !p1) return null;
                const fraction = 1 - Math.min(1, Math.max(0, f.jumpTicksLeft / jumpTicks));
                x = p0.x + (p1.x - p0.x) * fraction; y = p0.y + (p1.y - p0.y) * fraction;
                label += " → " + target.name;
              } else {
                const p = proj(current.x, current.y); if (!p) return null; x = p.x + 14; y = p.y - 18;
              }
              const route = [current, ...f.path.slice(Math.min(f.pathIndex, f.path.length - 1)).map((id) => world.systems[id])]
                .filter((sys): sys is NonNullable<typeof sys> => Boolean(sys))
                .map((sys) => proj(sys.x, sys.y)).filter((p): p is { x: number; y: number } => p !== null);
              return (
                <g key={"own-" + f.id} data-testid={"map-fleet-" + f.id}>
                  {route.length > 1 && <polyline className={"sf-map-fleet-route" + (selected?.id === f.id ? " sf-map-fleet-route--selected" : "")} points={route.map((p) => p.x + "," + p.y).join(" ")} />}
                  {marker(f, x, y, label, "sf-map-fleet-own" + (selected?.id === f.id ? " sf-map-fleet-own--selected" : ""))}
                </g>
              );
            })}
            {enemy.map((f) => {
              const current = world.systems[f.systemId]; if (!current) return null;
              const p = proj(current.x, current.y); if (!p) return null;
              return marker(f, p.x - 18, p.y + 8, "▼ " + f.name, "sf-map-fleet-enemy");
            })}
          </svg>
        );
      })()}
      {layer === "political" && (() => {
        const proj = game.mapProject; if (!proj || !world) return null;
        let route: { path?: number[]; targetId?: number } | null = null;
        try { route = JSON.parse(localStorage.getItem("sf.routeLayer") ?? "null") as { path?: number[]; targetId?: number } | null; } catch { route = null; }
        if (!route?.path || route.path.length === 0) return null;
        const pts = route.path.map((id) => world.systems[id]).filter(Boolean).map((sys) => proj(sys!.x, sys!.y)).filter((p): p is { x: number; y: number } => p !== null);
        if (pts.length < 2) return null;
        return (
          <svg className="sf-map-route-layer" aria-hidden="true" data-testid="map-route-layer">
            <polyline className="sf-map-route-line" points={pts.map((p) => p.x + "," + p.y).join(" ")} />
            {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 7 : 4} className={i === pts.length - 1 ? "sf-map-route-target" : "sf-map-route-waypoint"} />)}
          </svg>
        );
      })()}
      {layer === "political" && (() => {
        const dlc = world ? dlcOf(world) : null;
        const proj = game.mapProject;
        if (!dlc?.enabled || !proj || !world) return null;
        return dlc.signals.map((s) => {
          const sys = world.systems.find((v) => v.id === s.systemId);
          if (!sys) return null;
          const p = proj(sys.x, sys.y);
          if (!p) return null;
          return (
            <button
              key={s.id}
              type="button"
              className="sf-quest-marker"
              data-testid={"quest-marker-" + s.id}
              style={{ left: p.x, top: p.y }}
              title={L("Сигнал квеста", "Quest signal") + (sys.name ? " · " + sys.name : "")}
              aria-label={L("Сигнал квеста", "Quest signal")}
              onClick={() => onPick(sys.id)}
            >
              ✦
            </button>
          );
        });
      })()}
      {layer === "sector" && (
        <div className="sf-sector-map" data-testid="sector-map" style={{ left: sectorBox.x - 8, top: sectorBox.y - 54, width: sectorBox.w + 16, height: sectorBox.h + 90 }}>
          <div className="sf-sector-map__head">
            <b style={{ color: "#C9B8FF" }}>{L("Реликтовый Предел", "Relic Expanse")}</b>
            <span className="sf-meta">◈ {intText(ancients?.relics ?? 0)} · ◉ {intText(ancients?.cores ?? 0)}</span>
            <span className="sf-spacer" />
            {sector && <span className="sf-meta">{L("стабильность", "stability")} {intText(sector.stability)}% · {L("Хор", "Chorus")} {intText(sector.chorusThreat)}%</span>}
            <span className="sf-meta">{L("слой", "layer")}: {L("схема сектора", "sector schematic")}</span>
          </div>
          {sectorPos.length === 0 ? (
            <div className="sf-sector-map__locked" data-testid="sector-map-locked">
              {L("Предел не открыт: достигните миссии 10 / технологии A3 и откройте варп.", "The Expanse is not open: reach mission 10 / A3 tech and unlock warp.")}
              <div className="sf-meta">{L("После открытия здесь появятся 45 систем, подрегионы и фракции.", "Once opened, 45 systems, subregions and factions appear here.")}</div>
            </div>
          ) : sectorPos.map(({ sys, x, y }) => {
            const region = SECTOR_REGIONS.find((r) => r.id === sys.region);
            const faction = SECTOR_FACTIONS.find((f) => f.id === sys.faction);
            const hazard = sys.hazard ? SECTOR_HAZARDS.find((h) => h.id === sys.hazard) : null;
            const color = region?.color ?? faction?.color ?? "#3A2B5C";
            const known = sys.visited || sys.controlled;
            return (
              <button
                key={sys.id}
                type="button"
                className={"sf-sector-label" + (sectorSel === sys.id ? " sf-sector-label--sel" : "") + (known ? "" : " sf-sector-label--fog")}
                style={{ left: x, top: y, borderColor: color, color: faction?.hostile ? "#FFC2C2" : undefined }}
                data-testid={"sector-label-" + sys.id}
                data-fog={known ? "false" : "true"}
                aria-label={known ? sys.name + " · " + (region?.ru ?? sys.region) : L("Неизвестная система Предела", "Unknown Expanse system")}
                title={known
                  ? sys.name + " · " + (region?.ru ?? sys.region) + (faction ? " · " + faction.ru : "") + (hazard ? " · " + hazard.ru : "")
                  : L("Неизвестная система Предела: скан/визит/квест раскроют её.", "Unknown Expanse system: scan/visit/quest reveals it.")}
                onClick={() => setSectorSel(sys.id)}
              >
                <span className="sf-sector-label__dot" style={{ background: color }} />
                <span className="sf-nowrap">{known ? sys.name : "?"}</span>
                {known && (sys.relics > 0 || sys.cores > 0) && <span className="sf-meta">◈{sys.relics}◉{sys.cores}</span>}
                {sys.controlled && <span className="sf-ok">✓</span>}
              </button>
            );
          })}
          <div className="sf-sector-map__legend">
            {SECTOR_REGIONS.map((r) => (
              <span key={r.id} data-testid={"sector-map-region-" + r.id}>
                <i style={{ background: r.color }} />{r.ru}
              </span>
            ))}
            {SECTOR_REGIONS.length === 0 && <span className="sf-meta">{L("Подрегионы появятся после генерации Предела.", "Subregions appear after Expanse generation.")}</span>}
          </div>
          {sectorSelSys && (
            <div className="sf-sector-map__info" data-testid="sector-map-info">
              <div className="sf-row">
                <b>{sectorSelSys.visited || sectorSelSys.controlled ? sectorSelSys.name : L("Неизвестная система", "Unknown system")}</b>
                <span className="sf-spacer" />
                <span className="sf-meta">{L("регион", "region")}: {SECTOR_REGIONS.find((r) => r.id === sectorSelSys.region)?.ru ?? sectorSelSys.region}</span>
              </div>
              <div className="sf-meta">
                {L("фракция", "faction")}: {SECTOR_FACTIONS.find((f) => f.id === sectorSelSys.faction)?.ru ?? sectorSelSys.faction} ·
                {" "}{L("опасность", "hazard")}: {sectorSelSys.hazard ? (SECTOR_HAZARDS.find((h) => h.id === sectorSelSys.hazard)?.ru ?? sectorSelSys.hazard) : "—"} ·
                {" "}◈ {intText(sectorSelSys.relics)} · ◉ {intText(sectorSelSys.cores)} · {sectorSelSys.visited ? L("посещена", "visited") : L("не посещена", "unvisited")}
              </div>
              <div className="sf-row" style={{ gap: 4 }}>
                <button type="button" className="sf-btn sf-btn--sm" data-testid="map-sector-scan"
                  onClick={() => game.sendCommand({ type: "sector_scan", systemId: sectorSelSys.id })}>{L("Скан", "Scan")}</button>
                <button type="button" className="sf-btn sf-btn--sm" data-testid="map-sector-claim"
                  onClick={() => game.sendCommand({ type: "sector_claim", systemId: sectorSelSys.id })}>{L("Захват", "Claim")}</button>
                <button type="button" className="sf-btn sf-btn--sm" data-testid="map-sector-warp"
                  onClick={() => {
                    const g = game as unknown as { selectWarpTarget?: (id: number) => unknown; requestWarp?: () => boolean };
                    g.selectWarpTarget?.(sectorSelSys.id);
                    if (g.requestWarp) g.requestWarp();
                    else game.sendCommand({ type: "warp_jump", targetSystemId: sectorSelSys.id } as never);
                  }}>{L("Варп", "Warp")}</button>
                <button type="button" className="sf-btn sf-btn--sm" data-testid="map-sector-enter"
                  onClick={() => {
                  if (!game.sendCommand({ type: "ancients_sector_enter", systemId: sectorSelSys.id } as never)) {
                    game.sendCommand({ type: "sector_enter", systemId: sectorSelSys.id } as never);
                  }
                }}>{L("Войти", "Enter")}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {layer === "political" && items.map((item) => {
        const cls = [
          "sf-map-label",
          "sf-map-label--p" + item.prio,
          item.selected ? "sf-map-label--sel" : "",
          item.battle ? "sf-map-label--battle" : "",
          item.capital ? "sf-map-label--home" : "",
          item.dot ? "sf-map-label--dot" : "",
        ].filter(Boolean).join(" ");
        const dot = item.battle ? "#FF5A5A" : item.capital ? "#F5C542" : item.own ? "#4FC3F7" : item.unknown ? "#5C6878" : "#8FA3BF";
        return (
          <button
            key={item.key}
            type="button"
            className={cls}
            style={{ left: item.x, top: item.y }}
            data-testid="map-label"
            data-system-id={item.systemId}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const above = r.bottom > window.innerHeight - 220;
              setHover({ item, left: r.left, top: above ? r.top - 6 : r.bottom + 6, above });
            }}
            onMouseLeave={() => setHover(null)}
            onFocus={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const above = r.bottom > window.innerHeight - 220;
              setHover({ item, left: r.left, top: above ? r.top - 6 : r.bottom + 6, above });
            }}
            onBlur={() => setHover(null)}
            onClick={() => onPick(item.systemId)}
            onDoubleClick={(e) => {
              e.preventDefault();
              if (item.kind === "system") onEnter(item.systemId);
              else game.focusSystem(item.systemId);
            }}
            title={item.kind === "cluster" ? L("Кластер", "Cluster") + ": " + item.ids.length + " " + L("систем", "systems") : item.dot ? L("Неизвестная система", "Unknown system") : item.name}
            aria-label={item.kind === "cluster" ? L("Кластер систем", "System cluster") : item.dot ? L("Неизвестная система", "Unknown system") : item.name}
          >
            <span className="sf-map-label__dot" style={{ background: item.dot ? "#5C6878" : dot }} />
            {!item.dot && <span className="sf-nowrap">{item.name}</span>}
            {item.capital && <span className="sf-map-label__home">ДОМ</span>}
          </button>
        );
      })}
      <div className="sf-map-hint">
        {L("Колесо — зум · клик — выбрать · двойной клик — войти · красные/жёлтые линии — войны и союзы ИИ, голубой пунктир — ваш флот · M — карта", "Wheel — zoom · click — select · double click — enter · red/yellow lines are AI wars/alliances, cyan dashes are your fleet route · M — map")}
      </div>
      {hover && tooltip && (
        <div
          className={"sf-tip" + (hover.above ? " sf-tip--above" : "")}
          style={{
            left: Math.max(8, Math.min(window.innerWidth - 348, hover.left)),
            top: hover.top,
            pointerEvents: "none",
          }}
          role="tooltip"
        >
          <div className="sf-tip-title">{tooltip.title}</div>
          {tooltip.value !== undefined && <div className="sf-tip-value">{tooltip.value}</div>}
          {tooltip.lines && tooltip.lines.length > 0 && (
            <>
              <div className="sf-tip-hr" />
              {tooltip.lines.map((l, i) => (
                <div key={i} className="sf-tip-line"><span>{l.label}</span><span>{l.value}</span></div>
              ))}
            </>
          )}
          {tooltip.note && <div className="sf-tip-note">{tooltip.note}</div>}
          {tooltip.consequence && <div className="sf-tip-consequence">{tooltip.consequence}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- мини-карта
type MapBounds = { seed: number; minX: number; maxX: number; minY: number; maxY: number };
function minimapBounds(game: Game, full: MapBounds, aspect: number): MapBounds {
  const cam = game.mapView;
  if (!cam || game.mapZoom <= 1.02) return full;
  const fullW = full.maxX - full.minX || 1;
  const fullH = full.maxY - full.minY || 1;
  let vw = Math.max(1, cam.halfWidth * 2 * 1.25);
  let vh = Math.max(1, cam.halfHeight * 2 * 1.25);
  if (vw / vh > aspect) vh = vw / aspect; else vw = vh * aspect;
  vw = Math.min(vw, fullW * 1.02);
  vh = Math.min(vh, fullH * 1.02);
  const cx = fullW <= vw ? (full.minX + full.maxX) / 2 : Math.max(full.minX + vw / 2, Math.min(full.maxX - vw / 2, cam.centerX));
  const cy = fullH <= vh ? (full.minY + full.maxY) / 2 : Math.max(full.minY + vh / 2, Math.min(full.maxY - vh / 2, cam.centerY));
  return { seed: full.seed, minX: cx - vw / 2, maxX: cx + vw / 2, minY: cy - vh / 2, maxY: cy + vh / 2 };
}

export function Minimap({ game, state }: { game: Game; state: GameState }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boundsRef = useRef<MapBounds | null>(null);
  const viewBoundsRef = useRef<MapBounds | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = rnd(160 * dpr);
    canvas.height = rnd(120 * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#05070E";
      ctx.fillRect(0, 0, 160, 120);
      const world = game.hasWorld ? game.world : null;
      if (!world) return;
      if (!boundsRef.current || boundsRef.current.seed !== world.seed) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const s of world.systems) {
          if (s.x < minX) minX = s.x;
          if (s.x > maxX) maxX = s.x;
          if (s.y < minY) minY = s.y;
          if (s.y > maxY) maxY = s.y;
        }
        boundsRef.current = { seed: world.seed, minX, maxX, minY, maxY };
      }
      const full = boundsRef.current;
      if (!full) return;
      const b = minimapBounds(game, full, 160 / 120);
      viewBoundsRef.current = b;
      const spanX = b.maxX - b.minX || 1;
      const spanY = b.maxY - b.minY || 1;
      const pad = 3;
      const w = 160 - pad * 2;
      const h = 120 - pad * 2;
      const sx = (x: number) => pad + ((x - b.minX) / spanX) * w;
      const sy = (y: number) => pad + ((y - b.minY) / spanY) * h;

      const playerId = world.playerEmpireId;
      const player = world.empires.find((e) => e.id === playerId);
      for (const s of world.systems) {
        const known = s.knownBy.includes(playerId);
        const own = s.ownerId === playerId;
        const cap = player?.capitalSystemId === s.id;
        ctx.fillStyle = own ? (cap ? "#F5C542" : "#4FC3F7") : known ? "#66799A" : "#38414F";
        const x = rnd(sx(s.x));
        const y = rnd(sy(s.y));
        const size = cap ? 3 : 2;
        ctx.fillRect(x - (size >> 1), y - (size >> 1), size, size);
      }
      // рамка текущего вида (синхронна зуму неба)
      const cam = game.mapView;
      if (cam) {
        const fx0 = Math.max(0, Math.min(1, (cam.centerX - cam.halfWidth - b.minX) / spanX));
        const fx1 = Math.max(0, Math.min(1, (cam.centerX + cam.halfWidth - b.minX) / spanX));
        const fy0 = Math.max(0, Math.min(1, (cam.centerY - cam.halfHeight - b.minY) / spanY));
        const fy1 = Math.max(0, Math.min(1, (cam.centerY + cam.halfHeight - b.minY) / spanY));
        ctx.strokeStyle = "#F5C542";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          rnd(pad + fx0 * w) + 0.5,
          rnd(pad + fy0 * h) + 0.5,
          Math.max(2, rnd((fx1 - fx0) * w)),
          Math.max(2, rnd((fy1 - fy0) * h)),
        );
      }
      // выбранная система
      if (state.selectedSystemId != null) {
        const s = world.systems.find((x) => x.id === state.selectedSystemId);
        if (s) {
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 1;
          ctx.strokeRect(rnd(sx(s.x)) - 3.5, rnd(sy(s.y)) - 3.5, 7, 7);
        }
      }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 250) return;
      last = now;
      draw();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, state.selectedSystemId, state.seed]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = game.hasWorld ? game.world : null;
    const b = viewBoundsRef.current;
    if (!world || !b) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const wx = b.minX + px * (b.maxX - b.minX);
    const wy = b.minY + py * (b.maxY - b.minY);
    let best: { id: number; d: number } | null = null;
    for (const s of world.systems) {
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (!best || d < best.d) best = { id: s.id, d };
    }
    if (best) game.focusSystem(best.id);
  };

  return (
    <div className="sf-minimap" data-testid="minimap">
      <div className="sf-minimap-title">
        <span>{L("ГАЛАКТИКА", "GALAXY")}</span>
        <span>{intText(state.tick)}</span>
      </div>
      <canvas ref={canvasRef} width={160} height={120} onClick={onClick} aria-label={L("Мини-карта галактики", "Galaxy minimap")} />
      <div className="sf-legend">
        <span><i style={{ background: "#F5C542" }} />{L("столица", "capital")}</span>
        <span><i style={{ background: "#4FC3F7" }} />{L("своя", "own")}</span>
        <span><i style={{ background: "#66799A" }} />{L("известная", "known")}</span>
        <span><i style={{ background: "#38414F" }} />{L("неизвестная", "unknown")}</span>
        <span><i style={{ background: "#FF5A5A" }} />{L("бой", "battle")}</span>
      </div>
    </div>
  );
}