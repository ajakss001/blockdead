import { type AnimationAction, Group, LoopOnce, Quaternion, Vector3 } from 'three';
import type { BodyId, ClipId } from '../characters/assets';
import { CharacterRig, stand } from '../characters/rig';

/**
 * The player's own body in first person: the same character model as in the inventory, feet where the
 * controller stands, facing the view. Its clips follow the speed and the state — idle, walking (the
 * woman's walk for her), running, crouched walking, the jump — blended. The head is folded away (its bone
 * scaled to nothing) and so are the arms (the first-person arms with the weapon are the viewmodel's);
 * the camera sits in the head bone, so looking down you see your own legs and body. Looking down bends
 * the spine and neck a little, which brings the head forward over the belly.
 */

const SPEED_WALK = 1.4;
const SPEED_RUN = 3.6;
/** The eyes from the head bone (its frame: +Y up the skull, +Z the face), m on a 1.8 m body. */
const EYE = new Vector3(0, 0.085, 0.1);

type Gait = 'idle' | 'walk' | 'run' | 'crouch';

export class BodyModel {
  readonly root = new Group();
  private rig: CharacterRig | null = null;
  private body: BodyId | null = null;
  private scale = 1;
  private gaits: Record<Gait, AnimationAction> | null = null;
  private jump: AnimationAction | null = null;
  private airT = 0;
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
    if (this.rig) this.root.remove(this.rig.root);
    this.body = body;
    const r = new CharacterRig(body, 0);
    r.mesh.castShadow = true;
    this.root.add(r.root);
    this.rig = r;
    const walk: ClipId = body === 'female' ? 'walking_female' : 'walking';
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

  /** Torso shown (always: the head and arms are folded away). */
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
    for (const n of ['Head', 'LeftArm', 'RightArm']) r.bone(n).scale.setScalar(1e-3);
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

const _q = new Quaternion();
const _x = new Vector3(1, 0, 0);
const _h = new Vector3();
