import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  type PerspectiveCamera,
  Quaternion,
  RedFormat,
  RepeatWrapping,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  UnsignedByteType,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sfx } from '../audio/Sound';

/*
 * The sky over the dead city: clouds drifting with the wind (one dome, one pre-baked noise texture,
 * two samples a pixel; dark and moon-rimmed at night, light by day), and now and then something
 * crossing it — a military transport plane high up, or a helicopter lower down with blinking lights
 * and a searchlight sweeping the streets. Purely visual for now (no game mechanics), with sound that
 * swells as it nears and fades as it goes.
 *
 * The camera's far plane is short (fog), so far things are drawn "projected": a craft really flying
 * at 300 m is drawn on the same line of sight at SKY_R, scaled down by SKY_R / distance — it looks
 * exactly the same and is never clipped. Fog does not touch them (they are above it).
 */

/** Radius of the dome and of the projected sky objects, as a share of the camera's far plane. */
const SKY_SHARE = 0.85;
const SKY_R = 42;
/** Minutes between flyovers (random within). */
const GAP_MIN = [10, 20] as const;
const FIRST_MIN = [2.5, 6] as const;

interface Flight {
  kind: 'plane' | 'heli';
  t: number;
  dur: number;
  from: Vector3;
  to: Vector3;
  /** Heli: wobble and the searchlight. */
  seed: number;
}

const _p = new Vector3();
const _d = new Vector3();
const _ray = new Vector3();
const _q = new Quaternion();
const _qb = new Quaternion();
/** Half-angle of the searchlight's cone (the beam mesh: radius 9 at 60 m). */
const BEAM_HALF = Math.atan(9 / 60);

/** A soft round pool of light, brighter in the middle, a ragged edge. */
function poolTexture(): CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.2)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return new CanvasTexture(c);
}

export class Sky {
  private readonly dome: Mesh;
  private readonly domeMat: ShaderMaterial;
  private readonly plane: Group;
  private readonly heli: Group;
  private readonly beacons: Mesh[] = [];
  private readonly beam: Mesh;
  private readonly rotor: Mesh;
  private flight: Flight | null = null;
  /**
   * Where the searchlight meets the ground: a real spot light from the helicopter's true position (medium and
   * high quality) or a soft glow disc on the ground (low: no extra light in the shaders).
   */
  private readonly spot: SpotLight;
  private readonly spotTarget = new Object3D();
  private readonly pool: Mesh;
  private realSpot = false;
  /** Ground height under a point (the world sets it). */
  groundAt: (x: number, z: number) => number = () => 0;
  private next = (FIRST_MIN[0] + Math.random() * (FIRST_MIN[1] - FIRST_MIN[0])) * 60;
  private time = 0;
  private sound: { gain: GainNode; rate: AudioParam[] } | null = null;
  /** Wind for the clouds, m/s-ish in texture space. */
  wind = new Vector3(0.006, 0, 0.0025);

  constructor(
    scene: Scene,
    skyColor: number,
    moonDir: Vector3,
  ) {
    this.domeMat = new ShaderMaterial({
      uniforms: {
        uTex: { value: cloudTexture(256) },
        uTime: { value: 0 },
        uWind: { value: new Vector3() },
        uSky: { value: new Color(skyColor) },
        uMoon: { value: moonDir.clone().normalize() },
        uDay: { value: 0 },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new Mesh(new SphereGeometry(SKY_R + 4, 24, 12), this.domeMat);
    this.dome.name = 'sky:dome';
    // Drawn after the opaque world: covered pixels fail the depth test early.
    this.dome.renderOrder = 1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.plane = this.buildPlane();
    this.heli = this.buildHeli();
    this.rotor = this.heli.getObjectByName('rotor') as Mesh;
    this.beam = this.heli.getObjectByName('beam') as Mesh;
    this.plane.visible = this.heli.visible = false;
    scene.add(this.plane, this.heli);

    this.spot = new SpotLight(0xc8d4dc, 0, 0, BEAM_HALF * 1.15, 0.55, 0);
    this.spot.castShadow = false;
    this.spot.target = this.spotTarget;
    this.pool = new Mesh(
      new CircleGeometry(1, 24).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: poolTexture(), color: 0xc8d4dc, transparent: true, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.pool.name = 'sky:searchlightPool';
    this.pool.visible = false;
    this.pool.renderOrder = 2;
    scene.add(this.pool, this.spot, this.spotTarget);
  }

  /** A real spot light on the ground (medium/high) or only the glow disc (low). Intensity is 0 on low. */
  set searchlightLight(on: boolean) {
    if (on === this.realSpot) return;
    this.realSpot = on;
    if (!on) this.spot.intensity = 0;
  }

  /** Daylight 0..1 (the game is always at night for now; stage 5 drives this). */
  set daylight(v: number) {
    this.domeMat.uniforms.uDay.value = v;
  }

  /** Sky (and fog) color the clouds fade into at the horizon. */
  set skyColor(c: Color) {
    this.domeMat.uniforms.uSky.value.copy(c);
  }

  update(dt: number, camera: PerspectiveCamera, paused: boolean): void {
    // Inside the far plane on every preset (the far plane follows the fog distance).
    const R = camera.far * SKY_SHARE;
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(R / (SKY_R + 4));
    if (paused) return;
    this.time += dt;
    this.domeMat.uniforms.uTime.value = this.time;
    this.domeMat.uniforms.uWind.value.copy(this.wind);

    if (!this.flight) {
      this.next -= dt;
      if (this.next <= 0) this.start(camera.position);
      if (!this.flight) return;
    }
    const f = this.flight;
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) {
      this.end();
      this.groundSpot(null, camera);
      return;
    }
    // Real position on the route, and the projection onto the sky sphere.
    _p.lerpVectors(f.from, f.to, k);
    if (f.kind === 'heli') {
      _p.y += Math.sin(f.t * 0.7 + f.seed) * 4;
      _p.x += Math.sin(f.t * 0.23 + f.seed * 3) * 25;
    }
    const obj = f.kind === 'plane' ? this.plane : this.heli;
    _d.subVectors(_p, camera.position);
    const dist = _d.length();
    const s = Math.min(1, (R * 0.92) / dist);
    obj.position.copy(camera.position).addScaledVector(_d, s);
    obj.scale.setScalar(s);
    obj.visible = true;
    // Nose along the route.
    _d.subVectors(f.to, f.from).normalize();
    obj.rotation.set(0, Math.atan2(-_d.z, _d.x), f.kind === 'heli' ? -0.12 : 0);
    // Beacons blink; the heli's rotor spins and its searchlight sweeps.
    const blink = (this.time % 1.2) < 0.12;
    for (const b of this.beacons) b.visible = blink === b.userData.on;
    if (f.kind === 'heli') {
      this.rotor.rotation.y += dt * 38;
      this.beam.rotation.set(0.35 + Math.sin(this.time * 0.6 + f.seed) * 0.3, 0, Math.sin(this.time * 0.4) * 0.4);
      this.groundSpot(_p, camera);
    }
    // Sound: loudness from the real distance, a little doppler from the closing speed.
    if (this.sound && sfx.ac) {
      const level = (f.kind === 'plane' ? 0.32 : 0.45) / (1 + (dist / (f.kind === 'plane' ? 260 : 120)) ** 2);
      const fade = Math.min(1, k * 8, (1 - k) * 8);
      this.sound.gain.gain.setTargetAtTime(level * fade, sfx.ac.currentTime, 0.3);
      const v = (_d.copy(f.to).sub(f.from).divideScalar(f.dur)).dot(_p.clone().sub(camera.position).normalize());
      const rate = Math.max(0.85, Math.min(1.15, 1 - v / 340));
      for (const r of this.sound.rate) r.setTargetAtTime(r.defaultValue * rate, sfx.ac.currentTime, 0.4);
    }
  }

  /**
   * The searchlight on the ground: the beam's direction from the helicopter's true position (not the drawn copy
   * inside the sky), down to the ground; a pool of light there that sweeps with the beam. Fades in the day.
   */
  private groundSpot(at: Vector3 | null, camera: PerspectiveCamera): void {
    const night = 1 - (this.domeMat.uniforms.uDay.value as number);
    let on = false;
    if (at && night > 0.05) {
      _q.setFromEuler(this.heli.rotation);
      _qb.setFromEuler(this.beam.rotation);
      _ray.set(0, -1, 0).applyQuaternion(_q.multiply(_qb));
      if (_ray.y < -0.25) {
        // Flat ground at the camera's level first, then the real height there (once more for slopes).
        let gy = camera.position.y - 1.6;
        let t = (at.y - gy) / -_ray.y;
        for (let i = 0; i < 2; i++) {
          gy = this.groundAt(at.x + _ray.x * t, at.z + _ray.z * t);
          t = (at.y - gy) / -_ray.y;
        }
        const hx = at.x + _ray.x * t;
        const hz = at.z + _ray.z * t;
        // Only near enough to be seen (inside the far plane).
        if (Math.hypot(hx - camera.position.x, hz - camera.position.z) < camera.far * 0.9) {
          on = true;
          const r = Math.tan(BEAM_HALF) * t;
          // A slow shimmer as the rotor chops the light.
          const flick = 0.9 + 0.1 * Math.sin(this.time * 31);
          if (this.realSpot) {
            this.spot.position.copy(at);
            this.spotTarget.position.set(hx, gy, hz);
            this.spot.intensity = 3.2 * night * flick;
          }
          this.pool.position.set(hx, gy + 0.06, hz);
          this.pool.scale.set(r, 1, r);
          (this.pool.material as MeshBasicMaterial).opacity = (this.realSpot ? 0.18 : 0.55) * night * flick;
        }
      }
    }
    this.pool.visible = on;
    if (!on) this.spot.intensity = 0;
  }

  /** Start a flyover now (dev: `__game.scene.sky.start()`). */
  start(center: Vector3, want?: Flight['kind']): void {
    const kind: Flight['kind'] = want ?? (Math.random() < 0.5 ? 'plane' : 'heli');
    const a = Math.random() * Math.PI * 2;
    const off = (Math.random() - 0.5) * (kind === 'plane' ? 600 : 90);
    const half = kind === 'plane' ? 2200 : 700;
    const alt = kind === 'plane' ? 280 + Math.random() * 120 : 70 + Math.random() * 40;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const from = new Vector3(center.x - dx * half - dz * off, alt, center.z - dz * half + dx * off);
    const to = new Vector3(center.x + dx * half - dz * off, alt, center.z + dz * half + dx * off);
    const speed = kind === 'plane' ? 95 : 38;
    this.flight = { kind, t: 0, dur: (2 * half) / speed, from, to, seed: Math.random() * 10 };
    // Shown once positioned (next update).
    this.beam.visible = kind === 'heli';
    this.sound = this.engine(kind);
  }

  private end(): void {
    this.plane.visible = this.heli.visible = false;
    this.flight = null;
    this.next = (GAP_MIN[0] + Math.random() * (GAP_MIN[1] - GAP_MIN[0])) * 60;
    if (this.sound && sfx.ac) {
      const g = this.sound.gain;
      g.gain.setTargetAtTime(0, sfx.ac.currentTime, 0.3);
      window.setTimeout(() => g.disconnect(), 2000);
    }
    this.sound = null;
  }

  /** Engine drone: turboprops (low hum, beating) or rotor thump with a turbine whine. */
  private engine(kind: Flight['kind']): { gain: GainNode; rate: AudioParam[] } | null {
    const ac = sfx.ac;
    if (!ac || !sfx.world || !sfx.noise) return null;
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(sfx.world);
    const rate: AudioParam[] = [];
    const noise = ac.createBufferSource();
    noise.buffer = sfx.noise;
    noise.loop = true;
    const low = ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = kind === 'plane' ? 380 : 260;
    rate.push(noise.playbackRate);
    if (kind === 'plane') {
      noise.connect(low).connect(gain);
      for (const f of [58, 61.5, 117]) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const og = ac.createGain();
        og.gain.value = 0.18;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 300;
        o.connect(lp).connect(og).connect(gain);
        o.start();
        rate.push(o.frequency);
        window.setTimeout(() => o.stop(), 60000);
      }
    } else {
      // Blade slap: the noise chopped ~11 times a second.
      const chop = ac.createGain();
      chop.gain.value = 0.5;
      const lfo = ac.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 11;
      const depth = ac.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(chop.gain);
      noise.connect(low).connect(chop).connect(gain);
      lfo.start();
      rate.push(lfo.frequency);
      const whine = ac.createOscillator();
      whine.frequency.value = 1750;
      const wg = ac.createGain();
      wg.gain.value = 0.02;
      whine.connect(wg).connect(gain);
      whine.start();
      rate.push(whine.frequency);
      window.setTimeout(() => {
        lfo.stop();
        whine.stop();
      }, 60000);
    }
    noise.start();
    window.setTimeout(() => noise.stop(), 60000);
    return { gain, rate };
  }

  private buildPlane(): Group {
    // Four-engine military transport, ~30 m span, grey; low-poly, one mesh (+ beacons).
    const parts: BufferGeometry[] = [];
    const add = (g: BufferGeometry, color: number) => parts.push(tint(g, color));
    const grey = 0x2e3236;
    add(new CylinderGeometry(1.9, 1.9, 26, 8).rotateZ(Math.PI / 2), grey);
    add(new ConeGeometry(1.9, 4, 8).rotateZ(-Math.PI / 2).translate(15, 0, 0), grey);
    add(new ConeGeometry(1.9, 7, 8).rotateZ(Math.PI / 2).translate(-16.5, 0.6, 0), grey);
    add(new BoxGeometry(5, 0.35, 32).translate(1, 1.6, 0), grey);
    add(new BoxGeometry(3.2, 6, 0.3).translate(-18, 4, 0), grey);
    add(new BoxGeometry(3, 0.3, 11).translate(-18.5, 1.5, 0), grey);
    for (const z of [-11, -5.5, 5.5, 11]) add(new CylinderGeometry(0.7, 0.7, 4, 6).rotateZ(Math.PI / 2).translate(2.5, 1.2, z), 0x26292c);
    const g = new Group();
    const body = new Mesh(mergeGeometries(parts)!, new MeshBasicMaterial({ vertexColors: true, fog: false }));
    g.add(body);
    g.add(this.beacon(0xff3a2a, 1, 1.9, 16, true), this.beacon(0x3aff6a, 1, 1.9, -16, true), this.beacon(0xffffff, -21, 2, 0, false));
    g.name = 'sky:plane';
    return g;
  }

  private buildHeli(): Group {
    const parts: BufferGeometry[] = [];
    const add = (g: BufferGeometry, color: number) => parts.push(tint(g, color));
    const olive = 0x24281e;
    add(new BoxGeometry(5, 2.2, 2.2).translate(0, 0, 0), olive);
    add(new ConeGeometry(1.25, 2.2, 6).rotateZ(-Math.PI / 2).translate(3.5, -0.1, 0), olive);
    add(new CylinderGeometry(0.35, 0.2, 7, 6).rotateZ(Math.PI / 2).translate(-5.5, 0.4, 0), olive);
    add(new BoxGeometry(1.2, 1.8, 0.15).translate(-9, 1, 0), olive);
    for (const z of [-1, 1]) add(new BoxGeometry(4.5, 0.12, 0.12).translate(0.3, -1.6, z), 0x1a1a1a);
    const g = new Group();
    g.add(new Mesh(mergeGeometries(parts)!, new MeshBasicMaterial({ vertexColors: true, fog: false })));
    const rotor = new Mesh(new BoxGeometry(14, 0.06, 0.4), new MeshBasicMaterial({ color: 0x141414, fog: false }));
    rotor.position.y = 1.4;
    rotor.name = 'rotor';
    g.add(rotor);
    // Searchlight: a long additive cone hanging from the nose, sweeping.
    const cone = new ConeGeometry(9, 60, 12, 1, true).translate(0, -30, 0);
    const beam = new Mesh(cone, new MeshBasicMaterial({ color: 0x8a9aa8, transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false, fog: false }));
    beam.position.set(2.5, -1, 0);
    beam.name = 'beam';
    g.add(beam);
    g.add(this.beacon(0xff3a2a, -9, 2, 0, true), this.beacon(0xffffff, 0, -1.2, 0, false));
    g.name = 'sky:heli';
    return g;
  }

  private beacon(color: number, x: number, y: number, z: number, on: boolean): Mesh {
    const m = new Mesh(new SphereGeometry(0.45, 6, 4), new MeshBasicMaterial({ color, fog: false }));
    m.position.set(x, y, z);
    m.userData.on = on;
    this.beacons.push(m);
    return m;
  }
}

function tint(g: BufferGeometry, color: number): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const c = new Color(color);
  const n = out.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) data.set([c.r, c.g, c.b], i * 3);
  out.setAttribute('color', new Float32BufferAttribute(data, 3));
  return out;
}

/** Tileable value-noise fbm, one channel. */
function cloudTexture(size: number): DataTexture {
  const data = new Uint8Array(size * size);
  const grid = (n: number) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    return g;
  };
  const octaves = [4, 8, 16, 32].map((n) => ({ n, g: grid(n) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.55;
      for (const { n, g } of octaves) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const at = (i: number, j: number) => g[((j + n) % n) * n + ((i + n) % n)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += (a + (b - a) * ty) * amp;
        amp *= 0.5;
      }
      data[y * size + x] = Math.min(255, Math.max(0, Math.round((v / 1.03) * 255)));
    }
  }
  const tex = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DOME_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D uTex;
uniform highp float uTime;
uniform highp vec3 uWind;
uniform vec3 uSky;
uniform vec3 uMoon;
uniform float uDay;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  // A flat cloud layer above: project the view ray onto it.
  vec2 uv = d.xz / (max(up, 0.0) + 0.15);
  float a = texture2D(uTex, uv * 0.18 + uWind.xz * uTime).r;
  float b = texture2D(uTex, uv * 0.47 - uWind.zx * uTime * 1.6).r;
  float dens = smoothstep(0.42, 0.78, a * 0.7 + b * 0.3) * smoothstep(-0.02, 0.22, up);
  float moon = max(dot(d, uMoon), 0.0);
  // Night: dark clouds, rims lit by the moon where they are thin; day: a shade off the grey sky.
  vec3 night = vec3(0.045, 0.05, 0.065) + vec3(0.09, 0.1, 0.13) * pow(moon, 6.0) * (1.2 - dens);
  vec3 day = uSky * (1.3 - 0.4 * dens);
  vec3 cloud = mix(night, day, uDay);
  // The moon's glow through thin cloud.
  vec3 sky = uSky + vec3(0.05, 0.06, 0.08) * pow(moon, 60.0) * (1.0 - dens * 0.8);
  gl_FragColor = vec4(mix(sky, cloud, dens * 0.92), 1.0);
}`;
