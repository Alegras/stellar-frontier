import { useEffect, useMemo, useRef, useState } from "react";
import type { Battle, Obstacle, Stack, Terrain } from "./model";
import {
  CLASS_RU, COLS, FIELD_H, FIELD_W, HEX_W, ROWS, distance, hexCenter,
  obstacleAt, pixelToHex, stackAt,
} from "./model";

const SIDE_COLOR = { player: "#4FC3F7", enemy: "#FF6B6B" } as const;
const CLASS_CODE: Record<string, string> = { corvette: "CV", frigate: "FR", destroyer: "DD", cruiser: "CA", battleship: "BB", carrier: "CVN", titan: "TT", colossus: "CL" };
const TERRAIN_COLOR: Record<Terrain, string> = { void: "#0B1422", asteroid: "#242018", nebula: "#1B1730", debris: "#1B2028", minefield: "#281818", gravity_anomaly: "#142033" };
const TERRAIN_RU: Record<Terrain, string> = { void: "пусто", asteroid: "астероид", nebula: "туманность", debris: "обломки", minefield: "мины", gravity_anomaly: "гравитация" };

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale = 1): void {
  const rx = 14 * scale, ry = 16 * scale;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Чистое тактическое поле: ровная сетка, читаемые токены, эффекты и анимация хода. */
export function HexField({ battle, reach, targets, selectedTargetId, targetObstacle, onHexClick, onHover, reducedMotion }: {
  battle: Battle;
  reach: Array<{ q: number; r: number }>;
  targets: Stack[];
  selectedTargetId?: string | null;
  targetObstacle?: { q: number; r: number } | null;
  onHexClick: (q: number, r: number) => void;
  onHover: (q: number, r: number) => void;
  reducedMotion: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<{ q: number; r: number } | null>(null);
  const [tick, setTick] = useState(0);
  const targetIds = useMemo(() => new Set(targets.map((t) => t.id)), [targets]);
  const reachSet = useMemo(() => new Set(reach.map((h) => h.q + "," + h.r)), [reach]);

  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0; let last = 0;
    const loop = (now: number) => { raf = requestAnimationFrame(loop); if (now - last < 50) return; last = now; setTick((v) => v + 1); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 2× backing store: текст и линии остаются гладкими при растяжении на весь экран.
    ctx.imageSmoothingEnabled = true;
    const scale = 2;
    canvas.width = FIELD_W * scale; canvas.height = FIELD_H * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // Ровный фон без мозаичного шума.
    const bg = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    bg.addColorStop(0, "#060B14"); bg.addColorStop(0.5, "#081120"); bg.addColorStop(1, "#050A12");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    ctx.fillStyle = "#1A2940";
    for (let i = 0; i < 55; i++) { const x = (i * 97 + 31) % FIELD_W, y = (i * 61 + 17) % FIELD_H; ctx.fillRect(x, y, 1, 1); }

    const center = (q: number, r: number) => hexCenter(q, r);
    const active = battle.stacks.find((s) => s.id === battle.activeId) ?? null;
    const selectedTarget = selectedTargetId ? battle.stacks.find((s) => s.id === selectedTargetId) ?? null : null;
    const now = performance.now();

    // Сетка и местность.
    for (let r = 0; r < ROWS; r++) {
      for (let q = 0; q < COLS; q++) {
        const { x, y } = center(q, r);
        const t = obstacleAt(battle, q, r);
        hexPath(ctx, x, y);
        ctx.fillStyle = TERRAIN_COLOR[t] ?? "#0B1422";
        ctx.fill();
        ctx.strokeStyle = t === "void" ? "#1C2A40" : "#3B4A60";
        ctx.lineWidth = 1; ctx.stroke();
        if (t !== "void") {
          // Простая читаемая пиктограмма местности, без шумных спрайтов.
          ctx.save(); ctx.globalAlpha = 0.9;
          if (t === "asteroid" || t === "debris") {
            ctx.fillStyle = t === "asteroid" ? "#5E5547" : "#4B5664";
            ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#262B30"; ctx.beginPath(); ctx.arc(x - 2, y - 1, 2, 0, Math.PI * 2); ctx.fill();
          } else if (t === "nebula") {
            ctx.fillStyle = "rgba(140,90,255,.25)"; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
          } else if (t === "minefield") {
            ctx.fillStyle = "#FF8A5A"; for (let i = 0; i < 3; i++) ctx.fillRect(x - 6 + i * 5, y - 2 - (i % 2) * 3, 2, 2);
          } else if (t === "gravity_anomaly") {
            ctx.strokeStyle = "#69A7FF"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.restore();
        }
        if (reachSet.has(q + "," + r)) {
          hexPath(ctx, x, y, 0.92); ctx.fillStyle = "rgba(79,195,247,.20)"; ctx.fill();
          ctx.strokeStyle = "#4FC3F7"; ctx.lineWidth = 1.6; ctx.stroke();
        }
        if (battle.cursor.q === q && battle.cursor.r === r) { hexPath(ctx, x, y, 1.02); ctx.strokeStyle = "#F5C542"; ctx.lineWidth = 2; ctx.stroke(); }
      }
    }

    // Линия выбранной цели — визуальная обратная связь, а не «декоративный» пунктир.
    const targetPos = selectedTarget ?? (selectedTargetId ? null : null);
    if (active && active.side === "player") {
      const hover = hoverRef.current;
      const hoverStack = hover ? stackAt(battle, hover.q, hover.r) : null;
      const goal = selectedTarget ?? (hoverStack && hoverStack.side === "enemy" ? hoverStack : null);
      if (goal) {
        const a = center(active.q, active.r), b = center(goal.q, goal.r);
        ctx.save(); ctx.strokeStyle = "#F5C542"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#F5C542"; ctx.beginPath(); ctx.arc(b.x, b.y - 22, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    void targetPos;

    const drawStack = (s: Stack) => {
      if (!s.alive || s.reserve) return;
      let { x, y } = center(s.q, s.r);
      // Плавное перемещение по последнему move-событию.
      const mv = [...battle.lastEffects].reverse().find((e) => e.kind === "move" && e.to.q === s.q && e.to.r === s.r);
      if (mv) {
        const age = (now - mv.t) / 280;
        if (age >= 0 && age < 1) {
          const a0 = center(mv.from.q, mv.from.r), b0 = center(mv.to.q, mv.to.r);
          x = a0.x + (b0.x - a0.x) * age; y = a0.y + (b0.y - a0.y) * age;
        }
      }
      const color = SIDE_COLOR[s.side];
      const isActive = s.id === battle.activeId;
      const isTarget = targetIds.has(s.id) || s.id === selectedTargetId;
      hexPath(ctx, x, y, 0.86); ctx.fillStyle = "rgba(5,7,14,.55)"; ctx.fill();

      // Читаемый токен: крупная окружность с кодом класса.
      ctx.beginPath(); ctx.arc(x, y - 6, 13, 0, Math.PI * 2);
      ctx.fillStyle = s.side === "player" ? "#0A1A2A" : "#2A1116"; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = isTarget ? 3 : 2; ctx.stroke();
      if (isActive) { ctx.beginPath(); ctx.arc(x, y - 6, 16, 0, Math.PI * 2); ctx.strokeStyle = "#F5C542"; ctx.lineWidth = 2; ctx.stroke(); }
      if (isTarget) { ctx.beginPath(); ctx.arc(x, y - 6, 17, 0, Math.PI * 2); ctx.strokeStyle = "#FF5A5A"; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = color; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(CLASS_CODE[s.cls] ?? "?", x, y - 6);
      // количество
      ctx.fillStyle = "#05070E"; ctx.fillRect(x - 12, y - 27, 24, 11);
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x - 12, y - 27, 24, 11);
      ctx.fillStyle = "#E8EEF7"; ctx.font = "bold 9px monospace"; ctx.fillText(String(s.count), x, y - 21);
      // HP
      const pct = Math.max(0, Math.min(1, s.hp / Math.max(1, s.maxHp)));
      ctx.fillStyle = "#211016"; ctx.fillRect(x - 16, y + 10, 32, 4);
      ctx.fillStyle = pct > 0.5 ? "#6BE675" : pct > 0.2 ? "#F5C542" : "#FF5A5A"; ctx.fillRect(x - 16, y + 10, 32 * pct, 4);
      if (s.defended) { ctx.fillStyle = "#4FC3F7"; ctx.fillRect(x - 19, y - 10, 4, 7); }
    };
    for (const s of battle.stacks) drawStack(s);

    // Эффекты боя.
    for (const e of battle.lastEffects) {
      const age = (now - e.t) / 700;
      if (age < 0 || age > 1) continue;
      const from = center(e.from.q, e.from.r), to = center(e.to.q, e.to.r);
      ctx.save(); ctx.globalAlpha = 1 - age;
      if (e.kind === "move") {
        ctx.strokeStyle = "rgba(79,195,247,.8)"; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = e.kind === "shield" ? "#4FC3F7" : "#FFD36A";
        ctx.lineWidth = 3; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        const px = from.x + (to.x - from.x) * Math.min(1, age * 2), py = from.y + (to.y - from.y) * Math.min(1, age * 2);
        ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
        const rad = 8 + age * 24;
        ctx.beginPath(); ctx.arc(to.x, to.y, rad, 0, Math.PI * 2);
        ctx.strokeStyle = e.kind === "shield" ? "rgba(79,195,247,.95)" : "rgba(255,211,106,.95)";
        ctx.lineWidth = 3; ctx.stroke();
        if (e.kind === "shield") { ctx.beginPath(); ctx.arc(to.x, to.y, rad + 7, 0, Math.PI * 2); ctx.strokeStyle = "rgba(120,220,255,.55)"; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.restore();
    }

    // Числа урона.
    for (const d of battle.lastDamage) {
      const age = (now - d.t) / 900; if (age > 1) continue;
      const { x, y } = center(d.q, d.r); ctx.globalAlpha = Math.max(0, 1 - age);
      ctx.fillStyle = "#FFD36A"; ctx.font = "bold 14px monospace"; ctx.textAlign = "center";
      ctx.fillText("-" + d.amount, x, y - 30 - age * 16);
      ctx.globalAlpha = 1;
    }

    // Нижняя строка с координатами/местностью.
    const hover = hoverRef.current;
    const ht = hover ? obstacleAt(battle, hover.q, hover.r) : "void";
    ctx.fillStyle = "#8FA3BF"; ctx.font = "10px monospace"; ctx.textAlign = "left";
    ctx.fillText("гексы 15×11 · SP · " + TERRAIN_RU[ht] + (hover ? " (q" + hover.q + ",r" + hover.r + ")" : ""), 8, FIELD_H - 8);
  }, [battle, battle.cursor, battle.activeId, battle.lastDamage, battle.lastEffects, reachSet, targetIds, tick, selectedTargetId, targetObstacle]);

  const toHex = (ev: React.PointerEvent<HTMLCanvasElement>): { q: number; r: number } => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (FIELD_W / rect.width);
    const y = (ev.clientY - rect.top) * (FIELD_H / rect.height);
    return pixelToHex(x, y);
  };
  return (
    <canvas
      ref={ref}
      className="sf-hexfield"
      data-testid="grid-hex-canvas"
      style={{ width: "100%", height: "auto", aspectRatio: FIELD_W + "/" + FIELD_H, imageRendering: "auto", cursor: "crosshair" }}
      onPointerMove={(ev) => { const h = toHex(ev); hoverRef.current = h; onHover(h.q, h.r); }}
      onPointerLeave={() => { hoverRef.current = null; }}
      onPointerDown={(ev) => { if (ev.button !== 0) return; const h = toHex(ev); onHexClick(h.q, h.r); }}
    />
  );
}
