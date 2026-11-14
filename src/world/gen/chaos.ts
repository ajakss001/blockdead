import { mulberry32 } from '../../core/random';
import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { type ModelInfo, pickModel } from '../models';
import { buildCar, modelLibrary, placeModel } from '../props/car';
import * as F from './furniture';
import { Place } from './furniture';
import { groundDecal } from './highrise';
import { BAND } from './layout';
import { hash3 } from './noise';
import { PAL, pick, type Rand } from './palette';
import type { Builder } from './pieces';
import { stripDecal } from './storytelling';

/*
 * Big chaos scenes at intersections: the last days of the city, told without blood. A military
 * cordon, a police / SWAT line, an evacuation that never finished, a helicopter that came down in
 * the street. Vehicles are procedural low-poly stand-ins (to be swapped for approved Sketchfab models
 * through ModelLibrary later) merged into the chunk batch — no new draw calls; simple box colliders.
 *
 * Bodies lie in natural poses (on the back, on the side, face down), whole and clean — no blood,
 * wounds or injuries — and many are covered with a sheet or zipped in a body bag. The "covered"
 * mode (for the age rating) covers every one. Bodies in uniform can be searched.
 *
 * At most one big scene per 2×2 intersections, a crashed helicopter only downtown and rarely.
 */

export type BodyMode = 'mixed' | 'covered';
export type SceneKind = 'cordon' | 'police' | 'evacuation' | 'heli';

/** Which big scene (if any) an intersection gets — deterministic, independent of the chunk's own random stream. */
export function sceneAt(seed: number, i: number, j: number, urban: boolean, downtown: boolean): { kind: SceneKind; rand: Rand } | null {
  if (!urban || (i & 1) !== 0 || (j & 1) !== 0) return null;
  const rand = mulberry32(hash3(seed, i * 7 + 3, j * 13 + 5));
  if (rand() > (downtown ? 0.45 : 0.3)) return null;
  const r = rand();
  const kind: SceneKind = downtown && r < 0.12 ? 'heli' : r < 0.42 ? 'cordon' : r < 0.71 ? 'police' : 'evacuation';
  return { kind, rand };
}

export function chaosScene(b: Builder, kind: SceneKind, x: number, z: number, rand: Rand, bodies: BodyMode): void {
  if (kind === 'cordon') cordon(b, x, z, rand, bodies);
  else if (kind === 'police') policeLine(b, x, z, rand, bodies);
  else if (kind === 'evacuation') evacuation(b, x, z, rand, bodies);
  else heliCrash(b, x, z, rand, bodies);
}

// ── Building blocks ─────────────────────────────────────────────────────────────

/** A vehicle frame: local +X = nose (same as cars), collider over its footprint. */
function vehicle(b: Builder, x: number, z: number, yaw: number, halfL: number, halfW: number): Place {
  b.colliders.addOrientedBox(x, z, halfL, halfW, yaw);
  return new Place(b, x, 0, z, 0).tipped(yaw);
}

/** A model of a group (nose +X along yaw), optionally tipped and lifted; collider over its footprint. */
function model(b: Builder, group: string, x: number, z: number, yaw: number, rand: Rand, o: { roll?: number; pitch?: number; lift?: number; collide?: boolean; paint?: number } = {}): ModelInfo | null {
  const m = pickModel(modelLibrary(), group, rand());
  if (!m) return null;
  const mat = new Matrix4().compose(new Vector3(x, (o.lift ?? 0) + 0.01, z), new Quaternion().setFromEuler(new Euler(o.roll ?? 0, yaw, o.pitch ?? 0, 'YXZ')), new Vector3(1, 1, 1));
  placeModel(b.batch, m, mat, o.paint !== undefined && m.tint ? new Color(o.paint) : null);
  if (o.collide !== false) b.colliders.addOrientedBox(x, z, m.size[0] / 2, m.size[2] / 2, yaw, -0.5, (o.lift ?? 0) + m.size[1] + 0.05);
  return m;
}

/** Yaw of a Place's local +X (quarter turns). */
const yawOf = (p: Place) => (p.r * Math.PI) / 2;

function wheels(p: Place, xs: number[], halfW: number, r = 0.45, color = 0x1e1e1e): void {
  for (const x of xs) for (const s of [-1, 1]) p.cyl(color, x, r, s * halfW, r, 0.32, 'rubber', Math.PI / 2);
}

/** Olive tank on tracks, turret turned, the hatch open. */
function tank(b: Builder, x: number, z: number, yaw: number, rand: Rand): void {
  if (model(b, rand() < 0.6 ? 'tank' : 'apc', x, z, yaw, rand)) return;
  const p = vehicle(b, x, z, yaw, 3.3, 1.7);
  const olive = pick(rand, [0x4a4e38, 0x545a40, 0x3e4434]);
  p.box(0x2a2a26, 0, 0.05, -1.35, 6.4, 0.85, 0.55, 'rubber');
  p.box(0x2a2a26, 0, 0.05, 1.35, 6.4, 0.85, 0.55, 'rubber');
  for (let k = -2; k <= 2; k++) for (const s of [-1, 1]) p.cyl(0x34342e, k * 1.25, 0.42, s * 1.35, 0.36, 0.6, 'metal', Math.PI / 2);
  p.box(olive, 0, 0.55, 0, 6.6, 0.75, 2.3, 'metal');
  p.rbox(olive, 3.2, 0.95, 0, 0.8, 0.4, 2.3, 0, 0, 0.5, 'metal');
  const tw = (rand() - 0.5) * 1.6;
  const t = p.tipped(0, 0, 0);
  t.rbox(olive, -0.3, 1.6, 0, 3.0, 0.6, 2.0, tw, 0, 0, 'metal');
  t.rbox(0x3a3e2e, -0.3 + Math.cos(tw) * 3.0, 1.62, -Math.sin(tw) * 3.0, 3.6, 0.18, 0.18, tw, 0, 0, 'metal');
  t.cyl(olive, -0.8, 2.0, 0.4, 0.32, 0.14, 'metal');
}

/** Canvas-covered army truck, tailgate down. */
function armyTruck(b: Builder, x: number, z: number, yaw: number, rand: Rand): Place {
  if (model(b, 'truck', x, z, yaw, rand)) return new Place(b, x, 0, z, 0).tipped(yaw);
  const p = vehicle(b, x, z, yaw, 3.6, 1.25);
  const olive = pick(rand, [0x4a4e38, 0x545a40]);
  p.box(0x2a2a26, 0, 0.55, 0, 7.0, 0.3, 1.8, 'metal');
  p.box(olive, 2.6, 0.85, 0, 1.6, 1.5, 2.3, 'metal');
  p.box(0x15181a, 3.41, 1.55, 0, 0.02, 0.6, 2.0, 'carGlass');
  p.box(olive, -0.9, 0.85, 0, 4.6, 0.5, 2.4, 'metal');
  p.box(pick(rand, [0x5a5a44, 0x4e5240]), -0.9, 1.35, 0, 4.6, 1.5, 2.4, 'rubber');
  p.rbox(olive, -3.45, 0.55, 0, 0.6, 0.05, 2.3, 0, 0, -0.2, 'metal');
  wheels(p, [2.5, -1.4, -2.6], 1.0);
  return p;
}

/** Sandbag wall along local X. */
export function sandbags(p: Place, lx: number, lz: number, len: number, rand: Rand): void {
  const lib = modelLibrary();
  if (pickModel(lib, 'sandbag', 0)) {
    // Real bags, two staggered layers.
    const n = Math.max(1, Math.round(len / 0.7));
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < n - layer; i++) {
        const [x, z] = p.pt(lx - len / 2 + 0.35 + i * 0.7 + layer * 0.35, lz + (rand() - 0.5) * 0.06);
        model(p.b, 'sandbag', x, z, yawOf(p) + (rand() - 0.5) * 0.25, rand, { lift: layer * 0.22, collide: false });
      }
    }
    p.solid(lx, lz, len, 0.5, 0.45);
    return;
  }
  const sand = pick(rand, [0x7a6e56, 0x6e6450, 0x847860]);
  p.box(sand, lx, 0, lz, len, 0.42, 0.7, 'rubber', true);
  p.box(sand, lx, 0.42, lz, len - 0.25, 0.38, 0.6, 'rubber', true);
  if (rand() < 0.5) p.box(sand, lx + len * 0.2, 0.8, lz, len * 0.4, 0.3, 0.55, 'rubber');
}

/** Concrete road barrier along local X. */
export function jersey(p: Place, lx: number, lz: number, len: number): void {
  if (pickModel(modelLibrary(), 'jersey', 0)) {
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i < n; i++) {
      const [x, z] = p.pt(lx - len / 2 + 1 + i * 2, lz);
      model(p.b, 'jersey', x, z, yawOf(p), () => 0, { collide: false });
    }
    p.solid(lx, lz, len, 0.6, 0.85);
    return;
  }
  p.box(0x8a8880, lx, 0, lz, len, 0.35, 0.6, 'concrete', true);
  p.box(0x8a8880, lx, 0.35, lz, len, 0.5, 0.25, 'concrete', true);
}

/** Striped police / road barrier on two feet. */
export function stripedBarrier(p: Place, lx: number, lz: number, len: number, down = false): void {
  if (!down && pickModel(modelLibrary(), 'barrier', 0)) {
    const [x, z] = p.pt(lx, lz);
    model(p.b, 'barrier', x, z, yawOf(p), () => (len > 2.6 ? 0.6 : 0.1), { collide: false });
    p.solid(lx, lz, len, 0.3, 1.0);
    return;
  }
  const q = down ? p.tipped(0, 0, Math.PI / 2, 0.1) : p;
  q.box(0xc8c2b0, lx, 0.75, lz, len, 0.22, 0.05, 'metal');
  for (let s = 0; s < Math.floor(len / 0.5); s++) q.box(0x8a2a22, lx - len / 2 + 0.15 + s * 0.5, 0.75, lz + 0.001, 0.2, 0.22, 0.055, 'metal');
  for (const e of [-1, 1]) {
    q.box(PAL.metal, lx + (e * len) / 2, 0, lz, 0.06, 0.97, 0.06, 'metal');
    q.box(PAL.metal, lx + (e * len) / 2, 0, lz, 0.06, 0.04, 0.7, 'metal');
  }
  if (!down) p.solid(lx, lz, len, 0.2, 1.0);
}

/** Field tent: walls, a ridge roof from two slanted sheets, the flap open. */
export function tent(b: Builder, x: number, z: number, yaw: number, rand: Rand, color = pick(rand, [0x4e5240, 0x5a5a48, 0x6a6a5a])): Place {
  if (model(b, color === 0xb0aca0 ? 'tent_medical' : 'tent', x, z, yaw, rand)) return new Place(b, x, 0, z, 0).tipped(yaw);
  const p = vehicle(b, x, z, yaw, 2.5, 2.0);
  const t = p.tipped(0, 0, 0);
  t.box(color, 0, 0, -1.95, 5.0, 1.4, 0.06, 'rubber');
  t.box(color, 0, 0, 1.95, 5.0, 1.4, 0.06, 'rubber');
  t.box(color, -2.47, 0, 0, 0.06, 1.4, 3.9, 'rubber');
  t.rbox(color, 0, 1.95, -1.0, 5.1, 0.05, 2.3, 0, 0.5, 0, 'rubber');
  t.rbox(color, 0, 1.95, 1.0, 5.1, 0.05, 2.3, 0, -0.5, 0, 'rubber');
  t.rbox(color, 2.6, 0.7, 1.2, 0.05, 1.4, 1.3, 0.9, 0, 0, 'rubber');
  return p;
}

/** Standing sign board on a post (arrows and stripes, no text). */
function signBoard(p: Place, lx: number, lz: number, color: number, rand: Rand): void {
  p.box(PAL.metal, lx, 0, lz, 0.08, 1.6, 0.08, 'metal');
  p.box(color, lx, 1.3, lz + 0.05, 1.0, 0.6, 0.03, 'metal');
  p.rbox(0xd8d2bc, lx - 0.1, 1.6, lz + 0.07, 0.5, 0.08, 0.01, 0, 0, 0, 'plaster');
  p.rbox(0xd8d2bc, lx + 0.2, 1.64, lz + 0.07, 0.22, 0.08, 0.01, 0, 0, -0.7, 'plaster');
  p.rbox(0xd8d2bc, lx + 0.2, 1.56, lz + 0.07, 0.22, 0.08, 0.01, 0, 0, 0.7, 'plaster');
  if (rand() < 0.4) p.poster(0xd6d0bc, lx - 0.3, 1.0, 0.21, 0.3, 0.1);
}

/** Box van (SWAT, ambulance, police van): rear doors open, light bar. */
function van(b: Builder, x: number, z: number, yaw: number, body: number, stripe: number, lights: [number, number]): Place {
  // White body = an ambulance; otherwise a plain van repainted (SWAT navy).
  const ambulance = body === 0xc8c4b8;
  if (model(b, ambulance ? 'ambulance' : 'van', x, z, yaw, () => Math.abs(Math.sin(x * 12.9898 + z * 78.233)), { paint: ambulance ? undefined : body * 1 + 0x101010 })) return new Place(b, x, 0, z, 0).tipped(yaw);
  const p = vehicle(b, x, z, yaw, 2.9, 1.15);
  p.box(0x1e1e1e, 0, 0.3, 0, 5.6, 0.3, 1.9, 'metal');
  p.box(body, -0.4, 0.55, 0, 4.4, 2.0, 2.2, 'carPaint');
  p.box(body, 2.15, 0.55, 0, 1.2, 1.3, 2.1, 'carPaint');
  p.rbox(0x15181a, 2.45, 1.55, 0, 0.7, 0.04, 1.9, 0, 0, 0.9, 'carGlass');
  p.box(stripe, -0.4, 1.2, 1.105, 4.4, 0.22, 0.01, 'carPaint');
  p.box(stripe, -0.4, 1.2, -1.105, 4.4, 0.22, 0.01, 'carPaint');
  p.box(lights[0], 1.5, 2.55, -0.4, 0.3, 0.12, 0.6, 'lamp');
  p.box(lights[1], 1.5, 2.55, 0.4, 0.3, 0.12, 0.6, 'lamp');
  // Rear doors swung open.
  p.rbox(body, -2.9, 1.5, -1.45, 0.05, 1.8, 0.9, -1.3, 0, 0, 'carPaint');
  p.rbox(body, -2.9, 1.5, 1.45, 0.05, 1.8, 0.9, 1.3, 0, 0, 'carPaint');
  p.box(0x0e0e0e, -2.61, 0.7, 0, 0.01, 1.7, 2.0, 'metal');
  wheels(p, [1.8, -1.9], 0.92, 0.4);
  return p;
}

/**
 * City / school bus, 11.2 × 2.5 × 3 m. Wheels under the body in open arches (a dark inner wall, the
 * tyres inside the side line); the window band is a dark recessed cabin behind pillars, and the panes sit in
 * the openings between them — no pane lies on a painted surface, so nothing z-fights at any distance.
 * Painted panels (busPaint): dust low down, no rust blooms that could read as stains.
 */
function bus(b: Builder, x: number, z: number, yaw: number, rand: Rand): Place {
  const p = vehicle(b, x, z, yaw, 5.6, 1.3);
  const paint = pick(rand, [0xb8922e, 0x9ea6aa, 0x8a968c, 0xa89a7a]);
  const L = 5.6;
  const W = 1.25;
  const cabin = 0x101214;
  const arches: [number, number][] = [
    [3.25, 4.55],
    [-3.95, -2.65],
  ];
  // Skirt between and around the arches, the wheel wells in them.
  const skirt: [number, number][] = [
    [4.55, L],
    [-2.65, 3.25],
    [-L, -3.95],
  ];
  for (const [x0, x1] of skirt) p.box(paint, (x0 + x1) / 2, 0.32, 0, x1 - x0, 0.73, W * 2, 'busPaint');
  // The dark inner wall of each arch, between the wheels (the tyres stand in the open arch).
  for (const [x0, x1] of arches) p.box(0x121212, (x0 + x1) / 2, 0.32, 0, x1 - x0, 0.73, 1.6, 'rubber');
  wheels(p, [3.9, -3.3], 1.02, 0.5);
  // Below the windows, the roof.
  p.box(paint, 0, 1.05, 0, L * 2, 0.5, W * 2, 'busPaint');
  p.box(paint, 0, 2.45, 0, L * 2, 0.55, W * 2, 'busPaint');
  // Window band: the dark cabin set back 8 cm, pillars flush with the sides, a rear wall.
  p.box(cabin, 0, 1.55, 0, L * 2 - 0.2, 0.9, W * 2 - 0.16, 'rubber');
  // (Clear of the corner posts and the rear wall: no two faces share the side line.)
  for (let px = -L + 0.35; px <= L - 0.4; px += 1.25) {
    for (const sz of [-1, 1]) p.box(paint, px, 1.55, sz * (W - 0.042), 0.18, 0.9, 0.085, 'busPaint');
  }
  p.box(paint, -L + 0.05, 1.55, 0, 0.1, 0.9, W * 2, 'busPaint');
  for (const sz of [-1, 1]) p.box(paint, L - 0.05, 1.55, sz * (W - 0.07), 0.1, 0.9, 0.14, 'busPaint');
  // Panes in the openings: side panes 4 cm in front of the cabin and 4 cm behind the side line,
  // the windshield between the cabin and the front.
  for (const sz of [-1, 1]) p.box(0x2a3036, 0, 1.58, sz * (W - 0.04), L * 2 - 0.2, 0.84, 0.006, 'carGlass');
  p.box(0x2a3036, L - 0.04, 1.58, 0, 0.006, 0.84, W * 2 - 0.3, 'carGlass');
  // Front: destination sign, lamps, bumpers; the door on the kerb side, a little proud of the panel.
  p.box(0x1a1c1e, L + 0.01, 2.55, 0, 0.02, 0.28, 1.6, 'rubber');
  for (const sz of [-1, 1]) p.box(0xcfc8b0, L + 0.01, 0.75, sz * 0.95, 0.02, 0.16, 0.3, 'lamp');
  p.box(0x2a2a28, L + 0.06, 0.3, 0, 0.12, 0.3, W * 2 - 0.1, 'rubber');
  p.box(0x2a2a28, -L - 0.06, 0.3, 0, 0.12, 0.3, W * 2 - 0.1, 'rubber');
  p.box(0x26282a, 4.6, 0.35, W + 0.008, 1.0, 2.05, 0.016, 'metal');
  return p;
}

/** A light helicopter down in the street: lying on its side, tail boom snapped off, blades bent. */
function heliCrash(b: Builder, x: number, z: number, rand: Rand, bodies: BodyMode): void {
  const yaw = rand() * Math.PI * 2;
  const paint = pick(rand, [0x3e4434, 0x2a3440, 0x6a6a62]);
  const heli = model(b, 'heli', x, z, yaw, rand, { pitch: -0.22, roll: 0.18, lift: 0.15 });
  const p = heli ? new Place(b, x, 0, z, 0).tipped(yaw) : vehicle(b, x, z, yaw, 2.4, 1.4);
  // Procedural stand-in only without the model.
  const q = heli ? new Place(b, x, -50, z, 0) : p.tipped(0, 1.25, 0, 0.95);
  q.box(paint, 0, -0.9, 0, 3.6, 1.8, 1.9, 'carPaint');
  q.rbox(paint, 2.05, 0.1, 0, 1.0, 1.4, 1.7, 0, 0, -0.5, 'carPaint');
  q.rbox(0x14181a, 2.3, 0.3, 0, 0.9, 1.0, 1.6, 0, 0, -0.6, 'carGlass');
  q.box(0x2a2a2a, 0, 0.9, 0, 0.8, 0.4, 0.8, 'metal');
  q.box(0x2a2a2a, 0.2, -1.05, 0.9, 3.2, 0.08, 0.08, 'metal');
  q.box(0x2a2a2a, 0.2, -1.05, -0.9, 3.2, 0.08, 0.08, 'metal');
  // Rotor blades: one bent into the asphalt, one snapped and thrown.
  q.rbox(0x2a2a2a, 0, 1.15, 0, 7.5, 0.04, 0.3, 0.3, 0, 0.12, 'metal');
  p.rbox(0x2a2a2a, 4.8, 0.03, 3.2, 3.6, 0.04, 0.3, 1.1, 0, 0, 'metal');
  // Tail boom torn off a few meters away.
  const tail = new Place(b, x, 0, z, 0).tipped(yaw + 0.6);
  tail.rbox(paint, -5.6, 0.3, 0.8, 4.2, 0.35, 0.35, 0.2, 0, 0.05, 'carPaint');
  tail.rbox(paint, -7.7, 0.7, 1.2, 0.4, 1.2, 0.08, 0.2, 0, 0, 'carPaint');
  b.colliders.addOrientedBox(x + Math.cos(yaw + 0.6) * -5.6, z - Math.sin(yaw + 0.6) * -5.6, 2.1, 0.3, yaw + 0.6);
  // Gouges, debris, soot (no fire left), glass.
  stripDecal(b, x - Math.cos(yaw) * 6, z + Math.sin(yaw) * 6, yaw, 10, 1.6, 'decalSkid');
  groundDecal(b, 'decalSoot', x, 0, z, 6, rand, 1.4);
  groundDecal(b, 'decalShards', x + (rand() - 0.5) * 3, 0, z + (rand() - 0.5) * 3, 3, rand);
  groundDecal(b, 'decalOil', x + (rand() - 0.5) * 4, 0, z + (rand() - 0.5) * 4, 2.4, rand);
  for (let n = 0; n < 9; n++) p.rbox(pick(rand, [paint, 0x2a2a2a, 0x5a5e60]), (rand() - 0.5) * 12, 0.05, (rand() - 0.5) * 10, 0.2 + rand() * 0.8, 0.06, 0.15 + rand() * 0.5, rand() * 6, 0, rand() * 0.3, 'metal');
  // The crew got out, or did not.
  if (rand() < 0.6) body(b, x + 3.5, z - 2.5, rand() * 6, rand, 'military', bodies);
  // Barriers somebody put up afterwards.
  const A = new Place(b, x, 0, z, 0);
  stripedBarrier(A, -7, -6, 2.4, rand() < 0.5);
  stripedBarrier(A, 7, 6, 2.4, rand() < 0.5);
}

// ── Scenes ──────────────────────────────────────────────────────────────────────

/** Military cordon across the intersection: tank, trucks, sandbag nests, concrete blocks, tents. */
function cordon(b: Builder, x: number, z: number, rand: Rand, bodies: BodyMode): void {
  const alongX = rand() < 0.5;
  const yaw = alongX ? 0 : Math.PI / 2;
  const A = new Place(b, x, 0, z, alongX ? 0 : 1);
  // The line: concrete blocks across the road with a gap, sandbag nests at both ends.
  for (const s of [-1, 1]) {
    jersey(A, s * 4.2, -4.5, 2.6);
    sandbags(A, s * (BAND + 0.8), -4.8, 2.8, rand);
    sandbags(A, s * (BAND + 2.2), -3.6, 0.8, rand);
  }
  stripedBarrier(A, 0, -5.4, 3.0, rand() < 0.4);
  tank(b, x + (alongX ? 6 : 0) * (rand() < 0.5 ? -1 : 1) * 0.3, z + (alongX ? 3.5 : 0), yaw + (rand() - 0.5) * 0.4, rand);
  const truck = armyTruck(b, x + (alongX ? -6.5 : 2.0), z + (alongX ? 2.0 : -6.5), yaw + Math.PI + (rand() - 0.5) * 0.3, rand);
  F.boxes(truck.at(-4.2, 0.6, 0), rand, 2);
  if (rand() < 0.6) armyTruck(b, x + (alongX ? 9 : -2.0), z + (alongX ? -1.6 : 9), yaw + (rand() - 0.5) * 0.3, rand);
  tent(b, x + (alongX ? -BAND - 4 : 4.5), z + (alongX ? 4.5 : -BAND - 4), yaw, rand);
  if (rand() < 0.6) tent(b, x + (alongX ? BAND + 4 : -4.5), z + (alongX ? 4.5 : BAND + 4), yaw, rand);
  // Crates of supplies (searchable), burn barrels' soot, litter.
  for (let n = 0; n < 2; n++) {
    const cx = x + (rand() - 0.5) * 8;
    const cz = z + (rand() - 0.5) * 8;
    const cp = new Place(b, cx, 0, cz);
    if (cp.model('supplyCrate', rand, 0, 0, 0, rand() * 6, 1.15, 0.78, 0.15)) {
      b.solid(cx - 0.5, cz - 0.3, cx + 0.5, cz + 0.3, 0, 0.5);
    } else {
      b.block(0x3e4a34, cx - 0.5, 0, cz - 0.3, 1.0, 0.5, 0.6, 'wood', true);
    }
    b.container('crate', cx, cz + 0.5);
  }
  for (let i = 0; i < 3; i++) groundDecal(b, 'decalLitter', x + (rand() - 0.5) * 14, 0, z + (rand() - 0.5) * 14, 2.4, rand);
  groundDecal(b, 'decalSoot', x + (rand() - 0.5) * 8, 0, z + (rand() - 0.5) * 8, 2.2, rand, 1.2);
  const n = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < n; k++) body(b, x + (rand() - 0.5) * 9, z + 2 + rand() * 4, rand() * 6, rand, 'military', bodies);
}

/** Police and SWAT line: cars with doors open slewed across the lanes, an armored van, barriers. */
function policeLine(b: Builder, x: number, z: number, rand: Rand, bodies: BodyMode): void {
  const alongX = rand() < 0.5;
  const base = alongX ? 0 : Math.PI / 2;
  for (const s of [-1, 1]) {
    const a = base + Math.PI / 2 + (rand() - 0.5) * 0.7;
    const cx = x + (alongX ? s * 2.6 : (rand() - 0.5)) + (alongX ? 0 : s * 0.5);
    const cz = z + (alongX ? (rand() - 0.5) : s * 2.6);
    policeCar(b, cx + (alongX ? 0 : 0), cz, a, rand);
  }
  van(b, x + (alongX ? -9 : 1.8), z + (alongX ? 1.8 : -9), base + (rand() - 0.5) * 0.3, 0x1e2430, 0x3a4250, [0x2a3a8a, 0x8a2a2a]);
  const A = new Place(b, x, 0, z, alongX ? 0 : 1);
  for (const s of [-1, 1]) {
    stripedBarrier(A, s * 4.5, 6.5, 2.2, rand() < 0.35);
    stripedBarrier(A, s * 1.6, 6.8, 2.2, rand() < 0.35);
    jersey(A, s * (BAND + 1.2), -6.5, 2.2);
  }
  signBoard(A, BAND + 1.0, 7.5, 0x2a3a6a, rand);
  F.papers(A, rand, -6, -6, 6, 6, 10);
  for (let i = 0; i < 2; i++) groundDecal(b, 'decalLitter', x + (rand() - 0.5) * 12, 0, z + (rand() - 0.5) * 12, 2.2, rand);
  groundDecal(b, 'decalShards', x + (rand() - 0.5) * 4, 0, z + (rand() - 0.5) * 4, 2.6, rand);
  if (rand() < 0.4) stripDecal(b, x + (rand() - 0.5) * 3, z + (rand() - 0.5) * 3, base, 7, 2, 'decalSkid');
  const n = Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) body(b, x + (rand() - 0.5) * 8, z + (rand() - 0.5) * 8, rand() * 6, rand, rand() < 0.5 ? 'police' : 'swat', bodies);
}

/** Patrol car: a sedan in dark blue with a light bar, front doors flung open. */
function policeCar(b: Builder, x: number, z: number, yaw: number, rand: Rand): void {
  if (modelLibrary()) {
    buildCar(b.batch, b.colliders, { x, z, yaw, paint: 0xffffff, seed: Math.floor(rand() * 1e6), kind: 'police' }, b.containers);
    return;
  }
  buildCar(b.batch, b.colliders, { x, z, yaw, paint: pick(rand, [0x1e2a44, 0x2a2e34]), seed: Math.floor(rand() * 1e6), smashed: rand() < 0.5 ? 0.3 : 0 }, b.containers);
  const p = new Place(b, x, 0, z, 0).tipped(yaw);
  p.box(0x2a2a2a, -0.3, 1.4, 0, 0.3, 0.1, 1.1, 'metal');
  p.box(0x2a3a8a, -0.3, 1.5, -0.3, 0.26, 0.1, 0.45, 'lamp');
  p.box(0x8a2a2a, -0.3, 1.5, 0.3, 0.26, 0.1, 0.45, 'lamp');
  for (const s of [-1, 1]) if (rand() < 0.75) p.rbox(0x1e2a44, 0.25 + 0.5, 0.6, s * (0.86 + 0.5), 1.0, 0.75, 0.05, s * -0.9, 0, 0, 'carPaint');
}

/** Evacuation point: buses, ambulances, a fire truck, a medical tent, luggage left behind, signs. */
function evacuation(b: Builder, x: number, z: number, rand: Rand, bodies: BodyMode): void {
  const alongX = rand() < 0.5;
  const base = alongX ? 0 : Math.PI / 2;
  const off = (u: number, v: number): [number, number] => (alongX ? [x + u, z + v] : [x + v, z + u]);
  let [vx, vz] = off(-10, -1.8);
  bus(b, vx, vz, base + (rand() - 0.5) * 0.08, rand);
  if (rand() < 0.6) {
    [vx, vz] = off(11, 1.8);
    bus(b, vx, vz, base + Math.PI + (rand() - 0.5) * 0.1, rand);
  }
  [vx, vz] = off(3, -1.8);
  van(b, vx, vz, base + (rand() - 0.5) * 0.4, 0xc8c4b8, 0x8a2a22, [0x2a3a8a, 0x2a3a8a]);
  if (rand() < 0.6) {
    [vx, vz] = off(-2, 2.2);
    van(b, vx, vz, base + Math.PI + (rand() - 0.5) * 0.5, 0xc8c4b8, 0x8a2a22, [0x2a3a8a, 0x8a2a2a]);
  }
  [vx, vz] = off(BAND + 3, 4.5 + BAND);
  fireTruck(b, vx, vz, base + Math.PI / 2 + (rand() - 0.5) * 0.3, rand);
  [vx, vz] = off(-BAND - 4, BAND + 4);
  const med = tent(b, vx, vz, base, rand, 0xb0aca0);
  F.boxes(med.at(1.0, 2.4, 0), rand, 2);
  // Stretchers, luggage, prams of belongings, a sign pointing to the buses.
  const A = new Place(b, x, 0, z, alongX ? 0 : 1);
  for (let k = 0; k < 2; k++) stretcher(A, (rand() - 0.5) * 6, 4 + rand() * 2, rand);
  for (let k = 0; k < 5; k++) F.suitcase(A.at((rand() - 0.5) * 12, (rand() - 0.5) * 9, Math.floor(rand() * 4)), rand, rand() < 0.4);
  for (let k = 0; k < 2; k++) F.boxes(A.at((rand() - 0.5) * 10, (rand() - 0.5) * 8, Math.floor(rand() * 4)), rand, 2);
  F.clothesPile(A, rand, 0, 0, 6);
  F.papers(A, rand, -8, -6, 8, 6, 14);
  signBoard(A, -BAND - 1.2, -BAND - 1.2, 0x3a6a4a, rand);
  signBoard(A, BAND + 1.2, -BAND - 1.2, 0x3a6a4a, rand);
  stripedBarrier(A, 0, BAND + 1.0, 2.6, rand() < 0.5);
  for (let i = 0; i < 3; i++) groundDecal(b, 'decalLitter', x + (rand() - 0.5) * 16, 0, z + (rand() - 0.5) * 16, 2.4, rand);
  const n = 1 + Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) body(b, x + (rand() - 0.5) * 10, z + (rand() - 0.5) * 10, rand() * 6, rand, rand() < 0.3 ? 'medic' : rand() < 0.3 ? 'fire' : 'civilian', bodies);
}

export function fireTruck(b: Builder, x: number, z: number, yaw: number, rand: Rand): void {
  const p = vehicle(b, x, z, yaw, 4.2, 1.25);
  const red = pick(rand, [0x7a2a22, 0x6a2620]);
  p.box(0x1e1e1e, 0, 0.35, 0, 8.2, 0.25, 2.1, 'metal');
  p.box(red, 3.2, 0.6, 0, 1.8, 2.1, 2.4, 'carPaint');
  p.box(0x14181a, 4.11, 1.6, 0, 0.02, 0.8, 2.1, 'carGlass');
  p.box(red, -0.9, 0.6, 0, 6.2, 1.7, 2.4, 'carPaint');
  p.box(0x8a8a86, -0.9, 1.45, 1.205, 6.0, 0.12, 0.01, 'metal');
  p.box(0x8a8a86, -0.9, 1.45, -1.205, 6.0, 0.12, 0.01, 'metal');
  // Ladder on top, partly raised.
  p.rbox(0xa8a49a, -0.8, 2.6, 0, 6.0, 0.12, 0.7, 0, 0, 0.12, 'metal');
  p.box(0xb8a838, 2.8, 2.7, 0, 0.3, 0.12, 1.2, 'lamp');
  // Hose reeled out across the road.
  for (let k = 0; k < 4; k++) p.rbox(0x8a7a5a, -1 - k * 1.7, 0.04, 2.0 + k * 0.6, 1.8, 0.08, 0.08, 0.4 - k * 0.3, 0, 0, 'rubber');
  // Tyres inside the side line (the body is 2.4 m wide), under it.
  wheels(p, [3.0, -1.6, -3.0], 1.0, 0.5);
}

function stretcher(p: Place, lx: number, lz: number, rand: Rand): void {
  const [sx, sz] = p.pt(lx, lz);
  if (model(p.b, 'stretcher', sx, sz, rand() * 6, rand, { collide: false })) return;
  const q = p.at(lx, lz).tipped(rand() * 6);
  q.box(0x8a8a86, 0, 0.0, 0, 1.9, 0.62, 0.05, 'metal');
  q.box(0x8a8a86, 0, 0.62, 0, 1.95, 0.05, 0.6, 'metal');
  q.box(0x6a7a84, 0, 0.67, 0, 1.85, 0.06, 0.56, 'rubber');
  if (rand() < 0.5) q.rbox(0xb8b4aa, 0.3, 0.74, 0, 1.0, 0.03, 0.6, 0.2, 0, 0, 'rubber');
}

// ── Bodies ──────────────────────────────────────────────────────────────────────

export type Dress = 'military' | 'police' | 'swat' | 'medic' | 'fire' | 'civilian';
const DRESS: Record<Dress, { top: number; pants: number; head?: number }> = {
  military: { top: 0x4a5236, pants: 0x4a5236, head: 0x3e4630 },
  police: { top: 0x2a3448, pants: 0x1e2430, head: 0x1e2430 },
  swat: { top: 0x1e2228, pants: 0x1e2228, head: 0x1a1c20 },
  medic: { top: 0x5a8a8a, pants: 0x5a8a8a },
  fire: { top: 0x8a7a3a, pants: 0x8a7a3a, head: 0x8a7a3a },
  civilian: { top: 0x4a4038, pants: 0x34404e },
};
const SKINS = [0xc8a084, 0xa47a5a, 0x7a5440, 0xd8b498];
const BODY_LOOT: Partial<Record<Dress, 'bodyMilitary' | 'bodyPolice' | 'bodyMedic' | 'bodyFire'>> = {
  military: 'bodyMilitary',
  police: 'bodyPolice',
  swat: 'bodyPolice',
  medic: 'bodyMedic',
  fire: 'bodyFire',
};

/**
 * A body on the ground: whole, clean, in a natural pose — or covered with a sheet, or in a bag.
 * Authored lying along local +X (head at +X).
 */
export function body(b: Builder, x: number, z: number, yaw: number, rand: Rand, dress: Dress, mode: BodyMode): void {
  const roll = rand();
  const cover = mode === 'covered' ? (roll < 0.6 ? 'sheet' : 'bag') : roll < 0.4 ? 'none' : roll < 0.75 ? 'sheet' : 'bag';
  const p = new Place(b, x, 0, z, 0).tipped(yaw);
  const d = DRESS[dress];
  if (cover === 'bag') {
    const c = pick(rand, [0x22262a, 0x2a2e26, 0x1e2430]);
    p.box(c, 0, 0, 0, 1.85, 0.26, 0.6, 'rubber');
    p.blob(c, 0.85, 0.15, 0, 0.18, 0.15, 0.27, 'rubber');
    p.blob(c, -0.85, 0.12, 0, 0.16, 0.13, 0.25, 'rubber');
    p.box(0x6a6a62, 0.05, 0.262, 0.06, 1.6, 0.01, 0.03, 'metal');
  } else if (cover === 'sheet') {
    const c = pick(rand, [0xb8b4aa, 0xa8a49a, 0x9aa0a4]);
    p.rbox(c, 0, 0.11, 0, 1.95, 0.2, 0.75, 0, 0, 0.02, 'rubber');
    p.blob(c, 0.78, 0.2, 0, 0.17, 0.14, 0.22, 'rubber');
    p.blob(c, -0.75, 0.2, 0.12, 0.1, 0.12, 0.1, 'rubber');
    p.blob(c, -0.75, 0.2, -0.12, 0.1, 0.12, 0.1, 'rubber');
    // The sheet's edge on the ground.
    p.rbox(c, 0, 0.01, 0, 2.1, 0.02, 1.0, 0.05, 0, 0, 'rubber');
    // A boot sticking out from under it.
    if (rand() < 0.5) p.box(0x2a2622, -1.02, 0.02, 0.12, 0.14, 0.12, 0.11, 'rubber');
  } else {
    const skin = pick(rand, SKINS);
    const pose = Math.floor(rand() * 3);
    if (pose === 0) {
      // On the back, arms at the sides, one knee a little up.
      p.box(d.top, 0.25, 0, 0, 0.62, 0.22, 0.4, 'rubber');
      p.blob(skin, 0.7, 0.11, 0, 0.11, 0.11, 0.1, 'plaster');
      if (d.head) p.blob(d.head, 0.72, 0.16, 0, 0.13, 0.07, 0.12, 'rubber');
      p.box(d.top, 0.3, 0, 0.27, 0.55, 0.1, 0.11, 'rubber');
      p.box(d.top, 0.3, 0, -0.27, 0.55, 0.1, 0.11, 'rubber');
      p.box(d.pants, -0.38, 0, 0.1, 0.8, 0.14, 0.15, 'rubber');
      p.rbox(d.pants, -0.38, 0.12, -0.1, 0.82, 0.14, 0.15, 0, 0, 0.18, 'rubber');
      p.box(0x2a2622, -0.82, 0, 0.1, 0.12, 0.13, 0.12, 'rubber');
    } else if (pose === 1) {
      // On the side, knees drawn up.
      const q = p.tipped(0, Math.PI / 2, 0, 0.0);
      q.box(d.top, 0.25, 0.2, -0.11, 0.62, 0.4, 0.22, 'rubber');
      q.blob(skin, 0.7, 0.2, 0, 0.11, 0.1, 0.11, 'plaster');
      q.rbox(d.top, 0.45, 0.35, 0.05, 0.5, 0.1, 0.11, -0.5, 0, 0, 'rubber');
      q.rbox(d.pants, -0.2, 0.2, 0.15, 0.5, 0.15, 0.16, 0.9, 0, 0, 'rubber');
      q.rbox(d.pants, -0.3, 0.2, 0.45, 0.48, 0.14, 0.15, -0.4, 0, 0, 'rubber');
    } else {
      // Face down, one arm reaching forward.
      p.box(d.top, 0.25, 0, 0, 0.62, 0.22, 0.4, 'rubber');
      p.blob(d.head ?? 0x2e2a1c, 0.7, 0.11, 0, 0.11, 0.11, 0.1, 'rubber');
      p.rbox(d.top, 0.9, 0.05, 0.28, 0.55, 0.1, 0.11, 0.3, 0, 0, 'rubber');
      p.box(d.top, 0.25, 0, -0.27, 0.5, 0.1, 0.11, 'rubber');
      p.box(d.pants, -0.38, 0, 0.1, 0.8, 0.14, 0.15, 'rubber');
      p.rbox(d.pants, -0.38, 0, -0.14, 0.8, 0.14, 0.15, -0.15, 0, 0, 'rubber');
    }
  }
  const loot = BODY_LOOT[dress];
  if (loot) b.container(loot, x, z);
}

