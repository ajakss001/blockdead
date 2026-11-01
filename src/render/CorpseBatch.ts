import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Matrix3, Matrix4, Mesh, Sphere, Vector3 } from 'three';
import { PART, PARTS, type Ragdoll } from '../physics/ragdoll';
import { characterMaterial } from './look/materials';
import { bodyBinding } from './zombieBody';

const BIND = bodyBinding();
const VERTS = BIND.part.length;

/**
 * Every zombie corpse in one draw call: one mesh, skinned on the CPU from its ragdoll — each vertex rides
 * its part's body (rest offset × scale). While a ragdoll is awake its corpse is rewritten each frame; once
 * asleep it is written one last time and never touched again. Shoes dark, the rest tinted per zombie.
 */
export class CorpseBatch {
  readonly mesh: Mesh;
  private readonly pos: BufferAttribute;
  private readonly nor: BufferAttribute;
  private readonly col: BufferAttribute;
  private readonly uv: BufferAttribute;
  private readonly slots: { id: number; rd: Ragdoll; scale: number; done: boolean; oneArm: boolean }[] = [];

  constructor(readonly capacity: number) {
    const geo = new BufferGeometry();
    this.pos = new BufferAttribute(new Float32Array(capacity * VERTS * 3), 3).setUsage(DynamicDrawUsage);
    this.nor = new BufferAttribute(new Float32Array(capacity * VERTS * 3), 3).setUsage(DynamicDrawUsage);
    this.col = new BufferAttribute(new Float32Array(capacity * VERTS * 3), 3).setUsage(DynamicDrawUsage);
    this.uv = new BufferAttribute(new Float32Array(capacity * VERTS * 2), 2);
    for (let c = 0; c < capacity; c++) (this.uv.array as Float32Array).set(BIND.uv, c * VERTS * 2);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('normal', this.nor);
    geo.setAttribute('color', this.col);
    geo.setAttribute('uv', this.uv);
    geo.setDrawRange(0, 0);
    // Bounds would change every frame: the corpses stay near the player, always drawn.
    geo.boundingSphere = new Sphere(new Vector3(), 1e6);
    const mat = characterMaterial('jacket', 0xdedede, true);
    this.mesh = new Mesh(geo, mat);
    this.mesh.name = 'corpses';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  get count(): number {
    return this.slots.length;
  }

  /** A new corpse driven by a ragdoll; tints = skin, shirt, pants (rgb each). Full: the oldest goes. */
  add(id: number, rd: Ragdoll, scale: number, tints: Float32Array, oneArm = false): void {
    if (this.slots.length >= this.capacity) this.remove(this.slots[0].id);
    const c = this.slots.length;
    this.slots.push({ id, rd, scale, done: false, oneArm });
    const col = this.col.array as Float32Array;
    for (let v = 0; v < VERTS; v++) {
      const k = BIND.kind[v];
      const o = (c * VERTS + v) * 3;
      if (k > 2.5) col.set([0.12, 0.11, 0.1], o);
      else col.set(tints.subarray(k < 0.5 ? 0 : k < 1.5 ? 3 : 6, (k < 0.5 ? 0 : k < 1.5 ? 3 : 6) + 3), o);
    }
    this.col.addUpdateRange(c * VERTS * 3, VERTS * 3);
    this.col.needsUpdate = true;
    this.write(c);
    this.mesh.geometry.setDrawRange(0, this.slots.length * VERTS);
  }

  has(id: number): boolean {
    return this.slots.some((s) => s.id === id);
  }

  /** Drop a corpse: the last one moves into its slot. */
  remove(id: number): void {
    const i = this.slots.findIndex((s) => s.id === id);
    if (i < 0) return;
    const last = this.slots.length - 1;
    if (i !== last) {
      this.slots[i] = this.slots[last];
      for (const a of [this.pos, this.nor, this.col]) {
        const arr = a.array as Float32Array;
        arr.copyWithin(i * VERTS * 3, last * VERTS * 3, (last + 1) * VERTS * 3);
        a.addUpdateRange(i * VERTS * 3, VERTS * 3);
        a.needsUpdate = true;
      }
    }
    this.slots.pop();
    this.mesh.geometry.setDrawRange(0, this.slots.length * VERTS);
  }

  /** Rewrite the corpses whose ragdolls are still moving (and each one last time as it falls asleep). */
  update(): void {
    for (let c = 0; c < this.slots.length; c++) {
      const s = this.slots[c];
      if (s.done) continue;
      this.write(c);
      if (s.rd.asleep) s.done = true;
    }
  }

  /** Every corpse is still: nothing written this frame. */
  get settled(): boolean {
    return this.slots.every((s) => s.done);
  }

  private write(c: number): void {
    const s = this.slots[c];
    for (let p = 0; p < PARTS; p++) {
      s.rd.matrix(p, _m[p]);
      _n[p].getNormalMatrix(_m[p]);
    }
    const pos = this.pos.array as Float32Array;
    const nor = this.nor.array as Float32Array;
    const k = s.scale;
    for (let v = 0; v < VERTS; v++) {
      const p = BIND.part[v];
      const o = (c * VERTS + v) * 3;
      // The one-armed worker: no arm on that side (the body's +X, his left), its triangles fold to a point.
      const kk = s.oneArm && (p === PART.upperArmR || p === PART.foreArmR) ? 0 : k;
      _v.set(BIND.offset[v * 3] * kk, BIND.offset[v * 3 + 1] * kk, BIND.offset[v * 3 + 2] * kk).applyMatrix4(_m[p]);
      pos[o] = _v.x;
      pos[o + 1] = _v.y;
      pos[o + 2] = _v.z;
      _v.set(BIND.normal[v * 3], BIND.normal[v * 3 + 1], BIND.normal[v * 3 + 2]).applyMatrix3(_n[p]);
      nor[o] = _v.x;
      nor[o + 1] = _v.y;
      nor[o + 2] = _v.z;
    }
    // Only this corpse's vertices go to the GPU.
    for (const a of [this.pos, this.nor]) {
      a.addUpdateRange(c * VERTS * 3, VERTS * 3);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

const _m = Array.from({ length: PARTS }, () => new Matrix4());
const _n = Array.from({ length: PARTS }, () => new Matrix3());
const _v = new Vector3();
