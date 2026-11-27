import { Matrix4, Quaternion, Vector3 } from 'three';
import { buildCar, CAR_PAINTS } from '../props/car';
import { GLB_WORLD_SPECS, type GlbModelId } from '../worldModels';
import { sandbags, stripedBarrier, tent } from './chaos';
import { isGlbClear } from './footprint';
import { Place } from './furniture';
import { type BuildingDesc, buildHighriseShell, FLOOR_H, groundDecal, wallDecalZ, WALL } from './highrise';
import { PAVE } from './layout';
import { LIFE } from './lifeKinds';
import { type Builder, type Rand } from './pieces';
import { stripDecal } from './storytelling';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _axis = new Vector3(0, 1, 0);

/** Center of the overrun military checkpoint on downtown chunk (-1, -1). */
export const LAST_STAND_CENTER = { x: -32, z: -32 } as const;

/** Two choke-point tripwire spans anchored between checkpoint barriers on chunk (-1, -1). */
export const LAST_STAND_WIRES = [
  { key: 'laststand:wireA', ax: -38.8, ay: PAVE.plaza + 0.3, az: -37.2, bx: -36.4, by: PAVE.plaza + 0.3, bz: -37.2 },
  { key: 'laststand:wireB', ax: -26.8, ay: PAVE.plaza + 0.3, az: -38.6, bx: -24.4, by: PAVE.plaza + 0.3, bz: -38.6 },
] as const;

/** Center of the overrun hospital quarantine camp on downtown chunk (-1, 0). */
export const QUARANTINE_CENTER = { x: -32, z: 32 } as const;

function placeProp(b: Builder, id: GlbModelId, x: number, z: number, yaw: number, sc = 1, solid = true, minGap = 0.5): boolean {
  if (!isGlbClear(b.batch, id, x, z, yaw, minGap, { keepClearGap: 1.2, scale: sc })) return false;
  b.glb(id, x, PAVE.plaza, z, yaw, { scale: sc });
  if (solid) {
    const sp = GLB_WORLD_SPECS[id];
    b.colliders.addOrientedBox(x, z, sp.size[0] * 0.48 * sc, sp.size[2] * 0.48 * sc, yaw, PAVE.plaza, PAVE.plaza + sp.size[1] * 0.95 * sc);
  }
  return true;
}

/**
 * 1) Overrun Military Checkpoint "Last Stand" on block (-1, -1):
 * Guard bunker, GAZ Tigr, ZSU-23-4 Shilka aimed toward the city, razor-wire jersey barriers,
 * overturned refugee PAZ bus in the kill zone, searchlight tower, and high-tier military crates.
 */
export function lastStandCheckpointBlock(b: Builder, _i: number, _j: number, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): BuildingDesc[] {
  const cx = (X0 + X1) * 0.5; // -32
  const cz = (Z0 + Z1) * 0.5; // -32

  // Low fortified concrete guardhouse in the NW quadrant (open doorway South into the yard)
  const gx0 = X0 + 7;
  const gz0 = Z1 - 15;
  const gw = 10;
  const gd = 7;
  const gh = 3.2;
  b.block(0x52524c, gx0, PAVE.plaza, gz0, gw, 0.12, gd, 'concrete', true);
  b.blockY(0x64645e, gx0, PAVE.plaza, gz0 + gd - WALL, gw, gh, WALL, 'concrete');
  b.blockY(0x64645e, gx0, PAVE.plaza, gz0, WALL, gh, gd - WALL, 'concrete');
  b.blockY(0x64645e, gx0 + gw - WALL, PAVE.plaza, gz0, WALL, gh, gd - WALL, 'concrete');
  b.blockY(0x64645e, gx0, PAVE.plaza, gz0, 3.8, gh, WALL, 'concrete');
  b.blockY(0x64645e, gx0 + 5.6, PAVE.plaza, gz0, gw - 5.6, gh, WALL, 'concrete');
  b.blockY(0x64645e, gx0 + 3.8, PAVE.plaza + 2.2, gz0, 1.8, gh - 2.2, WALL, 'concrete');
  b.block(0x4a4a46, gx0 - 0.15, PAVE.plaza + gh, gz0 - 0.15, gw + 0.3, 0.25, gd + 0.3, 'concrete', true);
  b.block(0x585852, gx0, PAVE.plaza + gh + 0.25, gz0 + gd - 0.3, gw, 0.75, 0.3, 'concrete', true);
  b.life(LIFE.beacon, gx0 + gw * 0.5, PAVE.plaza + gh + 0.7, gz0 + 0.5, 0, 0, 0.45, 5, 0.25, 0);
  wallDecalZ(b, 'decalInfected', gx0 + 2.0, PAVE.plaza + 1.7, gz0, 1.4, -1);
  wallDecalZ(b, 'decalEvacuate', gx0 + 7.5, PAVE.plaza + 1.8, gz0, 1.45, -1);

  // Heavy armour holding the northern plaza behind the barriers, muzzles turned toward downtown
  buildCar(b.batch, b.colliders, { x: cx - 5.5, z: cz + 8.5, yaw: -Math.PI * 0.38, glbId: 'zsu_23_4_shilka_14k', paint: 0x3b4434, seed: 910, allowOverlap: false }, b.containers);
  buildCar(b.batch, b.colliders, { x: cx + 9.0, z: cz + 6.5, yaw: -Math.PI * 0.62, glbId: 'gaz_tigr_4x4_17k', paint: 0x3f4739, seed: 911, allowOverlap: false }, b.containers);
  buildCar(b.batch, b.colliders, { x: cx + 15.0, z: cz + 14.0, yaw: Math.PI * 0.92, glbId: 'Kamaz_6x6_25k', paint: 0x3c4336, seed: 912, allowOverlap: false }, b.containers);
  groundDecal(b, 'decalSoot', cx - 5.5, PAVE.plaza + 0.015, cz + 8.5, 6.2, rand, 1.3);
  groundDecal(b, 'decalOil', cx + 9.0, PAVE.plaza + 0.015, cz + 6.5, 4.0, rand, 1.2);

  // Fortified defensive arc leaving two exact tripwire choke gaps (-38.8..-36.4 @ -37.2 & -26.8..-24.4 @ -38.6)
  const addBarrier = (bx: number, bz: number, yaw = 0) => {
    b.glb('military_barbed_barrier', bx, PAVE.plaza, bz, yaw);
    b.colliders.addOrientedBox(bx, bz, 2.3, 1.1, yaw, PAVE.plaza, PAVE.plaza + 1.95);
  };
  addBarrier(cx - 9.2, cz - 5.2, 0.08);
  addBarrier(cx - 2.0, cz - 5.2, -0.05);
  addBarrier(cx + 3.0, cz - 6.6, 0.12);
  addBarrier(cx + 10.0, cz - 6.6, -0.14);

  const sPlace = new Place(b, cx - 2.0, PAVE.plaza, cz + 1.5, 0);
  sandbags(sPlace, -6.5, -1.5, 3.8, rand);
  sandbags(sPlace, 4.5, -1.8, 3.8, rand);
  stripedBarrier(sPlace, -11.0, -7.8, 2.6, false);
  stripedBarrier(sPlace, 12.0, -7.8, 2.6, true);

  // Overturned refugee PAZ-3205 bus right in front of the firing line + luggage & bullet craters
  if (buildCar(b.batch, b.colliders, { x: cx - 1.5, z: cz - 14.2, yaw: 0.28, glbId: 'paz_3205_bus_11000', paint: 0xd0ccc0, seed: 913, smashed: 0.9, flipped: 'sideL', allowOverlap: false }, b.containers)) {
    stripDecal(b, cx - 7.5, cz - 16.0, 0.28, 9.5, 2.2, 'decalSkid');
    groundDecal(b, 'decalSoot', cx - 1.5, PAVE.plaza + 0.015, cz - 14.2, 5.5, rand, 1.4);
    b.life(LIFE.smoke, cx - 1.5, 1.8, cz - 14.2, 0, 0, 0, 0, 0.41);
  }
  placeProp(b, 'abandoned_luggage_pil', cx - 6.8, cz - 11.2, 0.5, 1.15, false, 0.3);
  placeProp(b, 'abandoned_luggage_pil', cx + 4.2, cz - 12.6, -0.8, 1.1, false, 0.3);
  placeProp(b, 'Road_Debris_Cluster_2', cx + 1.5, cz - 10.4, 0.9, 1.15, false, 0.3);
  groundDecal(b, 'decalBullets', cx - 3.0, PAVE.plaza + 0.016, cz - 4.0, 3.2, rand, 1.3);
  groundDecal(b, 'decalBullets', cx + 4.0, PAVE.plaza + 0.016, cz - 5.2, 3.0, rand, 1.2);

  // Searchlight tower sweeping through the fog + burn barrel + snapping wire
  if (placeProp(b, 'generator_light_tower', cx + 2.0, cz + 12.5, -0.6, 1.0, true, 0.5)) {
    b.life(LIFE.lamp, cx + 2.0, 4.1, cz + 12.5, 0, 0, 2.5, 4.1, 0.7);
    b.life(LIFE.spin, cx + 2.0, 4.2, cz + 12.5, 0, 0, 5.5, 0, 0.35, 1);
  }
  if (placeProp(b, 'burn_barrel', cx - 9.0, cz + 11.5, 0, 1.0, true, 0.4)) {
    b.life(LIFE.fire, cx - 9.0, PAVE.plaza + 0.92, cz + 11.5, 0, 0, 0.85, 0, 0.55);
  }
  b.life(LIFE.sparks, cx - 13.5, 1.5, cz - 4.5, 0, 0, 0, 0, 0.22);

  // High-tier military crates & armory inside the bunker + fallen soldiers
  const armP = new Place(b, gx0 + 5.0, PAVE.plaza + 0.12, gz0 + 4.2, 2);
  armP.resetBounds();
  if (armP.model('supplyCrate', rand, 0, 0, 0, 0, 1, 0.82, 0.2, true)) armP.container('baseArmory', 0, 0.6);

  const mc1 = new Place(b, cx - 5.0, PAVE.plaza, cz + 1.2, 0);
  mc1.resetBounds();
  if (mc1.model('supplyCrate', rand, 0, 0, 0, 0, 1, 0.8, 0.2, true)) mc1.container('militaryCrate', 0, 0.6);

  const mc2 = new Place(b, cx + 6.5, PAVE.plaza, cz + 0.8, 1);
  mc2.resetBounds();
  if (mc2.model('supplyCrate', rand, 0, 0, 0, 0, 1, 0.8, 0.2, true)) mc2.container('militaryCrate', 0, 0.6);

  b.container('bodyMilitary', cx - 6.8, cz - 1.2, PAVE.plaza);
  b.container('bodyMilitary', cx + 5.2, cz - 2.6, PAVE.plaza);
  return [];
}

/**
 * 2) Collapsed Evacuation / Quarantine Camp at City Hospital on block (-1, 0):
 * 3-story concrete triage clinic, breached perimeter wall with hazard tape, 3 tight quarantine tents,
 * overturned Gazelle ambulance, flashing EMS responder, static loudspeaker & medical supply caches.
 */
export function quarantineEvacBlock(b: Builder, i: number, j: number, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): BuildingDesc[] {
  const chunkKey = (i + 32768) * 65536 + (j + 32768);
  const bW = Math.min(34, Math.floor((X1 - X0 - 8) / 3) * 3);
  const bD = 15;
  const bX0 = Math.ceil((X0 + (X1 - X0 - bW) * 0.5) / 3) * 3;
  const bZ1 = Math.floor((Z1 - 1.0) / 3) * 3;
  const bZ0 = bZ1 - bD;
  const bCx = bX0 + bW * 0.5;
  const clinic: BuildingDesc = {
    id: chunkKey * 16,
    cx: bCx,
    cz: bZ0 + bD * 0.5,
    w: bW,
    d: bD,
    floors: 3,
    facade: 'facadeConcrete',
    flip: false,
    kind: 'offices',
    seed: Math.floor(rand() * 1e9),
  };
  buildHighriseShell(b, clinic, rand);

  // Red Cross hospital badge centered cleanly on the solid fascia board below the 2nd-floor window
  b.block(0xe2ded4, bCx - 0.34, 3.04, bZ0 - 0.13, 0.68, 0.52, 0.03, 'plaster');
  b.block(0xb63232, bCx - 0.08, 3.08, bZ0 - 0.16, 0.16, 0.44, 0.04, 'lamp');
  b.block(0xb63232, bCx - 0.22, 3.22, bZ0 - 0.16, 0.44, 0.16, 0.04, 'lamp');

  const cx = (X0 + X1) * 0.5; // -32
  const fenceZ = Z0 + 5.2;
  // Breached quarantine perimeter wall along South approach with biohazard tape, graffiti & rubble breach
  b.block(0x747068, X0 + 1.5, PAVE.plaza, fenceZ, 17.5, 2.1, 0.28, 'concrete', true);
  b.block(0x747068, cx + 4.5, PAVE.plaza, fenceZ, X1 - (cx + 4.5) - 1.5, 2.1, 0.28, 'concrete', true);
  wallDecalZ(b, 'decalEvacuate', X0 + 5.5, 1.35, fenceZ, 1.45, -1);
  wallDecalZ(b, 'decalBiohazard', X0 + 10.0, 1.35, fenceZ, 3.2, -1);
  wallDecalZ(b, 'decalBiohazard', cx + 10.5, 1.35, fenceZ, 3.2, -1);
  wallDecalZ(b, 'decalInfected', cx + 15.5, 1.35, fenceZ, 1.45, -1);
  placeProp(b, 'concrete_rubble_mound', cx - 1.5, fenceZ + 0.5, 0.4, 0.78, true, 0.3);

  // Tight corridor layout of 3 quarantine tents + sandbags + scattered gurneys/trauma kits
  tent(b, cx - 11.5, Z0 + 16.5, 0.12, rand);
  tent(b, cx - 2.5, Z0 + 20.5, -0.08, rand);
  tent(b, cx + 10.5, Z0 + 16.0, 1.48, rand);
  const sb = new Place(b, cx - 6.5, PAVE.plaza, Z0 + 12.0, 0);
  sandbags(sb, 0, 0, 3.6, rand);
  sandbags(sb, 8.2, -1.5, 3.6, rand);

  placeProp(b, 'emergency_gear_scatter', cx - 7.0, Z0 + 16.0, 0.3, 1.05, false, 0.3);
  placeProp(b, 'emergency_gear_scatter', cx + 3.5, Z0 + 16.5, -0.6, 1.05, false, 0.3);
  placeProp(b, 'emergency_gear_scatter', cx + 7.5, Z0 + 23.0, 1.2, 1.0, false, 0.3);

  // Overturned ambulance near the breached gate + active responder by the clinic doors
  if (buildCar(b.batch, b.colliders, { x: cx + 1.5, z: Z0 + 10.5, yaw: 0.55, glbId: 'gazelle_ambulance_17k', paint: 0xffffff, seed: 920, smashed: 0.85, flipped: 'sideR', allowOverlap: false }, b.containers)) {
    groundDecal(b, 'decalShards', cx + 1.5, PAVE.plaza + 0.015, Z0 + 10.5, 4.2, rand, 1.3);
    groundDecal(b, 'decalOil', cx + 2.2, PAVE.plaza + 0.015, Z0 + 11.2, 3.0, rand, 1.2);
  }
  if (buildCar(b.batch, b.colliders, { x: cx - 8.5, z: bZ0 - 4.8, yaw: -0.22, glbId: 'gazelle_ambulance_17k', paint: 0xffffff, seed: 921, allowOverlap: false }, b.containers)) {
    b.life(LIFE.beacon, cx - 8.5, 3.1, bZ0 - 4.8, 0, 0, 0.45, 6, 0.32, 0);
  }

  // Evacuation loudspeaker crackling static & emergency floodlight
  b.block(0x3a3e42, cx + 13.0, PAVE.plaza, Z0 + 23.5, 0.14, 4.6, 0.14, 'metal', true);
  b.block(0x52565c, cx + 12.8, PAVE.plaza + 4.3, Z0 + 23.2, 0.55, 0.42, 0.45, 'metal');
  b.life(LIFE.speaker, cx + 13.0, PAVE.plaza + 4.4, Z0 + 23.5, 0, -1, 0.5, 0.4, 0.45);
  b.life(LIFE.beacon, cx + 13.0, PAVE.plaza + 4.75, Z0 + 23.5, 0, 0, 0.35, 5, 0.61, 1);
  if (placeProp(b, 'generator_light_tower', cx + 6.5, bZ0 - 4.2, 2.3, 1.0, true, 0.5)) {
    b.life(LIFE.lamp, cx + 6.5, 4.1, bZ0 - 4.2, 0, 0, 2.2, 4.1, 0.8);
  }

  // Medical supplies + medics + evacuee camp stash
  for (const [mx, mz] of [
    [cx - 11.5, Z0 + 16.5],
    [cx - 2.5, Z0 + 20.5],
    [cx + 10.5, Z0 + 16.0],
  ] as const) {
    b.container('pharmacy', mx + 1.2, mz - 0.8, PAVE.plaza);
  }
  b.container('bodyMedic', cx - 5.5, Z0 + 17.5, PAVE.plaza);
  b.container('bodyMedic', cx + 4.8, Z0 + 13.2, PAVE.plaza);
  b.container('campStash', cx + 12.5, bZ0 - 5.2, PAVE.plaza);

  return [clinic];
}

/**
 * 3) Collapsed Tower Crane Skybridge Between Two Highrises on block (0, -1):
 * South Tower (4 stories, fire escape up to y=12.8 m, rooftop tower_crane_cab) bridged across the courtyard
 * by a walkable collapsed_crane_boom truss into North Tower's 4th-floor breach (sniper nest + baseArmory).
 * Below in the alley sits a crushed Kamaz 6x6 beneath concrete slabs.
 */
export function collapsedCraneBlock(b: Builder, i: number, j: number, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): BuildingDesc[] {
  const chunkKey = (i + 32768) * 65536 + (j + 32768);
  const wS = 21;
  const dS = 15;
  const x0S = Math.ceil((X0 + (X1 - X0 - wS) * 0.5) / 3) * 3;
  const z0S = Math.ceil((Z0 + 1.0) / 3) * 3;
  const cxS = x0S + wS * 0.5;
  const bridgeH = 4 * FLOOR_H; // 12.8 m
  const bridgeX = cxS + 6.5;
  const z1S = z0S + dS; // -42
  const southTower: BuildingDesc = {
    id: chunkKey * 16,
    cx: cxS,
    cz: z0S + dS * 0.5,
    w: wS,
    d: dS,
    floors: 4,
    facade: 'facadeConcrete',
    flip: false,
    kind: 'offices',
    seed: Math.floor(rand() * 1e9),
    roofGapX: [bridgeX - 1.4, bridgeX + 1.4],
  };
  buildHighriseShell(b, southTower, rand);

  const wN = 27;
  const dN = 18;
  const x0N = Math.ceil((X0 + (X1 - X0 - wN) * 0.5) / 3) * 3;
  const z1N = Math.floor((Z1 - 1.0) / 3) * 3;
  const z0N = z1N - dN; // -24
  const northTower: BuildingDesc = {
    id: chunkKey * 16 + 1,
    cx: x0N + wN * 0.5,
    cz: z0N + dN * 0.5,
    w: wN,
    d: dN,
    floors: 6,
    facade: 'facadeConcrete',
    flip: false,
    kind: 'offices',
    seed: Math.floor(rand() * 1e9),
    breach: { x: bridgeX, y: bridgeH, w: 5.4, h: 1.45 * FLOOR_H },
  };
  buildHighriseShell(b, northTower, rand);

  // Rooftop crane operator cab mounted on a solid concrete counterweight plinth on open East roof (clear of head-house)
  const cabX = bridgeX - 0.3;
  const cabZ = z1S - 7.8;
  b.block(0x525458, cabX - 1.6, bridgeH, cabZ - 1.6, 3.2, 0.45, 3.2, 'concrete', true);
  b.glb('tower_crane_cab', cabX, bridgeH + 0.42, cabZ, Math.PI * 0.5);
  b.solid(cabX - 1.9, cabZ - 1.9, cabX + 1.9, cabZ + 1.9, bridgeH, bridgeH + 5.6);
  b.life(LIFE.beacon, cabX, bridgeH + 5.75, cabZ, 0, 0, 0.45, 5, 0.4, 0);

  // Walkable collapsed crane boom bridging South roof (z1S - 0.5) across the alley into North 4th-floor breach (z0N + 1.5)
  const bridgeZ = (z1S + z0N) * 0.5; // -33.0
  b.glb('collapsed_crane_boom', bridgeX, bridgeH - 0.16, bridgeZ, Math.PI / 2);
  // Thin 0.26m continuous walkable deck slab so supportAt tracks smoothly with real edge risk (no railings)
  b.solid(bridgeX - 0.92, z1S - 0.6, bridgeX + 0.92, z0N + 2.2, bridgeH - 0.26, bridgeH);

  // Breach framing, dangling concrete slab & sparks on North Tower 4th floor
  b.glb('building_breach_frame', bridgeX, bridgeH - 0.35, z0N - 0.25, 0, { scale: 0.95 });
  b.glb('collapsed_concrete_slab', bridgeX + 2.2, bridgeH - 0.85, z0N + 0.6, -0.3, { pitch: 0.45, roll: 0.22, scale: 0.78 });
  wallDecalZ(b, 'decalSoot', bridgeX - 3.6, bridgeH + 2.1, z0N, 2.2, -1);
  wallDecalZ(b, 'decalSoot', bridgeX + 3.6, bridgeH + 2.1, z0N, 2.2, -1);
  b.life(LIFE.sparks, bridgeX - 2.1, bridgeH + 2.8, z0N - 0.1, 0, 0, 0, 0, 0.37);

  // Street-level courtyard devastation beneath the fallen boom: crushed Kamaz & fallen slabs
  const cy = (z1S + z0N) * 0.5;
  if (buildCar(b.batch, b.colliders, { x: bridgeX + 0.8, z: cy + 1.5, yaw: 0.38, glbId: 'Kamaz_6x6_25k', paint: CAR_PAINTS.slate, seed: 930, smashed: 0.95, flipped: 'sideL', allowOverlap: true }, b.containers)) {
    groundDecal(b, 'decalSoot', bridgeX + 0.8, PAVE.plaza + 0.015, cy + 1.5, 5.5, rand, 1.3);
    b.life(LIFE.smoke, bridgeX + 0.8, 1.8, cy + 1.5, 0, 0, 0, 0, 0.52);
  }
  placeProp(b, 'collapsed_concrete_slab', bridgeX - 4.2, cy - 1.5, 0.7, 0.88, true, 0.4);
  placeProp(b, 'concrete_rubble_mound', bridgeX + 6.2, cy - 1.2, -0.5, 0.82, true, 0.4);
  placeProp(b, 'Road_Debris_Cluster_2', bridgeX - 2.0, cy + 4.8, 1.1, 1.1, false, 0.3);
  b.life(LIFE.beacon, bridgeX - 4.2, PAVE.plaza + 0.9, cy - 5.2, 0, 0, 0.4, 5, 0.7, 1);

  return [southTower, northTower];
}

/**
 * 4) Ambushed Convoy & Burning Gas Station on block (-1, 1):
 * Gas canopy, ambushed Kamaz 6x6 fuel truck & 2 DPS cars pinned by a charred PAZ bus,
 * shimmering fuel spill trail & 4 explosive fuel_barrel_cluster hazards + 3 guaranteed jerrycans.
 */
export function ambushedConvoyGasBlock(b: Builder, _i: number, _j: number, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): BuildingDesc[] {
  const cx = (X0 + X1) * 0.5; // -32
  const canopyCx = cx - 4.0;
  const canopyZ = Z1 - 14.0;

  // Gas canopy roof + 4 pillars + 2 fuel pump islands + cashier booth
  b.block(0x88322c, canopyCx - 11.0, PAVE.plaza + 4.4, canopyZ - 6.0, 22.0, 0.55, 12.0, 'metal', true);
  for (const px of [canopyCx - 9.0, canopyCx + 9.0]) {
    for (const pz of [canopyZ - 4.2, canopyZ + 4.2]) {
      b.blockY(0x4a4e54, px - 0.25, PAVE.plaza, pz - 0.25, 0.5, 4.4, 0.5, 'metal');
    }
  }
  for (const px of [canopyCx - 3.6, canopyCx + 3.6]) {
    b.block(0x6e6a62, px - 1.2, PAVE.plaza, canopyZ - 0.8, 2.4, 0.22, 1.6, 'concrete', true);
    b.block(0xc84032, px - 0.5, PAVE.plaza + 0.22, canopyZ - 0.35, 1.0, 1.55, 0.7, 'metal', true);
    b.container('gasCounter', px, canopyZ + 1.0, PAVE.plaza);
    if (b.lastContainer) b.lastContainer.fixed = ['jerrycan'];
  }

  // Gas shop booth behind pumps
  const sx0 = canopyCx + 11.5;
  const sz0 = Z1 - 19.0;
  b.blockY(0x7c7870, sx0, PAVE.plaza, sz0, 8.5, 3.2, 7.0, 'concrete');
  b.block(0x52524e, sx0 - 0.15, PAVE.plaza + 3.2, sz0 - 0.15, 8.8, 0.22, 7.3, 'concrete', true);
  wallDecalZ(b, 'decalNoFuel', sx0 + 4.2, PAVE.plaza + 1.85, sz0, 1.65, -1);
  b.container('gasShelf', sx0 + 2.2, sz0 - 0.9, PAVE.plaza);
  if (b.lastContainer) b.lastContainer.fixed = ['jerrycan'];

  // Ambushed convoy across the forecourt: Kamaz tanker/truck + 2 DPS escorts blocked by charred PAZ bus
  buildCar(b.batch, b.colliders, { x: cx + 10.5, z: Z0 + 11.5, yaw: 0.72, glbId: 'paz_3205_bus_11000', paint: 0x262626, seed: 940, smashed: 0.95, allowOverlap: false }, b.containers);
  buildCar(b.batch, b.colliders, { x: cx - 5.5, z: Z0 + 18.5, yaw: 0.45, glbId: 'Kamaz_6x6_25k', paint: 0x424a38, seed: 941, smashed: 0.35, allowOverlap: false }, b.containers);
  if (buildCar(b.batch, b.colliders, { x: cx + 1.5, z: Z0 + 12.2, yaw: 0.22, glbId: 'Police_Sedan_DPS_22k', paint: 0xffffff, seed: 942, allowOverlap: false }, b.containers)) {
    b.life(LIFE.beacon, cx + 1.5, 1.85, Z0 + 12.2, 0, 0, 0.42, 6, 0.19, 0);
  }
  if (buildCar(b.batch, b.colliders, { x: cx - 12.5, z: Z0 + 13.5, yaw: 0.55, glbId: 'Police_Sedan_DPS_22k', paint: 0xffffff, seed: 943, allowOverlap: false }, b.containers)) {
    b.life(LIFE.beacon, cx - 12.5, 1.85, Z0 + 13.5, 0, 0, 0.42, 5, 0.65, 1);
  }
  b.container('garage', cx - 9.2, Z0 + 23.0, PAVE.plaza);
  if (b.lastContainer) b.lastContainer.fixed = ['jerrycan'];

  // Shimmering leaking fuel slicks & chain-reaction explosive fuel barrel clusters
  const barrelSpots: [number, number, number][] = [
    [cx - 1.5, Z0 + 22.8, 0.2],
    [cx + 4.8, Z0 + 26.2, 1.1],
    [cx + 10.2, Z0 + 22.5, -0.7],
    [canopyCx - 7.5, canopyZ - 7.5, 0.5],
  ];
  for (let k = 0; k < barrelSpots.length; k++) {
    const [fx, fz, fyaw] = barrelSpots[k];
    if (placeProp(b, 'fuel_barrel_cluster', fx, fz, fyaw, 1.0, true, 0.25)) {
      groundDecal(b, 'decalSheen', fx, PAVE.plaza + 0.015, fz, 4.4, rand, 1.35);
      groundDecal(b, 'decalOil', fx + 0.8, PAVE.plaza + 0.017, fz - 0.6, 2.8, rand, 1.2);
    }
  }
  groundDecal(b, 'decalSoot', cx + 10.5, PAVE.plaza + 0.015, Z0 + 11.5, 6.2, rand, 1.3);
  b.life(LIFE.fire, cx + 10.5, PAVE.plaza + 1.4, Z0 + 11.5, 0, 0, 2.1, 0, 0.33);
  b.life(LIFE.smoke, cx + 10.5, PAVE.plaza + 2.6, Z0 + 11.5, 0, 0, 0, 0, 0.44);
  b.life(LIFE.fire, canopyCx + 4.2, PAVE.plaza + 1.1, canopyZ - 3.5, 0, 0, 1.5, 0, 0.77);
  b.life(LIFE.smoke, cx - 5.0, PAVE.plaza + 2.0, Z0 + 18.5, 0, 0, 0, 0, 0.18);

  return [];
}

/**
 * 5) Road Collapse & Sewer Sinkhole on block (0, 1):
 * Central 14m road_sinkhole_crater, burst steam/water mains, Sport_Sedan pitched on the crater rim,
 * UAZ & EMERCOM utility responders with amber strobes, and a walkable underground cover trench / stash.
 */
export function sinkholeCollapseBlock(b: Builder, _i: number, _j: number, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): BuildingDesc[] {
  const cx = (X0 + X1) * 0.5; // +32
  const cz = (Z0 + Z1) * 0.5; // +96

  // Central flat-clamped collapsed crater & surrounding fractured concrete rim slabs
  b.glb('road_sinkhole_crater', cx, PAVE.plaza - 0.02, cz, 0.14);
  groundDecal(b, 'decalSoot', cx, PAVE.plaza + 0.014, cz, 12.5, rand, 1.2);
  for (const [sx, sz, syaw, sc] of [
    [cx - 6.8, cz + 2.5, 0.4, 0.85],
    [cx + 7.2, cz - 2.0, -0.5, 0.82],
  ] as const) {
    b.glb('collapsed_concrete_slab', sx, PAVE.plaza, sz, syaw, { scale: sc });
    const sp = GLB_WORLD_SPECS.collapsed_concrete_slab;
    b.colliders.addOrientedBox(sx, sz, sp.size[0] * 0.45 * sc, sp.size[2] * 0.45 * sc, syaw, PAVE.plaza, PAVE.plaza + sp.size[1] * 0.92 * sc);
  }

  // Burst storm sewer pipes venting steam & gushing water jets
  _m.compose(_p.set(cx - 3.2, PAVE.plaza + 0.35, cz - 1.2), _q.setFromAxisAngle(_axis.set(0, 0, 1), Math.PI / 2), _s.set(0.45, 2.2, 0.45));
  b.geo(b.cyl8, 0x383c40, _m, 'metal');
  _m.compose(_p.set(cx + 3.4, PAVE.plaza + 0.35, cz + 1.6), _q.setFromAxisAngle(_axis.set(0, 0, 1), Math.PI / 2), _s.set(0.42, 2.0, 0.42));
  b.geo(b.cyl8, 0x383c40, _m, 'metal');
  b.life(LIFE.steam, cx - 2.4, PAVE.plaza + 0.45, cz - 1.2, 1, 0, 0.9, 0.8, 0.31);
  b.life(LIFE.jet, cx + 2.5, PAVE.plaza + 0.45, cz + 1.6, -1, 0, 1.1, 0.9, 0.67);
  b.life(LIFE.sparks, cx + 5.6, PAVE.plaza + 0.9, cz + 4.4, 0, 0, 0, 0, 0.48);

  // Sport Sedan perched nose-down on the jagged West rim with blinking amber hazards
  if (buildCar(b.batch, b.colliders, { x: cx - 7.8, z: cz - 1.4, yaw: 0.18, glbId: 'Sport_Sedan_22k', paint: CAR_PAINTS.slate, seed: 950, smashed: 0.4, allowOverlap: true }, b.containers)) {
    const last = b.batch.glbs[b.batch.glbs.length - 1];
    last.pitch = 0.42;
    last.roll = 0.14;
    last.y = PAVE.plaza + 0.55;
    stripDecal(b, cx - 13.5, cz - 2.2, 0.18, 7.5, 2.0, 'decalSkid');
    b.life(LIFE.beacon, cx - 7.8, PAVE.plaza + 1.65, cz - 1.4, 0, 0, 0.42, 5, 0.25, 1);
  }

  // Abandoned municipal / EMERCOM road crew & roadwork barrier ring
  buildCar(b.batch, b.colliders, { x: cx + 11.5, z: cz - 10.5, yaw: -2.2, glbId: 'UAZ_Bukhanka_22k', paint: 0xffffff, seed: 951, allowOverlap: false }, b.containers);
  if (buildCar(b.batch, b.colliders, { x: cx - 12.0, z: cz - 12.0, yaw: 0.78, glbId: 'emercom_pickup_17k', paint: 0xffffff, seed: 952, allowOverlap: false }, b.containers)) {
    b.life(LIFE.beacon, cx - 12.0, 2.5, cz - 12.0, 0, 0, 0.42, 6, 0.55, 1);
  }
  placeProp(b, 'checkpoint_barricade', cx - 2.5, cz - 10.2, 0.08, 1.0, true, 0.4);
  placeProp(b, 'checkpoint_barricade', cx + 4.5, cz - 10.0, -0.15, 1.0, true, 0.4);
  placeProp(b, 'checkpoint_barricade', cx, cz + 10.5, 0.05, 1.0, true, 0.4);

  // Sheltered collector maintenance pocket / firing trench on North edge with secret stashes
  const tx0 = cx - 4.5;
  const tz0 = Z1 - 14.5;
  b.block(0x46484c, tx0, PAVE.plaza, tz0, 9.0, 0.1, 6.5, 'concrete', true);
  b.blockY(0x5a5c60, tx0, PAVE.plaza, tz0 + 6.2, 9.0, 2.3, 0.3, 'concrete');
  b.blockY(0x5a5c60, tx0, PAVE.plaza, tz0, 0.3, 2.3, 6.2, 'concrete');
  b.blockY(0x5a5c60, tx0 + 8.7, PAVE.plaza, tz0, 0.3, 2.3, 6.2, 'concrete');
  b.block(0x424448, tx0, PAVE.plaza + 2.3, tz0, 9.0, 0.25, 6.5, 'concrete', true);
  wallDecalZ(b, 'decalNoWater', cx - 2.6, 1.5, tz0 + 6.18, 1.35, -1);
  wallDecalZ(b, 'decalEvacuate', cx, 1.5, tz0 + 6.18, 1.4, -1);

  const st1 = new Place(b, cx - 2.2, PAVE.plaza + 0.1, tz0 + 4.8, 2);
  st1.resetBounds();
  if (st1.model('supplyCrate', rand, 0, 0, 0, 0, 1, 0.8, 0.2, true)) st1.container('militaryCrate', 0, 0.6);

  b.container('labLocker', cx + 0.6, tz0 + 5.1, PAVE.plaza + 0.1);
  b.container('campStash', cx + 2.8, tz0 + 4.6, PAVE.plaza + 0.1);
  b.life(LIFE.beacon, tx0 + 4.5, PAVE.plaza + 2.65, tz0 + 0.4, 0, 0, 0.38, 5, 0.85, 1);

  return [];
}
