import { type AnimationAction, type Bone, BufferGeometry, Group, LoopOnce, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { baseOf, bodyAsset, type BodyId, type ClipId } from '../characters/assets';
import { coverBody, gearGeometry, gearKind, gearTexture, hideBits, loadGear } from '../characters/gear';
import { characterMaterial } from '../characters/material';
import { CharacterRig, stand } from '../characters/rig';
import type { GearId } from '../data/items';

/**
 * The player's own body in first person: the same character model as in the inventory, feet where the
 * controller stands, facing the view. Its clips follow the speed and the state — idle, walking (the
 * woman's walk for her), running, crouched walking, the jump — blended. Drawn without its head and arms
 * (fpBodyGeometry; the first-person arms with the weapon are the viewmodel's);
 * the camera sits in the head bone, so looking down you see your own legs and body. Looking down bends
 * the spine and neck a little, which brings the head forward over the belly.
 *
 * Gear on it as on the figure (characters/gear), but never in the way: no helmet (it is round the eyes), and
 * nothing of a vest's collar or the straps nearer the eye than NEAR; the toolbox only when it is on the hip.
 */
const NEAR = 0.22;

const SPEED_WALK = 1.4;
const SPEED_RUN = 3.6;
/** The eyes from the head bone (its frame: +Y up the skull, +Z the face), m on a 1.8 m body. */
const EYE = new Vector3(0, 0.085, 0.1);

type Gait = 'idle' | 'walk' | 'run' | 'crouch';

export class BodyModel {
  readonly root = new Group();
  private rig: CharacterRig | null = null;
  private readonly hide = { value: 0 };
  private readonly gear = new Map<GearId, SkinnedMesh>();
  private gearWant: GearId[] = [];

  /** The model's bones (tests). */
  get bones(): readonly Bone[] {
    return this.rig?.bones ?? [];
  }
  private body: BodyId | null = null;
  private scale = 1;
  private gaits: Record<Gait, AnimationAction> | null = null;
  private jump: AnimationAction | null = null;
  private airT = 0;
  private posed = false;
  private readonly w: Record<Gait, number> = { idle: 1, walk: 0, run: 0, crouch: 0 };
  private readonly eye = new Vector3();
  private eyeSet = false;
  /** The eyes above the feet standing and crouched (model frame, unscaled). */
  private eyeY: [number, number] = [1.62, 1.08];

  /** The model for the survivor (a man, a woman, the SWAT officer), scaled to their height. */
  setBody(body: BodyId, scale: number): void {
    this.scale = scale;
    this.root.scale.setScalar(scale);
    if (body === this.body) return;
    this.rig?.dispose();
    this.posed = false;
    if (this.rig) this.root.remove(this.rig.root);
    this.body = body;
    for (const m of this.gear.values()) (m.material as { dispose(): void }).dispose();
    this.gear.clear();
    coverBody(body);
    const r = new CharacterRig(body, 0, { cover: true, hide: this.hide }, fpBodyGeometry(body));
    r.mesh.castShadow = true;
    this.root.add(r.root);
    this.rig = r;
    this.dress();
    const walk: ClipId = baseOf(body) === 'female' ? 'walking_female' : 'walking';
    this.gaits = { idle: r.action('idle'), walk: r.action(walk), run: r.action('running'), crouch: r.action('crouched_walking') };
    for (const a of Object.values(this.gaits)) a.play();
    this.jump = r.action('jump').setLoop(LoopOnce, 1);
    this.jump.clampWhenFinished = true;
    const t = new CharacterRig(body, 0);
    this.eyeY = (['idle', 'crouched_walking'] as const).map((c) => {
      t.hold(c, 0);
      const head = t.bone('Head');
      return head.parent!.localToWorld(_h.copy(EYE).applyQuaternion(head.quaternion).add(head.position)).y;
    }) as [number, number];
    t.dispose();
  }

  /** The eyes above the feet for a crouch (0..1), m. */
  standEye(crouchT: number): number {
    return (this.eyeY[0] + (this.eyeY[1] - this.eyeY[0]) * crouchT) * this.scale;
  }

  /** The gear worn (`handFree`: the toolbox is in the hand, so not on the hip). */
  setGear(gear: readonly GearId[], handFree: boolean): void {
    this.gearWant = gear.filter((g) => gearKind(g) !== 'helmet' && !(gearKind(g) === 'box' && handFree));
    this.dress();
  }

  /** The gear on its body (the ones still loading come when they are in). */
  private dress(): void {
    const r = this.rig;
    const body = this.body;
    if (!r || !body) return;
    for (const [g, m] of this.gear)
      if (!this.gearWant.includes(g)) {
        m.removeFromParent();
        (m.material as { dispose(): void }).dispose();
        this.gear.delete(g);
      }
    let missing = false;
    for (const g of this.gearWant) {
      if (this.gear.has(g)) continue;
      const geo = gearGeometry(body, g, 0);
      if (!geo) {
        missing = true;
        continue;
      }
      const m = new SkinnedMesh(geo, characterMaterial(bodyAsset(body), r.rig, { map: gearTexture(g), near: NEAR }));
      m.bind(r.mesh.skeleton, r.mesh.bindMatrix);
      m.frustumCulled = false;
      m.castShadow = true;
      r.mesh.add(m);
      this.gear.set(g, m);
    }
    this.hide.value = hideBits(this.gearWant);
    const want = this.gearWant;
    if (missing) void loadGear(body, want).then(() => this.body === body && this.gearWant === want && (coverBody(body), this.dress()));
  }

  /** Torso shown (the head and arms are not in its geometry). */
  set torsoVisible(v: boolean) {
    if (this.rig) this.rig.mesh.visible = v;
  }

  /**
   * Feet at (x, y, z), facing `yaw` (the view's), the gait by speed and crouch; `pitch` the view's
   * (looking down bends the back); `air` whether it is off the ground; `dt` for the clips.
   */
  update(x: number, y: number, z: number, yaw: number, speed: number, crouchT: number, pitch: number, air: boolean, dt: number): void {
    const r = this.rig;
    if (!r || !this.gaits) return;
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw + Math.PI, 0);
    // Paused (no world time): the pose stays exactly as it was.
    if (dt <= 0 && this.posed) {
      this.root.updateMatrixWorld(true);
      return;
    }
    this.posed = true;
    const g = this.gaits;
    const move = Math.min(1, speed / 0.6);
    const run = Math.min(1, Math.max(0, (speed - SPEED_WALK) / (SPEED_RUN - SPEED_WALK)));
    const target: Record<Gait, number> = {
      idle: (1 - move) * (1 - crouchT),
      walk: move * (1 - run) * (1 - crouchT),
      run: move * run * (1 - crouchT),
      crouch: crouchT,
    };
    const k = 1 - Math.exp(-10 * dt);
    for (const n of Object.keys(target) as Gait[]) {
      this.w[n] += (target[n] - this.w[n]) * k;
      g[n].setEffectiveWeight(this.w[n]);
    }
    // Steps in time with the ground covered: the clips' own speed at their own pace.
    g.walk.timeScale = Math.max(0.6, speed / SPEED_WALK);
    g.run.timeScale = Math.max(0.7, speed / SPEED_RUN);
    g.crouch.timeScale = speed < 0.1 ? 0 : Math.max(0.5, speed / 1.2);
    // The jump: from the take-off, while in the air (its hips stay the controller's).
    const j = this.jump!;
    if (air) {
      if (this.airT === 0) j.reset().play().time = 0.35;
      this.airT += dt;
    } else if (this.airT > 0) {
      this.airT = 0;
      j.fadeOut(0.2);
    }
    j.setEffectiveWeight(air ? Math.min(1, this.airT / 0.1) : j.getEffectiveWeight());
    r.restPose();
    r.mixer.update(dt);
    // Looking down: the back and the neck bend (the head comes forward over the belly).
    const down = Math.max(0, -pitch - 0.2);
    r.bone('Spine1').quaternion.multiply(_q.setFromAxisAngle(_x, down * 0.18));
    r.bone('Spine2').quaternion.multiply(_q.setFromAxisAngle(_x, down * 0.18));
    r.bone('Neck').quaternion.multiply(_q.setFromAxisAngle(_x, down * 0.3));
    // Air: the hips at the controller's height (the clip's own rise taken out).
    if (air) r.bone('Hips').position.y = this.hipsY();
    this.root.updateMatrixWorld(true);
  }

  /** The hips' height standing at ease (model frame). */
  private hipsY(): number {
    const r = this.rig!;
    return stand(r.body, 0).world[r.rig.index.get('Hips')!].elements[13];
  }

  /** The eyes (world): in the head bone, its motion smoothed a little (`dt`), never through a wall. */
  eyePosition(out: Vector3, dt: number): Vector3 {
    const r = this.rig;
    if (!r) return out.copy(this.root.position).setY(this.root.position.y + 1.62);
    const head = r.bone('Head');
    // The head bone is scaled to nothing: its parent's frame carries the eye.
    _h.copy(EYE).applyQuaternion(head.quaternion).add(head.position);
    head.parent!.localToWorld(_h);
    if (!this.eyeSet) this.eye.copy(_h);
    else {
      const k = 1 - Math.exp(-25 * dt);
      this.eye.lerp(_h, k);
    }
    this.eyeSet = true;
    return out.copy(this.eye);
  }

  dispose(): void {
    this.rig?.dispose();
  }
}

/**
 * The body as the player sees it from inside: the model without its head and arms (the arms are
 * player/fpArms, the head is where the eyes are). Whole triangles go — any corner on the head or the neck's top
 * (≥ 30%) or on an arm (≥ 50%) — so nothing is folded away by squashing bones (that stretched the skin across
 * the view). Shared per body.
 */
const fpGeos = new Map<BodyId, BufferGeometry>();
function fpBodyGeometry(body: BodyId): BufferGeometry {
  let g = fpGeos.get(body);
  if (g) return g;
  const rig = bodyAsset(body).lod0;
  const src = rig.geometry;
  const si = src.getAttribute('skinIndex');
  const sw = src.getAttribute('skinWeight');
  const isHead = rig.names.map((n) => n === 'Head' || n.startsWith('HeadTop') || n.includes('Eye'));
  const isArm = rig.names.map((n) => /^(Left|Right)(Arm|ForeArm|Hand)/.test(n));
  const n = si.count;
  const head = new Float32Array(n);
  const arm = new Float32Array(n);
  for (let v = 0; v < n; v++)
    for (let k = 0; k < 4; k++) {
      const j = si.getComponent(v, k);
      if (isHead[j]) head[v] += sw.getComponent(v, k);
      if (isArm[j]) arm[v] += sw.getComponent(v, k);
    }
  const off = (v: number) => head[v] >= 0.3 || arm[v] >= 0.5;
  const idx = src.index!;
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (!off(a) && !off(b) && !off(c)) keep.push(a, b, c);
  }
  g = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'aCover']) if (src.getAttribute(name)) g.setAttribute(name, src.getAttribute(name));
  g.setIndex(keep);
  g.boundingBox = src.boundingBox ?? (src.computeBoundingBox(), src.boundingBox);
  fpGeos.set(body, g);
  return g;
}

const _q = new Quaternion();
const _x = new Vector3(1, 0, 0);
const _h = new Vector3();
