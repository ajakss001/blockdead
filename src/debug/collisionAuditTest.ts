import './domStub';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Scene, Vector3 } from 'three';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { mulberry32 } from '../core/random';
import { InputManager } from '../input/InputManager';
import { MANTLE_MAX, MANTLE_MIN, PlayerController } from '../player/PlayerController';
import { StaticBatch } from '../render/StaticBatch';
import { Bandits, type Bandit, type BanditWorld, type FactionId, type SpawnBotOptions, type SpawnKind } from '../systems/Bandits';
import { Containers } from '../systems/Containers';
import { splitCarMeshIntoRig, type VehicleKind } from '../systems/Vehicles';
import { ZombieSim, type ZombieWorld } from '../systems/zombies';
import { CollisionWorld, PackedColliders } from '../world/CollisionWorld';
import { WindowPanes, WINDOW_OWNER_BASE } from '../world/WindowPanes';
import { buildChunk, type ChunkData } from '../world/gen/buildChunk';
import { buildHighriseShell, FLOOR_H, windowPanes, type BuildingDesc } from '../world/gen/highrise';
import { CHUNK, WorldLayout } from '../world/gen/layout';
import { Builder } from '../world/gen/pieces';
import { nearestPoi, siteToWorld, type PoiKind, type PoiSite } from '../world/gen/poi';
import { GLB_WORLD_SPECS, type GlbModelId } from '../world/worldModels';
import { loadCharactersNode } from './nodeCharacters';

/** Ground foliage/decal/archway/sign GLBs that are intentionally walkable or non-blocking. */
const NON_BLOCKING_GLBS = new Set<GlbModelId>([
  'speed_bump_1000',
  'Urban_Bush_2500',
  'garbage_cluster_1500',
  'Road_Debris_Cluster_2',
  'abandoned_luggage_pil',
  'fire_escape_smart_top',
  'building_breach_frame',
  'crash_skid_trench',
  'plane_debris_cluster',
  'emergency_gear_scatter',
  'road_sinkhole_crater',
  'razor_wire_coil',
]);

/** Thin sign/lamp poles & nature scenery. */
const POLE_OR_SCENERY_GLBS = new Set<GlbModelId>([
  'crosswalk_sign_1500',
  'Sign_Bus_Stop_1500',
  'Sign_Give_Way_1500',
  'Sign_Main_Road_1500',
  'Sign_No_Entry_1500',
  'Sign_No_Stopping_1500',
  'street_lamp_2000',
  'traffic_light_2500',
  'Dead_Autumn_Tree_6000',
  'Spruce_Pine_Tree_7000',
  'sniper_nest_camp',
]);

interface SpawnFn {
  spawnBot(
    rx: number,
    sy: number,
    rz: number,
    faction: FactionId,
    spawnKind: SpawnKind,
    weapon: string,
    isGun: boolean,
    mods?: string[],
    opts?: SpawnBotOptions,
  ): Bandit;
}

function chunkKeyOf(i: number, j: number): number {
  return (i + 32768) * 65536 + (j + 32768);
}

function loadPoiChunks(layout: WorldLayout, kind: PoiKind): { site: PoiSite; chunks: ChunkData[]; cw: CollisionWorld } {
  const site = nearestPoi(layout, kind, 0, 0, 120);
  if (!site) throw new Error(`POI ${kind} not found in layout`);
  const bw = site.bw ?? 1;
  const bd = site.bd ?? 1;
  const cw = new CollisionWorld();
  const chunks: ChunkData[] = [];
  for (let i = site.i; i < site.i + bw; i++) {
    for (let j = site.j; j < site.j + bd; j++) {
      const ch = buildChunk(layout, i, j);
      chunks.push(ch);
      cw.addPacked(chunkKeyOf(i, j), ch.colliders);
    }
  }
  return { site, chunks, cw };
}

async function buildThreeMeshFromGlb(filePath: string): Promise<Group> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(filePath);
  await doc.transform(dequantize());
  const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
  if (!prim) throw new Error(`Missing mesh primitive in ${filePath}`);
  const pos = prim.getAttribute('POSITION')?.getArray();
  const norm = prim.getAttribute('NORMAL')?.getArray();
  const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
  const idx = prim.getIndices()?.getArray();
  if (!pos) throw new Error(`Missing POSITION attribute in ${filePath}`);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  if (norm) geo.setAttribute('normal', new BufferAttribute(new Float32Array(norm), 3));
  if (uv) geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  if (idx) geo.setIndex(Array.from(idx));
  const mesh = new Mesh(geo, new MeshStandardMaterial());
  const node = doc.getRoot().listNodes().find((n) => n.getMesh());
  if (node) {
    const t = node.getTranslation();
    const r = node.getRotation();
    const s = node.getScale();
    mesh.position.set(t[0], t[1], t[2]);
    mesh.quaternion.copy(new Quaternion(r[0], r[1], r[2], r[3]));
    mesh.scale.set(s[0], s[1], s[2]);
  }
  const g = new Group();
  g.add(mesh);
  return g;
}

export async function main(): Promise<number> {
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };

  await loadCharactersNode();

  // 1. Audit solid GLB collider coverage across downtown dioramas + major/utility POIs
  const layout = new WorldLayout(1993);
  const dtCoords: [number, number][] = [
    [-1, 0],
    [0, -1],
    [0, 0],
    [1, 0],
    [-1, 1],
    [1, -1],
    [0, 1],
  ];
  const auditChunks: { label: string; chunk: ChunkData; cw: CollisionWorld }[] = [];
  const dtCw = new CollisionWorld();
  for (const [ci, cj] of dtCoords) {
    const ch = buildChunk(layout, ci, cj);
    dtCw.addPacked(chunkKeyOf(ci, cj), ch.colliders);
    auditChunks.push({ label: `downtown(${ci},${cj})`, chunk: ch, cw: dtCw });
  }
  const poiMap = new Map<PoiKind, { site: PoiSite; chunks: ChunkData[]; cw: CollisionWorld }>();
  for (const kind of ['base', 'airport', 'checkpoint', 'plant', 'helipad'] as PoiKind[]) {
    const res = loadPoiChunks(layout, kind);
    poiMap.set(kind, res);
    for (const ch of res.chunks) auditChunks.push({ label: `${kind}(${ch.i},${ch.j})`, chunk: ch, cw: res.cw });
  }

  let auditedSolidGlbs = 0;
  const missingGlbs: string[] = [];
  for (const { label, chunk, cw } of auditChunks) {
    for (const g of chunk.glbs) {
      if (NON_BLOCKING_GLBS.has(g.id) || POLE_OR_SCENERY_GLBS.has(g.id)) continue;
      const spec = GLB_WORLD_SPECS[g.id];
      const sc = g.scale ?? 1;
      const wSpan = Math.max(spec.size[0] * (g.sx ?? sc), spec.size[2] * (g.sz ?? sc));
      const hSpan = spec.size[1] * (g.sy ?? sc);
      if (hSpan < 0.35 || g.y > 4.0) continue;
      auditedSolidGlbs++;
      const flippedRoof = Math.abs(g.roll ?? 0) > 2.5;
      const yLo = flippedRoof ? 0.05 : g.y + 0.05;
      const yHi = flippedRoof ? Math.max(0.5, g.y) : g.y + hSpan;
      let hasSolid = false;
      cw.boxesNear(g.x, g.z, Math.max(0.8, wSpan * 0.55), (b) => {
        if (b.maxY > yLo && b.minY < yHi) hasSolid = true;
      });
      if (!hasSolid) {
        missingGlbs.push(`${label}: ${g.id} @ (${g.x.toFixed(1)}, ${g.y.toFixed(2)}, ${g.z.toFixed(1)})`);
      }
    }
  }
  check(
    auditedSolidGlbs >= 80 && missingGlbs.length === 0,
    `Audit ${auditedSolidGlbs} solid GLBs across downtown & 5 POIs (${missingGlbs.length} uncollided${missingGlbs.length ? `: ${missingGlbs.slice(0, 4).join('; ')}` : ''})`,
  );

  // 2. Military Base: boom gate (шлагбаум), chainlink fences (no glass fences), watchtowers, radar tower & windows
  const baseData = poiMap.get('base')!;
  const baseSite = baseData.site;
  const baseGlbs = baseData.chunks.flatMap((c) => c.glbs);
  const baseWindows = baseData.chunks.flatMap((c) => c.windows);
  const baseFences = baseGlbs.filter((g) => g.id === 'military_chainlink_fence');
  const baseWire = baseGlbs.filter((g) => g.id === 'razor_wire_coil');
  const baseTowers = baseGlbs.filter((g) => g.id === 'military_watchtower');
  const baseRadar = baseGlbs.filter((g) => g.id === 'airfield_radar_tower');
  const baseFencesSolid = baseFences.every((f) => {
    let solid = false;
    baseData.cw.boxesNear(f.x, f.z, 3.5, (b) => {
      if (!b.glass && b.maxY >= 2.5) solid = true;
    });
    return solid;
  });
  check(
    baseFences.length >= 40 && baseWire.length >= 40 && baseTowers.length === 4 && baseRadar.length === 1 && baseFencesSolid,
    `Base perimeter upgraded: chainlink×${baseFences.length}, wire×${baseWire.length}, watchtower×${baseTowers.length}, radar×${baseRadar.length}, solidFences=${baseFencesSolid}`,
  );
  const Lbase = ((Math.min(baseSite.bw ?? 1, baseSite.bd ?? 1)) * CHUNK) / 2 - 5.8;
  const [gateCx, gateCz] = siteToWorld(baseSite, -0.625, Lbase + 0.4);
  const [gateOutX, gateOutZ] = siteToWorld(baseSite, -0.625, Lbase + 2.4);
  const rdx = gateCx - gateOutX;
  const rdz = gateCz - gateOutZ;
  const rLen = Math.hypot(rdx, rdz);
  const gateRay = baseData.cw.rayHit(gateOutX, 1.0, gateOutZ, rdx / rLen, 0, rdz / rLen, 3.5);
  const gateProbe = new Vector3(gateCx + 0.04, 0, gateCz + 0.04);
  baseData.cw.resolveCircle(gateProbe, 0.3, 1.78);
  const gatePushed = Math.hypot(gateProbe.x - (gateCx + 0.04), gateProbe.z - (gateCz + 0.04)) > 0.1;
  check(
    gateRay >= 0 && gateRay < 2.5 && gatePushed,
    `Military base boom gate (шлагбаум) blocks bullets (ray=${gateRay.toFixed(2)}m) & player push=${gatePushed}`,
  );
  check(baseWindows.length >= 8, `Military base exposes interactive WindowPanes (${baseWindows.length} panes)`);

  // 3. Airport, Checkpoint, Water Plant, Helipad colliders & fences/towers
  const airportData = poiMap.get('airport')!;
  const airportGlbs = airportData.chunks.flatMap((c) => c.glbs);
  const airportWindows = airportData.chunks.flatMap((c) => c.windows);
  const airportGlassFenceProbe = (() => {
    const firstFence = airportGlbs.find((g) => g.id === 'military_chainlink_fence');
    if (!firstFence) return false;
    let solid = false;
    airportData.cw.boxesNear(firstFence.x, firstFence.z, 3.5, (b) => {
      if (!b.glass && b.maxY >= 2.5) solid = true;
    });
    return solid;
  })();
  check(
    airportGlbs.some((g) => g.id === 'military_chainlink_fence') &&
      airportGlbs.some((g) => g.id === 'airfield_radar_tower') &&
      airportWindows.length >= 8 &&
      airportGlassFenceProbe,
    `Airport: solid chainlink + radar tower + interactive WindowPanes (${airportWindows.length})`,
  );

  const cpData = poiMap.get('checkpoint')!;
  const cpTower = cpData.chunks.flatMap((c) => c.glbs).find((g) => g.id === 'military_watchtower');
  const cpHit = cpTower ? cpData.cw.rayHit(cpTower.x - 4, 1.5, cpTower.z, 1, 0, 0, 6) : -1;
  check(!!cpTower && cpHit >= 0 && cpHit < 4.2, `Checkpoint watchtower GLB present & solid (ray=${cpHit.toFixed(2)}m)`);

  const plantData = poiMap.get('plant')!;
  const plantFences = plantData.chunks.flatMap((c) => c.glbs).filter((g) => g.id === 'military_chainlink_fence');
  const plantBlocked = plantFences.every((f) => {
    let ok = false;
    plantData.cw.boxesNear(f.x, f.z, 3.5, (b) => {
      if (b.maxY >= 2.5) ok = true;
    });
    return ok;
  });
  check(plantFences.length >= 20 && plantBlocked, `Water plant chainlink fence (${plantFences.length} segs) 100% solid=${plantBlocked}`);

  const heliData = poiMap.get('helipad')!;
  const heliLight = heliData.chunks.flatMap((c) => c.glbs).find((g) => g.id === 'generator_light_tower');
  const heliProbe = heliLight ? new Vector3(heliLight.x + 0.05, 0, heliLight.z + 0.05) : new Vector3();
  if (heliLight) heliData.cw.resolveCircle(heliProbe, 0.3, 1.78);
  const heliBlocked = !!heliLight && Math.hypot(heliProbe.x - (heliLight.x + 0.05), heliProbe.z - (heliLight.z + 0.05)) > 0.1;
  check(!!heliLight && heliBlocked, `Helipad generator_light_tower collider active=${heliBlocked}`);

  // 4. Window mantle & 2-stage shatter + highrise upper-floor climb-out check
  const winScene = new Scene();
  const winCw = new CollisionWorld();
  winCw.addBox(-3, -0.15, 3, 0.15, 0, 0.9);
  winCw.addBox(-3, -0.15, 3, 0.15, 2.6, 3.2);
  const wp = new WindowPanes(winScene, winCw);
  const spot = { cx: 0, cy: 1.75, cz: 0, sx: 2.0, sy: 1.7, sz: 0.04 };
  wp.addChunk(101, [spot]);
  const owner0 = winCw.rayHitDetail(0, 1.75, -0.55, 0, 0, 1, 1, false)?.owner ?? WINDOW_OWNER_BASE + 1;

  const intactMantle = winCw.ledgeAhead(0, -0.55, 0, 1, 0, MANTLE_MIN, MANTLE_MAX);
  const hit1 = wp.bulletHit(owner0);
  const hit2 = wp.bulletHit(owner0);
  const crackedMantle = winCw.ledgeAhead(0, -0.55, 0, 1, 0, MANTLE_MIN, MANTLE_MAX);
  const hit3 = wp.bulletHit(owner0);
  const brokenMantle = winCw.ledgeAhead(0, -0.55, 0, 1, 0, MANTLE_MIN, MANTLE_MAX);
  check(
    intactMantle === -1 &&
      hit1?.stage === 1 &&
      hit2?.stage === 1 &&
      crackedMantle === -1 &&
      hit3?.stage === 2 &&
      hit3.shattered &&
      brokenMantle > 0.85,
    `Window mantle gate: intact=${intactMantle}, crack2=${crackedMantle}, shattered=${brokenMantle.toFixed(2)}`,
  );

  // PlayerController vaults cleanly over thin window sill to far side (~+0.50m)
  const bus = new EventBus<GameEvents>();
  const input = new InputManager('kbm', bus);
  const player = new PlayerController(new Vector3(0, 0, -0.55), Math.PI); // facing +Z
  input.setMove(0, 1);
  input.press('jump');
  for (let s = 0; s < 35; s++) {
    player.fixedUpdate(1 / 60, input, winCw, () => 0);
    input.release('jump');
  }
  check(player.position.z > 0.3, `Player vaults completely through broken window onto far side (z=${player.position.z.toFixed(2)})`);

  // Highrise upper floor (floor 2) has NO bodyOnly seal blocking broken window exit
  const hrBatch = new StaticBatch([0, 0]);
  const hrCols = new PackedColliders();
  const hrBuilder = new Builder(hrBatch, hrCols);
  const desc: BuildingDesc = { id: 1, cx: 0, cz: 0, w: 15, d: 15, floors: 4, facade: 'facadeConcrete', flip: false, kind: 'offices', seed: 123 };
  buildHighriseShell(hrBuilder, desc, mulberry32(123));
  windowPanes(hrBuilder, desc);
  const hrCw = new CollisionWorld();
  hrCw.addPacked(99, new Float32Array(hrCols.data));
  const hrWp = new WindowPanes(new Scene(), hrCw);
  hrWp.addChunk(99, hrBuilder.windows);
  const floor2Pane = hrBuilder.windows.find((w) => w.cy > FLOOR_H + 1.0 && w.cy < 2 * FLOOR_H && w.cz < -6);
  let hrExitClear = false;
  if (floor2Pane) {
    const probe = new Vector3(floor2Pane.cx, floor2Pane.cy, floor2Pane.cz + 0.6);
    const det = hrCw.rayHitDetail(probe.x, probe.y, probe.z, 0, 0, -1, 1.5, false, true);
    if (det && det.glass) {
      hrWp.shatter(det.owner);
      const afterBreak = hrCw.rayHitDetail(probe.x, probe.y, probe.z, 0, 0, -1, 1.5, false, true);
      hrExitClear = afterBreak === null;
    }
  }
  check(!!floor2Pane && hrExitClear, `Highrise floor 2 broken window allows unobstructed exit (clear=${hrExitClear})`);

  // 5. Vehicle wheel rig splitting (Sedan & Gelik SUV)
  for (const [kind, file] of [
    ['sedan', 'public/models/world/Sport_Sedan_22k.glb'],
    ['suv', 'public/models/world/Luxury_SUV_Gelik_22k.glb'],
  ] as [VehicleKind, string][]) {
    const rawMesh = await buildThreeMeshFromGlb(file);
    rawMesh.updateMatrixWorld(true);
    const b = new Box3().setFromObject(rawMesh);
    rawMesh.position.set(-(b.min.x + b.max.x) * 0.5, -b.min.y, -(b.min.z + b.max.z) * 0.5);
    rawMesh.updateMatrixWorld(true);
    const rig = splitCarMeshIntoRig(rawMesh, kind);
    const counts = rig
      ? (['body', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'] as const).map((n) => {
          const m = rig.getObjectByName(n) as Mesh | undefined;
          return m ? m.geometry.getAttribute('position').count : 0;
        })
      : [0, 0, 0, 0, 0];
    const minWheelVerts = Math.min(...counts.slice(1));
    check(!!rig && counts[0] > 5000 && minWheelVerts > 100, `Vehicle splitCarMeshIntoRig (${kind}): verts=${counts.join('/')}`);
  }

  // 6. Actor separation quick sanity (Bandit vs player & bandit)
  const banditCw = new CollisionWorld();
  const zWorld: ZombieWorld = {
    groundY: () => 0,
    resolveCircle: (p, r) => banditCw.resolveCircle(p, r),
    rayHit: (ox, oy, oz, dx, dy, dz, max) => banditCw.rayHit(ox, oy, oz, dx, dy, dz, max),
  };
  const zombies = new ZombieSim(zWorld, 0);
  const containers = new Containers(1993);
  const bw: BanditWorld = {
    scene: new Scene(),
    zombies,
    groundY: () => 0,
    resolveCircle: (p, r) => banditCw.resolveCircle(p, r),
    rayHit: (ox, oy, oz, dx, dy, dz, max, ig = false) => banditCw.rayHit(ox, oy, oz, dx, dy, dz, max, ig),
    rayHitDetail: (ox, oy, oz, dx, dy, dz, max, ig = false) => banditCw.rayHitDetail(ox, oy, oz, dx, dy, dz, max, ig),
    boxesNear: (x, z, r, out) => banditCw.boxesNear(x, z, r, (b) => out.push(b)),
    buildingsNear: () => [],
    noise() {},
    hurtPlayer() {},
    placeAt: () => 'street',
    addRagdoll: () => {},
    removeRagdoll: () => {},
    onDropLoot: (bot) => containers.addLoose({ id: 9000 + bot.id, type: 'bodyBandit', x: bot.pos.x, z: bot.pos.z, y: 0, zone: 'downtown' }, bot.loot, bot.corpse),
    onRemoveCorpse: () => {},
  };
  const bandits = new Bandits(bw);
  const spawner = bandits as unknown as SpawnFn;
  const b1 = spawner.spawnBot(10, 0, 10, 'scavs', 'street', 'pistol_g17', true);
  const b2 = spawner.spawnBot(10.05, 0, 10.05, 'scavs', 'street', 'pistol_g17', true);
  for (let k = 0; k < 5; k++) bandits.update(1 / 60, 10.02, 0, 10.02, false, false);
  const bbDist = Math.hypot(b1.pos.x - b2.pos.x, b1.pos.z - b2.pos.z);
  const bpDist = Math.hypot(b1.pos.x - 10.02, b1.pos.z - 10.02);
  check(bbDist >= 0.62 && bpDist >= 0.55, `Bandit actor separation: bot-bot=${bbDist.toFixed(2)}m, bot-player=${bpDist.toFixed(2)}m`);

  console.log(fails.length ? `\ntest:collisions FAILED (${fails.length})` : '\ntest:collisions passed');
  return fails.length ? 1 : 0;
}
