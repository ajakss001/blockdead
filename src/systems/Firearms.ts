import { type Object3D, Quaternion, type Scene, Vector3 } from 'three';
import { type BulletHit, type EchoPlace, type GunMech, type GunSound, sfx, type StepSurface } from '../audio/Sound';
import { tr } from '../core/i18n';
import type { InputManager } from '../input/InputManager';
import type { Player } from '../player/Player';
import type { Particles } from '../render/Particles';
import type { Surface } from '../render/look/surfaces';
import { GunFx } from '../weapons/GunFx';
import { capacityOf, damageOf, falloff, GUNS, type GunId, isGun, noiseOf } from '../weapons/guns';
import { type AmmoSource, type GunEvent, type GunInput, GunState } from '../weapons/gunState';
import type { Inventory } from './Inventory';
import { applyZonalArmor, type HitZone } from './Armor';
import type { Bandit, BanditHit } from './Bandits';
import type { HitResult, ZombieSim } from './zombies';
import type { RayHitDetail } from '../world/CollisionWorld';
import type { DoorBulletResult } from '../world/Doors';

export interface BlastSpec {
  radius: number;
  damage: number;
  impulse: number;
  noise: number;
  selfDamage?: number;
  shrapnel?: number;
}

/**
 * Firearms in the world (CLAUDE.md «Огнестрельное оружие»): the gun in hand's logic (weapons/gunState) on the
 * player's input, its shots as rays from the eye with the gun's spread (wide from the hip, tight in the
 * sights, wider on the move; the class's handling narrows it and the recoil), the nearest zombie or wall
 * on each ray takes it (the head double, a leg slows; dust, scraps of cloth, sparks — no blood), the noise
 * the zombies and hordes come to, the RPG's rocket and its blast, the butt strike. The viewmodel animates
 * (gunView), GunFx leaves the flash, the cases and the magazines, the HUD shows the rounds.
 */

export interface FirearmsWorld {
  input: InputManager;
  player: Player;
  inventory: Inventory;
  zombies: ZombieSim;
  particles: Particles;
  /** The world scene (cases, magazines, the flash's light). */
  scene: Scene;
  toast(text: string, ms: number): void;
  /** The world camera (the arms' space is its own). */
  camera: Object3D;
  rayHit(o: Vector3, d: Vector3, max: number): number;
  rayHitDetail?(o: Vector3, d: Vector3, max: number, ignoreGlass?: boolean): RayHitDetail | null;
  doorBullet?(owner: number, dmg: number): DoorBulletResult | null;
  doorsBlast?(at: Vector3, radius: number, dmg: number): { brokenGlassAt: Vector3[] };
  surface(o: Vector3, d: Vector3, dist: number): Surface | null;
  /** A noise zombies and hordes hear, m. */
  noise(x: number, y: number, z: number, r: number): void;
  /** Where the floor is under a point. */
  groundY(x: number, y: number, z: number): number;
  /** The player hurt by their own blast (hp of 100). */
  hurtSelf(hp: number): void;
  /** A blast sets the cars within r on fire. */
  igniteCars(x: number, y: number, z: number, r: number): void;
  /** A bullet on a car: its alarm may go off. */
  carHit(x: number, y: number, z: number): void;
  /** Glass pane struck by bullet or melee: plays 3D shatter + settle and spawns floor shard zones. */
  onBreakGlass?(at: Vector3, dir: Vector3): void;
  /** The class's handling of firearms (1 none, 1.3 military, 1.5 SWAT). */
  handling(): number;
  /** Indoors / an alley / a street (the echo). */
  place(): EchoPlace;
  /** Surface under the shooter's feet for shell casing drop sound. */
  surfaceAt?(): StepSurface;
  /** A zombie hit (skills, kills count). */
  onHit?(killed: boolean, head: boolean): void;
  /** Hostile survivor bots. */
  bandits?: {
    hitTest(o: Vector3, d: Vector3, max: number, slack?: number): BanditHit | null;
    hit(bot: Bandit, dmg: number, fromX: number, fromZ: number, head: boolean, zone?: HitZone): boolean;
    blastDamage?(at: Vector3, radius: number, maxDmg: number): void;
  };
}

/** What the HUD shows of the gun in hand. */
export interface GunHudState {
  id: GunId;
  name: string;
  mag: number;
  chamber: boolean;
  capacity: number;
  reserve: number;
  mode: string;
  busy: boolean;
  reloadK: number;
  reloading: boolean;
  jammed: boolean;
  ads: boolean;
  /** Seconds left for the Tarkov-style mag-check readout beside the white silhouette. */
  magCheckLeft: number;
  /** Crosshair spread now (deg), the kind of crosshair. */
  spread: number;
  crosshair: 'cross' | 'circle' | 'none';
}

const SOUND: Record<GunId, GunSound> = {
  pistol_g17: 'pistol',
  pistol_m1911: 'pistol45',
  shotgun_pump: 'shotgun',
  rifle_m4a1: 'rifle',
  rifle_ak: 'ak',
  rifle_hunting: 'hunting',
  launcher_rpg: 'rpg',
};
const BULLET: Partial<Record<Surface, BulletHit>> = {
  wood: 'wood',
  roof: 'wood',
  foliage: 'soft',
  metal: 'metal',
  trim: 'metal',
  lamp: 'metal',
  carPaint: 'car',
  busPaint: 'car',
  glass: 'glass',
  windowGlass: 'glass',
  carGlass: 'glass',
  rubber: 'soft',
  ground: 'soft',
};
/** The butt strike: reach, damage. */
const BASH = { reach: 1.5, damage: [12, 18] as const };
const ROCKET = { speed: 55, gravity: 2.5, life: 4 };

const _o = new Vector3();
const _d = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _p = new Vector3();
const _p2 = new Vector3();
const _rayO = new Vector3();
const _origO = new Vector3();
const _shpD = new Vector3();
const _q = new Quaternion();

interface Rocket {
  pos: Vector3;
  vel: Vector3;
  t: number;
}

export class Firearms {
  readonly fx: GunFx;
  /** The logic of the gun in hand (a new one each time it is drawn: its rounds stay in the inventory). */
  state: GunState | null = null;
  private current: GunId | null = null;
  /** R held: a long press inspects. */
  private reloadHeld = -1;
  private inspectFromHold = false;
  private smokeT = 0;
  private prevAds = false;
  private readonly pendingCasings: { t: number; shell: boolean }[] = [];
  private rockets: Rocket[] = [];
  /** The burst's climb on the view this pull. */
  private climb = 0;
  /** Seconds since the last shot (the HUD fades out 3 s after). */
  sinceUse = 99;
  /** Seconds left for Tarkov-style mag-check overlay below crosshair. */
  magCheckT = 0;
  /** Anti-spam cooldown (seconds) for manual mag check (Alt+T / touch). */
  private magCheckCooldown = 0;
  /** The noise of the last shot (the HUD's wave), m, and how long ago. */
  lastNoise = 0;
  /** A hit to show: 'body' | 'head', fresh. */
  hitMark: 'body' | 'head' | null = null;
  /** Hit-marker age. */
  hitMarkT = 9;
  /** Distance to a wall straight ahead (the gun goes up and back near it), m. */
  wallDist = 99;
  private shotTotalPellets = 1;
  private shotHitSounds = 0;
  private shotSurfaceLookups = 0;
  private shotLastSurface: Surface | null = null;
  private shotHitMarked = false;

  constructor(private readonly w: FirearmsWorld) {
    this.fx = new GunFx(w.scene);
    this.fx.groundY = w.groundY;
  }


  private ammo(id: GunId): AmmoSource {
    const inv = this.w.inventory;
    const g = GUNS[id];
    return {
      count: (a) => inv.count(a),
      take: (a, n) => inv.remove(a, n),
      give: (a, n) => {
        if (n > 0) inv.add(a, n);
      },
      spareMags: () => (g.mag ? inv.count(g.mag) : 0),
      takeMag: () => (g.mag ? inv.remove(g.mag, 1) > 0 : false),
    };
  }

  /** The gun in hand now (the viewmodel has switched to it). */
  get gun(): GunId | null {
    return this.current;
  }

  fixedUpdate(dt: number): void {
    const { input, inventory: inv, player } = this.w;
    const vm = player.viewmodel;
    const hand = inv.hand;
    this.sinceUse += dt;
    this.magCheckT = Math.max(0, this.magCheckT - dt);
    this.magCheckCooldown = Math.max(0, this.magCheckCooldown - dt);
    this.hitMarkT += dt;
    for (let i = this.pendingCasings.length - 1; i >= 0; i--) {
      this.pendingCasings[i].t -= dt;
      if (this.pendingCasings[i].t <= 0) {
        const c = this.pendingCasings[i];
        this.pendingCasings.splice(i, 1);
        const pos = this.w.player.controller?.position ?? this.w.camera.getWorldPosition(_o);
        sfx.casing({ x: pos.x, y: pos.y + 0.05, z: pos.z }, c.shell, this.w.surfaceAt?.() ?? 'asphalt');
      }
    }
    this.updateRockets(dt);
    // The gun in the hands is the one the viewmodel shows (after the switch).
    const id = isGun(hand) && vm.gun === hand ? hand : null;
    if (id !== this.current || (id && this.state && inv.gun(id) !== this.state.inst)) {
      this.current = id;
      this.climb = 0;
      if (id) {
        const inst = inv.gun(id);
        inst.wear = inv.handWear;
        this.state = new GunState(id, inst, this.ammo(id));
        this.state.speed = 1 + (this.w.handling() - 1) * 0.4;
        this.sinceUse = 0;
        this.magCheckT = 0;
        sfx.gunMech('draw');
      } else this.state = null;
    }
    const gs = this.state;
    if (!id || !gs) {
      vm.gunView.wall = 0;
      vm.gunView.wallDist = 99;
      vm.gunView.ads = false;
      // Keep the gun's state shown to the viewmodel during the switch away.
      input.consumePressed('reload');
      input.consumePressed('inspect');
      input.consumePressed('checkAmmo');
      input.consumePressed('fireMode');
      input.consumePressed('bash');
      return;
    }
    const g = GUNS[id];
    const c = player.controller;
    // A wall straight ahead: compute live eye when controller has position (avoids 1-frame crouch lag), fallback to camera in unit tests.
    if (c.position && typeof c.eyeHeight === 'function') {
      _o.set(c.position.x, c.position.y + c.eyeHeight(1), c.position.z);
      const cp = Math.cos(c.pitch);
      _d.set(-Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp);
    } else {
      this.w.camera.getWorldPosition(_o);
      this.w.camera.getWorldDirection(_d);
    }
    const hit = this.w.rayHit(_o, _d, 2);
    this.wallDist = hit < 0 ? 99 : hit;
    const reachOut = g.cls === 'pistol' ? 0.62 : g.cls === 'launcher' ? 0.55 : 0.85;
    vm.gunView.wall = Math.max(0, Math.min(1, (reachOut + 0.15 - this.wallDist) / 0.45));
    vm.gunView.wallDist = this.wallDist;
    // R: a tap reloads, held inspects. Alt+T / touch mag-check checks magazine status with 1.5s cooldown.
    let reload = false;
    let inspect = input.consumePressed('inspect');
    const checkAmmo = input.consumePressed('checkAmmo');
    if (checkAmmo && this.magCheckCooldown <= 0 && !player.busy && !vm.switching) {
      this.magCheckT = 2.8;
      this.magCheckCooldown = 1.5;
      inspect = true;
      sfx.gunMech('magCheck', id === 'rifle_ak' ? 0.94 : id.startsWith('pistol') ? 1.08 : 1);
    }
    if (input.consumePressed('reload')) {
      this.reloadHeld = 0;
      this.inspectFromHold = false;
    }
    if (this.reloadHeld >= 0) {
      if (input.isHeld('reload')) {
        this.reloadHeld += dt;
        if (this.reloadHeld > 0.45 && !this.inspectFromHold) {
          this.inspectFromHold = true;
          inspect = true;
        }
      } else {
        if (!this.inspectFromHold) reload = true;
        this.reloadHeld = -1;
      }
    }
    const busy = player.busy || vm.switching;
    const pulled = input.consumePressed('attack');
    const trigger = input.isHeld('attack');
    const canFire = !busy && !c.sprinting && vm.gunView.wall < 0.5;
    const inp: GunInput = {
      trigger: trigger && !busy,
      pulled: pulled && !busy,
      reload: reload && !busy,
      mode: input.consumePressed('fireMode') && !busy,
      inspect: inspect && !busy,
      bash: input.consumePressed('bash') && !busy && vm.gunView.wall < 0.5,
      canFire,
    };
    const events = gs.update(dt, inp);
    for (const e of events) this.event(id, gs, e);
    if (!trigger) this.climb = Math.max(0, this.climb - dt * 2);
    inv.handWear = gs.inst.wear;
    // The viewmodel's view of it.
    const gv = vm.gunView;
    gv.action = gs.action;
    gv.t = gs.t;
    gv.duration = gs.duration;
    gv.open = gs.open;
    gv.chamber = gs.inst.chamber;
    gv.mods = gs.inst.mods;
    gv.ads = input.isHeld('aim');
    if (gv.ads && !this.prevAds && !busy && !c.sprinting) sfx.ads(g.cls === 'pistol');
    this.prevAds = gv.ads;
    player.zoom = g.zoom;
    if (gv.ads || trigger || gs.busy) this.sinceUse = Math.min(this.sinceUse, 0.5);
    // Smoke from the muzzle after a burst.
    if (this.smokeT > 0) {
      this.smokeT -= dt;
      if (Math.random() < dt * 14) {
        this.muzzleWorld(_p);
        this.w.particles.steam(_p.x, _p.y, _p.z, 0.45);
      }
    }
  }

  /** A shot went off (the HUD's noise wave). */
  onShot?: (noise: number) => void;


  render(gameDt: number): void {
    this.fx.update(gameDt);
    // The flash sprite rides on the muzzle of the gun in hand.
    const gm = this.w.player.viewmodel.gunModel;
    const f = this.fx.flash;
    if (gm && f.parent !== gm.root) gm.root.add(f);
    if (gm) gm.muzzle(f.position).z -= 0.03;
  }

  /** The HUD's view of the gun in hand, or null. */
  hud(): GunHudState | null {
    const id = this.current;
    const gs = this.state;
    if (!id || !gs) return null;
    const g = GUNS[id];
    const inst = gs.inst;
    const vm = this.w.player.viewmodel;
    return {
      id,
      name: g.name,
      mag: inst.mag + (inst.chamber ? 1 : 0),
      chamber: inst.chamber,
      capacity: capacityOf(id, inst.mods),
      reserve: this.w.inventory.count(g.caliber),
      mode:
        g.modes.length > 1
          ? inst.mode === 'auto'
            ? tr('АВТО', 'AUTO')
            : tr('ОДИН', 'SEMI')
          : g.action === 'pump'
            ? tr('ПОМПА', 'PUMP')
            : g.action === 'bolt'
              ? tr('ЗАТВОР', 'BOLT')
              : '',
      busy: gs.busy,
      reloadK: gs.duration > 0 ? gs.t / gs.duration : 0,
      reloading: gs.action === 'reload' || gs.action === 'reloadEmpty' || gs.action.startsWith('load') || gs.action === 'unjam',
      jammed: inst.jammed,
      ads: vm.ads > 0.6,
      magCheckLeft: Math.max(0, this.magCheckT),
      spread: this.spread(id),
      crosshair: g.cls === 'launcher' ? 'none' : g.pellets ? 'circle' : 'cross',
    };
  }

  /** The cone now, degrees (half-angle). */
  spread(id: GunId): number {
    const g = GUNS[id];
    const vm = this.w.player.viewmodel;
    const c = this.w.player.controller;
    const base = g.spread.hip + (g.spread.aim - g.spread.hip) * vm.ads;
    const move = Math.min(1, c.speed / 4.5) * g.spread.move;
    const burst = this.climb * 0.6;
    return (base + move + burst) / this.w.handling();
  }

  private event(id: GunId, gs: GunState, e: GunEvent): void {
    const g = GUNS[id];
    const vm = this.w.player.viewmodel;
    const p = this.w.player;
    const mods = gs.inst.mods;
    const mech = (m: GunMech) => sfx.gunMech(m, id === 'rifle_ak' ? 0.85 : id.startsWith('pistol') ? 1.15 : 1);
    switch (e.kind) {
      case 'shot': {
        this.sinceUse = 0;
        const handling = this.w.handling();
        const suppressed = mods.includes('mod_suppressor');
        // Recoil: the gun in the hands, the view (climbing in a burst), the camera's jolt.
        vm.fire(g.recoil.up / handling, g.recoil.side / handling, g.recoil.back / handling);
        const c = p.controller;
        const adsK = 1 - 0.4 * vm.ads;
        c.pitch = Math.min(1.45, c.pitch + ((g.recoil.up * 0.6 + g.recoil.climb * Math.min(10, e.burst)) * adsK) / handling);
        c.yaw += ((Math.random() * 2 - 1) * g.recoil.side * 0.6 * adsK) / handling;
        this.climb = Math.min(6, this.climb + (g.modes.includes('auto') && gs.inst.mode === 'auto' ? 1 : 0.3));
        p.shake(g.recoil.shake * (1 - 0.6 * vm.ads));
        sfx.gunShot(SOUND[id], null, suppressed, this.w.place());
        // The M4's brighter click on its last three rounds.
        if (id === 'rifle_m4a1' && gs.inst.mag < 3) mech('lastRounds');
        this.muzzleWorld(_p);
        if (suppressed) this.fx.noFlash();
        else this.fx.muzzleFlash(_p, g.cls === 'launcher' ? 2.2 : g.pellets ? 1.4 : 1);
        if (e.burst >= 3 || g.pellets || g.cls === 'launcher') this.smokeT = g.cls === 'launcher' ? 1.6 : 0.9;
        const eye = this.w.camera.getWorldPosition(_o);
        const nx = eye.x;
        const ny = eye.y;
        const nz = eye.z;
        const r = noiseOf(id, mods);
        this.lastNoise = r;
        this.onShot?.(r);
        if (g.cls === 'launcher') this.launch();
        else {
          const nPellets = g.pellets ?? 1;
          this.shotTotalPellets = nPellets;
          this.shotHitSounds = 0;
          this.shotSurfaceLookups = 0;
          this.shotLastSurface = null;
          this.shotHitMarked = false;
          for (let i = 0; i < nPellets; i++) this.bullet(id, mods);
        }
        // Alert AI after resolving pellets so unalerted Stealth First Strike shots trigger ×1.75 crit damage first.
        this.w.noise(nx, ny, nz, r);
        p.controller.addNoise(Math.min(1, r / 60));
        if (g.cls !== 'launcher' && g.action !== 'pump' && g.action !== 'bolt') {
          this.pendingCasings.push({ t: 0.3 + Math.random() * 0.2, shell: false });
        }
        if (gs.inst.mag === 0 && !gs.inst.chamber && g.cls === 'pistol') mech('slideLock');
        break;
      }
      case 'casing':
        this.ejectCase(id);
        break;
      case 'dry':
        mech('dry');
        this.w.toast(tr('Пусто — перезарядка (R)', 'Empty — reload (R)'), 900);
        break;
      case 'jam':
        mech('jam');
        this.w.toast(tr('Заклинило — R', 'Jammed — R'), 1200);
        break;
      case 'magOut':
        if (id !== 'rifle_ak' && id !== 'rifle_m4a1') mech('magOut');
        if (e.drop) this.dropMag(id);
        break;
      case 'magIn':
        if (id !== 'rifle_ak' && id !== 'rifle_m4a1') mech('magIn');
        break;
      case 'rack':
        // Rifles play trimmed mag-out + mag-in only on reload (no trailing bolt-rack); unjam still racks.
        if ((id === 'rifle_ak' || id === 'rifle_m4a1') && gs.action === 'reloadEmpty') break;
        mech(id === 'rifle_m4a1' ? 'boltCatch' : 'rack');
        break;
      case 'cycle':
        mech(g.action === 'pump' ? 'pump' : 'bolt');
        this.pendingCasings.push({ t: 0.3 + Math.random() * 0.2, shell: !!g.pellets });
        break;
      case 'shellIn':
        mech('shell');
        break;
      case 'rocketIn':
        mech('rocket');
        break;
      case 'mode':
        mech('mode');
        break;
      case 'unjammed':
        this.ejectCase(id);
        this.pendingCasings.push({ t: 0.3 + Math.random() * 0.2, shell: !!g.pellets });
        break;
      case 'bash':
        this.bash(id);
        break;
      case 'start':
        if (e.action === 'holster') mech('holster');
        else if (e.action === 'reload' || e.action === 'reloadEmpty') {
          if (id === 'rifle_ak' || id === 'rifle_m4a1') mech('reloadRifle');
          else if (g.cls === 'pistol') sfx.ads(true);
        }
        break;
    }
  }

  /** The gun's muzzle in the world. */
  private muzzleWorld(out: Vector3): Vector3 {
    const gm = this.w.player.viewmodel.gunModel;
    if (!gm) return this.w.camera.getWorldPosition(out);
    gm.root.updateWorldMatrix(true, false);
    gm.muzzle(out).applyMatrix4(gm.root.matrixWorld);
    return this.armsToWorld(out);
  }

  /** A point in the arms' space (the viewmodel camera = the eye) to the world. */
  private armsToWorld(v: Vector3): Vector3 {
    this.w.camera.updateWorldMatrix(true, false);
    return v.applyMatrix4(this.w.camera.matrixWorld);
  }

  private ejectCase(id: GunId): void {
    const g = GUNS[id];
    if (g.cls === 'launcher') return;
    const gm = this.w.player.viewmodel.gunModel;
    if (!gm) return;
    gm.root.updateWorldMatrix(true, false);
    _p.set(...gm.sockets.eject).applyMatrix4(gm.root.matrixWorld);
    this.armsToWorld(_p);
    this.w.camera.getWorldQuaternion(_q);
    _r.set(1, 0, 0).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    this.fx.eject(_p, _r, _u, !!g.pellets);
  }

  private dropMag(_id: GunId): void {
    const vm = this.w.player.viewmodel;
    const gm = vm.gunModel;
    if (!gm) return;
    gm.parts.mag.updateWorldMatrix(true, false);
    gm.parts.mag.getWorldPosition(_p);
    this.armsToWorld(_p);
    this.w.camera.getWorldQuaternion(_q);
    this.fx.dropMag(_p, _q, _p2.set(0, -0.5, 0));
  }

  /** One bullet (a pellet): multi-hop ray supporting door material penetration/ricochet/glass shatter and Stealth First Strike. */
  private bullet(id: GunId, mods: readonly string[]): void {
    const g = GUNS[id];
    const o = this.w.camera.getWorldPosition(_o);
    const d = this.w.camera.getWorldDirection(_d);
    // A random direction in the cone (uniform over the disc).
    const half = (this.spread(id) * Math.PI) / 180;
    this.w.camera.getWorldQuaternion(_q);
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * Math.tan(half);
    d.addScaledVector(_r.set(1, 0, 0).applyQuaternion(_q), Math.cos(a) * rr).addScaledVector(_u.set(0, 1, 0).applyQuaternion(_q), Math.sin(a) * rr).normalize();
    _origO.copy(o);
    _rayO.copy(o);
    let remain = g.range * 4;
    let traveled = 0;
    let dmgMul = 1;
    const isMulti = this.shotTotalPellets > 1;
    for (let hop = 0; hop < 3 && remain > 0.05; hop++) {
      const det = this.w.rayHitDetail ? this.w.rayHitDetail(_rayO, d, remain) : null;
      const wall = det ? det.t : this.w.rayHit(_rayO, d, remain);
      const lim = wall >= 0 ? wall : remain;
      const z = this.w.zombies.hitTest(_rayO, d, lim, 0.02);
      const bHit = this.w.bandits?.hitTest(_rayO, d, z ? z.dist : lim, 0.03);
      if (bHit) {
        this.hitBandit(id, mods as never, bHit, _origO, dmgMul, traveled + bHit.dist);
        return;
      }
      if (z) {
        this.hitZombie(id, mods as never, z, _origO, dmgMul, traveled + z.dist);
        return;
      }
      if (wall < 0) return;
      if (det && det.door && this.w.doorBullet) {
        const [lo, hi] = damageOf(id, mods as never);
        const nom = ((lo + hi) * 0.5) * falloff(id, traveled + wall) * dmgMul;
        const dr = this.w.doorBullet(det.owner, nom);
        if (dr) {
          _p.copy(_rayO).addScaledVector(d, wall - 0.02);
          if (dr.kind === 'lab') {
            this.w.particles.sparks(_p.x, _p.y, _p.z, 6);
            if (!isMulti || this.shotHitSounds < 2) {
              sfx.bulletHit('metal', _p);
              this.shotHitSounds++;
            }
            return;
          }
          if (dr.kind === 'glass') {
            if (dr.glassShattered) {
              if (!isMulti || this.shotHitSounds < 2) {
                this.w.onBreakGlass?.(_p, d);
                this.shotHitSounds++;
              }
            }
            const step = wall + 0.08;
            _rayO.addScaledVector(d, step);
            traveled += step;
            remain -= step;
            dmgMul *= dr.mul;
            continue;
          }
          // Wood or barricaded plank door: splinter, damage, attenuate, and continue ray.
          this.w.particles.burst(_p, 5, 0.55);
          if (!isMulti || this.shotHitSounds < 2) {
            sfx.bulletHit('wood', _p);
            this.shotHitSounds++;
          }
          const step = wall + 0.30;
          _rayO.addScaledVector(d, step);
          traveled += step;
          remain -= step;
          dmgMul *= dr.mul;
          continue;
        }
      }
      this.hitWorld(_rayO, d, wall);
      return;
    }
  }

  private hitBandit(id: GunId, mods: readonly never[], res: BanditHit, o: Vector3, dmgMul = 1, distOverride?: number): void {
    const [lo, hi] = damageOf(id, mods);
    const stealthCrit = res.bot.state === 'patrol' && res.bot.investigateT <= 0 ? 1.75 : 1;
    const dmg = (lo + Math.random() * (hi - lo)) * falloff(id, distOverride ?? res.dist) * (res.head ? 2 : 1) * dmgMul * stealthCrit;
    const killed = this.w.bandits!.hit(res.bot, dmg, o.x, o.z, res.head, res.zone);
    const armored = applyZonalArmor(1, res.zone, res.bot.worn, res.bot.wornDirt).armored;
    const isMulti = this.shotTotalPellets > 1;
    if (!isMulti || this.shotHitSounds < 2) {
      this.w.particles.burst(res.point, res.head ? 8 : 6, 0.7);
      this.cloth(res.point);
      sfx.bulletHit(armored ? 'metal' : 'flesh', res.point);
      if (armored) sfx.armorHit();
      this.shotHitSounds++;
    }
    this.hitMark = res.head || stealthCrit > 1 ? 'head' : 'body';
    this.hitMarkT = 0;
    if (!isMulti || !this.shotHitMarked) {
      sfx.hitMarker(res.head || stealthCrit > 1);
      this.shotHitMarked = true;
    }
    this.w.onHit?.(killed, res.head);
  }

  private hitZombie(id: GunId, mods: readonly never[], res: HitResult, o: Vector3, dmgMul = 1, distOverride?: number): void {
    const [lo, hi] = damageOf(id, mods);
    const dmg = (lo + Math.random() * (hi - lo)) * falloff(id, distOverride ?? res.dist) * (res.head ? 2 : 1) * dmgMul;
    const killed = this.w.zombies.hit(res.zombie, dmg, o.x, o.z, res.head, res.point, GUNS[id].pellets ? 1.2 : 1.4);
    const isMulti = this.shotTotalPellets > 1;
    if (!isMulti || this.shotHitSounds < 2) {
      // No blood: dust off the clothes, a scrap of cloth.
      this.w.particles.burst(res.point, res.head ? 8 : 6, 0.7);
      this.cloth(res.point);
      sfx.bulletHit('flesh', res.point);
      this.shotHitSounds++;
    }
    this.hitMark = res.head ? 'head' : 'body';
    this.hitMarkT = 0;
    if (!isMulti || !this.shotHitMarked) {
      sfx.hitMarker(res.head);
      this.shotHitMarked = true;
    }
    this.w.onHit?.(killed, res.head);
  }

  /** Scraps of cloth torn off by a hit: dark specks falling. */
  private cloth(at: Vector3): void {
    for (let i = 0; i < 3; i++) {
      this.w.particles.drop(at.x, at.y, at.z, this.w.groundY(at.x, at.y, at.z), (Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5, 0.02);
    }
  }

  /** A bullet on the world: by what it is made of — dust, sparks and a ricochet, splinters, glass, a car's tin. */
  private hitWorld(o: Vector3, d: Vector3, dist: number): void {
    const isMulti = this.shotTotalPellets > 1;
    let s = this.shotLastSurface;
    if (!isMulti || this.shotSurfaceLookups < 2) {
      s = this.w.surface(o, d, dist);
      this.shotSurfaceLookups++;
      this.shotLastSurface = s;
    }
    const kind: BulletHit = (s && BULLET[s]) ?? 'concrete';
    const at = _p.copy(o).addScaledVector(d, dist - 0.03);
    if (kind === 'glass' && this.w.onBreakGlass) {
      if (!isMulti || this.shotHitSounds < 2) {
        this.w.onBreakGlass(at, d);
        this.shotHitSounds++;
      }
    } else if (!isMulti || this.shotHitSounds < 2) {
      sfx.bulletHit(kind, at);
      this.shotHitSounds++;
    }
    const pt = this.w.particles;
    const nScale = isMulti && this.shotHitSounds > 1 ? 0.5 : 1;
    if (kind === 'metal' || kind === 'car') pt.sparks(at.x, at.y, at.z, Math.max(2, Math.round(6 * nScale)));
    else pt.burst(at, Math.max(2, Math.round((kind === 'glass' ? 3 : 7) * nScale)), kind === 'soft' ? 0.4 : 0.6);
    if (kind === 'car' && (!isMulti || this.shotSurfaceLookups <= 2)) this.w.carHit(at.x, at.y, at.z);
  }

  /** The butt strike: a short push, low damage, knocks back. */
  private bash(_id: GunId): void {
    const o = this.w.camera.getWorldPosition(_o);
    const d = this.w.camera.getWorldDirection(_d);
    const bHit = this.w.bandits?.hitTest(o, d, BASH.reach);
    const res = this.w.zombies.hitTest(o, d, BASH.reach);
    if (bHit && (!res || bHit.dist < res.dist)) {
      const wall = this.w.rayHit(o, d, bHit.dist);
      if (wall >= 0 && wall < bHit.dist - 0.1) return;
      const dmg = BASH.damage[0] + Math.random() * (BASH.damage[1] - BASH.damage[0]);
      const killed = this.w.bandits!.hit(bHit.bot, dmg, o.x, o.z, bHit.head, bHit.zone);
      sfx.strike('blunt', bHit.point, bHit.head, killed);
      this.w.particles.burst(bHit.point, 6, 0.6);
      this.w.player.viewmodel.recoil();
      this.w.onHit?.(killed, bHit.head);
      return;
    }
    if (!res) {
      sfx.swing('heavy', 0.2, o);
      return;
    }
    const wall = this.w.rayHit(o, d, res.dist);
    if (wall >= 0 && wall < res.dist - 0.1) return;
    const dmg = BASH.damage[0] + Math.random() * (BASH.damage[1] - BASH.damage[0]);
    const killed = this.w.zombies.hit(res.zombie, dmg, o.x, o.z, res.head, res.point);
    // Pushed further back than a blow does.
    res.zombie.pos.addScaledVector(_p2.set(d.x, 0, d.z).normalize(), 0.45);
    sfx.strike('blunt', res.point, res.head, killed);
    this.w.particles.burst(res.point, 6, 0.6);
    this.w.player.viewmodel.recoil();
    this.w.onHit?.(killed, res.head);
  }

  /** The RPG's rocket leaves the tube. */
  private launch(): void {
    const o = this.muzzleWorld(new Vector3());
    const d = this.w.camera.getWorldDirection(new Vector3());
    this.rockets.push({ pos: o, vel: d.multiplyScalar(ROCKET.speed), t: 0 });
  }

  private updateRockets(dt: number): void {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.t += dt;
      r.vel.y -= ROCKET.gravity * dt;
      const step = r.vel.length() * dt;
      _d.copy(r.vel).normalize();
      const wall = this.w.rayHit(r.pos, _d, step);
      const z = this.w.zombies.hitTest(r.pos, _d, wall >= 0 ? wall : step, 0.05);
      const bHit = this.w.bandits?.hitTest(r.pos, _d, wall >= 0 ? wall : step, 0.05);
      if (Math.random() < 0.8) this.w.particles.steam(r.pos.x, r.pos.y, r.pos.z, 0.5);
      if (z || bHit || wall >= 0 || r.t > ROCKET.life || r.pos.y < this.w.groundY(r.pos.x, r.pos.y, r.pos.z)) {
        const dist = z ? z.dist : bHit ? bHit.dist : wall >= 0 ? wall : 0;
        r.pos.addScaledVector(_d, Math.max(0, dist - 0.1));
        this.explode(r.pos);
        this.rockets.splice(i, 1);
        continue;
      }
      r.pos.addScaledVector(r.vel, dt);
    }
  }

  /** The blast: damage falling off over the radius, radial shrapnel rays blocked by walls, doors shattered, ragdolls thrown. */
  explode(at: Vector3, spec?: BlastSpec): void {
    const def = GUNS.launcher_rpg.blast!;
    const b: Required<BlastSpec> = {
      radius: spec?.radius ?? def.radius,
      damage: spec?.damage ?? def.damage,
      impulse: spec?.impulse ?? def.impulse,
      noise: spec?.noise ?? GUNS.launcher_rpg.noise,
      selfDamage: spec?.selfDamage ?? 90,
      shrapnel: spec?.shrapnel ?? 24,
    };
    sfx.explosion(at);
    this.fx.muzzleFlash(at, 4);
    const pt = this.w.particles;
    pt.burst(at, 30, 3);
    pt.sparks(at.x, at.y, at.z, 24);
    for (let i = 0; i < 8; i++) pt.smoke(at.x, at.y, at.z);
    this.w.noise(at.x, at.y, at.z, b.noise);
    const doorRes = this.w.doorsBlast?.(at, b.radius, b.damage * 0.65);
    if (doorRes && this.w.onBreakGlass) {
      for (const gAt of doorRes.brokenGlassAt) {
        this.w.onBreakGlass(gAt, _shpD.subVectors(gAt, at).normalize());
      }
    }
    // Radial shrapnel rays break nearby window glass and scatter sparks along open lines of sight.
    for (let i = 0; i < b.shrapnel; i++) {
      const ang = (i / b.shrapnel) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const elev = (Math.random() - 0.25) * 0.35;
      _shpD.set(Math.cos(ang), elev, Math.sin(ang)).normalize();
      const det = this.w.rayHitDetail ? this.w.rayHitDetail(at, _shpD, b.radius) : null;
      const hitDist = det ? det.t : this.w.rayHit(at, _shpD, b.radius);
      if (hitDist >= 0) {
        _p.copy(at).addScaledVector(_shpD, Math.max(0.05, hitDist - 0.03));
        if (det?.glass && this.w.onBreakGlass) this.w.onBreakGlass(_p, _shpD);
        else pt.sparks(_p.x, _p.y, _p.z, 2);
      }
    }
    for (const z of this.w.zombies.list) {
      if (z.state === 'dead') continue;
      const d = Math.hypot(z.pos.x - at.x, z.pos.y + 1 - at.y, z.pos.z - at.z);
      if (d > b.radius) continue;
      // Walls shelter: nothing through them.
      _p.set(z.pos.x, z.pos.y + 1, z.pos.z);
      _d.subVectors(_p, at);
      const len = _d.length();
      _d.divideScalar(len || 1);
      const wall = this.w.rayHit(at, _d, len);
      if (wall >= 0 && wall < len - 0.3) continue;
      const k = 1 - d / b.radius;
      this.w.zombies.hit(z, b.damage * k * k + 20 * k, at.x, at.z, false, _p.clone(), 1 + b.impulse * k * 0.25);
    }
    this.w.bandits?.blastDamage?.(at, b.radius, b.damage);
    const eye = this.w.camera.getWorldPosition(_o);
    const pd = eye.distanceTo(at);
    if (pd < b.radius) {
      _d.subVectors(eye, at).normalize();
      const wall = this.w.rayHit(at, _d, pd);
      if (wall < 0 || wall > pd - 0.3) this.w.hurtSelf(b.selfDamage * (1 - pd / b.radius) ** 1.5);
    }
    this.w.player.shake(Math.max(0.3, 2.2 * (1 - pd / 30)));
    this.w.igniteCars(at.x, at.y, at.z, b.radius * 0.8);
  }

  dispose(): void {
    this.fx.dispose();
  }
}
