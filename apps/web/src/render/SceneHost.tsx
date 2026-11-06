import { useEffect, useRef } from "react";
import type { Game } from "../game/Game";
import type { GameState } from "../game/types";
import type { SceneView } from "./contracts";
import { GalaxyView } from "./galaxy/GalaxyView";
import { SystemView } from "./system/SystemView";

interface SceneHostProps {
  game: Game;
  state: GameState;
}

/**
 * Хост 3D-сцены: один canvas на всю игру, переключает виды по режиму.
 * RAF-цикл: сначала advance симуляции (такт), затем update вида.
 */
export function SceneHost({ game, state }: SceneHostProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<SceneView | null>(null);
  const kind = state.mode === "galaxy" ? "galaxy" : "system";
  const systemId = state.activeSystemId;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let view: SceneView | null = null;
    try {
      if (kind === "galaxy") {
        view = new GalaxyView(canvas, game);
      } else {
        view = new SystemView(canvas, game, systemId ?? 1);
      }
      if (view) {
        view.resize(wrap.clientWidth, wrap.clientHeight);
        viewRef.current = view;
      }
    } catch (e) {
      console.error("Scene init failed", e);
    }

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      game.advance(dt * 1000);
      try {
        view?.update(dt);
      } catch (e) {
        console.error("Scene update failed", e);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      view?.resize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      view?.dispose();
      viewRef.current = null;
    };
  }, [game, kind, systemId]);

  return (
    <div ref={wrapRef} className="sf-scene-wrap">
      <canvas ref={canvasRef} className="sf-canvas" data-testid="game-canvas" />
    </div>
  );
}