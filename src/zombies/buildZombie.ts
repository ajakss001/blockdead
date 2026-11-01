import {
  type Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Euler,
  Matrix3,
  Matrix4,
  MeshToonMaterial,
  NearestFilter,
  Quaternion,
  RedFormat,
  Skeleton,
  SkinnedMesh,
  Sphere,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BONES, type BoneName, boneIndex, createBones, type Proportions, restWorld, type SkeletonDims, skeletonDims } from './skeleton';

/**
 * Procedural zombies: a type (types/*.ts) lists its parts — low-poly primitives in the frame of the bone
 * that carries them — and this merges them into ONE SkinnedMesh, every vertex 100% on its bone (rigid
 * skinning): one draw call per zombie. Colours per vertex, one shared toon material for every zombie.
 *
 * The black outline is an inverted hull in the same geometry (and so the same draw call): a copy of the
 * outlined parts with smoothed normals and reversed winding, pushed out along the normal in the vertex
 * shader. Its triangles come after the body's: switching it off on weak devices just shortens the draw range.
 *
 * Missing limbs (`missing: ['arm_L']`) build no geometry; the bones stay, so every clip still plays.
 */

export type Limb = 'arm_L' | 'arm_R' | 'leg_L' | 'leg_R';
const LIMB_OF: Partial<Record<BoneName, Limb>> = {
  UpperArm_L: 'arm_L',
  LowerArm_L: 'arm_L',
  Hand_L: 'arm_L',
  UpperArm_R: 'arm_R',
  LowerArm_R: 'arm_R',
  Hand_R: 'arm_R',
  UpperLeg_L: 'leg_L',
  LowerLeg_L: 'leg_L',
  Foot_L: 'leg_L',
  UpperLeg_R: 'leg_R',
  LowerLeg_R: 'leg_R',
  Foot_R: 'leg_R',
};

export interface PartSpec {
  bone: BoneName;
  /** In the bone's rest frame. */
  geo: BufferGeometry;
  color: number;
  /** Self-lit (eyes): 0..2. */
  glow?: number;
  /** Gets the black outline (default true; small decals, hairs and teeth don't). */
  outline?: boolean;
  /** A pattern drawn over the colour (camouflage, grime, a check, a print): see `Pattern`. */
  paint?: Pattern;
}

/**
 * A surface pattern, drawn per pixel by the shared material from the bone-frame position (it sticks to the
 * part, costs no triangles): `spots` — blotches of a and b over the colour (camouflage, grime; `share` of the
 * area); `check` — a and b in cells; `flowers` — blossoms of a with b hearts (`share` of the cells);
 * `print` — blobs of a or b. `scale`: cells per metre.
 */
export interface Pattern {
  kind: 'spots' | 'check' | 'flowers' | 'print';
  a: number;
  b: number;
  scale: number;
  share: number;
}
const PATTERN_KIND = { spots: 1, check: 2, flowers: 3, print: 4 } as const;

export interface ZombieType {
  id: string;
  name: string;
  proportions: Proportions;
  missing: Limb[];
  /** Walk / run speed in the game (m/s), animation speed factor, health. */
  walk: number;
  run: number;
  animSpeed: number;
  hp: number;
  parts(d: SkeletonDims, kit: Kit): PartSpec[];
}

// ── Kit: low-poly primitives placed in a bone frame ──────────────────────────────────────────────────

type V3 = [number, number, number];
const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _a = new Vector3();
const _b = new Vector3();
const UP = new Vector3(0, 1, 0);

function place(g: BufferGeometry, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): BufferGeometry {
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
  return g.applyMatrix4(_m.compose(_a.set(...at), _q, _b.set(...scale)));
}

export const kit = {
  box: (w: number, h: number, d: number, at?: V3, rot?: V3) => place(new BoxGeometry(w, h, d), at, rot),
  rbox: (w: number, h: number, d: number, r: number, at?: V3, rot?: V3) => place(new RoundedBoxGeometry(w, h, d, 1, r), at, rot),
  /** Ellipsoid: a unit sphere scaled to radii. */
  ball: (r: V3, at?: V3, rot?: V3, ws = 7, hs = 5) => place(new SphereGeometry(1, ws, hs), at, rot, r),
  /** A flat decal or a small knob: the cheapest ellipsoid (20 triangles). */
  dot: (r: V3, at?: V3, rot?: V3) => place(new SphereGeometry(1, 5, 3), at, rot, r),
  capsule: (r: number, len: number, at?: V3, rot?: V3, radial = 6) => place(new CapsuleGeometry(r, len, 2, radial), at, rot),
  /** An elliptic, maybe tapered cylinder (radii x, z at the top; bottom = top × taper). */
  barrel: (rx: number, rz: number, h: number, taper: number, at?: V3, rot?: V3, radial = 8) => place(new CylinderGeometry(1, taper, h, radial), at, rot, [rx, 1, rz]),
  /** Part of an open tube (theta from +Z towards +X). */
  shell: (rx: number, rz: number, h: number, from: number, len: number, at?: V3, radial = 6) => place(new CylinderGeometry(1, 1.04, h, radial, 1, true, from, len), at, [0, 0, 0], [rx, 1, rz]),
  /** A tapered rod from a to b. */
  rod: (a: V3, b: V3, r0: number, r1: number, radial = 6) => {
    const s = new Vector3(...a);
    const e = new Vector3(...b);
    const len = s.distanceTo(e);
    const g = new CylinderGeometry(r1, r0, len, radial).translate(0, len / 2, 0);
    _q.setFromUnitVectors(UP, e.clone().sub(s).normalize());
    return g.applyMatrix4(_m.compose(s, _q, _b.set(1, 1, 1)));
  },
  /** A flat strap from a to b (width w, thickness t), its face towards `face`. */
  strap: (a: V3, b: V3, w: number, t: number, face: V3) => {
    const s = new Vector3(...a);
    const e = new Vector3(...b);
    const y = e.clone().sub(s);
    const len = y.length();
    y.normalize();
    const z = new Vector3(...face).projectOnPlane(y).normalize();
    const x = new Vector3().crossVectors(y, z);
    const g = new BoxGeometry(w, len, t).translate(0, len / 2, 0);
    return g.applyMatrix4(_m.makeBasis(x, y, z).setPosition(s));
  },
  cone: (r: number, h: number, at?: V3, rot?: V3, radial = 4) => place(new ConeGeometry(r, h, radial), at, rot),
  /** Any geometry moved by a matrix (e.g. into a frame hanging plumb from a stooped chest). */
  frame: (g: BufferGeometry, m: Matrix4) => g.applyMatrix4(m),
};
export type Kit = typeof kit;

// ── Building ─────────────────────────────────────────────────────────────────────────────────────────

export interface BuiltZombie {
  type: ZombieType;
  dims: SkeletonDims;
  geometry: BufferGeometry;
  /** Body triangles (no outline) and the outline's. */
  triangles: number;
  outlineTriangles: number;
  /** Rest world matrices (model frame) and their inverses. */
  rest: Matrix4[];
  inverses: Matrix4[];
}

const cache = new Map<string, BuiltZombie>();

/** Shared geometry of a type (built once). */
export function buildZombie(type: ZombieType): BuiltZombie {
  const hit = cache.get(type.id);
  if (hit) return hit;
  const dims = skeletonDims(type.proportions);
  const rest = restWorld(dims);
  const parts = type.parts(dims, kit).filter((p) => {
    const limb = LIMB_OF[p.bone];
    return !(limb && type.missing.includes(limb));
  });
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const glow: number[] = [];
  const line: number[] = [];
  const pat0: number[] = [];
  const pat1: number[] = [];
  const pat2: number[] = [];
  const skin: number[] = [];
  const body: number[] = [];
  const hull: number[] = [];
  const nm = new Matrix3();
  const c = new Color();
  const v = new Vector3();
  const add = (p: PartSpec, outline: boolean) => {
    const g = p.geo;
    const pt = outline ? undefined : p.paint;
    const ca = new Color(pt?.a ?? 0);
    const cb = new Color(pt?.b ?? 0);
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const bi = boneIndex(p.bone);
    const m = rest[bi];
    nm.getNormalMatrix(m);
    const base = pos.length / 3;
    const smooth = outline ? smoothNormals(g) : null;
    if (outline) c.setRGB(0, 0, 0);
    else c.setHex(p.color);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      pat0.push(v.x, v.y, v.z, pt ? PATTERN_KIND[pt.kind] : 0);
      pat1.push(ca.r, ca.g, ca.b, pt?.scale ?? 0);
      pat2.push(cb.r, cb.g, cb.b, pt?.share ?? 0);
      v.applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      if (smooth) v.fromArray(smooth, i * 3);
      else v.fromBufferAttribute(N, i);
      v.applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
      glow.push(outline ? 0 : (p.glow ?? 0));
      line.push(outline ? 1 : 0);
      skin.push(bi, 0, 0, 0);
    }
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: P.count }, (_, i) => i);
    const out = outline ? hull : body;
    for (let t = 0; t < idx.length; t += 3) {
      if (outline) out.push(base + idx[t], base + idx[t + 2], base + idx[t + 1]);
      else out.push(base + idx[t], base + idx[t + 1], base + idx[t + 2]);
    }
  };
  for (const p of parts) add(p, false);
  for (const p of parts) if (p.outline !== false) add(p, true);
  for (const p of parts) p.geo.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geometry.setAttribute('aGlow', new BufferAttribute(new Float32Array(glow), 1));
  geometry.setAttribute('aOutline', new BufferAttribute(new Float32Array(line), 1));
  geometry.setAttribute('aPat0', new BufferAttribute(new Float32Array(pat0), 4));
  geometry.setAttribute('aPat1', new BufferAttribute(new Float32Array(pat1), 4));
  geometry.setAttribute('aPat2', new BufferAttribute(new Float32Array(pat2), 4));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skin, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(skin.length).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const all = body.concat(hull);
  geometry.setIndex(pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(all), 1) : new BufferAttribute(new Uint16Array(all), 1));
  geometry.boundingSphere = new Sphere(new Vector3(0, dims.p.height / 2, 0), dims.p.height * 0.75);
  const built: BuiltZombie = {
    type,
    dims,
    geometry,
    triangles: body.length / 3,
    outlineTriangles: hull.length / 3,
    rest,
    inverses: rest.map((m) => m.clone().invert()),
  };
  setOutline(built, outlineOn);
  cache.set(type.id, built);
  return built;
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

// ── Outline and the shared material ──────────────────────────────────────────────────────────────────

let outlineOn = true;
const outlineWidth = { value: 0.011 };

function setOutline(b: BuiltZombie, on: boolean): void {
  b.geometry.setDrawRange(0, (on ? b.triangles + b.outlineTriangles : b.triangles) * 3);
}

/** Outline on or off for every zombie (off on weak devices: half the triangles). */
export function setZombieOutline(on: boolean, width = outlineWidth.value): void {
  outlineOn = on;
  outlineWidth.value = width;
  for (const b of cache.values()) setOutline(b, on);
}

export function zombieOutline(): boolean {
  return outlineOn;
}

/** The patterns (see `Pattern`): kind in vPat0.w, the bone-frame position in vPat0.xyz, a/scale, b/share. */
const PATTERN_GLSL = /* glsl */ `
float zHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float zNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(zHash(i), zHash(i + vec3(1, 0, 0)), f.x), mix(zHash(i + vec3(0, 1, 0)), zHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(zHash(i + vec3(0, 0, 1)), zHash(i + vec3(1, 0, 1)), f.x), mix(zHash(i + vec3(0, 1, 1)), zHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 zPattern(vec3 base) {
  vec3 p = vPat0.xyz * vPat1.w;
  float kind = vPat0.w;
  float share = vPat2.w;
  if (kind < 1.5) {
    float n = zNoise(p) * 0.65 + zNoise(p * 2.13 + 17.1) * 0.35;
    if (n < 0.2 + 0.35 * share) return vPat1.rgb;
    if (n > 0.8 - 0.35 * share) return vPat2.rgb;
    return base;
  }
  if (kind < 2.5) {
    vec3 f = floor(p);
    return mod(f.x + f.y + f.z, 2.0) < 0.5 ? vPat1.rgb : vPat2.rgb;
  }
  vec3 c = floor(p);
  float h = zHash(c);
  if (h > share) return base;
  vec3 q = fract(p) - 0.5 - 0.22 * (vec3(zHash(c + 3.1), zHash(c + 5.7), zHash(c + 9.3)) - 0.5);
  float d = length(q);
  if (kind < 3.5) return d < 0.11 ? vPat2.rgb : d < 0.3 ? vPat1.rgb : base;
  return d < 0.34 ? (h < share * 0.5 ? vPat1.rgb : vPat2.rgb) : base;
}
`;

let material: MeshToonMaterial | null = null;

/** The one toon material of every procedural zombie: vertex colours, self-lit eyes, the hull pushed out. */
export function zombieMaterial(): MeshToonMaterial {
  if (material) return material;
  const ramp = new DataTexture(new Uint8Array([105, 175, 255]), 3, 1, RedFormat);
  ramp.minFilter = ramp.magFilter = NearestFilter;
  ramp.needsUpdate = true;
  const mat = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
  mat.name = 'zombie-toon';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uOutline = outlineWidth;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nattribute float aOutline;\nattribute vec4 aPat0;\nattribute vec4 aPat1;\nattribute vec4 aPat2;\nuniform float uOutline;\nvarying float vGlow;\nvarying vec4 vPat0;\nvarying vec4 vPat1;\nvarying vec4 vPat2;',
      )
      // Along the raw normal: skinning then turns the push with the bone.
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * (uOutline * aOutline);\nvGlow = aGlow;\nvPat0 = aPat0;\nvPat1 = aPat1;\nvPat2 = aPat2;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vGlow;\nvarying vec4 vPat0;\nvarying vec4 vPat1;\nvarying vec4 vPat2;\n${PATTERN_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vPat0.w > 0.5) diffuseColor.rgb = zPattern(diffuseColor.rgb);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;');
  };
  mat.customProgramCacheKey = () => 'zombie-toon';
  material = mat;
  return mat;
}

// ── Instances ────────────────────────────────────────────────────────────────────────────────────────

export interface ZombieInstance {
  mesh: SkinnedMesh;
  /** In BONES order. */
  bones: Bone[];
  built: BuiltZombie;
}

/** A new zombie of a type: shared geometry and material, its own bones. Faces −Z, feet at its origin. */
export function createZombie(type: ZombieType): ZombieInstance {
  const built = buildZombie(type);
  const bones = createBones(built.dims);
  const mesh = new SkinnedMesh(built.geometry, zombieMaterial());
  mesh.name = `zombie-${type.id}`;
  mesh.add(bones[0]);
  mesh.bind(new Skeleton(bones, built.inverses.map((m) => m.clone())), new Matrix4());
  // Generous bounds round the body in any living pose (no per-frame bone bounds).
  mesh.boundingSphere = built.geometry.boundingSphere!.clone();
  return { mesh, bones, built };
}

export { BONES };
