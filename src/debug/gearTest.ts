import { type BufferGeometry, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { BODY_IDS, type BodyId, type ClipId, bodyAsset, loadBody } from '../characters/assets';
import { coverBody, gearGeometry, gearKind, hideBits, loadGear, loadGearMeta, setGearSource } from '../characters/gear';
import { CharacterRig } from '../characters/rig';
import type { GearId } from '../data/items';
import { loadCharactersNode } from './nodeCharacters';

/**
 * Gear on every body in every pose (npm run test:gear): the runtime's own geometry (characters/gear),
 * skinned on the CPU on the body's skeleton —
 *  - the body never comes out through a vest or a helmet: no drawn vertex of the body with the piece
 *    right under its skin (the piece inwards along its normal, nothing of it outwards);
 *  - the straps of the packs and the bag lie on the body: their inner side ≤ 2 cm off the skin (but where a
 *    strap leaves the body for its pack or bag);
 *  - glasses and masks the same, alone and worn together with every helmet and each other (COMBOS): the
 *    body under the whole set hidden at once, nothing of it through any of them;
 *  - nothing hangs in the air: a helmet on the head, a pack on the back, the bag and the box at the hip, a
 *    vest on the torso (≤ 3 cm from the skin at its nearest inner points).
 * Poses: idle, walk, run, crouched walk, jump, the zombies' walk and the top of an axe swing.
 */

type Fs = { readFileSync(p: string): Uint8Array };
const process = (globalThis as unknown as { process: { env: Record<string, string> } }).process;
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): Fs } }).process.getBuiltinModule('node:fs');
const GEAR: GearId[] = ['helmet_military', 'helmet_swat', 'helmet_firefighter', 'helmet_construction', 'vest_military', 'vest_swat', 'backpack_military', 'backpack_school', 'backpack_hiking', 'bag_medic', 'toolbox_mechanic', 'goggles_tactical', 'balaclava', 'shemagh', 'mask_half'];
const HELMETS: GearId[] = ['helmet_military', 'helmet_swat', 'helmet_firefighter', 'helmet_construction'];
const FACE: GearId[] = ['goggles_tactical'];
const MASK: GearId[] = ['balaclava', 'shemagh', 'mask_half'];
/**
 * Worn together (the body under all of them hidden at once — the check that nothing of it comes through any
 * of them): every helmet with every glasses and every mask, glasses with a mask, the class kits.
 */
const COMBOS: GearId[][] = [
  ...HELMETS.flatMap((h) => [...FACE, ...MASK].map((x) => [h, x])),
  ...FACE.flatMap((g) => MASK.map((m) => [g, m])),
  ...HELMETS.flatMap((h) => FACE.flatMap((g) => MASK.map((m) => [h, g, m]))),
  ['helmet_military', 'shemagh', 'vest_military'],
  ['helmet_swat', 'goggles_tactical', 'balaclava', 'vest_swat'],
];
const POSES: { name: string; clip: ClipId; t: number; swing?: boolean }[] = [
  { name: 'idle', clip: 'idle', t: 0 },
  { name: 'walk', clip: 'walking', t: 0.3 },
  { name: 'walk 2', clip: 'walking', t: 0.8 },
  { name: 'run', clip: 'running', t: 0.2 },
  { name: 'run 2', clip: 'running', t: 0.5 },
  { name: 'crouch', clip: 'crouched_walking', t: 0.4 },
  { name: 'jump', clip: 'jump', t: 0.5 },
  { name: 'zombie walk', clip: 'zombie_walk', t: 0.4 },
  { name: 'axe swing', clip: 'idle', t: 0, swing: true },
];

// ── Geometry helpers ──
class Grid {
  private readonly map = new Map<string, number[]>();
  constructor(
    readonly pos: Float32Array,
    readonly cell: number,
    keep?: (i: number) => boolean,
  ) {
    for (let i = 0; i < pos.length / 3; i++) {
      if (keep && !keep(i)) continue;
      const k = this.key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      let l = this.map.get(k);
      if (!l) this.map.set(k, (l = []));
      l.push(i);
    }
  }
  key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  near(p: Vector3, r: number, out: number[] = []): number[] {
    out.length = 0;
    const n = Math.ceil(r / this.cell);
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell), cz = Math.floor(p.z / this.cell);
    for (let x = cx - n; x <= cx + n; x++)
      for (let y = cy - n; y <= cy + n; y++)
        for (let z = cz - n; z <= cz + n; z++) {
          const l = this.map.get(`${x},${y},${z}`);
          if (l) for (const i of l) out.push(i);
        }
    return out;
  }
}
const A = new Vector3(), B = new Vector3(), C = new Vector3(), T = new Vector3();
function rayTri(o: Vector3, d: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
  const e1 = B.subVectors(b, a), e2 = C.subVectors(c, a);
  const p = new Vector3().crossVectors(d, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-12) return -1;
  const t = T.subVectors(o, a);
  const u = t.dot(p) / det;
  if (u < 0 || u > 1) return -1;
  const q = new Vector3().crossVectors(t, e1);
  const v = d.dot(q) / det;
  if (v < 0 || u + v > 1) return -1;
  const h = e2.dot(q) / det;
  return h > 0 ? h : -1;
}
/** Closest point on a triangle (Ericson). */
function closest(p: Vector3, a: Vector3, b: Vector3, c: Vector3): Vector3 {
  const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a.clone();
  const bp = p.clone().sub(b), d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return b.clone();
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().addScaledVector(ab, d1 / (d1 - d3));
  const cp = p.clone().sub(c), d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return c.clone();
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().addScaledVector(ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b.clone().addScaledVector(c.clone().sub(b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return a.clone().addScaledVector(ab, vb * den).addScaledVector(ac, vc * den);
}
interface Posed {
  pos: Float32Array;
  nor: Float32Array;
  index: ArrayLike<number>;
  tris: Grid;
  verts: Grid;
}
const V = (a: Float32Array, i: number, o = new Vector3()) => o.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
function pose(mesh: SkinnedMesh, geo: BufferGeometry): Posed {
  const P = geo.getAttribute('position');
  const pos = new Float32Array(P.count * 3);
  const v = new Vector3();
  for (let i = 0; i < P.count; i++) mesh.applyBoneTransform(i, v.fromBufferAttribute(P, i)).toArray(pos, i * 3);
  const index = geo.index!.array;
  const nor = new Float32Array(pos.length);
  const cen = new Float32Array(index.length);
  for (let t = 0; t < index.length; t += 3) {
    V(pos, index[t], A);
    const b = V(pos, index[t + 1]).sub(A), c = V(pos, index[t + 2]).sub(A);
    const n = b.clone().cross(c);
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) nor[index[t + k] * 3 + a] += n.getComponent(a);
    V(pos, index[t]).add(V(pos, index[t + 1])).add(V(pos, index[t + 2])).multiplyScalar(1 / 3).toArray(cen, t);
  }
  for (let i = 0; i < P.count; i++) {
    const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
    for (let a = 0; a < 3; a++) nor[i * 3 + a] /= l;
  }
  return { pos, nor, index, tris: new Grid(cen, 0.05), verts: new Grid(pos, 0.03) };
}
function shellTris(pos: Float32Array, index: ArrayLike<number>): Grid {
  const cen = new Float32Array(index.length);
  for (let t = 0; t < index.length; t += 3) V(pos, index[t]).add(V(pos, index[t + 1])).add(V(pos, index[t + 2])).multiplyScalar(1 / 3).toArray(cen, t);
  return new Grid(cen, 0.05);
}
const _l: number[] = [];
function cast(m: Posed, o: Vector3, d: Vector3, max: number): number {
  let best = -1;
  const mid = o.clone().addScaledVector(d, max / 2);
  for (const c of m.tris.near(mid, max / 2 + 0.08, _l)) {
    const t = c * 3;
    const h = rayTri(o, d, V(m.pos, m.index[t]), V(m.pos, m.index[t + 1]), V(m.pos, m.index[t + 2]));
    if (h > 0 && h <= max && (best < 0 || h < best)) best = h;
  }
  return best;
}
/** Distance from p to the mesh's surface (its triangles round the nearest vertices). */
function dist(m: Posed, p: Vector3, r = 0.1): number {
  let best = Infinity;
  for (const c of m.tris.near(p, r, _l)) {
    const t = c * 3;
    const q = closest(p, V(m.pos, m.index[t]), V(m.pos, m.index[t + 1]), V(m.pos, m.index[t + 2]));
    const d = q.distanceTo(p);
    if (d < best) best = d;
  }
  return best;
}

// ── Run ──
/** The share of a geometry's area whose winding disagrees with its vertex normals. */
function inwardShare(geo: BufferGeometry): number {
  const P = geo.getAttribute('position'), N = geo.getAttribute('normal');
  if (!N) return 0;
  const idx = geo.index;
  const n = idx ? idx.count : P.count;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), fn = new Vector3(), vn = new Vector3(), t = new Vector3();
  let all = 0, bad = 0;
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(P, ia);
    b.fromBufferAttribute(P, ib);
    c.fromBufferAttribute(P, ic);
    fn.crossVectors(b.sub(a), c.sub(a));
    const area = fn.length() / 2;
    if (area < 1e-12) continue;
    vn.fromBufferAttribute(N, ia).add(t.fromBufferAttribute(N, ib)).add(t.fromBufferAttribute(N, ic));
    all += area;
    if (fn.dot(vn) < 0) bad += area;
  }
  return all ? bad / all : 0;
}

await loadCharactersNode();
setGearSource(0, async (f) => {
  const b = fs.readFileSync(`public/models/gear/${f}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
});
await loadGearMeta();
let fails = 0, checks = 0;
const worst: Record<string, { v: number; at: string }> = {};
const note = (k: string, v: number, at: string) => {
  if (!worst[k] || v > worst[k].v) worst[k] = { v, at };
};
const _q = new Quaternion();
for (const body of (process.env.BODIES ? process.env.BODIES.split(",") : BODY_IDS) as readonly BodyId[]) {
  await loadBody(body);
  await loadGear(body, GEAR);
  coverBody(body);
  const rig = new CharacterRig(body, 0);
  const bgeo = bodyAsset(body).lod0.geometry;
  const cover = bgeo.getAttribute('aCover');
  const meshes = new Map<GearId, { mesh: SkinnedMesh; geo: BufferGeometry }>();
  for (const g of GEAR) {
    if (process.env.GEAR && !process.env.GEAR.split(',').includes(g)) continue;
    const geo = gearGeometry(body, g, 0);
    if (!geo) {
      console.log(`✗ ${body}: no ${g}`);
      fails++;
      continue;
    }
    const m = new SkinnedMesh(geo);
    m.bind(rig.mesh.skeleton, rig.mesh.bindMatrix);
    meshes.set(g, { mesh: m, geo });
  }
  // Faces turned inside out: the winding's normal against the vertices' (by area) — a one-sided material
  // drops those faces (holes) or lights them from behind (dark triangles). The body too.
  for (const [name, geo] of [[body, bgeo], ...[...meshes].map(([g, m]) => [g, m.geo])] as [string, BufferGeometry][]) {
    const inward = inwardShare(geo);
    note('вывернутые грани, доля площади', inward, `${body}/${name}`);
    checks++;
    if (!(inward <= 0.05)) {
      fails++;
      console.log(`✗ ${body}/${name}: вывернутых граней ${(inward * 100).toFixed(1)}% площади (≤ 5%)`);
    }
  }
  for (const p of process.env.POSES ? POSES.filter((x) => process.env.POSES!.split(',').includes(x.name)) : POSES) {
    rig.hold(p.clip, p.t);
    if (p.swing) {
      rig.bone('Spine1').quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 1, 0), -0.35));
      rig.bone('RightArm').quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 0, 1), -1.9));
      rig.bone('RightForeArm').quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 0, 1), -1.2));
      rig.bone('LeftArm').quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 0, 1), 0.9));
    }
    rig.root.updateMatrixWorld(true);
    const bp = pose(rig.mesh, bgeo);
    const posed = new Map<GearId, Posed>();
    for (const [g, { mesh, geo }] of meshes) posed.set(g, pose(mesh, geo));
    const sets: [GearId, GearId[]][] = [...[...meshes.keys()].map((g) => [g, [g]] as [GearId, GearId[]]), ...COMBOS.filter((c) => c.every((g) => meshes.has(g))).flatMap((c) => c.filter((g) => meshes.has(g)).map((g) => [g, c] as [GearId, GearId[]]))];
    for (const [g, set] of sets) {
      const { geo } = meshes.get(g)!;
      const single = set.length === 1;
      let gp = posed.get(g)!;
      const whole = gp;
      const kind = gearKind(g)!;
      const bit = hideBits(set);
      const at = `${body} / ${single ? g : `${g} в [${set.join('+')}]`} / ${p.name}`;
      // Drawn body vertices: in a triangle not all of whose corners are under the piece.
      const hidden = (v: number) => (cover.getX(v) & bit) !== 0;
      const drawn = new Uint8Array(bp.pos.length / 3);
      for (let t = 0; t < bp.index.length; t += 3) {
        const [a, b, c] = [bp.index[t], bp.index[t + 1], bp.index[t + 2]];
        if (!(hidden(a) && hidden(b) && hidden(c))) drawn[a] = drawn[b] = drawn[c] = 1;
      }
      if (kind === 'vest' || kind === 'helmet' || kind === 'glasses' || kind === 'mask') {
        // A helmet: its shell (above its rim, at bind), not the chin straps that run along the face.
        let rimY = -Infinity;
        const dome = new Vector3();
        if (kind === 'helmet') {
          const gb = geo.getAttribute('position');
          let lo = Infinity, hi = -Infinity;
          for (let i = 0; i < gb.count; i++) (lo = Math.min(lo, gb.getY(i))), (hi = Math.max(hi, gb.getY(i)));
          rimY = lo + (hi - lo) * 0.45;
          // Its shell only: the triangles above the rim (not the harness inside, nor the chin straps).
          const idx = geo.index!.array, keep: number[] = [];
          for (let t = 0; t < idx.length; t += 3) if ([0, 1, 2].every((k) => gb.getY(idx[t + k]) >= rimY)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
          gp = { ...gp, index: keep, tris: shellTris(gp.pos, keep) };
          const dlo = new Vector3(Infinity, Infinity, Infinity), dhi = new Vector3(-Infinity, -Infinity, -Infinity);
          for (const i of new Set(keep)) (dlo.min(V(gp.pos, i)), dhi.max(V(gp.pos, i)));
          dome.copy(dlo).add(dhi).multiplyScalar(0.5);
        }
        const bindY = bgeo.getAttribute('position');
        // Through the surface: the piece just inside the skin there, nothing of it outside.
        let near = 0, out = 0;
        const n = new Vector3(), q = new Vector3();
        for (let v = 0; v < drawn.length; v++) {
          if (!drawn[v] || bindY.getY(v) < rimY) continue;
          V(bp.pos, v, q);
          if (!gp.verts.near(q, 0.05, _l).length) continue;
          near++;
          V(bp.nor, v, n);
          if (kind === 'helmet') {
            // Outside the dome: the way to its middle crosses it, and nothing of the helmet over it (hair hanging
            // under a wide brim or a neck guard is below the helmet, not through it).
            const d = dome.clone().sub(q);
            const L = d.length();
            d.normalize();
            if (cast(gp, q, d, L) > 0 && cast(whole, q, d.clone().negate(), 0.3) < 0 && cast(whole, q, new Vector3(0, 1, 0), 0.3) < 0) {
              out++;
              if (process.env.DEBUG_THROUGH && out <= 6) console.log('   ', v, bindY.getX(v).toFixed(3), bindY.getY(v).toFixed(3), bgeo.getAttribute('position').getZ(v).toFixed(3));
            }
            continue;
          }
          const inward = cast(gp, q, n.clone().negate(), 0.02);
          if (inward < 0) continue;
          if (cast(gp, q, n, 0.04) < 0) {
            out++;
            if (process.env.DEBUG_THROUGH && out <= 6) console.log('   ', v, bindY.getX(v).toFixed(3), bindY.getY(v).toFixed(3), bgeo.getAttribute('position').getZ(v).toFixed(3));
          }
        }
        const share = near ? out / near : 0;
        note(`${kind}${single ? '' : ' (набор)'}: кожа сквозь`, share, at);
        checks++;
        if (share > 0.01) {
          fails++;
          if (fails < 1e9) console.log(`✗ ${at}: тело сквозь ${kind}: ${out}/${near} вершин`);
        }
      }
      if (!single) continue;
      if (kind === 'pack' || kind === 'bag') {
        // Straps: the ribbons (generated: 4 vertices a section, the first two the inner side).
        const rigidN = geo.userData.rigid ?? 0;
        let far = 0, n = 0, max = 0;
        const q = new Vector3();
        const rigidGrid = new Grid(gp.pos.subarray(0, rigidN * 3), 0.03);
        for (let v = rigidN; v < gp.pos.length / 3; v++) {
          if ((v - rigidN) % 4 > 1) continue;
          V(gp.pos, v, q);
          // Where it leaves the body for its pack or bag: not a strap on the body.
          if (rigidGrid.near(q, 0.15, _l).some((k) => V(gp.pos, k).distanceTo(q) < 0.15)) continue;
          const d = dist(bp, q, 0.12);
          n++;
          max = Math.max(max, Math.min(d, 1));
          if (d > 0.02) far++;
        }
        note('лямки: дальше 2 см', n ? far / n : 0, at);
        note('лямки: макс. зазор, м', max, at);
        checks++;
        if (n && far / n > 0.02) {
          fails++;
          if (fails < 1e9) console.log(`✗ ${at}: лямки отходят > 2 см: ${far}/${n} (макс ${(max * 100).toFixed(1)} см)`);
        }
      }
      // Nothing in the air: the piece's nearest points to the body.
      {
        const q = new Vector3();
        const ds: number[] = [];
        // Points spread over its surface by area (a flat face touching the body has only its corners as vertices).
        const nr = geo.userData.rigid || gp.pos.length / 3;
        const idx = geo.index!.array;
        const tri: number[] = [], acc: number[] = [];
        let area = 0;
        const a = new Vector3(), b = new Vector3(), c = new Vector3();
        for (let t = 0; t < idx.length; t += 3) {
          if (idx[t] >= nr || idx[t + 1] >= nr || idx[t + 2] >= nr) continue;
          V(gp.pos, idx[t], a), V(gp.pos, idx[t + 1], b), V(gp.pos, idx[t + 2], c);
          area += b.sub(a).cross(c.sub(a)).length() / 2;
          tri.push(t), acc.push(area);
        }
        let seed = 12345;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let k = 0; k < 600 && tri.length; k++) {
          const x = rnd() * area;
          let lo = 0, hi = acc.length - 1;
          while (lo < hi) { const m = (lo + hi) >> 1; if (acc[m] < x) lo = m + 1; else hi = m; }
          const t = tri[lo];
          let u = rnd(), w = rnd();
          if (u + w > 1) (u = 1 - u), (w = 1 - w);
          V(gp.pos, idx[t], a), V(gp.pos, idx[t + 1], b), V(gp.pos, idx[t + 2], c);
          q.copy(a).addScaledVector(b.sub(a), u).addScaledVector(c.sub(a), w);
          ds.push(dist(bp, q, 0.2));
        }
        ds.sort((a, b) => a - b);
        // Touching: a patch of it (30 cm², a palm) within the limit of the body.
        const contact = ds[Math.min(ds.length - 1, Math.floor((ds.length * 0.003) / area))];
        const limit = kind === 'bag' || kind === 'box' ? 0.04 : 0.03;
        note('висит: зазор до тела, м', contact, at);
        checks++;
        if (!(contact <= limit)) {
          fails++;
          if (fails < 1e9) console.log(`✗ ${at}: висит в воздухе: ${(contact * 100).toFixed(1)} см до тела`);
        }
      }
    }
  }
  rig.dispose();
  console.log(`${body}: ok so far (${fails} fails)`);
}
for (const [k, w] of Object.entries(worst)) console.log(`  худшее «${k}»: ${w.v.toFixed(3)} (${w.at})`);
console.log(fails ? `✗ test:gear: ${fails} из ${checks} проверок не прошли` : `✓ test:gear: ${checks} проверок (${BODY_IDS.length} тел × (${GEAR.length} предметов + ${COMBOS.length} наборов) × ${POSES.length} поз)`);
if (fails) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
