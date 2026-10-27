import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, TorusGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ShoeKind = 'sneakers' | 'boots' | 'barefoot';

export interface ShoeStyle {
  kind: ShoeKind;
  upper: number;
  sole: number;
  laces: number;
  collar: number;
}

/**
 * One cross-section of the foot, toe at -Z, heel at +Z. Heights are above the ground.
 * w: half width of the upper; top: top of the upper; soleT/soleB: sole top / bottom lift
 * (a lifted bottom is the heel bevel and the toe spring).
 */
interface Station {
  z: number;
  w: number;
  top: number;
  soleT: number;
  soleB: number;
}

// prettier-ignore
const SNEAKER: Station[] = [
  { z:  0.082, w: 0.030, top: 0.098, soleT: 0.030, soleB: 0.018 },
  { z:  0.072, w: 0.040, top: 0.112, soleT: 0.032, soleB: 0.005 },
  { z:  0.045, w: 0.046, top: 0.116, soleT: 0.031, soleB: 0 },
  { z:  0.005, w: 0.047, top: 0.112, soleT: 0.028, soleB: 0.003 },
  { z: -0.040, w: 0.050, top: 0.092, soleT: 0.024, soleB: 0.002 },
  { z: -0.090, w: 0.054, top: 0.068, soleT: 0.022, soleB: 0 },
  { z: -0.135, w: 0.054, top: 0.056, soleT: 0.021, soleB: 0 },
  { z: -0.168, w: 0.047, top: 0.048, soleT: 0.020, soleB: 0.004 },
  { z: -0.188, w: 0.033, top: 0.040, soleT: 0.020, soleB: 0.010 },
  { z: -0.197, w: 0.016, top: 0.031, soleT: 0.021, soleB: 0.017 },
];

/** Work boot: thick lugged sole, a real heel block with a breast step, a blunt steel-toe box. */
// prettier-ignore
const BOOT: Station[] = [
  { z:  0.086, w: 0.033, top: 0.104, soleT: 0.042, soleB: 0.014 },
  { z:  0.076, w: 0.043, top: 0.118, soleT: 0.044, soleB: 0 },
  { z:  0.040, w: 0.048, top: 0.122, soleT: 0.043, soleB: 0 },
  { z:  0.002, w: 0.048, top: 0.120, soleT: 0.040, soleB: 0 },
  { z: -0.004, w: 0.048, top: 0.118, soleT: 0.034, soleB: 0.012 },
  { z: -0.045, w: 0.051, top: 0.098, soleT: 0.030, soleB: 0.006 },
  { z: -0.095, w: 0.056, top: 0.074, soleT: 0.030, soleB: 0 },
  { z: -0.140, w: 0.057, top: 0.064, soleT: 0.029, soleB: 0 },
  { z: -0.175, w: 0.051, top: 0.060, soleT: 0.029, soleB: 0.006 },
  { z: -0.196, w: 0.036, top: 0.052, soleT: 0.030, soleB: 0.014 },
  { z: -0.205, w: 0.018, top: 0.042, soleT: 0.031, soleB: 0.022 },
];

/** Bare foot: the sneaker last, narrower and flatter, with a thin "sole" of calloused skin. */
const BAREFOOT: Station[] = SNEAKER.map((s) => ({ z: s.z * 0.95, w: s.w * 0.8, top: 0.012 + (s.top - s.soleT) * 0.7, soleT: 0.012, soleB: s.soleB * 0.5 }));

/** Points across the upper's arch (side, over the top, other side). */
const ARCH = 9;
/** < 1 squares the arch off: vertical sides, a rounded top edge. */
const ARCH_POWER = 0.55;
/** The sole sticks out past the upper by this much, m. */
const WELT = 0.005;
const BEVEL = 0.006;

/**
 * Anatomical low-poly shoe in the shin's frame: the ankle (end of the shin) is the origin, the
 * ground is `ground` below it. Upper, sole, collar, tongue and laces are merged into one geometry
 * with vertex colors, so one shoe is one draw call (~450 triangles). `barefoot` is the same last
 * without sole, collar and laces.
 */
export function buildShoeGeometry(style: ShoeStyle, ground: number): BufferGeometry {
  const st = style.kind === 'boots' ? BOOT : style.kind === 'barefoot' ? BAREFOOT : SNEAKER;
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, color: number) => parts.push(finish(g, color));

  add(loftUpper(st, ground), style.upper);
  add(loftSole(st, ground), style.sole);
  if (style.kind === 'barefoot') return merge(parts);

  const topAt = (z: number) => sample(st, z, 'top') + ground;
  if (style.kind === 'sneakers') {
    // Rubber toe bumper and a heel tab.
    add(loftUpper(st.slice(-4), ground, 0.38, 1.04), style.sole);
    add(box(0.022, 0.03, 0.008, 0, topAt(0.07) - 0.004, 0.086, -0.2), style.collar);
  } else {
    // Shaft around the shin, laced up the front.
    // Centred on the shin and wider than the trouser leg, so the jeans read as tucked in.
    const shaft = new CylinderGeometry(0.066, 0.062, 0.11, 9, 1, true);
    shaft.translate(0, ground + 0.155, 0);
    add(shaft, style.upper);
    for (let n = 0; n < 4; n++) add(box(0.05, 0.006, 0.008, 0, ground + 0.12 + n * 0.022, -0.064), style.laces);
  }

  // Padded collar around the ankle opening, tilted down toward the instep.
  const boots = style.kind === 'boots';
  const collar = new TorusGeometry(boots ? 0.066 : 0.043, boots ? 0.011 : 0.009, 4, 10);
  collar.rotateX(Math.PI / 2);
  collar.scale(1, 1, boots ? 1.1 : 1.22);
  collar.rotateX(boots ? -0.12 : 0.1);
  collar.translate(0, boots ? ground + 0.212 : topAt(0.03) - 0.006, boots ? 0 : 0.026);
  add(collar, style.collar);

  // Tongue rising out of the instep, then laces across it.
  const tongueZ = style.kind === 'boots' ? -0.035 : -0.02;
  add(box(0.05, 0.012, 0.07, 0, topAt(tongueZ) + 0.004, tongueZ, -0.5), style.upper);
  for (let n = 0; n < 4; n++) {
    const z = -0.035 - n * 0.022;
    const slope = Math.atan2(topAt(z - 0.01) - topAt(z + 0.01), 0.02);
    add(box(0.058 - n * 0.004, 0.004, 0.007, 0, topAt(z) + 0.001, z, -slope), style.laces);
  }

  return merge(parts);
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged!;
}

/** Linear interpolation of a station field at z. */
function sample(st: Station[], z: number, key: keyof Station): number {
  if (z >= st[0].z) return st[0][key];
  for (let i = 1; i < st.length; i++) {
    if (z >= st[i].z) {
      const t = (z - st[i - 1].z) / (st[i].z - st[i - 1].z);
      return st[i - 1][key] + (st[i][key] - st[i - 1][key]) * t;
    }
  }
  return st[st.length - 1][key];
}

/**
 * The upper: an arch lofted through the stations and closed at both ends.
 * `heightScale` < 1 makes a low band (the toe bumper); `grow` pushes it slightly outward.
 */
function loftUpper(st: Station[], ground: number, heightScale = 1, grow = 1): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of st) {
    const base = ground + s.soleT - 0.002;
    const h = (s.top - s.soleT) * heightScale;
    for (let a = 0; a < ARCH; a++) {
      const th = -Math.PI / 2 + (Math.PI * a) / (ARCH - 1);
      const sx = Math.sin(th);
      const cy = Math.cos(th);
      pos.push(s.w * grow * Math.sign(sx) * Math.abs(sx) ** ARCH_POWER, base + h * Math.abs(cy) ** ARCH_POWER, s.z);
    }
  }
  for (let i = 0; i < st.length - 1; i++) {
    for (let a = 0; a < ARCH - 1; a++) {
      const p = i * ARCH + a;
      const q = p + ARCH;
      idx.push(p, p + 1, q, p + 1, q + 1, q);
    }
  }
  capFan(pos, idx, 0, ARCH, true);
  capFan(pos, idx, (st.length - 1) * ARCH, ARCH, false);
  return indexed(pos, idx);
}

/** The sole: a closed ring lofted through the stations, with chamfered bottom edges. */
function loftSole(st: Station[], ground: number): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const RING = 6;
  for (const s of st) {
    const w = s.w + WELT;
    const top = ground + s.soleT;
    const bot = ground + s.soleB;
    const bev = Math.min(BEVEL, (top - bot) * 0.45);
    // Clockwise seen from the heel: top-left, down the left side, across the tread, up the right side.
    pos.push(-w, top, s.z, -w, bot + bev, s.z, -w + bev, bot, s.z, w - bev, bot, s.z, w, bot + bev, s.z, w, top, s.z);
  }
  for (let i = 0; i < st.length - 1; i++) {
    for (let a = 0; a < RING; a++) {
      const p = i * RING + a;
      const p1 = i * RING + ((a + 1) % RING);
      const q = p + RING;
      const q1 = p1 + RING;
      idx.push(p, q, p1, p1, q, q1);
    }
  }
  capFan(pos, idx, 0, RING, false);
  capFan(pos, idx, (st.length - 1) * RING, RING, true);
  return indexed(pos, idx);
}

/** Closes a ring with a fan around its centroid. */
function capFan(pos: number[], idx: number[], start: number, count: number, flip: boolean): void {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let a = 0; a < count; a++) {
    cx += pos[(start + a) * 3];
    cy += pos[(start + a) * 3 + 1];
    cz += pos[(start + a) * 3 + 2];
  }
  const c = pos.length / 3;
  pos.push(cx / count, cy / count, cz / count);
  for (let a = 0; a < count - 1; a++) {
    if (flip) idx.push(c, start + a + 1, start + a);
    else idx.push(c, start + a, start + a + 1);
  }
}

function indexed(pos: number[], idx: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, tiltX = 0): BufferGeometry {
  const g = new BoxGeometry(sx, sy, sz);
  g.rotateX(tiltX);
  g.translate(x, y, z);
  return g;
}

/**
 * Non-indexed, smooth-shaded where it was indexed, with box-projected UVs (the grime texture
 * tiles ~7× per metre) and a flat vertex color. All parts end with the same attributes for merging.
 */
function finish(g: BufferGeometry, color: number): BufferGeometry {
  g.deleteAttribute('uv');
  if (!g.index) g.deleteAttribute('normal');
  g.computeVertexNormals();
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  const p = out.getAttribute('position');
  const n = out.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  const col = new Float32Array(p.count * 3);
  // Vertex colors are read in linear space; Color converts from the sRGB hex.
  const { r, g: gr, b } = new Color(color);
  const T = 7;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const x = p.getX(i) * T;
    const y = p.getY(i) * T;
    const z = p.getZ(i) * T;
    if (ay >= ax && ay >= az) uv.set([x, z], i * 2);
    else if (ax >= az) uv.set([z, y], i * 2);
    else uv.set([x, y], i * 2);
    col.set([r, gr, b], i * 3);
  }
  out.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  return out;
}
