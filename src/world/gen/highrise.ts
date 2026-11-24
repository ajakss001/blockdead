import { type BufferGeometry, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/random';
import { FACADE_BAY, FACADE_WINDOW, type Surface } from '../../render/look/surfaces';
import { SHOP_KINDS, SHOP_SIGN, type ShopKind } from './furniture';
import { hash3 } from './noise';
import { type Builder, PAL, pick, type Rand } from './pieces';

/**
 * Downtown high-rises (5–25 storeys), authored in a local frame with the entrance on the −Z side
 * and the stair core in the back-left corner; buildings facing +Z are rotated 180° about their center.
 *
 * Two halves:
 * - the shell (facades, roof, head-house, storefront, rooftop clutter) is part of the chunk, always;
 * - the interior (slabs, stair core, corridors, units, doors, furniture, containers) is streamed in by
 *   the worker only when the player approaches, and dropped when they leave.
 * The walkable surface (floors, flights, landings, roof) is analytic, so the player can stand on it
 * whether or not the interior meshes have arrived yet.
 */

export const FLOOR_H = 3.2;
export const WALL = 0.3;
export const CORE_W = 3.2;
const CORE_D = 5.4;
/** Floor-level landing at the corridor side of the core. */
export const NEAR = 1.1;
/** Horizontal run of one flight (10 steps × 0.3 m), rising half a storey. */
export const RUN = 3.0;
export const FLIGHT_W = 1.4;
export const STEPS = 10;
export const CORRIDOR = 1.8;
export const DOOR_W = 1.0;
export const ENTRANCE_W = 2.2;
const ENTRANCE_H = 2.6;

export type FacadeSurface = 'facadeConcrete' | 'facadeBrick' | 'facadeOffice';

export interface BuildingDesc {
  /** Unique world-wide (chunk key × 16 + n). */
  id: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  floors: number;
  facade: FacadeSurface;
  /** true → entrance faces +Z (rotated 180°). */
  flip: boolean;
  kind: 'apartments' | 'offices';
  seed: number;
}

export interface Local {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  ix0: number;
  iz0: number;
  ix1: number;
  iz1: number;
  /** Stair core. */
  cx0: number;
  cz0: number;
  cx1: number;
  cz1: number;
  /** Corridor z-range (front edge, back edge = core near side). */
  czA: number;
  doorX: number;
}

export function local(b: BuildingDesc): Local {
  const x0 = b.cx - b.w / 2;
  const z0 = b.cz - b.d / 2;
  const x1 = x0 + b.w;
  const z1 = z0 + b.d;
  const ix0 = x0 + WALL;
  const iz0 = z0 + WALL;
  const ix1 = x1 - WALL;
  const iz1 = z1 - WALL;
  const cz0 = iz1 - CORE_D;
  return { x0, z0, x1, z1, ix0, iz0, ix1, iz1, cx0: ix0, cz0, cx1: ix0 + CORE_W, cz1: iz1, czA: cz0 - CORRIDOR, doorX: b.cx + b.w * 0.15 };
}

/** Local X of the window centers on the front and back facades (the grid windowPanes uses). */
export function windowXs(desc: BuildingDesc): number[] {
  const spec = desc.kind === 'offices' ? FACADE_WINDOW.offices : FACADE_WINDOW.apartments;
  const x0 = desc.cx - desc.w / 2;
  const x1 = x0 + desc.w;
  const out: number[] = [];
  for (let u = Math.ceil(x0 / FACADE_BAY) * FACADE_BAY; u + FACADE_BAY <= x1 + 1e-6; u += FACADE_BAY) {
    const c = u + spec.inset + spec.width / 2;
    out.push(desc.flip ? 2 * desc.cx - c : c);
  }
  return out;
}

/** Local Z of the window centers on the two side walls. */
export function windowZs(desc: BuildingDesc): number[] {
  const spec = desc.kind === 'offices' ? FACADE_WINDOW.offices : FACADE_WINDOW.apartments;
  const z0 = desc.cz - desc.d / 2;
  const z1 = z0 + desc.d;
  const out: number[] = [];
  for (let u = Math.ceil(z0 / FACADE_BAY) * FACADE_BAY; u + FACADE_BAY <= z1 + 1e-6; u += FACADE_BAY) {
    const c = u + spec.inset + spec.width / 2;
    out.push(desc.flip ? 2 * desc.cz - c : c);
  }
  return out;
}

/** Unit spans of a storey (the split the interior builds): the front row along the street, the back row by the stairs. */
export function unitSpans(L: Local, back: boolean): { x0: number; x1: number; z0: number; z1: number }[] {
  const x0 = back ? L.cx1 + 0.15 : L.ix0;
  const width = L.ix1 - x0;
  if (back && width < 4) return [];
  const n = Math.max(back ? 1 : 2, Math.floor(width / 6.5));
  const uw = width / n;
  return Array.from({ length: n }, (_, u) => ({ x0: x0 + u * uw, x1: x0 + (u + 1) * uw, z0: back ? L.cz0 : L.iz0, z1: back ? L.iz1 : L.czA }));
}

/**
 * A lit apartment or office (a generator, the last of the power): rare — a third of the apartment
 * towers have one, a few two, offices seldom. The light lives in the unit: the facade lights all its
 * windows, the interior hangs the lamp and lights the room. `mode` 1 flickers.
 */
export interface LitUnit {
  k: number;
  back: boolean;
  u: number;
  mode: number;
  /** Id shared by the facade windows and the room (exact in a float32). */
  tag: number;
}

export function litUnits(desc: BuildingDesc): LitUnit[] {
  if (desc.floors < 3) return [];
  const r = mulberry32(hash3(desc.seed, 9, 606));
  const roll = r();
  const count = desc.kind === 'offices' ? (roll < 0.15 ? 1 : 0) : roll < 0.3 ? 1 : roll < 0.4 ? 2 : 0;
  const L = local(desc);
  const out: LitUnit[] = [];
  for (let n = 0; n < count; n++) {
    const k = 2 + Math.floor(r() * (desc.floors - 2));
    const back = r() < 0.4;
    const spans = unitSpans(L, back);
    const u = Math.floor(r() * Math.max(1, spans.length));
    const mode = r() < 0.35 ? 1 : 0;
    if (!spans.length || out.some((o) => o.k === k && o.back === back && o.u === u)) continue;
    out.push({ k, back, u, mode, tag: (desc.seed % 40000) * 200 + k * 8 + (back ? 4 : 0) + Math.min(u, 3) + 1 });
  }
  return out;
}

/** Street-level shop left of the lobby (local x from the side wall to x1), if the frontage allows one. */
export interface GroundShop {
  kind: ShopKind;
  x1: number;
}

export function groundShop(desc: BuildingDesc): GroundShop | null {
  const L = local(desc);
  const x1 = L.doorX - ENTRANCE_W / 2 - 1.4;
  if (x1 - L.ix0 < 4.5) return null;
  const r = mulberry32(hash3(desc.seed, 0, 404));
  return { kind: SHOP_KINDS[Math.floor(r() * SHOP_KINDS.length)], x1 };
}

/** On the stair flights / landings of the core (footsteps: concrete, steel in office towers). */
export function inStairCore(b: BuildingDesc, wx: number, wz: number): boolean {
  const [x, z] = toLocal(b, wx, wz);
  const L = local(b);
  return x >= L.cx0 && x <= L.cx1 && z >= L.cz0 + NEAR && z <= L.cz1;
}

/** World → building-local (undo the 180° rotation). */
function toLocal(b: BuildingDesc, x: number, z: number): [number, number] {
  return b.flip ? [2 * b.cx - x, 2 * b.cz - z] : [x, z];
}

export function insideFootprint(b: BuildingDesc, x: number, z: number, margin = 0): boolean {
  return Math.abs(x - b.cx) <= b.w / 2 + margin && Math.abs(z - b.cz) <= b.d / 2 + margin;
}

/**
 * Height of the surface the player stands on: the highest floor, landing or flight point that is
 * at most a step above their feet. Storeys are FLOOR_H apart; the roof is level `floors`.
 */
export function highriseSurfaceY(b: BuildingDesc, wx: number, wz: number, y: number): number | null {
  const [x, z] = toLocal(b, wx, wz);
  const L = local(b);
  const reach = y + 0.55;
  const kc = Math.max(0, Math.min(b.floors, Math.round(y / FLOOR_H)));
  let best = -Infinity;
  let lowest = Infinity;
  const consider = (h: number) => {
    lowest = Math.min(lowest, h);
    if (h <= reach && h > best) best = h;
  };
  const inCore = x >= L.cx0 && x <= L.cx1 && z >= L.cz0 && z <= L.cz1;
  // Exterior fire escape along the back wall (L.z1 .. L.z1 + 1.4).
  const feX0 = (L.x0 + L.x1) / 2 - 3.0;
  const feX1 = feX0 + 6.0;
  if (b.floors >= 2 && x >= feX0 - 0.05 && x <= feX1 + 0.05 && z >= L.z1 - 0.15 && z <= L.z1 + 1.42) {
    const landW = 1.3;
    const run = feX1 - feX0 - 2 * landW;
    for (let k = Math.max(0, kc - 1); k <= Math.min(b.floors, kc + 1); k++) {
      if (k === b.floors) {
        const oddTop = b.floors % 2 === 1;
        if ((oddTop && x >= feX1 - landW - 0.1) || (!oddTop && x <= feX0 + landW + 0.1)) {
          consider(b.floors * FLOOR_H);
        }
        continue;
      }
      const y0 = k * FLOOR_H;
      if (k % 2 === 0) {
        if (x <= feX0 + landW) consider(y0);
        else if (x >= feX1 - landW) consider(y0 + FLOOR_H);
        else consider(y0 + ((x - (feX0 + landW)) / run) * FLOOR_H);
      } else {
        if (x >= feX1 - landW) consider(y0);
        else if (x <= feX0 + landW) consider(y0 + FLOOR_H);
        else consider(y0 + ((feX1 - landW - x) / run) * FLOOR_H);
      }
    }
    return best > -Infinity ? best : null;
  }
  // Outside the building footprint (and off the fire escape): never return phantom elevated floors.
  if (x < L.x0 || x > L.x1 || z < L.z0 || z > L.z1) return null;
  const inInterior = x >= L.ix0 - 0.05 && x <= L.ix1 + 0.05 && z >= L.iz0 - 0.05 && z <= L.iz1 + 0.05;
  for (let k = Math.max(0, kc - 1); k <= Math.min(b.floors, kc + 1); k++) {
    const yk = k * FLOOR_H;
    // Upper floor slabs end strictly inside the facade walls so nothing protrudes past the exterior face.
    if (k >= 1 && k < b.floors && !inInterior) continue;
    if (!inCore) {
      consider(yk);
      continue;
    }
    const zf0 = L.cz0 + NEAR;
    if (z < zf0) {
      consider(yk);
      continue;
    }
    if (k >= b.floors) continue; // no flights above the roof
    if (z >= zf0 + RUN) {
      consider(yk + FLOOR_H / 2);
    } else if (x < L.cx0 + FLIGHT_W) {
      consider(yk + ((z - zf0) / RUN) * (FLOOR_H / 2));
    } else if (x > L.cx1 - FLIGHT_W) {
      consider(yk + FLOOR_H / 2 + ((zf0 + RUN - z) / RUN) * (FLOOR_H / 2));
    }
  }
  return best > -Infinity ? best : lowest === Infinity ? null : lowest;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _yAxis = new Vector3(0, 1, 0);

/** Decal quad lying on the ground (or a slab), random rotation. */
export function groundDecal(b: Builder, surface: Surface, x: number, y: number, z: number, size: number, rand: Rand, stretch = 1): void {
  if (surface === 'decalShards') b.life(4, x, y, z, 0, 0, size * Math.max(1, stretch) * 0.5, 0, 0);
  const g = new PlaneGeometry(size * stretch, size);
  g.rotateX(-Math.PI / 2);
  g.rotateY(rand() * Math.PI * 2);
  b.geo(g, 0xffffff, _m.compose(_p.set(x, y + 0.03, z), _q.identity(), _s.set(1, 1, 1)), surface);
  g.dispose();
}

/** Decal on a wall facing −Z (in the current frame), e.g. bullet holes. */
export function wallDecalZ(b: Builder, surface: Surface, x: number, y: number, z: number, size: number, facing: 1 | -1): void {
  const g = new PlaneGeometry(size, size);
  if (facing < 0) g.rotateY(Math.PI);
  b.geo(g, 0xffffff, _m.compose(_p.set(x, y, z + facing * 0.02), _q.identity(), _s.set(1, 1, 1)), surface);
  g.dispose();
}

/** Shell: facades, roof with parapet and stair head-house, storefront at street level, rooftop clutter. */
export function buildHighriseShell(b: Builder, desc: BuildingDesc, rand: Rand): void {
  b.shelter(desc.cx - desc.w / 2, desc.cz - desc.d / 2, desc.cx + desc.w / 2, desc.cz + desc.d / 2, desc.floors * FLOOR_H);
  if (desc.flip) b.beginFlip(desc.cx, desc.cz);
  const L = local(desc);
  const H = desc.floors * FLOOR_H;
  const top = H + 1.1; // parapet
  const f = desc.facade;
  const tint = pick(rand, [0xd0ccc4, 0xc4c0b6, 0xbab4aa, 0xd4d0ca, 0xc29e86, 0x9aa6ac, 0xa8b2a2, 0x8e8c88, 0xd8c8ae]);

  // Street level is planned first: the ground-floor front wall is built around its real openings.
  const d0 = L.doorX - ENTRANCE_W / 2;
  const d1 = L.doorX + ENTRANCE_W / 2;
  const panes: { x: number; w: number; broken: boolean }[] = [];
  for (const [a, c] of [
    [L.x0 + 0.6, d0 - 0.4],
    [d1 + 0.4, L.x1 - 0.6],
  ] as const) {
    for (let x = a; x < c - 1; x += 3) panes.push({ x, w: Math.min(2.8, c - x), broken: rand() < 0.4 });
  }
  const roll = rand();
  const entrance: 'doors' | 'smashed' = roll < 0.7 ? 'doors' : 'smashed';

  // Front wall: storeys 1+ in one slab; the ground floor in segments between the openings
  // (entrance: full height to the lintel; smashed shop windows: over a low sill you can step across).
  b.blockY(tint, L.x0, FLOOR_H, L.z0, L.x1 - L.x0, top - FLOOR_H, WALL, f);
  const openings = [{ x0: d0, x1: d1, sill: 0, head: ENTRANCE_H }, ...panes.filter((p) => p.broken).map((p) => ({ x0: p.x, x1: p.x + p.w, sill: 0.3, head: 2.9 }))].sort((a, c) => a.x0 - c.x0);
  let wx = L.x0;
  for (const o of openings) {
    if (o.x0 - wx > 0.01) b.block(tint, wx, 0, L.z0, o.x0 - wx, FLOOR_H, WALL, f, true);
    b.blockY(tint, o.x0, o.head, L.z0, o.x1 - o.x0, FLOOR_H - o.head, WALL, f);
    if (o.sill > 0) b.block(tint, o.x0, 0, L.z0, o.x1 - o.x0, o.sill, WALL, f);
    wx = o.x1;
  }
  if (L.x1 - wx > 0.01) b.block(tint, wx, 0, L.z0, L.x1 - wx, FLOOR_H, WALL, f, true);
  // Back wall up to roof, plus parapet with a doorway gap for the exterior fire escape.
  const feX0 = (L.x0 + L.x1) / 2 - 3.0;
  const feX1 = feX0 + 6.0;
  const feLandW = 1.3;
  if (desc.floors >= 2) {
    b.block(tint, L.x0, 0, L.z1 - WALL, L.x1 - L.x0, H, WALL, f, true);
    const gap0 = desc.floors % 2 === 1 ? feX1 - feLandW : feX0;
    const gap1 = gap0 + feLandW;
    if (gap0 > L.x0 + 0.05) b.block(tint, L.x0, H, L.z1 - WALL, gap0 - L.x0, top - H, WALL, f, true);
    if (L.x1 > gap1 + 0.05) b.block(tint, gap1, H, L.z1 - WALL, L.x1 - gap1, top - H, WALL, f, true);
    // Exterior working fire escape (ground to roof) along L.z1.
    const feSteel = 0x34383d;
    const feZ0 = L.z1;
    const feD = 1.4;
    const run = feX1 - feX0 - 2 * feLandW;
    const steps = 10;
    const stepW = run / steps;
    const stepH = FLOOR_H / steps;
    for (const px of [feX0 + 0.04, feX1 - 0.12]) {
      for (const pz of [feZ0 + 0.04, feZ0 + feD - 0.12]) {
        b.block(feSteel, px, 0, pz, 0.08, H + 1.0, 0.08, 'metal');
      }
    }
    b.block(feSteel, feX0, 0.01, feZ0, feLandW, 0.04, feD, 'metal');
    for (let k = 0; k < desc.floors; k++) {
      const y0 = k * FLOOR_H;
      const even = k % 2 === 0;
      for (let s = 0; s < steps; s++) {
        const sx = even ? feX0 + feLandW + s * stepW : feX1 - feLandW - (s + 1) * stepW;
        b.block(feSteel, sx, y0 + (s + 1) * stepH - 0.06, feZ0 + 0.12, stepW + 0.02, 0.06, feD - 0.24, 'metal');
      }
      const lx = even ? feX1 - feLandW : feX0;
      const ly = (k + 1) * FLOOR_H;
      b.block(feSteel, lx, ly - 0.08, feZ0, feLandW, 0.08, feD, 'metal');
      // Outer safety rails on landing.
      b.block(feSteel, lx, ly + 0.88, feZ0 + feD - 0.05, feLandW, 0.05, 0.05, 'metal');
      b.block(feSteel, even ? feX1 - 0.05 : feX0, ly + 0.88, feZ0, 0.05, 0.05, feD, 'metal');
    }
  } else {
    b.block(tint, L.x0, 0, L.z1 - WALL, L.x1 - L.x0, top, WALL, f, true);
  }
  b.block(tint, L.x0, 0, L.z0 + WALL, WALL, top, L.z1 - L.z0 - 2 * WALL, f, true);
  b.block(tint, L.x1 - WALL, 0, L.z0 + WALL, WALL, top, L.z1 - L.z0 - 2 * WALL, f, true);

  // Roof slab with the stair opening, and the head-house over the core.
  const roofY = H - 0.2;
  b.block(0x6a6862, L.ix0, roofY, L.iz0, L.ix1 - L.ix0, 0.2, L.cz0 + NEAR - L.iz0, 'concrete', true);
  b.block(0x6a6862, L.cx1, roofY, L.cz0 + NEAR, L.ix1 - L.cx1, 0.2, L.iz1 - L.cz0 - NEAR, 'concrete', true);
  const hh = 2.6;
  b.blockY(0x77756e, L.cx1, H, L.cz0, 0.15, hh, L.cz1 - L.cz0, 'concrete');
  b.blockY(0x77756e, L.cx0, H, L.cz0 - 0.15, 0.6, hh, 0.15, 'concrete');
  b.blockY(0x77756e, L.cx0 + 1.6, H, L.cz0 - 0.15, L.cx1 - L.cx0 - 1.45, hh, 0.15, 'concrete');
  // The facades stop at the parapet; close the head-house on the outer sides up to its roof.
  b.blockY(0x77756e, L.x0, top, L.cz0, WALL, H + hh - top, L.z1 - L.cz0, 'concrete');
  b.blockY(0x77756e, L.x0, top, L.z1 - WALL, L.cx1 - L.x0 + 0.15, H + hh - top, WALL, 'concrete');
  b.block(0x5a5852, L.cx0 - 0.1, H + hh, L.cz0 - 0.2, L.cx1 - L.cx0 + 0.35, 0.15, L.cz1 - L.cz0 + 0.25, 'concrete', true);

  // Street level: shop windows (intact glass in front of the wall, or a smashed opening), the entrance, canopy.
  for (const { x, w: pw, broken } of panes) {
    // Frame: four bars round the pane.
    b.block(PAL.trim, x - 0.08, 0.3, L.z0 - 0.06, 0.08, 2.6, 0.06, 'metal');
    b.block(PAL.trim, x + pw, 0.3, L.z0 - 0.06, 0.08, 2.6, 0.06, 'metal');
    b.block(PAL.trim, x, 2.8, L.z0 - 0.06, pw, 0.1, 0.06, 'metal');
    if (broken) {
      groundDecal(b, 'decalShards', x + pw / 2, 0, L.z0 - 1.0, 1.8, rand, 1.4);
      groundDecal(b, 'decalShards', x + pw / 2, 0, L.z0 + 1.0, 1.6, rand, 1.2);
    } else {
      b.block(PAL.trim, x, 0.3, L.z0 - 0.06, pw, 0.15, 0.06, 'metal');
      b.block(PAL.window, x, 0.45, L.z0 - 0.08, pw, 2.35, 0.03, 'windowGlass');
    }
  }
  if (entrance === 'doors') {
    // Double doors swinging in; glass on office towers, wood or glass on apartments; sometimes left open.
    const style = desc.kind === 'offices' || rand() < 0.4 ? 'glass' : 'wood';
    const open = rand() < 0.25;
    const half = ENTRANCE_W / 2;
    b.door(d0, L.z0 + WALL / 2, 0, 0, -1, false, { width: half, height: ENTRANCE_H, style, open, pair: 1 });
    b.door(d1, L.z0 + WALL / 2, 0, Math.PI, 1, false, { width: half, height: ENTRANCE_H, style, open, pair: -1 });
    b.block(PAL.window, d0, 2.15, L.z0 + 0.1, ENTRANCE_W, ENTRANCE_H - 2.15, 0.03, 'windowGlass');
  } else {
    // The doors are gone: glass on the ground, an open way in.
    groundDecal(b, 'decalShards', L.doorX, 0, L.z0 - 0.8, 2.2, rand, 1.3);
    groundDecal(b, 'decalShards', L.doorX, 0, L.z0 + 1.2, 2.0, rand, 1.3);
  }
  b.block(PAL.trim, d0 - 0.12, 0, L.z0 - 0.08, 0.12, ENTRANCE_H + 0.12, 0.08, 'metal');
  b.block(PAL.trim, d1, 0, L.z0 - 0.08, 0.12, ENTRANCE_H + 0.12, 0.08, 'metal');
  b.block(0x2a2c2e, d0 - 0.8, ENTRANCE_H + 0.3, L.z0 - 1.4, ENTRANCE_W + 1.6, 0.12, 1.4, 'metal');
  b.block(0x1c1e20, L.x0 + 1, 3.0, L.z0 - 0.1, desc.w - 2, 0.6, 0.08, 'metal');
  const shop = groundShop(desc);
  if (shop) {
    // The shop's own sign panel (a color per trade, no names); a pale cross for the pharmacy.
    b.block(SHOP_SIGN[shop.kind], L.x0 + 1.2, 3.05, L.z0 - 0.13, shop.x1 - L.x0 - 1.4, 0.5, 0.03, 'metal');
    if (shop.kind === 'pharmacy') {
      const sx = (L.x0 + shop.x1) / 2;
      b.block(0x9ad0a8, sx - 0.06, 3.1, L.z0 - 0.15, 0.12, 0.4, 0.02, 'lamp');
      b.block(0x9ad0a8, sx - 0.2, 3.24, L.z0 - 0.15, 0.4, 0.12, 0.02, 'lamp');
    }
  }
  shellLife(b, desc, L);
  b.endFrame();
}

/**
 * World life on the facade: lit windows (flickering by room). Rendered by WorldLife (one draw call
 * for the whole world).
 */
function shellLife(b: Builder, desc: BuildingDesc, L: Local): void {
  const spec = desc.kind === 'offices' ? FACADE_WINDOW.offices : FACADE_WINDOW.apartments;
  const wins = windowXs(desc);
  if (wins.length === 0 || desc.floors < 3) return;
  // Lit units: every window of the unit, the side ones too on a corner unit.
  const side = windowZs(desc);
  const ww = spec.width * 0.92;
  const wh = (spec.head - spec.sill) * 0.92;
  for (const lu of litUnits(desc)) {
    const span = unitSpans(L, lu.back)[lu.u];
    const y = lu.k * FLOOR_H + (spec.sill + spec.head) / 2;
    for (const x of wins) if (x > span.x0 + 0.3 && x < span.x1 - 0.3) b.life(0, x, y, lu.back ? L.z1 + 0.03 : L.z0 - 0.03, 0, lu.back ? 1 : -1, ww, wh, lu.mode, lu.tag);
    const corner = span.x0 - L.ix0 < 0.5 ? -1 : L.ix1 - span.x1 < 0.5 ? 1 : 0;
    if (corner) for (const z of side) if (z > span.z0 + 0.3 && z < span.z1 - 0.3) b.life(0, corner < 0 ? L.x0 - 0.03 : L.x1 + 0.03, y, z, corner, 0, ww, wh, lu.mode, lu.tag);
  }
}

/**
 * Glass panes in every window opening of the facade grid, all storeys, all four walls, set into the
 * middle of the wall. Where the facade texture shows intact glass the wall is cut open near the
 * player and the pane is what you look through; elsewhere the pane hides inside the wall.
 * Double-sided quads: ~2 triangles a window.
 */
export function windowPanes(b: Builder, desc: BuildingDesc): void {
  const spec = desc.kind === 'offices' ? FACADE_WINDOW.offices : FACADE_WINDOW.apartments;
  const x0 = desc.cx - desc.w / 2;
  const z0 = desc.cz - desc.d / 2;
  const x1 = x0 + desc.w;
  const z1 = z0 + desc.d;
  const h = spec.head - spec.sill;
  const pane = new PlaneGeometry(spec.width, h);
  // Frames: the reveal of every opening, so looking in at an angle never shows a slit through the wall.
  const reveal = revealGeometry(spec.width, h, WALL + 0.02);
  const mid = WALL / 2;
  // The street front's ground floor is shop windows and the entrance: no panes in that wall.
  const front = desc.flip ? z1 - mid : z0 + mid;
  for (let k = 0; k < desc.floors; k++) {
    const y = k * FLOOR_H + spec.sill + h / 2;
    for (let u = Math.ceil(x0 / FACADE_BAY) * FACADE_BAY; u + FACADE_BAY <= x1 + 1e-6; u += FACADE_BAY) {
      const cx = u + spec.inset + spec.width / 2;
      for (const z of [z0 + mid, z1 - mid]) {
        if (k === 0 && z === front) continue;
        _m.compose(_p.set(cx, y, z), _q.identity(), _s.set(1, 1, 1));
        b.geo(pane, 0x6c7a84, _m, 'windowGlass');
        b.geo(reveal, 0x3b3e42, _m, 'metal');
      }
    }
    _q.setFromAxisAngle(_yAxis, Math.PI / 2);
    for (let u = Math.ceil(z0 / FACADE_BAY) * FACADE_BAY; u + FACADE_BAY <= z1 + 1e-6; u += FACADE_BAY) {
      const cz = u + spec.inset + spec.width / 2;
      for (const x of [x0 + mid, x1 - mid]) {
        _m.compose(_p.set(x, y, cz), _q, _s.set(1, 1, 1));
        b.geo(pane, 0x6c7a84, _m, 'windowGlass');
        b.geo(reveal, 0x3b3e42, _m, 'metal');
      }
    }
    _q.identity();
  }
  pane.dispose();
  reveal.dispose();
}

/**
 * The reveal of a window opening: the four inner faces of the hole through the wall (sides, sill, head),
 * facing into the opening, a hair wider than the cut so no slit shows between the wall and the frame.
 * Centred on the pane, `depth` = the wall's thickness plus a little either side (no z-fighting with
 * the wall faces). 8 triangles.
 */
export function revealGeometry(w: number, h: number, depth: number): BufferGeometry {
  const hw = w / 2 + 0.01;
  const hh = h / 2 + 0.01;
  const side = (rotY: number, x: number) => new PlaneGeometry(depth, h + 0.02).rotateY(rotY).translate(x, 0, 0);
  const cap = (rotX: number, y: number) => new PlaneGeometry(w + 0.02, depth).rotateX(rotX).translate(0, y, 0);
  // Normals into the opening: the left jamb faces +X, the right −X, the sill +Y, the head −Y.
  const parts = [side(Math.PI / 2, -hw), side(-Math.PI / 2, hw), cap(-Math.PI / 2, -hh), cap(Math.PI / 2, hh)];
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
}

/**
 * Where to walk next inside / into / out of a high-rise on the way from `from` to `to` (zombies): to the
 * entrance from outside, along the two flights of the stair core between storeys (one landing at a
 * time), out through the lobby. False when the way is straight (same storey, or neither end inside).
 */
export function routeHighrise(b: BuildingDesc, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, out: { set(x: number, y: number, z: number): unknown }): boolean {
  const fromIn = insideFootprint(b, from.x, from.z, -0.05);
  const toIn = insideFootprint(b, to.x, to.z, -0.05);
  if (!fromIn && !toIn) return false;
  const L = local(b);
  const kf = Math.max(0, Math.round(from.y / FLOOR_H));
  const kt = toIn ? Math.max(0, Math.round(to.y / FLOOR_H)) : 0;
  const put = (x: number, z: number, k: number) => {
    const [wx, wz] = toLocal(b, x, z);
    out.set(wx, k * FLOOR_H, wz);
    return true;
  };
  // Into the building: the entrance from outside, then on.
  if (!fromIn) {
    const [lx, lz] = toLocal(b, from.x, from.z);
    return Math.hypot(lx - L.doorX, lz - (L.z0 - 0.8)) > 1.2 ? put(L.doorX, L.z0 - 0.8, 0) : put(L.doorX, L.iz0 + 1.2, 0);
  }
  const target = toIn ? kt : 0;
  if (kf === target) {
    if (toIn) return false;
    // Out through the lobby door.
    const [lx, lz] = toLocal(b, from.x, from.z);
    return Math.hypot(lx - L.doorX, lz - (L.iz0 + 1.2)) > 1 ? put(L.doorX, L.iz0 + 1.2, 0) : put(L.doorX, L.z0 - 0.8, 0);
  }
  const [x, z] = toLocal(b, from.x, from.z);
  const zf0 = L.cz0 + NEAR;
  const left = L.cx0 + FLIGHT_W / 2;
  const right = L.cx1 - FLIGHT_W / 2;
  const mid = zf0 + RUN + 0.5;
  const entry = zf0 - 0.4;
  const inCore = x >= L.cx0 - 0.2 && x <= L.cx1 + 0.2 && z >= zf0 - 0.1 && z <= L.cz1 + 0.2;
  const k = Math.floor(from.y / FLOOR_H + 0.05);
  if (target > kf) {
    if (!inCore) return put(left, entry, kf);
    if (z < zf0 + RUN && x < L.cx0 + FLIGHT_W) return put(left, mid, k);
    if (z >= zf0 + RUN) return x < L.cx1 - FLIGHT_W ? put(right, mid, k) : put(right, entry, k + 1);
    return put(right, entry, k + 1);
  }
  if (!inCore) return put(right, entry, kf);
  if (x > L.cx1 - FLIGHT_W && z < zf0 + RUN) return put(right, mid, k);
  if (z >= zf0 + RUN) return x > L.cx0 + FLIGHT_W ? put(left, mid, k) : put(left, entry, k);
  return put(left, entry, k);
}
