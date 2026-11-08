import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { HINTS } from '../weapons/gunHints';
import { GUN_IDS } from '../weapons/guns';

/**
 * The firearm models' parts where they belong (test:guns): public/models/weapons/<id>.glb as the import
 * cut it (body, mag, slide, pump, rocket — each in the gun frame at rest) —
 *  - no piece off the gun: every part's box within 1 cm of the body's;
 *  - the whole as the source: its box against the source model's (assets/incoming/weapons, when it is
 *    there) turned into the gun frame the import's way (src/weapons/gunFrame), every side within 1.5 cm;
 *    without the source, its length against the gun's real length (gunHints) within 3%.
 * A gun with no model file draws its stand-in: nothing to check.
 */

type Fs = { existsSync(p: string): boolean; readFileSync(p: string): Uint8Array };
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): Fs } }).process.getBuiltinModule('node:fs');

interface Box {
  lo: Vector3;
  hi: Vector3;
}
const empty = (): Box => ({ lo: new Vector3(Infinity, Infinity, Infinity), hi: new Vector3(-Infinity, -Infinity, -Infinity) });

async function boxes(io: NodeIO, file: string, map?: (p: Vector3) => Vector3): Promise<Map<string, Box>> {
  const doc = await io.readBinary(fs.readFileSync(file));
  const out = new Map<string, Box>();
  const p = new Vector3();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = new Matrix4().fromArray(node.getWorldMatrix());
    const b = out.get(node.getName()) ?? empty();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!;
      for (let i = 0; i < pos.getCount(); i++) {
        const e = pos.getElement(i, [0, 0, 0]);
        p.set(e[0], e[1], e[2]).applyMatrix4(m);
        if (map) map(p);
        b.lo.min(p);
        b.hi.max(p);
      }
    }
    out.set(node.getName(), b);
  }
  return out;
}
/** Gap between two boxes (0 when they touch or overlap), m. */
function gap(a: Box, b: Box): number {
  let d = 0;
  for (const k of ['x', 'y', 'z'] as const) d = Math.max(d, a.lo[k] - b.hi[k], b.lo[k] - a.hi[k]);
  return Math.max(0, d);
}

export async function gunParts(): Promise<{ ok: boolean; what: string }[]> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const res: { ok: boolean; what: string }[] = [];
  for (const id of GUN_IDS) {
    const file = `public/models/weapons/${id}.glb`;
    if (!fs.existsSync(file)) continue;
    const parts = await boxes(io, file);
    const body = parts.get('body');
    if (!body) {
      res.push({ ok: false, what: `${id}: model without a body part` });
      continue;
    }
    const all = empty();
    for (const [name, b] of parts) {
      all.lo.min(b.lo);
      all.hi.max(b.hi);
      if (name === 'body') continue;
      const g = gap(b, body);
      res.push({ ok: g <= 0.01, what: `${id}: part «${name}» on the gun (${(g * 100).toFixed(1)} cm off the body)` });
    }
    const h = HINTS[id];
    const src = `assets/incoming/weapons/${id}.glb`;
    if (fs.existsSync(src)) {
      // The source in the gun frame (src/weapons/gunFrame toGun): its −X the muzzle → −Z, the grip at the origin.
      const s = h.length / 0.96;
      const [b0, t0] = h.grip;
      const gx = b0[0] + (t0[0] - b0[0]) * h.main, gy = b0[1] + (t0[1] - b0[1]) * h.main;
      const whole = empty();
      for (const b of (await boxes(io, src, (p) => p.set(-s * p.z, s * (p.y - gy), s * (p.x - gx)))).values()) {
        whole.lo.min(b.lo);
        whole.hi.max(b.hi);
      }
      const off = Math.max(...(['x', 'y', 'z'] as const).flatMap((k) => [Math.abs(all.lo[k] - whole.lo[k]), Math.abs(all.hi[k] - whole.hi[k])]));
      res.push({ ok: off <= 0.015, what: `${id}: assembled as the source model (box sides within ${(off * 100).toFixed(1)} cm)` });
    } else {
      const len = all.hi.z - all.lo.z;
      res.push({ ok: Math.abs(len - h.length) <= h.length * 0.03, what: `${id}: assembled ${len.toFixed(3)} m long (the gun ${h.length} m)` });
    }
  }
  return res;
}
