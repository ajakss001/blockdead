import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from 'three';
import { mulberry32 } from '../../core/random';
import type { Surface } from '../../render/look/materials';
import type { StaticBatch, VertexTint } from '../../render/StaticBatch';
import type { ColliderSink } from '../CollisionWorld';
import type { ContainerSpot } from '../gen/pieces';
import { type ModelInfo, type ModelLibrary, modelGeometry, modelGlass, modelLod1Indices } from '../models';
import { CIVILIAN_FALLBACK_POOL, GLB_WORLD_SPECS, type GlbModelId, pickWorldVehicle } from '../worldModels';

/** Third-party vehicle and prop models (set in the worker once loaded); null = procedural only. */
let library: ModelLibrary | null = null;
export function setModelLibrary(lib: ModelLibrary | null): void {
  library = lib;
}
export function modelLibrary(): ModelLibrary | null {
  return library;
}

/** Faded 90s factory colors. */
export const CAR_PAINTS = {
  tan: 0x5c4a36,
  slate: 0x3c4650,
  beige: 0x8a7f68,
  bottle: 0x2f4034,
} as const;

export interface CarOptions {
  /** Center of the footprint on the ground. */
  x: number;
  z: number;
  /** Heading: 0 = nose towards +X. */
  yaw: number;
  paint: number;
  seed?: number;
  /** Rear-right tire flat: wheel squashed, body sags towards that corner. */
  flatTire?: boolean;
  /** Chance (0..1) for each window to be smashed out, leaving jagged teeth in the frame. */
  smashed?: number;
  /** Model group (car, van, police, ambulance, wreck…); default: a civilian car or van. */
  kind?: string;
  /** Optional explicit world GLB vehicle override. */
  glbId?: GlbModelId;
}

// Mid-size 90s sedan, meters. Local axes: +X nose, +Y up, +Z left side.
const LENGTH = 4.66;
const WIDTH = 1.72;
const WHEEL_R = 0.31;
const WHEEL_W = 0.21;
const ARCH_R = 0.4;
const ARCH_Y = 0.3;
const AXLE_F = 1.35;
const AXLE_R = -1.35;
const SILL = 0.23;
/** Body panels are extruded slightly narrower; the 3 cm bevel brings them back to WIDTH. */
const BEVEL = 0.03;
/** Bumper tip to bumper tip / 2. */
const BODY_HALF_LENGTH = 2.44;

type P = [number, number];

/** Wheel-arch cut-out in the bottom edge of a side profile, traversed left → right. */
function arch(cx: number): P[] {
  const pts: P[] = [];
  for (const deg of [190, 160, 130, 100, 70, 40, 10, -10]) {
    const a = (deg * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * ARCH_R, ARCH_Y + Math.sin(a) * ARCH_R]);
  }
  return pts;
}

/**
 * Side profiles of the three body sections (counter-clockwise). Splitting the body leaves
 * real panel gaps between front clip, doors and rear — the flashlight catches them.
 */
const PROFILES: Record<'front' | 'doors' | 'rear', P[]> = {
  // Front clip: fender with arch, nose, hood sloping down towards the grille.
  front: [[0.66, SILL], ...arch(AXLE_F), [2.22, SILL], [2.32, 0.36], [2.3, 0.7], [2.12, 0.79], [0.7, 0.94], [0.66, 0.94]],
  // Doors: beltline rising slightly towards the back (wedge stance of the era).
  doors: [[-0.88, SILL], [0.645, SILL], [0.645, 0.94], [-0.88, 0.965]],
  // Rear: quarter panel with arch, trunk lid, tail.
  rear: [[-2.22, SILL], ...arch(AXLE_R), [-0.895, SILL], [-0.895, 0.965], [-1.3, 0.97], [-2.16, 0.93], [-2.3, 0.8], [-2.33, 0.36]],
};

// Cabin (greenhouse): bottom at the beltline, narrower roof (tumblehome), raked glass.
const CABIN = {
  baseFront: 0.62,
  baseRear: -1.22,
  baseY: 0.955,
  roofFront: 0.05,
  roofRear: -0.7,
  roofY: 1.4,
  baseHalf: WIDTH / 2 - 0.05,
  roofHalf: 0.7,
};

const MUD = new Color(0x3b3226);
const DUST = new Color(0x8c8678);

/** Mud splashed up to the sills and wheel arches; dust and grime settled on the hood, roof and trunk. */
const dirt: VertexTint = (c, _x, y, _z, _nx, ny) => {
  const t = Math.min(1, Math.max(0, (0.8 - y) / 0.6));
  c.lerp(MUD, t * t * (3 - 2 * t) * 0.75);
  if (ny > 0.55) c.lerp(DUST, 0.38 * ny);
};

const _m = new Matrix4();
const _local = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

/**
 * Abandoned 90s sedan, ~1.4k triangles, built from logical parts that go into the static batch
 * under their own surfaces: rusted paint, dirty rubber, murky cracked glass, old chrome, dead lamps.
 */
export function buildCar(batch: StaticBatch, world: ColliderSink, o: CarOptions, containers?: ContainerSpot[]): void {
  const rand = mulberry32(o.seed ?? 1);
  const roll = o.flatTire ? -0.022 : 0;
  const pitch = o.flatTire ? -0.012 : 0;
  let id = o.glbId ?? pickWorldVehicle(o.kind, rand(), o.smashed ?? 0);
  if (!o.glbId && !o.kind) {
    const tooClose = (cand: GlbModelId) =>
      batch.glbs.some((g) => g.id === cand && (g.x - o.x) * (g.x - o.x) + (g.z - o.z) * (g.z - o.z) < 1600);
    if (tooClose(id)) {
      const start = Math.floor(rand() * CIVILIAN_FALLBACK_POOL.length);
      for (let k = 0; k < CIVILIAN_FALLBACK_POOL.length; k++) {
        const cand = CIVILIAN_FALLBACK_POOL[(start + k) % CIVILIAN_FALLBACK_POOL.length];
        if (!tooClose(cand)) {
          id = cand;
          break;
        }
      }
    }
  }
  const spec = GLB_WORLD_SPECS[id];
  if (spec) {
    // World GLBs face -Z at yaw 0; rotating by (o.yaw - PI/2) points nose along +X at o.yaw = 0.
    batch.glbs.push({
      id,
      x: o.x,
      y: 0.01,
      z: o.z,
      yaw: o.yaw - Math.PI / 2,
      roll,
      pitch,
    });
    // spec.size = [widthX, heightY, lengthZ]
    const W = spec.size[0];
    const H = spec.size[1];
    const L = spec.size[2];
    const hx = L * 0.5 + 0.02;
    const hz = W * 0.48;
    const hoodH = Math.max(0.95, H * 0.62);
    world.addOrientedBox(o.x, o.z, hx, hz, o.yaw, -0.5, hoodH);
    world.addOrientedBox(o.x, o.z, hx * 0.68, hz * 0.92, o.yaw, hoodH, Math.max(1.58, H + 0.12));

    if (containers) {
      const pickup = id === 'emercom_pickup_17k';
      const tall =
        id === 'UAZ_Bukhanka_22k' ||
        id === 'omon_swat_van_17k' ||
        id === 'gazelle_ambulance_17k' ||
        id === 'Kamaz_6x6_25k' ||
        id === 'paz_3205_bus_11000' ||
        id === 'kamaz_fire_truck_20k' ||
        id === 'Semi_Truck_Tractor_24' ||
        id === 'Semi_Trailer_Cargo_20';
      const depth = pickup ? Math.min(1.9, L * 0.36) : tall ? 0.5 : Math.min(0.95, L * 0.22);
      const y0 = pickup ? 0.45 : 0.3;
      const y1 = pickup ? Math.min(1.15, H * 0.55) : tall ? Math.min(2.15, H * 0.85) : Math.min(1.2, H * 0.72);
      const offset = -L * 0.5 + depth * 0.5 - 0.05;
      const cx = o.x + Math.cos(o.yaw) * offset;
      const cz = o.z - Math.sin(o.yaw) * offset;
      containers.push({
        type: 'trunk',
        x: cx,
        z: cz,
        box: [cx, (y0 + y1) * 0.5, cz, depth * 0.5 + 0.06, (y1 - y0) * 0.5, W * 0.5 - 0.14, o.yaw],
      });
    }
    return;
  }

  // Fallback procedural sedan only if spec lookup ever failed (all 40 GLBs are always in GLB_WORLD_SPECS).
  const car = new Matrix4()
    .makeTranslation(o.x, 0.01, o.z)
    .multiply(new Matrix4().makeRotationY(o.yaw))
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(roll, 0, pitch)));

  const add = (g: BufferGeometry, color: number, surface: Surface, local?: Matrix4) => {
    _m.copy(car);
    if (local) _m.multiply(local);
    batch.add(g, color, _m, surface, dirt);
  };
  const box = new BoxGeometry(1, 1, 1);
  /** Box by local min/max corners. */
  const block = (color: number, surface: Surface, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    _p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    _s.set(x1 - x0, y1 - y0, z1 - z0);
    add(box, color, surface, _local.compose(_p, _q.identity(), _s));
  };
  const geos: BufferGeometry[] = [box];

  // Body: three extruded sections with panel gaps.
  for (const key of ['front', 'doors', 'rear'] as const) {
    const shape = new Shape(PROFILES[key].map(([x, y]) => new Vector2(x, y)));
    const depth = WIDTH - 2 * BEVEL;
    const g = new ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 1,
      curveSegments: 1,
    });
    g.translate(0, 0, -depth / 2);
    geos.push(g);
    add(g, o.paint, 'carPaint');
  }
  // Seam between front and rear doors, both sides (the other seams are real gaps between sections).
  for (const side of [1, -1]) {
    const z0 = side > 0 ? WIDTH / 2 : -WIDTH / 2 - 0.004;
    block(0x141312, 'rubber', -0.13, SILL + 0.04, z0, -0.115, 0.93, z0 + 0.004);
  }

  // Cabin: pillars and roof in paint, panes in glass — one bilinear grid per face.
  const cab = buildCabin(o.smashed ?? 0, rand);
  geos.push(cab.paint, cab.glass);
  add(cab.paint, o.paint, 'carPaint');
  add(cab.glass, 0x2a3036, 'carGlass');

  // Interior silhouettes seen through the murky glass: dashboard, front seats, rear bench, wheel.
  const fabric = 0x2a2826;
  block(0x1e1d1c, 'rubber', 0.3, 0.95, -0.76, 0.62, 1.1, 0.76);
  for (const side of [1, -1]) {
    const z0 = side > 0 ? 0.12 : -0.68;
    block(fabric, 'rubber', -0.3, 0.95, z0, 0.15, 1.04, z0 + 0.56);
    block(fabric, 'rubber', -0.36, 0.95, z0 + 0.03, -0.24, 1.42, z0 + 0.53);
  }
  block(fabric, 'rubber', -1.12, 0.95, -0.72, -1.0, 1.32, 0.72);
  const steer = new CylinderGeometry(0.17, 0.17, 0.035, 10);
  geos.push(steer);
  add(steer, 0x151515, 'rubber', _local.compose(_p.set(0.36, 1.17, 0.38), _q.setFromEuler(new Euler(0, 0, 1.15)), _s.set(1, 1, 1)));

  // Bumpers (old chrome/plastic), grille, plates, lamps (dead; one headlight smashed).
  block(0x8a8780, 'trim', 2.27, 0.27, -0.9, 2.42, 0.45, 0.9);
  block(0x8a8780, 'trim', -2.44, 0.27, -0.9, -2.28, 0.45, 0.9);
  block(0x161616, 'trim', 2.3, 0.5, -0.42, 2.335, 0.66, 0.42);
  block(0x9a9784, 'trim', 2.42, 0.3, -0.24, 2.435, 0.42, 0.24);
  block(0x9a9784, 'trim', -2.455, 0.3, -0.24, -2.44, 0.42, 0.24);
  const smashed = rand() < 0.5 ? 1 : -1;
  for (const side of [1, -1]) {
    const z0 = side > 0 ? 0.5 : -0.8;
    if (side === smashed) {
      // Broken headlight: dark empty socket with a few shards left in the frame.
      block(0x0c0c0c, 'lamp', 2.29, 0.52, z0, 2.31, 0.66, z0 + 0.3);
      block(0xb4b4aa, 'lamp', 2.3, 0.52, z0, 2.335, 0.57, z0 + 0.12);
      block(0xb4b4aa, 'lamp', 2.3, 0.61, z0 + 0.2, 2.335, 0.66, z0 + 0.3);
    } else {
      block(0xb8b8ae, 'lamp', 2.3, 0.52, z0, 2.34, 0.66, z0 + 0.3);
    }
    const t0 = side > 0 ? 0.52 : -0.84;
    block(0x4a1212, 'lamp', -2.345, 0.6, t0, -2.3, 0.8, t0 + 0.32);
    // Side mirrors at the A-pillar base.
    block(o.paint, 'carPaint', 0.46, 0.98, side > 0 ? WIDTH / 2 + 0.01 : -WIDTH / 2 - 0.13, 0.58, 1.08, side > 0 ? WIDTH / 2 + 0.13 : -WIDTH / 2 - 0.01);
  }

  // Wheels sit inside the arches; hubcaps outside, one missing; optional flat.
  const tire = new CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 10);
  tire.rotateX(Math.PI / 2);
  const hub = new CylinderGeometry(0.17, 0.17, 0.03, 8);
  hub.rotateX(Math.PI / 2);
  geos.push(tire, hub);
  const zWheel = WIDTH / 2 - WHEEL_W / 2 - 0.03;
  const missingHub = Math.floor(rand() * 4);
  let i = 0;
  for (const ax of [AXLE_F, AXLE_R]) {
    for (const side of [1, -1]) {
      const flat = o.flatTire && ax === AXLE_R && side === -1;
      const y = flat ? WHEEL_R - 0.07 : WHEEL_R;
      _s.set(flat ? 1.08 : 1, flat ? 0.78 : 1, 1);
      add(tire, 0x1c1b1a, 'rubber', _local.compose(_p.set(ax, y, side * zWheel), _q.identity(), _s));
      const hubColor = i === missingHub ? 0x3a2e24 : 0x7e7b74;
      add(hub, hubColor, 'trim', _local.compose(_p.set(ax, y, side * (zWheel + WHEEL_W / 2 + 0.012)), _q.identity(), _s.set(1, 1, 1)));
      i++;
    }
  }

  // Soft contact shadow under the car: baked into the chunk's decal batch (zero extra draw calls).
  batch.addShadow(car, LENGTH * 1.12, WIDTH * 1.24, 0.025);

  for (const g of geos) g.dispose();

  // Searchable trunk: the lid and the rear bumper.
  if (containers) {
    const t = new Vector3(-1.95, 0.68, 0).applyMatrix4(car);
    containers.push({ type: 'trunk', x: t.x, z: t.z, box: [t.x, t.y, t.z, 0.45, 0.36, WIDTH / 2 - 0.08, o.yaw] });
  }

  // Full footprint + tall cabin so player cannot clip into trunk and bandits cannot shoot through cars.
  world.addOrientedBox(o.x, o.z, BODY_HALF_LENGTH + 0.04, WIDTH * 0.48, o.yaw, -0.5, 0.96);
  world.addOrientedBox(o.x, o.z, BODY_HALF_LENGTH * 0.66, WIDTH * 0.44, o.yaw, 0.96, 1.58);
}

/** A model into the batch: vehicle metal by default, slightly rough; its glass as murky translucent car glass. */
export function placeModel(batch: StaticBatch, m: ModelInfo, matrix: Matrix4, paint: Color | null, tint?: VertexTint, roughness = 0.75, metalness = 0.25): void {
  batch.addModel(modelGeometry(library!, m), m.layer, matrix, paint, roughness, metalness, tint, modelLod1Indices(library!, m));
  const glass = modelGlass(library!, m);
  if (glass) batch.add(glass, 0x2a3036, matrix, 'carGlass');
  if (m.size[0] > 0.25 && m.size[2] > 0.25) {
    batch.addShadow(matrix, m.size[0] * 1.14, m.size[2] * 1.22, 0.025, m.min[0] + m.size[0] / 2, m.min[2] + m.size[2] / 2);
  }
}

/** Greenhouse faces split into a grid of cells; inner cells are glass, the frame is painted pillars. */
function buildCabin(smashed: number, rand: () => number): { paint: BufferGeometry; glass: BufferGeometry } {
  const C = CABIN;
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const fl = v(C.baseFront, C.baseY, C.baseHalf);
  const fr = v(C.baseFront, C.baseY, -C.baseHalf);
  const rl = v(C.baseRear, C.baseY + 0.01, C.baseHalf);
  const rr = v(C.baseRear, C.baseY + 0.01, -C.baseHalf);
  const tfl = v(C.roofFront, C.roofY, C.roofHalf);
  const tfr = v(C.roofFront, C.roofY, -C.roofHalf);
  const trl = v(C.roofRear, C.roofY, C.roofHalf);
  const trr = v(C.roofRear, C.roofY, -C.roofHalf);
  const inside = v(-0.3, 1.15, 0);

  const paint: number[] = [];
  const glass: number[] = [];
  // Corners: p00 = u0,v0 … ; u runs across the face, v from bottom to top.
  const face = (p00: Vector3, p10: Vector3, p01: Vector3, p11: Vector3, us: number[], vs: number[], isGlass: (ui: number, vi: number) => boolean) => {
    const at = (u: number, w: number) => {
      const bottom = p00.clone().lerp(p10, u);
      const top = p01.clone().lerp(p11, u);
      return bottom.lerp(top, w);
    };
    for (let ui = 0; ui < us.length - 1; ui++) {
      for (let vi = 0; vi < vs.length - 1; vi++) {
        const a = at(us[ui], vs[vi]);
        const b = at(us[ui + 1], vs[vi]);
        const c = at(us[ui + 1], vs[vi + 1]);
        const d = at(us[ui], vs[vi + 1]);
        if (isGlass(ui, vi) && rand() < smashed) {
          // Smashed pane: the frame keeps a few jagged teeth of glass along its bottom edge.
          for (let t = 0; t < 4; t++) {
            const b0 = a.clone().lerp(b, t / 4);
            const b1 = a.clone().lerp(b, (t + 1) / 4);
            const tip = b0.clone().lerp(b1, 0.5).lerp(d.clone().lerp(c, (t + 0.5) / 4), 0.12 + rand() * 0.28);
            tri(glass, b0, b1, tip, inside);
          }
          continue;
        }
        quad(isGlass(ui, vi) ? glass : paint, a, b, c, d, inside);
      }
    }
  };

  // Sides: C-pillar | rear window | B-pillar | front window | A-pillar; sill strip and roof rail.
  const sideU = [0, 0.13, 0.5, 0.56, 0.93, 1];
  const sideV = [0, 0.07, 0.93, 1];
  const sideGlass = (ui: number, vi: number) => vi === 1 && (ui === 1 || ui === 3);
  face(rl, fl, trl, tfl, sideU, sideV, sideGlass);
  face(rr, fr, trr, tfr, sideU, sideV, sideGlass);
  // Windshield and rear window with a thin painted frame.
  const frameU = [0, 0.04, 0.96, 1];
  const frameV = [0, 0.05, 0.95, 1];
  const centerGlass = (ui: number, vi: number) => ui === 1 && vi === 1;
  face(fr, fl, tfr, tfl, frameU, frameV, centerGlass);
  face(rl, rr, trl, trr, frameU, frameV, centerGlass);
  // Roof panel.
  face(trl, trr, tfl, tfr, [0, 1], [0, 1], () => false);

  return { paint: geometry(paint), glass: geometry(glass) };
}

/** One triangle, double-sided (thin glass teeth are seen from both sides). */
function tri(out: number[], a: Vector3, b: Vector3, c: Vector3, _inside: Vector3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
}

/** Two triangles, wound so the face points away from `inside`. */
function quad(out: number[], a: Vector3, b: Vector3, c: Vector3, d: Vector3, inside: Vector3): void {
  const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
  const center = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
  const flip = n.dot(center.sub(inside)) < 0;
  const tri = (p: Vector3, q: Vector3, r: Vector3) => out.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  if (flip) {
    tri(a, c, b);
    tri(a, d, c);
  } else {
    tri(a, b, c);
    tri(a, c, d);
  }
}

function geometry(positions: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}
