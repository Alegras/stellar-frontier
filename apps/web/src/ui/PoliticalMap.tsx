import { useEffect, useMemo, useRef, useState } from "react";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import { empireColor } from "./fg";
import { intText, worldOf } from "./util";

const W = 236;
const H = 160;
const PAD = 4;

type MapBounds = { seed: number; minX: number; maxX: number; minY: number; maxY: number };
function minimapBounds(game: Game, full: MapBounds, aspect: number): MapBounds {
  const cam = game.mapView;
  if (!cam || game.mapZoom <= 1.02) return full;
  const fullW = full.maxX - full.minX || 1;
  const fullH = full.maxY - full.minY || 1;
  let vw = Math.max(1, cam.halfWidth * 2 * 1.25);
  let vh = Math.max(1, cam.halfHeight * 2 * 1.25);
  if (vw / vh > aspect) vh = vw / aspect; else vw = vh * aspect;
  vw = Math.min(vw, fullW * 1.02); vh = Math.min(vh, fullH * 1.02);
  const cx = fullW <= vw ? (full.minX + full.maxX) / 2 : Math.max(full.minX + vw / 2, Math.min(full.maxX - vw / 2, cam.centerX));
  const cy = fullH <= vh ? (full.minY + full.maxY) / 2 : Math.max(full.minY + vh / 2, Math.min(full.maxY - vh / 2, cam.centerY));
  return { seed: full.seed, minX: cx - vw / 2, maxX: cx + vw / 2, minY: cy - vh / 2, maxY: cy + vh / 2 };
}

/**
 * Политическая карта галактики: соседний с миникартой обзор владений.
 * Показывает известные системы цветом империи-владельца, границы между империями,
 * столицу, выбранную систему и рамку текущего вида. Клик — фокус/выбор системы.
 */
export function PoliticalMap({ game, state }: { game: Game; state: GameState }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boundsRef = useRef<MapBounds | null>(null);
  const viewBoundsRef = useRef<MapBounds | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const world = worldOf(game);

  const legend = useMemo(() => {
    if (!world) return [];
    const counts = new Map<number, number>();
    for (const s of world.systems) {
      if (s.ownerId > 0 && s.knownBy.includes(world.playerEmpireId)) counts.set(s.ownerId, (counts.get(s.ownerId) ?? 0) + 1);
    }
    return world.empires
      .filter((e) => counts.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, color: empireColor(world, e.id), count: counts.get(e.id) ?? 0, capital: e.capitalSystemId }))
      .sort((a, b) => (a.id === world.playerEmpireId ? -1 : b.id === world.playerEmpireId ? 1 : b.count - a.count))
      .slice(0, 6);
  }, [world, world?.tick]);

  useEffect(() => {
    if (collapsed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#05070E";
      ctx.fillRect(0, 0, W, H);
      const w = worldOf(game);
      if (!w) return;
      if (!boundsRef.current || boundsRef.current.seed !== w.seed) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const s of w.systems) {
          if (s.x < minX) minX = s.x;
          if (s.x > maxX) maxX = s.x;
          if (s.y < minY) minY = s.y;
          if (s.y > maxY) maxY = s.y;
        }
        boundsRef.current = { seed: w.seed, minX, maxX, minY, maxY };
      }
      const full = boundsRef.current;
      if (!full) return;
      const b = minimapBounds(game, full, W / H);
      viewBoundsRef.current = b;
      const spanX = b.maxX - b.minX || 1;
      const spanY = b.maxY - b.minY || 1;
      const iw = W - PAD * 2;
      const ih = H - PAD * 2;
      const sx = (x: number) => PAD + ((x - b.minX) / spanX) * iw;
      const sy = (y: number) => PAD + ((y - b.minY) / spanY) * ih;
      const playerId = w.playerEmpireId;
      const player = w.empires.find((e) => e.id === playerId);

      // 1) территории: полупрозрачные круги вокруг известных владений
      for (const s of w.systems) {
        if (s.ownerId <= 0 || !s.knownBy.includes(playerId)) continue;
        ctx.fillStyle = empireColor(w, s.ownerId) + "33";
        ctx.beginPath();
        ctx.arc(sx(s.x), sy(s.y), 11, 0, Math.PI * 2);
        ctx.fill();
      }
      // 2) границы: гиперлиния между системами разных империй
      ctx.lineWidth = 1.5;
      for (const s of w.systems) {
        if (s.ownerId <= 0 || !s.knownBy.includes(playerId)) continue;
        for (const to of s.links) {
          if (to <= s.id) continue;
          const t = w.systems[to];
          if (!t || t.ownerId <= 0 || t.ownerId === s.ownerId || !t.knownBy.includes(playerId)) continue;
          ctx.strokeStyle = "#F5C542";
          ctx.beginPath();
          ctx.moveTo(sx(s.x), sy(s.y));
          ctx.lineTo(sx(t.x), sy(t.y));
          ctx.stroke();
        }
      }
      // 3) системы: цвет владельца / серая известная / тёмная неизвестная
      for (const s of w.systems) {
        const known = s.knownBy.includes(playerId);
        const x = Math.round(sx(s.x));
        const y = Math.round(sy(s.y));
        if (!known) {
          ctx.fillStyle = "#38414F";
          ctx.fillRect(x, y, 1, 1);
          continue;
        }
        const cap = player?.capitalSystemId === s.id;
        const size = s.ownerId > 0 ? 3 : 2;
        ctx.fillStyle = s.ownerId > 0 ? empireColor(w, s.ownerId) : "#66799A";
        ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
        if (cap) {
          ctx.strokeStyle = "#F5C542";
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
        }
      }
      // 4) рамка текущего вида (синхронна зуму неба)
      const cam = game.mapView;
      if (cam) {
        const fx0 = Math.max(0, Math.min(1, (cam.centerX - cam.halfWidth - b.minX) / spanX));
        const fx1 = Math.max(0, Math.min(1, (cam.centerX + cam.halfWidth - b.minX) / spanX));
        const fy0 = Math.max(0, Math.min(1, (cam.centerY - cam.halfHeight - b.minY) / spanY));
        const fy1 = Math.max(0, Math.min(1, (cam.centerY + cam.halfHeight - b.minY) / spanY));
        ctx.strokeStyle = "#4FC3F7";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          Math.round(PAD + fx0 * iw) + 0.5,
          Math.round(PAD + fy0 * ih) + 0.5,
          Math.max(2, Math.round((fx1 - fx0) * iw)),
          Math.max(2, Math.round((fy1 - fy0) * ih)),
        );
      }
      // 5) выбранная система
      if (state.selectedSystemId != null) {
        const s = w.systems[state.selectedSystemId];
        if (s) {
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(sx(s.x)) - 3.5, Math.round(sy(s.y)) - 3.5, 7, 7);
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
  }, [game, collapsed, state.selectedSystemId, state.seed, state.tick]);

  const nearest = (clientX: number, clientY: number): number | null => {
    const w = worldOf(game);
    const b = boundsRef.current;
    const canvas = canvasRef.current;
    if (!w || !b || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const wx = b.minX + px * (b.maxX - b.minX);
    const wy = b.minY + py * (b.maxY - b.minY);
    let best: { id: number; d: number } | null = null;
    for (const s of w.systems) {
      if (!s.knownBy.includes(w.playerEmpireId)) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (!best || d < best.d) best = { id: s.id, d };
    }
    return best?.id ?? null;
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const id = nearest(e.clientX, e.clientY);
    const w = worldOf(game);
    if (id == null || !w) { setHover(null); return; }
    const s = w.systems[id];
    const owner = s.ownerId > 0 ? w.empires.find((x) => x.id === s.ownerId)?.name ?? "—" : "нейтральная";
    setHover(s.name + " · " + owner);
  };
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const id = nearest(e.clientX, e.clientY);
    if (id == null) return;
    game.focusSystem(id);
    game.selectSystem(id);
  };

  return (
    <div className={"sf-political-map" + (collapsed ? " sf-political-map--collapsed" : "")} data-testid="political-map">
      <div className="sf-political-map__title">
        <span>ПОЛИТИЧЕСКАЯ КАРТА</span>
        <button
          type="button"
          className="sf-btn sf-btn--sm"
          data-testid="btn-toggle-political-map"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Развернуть политическую карту" : "Свернуть политическую карту"}
          title={collapsed ? "Развернуть" : "Свернуть"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
      {!collapsed && (
        <>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            onClick={onClick}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            aria-label="Политическая карта галактики"
            data-testid="political-map-canvas"
          />
          <div className="sf-political-map__status" data-testid="political-map-status">
            {hover ?? "Клик — выбрать систему · цвет — империя-владелец"}
          </div>
          <div className="sf-political-map__legend">
            {legend.map((e) => (
              <button
                key={e.id}
                type="button"
                className="sf-political-map__legend-row"
                data-testid={"political-legend-" + e.id}
                onClick={() => { if (e.capital != null) { game.focusSystem(e.capital); game.selectSystem(e.capital); } }}
                title={e.name + ": " + intText(e.count) + " систем"}
              >
                <i style={{ background: e.color }} />
                <span className="sf-nowrap">{e.name}</span>
                <span className="sf-spacer" />
                <span className="sf-dim">{intText(e.count)}</span>
              </button>
            ))}
            {legend.length === 0 && <span className="sf-meta">Нет известных владений</span>}
          </div>
        </>
      )}
    </div>
  );
}