/**
 * Hostile living survivor bots (bandits): armed with firearms or melee weapons and carrying
 * player-like supplies (food, water, bandages, ammo). Light-to-medium aim difficulty with
 * reaction delay, fair spread, burst pauses, and reload windows.
 */

import {
  BoxGeometry,
  type Group,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  Vector3,
} from 'three';
import { sfx, type EchoPlace, type GunSound } from '../audio/Sound';
import { type ItemId, ITEMS } from '../data/items';
import { BASE_LOOK, type Appearance, type Sex } from '../player/appearance';
import { CharacterFigure } from '../player/CharacterFigure';
import { GUNS, type GunId } from '../weapons/guns';
import type { Worn } from './Inventory';
import type { ZombieSim } from './zombies';

export interface BanditLootItem {
  id: ItemId;
  count: number;
  condition?: number;
}

export const BANDIT_BODY_ID = 700000;

export interface BanditWorld {
  scene: Scene;
  groundY(x: number, z: number): number;
  resolveCircle(pos: Vector3, r: number): void;
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number;
  zombies: ZombieSim;
  noise(x: number, y: number, z: number, r: number): void;
  hurtPlayer(hp: number, fromX: number, fromZ: number, cause: string): void;
  placeAt(x: number, z: number): EchoPlace;
  onDropLoot?(bot: Bandit): void;
  onRemoveCorpse?(bot: Bandit): void;
}

export interface BanditHit {
  bot: Bandit;
  dist: number;
  head: boolean;
  point: Vector3;
}

type BanditGunId = Exclude<GunId, 'launcher_rpg'>;
type BanditMeleeId = 'bat' | 'crowbar' | 'axe';

const BANDIT_GUNS: readonly BanditGunId[] = [
  'pistol_g17',
  'pistol_m1911',
  'shotgun_pump',
  'rifle_m4a1',
  'rifle_ak',
  'rifle_hunting',
];
const BANDIT_MELEE: readonly BanditMeleeId[] = ['bat', 'crowbar', 'axe'];

const GUN_SOUND: Record<BanditGunId, GunSound> = {
  pistol_g17: 'pistol',
  pistol_m1911: 'pistol45',
  shotgun_pump: 'shotgun',
  rifle_m4a1: 'rifle',
  rifle_ak: 'ak',
  rifle_hunting: 'hunting',
};

const BANDIT_OUTFITS: readonly Worn[] = [
  { outfit: null, head: null, face: null, mask: null, torso: 'hoodie', vest: null, hands: null, legs: 'jeans', feet: 'boots', back: null, bag: null },
  { outfit: null, head: null, face: null, mask: 'balaclava', torso: 'leatherJacket', vest: null, hands: null, legs: 'jeans', feet: 'boots', back: null, bag: null },
  { outfit: null, head: null, face: null, mask: 'shemagh', torso: 'workJacket', vest: null, hands: null, legs: 'cargoPants', feet: 'sneakers', back: null, bag: null },
];

const MAX_ACTIVE = 4;
const SPAWN_MIN = 26;
const SPAWN_MAX = 54;
const DESPAWN_DIST = 88;
const CORPSE_LIFE = 95;

const _v1 = new Vector3();
const _v2 = new Vector3();
const _to = new Vector3();

interface Tracer {
  mesh: Mesh;
  life: number;
}

export interface Bandit {
  id: number;
  pos: Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  state: 'patrol' | 'combat' | 'dead';
  weapon: ItemId;
  isGun: boolean;
  ammoInMag: number;
  magCap: number;
  fireCd: number;
  burstLeft: number;
  burstPause: number;
  reloadT: number;
  reactT: number;
  meleeCd: number;
  animT: number;
  patrolYaw: number;
  patrolT: number;
  investigateX: number;
  investigateZ: number;
  investigateT: number;
  deadT: number;
  loot: BanditLootItem[];
  figure: CharacterFigure;
  lootDropped: boolean;
}

function randomLook(): Appearance {
  const sex: Sex = Math.random() < 0.78 ? 'male' : 'female';
  const base = BASE_LOOK[sex];
  return {
    ...base,
    name: sex === 'male' ? 'Бандит' : 'Бандитка',
    height: base.height + Math.round((Math.random() - 0.5) * 8),
  };
}

function makeStack(id: ItemId, count = 1): BanditLootItem {
  const def = ITEMS[id];
  return {
    id,
    count,
    condition: def.durability ? 0.5 + Math.random() * 0.4 : undefined,
  };
}

function createBanditLoot(weapon: ItemId, isGun: boolean): BanditLootItem[] {
  const loot: BanditLootItem[] = [makeStack(weapon, 1)];
  if (isGun) {
    const g = GUNS[weapon as BanditGunId];
    loot.push(makeStack(g.caliber, 4 + Math.floor(Math.random() * 10)));
  }
  if (Math.random() < 0.8) loot.push(makeStack('bandage', 1 + (Math.random() < 0.35 ? 1 : 0)));
  if (Math.random() < 0.65) loot.push(makeStack('beans', 1));
  if (Math.random() < 0.65) loot.push(makeStack('water', 1));
  return loot;
}

export class Bandits {
  readonly list: Bandit[] = [];
  private nextId = 1;
  private spawnCd = 4;
  private maxActive = MAX_ACTIVE;
  private readonly tracers: Tracer[] = [];
  private readonly tracerGeo = new BoxGeometry(0.025, 0.025, 1);
  private readonly tracerMat = new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.78 });

  constructor(private readonly w: BanditWorld) {}

  setMaxActive(n: number): void {
    this.maxActive = Math.max(1, n);
  }

  update(dt: number, px: number, py: number, pz: number, playerDead: boolean, inCar: boolean): void {
    this.updateTracers(dt);

    // Spawn bandits up to maxActive around the player.
    this.spawnCd -= dt;
    let aliveCount = 0;
    for (const b of this.list) if (b.state !== 'dead') aliveCount++;
    if (this.spawnCd <= 0 && aliveCount < this.maxActive) {
      this.trySpawnAround(px, pz);
      this.spawnCd = (this.maxActive <= 2 ? 9 : 5) + Math.random() * 5;
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const dx = px - b.pos.x;
      const dz = pz - b.pos.z;
      const distSq = dx * dx + dz * dz;

      if (b.state === 'dead') {
        b.deadT += dt;
        if (b.deadT > CORPSE_LIFE || distSq > DESPAWN_DIST * DESPAWN_DIST) {
          this.removeAt(i);
        }
        continue;
      }

      if (distSq > DESPAWN_DIST * DESPAWN_DIST) {
        this.removeAt(i);
        continue;
      }

      const dist = Math.sqrt(distSq);
      b.fireCd = Math.max(0, b.fireCd - dt);
      b.meleeCd = Math.max(0, b.meleeCd - dt);
      b.burstPause = Math.max(0, b.burstPause - dt);
      if (b.reloadT > 0) {
        b.reloadT -= dt;
        if (b.reloadT <= 0) {
          b.ammoInMag = b.magCap;
          b.burstLeft = b.isGun ? 2 + Math.floor(Math.random() * 3) : 1;
        }
      }

      // Check self-defense against a close zombie first.
      const nearZombie = this.findNearestZombie(b.pos.x, b.pos.z, 4.5);

      const canSeePlayer = !playerDead && dist < 38 && this.hasLineOfSight(b.pos.x, b.pos.y + 1.5, b.pos.z, px, py + 1.35, pz);
      if (canSeePlayer && b.state !== 'combat') {
        b.state = 'combat';
        b.reactT = 0.55 + Math.random() * 0.35; // Fair reaction delay (light-medium difficulty)
      }

      let moving = false;
      let running = false;

      if (nearZombie) {
        const zdx = nearZombie.pos.x - b.pos.x;
        const zdz = nearZombie.pos.z - b.pos.z;
        const zd = Math.hypot(zdx, zdz) || 1;
        b.yaw = Math.atan2(zdx, zdz);
        if (b.isGun && zd > 1.8 && b.fireCd <= 0 && b.reloadT <= 0) {
          this.shootAt(b, nearZombie.pos.x, nearZombie.pos.y + 1.25, nearZombie.pos.z, false);
        } else if (zd <= 1.9 && b.meleeCd <= 0) {
          b.meleeCd = 0.95;
          this.w.zombies.hit(nearZombie, 24, b.pos.x, b.pos.z, false, _v1.set(nearZombie.pos.x, nearZombie.pos.y + 1.1, nearZombie.pos.z));
          sfx.swing('heavy', 0.25, b.pos);
        } else if (zd > 1.6) {
          this.stepBandit(b, zdx / zd, zdz / zd, 3.2 * dt);
          moving = true;
        }
      } else if (b.state === 'combat' && !playerDead) {
        b.yaw = Math.atan2(dx, dz);
        b.investigateX = px;
        b.investigateZ = pz;
        b.investigateT = 8;

        if (b.reactT > 0) {
          b.reactT -= dt;
        } else if (b.isGun) {
          const desiredMin = inCar ? 11 : 10;
          const desiredMax = 24;
          if (!canSeePlayer || dist > desiredMax) {
            this.stepBandit(b, dx / (dist || 1), dz / (dist || 1), 3.6 * dt);
            moving = true;
            running = dist > 20;
          } else if (dist < desiredMin) {
            this.stepBandit(b, -dx / (dist || 1), -dz / (dist || 1), 2.1 * dt);
            moving = true;
          } else {
            // Light strafing while shooting
            const strafe = Math.sin(b.id * 1.7 + b.animT * 0.9);
            this.stepBandit(b, (-dz / (dist || 1)) * strafe, (dx / (dist || 1)) * strafe, 1.4 * dt);
            moving = true;
          }

          if (canSeePlayer && b.fireCd <= 0 && b.reloadT <= 0 && b.burstPause <= 0 && dist < 36) {
            this.shootAt(b, px, py + (inCar ? 1.05 : 1.38), pz, true);
          }
        } else {
          // Melee bandit closes in to strike
          if (dist > 1.65) {
            this.stepBandit(b, dx / (dist || 1), dz / (dist || 1), 4.35 * dt);
            moving = true;
            running = true;
          } else if (b.meleeCd <= 0) {
            b.meleeCd = 1.05 + Math.random() * 0.25;
            sfx.swing('heavy', 0.3, b.pos);
            if (!inCar) {
              this.w.hurtPlayer(12 + Math.random() * 7, b.pos.x, b.pos.z, 'Нападение бандита');
            }
          }
        }
        if (!canSeePlayer && b.investigateT <= 0) b.state = 'patrol';
      } else {
        // Patrol or investigate last noise
        if (b.investigateT > 0) {
          b.investigateT -= dt;
          const idx = b.investigateX - b.pos.x;
          const idz = b.investigateZ - b.pos.z;
          const idist = Math.hypot(idx, idz);
          if (idist > 2.2) {
            b.yaw = Math.atan2(idx, idz);
            this.stepBandit(b, idx / idist, idz / idist, 2.3 * dt);
            moving = true;
          }
        } else {
          b.patrolT -= dt;
          if (b.patrolT <= 0) {
            b.patrolYaw += (Math.random() - 0.5) * 2.4;
            b.patrolT = 2.5 + Math.random() * 4;
          }
          b.yaw = b.patrolYaw;
          this.stepBandit(b, Math.sin(b.yaw), Math.cos(b.yaw), 1.55 * dt);
          moving = true;
        }
      }

      if (b.investigateT > 0 && !canSeePlayer) b.investigateT -= dt;

      b.animT += dt * (running ? 1.35 : 1);
      b.figure.setPose(running ? 'running' : moving ? 'walking' : 'idle', b.animT);
      const root = b.figure.root;
      root.position.copy(b.pos);
      root.rotation.set(0, b.yaw, 0);
    }
  }

  /** Attract nearby bandits to gunfire or explosions. */
  onNoise(x: number, z: number, r: number): void {
    const r2 = r * r;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      const dx = x - b.pos.x;
      const dz = z - b.pos.z;
      if (dx * dx + dz * dz <= r2) {
        b.investigateX = x;
        b.investigateZ = z;
        b.investigateT = 9;
      }
    }
  }

  /** Ray test against living bandits (player bullets, melee, bash, rockets). */
  hitTest(o: Vector3, d: Vector3, maxDist: number, slack = 0.04): BanditHit | null {
    let best: BanditHit | null = null;
    let bestT = maxDist;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      // Capsule-like check from feet (y) to head top (y + 1.78)
      const cx = b.pos.x;
      const cz = b.pos.z;
      const ox = o.x - cx;
      const oz = o.z - cz;
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-6) continue;
      const t = -(ox * d.x + oz * d.z) / a;
      if (t < 0 || t > bestT) continue;
      const hitX = o.x + d.x * t;
      const hitY = o.y + d.y * t;
      const hitZ = o.z + d.z * t;
      if (hitY < b.pos.y || hitY > b.pos.y + 1.8) continue;
      const rad = 0.34 + slack;
      if ((hitX - cx) ** 2 + (hitZ - cz) ** 2 > rad * rad) continue;
      bestT = t;
      best = {
        bot: b,
        dist: t,
        head: hitY >= b.pos.y + 1.44,
        point: new Vector3(hitX, hitY, hitZ),
      };
    }
    return best;
  }

  /** Apply damage to a bandit. Returns true if killed. */
  hit(b: Bandit, dmg: number, fromX: number, fromZ: number, head: boolean): boolean {
    if (b.state === 'dead') return false;
    b.hp -= dmg;
    b.state = 'combat';
    b.investigateX = fromX;
    b.investigateZ = fromZ;
    b.investigateT = 10;
    if (b.hp <= 0) {
      b.hp = 0;
      b.state = 'dead';
      b.deadT = 0;
      b.figure.setPose('idle', 0);
      const root = b.figure.root;
      root.rotation.set(-Math.PI / 2, b.yaw, 0);
      root.position.set(b.pos.x, b.pos.y + 0.14, b.pos.z);
      if (!b.lootDropped) {
        b.lootDropped = true;
        this.w.onDropLoot?.(b);
      }
      return true;
    }
    if (head) b.reactT = Math.max(b.reactT, 0.25);
    return false;
  }

  /** Explosion damage from RPG rockets. */
  blastDamage(at: Vector3, radius: number, maxDmg: number): void {
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      const d = Math.hypot(b.pos.x - at.x, b.pos.y + 1 - at.y, b.pos.z - at.z);
      if (d > radius) continue;
      _v1.set(b.pos.x, b.pos.y + 1, b.pos.z).sub(at);
      const len = _v1.length() || 1;
      _v1.divideScalar(len);
      const wall = this.w.rayHit(at.x, at.y, at.z, _v1.x, _v1.y, _v1.z, len);
      if (wall >= 0 && wall < len - 0.3) continue;
      const k = 1 - d / radius;
      this.hit(b, maxDmg * k * k + 25 * k, at.x, at.z, false);
    }
  }

  /** Rammed by a driving car. */
  ramByCar(cx: number, cz: number, carVx: number, carVz: number, radius = 1.45): void {
    const speed = Math.hypot(carVx, carVz);
    if (speed < 2.4) return;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      const dx = b.pos.x - cx;
      const dz = b.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const nx = d > 0.01 ? dx / d : carVx / speed;
      const nz = d > 0.01 ? dz / d : carVz / speed;
      this.stepBandit(b, nx, nz, 1.3);
      const dmg = speed * 12;
      sfx.strike('blunt', b.pos, false, b.hp <= dmg);
      this.hit(b, dmg, cx, cz, false);
    }
  }

  dispose(): void {
    for (let i = this.list.length - 1; i >= 0; i--) this.removeAt(i);
    for (const t of this.tracers) this.w.scene.remove(t.mesh);
    this.tracers.length = 0;
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
  }

  private trySpawnAround(px: number, pz: number): void {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const sx = px + Math.cos(ang) * dist;
      const sz = pz + Math.sin(ang) * dist;
      const sy = this.w.groundY(sx, sz);
      if (sy < -5) continue;
      _v1.set(sx, sy, sz);
      this.w.resolveCircle(_v1, 0.45);
      const rx = _v1.x;
      const rz = _v1.z;
      if (Math.hypot(rx - px, rz - pz) < SPAWN_MIN * 0.85) continue;

      const isGun = Math.random() < 0.7;
      const weapon: ItemId = isGun
        ? BANDIT_GUNS[Math.floor(Math.random() * BANDIT_GUNS.length)]
        : BANDIT_MELEE[Math.floor(Math.random() * BANDIT_MELEE.length)];
      const magCap = isGun ? GUNS[weapon as BanditGunId].capacity : 1;

      const figure = new CharacterFigure();
      figure.setAppearance(randomLook(), null);
      const outfit = BANDIT_OUTFITS[Math.floor(Math.random() * BANDIT_OUTFITS.length)];
      figure.setOutfit(outfit, weapon);
      figure.setPose('idle', 0);
      figure.root.position.set(rx, sy, rz);
      this.w.scene.add(figure.root);

      this.list.push({
        id: this.nextId++,
        pos: new Vector3(rx, sy, rz),
        yaw: Math.random() * Math.PI * 2,
        hp: 95,
        maxHp: 95,
        state: 'patrol',
        weapon,
        isGun,
        ammoInMag: magCap,
        magCap,
        fireCd: 0.4,
        burstLeft: isGun ? 2 + Math.floor(Math.random() * 3) : 1,
        burstPause: 0,
        reloadT: 0,
        reactT: 0.65,
        meleeCd: 0,
        animT: Math.random() * 6,
        patrolYaw: Math.random() * Math.PI * 2,
        patrolT: 2 + Math.random() * 3,
        investigateX: rx,
        investigateZ: rz,
        investigateT: 0,
        deadT: 0,
        loot: createBanditLoot(weapon, isGun),
        figure,
        lootDropped: false,
      });
      return;
    }
  }

  private removeAt(i: number): void {
    const b = this.list[i];
    if (b.state === 'dead') this.w.onRemoveCorpse?.(b);
    this.w.scene.remove(b.figure.root);
    b.figure.dispose();
    this.list.splice(i, 1);
  }

  private stepBandit(b: Bandit, nx: number, nz: number, step: number): void {
    b.pos.x += nx * step;
    b.pos.z += nz * step;
    this.w.resolveCircle(b.pos, 0.34);
    b.pos.y = this.w.groundY(b.pos.x, b.pos.z);
  }

  private hasLineOfSight(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
    _v1.set(tx - ox, ty - oy, tz - oz);
    const len = _v1.length();
    if (len < 0.1) return true;
    _v1.divideScalar(len);
    const hit = this.w.rayHit(ox, oy, oz, _v1.x, _v1.y, _v1.z, len);
    return hit < 0 || hit > len - 0.35;
  }

  private findNearestZombie(x: number, z: number, radius: number) {
    let best = null;
    let bestD2 = radius * radius;
    for (const zmb of this.w.zombies.list) {
      if (zmb.state === 'dead') continue;
      const d2 = (zmb.pos.x - x) ** 2 + (zmb.pos.z - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = zmb;
      }
    }
    return best;
  }

  private shootAt(b: Bandit, tx: number, ty: number, tz: number, targetIsPlayer: boolean): void {
    const gId = b.weapon as BanditGunId;
    const g = GUNS[gId];
    const ox = b.pos.x + Math.sin(b.yaw) * 0.35;
    const oy = b.pos.y + 1.42;
    const oz = b.pos.z + Math.cos(b.yaw) * 0.35;

    _to.set(tx - ox, ty - oy, tz - oz);
    const targetDist = _to.length() || 1;
    _to.divideScalar(targetDist);

    // Light-to-medium spread (0.11..0.17 rad ~ 6.5-10 deg)
    const spread = gId === 'shotgun_pump' ? 0.16 : 0.125;
    _to.x += (Math.random() - 0.5) * spread;
    _to.y += (Math.random() - 0.5) * spread * 0.65;
    _to.z += (Math.random() - 0.5) * spread;
    _to.normalize();

    const maxRange = 46;
    const wall = this.w.rayHit(ox, oy, oz, _to.x, _to.y, _to.z, maxRange);
    const maxTrace = wall >= 0 ? wall : maxRange;

    let hitDist = maxTrace;
    if (targetIsPlayer) {
      // Ray-sphere check against player's torso/head
      const px = tx;
      const py = ty - 0.15;
      const pz = tz;
      const ex = px - ox;
      const ey = py - oy;
      const ez = pz - oz;
      const proj = ex * _to.x + ey * _to.y + ez * _to.z;
      if (proj > 0 && proj < hitDist) {
        const d2 = ex * ex + ey * ey + ez * ez - proj * proj;
        if (d2 < 0.36 * 0.36) {
          hitDist = proj;
          const rawDmg = (g.damage[0] + g.damage[1]) * 0.22; // Fair bot damage
          this.w.hurtPlayer(Math.max(5, Math.min(18, rawDmg)), b.pos.x, b.pos.z, 'Пулевое ранение от бандита');
        }
      }
    } else {
      const zh = this.w.zombies.hitTest(_v2.set(ox, oy, oz), _to, maxTrace, 0.05);
      if (zh) {
        hitDist = zh.dist;
        const dmg = g.damage[0] * 0.7;
        this.w.zombies.hit(zh.zombie, dmg, ox, oz, zh.head, zh.point);
      }
    }

    this.spawnTracer(ox, oy, oz, _to.x, _to.y, _to.z, Math.min(hitDist, 32));
    sfx.gunShot(GUN_SOUND[gId], b.pos, false, this.w.placeAt(b.pos.x, b.pos.z));
    this.w.noise(b.pos.x, b.pos.y, b.pos.z, Math.min(40, g.noise * 0.7));

    b.ammoInMag--;
    b.burstLeft--;
    if (b.ammoInMag <= 0) {
      b.reloadT = 2.2;
    } else if (b.burstLeft <= 0) {
      b.burstLeft = 2 + Math.floor(Math.random() * 3);
      b.burstPause = 1.0 + Math.random() * 0.7;
    } else {
      b.fireCd = Math.max(0.24, 60 / Math.min(260, g.rpm));
    }
  }

  private spawnTracer(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, dist: number): void {
    const len = Math.max(0.6, Math.min(dist, 24));
    const mesh = new Mesh(this.tracerGeo, this.tracerMat);
    mesh.scale.set(1, 1, len);
    mesh.position.set(ox + dx * (len * 0.5), oy + dy * (len * 0.5), oz + dz * (len * 0.5));
    mesh.lookAt(ox + dx * len, oy + dy * len, oz + dz * len);
    this.w.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.06 });
  }

  private updateTracers(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.w.scene.remove(t.mesh);
        this.tracers.splice(i, 1);
      }
    }
  }
}

export type { Group };
