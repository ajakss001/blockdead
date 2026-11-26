import { BufferAttribute, BufferGeometry, type Fog, Points, type Scene, ShaderMaterial, Vector2, type Vector3 } from 'three';

const N = 480;
const KIND = { dust: 0, drop: 1, splash: 2, leaf: 3, smoke: 4, spark: 5, moth: 6, mote: 7, puff: 8 } as const;
/** Moths circle one of a few centres (a lamp, the flashlight's beam). */
const MOTH_GROUPS = 8;
const _v = new Vector2();

/**
 * Every small particle in the world — one Points object, one draw call, a ring buffer: dust where a blow
 * lands (no blood — kid-friendly), drops from a leaking ceiling or a broken hydrant and their splash, leaves
 * the wind tears off, smoke and sparks over a fire, moths round a lamp, dust in the flashlight's beam, your
 * breath in the cold. Each has its own size (world units, growing or not), colour, shape and fade.
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
  /** Where a drop / a leaf stops falling; a moth's group. */
  private readonly floor = new Float32Array(N);
  private readonly phase = new Float32Array(N);
  /** Size and alpha at birth, size at the end (smoke, breath grow as they fade). */
  private readonly size0 = new Float32Array(N);
  private readonly size1 = new Float32Array(N);
  private readonly alpha0 = new Float32Array(N);
  private readonly mothAt = new Float32Array(MOTH_GROUPS * 3);
  private next = 0;
  private live = 0;
  private time = 0;
  /** Wind for leaves and smoke: x, z velocity, m/s. */
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

  private take(kind: number, x: number, y: number, z: number, life: number, size: number, shape: number, alpha: number, r: number, g: number, b: number): number {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.kind[i] = kind;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([0, 0, 0], i * 3);
    this.col.set([r, g, b], i * 3);
    this.look.set([size, shape, alpha, Math.random() * 6], i * 4);
    this.age[i] = 0;
    this.life[i] = life;
    this.phase[i] = Math.random() * 6.28;
    this.size0[i] = size;
    this.size1[i] = size;
    this.alpha0[i] = alpha;
    return i;
  }

  /** Grey dust puffing out where a blow lands. */
  burst(at: Vector3, count = 10, spread = 1): void {
    for (let k = 0; k < count; k++) {
      const i = this.take(KIND.dust, at.x, at.y, at.z, 0.6, 0.045, 0, 0.75, 0.55, 0.53, 0.49);
      this.vel.set([(Math.random() - 0.5) * 1.6 * spread, Math.random() * 1.2 * spread, (Math.random() - 0.5) * 1.6 * spread], i * 3);
    }
  }

  /** A water drop from (x, y, z), thrown with (vx, vy, vz), falling to `floorY` where it splashes. */
  drop(x: number, y: number, z: number, floorY: number, vx = 0, vy = 0, vz = 0, size = 0.03): void {
    const i = this.take(KIND.drop, x, y, z, 4, size, 1, 0.8, 0.66, 0.72, 0.78);
    this.vel.set([vx, vy, vz], i * 3);
    this.floor[i] = floorY;
  }

  /** A leaf let go at (x, y, z), drifting down with the wind to `groundY`. */
  leaf(x: number, y: number, z: number, groundY: number): void {
    const t = Math.random();
    const i = this.take(KIND.leaf, x, y, z, 9, 0.09 + Math.random() * 0.05, 2, 1, 0.42 + t * 0.25, 0.3 + t * 0.12, 0.12 + t * 0.04);
    this.vel.set([this.windX * 0.5, 0, this.windZ * 0.5], i * 3);
    this.floor[i] = groundY;
  }

  /** A shower of sparks off a torn cable. */
  sparks(x: number, y: number, z: number, n = 6): void {
    for (let k = 0; k < n; k++) {
      const s = this.take(KIND.spark, x, y, z, 0.4 + Math.random() * 0.4, 0.02, 0, 1, 1, 0.85, 0.45);
      this.vel.set([(Math.random() - 0.5) * 2.4, Math.random() * 1.6, (Math.random() - 0.5) * 2.4], s * 3);
    }
  }

  /** A puff of white steam (or a thin wisp of smoke off something burnt out: `shade` grey). */
  steam(x: number, y: number, z: number, shade = 0.75, vx = 0, vz = 0): void {
    const i = this.take(KIND.smoke, x, y, z, 1.6 + Math.random() * 0.8, 0.2, 0, shade > 0.5 ? 0.35 : 0.22, shade, shade, shade * 1.03);
    this.size1[i] = 0.9 + Math.random() * 0.6;
    this.vel.set([vx + (Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.3, vz + (Math.random() - 0.5) * 0.3], i * 3);
  }

  /** Compact low-opacity gunsmoke puff that clears quickly ahead of the muzzle without blocking ADS. */
  muzzleSmoke(x: number, y: number, z: number, dx = 0, dy = 0, dz = 0): void {
    const shade = 0.62 + Math.random() * 0.08;
    const i = this.take(
      KIND.puff,
      x + (Math.random() - 0.5) * 0.02,
      y + (Math.random() - 0.5) * 0.02,
      z + (Math.random() - 0.5) * 0.02,
      0.22 + Math.random() * 0.12,
      0.025 + Math.random() * 0.010,
      0,
      0.12 + Math.random() * 0.06,
      shade,
      shade,
      shade * 1.02,
    );
    this.size1[i] = 0.08 + Math.random() * 0.04;
    this.vel.set(
      [
        dx * 0.75 + (Math.random() - 0.5) * 0.16,
        dy * 0.45 + 0.22 + Math.random() * 0.10,
        dz * 0.75 + (Math.random() - 0.5) * 0.16,
      ],
      i * 3,
    );
  }

  /** A puff of smoke rising off a fire, spreading and thinning; now and then a spark. */
  smoke(x: number, y: number, z: number): void {
    const d = 0.1 + Math.random() * 0.1;
    const i = this.take(KIND.smoke, x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, 3.5 + Math.random() * 1.5, 0.35, 0, 0.32, d, d, d * 1.05);
    this.size1[i] = 1.8 + Math.random() * 0.8;
    this.vel.set([0, 0.7 + Math.random() * 0.4, 0], i * 3);
    if (Math.random() < 0.25) {
      const s = this.take(KIND.spark, x, y + 0.2, z, 0.8 + Math.random() * 0.6, 0.025, 0, 1, 1, 0.55, 0.15);
      this.vel.set([(Math.random() - 0.5) * 0.8, 1.4 + Math.random() * 1.4, (Math.random() - 0.5) * 0.8], s * 3);
    }
  }

  /** Moths of group `g` circle (x, y, z) — call it every frame the light is there; they live a few seconds. */
  mothCenter(g: number, x: number, y: number, z: number): void {
    this.mothAt.set([x, y, z], g * 3);
  }

  moth(g: number): void {
    const i = this.take(KIND.moth, this.mothAt[g * 3], this.mothAt[g * 3 + 1], this.mothAt[g * 3 + 2], 4 + Math.random() * 3, 0.014, 0, 0.55, 0.62, 0.58, 0.5);
    this.floor[i] = g;
    // Orbit: radius, speeds.
    this.vel.set([0.25 + Math.random() * 0.4, 2 + Math.random() * 3, 1 + Math.random() * 2], i * 3);
  }

  /** A speck of dust hanging in the flashlight's beam. */
  mote(x: number, y: number, z: number): void {
    const i = this.take(KIND.mote, x, y, z, 2.5 + Math.random() * 1.5, 0.008 + Math.random() * 0.006, 0, 0.45, 0.85, 0.82, 0.75);
    this.vel.set([(Math.random() - 0.5) * 0.06, (Math.random() - 0.6) * 0.04, (Math.random() - 0.5) * 0.06], i * 3);
  }

  /** Breath in the cold: a little white cloud from the mouth, spreading as it goes. */
  breath(x: number, y: number, z: number, dx: number, dz: number): void {
    for (let k = 0; k < 5; k++) {
      const i = this.take(KIND.puff, x + dx * 0.05 * k, y, z + dz * 0.05 * k, 1.1 + Math.random() * 0.4, 0.05, 0, 0.22, 0.85, 0.87, 0.9);
      this.size1[i] = 0.3 + Math.random() * 0.15;
      this.vel.set([dx * (0.45 + Math.random() * 0.2), 0.08 + Math.random() * 0.06, dz * (0.45 + Math.random() * 0.2)], i * 3);
    }
  }

  private splash(x: number, y: number, z: number): void {
    for (let k = 0; k < 3; k++) {
      const i = this.take(KIND.splash, x, y + 0.01, z, 0.28, 0.018, 0, 0.7, 0.6, 0.66, 0.72);
      const a = Math.random() * 6.28;
      this.vel.set([Math.cos(a) * 0.5, 0.6 + Math.random() * 0.5, Math.sin(a) * 0.5], i * 3);
    }
  }

  update(dt: number): void {
    this.time += dt;
    let live = 0;
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= this.life[i]) continue;
      live++;
      this.age[i] += dt;
      const o = i * 3;
      const lo = i * 4;
      if (this.age[i] >= this.life[i]) {
        this.pos[o + 1] = -1000;
        continue;
      }
      const k = this.kind[i];
      const t = this.age[i] / this.life[i];
      switch (k) {
        case KIND.drop:
          this.vel[o + 1] -= 9.8 * dt;
          for (let a = 0; a < 3; a++) this.pos[o + a] += this.vel[o + a] * dt;
          if (this.pos[o + 1] <= this.floor[i] && this.vel[o + 1] < 0) {
            this.age[i] = this.life[i];
            this.pos[o + 1] = -1000;
            this.splash(this.pos[o], this.floor[i], this.pos[o + 2]);
          }
          break;
        case KIND.leaf: {
          if (this.pos[o + 1] <= this.floor[i] + 0.01) {
            // On the ground: lie still, fade out.
            this.pos[o + 1] = this.floor[i] + 0.01;
            this.look[lo + 2] = Math.max(0, this.look[lo + 2] - dt * 0.6);
            if (this.look[lo + 2] <= 0) this.age[i] = this.life[i];
            break;
          }
          // Flutter: a slow fall that swings side to side, carried by the wind.
          const ph = this.phase[i] + this.age[i] * 2.6;
          const pull = Math.min(1, dt * 1.5);
          this.vel[o] += (this.windX + Math.cos(ph) * 0.6 - this.vel[o]) * pull;
          this.vel[o + 2] += (this.windZ + Math.sin(ph * 0.8) * 0.6 - this.vel[o + 2]) * pull;
          this.vel[o + 1] = -0.45 - 0.35 * Math.abs(Math.sin(ph));
          for (let a = 0; a < 3; a++) this.pos[o + a] += this.vel[o + a] * dt;
          this.look[lo + 3] += dt * 4;
          break;
        }
        case KIND.moth: {
          // Round its light, a jittery orbit.
          const g = this.floor[i] * 3;
          const ph = this.phase[i] + this.age[i] * this.vel[o + 1];
          const r = this.vel[o] * (0.8 + 0.2 * Math.sin(this.age[i] * 7 + this.phase[i]));
          this.pos[o] = this.mothAt[g] + Math.cos(ph) * r;
          this.pos[o + 1] = this.mothAt[g + 1] + Math.sin(this.age[i] * this.vel[o + 2] + this.phase[i]) * 0.18;
          this.pos[o + 2] = this.mothAt[g + 2] + Math.sin(ph) * r;
          this.look[lo + 2] = 0.55 * Math.min(1, (1 - t) * 4, t * 8);
          break;
        }
        case KIND.smoke:
        case KIND.puff:
        case KIND.mote: {
          // Drifting with the wind (smoke), slowing (breath), hanging (dust); growing and fading.
          if (k === KIND.smoke) {
            this.vel[o] += (this.windX * 0.6 - this.vel[o]) * Math.min(1, dt * 0.8);
            this.vel[o + 2] += (this.windZ * 0.6 - this.vel[o + 2]) * Math.min(1, dt * 0.8);
          } else if (k === KIND.puff) for (let a = 0; a < 3; a++) this.vel[o + a] *= 1 - Math.min(1, dt * 1.8);
          for (let a = 0; a < 3; a++) this.pos[o + a] += this.vel[o + a] * dt;
          this.look[lo] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
          this.look[lo + 2] = this.alpha0[i] * Math.min(1, t * 6) * (1 - t);
          break;
        }
        default:
          // Dust, splash, sparks: gravity and drag (sparks rise, then fall, fading).
          this.vel[o + 1] -= (k === KIND.splash ? 6 : k === KIND.spark ? 1.2 : 2.5) * dt;
          for (let a = 0; a < 3; a++) {
            this.vel[o + a] *= 1 - 2.2 * dt * (k === KIND.spark ? 0.3 : 1);
            this.pos[o + a] += this.vel[o + a] * dt;
          }
          if (k === KIND.spark) this.look[lo + 2] = 1 - t;
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
precision mediump float;
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
