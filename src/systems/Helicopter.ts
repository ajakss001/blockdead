import { Group, MathUtils, type Mesh, type Object3D, PointLight, type Scene, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { sfx } from '../audio/Sound';
import { tr } from '../core/i18n';
import type { InputManager } from '../input/InputManager';
import type { Particles } from '../render/Particles';
import type { CollisionWorld } from '../world/CollisionWorld';
import type { WorldLayout } from '../world/gen/layout';
import { nearestPoi, siteToWorld } from '../world/gen/poi';
import type { BlastSpec } from './Firearms';
import type { Inventory } from './Inventory';

export const PERIMETER_RADIUS = 1400;
export const ESCAPE_ALTITUDE = 25;
export const HELI_SPOOL_TIME = 5.5;
export const HELI_OWNER = 4e15;

export interface HeliPartsState {
  avionics: boolean;
  fuelPump: boolean;
  battery: boolean;
}

export interface HeliSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  fuel: number;
  hull: number;
  parts: HeliPartsState;
  crashed?: boolean;
}

export interface HeliHudSnapshot {
  altitude: number;
  speedKmh: number;
  vsi: number;
  rpmPct: number;
  fuel: number;
  hull: number;
  distToPerimeter: number;
  escaped: boolean;
  crashed: boolean;
  chaseCam: boolean;
  piloting: boolean;
  parts: HeliPartsState;
}

export interface HelicopterWorld {
  scene: Scene;
  world: CollisionWorld;
  layout: WorldLayout;
  particles: Particles;
  groundY(x: number, z: number, refY?: number): number;
  toast(text: string, ms?: number): void;
  hurtPlayer(hp: number, cause: string): void;
  explode(at: Vector3, spec?: BlastSpec): void;
  onEscape(): void;
  onSave?(): void;
}

const GRAVITY = 9.8;
const _camPos = new Vector3();
const _camLook = new Vector3();
const _spark = new Vector3();

/**
 * Flyable Mi-8 EMERCOM helicopter:
 * - Spawns damaged on the Military Base helipad `(37, 41)` (or near start with `?heli=1`).
 * - Requires 3 rare parts (`heliAvionics`, `heliFuelPump`, `heliBattery`) + `'jerrycan'` fuel.
 * - 5.5 s spool-up with procedural WebAudio rotor/turbine synth & ground wash particles.
 * - Collective/pitch/roll/yaw flight physics, autorotation at 0% fuel, hard-landing damage/crash.
 * - Crossing `PERIMETER_RADIUS = 1400 m` at `alt > 25 m` triggers the Air Evacuation secret ending.
 */
export class Helicopter {
  readonly root = new Group();
  private mainRotor: Object3D | null = null;
  private tailRotor: Object3D | null = null;
  private beacon: PointLight | null = null;

  x = 37;
  y = 0.04;
  z = 41;
  yaw = Math.PI * 0.25;
  vx = 0;
  vy = 0;
  vz = 0;

  fuel = 0.12;
  hull = 0.65;
  parts: HeliPartsState = { avionics: false, fuelPump: false, battery: false };
  spool = 0;
  piloting = false;
  crashed = false;
  escaped = false;
  chaseCam = true;

  private rotorSpin = 0;
  private tailSpin = 0;
  private pitchVis = 0;
  private rollVis = 0;
  private washT = 0;
  private smokeT = 0;
  private camYaw = 0;
  private colliderInstalled = false;
  private disposed = false;

  private engineAudio: {
    gain: GainNode;
    chopLfo: OscillatorNode;
    whine: OscillatorNode;
    noise: AudioBufferSourceNode;
  } | null = null;

  constructor(private readonly w: HelicopterWorld) {
    const helipad = nearestPoi(w.layout, 'helipad', 0, 0, 120);
    if (helipad) {
      const [wx, wz] = siteToWorld(helipad, 0, 0);
      this.x = wx;
      this.z = wz;
      this.yaw = (helipad.r * Math.PI) / 2;
    } else {
      const base = nearestPoi(w.layout, 'base', 0, 0, 120);
      if (base) {
        const [wx, wz] = siteToWorld(base, 37, 41);
        this.x = wx;
        this.z = wz;
      }
    }
    this.y = Math.max(0.04, this.w.groundY(this.x, this.z, 2));
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.yaw;

    this.beacon = new PointLight(0xff5522, 0, 10, 2);
    this.beacon.position.set(0, 3.6, 5.8);
    this.root.add(this.beacon);

    this.w.scene.add(this.root);
    this.updateCollider();
    this.loadModel();
  }

  get isRepaired(): boolean {
    return this.parts.avionics && this.parts.fuelPump && this.parts.battery && !this.crashed && this.hull > 0.15;
  }

  get canTakeoff(): boolean {
    return this.isRepaired && this.fuel >= 0.05;
  }

  placeForTest(x: number, z: number, ready = false): void {
    this.x = x;
    this.z = z;
    this.y = Math.max(0.04, this.w.groundY(x, z, 2));
    this.vx = this.vy = this.vz = 0;
    if (ready) {
      this.parts = { avionics: true, fuelPump: true, battery: true };
      this.fuel = 0.85;
      this.hull = 1.0;
      this.crashed = false;
    }
    this.syncRoot();
    this.updateCollider();
  }

  private loadModel(): void {
    const baseUrl = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : '/';
    if (typeof fetch !== 'function' || typeof window === 'undefined') return;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    void loader
      .loadAsync(`${baseUrl}models/world/mi8_emercom_22k.glb`)
      .then((gltf) => {
        if (this.disposed) return;
        const scene = gltf.scene;
        scene.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        this.mainRotor = scene.getObjectByName('main_rotor') ?? null;
        this.tailRotor = scene.getObjectByName('tail_rotor') ?? null;
        this.root.add(scene);
      })
      .catch((e) => console.warn('Mi-8 GLB load skipped:', e));
  }

  /** Context prompt when on foot looking/standing near the Mi-8. Returns null if not near. */
  interactPrompt(px: number, py: number, pz: number, inv: Inventory): string | null {
    if (this.piloting) return null;
    if (Math.hypot(px - this.x, pz - this.z) > 6.8 || Math.abs(py - this.y) > 4.2) return null;
    if (this.crashed) return tr('Ми-8 разрушен и непригоден к полёту', 'Mi-8 destroyed beyond repair');

    if (!this.parts.avionics || !this.parts.fuelPump || !this.parts.battery) {
      const missing: string[] = [];
      let installable: string | null = null;
      if (!this.parts.avionics) {
        missing.push(tr('авионика', 'avionics'));
        if (inv.count('heliAvionics') > 0) installable ??= tr('Установить авионику', 'Install avionics');
      }
      if (!this.parts.fuelPump) {
        missing.push(tr('топливный насос', 'fuel pump'));
        if (inv.count('heliFuelPump') > 0) installable ??= tr('Установить топливный насос', 'Install fuel pump');
      }
      if (!this.parts.battery) {
        missing.push(tr('борт-АКБ', 'starter battery'));
        if (inv.count('heliBattery') > 0) installable ??= tr('Установить борт-АКБ', 'Install battery');
      }
      if (installable) return `E — ${installable}`;
      return `${tr('Ми-8 повреждён. Нужно', 'Mi-8 damaged. Needs')}: ${missing.join(', ')}`;
    }

    if (this.fuel < 0.20) {
      if (inv.count('jerrycan') > 0) return `E — ${tr('Заправить Ми-8 канистрой', 'Refuel Mi-8 with jerrycan')} (${Math.round(this.fuel * 100)}%)`;
      return tr(`Мало топлива (${Math.round(this.fuel * 100)}%) — нужна канистра бензина`, `Low fuel (${Math.round(this.fuel * 100)}%) — need gasoline jerrycan`);
    }

    if (inv.count('jerrycan') > 0 && this.fuel < 0.45) {
      return `E — ${tr('Заправить Ми-8 канистрой', 'Refuel Mi-8 with jerrycan')} (${Math.round(this.fuel * 100)}%)`;
    }
    return `E — ${tr('Сесть за штурвал Ми-8', 'Pilot Mi-8 Helicopter')}`;
  }

  /** Handles [E] on foot near the helicopter. Returns true if interaction consumed [E]. */
  interact(px: number, py: number, pz: number, inv: Inventory): boolean {
    if (this.piloting) return false;
    if (Math.hypot(px - this.x, pz - this.z) > 6.8 || Math.abs(py - this.y) > 4.2) return false;
    if (this.crashed) {
      this.w.toast(tr('Вертолёт разрушен', 'Helicopter is destroyed'), 1400);
      return true;
    }

    if (!this.parts.avionics && inv.remove('heliAvionics', 1) > 0) {
      this.parts.avionics = true;
      sfx.item('weapon');
      this.w.toast(tr('Авионика Ми-8 установлена!', 'Mi-8 avionics installed!'), 1600);
      this.w.onSave?.();
      return true;
    }
    if (!this.parts.fuelPump && inv.remove('heliFuelPump', 1) > 0) {
      this.parts.fuelPump = true;
      sfx.item('weapon');
      this.w.toast(tr('Топливный насос установлен!', 'Mi-8 fuel pump installed!'), 1600);
      this.w.onSave?.();
      return true;
    }
    if (!this.parts.battery && inv.remove('heliBattery', 1) > 0) {
      this.parts.battery = true;
      sfx.item('weapon');
      this.w.toast(tr('Стартерная батарея установлена!', 'Mi-8 battery installed!'), 1600);
      this.w.onSave?.();
      return true;
    }

    if (!this.isRepaired) {
      const rem: string[] = [];
      if (!this.parts.avionics) rem.push(tr('Блок авионики', 'Avionics'));
      if (!this.parts.fuelPump) rem.push(tr('Топливный насос', 'Fuel pump'));
      if (!this.parts.battery) rem.push(tr('Бортовой АКБ', 'Battery'));
      this.w.toast(`${tr('Недостаёт', 'Missing')}: ${rem.join(', ')}`, 1800);
      return true;
    }

    if (this.fuel < 0.45 && inv.remove('jerrycan', 1) > 0) {
      this.fuel = Math.min(1, this.fuel + 0.45);
      sfx.item('drink');
      this.w.toast(`${tr('Ми-8 заправлен', 'Mi-8 refueled')}: ${Math.round(this.fuel * 100)}%`, 1500);
      this.w.onSave?.();
      return true;
    }

    if (this.fuel < 0.08) {
      this.w.toast(tr('Бак пуст — нужна канистра бензина!', 'Tank empty — need gasoline jerrycan!'), 1600);
      return true;
    }

    this.board();
    return true;
  }

  board(): void {
    if (!this.isRepaired || this.crashed) return;
    this.piloting = true;
    this.camYaw = 0;
    this.updateCollider();
    this.startAudio();
    this.w.toast(tr('Запуск турбин Ми-8… (5.5 сек)', 'Starting Mi-8 turbines… (5.5 s)'), 2200);
  }

  tryExit(outPos: Vector3, outPrev: Vector3): boolean {
    if (!this.piloting) return false;
    const alt = this.y - this.w.groundY(this.x, this.z, this.y);
    const spd = Math.hypot(this.vx, this.vy, this.vz);
    if (alt > 1.8 || spd > 3.5) {
      this.w.toast(tr('Сначала приземлитесь! (Shift — снижение)', 'Land first before exiting! (Shift — descend)'), 1500);
      return false;
    }
    this.piloting = false;
    const lx = this.x - Math.cos(this.yaw) * 3.1;
    const lz = this.z + Math.sin(this.yaw) * 3.1;
    const ly = this.w.groundY(lx, lz, this.y);
    outPos.set(lx, ly, lz);
    outPrev.copy(outPos);
    this.updateCollider();
    this.w.onSave?.();
    return true;
  }

  fixedUpdate(dt: number, input: InputManager | null, playerPos: Vector3, playerPrev: Vector3): void {
    if (this.crashed) {
      this.spool = Math.max(0, this.spool - dt * 0.4);
      this.updateRotors(dt);
      this.updateAudio();
      return;
    }

    if (this.piloting && input) {
      if (input.consumePressed('inspect')) {
        this.chaseCam = !this.chaseCam;
      }
      if (this.fuel > 0) {
        this.spool = Math.min(1, this.spool + dt / HELI_SPOOL_TIME);
      } else {
        // Autorotation rpm decays gently toward glide regime
        this.spool = Math.max(0.55, this.spool - dt * 0.08);
      }

      const groundH = this.w.groundY(this.x, this.z, this.y);
      const alt = Math.max(0, this.y - groundH);

      const moveFwd = input.moveY; // W (+1), S (-1)
      const moveRight = input.moveX; // D (+1), A (-1)
      const up = input.isHeld('jump') ? 1 : 0; // Space
      const down = input.isHeld('sprint') ? 1 : 0; // Shift
      const yawInput = (input.isHeld('bash') ? 1 : 0) - (input.isHeld('use') ? 1 : 0); // Q left (+1), E right (-1)

      if (this.spool > 0.72) {
        const power = (this.spool - 0.72) / 0.28;
        const yawRate = 1.25 * power;
        this.yaw += yawInput * yawRate * dt;

        // Forward vector for nose along -Z at yaw = 0
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw);
        const rz = -Math.sin(this.yaw);

        const maxAccel = 26 * power;
        const collective = (up - down * 1.1) * power;

        if (this.fuel > 0) {
          // Hover gravity compensation + collective climb/descend + forward/lateral cyclic thrust
          const lift = GRAVITY + collective * 11.5;
          this.vy += (lift - GRAVITY) * dt;
          this.vy *= Math.exp(-dt * 1.6);
          const burnRate = (0.0042 + Math.abs(collective) * 0.0028 + Math.hypot(moveFwd, moveRight) * 0.0022) * dt;
          this.fuel = Math.max(0, this.fuel - burnRate);
          if (this.fuel <= 0) {
            this.w.toast(tr('Топливо закончилось! Авторотация — держите крен ровно!', 'Fuel exhausted! Autorotating — keep level for landing!'), 2400);
          }
        } else {
          // Autorotation: steady descent -6.5 m/s unless pilot flares momentarily near ground
          const flare = up > 0 ? 3.5 : 0;
          this.vy += (-6.2 + flare - this.vy) * Math.min(1, dt * 1.8);
        }

        if (alt > 0.25 || up > 0) {
          this.vx += (fx * moveFwd + rx * moveRight) * maxAccel * dt;
          this.vz += (fz * moveFwd + rz * moveRight) * maxAccel * dt;
        }
        this.pitchVis = MathUtils.lerp(this.pitchVis, -moveFwd * 0.24 * power, Math.min(1, dt * 5));
        this.rollVis = MathUtils.lerp(this.rollVis, -moveRight * 0.26 * power, Math.min(1, dt * 5));
      } else {
        this.vy = 0;
        this.vx *= Math.exp(-dt * 4);
        this.vz *= Math.exp(-dt * 4);
        this.pitchVis *= Math.exp(-dt * 5);
        this.rollVis *= Math.exp(-dt * 5);
      }

      // Aerodynamic horizontal drag
      const drag = alt > 0.15 ? 0.55 : 3.2;
      this.vx *= Math.exp(-drag * dt);
      this.vz *= Math.exp(-drag * dt);

      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;

      const nextGround = this.w.groundY(this.x, this.z, this.y);
      if (this.y <= nextGround + 0.04) {
        const impact = -this.vy;
        this.y = nextGround + 0.04;
        this.vy = Math.max(0, this.vy);
        if (impact > 11.5) {
          this.crash();
          return;
        } else if (impact > 5.2) {
          const dmg = (impact - 5.0) * 0.085;
          this.hull = Math.max(0.05, this.hull - dmg);
          this.w.hurtPlayer(Math.round((impact - 4.8) * 5.5), tr('Жёсткая посадка Ми-8', 'Mi-8 hard landing'));
          sfx.hit('metal', _spark.set(this.x, this.y, this.z), 1);
          this.w.toast(tr('Жёсткая посадка!', 'Hard landing!'), 1200);
          if (this.hull <= 0.1) {
            this.crash();
            return;
          }
        }
      }

      // Keep player anchor coupled to cockpit while airborne
      playerPos.set(this.x, this.y + 1.1, this.z);
      playerPrev.copy(playerPos);

      // Secret ending trigger: crossing outer perimeter above 25 m altitude!
      const newAlt = this.y - nextGround;
      if (!this.escaped && newAlt > ESCAPE_ALTITUDE && Math.hypot(this.x, this.z) > PERIMETER_RADIUS) {
        this.escaped = true;
        this.w.onEscape();
      }
    } else {
      this.spool = Math.max(0, this.spool - dt / 8.0);
      this.pitchVis *= Math.exp(-dt * 5);
      this.rollVis *= Math.exp(-dt * 5);
      if (this.y > this.w.groundY(this.x, this.z, this.y) + 0.1) {
        this.vy -= GRAVITY * 0.5 * dt;
        this.y = Math.max(this.w.groundY(this.x, this.z, this.y) + 0.04, this.y + this.vy * dt);
      }
    }

    const alt = Math.max(0, this.y - this.w.groundY(this.x, this.z, this.y));
    if (this.spool > 0.45 && alt < 18) {
      this.washT -= dt;
      if (this.washT <= 0) {
        this.washT = 0.08;
        const ringAng = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 5.5;
        this.w.particles.steam(this.x + Math.cos(ringAng) * r, this.y - alt + 0.25, this.z + Math.sin(ringAng) * r, 0.38 * this.spool);
      }
    }
    if (this.hull < 0.72) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.35;
        this.w.particles.smoke(this.x, this.y + 3.2, this.z);
      }
    }
    if (this.beacon) {
      this.beacon.intensity = this.spool > 0.15 && ((performance.now() * 0.001) % 1.1) < 0.14 ? 2.2 : 0;
    }

    this.updateRotors(dt);
    this.syncRoot();
    this.updateCollider();
    this.updateAudio();
  }

  applyCamera(camera: { position: Vector3; lookAt(v: Vector3): void; rotation: { order: string } }, lookDeltaX: number): void {
    this.camYaw = MathUtils.clamp(this.camYaw - lookDeltaX * 0.8, -Math.PI * 0.75, Math.PI * 0.75);
    const totalYaw = this.yaw + (this.chaseCam ? this.camYaw : 0);
    const fx = -Math.sin(totalYaw);
    const fz = -Math.cos(totalYaw);
    if (this.chaseCam) {
      const groundAtCam = this.w.groundY(this.x - fx * 19, this.z - fz * 19, this.y);
      _camPos.set(this.x - fx * 19.5, Math.max(groundAtCam + 1.5, this.y + 6.4), this.z - fz * 19.5);
      _camLook.set(this.x + fx * 6, this.y + 2.0, this.z + fz * 6);
    } else {
      const hfx = -Math.sin(this.yaw);
      const hfz = -Math.cos(this.yaw);
      _camPos.set(this.x + hfx * 6.5, this.y + 2.35, this.z + hfz * 6.5);
      _camLook.set(_camPos.x + fx * 30, _camPos.y - 2.2 + this.pitchVis * 18, _camPos.z + fz * 30);
    }
    camera.position.copy(_camPos);
    camera.lookAt(_camLook);
  }

  hudState(): HeliHudSnapshot {
    const alt = Math.max(0, this.y - this.w.groundY(this.x, this.z, this.y));
    return {
      altitude: alt,
      speedKmh: Math.hypot(this.vx, this.vz) * 3.6,
      vsi: this.vy,
      rpmPct: Math.round(this.spool * 100),
      fuel: this.fuel,
      hull: this.hull,
      distToPerimeter: Math.max(0, PERIMETER_RADIUS - Math.hypot(this.x, this.z)),
      escaped: this.escaped,
      crashed: this.crashed,
      chaseCam: this.chaseCam,
      piloting: this.piloting,
      parts: { ...this.parts },
    };
  }

  /** Returns dashboard snapshot while piloting OR within 9 m on foot (for cockpit checklist updates). */
  nearbyHudState(px: number, py: number, pz: number): HeliHudSnapshot | null {
    if (this.piloting) return this.hudState();
    if (this.crashed) return null;
    if (Math.hypot(px - this.x, pz - this.z) <= 9.0 && Math.abs(py - this.y) <= 4.5) return this.hudState();
    return null;
  }

  serialize(): HeliSave {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      fuel: this.fuel,
      hull: this.hull,
      parts: { ...this.parts },
      crashed: this.crashed || undefined,
    };
  }

  restore(s: HeliSave | undefined): void {
    if (!s) return;
    this.x = s.x;
    this.y = s.y;
    this.z = s.z;
    this.yaw = s.yaw;
    this.fuel = s.fuel;
    this.hull = s.hull;
    this.parts = { ...s.parts };
    this.crashed = !!s.crashed;
    this.syncRoot();
    this.updateCollider();
  }

  dispose(): void {
    this.disposed = true;
    this.stopAudio();
    this.w.world.removeOwner(HELI_OWNER);
    this.root.removeFromParent();
  }

  private crash(): void {
    this.crashed = true;
    this.piloting = false;
    this.hull = 0;
    this.vx = this.vy = this.vz = 0;
    this.w.explode(new Vector3(this.x, this.y + 1.2, this.z), {
      radius: 11,
      damage: 180,
      impulse: 5,
      noise: 90,
      selfDamage: 120,
      shrapnel: 32,
    });
    this.w.hurtPlayer(120, tr('Крушение вертолёта Ми-8', 'Mi-8 helicopter crash'));
    this.stopAudio();
    this.updateCollider();
  }

  private syncRoot(): void {
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.set(this.pitchVis, this.yaw, this.rollVis, 'YXZ');
  }

  private updateCollider(): void {
    const alt = this.y - this.w.groundY(this.x, this.z, this.y);
    if (this.piloting || alt > 2.2) {
      if (this.colliderInstalled) {
        this.w.world.removeOwner(HELI_OWNER);
        this.colliderInstalled = false;
      }
      return;
    }
    this.w.world.removeOwner(HELI_OWNER);
    // Fuselage collider (~2.8 m width, 16 m length, rotated along yaw; blades spin high above head)
    this.w.world.addOwnedOriented(HELI_OWNER, this.x, this.z, 1.5, 7.6, this.yaw, this.y, this.y + 3.4, false, false);
    this.colliderInstalled = true;
  }

  private updateRotors(dt: number): void {
    const spinSpeed = this.spool * 26;
    this.rotorSpin = (this.rotorSpin + spinSpeed * dt) % (Math.PI * 2);
    this.tailSpin = (this.tailSpin + spinSpeed * 2.4 * dt) % (Math.PI * 2);
    if (this.mainRotor) this.mainRotor.rotation.y = this.rotorSpin;
    if (this.tailRotor) this.tailRotor.rotation.x = this.tailSpin;
  }

  private startAudio(): void {
    if (this.engineAudio || !sfx.ac || !sfx.world || !sfx.noise) return;
    const ac = sfx.ac;
    const gain = ac.createGain();
    gain.gain.value = 0.01;
    gain.connect(sfx.world);

    const noise = ac.createBufferSource();
    noise.buffer = sfx.noise;
    noise.loop = true;
    const low = ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 250;

    const chop = ac.createGain();
    chop.gain.value = 0.5;
    const lfo = ac.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 2;
    const depth = ac.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(chop.gain);
    noise.connect(low).connect(chop).connect(gain);

    const whine = ac.createOscillator();
    whine.frequency.value = 520;
    const wg = ac.createGain();
    wg.gain.value = 0.03;
    whine.connect(wg).connect(gain);

    noise.start();
    lfo.start();
    whine.start();
    this.engineAudio = { gain, chopLfo: lfo, whine, noise };
  }

  private updateAudio(): void {
    if (!this.engineAudio || !sfx.ac) return;
    if (this.spool < 0.02 && !this.piloting) {
      this.stopAudio();
      return;
    }
    const t = sfx.ac.currentTime;
    const vol = (this.piloting ? 0.34 : 0.14) * Math.max(0.05, this.spool);
    this.engineAudio.gain.gain.setTargetAtTime(vol, t, 0.15);
    this.engineAudio.chopLfo.frequency.setTargetAtTime(2 + this.spool * 12, t, 0.2);
    this.engineAudio.whine.frequency.setTargetAtTime(420 + this.spool * 1450, t, 0.2);
  }

  private stopAudio(): void {
    if (!this.engineAudio) return;
    try {
      this.engineAudio.noise.stop();
      this.engineAudio.chopLfo.stop();
      this.engineAudio.whine.stop();
      this.engineAudio.gain.disconnect();
    } catch {
      // Ignore already stopped audio nodes.
    }
    this.engineAudio = null;
  }
}
