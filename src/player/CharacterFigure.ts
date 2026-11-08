import { type BufferGeometry, Group, Matrix4, Mesh, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { type BodyId, bodyAsset, bodyNow, type ClipId, costumeBody, loadBody } from '../characters/assets';
import { boxInHand, coverBody, gearGeometry, gearKind, gearTexture, hideBits, loadGear, wornGear } from '../characters/gear';
import { handFrame } from '../characters/hands';
import { gripHands } from './grips';
import { characterMaterial, LENS_TINT } from '../characters/material';
import { CharacterRig } from '../characters/rig';
import { type ItemId, ITEMS, type WearSlot } from '../data/items';
import type { Worn } from '../systems/Inventory';
import { type Appearance, DEFAULT_APPEARANCE } from './appearance';
import { buildHeldModel, HELD, type HeldId } from './held';

const NO_WORN: Worn = { outfit: null, head: null, face: null, mask: null, torso: null, vest: null, hands: null, legs: null, feet: null, back: null, bag: null };

/** The model a survivor wears: the costume in the outfit slot (men; women keep their base body), else a man or a woman. */
export function bodyFor(look: Pick<Appearance, 'sex'>, outfit?: ItemId | null): BodyId {
  return costumeBody(outfit ? ITEMS[outfit].wear?.costume : null, look.sex);
}

/** The figure's scale for a look's height (cm) on its body's model. */
export function figureScale(look: Pick<Appearance, 'height'>, body: BodyId): number {
  return look.height / 100 / bodyAsset(body).height;
}

/**
 * The survivor as a whole — the character model (src/characters): a man, a woman, or a man in a class costume,
 * scaled to the look's height, standing at ease (the first frame of `idle`). What is held rides in the
 * right hand (the RightHand socket, the fist closed on its grip). Gear is the fitted models (characters/gear):
 * skinned to the same skeleton, the body under them not drawn; the toolbox in the free right hand, on the hip
 * when something is held.
 * The inventory figure, the character editor and the body on death (PlayerDeath drives its bones from the
 * ragdoll).
 */
export class CharacterFigure {
  readonly root = new Group();
  private rig: CharacterRig | null = null;
  private body: BodyId | null = null;
  private readonly geometries: BufferGeometry[] = [];
  private readonly held = new Map<HeldId, Group>();
  private readonly gear = new Map<string, Mesh>();
  private readonly hide = { value: 0 };
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

  private disposed = false;

  dispose(): void {
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    this.dropGear();
    this.rig?.dispose();
  }

  private heldItem(): HeldId | null {
    const id = this.holding;
    const h = id && id in HELD && this.held.has(id as HeldId) ? (id as HeldId) : null;
    // A toolbox carried takes the right hand from a one-handed tool (it rides in the pack meanwhile);
    // a two-handed weapon keeps the hands, the box goes to the hip.
    if (h && !HELD[h].twoHanded && this.boxWorn()) return null;
    return h;
  }

  private boxWorn(): boolean {
    return wornGear(this.worn).some((g) => gearKind(g) === 'box');
  }

  /** Called when something that was loading came in and the figure changed (a still preview redraws). */
  onChange: (() => void) | null = null;

  private rebuild(): void {
    const want = bodyFor(this.look, this.worn.outfit);
    const body = bodyNow(want);
    // A costume not loaded yet: the base body until it is, then the costume.
    if (body !== want) void loadBody(want).then(() => !this.disposed && bodyFor(this.look, this.worn.outfit) === want && (this.rebuild(), this.onChange?.()));
    if (body !== this.body) {
      const old = this.rig;
      this.body = body;
      this.dropGear();
      coverBody(body);
      this.rig = new CharacterRig(body, 0, { cover: true, hide: this.hide });
      this.root.add(this.rig.root);
      this.attach();
      if (old) {
        this.root.remove(old.root);
        old.dispose();
      }
    }
    this.rig!.root.scale.setScalar(figureScale(this.look, body));
    this.dress();
    const id = this.heldItem();
    for (const [hid, g] of this.held) g.visible = id === hid;
    this.pose();
  }

  /** The gear worn, on this body: skinned pieces on its skeleton (the toolbox in the free hand is held). */
  private dress(): void {
    const r = this.rig!;
    const body = this.body!;
    const want = wornGear(this.worn);
    const inHand = !this.heldItem();
    const keys = new Set(want.flatMap((g) => (gearKind(g) === 'box' && inHand ? [`${g}:hand`] : [g, `${g}:lens`])));
    for (const [k, m] of this.gear)
      if (!keys.has(k)) {
        m.removeFromParent();
        (m.material as { dispose(): void }).dispose();
        this.gear.delete(k);
      }
    let missing = false;
    for (const g of want) {
      const hand = gearKind(g) === 'box' && inHand;
      const key = hand ? `${g}:hand` : g;
      if (this.gear.has(key)) continue;
      const mat = characterMaterial(bodyAsset(body), r.rig, { map: gearTexture(g) });
      if (hand) {
        const hf = handFrame(r.rig, 'R');
        const b = hf && boxInHand(g);
        if (!b || !hf) {
          missing = true;
          mat.dispose();
          continue;
        }
        // Hanging from the fist: upright in the figure's frame whatever the arm does (a box swings on its
        // handle, it does not turn with the wrist).
        const gripInHand = hf.grip.clone();
        const hang = new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(-1, 0, 0)).setPosition(0, 0.012 - b.top, 0);
        const m = new Mesh(b.geometry, mat);
        m.matrixAutoUpdate = false;
        const socket = r.socket('hand');
        const root = r.root;
        const at = new Vector3();
        m.updateMatrixWorld = () => {
          at.copy(gripInHand).applyMatrix4(socket.matrixWorld);
          m.matrixWorld.copy(root.matrixWorld).setPosition(0, 0, 0).multiply(hang);
          m.matrixWorld.elements[12] += at.x;
          m.matrixWorld.elements[13] += at.y;
          m.matrixWorld.elements[14] += at.z;
        };
        socket.add(m);
        this.gear.set(key, m);
        continue;
      }
      const geo = gearGeometry(body, g, 0);
      if (!geo) {
        missing = true;
        mat.dispose();
        continue;
      }
      const m = new SkinnedMesh(geo, mat);
      m.bind(r.mesh.skeleton, r.mesh.bindMatrix);
      m.frustumCulled = false;
      m.castShadow = true;
      r.mesh.add(m);
      this.gear.set(key, m);
      // Glasses: the lenses in their own see-through material, drawn after the face.
      const lg = gearGeometry(body, g, 0, 'lens');
      if (lg && !this.gear.has(`${g}:lens`)) {
        const l = new SkinnedMesh(lg, characterMaterial(bodyAsset(body), r.rig, { lens: LENS_TINT[g] ?? 0x1e1f1d }));
        l.bind(r.mesh.skeleton, r.mesh.bindMatrix);
        l.frustumCulled = false;
        l.renderOrder = 2;
        r.mesh.add(l);
        this.gear.set(`${g}:lens`, l);
      }
    }
    this.hide.value = hideBits(want.filter((g) => !(gearKind(g) === 'box' && inHand)));
    if (missing) void loadGear(body, want).then(() => !this.disposed && this.body === body && (coverBody(body), this.rebuild(), this.onChange?.()));
  }

  private dropGear(): void {
    for (const m of this.gear.values()) {
      m.removeFromParent();
      (m.material as { dispose(): void }).dispose();
    }
    this.gear.clear();
  }

  /** Into the sockets: held items in the right hand's grip. */
  private attach(): void {
    const r = this.rig!;
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
    const item = this.heldItem();
    const held = !!item;
    // The free left hand a little bent; the right as its item says (data/grips.json), a fist on a box's handle.
    const hl = handFrame(r.rig, 'L');
    if (hl) for (const [i, q] of hl.poses.relaxed) r.bones[i].quaternion.copy(q);
    const hr = handFrame(r.rig, 'R');
    if (hr && !held) for (const [i, q] of hr.poses.relaxed) r.bones[i].quaternion.copy(q);
    if (held || this.gear.has(`${this.worn.bag ? ITEMS[this.worn.bag].wear?.gear : ''}:hand`)) {
      if (hr) for (const [i, q] of hr.poses[held ? gripHands(item, false, false).R : 'grip_fist']) r.bones[i].quaternion.copy(q);
      // The right forearm brought forward a little: a held item clear of the leg (a toolbox just hangs).
      if (held) r.bone('RightForeArm').quaternion.multiply(_q.setFromAxisAngle(_x, -0.5));
      r.root.updateMatrixWorld(true);
    }
  }
}

const _q = new Quaternion();
const _x = new Vector3(1, 0, 0);
