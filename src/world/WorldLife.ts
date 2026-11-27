import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  type Camera,
  CanvasTexture,
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  type Fog,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  type Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { AmbientAudio } from '../audio/AmbientAudio';
import type { AnxietyAudio } from '../audio/AnxietyAudio';
import { generateDecalCanvas } from '../render/look/decals';
import { LIFE } from './gen/lifeKinds';

/** Spot layout from the generators (Builder.life): kind, x, y, z, normal x, normal z, w, h, seed, tag. */
export const LIFE_STRIDE = 10;
/** Spot kinds (shared with the generators and Atmosphere). */
export { LIFE };
/** Real lights go to lit rooms within this distance, m. */
const ROOM_LIGHT_RANGE = 30;

const GLOW_CAP = 320;
/** Fires light the ground round them from this far (the nearest few get a real light). */
const FIRE_LIGHT_RANGE = 45;
const MAX_ROOM_LIGHTS = 2;
const MAX_FIRE_LIGHTS = 4;
const DYN_SHARD_CAP = 64;
const FLY_SHARD_CAP = 192;
const GLASS_DECAL_CAP = 64;

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _n = new Vector3();
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);
const _z = new Vector3(0, 0, 1);

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

/**
 * The city without zombies is still not dead: a window lit by someone's generator or candles here
 * and there (flickering), fluorescent tubes dying in a corridor, a car alarm in the distance, a radio left
 * on behind a door. Spots come from the generators (chunks and streamed interiors); glows are drawn by
 * one instanced mesh for the whole world and the sound is synthesized.
 */
export class WorldLife {
  private readonly sets = new Map<number, Float32Array>();
  private dirty = false;
  private readonly glow: InstancedMesh;
  private readonly glowData: InstancedBufferAttribute;
  private readonly glowMat: ShaderMaterial;
  private readonly radios: number[] = [];
  /** Broken glass on the ground: x, z, radius. */
  private readonly shards: number[] = [];
  /** Dynamically broken windows (multi-storey safe): { x, y, z, r }. */
  private readonly dynamicShards: { x: number; y: number; z: number; r: number }[] = [];
  private dynShardMesh: InstancedMesh | null = null;
  private dynShardTex: CanvasTexture | null = null;
  private dynShardMat: MeshStandardMaterial | null = null;
  private flyShardMesh: InstancedMesh | null = null;
  private flyShardMat: MeshStandardMaterial | null = null;
  private readonly flyPos = new Float32Array(FLY_SHARD_CAP * 3);
  private readonly flyVel = new Float32Array(FLY_SHARD_CAP * 3);
  private readonly flyRot = new Float32Array(FLY_SHARD_CAP * 3);
  private readonly flyAng = new Float32Array(FLY_SHARD_CAP * 3);
  private readonly flyFloor = new Float32Array(FLY_SHARD_CAP);
  private readonly flyScale = new Float32Array(FLY_SHARD_CAP);
  private readonly flyLife = new Float32Array(FLY_SHARD_CAP);
  private flyCursor = 0;
  private glassDecalMesh: InstancedMesh | null = null;
  private glassDecalTex: CanvasTexture | null = null;
  private glassDecalMat: MeshBasicMaterial | null = null;
  private readonly glassDecalMats = new Float32Array(GLASS_DECAL_CAP * 16);
  private glassDecalCount = 0;
  private glassDecalCursor = 0;
  /** Lit rooms of the loaded interiors: x, y (lamp), z, flicker mode, phase. */
  private readonly rooms: number[] = [];
  /** A few real point lights (quality preset) given to the nearest lit rooms. */
  private lights: PointLight[] = [];
  private roomLightCap = 0;
  private roomSortT = 0;
  private readonly roomPicks: { isLamp: boolean; idx: number }[] = [];
  private readonly lampNearTmp: [number, number][] = [];
  private readonly roomNearTmp: [number, number][] = [];
  /** 0 night … 1 day: lit windows and lamps fade in daylight. */
  daylight = 0;
  /** Hour of the day and rain 0..1, for the ambient sound (crickets, birds, the rain's hiss). */
  hour = 12;
  rain = 0;
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

    // Fixed light pools keep NUM_POINT_LIGHTS constant across quality switches (intensity = 0 when unused).
    for (let i = 0; i < MAX_ROOM_LIGHTS; i++) {
      const l = new PointLight(0xffc887, 0, 9, 2);
      l.castShadow = false;
      this.scene.add(l);
      this.lights.push(l);
    }
    for (let i = 0; i < MAX_FIRE_LIGHTS; i++) {
      const l = new PointLight(0xff8a3a, 0, 16, 1.6);
      l.castShadow = false;
      this.scene.add(l);
      this.fireLightList.push(l);
    }
    // Pre-create spinner/searchlight meshes at boot so first POI approach never compiles new programs.
    this.spinMesh = new InstancedMesh(new BoxGeometry(1, 0.5, 0.12).translate(0, 0, 0.1), new MeshStandardMaterial({ color: 0x8a8e90, roughness: 0.6, metalness: 0.4 }), 16);
    this.spinMesh.frustumCulled = false;
    this.spinMesh.castShadow = true;
    this.spinMesh.count = 0;
    this.spinMesh.visible = false;
    const cone = new ConeGeometry(1, 1, 12, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
    this.beamMesh = new InstancedMesh(cone, new MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), 16);
    this.beamMesh.frustumCulled = false;
    this.beamMesh.count = 0;
    this.beamMesh.visible = false;
    this.scene.add(this.spinMesh, this.beamMesh);

    // Pre-allocate and add glass shatter/crack pools at boot so breaking windows/windshields
    // performs ZERO GPU allocations and ZERO shader compilations in shot frames.
    if (typeof document !== 'undefined') {
      try {
        const tex = new CanvasTexture(generateDecalCanvas('shards', 128, 17));
        const mat = new MeshStandardMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.04,
          depthWrite: false,
          roughness: 0.25,
          metalness: 0.2,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        });
        const quadFloor = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const dMesh = new InstancedMesh(quadFloor, mat, DYN_SHARD_CAP);
        dMesh.name = 'life:dynShards';
        dMesh.castShadow = false;
        dMesh.receiveShadow = false;
        dMesh.frustumCulled = false;
        dMesh.renderOrder = 1;
        dMesh.count = 0;
        dMesh.visible = false;
        this.dynShardTex = tex;
        this.dynShardMat = mat;
        this.dynShardMesh = dMesh;

        const shardGeo = new BufferGeometry();
        shardGeo.setAttribute(
          'position',
          new Float32BufferAttribute(
            [-0.045, 0, 0, 0.05, 0.015, 0, 0.01, 0.11, 0, -0.045, 0, 0, 0.01, 0.11, 0, -0.025, 0.08, 0.008],
            3,
          ),
        );
        shardGeo.computeVertexNormals();
        const flyMat = new MeshStandardMaterial({
          color: 0xcbe2ee,
          roughness: 0.12,
          metalness: 0.35,
          transparent: true,
          opacity: 0.78,
          side: DoubleSide,
        });
        const fMesh = new InstancedMesh(shardGeo, flyMat, FLY_SHARD_CAP);
        fMesh.name = 'life:flyShards';
        fMesh.frustumCulled = false;
        fMesh.instanceMatrix.setUsage(DynamicDrawUsage);
        fMesh.count = 0;
        fMesh.visible = false;
        this.flyShardMat = flyMat;
        this.flyShardMesh = fMesh;

        const crackTex = new CanvasTexture(buildGlassCrackCanvas());
        const crackMat = new MeshBasicMaterial({
          map: crackTex,
          color: 0xeef6ff,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
          alphaTest: 0.02,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: DoubleSide,
        });
        const cMesh = new InstancedMesh(new PlaneGeometry(1, 1), crackMat, GLASS_DECAL_CAP);
        cMesh.name = 'life:glassCracks';
        cMesh.castShadow = false;
        cMesh.receiveShadow = false;
        cMesh.frustumCulled = false;
        cMesh.renderOrder = 2;
        cMesh.count = 0;
        cMesh.visible = false;
        this.glassDecalTex = crackTex;
        this.glassDecalMat = crackMat;
        this.glassDecalMesh = cMesh;

        this.scene.add(dMesh, fMesh, cMesh);
      } catch {
        // Node headless test DOM stub without 2D canvas context skips visual meshes cleanly.
      }
    }
  }

  /** Number of real point lights for lit rooms (0 on weak phones: the fake glow does it alone). */
  set roomLights(n: number) {
    this.roomLightCap = Math.max(0, Math.min(n, this.lights.length));
    for (let i = this.roomLightCap; i < this.lights.length; i++) this.lights[i].intensity = 0;
    this.roomSortT = 0;
  }

  /** Wind: direction (rad, xz) and gust 0..1 — the clouds drift with it. */
  get windDirection(): number {
    return this.windDir;
  }

  get windGust(): number {
    return this.gust;
  }

  /** Spawn visual glass shard decals and active footstep crunch zone on both sides of broken windows. */
  addDynamicShards(x: number, y: number, z: number, radius = 2.2): void {
    for (let i = 0; i < this.dynamicShards.length; i++) {
      const s = this.dynamicShards[i];
      if (Math.abs(s.y - y) < 0.7 && (s.x - x) ** 2 + (s.z - z) ** 2 < 1.2 * 1.2) return;
    }
    if (this.dynamicShards.length >= DYN_SHARD_CAP) this.dynamicShards.shift();
    this.dynamicShards.push({ x, y, z, r: radius });
    if (this.dynShardMesh) {
      for (let i = 0; i < this.dynamicShards.length; i++) {
        const s = this.dynamicShards[i];
        const diam = s.r * 1.1;
        _m.compose(_p.set(s.x, s.y + 0.025, s.z), _q.setFromAxisAngle(_y, (s.x * 1.3 + s.z * 0.7) % 6.28), _s.set(diam, 1, diam));
        this.dynShardMesh.setMatrixAt(i, _m);
      }
      this.dynShardMesh.count = this.dynamicShards.length;
      this.dynShardMesh.visible = true;
      this.dynShardMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Pooled zero-allocation 3D flying glass shard burst when a window or car windshield shatters. */
  burstGlassShards(x: number, y: number, z: number, nx: number, ny: number, nz: number, count = 16, floorY = 0): void {
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const dx = nx / nLen;
    const dy = ny / nLen;
    const dz = nz / nLen;
    for (let i = 0; i < count; i++) {
      const slot = this.flyCursor;
      this.flyCursor = (this.flyCursor + 1) % FLY_SHARD_CAP;
      const i3 = slot * 3;
      this.flyPos[i3] = x + (Math.random() - 0.5) * 0.28;
      this.flyPos[i3 + 1] = y + (Math.random() - 0.5) * 0.24;
      this.flyPos[i3 + 2] = z + (Math.random() - 0.5) * 0.28;
      const spd = 1.6 + Math.random() * 3.8;
      this.flyVel[i3] = dx * spd * 0.65 + (Math.random() - 0.5) * 2.8;
      this.flyVel[i3 + 1] = dy * spd * 0.4 + 0.6 + Math.random() * 2.2;
      this.flyVel[i3 + 2] = dz * spd * 0.65 + (Math.random() - 0.5) * 2.8;
      this.flyRot[i3] = Math.random() * 6.28;
      this.flyRot[i3 + 1] = Math.random() * 6.28;
      this.flyRot[i3 + 2] = Math.random() * 6.28;
      this.flyAng[i3] = (Math.random() - 0.5) * 18;
      this.flyAng[i3 + 1] = (Math.random() - 0.5) * 18;
      this.flyAng[i3 + 2] = (Math.random() - 0.5) * 18;
      this.flyFloor[slot] = floorY;
      this.flyScale[slot] = 0.75 + Math.random() * 1.15;
      this.flyLife[slot] = 1.2 + Math.random() * 0.65;
    }
    this.syncFlyShards(0);
  }

  /** Pooled zero-allocation crack/bullet-hole decal for shattered car windows. */
  addGlassCrackDecal(x: number, y: number, z: number, nx: number, ny: number, nz: number, size = 0.48): void {
    if (!this.glassDecalMesh) return;
    _n.set(nx, ny, nz);
    if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1);
    else _n.normalize();
    _q.setFromUnitVectors(_z, _n).multiply(_q2.setFromAxisAngle(_z, Math.random() * Math.PI * 2));
    _m.compose(_p.set(x, y, z).addScaledVector(_n, 0.004), _q, _s.set(size, size, 1));
    const slot = this.glassDecalCursor;
    this.glassDecalCursor = (this.glassDecalCursor + 1) % GLASS_DECAL_CAP;
    if (this.glassDecalCount < GLASS_DECAL_CAP) this.glassDecalCount++;
    _m.toArray(this.glassDecalMats, slot * 16);
    this.glassDecalMesh.setMatrixAt(slot, _m);
    this.glassDecalMesh.count = this.glassDecalCount;
    this.glassDecalMesh.visible = this.glassDecalCount > 0;
    this.glassDecalMesh.instanceMatrix.needsUpdate = true;
  }

  private syncFlyShards(dt: number): void {
    const mesh = this.flyShardMesh;
    let active = 0;
    for (let i = 0; i < FLY_SHARD_CAP; i++) {
      let life = this.flyLife[i];
      if (life <= 0) continue;
      if (dt > 0) {
        life -= dt;
        if (life <= 0) {
          this.flyLife[i] = 0;
          continue;
        }
        this.flyLife[i] = life;
        const i3 = i * 3;
        this.flyVel[i3 + 1] -= 14 * dt;
        this.flyPos[i3] += this.flyVel[i3] * dt;
        this.flyPos[i3 + 1] += this.flyVel[i3 + 1] * dt;
        this.flyPos[i3 + 2] += this.flyVel[i3 + 2] * dt;
        const fy = this.flyFloor[i] + 0.015;
        if (this.flyPos[i3 + 1] <= fy) {
          this.flyPos[i3 + 1] = fy;
          if (Math.abs(this.flyVel[i3 + 1]) > 0.6) {
            this.flyVel[i3 + 1] = -this.flyVel[i3 + 1] * 0.22;
            this.flyVel[i3] *= 0.45;
            this.flyVel[i3 + 2] *= 0.45;
          } else {
            this.flyVel[i3] = this.flyVel[i3 + 1] = this.flyVel[i3 + 2] = 0;
            this.flyAng[i3] = this.flyAng[i3 + 1] = this.flyAng[i3 + 2] = 0;
          }
        }
        this.flyRot[i3] += this.flyAng[i3] * dt;
        this.flyRot[i3 + 1] += this.flyAng[i3 + 1] * dt;
        this.flyRot[i3 + 2] += this.flyAng[i3 + 2] * dt;
      }
      if (mesh) {
        const i3 = i * 3;
        const s = this.flyScale[i] * Math.min(1, life * 4);
        _e.set(this.flyRot[i3], this.flyRot[i3 + 1], this.flyRot[i3 + 2], 'XYZ');
        _q.setFromEuler(_e);
        _m.compose(_p.set(this.flyPos[i3], this.flyPos[i3 + 1], this.flyPos[i3 + 2]), _q, _s.set(s, s, s));
        mesh.setMatrixAt(active, _m);
      }
      active++;
    }
    if (mesh) {
      mesh.count = active;
      mesh.visible = active > 0;
      if (active > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Standing on broken glass. */
  onShards(x: number, z: number, y: number): boolean {
    for (let i = 0; i < this.dynamicShards.length; i++) {
      const s = this.dynamicShards[i];
      if (Math.abs(y - s.y) < 0.85 && (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r) return true;
    }
    if (y > 0.5) return false;
    if (this.dirty) this.rebuild();
    for (let i = 0; i < this.shards.length; i += 3) {
      const r = this.shards[i + 2];
      if (Math.abs(x - this.shards[i]) < r && Math.abs(z - this.shards[i + 1]) < r) return true;
    }
    return false;
  }

  /**
   * The city's power (systems/Utilities): off = only generator and candle light (mode 0) stays lit — the
   * tubes in windows, rooms and corridors and the TVs go dark.
   */
  set power(on: boolean) {
    if (on === this.powerOn) return;
    this.powerOn = on;
    this.dirty = true;
  }

  private powerOn = true;

  /** Curtains and paper disabled. */
  set clothEnabled(_on: boolean) {}

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
    if (fog) this.glowMat.uniforms.uFog.value.set(fog.near, fog.far, this.daylight);
    this.updateRoomLights(player, dt);
    this.updateFireLights(player, dt);
    this.updateSpinners();
    this.syncFlyShards(dt);

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
    this.audio.update(dt, { gust: this.gust, outdoors, height: Math.max(0, player.y), radio: best < Infinity ? { dist: best, pan } : null, hour: this.hour, rain: this.rain, urban: street });
  }

  /** Thunder after a flash: `delay` s later, `power` 0..1. */
  thunder(delay: number, power: number): void {
    this.audio.thunder(delay, power);
  }

  /** Lamps on mains power (a lab whose generator runs): world x, y, z each; steady cold light, nearest first. */
  powered: number[] = [];

  /** Fires burning (x, y, z, size, phase): the nearest get the real lights. */
  private readonly fires: number[] = [];
  private fireLightList: PointLight[] = [];
  private fireLightCap = 0;
  private fireSortT = 0;
  private readonly fireNearTmp: [number, number][] = [];
  private readonly firePicks: number[] = [];

  /** At most this many real lights for fires (fixed pool, intensity = 0 when unused). */
  set fireLights(n: number) {
    this.fireLightCap = Math.max(0, Math.min(n, this.fireLightList.length));
    for (let i = this.fireLightCap; i < this.fireLightList.length; i++) this.fireLightList[i].intensity = 0;
    this.fireSortT = 0;
  }

  private updateFireLights(player: Vector3, dt: number): void {
    const cap = this.fireLightCap;
    if (cap === 0) {
      for (const l of this.fireLightList) l.intensity = 0;
      return;
    }
    const F = this.fires;
    this.fireSortT -= dt;
    if (this.fireSortT <= 0) {
      this.fireSortT = 0.1;
      const near = this.fireNearTmp;
      near.length = 0;
      for (let i = 0; i < F.length; i += 5) {
        const d = Math.hypot(F[i] - player.x, F[i + 1] - player.y, F[i + 2] - player.z);
        if (d < FIRE_LIGHT_RANGE) near.push([d, i]);
      }
      near.sort((a, b) => a[0] - b[0]);
      this.firePicks.length = 0;
      for (let n = 0; n < cap && n < near.length; n++) {
        this.firePicks.push(near[n][1]);
      }
    }
    const active = this.firePicks.length > 0;
    if (!active) {
      for (const l of this.fireLightList) l.intensity = 0;
      return;
    }
    for (let n = 0; n < this.fireLightList.length; n++) {
      const l = this.fireLightList[n];
      const i = n < cap ? this.firePicks[n] : undefined;
      if (i === undefined || i + 4 >= F.length) {
        l.intensity = 0;
        continue;
      }
      const w = F[i + 3];
      l.position.set(F[i], F[i + 1], F[i + 2]);
      l.distance = 13 + w * 6.5;
      l.intensity = (14 + w * 9) * (0.72 + 0.28 * Math.sin(this.time * 13 + F[i + 4] * 9) * Math.sin(this.time * 7.3 + F[i + 4]));
    }
  }

  /** Things still turning (a radar dish, a searchlight's beam). */
  private readonly spinners: { x: number; y: number; z: number; w: number; tag: number; phase: number }[] = [];
  private spinMesh: InstancedMesh | null = null;
  private beamMesh: InstancedMesh | null = null;

  private updateSpinners(): void {
    if (this.spinners.length === 0) {
      if (this.spinMesh) this.spinMesh.visible = false;
      if (this.beamMesh) this.beamMesh.visible = false;
      return;
    }
    if (!this.spinMesh) {
      // A dish on its head (turns about Y), a searchlight beam: a long soft cone, additive.
      this.spinMesh = new InstancedMesh(new BoxGeometry(1, 0.5, 0.12).translate(0, 0, 0.1), new MeshStandardMaterial({ color: 0x8a8e90, roughness: 0.6, metalness: 0.4 }), 16);
      this.spinMesh.frustumCulled = false;
      this.spinMesh.castShadow = true;
      const cone = new ConeGeometry(1, 1, 12, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
      this.beamMesh = new InstancedMesh(cone, new MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), 16);
      this.beamMesh.frustumCulled = false;
      this.scene.add(this.spinMesh, this.beamMesh);
    }
    let d = 0;
    let b = 0;
    for (const sp of this.spinners) {
      const yaw = sp.phase + this.time * (sp.tag ? 0.6 : 0.9);
      if (sp.tag === 0 && d < 16) {
        _m.compose(_p.set(sp.x, sp.y, sp.z), _q.setFromAxisAngle(_y, yaw), _s.set(sp.w, sp.w, sp.w));
        this.spinMesh.setMatrixAt(d++, _m);
      } else if (sp.tag === 1 && b < 16) {
        // Tilted a little down, 30 m long, widening to 3 m.
        _q.setFromEuler(_e.set(-0.12, yaw, 0, 'YXZ'));
        _m.compose(_p.set(sp.x, sp.y, sp.z), _q, _s.set(1.6 * sp.w, 1.6 * sp.w, 30));
        this.beamMesh!.setMatrixAt(b++, _m);
      }
    }
    this.spinMesh.count = d;
    this.spinMesh.visible = d > 0;
    this.beamMesh!.count = b;
    this.beamMesh!.visible = b > 0;
    if (d > 0) this.spinMesh.instanceMatrix.needsUpdate = true;
    if (b > 0) this.beamMesh!.instanceMatrix.needsUpdate = true;
  }

  /** The real lights go to the nearest lit rooms; they flicker with their room. Powered lamps win nearby. */
  private updateRoomLights(player: Vector3, dt: number): void {
    const cap = this.roomLightCap;
    if (cap === 0) {
      for (const l of this.lights) l.intensity = 0;
      return;
    }
    const P = this.powered;
    this.roomSortT -= dt;
    if (this.roomSortT <= 0) {
      this.roomSortT = 0.1;
      const lamps = this.lampNearTmp;
      const near = this.roomNearTmp;
      lamps.length = 0;
      near.length = 0;
      for (let i = 0; i < P.length; i += 3) {
        const d = Math.hypot(P[i] - player.x, P[i + 1] - player.y - 1.5, P[i + 2] - player.z);
        if (d < ROOM_LIGHT_RANGE) lamps.push([d, i]);
      }
      lamps.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < this.rooms.length; i += 5) {
        const d = Math.hypot(this.rooms[i] - player.x, (this.rooms[i + 1] - player.y - 1.5) * 1.5, this.rooms[i + 2] - player.z);
        if (d < ROOM_LIGHT_RANGE) near.push([d, i]);
      }
      near.sort((a, b) => a[0] - b[0]);
      this.roomPicks.length = 0;
      for (let n = 0; n < cap; n++) {
        if (n < lamps.length) this.roomPicks.push({ isLamp: true, idx: lamps[n][1] });
        else if (n - lamps.length < near.length) this.roomPicks.push({ isLamp: false, idx: near[n - lamps.length][1] });
      }
    }
    const active = this.roomPicks.length > 0;
    if (!active) {
      for (const l of this.lights) l.intensity = 0;
      return;
    }
    for (let n = 0; n < this.lights.length; n++) {
      const l = this.lights[n];
      const pick = n < cap ? this.roomPicks[n] : undefined;
      if (!pick) {
        l.intensity = 0;
        continue;
      }
      if (pick.isLamp) {
        const i = pick.idx;
        if (i + 2 >= P.length) {
          l.intensity = 0;
          continue;
        }
        l.position.set(P[i], P[i + 1], P[i + 2]);
        l.color.setHex(0xdce6f0);
        l.intensity = 9;
      } else {
        const i = pick.idx;
        if (i + 4 >= this.rooms.length) {
          l.intensity = 0;
          continue;
        }
        l.color.setHex(0xffc887);
        l.position.set(this.rooms[i], this.rooms[i + 1] - 0.1, this.rooms[i + 2]);
        l.intensity = 7 * flicker(this.time, this.rooms[i + 4], this.rooms[i + 3]);
      }
    }
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
    this.radios.length = 0;
    this.shards.length = 0;
    this.rooms.length = 0;
    this.fires.length = 0;
    this.spinners.length = 0;
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
        // No power: electric light is out (generator and candle light, mode 0, burns on).
        if (!this.powerOn && (((kind === LIFE.window || kind === LIFE.room) && seed > 0.5) || kind === LIFE.lamp || kind === LIFE.tv)) continue;
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
        } else if (kind === LIFE.tv && g + 2 < GLOW_CAP) {
          // A TV left on: static on the screen, its cold flicker on the wall behind and the floor in front.
          const nx = spots[i + 4];
          const nz = spots[i + 5];
          _q.setFromAxisAngle(_y, yaw);
          _m.compose(_p.set(x + nx * 0.004, y, z + nz * 0.004), _q, _s.set(w, h, 1));
          glow(5, seed, 3, 1);
          _m.compose(_p.set(x - nx * 0.46, y + 0.2, z - nz * 0.46), _q, _s.set(2.6, 1.9, 1));
          glow(6, seed, 3, 0.22);
          _m.compose(_p.set(x + nx * 1.3, y - 0.72, z + nz * 1.3), _q.setFromAxisAngle(_x, -Math.PI / 2), _s.set(2.8, 2.8, 1));
          glow(6, seed, 3, 0.3);
        } else if (kind === LIFE.fire && g + 2 < GLOW_CAP) {
          // A fire: two crossed sheets of flame, its flickering light on the ground round it.
          const phase = seed;
          for (const a of [0, Math.PI / 2]) {
            _m.compose(_p.set(x, y + w * 0.6, z), _q.setFromAxisAngle(_y, a + seed), _s.set(w * 1.3, w * 1.8, 1));
            glow(7, phase, 4, 1);
          }
          _m.compose(_p.set(x, this.groundAt(x, z) + 0.014, z), _q.setFromAxisAngle(_x, -Math.PI / 2), _s.set(7, 7, 1));
          glow(8, phase, 4, 0.5);
          this.fires.push(x, y + 0.6 + w * 0.4, z, w, phase);
        } else if (kind === LIFE.beacon && g + 2 < GLOW_CAP) {
          // A warning light: two crossed sheets so it reads from every side; its colour from the tag.
          for (const a of [0, Math.PI / 2]) {
            _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_y, a), _s.set(w, w, 1));
            glow(tag === 2 ? 11 : tag ? 10 : 9, seed, h || 5, 1);
          }
        } else if (kind === LIFE.spin) {
          this.spinners.push({ x, y, z, w, tag, phase: seed * 6.28 });
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
    this.roomSortT = 0;
    this.fireSortT = 0;
  }

  /** Program compiles during the loading-screen prewarm. */
  prewarm(): () => void {
    this.keepPrewarmVisible();
    return () => {
      this.dirty = true;
      for (const m of [this.spinMesh, this.beamMesh, this.dynShardMesh, this.flyShardMesh, this.glassDecalMesh]) {
        if (m) {
          m.count = 0;
          m.visible = false;
        }
      }
    };
  }

  /** Keep dynamic meshes visible through scene.render() during boot prewarm. */
  keepPrewarmVisible(): void {
    if (this.glow.count === 0) {
      this.glow.setMatrixAt(0, _m.identity());
      this.glow.instanceMatrix.needsUpdate = true;
      this.glow.count = 1;
    }
    this.glow.visible = true;
    for (const m of [this.spinMesh, this.beamMesh, this.dynShardMesh, this.flyShardMesh, this.glassDecalMesh]) {
      if (!m) continue;
      if (m.count === 0) {
        m.setMatrixAt(0, _m.identity());
        m.instanceMatrix.needsUpdate = true;
        m.count = 1;
      }
      m.visible = true;
    }
  }

  dispose(): void {
    this.scene.remove(this.glow);
    this.glow.geometry.dispose();
    this.glowMat.dispose();
    for (const l of this.lights) l.removeFromParent();
    for (const l of this.fireLightList) l.removeFromParent();
    this.spinMesh?.removeFromParent();
    this.beamMesh?.removeFromParent();
    for (const m of [this.dynShardMesh, this.flyShardMesh, this.glassDecalMesh]) {
      if (m) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    this.dynShardMat?.dispose();
    this.dynShardTex?.dispose();
    this.flyShardMat?.dispose();
    this.glassDecalMat?.dispose();
    this.glassDecalTex?.dispose();
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
  else if (mode < 2.5) f = slow < 0.4 ? step(0.35, fast) : 0.04;                         // dying, bursts of light
  else if (mode < 3.5) f = 0.5 + 0.5 * hash(floor(t * 11.0) + aGlow.y * 53.0);            // a TV: the picture jumping
  else if (mode < 4.5) f = 0.8 + 0.2 * sin(t * 13.0) * sin(t * 7.3) + 0.12 * (hash(floor(t * 18.0) + aGlow.y * 7.0) - 0.5); // fire
  else if (mode < 5.5) f = step(0.5, fract(t * 0.9));                                     // a board / alarm light blinking
  else f = 0.12 + 1.4 * pow(max(0.0, sin(t * 3.4)), 6.0);                                 // a turning beacon sweeping past
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
uniform float uTime;
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
  } else if (vKind > 10.5) {
    // A fluorescent tube's glow under a ceiling: cold white, long.
    a = pow(max(0.0, 1.0 - length(c * vec2(2.0, 0.9)) * 1.6), 1.6);
    col = vec3(0.85, 0.92, 1.0) * 1.4;
  } else if (vKind > 8.5) {
    // A warning light: red (9) or amber (10), a hot core in a soft halo.
    float r = length(c) * 2.0;
    a = pow(max(0.0, 1.0 - r), 1.5) + 0.8 * smoothstep(0.25, 0.0, r);
    col = vKind > 9.5 ? vec3(1.0, 0.62, 0.12) * 1.6 : vec3(1.0, 0.12, 0.08) * 1.6;
  } else if (vKind > 7.5) {
    // Firelight on the ground: orange, flickering.
    a = pow(max(0.0, 1.0 - length(c) * 2.0), 1.8);
    col = vec3(1.0, 0.48, 0.16);
  } else if (vKind > 6.5) {
    // Volumetric multi-layered flame + soft outer ember halo (no hard cutout edges).
    float h = c.y + 0.5;
    float sway = sin(h * 7.5 - uTime * 7.2) * 0.055 * h + sin(h * 15.0 - uTime * 11.5) * 0.025;
    float x = c.x + sway;
    float tongues = 0.14 * h * sin(x * 18.0 + uTime * 5.2 + h * 6.5) + 0.07 * h * sin(x * 29.0 - uTime * 9.3);
    float body = (1.0 - h) * 0.54 - abs(x) * (0.62 + 0.65 * h) + tongues;
    float core = smoothstep(0.0, 0.32, body) * pow(max(0.0, 1.0 - h), 1.25) * smoothstep(0.0, 0.11, h);
    float rad = length(c * vec2(1.45, 1.15)) * 1.9;
    float halo = 0.36 * pow(max(0.0, 1.0 - rad), 2.3) * smoothstep(0.0, 0.08, h);
    a = core + halo;
    vec3 flameCol = mix(vec3(1.0, 0.88, 0.48), vec3(1.0, 0.36, 0.08), smoothstep(0.08, 0.72, h));
    flameCol = mix(flameCol, vec3(0.68, 0.12, 0.03), smoothstep(0.68, 1.0, h));
    col = flameCol * (1.75 * core + 0.85 * halo) / max(a, 0.001);
  } else if (vKind > 5.5) {
    // A TV's light thrown on a wall, the floor: cold blue-white.
    a = pow(max(0.0, 1.0 - length(c) * 2.0), 1.6);
    col = vec3(0.55, 0.65, 0.9);
  } else if (vKind > 4.5) {
    // The screen: snow, changing every frame of the broadcast.
    vec2 cell = floor(vUv * vec2(64.0, 48.0));
    float n = fract(sin(dot(cell + floor(uTime * 30.0) * vec2(7.0, 13.0), vec2(12.9898, 78.233))) * 43758.5453);
    a = 1.0;
    col = vec3(0.6, 0.68, 0.8) * (0.3 + 0.7 * n);
  } else {
    // The lamp: a bright core.
    a = pow(max(0.0, 1.0 - length(c) * 2.0), 3.0);
    col = uWarm * 3.0;
  }
  float fog = smoothstep(uFog.x, uFog.y, vDepth);
  // uFog.z = daylight: lamps and lit windows read far weaker by day.
  gl_FragColor = vec4(col * a * vI * (1.0 - fog) * (1.0 - 0.75 * uFog.z), 1.0);
}`;

/** Realistic jagged shattered car glass decal texture (angular impact hole, sharp splinters, no cobweb rings). */
function buildGlassCrackCanvas(): HTMLCanvasElement {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const cx = S / 2;
  const cy = S / 2;
  g.clearRect(0, 0, S, S);

  const hash = (k: number) => {
    const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  const rays = 18;
  const angles: number[] = [];
  const holeR: number[] = [];
  const reaches: number[] = [];
  for (let i = 0; i < rays; i++) {
    const step = (Math.PI * 2) / rays;
    angles.push(i * step + (hash(i * 4.3 + 2) - 0.5) * step * 0.56);
    holeR.push(7 + hash(i * 8.1 + 3) * 8);
    reaches.push(S * (0.28 + hash(i * 12.7 + 5) * 0.19));
  }

  // Subtle translucent triangular shard facets around the impact perforation.
  for (let i = 0; i < rays; i++) {
    const j = (i + 1) % rays;
    const rA = holeR[i] + 18 + hash(i * 15.1) * 42;
    const rB = holeR[j] + 18 + hash(j * 15.1) * 42;
    const alpha = 0.16 + hash(i * 19.7) * 0.12;
    g.fillStyle = `rgba(195, 225, 238, ${alpha.toFixed(3)})`;
    g.beginPath();
    g.moveTo(cx + Math.cos(angles[i]) * holeR[i], cy + Math.sin(angles[i]) * holeR[i]);
    g.lineTo(cx + Math.cos(angles[i]) * rA, cy + Math.sin(angles[i]) * rA);
    g.lineTo(cx + Math.cos(angles[j]) * rB, cy + Math.sin(angles[j]) * rB);
    g.lineTo(cx + Math.cos(angles[j]) * holeR[j], cy + Math.sin(angles[j]) * holeR[j]);
    g.closePath();
    g.fill();
  }

  // Only sparse broken angular cross-cracks between a few neighboring rays near center.
  for (let i = 0; i < rays; i++) {
    const j = (i + 1) % rays;
    if (hash(i * 23.3 + 7) < 0.35) {
      const rA = holeR[i] + 14 + hash(i * 27.1) * 28;
      const rB = holeR[j] + 14 + hash(i * 31.9) * 28;
      g.strokeStyle = 'rgba(30, 45, 55, 0.34)';
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(cx + Math.cos(angles[i]) * rA + 0.8, cy + Math.sin(angles[i]) * rA + 0.8);
      g.lineTo(cx + Math.cos(angles[j]) * rB + 0.8, cy + Math.sin(angles[j]) * rB + 0.8);
      g.stroke();
      g.strokeStyle = 'rgba(232, 245, 255, 0.85)';
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(cx + Math.cos(angles[i]) * rA, cy + Math.sin(angles[i]) * rA);
      g.lineTo(cx + Math.cos(angles[j]) * rB, cy + Math.sin(angles[j]) * rB);
      g.stroke();
    }
  }

  // Sharp jagged radial fracture rays + secondary forked splinters.
  for (let i = 0; i < rays; i++) {
    let curA = angles[i];
    let px = cx + Math.cos(curA) * holeR[i];
    let py = cy + Math.sin(curA) * holeR[i];
    for (let seg = 1; seg <= 4; seg++) {
      const t = seg / 4;
      curA += (hash(i * 37.3 + seg * 5.9) - 0.5) * 0.24;
      const r = holeR[i] + (reaches[i] - holeR[i]) * t;
      const nx = cx + Math.cos(curA) * r;
      const ny = cy + Math.sin(curA) * r;
      const w = Math.max(0.65, (i % 2 === 0 ? 1.55 : 1.05) * (1 - t * 0.45));
      g.strokeStyle = 'rgba(30, 45, 55, 0.36)';
      g.lineWidth = w + 0.35;
      g.beginPath();
      g.moveTo(px + 0.8, py + 0.8);
      g.lineTo(nx + 0.8, ny + 0.8);
      g.stroke();
      g.strokeStyle = 'rgba(238, 248, 255, 0.92)';
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(nx, ny);
      g.stroke();
      if (seg === 2 && hash(i * 43.1) < 0.55) {
        const fAng = curA + (hash(i * 47.9) < 0.5 ? 1 : -1) * 0.36;
        const fLen = 14 + hash(i * 53.3) * 24;
        g.strokeStyle = 'rgba(232, 245, 255, 0.82)';
        g.lineWidth = 0.85;
        g.beginPath();
        g.moveTo(nx, ny);
        g.lineTo(nx + Math.cos(fAng) * fLen, ny + Math.sin(fAng) * fLen);
        g.stroke();
      }
      px = nx;
      py = ny;
    }
  }

  // Punch irregular jagged central bullet hole and stroke beveled rim.
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.beginPath();
  for (let i = 0; i < rays; i++) {
    const x = cx + Math.cos(angles[i]) * holeR[i];
    const y = cy + Math.sin(angles[i]) * holeR[i];
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.restore();

  g.beginPath();
  for (let i = 0; i < rays; i++) {
    const x = cx + Math.cos(angles[i]) * holeR[i];
    const y = cy + Math.sin(angles[i]) * holeR[i];
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.strokeStyle = 'rgba(28, 42, 52, 0.55)';
  g.lineWidth = 2.0;
  g.stroke();
  g.strokeStyle = 'rgba(242, 250, 255, 0.96)';
  g.lineWidth = 1.1;
  g.stroke();
  return cv;
}
