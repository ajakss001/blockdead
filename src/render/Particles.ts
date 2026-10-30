import { BufferAttribute, BufferGeometry, type Fog, Points, type Scene, ShaderMaterial, Vector2, type Vector3 } from 'three';

const N = 320;
const KIND = { dust: 0, drop: 1, splash: 2, leaf: 3 } as const;
const _v = new Vector2();

/**
 * Every small particle in the world — one Points object, one draw call, a ring buffer: dust where a blow
 * lands (no blood — kid-friendly), water drops falling from a leaking ceiling and their splash, leaves the
 * wind tears off the trees. Each has its own size (world units), colour, shape and fade.
 */
export class Particles {
  readonly points: Points;
  private readonly pos = new Float32Array(N * 3);
  private readonly vel = new Float32Array(N * 3);
  private readonly col = new Float32Array(N * 3);
  /** size, shape (0 round, 1 streak, 2 leaf), alpha, spin */
  private readonly look = new Float32Array(N * 4);
  private readonly age = new Float32Array(N).fill(1);
  private readonly life = new Float32Array(N).fill(1);
  private readonly kind = new Uint8Array(N);
  /** Where a drop / a leaf stops falling. */
  private readonly floor = new Float32Array(N);
  private readonly phase = new Float32Array(N);
  private next = 0;
  private live = 0;
  /** Wind for the leaves: x, z velocity, m/s. */
  windX = 0;
  windZ = 0;
  private readonly uniforms = { uHalfH: { value: 400 }, uFog: { value: new Vector2(3, 50) } };

  constructor() {
    this.pos.fill(-1000);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new BufferAttribute(this.col, 3));
    g.setAttribute('aLook', new BufferAttribute(this.look, 4));
    const mat = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
    this.points = new Points(g, mat);
    this.points.frustumCulled = false;
    this.points.name = 'particles';
    this.points.onBeforeRender = (r, scene: Scene) => {
      r.getDrawingBufferSize(_v);
      this.uniforms.uHalfH.value = _v.y / 2;
      const fog = scene.fog as Fog | null;
      if (fog) this.uniforms.uFog.value.set(fog.near, fog.far);
    };
  }

  private take(kind: number, x: number, y: number, z: number, life: number): number {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.kind[i] = kind;
    this.pos.set([x, y, z], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.phase[i] = Math.random() * 6.28;
    return i;
  }

  /** Grey dust puffing out where a blow lands. */
  burst(at: Vector3, count = 10, spread = 1): void {
    for (let k = 0; k < count; k++) {
      const i = this.take(KIND.dust, at.x, at.y, at.z, 0.6);
      this.vel.set([(Math.random() - 0.5) * 1.6 * spread, Math.random() * 1.2 * spread, (Math.random() - 0.5) * 1.6 * spread], i * 3);
      this.col.set([0.55, 0.53, 0.49], i * 3);
      this.look.set([0.045, 0, 0.75, 0], i * 4);
    }
  }

  /** A water drop falling from (x, y, z) to `floorY`, where it splashes. */
  drop(x: number, y: number, z: number, floorY: number): void {
    const i = this.take(KIND.drop, x, y, z, 3);
    this.vel.set([0, 0, 0], i * 3);
    this.col.set([0.62, 0.68, 0.74], i * 3);
    this.look.set([0.03, 1, 0.8, 0], i * 4);
    this.floor[i] = floorY;
  }

  /** A leaf let go at (x, y, z), drifting down with the wind to `groundY`. */
  leaf(x: number, y: number, z: number, groundY: number): void {
    const i = this.take(KIND.leaf, x, y, z, 9);
    this.vel.set([this.windX * 0.5, 0, this.windZ * 0.5], i * 3);
    const t = Math.random();
    this.col.set([0.42 + t * 0.25, 0.3 + t * 0.12, 0.12 + t * 0.04], i * 3);
    this.look.set([0.09 + Math.random() * 0.05, 2, 1, Math.random() * 6], i * 4);
    this.floor[i] = groundY;
  }

  private splash(x: number, y: number, z: number): void {
    for (let k = 0; k < 4; k++) {
      const i = this.take(KIND.splash, x, y + 0.01, z, 0.28);
      const a = Math.random() * 6.28;
      this.vel.set([Math.cos(a) * 0.5, 0.6 + Math.random() * 0.5, Math.sin(a) * 0.5], i * 3);
      this.col.set([0.6, 0.66, 0.72], i * 3);
      this.look.set([0.018, 0, 0.7, 0], i * 4);
    }
  }

  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= this.life[i]) continue;
      live++;
      this.age[i] += dt;
      const o = i * 3;
      if (this.age[i] >= this.life[i]) {
        this.pos[o + 1] = -1000;
        continue;
      }
      const k = this.kind[i];
      if (k === KIND.drop) {
        this.vel[o + 1] -= 9.8 * dt;
        this.pos[o + 1] += this.vel[o + 1] * dt;
        if (this.pos[o + 1] <= this.floor[i]) {
          this.age[i] = this.life[i];
          this.pos[o + 1] = -1000;
          this.splash(this.pos[o], this.floor[i], this.pos[o + 2]);
        }
        continue;
      }
      if (k === KIND.leaf) {
        const lo = i * 4;
        if (this.pos[o + 1] <= this.floor[i] + 0.01) {
          // On the ground: lie still, fade out.
          this.pos[o + 1] = this.floor[i] + 0.01;
          this.look[lo + 2] = Math.max(0, this.look[lo + 2] - dt * 0.6);
          if (this.look[lo + 2] <= 0) this.age[i] = this.life[i];
          continue;
        }
        // Flutter: a slow fall that swings side to side, carried by the wind.
        const ph = this.phase[i] + this.age[i] * 2.6;
        const pull = Math.min(1, dt * 1.5);
        this.vel[o] += (this.windX + Math.cos(ph) * 0.6 - this.vel[o]) * pull;
        this.vel[o + 2] += (this.windZ + Math.sin(ph * 0.8) * 0.6 - this.vel[o + 2]) * pull;
        this.vel[o + 1] = -0.45 - 0.35 * Math.abs(Math.sin(ph));
        for (let a = 0; a < 3; a++) this.pos[o + a] += this.vel[o + a] * dt;
        this.look[lo + 3] += dt * 4;
        continue;
      }
      // Dust, splash: gravity and drag.
      this.vel[o + 1] -= (k === KIND.splash ? 6 : 2.5) * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[o + a] *= 1 - 2.2 * dt;
        this.pos[o + a] += this.vel[o + a] * dt;
      }
    }
    if (live || this.live) {
      const g = this.points.geometry;
      (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (g.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
      (g.getAttribute('aLook') as BufferAttribute).needsUpdate = true;
    }
    this.live = live;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aLook; // size, shape, alpha, spin
uniform float uHalfH;
uniform vec2 uFog;
varying vec3 vColor;
varying vec2 vLook;
varying float vSpin;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float fog = smoothstep(uFog.x, uFog.y, -mv.z);
  vLook = vec2(aLook.y, aLook.z * (1.0 - fog));
  vSpin = aLook.w;
  gl_PointSize = max(1.0, aLook.x * projectionMatrix[1][1] * uHalfH / max(0.05, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying vec2 vLook;
varying float vSpin;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a;
  if (vLook.x < 0.5) a = smoothstep(0.5, 0.3, length(c));
  else if (vLook.x < 1.5) a = smoothstep(0.5, 0.35, length(vec2(c.x * 3.5, c.y)));
  else {
    // A leaf: a pointed ellipse turning as it falls.
    float s = sin(vSpin), k = cos(vSpin);
    vec2 r = vec2(k * c.x - s * c.y, s * c.x + k * c.y);
    a = step(length(vec2(r.x * 2.2, r.y)) + abs(r.x) * 0.6, 0.48);
  }
  if (a * vLook.y < 0.02) discard;
  gl_FragColor = vec4(vColor, a * vLook.y);
}`;
