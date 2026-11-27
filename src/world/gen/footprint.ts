import type { StaticBatch } from '../../render/StaticBatch';
import { GLB_WORLD_SPECS, type GlbModelId, type GlbPlacement } from '../worldModels';

const NON_SOLID_OVERLAP: ReadonlySet<GlbModelId> = new Set([
  'speed_bump_1000',
  'Dead_Autumn_Tree_6000',
  'Spruce_Pine_Tree_7000',
  'Urban_Bush_2500',
  'street_lamp_2000',
  'crosswalk_sign_1500',
  'Sign_Bus_Stop_1500',
  'Sign_Give_Way_1500',
  'Sign_Main_Road_1500',
  'Sign_No_Entry_1500',
  'Sign_No_Stopping_1500',
]);

/** 2D Separating Axis Theorem overlap check between two XZ oriented bounding boxes. */
export function obbOverlap(
  ax: number,
  az: number,
  ahx: number,
  ahz: number,
  ayaw: number,
  bx: number,
  bz: number,
  bhx: number,
  bhz: number,
  byaw: number,
): boolean {
  const uAx = Math.cos(ayaw);
  const uAz = -Math.sin(ayaw);
  const vAx = Math.sin(ayaw);
  const vAz = Math.cos(ayaw);

  const uBx = Math.cos(byaw);
  const uBz = -Math.sin(byaw);
  const vBx = Math.sin(byaw);
  const vBz = Math.cos(byaw);

  const dx = bx - ax;
  const dz = bz - az;

  const axes = [
    [uAx, uAz],
    [vAx, vAz],
    [uBx, uBz],
    [vBx, vBz],
  ] as const;

  for (let i = 0; i < 4; i++) {
    const nx = axes[i][0];
    const nz = axes[i][1];
    const dist = Math.abs(dx * nx + dz * nz);
    const rA = ahx * Math.abs(uAx * nx + uAz * nz) + ahz * Math.abs(vAx * nx + vAz * nz);
    const rB = bhx * Math.abs(uBx * nx + uBz * nz) + bhz * Math.abs(vBx * nx + vBz * nz);
    if (dist >= rA + rB) return false;
  }
  return true;
}

/** Half-extents along local X and Z and world yaw of any `GlbPlacement`. */
export function glbObb(g: GlbPlacement): { x: number; z: number; hx: number; hz: number; yaw: number } {
  const spec = GLB_WORLD_SPECS[g.id];
  const s = g.scale ?? 1;
  return {
    x: g.x,
    z: g.z,
    hx: spec.size[0] * 0.5 * (g.sx ?? s),
    hz: spec.size[2] * 0.5 * (g.sz ?? s),
    yaw: g.yaw,
  };
}

export interface ClearOpts {
  /** Extra clearance required around `fire_escape_smart_top` & `keepClear` fire escapes / entrances. */
  keepClearGap?: number;
  /** Index inside `batch.glbs` to ignore (e.g. coupled semi-truck tractor when attaching its trailer). */
  ignoreGlb?: number;
  /** Also ignore indices in this set. */
  ignoreIds?: ReadonlySet<GlbModelId>;
}

/**
 * Checks whether an OBB centered at `(x, z)` with half-extents `(hx, hz)` and Three.js `yaw`
 * clears all placed vehicles/props (`minGap`), sidewalk infrastructure (`>= 0.25 m`), and
 * highrise entrances / fire escapes (`keepClearGap`, default `3.0 m`).
 */
export function isObbClear(
  batch: StaticBatch,
  x: number,
  z: number,
  hx: number,
  hz: number,
  yaw: number,
  minGap = 1.0,
  opts?: ClearOpts,
): boolean {
  const clearGap = opts?.keepClearGap ?? 3.0;
  for (let i = 0; i < batch.keepClear.length; i++) {
    const kz = batch.keepClear[i];
    const rad = kz.r + clearGap;
    if (obbOverlap(x, z, hx, hz, yaw, kz.x, kz.z, rad, rad, 0)) return false;
  }
  for (let i = 0; i < batch.glbs.length; i++) {
    if (i === opts?.ignoreGlb) continue;
    const g = batch.glbs[i];
    if (opts?.ignoreIds?.has(g.id)) continue;
    if (NON_SOLID_OVERLAP.has(g.id)) continue;
    const spec = GLB_WORLD_SPECS[g.id];
    const gap = g.id === 'fire_escape_smart_top' ? clearGap : spec.category === 'infra' ? 0.25 : minGap;
    const b = glbObb(g);
    if (obbOverlap(x, z, hx + gap * 0.5, hz + gap * 0.5, yaw, b.x, b.z, b.hx + gap * 0.5, b.hz + gap * 0.5, b.yaw)) {
      return false;
    }
  }
  return true;
}

/** Convenience wrapper checking clearance for a candidate GLB id placed at `(x, z, glbYaw)`. */
export function isGlbClear(
  batch: StaticBatch,
  id: GlbModelId,
  x: number,
  z: number,
  glbYaw: number,
  minGap = 1.0,
  opts?: ClearOpts & { sx?: number; sy?: number; sz?: number; scale?: number },
): boolean {
  const spec = GLB_WORLD_SPECS[id];
  const s = opts?.scale ?? 1;
  const hx = spec.size[0] * 0.5 * (opts?.sx ?? s);
  const hz = spec.size[2] * 0.5 * (opts?.sz ?? s);
  return isObbClear(batch, x, z, hx, hz, glbYaw, minGap, opts);
}
