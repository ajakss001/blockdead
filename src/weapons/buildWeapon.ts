import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Curve,
  CylinderGeometry,
  DataTexture,
  ExtrudeGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  Shape,
  Sphere,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { glslColor, look, NOISE_GLSL, stainGlsl } from '../style/look';
import { grim, hex, luminance, RUST, rgb, TAPE } from '../style/palette';
import { WEAPONS, type WeaponId } from './config';

/**
 * Procedural melee weapons from low-poly primitives, merged into ONE mesh each: colours per vertex, one
 * shared material — one draw call per weapon.
 *
 * The grim look (CLAUDE.md «Визуальный стиль», `look.grim`): every colour through `grim`, each part made of
 * something (`Wear`: chipped paint over steel, bare steel, faded fibreglass, insulating tape, worn dark
 * wood, cord) that the shader wears — paint chipped to the steel along the rims, rust spots, scratches,
 * wood grain, the tape's wraps, dirt — on a rough MeshStandardMaterial, metal only where it is metal.
 * The inverted-hull outline stays in the geometry but is drawn only by the highlight (a weapon on the
 * ground under the crosshair). `look.grim = false` (the viewer's «до»): the old toon look with the outline.
 *
 * Model frame: the origin at the grip (where the hand holds the handle — the lower hand of a two-handed
 * one), the weapon along −Z, the blade / striking face up (+Y). Parts are laid out in the build frame of
 * the held items (player/held: the handle along +Y from the butt at 0, the blade to −Z) and turned into
 * the model frame at the end; `heldMatrix` turns it back for the hands.
 */

type Paint = number | ((p: Vector3) => number);

/** What a part is made of: how it is coloured and worn in the grim look (the shader's kinds, in order). */
const WEAR = ['paint', 'steel', 'glass', 'tape', 'wood', 'cloth', 'coated'] as const;
type Wear = (typeof WEAR)[number];

interface Part {
  geo: BufferGeometry;
  color: Paint;
  wear: Wear | ((p: Vector3) => Wear);
  /** Extra wear by place (0..1, build frame): the paint goes first there (a blade's front, a bar's ends). */
  rim?: (p: Vector3) => number;
  /** Gets the outline (default true; thin cords don't). */
  outline?: boolean;
  /** A flat piece whose narrow sides wear first (default: by its proportions; a bent tube is not). */
  flat?: boolean;
}

export interface BuiltWeapon {
  id: WeaponId;
  /** Model frame (see above): body triangles first, then the outline's. */
  geometry: BufferGeometry;
  triangles: number;
  outlineTriangles: number;
}

// ── Part helpers, build frame: y along the handle from the butt, −z the blade side ──────────────────────

/** A shaft from y0 to y1 (radius r0 → r1), `seg` sides, squashed across (x) by sx. */
function cyl(r0: number, r1: number, y0: number, y1: number, seg = 6, sx = 1): BufferGeometry {
  return new CylinderGeometry(r1, r0, y1 - y0, seg).scale(sx, 1, 1).translate(0, (y0 + y1) / 2, 0);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(x, y, z);
}

/**
 * A flat piece cut from a 2D outline [forward (−z), along (y)], `thick` across (x) about `x0`, thinning
 * towards the front by `taper` (scale of the thickness at the most forward point, linear).
 */
function slab(points: [number, number][], thick: number, taper = 1, x0 = 0): BufferGeometry {
  const shape = new Shape();
  points.forEach(([f, a], i) => (i ? shape.lineTo(f, a) : shape.moveTo(f, a)));
  const g = new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 2 });
  const fs = points.map((p) => p[0]);
  const f0 = Math.min(...fs);
  const f1 = Math.max(...fs);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const f = pos.getX(i);
    const k = 1 + (taper - 1) * ((f - f0) / Math.max(1e-6, f1 - f0));
    pos.setXYZ(i, x0 + (pos.getZ(i) - thick / 2) * k, pos.getY(i), -f);
  }
  g.computeVertexNormals();
  return g;
}

/** A flat piece in its own plane: outline (u, v) laid along U and V from `at`, `thick` along U × V. */
function plate(points: [number, number][], thick: number, at: Vector3, U: Vector3, V: Vector3): BufferGeometry {
  const shape = new Shape();
  points.forEach(([u, v], i) => (i ? shape.lineTo(u, v) : shape.moveTo(u, v)));
  const g = new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 2 });
  const W = new Vector3().crossVectors(U, V).normalize();
  g.translate(0, 0, -thick / 2);
  g.applyMatrix4(new Matrix4().makeBasis(U, V, W).setPosition(at));
  g.computeVertexNormals();
  return g;
}

/** An arc in the y–z plane about (cy, cz), angle from +z towards +y. */
class Arc extends Curve<Vector3> {
  constructor(
    private readonly cy: number,
    private readonly cz: number,
    private readonly r: number,
    private readonly a0: number,
    private readonly a1: number,
  ) {
    super();
  }
  override getPoint(t: number, out = new Vector3()): Vector3 {
    const a = this.a0 + (this.a1 - this.a0) * t;
    return out.set(0, this.cy + this.r * Math.sin(a), this.cz + this.r * Math.cos(a));
  }
}

const ramp01 = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));

// ── The four weapons ─────────────────────────────────────────────────────────────────────────────────

function fireAxe(): Part[] {
  const c = WEAPONS.fireAxe.colors;
  const parts: Part[] = [
    // Fibreglass handle, oval (wider fore and aft), into the head.
    { geo: cyl(0.016, 0.015, 0, 0.875, 6, 0.8), color: c.handle, wear: 'glass' },
    // The grip at the bottom wrapped in tape, a knob at the butt, ribs.
    { geo: cyl(0.0185, 0.018, 0.012, 0.3, 6, 0.85), color: c.grip, wear: 'tape' },
    { geo: cyl(0.022, 0.021, 0, 0.022, 6, 0.85), color: c.grip, wear: 'tape' },
    // The painted head: the eye round the handle, the wide blade forward (worn to the steel towards the
    // edge), the pick behind.
    { geo: box(0.034, 0.085, 0.06, 0, 0.855, 0), color: c.head, wear: 'paint' },
    {
      geo: slab([[0.025, 0.897], [0.15, 0.903], [0.155, 0.745], [0.12, 0.762], [0.07, 0.798], [0.025, 0.814]], 0.024, 0.3),
      color: c.head,
      wear: 'paint',
      rim: (p) => ramp01(0.09, 0.15, -p.z) * 0.6,
    },
    // The ground edge: bright steel along the front of the blade.
    { geo: slab([[0.146, 0.903], [0.174, 0.906], [0.182, 0.82], [0.18, 0.735], [0.151, 0.746]], 0.008, 0.45), color: c.edge, wear: 'steel' },
    { geo: slab([[-0.025, 0.893], [-0.15, 0.872], [-0.15, 0.858], [-0.025, 0.822]], 0.026, 0.45), color: c.head, wear: 'paint', rim: (p) => ramp01(0.1, 0.15, p.z) * 0.6 },
    { geo: slab([[-0.148, 0.873], [-0.185, 0.865], [-0.148, 0.857]], 0.012, 0.3), color: c.edge, wear: 'steel' },
  ];
  for (let k = 0; k < 6; k++) parts.push({ geo: cyl(0.021, 0.021, 0.05 + k * 0.042, 0.058 + k * 0.042, 6, 0.85), color: c.grip, wear: 'tape' });
  return parts;
}

function tacticalKnife(): Part[] {
  const c = WEAPONS.tacticalKnife.colors;
  // Spine behind (+z), the edge forward; serrations on the spine by the guard, a clip point.
  const blade: [number, number][] = [[-0.011, 0.126]];
  for (let k = 0; k < 5; k++) blade.push([-0.011, 0.134 + k * 0.009], [-0.0155, 0.1385 + k * 0.009]);
  blade.push([-0.011, 0.179], [-0.011, 0.243], [-0.004, 0.279], [0.006, 0.268], [0.014, 0.25], [0.017, 0.226], [0.017, 0.126]);
  const parts: Part[] = [
    { geo: cyl(0.012, 0.012, 0, 0.012, 8, 0.7), color: c.guard, wear: 'steel' },
    // The handle wrapped in tape.
    { geo: cyl(0.0135, 0.0125, 0.012, 0.118, 8, 0.7), color: c.handle, wear: 'tape' },
    { geo: box(0.016, 0.008, 0.048, 0, 0.122, 0.002), color: c.guard, wear: 'steel' },
    // The coated blade, the coating worn off towards the edge and the point.
    { geo: slab(blade, 0.0055, 0.35), color: c.blade, wear: 'coated', rim: (p) => ramp01(0.004, 0.012, -p.z) * 0.5 + ramp01(0.23, 0.27, p.y) * 0.4 },
    // The bright bevel along the edge to the tip.
    {
      geo: slab([[0.0105, 0.127], [0.0178, 0.127], [0.0178, 0.226], [0.0148, 0.251], [0.0068, 0.269], [-0.003, 0.279], [0.003, 0.263], [0.009, 0.246], [0.0112, 0.225]], 0.0034, 0.8),
      color: c.edge,
      wear: 'steel',
    },
    // Paracord loop through the butt.
    { geo: new TorusGeometry(0.016, 0.0028, 4, 8).rotateY(Math.PI / 2).translate(0, -0.014, 0.004), color: c.cord, wear: 'cloth', outline: false },
    { geo: cyl(0.0035, 0.0035, -0.004, 0.004, 4), color: c.cord, wear: 'cloth', outline: false },
  ];
  for (let k = 0; k < 4; k++) parts.push({ geo: cyl(0.0148, 0.0148, 0.03 + k * 0.022, 0.035 + k * 0.022, 8, 0.7), color: c.handle, wear: 'tape' });
  return parts;
}

function crowbar(): Part[] {
  const c = WEAPONS.crowbar.colors;
  const R = 0.0115;
  // The hook: from the top of the bar over and down in front, the paint worn off its last stretch.
  const a1 = Math.PI + 0.35;
  const cy = 0.69;
  const cz = -0.052;
  const hook = new TubeGeometry(new Arc(cy, cz, 0.052, 0, a1), 9, R, 6, false);
  const end = new Vector3(0, cy + 0.052 * Math.sin(a1), cz + 0.052 * Math.cos(a1));
  const tangent = new Vector3(0, Math.cos(a1), -Math.sin(a1)).normalize();
  // The split claw at the hook's end: flat across (x), a V between two prongs.
  const claw: [number, number][] = [[-0.0125, -0.004], [0.0125, -0.004], [0.0135, 0.03], [0.0045, 0.047], [0, 0.031], [-0.0045, 0.047], [-0.0135, 0.03]];
  const butt = new Vector3(0, 0.055, 0);
  const down = new Vector3(0, -Math.cos(0.26), Math.sin(0.26));
  const bare = (p: Vector3) => p.y < cy - 0.02 && p.z < cz - 0.03;
  return [
    { geo: cyl(R, R, 0.05, 0.095, 6), color: c.steel, wear: 'steel' },
    // The painted bar: the paint goes first at the ends, where it is held and where it pries.
    { geo: cyl(R, R, 0.095, 0.69, 6), color: c.paint, wear: 'paint', rim: (p) => Math.max(ramp01(0.2, 0.1, p.y), ramp01(0.55, 0.69, p.y)) * 0.5 },
    { geo: hook, color: (p) => (bare(p) ? c.steel : c.paint), wear: (p) => (bare(p) ? 'steel' : 'paint'), rim: () => 0.3, flat: false },
    { geo: plate(claw, 0.008, end, new Vector3(1, 0, 0), tangent), color: c.steel, wear: 'steel' },
    // The other end: flat, a little bent.
    { geo: plate([[-0.011, -0.004], [0.011, -0.004], [0.0155, 0.052], [-0.0155, 0.052]], 0.007, butt, new Vector3(1, 0, 0), down), color: c.steel, wear: 'steel' },
  ];
}

function hammer(): Part[] {
  const c = WEAPONS.hammer.colors;
  const y = 0.305;
  const claw: [number, number][] = [[-0.012, 0.323], [-0.05, 0.319], [-0.08, 0.306], [-0.103, 0.283], [-0.107, 0.276], [-0.098, 0.279], [-0.075, 0.293], [-0.045, 0.3], [-0.012, 0.292]];
  return [
    // Wooden handle (oval), its flared butt, the grip wrapped in tape.
    { geo: cyl(0.0135, 0.012, 0, 0.318, 8, 0.75), color: c.handle, wear: 'wood' },
    { geo: cyl(0.0172, 0.0165, 0, 0.018, 8, 0.75), color: c.handle, wear: 'wood' },
    { geo: cyl(0.0163, 0.0155, 0.018, 0.155, 8, 0.75), color: c.grip, wear: 'tape' },
    // Steel head: the eye, the neck and the round face forward, the split curved claw behind.
    { geo: box(0.026, 0.042, 0.034, 0, y, 0), color: c.head, wear: 'steel' },
    { geo: new CylinderGeometry(0.013, 0.011, 0.03, 8).rotateX(Math.PI / 2).translate(0, y, -0.031), color: c.head, wear: 'steel' },
    { geo: new CylinderGeometry(0.0165, 0.0145, 0.013, 8).rotateX(Math.PI / 2).translate(0, y, -0.0525), color: c.head, wear: 'steel' },
    { geo: slab([[-0.012, 0.323], [-0.036, 0.319], [-0.036, 0.296], [-0.012, 0.292]], 0.022), color: c.head, wear: 'steel' },
    { geo: slab(claw, 0.0085, 1, 0.0065), color: c.head, wear: 'steel' },
    { geo: slab(claw, 0.0085, 1, -0.0065), color: c.head, wear: 'steel' },
  ];
}

const PARTS: Record<WeaponId, () => Part[]> = { fireAxe, tacticalKnife, crowbar, hammer };

// ── Colours ──────────────────────────────────────────────────────────────────────────────────────────

/** A colour washed towards its own grey by k (0..1). */
function fade(color: number, k: number): number {
  const L = luminance(color);
  return hex(...(rgb(color).map((v) => v + (L - v) * k) as [number, number, number]));
}

/** The colour of a part in the grim look, by what it is made of. */
function grimColor(color: number, wear: Wear): number {
  if (wear === 'tape') return TAPE;
  if (wear === 'wood') return hex(...(rgb(grim(color)).map((v) => v * 0.62) as [number, number, number]));
  if (wear === 'glass') return fade(grim(color), 0.3);
  // Steel: grey worn metal, not the cold blue of a new tool.
  if (wear === 'steel') return fade(grim(color), 0.6);
  return grim(color);
}

// ── Frames ───────────────────────────────────────────────────────────────────────────────────────────

/** Build frame → model frame: the handle (+y) to −z, the blade (−z) up, the grip point to the origin. */
function modelFromBuild(id: WeaponId): Matrix4 {
  const g = WEAPONS[id].grip;
  return new Matrix4().set(-1, 0, 0, 0, 0, 0, -1, 0, 0, -1, 0, g, 0, 0, 0, 1);
}

/** Model frame → the held-item frame of player/held (handle +Y from the butt, blade −Z). */
export function heldMatrix(id: WeaponId): Matrix4 {
  return modelFromBuild(id).invert();
}

// ── Merge ────────────────────────────────────────────────────────────────────────────────────────────

const cache = new Map<string, BuiltWeapon>();

/** Shared geometry of a weapon (built once per look). */
export function buildWeapon(id: WeaponId): BuiltWeapon {
  const key = look.grim ? id : `${id}:toy`;
  const hit = cache.get(key);
  if (hit) return hit;
  const grimLook = look.grim;
  const parts = PARTS[id]();
  const m = modelFromBuild(id);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const line: number[] = [];
  const wears: number[] = [];
  const rims: number[] = [];
  const body: number[] = [];
  const hull: number[] = [];
  const c = new Color();
  const v = new Vector3();
  const n = new Vector3();
  const add = (p: Part, outline: boolean) => {
    const g = p.geo;
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const smooth = outline ? smoothNormals(g) : null;
    const thin = p.flat === false ? null : thinAxis(g);
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      n.fromBufferAttribute(N, i);
      const wear = typeof p.wear === 'string' ? p.wear : p.wear(v);
      const hexc = typeof p.color === 'number' ? p.color : p.color(v);
      if (outline) c.setRGB(0, 0, 0);
      else c.setHex(grimLook ? grimColor(hexc, wear) : hexc);
      // The rims of a flat piece (its narrow sides) wear first, and wherever the part says.
      const rim = Math.min(1, (thin ? 1 - Math.abs(n.dot(thin)) : 0) * 0.45 + (p.rim ? p.rim(v) : 0));
      v.applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      if (smooth) v.fromArray(smooth, i * 3);
      else v.copy(n);
      // The frame change is a pure turn: normals turn the same way.
      v.transformDirection(m);
      nor.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
      line.push(outline ? 1 : 0);
      wears.push(WEAR.indexOf(wear));
      rims.push(rim);
    }
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: P.count }, (_, i) => i);
    for (let t = 0; t < idx.length; t += 3) {
      if (outline) hull.push(base + idx[t], base + idx[t + 2], base + idx[t + 1]);
      else body.push(base + idx[t], base + idx[t + 1], base + idx[t + 2]);
    }
  };
  for (const p of parts) add(p, false);
  for (const p of parts) if (p.outline !== false) add(p, true);
  for (const p of parts) p.geo.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geometry.setAttribute('aOutline', new BufferAttribute(new Float32Array(line), 1));
  geometry.setAttribute('aWear', new BufferAttribute(new Float32Array(wears), 1));
  geometry.setAttribute('aRim', new BufferAttribute(new Float32Array(rims), 1));
  geometry.setIndex(new BufferAttribute(new Uint16Array(body.concat(hull)), 1));
  const L = WEAPONS[id].length;
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, WEAPONS[id].grip - L / 2), L * 0.6);
  geometry.computeBoundingBox();
  const built: BuiltWeapon = { id, geometry, triangles: body.length / 3, outlineTriangles: hull.length / 3 };
  cache.set(key, built);
  return built;
}

/** The thin axis of a flat piece (a blade, a claw), null when the part isn't flat. */
function thinAxis(g: BufferGeometry): Vector3 | null {
  g.computeBoundingBox();
  const s = g.boundingBox!.getSize(new Vector3());
  const e = [s.x, s.y, s.z];
  const order = [0, 1, 2].sort((a, b) => e[a] - e[b]);
  if (e[order[0]] > 0.4 * e[order[1]]) return null;
  return new Vector3().setComponent(order[0], 1);
}

/** Normals averaged over vertices at the same spot: the hull pushed out along them has no cracks. */
function smoothNormals(g: BufferGeometry): Float32Array {
  const P = g.getAttribute('position');
  const N = g.getAttribute('normal');
  const sum = new Map<string, Vector3>();
  const key = (i: number) => `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
  for (let i = 0; i < P.count; i++) {
    const k = key(i);
    const s = sum.get(k) ?? sum.set(k, new Vector3()).get(k)!;
    s.x += N.getX(i);
    s.y += N.getY(i);
    s.z += N.getZ(i);
  }
  const out = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) sum.get(key(i))!.clone().normalize().toArray(out, i * 3);
  return out;
}

// ── Material ─────────────────────────────────────────────────────────────────────────────────────────

let ramp: DataTexture | null = null;
function toonRamp(): DataTexture {
  if (ramp) return ramp;
  ramp = new DataTexture(new Uint8Array([105, 175, 255]), 3, 1, RedFormat);
  ramp.minFilter = ramp.magFilter = NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

type Shader = { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string };

/** The hull (aOutline = 1) pushed out along its normal and drawn flat; width 0: not drawn at all. */
function outlineCompile(sh: Shader, width: number, color: number): void {
  sh.uniforms.uOutline = { value: width };
  sh.uniforms.uOutlineColor = { value: new Color(color) };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aOutline;\nvarying float vOutline;\nuniform float uOutline;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOutline = aOutline;\ntransformed += normalize(objectNormal) * aOutline * uOutline;')
    // No outline: the hull collapses to a point (nothing rasterised).
    .replace('#include <project_vertex>', '#include <project_vertex>\nif (aOutline > 0.5 && uOutline <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vOutline;\nuniform vec3 uOutlineColor;')
    .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (vOutline > 0.5) gl_FragColor = vec4(uOutlineColor, 1.0);');
}

/** Bare steel where the paint is gone: a neutral worn grey (not the cold blue of new steel). */
const STEEL = glslColor(0x77766f);

/** The wear of the grim look by kind (WEAR order), on the model-frame position: colour, metal, roughness. */
const WEAR_GLSL = /* glsl */ `
vec3 p = vWPos;
vec3 c = diffuseColor.rgb;
int k = int(vWear + 0.5);
float n1 = zNoise(p * 90.0);
float n2 = zNoise(p * 26.0 + 7.0);
float zMetal = 0.0;
float zRough = 0.9;
if (k == 0 || k == 6) {
  // Paint / coating: chipped to the steel along the rims and here and there, rust round the chips and in spots.
  // The paint stays the most of it: small chips, more along the rims; a thin rust edge round them.
  float th = k == 0 ? 0.76 : 0.78;
  float w = n1 * 0.55 + n2 * 0.45 + vRim * 0.25;
  float chip = smoothstep(th, th + 0.02, w);
  float halo = smoothstep(th - 0.04, th, w) * (1.0 - chip);
  float spot = smoothstep(0.76, 0.86, zNoise(p * 14.0 + 3.0) * 0.75 + n1 * 0.25) * (k == 0 ? 0.8 : 0.3);
  c *= 0.88 + 0.22 * n2;
  c = mix(c, ${STEEL} * (0.8 + 0.4 * n1), chip);
  c = mix(c, ${glslColor(RUST)}, max(halo * 0.6, spot * 0.7));
  zMetal = chip * 0.25;
  zRough = mix(0.9, 0.65, chip);
} else if (k == 1) {
  // Steel: scratches along the length, grime, rust spots.
  float scr = smoothstep(0.72, 0.9, zNoise(vec3(p.x * 420.0, p.y * 420.0, p.z * 14.0)));
  float rust = smoothstep(0.66, 0.78, zNoise(p * 18.0 + 1.0) * 0.7 + n1 * 0.3 - vRim * 0.2);
  c *= (0.8 + 0.3 * n2) * (1.0 + 0.3 * scr);
  c = mix(c, ${glslColor(RUST)} * (0.8 + 0.3 * n1), rust * 0.85);
  zMetal = 0.25 * (1.0 - rust);
  zRough = mix(0.75, 0.95, rust);
} else if (k == 2) {
  // Fibreglass: faded, fibres along the length, scuffed.
  float fib = zNoise(vec3(p.x * 160.0, p.y * 160.0, p.z * 4.0));
  c *= 0.86 + 0.2 * fib + 0.1 * smoothstep(0.65, 0.8, n1);
} else if (k == 3) {
  // Insulating tape: the wraps' edges, worn shiny patches.
  float t = fract(p.z * 48.0 + atan(p.y, p.x) / 6.2832);
  float seam = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.85, t);
  c *= (0.7 + 0.3 * seam) * (1.0 + 0.35 * smoothstep(0.62, 0.8, n2));
  zRough = 0.75;
} else if (k == 4) {
  // Dark wood: the grain along the handle, worn smooth and darker where it is held.
  float g = zNoise(vec3(p.x * 220.0, p.y * 220.0, p.z * 5.0)) * 0.7 + zNoise(p * 40.0) * 0.3;
  c *= 0.72 + 0.4 * g;
} else {
  c *= 0.8 + 0.3 * zNoise(p * 300.0);
}
${stainGlsl('p', 'c', 0.6)}
diffuseColor.rgb = c;
`;

/** A rough standard material worn per kind; the outline only when `width` > 0 (the highlight). */
function grimMaterial(width: number, color: number): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    outlineCompile(sh, width, color);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWear;\nattribute float aRim;\nvarying float vWear;\nvarying float vRim;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWear = aWear;\nvRim = aRim;\nvWPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vWear;\nvarying float vRim;\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${WEAR_GLSL}`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = zMetal;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = zRough;');
  };
  mat.customProgramCacheKey = () => `weapon-grim-${width > 0}`;
  return mat;
}

/** The old toy look: toon shading by vertex colour, the outline always on. */
function toonMaterial(width: number, color: number): MeshToonMaterial {
  const mat = new MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  mat.onBeforeCompile = (sh) => outlineCompile(sh, width, color);
  mat.customProgramCacheKey = () => `weapon-toy-${width}`;
  return mat;
}

const materials = new Map<string, Material>();

function lookMaterial(highlight: boolean): Material {
  const key = `${look.grim}:${highlight}`;
  let mat = materials.get(key);
  if (!mat) {
    if (look.grim) mat = highlight ? grimMaterial(0.012, 0xc9c0a0) : grimMaterial(0, 0);
    else mat = highlight ? toonMaterial(0.012, 0xffe7a0) : toonMaterial(0.0035, 0x000000);
    materials.set(key, mat);
  }
  return mat;
}

/** The one material of every weapon. */
export function weaponMaterial(): Material {
  return lookMaterial(false);
}

/** A weapon on the ground under the crosshair: a wider, light outline. */
export function weaponHighlightMaterial(): Material {
  return lookMaterial(true);
}

/** A mesh of the weapon in its model frame (shared geometry and material). */
export function weaponMesh(id: WeaponId): Mesh {
  const m = new Mesh(buildWeapon(id).geometry, weaponMaterial());
  m.name = `weapon:${id}`;
  return m;
}
