import { useEffect, useMemo, useRef, useState } from "react";
import type { Battle, Stack } from "./model";
import {
  CLASS_RU, COLS, FIELD_H, FIELD_W, HEX_H, HEX_W, ROWS, TERRAIN_RU, distance, hexCenter,
  obstacleAt, pixelToHex, stackAt, terrainBlocksLos, terrainBlocksMove,
} from "./model";

interface ArtAsset { path: string; frameW: number; frameH: number; frames: number; fps: number; loop: boolean; anchor?: [number, number] }
interface ArtManifest { tiles?: Record<string, ArtAsset>; units?: Record<string, Record<string, ArtAsset>>; effects?: Record<string, ArtAsset>; backgrounds?: Record<string, unknown> }
const TERRAIN_ART: Record<string, string> = { void: "empty", debris: "wreck", minefield: "mines", gravity_anomaly: "gravity", asteroid: "asteroid", nebula: "nebula" };
const TERRAIN_COLOR: Record<string, string> = { void: "#101A2E", asteroid: "#5C5044", nebula: "#3A2B5C", debris: "#3A4048", minefield: "#4A2A2A", gravity_anomaly: "#2A3A56" };
const SIDE_COLOR = { player: "#4FC3F7", enemy: "#FF5A5A" } as const;
const CLASS_CODE: Record<string, string> = { corvette: "CV", frigate: "FR", destroyer: "DD", cruiser: "CA", battleship: "BB", carrier: "CVN", titan: "TT", colossus: "CL" };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("img")); img.src = src; });
}
function artUrl(path: string): string { return path.startsWith("/") ? path : "/battle/" + path; }

/** Пиксельный 2.5D-гекс-рендер 15×11: canvas с nearest-масштабированием + graceful fallback без ассетов. */
export function HexField({ battle, reach, targets, onHexClick, onHover, reducedMotion }: {
  battle: Battle;
  reach: Array<{ q: number; r: number }>;
  targets: Stack[];
  onHexClick: (q: number, r: number) => void;
  onHover: (q: number, r: number) => void;
  reducedMotion: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<{ q: number; r: number } | null>(null);
  const [manifest, setManifest] = useState<ArtManifest | null>(null);
  const artRef = useRef<{ tiles: Record<string, HTMLImageElement>; units: Record<string, HTMLImageElement> }>({ tiles: {}, units: {} });
  const hoverState = useState(0)[1];
  const [artTick, setArtTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/battle/manifest.json");
        if (!res.ok) return;
        const man = (await res.json()) as ArtManifest;
        if (!alive) return;
        setManifest(man);
        const tiles: Record<string, HTMLImageElement> = {};
        for (const [k, a] of Object.entries(man.tiles ?? {})) { try { tiles[k] = await loadImage(artUrl(a.path)); } catch { /* fallback */ } }
        const units: Record<string, HTMLImageElement> = {};
        for (const side of ["player", "enemy"]) for (const [cls, a] of Object.entries(man.units?.[side] ?? {})) { try { units[side + ":" + cls] = await loadImage(artUrl(a.path)); } catch { /* fallback */ } }
        if (alive) artRef.current = { tiles, units };
      } catch { /* graceful fallback */ }
    })();
    return () => { alive = false; };
  }, []);

  // анимация idle/эффектов (отключается prefers-reduced-motion)
  useEffect(() => {
    if (reducedMotion || !manifest) return;
    let raf = 0; let last = 0;
    const tick = (now: number) => { raf = requestAnimationFrame(tick); if (now - last < 120) return; last = now; setArtTick((v) => v + 1); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest, reducedMotion]);

  const targetIds = useMemo(() => new Set(targets.map((t) => t.id)), [targets]);
  const reachSet = useMemo(() => new Set(reach.map((h) => h.q + "," + h.r)), [reach]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const dpr = 1;
    canvas.width = FIELD_W * dpr; canvas.height = FIELD_H * dpr;
    // фон
    const bg = ctx.createLinearGradient(0, 0, FIELD_W, FIELD_H);
    bg.addColorStop(0, "#05070E"); bg.addColorStop(0.5, "#0A1020"); bg.addColorStop(1, "#070B16");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    // звёзды
    ctx.fillStyle = "#26344A";
    for (let i = 0; i < 90; i++) { const x = (i * 73 + 19) % FIELD_W, y = (i * 47 + 31) % FIELD_H; ctx.fillRect(x, y, 1, 1); }
    const hexPath = (cx: number, cy: number, scale = 1): void => {
      ctx.beginPath();
      const rx = 14 * scale, ry = 16 * scale;
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath();
    };
    const t = artTick / 6;
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const { x, y } = hexCenter(q, r); const terrain = obstacleAt(battle, q, r);
      const artKey = TERRAIN_ART[terrain] ?? "empty";
      const img = artRef.current.tiles[artKey];
      const meta = manifest?.tiles?.[artKey];
      // 2.5D подложка-тень
      hexPath(x + 2, y + 3); ctx.fillStyle = "#03050A"; ctx.fill();
      hexPath(x, y);
      if (img && meta) {
        const frame = meta.frames > 1 && meta.loop ? Math.floor(t * meta.fps) % meta.frames : 0;
        ctx.drawImage(img, frame * meta.frameW, 0, meta.frameW, meta.frameH, x - 16, y - 18, 32, 36);
      } else {
        ctx.fillStyle = TERRAIN_COLOR[terrain] ?? "#101A2E"; ctx.fill();
        ctx.strokeStyle = terrain === "void" ? "#24324A" : "#7A6A4A"; ctx.lineWidth = 1; ctx.stroke();
      }
      if (reachSet.has(q + "," + r)) { hexPath(x, y, 0.92); ctx.fillStyle = "rgba(79,195,247,.16)"; ctx.fill(); ctx.strokeStyle = "#4FC3F7"; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (battle.cursor.q === q && battle.cursor.r === r) { hexPath(x, y, 1.03); ctx.strokeStyle = "#F5C542"; ctx.lineWidth = 2; ctx.stroke(); }
    }
    // LOS-линия от активного к наведённой цели (для стрелка)
    const active = battle.stacks.find((s) => s.id === battle.activeId);
    const hover = hoverRef.current;
    if (active && hover && active.side === "player") {
      const hoverStack = stackAt(battle, hover.q, hover.r);
      if (hoverStack && hoverStack.side === "enemy") {
        const a = hexCenter(active.q, active.r), b = hexCenter(hover.q, hover.r);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = active.range > 1 && !hasLos(battle, active, hover) ? "#FF5A5A" : "#F5C542";
        ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // стэки
    const drawStack = (s: Stack) => {
      if (!s.alive || s.reserve) return;
      const { x, y } = hexCenter(s.q, s.r); const color = SIDE_COLOR[s.side];
      const isActive = s.id === battle.activeId;
      const targeted = targetIds.has(s.id);
      if (isActive) { ctx.strokeStyle = "#F5C542"; ctx.lineWidth = 2; hexPath(x, y, 1.02); ctx.stroke(); }
      if (targeted) { ctx.fillStyle = "rgba(255,90,90,.14)"; hexPath(x, y, 0.95); ctx.fill(); }
      const img = artRef.current.units[s.side + ":" + s.cls];
      if (img) {
        ctx.drawImage(img, 0, 0, 64, 64, x - 24, y - 38, 48, 48);
      } else {
        ctx.beginPath();
        if (s.side === "player") { ctx.arc(x, y - 4, 13, 0, Math.PI * 2); } else { ctx.moveTo(x, y - 18); ctx.lineTo(x + 14, y + 6); ctx.lineTo(x - 14, y + 6); ctx.closePath(); }
        ctx.fillStyle = "#0C1626"; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = color; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(CLASS_CODE[s.cls] ?? "?", x, y - 4);
      }
      // бейдж количества
      ctx.fillStyle = "rgba(5,7,14,.9)"; ctx.fillRect(x - 13, y - 28, 26, 11);
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x - 13, y - 28, 26, 11);
      ctx.fillStyle = "#E8EEF7"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(s.count), x, y - 22);
      // hp bar
      const pct = Math.max(0, Math.min(1, s.hp / s.maxHp));
      ctx.fillStyle = "#241016"; ctx.fillRect(x - 16, y + 8, 32, 4);
      ctx.fillStyle = pct > 0.5 ? "#6BE675" : pct > 0.2 ? "#F5C542" : "#FF5A5A"; ctx.fillRect(x - 16, y + 8, 32 * pct, 4);
      if (s.defended) { ctx.fillStyle = "#4FC3F7"; ctx.fillRect(x - 18, y - 8, 5, 5); }
      if (s.waited) { ctx.fillStyle = "#8FA3BF"; ctx.fillRect(x + 13, y - 8, 5, 5); }
      if (s.side === "player" && !s.moved && isActive) { ctx.fillStyle = "#F5C542"; ctx.beginPath(); ctx.moveTo(x, y - 38); ctx.lineTo(x + 5, y - 32); ctx.lineTo(x - 5, y - 32); ctx.fill(); }
    };
    for (const s of battle.stacks) if (!s.reserve) drawStack(s);
    // числа урона
    const now = Date.now();
    for (const d of battle.lastDamage) {
      const age = (now - d.t) / 1000; if (age > 0.9) continue;
      const { x, y } = hexCenter(d.q, d.r); ctx.globalAlpha = Math.max(0, 1 - age);
      ctx.fillStyle = "#FFD36A"; ctx.font = "bold 11px monospace"; ctx.textAlign = "center";
      ctx.fillText("-" + d.amount, x, y - 32 - age * 18); ctx.globalAlpha = 1;
    }
    // легенда местности
    ctx.fillStyle = "#8FA3BF"; ctx.font = "8px monospace"; ctx.textAlign = "left";
    ctx.fillText("гексы 15×11 · " + (battle.coop ? "кооп" : "SP") + " · " + TERRAIN_RU[obstacleAt(battle, battle.cursor.q, battle.cursor.r)] + " (q" + battle.cursor.q + ",r" + battle.cursor.r + ")", 8, FIELD_H - 8);
  }, [battle, battle.cursor, battle.activeId, battle.lastDamage, reachSet, targetIds, manifest, artTick]);

  const handle = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>, click: boolean): void => {
    const canvas = ref.current; if (!canvas) return; const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * FIELD_W; const y = (e.clientY - rect.top) / rect.height * FIELD_H;
    const hex = pixelToHex(x, y); hoverRef.current = hex; onHover(hex.q, hex.r); if (click) onHexClick(hex.q, hex.r);
  };
  return <canvas ref={ref} className="sf-gridhex" data-testid="grid-hex-canvas" width={FIELD_W} height={FIELD_H} style={{ width: "100%", height: "auto", imageRendering: "pixelated", touchAction: "none" }} onPointerMove={(e) => handle(e, false)} onClick={(e) => handle(e, true)} aria-label="Поле боя 15 на 11 гексов" role="img" />;
}
function hasLos(b: Battle, a: { q: number; r: number }, t: { q: number; r: number }): boolean { const n = distance(a, t); if (n <= 1) return true; for (let i = 1; i < n; i++) { const f = i / n; const q = Math.round(a.q + (t.q - a.q) * f), r = Math.round(a.r + (t.r - a.r) * f); if (terrainBlocksLos(obstacleAt(b, q, r))) return false; } return true; }
