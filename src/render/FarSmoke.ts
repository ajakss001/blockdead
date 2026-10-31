import { AdditiveBlending, Color, DoubleSide, DynamicDrawUsage, type Fog, InstancedBufferAttribute, InstancedMesh, Matrix4, NormalBlending, PlaneGeometry, Quaternion, type Scene, ShaderMaterial, Vector3 } from 'three';
import { CHUNK, type WorldLayout } from '../world/gen/layout';
import { burningSpots } from '../world/gen/scenarios';

const CAP = 12;
const REACH = 9;
const MAX_DIST = 600;
const HEIGHT = 80;

interface Column {
  x: number;
  z: number;
  size: number;
  seed: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

const VERT = /* glsl */ `
attribute vec2 aSmoke; // seed, fade
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
  vUv = uv;
  vSeed = aSmoke.x;
  vFade = aSmoke.y;
  vec4 w = instanceMatrix * vec4(position, 1.0);
  // The column leans downwind, more the higher it goes.
  float h = uv.y;
  w.xz += uWind * h * h * 26.0 * (instanceMatrix[1][1] / ${HEIGHT}.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SMOKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDay;
uniform vec3 uHaze;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float h = vUv.y;
  // Narrow at the fire, billowing wider as it rises; puffs drifting up.
  float width = 0.16 + 0.42 * pow(h, 0.6);
  float x = (vUv.x - 0.5) / width;
  vec2 q = vec2(vUv.x * 3.0 + vSeed * 7.0, h * 5.0 - uTime * 0.18);
  float n = noise(q) * 0.55 + noise(q * 2.1 + 3.7) * 0.3 + noise(q * 4.3 - 1.3) * 0.15;
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(x) + (n - 0.5) * 0.7);
  float a = edge * smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.65, 1.0, h)) * (0.55 + 0.45 * n);
  // Black at the root, grey higher up; lit orange from below at night.
  vec3 col = mix(vec3(0.07, 0.065, 0.06), vec3(0.32, 0.31, 0.3), smoothstep(0.0, 0.8, h));
  col *= 0.25 + 0.75 * uDay;
  col += vec3(0.9, 0.35, 0.08) * (1.0 - uDay) * (1.0 - smoothstep(0.0, 0.25, h)) * 0.6;
  col = mix(col, uHaze, 0.25);
  gl_FragColor = vec4(col, a * 0.85 * vFade);
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDay;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c * vec2(1.0, 1.25)) * 2.0;
  float f = 0.85 + 0.15 * sin(uTime * 7.0 + vSeed * 20.0) * sin(uTime * 3.1 + vSeed * 5.0);
  float a = pow(max(0.0, 1.0 - r), 2.6) * f * (1.0 - uDay) * vFade * 0.8;
  gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a, 1.0);
}`;

/**
 * Columns of smoke over the places burning now, and their glow at night: a landmark that draws the player.
 * One billboard per site (turned to the eye about its axis), the glow a second; past the fog both are drawn
 * as scaled-down copies just inside it (like Landmarks). Two draw calls when anything burns, none otherwise.
 */
export class FarSmoke {
  private readonly smoke: InstancedMesh;
  private readonly glow: InstancedMesh;
  private readonly data = new InstancedBufferAttribute(new Float32Array(CAP * 2), 2);
  private readonly smokeMat: ShaderMaterial;
  private readonly glowMat: ShaderMaterial;
  private columns: Column[] = [];
  private scanT = 0;
  private lastI = 1e9;
  private lastJ = 1e9;
  private time = 0;

  constructor(
    scene: Scene,
    private readonly layout: WorldLayout,
  ) {
    const geo = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
    geo.setAttribute('aSmoke', this.data);
    this.data.setUsage(DynamicDrawUsage);
    const uniforms = { uTime: { value: 0 }, uDay: { value: 1 }, uWind: { value: [0, 0] }, uHaze: { value: new Color() } };
    this.smokeMat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: SMOKE_FRAG, uniforms, transparent: true, depthWrite: false, side: DoubleSide, blending: NormalBlending });
    this.glowMat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: GLOW_FRAG, uniforms, transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
    this.smoke = new InstancedMesh(geo, this.smokeMat, CAP);
    this.glow = new InstancedMesh(geo, this.glowMat, CAP);
    for (const m of [this.smoke, this.glow]) {
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      scene.add(m);
    }
    this.smoke.name = 'farSmoke';
    this.glow.name = 'farGlow';
    this.glow.renderOrder = 1;
  }

  /** How many sites burn within reach (for the debug overlay and tests). */
  get burning(): number {
    return this.columns.length;
  }

  update(dt: number, eye: Vector3, fog: Fog, daylight: number, windDir: number, gust: number): void {
    this.time += dt;
    const ci = Math.floor(eye.x / CHUNK);
    const cj = Math.floor(eye.z / CHUNK);
    this.scanT -= dt;
    if (this.scanT <= 0 || Math.abs(ci - this.lastI) + Math.abs(cj - this.lastJ) > 1) this.scan(ci, cj);
    const u = this.smokeMat.uniforms;
    u.uTime.value = this.time;
    u.uDay.value = daylight;
    const ws = 0.4 + gust;
    u.uWind.value = [Math.cos(windDir) * ws, Math.sin(windDir) * ws];
    (u.uHaze.value as Color).copy(fog.color);
    const at = fog.far * 0.88;
    let n = 0;
    let g = 0;
    for (const c of this.columns) {
      if (n >= CAP) break;
      const dx = c.x - eye.x;
      const dz = c.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > MAX_DIST) continue;
      // Near, the fire's own smoke takes over (the column fades in from 25 m out).
      const fade = Math.min(1, Math.max(0, (dist - 25) / 40)) * (1 - Math.max(0, (dist - MAX_DIST * 0.8) / (MAX_DIST * 0.2)));
      if (fade <= 0) continue;
      const k = dist > at ? at / dist : 1;
      const yaw = Math.atan2(dx, dz);
      _q.setFromAxisAngle(_up, yaw);
      _p.set(eye.x + dx * k, eye.y + (0 - eye.y) * k, eye.z + dz * k);
      const w = 14 + c.size * 5;
      _m.compose(_p, _q, _s.set(w * k, HEIGHT * k, 1));
      this.smoke.setMatrixAt(n, _m);
      this.data.setXY(n, c.seed, fade);
      if (daylight < 0.85) {
        _m.compose(_p, _q, _s.set((16 + c.size * 6) * k, (10 + c.size * 3) * k, 1));
        this.glow.setMatrixAt(g++, _m);
      }
      n++;
    }
    this.smoke.count = n;
    this.glow.count = Math.min(g, n);
    this.smoke.visible = n > 0;
    this.glow.visible = g > 0;
    if (n) {
      this.smoke.instanceMatrix.needsUpdate = true;
      this.data.needsUpdate = true;
    }
    if (g) this.glow.instanceMatrix.needsUpdate = true;
  }

  /** The burning sites within reach: one column each, at its first fire. */
  private scan(ci: number, cj: number): void {
    this.scanT = 3;
    this.lastI = ci;
    this.lastJ = cj;
    this.columns = [];
    const seen = new Set<string>();
    for (let i = ci - REACH; i <= ci + REACH; i++) {
      for (let j = cj - REACH; j <= cj + REACH; j++) {
        const site = this.layout.poi(i, j);
        if (!site) continue;
        const key = `${site.i},${site.j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const spots = burningSpots(this.layout.seed, site);
        if (!spots.length) continue;
        const size = spots.reduce((a, s) => a + s[2], 0);
        this.columns.push({ x: spots[0][0], z: spots[0][1], size, seed: Math.abs(site.i * 0.37 + site.j * 0.71) % 1 });
      }
    }
  }

  dispose(): void {
    for (const m of [this.smoke, this.glow]) m.removeFromParent();
    this.smoke.geometry.dispose();
    this.smokeMat.dispose();
    this.glowMat.dispose();
  }
}
