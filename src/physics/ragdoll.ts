import { Body, Box, ConeTwistConstraint, HingeConstraint, Plane, Quaternion as CQuat, Vec3, World } from 'cannon-es';
import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Physical ragdolls for the dead (zombies and the player), on cannon-es: pure JS (no WASM to load, ~40 kB
 * gzipped), synchronous, runs in the Node tests, and plenty for a few ragdolls of 11 bodies. Each ragdoll
 * steps its own small world: the floor and the boxes of the level near it (walls, cars, furniture — from
 * CollisionWorld), 120 Hz substeps so limbs don't tunnel through the floor or a wall.
 *
 * Bodies: pelvis, chest, head, upper arms, forearms, thighs, shins — boxes sized like the body's parts.
 * Joints with human limits: shoulders and hips cone-twist, elbows and knees a hinge that bends one way,
 * waist and neck small cones; joined parts don't collide. Heavy damping: it falls limp and heavy, no springs.
 * When everything has been nearly still for half a second (or after 3 s at most) it falls asleep: the
 * body transforms are baked and the physics is dropped — nothing moves it again.
 */

/** Body indices. */
export const PART = { pelvis: 0, chest: 1, head: 2, upperArmL: 3, upperArmR: 4, foreArmL: 5, foreArmR: 6, thighL: 7, thighR: 8, shinL: 9, shinR: 10 } as const;
export const PARTS = 11;

/**
 * A body's joints in its own frame (facing +Z, feet at y = 0, unscaled, m) and the widths that differ:
 * zombies and the player's figure are built a little differently, each ragdoll fits its own mesh.
 */
export interface BodyShape {
  shoulderX: number;
  shoulderY: number;
  elbowY: number;
  wristY: number;
  hipX: number;
  hipY: number;
  kneeY: number;
  waistY: number;
  neckY: number;
  /** Half widths (x) of the pelvis, thighs and forearms: hanging arms must not start inside the hips. */
  pelvisW: number;
  thighW: number;
  foreW: number;
}

export const ZOMBIE_SHAPE: BodyShape = { shoulderX: 0.25, shoulderY: 1.42, elbowY: 1.08, wristY: 0.7, hipX: 0.1, hipY: 0.9, kneeY: 0.5, waistY: 1.165, neckY: 1.45, pelvisW: 0.18, thighW: 0.075, foreW: 0.048 };

type Part = { c: [number, number, number]; h: [number, number, number]; m: number };

/** Each part's rest centre, half size (m) and mass (kg) for a body shape. */
export function bodyParts(b: BodyShape): Part[] {
  const mid = (a: number, c: number) => (a + c) / 2;
  const half = (a: number, c: number) => Math.abs(a - c) / 2;
  const parts: Part[] = [
    { c: [0, mid(b.hipY, b.waistY), 0], h: [b.pelvisW, half(b.hipY, b.waistY), 0.11], m: 11 },
    { c: [0, mid(b.waistY, b.neckY), 0], h: [0.2, half(b.waistY, b.neckY), 0.12], m: 15 },
    { c: [0, b.neckY + 0.15, 0.02], h: [0.1, 0.15, 0.11], m: 4.5 },
  ];
  for (const s of [-1, 1]) parts.push({ c: [b.shoulderX * s, mid(b.shoulderY, b.elbowY), 0], h: [0.055, half(b.shoulderY, b.elbowY), 0.06], m: 2.2 });
  for (const s of [-1, 1]) parts.push({ c: [b.shoulderX * s, mid(b.elbowY, b.wristY), 0.01], h: [b.foreW, half(b.elbowY, b.wristY), 0.05], m: 1.6 });
  for (const s of [-1, 1]) parts.push({ c: [b.hipX * s, mid(b.hipY, b.kneeY), 0], h: [b.thighW, half(b.hipY, b.kneeY), 0.085], m: 7.5 });
  for (const s of [-1, 1]) parts.push({ c: [b.hipX * s, mid(b.kneeY, 0.04), 0.02], h: [b.thighW * 0.9, half(b.kneeY, 0.04), 0.09], m: 4 });
  return parts;
}

/** The player's figure (CharacterFigure): narrower shoulders, shorter arms, slimmer hips and legs. */
export const FIGURE_SHAPE: BodyShape = { shoulderX: 0.19, shoulderY: 1.41, elbowY: 1.12, wristY: 0.87, hipX: 0.092, hipY: 0.92, kneeY: 0.47, waistY: 1.165, neckY: 1.47, pelvisW: 0.13, thighW: 0.055, foreW: 0.04 };

/** The parts of a body standing straight on its feet, turned by yaw (its +Z forward), scaled. */
export function standingPoses(shape: BodyShape, feet: Vector3, yaw: number, scale: number): PartPose[] {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return bodyParts(shape).map((d) => ({ p: new Vector3(d.c[0] * scale, d.c[1] * scale, d.c[2] * scale).applyQuaternion(q).add(feet), q: q.clone() }));
}

/** The zombie body's parts (the player's figure has its own shape). */
export const BODY_PARTS = bodyParts(ZOMBIE_SHAPE);

type JointDef =
  | { kind: 'cone'; a: number; b: number; pivot: [number, number, number]; axis: [number, number, number]; child: [number, number, number]; angle: number; twist: number }
  | { kind: 'hinge'; a: number; b: number; pivot: [number, number, number]; mid: [number, number, number]; angle: number };

/** Joints in the body frame: pivot, the cone's centre (parent frame) and the child's own axis. */
function joints(b: BodyShape): JointDef[] {
  return [
    { kind: 'cone', a: PART.pelvis, b: PART.chest, pivot: [0, b.waistY, 0], axis: [0, 1, 0.08], child: [0, 1, 0], angle: 0.45, twist: 0.35 },
    { kind: 'cone', a: PART.chest, b: PART.head, pivot: [0, b.neckY, 0], axis: [0, 1, 0.1], child: [0, 1, 0], angle: 0.6, twist: 0.7 },
    ...[-1, 1].flatMap((s): JointDef[] => {
      const L = s < 0;
      return [
        { kind: 'cone', a: PART.chest, b: L ? PART.upperArmL : PART.upperArmR, pivot: [b.shoulderX * s, b.shoulderY, 0], axis: [0.35 * s, -0.75, 0.45], child: [0, -1, 0], angle: 1.35, twist: 0.6 },
        // Elbows bend the forearm forward only: a hinge, and a cone round the half-bent direction.
        { kind: 'hinge', a: L ? PART.upperArmL : PART.upperArmR, b: L ? PART.foreArmL : PART.foreArmR, pivot: [b.shoulderX * s, b.elbowY, 0], mid: [0, -0.57, 0.82], angle: 1.02 },
        { kind: 'cone', a: PART.pelvis, b: L ? PART.thighL : PART.thighR, pivot: [b.hipX * s, b.hipY, 0], axis: [0.12 * s, -0.9, 0.38], child: [0, -1, 0], angle: 0.85, twist: 0.3 },
        // Knees bend the shin backward only.
        { kind: 'hinge', a: L ? PART.thighL : PART.thighR, b: L ? PART.shinL : PART.shinR, pivot: [b.hipX * s, b.kneeY, 0], mid: [0, -0.57, -0.82], angle: 1.02 },
      ];
    }),
  ];
}

/** A box of the level the ragdoll can land on: bounds, and a turned box's frame. */
export interface StaticBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  minY: number;
  maxY: number;
  obb?: { cx: number; cz: number; hx: number; hz: number; c: number; s: number } | null;
}

/** A part's world transform: position and rotation (the body's frame turned with it). */
export interface PartPose {
  p: Vector3;
  q: Quaternion;
}

export interface RagdollInit {
  /** Each part's world pose at the moment of death (from the animated body), uniform scale. */
  parts: PartPose[];
  scale: number;
  /** The body's build (zombie by default). */
  shape?: BodyShape;
  /** How the body was moving (m/s). */
  velocity: Vector3;
  /** The blow: an impulse (N·s, world) at a point, on a part. */
  impulse?: { part: number; at: Vector3; dir: Vector3; strength: number };
  /** The floor under it and the level's boxes near it. */
  floorY: number;
  /** Optional dynamic surface query (sidewalks, steps, upper floors) to prevent any limb from sinking. */
  groundY?: (x: number, z: number, y: number) => number;
  boxes: StaticBox[];
}

/** Nearly still: no part strays further than this (m, rad) from where it was over SLEEP_AFTER seconds. */
const SLEEP_MOVE = 0.015;
const SLEEP_TURN = 0.05;
const SLEEP_AFTER = 0.5;
/** The level is this much thicker for the body (m): a limb landing hard keeps >= 0.05 m clearance over ground. */
const SKIN = 0.05;
const MAX_SPEED = 6;
/** Once down, it goes heavier still: no limb keeps trembling against the floor. */
const SETTLE_AFTER = 1.1;
const MAX_AWAKE = 3;

const _v = new Vector3();

export class Ragdoll {
  readonly world: World;
  readonly bodies: Body[] = [];
  /** Baked world poses once asleep (and the live ones while awake). */
  readonly poses: PartPose[] = Array.from({ length: PARTS }, () => ({ p: new Vector3(), q: new Quaternion() }));
  asleep = false;
  /** Seconds awake, seconds nearly still. */
  private age = 0;
  private still = 0;
  private readonly anchor: PartPose[] = Array.from({ length: PARTS }, () => ({ p: new Vector3(), q: new Quaternion() }));
  /** Extra bodies stepped with it (a dropped weapon): body and the pose to write to. */
  readonly extras: { body: Body; pose: PartPose }[] = [];
  readonly floorY: number;
  private readonly groundAt?: (x: number, z: number, y: number) => number;
  private readonly partHalf: [number, number, number][] = [];

  constructor(init: RagdollInit) {
    this.floorY = init.floorY;
    this.groundAt = init.groundY;
    const k = init.scale;
    const shape = init.shape ?? ZOMBIE_SHAPE;
    const parts = bodyParts(shape);
    this.world = new World({ gravity: new Vec3(0, -9.82, 0) });
    this.world.allowSleep = false;
    (this.world.solver as unknown as { iterations: number }).iterations = 8;
    // Stiff contacts: a limb landing hard does not sink into the floor or a wall.
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.defaultContactMaterial.contactEquationRelaxation = 2.5;
    // The floor, and the level round it.
    const floor = new Body({ mass: 0, shape: new Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floor.position.set(0, init.floorY + SKIN, 0);
    this.world.addBody(floor);
    for (const b of init.boxes) this.addStatic(b, init.floorY);
    // The parts, where the living body had them.
    parts.forEach((d, i) => {
      const pose = init.parts[i];
      const hx = d.h[0] * k;
      const hy = d.h[1] * k;
      const hz = d.h[2] * k;
      this.partHalf.push([hx, hy, hz]);
      const body = new Body({
        mass: d.m,
        shape: new Box(new Vec3(hx, hy, hz)),
        position: new Vec3(pose.p.x, pose.p.y, pose.p.z),
        quaternion: new CQuat(pose.q.x, pose.q.y, pose.q.z, pose.q.w),
        linearDamping: 0.08,
        angularDamping: 0.45,
      });
      body.velocity.set(init.velocity.x, init.velocity.y, init.velocity.z);
      this.world.addBody(body);
      this.bodies.push(body);
    });
    this.separate(parts, k);
    // Joints (pivots from the rest body into each part's own frame).
    const local = (part: number, p: [number, number, number]) => {
      const c = parts[part].c;
      return new Vec3((p[0] - c[0]) * k, (p[1] - c[1]) * k, (p[2] - c[2]) * k);
    };
    for (const j of joints(shape)) {
      const A = this.bodies[j.a];
      const B = this.bodies[j.b];
      if (j.kind === 'cone') {
        const ax = new Vec3(...j.axis);
        ax.normalize();
        this.world.addConstraint(new ConeTwistConstraint(A, B, { pivotA: local(j.a, j.pivot), pivotB: local(j.b, j.pivot), axisA: ax, axisB: new Vec3(...j.child), angle: j.angle, twistAngle: j.twist, collideConnected: false, maxForce: 1e6 }));
      } else {
        this.world.addConstraint(new HingeConstraint(A, B, { pivotA: local(j.a, j.pivot), pivotB: local(j.b, j.pivot), axisA: new Vec3(1, 0, 0), axisB: new Vec3(1, 0, 0), collideConnected: false, maxForce: 1e6 }));
        const mid = new Vec3(...j.mid);
        mid.normalize();
        this.world.addConstraint(new ConeTwistConstraint(A, B, { pivotA: local(j.a, j.pivot), pivotB: local(j.b, j.pivot), axisA: mid, axisB: new Vec3(0, -1, 0), angle: j.angle, twistAngle: Math.PI, collideConnected: false, maxForce: 1e6 }));
      }
    }
    // The blow: half of it at the point it landed (no part flung faster than 5 m/s — limp, not exploding),
    // the rest carries the whole body.
    if (init.impulse) {
      const b = this.bodies[init.impulse.part];
      const at = init.impulse.at;
      const dir = init.impulse.dir.clone().normalize();
      const J = init.impulse.strength;
      const local = Math.min(J * 0.5, b.mass * 5);
      b.applyImpulse(new Vec3(dir.x * local, dir.y * local, dir.z * local), new Vec3(at.x - b.position.x, at.y - b.position.y, at.z - b.position.z));
      const mass = this.bodies.reduce((m, x) => m + x.mass, 0);
      const dv = (J - local) / mass;
      for (const x of this.bodies) x.velocity.vadd(new Vec3(dir.x * dv, dir.y * dv, dir.z * dv), x.velocity);
    }
    this.clampToGround();
    this.read();
  }

  /** A loose thing falling with the body (the weapon from the hand): a box of half size h. */
  addExtra(pose: PartPose, h: Vector3, mass: number, velocity: Vector3): void {
    const body = new Body({ mass, shape: new Box(new Vec3(h.x, h.y, h.z)), position: new Vec3(pose.p.x, pose.p.y, pose.p.z), quaternion: new CQuat(pose.q.x, pose.q.y, pose.q.z, pose.q.w), linearDamping: 0.2, angularDamping: 0.4 });
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    this.world.addBody(body);
    this.extras.push({ body, pose });
  }

  /** The level's boxes as the body sees them (centre, half sizes with the skin, turn). */
  private readonly statics: { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; c: number; s: number }[] = [];

  /**
   * A zombie's arms (drawn without collision) can reach into a wall or a car as it dies: the whole body
   * steps out sideways first, so the physics never starts inside anything.
   */
  private separate(parts: Part[], k: number): void {
    const corner = new Vector3();
    for (let pass = 0; pass < 4; pass++) {
      let px = 0;
      let pz = 0;
      let best = 0;
      this.bodies.forEach((body, i) => {
        const h = parts[i].h;
        const q = new Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        for (let n = 0; n < 8; n++) {
          corner.set(n & 1 ? h[0] : -h[0], n & 2 ? h[1] : -h[1], n & 4 ? h[2] : -h[2]).multiplyScalar(k).applyQuaternion(q);
          corner.x += body.position.x;
          corner.y += body.position.y;
          corner.z += body.position.z;
          for (const b of this.statics) {
            const wx = corner.x - b.cx;
            const wz = corner.z - b.cz;
            const lx = wx * b.c - wz * b.s;
            const lz = wx * b.s + wz * b.c;
            if (Math.abs(corner.y - b.cy) >= b.hy || Math.abs(lx) >= b.hx || Math.abs(lz) >= b.hz) continue;
            const dx = (b.hx - Math.abs(lx)) * Math.sign(lx || 1);
            const dz = (b.hz - Math.abs(lz)) * Math.sign(lz || 1);
            // Out the nearest side (local x or z), back into the world frame.
            const [ox, oz] = Math.abs(dx) < Math.abs(dz) ? [dx * b.c, -dx * b.s] : [dz * b.s, dz * b.c];
            const d = Math.hypot(ox, oz);
            if (d > best) (best = d), (px = ox), (pz = oz);
          }
        }
      });
      if (best <= 0) return;
      const m = (best + 0.01) / best;
      for (const body of this.bodies) {
        body.position.x += px * m;
        body.position.z += pz * m;
      }
    }
  }

  private addStatic(b: StaticBox, floorY: number): void {
    // Under the floor (the plane has it) or out of reach overhead: nothing to fall on.
    if (b.maxY < floorY + 0.05 || b.minY > floorY + 2.2) return;
    const y0 = Math.max(b.minY, floorY - 1) - SKIN;
    const y1 = Math.min(b.maxY, floorY + 6) + SKIN;
    if (y1 <= y0 + 0.01) return;
    let body: Body;
    const o = b.obb ?? { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, hx: (b.maxX - b.minX) / 2, hz: (b.maxZ - b.minZ) / 2, c: 1, s: 0 };
    this.statics.push({ cx: o.cx, cy: (y0 + y1) / 2, cz: o.cz, hx: o.hx + SKIN, hy: (y1 - y0) / 2, hz: o.hz + SKIN, c: o.c, s: o.s });
    if (b.obb) {
      body = new Body({ mass: 0, shape: new Box(new Vec3(b.obb.hx + SKIN, (y1 - y0) / 2, b.obb.hz + SKIN)), position: new Vec3(b.obb.cx, (y0 + y1) / 2, b.obb.cz) });
      // Same turn as the collider (cos, sin of its yaw).
      body.quaternion.setFromAxisAngle(new Vec3(0, 1, 0), Math.atan2(b.obb.s, b.obb.c));
    } else {
      body = new Body({ mass: 0, shape: new Box(new Vec3((b.maxX - b.minX) / 2 + SKIN, (y1 - y0) / 2, (b.maxZ - b.minZ) / 2 + SKIN)), position: new Vec3((b.minX + b.maxX) / 2, (y0 + y1) / 2, (b.minZ + b.maxZ) / 2) });
    }
    this.world.addBody(body);
  }

  /** One fixed 1/60 s step (two 1/120 substeps). Falls asleep when still. */
  step(): void {
    if (this.asleep) return;
    for (let k = 0; k < 2; k++) {
      // A limb is never flung faster than this: limp, and it cannot tunnel through a wall in a substep.
      for (const b of this.bodies) {
        const v = b.velocity.length();
        if (v > MAX_SPEED) b.velocity.scale(MAX_SPEED / v, b.velocity);
      }
      this.world.step(1 / 120);
      this.clampToGround();
    }
    this.age += 1 / 60;
    this.read();
    if (this.age >= SETTLE_AFTER && this.age - 1 / 60 < SETTLE_AFTER) {
      for (const b of this.bodies) {
        b.linearDamping = 0.3;
        b.angularDamping = 0.8;
      }
    }
    // Still: every part within a centimetre and a half (and three degrees) of where it was half a second
    // ago — a measure a trembling hand cannot fool.
    let moved = this.still === 0;
    for (let i = 0; i < PARTS && !moved; i++) {
      if (this.poses[i].p.distanceTo(this.anchor[i].p) > SLEEP_MOVE || this.poses[i].q.angleTo(this.anchor[i].q) > SLEEP_TURN) moved = true;
    }
    if (moved) {
      this.poses.forEach((pp, i) => (this.anchor[i].p.copy(pp.p), this.anchor[i].q.copy(pp.q)));
      this.still = 1e-6;
    } else this.still += 1 / 60;
    if (this.still >= SLEEP_AFTER && this.age > 0.8 && this.age < MAX_AWAKE - 0.15 && this.isStillUpright()) {
      this.applyToppleImpulse();
      this.still = 0.05;
      return;
    }
    if ((this.still >= SLEEP_AFTER && this.age > 0.8) || this.age >= MAX_AWAKE - 1e-6) this.sleep();
  }

  /** Detect frozen kneeling / wedged upright pelvis-chest-head pose above flat lying floor level. */
  private isStillUpright(): boolean {
    if (this.bodies.length < 3) return false;
    const pelvis = this.bodies[PART.pelvis];
    const chest = this.bodies[PART.chest];
    const head = this.bodies[PART.head];
    const gy = this.groundAt ? this.groundAt(pelvis.position.x, pelvis.position.z, Math.max(this.floorY, pelvis.position.y)) : this.floorY;
    return pelvis.position.y - gy > 0.38 || chest.position.y - gy > 0.42 || head.position.y - gy > 0.48;
  }

  /** Nudge a kneeling or wedged ragdoll horizontally & sideways so knees cannot prop the pelvis in an A-frame. */
  private applyToppleImpulse(): void {
    if (this.bodies.length < PARTS) return;
    for (const b of this.bodies) {
      b.linearDamping = 0.06;
      b.angularDamping = 0.05;
    }
    const pelvis = this.bodies[PART.pelvis];
    const chest = this.bodies[PART.chest];
    const head = this.bodies[PART.head];
    const q = chest.quaternion;
    let tx = 2 * (q.x * q.z + q.w * q.y);
    let tz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const len = Math.hypot(tx, tz);
    if (len > 0.15) {
      tx /= len;
      tz /= len;
    } else {
      const ang = (Math.abs(pelvis.position.x * 13.7 + pelvis.position.z * 7.3) % 6.283);
      tx = Math.cos(ang);
      tz = Math.sin(ang);
    }
    // Lateral perpendicular axis breaks symmetrical two-knee kneeling bridges.
    const sx = -tz;
    const sz = tx;
    chest.applyImpulse(new Vec3((tx * 4.5 + sx * 3.0) * chest.mass, -chest.mass * 1.5, (tz * 4.5 + sz * 3.0) * chest.mass));
    head.applyImpulse(new Vec3((tx * 4.5 + sx * 3.0) * head.mass, -head.mass * 1.2, (tz * 4.5 + sz * 3.0) * head.mass));
    pelvis.applyImpulse(new Vec3((-tx * 2.5 - sx * 4.2) * pelvis.mass, -pelvis.mass * 2.8, (-tz * 2.5 - sz * 4.2) * pelvis.mass));
    for (const leg of [PART.thighL, PART.thighR, PART.shinL, PART.shinR]) {
      const lb = this.bodies[leg];
      lb.applyImpulse(new Vec3((-tx * 4.5 + sx * 2.0) * lb.mass, 0, (-tz * 4.5 + sz * 2.0) * lb.mass));
    }
  }

  /** Keep every body part strictly at or above groundY + 0.05 m (including curbs, sidewalks, stairs, and slabs). */
  private clampToGround(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const [hx, hy, hz] = this.partHalf[i];
      const { x: qx, y: qy, z: qz, w: qw } = b.quaternion;
      const m10 = 2 * (qx * qy + qw * qz);
      const m11 = 1 - 2 * (qx * qx + qz * qz);
      const m12 = 2 * (qy * qz - qw * qx);
      const halfWorldY = Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz;
      const gy = this.groundAt ? this.groundAt(b.position.x, b.position.z, Math.max(this.floorY, b.position.y)) : this.floorY;
      const minY = gy + SKIN + halfWorldY;
      if (b.position.y < minY) {
        b.position.y = minY;
        if (b.velocity.y < 0) b.velocity.y = 0;
      }
    }
  }

  /** Bake the poses and drop the physics: from now on nothing changes. */
  sleep(): void {
    if (this.asleep) return;
    if (this.bodies.length >= PARTS && this.isStillUpright()) {
      for (let s = 0; s < 96; s++) {
        if (s % 24 === 0) this.applyToppleImpulse();
        this.world.step(1 / 60);
        this.clampToGround();
        if (s >= 24 && !this.isStillUpright()) break;
      }
    }
    this.clampToGround();
    this.read();
    this.asleep = true;
    for (const c of [...this.world.constraints]) this.world.removeConstraint(c);
    for (const b of [...this.world.bodies]) this.world.removeBody(b);
    this.bodies.length = 0;
    this.extras.length = 0;
  }

  private read(): void {
    this.bodies.forEach((b, i) => {
      this.poses[i].p.set(b.position.x, b.position.y, b.position.z);
      this.poses[i].q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    });
    for (const e of this.extras) {
      e.pose.p.set(e.body.position.x, e.body.position.y, e.body.position.z);
      e.pose.q.set(e.body.quaternion.x, e.body.quaternion.y, e.body.quaternion.z, e.body.quaternion.w);
    }
  }

  /** A part's world matrix (scale folded into the vertex offsets, not here). */
  matrix(part: number, out: Matrix4): Matrix4 {
    const pose = this.poses[part];
    return out.compose(pose.p, pose.q, _v.set(1, 1, 1));
  }

  /** Every body's world pose as numbers (for "did anything move" checks). */
  snapshot(): number[] {
    return this.poses.flatMap((p) => [p.p.x, p.p.y, p.p.z, p.q.x, p.q.y, p.q.z, p.q.w]);
  }
}

/**
 * All ragdolls: stepped at a fixed 60 Hz, at most `limit` awake (the oldest goes to sleep at once when
 * another comes; the player's never does).
 */
export class Ragdolls {
  readonly list: { rd: Ragdoll; player: boolean; born: number }[] = [];
  limit = 3;
  private acc = 0;
  private time = 0;

  add(rd: Ragdoll, player = false): Ragdoll {
    this.list.push({ rd, player, born: this.time });
    const awake = () => this.list.filter((e) => !e.rd.asleep);
    while (awake().length > this.limit) {
      const old = awake().filter((e) => !e.player).sort((a, b) => a.born - b.born)[0];
      if (!old) break;
      old.rd.sleep();
    }
    return rd;
  }

  remove(rd: Ragdoll): void {
    const i = this.list.findIndex((e) => e.rd === rd);
    if (i >= 0) this.list.splice(i, 1);
  }

  update(dt: number): void {
    this.time += dt;
    // Asleep: baked, out of the step (their owners keep them for the poses).
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].rd.asleep) this.list.splice(i, 1);
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= 1 / 60) {
      this.acc -= 1 / 60;
      for (const e of this.list) e.rd.step();
    }
  }

  get awake(): number {
    return this.list.filter((e) => !e.rd.asleep).length;
  }
}

