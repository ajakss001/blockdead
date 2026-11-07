import { BoxGeometry, type BufferGeometry, CylinderGeometry, Group, Mesh, Quaternion, SphereGeometry, Vector3 } from 'three';
import { type BodyId, bodyAsset, type ClipId } from '../characters/assets';
import { handFrame } from '../characters/hands';
import { CharacterRig } from '../characters/rig';
import { type ItemId, ITEMS, type WearSlot } from '../data/items';
import { characterMaterial } from '../render/look/materials';
import type { Worn } from '../systems/Inventory';
import { type Appearance, DEFAULT_APPEARANCE } from './appearance';
import { buildHeldModel, HELD, type HeldId } from './held';

const NO_WORN: Worn = { head: null, torso: null, vest: null, hands: null, legs: null, feet: null, back: null };

/** The model a survivor wears: the SWAT officer's for the SWAT class (either sex), else a man or a woman. */
export function bodyFor(look: Pick<Appearance, 'sex'>, classId?: string | null): BodyId {
  return classId === 'swat' ? 'swat' : look.sex === 'female' ? 'female' : 'male';
}

/** The figure's scale for a look's height (cm) on its body's model. */
export function figureScale(look: Pick<Appearance, 'height'>, body: BodyId): number {
  return look.height / 100 / bodyAsset(body).height;
}

/**
 * The survivor as a whole — the character model (src/characters): a man, a woman or the SWAT officer,
 * scaled to the look's height, standing at ease (the first frame of `idle`). What is held rides in the
 * right hand (the RightHand socket, the fist closed on its grip), hats on Head, vests and bags on Spine2.
 * The inventory figure, the character editor and the body on death (PlayerDeath drives its bones from the
 * ragdoll).
 */
export class CharacterFigure {
  readonly root = new Group();
  private rig: CharacterRig | null = null;
  private body: BodyId | null = null;
  private readonly geometries: BufferGeometry[] = [];
  private readonly held = new Map<HeldId, Group>();
  private readonly hats = new Map<ItemId, Group>();
  private readonly gear = new Map<ItemId, Group>();
  private look: Appearance = { ...DEFAULT_APPEARANCE };
  private classId: string | null = null;
  private worn: Worn = { ...NO_WORN };
  private holding: ItemId | null = null;
  private clip: ClipId = 'idle';
  private clipTime = 0;

  constructor() {
    for (const id of Object.keys(HELD) as HeldId[]) {
      if (id === 'torch') continue;
      const g = buildHeldModel(id, this.geometries);
      g.visible = false;
      this.held.set(id, g);
    }
    this.buildHats();
    this.buildGear();
    this.rebuild();
  }

  setAppearance(a: Appearance, classId: string | null = this.classId): void {
    this.look = { ...a };
    this.classId = classId;
    this.rebuild();
  }

  /** What is worn and held (dirt and tint stay with the model's own texture). */
  setOutfit(worn: Worn, hand: ItemId | null, _dirt?: Record<WearSlot, number>, _tint?: Partial<Record<WearSlot, number>>): void {
    this.worn = { ...worn };
    this.holding = hand;
    this.rebuild();
  }

  /** A frame of a clip to stand in (the preview sheet: walk, run). */
  setPose(clip: ClipId, time = 0): void {
    this.clip = clip;
    this.clipTime = time;
    this.pose();
  }

  /** The rig (PlayerDeath takes it over). */
  get skinned(): CharacterRig {
    return this.rig!;
  }

  get bodyId(): BodyId {
    return this.body!;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.rig?.dispose();
  }

  private heldItem(): HeldId | null {
    const id = this.holding;
    return id && id in HELD && this.held.has(id as HeldId) ? (id as HeldId) : null;
  }

  private rebuild(): void {
    const body = bodyFor(this.look, this.classId);
    if (body !== this.body) {
      const old = this.rig;
      this.body = body;
      this.rig = new CharacterRig(body, 0);
      this.root.add(this.rig.root);
      this.attach();
      if (old) {
        this.root.remove(old.root);
        old.dispose();
      }
    }
    this.rig!.root.scale.setScalar(figureScale(this.look, body));
    for (const [hid, g] of this.hats) g.visible = this.worn.head === hid;
    for (const [gid, g] of this.gear) g.visible = this.worn.vest === gid || this.worn.back === gid;
    const id = this.heldItem();
    for (const [hid, g] of this.held) g.visible = id === hid;
    this.pose();
  }

  /** Into the sockets: held items in the right hand's grip, hats on Head, vests and bags on Spine2. */
  private attach(): void {
    const r = this.rig!;
    const head = r.socket('head');
    const k = bodyAsset(this.body!).height / 1.8;
    for (const g of this.hats.values()) {
      head.add(g);
      g.position.set(0, 0.105 * k, 0.012 * k);
      g.rotation.set(0, Math.PI, 0);
      g.scale.setScalar(k);
    }
    const back = r.socket('back');
    for (const g of this.gear.values()) {
      back.add(g);
      // Built facing −Z about a chest 0.25 m above the hips: turned to the model's +Z.
      g.position.set(0, -0.06 * k, 0.01 * k);
      g.rotation.set(0, Math.PI, 0);
      g.scale.setScalar(k);
    }
    const hand = r.socket('hand');
    const hf = handFrame(r.rig, 'R');
    for (const [id, g] of this.held) {
      hand.add(g);
      if (!hf) continue;
      g.quaternion.copy(hf.q);
      g.position.copy(hf.grip).sub(new Vector3(0, HELD[id].main.along, 0).applyQuaternion(hf.q));
    }
  }

  private pose(): void {
    const r = this.rig!;
    r.hold(this.clip, this.clipTime);
    if (this.heldItem()) {
      const hf = handFrame(r.rig, 'R');
      if (hf) for (const [i, q] of hf.fist) r.bones[i].quaternion.copy(q);
      // The right forearm brought forward a little: the item clear of the leg.
      const fore = r.bone('RightForeArm');
      fore.quaternion.multiply(_q.setFromAxisAngle(_x, -0.5));
      r.root.updateMatrixWorld(true);
    }
  }

  /**
   * Vests and bags: boxes over the chest and on the back, sized to an average build (placeholders until
   * the gear is fitted: they ride on the Spine2 socket).
   */
  private buildGear(): void {
    const box = (sx: number, sy: number, sz: number) => this.geo(new BoxGeometry(sx, sy, sz));
    const chestY = 0;
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
    const vest = box(0.36, 0.4, 0.25);
    const pouch = box(0.08, 0.1, 0.05);
    make('swatVest', [[vest, 0, chestY, 0], [box(0.3, 0.12, 0.04), 0, chestY + 0.05, -0.135]]);
    make('policeVest', [[vest, 0, chestY, 0]]);
    make('tacticalRig', [[box(0.35, 0.36, 0.24), 0, chestY, 0], [pouch, -0.1, chestY - 0.08, -0.14], [pouch, 0, chestY - 0.08, -0.14], [pouch, 0.1, chestY - 0.08, -0.14]]);
    const strap = box(0.04, 0.42, 0.02);
    const backY = chestY - 0.02;
    make('schoolBackpack', [[box(0.28, 0.34, 0.12), 0, backY, 0.19], [strap, -0.1, backY + 0.02, -0.125], [strap, 0.1, backY + 0.02, -0.125]]);
    make('hikingBackpack', [[box(0.32, 0.56, 0.2), 0, backY + 0.06, 0.22], [box(0.3, 0.1, 0.16), 0, backY + 0.38, 0.21], [strap, -0.1, backY + 0.02, -0.125], [strap, 0.1, backY + 0.02, -0.125]]);
    make('armyBackpack', [[box(0.36, 0.46, 0.22), 0, backY + 0.02, 0.23], [box(0.12, 0.18, 0.08), -0.2, backY - 0.06, 0.21], [box(0.12, 0.18, 0.08), 0.2, backY - 0.06, 0.21], [strap, -0.1, backY + 0.02, -0.125], [strap, 0.1, backY + 0.02, -0.125]]);
    make('sportsBag', [[this.geo(new CylinderGeometry(0.11, 0.11, 0.42, 10).rotateZ(Math.PI / 2)), 0.05, -0.3, 0.18], [box(0.03, 0.6, 0.02), 0, chestY, 0, 0.6]]);
    make('medBag', [[box(0.22, 0.18, 0.1), 0.24, -0.3, 0.02], [box(0.08, 0.02, 0.105), 0.24, -0.28, 0.02], [box(0.03, 0.6, 0.02), 0, chestY, 0, -0.6]]);
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

const _q = new Quaternion();
const _x = new Vector3(1, 0, 0);
