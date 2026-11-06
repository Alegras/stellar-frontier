/**
 * 3D-сцена звёздной системы (docs/03_hybrid_gdd.md §10.2, docs/10_art_direction.md §4.3).
 * Масштаб: 1 unit = 1 м, но система «сжата»: орбиты 12–220 км, чтобы полёт и суперкруиз
 * укладывались в игровой бюджет времени (GDD §10.2: суперкруиз 30–600 c).
 * Всё процедурно: flat shading, vertex colors, CanvasTexture только для спрайтов короны/туманностей.
 */
import * as THREE from "three";
import type { Planet, PlanetType, StarSystem, StarType } from "@sf/sim";
import { PAL, makeGlowTexture, planetColors, starColor, starRadiusM } from "./palette";
import { clamp01, hash01 } from "./util";
import { Rng } from "./rng";
import { SECTOR_CHORUS, SECTOR_MIST, hazardInfo, type SectorVariant } from "./sector";

/** Дальняя плоскость камеры (м): покрывает звёздный фон, туманности и внешние орбиты. */
export const SCENE_FAR_M = 480_000;

/**
 * planet.orbitRadius приходит из симуляции в «игровых единицах»
 * (packages/sim/src/galaxy.ts: 1200 + orbit*900 + size*300 + 4000 для газовых гигантов),
 * т.е. 1200–15 200. Для 3D переводим их в метры (1 unit = 1 м по требованию сцены):
 * 1 игровая единица орбиты = 20 м → система занимает 24–300 км, и суперкруиз
 * 30–600 c (1c = 50 м/с) пролетает её за 5–20 с.
 */
const ORBIT_UNITS_TO_M = 20;
/** Резервный шаг кольца, если orbitRadius пуст: 20 км между планетами. */
const ORBIT_STEP_M = 20_000;
const MIN_ORBIT_M = 20_000;
const MAX_ORBIT_M = 340_000;

/** Сколько астероидов в поясе (docs/10_art_direction.md §7: instancing, 200–400). */
const ASTEROID_COUNT = 300;

type Disposable = THREE.BufferGeometry | THREE.Material | THREE.Texture;

export interface OrbitBody {
  planet: Planet;
  radiusM: number;
  orbitRadiusM: number;
  angle: number;
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  ring: THREE.Mesh | null;
  spin: number;
}

export interface StationVisual {
  id: number;
  name: string;
  group: THREE.Group;
  radiusM: number;
}

function resolveOrbitRadius(planet: Planet, index: number): number {
  const raw = planet.orbitRadius;
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(MAX_ORBIT_M, Math.max(MIN_ORBIT_M, raw * ORBIT_UNITS_TO_M));
  }
  // orbitRadius не сгенерирован — раскладываем кольца по индексу орбиты
  const ring = planet.orbit > 0 ? planet.orbit : index + 1;
  return MIN_ORBIT_M + (ring - 1) * ORBIT_STEP_M;
}

/** Холодная палитра звёзд Реликтового Предела (13d §1.5): туман Предела, белые/синие/фиолетовые. */
const SECTOR_STAR_HEX: Readonly<Record<StarType, string>> = {
  yellow: PAL.text2,
  orange: PAL.warn,
  red: PAL.enemy,
  blue: PAL.shield,
  white: PAL.text,
  binary: PAL.text2,
  trinary: PAL.text2,
  neutron: PAL.text2,
  pulsar: PAL.psi,
  blackhole: PAL.spaceDeep,
  nebula: PAL.nebula2,
};

/** Холодные палитры планет сектора: лёд/камень/биолюминесценция вместо зелени и золота. */
const SECTOR_PLANET_COLORS: Readonly<Record<PlanetType, readonly [string, string, string]>> = {
  continental: [PAL.metal2, PAL.text2, PAL.shieldDark],
  ocean: [PAL.shieldDark, PAL.shield, PAL.text2],
  desert: [PAL.metal2, PAL.metal1, PAL.warnLight],
  tundra: [PAL.metal2, PAL.text2, PAL.white],
  arctic: [PAL.text2, PAL.white, PAL.shield],
  savanna: [PAL.metal2, PAL.text2, PAL.shieldDark],
  tropical: [PAL.shieldDark, PAL.metal2, PAL.shield],
  arid: [PAL.metal2, PAL.metal1, PAL.metalShadow],
  volcanic: [PAL.enemyDark, PAL.metalShadow, PAL.warn],
  gas_giant: [PAL.nebula2, PAL.metal2, PAL.psi],
  barren: [PAL.metalShadow, PAL.metal2, PAL.metal1],
  asteroid_belt: [PAL.metal2, PAL.metalShadow, PAL.metal1],
};

function planetPalette(type: PlanetType, sector: boolean): readonly [string, string, string] {
  return sector ? SECTOR_PLANET_COLORS[type] ?? SECTOR_PLANET_COLORS.barren : planetColors(type);
}

/** Радиус планеты из planet.size (1..5), м; газовые гиганты крупнее. */
function resolvePlanetRadius(planet: Planet): number {
  const size = Math.max(1, Math.min(5, planet.size || 3));
  const base = 900 + size * 700;
  return planet.type === "gas_giant" ? base * 2.4 : base;
}

export class SystemScene {
  readonly root = new THREE.Group();
  readonly bodies: OrbitBody[] = [];
  readonly starPosition = new THREE.Vector3();
  readonly starRadiusM: number;
  readonly starType: StarType;
  station: StationVisual | null = null;
  /** коллайдеры астероидов (мировые координаты и радиус), для полёта */
  readonly asteroidColliders: { position: THREE.Vector3; radiusM: number }[] = [];
  /** Часть XIII: вариант сцены Реликтового Предела (null — обычная система галактики). */
  readonly sector: SectorVariant | null;
  /** Аномалии/POI сектора: визуальные маркеры и координаты (для HUD/контактов). */
  readonly sectorMarkers: { kind: string; name: string; position: THREE.Vector3 }[] = [];

  private readonly disposables: Disposable[] = [];
  private readonly coronaSprites: { sprite: THREE.Sprite; base: number; phase: number }[] = [];
  private readonly belts: THREE.InstancedMesh[] = [];
  private readonly sectorPulse: { sprite: THREE.Sprite; base: number; phase: number }[] = [];
  private readonly sectorGates: THREE.Mesh[] = [];
  private starSpin = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: StarSystem,
    private readonly rng: Rng,
    sector: SectorVariant | null = null,
  ) {
    this.sector = sector;
    this.starType = system.star;
    this.starRadiusM = this.sector ? Math.round(starRadiusM(system.star) * 0.8) : starRadiusM(system.star);
    this.root.name = "system-root";
    scene.add(this.root);

    this.buildLights();
    this.buildStar();
    this.buildPlanets();
    this.buildBelt();
    this.buildStation();
    this.buildStarfield();
    this.buildNebulae();
    this.buildSectorFeatures();
  }

  /** Опасность сектора: метка/эффект для HUD и полёта (13d §7.3). */
  get sectorHazardLabel(): string {
    return hazardInfo(this.sector?.hazard ?? null)?.labelRu ?? "";
  }

  get sectorHazardEffect(): string {
    return hazardInfo(this.sector?.hazard ?? null)?.effectRu ?? "";
  }

  /** Множитель дальности сенсоров в секторе (13d §7.5): база −40%, у Хор-зоны −70%. */
  get sectorSensorFactor(): number {
    if (!this.sector) return 1;
    const hazard = hazardInfo(this.sector.hazard);
    return hazard ? hazard.sensorFactor : 0.6;
  }

  /** Служебный цвет тинта опасности (для миста/виньетки в SystemView). */
  get sectorHazardTint(): string {
    return hazardInfo(this.sector?.hazard ?? null)?.tint ?? SECTOR_MIST;
  }

  // ------------------------------------------------------------------ helper
  private track<T extends Disposable>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  private mat(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
    return this.track(new THREE.MeshLambertMaterial({ flatShading: true, ...params }));
  }

  private basic(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    return this.track(new THREE.MeshBasicMaterial(params));
  }

  // ------------------------------------------------------------------ свет
  private buildLights(): void {
    // Звезда — основной источник: точечный свет с decay = 0 светит равномерно на всю систему,
    // но с правильным направлением в каждой точке (docs/10_art_direction.md: flat shading).
    const sector = this.sector;
    const deadStar = Boolean(sector && hazardInfo(sector.hazard)?.key.match(/dead|погас/));
    const ambient = new THREE.AmbientLight(sector ? PAL.nebula1 : PAL.nebula3, sector ? (deadStar ? 0.9 : 2.6) : 2.0);
    this.root.add(ambient);
    const starLight = new THREE.PointLight(sector ? PAL.shield : PAL.white, deadStar ? 0.4 : sector ? 5.0 : 9.0, 0, 0);
    starLight.position.copy(this.starPosition);
    this.root.add(starLight);
    // заполняющий свет, чтобы теневые борта силуэтов не проваливались в чёрный
    const fill = new THREE.DirectionalLight(sector ? PAL.nebula2 : PAL.text2, sector ? 1.2 : 2.2);
    fill.position.set(600, 900, 400);
    this.root.add(fill);
  }

  // ------------------------------------------------------------------- star
  private buildStar(): void {
    const r = this.starRadiusM;
    const colorHex = this.sector ? SECTOR_STAR_HEX[this.starType] : starColor(this.starType);
    const deadStar = Boolean(this.sector && hazardInfo(this.sector.hazard)?.key.match(/dead|погас/));
    const star = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(r, 20, 14)),
      this.basic({ color: colorHex }),
    );
    star.position.copy(this.starPosition);
    this.root.add(star);

    if (deadStar) {
      // Погасшая звезда (13d §3.3): угольный шар + слабое ИК-кольцо, без света и короны
      const ir = new THREE.Mesh(
        this.track(new THREE.TorusGeometry(r * 1.25, r * 0.06, 4, 24)),
        this.basic({ color: PAL.enemyDark, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ir.rotation.x = Math.PI / 2.15;
      this.root.add(ir);
    } else if (this.starType === "blackhole") {
      // аккреционный диск (в секторе — фиолетовый служебный цвет Предела)
      const disk = new THREE.Mesh(
        this.track(new THREE.TorusGeometry(r * 1.9, r * 0.22, 4, 24)),
        this.basic({ color: this.sector ? PAL.psi : PAL.warn, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      disk.rotation.x = Math.PI / 2.1;
      this.root.add(disk);
    } else {
      const tex = this.track(
        makeGlowTexture(64, [
          [0, PAL.white],
          [0.22, colorHex],
          [0.55, this.sector ? SECTOR_MIST + "99" : colorHex + "88"],
          [1, colorHex + "00"],
        ]),
      );
      const corona = new THREE.Sprite(
        this.track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
      );
      corona.scale.setScalar(r * 4.4);
      corona.position.copy(this.starPosition);
      this.root.add(corona);
      this.coronaSprites.push({ sprite: corona, base: 4.4, phase: 0 });

      const inner = new THREE.Sprite(
        this.track(
          new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity: 0.55,
          }),
        ),
      );
      inner.scale.setScalar(r * 2.1);
      inner.position.copy(this.starPosition);
      this.root.add(inner);
      this.coronaSprites.push({ sprite: inner, base: 2.1, phase: 1.7 });
    }

    // двойные/тройные звёзды: компаньоны со своими коронами
    const companions = this.starType === "binary" ? 1 : this.starType === "trinary" ? 2 : 0;
    for (let i = 0; i < companions; i++) {
      const angle = (i / Math.max(1, companions)) * Math.PI * 2 + this.rng.range(0, 1);
      const dist = r * 2.6;
      const companionColor = i === 0 ? PAL.white : PAL.shield;
      const cr = r * 0.55;
      const mesh = new THREE.Mesh(this.track(new THREE.SphereGeometry(cr, 14, 10)), this.basic({ color: companionColor }));
      mesh.position.set(Math.cos(angle) * dist, this.rng.range(-r * 0.2, r * 0.2), Math.sin(angle) * dist);
      this.root.add(mesh);
      const tex = this.track(
        makeGlowTexture(48, [
          [0, PAL.white],
          [0.25, companionColor],
          [0.6, companionColor + "66"],
          [1, companionColor + "00"],
        ]),
      );
      const halo = new THREE.Sprite(
        this.track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
      );
      halo.scale.setScalar(cr * 4);
      halo.position.copy(mesh.position);
      this.root.add(halo);
    }
  }

  // ---------------------------------------------------------------- planets
  private buildPlanets(): void {
    const planets = this.system.planets ?? [];
    planets.forEach((planet, index) => {
      const orbitRadiusM = resolveOrbitRadius(planet, index);
      const radiusM = resolvePlanetRadius(planet);
      const angle = this.rng.range(0, Math.PI * 2);
      const position = new THREE.Vector3(
        Math.cos(angle) * orbitRadiusM,
        this.rng.range(-0.015, 0.015) * orbitRadiusM,
        Math.sin(angle) * orbitRadiusM,
      );

      const mesh = this.buildPlanetMesh(planet, radiusM);
      mesh.position.copy(position);
      this.root.add(mesh);

      let ring: THREE.Mesh | null = null;
      if (planet.type === "gas_giant") {
        ring = this.buildRingMesh(planet, radiusM);
        ring.position.copy(position);
        ring.rotation.x = -Math.PI / 2 + this.rng.range(-0.12, 0.12);
        this.root.add(ring);
      }

      if (planet.type !== "barren" && planet.type !== "asteroid_belt") {
        const atmo = new THREE.Mesh(
          this.track(new THREE.SphereGeometry(radiusM * 1.055, 14, 10)),
          this.basic({
            color: planetPalette(planet.type, Boolean(this.sector))[2],
            transparent: true,
            opacity: this.sector ? 0.18 : 0.12,
            side: THREE.BackSide,
            depthWrite: false,
          }),
        );
        atmo.position.copy(position);
        this.root.add(atmo);
      }

      this.bodies.push({
        planet,
        radiusM,
        orbitRadiusM,
        angle,
        position,
        mesh,
        ring,
        spin: this.rng.range(0.01, 0.05) * this.rng.sign(),
      });
    });
  }

  /** Сфера с плоскими зонами цвета (газовые — полосы, каменные — «пятна»). */
  private buildPlanetMesh(planet: Planet, radiusM: number): THREE.Mesh {
    const geo = this.track(new THREE.SphereGeometry(radiusM, planet.type === "gas_giant" ? 20 : 16, 12));
    const colors = planetPalette(planet.type, Boolean(this.sector)).map((hex) => new THREE.Color(hex));
    const position = geo.getAttribute("position");
    const count = position.count;
    const arr = new Float32Array(count * 3);
    const isBanded = planet.type === "gas_giant";
    const bands = 9;
    const inv = 1 / Math.max(1, radiusM);
    for (let i = 0; i < count; i++) {
      const nx = position.getX(i) * inv;
      const ny = position.getY(i) * inv;
      const nz = position.getZ(i) * inv;
      let color: THREE.Color;
      if (isBanded) {
        // газовый гигант: широтные полосы с детерминированным сдвигом
        const band = (Math.sin(ny * bands + hash01(Math.floor((ny + 1) * bands)) * 2.4) + 1) * 0.5;
        color = band > 0.66 ? colors[0] : band > 0.33 ? colors[1] : colors[2];
      } else {
        // каменная планета: полярные шапки + «континентальный» шум (сумма синусов по сфере)
        const noise =
          Math.sin(nx * 3.1 + planet.id * 0.7) * Math.cos(ny * 2.6) +
          0.6 * Math.sin(nz * 4.3 - planet.id * 1.3) +
          0.35 * Math.sin((nx + nz) * 7.1 + planet.id);
        if (Math.abs(ny) > 0.84) color = colors[2];
        else color = noise > 0.45 ? colors[1] : colors[0];
      }
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    const material = this.track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    return new THREE.Mesh(geo, material);
  }

  private buildRingMesh(planet: Planet, radiusM: number): THREE.Mesh {
    const inner = radiusM * 1.4;
    const outer = radiusM * 2.35;
    const geo = this.track(new THREE.RingGeometry(inner, outer, 40, 2));
    const colors = planetPalette(planet.type, Boolean(this.sector));
    const palette = [new THREE.Color(colors[0]), new THREE.Color(colors[1]), new THREE.Color(colors[2])];
    const position = geo.getAttribute("position");
    const count = position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const t = clamp01((Math.hypot(x, y) - inner) / Math.max(1, outer - inner));
      const stripe = (Math.sin(t * 26 + planet.id) + 1) * 0.5;
      const color = stripe > 0.62 ? palette[1] : stripe > 0.28 ? palette[0] : palette[2];
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    const material = this.track(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
    );
    return new THREE.Mesh(geo, material);
  }

  // ------------------------------------------------------------------- belt
  private buildBelt(): void {
    const beltPlanet = this.bodies.find((b) => b.planet.type === "asteroid_belt");
    const maxOrbit = this.bodies.reduce((m, b) => Math.max(m, b.orbitRadiusM), MIN_ORBIT_M);
    const centerRadius = beltPlanet ? beltPlanet.orbitRadiusM : maxOrbit * 0.58;
    const inner = centerRadius * 0.86;
    const outer = centerRadius * 1.14;
    const halfCount = Math.floor(ASTEROID_COUNT / 2);

    // Два InstancedMesh по цветам металла → 2 draw call на весь пояс
    for (const [meshIndex, colorHex] of [PAL.metal2, PAL.metalShadow].entries()) {
      const geo = this.track(new THREE.IcosahedronGeometry(1, 0));
      const material = this.mat({ color: colorHex });
      const mesh = new THREE.InstancedMesh(geo, material, halfCount);
      mesh.frustumCulled = false;
      mesh.name = "asteroid-belt";
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const pos = new THREE.Vector3();
      for (let i = 0; i < halfCount; i++) {
        const radius = this.rng.range(inner, outer);
        const a = this.rng.range(0, Math.PI * 2);
        pos.set(
          Math.cos(a) * radius,
          this.rng.range(-0.02, 0.02) * radius,
          Math.sin(a) * radius,
        );
        quaternion.setFromEuler(
          new THREE.Euler(this.rng.range(0, Math.PI), this.rng.range(0, Math.PI), this.rng.range(0, Math.PI)),
        );
        const size = this.rng.range(35, 190);
        const sx = size * this.rng.range(0.7, 1.3);
        const sy = size * this.rng.range(0.7, 1.3);
        const sz = size * this.rng.range(0.7, 1.3);
        scale.set(sx, sy, sz);
        matrix.compose(pos, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
        this.asteroidColliders.push({ position: pos.clone(), radiusM: Math.max(sx, Math.max(sy, sz)) * 0.9 });
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.root.add(mesh);
      this.belts.push(mesh);
      void meshIndex;
    }
  }

  // ---------------------------------------------------------------- station
  private buildStation(): void {
    const station = this.system.station;
    if (!station) {
      this.station = null;
      return;
    }
    const group = new THREE.Group();
    // emissive-подмес: даже теневой борт станции не превращается в чёрный силуэт
    const metal1 = this.mat({ color: PAL.metal1, emissive: PAL.metalShadow, emissiveIntensity: 0.55 });
    const metal2 = this.mat({ color: PAL.metal2, emissive: PAL.metalShadow, emissiveIntensity: 0.5 });
    const shadow = this.mat({ color: PAL.metalShadow, emissive: PAL.spaceFar, emissiveIntensity: 0.5 });
    const gold = this.mat({ color: PAL.goldDark, emissive: PAL.goldDark, emissiveIntensity: 0.4 });

    // Тор радиуса 420 м: с 5–8 км станция читается как узнаваемый объект (§4.3 art-direction)
    const ringGeo = this.track(new THREE.TorusGeometry(420, 78, 6, 24));
    const ring = new THREE.Mesh(ringGeo, metal2);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const hub = new THREE.Mesh(this.track(new THREE.CylinderGeometry(150, 180, 280, 8)), metal1);
    group.add(hub);

    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(this.track(new THREE.BoxGeometry(760, 22, 44)), shadow);
      spoke.rotation.y = (i / 3) * Math.PI * 2;
      group.add(spoke);
    }

    const dockModule = new THREE.Mesh(this.track(new THREE.BoxGeometry(280, 160, 400)), metal1);
    dockModule.position.set(0, -240, 0);
    group.add(dockModule);

    const dockPort = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(170, 80, 70)),
      this.basic({ color: PAL.shield }),
    );
    dockPort.position.set(0, -260, 220);
    group.add(dockPort);

    const pad = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(260, 14, 110)),
      this.basic({ color: PAL.gold, transparent: true, opacity: 0.85 }),
    );
    pad.position.set(0, -330, 0);
    group.add(pad);

    // ходовые огни по ободу и «окна» хаба — станцию видно и на 10 км
    const lightGeo = this.track(new THREE.BoxGeometry(46, 16, 16));
    const lightMat = this.basic({ color: PAL.gold });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const light = new THREE.Mesh(lightGeo, lightMat);
      light.position.set(Math.cos(a) * 420, 0, Math.sin(a) * 420);
      light.rotation.y = -a;
      group.add(light);
    }
    const windowGeo = this.track(new THREE.BoxGeometry(22, 14, 22));
    const windowMat = this.basic({ color: PAL.shield });
    for (let i = 0; i < 6; i++) {
      const window2 = new THREE.Mesh(windowGeo, windowMat);
      window2.position.set(Math.cos((i / 6) * Math.PI * 2) * 150, 40 - (i % 2) * 70, Math.sin((i / 6) * Math.PI * 2) * 150);
      group.add(window2);
    }

    for (const sign of [-1, 1]) {
      const panel = new THREE.Mesh(this.track(new THREE.BoxGeometry(520, 10, 160)), gold);
      panel.position.set(sign * 620, 60, 0);
      panel.rotation.z = sign * 0.2;
      group.add(panel);
    }

    const antenna = new THREE.Mesh(this.track(new THREE.CylinderGeometry(8, 8, 420, 4)), shadow);
    antenna.position.set(0, 330, 0);
    group.add(antenna);

    // маяк: светящийся спрайт, видимый с 20+ км (для поиска станции в полёте)
    const beaconTex = this.track(
      makeGlowTexture(32, [
        [0, PAL.white],
        [0.3, PAL.gold],
        [0.7, PAL.gold + "55"],
        [1, PAL.gold + "00"],
      ]),
    );
    const beacon = new THREE.Sprite(
      this.track(new THREE.SpriteMaterial({ map: beaconTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
    );
    beacon.scale.setScalar(900);
    beacon.position.set(0, 120, 0);
    group.add(beacon);

    // позиция: ориентир рядом с первой планетой (или на фиксированной орбите)
    const anchor = this.bodies[0];
    const position = new THREE.Vector3();
    if (anchor) {
      position.set(
        Math.cos(anchor.angle) * anchor.orbitRadiusM * 0.72,
        1800,
        Math.sin(anchor.angle) * anchor.orbitRadiusM * 0.72,
      );
    } else {
      position.set(18_000, 1200, 0);
    }
    group.position.copy(position);
    // док (+Z) развёрнут к звезде — навстречу подлетающему игроку
    group.rotation.y = Math.atan2(-position.x, -position.z);
    this.root.add(group);

    this.station = {
      id: station.id,
      name: station.nameRu || "Станция",
      group,
      radiusM: 760,
    };
  }

  // -------------------------------------------------------------- background
  private buildStarfield(): void {
    const count = this.sector ? 1200 : 900;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = (this.sector
      ? [PAL.white, PAL.text2, PAL.text, PAL.shield, PAL.nebula1, PAL.psi]
      : [PAL.white, PAL.text, PAL.text2, PAL.spaceFar, PAL.gold, PAL.shield]).map((hex) => new THREE.Color(hex));
    const radius = SCENE_FAR_M * 0.72;
    for (let i = 0; i < count; i++) {
      const u = this.rng.range(-1, 1);
      const a = this.rng.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = Math.cos(a) * s * radius;
      positions[i * 3 + 1] = u * radius;
      positions[i * 3 + 2] = Math.sin(a) * s * radius;
      const h = this.rng.next();
      const color = palette[h > 0.94 ? 4 : h > 0.86 ? 5 : h > 0.6 ? 2 : h > 0.25 ? 1 : 0];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = this.track(
      new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }),
    );
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    this.root.add(points);
  }

  private buildNebulae(): void {
    const total = this.sector ? 6 : 4;
    for (let i = 0; i < total; i++) {
      const colorHex = this.sector
        ? (i % 3 === 0 ? SECTOR_MIST : i % 3 === 1 ? PAL.nebula1 : PAL.psi)
        : (i % 2 === 0 ? PAL.nebula1 : PAL.nebula2);
      const tex = this.track(this.makeNebulaTexture(colorHex));
      const sprite = new THREE.Sprite(
        this.track(
          new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            opacity: this.sector ? 0.62 : 0.5,
            depthWrite: false,
          }),
        ),
      );
      const a = this.rng.range(0, Math.PI * 2);
      const radius = SCENE_FAR_M * this.rng.range(0.5, 0.62);
      sprite.position.set(
        Math.cos(a) * radius,
        this.rng.range(-0.4, 0.4) * radius,
        Math.sin(a) * radius,
      );
      sprite.scale.setScalar(SCENE_FAR_M * this.rng.range(0.28, 0.5));
      this.root.add(sprite);
    }
  }

  private makeNebulaTexture(colorHex: string): THREE.CanvasTexture {
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      for (let cloud = 0; cloud < 4; cloud++) {
        const cx = this.rng.range(20, 76);
        const cy = this.rng.range(20, 76);
        const radius = this.rng.range(14, 32);
        for (let y = 0; y < size; y += 2) {
          for (let x = 0; x < size; x += 2) {
            const d = Math.hypot(x - cx, y - cy) / radius;
            if (d >= 1) continue;
            if (this.rng.next() > (1 - d) * 0.85) {
              ctx.fillStyle = colorHex;
              ctx.globalAlpha = (1 - d) * 0.5;
              ctx.fillRect(x, y, 2, 2);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  // -------------------------------------------------- Реликтовый Предел (XIII)
  /**
   * Визуалы сектора (13d §6–§7): аномалии/POI — светящиеся маркеры, опасность — тинт-гало,
   * Хор — биомасса (#6BE08A), Врата Ансаров — золотое кольцо. Всё процедурно, без ассетов.
   */
  private buildSectorFeatures(): void {
    if (!this.sector) return;
    const poiColors: Record<string, string> = {
      anomaly: PAL.psi,
      derelict: PAL.text2,
      pirate_base: PAL.enemy,
      mining_platform: PAL.goldDark,
      research_station: PAL.shield,
      trade_hub: PAL.gold,
    };
    for (const poi of this.system.poi) {
      const angle = hash01(poi.id * 13 + 7) * Math.PI * 2;
      const radiusM = 9000 + hash01(poi.id * 17 + 3) * 52000;
      const position = new THREE.Vector3(
        Math.cos(angle) * radiusM,
        this.rng.range(-3000, 3000),
        Math.sin(angle) * radiusM,
      );
      const colorHex = poiColors[poi.kind] ?? PAL.text2;
      const tex = this.track(
        makeGlowTexture(32, [
          [0, PAL.white],
          [0.25, colorHex],
          [0.6, colorHex + "66"],
          [1, colorHex + "00"],
        ]),
      );
      const sprite = new THREE.Sprite(
        this.track(
          new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
        ),
      );
      sprite.position.copy(position);
      const scale = 900 + hash01(poi.id * 29) * 1000;
      sprite.scale.setScalar(scale);
      this.root.add(sprite);
      this.sectorPulse.push({ sprite, base: scale, phase: this.rng.range(0, Math.PI * 2) });
      this.sectorMarkers.push({ kind: poi.kind, name: poi.nameRu, position });
    }

    const hazard = hazardInfo(this.sector.hazard);
    if (hazard) {
      const tint = hazard.tint;
      const halo = new THREE.Sprite(
        this.track(
          new THREE.SpriteMaterial({
            map: this.track(
              makeGlowTexture(64, [
                [0, tint + "00"],
                [0.5, tint + "44"],
                [0.8, tint + "22"],
                [1, tint + "00"],
              ]),
            ),
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        ),
      );
      halo.scale.setScalar(this.starRadiusM * 9);
      halo.position.copy(this.starPosition);
      this.root.add(halo);

      if (hazard.key.includes("chorus") || hazard.key.includes("хор")) {
        // биомасса Хора: зелёные сгустки у планет (13d §4.3, §7.3)
        for (let i = 0; i < 10; i++) {
          const body = this.bodies[i % Math.max(1, this.bodies.length)];
          const base = body ? body.position.clone() : this.starPosition.clone();
          const angle = this.rng.range(0, Math.PI * 2);
          const dist = this.rng.range(6000, 22000);
          base.add(new THREE.Vector3(Math.cos(angle) * dist, this.rng.range(-2500, 2500), Math.sin(angle) * dist));
          const bioTex = this.track(
            makeGlowTexture(32, [
              [0, PAL.white],
              [0.3, SECTOR_CHORUS],
              [0.65, SECTOR_CHORUS + "77"],
              [1, SECTOR_CHORUS + "00"],
            ]),
          );
          const sprite = new THREE.Sprite(
            this.track(new THREE.SpriteMaterial({ map: bioTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })),
          );
          sprite.position.copy(base);
          const scale = this.rng.range(1500, 4200);
          sprite.scale.setScalar(scale);
          this.root.add(sprite);
          this.sectorPulse.push({ sprite, base: scale, phase: this.rng.range(0, Math.PI * 2) });
        }
      }
    }

    // Врата Ансаров / форпост: золотое кольцо-ориентир
    const isGate = /ansar|ансар|gate|врат/i.test(this.sector.faction)
      || this.system.poi.some((poi) => /gate|врат/i.test(poi.nameRu));
    if (isGate) {
      const gate = new THREE.Mesh(
        this.track(new THREE.TorusGeometry(2400, 280, 6, 26)),
        this.basic({ color: PAL.gold, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      gate.position.set(9000, 1400, 9000);
      gate.rotation.x = Math.PI / 2.3;
      this.root.add(gate);
      this.sectorGates.push(gate);
      this.sectorMarkers.push({ kind: "gate", name: "Врата Ансаров", position: gate.position.clone() });
    }
  }

  // ----------------------------------------------------------------- update
  update(dtSec: number, timeSec: number): void {
    const dt = Math.min(0.1, dtSec);
    for (const body of this.bodies) {
      body.mesh.rotation.y += body.spin * dt;
      if (body.ring) body.ring.rotation.z += dt * 0.02;
    }
    for (const belt of this.belts) belt.rotation.y += dt * 0.004;
    this.starSpin += dt * 0.15;
    for (const corona of this.coronaSprites) {
      const pulse = 1 + Math.sin(timeSec * 0.7 + corona.phase) * 0.012;
      corona.sprite.scale.setScalar(this.starRadiusM * corona.base * pulse);
    }
    if (this.station) this.station.group.rotation.y += dt * 0.03;
    // Реликтовый Предел: пульсация аномалий/биомассы Хора и вращение Врат
    for (const pulse of this.sectorPulse) {
      const scale = pulse.base * (1 + Math.sin(timeSec * 1.3 + pulse.phase) * 0.12);
      pulse.sprite.scale.setScalar(scale);
    }
    for (const gate of this.sectorGates) gate.rotation.z += dt * 0.25;
  }

  /** Ближайший гравитационный колодец: 1 = поверхность тела, 0 = глубокий космос. */
  gravityAt(position: THREE.Vector3): { proximity: number; bodyName: string } {
    let best = 0;
    let name = "";
    const starDistance = position.distanceTo(this.starPosition) - this.starRadiusM;
    const starRange = this.starType === "blackhole" ? this.starRadiusM * 3.2 : this.starRadiusM * 6;
    const starProx = clamp01(1 - starDistance / Math.max(1, starRange));
    if (starProx > best) {
      best = starProx;
      name = "звезда";
    }
    for (const body of this.bodies) {
      const distance = position.distanceTo(body.position) - body.radiusM;
      const prox = clamp01(1 - distance / Math.max(1, body.radiusM * 6));
      if (prox > best) {
        best = prox;
        name = body.planet.name;
      }
    }
    return { proximity: best, bodyName: name };
  }

  /** Дистанция до станции (м) или Infinity, если станции нет. */
  stationDistance(position: THREE.Vector3): number {
    if (!this.station) return Number.POSITIVE_INFINITY;
    return position.distanceTo(this.station.group.position);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.clear();
    for (const resource of this.disposables) resource.dispose();
    this.disposables.length = 0;
    this.bodies.length = 0;
    this.belts.length = 0;
    this.coronaSprites.length = 0;
    this.station = null;
  }
}