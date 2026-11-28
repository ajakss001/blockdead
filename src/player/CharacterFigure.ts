import { type BufferGeometry, Group, Matrix4, Mesh, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { type BodyId, bodyAsset, bodyNow, type ClipId, costumeBody, loadBody } from '../characters/assets';
import { boxInHand, coverBody, gearGeometry, gearKind, gearTexture, hideBits, loadGear, wornGear } from '../characters/gear';
import { handFrame, type HandFrame } from '../characters/hands';
import { slerpBoneWorld, solveTwoBoneIK } from '../characters/ik';
import { gripHands } from './grips';
import { characterMaterial, LENS_TINT } from '../characters/material';
import { CharacterRig } from '../characters/rig';
import { type ItemId, ITEMS, type WearSlot } from '../data/items';
import type { Worn } from '../systems/Inventory';
import { type Appearance, DEFAULT_APPEARANCE } from './appearance';
import { basisQuat } from './armRig';
import { buildHeldModel, HELD, type HeldId } from './held';
import { gunRigData } from './gunPose';
import { GunModel } from '../weapons/gunModel';
import { GUN_IDS, GUNS, type GunId, type ModId } from '../weapons/guns';

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
  /** Guns in the right hand: the gun frame placed so its grip_main hand frame (data/grips.json) sits in the fist. */
  private readonly gunModels = new Map<GunId, GunModel>();
  private readonly gear = new Map<string, Mesh>();
  private readonly hide = { value: 0 };
  private look: Appearance = { ...DEFAULT_APPEARANCE };
  private classId: string | null = null;
  private worn: Worn = { ...NO_WORN };
  private holding: ItemId | null = null;
  private handMods: readonly ModId[] = [];
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

  /** What is worn and held (dirt and tint stay with the model's own texture; optional weapon mods shown on firearms). */
  setOutfit(
    worn: Worn,
    hand: ItemId | null,
    _dirt?: Record<WearSlot, number>,
    _tint?: Partial<Record<WearSlot, number>>,
    handMods: readonly ModId[] = [],
  ): void {
    this.worn = { ...worn };
    this.holding = hand;
    this.handMods = handMods;
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

  private heldGun(): GunId | null {
    const id = this.holding as GunId | null;
    return id && GUN_IDS.includes(id) ? id : null;
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
    const gun = this.heldGun();
    if (gun && !this.gunModels.has(gun)) {
      const gm = new GunModel(gun);
      gm.onChange = () => !this.disposed && this.onChange?.();
      this.gunModels.set(gun, gm);
      this.attach();
    }
    if (gun) this.gunModels.get(gun)!.setMods(this.handMods);
    for (const [gid, gm] of this.gunModels) gm.root.visible = gun === gid;
    this.pose();
  }

  /** The gear worn, on this body: skinned pieces on its skeleton (the toolbox in the free hand is held). */
  private dress(): void {
    const r = this.rig!;
    const body = this.body!;
    const want = wornGear(this.worn);
    const inHand = !this.heldItem() && !this.heldGun();
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
      const mat = characterMaterial(bodyAsset(body), r.rig, { map: gearTexture(g), doubleSide: gearKind(g) === 'mask' });
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
      g.userData.rest = { p: g.position.clone(), q: g.quaternion.clone(), grip: hf.grip.clone() };
    }
    for (const [id, gm] of this.gunModels) {
      const g = gm.root;
      hand.add(g);
      if (!hf) continue;
      const d = gunRigData(id).main;
      _m.compose(hf.grip, hf.q, _one).multiply(_m2.compose(d.at, d.q, _one).invert());
      _m.decompose(g.position, g.quaternion, g.scale);
      g.userData.rest = { p: g.position.clone(), q: g.quaternion.clone(), grip: hf.grip.clone() };
    }
  }

  /**
   * The held item turned the way it is carried at ease: a hand weapon's head forward and a little down from the
   * lowered fist, a gun's barrel down. The turn is split as in the game's hands (CLAUDE.md): its twist about
   * the forearm half on the forearm, half on the wrist, the rest bends the wrist.
   */
  private aim(item: Group, axis: Vector3, want: Vector3): void {
    const r = this.rig!;
    // From its place in the grip each time (the turn below is not added up frame after frame).
    const rest = item.userData.rest as { p: Vector3; q: Quaternion; grip: Vector3 } | undefined;
    if (rest) item.position.copy(rest.p), item.quaternion.copy(rest.q);
    r.root.updateMatrixWorld(true);
    const fore = r.bone('RightForeArm'), hand = r.bone('RightHand');
    const cur = axis.clone().applyQuaternion(item.getWorldQuaternion(_q2)).normalize();
    const to = want.clone().normalize().applyQuaternion(r.root.getWorldQuaternion(_q3));
    const delta = new Quaternion().setFromUnitVectors(cur, to);
    const along = hand.getWorldPosition(new Vector3()).sub(fore.getWorldPosition(new Vector3())).normalize();
    const p = new Vector3(delta.x, delta.y, delta.z).projectOnVector(along);
    const twist = new Quaternion(p.x, p.y, p.z, delta.w).normalize();
    const swing = delta.clone().multiply(twist.clone().invert());
    // The arm takes only a part of it (the wrist's limits, CLAUDE.md: a hand at ease is not wrung): the twist up
    // to 40°, the bend up to 30°; the rest turns the item in the hand.
    const cap = (q: Quaternion, max: number) => {
      const a = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      return a <= max ? q : new Quaternion().slerp(q, max / a);
    };
    const half = new Quaternion().slerp(cap(twist, 0.7), 0.5);
    const turn = (b: typeof hand, q: Quaternion) => {
      const w = b.getWorldQuaternion(new Quaternion());
      const pw = b.parent!.getWorldQuaternion(new Quaternion());
      b.quaternion.copy(pw.invert().multiply(q).multiply(w));
      r.root.updateMatrixWorld(true);
    };
    turn(fore, half);
    turn(hand, cap(swing, 0.52).multiply(half));
    // What is left: the item itself turned about its grip until its axis points where it should.
    const now = axis.clone().applyQuaternion(item.getWorldQuaternion(_q2)).normalize();
    const left = new Quaternion().setFromUnitVectors(now, to);
    // That turn in the hand's frame, about the grip (the fist stays on the handle).
    const pw = item.parent!.getWorldQuaternion(new Quaternion());
    const local = pw.clone().invert().multiply(left).multiply(pw);
    item.quaternion.premultiply(local);
    if (rest) item.position.sub(rest.grip).applyQuaternion(local).add(rest.grip);
    item.updateMatrixWorld(true);
  }

  /**
   * The right forearm brought forward by `angle` (rad): turned in the world about the elbow's hinge (the forearm
   * and the body's forward), not about the bone's own x (on these rigs that swung the hand out to the side).
   */
  private bendElbow(angle: number): void {
    const r = this.rig!;
    r.root.updateMatrixWorld(true);
    const fore = r.bone('RightForeArm');
    const dir = r.bone('RightHand').getWorldPosition(new Vector3()).sub(fore.getWorldPosition(new Vector3())).normalize();
    const fwd = new Vector3(0, 0, 1).applyQuaternion(r.root.getWorldQuaternion(_q3));
    const axis = dir.clone().cross(fwd);
    if (axis.lengthSq() < 1e-6) return;
    const q = new Quaternion().setFromAxisAngle(axis.normalize(), angle);
    const w = fore.getWorldQuaternion(new Quaternion());
    const pw = fore.parent!.getWorldQuaternion(new Quaternion());
    fore.quaternion.copy(pw.invert().multiply(q).multiply(w));
    r.root.updateMatrixWorld(true);
  }

  private pose(): void {
    const r = this.rig!;
    r.hold(this.clip, this.clipTime);
    const item = this.heldItem();
    const held = !!item;
    const gun = this.heldGun();
    // The free left hand a little bent; the right as its item says (data/grips.json), a fist on a box's handle.
    const hl = handFrame(r.rig, 'L');
    if (hl) for (const [i, q] of hl.poses.relaxed) r.bones[i].quaternion.copy(q);
    const hr = handFrame(r.rig, 'R');
    if (hr && !held && !gun) for (const [i, q] of hr.poses.relaxed) r.bones[i].quaternion.copy(q);
    if (held || this.gear.has(`${this.worn.bag ? ITEMS[this.worn.bag].wear?.gear : ''}:hand`)) {
      if (hr) for (const [i, q] of hr.poses[held ? gripHands(item, false, false).R : 'grip_fist']) r.bones[i].quaternion.copy(q);
      // The right forearm brought forward a little: a held item clear of the leg (a toolbox just hangs).
      if (held) this.bendElbow(0.5);
      r.root.updateMatrixWorld(true);
      const melee = item && this.held.get(item);
      if (melee) this.aim(melee, _y, _fwd);
    }
    const gm = gun && this.gunModels.get(gun);
    if (gun && gm && hr) {
      this.poseGunAim(gun, gm, hr, hl);
    }
  }

  /**
   * Tactical two-handed aiming stance for firearms in the inventory/character preview:
   * rotates the torso into a bladed stance, anchors the gun in the shoulder pocket/eyesight line,
   * solves 2-bone IK + wrist alignment for both hands, and curls right/left fingers onto the weapon.
   */
  private poseGunAim(gun: GunId, gm: GunModel, hr: HandFrame, hl: HandFrame | null): void {
    const r = this.rig!;
    const d = gunRigData(gun);
    const cls = GUNS[gun].cls;
    const sc = figureScale(this.look, this.body!);

    const rest = gm.root.userData.rest as { p: Vector3; q: Quaternion; grip: Vector3 } | undefined;
    if (rest) {
      gm.root.position.copy(rest.p);
      gm.root.quaternion.copy(rest.q);
    }
    gm.root.scale.set(1, 1, 1);

    // 1. Pose trigger & support hand fingers.
    const gp = gripHands(gun, true, true);
    for (const [i, q] of hr.poses[gp.R]) r.bones[i].quaternion.copy(q);
    if (hl) for (const [i, q] of hl.poses[gp.L]) r.bones[i].quaternion.copy(q);

    // 2. Bladed upper-body combat stance + counter-rotated neck/head to sight forward cleanly.
    if (r.root.parent === this.root) this.root.updateMatrixWorld(true);
    else r.root.updateMatrixWorld(true);
    const rootQ = r.root.getWorldQuaternion(_q3);
    const charUp = _v1.set(0, 1, 0).applyQuaternion(rootQ).normalize();
    const charRight = _v2.set(-1, 0, 0).applyQuaternion(rootQ).normalize();
    const charFwd = _v3.set(0, 0, 1).applyQuaternion(rootQ).normalize();

    const turnBoneAxis = (name: string, axis: Vector3, angle: number) => {
      if (!angle || !r.rig.index.has(name)) return;
      const b = r.bone(name);
      if (!b.parent) return;
      const dq = _q4.setFromAxisAngle(axis, angle);
      const w = b.getWorldQuaternion(_q5);
      const pw = b.parent.getWorldQuaternion(_q6);
      b.quaternion.copy(pw.invert().multiply(dq).multiply(w));
      r.root.updateMatrixWorld(true);
    };

    if (cls === 'pistol') {
      const twist = -0.16;
      turnBoneAxis('Spine', charUp, twist * 0.34);
      turnBoneAxis('Spine1', charUp, twist * 0.36);
      turnBoneAxis('Spine2', charUp, twist * 0.30);
      turnBoneAxis('Spine1', charRight, -0.03);
      turnBoneAxis('Spine2', charRight, -0.03);
      turnBoneAxis('Neck', charUp, -twist * 0.52);
      turnBoneAxis('Head', charUp, -twist * 0.48);
      turnBoneAxis('Head', charRight, 0.04);
    } else if (cls === 'launcher') {
      const twist = -0.38;
      turnBoneAxis('Spine', charUp, twist * 0.34);
      turnBoneAxis('Spine1', charUp, twist * 0.36);
      turnBoneAxis('Spine2', charUp, twist * 0.30);
      turnBoneAxis('Neck', charUp, -twist * 0.52);
      turnBoneAxis('Head', charUp, -twist * 0.48);
      // Slight head tilt away from shoulder tube so helmet clears RPG body cleanly.
      turnBoneAxis('Head', charFwd, -0.07);
    } else {
      const twist = -0.44;
      turnBoneAxis('Spine', charUp, twist * 0.34);
      turnBoneAxis('Spine1', charUp, twist * 0.36);
      turnBoneAxis('Spine2', charUp, twist * 0.30);
      turnBoneAxis('Spine1', charRight, -0.05);
      turnBoneAxis('Spine2', charRight, -0.05);
      turnBoneAxis('Neck', charUp, -twist * 0.52);
      turnBoneAxis('Neck', charRight, 0.04);
      turnBoneAxis('Head', charUp, -twist * 0.48 + 0.15);
      turnBoneAxis('Head', charRight, 0.04);
      turnBoneAxis('Head', charFwd, 0.06);
      turnBoneAxis('LeftShoulder', charUp, -0.18);
    }

    // 3. Aiming frame & weapon orientation (gun -Z along aimFwd).
    // Long guns cant slightly inward across the chest so the stock seats in the right shoulder pocket/underarm
    // and the left hand reaches long forends cleanly without pulling the weapon into the vest.
    const aimPitch = cls === 'launcher' ? 0.08 : 0;
    const aimYaw = cls === 'long' ? 0.25 : 0;
    const aimQ = _q4
      .setFromAxisAngle(charUp, aimYaw)
      .multiply(_q5.setFromAxisAngle(charRight, aimPitch))
      .multiply(rootQ)
      .normalize();
    const aimFwd = _aimFwd.set(0, 0, 1).applyQuaternion(aimQ).normalize();
    const aimRight = _aimRight.set(-1, 0, 0).applyQuaternion(aimQ).normalize();
    const aimUp = _aimUp.crossVectors(aimRight, aimFwd).normalize();

    const qGunW = _qGunW.copy(aimQ).multiply(_qFlipY);

    // 4. Right-hand grip contact & shoulder-pocket buttstock anchor.
    _mainAt.copy(d.main.at);
    if (gun === 'rifle_ak' || gun === 'rifle_m4a1') _mainAt.x = 0.012;
    else if (gun === 'rifle_hunting') _mainAt.set(0.008, -0.010, -0.015);

    _offAt.copy(d.off.at);
    if (gun === 'rifle_hunting') _offAt.set(0.0, d.s.off.at[1] - 0.008, -0.39);

    const shoulderR = r.bone('RightArm').getWorldPosition(_pShR);
    let fwdDist: number;
    let inwardDist: number;
    let dropDist: number;
    if (cls === 'pistol') {
      fwdDist = 0.38 * sc;
      inwardDist = 0.145 * sc;
      dropDist = 0.015 * sc;
    } else if (cls === 'launcher') {
      fwdDist = 0.22 * sc;
      inwardDist = -0.045 * sc;
      dropDist = -0.055 * sc;
    } else {
      const stockBack = Math.max(0.20, d.s.back - _mainAt.z);
      fwdDist = stockBack + 0.075 * sc;
      inwardDist = 0.028 * sc;
      dropDist = 0.080 * sc;
    }

    _gripR
      .copy(shoulderR)
      .addScaledVector(aimFwd, fwdDist)
      .addScaledVector(aimRight, -inwardDist)
      .addScaledVector(aimUp, -dropDist);

    _gunPos.copy(_gripR).sub(_tmp.copy(_mainAt).applyQuaternion(qGunW));
    _gripL.copy(_gunPos).add(_tmp.copy(_offAt).applyQuaternion(qGunW));

    // 5. Convert palm grip centers into wrist world targets & anatomical 3P orientations.
    // Rifles whose grips.json hand rotations carry steep FP viewmodel sleeve twists use neutral 3P rifle frames.
    const mainQ = gun === 'rifle_ak' || gun === 'rifle_hunting' || gun === 'rifle_m4a1' ? _rifleMainQ : d.main.q;
    const offQ = gun === 'rifle_hunting' ? _rifleOffQ : d.off.q;

    _qWristR.copy(qGunW).multiply(mainQ).multiply(_q5.copy(hr.q).invert());
    _wristR.copy(_gripR).sub(_tmp.copy(hr.grip).multiplyScalar(sc).applyQuaternion(_qWristR));

    if (hl) {
      _qWristL.copy(qGunW).multiply(offQ).multiply(_q5.copy(hl.q).invert());
      _wristL.copy(_gripL).sub(_tmp.copy(hl.grip).multiplyScalar(sc).applyQuaternion(_qWristL));
    } else {
      _qWristL.copy(qGunW);
      _wristL.copy(_gripL);
    }

    // Left-arm reach guard: pull weapon only slightly if left forearm can't quite reach forend.
    const shoulderL = r.bone('LeftArm').getWorldPosition(_pShL);
    const l1 = shoulderL.distanceTo(r.bone('LeftForeArm').getWorldPosition(_tmp));
    const l2 = _tmp.distanceTo(r.bone('LeftHand').getWorldPosition(_tmp2));
    const maxReach = (l1 + l2) * 0.965;
    const distL = shoulderL.distanceTo(_wristL);
    if (distL > maxReach) {
      const pull = Math.min(cls === 'long' ? 0.035 * sc : 0.08 * sc, distL - maxReach);
      _gripR.addScaledVector(aimFwd, -pull);
      _gunPos.addScaledVector(aimFwd, -pull);
      _gripL.addScaledVector(aimFwd, -pull);
      _wristR.addScaledVector(aimFwd, -pull);
      _wristL.addScaledVector(aimFwd, -pull);
    }

    // 6. Solve analytical 2-bone IK and align both wrists.
    if (cls === 'pistol') {
      _poleR.copy(aimRight).multiplyScalar(0.55).addScaledVector(aimUp, -0.82).addScaledVector(aimFwd, -0.15);
      _poleL.copy(aimRight).multiplyScalar(-0.55).addScaledVector(aimUp, -0.82).addScaledVector(aimFwd, -0.15);
    } else if (cls === 'launcher') {
      _poleR.copy(aimRight).multiplyScalar(0.72).addScaledVector(aimUp, -0.68).addScaledVector(aimFwd, -0.15);
      _poleL.copy(aimRight).multiplyScalar(-0.45).addScaledVector(aimUp, -0.88).addScaledVector(aimFwd, -0.15);
    } else {
      _poleR.copy(aimRight).multiplyScalar(0.62).addScaledVector(aimUp, -0.78).addScaledVector(aimFwd, -0.20);
      _poleL.copy(aimRight).multiplyScalar(-0.50).addScaledVector(aimUp, -0.85).addScaledVector(aimFwd, -0.15);
    }

    solveTwoBoneIK(r, 'RightArm', 'RightForeArm', 'RightHand', _wristR, _poleR, 1);
    solveTwoBoneIK(r, 'LeftArm', 'LeftForeArm', 'LeftHand', _wristL, _poleL, 1);

    slerpBoneWorld(r.bone('RightHand'), r, _qWristR, 1);
    if (hl) slerpBoneWorld(r.bone('LeftHand'), r, _qWristL, 1);

    // 7. Re-anchor gun mesh squarely inside RightHand world transform at true 1.0 world scale.
    r.root.updateMatrixWorld(true);
    const handBone = r.socket('hand');
    _m.copy(handBone.matrixWorld).invert().multiply(_m2.compose(_gunPos, qGunW, _one));
    _m.decompose(gm.root.position, gm.root.quaternion, gm.root.scale);
    gm.root.updateMatrixWorld(true);
  }
}

const _y = new Vector3(0, 1, 0);
const _fwd = new Vector3(0, -0.55, 1);
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _aimFwd = new Vector3();
const _aimRight = new Vector3();
const _aimUp = new Vector3();
const _pShR = new Vector3();
const _pShL = new Vector3();
const _gripR = new Vector3();
const _gripL = new Vector3();
const _mainAt = new Vector3();
const _offAt = new Vector3();
const _wristR = new Vector3();
const _wristL = new Vector3();
const _poleR = new Vector3();
const _poleL = new Vector3();
const _gunPos = new Vector3();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _q4 = new Quaternion();
const _q5 = new Quaternion();
const _q6 = new Quaternion();
const _qGunW = new Quaternion();
const _rifleMainQ = basisQuat(new Vector3(-0.04, 0.99, -0.08), new Vector3(-0.40, 0.05, -0.91));
const _rifleOffQ = basisQuat(new Vector3(-0.88, 0.0, -0.47), new Vector3(0.47, 0.10, -0.88));
const _qWristR = new Quaternion();
const _qWristL = new Quaternion();
const _qFlipY = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const _m = new Matrix4();
const _m2 = new Matrix4();
const _one = new Vector3(1, 1, 1);
