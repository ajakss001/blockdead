import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  RGBAFormat,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { grim as palette } from '../style/palette';
import { FLASHLIGHT } from './config';

/**
 * The flashlight, procedural: a knurled aluminium body (ring grooves), electrical tape round the middle, a
 * rubber button on the side, the wider head with a reflector cone and a cracked lens, the tail cap with
 * a wrist strap. ONE mesh in two groups: the body (Lambert, colours and grime per vertex — paint worn to
 * bare aluminium on the edges, darker dirt in patches) and the lens (its own material: it glows when on).
 *
 * Model frame: the origin at the grip, the beam along −Z, the button up (+Y). Parts are laid out in the
 * held-item frame of player/held (the body along +Y from the butt, the button towards −Z) and turned at
 * the end; `flashlightHeldMatrix` turns it back for the hand.
 */

type Paint = { color: number; wear?: number; dirt?: number };
interface Part {
  geo: BufferGeometry;
  paint: Paint;
  /** In the lens group (its own material). */
  lens?: boolean;
}

const C = FLASHLIGHT.colors;
const SEG = 10;

/**
 * A colour through the game's grim palette (style/palette, CLAUDE.md «Визуальный стиль»), then `k` of
 * the way to the grey-brown of old dirt — nothing comes out clean.
 */
function grim(hex: number, k = 0.1): Color {
  return new Color(palette(hex)).lerp(new Color(0x2c2924), k * 0.6);
}

/** 0..1 from a position (stable grime). */
function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A ring of the body from y0 to y1, radius r0 → r1. */
function ring(r0: number, r1: number, y0: number, y1: number, open = true, seg = SEG): BufferGeometry {
  return new CylinderGeometry(r1, r0, y1 - y0, seg, 1, open).translate(0, (y0 + y1) / 2, 0);
}

function parts(): Part[] {
  const R = 0.0175;
  const H = 0.0275;
  const L = FLASHLIGHT.length;
  const out: Part[] = [];
  const body = (geo: BufferGeometry, wear = 0.35, dirt = 0.3) => out.push({ geo, paint: { color: C.body, wear, dirt } });
  // Tail cap: knurled, a groove, the end disc.
  body(ring(0.0188, 0.0188, 0, 0.009, false), 0.6);
  body(ring(0.0172, 0.0172, 0.009, 0.012), 0.2);
  body(ring(0.0188, 0.0188, 0.012, 0.024), 0.6);
  // Knurled grip: bands and ring grooves; the tape; more knurl; the smooth part with the button.
  let y = 0.024;
  for (const [y1, groove] of [[0.03, true], [0.042, false], [0.046, true], [0.058, false], [0.062, true], [0.074, false], [0.078, true], [0.088, false]] as const) {
    body(ring(groove ? R - 0.0013 : R, groove ? R - 0.0013 : R, y, y1), groove ? 0.1 : 0.45);
    y = y1;
  }
  out.push({ geo: ring(R + 0.0009, R + 0.0009, 0.088, 0.118), paint: { color: C.tape, wear: 0.05, dirt: 0.45 } });
  y = 0.118;
  for (const [y1, groove] of [[0.124, false], [0.128, true], [0.14, false], [0.144, true], [0.152, false]] as const) {
    body(ring(groove ? R - 0.0013 : R, groove ? R - 0.0013 : R, y, y1), groove ? 0.1 : 0.45);
    y = y1;
  }
  body(ring(R, R, 0.152, 0.205), 0.3);
  // The head: flaring out, the bezel with a worn rim.
  body(ring(R, H, 0.205, 0.245), 0.35);
  body(ring(H, H, 0.245, 0.29), 0.45);
  body(ring(H + 0.001, H + 0.0012, 0.29, L), 0.9);
  // The front face of the bezel round the lens (a flat ring).
  body(new RingGeometry(0.0235, H + 0.0012, SEG, 1).rotateX(-Math.PI / 2).translate(0, L, 0), 0.9);
  // Inside: the reflector cone, the bulb; the lens just behind the rim.
  out.push({ geo: new ConeGeometry(0.0235, 0.024, SEG, 1, true).rotateX(Math.PI).translate(0, L - 0.016, 0), paint: { color: C.reflector, dirt: 0.15 } });
  out.push({ geo: new SphereGeometry(0.004, 6, 4).translate(0, L - 0.025, 0), paint: { color: 0xd8d4c4 } });
  out.push({ geo: new CylinderGeometry(0.0245, 0.0245, 0.0015, SEG * 2, 1, false).translate(0, L - 0.003, 0), paint: { color: C.lens }, lens: true });
  // A crack in the lens near the rim: two dark slivers on its face.
  for (const [a, len, tilt] of [[0.6, 0.011, 0.5], [0.9, 0.007, -0.8]] as const) {
    const g = new BoxGeometry(0.00035, 0.0003, len).rotateY(tilt).translate(Math.cos(a) * 0.017, L - 0.0018, Math.sin(a) * 0.017);
    out.push({ geo: g, paint: { color: 0x5a5850 } });
  }
  // Rubber button on the side (−z: on top in the hand), in a rubber surround.
  out.push({ geo: new BoxGeometry(0.014, 0.021, 0.004).translate(0, 0.178, -R - 0.0006), paint: { color: C.button, dirt: 0.2 } });
  out.push({ geo: new BoxGeometry(0.009, 0.015, 0.003).translate(0, 0.178, -R - 0.003), paint: { color: C.button, wear: 0.1 } });
  // Wrist strap: a flat loop hanging from the tail cap.
  out.push({ geo: new TorusGeometry(0.042, 0.003, 4, 12).scale(0.42, 1, 1).rotateY(Math.PI / 2).translate(0, -0.042, 0).rotateX(-1.1).translate(0, 0, 0.004), paint: { color: C.strap, dirt: 0.4 } });
  out.push({ geo: new BoxGeometry(0.004, 0.008, 0.004).translate(0, -0.002, 0.006), paint: { color: C.strap } });
  return out;
}

/** Held frame → model frame: the body (+y) to −z, the button side (−z) up, the grip to the origin (as weapons/buildWeapon). */
function modelFromHeld(): Matrix4 {
  return new Matrix4().set(-1, 0, 0, 0, 0, 0, -1, 0, 0, -1, 0, FLASHLIGHT.grip, 0, 0, 0, 1);
}

/** Model frame → the held-item frame (player/held). */
export function flashlightHeldMatrix(): Matrix4 {
  return modelFromHeld().invert();
}

export interface BuiltFlashlight {
  geometry: BufferGeometry;
  triangles: number;
}

let built: BuiltFlashlight | null = null;

/** Shared geometry (built once): group 0 the body, group 1 the lens. */
export function buildFlashlight(): BuiltFlashlight {
  if (built) return built;
  const m = modelFromHeld();
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idxBody: number[] = [];
  const idxLens: number[] = [];
  const alu = grim(C.alu, 0.1);
  const grime = new Color(0x1d1b17);
  const c = new Color();
  const v = new Vector3();
  for (const p of parts()) {
    const g = p.geo;
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const base = pos.length / 3;
    const box = (g.computeBoundingBox(), g.boundingBox!);
    const paint = grim(p.paint.color);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      c.copy(paint);
      if (!p.lens) {
        // Paint worn to aluminium on the edges (the ends of a ring), scuffs here and there.
        const edge = Math.abs(v.y - box.min.y) < 1e-4 || Math.abs(v.y - box.max.y) < 1e-4;
        const h = hash3(v.x * 50, v.y * 50, v.z * 50);
        const w = p.paint.wear ?? 0;
        if ((edge && h < w) || h < w * 0.3) c.lerp(alu, 0.5 + 0.4 * hash3(v.y, v.x, 7));
        // Dirt in patches, in the grooves most.
        const d = (p.paint.dirt ?? 0.2) * hash3(Math.floor(v.y * 60), Math.floor(Math.atan2(v.z, v.x) * 3), 3);
        c.lerp(grime, d * 0.6);
      }
      col.push(c.r, c.g, c.b);
      v.applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).transformDirection(m);
      nor.push(v.x, v.y, v.z);
    }
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: P.count }, (_, i) => i);
    for (const i of idx) (p.lens ? idxLens : idxBody).push(base + i);
    p.geo.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geometry.setIndex(new BufferAttribute(new Uint16Array(idxBody.concat(idxLens)), 1));
  geometry.addGroup(0, idxBody.length, 0);
  geometry.addGroup(idxBody.length, idxLens.length, 1);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  built = { geometry, triangles: (idxBody.length + idxLens.length) / 3 };
  return built;
}

let bodyMat: MeshLambertMaterial | null = null;

/** The body's material (shared): Lambert by vertex colour. */
export function flashlightMaterial(): MeshLambertMaterial {
  bodyMat ??= new MeshLambertMaterial({ vertexColors: true });
  return bodyMat;
}

/** A lens material of its own (each flashlight glows on its own): see-through, emissive when on. */
export function lensMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: grim(C.lens, 0.1),
    roughness: 0.25,
    metalness: 0,
    transparent: true,
    opacity: 0.6,
    emissive: FLASHLIGHT.glow,
    emissiveIntensity: 0,
    depthWrite: false,
  });
}

/** Lens glow, 0..1 (0 = off). */
export function setLensGlow(lens: MeshStandardMaterial, k: number): void {
  lens.emissiveIntensity = 0.55 * k;
  lens.opacity = 0.55 + 0.2 * Math.min(1, k);
}

/** A flashlight mesh in its model frame; `lens` is its own lens material. */
export function flashlightMesh(): { mesh: Mesh; lens: MeshStandardMaterial } {
  const lens = lensMaterial();
  const mesh = new Mesh(buildFlashlight().geometry, [flashlightMaterial(), lens]);
  mesh.name = 'flashlight';
  return { mesh, lens };
}

let mask: DataTexture | null = null;

/**
 * The beam's cookie (SpotLight.map): a bright hot spot, a darker ring round it, a faint halo out to the
 * edge, and a couple of dim streaks where the cracked lens throws its shadow.
 */
export function beamMask(): DataTexture {
  if (mask) return mask;
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N - 0.5;
      const y = (j + 0.5) / N - 0.5;
      const r = Math.hypot(x, y) * 2;
      let k = r < 0.28 ? 1 : r < 0.42 ? 1 - ((r - 0.28) / 0.14) * 0.45 : r < 0.52 ? 0.55 : r < 0.62 ? 0.55 + ((r - 0.52) / 0.1) * 0.2 : 0.75 * Math.max(0, 1 - (r - 0.62) / 0.38) + 0.08;
      // The crack: two soft dark streaks off-centre.
      const a = Math.atan2(y, x);
      if (r > 0.3 && r < 0.9 && Math.abs(Math.sin(a - 0.6)) < 0.05) k *= 0.6;
      if (r > 0.45 && r < 0.8 && Math.abs(Math.sin(a - 2.3)) < 0.04) k *= 0.7;
      k *= 0.94 + 0.06 * hash3(i, j, 1);
      const b = Math.round(Math.min(1, k) * 255);
      data.set([b, b, Math.round(b * 0.96), 255], (j * N + i) * 4);
    }
  }
  mask = new DataTexture(data, N, N, RGBAFormat);
  mask.magFilter = mask.minFilter = LinearFilter;
  mask.needsUpdate = true;
  return mask;
}

// ── Batteries (a pack lying about) ──────────────────────────────────────────────────────────────────

let batteryGeo: BufferGeometry | null = null;

/** Two AA cells side by side, lying along −Z: dark wrap, a copper band, steel ends (vertex colours). */
export function batteriesGeometry(): BufferGeometry {
  if (batteryGeo) return batteryGeo;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new Color();
  const add = (g: BufferGeometry, hex: number) => {
    g.rotateX(Math.PI / 2);
    const base = pos.length / 3;
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    c.copy(grim(hex));
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    for (const i of g.index!.array) idx.push(base + i);
    g.dispose();
  };
  for (const x of [-0.0075, 0.0075]) {
    add(new CylinderGeometry(0.007, 0.007, 0.036, 8).translate(x, 0.004, 0), 0x2a2b2d);
    add(new CylinderGeometry(0.0071, 0.0071, 0.012, 8).translate(x, 0.026, 0), 0xb06a2c);
    add(new CylinderGeometry(0.003, 0.003, 0.003, 6).translate(x, 0.0335, 0), 0x9a9ea2);
    add(new CylinderGeometry(0.0068, 0.0068, 0.002, 8).translate(x, -0.015, 0), 0x9a9ea2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  batteryGeo = g;
  return g;
}

let batteryLit: MeshLambertMaterial | null = null;

/** Batteries under the crosshair: lit up a little. */
export function batteriesHighlightMaterial(): MeshLambertMaterial {
  batteryLit ??= new MeshLambertMaterial({ vertexColors: true, emissive: 0x6a5a30 });
  return batteryLit;
}
