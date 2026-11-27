import {
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  type Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { LEAFY, spotHash } from '../world/gen/lifeKinds';

/** What a ground cell is, for growing things: nothing (indoors, under a roof), open ground, paving, a curb line. */
export const Ground = { None: 0, Grass: 1, Paved: 2, Curb: 3 } as const;
export type Ground = (typeof Ground)[keyof typeof Ground];

/** Atlas tiles (2×2). */
const TILE = { grass: 0, weed: 1, ivy: 2, litter: 3 } as const;
/** Tiles of 4×4 m are grown once and cached; new ones while a frame has time left (ms), at least one. */
const TILE_M = 4;
const GROW_MS = 0.5;

export interface FoliageSources {
  /** Trees: x, y, z, crown radius, pine (0/1). */
  trees: number[];
  /** Cars: x, z, heading x, heading z. */
  cars: number[];
  /** Ivy: x, y, z (bottom middle), normal x, normal z, w, h, seed. */
  ivy: number[];
}

interface Grown {
  n: number;
  m: Float32Array;
  data: Float32Array;
  color: Float32Array;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _z = new Vector3(0, 0, 1);
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _y = new Vector3(0, 1, 0);

/**
 * Grass on open ground, in the cracks of the asphalt and along the curbs, thicker round the trees; weeds
 * through abandoned cars; ivy and moss up old walls and fences; fallen leaves under the trees. One
 * InstancedMesh (one draw call): crossed quads for tufts, flat ones for ivy and litter, an atlas texture,
 * swaying in the wind in the vertex shader. Grown only near the player (quality preset), in 4 m tiles that
 * are computed once, a few per frame (a time budget).
 */
export class Foliage {
  readonly mesh: InstancedMesh;
  private readonly data: InstancedBufferAttribute;
  private readonly uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uSnow: { value: 0.15 },
    uCamPos: { value: new Vector3() },
    uFadeStart: { value: 18 },
    uFadeEnd: { value: 30 },
  };
  private readonly tiles = new Map<number, Grown>();
  /** Tiles grown from old sources: still shown, regrown nearest first (no grass popping out). */
  private readonly stale = new Set<number>();
  private shown = '';
  private radius = 13;
  private cell = 0.95;
  private cap = 1400;
  private sources: FoliageSources = { trees: [], cars: [], ivy: [] };
  /** Tiles grown or dropped since the last upload. */
  private dirty = true;
  private readonly wantPool: { d: number; k: number }[] = [];
  private readonly want: { d: number; k: number }[] = [];

  constructor(
    scene: Scene,
    private readonly ground: (x: number, z: number) => Ground,
    private readonly groundY: (x: number, z: number) => number,
    maxCap = 7000,
  ) {
    const quad = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.data = new InstancedBufferAttribute(new Float32Array(maxCap * 4), 4);
    quad.setAttribute('aFol', this.data);
    const tex = new CanvasTexture(atlas());
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    const mat = new MeshLambertMaterial({
      map: tex,
      alphaTest: 0.45,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aFol;
uniform float uTime;
uniform float uWind;
uniform vec3 uCamPos;
uniform float uFadeStart;
uniform float uFadeEnd;
varying float vBladeY;
varying float vDistFade;
varying float vIsLitter;`,
        )
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (vMapUv + vec2(mod(aFol.x, 2.0), 1.0 - floor(aFol.x / 2.0))) * 0.5;')
        // Tufts are lit like the ground under them (up), not like a card.
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nif (aFol.x < 1.5) objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float camDist = length(instanceMatrix[3].xz - uCamPos.xz);
float distFade = 1.0 - smoothstep(uFadeStart, uFadeEnd, camDist);
vDistFade = distFade;
vBladeY = clamp(position.y, 0.0, 1.0);
vIsLitter = step(2.5, aFol.x);
transformed.y *= mix(0.15, 1.0, distFade);
float bend = position.y * position.y * aFol.y * distFade;
float wt = uTime * (1.6 + aFol.z) + aFol.z * 40.0 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
transformed.x += bend * (0.05 + 0.16 * uWind) * sin(wt);
transformed.z += bend * (0.03 + 0.08 * uWind) * sin(wt * 1.3 + 1.7);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uSnow;
varying float vBladeY;
varying float vDistFade;
varying float vIsLitter;`,
        )
        .replace(
          '#include <map_fragment>',
          `if (vDistFade < 0.04) discard;
#include <map_fragment>
if (uSnow > 0.01) {
  float snowMix = clamp(uSnow * mix(0.2 + 0.95 * vBladeY, 0.85, vIsLitter), 0.0, 0.92);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.90, 0.96), snowMix);
}`,
        );
    };
    mat.customProgramCacheKey = () => 'foliage-snow-fade-v1';
    this.mesh = new InstancedMesh(quad, mat, maxCap);
    this.mesh.name = 'foliage';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0xffffff));
    scene.add(this.mesh);
  }

  /** Quality preset: how far, how dense, how many. */
  configure(radius: number, cell: number, cap: number): void {
    if (radius === this.radius && cell === this.cell && cap === this.cap) return;
    this.radius = radius;
    this.cell = cell;
    this.cap = Math.min(cap, this.mesh.instanceMatrix.count);
    this.tiles.clear();
    this.stale.clear();
    this.dirty = true;
  }

  /** Trees, cars, ivy changed (chunks streamed): regrow. */
  setSources(s: FoliageSources): void {
    this.sources = s;
    for (const k of this.tiles.keys()) this.stale.add(k);
  }

  /** Snow cover 0..1 blended onto blade tips & fallen litter. */
  setSnow(v: number): void {
    this.uniforms.uSnow.value = Math.max(0, Math.min(1, v));
  }

  update(time: number, wind: number, px: number, pz: number, dirX = 0, dirZ = 0): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value = wind;
    this.uniforms.uCamPos.value.set(px, 0, pz);
    this.uniforms.uFadeStart.value = this.radius * 0.65;
    this.uniforms.uFadeEnd.value = this.radius * 0.98;
    const r = this.radius;
    const t0x = Math.floor((px - r) / TILE_M);
    const t1x = Math.floor((px + r) / TILE_M);
    const t0z = Math.floor((pz - r) / TILE_M);
    const t1z = Math.floor((pz + r) / TILE_M);
    const dLen = Math.hypot(dirX, dirZ);
    const hasDir = dLen > 1e-4;
    const nx = hasDir ? dirX / dLen : 0;
    const nz = hasDir ? dirZ / dLen : 0;
    // Tiles in reach and in front (keeping immediate 4.5 m ring), nearest first; grow a few missing ones per frame.
    let wantN = 0;
    for (let tx = t0x; tx <= t1x; tx++) {
      for (let tz = t0z; tz <= t1z; tz++) {
        const vx = (tx + 0.5) * TILE_M - px;
        const vz = (tz + 0.5) * TILE_M - pz;
        const d = Math.hypot(vx, vz);
        if (d >= r + TILE_M * 0.7) continue;
        if (hasDir && d > 4.5 && (vx * nx + vz * nz) / d < -0.25) continue;
        let slot = this.wantPool[wantN];
        const k = key(tx, tz);
        if (!slot) this.wantPool[wantN] = slot = { d, k };
        else {
          slot.d = d;
          slot.k = k;
        }
        this.want[wantN++] = slot;
      }
    }
    this.want.length = wantN;
    if (wantN > 1) this.want.sort((a, b) => a.d - b.d);
    const until = performance.now() + GROW_MS;
    let grown = 0;
    for (let i = 0; i < this.want.length; i++) {
      const k = this.want[i].k;
      if (this.tiles.has(k) && !this.stale.has(k)) continue;
      if (grown++ > 0 && performance.now() > until) break;
      this.tiles.set(k, this.grow(k));
      this.stale.delete(k);
      this.dirty = true;
    }
    const yawBucket = hasDir ? Math.round(Math.atan2(nz, nx) * 4) : 0;
    const sig = `${t0x},${t1x},${t0z},${t1z},${yawBucket}`;
    if (!this.dirty && sig === this.shown) return;
    this.dirty = false;
    this.shown = sig;
    // Forget tiles well out of reach.
    for (const k of this.tiles.keys()) {
      const [tx, tz] = unkey(k);
      if (Math.hypot((tx + 0.5) * TILE_M - px, (tz + 0.5) * TILE_M - pz) > r + TILE_M * 3) {
        this.tiles.delete(k);
        this.stale.delete(k);
      }
    }
    // Upload the tiles in reach, nearest first, up to the cap.
    const im = this.mesh.instanceMatrix.array as Float32Array;
    const ic = this.mesh.instanceColor!.array as Float32Array;
    const id = this.data.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.want.length; i++) {
      const g = this.tiles.get(this.want[i].k);
      if (!g || g.n === 0) continue;
      const take = Math.min(g.n, this.cap - n);
      if (take <= 0) break;
      im.set(g.m.subarray(0, take * 16), n * 16);
      id.set(g.data.subarray(0, take * 4), n * 4);
      ic.set(g.color.subarray(0, take * 3), n * 3);
      n += take;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      const icAttr = this.mesh.instanceColor!;
      icAttr.clearUpdateRanges();
      icAttr.addUpdateRange(0, n * 3);
      icAttr.needsUpdate = true;
      this.data.clearUpdateRanges();
      this.data.addUpdateRange(0, n * 4);
      this.data.needsUpdate = true;
    }
  }

  /** Everything that grows in one tile: tufts per cell, plus the trees', cars' and walls' own. */
  private grow(k: number): Grown {
    const [tx, tz] = unkey(k);
    const x0 = tx * TILE_M;
    const z0 = tz * TILE_M;
    const m: number[] = [];
    const data: number[] = [];
    const color: number[] = [];
    const push = (tile: number, sway: number, tint: number) => {
      _m.toArray(m, m.length);
      data.push(tile, sway, Math.random(), 0);
      const g = tile === TILE.litter ? _c.setRGB(0.85 + tint * 0.3, 0.8 + tint * 0.2, 0.75) : _c.setRGB(0.55 + tint * 0.25, 0.62 + tint * 0.25, 0.5 + tint * 0.15);
      color.push(g.r, g.g, g.b);
    };
    // A tuft: three crossed cards.
    const tuft = (x: number, z: number, size: number, tile: number) => {
      const y = this.groundY(x, z) - 0.02;
      const yaw = spotHash(x, z, 3) * Math.PI;
      const h = size * (0.7 + spotHash(z, x, 4) * 0.6);
      const tint = spotHash(x, z, 5);
      for (let i = 0; i < 3; i++) {
        _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_y, yaw + (i * Math.PI) / 3), _s.set(size, h, 1));
        push(tile, 1, tint);
      }
    };
    // Flat on the ground (litter).
    const flat = (x: number, z: number, size: number) => {
      const y = this.groundY(x, z) + 0.022;
      _q.setFromAxisAngle(_y, spotHash(x, z, 6) * 6.28).multiply(_q2.setFromEuler(_e.set(-Math.PI / 2, 0, 0)));
      // The quad's pivot is its bottom edge: shift it back so the patch is centred on (x, z).
      _p.set(0, -size * 0.5, 0).applyQuaternion(_q).add(_s.set(x, y, z));
      _m.compose(_p, _q, _s.set(size, size, 1));
      push(TILE.litter, 0, spotHash(x, z, 7));
    };
    const c = this.cell;
    const trees = this.sources.trees;
    for (let x = x0 + c / 2; x < x0 + TILE_M; x += c) {
      for (let z = z0 + c / 2; z < z0 + TILE_M; z += c) {
        const jx = x + (spotHash(x, z, 1) - 0.5) * c * 0.9;
        const jz = z + (spotHash(z, x, 2) - 0.5) * c * 0.9;
        const roll = spotHash(jx, jz, 8);
        const kind = this.ground(jx, jz);
        if (kind === Ground.None) continue;
        // Round a tree: fallen leaves everywhere; bonus grass only on soil/curb (never across asphalt lanes).
        let near = 0;
        let leafy = false;
        for (let i = 0; i < trees.length; i += 5) {
          const d = Math.hypot(trees[i] - jx, trees[i + 2] - jz);
          if (d < trees[i + 3] * 1.3 && d > 0.25) {
            near = Math.max(near, 1 - d / (trees[i + 3] * 1.3));
            if (trees[i + 4] <= LEAFY) leafy = true;
          }
        }
        if (leafy && spotHash(jx, jz, 9) < 0.35) flat(jx, jz, 0.55 + spotHash(jx, jz, 10) * 0.35);
        const treeGrass = kind === Ground.Paved ? 0 : near * 0.75;
        const p = kind === Ground.Grass ? 0.78 : kind === Ground.Curb ? 0.24 : 0.008;
        if (roll < Math.max(p, treeGrass)) {
          const weed = spotHash(jx, jz, 11) < (kind === Ground.Grass ? 0.14 : 0.45);
          const scale = kind === Ground.Paved ? 0.42 : kind === Ground.Curb ? 0.62 : 1.05;
          tuft(jx, jz, (weed ? 0.44 : 0.54) * scale * (0.8 + spotHash(jx, jz, 12) * 0.55), weed ? TILE.weed : TILE.grass);
        }
      }
    }
    // Weeds pushing up round an abandoned car's wheels (only on curb or countryside soil, never asphalt lanes).
    const cars = this.sources.cars;
    for (let i = 0; i < cars.length; i += 4) {
      const cx = cars[i];
      const cz = cars[i + 1];
      if (cx < x0 || cx >= x0 + TILE_M || cz < z0 || cz >= z0 + TILE_M) continue;
      const fx = cars[i + 2];
      const fz = cars[i + 3];
      for (const [a, s] of [
        [1.35, 0.85],
        [1.35, -0.85],
        [-1.35, 0.85],
        [-1.35, -0.85],
      ] as const) {
        if (spotHash(cx + a, cz + s, 13) < 0.35) continue;
        // Length along the car's local X = (fz, −fx), width along (fx, fz).
        const wx = cx + fz * a + fx * s;
        const wz = cz - fx * a + fz * s;
        const wk = this.ground(wx, wz);
        if (wk === Ground.None || wk === Ground.Paved) continue;
        tuft(wx, wz, 0.52, TILE.weed);
        tuft(wx + 0.2, wz - 0.15, 0.38, TILE.grass);
      }
    }
    // Ivy and moss up the walls and fences whose foot is in this tile.
    const ivy = this.sources.ivy;
    for (let i = 0; i < ivy.length; i += 8) {
      const ix = ivy[i];
      const iz = ivy[i + 2];
      if (ix < x0 || ix >= x0 + TILE_M || iz < z0 || iz >= z0 + TILE_M) continue;
      const nx = ivy[i + 3];
      const nz = ivy[i + 4];
      const w = ivy[i + 5];
      const h = ivy[i + 6];
      const yaw = Math.atan2(nx, nz);
      _q.setFromAxisAngle(_y, yaw);
      const n = Math.ceil(w * h * 2.6);
      for (let k2 = 0; k2 < n; k2++) {
        const u = (spotHash(ix + k2, iz, 14) - 0.5) * w;
        // Thicker low down: the top edge is ragged.
        const v = Math.pow(spotHash(iz, ix + k2, 15), 1.6) * h * (0.7 + 0.3 * Math.sin(u * 2.3 + ivy[i + 7] * 9));
        const size = 0.55 + spotHash(ix, iz + k2, 16) * 0.4;
        // Along the wall (its tangent is (nz, −nx)), a hair off it, each leaf patch a little in front of the last.
        const off = 0.01 + k2 * 0.0004;
        _q2.copy(_q).multiply(_q3.setFromAxisAngle(_z, (spotHash(k2, ix, 17) - 0.5) * 1.2));
        _p.set(ix + u * nz + nx * off, ivy[i + 1] + v - size * 0.3, iz - u * nx + nz * off);
        _m.compose(_p, _q2, _s.set(size, size, 1));
        push(TILE.ivy, 0.12, spotHash(ix, iz, 18 + k2));
      }
    }
    return { n: data.length / 4, m: new Float32Array(m), data: new Float32Array(data), color: new Float32Array(color) };
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    const mat = this.mesh.material as MeshLambertMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}

const key = (tx: number, tz: number) => (tx + 32768) * 65536 + (tz + 32768);
const unkey = (k: number): [number, number] => [Math.floor(k / 65536) - 32768, (k % 65536) - 32768];

/** The 2×2 atlas: crisp grass blades, broad-leaved weed, ivy, fallen leaves. */
function atlas(): HTMLCanvasElement {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * 2;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const greens = ['#4f5a2e', '#5d6634', '#6b6a38', '#45502a', '#7a7440', '#3e4a28'];
  // Grass: fine tapering meadow blades fanning out from a dense base; dark root, sunlit tips.
  for (let i = 0; i < 24; i++) {
    const root = S / 2 + (rnd() - 0.5) * S * 0.28;
    const h = S * (0.48 + rnd() * 0.50);
    const lean = (root - S / 2) * 1.15 + (rnd() - 0.5) * S * 0.32;
    const w = 3.2 + rnd() * 3.8;
    const grad = g.createLinearGradient(0, S, 0, S - h);
    const tone = rnd();
    grad.addColorStop(0, '#243018');
    grad.addColorStop(0.45, tone < 0.5 ? '#4a5c2a' : '#586430');
    grad.addColorStop(1, tone < 0.3 ? '#9a9e5c' : '#80964a');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(root - w, S);
    g.quadraticCurveTo(root - w * 0.55 + lean * 0.35, S - h * 0.55, root + lean, S - h);
    g.quadraticCurveTo(root + w * 0.55 + lean * 0.35, S - h * 0.55, root + w, S);
    g.closePath();
    g.fill();
  }
  // Weed: stalks with broad leaves.
  g.save();
  g.translate(S, 0);
  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 22 + rnd() * 8;
    const h = S * (0.5 + rnd() * 0.45);
    g.strokeStyle = '#4a5228';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x, S);
    g.lineTo(x + (rnd() - 0.5) * 12, S - h);
    g.stroke();
    for (let k = 0; k < 4; k++) {
      const y = S - h * (0.25 + k * 0.2);
      g.fillStyle = greens[Math.floor(rnd() * greens.length)];
      g.beginPath();
      g.ellipse(x + (k % 2 ? 12 : -12), y, 14, 6, (k % 2 ? -0.5 : 0.5), 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  // Ivy: small dark leaves on wandering stems, gaps between.
  g.save();
  g.translate(0, S);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const d = Math.hypot(x - S / 2, y - S / 2);
    if (d > S * 0.5 * (0.75 + rnd() * 0.3)) continue;
    g.fillStyle = ['#2f3c22', '#3a4826', '#46542c', '#2a3420', '#55603a'][Math.floor(rnd() * 5)];
    g.beginPath();
    g.ellipse(x, y, 6 + rnd() * 5, 5 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // Fallen leaves: scattered, brown to rust.
  g.save();
  g.translate(S, S);
  for (let i = 0; i < 26; i++) {
    const x = 12 + rnd() * (S - 24);
    const y = 12 + rnd() * (S - 24);
    if (Math.hypot(x - S / 2, y - S / 2) > S * 0.46) continue;
    g.fillStyle = ['#8a5226', '#9a6a2a', '#7a3e1e', '#a0702a', '#6e4a22'][Math.floor(rnd() * 5)];
    g.beginPath();
    g.ellipse(x, y, 8 + rnd() * 4, 4 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  return cv;
}
