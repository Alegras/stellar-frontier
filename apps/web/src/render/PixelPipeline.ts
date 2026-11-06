import * as THREE from "three";
import { PALETTE_HEX } from "./contracts";

export interface PixelOptions {
  internalWidth: number;
  internalHeight: number;
  dither: number;   // 0..100
  palette: boolean;
  outlines: boolean;
  crt: boolean;
  bloom: boolean;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform float uDither;
uniform float uPaletteOn;
uniform float uOutline;
uniform float uCrt;
uniform float uTime;
uniform vec3 uPalette[32];
uniform float uPaletteSize;

float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

void main() {
  vec2 uv = vUv;
  vec2 px = floor(uv * uResolution);
  vec2 texel = 1.0 / uResolution;

  vec3 color = texture2D(uColor, uv).rgb;

  // --- контур по глубине (1 пиксель внутреннего буфера) ---
  float d0 = texture2D(uDepth, uv).x;
  float dx1 = texture2D(uDepth, uv + vec2(texel.x, 0.0)).x;
  float dx2 = texture2D(uDepth, uv - vec2(texel.x, 0.0)).x;
  float dy1 = texture2D(uDepth, uv + vec2(0.0, texel.y)).x;
  float dy2 = texture2D(uDepth, uv - vec2(0.0, texel.y)).x;
  float lap = abs(dx1 + dx2 - 2.0 * d0) + abs(dy1 + dy2 - 2.0 * d0);
  float edge = smoothstep(0.00035, 0.0012, lap) * uOutline;
  color = mix(color, vec3(0.02, 0.03, 0.06), edge * 0.75);

  // --- дизеринг + квантование палитры ---
  float bayer = bayer4(px) - 0.5;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color += bayer * (uDither / 100.0) * 0.15 * smoothstep(0.02, 0.35, luma);

  if (uPaletteOn > 0.5) {
    float best = 1e9;
    vec3 bestColor = color;
    for (int i = 0; i < 32; i++) {
      if (float(i) >= uPaletteSize) break;
      vec3 p = uPalette[i];
      vec3 diff = color - p;
      float dist = dot(diff, diff);
      if (dist < best) { best = dist; bestColor = p; }
    }
    color = bestColor;
  }

  // --- виньетка и CRT ---
  vec2 c2 = uv - 0.5;
  color *= 1.0 - dot(c2, c2) * 0.35;
  if (uCrt > 0.5) {
    float scan = 0.92 + 0.08 * sin(uv.y * uResolution.y * 3.14159);
    color *= scan;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

export class PixelPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private rt: THREE.WebGLRenderTarget;
  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private material: THREE.ShaderMaterial;
  private options: PixelOptions;
  private width = 1;
  private height = 1;
  scale = 1;

  constructor(canvas: HTMLCanvasElement, options: PixelOptions) {
    this.options = { ...options };
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x05070e, 1);
    this.renderer.autoClear = true;

    const iw = this.options.internalWidth;
    const ih = this.options.internalHeight;
    const depthTexture = new THREE.DepthTexture(iw, ih);
    depthTexture.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(iw, ih, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      depthTexture,
    });

    const palette = PALETTE_HEX.map((h) => new THREE.Color(h));
    const palVec: THREE.Vector3[] = [];
    for (let i = 0; i < 32; i++) {
      const c = palette[Math.min(i, palette.length - 1)] ?? new THREE.Color(0x000000);
      palVec.push(new THREE.Vector3(c.r, c.g, c.b));
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uColor: { value: this.rt.texture },
        uDepth: { value: this.rt.depthTexture },
        uResolution: { value: new THREE.Vector2(iw, ih) },
        uDither: { value: this.options.dither },
        uPaletteOn: { value: this.options.palette ? 1 : 0 },
        uOutline: { value: this.options.outlines ? 1 : 0 },
        uCrt: { value: this.options.crt ? 1 : 0 },
        uTime: { value: 0 },
        uPalette: { value: palVec },
        uPaletteSize: { value: palette.length },
      },
    });

    this.postScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setOptions(patch: Partial<PixelOptions>): void {
    this.options = { ...this.options, ...patch };
    const u = this.material.uniforms;
    u.uDither.value = this.options.dither;
    u.uPaletteOn.value = this.options.palette ? 1 : 0;
    u.uOutline.value = this.options.outlines ? 1 : 0;
    u.uCrt.value = this.options.crt ? 1 : 0;
    if (patch.internalWidth || patch.internalHeight) this.rebuildTargets();
  }

  private rebuildTargets(): void {
    const iw = this.options.internalWidth;
    const ih = this.options.internalHeight;
    this.rt.dispose();
    const depthTexture = new THREE.DepthTexture(iw, ih);
    depthTexture.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(iw, ih, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      depthTexture,
    });
    this.material.uniforms.uColor.value = this.rt.texture;
    this.material.uniforms.uDepth.value = this.rt.depthTexture;
    this.material.uniforms.uResolution.value = new THREE.Vector2(iw, ih);
    const iw2 = this.width;
    const ih2 = this.height;
    this.resize(iw2, ih2);
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.width = Math.max(1, Math.floor(cssWidth));
    this.height = Math.max(1, Math.floor(cssHeight));
    this.renderer.setSize(this.width, this.height, false);
    this.scale = Math.max(1, Math.floor(Math.min(this.width / this.options.internalWidth, this.height / this.options.internalHeight)));
  }

  render(scene: THREE.Scene, camera: THREE.Camera, timeSec = 0): void {
    const { renderer } = this;
    this.material.uniforms.uTime.value = timeSec;
    const iw = this.options.internalWidth;
    const ih = this.options.internalHeight;

    renderer.setRenderTarget(this.rt);
    renderer.setViewport(0, 0, iw, ih);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, this.width, this.height);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();

    const vw = iw * this.scale;
    const vh = ih * this.scale;
    const vx = Math.floor((this.width - vw) / 2);
    const vy = Math.floor((this.height - vh) / 2);
    renderer.setViewport(vx, vy, vw, vh);
    renderer.render(this.postScene, this.postCamera);
    renderer.setViewport(0, 0, this.width, this.height);
  }

  dispose(): void {
    this.rt.depthTexture?.dispose();
    this.rt.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}