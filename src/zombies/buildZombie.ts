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
  MeshLambertMaterial,
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
import { DIRT, EYES, grim, MAX_GLOW, rgb, SKIN, SOOT } from '../style/palette';
import { glslColor, look, NOISE_GLSL, noise3, smoothstep, stainGlsl } from '../style/look';

/**
 * Procedural zombies: a type (types/*.ts) lists its parts — low-poly primitives in the frame of the bone
 * that carries them — and this merges them into ONE SkinnedMesh, every vertex 100% on its bone (rigid
 * skinning): one draw call per zombie. Colours per vertex, one shared material for every zombie.
 *
 * The grim look (CLAUDE.md «Визуальный стиль», `look.grim`): every colour through `grim`, the skin the
 * palette's, the eyes milky and barely lit; grime baked into the vertex colours (noise, dark joints and
 * folds, dust from the ground up, dark rings round the eyes, hollow cheeks); stains, patches and tears on
 * the clothes in the shader; Lambert shading. The toy look (the viewer's «до») keeps the old toon colours.
 *
 * The black outline is an inverted hull in the same geometry (and so the same draw call): a copy of the
 * outlined parts with smoothed normals and reversed winding, pushed out along the normal in the vertex
 * shader. Its triangles come after the body's: off (the default) it just shortens the draw range.
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
  /** Skin (living types mark it: their warm skin is not told by colour); zombies: by colour. */
  skin?: boolean;
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
  /**
   * A living person (the player's figure, src/zombies/types/survivor.ts): the skin is theirs (marked parts,
   * muted warm through grim, not the palette's dead SKIN), tired rings round the eyes, no hollow cheeks.
   */
  living?: boolean;
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
  const key = look.grim ? type.id : `${type.id}:toy`;
  const hit = cache.get(key);
  if (hit) return hit;
  const grimLook = look.grim;
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
  const cloth: number[] = [];
  const skin: number[] = [];
  const grime = grimLook ? grimer(type, dims, rest) : null;
  const body: number[] = [];
  const hull: number[] = [];
  const nm = new Matrix3();
  const c = new Color();
  const v = new Vector3();
  const add = (p: PartSpec, outline: boolean) => {
    const g = p.geo;
    const pt = outline ? undefined : p.paint;
    const isSkin = grimLook && !outline && (p.skin ?? (!type.living && skinLike(p.color)));
    const glowing = (p.glow ?? 0) > 0;
    const tone = (hex: number) => (grimLook ? grim(hex) : hex);
    const ca = new Color(tone(pt?.a ?? 0));
    const cb = new Color(tone(pt?.b ?? 0));
    const isCloth = grimLook && !outline && !isSkin && !glowing && p.outline !== false;
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const bi = boneIndex(p.bone);
    const m = rest[bi];
    nm.getNormalMatrix(m);
    const base = pos.length / 3;
    const smooth = outline ? smoothNormals(g) : null;
    const own = new Color();
    if (outline) own.setRGB(0, 0, 0);
    else if (!grimLook) own.setHex(p.color);
    else own.setHex(glowing ? EYES : isSkin ? (type.living ? livingSkin(p.color) : skinTone(p.color)) : grim(p.color));
    const local = new Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      local.copy(v);
      v.applyMatrix4(m);
      // Grime: darker in the joints and folds, dust from the ground up, rings round the eyes.
      // Cloth a shade darker still (worn, never clean): a white shirt ends up about #8E8C82.
      const f = (grime && !outline && !glowing ? grime(v, local, p.bone, isSkin) : 1) * (isCloth ? 0.9 : 1);
      c.copy(own).multiplyScalar(f);
      pat0.push(local.x, local.y, local.z, pt ? PATTERN_KIND[pt.kind] : 0);
      pat1.push(ca.r * f, ca.g * f, ca.b * f, pt?.scale ?? 0);
      pat2.push(cb.r * f, cb.g * f, cb.b * f, pt?.share ?? 0);
      cloth.push(isCloth ? 1 : 0);
      pos.push(v.x, v.y, v.z);
      if (smooth) v.fromArray(smooth, i * 3);
      else v.fromBufferAttribute(N, i);
      v.applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
      glow.push(outline ? 0 : grimLook ? Math.min(MAX_GLOW, p.glow ?? 0) : (p.glow ?? 0));
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
  geometry.setAttribute('aCloth', new BufferAttribute(new Float32Array(cloth), 1));
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
  cache.set(key, built);
  return built;
}

/** Forget a type's geometry (a figure rebuilt with other looks or clothes): frees its buffers. */
export function dropZombie(type: ZombieType): void {
  for (const key of [type.id, `${type.id}:toy`]) {
    const b = cache.get(key);
    if (!b) continue;
    b.geometry.dispose();
    cache.delete(key);
  }
}

/** The zombie skin family (the greenish greys of the old skins and their shades). */
function skinLike(hex: number): boolean {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  return g >= r && g >= b && s > 0.03 && s < 0.2 && l > 0.36 && l < 0.66;
}

/** A skin shade as the palette's skin, as much darker or lighter as it was against the old skin. */
function skinTone(hex: number): number {
  const [r, g, b] = rgb(hex);
  const k = (r + g + b) / 3 / 0.57;
  const [sr, sg, sb] = rgb(SKIN);
  return new Color().setRGB(sr * k, sg * k, sb * k, 'srgb').getHex('srgb');
}

const lighter = (hex: number, f: number) => {
  const c = (s: number) => Math.min(255, Math.round(((hex >> s) & 255) * f));
  return (c(16) << 16) | (c(8) << 8) | c(0);
};
/** A living skin: its own warm tone, muted and a little darker (a third of the grim rule). */
export function livingSkin(hex: number): number {
  return grim(lighter(hex, 1.18), 0.6);
}

/** Joints where cloth folds and dirt gathers (their bones' origins). */
const FOLDS: BoneName[] = ['Neck', 'UpperArm_L', 'UpperArm_R', 'LowerArm_L', 'LowerArm_R', 'Hand_L', 'Hand_R', 'UpperLeg_L', 'UpperLeg_R', 'LowerLeg_L', 'LowerLeg_R', 'Foot_L', 'Foot_R'];

/**
 * The grime of a type: a brightness factor for a vertex at `v` (model frame, rest pose; `local` in its
 * bone's frame) — noise ±10%, darker within 9 cm of a joint, darker towards the ground (dust and mud up to
 * the knees, the shoes darkest); on the skin, dark rings round the eyes and hollow cheeks.
 */
function grimer(type: ZombieType, dims: SkeletonDims, rest: Matrix4[]): (v: Vector3, local: Vector3, bone: BoneName, skin: boolean) => number {
  const height = dims.p.height;
  const h = type.proportions.head ?? 1;
  const joints = FOLDS.map((b) => new Vector3().setFromMatrixPosition(rest[boneIndex(b)]));
  const eyes = [-1, 1].map((s) => new Vector3(0.04 * s * h, 0.085 * h, -0.104 * h));
  const cheeks = [-1, 1].map((s) => new Vector3(0.062 * s * h, 0.035 * h, -0.085 * h));
  const living = type.living === true;
  const under = [-1, 1].map((s) => new Vector3(0.035 * s * h, 0.075 * h, -0.082 * h));
  return (v, local, bone, skin) => {
    let f = 0.9 + 0.2 * noise3(v.x * 8 + 11.3, v.y * 8, v.z * 8 + 3.7);
    let d = Infinity;
    for (const j of joints) d = Math.min(d, j.distanceTo(v));
    f *= 0.8 + 0.2 * smoothstep(0.025, 0.09, d);
    f *= 0.68 + 0.32 * smoothstep(0.03, 0.42 * height * 0.55, v.y);
    if (skin && bone === 'Head') {
      // The dead: deep sockets, hollow cheeks. The living: tired dark circles under the eyes.
      if (living) for (const e of under) f *= 0.8 + 0.2 * smoothstep(0.008 * h, 0.03 * h, e.distanceTo(local));
      else {
        for (const e of eyes) f *= 0.55 + 0.45 * smoothstep(0.016 * h, 0.05 * h, e.distanceTo(local));
        for (const c of cheeks) f *= 0.74 + 0.26 * smoothstep(0.012 * h, 0.045 * h, c.distanceTo(local));
      }
    }
    return f;
  };
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

let outlineOn = false;
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
const PATTERN_GLSL = /* glsl */ `${NOISE_GLSL}
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

const materials: { grim?: MeshLambertMaterial; toy?: MeshToonMaterial } = {};
let ramp: DataTexture | null = null;

function toonRamp(): DataTexture {
  if (ramp) return ramp;
  ramp = new DataTexture(new Uint8Array([105, 175, 255]), 3, 1, RedFormat);
  ramp.minFilter = ramp.magFilter = NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

/**
 * Clothes in the grim look: square patches a shade off, dark tears (holes), and on everything but the eyes
 * stains of dirt, soot and oil — by the bone-frame position, so they stay put on the part.
 */
const GRIM_GLSL = /* glsl */ `
if (vCloth > 0.5) {
  vec3 zc = floor(vPat0.xyz * 8.0);
  vec3 zf = abs(fract(vPat0.xyz * 8.0) - 0.5);
  if (zHash(zc + 7.7) < 0.05 && max(zf.x, max(zf.y, zf.z)) < 0.44) diffuseColor.rgb *= vec3(0.78, 0.83, 0.76) + 0.25 * zHash(zc + 1.9);
  // Soot and wear streaked down the cloth (stretched along the bone), never round blots.
  vec3 zs = vPat0.xyz * vec3(24.0, 7.0, 24.0);
  float zt = zNoise(zs + 11.0) * 0.65 + zNoise(zs * 2.6) * 0.35;
  diffuseColor.rgb = mix(diffuseColor.rgb, ${glslColor(SOOT)}, smoothstep(0.7, 0.86, zt) * 0.55);
  // Faded unevenly (washed-out patches on big plain areas: a coat, a vest, a box), uneven in brightness,
  // a film of dust over it.
  float zl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(zl) * vec3(0.97, 1.0, 0.95), 0.2 + 0.4 * zNoise(vPat0.xyz * 4.0 + 5.0));
  diffuseColor.rgb *= 0.82 + 0.26 * zNoise(vPat0.xyz * 9.0 + 2.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, ${glslColor(DIRT)}, smoothstep(0.45, 0.8, zNoise(vPat0.xyz * 6.0 + 17.0)) * 0.3);
  ${stainGlsl('vPat0.xyz', 'diffuseColor.rgb', 1.3)}
} else if (vGlow < 0.001) ${stainGlsl('vPat0.xyz', 'diffuseColor.rgb')}
`;

/**
 * The shader of the zombies: vertex colours, patterns, self-lit eyes, the hull pushed out along the raw
 * normal (before skinning: the push turns with the bone); the grim look adds patches, tears and stains.
 * Batched: an instanced mesh skinned from a texture — per instance (row) the 18 skin matrices (bone ×
 * inverse rest), 4 texels (columns) each.
 */
function toonCompile(sh: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }, batched: boolean, grimLook = look.grim): void {
  sh.uniforms.uOutline = outlineWidth;
  const skin = batched
    ? {
        decl: '\nattribute vec4 skinIndex;\nuniform highp sampler2D uSkin;\nmat4 zSkin;',
        normal: `#include <beginnormal_vertex>
{
  int zb = int(skinIndex.x + 0.5) * 4;
  zSkin = mat4(texelFetch(uSkin, ivec2(zb, gl_InstanceID), 0), texelFetch(uSkin, ivec2(zb + 1, gl_InstanceID), 0),
               texelFetch(uSkin, ivec2(zb + 2, gl_InstanceID), 0), texelFetch(uSkin, ivec2(zb + 3, gl_InstanceID), 0));
  objectNormal = mat3(zSkin) * objectNormal;
}`,
        vertex: '\ntransformed = (zSkin * vec4(transformed, 1.0)).xyz;',
      }
    : { decl: '', normal: '#include <beginnormal_vertex>', vertex: '' };
  sh.vertexShader = sh.vertexShader
    .replace(
      '#include <common>',
      `#include <common>\nattribute float aGlow;\nattribute float aOutline;\nattribute float aCloth;\nattribute vec4 aPat0;\nattribute vec4 aPat1;\nattribute vec4 aPat2;\nuniform float uOutline;\nvarying float vGlow;\nvarying float vCloth;\nvarying vec4 vPat0;\nvarying vec4 vPat1;\nvarying vec4 vPat2;${skin.decl}`,
    )
    .replace('#include <beginnormal_vertex>', skin.normal)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normal * (uOutline * aOutline);\nvGlow = aGlow;\nvCloth = aCloth;\nvPat0 = aPat0;\nvPat1 = aPat1;\nvPat2 = aPat2;${skin.vertex}`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying float vGlow;\nvarying float vCloth;\nvarying vec4 vPat0;\nvarying vec4 vPat1;\nvarying vec4 vPat2;\n${PATTERN_GLSL}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\nif (vPat0.w > 0.5) diffuseColor.rgb = zPattern(diffuseColor.rgb);${grimLook ? GRIM_GLSL : ''}`)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;');
}

/** A new material in the current look: Lambert (grim) or the old toon (toy). */
function lookMaterial(): MeshLambertMaterial | MeshToonMaterial {
  return look.grim ? new MeshLambertMaterial({ vertexColors: true }) : new MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
}

/** The one material of a SkinnedMesh zombie in the current look (the viewer, GLB export). */
export function zombieMaterial(): MeshLambertMaterial | MeshToonMaterial {
  const which = look.grim ? 'grim' : 'toy';
  const hit = materials[which];
  if (hit) return hit;
  const mat = lookMaterial();
  const grimLook = look.grim;
  mat.name = `zombie-${which}`;
  mat.onBeforeCompile = (sh) => toonCompile(sh, false, grimLook);
  mat.customProgramCacheKey = () => `zombie-${which}`;
  (materials as Record<string, unknown>)[which] = mat;
  return mat;
}

/** The material of an instanced batch skinned from `skin` (render/ZombieModels): one per batch. */
export function zombieBatchMaterial(skin: DataTexture): MeshLambertMaterial | MeshToonMaterial {
  const mat = lookMaterial();
  const grimLook = look.grim;
  mat.name = 'zombie-batch';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSkin = { value: skin };
    toonCompile(sh, true, grimLook);
  };
  mat.customProgramCacheKey = () => `zombie-batch-${grimLook}`;
  return mat;
}

/** A view of a type's geometry (the same buffers) drawing the body only, or the body and its outline. */
export function zombieGeometryView(built: BuiltZombie, outline: boolean): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, a] of Object.entries(built.geometry.attributes)) g.setAttribute(name, a);
  g.setIndex(built.geometry.index);
  g.setDrawRange(0, (outline ? built.triangles + built.outlineTriangles : built.triangles) * 3);
  g.boundingSphere = built.geometry.boundingSphere!.clone();
  return g;
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
