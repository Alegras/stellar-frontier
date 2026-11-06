import * as THREE from "three";
import type { StarSystem, World } from "@sf/sim";
import type { GameApi } from "../../game/types";
import type { SceneView } from "../contracts";
import { PixelPipeline } from "../PixelPipeline";

const C = {
  gold: 0xf5c542,
  neutral: 0x8fa3bf,
  unknown: 0x5c6878,
  player: 0xf5c542,
  enemy: 0xff5a5a,
};

function empireColor(hex: string | undefined): string {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  return "#8FA3BF";
}

function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const POINT_VERT = `
attribute vec3 aColor;
attribute float aSize;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.18, d);
  gl_FragColor = vec4(vColor, a);
}
`;

function makePoints(positions: Float32Array, colors: Float32Array, sizes: Float32Array): THREE.Points {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geom.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
  });
  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  return points;
}

interface DragState {
  active: boolean;
  moved: boolean;
  startX: number;
  startY: number;
  centerX: number;
  centerY: number;
}

export class GalaxyView implements SceneView {
  private game: GameApi;
  private canvas: HTMLCanvasElement;
  private pipeline: PixelPipeline;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private world: World;
  private systems: StarSystem[];

  private center = { x: 0, y: 0 };
  private targetCenter = { x: 0, y: 0 };
  private halfHeight = 1000;
  private targetHalfHeight = 1000;
  private fitHalfHeight = 1000;
  private minHalfHeight = 60;
  private maxHalfHeight = 40000;
  private zoom = 1;
  private aspect = 16 / 9;
  private width = 1;
  private height = 1;
  private elapsed = 0;

  private systemLayer!: THREE.Points;
  private haloLayer!: THREE.Points;
  private lanes!: THREE.LineSegments;
  private territory!: THREE.LineSegments;
  private capitalRing!: THREE.Mesh;
  private fleetLayer!: THREE.Points;
  private routeLayer!: THREE.LineSegments;
  private selection!: THREE.Mesh;
  private selectionRing2!: THREE.Mesh;
  private starfield!: THREE.Points;
  private nebulaGroup!: THREE.Group;
  private lastFocusNonce = -1;
  private lastFleetSignature = "";
  private drag: DragState = { active: false, moved: false, startX: 0, startY: 0, centerX: 0, centerY: 0 };

  private disposed = false;
  private cleanups: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, game: GameApi) {
    this.canvas = canvas;
    this.game = game;
    this.world = game.world;
    this.systems = this.world.systems;
    const settings = game.getState().settings;
    this.pipeline = new PixelPipeline(canvas, {
      internalWidth: settings.internalWidth,
      internalHeight: settings.internalHeight,
      dither: settings.dither,
      palette: settings.palette,
      outlines: settings.outlines,
      crt: settings.crt,
      bloom: settings.bloom,
    });
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 40000);
    this.camera.position.set(0, 0, 10000);
    this.setupBackground();
    this.setupGalaxy();
    this.setupSelection();
    this.fitToGalaxy();
    this.game.mapProject = (x, y) => this.project(x, y);
    this.bindInput();
    this.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  }

  private setupBackground(): void {
    const rand = mulberry(this.world.seed ^ 0x9e3779b9);
    const count = 2000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const siz = new Float32Array(count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 80000;
      pos[i * 3 + 1] = (rand() - 0.5) * 80000;
      pos[i * 3 + 2] = -200 + rand() * 100;
      c.setHex(rand() > 0.85 ? 0xf5c542 : rand() > 0.5 ? 0xb7c2d0 : 0x4fc3f7);
      const b = 0.45 + rand() * 0.55;
      col[i * 3] = c.r * b;
      col[i * 3 + 1] = c.g * b;
      col[i * 3 + 2] = c.b * b;
      siz[i] = rand() > 0.9 ? 2 : 1;
    }
    this.starfield = makePoints(pos, col, siz);
    this.scene.add(this.starfield);

    this.nebulaGroup = new THREE.Group();
    const palette = ["#1B2A4A", "#233A5C", "#2A7CA8", "#7A5CFF"];
    const glow = makeGlowTexture("rgba(255,255,255,0.45)", "rgba(255,255,255,0.12)");
    for (let i = 0; i < 14; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          color: new THREE.Color(palette[i % palette.length] ?? "#1B2A4A"),
          transparent: true,
          opacity: 0.1 + rand() * 0.12,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const span = 34000;
      sprite.position.set((rand() - 0.5) * span, (rand() - 0.5) * span, -400 + rand() * 200);
      const s = 6000 + rand() * 16000;
      sprite.scale.set(s, s, 1);
      this.nebulaGroup.add(sprite);
    }
    this.scene.add(this.nebulaGroup);
  }

  private setupGalaxy(): void {
    const n = this.systems.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const siz = new Float32Array(n);
    const color = new THREE.Color();
    const player = this.world.empires.find((e) => e.id === this.world.playerEmpireId);
    for (let i = 0; i < n; i++) {
      const s = this.systems[i]!;
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y;
      pos[i * 3 + 2] = 0;
      const isKnown = player ? s.knownBy.includes(player.id) : false;
      if (s.ownerId === 0) {
        color.setHex(isKnown ? C.neutral : C.unknown);
        siz[i] = isKnown ? 4.5 : 3.2;
      } else if (s.ownerId === this.world.playerEmpireId) {
        color.setHex(C.player);
        siz[i] = 5.5;
      } else {
        color.set(empireColor(this.world.empires.find((e) => e.id === s.ownerId)?.color));
        siz[i] = 4;
      }
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
      if (isKnown && s.chokepoint) siz[i] += 1.5;
    }
    this.systemLayer = makePoints(pos, col, siz);
    this.scene.add(this.systemLayer);

    const haloPos = new Float32Array(n * 3);
    const haloCol = new Float32Array(n * 3);
    const haloSiz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = this.systems[i]!;
      haloPos[i * 3] = s.x;
      haloPos[i * 3 + 1] = s.y;
      haloPos[i * 3 + 2] = -1;
      if (s.ownerId !== 0) {
        const owner = this.world.empires.find((e) => e.id === s.ownerId);
        color.set(empireColor(owner?.color));
        haloSiz[i] = 15;
      } else {
        color.setHex(0x101a2e);
        haloSiz[i] = 0.1;
      }
      haloCol[i * 3] = color.r * 0.32;
      haloCol[i * 3 + 1] = color.g * 0.32;
      haloCol[i * 3 + 2] = color.b * 0.32;
    }
    this.haloLayer = makePoints(haloPos, haloCol, haloSiz);
    (this.haloLayer.material as THREE.ShaderMaterial).blending = THREE.AdditiveBlending;
    (this.haloLayer.material as THREE.ShaderMaterial).opacity = 0.22;
    this.scene.add(this.haloLayer);

    const segs: number[] = [];
    const segCols: number[] = [];
    for (const s of this.systems) {
      for (const link of s.links) {
        if (link <= s.id) continue;
        const t = this.systems.find((x) => x.id === link);
        if (!t) continue;
        segs.push(s.x, s.y, 0, t.x, t.y, 0);
        const known = player ? s.knownBy.includes(player.id) || t.knownBy.includes(player.id) : false;
        color.setHex(known ? 0x2a7ca8 : 0x2e4a70);
        segCols.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
    }
    const laneGeom = new THREE.BufferGeometry();
    laneGeom.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
    laneGeom.setAttribute("color", new THREE.Float32BufferAttribute(segCols, 3));
    this.lanes = new THREE.LineSegments(
      laneGeom,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthTest: false }),
    );
    this.lanes.frustumCulled = false;
    this.scene.add(this.lanes);

    // территориальные связи: линии между собственными системами империй
    const terrSegs: number[] = [];
    const terrCols: number[] = [];
    for (const emp of this.world.empires) {
      if (emp.id === 0) continue;
      const owned = this.systems.filter((s) => s.ownerId === emp.id);
      if (owned.length < 2) continue;
      color.set(empireColor(emp.color));
      for (const a of owned) {
        const nearest = owned
          .filter((b) => b.id !== a.id)
          .map((b) => ({ b, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
          .sort((u, v) => u.d - v.d)
          .slice(0, 2);
        for (const { b } of nearest) {
          terrSegs.push(a.x, a.y, -0.5, b.x, b.y, -0.5);
          terrCols.push(color.r * 0.5, color.g * 0.5, color.b * 0.5, color.r * 0.5, color.g * 0.5, color.b * 0.5);
        }
      }
    }
    const terrGeom = new THREE.BufferGeometry();
    terrGeom.setAttribute("position", new THREE.Float32BufferAttribute(terrSegs, 3));
    terrGeom.setAttribute("color", new THREE.Float32BufferAttribute(terrCols, 3));
    this.territory = new THREE.LineSegments(
      terrGeom,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthTest: false }),
    );
    this.territory.frustumCulled = false;
    this.scene.add(this.territory);

    this.fleetLayer = makePoints(new Float32Array(0), new Float32Array(0), new Float32Array(0));
    this.scene.add(this.fleetLayer);

    // маркер столицы игрока
    const playerEmpire = this.world.empires.find((e) => e.id === this.world.playerEmpireId);
    const capital = this.systems.find((s) => s.id === playerEmpire?.capitalSystemId);
    this.capitalRing = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.18, 32),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false }),
    );
    this.capitalRing.visible = !!capital;
    if (capital) this.capitalRing.position.set(capital.x, capital.y, 1);
    this.scene.add(this.capitalRing);

    this.routeLayer = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: C.gold, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.routeLayer.frustumCulled = false;
    this.routeLayer.visible = false;
    this.scene.add(this.routeLayer);
  }

  private setupSelection(): void {
    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 40),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
    );
    this.selection.renderOrder = 10;
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.selectionRing2 = new THREE.Mesh(
      new THREE.RingGeometry(1.35, 1.42, 40),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false }),
    );
    this.selectionRing2.renderOrder = 10;
    this.selectionRing2.visible = false;
    this.scene.add(this.selectionRing2);
  }

  private fitToGalaxy(): void {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of this.systems) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    }
    const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
    const extX = Number.isFinite(maxX) ? Math.max(600, maxX - minX) : 6000;
    const extY = Number.isFinite(maxY) ? Math.max(600, maxY - minY) : 6000;
    this.center = { x: cx, y: cy };
    this.targetCenter = { x: cx, y: cy };
    this.fitHalfHeight = Math.max(extY, extX / Math.max(0.5, this.aspect)) * 0.38;
    this.halfHeight = this.fitHalfHeight;
    this.targetHalfHeight = this.fitHalfHeight;
    this.minHalfHeight = this.fitHalfHeight * 0.06;
    this.maxHalfHeight = this.fitHalfHeight * 2;
    this.applyCamera();
  }

  private applyCamera(): void {
    const halfW = this.halfHeight * this.aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = this.halfHeight;
    this.camera.bottom = -this.halfHeight;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(this.center.x, this.center.y, 10000);
    this.camera.lookAt(this.center.x, this.center.y, 0);
    this.zoom = this.fitHalfHeight / this.halfHeight;
    this.game.mapZoom = this.zoom;
  }

  private screenToWorld(px: number, py: number): { x: number; y: number } {
    const halfW = this.halfHeight * this.aspect;
    return {
      x: this.center.x + (px / this.width - 0.5) * 2 * halfW,
      y: this.center.y - (py / this.height - 0.5) * 2 * this.halfHeight,
    };
  }

  private project(x: number, y: number): { x: number; y: number } | null {
    if (!this.width || !this.height) return null;
    const halfW = this.halfHeight * this.aspect;
    const sx = ((x - this.center.x) / (2 * halfW) + 0.5) * this.width;
    const sy = (0.5 - (y - this.center.y) / (2 * this.halfHeight)) * this.height;
    return { x: sx, y: sy };
  }

  private systemAt(px: number, py: number, maxPx = 26): StarSystem | null {
    let best: StarSystem | null = null;
    let bestD = maxPx * maxPx;
    for (const s of this.systems) {
      const p = this.project(s.x, s.y);
      if (!p) continue;
      const dx = p.x - px;
      const dy = p.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private bindInput(): void {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const before = this.screenToWorld(px, py);
      const factor = Math.pow(1.0016, e.deltaY);
      const newHalf = clampNum(this.targetHalfHeight * factor, this.minHalfHeight, this.maxHalfHeight);
      this.targetHalfHeight = newHalf;
      const halfW = newHalf * this.aspect;
      const after = {
        x: this.targetCenter.x + (px / this.width - 0.5) * 2 * halfW,
        y: this.targetCenter.y - (py / this.height - 0.5) * 2 * newHalf,
      };
      this.targetCenter.x += before.x - after.x;
      this.targetCenter.y += before.y - after.y;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.drag = {
        active: true, moved: false, startX: e.clientX, startY: e.clientY,
        centerX: this.targetCenter.x, centerY: this.targetCenter.y,
      };
      this.canvas.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (this.drag.active) {
        const dx = e.clientX - this.drag.startX;
        const dy = e.clientY - this.drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 5) this.drag.moved = true;
        const wppX = (2 * this.halfHeight * this.aspect) / this.width;
        const wppY = (2 * this.halfHeight) / this.height;
        this.targetCenter.x = this.drag.centerX - dx * wppX;
        this.targetCenter.y = this.drag.centerY + dy * wppY;
        this.center.x = this.targetCenter.x;
        this.center.y = this.targetCenter.y;
        this.applyCamera();
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const sys = this.systemAt(e.clientX - rect.left, e.clientY - rect.top);
        this.canvas.style.cursor = sys ? "pointer" : "grab";
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      const wasDrag = this.drag.moved;
      this.drag.active = false;
      this.canvas.releasePointerCapture?.(e.pointerId);
      if (wasDrag) return;
      const rect = this.canvas.getBoundingClientRect();
      const sys = this.systemAt(e.clientX - rect.left, e.clientY - rect.top);
      if (sys) this.game.selectSystem(sys.id);
    };
    const onDblClick = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const sys = this.systemAt(e.clientX - rect.left, e.clientY - rect.top, 30);
      if (sys) this.game.enterSystem(sys.id);
    };
    const onContext = (e: Event) => e.preventDefault();

    this.canvas.addEventListener("wheel", onWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", onPointerUp);
    this.canvas.addEventListener("dblclick", onDblClick);
    this.canvas.addEventListener("contextmenu", onContext);
    this.cleanups.push(() => {
      this.canvas.removeEventListener("wheel", onWheel);
      this.canvas.removeEventListener("pointerdown", onPointerDown);
      this.canvas.removeEventListener("pointermove", onPointerMove);
      this.canvas.removeEventListener("pointerup", onPointerUp);
      this.canvas.removeEventListener("dblclick", onDblClick);
      this.canvas.removeEventListener("contextmenu", onContext);
    });
  }

  update(dt: number): void {
    this.elapsed += dt;
    const k = 1 - Math.exp(-8 * Math.min(dt, 0.05));
    this.center.x += (this.targetCenter.x - this.center.x) * k;
    this.center.y += (this.targetCenter.y - this.center.y) * k;
    this.halfHeight += (this.targetHalfHeight - this.halfHeight) * k;
    this.applyCamera();

    const focus = this.game.mapFocus;
    if (focus && focus.nonce !== this.lastFocusNonce) {
      this.lastFocusNonce = focus.nonce;
      const sys = this.systems.find((s) => s.id === focus.systemId);
      if (sys) {
        this.targetCenter = { x: sys.x, y: sys.y };
        this.targetHalfHeight = Math.min(this.targetHalfHeight, this.fitHalfHeight * 0.42);
      }
    }

    this.updateSelection();
    this.updateCapitalRing();
    this.updateFleets();
    this.pipeline.render(this.scene, this.camera, this.elapsed);
  }

  private updateSelection(): void {
    const id = this.game.getState().selectedSystemId;
    const sys = id != null ? this.systems.find((s) => s.id === id) : null;
    if (!sys) {
      this.selection.visible = false;
      this.selectionRing2.visible = false;
      return;
    }
    const worldPerPixel = (2 * this.halfHeight) / this.height;
    const r = worldPerPixel * 14;
    const pulse = 1 + Math.sin(this.elapsed * 3.4) * 0.06;
    this.selection.visible = true;
    this.selection.scale.setScalar(r * pulse);
    this.selection.position.set(sys.x, sys.y, 2);
    this.selectionRing2.visible = true;
    this.selectionRing2.scale.setScalar(r * 1.35);
    this.selectionRing2.position.set(sys.x, sys.y, 2);
    this.selectionRing2.rotation.z = this.elapsed * 0.25;
  }

  private updateCapitalRing(): void {
    if (!this.capitalRing.visible) return;
    const worldPerPixel = (2 * this.halfHeight) / this.height;
    const r = worldPerPixel * 20;
    this.capitalRing.scale.setScalar(r * (1 + Math.sin(this.elapsed * 2.1) * 0.04));
    this.capitalRing.rotation.z = -this.elapsed * 0.15;
  }

  private updateFleets(): void {
    const fleets = this.world.fleets.filter((f) => f.ships.length > 0);
    const sig = fleets.map((f) => f.id + ":" + f.systemId + ":" + f.pathIndex).join(",");
    if (sig !== this.lastFleetSignature) {
      this.lastFleetSignature = sig;
      const pos: number[] = [];
      const col: number[] = [];
      const siz: number[] = [];
      const c = new THREE.Color();
      for (const f of fleets) {
        const sys = this.systems.find((s) => s.id === f.systemId);
        if (!sys) continue;
        const isPlayer = f.empireId === this.world.playerEmpireId;
        c.setHex(isPlayer ? C.gold : C.enemy);
        const offset = isPlayer ? 26 : -26;
        pos.push(sys.x, sys.y + offset, 3);
        col.push(c.r, c.g, c.b);
        siz.push(isPlayer ? 9 : 7);
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geom.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
      geom.setAttribute("aSize", new THREE.Float32BufferAttribute(siz, 1));
      this.fleetLayer.geometry.dispose();
      this.fleetLayer.geometry = geom;
    }
    const selectedFleetId = this.game.getState().selectedFleetId;
    const fleet = fleets.find((f) => f.id === selectedFleetId);
    if (fleet) {
      const pts: number[] = [];
      const path = [fleet.systemId, ...fleet.path.slice(fleet.pathIndex)];
      for (let i = 0; i < path.length - 1; i++) {
        const a = this.systems.find((s) => s.id === path[i]);
        const b = this.systems.find((s) => s.id === path[i + 1]);
        if (a && b) pts.push(a.x, a.y, 4, b.x, b.y, 4);
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      this.routeLayer.geometry.dispose();
      this.routeLayer.geometry = geom;
      this.routeLayer.visible = pts.length > 0;
    } else {
      this.routeLayer.visible = false;
    }
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.width = Math.max(1, Math.floor(cssWidth));
    this.height = Math.max(1, Math.floor(cssHeight));
    this.aspect = this.width / this.height;
    this.pipeline.resize(this.width, this.height);
    this.applyCamera();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.cleanups) c();
    this.cleanups = [];
    if (this.game.mapProject) this.game.mapProject = null;
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.pipeline.dispose();
  }
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}