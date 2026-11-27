import { mulberry32 } from '../../core/random';
import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { type ModelInfo, pickModel } from '../models';
import { buildCar, modelLibrary, placeModel } from '../props/car';
import { GLB_WORLD_SPECS, type GlbModelId, pickWorldVehicle } from '../worldModels';
import { isGlbClear } from './footprint';
import * as F from './furniture';
import { Place } from './furniture';
import { groundDecal } from './highrise';
import { BAND } from './layout';
import { LIFE, spotHash } from './lifeKinds';
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

function resolveChaosGlb(group: string, r: number): GlbModelId | null {
  if (group === 'tent' || group === 'tent_medical') return 'quarantine_tent';
  if (group === 'barrier') return 'checkpoint_barricade';
  if (['tank', 'apc', 'truck', 'van', 'ambulance', 'fireTruck', 'bus', 'heli', 'heliMil', 'semi', 'trailer'].includes(group)) {
    return pickWorldVehicle(group, r);
  }
  return null;
}

/** A model of a group (nose +X along yaw), optionally tipped and lifted; collider over its footprint. */
function model(b: Builder, group: string, x: number, z: number, yaw: number, rand: Rand, o: { roll?: number; pitch?: number; lift?: number; collide?: boolean; paint?: number } = {}): ModelInfo | null {
  const r = rand();
  const glbId = resolveChaosGlb(group, r);
  if (glbId) {
    const spec = GLB_WORLD_SPECS[glbId];
    const y = (o.lift ?? 0) + 0.01;
    const isBarrier = glbId === 'checkpoint_barricade' || glbId === 'quarantine_tent';
    const glbYaw = isBarrier ? yaw : yaw - Math.PI / 2;
    if (o.collide !== false && !isGlbClear(b.batch, glbId, x, z, glbYaw, 0.9, { keepClearGap: 2.5 })) {
      return null;
    }
    b.glb(glbId, x, y, z, glbYaw, { roll: o.roll, pitch: o.pitch });
    if (o.collide !== false) {
      const hx = isBarrier ? spec.size[0] / 2 : spec.size[2] / 2;
      const hz = isBarrier ? spec.size[2] / 2 : spec.size[0] / 2;
      b.colliders.addOrientedBox(x, z, hx, hz, yaw, -0.5, (o.lift ?? 0) + spec.size[1] + 0.05);
    }
    return null;
  }
  const m = pickModel(modelLibrary(), group, r);
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

/** Road barrier (GLB checkpoint_barricade). */
export function stripedBarrier(p: Place, lx: number, lz: number, len: number, down = false): void {
  const [x, z] = p.pt(lx, lz);
  const yaw = yawOf(p);
  const sx = Math.max(0.7, len / 3.4);
  if (!isGlbClear(p.b.batch, 'checkpoint_barricade', x, z, yaw, 0.35, { keepClearGap: 0.6, sx })) return;
  p.b.glb('checkpoint_barricade', x, down ? 0.12 : 0, z, yaw, {
    sx,
    roll: down ? Math.PI / 2 - 0.1 : 0,
  });
  if (!down) p.solid(lx, lz, len, 0.45, 1.4);
}

/** Field tent (GLB quarantine_tent). */
export function tent(b: Builder, x: number, z: number, yaw: number, _rand: Rand, _color?: number): Place {
  if (isGlbClear(b.batch, 'quarantine_tent', x, z, yaw, 0.8, { keepClearGap: 1.5 })) {
    b.glb('quarantine_tent', x, 0, z, yaw);
    b.colliders.addOrientedBox(x, z, 3.1, 2.06, yaw, -0.5, 3.05);
  }
  return new Place(b, x, 0, z, 0).tipped(yaw);
}

/** Box van / ambulance (GLB). */
function van(b: Builder, x: number, z: number, yaw: number, body: number, _stripe: number, _lights: [number, number]): Place {
  const ambulance = body === 0xc8c4b8;
  model(b, ambulance ? 'ambulance' : body === 0x1e2430 ? 'swat' : 'van', x, z, yaw, () => Math.abs(Math.sin(x * 12.9898 + z * 78.233)));
  return new Place(b, x, 0, z, 0).tipped(yaw);
}

/** Transit / heavy vehicle slot (bus / semi / Kamaz). */
function bus(b: Builder, x: number, z: number, yaw: number, rand: Rand): Place {
  const r = rand();
  model(b, r < 0.55 ? 'bus' : r < 0.8 ? 'truck' : 'semi', x, z, yaw, rand);
  return new Place(b, x, 0, z, 0).tipped(yaw);
}

/** Crashed helicopter (GLB mi8_wreck_remesh with cockpit container carrying guaranteed avionics). */
function heliCrash(b: Builder, x: number, z: number, rand: Rand, _bodies: BodyMode): void {
  const yaw = rand() * Math.PI * 2;
  b.glb('mi8_wreck_remesh', x, 0.05, z, yaw - Math.PI / 2, { pitch: -0.14, roll: 0.16 });
  b.colliders.addOrientedBox(x, z, 7.6, 2.6, yaw, -0.5, 4.1);
  // Searchable flight deck holding guaranteed Mi-8 avionics / ignition unit.
  const cx = x + Math.cos(yaw) * 1.8;
  const cz = z - Math.sin(yaw) * 1.8;
  if (b.inClip(cx, cz)) {
    b.containers.push({ type: 'vehicleCabin', x: cx, z: cz, box: [cx, 1.4, cz, 2.1, 1.35, 1.35, yaw], fixed: ['heliAvionics'] });
  }
  stripDecal(b, x - Math.cos(yaw) * 6, z + Math.sin(yaw) * 6, yaw, 10, 1.6, 'decalSkid');
  groundDecal(b, 'decalSoot', x, 0, z, 6, rand, 1.4);
  groundDecal(b, 'decalShards', x + (rand() - 0.5) * 3, 0, z + (rand() - 0.5) * 3, 3, rand);
  groundDecal(b, 'decalOil', x + (rand() - 0.5) * 4, 0, z + (rand() - 0.5) * 4, 2.4, rand);
  b.life(LIFE.fire, x - Math.cos(yaw) * 1.4, 1.1, z + Math.sin(yaw) * 1.4, 0, 0, 1.4, 0, spotHash(x, z, 111));
  b.life(LIFE.smoke, x, 1.8, z, 0, 0, 0, 0, spotHash(x, z, 112));
  if (isGlbClear(b.batch, 'Road_Debris_Cluster_2', x + 4.2, z - 2.2, yaw, 0.35, { keepClearGap: 1.5 })) {
    b.glb('Road_Debris_Cluster_2', x + 4.2, 0.01, z - 2.2, yaw, { scale: 1.2 });
  }
  const A = new Place(b, x, 0, z, 0);
  stripedBarrier(A, -8, -2.5, 2.4, rand() < 0.5);
  stripedBarrier(A, 8, 2.5, 2.4, rand() < 0.5);
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
  // Tents on the road arms beside the line (an arm is 2 × BAND wide: the corners beyond are the blocks' buildings).
  tent(b, x + (alongX ? -BAND - 4 : 3.0), z + (alongX ? 3.0 : -BAND - 4), yaw, rand);
  if (rand() < 0.6) tent(b, x + (alongX ? BAND + 4 : -3.0), z + (alongX ? 3.0 : BAND + 4), yaw, rand);
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
    jersey(A, s * (BAND + 1.2), -5.0, 2.2);
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
  let [vx, vz] = off(-10, -2.0);
  bus(b, vx, vz, base + (rand() - 0.5) * 0.08, rand);
  if (rand() < 0.6) {
    [vx, vz] = off(11, 2.2);
    bus(b, vx, vz, base + Math.PI + (rand() - 0.5) * 0.1, rand);
  }
  [vx, vz] = off(3.2, -2.0);
  van(b, vx, vz, base + (rand() - 0.5) * 0.4, 0xc8c4b8, 0x8a2a22, [0x2a3a8a, 0x2a3a8a]);
  if (rand() < 0.6) {
    [vx, vz] = off(-2.8, 2.4);
    van(b, vx, vz, base + Math.PI + (rand() - 0.5) * 0.5, 0xc8c4b8, 0x8a2a22, [0x2a3a8a, 0x8a2a2a]);
  }
  // The fire truck and the medical tent stand on the cross street's arm, never in the corners (the buildings).
  [vx, vz] = off(2.0, BAND + 6);
  fireTruck(b, vx, vz, base + Math.PI / 2 + (rand() - 0.5) * 0.3, rand);
  [vx, vz] = off(-0.4, -BAND - 4.2);
  const med = tent(b, vx, vz, base, rand, 0xb0aca0);
  F.boxes(med.at(1.0, 2.4, 0), rand, 2);
  // Stretchers, luggage, boxes, barriers.
  const A = new Place(b, x, 0, z, alongX ? 0 : 1);
  for (let k = 0; k < 2; k++) stretcher(A, (rand() - 0.5) * 6, 4 + rand() * 2, rand);
  for (let k = 0; k < 4; k++) {
    const lx = x + (rand() - 0.5) * 12;
    const lz = z + (rand() - 0.5) * 9;
    const lyaw = rand() * 6.28;
    if (isGlbClear(b.batch, 'abandoned_luggage_pil', lx, lz, lyaw, 0.5, { keepClearGap: 0.8 })) {
      b.glb('abandoned_luggage_pil', lx, 0, lz, lyaw);
    }
  }
  for (let k = 0; k < 2; k++) F.boxes(A.at((rand() - 0.5) * 10, (rand() - 0.5) * 8, Math.floor(rand() * 4)), rand, 2);
  stripedBarrier(A, 0, BAND + 1.0, 2.6, rand() < 0.5);
}

export function fireTruck(b: Builder, x: number, z: number, yaw: number, rand: Rand): void {
  model(b, 'fireTruck', x, z, yaw, rand);
}

function stretcher(p: Place, lx: number, lz: number, rand: Rand): void {
  const [sx, sz] = p.pt(lx, lz);
  model(p.b, 'stretcher', sx, sz, rand() * 6, rand, { collide: false });
}

// ── Bodies (removed procedural block/blob corpses) ──────────────────────────────

export type Dress = 'military' | 'police' | 'swat' | 'medic' | 'fire' | 'civilian';

export function body(_b: Builder, _x: number, _z: number, _yaw: number, _rand: Rand, _dress: Dress, _mode: BodyMode): void {}

