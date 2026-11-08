/**
 * One face for every costume: the head and neck of the base body (char_male / char_female) put on a costume
 * in place of its own (Meshy made every costume with a face of its own).
 *
 *   1. Head = the vertices with Head + Neck weight > 0.5 (a triangle with two such corners is the head's).
 *   2. The costume's head goes by the same rule.
 *   3. The donor head is moved by the Neck bone (donor Neck → costume Neck); its open ring at the neck is laid
 *      onto the costume's ring (the collar line): each donor ring vertex onto the costume's ring polyline, the
 *      costume's ring vertices merged into the nearest donor ones, the displacement faded up the neck — closed,
 *      no gap.
 *   4. Weights: the donor's (mapped to the costume's bones by name); the ring takes the costume's own, fading
 *      into the donor's up the neck (the seam never tears). Skin of the head and neck gains the colour of the
 *      costume's hands (or of its own neck under gloves): no step in tone.
 *   5. One texture: the UV islands of both (costume without its head, donor head) packed into one square atlas.
 *
 * Input and output: non-indexed geometry (position, normal, uv, skinIndex, skinWeight), a bone list, RGBA.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

const bare = (n) => n.replace(/^mixamorig:?/, '');
const HEADNECK = (n) => /^(Head|Neck)/.test(n);

function headShare(geo, bones, v) {
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  let s = 0;
  for (let k = 0; k < 4; k++) if (HEADNECK(bare(bones[si.getComponent(v, k)].name))) s += sw.getComponent(v, k);
  return s;
}
const jointOf = (bones, name) => new Vector3().setFromMatrixPosition(bones.find((b) => bare(b.name) === name).matrixWorld);

/** Triangles (non-indexed) split into the head's and the rest's. */
function splitHead(geo, bones) {
  const n = geo.attributes.position.count / 3;
  const head = [], rest = [];
  for (let t = 0; t < n; t++) {
    let c = 0;
    for (let k = 0; k < 3; k++) if (headShare(geo, bones, t * 3 + k) > 0.5) c++;
    (c >= 2 ? head : rest).push(t);
  }
  return { head, rest };
}

const key = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;

/**
 * The cut: edges (by position) between a triangle of `side` and one of `other` — exactly the line where the
 * head was taken off (not a collar's own open edge nearby). Each with the vertex slots of its `side` triangle.
 */
function cutEdges(P, side, other) {
  const edges = new Map();
  const add = (tris, own) => {
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k, j = t * 3 + ((k + 1) % 3);
        const ka = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), kb = key(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
        const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        let r = edges.get(e);
        if (!r) edges.set(e, (r = { own: 0, other: 0, a: -1, b: -1 }));
        if (own) (r.own++, (r.a = i), (r.b = j));
        else r.other++;
      }
  };
  add(side, true);
  add(other, false);
  return [...edges.values()].filter((e) => e.own === 1 && e.other >= 1);
}

function closestOnSeg(p, a, b) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-12, ab.lengthSq())));
  return a.clone().addScaledVector(ab, t);
}

// ── Skin colour ──────────────────────────────────────────────────────────────────────────────────────
function skinness(r, g, b) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2;
  if (max === min || r < g || g < b) return 0;
  const s = (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  const h = ((g - b) / 255 / (max - min)) / 6;
  const hue = 1 - Math.min(1, Math.max(0, (Math.abs(h - 0.06) - 0.035) / 0.03));
  return hue * (s > 0.12 && s < 0.75 ? 1 : 0) * (l > 0.22 && l < 0.88 ? 1 : 0);
}
const texel = (img, u, v) => {
  const x = Math.min(img.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor((1 - (v - Math.floor(v))) * img.h)));
  const o = (y * img.w + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};
/** Mean skin colour of the vertices `pick` takes (null: too little skin there). */
function skinMean(geo, img, pick) {
  const uv = geo.attributes.uv;
  const acc = [0, 0, 0];
  let n = 0;
  for (let v = 0; v < uv.count; v++) {
    if (!pick(v)) continue;
    const c = texel(img, uv.getX(v), uv.getY(v));
    if (skinness(...c) < 0.5) continue;
    for (let k = 0; k < 3; k++) acc[k] += c[k];
    n++;
  }
  return n > 40 ? acc.map((x) => x / n) : null;
}
const boneShare = (geo, bones, v, test) => {
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  let s = 0;
  for (let k = 0; k < 4; k++) if (test(bare(bones[si.getComponent(v, k)].name))) s += sw.getComponent(v, k);
  return s;
};

// ── Atlas ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Islands of triangles (joined where they share a UV corner), each one's box in its source's pixels; packed
 * onto shelves into a square at the sources' own texel size; UVs moved to match.
 */
function packAtlas(parts) {
  const charts = [];
  for (const [pi, part] of parts.entries()) {
    const { uv, tris, img } = part;
    const parent = new Int32Array(tris.length).map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const at = new Map();
    tris.forEach((t, ti) => {
      // Whole-triangle shift into [0, 1) (a few corners run past 1 on wrapped islands).
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        const kk = `${Math.round(uv[i * 2] * 1e5)},${Math.round(uv[i * 2 + 1] * 1e5)}`;
        const o = at.get(kk);
        if (o === undefined) at.set(kk, ti);
        else parent[find(ti)] = find(o);
      }
    });
    const by = new Map();
    tris.forEach((t, ti) => {
      const r = find(ti);
      let c = by.get(r);
      if (!c) by.set(r, (c = { part: pi, tris: [], lo: [Infinity, Infinity], hi: [-Infinity, -Infinity] }));
      c.tris.push(t);
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        const x = uv[i * 2] * img.w, y = (1 - uv[i * 2 + 1]) * img.h;
        c.lo[0] = Math.min(c.lo[0], x);
        c.lo[1] = Math.min(c.lo[1], y);
        c.hi[0] = Math.max(c.hi[0], x);
        c.hi[1] = Math.max(c.hi[1], y);
      }
    });
    charts.push(...by.values());
  }
  const PAD = 3;
  for (const c of charts) {
    c.x0 = Math.floor(c.lo[0]) - PAD;
    c.y0 = Math.floor(c.lo[1]) - PAD;
    c.w = Math.ceil(c.hi[0]) + PAD - c.x0;
    c.h = Math.ceil(c.hi[1]) + PAD - c.y0;
  }
  charts.sort((a, b) => b.h - a.h);
  const area = charts.reduce((s, c) => s + c.w * c.h, 0);
  let L = Math.ceil(Math.sqrt(area * 1.1));
  for (;;) {
    let x = 0, y = 0, row = 0, ok = true;
    for (const c of charts) {
      if (c.w > L) {
        ok = false;
        break;
      }
      if (x + c.w > L) (x = 0), (y += row), (row = 0);
      c.dx = x;
      c.dy = y;
      x += c.w;
      row = Math.max(row, c.h);
    }
    if (ok && y + row <= L) break;
    L = Math.ceil(L * 1.04);
  }
  const data = Buffer.alloc(L * L * 4);
  for (const c of charts) {
    const img = parts[c.part].img;
    for (let yy = 0; yy < c.h; yy++)
      for (let xx = 0; xx < c.w; xx++) {
        const sx = (((c.x0 + xx) % img.w) + img.w) % img.w, sy = (((c.y0 + yy) % img.h) + img.h) % img.h;
        const s = (sy * img.w + sx) * 4, d = ((c.dy + yy) * L + c.dx + xx) * 4;
        data[d] = img.data[s];
        data[d + 1] = img.data[s + 1];
        data[d + 2] = img.data[s + 2];
        data[d + 3] = 255;
      }
    const uv = parts[c.part].uv, out = parts[c.part].out;
    for (const t of c.tris)
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        const x = uv[i * 2] * img.w - c.x0 + c.dx, y = (1 - uv[i * 2 + 1]) * img.h - c.y0 + c.dy;
        out[i * 2] = x / L;
        out[i * 2 + 1] = 1 - y / L;
      }
  }
  return { data, w: L, h: L, charts: charts.length };
}

/** Only the largest connected patch of the head stays the head; stray bits (a collar tip) go back to the rest. */
function mainPatch(P, split) {
  const { head, rest } = split;
  const parent = head.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const at = new Map();
  head.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      const kk = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      const o = at.get(kk);
      if (o === undefined) at.set(kk, ti);
      else parent[find(ti)] = find(o);
    }
  });
  const size = new Map();
  head.forEach((_, ti) => size.set(find(ti), (size.get(find(ti)) ?? 0) + 1));
  const big = [...size].sort((a, b) => b[1] - a[1])[0][0];
  const keep = [], back = [];
  head.forEach((t, ti) => (find(ti) === big ? keep : back).push(t));
  return { head: keep, rest: [...rest, ...back].sort((a, b) => a - b) };
}

/** The longest closed chain of cut edges: [{ slot, p }] in order. */
function loopOf(P, edges) {
  const next = new Map();
  for (const e of edges) {
    const ka = key(P[e.a * 3], P[e.a * 3 + 1], P[e.a * 3 + 2]), kb = key(P[e.b * 3], P[e.b * 3 + 1], P[e.b * 3 + 2]);
    for (const [x, y, s] of [[ka, kb, e.a], [kb, ka, e.b]]) {
      let l = next.get(x);
      if (!l) next.set(x, (l = { slot: s, to: [] }));
      l.to.push(y);
    }
  }
  const seen = new Set();
  let best = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let cur = start, prev = null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      loop.push(cur);
      const n = next.get(cur).to.find((y) => y !== prev && !seen.has(y));
      prev = cur;
      cur = n;
    }
    if (loop.length > best.length) best = loop;
  }
  return best.map((k) => ({ slot: next.get(k).slot, p: new Vector3().fromArray(P, next.get(k).slot * 3) }));
}

const TAU = 2 * Math.PI;
const wrap = (a) => ((a % TAU) + TAU) % TAU;

/**
 * The swap. `costume`, `donor`: { geo (non-indexed), bones, img: {data, w, h} }. Returns { geo, img, info }.
 */
export function headSwap(costume, donor) {
  const cg = costume.geo, dg = donor.geo;
  const cP = Float32Array.from(cg.attributes.position.array);
  const cs = mainPatch(cP, splitHead(cg, costume.bones));
  const cNeck = jointOf(costume.bones, 'Neck'), cHead = jointOf(costume.bones, 'Head');
  const dNeck = jointOf(donor.bones, 'Neck');
  const shift = cNeck.clone().sub(dNeck);
  // The donor head moved onto the costume's neck.
  const dP = Float32Array.from(dg.attributes.position.array);
  for (let i = 0; i < dP.length; i += 3) (dP[i] += shift.x), (dP[i + 1] += shift.y), (dP[i + 2] += shift.z);
  const ds = mainPatch(dP, splitHead(dg, donor.bones));

  // The two rings round the neck's axis, by angle (both the same way round, from angle 0).
  const axis = cHead.clone().sub(cNeck).normalize();
  const ux = new Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
  const uz = new Vector3().crossVectors(axis, ux);
  const rel = (p) => p.clone().sub(cNeck);
  const ang = (p) => Math.atan2(rel(p).dot(uz), rel(p).dot(ux));
  const height = (p) => rel(p).dot(axis);
  const radius = (p) => rel(p).addScaledVector(axis, -height(p)).length();
  const order = (loop) => {
    let turn = 0;
    for (let i = 0; i < loop.length; i++) {
      let d = ang(loop[(i + 1) % loop.length].p) - ang(loop[i].p);
      d -= Math.round(d / TAU) * TAU;
      turn += d;
    }
    if (turn < 0) loop.reverse();
    let s = 0, bd = Infinity;
    loop.forEach((v, i) => {
      const a = wrap(ang(v.p));
      if (a < bd) (bd = a), (s = i);
    });
    const out = [...loop.slice(s), ...loop.slice(0, s)];
    let acc = wrap(ang(out[0].p));
    out.forEach((v, i) => {
      if (i) {
        let d = ang(v.p) - ang(out[i - 1].p);
        d -= Math.round(d / TAU) * TAU;
        acc += d;
      }
      v.a = acc;
    });
    return out;
  };
  const C = order(loopOf(cP, cutEdges(cP, cs.rest, cs.head)));
  // The collar line smoothed along the neck (the cut follows the triangles: a saw edge at the back), each corner
  // moved along the axis to its neighbours' mean height, with every copy of it in the costume.
  {
    const slots = new Map();
    for (const t of cs.rest)
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        const kk = key(cP[i * 3], cP[i * 3 + 1], cP[i * 3 + 2]);
        let l = slots.get(kk);
        if (!l) slots.set(kk, (l = []));
        l.push(i);
      }
    const n = C.length, H = C.map((c) => height(c.p));
    for (let pass = 0; pass < 3; pass++)
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let d = -2; d <= 2; d++) acc += H[(i + d + n) % n];
        H[i] = H[i] * 0.4 + (acc / 5) * 0.6;
      }
    C.forEach((c, i) => {
      const l = slots.get(key(c.p.x, c.p.y, c.p.z)) ?? [];
      c.p.addScaledVector(axis, H[i] - height(c.p));
      for (const j of l) cP.set(c.p.toArray(), j * 3);
    });
  }
  const D = order(loopOf(dP, cutEdges(dP, ds.head, ds.rest)));
  /** Segment of a ring (closed) holding angle a, and how far along it. */
  const seg = (R, a) => {
    const n = R.length, t = wrap(a - R[0].a) + R[0].a;
    for (let i = 0; i < n; i++) {
      const a0 = R[i].a, a1 = i + 1 < n ? R[i + 1].a : R[0].a + TAU;
      if (t >= a0 && t <= a1) return [i, (i + 1) % n, a1 > a0 ? (t - a0) / (a1 - a0) : 0];
    }
    return [n - 1, 0, 1];
  };
  // Each donor ring corner onto the costume's ring at its angle (a costume corner within 1 cm: onto it exactly).
  for (const d of D) {
    d.from = d.p.clone();
    const [i, j, f] = seg(C, d.a);
    d.to = C[i].p.clone().lerp(C[j].p, f);
    let bd = 0.01;
    for (const c of C) {
      const dist = c.p.distanceTo(d.to);
      if (dist < bd) (bd = dist), d.to.copy(c.p);
    }
  }
  // The donor neck follows its ring, fading 4 cm up (the neck only: the chin stands out past the neck's radius).
  const FADE = 0.04;
  const ringR = D.reduce((s, d) => s + radius(d.to), 0) / D.length;
  const ringKeys = new Map(D.map((d) => [key(d.from.x, d.from.y, d.from.z), d]));
  const headVerts = new Set();
  for (const t of ds.head) for (let k = 0; k < 3; k++) headVerts.add(t * 3 + k);
  const fadeOf = new Float32Array(dP.length / 3);
  for (const i of headVerts) {
    const p = new Vector3().fromArray(dP, i * 3);
    const r = ringKeys.get(key(p.x, p.y, p.z));
    if (r) {
      dP.set(r.to.toArray(), i * 3);
      fadeOf[i] = 1;
      continue;
    }
    const [a, b, f0] = seg(D, ang(p));
    const h = height(D[a].from) * (1 - f0) + height(D[b].from) * f0;
    const up = height(p) - h;
    if (up >= FADE || radius(p) > ringR * 1.2) continue;
    const d = D[a].to.clone().sub(D[a].from).lerp(D[b].to.clone().sub(D[b].from), f0);
    const f = (1 - Math.max(0, up) / FADE) ** 2;
    fadeOf[i] = f;
    dP.set(p.addScaledVector(d, f).toArray(), i * 3);
  }

  // Weights: the donor's by bone name; near the ring the costume's (nearest costume ring corner) mixed in.
  const cIdx = new Map(costume.bones.map((b, i) => [bare(b.name), i]));
  const dMap = donor.bones.map((b) => cIdx.get(bare(b.name)) ?? cIdx.get('Head') ?? 0);
  const cSI = cg.attributes.skinIndex, cSW = cg.attributes.skinWeight;
  const dSI = dg.attributes.skinIndex, dSW = dg.attributes.skinWeight;
  const nearestRing = (p) => {
    let best = C[0].slot, bd = Infinity;
    for (const c of C) {
      const d = c.p.distanceToSquared(p);
      if (d < bd) (bd = d), (best = c.slot);
    }
    return best;
  };

  // Skin tone: the costume's hands (bare), else its own neck; the donor's neck skin brought to it.
  const handPick = (v) => boneShare(cg, costume.bones, v, (n) => /Hand/.test(n)) > 0.5;
  const ownNeck = (v) => boneShare(cg, costume.bones, v, (n) => n === 'Neck') > 0.4;
  const want = skinMean(cg, costume.img, handPick) ?? skinMean(cg, costume.img, ownNeck);
  const have = skinMean(dg, donor.img, (v) => headVerts.has(v) && boneShare(dg, donor.bones, v, (n) => n === 'Neck') > 0.4) ?? skinMean(dg, donor.img, (v) => headVerts.has(v));
  // Brightness matched (within reason), the hue only halfway (no ruddy face off a warm-lit glove cuff).
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const gain = want && have
    ? (() => {
        const L = Math.min(1.3, Math.max(0.75, lum(want) / Math.max(1, lum(have))));
        return want.map((w, k) => L * Math.sqrt(w / lum(want) / Math.max(1e-3, have[k] / lum(have))));
      })()
    : [1, 1, 1];
  const donorImg = { data: Buffer.from(donor.img.data), w: donor.img.w, h: donor.img.h };
  if (gain.some((g) => Math.abs(g - 1) > 0.01))
    for (let i = 0; i < donorImg.w * donorImg.h; i++) {
      const o = i * 4;
      const s = skinness(donorImg.data[o], donorImg.data[o + 1], donorImg.data[o + 2]);
      if (!s) continue;
      for (let k = 0; k < 3; k++) donorImg.data[o + k] = Math.min(255, Math.round(donorImg.data[o + k] * (1 + (gain[k] - 1) * s)));
    }

  // The zipper: triangles between the two rings, round by angle (closed whatever their corner counts).
  const zip = [];
  {
    const n = C.length, m = D.length;
    let i = 0, j = 0;
    const ca = (k) => (k < n ? C[k].a : C[k - n].a + TAU);
    const da = (k) => (k < m ? D[k].a : D[k - m].a + TAU);
    while (i < n || j < m) {
      const advC = j >= m || (i < n && ca(i + 1) <= da(j + 1));
      if (advC) zip.push([{ c: C[i % n] }, { c: C[(i + 1) % n] }, { d: D[j % m] }]), i++;
      else zip.push([{ c: C[i % n] }, { d: D[(j + 1) % m] }, { d: D[j % m] }]), j++;
    }
  }
  const dUVsrc = dg.attributes.uv.array;

  // Assemble: the costume without its head, the donor head, the zipper (on the donor's texture).
  const nT = cs.rest.length + ds.head.length + zip.length;
  const P = new Float32Array(nT * 9), N = new Float32Array(nT * 9);
  const SI = new Uint16Array(nT * 12), SW = new Float32Array(nT * 12);
  const cN = cg.attributes.normal.array, dN = dg.attributes.normal.array;
  const cUV = cg.attributes.uv.array;
  let o = 0;
  for (const t of cs.rest)
    for (let k = 0; k < 3; k++, o++) {
      const i = t * 3 + k;
      P.set(cP.subarray(i * 3, i * 3 + 3), o * 3);
      N.set(cN.subarray(i * 3, i * 3 + 3), o * 3);
      for (let c = 0; c < 4; c++) (SI[o * 4 + c] = cSI.getComponent(i, c)), (SW[o * 4 + c] = cSW.getComponent(i, c));
    }
  const headStart = o;
  const setW = (o, mix) => {
    const list = [...mix].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((s, x) => s + x[1], 0) || 1;
    list.forEach(([j, w], c) => ((SI[o * 4 + c] = j), (SW[o * 4 + c] = w / sum)));
  };
  const costumeW = (slot, f, mix) => {
    for (let c = 0; c < 4; c++) {
      const w = cSW.getComponent(slot, c);
      if (w > 0) mix.set(cSI.getComponent(slot, c), (mix.get(cSI.getComponent(slot, c)) ?? 0) + w * f);
    }
  };
  for (const t of ds.head)
    for (let k = 0; k < 3; k++, o++) {
      const i = t * 3 + k;
      P.set(dP.subarray(i * 3, i * 3 + 3), o * 3);
      N.set(dN.subarray(i * 3, i * 3 + 3), o * 3);
      const mix = new Map();
      for (let c = 0; c < 4; c++) {
        const w = dSW.getComponent(i, c);
        if (w > 0) mix.set(dMap[dSI.getComponent(i, c)], (mix.get(dMap[dSI.getComponent(i, c)]) ?? 0) + w * (1 - fadeOf[i]));
      }
      if (fadeOf[i] > 0) costumeW(nearestRing(new Vector3().fromArray(dP, i * 3)), fadeOf[i], mix);
      setW(o, mix);
    }
  const zipStart = o;
  const zipUV = [];
  for (const tri of zip) {
    let ps = tri.map((v) => (v.c ? v.c.p : v.d.to));
    const nrm = ps[1].clone().sub(ps[0]).cross(ps[2].clone().sub(ps[0]));
    const mid = ps[0].clone().add(ps[1]).add(ps[2]).multiplyScalar(1 / 3);
    const out = rel(mid).addScaledVector(axis, -height(mid));
    if (nrm.dot(out) < 0) {
      tri.reverse();
      ps = tri.map((v) => (v.c ? v.c.p : v.d.to));
    }
    const nn = out.normalize();
    // A sliver of the donor's neck skin: all its corners on one texel of a donor ring corner (no stretched island).
    const dv = tri.find((v) => v.d)?.d ?? D.reduce((b, d) => (d.to.distanceTo(mid) < b.to.distanceTo(mid) ? d : b), D[0]);
    for (const [k, v] of tri.entries()) {
      P.set(ps[k].toArray(), o * 3);
      N.set(nn.toArray(), o * 3);
      const mix = new Map();
      costumeW(v.c ? v.c.slot : nearestRing(v.d.to), 1, mix);
      setW(o, mix);
      const s = dv.slot;
      zipUV.push(dUVsrc[s * 2], dUVsrc[s * 2 + 1]);
      o++;
    }
  }
  // One normal per position along the seam (both sides shade alike).
  const at = new Map();
  for (let v = 0; v < o; v++) {
    const k = key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    let l = at.get(k);
    if (!l) at.set(k, (l = []));
    l.push(v);
  }
  for (const l of at.values()) {
    if (l.length < 2 || !l.some((v) => v >= headStart) || !l.some((v) => v < headStart)) continue;
    const n = new Vector3();
    for (const v of l) if (v < zipStart) n.add(new Vector3().fromArray(N, v * 3));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    for (const v of l) N.set(n.toArray(), v * 3);
  }
  // The atlas: the zipper rides with the donor head (its UVs are the donor's).
  const nz = zip.length;
  const dUV = new Float32Array(dUVsrc.length + nz * 6);
  dUV.set(dUVsrc);
  dUV.set(zipUV, dUVsrc.length);
  const zipTris = Array.from({ length: nz }, (_, k) => dUVsrc.length / 6 + k);
  const cOut = new Float32Array(cUV.length), dOut = new Float32Array(dUV.length);
  const atlas = packAtlas([
    { uv: cUV, tris: cs.rest, img: costume.img, out: cOut },
    { uv: dUV, tris: [...ds.head, ...zipTris], img: donorImg, out: dOut },
  ]);
  const U = new Float32Array(nT * 6);
  o = 0;
  for (const t of cs.rest) for (let k = 0; k < 3; k++, o++) U.set(cOut.subarray((t * 3 + k) * 2, (t * 3 + k) * 2 + 2), o * 2);
  for (const t of [...ds.head, ...zipTris]) for (let k = 0; k < 3; k++, o++) U.set(dOut.subarray((t * 3 + k) * 2, (t * 3 + k) * 2 + 2), o * 2);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(P, 3));
  geo.setAttribute('normal', new BufferAttribute(N, 3));
  geo.setAttribute('uv', new BufferAttribute(U, 2));
  geo.setAttribute('skinIndex', new BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(SW, 4));
  // Open edges left along the seam (0: closed).
  let open = 0;
  {
    const edges = new Map();
    for (let t = 0; t < o / 3; t++)
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k, j = t * 3 + ((k + 1) % 3);
        const ka = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), kb = key(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
        if (ka === kb) continue;
        const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    const seamKeys = new Set([...C.map((c) => key(c.p.x, c.p.y, c.p.z)), ...D.map((d) => key(d.to.x, d.to.y, d.to.z))]);
    for (const [e, c] of edges) if (c === 1 && e.split('|').every((k) => seamKeys.has(k))) open++;
  }
  return {
    geo,
    img: atlas,
    info: { removed: cs.head.length, head: ds.head.length, ring: [C.length, D.length], zip: nz, openSeamEdges: open, gain: gain.map((g) => +g.toFixed(3)), atlas: atlas.w, charts: atlas.charts },
  };
}
