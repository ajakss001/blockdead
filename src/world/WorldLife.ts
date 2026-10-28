import {
  AdditiveBlending,
  type Camera,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  type Fog,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  type Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { AmbientAudio } from '../audio/AmbientAudio';
import type { AnxietyAudio } from '../audio/AnxietyAudio';

/** Spot layout from the generators (Builder.life): kind, x, y, z, normal x, normal z, w, h, seed, tag. */
export const LIFE_STRIDE = 10;
/** Spot kinds. */
export const LIFE = { window: 0, lamp: 1, curtain: 2, radio: 3, shards: 4, room: 5 } as const;
/** Real lights go to lit rooms within this distance, m. */
const ROOM_LIGHT_RANGE = 30;

const GLOW_CAP = 192;
const CLOTH_CAP = 96;
const PAPERS = 18;
/** Papers live within this distance of the player, m. */
const PAPER_RANGE = 15;

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);

/** Same light curve as the glow shader (mode 0 steady with a slight wobble, 1 flickering). */
function flicker(t: number, phase: number, mode: number): number {
  const tt = t + phase * 37;
  if (mode < 0.5) return 0.8 + 0.12 * Math.sin(tt * 6.3) * Math.sin(tt * 2.9) + 0.08 * Math.sin(tt * 13);
  const hash = (n: number) => {
    const s = Math.sin(n) * 43758.5453;
    return s - Math.floor(s);
  };
  const fast = hash(Math.floor(tt * 14) + phase * 131);
  const slow = hash(Math.floor(tt * 1.6) + phase * 71);
  return slow < 0.18 ? (fast > 0.45 ? 1 : 0) : 1;
}

const CURTAIN_COLORS = [0x5a4a40, 0x4a5058, 0x6a5a48, 0x5a3e3a, 0x7a7262, 0x4a5a4a];

interface Paper {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  spin: number;
}

/**
 * The city without zombies is still not dead: a window lit by someone's generator or candles here
 * and there (flickering), fluorescent tubes dying in a corridor, curtains blowing out of broken
 * windows, paper skittering down the street in the gusts, a car alarm in the distance, a radio left
 * on behind a door. Spots come from the generators (chunks and streamed interiors); everything is
 * drawn by two instanced meshes for the whole world — two draw calls — and the sound is synthesized.
 */
export class WorldLife {
  private readonly sets = new Map<number, Float32Array>();
  private dirty = false;
  private readonly glow: InstancedMesh;
  private readonly glowData: InstancedBufferAttribute;
  private readonly glowMat: ShaderMaterial;
  private readonly cloth: InstancedMesh;
  private readonly clothData: InstancedBufferAttribute;
  private readonly clothUniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
  private curtains = 0;
  private readonly radios: number[] = [];
  /** Broken glass on the ground: x, z, radius. */
  private readonly shards: number[] = [];
  /** Lit rooms of the loaded interiors: x, y (lamp), z, flicker mode, phase. */
  private readonly rooms: number[] = [];
  /** A few real point lights (quality preset) given to the nearest lit rooms. */
  private lights: PointLight[] = [];
  private readonly papers: Paper[] = [];
  private papersOn = false;
  private clothOn = true;
  private readonly audio: AmbientAudio;
  private time = 0;
  /** Wind: direction (radians) wandering slowly, gusts 0..1. */
  private windDir = Math.random() * Math.PI * 2;
  private gust = 0.3;
  private gustTarget = 0.4;
  private gustT = 0;

  constructor(
    private readonly scene: Scene,
    dread: AnxietyAudio,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.audio = new AmbientAudio(dread);
    const quad = new PlaneGeometry(1, 1);
    this.glowData = new InstancedBufferAttribute(new Float32Array(GLOW_CAP * 4), 4);
    quad.setAttribute('aGlow', this.glowData);
    this.glowMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFog: { value: new Vector3(3, 50, 0) },
        uWarm: { value: new Color(0xffb060) },
        uCold: { value: new Color(0xb8d8ff) },
      },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.glow = new InstancedMesh(quad, this.glowMat, GLOW_CAP);
    this.glow.name = 'life:glow';
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.glow);

    // Cloth: hangs from its top edge (y = 0 at the top), swaying along its normal (+Z).
    const strip = new PlaneGeometry(1, 1, 1, 6).translate(0, -0.5, 0);
    this.clothData = new InstancedBufferAttribute(new Float32Array(CLOTH_CAP * 2), 2);
    strip.setAttribute('aCloth', this.clothData);
    const clothMat = new MeshLambertMaterial({ side: DoubleSide });
    clothMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.clothUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCloth;\nuniform float uTime;\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float hang = clamp(-position.y, 0.0, 1.0);
float t = uTime * (1.3 + aCloth.y) + aCloth.y * 31.0;
float billow = uWind * (0.55 + 0.45 * sin(t * 0.7)) + 0.15 * sin(t * 2.3 + position.x * 3.0);
transformed.z += aCloth.x * hang * hang * billow;
transformed.x += aCloth.x * hang * 0.08 * sin(t * 1.7 + hang * 4.0);`,
        );
    };
    clothMat.customProgramCacheKey = () => 'life-cloth';
    this.cloth = new InstancedMesh(strip, clothMat, CLOTH_CAP);
    this.cloth.name = 'life:cloth';
    this.cloth.count = 0;
    this.cloth.frustumCulled = false;
    this.cloth.instanceMatrix.setUsage(DynamicDrawUsage);
    this.cloth.setColorAt(0, _c.set(0xffffff));
    scene.add(this.cloth);
    for (let i = 0; i < PAPERS; i++) this.papers.push({ x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: 0.5 + Math.random() });
  }

  /** Number of real point lights for lit rooms (0 on weak phones: the fake glow does it alone). */
  set roomLights(n: number) {
    if (n === this.lights.length) return;
    for (const l of this.lights) this.scene.remove(l);
    this.lights = Array.from({ length: n }, () => {
      const l = new PointLight(0xffc887, 0, 9, 2);
      l.castShadow = false;
      this.scene.add(l);
      return l;
    });
  }

  /** Wind: direction (rad, xz) and gust 0..1 — the clouds drift with it. */
  get windDirection(): number {
    return this.windDir;
  }

  get windGust(): number {
    return this.gust;
  }

  /** Standing on broken glass. */
  onShards(x: number, z: number, y: number): boolean {
    if (y > 0.5) return false;
    if (this.dirty) this.rebuild();
    for (let i = 0; i < this.shards.length; i += 3) {
      const r = this.shards[i + 2];
      if (Math.abs(x - this.shards[i]) < r && Math.abs(z - this.shards[i + 1]) < r) return true;
    }
    return false;
  }

  /** Curtains and paper (quality preset): off = no draw call and no paper simulation. */
  set clothEnabled(on: boolean) {
    this.clothOn = on;
    this.cloth.visible = on;
  }

  add(key: number, spots: Float32Array): void {
    if (spots.length === 0 && !this.sets.has(key)) return;
    this.sets.set(key, spots);
    this.dirty = true;
  }

  remove(key: number): void {
    if (this.sets.delete(key)) this.dirty = true;
  }

  /** Frame update. `player`: feet position; `outdoors`: not under a roof; `street`: an urban zone. */
  update(dt: number, camera: Camera, player: Vector3, outdoors: boolean, street: boolean, paused: boolean): void {
    if (this.dirty) this.rebuild();
    if (paused) return;
    this.time += dt;
    this.wind(dt);
    this.glowMat.uniforms.uTime.value = this.time;
    const fog = this.scene.fog as Fog | null;
    if (fog) this.glowMat.uniforms.uFog.value.set(fog.near, fog.far, 0);
    this.clothUniforms.uTime.value = this.time;
    this.clothUniforms.uWind.value = this.gust;
    this.updatePapers(dt, player, this.clothOn && outdoors && street);
    this.updateRoomLights(player);

    // Nearest radio: a storey apart counts as far; pan from the camera's facing.
    let best = Infinity;
    let pan = 0;
    camera.getWorldDirection(_p);
    for (let i = 0; i < this.radios.length; i += 3) {
      const dx = this.radios[i] - player.x;
      const dy = Math.abs(this.radios[i + 1] - (player.y + 1));
      const dz = this.radios[i + 2] - player.z;
      const d = Math.hypot(dx, dz) + (dy > 2 ? 8 + dy : 0);
      if (d < best) {
        best = d;
        const len = Math.hypot(dx, dz) || 1;
        pan = (dx * -_p.z + dz * _p.x) / len;
      }
    }
    this.audio.update(dt, { gust: this.gust, outdoors, height: Math.max(0, player.y), radio: best < Infinity ? { dist: best, pan } : null });
  }

  /** The real lights go to the nearest lit rooms; they flicker with their room. */
  private updateRoomLights(player: Vector3): void {
    if (this.lights.length === 0) return;
    const near: [number, number][] = [];
    for (let i = 0; i < this.rooms.length; i += 5) {
      const d = Math.hypot(this.rooms[i] - player.x, (this.rooms[i + 1] - player.y - 1.5) * 1.5, this.rooms[i + 2] - player.z);
      if (d < ROOM_LIGHT_RANGE) near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    this.lights.forEach((l, n) => {
      const hit = near[n];
      if (!hit) {
        l.intensity = 0;
        return;
      }
      const i = hit[1];
      l.position.set(this.rooms[i], this.rooms[i + 1] - 0.1, this.rooms[i + 2]);
      l.intensity = 7 * flicker(this.time, this.rooms[i + 4], this.rooms[i + 3]);
    });
  }

  private wind(dt: number): void {
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 2 + Math.random() * 5;
      this.gustTarget = Math.random() < 0.3 ? 0.7 + Math.random() * 0.3 : 0.15 + Math.random() * 0.35;
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.8);
    this.windDir += (Math.random() - 0.5) * dt * 0.05;
  }

  private rebuild(): void {
    this.dirty = false;
    let g = 0;
    let c = 0;
    this.radios.length = 0;
    this.shards.length = 0;
    this.rooms.length = 0;
    // Rooms whose interior is here: their facade windows step aside for the real room.
    const inside = new Set<number>();
    for (const spots of this.sets.values()) for (let i = 0; i + LIFE_STRIDE <= spots.length; i += LIFE_STRIDE) if (spots[i] === LIFE.room) inside.add(spots[i + 9]);
    const glow = (kind: number, seed: number, mode: number, strength: number) => {
      this.glow.setMatrixAt(g, _m);
      this.glowData.setXYZW(g, kind, seed, mode, strength);
      g++;
    };
    for (const spots of this.sets.values()) {
      for (let i = 0; i + LIFE_STRIDE <= spots.length; i += LIFE_STRIDE) {
        const kind = spots[i];
        const x = spots[i + 1];
        const y = spots[i + 2];
        const z = spots[i + 3];
        const yaw = Math.atan2(spots[i + 4], spots[i + 5]);
        const w = spots[i + 6];
        const h = spots[i + 7];
        const seed = spots[i + 8];
        const tag = spots[i + 9];
        if (kind === LIFE.window && g < GLOW_CAP) {
          if (inside.has(tag)) continue;
          // All windows of one room share the flicker phase (seed from the room's tag).
          _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_y, yaw), _s.set(w, h, 1));
          glow(0, (tag % 997) / 997, seed, 0.9);
        } else if (kind === LIFE.room && g + 2 < GLOW_CAP) {
          // The lamp, its glow on the ceiling, the pool of light on the floor.
          const phase = (tag % 997) / 997;
          this.rooms.push(x, y, z, seed, phase);
          _m.compose(_p.set(x, y + 0.02, z), _q.setFromAxisAngle(_x, Math.PI / 2), _s.set(0.7, 0.7, 1));
          glow(4, phase, seed, 1);
          _m.compose(_p.set(x, y + 0.45, z), _q.setFromAxisAngle(_x, Math.PI / 2), _s.set(3.2, 3.2, 1));
          glow(3, phase, seed, 0.35);
          const pool = Math.min(w, 5);
          _m.compose(_p.set(x, y - h + 0.03, z), _q.setFromAxisAngle(_x, -Math.PI / 2), _s.set(pool, pool * 0.85, 1));
          glow(3, phase, seed, 0.55);
        } else if (kind === LIFE.lamp && g + 1 < GLOW_CAP) {
          _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_x, Math.PI / 2), _s.set(w, 0.16, 1));
          const mode = seed < 0.6 ? 1 : 2;
          glow(1, seed, mode, 1);
          _m.compose(_p.set(x, y - h + 0.03, z), _q.setFromAxisAngle(_x, -Math.PI / 2), _s.set(3.4, 1.7, 1));
          glow(2, seed, mode, 0.32);
        } else if (kind === LIFE.curtain && c < CLOTH_CAP - PAPERS) {
          _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_y, yaw), _s.set(w, h, 1));
          this.cloth.setMatrixAt(c, _m);
          this.cloth.setColorAt(c, _c.set(CURTAIN_COLORS[Math.floor(seed * CURTAIN_COLORS.length)]));
          this.clothData.setXY(c, 0.35 + seed * 0.3, seed);
          c++;
        } else if (kind === LIFE.radio) {
          this.radios.push(x, y, z);
        } else if (kind === LIFE.shards) {
          this.shards.push(x, z, w);
        }
      }
    }
    this.glow.count = g;
    this.glow.instanceMatrix.needsUpdate = true;
    this.glowData.needsUpdate = true;
    this.curtains = c;
    // Papers follow the curtains in the cloth mesh.
    for (let i = 0; i < PAPERS; i++) {
      this.cloth.setColorAt(c + i, _c.set(0xbdb6a2));
      this.clothData.setXY(c + i, 0, 0);
    }
    this.cloth.instanceMatrix.needsUpdate = true;
    if (this.cloth.instanceColor) this.cloth.instanceColor.needsUpdate = true;
    this.clothData.needsUpdate = true;
    this.cloth.count = c + (this.papersOn ? PAPERS : 0);
  }

  /** Paper blowing down the street around the player (outdoors in town only). */
  private updatePapers(dt: number, player: Vector3, on: boolean): void {
    if (on !== this.papersOn) {
      this.papersOn = on;
      this.cloth.count = this.curtains + (on ? PAPERS : 0);
      if (on) for (const p of this.papers) this.respawn(p, player, true);
    }
    if (!on) return;
    const wx = Math.cos(this.windDir);
    const wz = Math.sin(this.windDir);
    const speed = 0.4 + this.gust * 4.2;
    for (let i = 0; i < PAPERS; i++) {
      const p = this.papers[i];
      const ground = this.groundAt(p.x, p.z) + 0.012;
      const air = p.y > ground + 0.03;
      const pull = Math.min(1, dt * (air ? 2.2 : 0.6 + this.gust * 1.5));
      p.vx += (wx * speed * p.spin - p.vx) * pull;
      p.vz += (wz * speed * p.spin - p.vz) * pull;
      if (!air && this.gust > 0.6 && Math.random() < dt * 1.5) p.vy = 0.8 + Math.random() * 1.6;
      p.vy -= 2.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y <= ground) {
        p.y = ground;
        p.vy = 0;
        p.vx *= 1 - Math.min(1, dt * 2);
        p.vz *= 1 - Math.min(1, dt * 2);
        p.rx += (-Math.PI / 2 - p.rx) * Math.min(1, dt * 8);
      } else {
        p.rx += dt * 7 * p.spin;
      }
      p.ry += dt * Math.hypot(p.vx, p.vz) * 1.5 * p.spin;
      if (Math.hypot(p.x - player.x, p.z - player.z) > PAPER_RANGE) this.respawn(p, player, false);
      _q.setFromEuler(_e.set(p.rx, p.ry, 0, 'YXZ'));
      _m.compose(_p.set(p.x, p.y + 0.004, p.z), _q, _s.set(0.3, 0.4, 1));
      this.cloth.setMatrixAt(this.curtains + i, _m);
    }
    this.cloth.instanceMatrix.needsUpdate = true;
  }

  /** Upwind of the player (or anywhere around at first), lying on the ground. */
  private respawn(p: Paper, player: Vector3, anywhere: boolean): void {
    const a = anywhere ? Math.random() * Math.PI * 2 : this.windDir + Math.PI + (Math.random() - 0.5) * 1.6;
    const r = anywhere ? 1.5 + Math.random() * (PAPER_RANGE - 3) : PAPER_RANGE * (0.6 + Math.random() * 0.35);
    p.x = player.x + Math.cos(a) * r;
    p.z = player.z + Math.sin(a) * r;
    p.y = this.groundAt(p.x, p.z) + 0.012;
    p.vx = p.vy = p.vz = 0;
    p.rx = -Math.PI / 2;
    p.ry = Math.random() * Math.PI * 2;
  }

  /** Both programs compile during the loading-screen prewarm (instanced meshes with no instances draw nothing). */
  prewarm(): () => void {
    this.glow.count = Math.max(1, this.glow.count);
    this.cloth.count = Math.max(1, this.cloth.count);
    return () => {
      this.dirty = true;
    };
  }

  dispose(): void {
    this.scene.remove(this.glow, this.cloth);
    this.glow.geometry.dispose();
    this.glowMat.dispose();
    this.cloth.geometry.dispose();
    (this.cloth.material as MeshLambertMaterial).dispose();
  }
}

const GLOW_VERT = /* glsl */ `
attribute vec4 aGlow; // kind, seed, mode, strength
uniform float uTime;
varying vec2 vUv;
varying float vI;
varying float vKind;
varying float vDepth;
varying vec3 vView;
varying vec2 vSize;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vUv = uv;
  vKind = aGlow.x;
  float t = uTime + aGlow.y * 37.0;
  float mode = aGlow.z;
  float fast = hash(floor(t * 14.0) + aGlow.y * 131.0);
  float slow = hash(floor(t * 1.6) + aGlow.y * 71.0);
  float f;
  if (mode < 0.5) f = 0.8 + 0.12 * sin(t * 6.3) * sin(t * 2.9) + 0.08 * sin(t * 13.0);  // generator / candles
  else if (mode < 1.5) f = slow < 0.18 ? step(0.45, fast) : 1.0;                         // tube with dropouts
  else f = slow < 0.4 ? step(0.35, fast) : 0.04;                                          // dying, bursts of light
  vI = f * aGlow.w;
  mat4 mi = modelMatrix * instanceMatrix;
  vec4 wp = mi * vec4(position, 1.0);
  // Window rooms: the view ray in the window's frame (x across, y up, z into the room).
  float sw = length(mi[0].xyz);
  float sh = length(mi[1].xyz);
  vec3 view = wp.xyz - cameraPosition;
  vView = vec3(dot(view, mi[0].xyz / sw), dot(view, mi[1].xyz / sh), -dot(view, normalize(mi[2].xyz)));
  vSize = vec2(sw, sh);
  vec4 mvPosition = viewMatrix * wp;
  vDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uWarm;
uniform vec3 uCold;
uniform vec3 uFog; // near, far
varying vec2 vUv;
varying float vI;
varying float vKind;
varying float vDepth;
varying vec3 vView;
varying vec2 vSize;
void main() {
  vec2 c = vUv - 0.5;
  float a;
  vec3 col;
  if (vKind < 0.5) {
    // A lit room behind the window (interior mapping): the ray from the eye through the glass hits
    // the back wall, a side wall, the ceiling or the floor of a 3.6 m deep room; a lamp hangs inside.
    vec3 r = normalize(vView);
    r.z = max(r.z, 0.02);
    vec3 p = vec3(c.x * vSize.x, c.y * vSize.y, 0.0);
    float hw = vSize.x * 1.4;
    float fl = -vSize.y * 0.5 - 0.8;
    float ce = vSize.y * 0.5 + 0.55;
    float dep = 3.6;
    float tx = ((r.x > 0.0 ? hw : -hw) - p.x) / (abs(r.x) < 1e-4 ? 1e-4 : r.x);
    float ty = ((r.y > 0.0 ? ce : fl) - p.y) / (abs(r.y) < 1e-4 ? 1e-4 : r.y);
    float tz = dep / r.z;
    float t = min(tx, min(ty, tz));
    vec3 hp = p + r * t;
    float face = t >= tz - 1e-3 ? 1.0 : (t >= ty - 1e-3 ? (r.y > 0.0 ? 0.85 : 0.45) : 0.7);
    vec3 lamp = vec3(0.0, ce - 0.3, dep * 0.55);
    float dl = length(hp - lamp);
    float lit = face * (0.25 + 1.1 / (1.0 + dl * dl * 0.4));
    vec3 toLamp = lamp - p;
    float along = dot(toLamp, r);
    float bulb = smoothstep(0.3, 0.04, length(toLamp - r * along)) * step(0.0, along) * step(along, t + 0.01);
    float curtain = 1.0 - 0.65 * smoothstep(0.26, 0.42, abs(c.x));
    a = smoothstep(0.5, 0.44, abs(c.x)) * smoothstep(0.5, 0.45, abs(c.y));
    col = uWarm * (lit * curtain + bulb * 2.5);
  } else if (vKind < 1.5) {
    a = smoothstep(0.5, 0.15, abs(c.y)) * smoothstep(0.5, 0.42, abs(c.x));
    col = uCold * 1.8;
  } else if (vKind < 2.5) {
    a = pow(max(0.0, 1.0 - length(c) * 2.0), 2.0);
    col = uCold;
  } else if (vKind < 3.5) {
    // Warm pool of lamplight (floor, ceiling).
    a = pow(max(0.0, 1.0 - length(c) * 2.0), 1.6);
    col = uWarm;
  } else {
    // The lamp: a bright core.
    a = pow(max(0.0, 1.0 - length(c) * 2.0), 3.0);
    col = uWarm * 3.0;
  }
  float fog = smoothstep(uFog.x, uFog.y, vDepth);
  gl_FragColor = vec4(col * a * vI * (1.0 - fog), 1.0);
}`;
