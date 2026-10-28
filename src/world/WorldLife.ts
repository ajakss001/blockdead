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
  Quaternion,
  type Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { AmbientAudio } from '../audio/AmbientAudio';
import type { AnxietyAudio } from '../audio/AnxietyAudio';

/** Spot layout from the generators (Builder.life): kind, x, y, z, normal x, normal z, w, h, seed. */
export const LIFE_STRIDE = 9;
/** Spot kinds. */
export const LIFE = { window: 0, lamp: 1, curtain: 2, radio: 3 } as const;

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
        if (kind === LIFE.window && g < GLOW_CAP) {
          _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_y, yaw), _s.set(w, h, 1));
          glow(0, seed, seed < 0.55 ? 0 : 1, 0.55);
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
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
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
void main() {
  vec2 c = vUv - 0.5;
  float a;
  vec3 col;
  if (vKind < 0.5) {
    // Lit window: warm, brighter low (a lamp on a table), curtain folds.
    a = smoothstep(0.5, 0.36, abs(c.x)) * smoothstep(0.5, 0.33, abs(c.y)) * (0.7 + 0.3 * sin(vUv.x * 11.0)) * (1.1 - vUv.y * 0.5);
    col = uWarm;
  } else if (vKind < 1.5) {
    a = smoothstep(0.5, 0.15, abs(c.y)) * smoothstep(0.5, 0.42, abs(c.x));
    col = uCold * 1.8;
  } else {
    a = pow(max(0.0, 1.0 - length(c) * 2.0), 2.0);
    col = uCold;
  }
  float fog = smoothstep(uFog.x, uFog.y, vDepth);
  gl_FragColor = vec4(col * a * vI * (1.0 - fog), 1.0);
}`;
