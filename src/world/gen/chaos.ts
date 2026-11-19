import { mulberry32 } from '../../core/random';
import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { type ModelInfo, pickModel } from '../models';
import { buildCar, modelLibrary, placeModel } from '../props/car';
import * as F from './furniture';
import { Place } from './furniture';
import { groundDecal } from './highrise';
import { BAND } from './layout';
import { hash3 } from './noise';
import type { Rand } from './palette';
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

function tank(b: Builder, x: number, z: number, yaw: number, rand: Rand): void {
  model(b, rand() < 0.6 ? 'tank' : 'apc', x, z, yaw, rand);
}

function armyTruck(b: Builder, x: number, z: number, yaw: number, rand: Rand): Place {
  model(b, 'truck', x, z, yaw, rand);
  return new Place(b, x, 0, z, 0).tipped(yaw);
}

/** Sandbag wall along local X (3D model only). */
export function sandbags(p: Place, lx: number, lz: number, len: number, rand: Rand): void {
  const lib = modelLibrary();
  if (!pickModel(lib, 'sandbag', 0)) return;
  const n = Math.max(1, Math.round(len / 0.7));
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < n - layer; i++) {
      const [x, z] = p.pt(lx - len / 2 + 0.35 + i * 0.7 + layer * 0.35, lz + (rand() - 0.5) * 0.06);
      model(p.b, 'sandbag', x, z, yawOf(p) + (rand() - 0.5) * 0.25, rand, { lift: layer * 0.22, collide: false });
    }
  }
  p.solid(lx, lz, len, 0.5, 0.45);
}

/** Concrete road barrier along local X (3D model only). */
export function jersey(p: Place, lx: number, lz: number, len: number): void {
  if (!pickModel(modelLibrary(), 'jersey', 0)) return;
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i < n; i++) {
    const [x, z] = p.pt(lx - len / 2 + 1 + i * 2, lz);
    model(p.b, 'jersey', x, z, yawOf(p), () => 0, { collide: false });
  }
  p.solid(lx, lz, len, 0.6, 0.85);
}

/** Road barrier (3D model only). */
export function stripedBarrier(p: Place, lx: number, lz: number, len: number, down = false): void {
  if (!pickModel(modelLibrary(), 'barrier', 0)) return;
  const [x, z] = p.pt(lx, lz);
  model(p.b, 'barrier', x, z, yawOf(p), () => (len > 2.6 ? 0.6 : 0.1), {
    collide: !down,
    roll: down ? Math.PI / 2 - 0.1 : 0,
    lift: down ? 0.12 : 0,
  });
  if (!down) p.solid(lx, lz, len, 0.3, 1.0);
}

/** Field tent (3D model only). */
export function tent(b: Builder, x: number, z: number, yaw: number, rand: Rand, color?: number): Place {
  model(b, color === 0xb0aca0 ? 'tent_medical' : 'tent', x, z, yaw, rand);
  return new Place(b, x, 0, z, 0).tipped(yaw);
}

/** Box van / ambulance (3D model only). */
function van(b: Builder, x: number, z: number, yaw: number, body: number, _stripe: number, _lights: [number, number]): Place {
  const ambulance = body === 0xc8c4b8;
  model(b, ambulance ? 'ambulance' : 'van', x, z, yaw, () => Math.abs(Math.sin(x * 12.9898 + z * 78.233)), { paint: ambulance ? undefined : body + 0x101010 });
  return new Place(b, x, 0, z, 0).tipped(yaw);
}

/** Transit / heavy vehicle slot replaced with baked 3D van/truck model. */
function bus(b: Builder, x: number, z: number, yaw: number, rand: Rand): Place {
  model(b, rand() < 0.5 ? 'truck' : 'van', x, z, yaw, rand);
  return new Place(b, x, 0, z, 0).tipped(yaw);
}

/** Crashed helicopter (3D model only, with ground skid/soot/shards/oil decals and real road barriers). */
function heliCrash(b: Builder, x: number, z: number, rand: Rand, _bodies: BodyMode): void {
  const yaw = rand() * Math.PI * 2;
  model(b, 'heli', x, z, yaw, rand, { pitch: -0.22, roll: 0.18, lift: 0.15 });
  stripDecal(b, x - Math.cos(yaw) * 6, z + Math.sin(yaw) * 6, yaw, 10, 1.6, 'decalSkid');
  groundDecal(b, 'decalSoot', x, 0, z, 6, rand, 1.4);
  groundDecal(b, 'decalShards', x + (rand() - 0.5) * 3, 0, z + (rand() - 0.5) * 3, 3, rand);
  groundDecal(b, 'decalOil', x + (rand() - 0.5) * 4, 0, z + (rand() - 0.5) * 4, 2.4, rand);
  const A = new Place(b, x, 0, z, 0);
  stripedBarrier(A, -7, -6, 2.4, rand() < 0.5);
  stripedBarrier(A, 7, 6, 2.4, rand() < 0.5);
}

// ── Scenes ──────────────────────────────────────────────────────────────────────

/** Military cordon across the intersection: tank, trucks, sandbag nests, concrete blocks, tents. */
function cordon(b: Builder, x: number, z: number, rand: Rand, _bodies: BodyMode): void {
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
  // Crates of supplies (searchable), burn barrels' soot.
  for (let n = 0; n < 2; n++) {
    const cx = x + (rand() - 0.5) * 8;
    const cz = z + (rand() - 0.5) * 8;
    const cp = new Place(b, cx, 0, cz);
    cp.resetBounds();
    cp.model('supplyCrate', rand, 0, 0, 0, rand() * 6, 1.15, 0.78, 0.15, true);
    cp.container('crate', 0, 0.5);
  }
  groundDecal(b, 'decalSoot', x + (rand() - 0.5) * 8, 0, z + (rand() - 0.5) * 8, 2.2, rand, 1.2);
}

/** Police and SWAT line: cars slewed across the lanes, an armored van, barriers. */
function policeLine(b: Builder, x: number, z: number, rand: Rand, _bodies: BodyMode): void {
  const alongX = rand() < 0.5;
  const base = alongX ? 0 : Math.PI / 2;
  for (const s of [-1, 1]) {
    const a = base + Math.PI / 2 + (rand() - 0.5) * 0.7;
    const cx = x + (alongX ? s * 2.6 : (rand() - 0.5)) + (alongX ? 0 : s * 0.5);
    const cz = z + (alongX ? (rand() - 0.5) : s * 2.6);
    policeCar(b, cx, cz, a, rand);
  }
  van(b, x + (alongX ? -9 : 1.8), z + (alongX ? 1.8 : -9), base + (rand() - 0.5) * 0.3, 0x1e2430, 0x3a4250, [0x2a3a8a, 0x8a2a2a]);
  const A = new Place(b, x, 0, z, alongX ? 0 : 1);
  for (const s of [-1, 1]) {
    stripedBarrier(A, s * 4.5, 6.5, 2.2, rand() < 0.35);
    stripedBarrier(A, s * 1.6, 6.8, 2.2, rand() < 0.35);
    jersey(A, s * (BAND + 1.2), -6.5, 2.2);
  }
  groundDecal(b, 'decalShards', x + (rand() - 0.5) * 4, 0, z + (rand() - 0.5) * 4, 2.6, rand);
  if (rand() < 0.4) stripDecal(b, x + (rand() - 0.5) * 3, z + (rand() - 0.5) * 3, base, 7, 2, 'decalSkid');
}

/** Patrol car (3D model via buildCar). */
function policeCar(b: Builder, x: number, z: number, yaw: number, rand: Rand): void {
  buildCar(b.batch, b.colliders, { x, z, yaw, paint: 0xffffff, seed: Math.floor(rand() * 1e6), kind: 'police' }, b.containers);
}

/** Evacuation point: transport vehicles, ambulances, medical tent, luggage, barriers. */
function evacuation(b: Builder, x: number, z: number, rand: Rand, _bodies: BodyMode): void {
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
  // Stretchers, luggage, boxes, barriers.
  const A = new Place(b, x, 0, z, alongX ? 0 : 1);
  for (let k = 0; k < 2; k++) stretcher(A, (rand() - 0.5) * 6, 4 + rand() * 2, rand);
  for (let k = 0; k < 5; k++) F.suitcase(A.at((rand() - 0.5) * 12, (rand() - 0.5) * 9, Math.floor(rand() * 4)), rand, rand() < 0.4);
  for (let k = 0; k < 2; k++) F.boxes(A.at((rand() - 0.5) * 10, (rand() - 0.5) * 8, Math.floor(rand() * 4)), rand, 2);
  stripedBarrier(A, 0, BAND + 1.0, 2.6, rand() < 0.5);
}

export function fireTruck(b: Builder, x: number, z: number, yaw: number, rand: Rand): void {
  model(b, 'truck', x, z, yaw, rand);
}

function stretcher(p: Place, lx: number, lz: number, rand: Rand): void {
  const [sx, sz] = p.pt(lx, lz);
  model(p.b, 'stretcher', sx, sz, rand() * 6, rand, { collide: false });
}

// ── Bodies (removed procedural block/blob corpses) ──────────────────────────────

export type Dress = 'military' | 'police' | 'swat' | 'medic' | 'fire' | 'civilian';

export function body(_b: Builder, _x: number, _z: number, _yaw: number, _rand: Rand, _dress: Dress, _mode: BodyMode): void {}

