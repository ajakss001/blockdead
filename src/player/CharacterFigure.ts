import {
  type Bone,
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
} from 'three';
import { type ItemId, ITEMS, type WearSlot } from '../data/items';
import { characterMaterial } from '../render/look/materials';
import type { Worn } from '../systems/Inventory';
import { buildZombie, dropZombie, zombieMaterial, type ZombieType } from '../zombies/buildZombie';
import { type BoneName, boneIndex, createBones, restLocals, restWorld, type SkeletonDims } from '../zombies/skeleton';
import { FIST_GRIP, survivorHand, type SurvivorSpec, survivorType } from '../zombies/types/survivor';
import { type Appearance, DEFAULT_APPEARANCE } from './appearance';
import { buildHeldModel, HELD, type HeldId } from './held';
import { type Outfit, outfitFrom } from './outfit';

const NO_WORN: Worn = { head: null, torso: null, vest: null, hands: null, legs: null, feet: null, back: null };

/** The survivor's build for a look and what they wear (dirt in tenths: a rebuild only when it shows). */
export function survivorSpec(look: Appearance, worn: Worn, o: Outfit, grip: SurvivorSpec['grip'] = 'none'): SurvivorSpec {
  const q = (v: number) => Math.round(v * 10) / 10;
  return {
    sex: look.sex,
    build: look.build,
    height: look.height,
    skin: look.skin,
    face: look.face,
    hair: look.hair,
    hairColor: look.hairColor,
    beard: look.sex === 'female' ? 'none' : look.beard,
    worn: { torso: worn.torso, legs: worn.legs, feet: worn.feet },
    top: o.top,
    sleeves: o.sleeves,
    pants: o.pants,
    shoes: { kind: o.shoes.kind, upper: o.shoes.upper },
    gloves: o.gloves,
    dirt: { torso: q(o.dirt.torso), legs: q(o.dirt.legs), feet: q(o.dirt.feet) },
    grip,
  };
}

/** One built survivor: its type (geometry cached by the zombie builder), the skinned mesh, its bones. */
export interface FigureBody {
  type: ZombieType;
  dims: SkeletonDims;
  mesh: SkinnedMesh;
  /** In BONES order. */
  bones: Bone[];
}

/** Figures sharing a build share its geometry: it goes when the last one lets it go. */
const users = new Map<string, number>();
function hold(type: ZombieType): void {
  users.set(type.id, (users.get(type.id) ?? 0) + 1);
}
function release(type: ZombieType): void {
  const n = (users.get(type.id) ?? 1) - 1;
  if (n > 0) users.set(type.id, n);
  else {
    users.delete(type.id);
    dropZombie(type);
  }
}

const _a = new Vector3();
const _b = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

/**
 * The survivor as a whole — the same model as the zombies are made of (src/zombies/types/survivor.ts):
 * one skinned mesh on the shared skeleton, a man or a woman as their look says, in what they wear, with
 * hats on the head bone and vests and bags on the chest bone. The arms are posed by a two-bone IK so the
 * fists close on what is held as in first person. The inventory figure, the character editor and the
 * body on death (PlayerDeath drives its bones from the ragdoll).
 */
export class CharacterFigure {
  readonly root = new Group();
  private body: FigureBody | null = null;
  private readonly geometries: BufferGeometry[] = [];
  private readonly held = new Map<HeldId, Group>();
  private readonly hats = new Map<ItemId, Group>();
  /** Vests and bags (low-poly placeholders until real models), keyed by item. */
  private readonly gear = new Map<ItemId, Group>();
  private look: Appearance = { ...DEFAULT_APPEARANCE };
  private worn: Worn = { ...NO_WORN };
  private dirt: Record<WearSlot, number> | undefined;
  private tint: Partial<Record<WearSlot, number>> | undefined;
  private holding: ItemId | null = null;

  constructor() {
    for (const id of Object.keys(HELD) as HeldId[]) {
      if (id === 'torch') continue;
      const g = buildHeldModel(id, this.geometries);
      g.visible = false;
      this.root.add(g);
      this.held.set(id, g);
    }
    this.buildHats();
    this.buildGear();
    this.rebuild();
  }

  /** Rebuilds the body only when the look changed what it is made of. */
  setAppearance(a: Appearance): void {
    this.look = { ...a };
    this.rebuild();
  }

  /** Clothes, shoes and what is in the hand; re-poses the arms. */
  setOutfit(worn: Worn, hand: ItemId | null, dirt?: Record<WearSlot, number>, tint?: Partial<Record<WearSlot, number>>): void {
    this.worn = { ...worn };
    this.holding = hand;
    this.dirt = dirt;
    this.tint = tint;
    this.rebuild();
  }

  /** The skinned body (PlayerDeath takes it over). */
  get skinned(): FigureBody {
    return this.body!;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    if (this.body) {
      this.body.mesh.skeleton.dispose();
      release(this.body.type);
    }
  }

  /** The held item (a two-handed one, a one-handed one, or nothing) as the fists see it. */
  private heldItem(): HeldId | null {
    const id = this.holding;
    return id && id in HELD && this.held.has(id as HeldId) ? (id as HeldId) : null;
  }

  private rebuild(): void {
    const o = outfitFrom(this.worn, this.look.skin, this.dirt, this.tint);
    const id = this.heldItem();
    const grip = id ? (HELD[id].twoHanded ? 'both' : 'right') : 'none';
    const spec = survivorSpec(this.look, this.worn, o, grip);
    const key = `figure:${JSON.stringify(spec)}`;
    if (this.body?.type.id !== key) {
      const old = this.body;
      const type = survivorType(spec, key);
      const built = buildZombie(type);
      hold(type);
      const bones = createBones(built.dims);
      const mesh = new SkinnedMesh(built.geometry, zombieMaterial());
      mesh.name = 'survivor';
      mesh.add(bones[0]);
      mesh.bind(new Skeleton(bones, built.inverses.map((m) => m.clone())), new Matrix4());
      mesh.boundingSphere = built.geometry.boundingSphere!.clone();
      this.body = { type, dims: built.dims, mesh, bones };
      this.root.add(mesh);
      this.attach();
      if (old) {
        this.root.remove(old.mesh);
        old.mesh.skeleton.dispose();
        release(old.type);
      }
    }
    for (const [hid, g] of this.hats) g.visible = this.worn.head === hid;
    for (const [gid, g] of this.gear) g.visible = this.worn.vest === gid || this.worn.back === gid;
    for (const [hid, g] of this.held) g.visible = id === hid;
    this.pose();
  }

  /** Hats on the head bone, vests and bags on the chest bone, sized to this body. */
  private attach(): void {
    const { dims: d, bones } = this.body!;
    const h = d.p.head ?? 1;
    const head = bones[boneIndex('Head')];
    for (const g of this.hats.values()) {
      head.add(g);
      g.position.set(0, 0.1 * h + 0.006, 0.012 * h);
      g.scale.setScalar(h / 0.88);
    }
    const chest = bones[boneIndex('Chest')];
    const k = d.p.height / 1.76;
    const w = d.shoulderX / 0.19;
    for (const g of this.gear.values()) {
      chest.add(g);
      // Built about the old figure's hips (0.92 m on a 1.76 m body).
      g.position.set(0, 0.92 * k - d.chestY, 0);
      g.scale.set(w * (0.85 + 0.15 * d.p.girth), k, 0.82 * (0.85 + 0.15 * d.p.girth));
    }
  }

  /** Arms: hanging, carrying a one-handed item, or holding a two-handed weapon across the body. */
  private pose(): void {
    const { bones, dims: d } = this.body!;
    restLocals(d).forEach((r, i) => {
      bones[i].position.copy(r.pos);
      bones[i].quaternion.copy(r.rot);
    });
    const id = this.heldItem();
    const cfg = id ? HELD[id] : null;
    const k = d.p.height / 1.76;
    if (cfg?.twoHanded && id) {
      // Diagonally across the body (as in first person): butt at the left hip, head by the right
      // shoulder, edge out; the right hand up the handle, the left at its end.
      const axis = new Vector3(0.55, 0.8, -0.05).normalize();
      const butt = new Vector3(-0.2 * k, 0.86 * k, -0.26 * k);
      const g = this.held.get(id)!;
      g.position.copy(butt);
      g.quaternion.copy(basis(axis, new Vector3(0.6, 0, -1)));
      this.grip('R', butt.clone().addScaledVector(axis, cfg.main.along), axis, new Vector3(0.7, -0.3, 0.5));
      this.grip('L', butt.clone().addScaledVector(axis, (cfg.off ?? cfg.main).along), axis, new Vector3(-0.7, -0.2, 0.5));
      return;
    }
    if (cfg && id) {
      // One-handed: carried in the right hand, pointing forward and down.
      const axis = new Vector3(0, -0.45, -1).normalize();
      const at = new Vector3(0.24 * k, 0.84 * k, -0.13 * k);
      const g = this.held.get(id)!;
      g.quaternion.copy(basis(axis, new Vector3(0, -1, 0)));
      g.position.copy(at).addScaledVector(axis, -cfg.main.along);
      this.grip('R', at, axis, new Vector3(0.15, 1, 0.3));
    } else this.hang('R');
    this.hang('L');
  }

  /** A relaxed arm: a little away from the body, the elbow a little bent. */
  private hang(side: 'L' | 'R'): void {
    const d = this.body!.dims;
    const s = side === 'R' ? 1 : -1;
    const sh = this.shoulder(side);
    const len = (d.upperArm + d.foreArm) * 0.97;
    this.ik(side, _b.set(sh.x + s * 0.075, sh.y - len, sh.z - 0.035), null);
  }

  /**
   * Close a fist on `point` with the handle along `axis` (towards the item's head, out of the thumb side),
   * the forearm running off towards `towardsElbow`; the arm reaches it by IK.
   */
  private grip(side: 'L' | 'R', point: Vector3, axis: Vector3, towardsElbow: Vector3): void {
    const s = side === 'R' ? 1 : -1;
    const z = axis.clone().normalize().negate();
    const y = towardsElbow.clone().addScaledVector(z, -towardsElbow.dot(z)).normalize();
    const x = new Vector3().crossVectors(y, z);
    const hand = new Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
    const hs = survivorHand(this.look.sex);
    const g = new Vector3(FIST_GRIP[0] * s * hs, FIST_GRIP[1] * hs, FIST_GRIP[2] * hs).applyQuaternion(hand);
    this.ik(side, point.clone().sub(g), hand);
  }

  private shoulder(side: 'L' | 'R'): Vector3 {
    return new Vector3().setFromMatrixPosition(restWorld(this.body!.dims)[boneIndex(`UpperArm_${side}` as BoneName)]);
  }

  /**
   * Two-bone IK (model frame): shoulder → elbow → wrist, the elbow out and back; the hand turned to `hand`
   * (model frame) or straight on from the forearm.
   */
  private ik(side: 'L' | 'R', wrist: Vector3, hand: Quaternion | null): void {
    const { bones, dims: d } = this.body!;
    const s = side === 'R' ? 1 : -1;
    const rest = restWorld(d);
    const chestQ = new Quaternion().setFromRotationMatrix(rest[boneIndex('Chest')]);
    const sh = this.shoulder(side);
    const L1 = d.upperArm;
    const L2 = d.foreArm;
    const to = _a.copy(wrist).sub(sh);
    const dist = Math.min(Math.max(to.length(), 0.05), L1 + L2 - 1e-3);
    const dir = to.normalize().clone();
    const along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    const pole = new Vector3(s * 0.6, -0.2, 0.7);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = sh.clone().addScaledVector(dir, along).addScaledVector(pole, h);
    const reach = sh.clone().addScaledVector(dir, dist);
    const u = elbow.clone().sub(sh).normalize();
    const f = reach.clone().sub(elbow).normalize();
    // Upper arm: +Y up the bone; the elbow bends the forearm towards the bone's −Z about its X.
    const y1 = u.clone().negate();
    let z1 = f.clone().addScaledVector(y1, -f.dot(y1));
    if (z1.lengthSq() < 1e-6) z1 = pole.clone().addScaledVector(y1, -pole.dot(y1));
    z1.normalize().negate();
    const x1 = new Vector3().crossVectors(y1, z1);
    const upQ = new Quaternion().setFromRotationMatrix(_m.makeBasis(x1, y1, z1));
    const y2 = f.clone().negate();
    const z2 = new Vector3().crossVectors(x1, y2);
    const foreQ = new Quaternion().setFromRotationMatrix(_m.makeBasis(x1, y2, z2));
    bones[boneIndex(`UpperArm_${side}` as BoneName)].quaternion.copy(chestQ.clone().invert().multiply(upQ));
    bones[boneIndex(`LowerArm_${side}` as BoneName)].quaternion.copy(upQ.clone().invert().multiply(foreQ));
    const hb = bones[boneIndex(`Hand_${side}` as BoneName)];
    if (hand) hb.quaternion.copy(_q.copy(foreQ).invert().multiply(hand));
    else hb.quaternion.setFromAxisAngle(_a.set(1, 0, 0), 0.12);
  }

  /**
   * Vests and bags: boxes over the chest and on the back, sized to an average build (they ride on the
   * chest bone, scaled to the body). Pouches on the rig, a strap and a duffel for the sports bag, a small
   * case at the hip for the medical bag.
   */
  private buildGear(): void {
    const box = (sx: number, sy: number, sz: number) => this.geo(new BoxGeometry(sx, sy, sz));
    const chestY = 1.41 - 0.24 - 0.92;
    const make = (id: ItemId, parts: [BufferGeometry, number, number, number, number?][]) => {
      const g = new Group();
      const m = characterMaterial('jacket', ITEMS[id].wear!.color);
      for (const [geo, x, y, z, rz] of parts) {
        const mesh = new Mesh(geo, m);
        mesh.position.set(x, y, z);
        if (rz) mesh.rotation.z = rz;
        g.add(mesh);
      }
      g.visible = false;
      this.gear.set(id, g);
    };
    const vest = box(0.36, 0.4, 0.23);
    const pouch = box(0.08, 0.1, 0.05);
    make('swatVest', [[vest, 0, chestY, 0], [box(0.3, 0.12, 0.04), 0, chestY + 0.05, -0.125]]);
    make('policeVest', [[vest, 0, chestY, 0]]);
    make('tacticalRig', [[box(0.35, 0.36, 0.22), 0, chestY, 0], [pouch, -0.1, chestY - 0.08, -0.13], [pouch, 0, chestY - 0.08, -0.13], [pouch, 0.1, chestY - 0.08, -0.13]]);
    const strap = box(0.04, 0.42, 0.02);
    const backY = chestY - 0.02;
    make('schoolBackpack', [[box(0.28, 0.34, 0.12), 0, backY, 0.17], [strap, -0.1, backY + 0.02, -0.115], [strap, 0.1, backY + 0.02, -0.115]]);
    make('hikingBackpack', [[box(0.32, 0.56, 0.2), 0, backY + 0.06, 0.2], [box(0.3, 0.1, 0.16), 0, backY + 0.38, 0.19], [strap, -0.1, backY + 0.02, -0.115], [strap, 0.1, backY + 0.02, -0.115]]);
    make('armyBackpack', [[box(0.36, 0.46, 0.22), 0, backY + 0.02, 0.21], [box(0.12, 0.18, 0.08), -0.2, backY - 0.06, 0.19], [box(0.12, 0.18, 0.08), 0.2, backY - 0.06, 0.19], [strap, -0.1, backY + 0.02, -0.115], [strap, 0.1, backY + 0.02, -0.115]]);
    make('sportsBag', [[this.geo(new CylinderGeometry(0.11, 0.11, 0.42, 10).rotateZ(Math.PI / 2)), 0.05, -0.05, 0.16], [box(0.03, 0.6, 0.02), 0, chestY, 0, 0.6]]);
    make('medBag', [[box(0.22, 0.18, 0.1), 0.24, -0.04, 0.02], [box(0.08, 0.02, 0.105), 0.24, -0.02, 0.02], [box(0.03, 0.6, 0.02), 0, chestY, 0, -0.6]]);
  }

  /** Headwear placeholders sized to the head (about the skull's centre). */
  private buildHats(): void {
    const dome = this.geo(new SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const make = (id: ItemId, parts: [BufferGeometry, number, number, number][], scale: [number, number, number]) => {
      const g = new Group();
      const m = characterMaterial('cuff', ITEMS[id].wear!.color);
      for (const [geo, px, py, pz] of parts) {
        const mesh = new Mesh(geo, m);
        mesh.position.set(px, py, pz);
        mesh.scale.set(...scale);
        g.add(mesh);
      }
      g.visible = false;
      this.hats.set(id, g);
    };
    const brim = this.geo(new BoxGeometry(0.16, 0.012, 0.1));
    const fold = this.geo(new CylinderGeometry(0.103, 0.103, 0.04, 12));
    const rim = this.geo(new CylinderGeometry(0.15, 0.15, 0.014, 14));
    for (const id of Object.keys(ITEMS) as ItemId[]) {
      if (ITEMS[id].wear?.slot !== 'head') continue;
      if (id === 'cap' || id === 'policeCap') make(id, [[dome, 0, 0, 0], [brim, 0, 0.005, -0.115]], [1, 0.95, 1.08]);
      else if (id === 'beanie') make(id, [[dome, 0, 0, 0], [fold, 0, 0.01, 0]], [1.02, 1.25, 1.08]);
      else make(id, [[dome, 0, 0, 0], [rim, 0, 0.004, -0.01]], id === 'hardhat' || id === 'fireHelmet' ? [1.1, 1.08, 1.14] : [1.08, 1.12, 1.12]);
    }
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
}

/** Rotation with +Y along `axis` and −Z leaning towards `edge` (held items' convention). */
function basis(axis: Vector3, edge: Vector3): Quaternion {
  const y = axis.clone().normalize();
  const f = edge.clone().addScaledVector(y, -edge.dot(y)).normalize();
  const z = f.negate();
  const x = new Vector3().crossVectors(y, z);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
