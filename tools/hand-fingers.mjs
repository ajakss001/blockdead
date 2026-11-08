/**
 * Fingers for every costume: the base body's finger bones and finger weights on a costume's own hands.
 *
 * Meshy's costumes came rigged with a hand of one or three fingers (police / mechanic / builder: only the index
 * finger, every finger of the mesh on it; SWAT / military / firefighter: no little finger) — a fist could not
 * close, the menu held a knife on an open palm. The game's grip poses (characters/hands: grip_fist /
 * grip_trigger / grip_support) need all fifteen.
 *
 *   1. The donor's hand (char_male / char_female) is laid onto the costume's: by the Hand bones' bind frames,
 *      scaled by the forearms' lengths.
 *   2. Every finger bone the costume lacks is added under its parent there (the donor's place, so laid).
 *   3. The costume's hand vertices (any weight on a Hand bone) take the donor's finger weights from the nearest
 *      donor hand vertex; whatever they had on the forearm stays (the wrist bends as before). The mesh and its
 *      texture (gloves) are the costume's own.
 *
 * Input: a non-indexed geometry (position, skinIndex, skinWeight) and its bones (three Bones at bind), the
 * donor's; the bones list grows. Out: the geometry with the new weights, a report.
 */
import { Bone, BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';

const bare = (n) => n.replace(/^mixamorig:?/, '');
const FINGER = /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)\d$/;

export function handFingers(costume, donor) {
  const { geo, bones } = costume;
  const byName = (list, n) => list.find((b) => bare(b.name) === n);
  const prefix = bones[0].name.match(/^mixamorig:?/)?.[0] ?? '';
  const info = { added: [], moved: 0, err: {} };
  for (const S of ['Left', 'Right']) {
    const cH = byName(bones, `${S}Hand`), dH = byName(donor.bones, `${S}Hand`);
    const cF = byName(bones, `${S}ForeArm`), dF = byName(donor.bones, `${S}ForeArm`);
    if (!cH || !dH || !cF || !dF) continue;
    const at = (b) => new Vector3().setFromMatrixPosition(b.matrixWorld);
    const k = at(cH).distanceTo(at(cF)) / at(dH).distanceTo(at(dF));
    // Donor bind space → the costume's: through the Hand frames, scaled.
    const T = new Matrix4().copy(cH.matrixWorld).multiply(new Matrix4().makeScale(k, k, k)).multiply(dH.matrixWorld.clone().invert());
    // Check the laying: the donor's index root against the costume's (both have it).
    const ci = byName(bones, `${S}HandIndex1`), di = byName(donor.bones, `${S}HandIndex1`);
    if (ci && di) info.err[S] = +at(di).applyMatrix4(T).distanceTo(at(ci)).toFixed(2);
    // 2. The missing finger bones, parents first (the donor's order is).
    for (const d of donor.bones) {
      const n = bare(d.name);
      if (!FINGER.test(n) || !n.startsWith(S) || byName(bones, n)) continue;
      const parent = byName(bones, bare(d.parent.name));
      if (!parent) continue;
      const world = new Matrix4().copy(T).multiply(d.matrixWorld);
      // No scale in a bone: the rotation and place only.
      const p = new Vector3(), q = new Quaternion(), s = new Vector3();
      world.decompose(p, q, s);
      world.compose(p, q, new Vector3(1, 1, 1));
      const local = new Matrix4().copy(parent.matrixWorld).invert().multiply(world);
      const b = new Bone();
      b.name = `${prefix}${n}`;
      local.decompose(b.position, b.quaternion, b.scale);
      parent.add(b);
      b.updateMatrixWorld(true);
      bones.push(b);
      info.added.push(n);
    }
  }
  if (!info.added.length) return { geo, info };
  // 3. Weights from the donor's nearest hand vertex.
  const index = new Map(bones.map((b, i) => [bare(b.name), i]));
  const dSI = donor.geo.attributes.skinIndex, dSW = donor.geo.attributes.skinWeight, dP = donor.geo.attributes.position;
  const handOf = (n) => /^(Left|Right)Hand/.test(n);
  const sideOf = (n) => (n.startsWith('Left') ? 'Left' : 'Right');
  const dHand = { Left: [], Right: [] };
  for (let v = 0; v < dP.count; v++) {
    let h = 0, side = null;
    for (let c = 0; c < 4; c++) {
      const n = bare(donor.bones[dSI.getComponent(v, c)].name);
      if (handOf(n)) (h += dSW.getComponent(v, c)), (side = sideOf(n));
    }
    if (h > 0.5) dHand[side].push(v);
  }
  const Tinv = {};
  for (const S of ['Left', 'Right']) {
    const cH = byName(bones, `${S}Hand`), dH = byName(donor.bones, `${S}Hand`);
    const cF = byName(bones, `${S}ForeArm`), dF = byName(donor.bones, `${S}ForeArm`);
    if (!cH || !dH || !cF || !dF) continue;
    const at = (b) => new Vector3().setFromMatrixPosition(b.matrixWorld);
    const k = at(cH).distanceTo(at(cF)) / at(dH).distanceTo(at(dF));
    Tinv[S] = new Matrix4().copy(cH.matrixWorld).multiply(new Matrix4().makeScale(k, k, k)).multiply(dH.matrixWorld.clone().invert()).invert();
  }
  const SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight, P = geo.attributes.position;
  const ji = new Uint16Array(P.count * 4), jw = new Float32Array(P.count * 4);
  const p = new Vector3(), q = new Vector3();
  for (let v = 0; v < P.count; v++) {
    const own = new Map();
    let hand = 0, side = null;
    for (let c = 0; c < 4; c++) {
      const w = SW.getComponent(v, c);
      if (w <= 0) continue;
      const n = bare(bones[SI.getComponent(v, c)].name);
      if (handOf(n)) (hand += w), (side = sideOf(n));
      else own.set(n, (own.get(n) ?? 0) + w);
    }
    if (hand > 0 && side && Tinv[side] && dHand[side].length) {
      p.fromBufferAttribute(P, v).applyMatrix4(Tinv[side]);
      let best = -1, bd = Infinity;
      for (const d of dHand[side]) {
        const dd = q.fromBufferAttribute(dP, d).distanceToSquared(p);
        if (dd < bd) (bd = dd), (best = d);
      }
      // The donor's weights on the hand's bones, renormalised to the share the hand had here.
      const dw = new Map();
      let sum = 0;
      for (let c = 0; c < 4; c++) {
        const n = bare(donor.bones[dSI.getComponent(best, c)].name), w = dSW.getComponent(best, c);
        if (w > 0 && handOf(n) && index.has(n)) dw.set(n, (dw.get(n) ?? 0) + w), (sum += w);
      }
      if (sum > 0) {
        for (const [n, w] of dw) own.set(n, (own.get(n) ?? 0) + (hand * w) / sum);
        info.moved++;
      } else own.set(`${side}Hand`, (own.get(`${side}Hand`) ?? 0) + hand);
    } else if (hand > 0) {
      for (let c = 0; c < 4; c++) {
        const n = bare(bones[SI.getComponent(v, c)].name);
        if (handOf(n)) own.set(n, (own.get(n) ?? 0) + SW.getComponent(v, c));
      }
    }
    const list = [...own].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = list.reduce((t, x) => t + x[1], 0) || 1;
    list.forEach(([n, w], c) => ((ji[v * 4 + c] = index.get(n) ?? 0), (jw[v * 4 + c] = w / s)));
  }
  geo.setAttribute('skinIndex', new BufferAttribute(ji, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(jw, 4));
  return { geo, info };
}
