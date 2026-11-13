import {
  BoxGeometry,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { sfx } from '../audio/Sound';
import { VehicleAudio } from '../audio/VehicleAudio';
import { tr } from '../core/i18n';
import { clamp, damp } from '../core/math';
import type { InputManager } from '../input/InputManager';
import type { Particles } from '../render/Particles';
import type { CollisionWorld } from '../world/CollisionWorld';
import { CHUNK, ROAD_HALF, type WorldLayout } from '../world/gen/layout';
import { nearestPoi, type PoiKind, siteToWorld } from '../world/gen/poi';
import type { Inventory } from './Inventory';
import type { Zombie, ZombieSim } from './zombies';

export type VehicleKind = 'sedan' | 'suv';

export interface CarState {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  steer: number;
  /** 0..1 fuel level in tank */
  fuel: number;
  /** 0..1 battery charge */
  battery: number;
  /** 0..1 engine condition */
  engine: number;
  /** 0..1 tires condition */
  tires: number;
  hasKey: boolean;
  hotwired: boolean;
  engineOn: boolean;
  lightsOn: boolean;
  /** Internal cooldown so a zombie isn't hit twice in the same 0.35s window */
  smokeT: number;
  stallT: number;
  group: Group;
  rig?: CarRig;
}

interface CarRig {
  bodyPivot: Group;
  steerFL: Group;
  steerFR: Group;
  wheelFL: Object3D;
  wheelFR: Object3D;
  wheelRL: Object3D;
  wheelRR: Object3D;
  wheelSpin: number;
  bodyPitch: number;
  bodyRoll: number;
  exhaustT: number;
  skidT: number;
}

export interface CarSave {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  fuel: number;
  battery: number;
  engine: number;
  tires: number;
  hasKey?: boolean;
  hotwired?: boolean;
  lightsOn?: boolean;
}

interface VehicleSpec {
  maxSpeed: number;
  reverseSpeed: number;
  accel: number;
  brake: number;
  drag: number;
  turnRate: number;
  halfW: number;
  halfL: number;
  height: number;
  fuelRate: number;
  engineArmor: number;
  camDist: number;
  camHeight: number;
}

export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  sedan: {
    maxSpeed: 19.5, // ~70 km/h
    reverseSpeed: 7.5,
    accel: 9.2,
    brake: 16.0,
    drag: 2.2,
    turnRate: 1.95,
    halfW: 0.96,
    halfL: 2.25,
    height: 1.48,
    fuelRate: 0.0028,
    engineArmor: 1.0,
    camDist: 5.8,
    camHeight: 2.35,
  },
  suv: {
    maxSpeed: 16.8, // ~60 km/h
    reverseSpeed: 6.8,
    accel: 8.0,
    brake: 14.5,
    drag: 2.0,
    turnRate: 1.65,
    halfW: 1.05,
    halfL: 2.32,
    height: 1.88,
    fuelRate: 0.0034,
    engineArmor: 1.65,
    camDist: 6.4,
    camHeight: 2.65,
  },
};

export function vehicleName(kind: VehicleKind): string {
  return kind === 'suv'
    ? tr('Внедорожник 4×4', '4×4 Off-Road SUV')
    : tr('Седан 90-х', '90s Sedan');
}

const _smokePos = new Vector3();
const _hitPos = new Vector3();
const _probe = new Vector3();

/**
 * Project Zomboid-style drivable vehicles (Sedan & 4x4 SUV).
 * Supports entering/exiting, ignition keys & hotwiring, fuel consumption, battery drain,
 * engine damage & smoke/stalling, tire wear/blowouts, headlights, horn, zombie ramming,
 * and under-the-hood mechanics repair.
 */
export class Vehicles {
  readonly group = new Scene();
  readonly cars: CarState[] = [];
  activeCar: CarState | null = null;
  /** True = 3rd-person chase cam; False = 1st-person hood/cabin cam */
  thirdPerson = true;
  /** Camera orbit offset controlled by mouse while driving */
  private camYawOffset = 0;
  private camPitchOffset = 0.22;
  private lookIdleT = 0;

  private readonly templates = new Map<VehicleKind, Group>();
  private readonly loading = new Set<VehicleKind>();
  private readonly hitCooldown = new Map<number, number>();
  private readonly poiSpawned = new Set<string>();
  private readonly roadChecked = new Set<string>();
  private readonly audio = new VehicleAudio();
  private headLightL: SpotLight;
  private headLightR: SpotLight;
  private headTargetL: Object3D;
  private headTargetR: Object3D;
  private brakeLight: PointLight;
  private isBraking = false;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly layout: WorldLayout,
    private readonly inventory: Inventory,
    private readonly zombies: ZombieSim,
    private readonly particles: Particles,
    private readonly hooks: {
      toast(text: string, ms?: number): void;
      noise(x: number, y: number, z: number, r: number): void;
      onKill(): void;
      onOpenMechanics(car: CarState): void;
      isMechanic(): boolean;
    },
  ) {
    this.scene.add(this.group);

    // Dual headlights moved to whichever car is currently active or has lights on
    this.headLightL = new SpotLight(0xfff1cc, 0, 34, 0.56, 0.45, 1.5);
    this.headLightR = new SpotLight(0xfff1cc, 0, 34, 0.56, 0.45, 1.5);
    this.headTargetL = new Object3D();
    this.headTargetR = new Object3D();
    this.headLightL.target = this.headTargetL;
    this.headLightR.target = this.headTargetR;
    this.brakeLight = new PointLight(0xff2218, 0, 5.5, 2);
    this.scene.add(this.headLightL, this.headLightR, this.headTargetL, this.headTargetR, this.brakeLight);

    this.loadModel('sedan');
    this.loadModel('suv');
  }

  private loadModel(kind: VehicleKind): void {
    if (this.loading.has(kind)) return;
    this.loading.add(kind);
    const base = `${import.meta.env?.BASE_URL ?? '/'}models/vehicles/${kind}`;
    const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const texLoader = new TextureLoader();

    Promise.all([
      gltfLoader.loadAsync(`${base}.glb?v=6`),
      texLoader.loadAsync(`${base}.webp?v=6`).then((t: Texture) => {
        t.colorSpace = SRGBColorSpace;
        t.flipY = false;
        t.minFilter = LinearMipmapLinearFilter;
        t.anisotropy = 4;
        return t;
      }),
    ])
      .then(([gltf, tex]) => {
        const root = gltf.scene;
        const mat = new MeshLambertMaterial({
          map: tex,
          color: 0xffffff,
        });
        root.traverse((obj) => {
          if ((obj as Mesh).isMesh) {
            const m = obj as Mesh;
            m.material = mat;
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        this.templates.set(kind, root);
        // Upgrade any already-spawned cars of this kind
        for (const car of this.cars) {
          if (car.kind === kind) this.attachVisual(car);
        }
      })
      .catch((err) => console.warn('[vehicles] model load failed:', kind, err));
  }

  private attachVisual(car: CarState): void {
    while (car.group.children.length > 0) {
      car.group.remove(car.group.children[0]);
    }
    car.rig = undefined;
    const tpl = this.templates.get(car.kind);
    if (tpl) {
      const clone = tpl.clone(true);
      const bodyObj = clone.getObjectByName('body');
      const wFL = clone.getObjectByName('wheelFL');
      const wFR = clone.getObjectByName('wheelFR');
      const wRL = clone.getObjectByName('wheelRL');
      const wRR = clone.getObjectByName('wheelRR');

      if (bodyObj && wFL && wFR && wRL && wRR) {
        const bodyPivot = new Group();
        bodyPivot.add(bodyObj);

        // Front steering pivots
        const steerFL = new Group();
        steerFL.position.copy(wFL.position);
        wFL.position.set(0, 0, 0);
        steerFL.add(wFL);

        const steerFR = new Group();
        steerFR.position.copy(wFR.position);
        wFR.position.set(0, 0, 0);
        steerFR.add(wFR);

        car.group.add(bodyPivot, steerFL, steerFR, wRL, wRR);
        car.rig = {
          bodyPivot,
          steerFL,
          steerFR,
          wheelFL: wFL,
          wheelFR: wFR,
          wheelRL: wRL,
          wheelRR: wRR,
          wheelSpin: 0,
          bodyPitch: 0,
          bodyRoll: 0,
          exhaustT: 0,
          skidT: 0,
        };
      } else {
        car.group.add(clone);
      }
      return;
    }
    // Lightweight fallback proxy while GLB finishes loading
    const spec = VEHICLE_SPECS[car.kind];
    const bodyGeo = new BoxGeometry(spec.halfW * 2, spec.height * 0.65, spec.halfL * 2);
    const bodyMat = new MeshLambertMaterial({ color: car.kind === 'suv' ? 0x3b4a3a : 0x6b2d2a });
    const mesh = new Mesh(bodyGeo, bodyMat);
    mesh.position.y = spec.height * 0.4;
    car.group.add(mesh);
  }

  /** Initialize default cars or restore from save. */
  init(px: number, pz: number, saved?: CarSave[]): void {
    for (const c of this.cars) c.group.removeFromParent();
    this.cars.length = 0;
    this.activeCar = null;

    if (saved && saved.length > 0) {
      for (const s of saved) {
        const spot = this.findFreeSpot(s.x, s.z, s.yaw, s.kind);
        this.spawnCar({
          id: s.id,
          kind: s.kind,
          x: spot.x,
          y: this.layout.walkHeightAt(spot.x, spot.z),
          z: spot.z,
          yaw: s.yaw,
          fuel: s.fuel,
          battery: s.battery,
          engine: s.engine,
          tires: s.tires,
          hasKey: !!s.hasKey,
          hotwired: !!s.hotwired,
          lightsOn: !!s.lightsOn,
        });
      }
      return;
    }

    // Starter vehicles near downtown spawn (20, 0, 4.6), placed in guaranteed obstacle-free road spots:
    // 1. 90s Sedan right on the road with key in ignition
    const sedanSpot = this.findFreeSpot(14, 2.2, -Math.PI / 2, 'sedan');
    this.spawnCar({
      id: 1,
      kind: 'sedan',
      x: sedanSpot.x,
      y: this.layout.walkHeightAt(sedanSpot.x, sedanSpot.z),
      z: sedanSpot.z,
      yaw: -Math.PI / 2,
      fuel: 0.58,
      battery: 0.82,
      engine: 0.74,
      tires: 0.85,
      hasKey: true,
      hotwired: false,
      lightsOn: false,
    });

    // 2. 4x4 Off-Road SUV further down the road (needs key or hotwiring, rugged condition)
    const suvSpot = this.findFreeSpot(28, -2.2, Math.PI / 2, 'suv');
    this.spawnCar({
      id: 2,
      kind: 'suv',
      x: suvSpot.x,
      y: this.layout.walkHeightAt(suvSpot.x, suvSpot.z),
      z: suvSpot.z,
      yaw: Math.PI / 2,
      fuel: 0.42,
      battery: 0.68,
      engine: 0.88,
      tires: 0.92,
      hasKey: false,
      hotwired: false,
      lightsOn: false,
    });

    this.ensurePoiCars(px, pz);
  }

  /** Find an obstacle-free spot near (cx, cz) so a drivable car never overlaps a static parked car or building. */
  private findFreeSpot(cx: number, cz: number, yaw: number, kind: VehicleKind): { x: number; z: number } {
    const spec = VEHICLE_SPECS[kind];
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const offsets = [0, 4, -4, 8, -8, 12, -12, 16, -16, 20, -20];
    const latOffsets = [0, 2.5, -2.5];

    for (const lat of latOffsets) {
      for (const along of offsets) {
        const tx = cx + fwdX * along - fwdZ * lat;
        const tz = cz + fwdZ * along + fwdX * lat;
        if (this.cars.some((c) => Math.hypot(c.x - tx, c.z - tz) < 5.8)) continue;
        const y = this.layout.walkHeightAt(tx, tz);
        let blocked = false;
        for (const t of [-1.4, 0, 1.4]) {
          const px = tx + fwdX * t;
          const pz = tz + fwdZ * t;
          _probe.set(px, y, pz);
          this.world.resolveCircle(_probe, spec.halfW + 0.25, 1.6);
          if (Math.hypot(_probe.x - px, _probe.z - pz) > 0.05) {
            blocked = true;
            break;
          }
        }
        if (!blocked) return { x: tx, z: tz };
      }
    }
    return { x: cx, z: cz };
  }

  /** Spawn deterministic vehicles near key POIs and along city/suburb roads as the player explores. */
  ensurePoiCars(px: number, pz: number): void {
    const maxCars = 36;
    if (this.cars.length >= maxCars) return;
    const ci = Math.floor(px / CHUNK);
    const cj = Math.floor(pz / CHUNK);
    const pois: [PoiKind, VehicleKind, boolean][] = [
      ['police', 'sedan', false],
      ['gas', 'sedan', true],
      ['hyper', 'sedan', false],
      ['mall', 'suv', false],
      ['plant', 'suv', true],
      ['checkpoint', 'suv', false],
      ['lab', 'suv', false],
      ['base', 'suv', true],
      ['airport', 'suv', false],
    ];
    for (const [poiKind, carKind, withKey] of pois) {
      if (this.cars.length >= maxCars) break;
      const site = nearestPoi(this.layout, poiKind, ci, cj, 22);
      if (!site) continue;
      const key = `${site.i},${site.j}`;
      if (this.poiSpawned.has(key)) continue;
      this.poiSpawned.add(key);
      const depth = ((site.r & 1 ? (site.bw ?? 1) : (site.bd ?? 1)) * CHUNK) / 2;
      const [wx, wz] = siteToWorld(site, 6, depth - 2.2);
      if (this.cars.some((c) => Math.hypot(c.x - wx, c.z - wz) < 18)) continue;
      const yaw = (site.r * Math.PI) / 2;
      const spot = this.findFreeSpot(wx, wz, yaw, carKind);
      const h = ((site.i * 73856093) ^ (site.j * 19349663)) >>> 0;
      this.spawnCar({
        id: 100 + this.cars.length,
        kind: carKind,
        x: spot.x,
        y: this.layout.walkHeightAt(spot.x, spot.z),
        z: spot.z,
        yaw,
        fuel: 0.25 + ((h & 0xff) / 255) * 0.5,
        battery: 0.35 + (((h >> 8) & 0xff) / 255) * 0.55,
        engine: 0.4 + (((h >> 16) & 0xff) / 255) * 0.5,
        tires: 0.45 + (((h >> 24) & 0xff) / 255) * 0.5,
        hasKey: withKey,
        hotwired: false,
        lightsOn: false,
      });
    }

    this.ensureRoadCars(ci, cj, maxCars);
  }

  /** Spawn deterministic roadside sedans & SUVs across explored road chunks so cars appear naturally throughout the map. */
  private ensureRoadCars(ci: number, cj: number, maxCars: number): void {
    const r = 5;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        if (this.cars.length >= maxCars) return;
        const key = `${i},${j}`;
        if (this.roadChecked.has(key)) continue;
        this.roadChecked.add(key);

        // Skip POI chunks (handled by ensurePoiCars) and immediate starter chunk (0, 0)
        if ((i === 0 && j === 0) || this.layout.poi(i, j)) continue;

        let h = ((i * 73856093) ^ (j * 19349663) ^ 0x9e3779b9) >>> 0;
        h = (Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0);
        // ~24% of chunks get a roadside drivable car
        if ((h % 100) >= 24) continue;

        const alongX = ((h >>> 8) & 1) === 0;
        const side = ((h >>> 9) & 1) === 0 ? 1 : -1;
        const wx = alongX ? i * CHUNK + (((h >>> 10) % 15) - 7) : i * CHUNK + side * 2.3;
        const wz = alongX ? j * CHUNK + side * 2.3 : j * CHUNK + (((h >>> 10) % 15) - 7);

        if (this.cars.some((c) => Math.hypot(c.x - wx, c.z - wz) < 48)) continue;

        const carKind: VehicleKind = ((h >>> 14) % 10) < 4 ? 'suv' : 'sedan';
        const yaw = alongX ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? 0 : Math.PI);
        const spot = this.findFreeSpot(wx, wz, yaw, carKind);
        if (this.cars.some((c) => Math.hypot(c.x - spot.x, c.z - spot.z) < 20)) continue;

        this.spawnCar({
          id: 200 + this.cars.length,
          kind: carKind,
          x: spot.x,
          y: this.layout.walkHeightAt(spot.x, spot.z),
          z: spot.z,
          yaw,
          fuel: 0.22 + ((h & 0xff) / 255) * 0.55,
          battery: 0.35 + (((h >> 8) & 0xff) / 255) * 0.6,
          engine: 0.45 + (((h >> 16) & 0xff) / 255) * 0.5,
          tires: 0.5 + (((h >> 24) & 0xff) / 255) * 0.48,
          hasKey: ((h >>> 20) % 10) < 3,
          hotwired: false,
          lightsOn: false,
        });
      }
    }
  }

  /** Spawn a pristine Sedan + 4x4 SUV right in front of the player for quick testing (?poi=cars or ?car=1). */
  spawnTestCars(px: number, pz: number, yaw: number): void {
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const defs: [VehicleKind, number][] = [
      ['sedan', -2.4],
      ['suv', 2.4],
    ];
    for (const [kind, side] of defs) {
      const tx = px + fwdX * 6.5 + rightX * side;
      const tz = pz + fwdZ * 6.5 + rightZ * side;
      const spot = this.findFreeSpot(tx, tz, yaw, kind);
      this.spawnCar({
        id: 900 + this.cars.length,
        kind,
        x: spot.x,
        y: this.layout.walkHeightAt(spot.x, spot.z),
        z: spot.z,
        yaw,
        fuel: 1,
        battery: 1,
        engine: 1,
        tires: 1,
        hasKey: true,
        hotwired: false,
        lightsOn: false,
      });
    }
  }

  private spawnCar(init: Omit<CarState, 'speed' | 'steer' | 'engineOn' | 'smokeT' | 'stallT' | 'group'>): CarState {
    const group = new Group();
    group.position.set(init.x, init.y, init.z);
    group.rotation.y = init.yaw;
    this.group.add(group);
    const car: CarState = {
      ...init,
      speed: 0,
      steer: 0,
      engineOn: false,
      smokeT: 0,
      stallT: 0,
      group,
    };
    this.attachVisual(car);
    this.cars.push(car);
    return car;
  }

  serialize(): CarSave[] {
    return this.cars.map((c) => ({
      id: c.id,
      kind: c.kind,
      x: Math.round(c.x * 100) / 100,
      y: Math.round(c.y * 100) / 100,
      z: Math.round(c.z * 100) / 100,
      yaw: Math.round(c.yaw * 1000) / 1000,
      fuel: Math.round(c.fuel * 1000) / 1000,
      battery: Math.round(c.battery * 1000) / 1000,
      engine: Math.round(c.engine * 1000) / 1000,
      tires: Math.round(c.tires * 1000) / 1000,
      hasKey: c.hasKey || undefined,
      hotwired: c.hotwired || undefined,
      lightsOn: c.lightsOn || undefined,
    }));
  }

  /**
   * Context prompt when on foot looking at a drivable vehicle:
   * - Looking near the front hood -> opens the PZ Vehicle Mechanics & Repair modal.
   * - Looking near the sides/cabin -> enters the driver's seat.
   */
  spotAt(eye: Vector3, dir: Vector3): { text: string; act: boolean; run(): void } | null {
    if (this.activeCar) return null;
    let bestCar: CarState | null = null;
    let bestDist = 3.4;
    let nearHood = false;

    for (const car of this.cars) {
      const dx = car.x - eye.x;
      const dz = car.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > bestDist || Math.abs(car.y - (eye.y - 1.5)) > 2.2) continue;
      const dot = (dx * dir.x + dz * dir.z) / Math.max(d, 1e-3);
      if (dot < 0.45) continue;

      // Check if player is standing closer to the front hood (+Z in car's local forward)
      const fwdX = -Math.sin(car.yaw);
      const fwdZ = -Math.cos(car.yaw);
      const hoodX = car.x + fwdX * 1.75;
      const hoodZ = car.z + fwdZ * 1.75;
      const dHood = Math.hypot(eye.x - hoodX, eye.z - hoodZ);
      bestDist = d;
      bestCar = car;
      nearHood = dHood < 1.65;
    }

    if (!bestCar) return null;
    const target = bestCar;
    const name = vehicleName(target.kind);
    if (nearHood) {
      return {
        text: tr(`${name} · Под капотом (Механика и ремонт)`, `${name} · Under the hood (Mechanics & repair)`),
        act: true,
        run: () => this.hooks.onOpenMechanics(target),
      };
    }
    return {
      text: tr(`Сесть за руль: ${name}`, `Enter vehicle: ${name}`),
      act: true,
      run: () => this.enter(target),
    };
  }

  enter(car: CarState): void {
    if (this.activeCar) return;
    // Automatically pair a carKey from backpack if the car doesn't have one yet
    if (!car.hasKey && !car.hotwired && this.inventory.count('carKey') > 0) {
      this.inventory.remove('carKey', 1);
      car.hasKey = true;
      this.hooks.toast(
        tr('Ключ подошёл к замку зажигания!', 'The car key fit the ignition!'),
        2200,
      );
    }
    this.activeCar = car;
    this.camYawOffset = 0;
    this.camPitchOffset = 0.22;
    this.audio.playDoor();
    if (car.hasKey || car.hotwired) {
      this.tryStartEngine(car, true);
    } else {
      this.hooks.toast(
        tr(
          'Нет ключа зажигания! Найдите ключ или замкните провода [K] на приборной панели.',
          'No ignition key! Find a key or hotwire the ignition [K] on the dashboard.',
        ),
        3400,
      );
    }
  }

  /** Exit the active vehicle, placing the player safely by the left driver door. */
  exit(playerPos: Vector3, playerPrevPos: Vector3): { yaw: number } | null {
    const car = this.activeCar;
    if (!car) return null;
    if (Math.abs(car.speed) > 4.5) {
      this.hooks.toast(
        tr('Сбросьте скорость перед выходом из машины!', 'Slow down before exiting the vehicle!'),
        1600,
      );
      return null;
    }
    car.speed = 0;
    this.activeCar = null;
    this.audio.playDoor();

    // Left side of the car (-cos(yaw), +sin(yaw))
    const leftX = -Math.cos(car.yaw);
    const leftZ = Math.sin(car.yaw);
    _probe.set(car.x + leftX * 1.65, car.y, car.z + leftZ * 1.65);
    this.world.resolveCircle(_probe, 0.35, 1.6);
    _probe.y = this.layout.walkHeightAt(_probe.x, _probe.z);
    playerPos.copy(_probe);
    playerPrevPos.copy(_probe);
    return { yaw: car.yaw };
  }

  /** Attempt to crank the starter and start/stop the engine. */
  toggleIgnition(): void {
    const car = this.activeCar;
    if (!car) return;
    if (car.engineOn) {
      car.engineOn = false;
      sfx.item('click');
      this.hooks.toast(tr('Двигатель заглушен', 'Engine turned off'), 1200);
      return;
    }
    this.tryStartEngine(car, false);
  }

  tryStartEngine(car: CarState, silentIfNoKey = false): boolean {
    if (!car.hasKey && !car.hotwired) {
      if (this.inventory.count('carKey') > 0) {
        this.inventory.remove('carKey', 1);
        car.hasKey = true;
      } else {
        if (!silentIfNoKey) {
          sfx.item('click');
          this.hooks.toast(
            tr('Замок зажигания заблокирован: нужен ключ или взлом проводов [K]', 'Ignition locked: key or hotwire [K] required'),
            2400,
          );
        }
        return false;
      }
    }
    if (car.battery <= 0.03) {
      sfx.item('click');
      this.hooks.toast(tr('Аккумулятор разряжен в ноль — стартер не крутит!', 'Battery is dead — starter will not turn!'), 2400);
      return false;
    }
    // Cranking costs a bit of battery
    car.battery = Math.max(0, car.battery - 0.015);
    if (car.fuel <= 0.005) {
      this.audio.playStarter(false);
      this.hooks.toast(tr('Бак пуст! Заправьте машину из канистры.', 'Fuel tank is empty! Refuel with a jerrycan.'), 2400);
      return false;
    }
    if (car.engine <= 0.06) {
      this.audio.playStarter(false);
      this.hooks.toast(tr('Двигатель разбит! Нужен ремонт запчастями под капотом.', 'Engine destroyed! Repair with engine parts under the hood.'), 2600);
      return false;
    }
    // Low engine condition may fail to catch on first try
    if (car.engine < 0.28 && Math.random() > car.engine * 2.6) {
      this.audio.playStarter(false);
      this.hooks.toast(tr('Стартер чихает — двигатель сильно изношен!', 'Starter sputters — engine is heavily worn!'), 1800);
      return false;
    }
    car.engineOn = true;
    this.audio.playStarter(true);
    this.hooks.noise(car.x, car.y, car.z, 32);
    return true;
  }

  toggleLights(): void {
    const car = this.activeCar;
    if (!car) return;
    sfx.item('click');
    if (!car.lightsOn && car.battery <= 0.02) {
      this.hooks.toast(tr('Аккумулятор сел — фары не горят', 'Battery dead — headlights cannot turn on'), 1800);
      return;
    }
    car.lightsOn = !car.lightsOn;
  }

  honkHorn(): void {
    const car = this.activeCar;
    if (!car) return;
    if (car.battery <= 0.02) return;
    this.audio.playHorn(car.kind === 'suv');
    this.hooks.noise(car.x, car.y, car.z, 115);
    this.hooks.toast(tr('Сигнал клаксона разнёсся по кварталу!', 'Car horn echoed across the block!'), 1500);
  }

  hotwireActiveCar(): boolean {
    const car = this.activeCar;
    if (!car) return false;
    if (car.hasKey || car.hotwired) {
      this.hooks.toast(tr('Зажигание уже разблокировано', 'Ignition is already unlocked'), 1400);
      return true;
    }
    car.hotwired = true;
    sfx.item('weapon');
    this.hooks.toast(
      tr('Провода зажигания замкнуты! Двигатель запущен.', 'Ignition wires hotwired! Engine started.'),
      2400,
    );
    this.tryStartEngine(car, true);
    return true;
  }

  /** Perform a maintenance/repair action on a car (from the Mechanics UI). */
  performRepair(car: CarState, part: 'fuel' | 'battery' | 'engine' | 'tires'): string {
    const inv = this.inventory;
    const mechBonus = this.hooks.isMechanic() ? 1.35 : 1.0;

    if (part === 'fuel') {
      if (car.fuel >= 0.99) return tr('Топливный бак уже полон', 'Fuel tank is already full');
      if (inv.count('jerrycan') < 1) return tr('Нужна канистра с бензином', 'Requires a Jerrycan');
      inv.remove('jerrycan', 1);
      car.fuel = Math.min(1, car.fuel + 0.55);
      sfx.item('drink');
      return tr(`Бак заправлен (${Math.round(car.fuel * 100)}%)`, `Fuel tank refilled (${Math.round(car.fuel * 100)}%)`);
    }

    if (part === 'battery') {
      if (car.battery >= 0.99) return tr('Аккумулятор полностью заряжен', 'Battery is already at 100%');
      if (inv.count('carBattery') < 1) return tr('Нужен автомобильный аккумулятор', 'Requires a Car Battery');
      inv.remove('carBattery', 1);
      car.battery = 1;
      sfx.item('weapon');
      return tr('Установлен новый аккумулятор (100%)', 'Installed new car battery (100%)');
    }

    if (part === 'engine') {
      if (car.engine >= 0.99) return tr('Двигатель в отличном состоянии', 'Engine is in top condition');
      if (inv.count('wrench') < 1 && inv.hand !== 'wrench') {
        return tr('Для ремонта двигателя нужен гаечный ключ', 'Requires a Wrench to repair the engine');
      }
      if (inv.count('engineParts') < 1) {
        return tr('Нужны запчасти двигателя', 'Requires Engine Parts');
      }
      inv.remove('engineParts', 1);
      car.engine = Math.min(1, car.engine + 0.35 * mechBonus);
      sfx.item('weapon');
      return tr(`Двигатель отремонтирован (${Math.round(car.engine * 100)}%)`, `Engine repaired (${Math.round(car.engine * 100)}%)`);
    }

    if (part === 'tires') {
      if (car.tires >= 0.99) return tr('Шины в отличном состоянии', 'Tires are in top condition');
      if (inv.count('wrench') < 1 && inv.hand !== 'wrench') {
        return tr('Для замены колеса нужен гаечный ключ', 'Requires a Wrench to replace tires');
      }
      if (inv.count('carTire') < 1) {
        return tr('Нужна автомобильная шина', 'Requires a Car Tire');
      }
      inv.remove('carTire', 1);
      car.tires = Math.min(1, car.tires + 0.5 * mechBonus);
      sfx.item('weapon');
      return tr(`Колесо заменено (шины ${Math.round(car.tires * 100)}%)`, `Tire replaced (tires ${Math.round(car.tires * 100)}%)`);
    }

    return '';
  }

  /** Step vehicle physics, fuel/battery/engine/tire simulation, world collisions, and zombie ramming. */
  fixedUpdate(dt: number, input: InputManager, playerPos: Vector3, playerPrevPos: Vector3): void {
    // Decrement zombie hit cooldowns
    for (const [zid, t] of this.hitCooldown) {
      if (t - dt <= 0) this.hitCooldown.delete(zid);
      else this.hitCooldown.set(zid, t - dt);
    }

    // Smoke & battery drain on all cars
    for (const car of this.cars) {
      if (car.lightsOn) {
        if (!car.engineOn || Math.abs(car.speed) < 2) {
          car.battery = Math.max(0, car.battery - dt * 0.0022);
          if (car.battery <= 0) car.lightsOn = false;
        }
      }
      if (car.engineOn && car.engine < 0.38) {
        car.smokeT -= dt;
        if (car.smokeT <= 0) {
          car.smokeT = 0.14 + car.engine * 0.35;
          const fx = -Math.sin(car.yaw);
          const fz = -Math.cos(car.yaw);
          _smokePos.set(car.x + fx * 1.75 + (Math.random() - 0.5) * 0.4, car.y + 0.95, car.z + fz * 1.75 + (Math.random() - 0.5) * 0.4);
          this.particles.burst(_smokePos, 3, 0.55);
        }
      }
    }

    const car = this.activeCar;
    if (!car) {
      this.audio.update({
        active: false,
        engineOn: false,
        speed: 0,
        maxSpeed: 1,
        throttle: 0,
        steer: 0,
        braking: false,
        engineHealth: 1,
        isSuv: false,
        onRoad: true,
      });
      this.isBraking = false;
      this.resolvePlayerParkedCollision(playerPos);
      return;
    }

    const spec = VEHICLE_SPECS[car.kind];
    const throttle = input.moveY; // W = +1, S = -1
    const turnInput = -input.moveX; // A = -1 (turn left = +yaw), D = +1 (turn right = -yaw)
    const handbrake = input.isHeld('jump');

    // Auto-crank starter when pressing W if key/hotwired
    if (!car.engineOn && throttle > 0.25) {
      this.tryStartEngine(car, false);
    }

    // Engine running: consumes fuel, charges battery at speed, may stall if engine < 18%
    if (car.engineOn) {
      const load = 0.22 + Math.abs(throttle) * 0.78;
      car.fuel = Math.max(0, car.fuel - spec.fuelRate * load * dt);
      if (Math.abs(car.speed) > 3.5) {
        car.battery = Math.min(1, car.battery + dt * 0.0018);
      }
      if (car.fuel <= 0) {
        car.engineOn = false;
        sfx.item('click');
        this.hooks.toast(tr('Двигатель заглох: кончился бензин!', 'Engine stalled: out of fuel!'), 2600);
      } else if (car.engine < 0.18) {
        car.stallT -= dt;
        if (car.stallT <= 0) {
          car.stallT = 4.5 + Math.random() * 5;
          if (Math.random() < 0.45) {
            car.engineOn = false;
            sfx.item('weapon');
            this.hooks.toast(tr('Двигатель заглох из-за критического износа!', 'Engine stalled due to critical damage!'), 2200);
          }
        }
      }
    }

    // Effective top speed & power scale with engine & tire condition
    const engineFactor = 0.42 + 0.58 * clamp(car.engine / 0.7, 0, 1);
    const tireFactor = 0.38 + 0.62 * clamp(car.tires / 0.65, 0, 1);

    // Off-road surface drag (SUV handles grass much better than Sedan)
    const rx = Math.abs(car.x - Math.round(car.x / CHUNK) * CHUNK);
    const rz = Math.abs(car.z - Math.round(car.z / CHUNK) * CHUNK);
    const onRoad = rx < ROAD_HALF + 1.5 || rz < ROAD_HALF + 1.5;
    const surfaceMul = onRoad ? 1.0 : car.kind === 'suv' ? 0.88 : 0.68;

    const maxFwd = spec.maxSpeed * engineFactor * tireFactor * surfaceMul;
    const maxRev = spec.reverseSpeed * engineFactor * tireFactor * surfaceMul;

    if (handbrake) {
      const decel = spec.brake * 1.25 * dt;
      if (Math.abs(car.speed) <= decel) car.speed = 0;
      else car.speed -= Math.sign(car.speed) * decel;
      if (Math.abs(car.speed) > 4) {
        car.tires = Math.max(0, car.tires - dt * 0.003);
      }
    } else if (car.engineOn && Math.abs(throttle) > 0.05) {
      if (throttle > 0) {
        if (car.speed < 0) {
          car.speed = Math.min(0, car.speed + spec.brake * dt);
        } else {
          car.speed = Math.min(maxFwd, car.speed + throttle * spec.accel * engineFactor * dt);
        }
      } else {
        if (car.speed > 0.4) {
          car.speed = Math.max(0, car.speed + throttle * spec.brake * dt);
        } else {
          car.speed = Math.max(-maxRev, car.speed + throttle * spec.accel * 0.75 * dt);
        }
      }
    } else {
      // Rolling resistance
      const drag = spec.drag * dt;
      if (Math.abs(car.speed) <= drag) car.speed = 0;
      else car.speed -= Math.sign(car.speed) * drag;
    }

    // Steering: smoothly damp steering angle, pull slightly if tires are blown (< 15%)
    const blowoutPull = car.tires < 0.15 ? Math.sin(car.x * 0.4 + car.z * 0.4) * 0.32 : 0;
    car.steer = damp(car.steer, clamp(turnInput + blowoutPull, -1, 1), 10, dt);

    const speedRatio = clamp(Math.abs(car.speed) / 2.2, 0, 1) * (1 - 0.28 * clamp(Math.abs(car.speed) / spec.maxSpeed, 0, 1));
    const dirSign = car.speed >= -0.05 ? 1 : -1;
    car.yaw += car.steer * spec.turnRate * (0.55 + 0.45 * tireFactor) * speedRatio * dirSign * dt;

    // Move forward along (-sin(yaw), -cos(yaw))
    const fwdX = -Math.sin(car.yaw);
    const fwdZ = -Math.cos(car.yaw);
    const nextX = car.x + fwdX * car.speed * dt;
    const nextZ = car.z + fwdZ * car.speed * dt;

    // Two-circle collision envelope (front & rear axle) against world buildings/walls/static props
    const axleOffset = spec.halfL * 0.52;
    const radius = spec.halfW * 0.94;
    _probe.set(nextX + fwdX * axleOffset, car.y, nextZ + fwdZ * axleOffset);
    this.world.resolveCircle(_probe, radius, 1.5);
    const dxF = _probe.x - (nextX + fwdX * axleOffset);
    const dzF = _probe.z - (nextZ + fwdZ * axleOffset);

    _probe.set(nextX - fwdX * axleOffset + dxF, car.y, nextZ - fwdZ * axleOffset + dzF);
    this.world.resolveCircle(_probe, radius, 1.5);
    const dxR = _probe.x - (nextX - fwdX * axleOffset + dxF);
    const dzR = _probe.z - (nextZ - fwdZ * axleOffset + dzF);

    const totalPush = Math.hypot(dxF + dxR, dzF + dzR);
    car.x = nextX + dxF + dxR;
    car.z = nextZ + dzF + dzR;
    car.y = this.layout.walkHeightAt(car.x, car.z);

    // Crash impact against solid wall/obstacle
    if (totalPush > 0.035 && Math.abs(car.speed) > 3.2) {
      const impact = Math.abs(car.speed);
      const dmg = ((impact - 2.5) * 0.014) / spec.engineArmor;
      car.engine = Math.max(0, car.engine - dmg);
      car.speed *= -0.22;
      sfx.hit('metal', { x: car.x + fwdX * spec.halfL, y: car.y + 0.7, z: car.z + fwdZ * spec.halfL }, Math.min(1, impact / 12));
      this.hooks.noise(car.x, car.y, car.z, Math.min(95, 25 + impact * 4));
      if (car.engine < 0.12 && car.engineOn) {
        car.engineOn = false;
        this.hooks.toast(tr('От удара двигатель заглох!', 'The crash stalled the engine!'), 2200);
      }
    }

    // Tire wear while driving
    if (Math.abs(car.speed) > 0.5) {
      const wearRate = onRoad ? 0.00018 : 0.00045;
      const prevTires = car.tires;
      car.tires = Math.max(0, car.tires - wearRate * Math.abs(car.speed) * dt);
      if (prevTires >= 0.15 && car.tires < 0.15) {
        sfx.hit('soft', { x: car.x, y: car.y + 0.3, z: car.z }, 0.9);
        this.hooks.toast(tr('Лопнула шина! Машину сильно ведёт.', 'A tire blew out! Steering is compromised.'), 2800);
      }
    }

    // Ramming zombies in the car's oriented bounding box
    if (Math.abs(car.speed) > 2.4) {
      this.ramZombies(car, spec, fwdX, fwdZ);
    }

    // Engine noise attracts nearby zombies
    if (car.engineOn) {
      const noiseRadius = 18 + Math.abs(car.speed) * 2.4;
      this.hooks.noise(car.x, car.y, car.z, noiseRadius);
    }

    // Sync transform & keep the player controller anchored inside the car
    car.group.position.set(car.x, car.y, car.z);
    car.group.rotation.y = car.yaw;
    playerPos.set(car.x, car.y, car.z);
    playerPrevPos.set(car.x, car.y, car.z);

    // Braking state, procedural vehicle audio, wheel/suspension animation & particles
    const braking = handbrake || (throttle < -0.05 && car.speed > 0.4) || (throttle > 0.05 && car.speed < -0.4);
    this.isBraking = braking;
    this.audio.update({
      active: true,
      engineOn: car.engineOn,
      speed: car.speed,
      maxSpeed: spec.maxSpeed,
      throttle,
      steer: car.steer,
      braking,
      engineHealth: car.engine,
      isSuv: car.kind === 'suv',
      onRoad,
    });

    if (car.rig) {
      const rig = car.rig;
      const wheelRadius = car.kind === 'suv' ? 0.45 : 0.33;
      rig.wheelSpin -= (car.speed / wheelRadius) * dt;
      rig.steerFL.rotation.y = car.steer * 0.46;
      rig.steerFR.rotation.y = car.steer * 0.46;
      rig.wheelFL.rotation.x = rig.wheelSpin;
      rig.wheelFR.rotation.x = rig.wheelSpin;
      rig.wheelRL.rotation.x = rig.wheelSpin;
      rig.wheelRR.rotation.x = rig.wheelSpin;

      const targetPitch =
        handbrake && Math.abs(car.speed) > 1
          ? -0.032 * Math.sign(car.speed)
          : throttle * (car.engineOn ? 0.022 : 0) * (car.speed >= -0.2 ? 1 : -1);
      const targetRoll = -car.steer * clamp(Math.abs(car.speed) / spec.maxSpeed, 0, 1) * 0.045;
      rig.bodyPitch = damp(rig.bodyPitch, targetPitch, 9, dt);
      rig.bodyRoll = damp(rig.bodyRoll, targetRoll, 9, dt);
      const idleVib = car.engineOn ? Math.sin(performance.now() * 0.048) * 0.0022 : 0;
      rig.bodyPivot.rotation.set(rig.bodyPitch, 0, rig.bodyRoll);
      rig.bodyPivot.position.y = idleVib;

      const rightX = Math.cos(car.yaw);
      const rightZ = -Math.sin(car.yaw);
      if (car.engineOn) {
        rig.exhaustT -= dt;
        if (rig.exhaustT <= 0) {
          rig.exhaustT = 0.18 - clamp(Math.abs(throttle), 0, 1) * 0.1;
          _probe.set(
            car.x - fwdX * spec.halfL - rightX * 0.55,
            car.y + 0.25,
            car.z - fwdZ * spec.halfL - rightZ * 0.55,
          );
          this.particles.burst(_probe, 1, 0.28);
        }
      }
      if (braking && Math.abs(car.speed) > 5) {
        rig.skidT -= dt;
        if (rig.skidT <= 0) {
          rig.skidT = 0.06;
          const rearX = car.x - fwdX * (spec.halfL * 0.62);
          const rearZ = car.z - fwdZ * (spec.halfL * 0.62);
          _probe.set(rearX - rightX * spec.halfW * 0.65, car.y + 0.08, rearZ - rightZ * spec.halfW * 0.65);
          this.particles.burst(_probe, 2, 0.45);
          _probe.set(rearX + rightX * spec.halfW * 0.65, car.y + 0.08, rearZ + rightZ * spec.halfW * 0.65);
          this.particles.burst(_probe, 2, 0.45);
        }
      }
    }
  }

  private resolvePlayerParkedCollision(playerPos: Vector3): void {
    const playerR = 0.38;
    for (const c of this.cars) {
      if (Math.abs(playerPos.y - c.y) > 2.2) continue;
      const spec = VEHICLE_SPECS[c.kind];
      const dx = playerPos.x - c.x;
      const dz = playerPos.z - c.z;
      if (dx * dx + dz * dz > (spec.halfL + 1.5) ** 2) continue;
      const fwdX = -Math.sin(c.yaw);
      const fwdZ = -Math.cos(c.yaw);
      const rightX = Math.cos(c.yaw);
      const rightZ = -Math.sin(c.yaw);
      const localF = dx * fwdX + dz * fwdZ;
      const localR = dx * rightX + dz * rightZ;
      const extF = spec.halfL + playerR;
      const extR = spec.halfW + playerR;
      if (Math.abs(localF) < extF && Math.abs(localR) < extR) {
        const penF = extF - Math.abs(localF);
        const penR = extR - Math.abs(localR);
        if (penR < penF) {
          const signR = localR >= 0 ? 1 : -1;
          playerPos.x += rightX * penR * signR;
          playerPos.z += rightZ * penR * signR;
        } else {
          const signF = localF >= 0 ? 1 : -1;
          playerPos.x += fwdX * penF * signF;
          playerPos.z += fwdZ * penF * signF;
        }
      }
    }
  }

  private ramZombies(car: CarState, spec: VehicleSpec, fwdX: number, fwdZ: number): void {
    const rightX = Math.cos(car.yaw);
    const rightZ = -Math.sin(car.yaw);
    const speedAbs = Math.abs(car.speed);

    for (const z of this.zombies.list) {
      if (z.state === 'dead' || this.hitCooldown.has(z.id)) continue;
      if (Math.abs(z.pos.y - car.y) > 1.5) continue;
      const dx = z.pos.x - car.x;
      const dz = z.pos.z - car.z;
      const localFwd = dx * fwdX + dz * fwdZ;
      const localRight = dx * rightX + dz * rightZ;

      if (Math.abs(localFwd) < spec.halfL + 0.42 && Math.abs(localRight) < spec.halfW + 0.38) {
        this.hitCooldown.set(z.id, 0.42);
        const dmg = 22 + speedAbs * 14 * (car.kind === 'suv' ? 1.25 : 1.0);
        _hitPos.set(z.pos.x, z.pos.y + 0.9, z.pos.z);
        const killed = this.zombies.hit(z, dmg, car.x, car.z, speedAbs > 9, _hitPos);
        if (killed) this.hooks.onKill();
        sfx.strike('blunt', _hitPos, false, killed);
        this.particles.burst(_hitPos, killed ? 14 : 8);

        // Push surviving zombie out of the bumper path
        if (!killed) {
          this.pushZombieOut(z, car, spec, fwdX, fwdZ, rightX, rightZ, localRight);
        }

        // Ramming wears the front grille/engine and tires slightly, slows the car a bit
        car.engine = Math.max(0, car.engine - 0.012 / spec.engineArmor);
        car.tires = Math.max(0, car.tires - 0.004);
        car.speed *= car.kind === 'suv' ? 0.9 : 0.82;
      }
    }
  }

  private pushZombieOut(
    z: Zombie,
    car: CarState,
    spec: VehicleSpec,
    fwdX: number,
    fwdZ: number,
    rightX: number,
    rightZ: number,
    localRight: number,
  ): void {
    const side = localRight >= 0 ? 1 : -1;
    z.pos.x = car.x + fwdX * (spec.halfL + 0.55) + rightX * side * (spec.halfW + 0.45);
    z.pos.z = car.z + fwdZ * (spec.halfL + 0.55) + rightZ * side * (spec.halfW + 0.45);
    this.world.resolveCircle(z.pos, 0.32, 1.6);
  }

  /** Toggle between 3rd-person chase camera and 1st-person driver camera. */
  toggleCameraMode(): void {
    this.thirdPerson = !this.thirdPerson;
    this.camYawOffset = 0;
  }

  /** Update camera and headlights each rendered frame. */
  render(frameDt: number, camera: PerspectiveCamera, input: InputManager): void {
    this.updateHeadlights();

    const car = this.activeCar;
    if (!car) return;

    const look = { x: 0, y: 0 };
    input.consumeLook(look);
    if (Math.abs(look.x) + Math.abs(look.y) > 1e-4) {
      this.camYawOffset -= look.x;
      this.camPitchOffset = clamp(this.camPitchOffset + look.y, -0.15, 0.75);
      this.lookIdleT = 1.6;
    } else {
      this.lookIdleT = Math.max(0, this.lookIdleT - frameDt);
      if (this.lookIdleT <= 0 && Math.abs(car.speed) > 1.0) {
        this.camYawOffset = damp(this.camYawOffset, 0, 3.5, frameDt);
      }
    }

    const spec = VEHICLE_SPECS[car.kind];
    const viewYaw = car.yaw + this.camYawOffset;
    const fwdX = -Math.sin(viewYaw);
    const fwdZ = -Math.cos(viewYaw);

    if (this.thirdPerson) {
      const pitchCos = Math.cos(this.camPitchOffset);
      const dist = spec.camDist * pitchCos;
      const height = spec.camHeight + Math.sin(this.camPitchOffset) * 2.2;
      const targetY = car.y + 1.15;

      // Raycast from car roof to desired camera position so camera doesn't clip behind walls
      const rayDx = -fwdX;
      const rayDy = (height - 1.15) / spec.camDist;
      const rayDz = -fwdZ;
      const len = Math.hypot(rayDx, rayDy, rayDz);
      const hit = this.world.rayHit(car.x, targetY, car.z, rayDx / len, rayDy / len, rayDz / len, dist);
      const safeDist = hit >= 0 ? Math.max(1.8, hit - 0.35) : dist;

      camera.position.set(
        car.x - fwdX * safeDist,
        car.y + 1.15 + (height - 1.15) * (safeDist / Math.max(dist, 0.1)),
        car.z - fwdZ * safeDist,
      );
      camera.lookAt(car.x + fwdX * 2.4, targetY, car.z + fwdZ * 2.4);
    } else {
      // 1st-person hood view (positioned just ahead of the windshield so the solid cabin roof never clips the camera)
      const carFwdX = -Math.sin(car.yaw);
      const carFwdZ = -Math.cos(car.yaw);
      const rightX = Math.cos(car.yaw);
      const rightZ = -Math.sin(car.yaw);
      const fwdDist = car.kind === 'suv' ? 1.15 : 1.05;
      const eyeH = car.kind === 'suv' ? 1.42 : 1.24;
      camera.position.set(
        car.x + carFwdX * fwdDist - rightX * 0.32,
        car.y + eyeH,
        car.z + carFwdZ * fwdDist - rightZ * 0.32,
      );
      camera.rotation.set(-this.camPitchOffset * 0.6, viewYaw, 0, 'YXZ');
    }
  }

  /** Called when a zombie strikes the occupied vehicle instead of the player inside. */
  damageActiveCar(damage: number, fromPos: Vector3): void {
    const car = this.activeCar;
    if (!car) return;
    car.engine = Math.max(0, car.engine - damage * 0.0018);
    sfx.hit('metal', { x: fromPos.x, y: car.y + 0.7, z: fromPos.z }, 0.72);
    if (car.rig) {
      const rightX = Math.cos(car.yaw);
      const rightZ = -Math.sin(car.yaw);
      const side = (fromPos.x - car.x) * rightX + (fromPos.z - car.z) * rightZ;
      car.rig.bodyRoll += (side >= 0 ? 1 : -1) * 0.04;
    }
    if (car.engine < 0.08 && car.engineOn) {
      car.engineOn = false;
      this.hooks.toast(tr('Зомби разбили двигатель!', 'Zombies wrecked the engine!'), 2200);
    }
  }

  private updateHeadlights(): void {
    const litCar =
      (this.activeCar && this.activeCar.lightsOn && this.activeCar.battery > 0.02 ? this.activeCar : null) ??
      this.cars.find((c) => c.lightsOn && c.battery > 0.02) ??
      null;

    if (!litCar) {
      this.headLightL.intensity = 0;
      this.headLightR.intensity = 0;
    } else {
      const fwdX = -Math.sin(litCar.yaw);
      const fwdZ = -Math.cos(litCar.yaw);
      const rightX = Math.cos(litCar.yaw);
      const rightZ = -Math.sin(litCar.yaw);
      const h = litCar.kind === 'suv' ? 0.96 : 0.72;
      const w = litCar.kind === 'suv' ? 0.74 : 0.72;
      const front = litCar.kind === 'suv' ? 2.24 : 2.16;

      const power = litCar.battery < 0.2 ? 3.5 * (litCar.battery / 0.2) : 4.2;
      this.headLightL.intensity = power;
      this.headLightR.intensity = power;

      this.headLightL.position.set(litCar.x + fwdX * front - rightX * w, litCar.y + h, litCar.z + fwdZ * front - rightZ * w);
      this.headLightR.position.set(litCar.x + fwdX * front + rightX * w, litCar.y + h, litCar.z + fwdZ * front + rightZ * w);

      this.headTargetL.position.set(litCar.x + fwdX * (front + 16) - rightX * w * 0.8, litCar.y + 0.15, litCar.z + fwdZ * (front + 16) - rightZ * w * 0.8);
      this.headTargetR.position.set(litCar.x + fwdX * (front + 16) + rightX * w * 0.8, litCar.y + 0.15, litCar.z + fwdZ * (front + 16) + rightZ * w * 0.8);
    }

    const brakeCar = this.activeCar ?? litCar;
    if (brakeCar && brakeCar.battery > 0.02 && (this.isBraking || brakeCar.lightsOn)) {
      const fwdX = -Math.sin(brakeCar.yaw);
      const fwdZ = -Math.cos(brakeCar.yaw);
      const rear = brakeCar.kind === 'suv' ? 2.42 : 2.32;
      const h = brakeCar.kind === 'suv' ? 0.98 : 0.78;
      this.brakeLight.position.set(brakeCar.x - fwdX * rear, brakeCar.y + h, brakeCar.z - fwdZ * rear);
      this.brakeLight.intensity = this.isBraking && brakeCar === this.activeCar ? 2.4 : 0.75;
    } else {
      this.brakeLight.intensity = 0;
    }
  }

  dispose(): void {
    this.audio.dispose();
    this.group.removeFromParent();
    this.headLightL.removeFromParent();
    this.headLightR.removeFromParent();
    this.headTargetL.removeFromParent();
    this.headTargetR.removeFromParent();
    this.brakeLight.removeFromParent();
  }
}
