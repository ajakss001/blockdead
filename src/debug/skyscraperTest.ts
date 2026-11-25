import './domStub';
import { Box3, DoubleSide, Mesh, type Object3D, Raycaster, Scene, Vector3 } from 'three';
import { MeshoptDecoder as ThreeMeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder as NodeMeshoptDecoder } from 'meshoptimizer';
import { mulberry32 } from '../core/random';
import { StaticBatch } from '../render/StaticBatch';
import { initWorldMaterials } from '../render/look/worldMaterials';
import { Shelters } from '../systems/Climate';
import { Containers } from '../systems/Containers';
import { CollisionWorld } from '../world/CollisionWorld';
import { downtownBlock } from '../world/gen/cityFill';
import { BAND, CHUNK, PAVE } from '../world/gen/layout';
import { Builder } from '../world/gen/pieces';
import {
  assembleSkyscraper,
  fitLobbyProp,
  LOBBY_PROP_PLACEMENTS,
  PROP_TARGET_HEIGHTS,
  SHOWCASE_BASE_H,
  SHOWCASE_FLOOR_H,
  SHOWCASE_FLOORS,
  SHOWCASE_MID_SECTIONS,
  SHOWCASE_ROOF_DECK_LOCAL_Y,
  SHOWCASE_STAIR,
  SHOWCASE_TOWER_CENTER,
  SHOWCASE_TOWER_WIDTH,
  SHOWCASE_WALL_T,
  SkyscraperShowcase,
} from '../world/SkyscraperShowcase';

type FsMod = { existsSync(p: string): boolean; readFileSync(p: string): Uint8Array; statSync(p: string): { size: number } };
const proc = (globalThis as unknown as { process: { getBuiltinModule(m: string): unknown } }).process;
const fs = proc.getBuiltinModule('node:fs') as FsMod;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function shaftBoundsXZ(mod: Object3D, minFrac = 0.72): { cx: number; cz: number; wx: number; wz: number } {
  mod.updateMatrixWorld(true);
  const full = new Box3().setFromObject(mod);
  const yCut = full.min.y + (full.max.y - full.min.y) * minFrac;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const v = new Vector3();
  mod.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.geometry) return;
    const pos = obj.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      if (v.y >= yCut) {
        if (v.x < x0) x0 = v.x;
        if (v.x > x1) x1 = v.x;
        if (v.z < z0) z0 = v.z;
        if (v.z > z1) z1 = v.z;
      }
    }
  });
  return { cx: (x0 + x1) * 0.5, cz: (z0 + z1) * 0.5, wx: x1 - x0, wz: z1 - z0 };
}

export async function main(): Promise<number> {
  const g = globalThis as unknown as {
    self?: unknown;
    createImageBitmap?: () => Promise<{ width: number; height: number; close(): void }>;
  };
  g.self ??= globalThis;
  g.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });

  await NodeMeshoptDecoder.ready;
  await ThreeMeshoptDecoder.ready;

  const files = [
    'assets/models/skyscraper_base.glb',
    'assets/models/skyscraper_mid_2f.glb',
    'assets/models/skyscraper_roof.glb',
    'assets/models/elevator_wall_14k.glb',
    'assets/models/tripod_turnstile_14k.glb',
    'assets/models/reception_desk_14k.glb',
  ];

  // 1) Verify compressed GLB sizes <= 1.6 MB and textures <= 1024px WebP/JPEG
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': NodeMeshoptDecoder });
  for (const f of files) {
    assert(fs.existsSync(f), `Missing compressed model: ${f}`);
    const sz = fs.statSync(f).size;
    assert(sz > 10_000 && sz <= 1.6 * 1024 * 1024, `Model ${f} size ${(sz / 1048576).toFixed(2)} MB out of budget`);
    const doc = await io.read(f);
    for (const tex of doc.getRoot().listTextures()) {
      const dim = tex.getSize();
      assert(dim && dim[0] <= 1024 && dim[1] <= 1024, `Oversized texture in ${f}: ${dim?.join('x')}`);
      assert(tex.getMimeType() === 'image/jpeg' || tex.getMimeType() === 'image/webp', `Uncompressed texture mime in ${f}: ${tex.getMimeType()}`);
    }
  }

  // 2) Load all 6 models via Three GLTFLoader + MeshoptDecoder and verify alignment, orientation & doorway cuts
  const loader = new GLTFLoader().setMeshoptDecoder(ThreeMeshoptDecoder);
  const parseGlb = async (f: string) => {
    const raw = fs.readFileSync(f);
    return loader.parseAsync(new Uint8Array(raw).buffer, '');
  };
  const [base, mid, roof, elevator, turnstile, desk] = await Promise.all(files.map(parseGlb));

  const tower = assembleSkyscraper(base.scene, mid.scene, roof.scene, {
    width: SHOWCASE_TOWER_WIDTH,
    midCount: SHOWCASE_MID_SECTIONS,
    seed: 20261124,
  });

  // Ground contact & shaft-center alignment across all 7 modules (zero tilt, 0/90/180/270 deg only)
  const towerBox = new Box3().setFromObject(tower.group);
  assert(Math.abs(towerBox.min.y) < 0.01, `Tower min.y not normalized to 0: ${towerBox.min.y}`);
  assert(tower.group.children.length === 7, `Expected 7 modules (1 base + 5 mid + 1 roof), got ${tower.group.children.length}`);

  let prevTop = 0;
  for (let i = 0; i < tower.group.children.length; i++) {
    const m = tower.group.children[i];
    assert(m.rotation.x === 0 && m.rotation.z === 0, `Non-zero tilt on module ${i}: rx=${m.rotation.x}, rz=${m.rotation.z}`);
    const q = m.rotation.y / (Math.PI / 2);
    assert(Math.abs(q - Math.round(q)) < 1e-6, `Non-orthogonal Y rotation on module ${i}: ${m.rotation.y}`);
    if (i === 0 || i === 6) {
      assert(Math.abs(m.rotation.y - Math.PI) < 1e-6, `Base/roof must rotate PI to face -Z road (i=${i}, yaw=${m.rotation.y})`);
    }
    const mb = new Box3().setFromObject(m);
    assert(Math.abs(mb.min.y - prevTop) < 0.02, `Vertical seam gap at module ${i}: prevTop=${prevTop.toFixed(4)} vs minY=${mb.min.y.toFixed(4)}`);
    const shaft = shaftBoundsXZ(m, i === 0 ? 0.72 : i === 6 ? 0.05 : 0.1);
    assert(Math.abs(shaft.cx) < 0.08 && Math.abs(shaft.cz) < 0.08, `Module ${i} shaft drifted off center: (${shaft.cx.toFixed(3)}, ${shaft.cz.toFixed(3)})`);
    assert(Math.abs(shaft.wx - 18) < 0.12 && Math.abs(shaft.wz - 18) < 0.12, `Module ${i} shaft not 18x18: ${shaft.wx.toFixed(2)}x${shaft.wz.toFixed(2)}`);
    prevTop = mb.max.y;
  }
  assert(tower.beaconPos.y >= tower.totalHeight - 0.15, `Antenna beacon tip too low: ${tower.beaconPos.y.toFixed(2)} vs ${tower.totalHeight.toFixed(2)}`);

  const midYaws = new Set(tower.group.children.slice(1, 6).map((c) => Math.round((c.rotation.y / (Math.PI / 2)) % 4)));
  assert(midYaws.size >= 2, `Expected varied 0/90/180/270 deg mid_2f rotations`);

  // Enable DoubleSide and verify geometric raycasts through the front canopy doorway AND roof booth exit pass cleanly!
  tower.group.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) if (mat) mat.side = DoubleSide;
  });
  const doorRay = new Raycaster(new Vector3(0, 1.35, -13), new Vector3(0, 0, 1), 0, 13);
  const doorHits = doorRay.intersectObject(tower.group, true);
  assert(doorHits.length === 0, `Front canopy entrance still blocked in GLB mesh at z=${doorHits[0]?.point.z.toFixed(2)}`);

  const sideWingRay = new Raycaster(new Vector3(-6.5, 1.35, -13), new Vector3(0, 0, 1), 0, 6);
  assert(sideWingRay.intersectObject(tower.group, true).length > 0, `Expected solid front facade wing at x=-6.5`);

  const boothCenterX = (SHOWCASE_STAIR.dx0 + SHOWCASE_STAIR.dx1) * 0.5;
  const roofExitRay = new Raycaster(
    new Vector3(boothCenterX, SHOWCASE_ROOF_DECK_LOCAL_Y + 1.2, SHOWCASE_STAIR.dz0 + 1.2),
    new Vector3(0, 0, -1),
    0,
    5,
  );
  const roofExitHits = roofExitRay.intersectObject(tower.group, true);
  assert(roofExitHits.length === 0, `Roof booth -Z exit still blocked in GLB mesh at z=${roofExitHits[0]?.point.z.toFixed(2)}`);

  // Check lobby prop target heights
  const dFit = fitLobbyProp(desk.scene, PROP_TARGET_HEIGHTS.desk);
  const tFit = fitLobbyProp(turnstile.scene, PROP_TARGET_HEIGHTS.turnstile);
  const eFit = fitLobbyProp(elevator.scene, PROP_TARGET_HEIGHTS.elevator);
  assert(Math.abs(dFit.size.y - 1.1) < 0.01, `Desk height mismatch: ${dFit.size.y.toFixed(3)}`);
  assert(Math.abs(tFit.size.y - 1.05) < 0.01, `Turnstile height mismatch: ${tFit.size.y.toFixed(3)}`);
  assert(Math.abs(eFit.size.y - 2.5) < 0.01, `Elevator wall height mismatch: ${eFit.size.y.toFixed(3)}`);

  // 3) Check chunk (0, 0) spawn plaza lot is clear of procedural buildings and front canopy faces road
  const world = new CollisionWorld();
  const b = new Builder(new StaticBatch(), world);
  const descs = downtownBlock(b, 0, 0, BAND, BAND, CHUNK - BAND, CHUNK - BAND, mulberry32(1993));
  const hw = SHOWCASE_TOWER_WIDTH * 0.5;
  for (const desc of descs) {
    const overlapsX = desc.cx + desc.w * 0.5 > SHOWCASE_TOWER_CENTER.x - hw && desc.cx - desc.w * 0.5 < SHOWCASE_TOWER_CENTER.x + hw;
    const overlapsZ = desc.cz + desc.d * 0.5 > SHOWCASE_TOWER_CENTER.z - hw && desc.cz - desc.d * 0.5 < SHOWCASE_TOWER_CENTER.z + hw;
    assert(!(overlapsX && overlapsZ), `Procedural building overlaps showcase tower at (${desc.cx}, ${desc.cz})`);
  }

  const spawnPos = new Vector3(20, 0, 4.6);
  const spawnFwd = new Vector3(1, 0, 0);
  const toTower = new Vector3(SHOWCASE_TOWER_CENTER.x - spawnPos.x, 0, SHOWCASE_TOWER_CENTER.z - spawnPos.z);
  const centerDist = toTower.length();
  assert(centerDist >= 15 && centerDist <= 26, `Tower distance from spawn out of range: ${centerDist.toFixed(2)}m`);
  assert(toTower.clone().normalize().dot(spawnFwd) > 0.78, `Tower not clearly inside spawn forward view`);

  // 4) Construct live SkyscraperShowcase with Containers & Shelters; verify enterable lobby, inside props, stairs, roof & cleanup
  initWorldMaterials('standard', 4);
  const scene = new Scene();
  const containers = new Containers(1993);
  const shelters = new Shelters();
  const boxesBefore = world.boxCount;
  const showcase = new SkyscraperShowcase(scene, world, 4, false, containers, shelters);
  assert(world.boxCount > boxesBefore, 'Showcase failed to register colliders');
  assert(containers.loadedCount >= 20, `Expected containers across showcase floors, got ${containers.loadedCount}`);

  const cx = SHOWCASE_TOWER_CENTER.x;
  const cz = SHOWCASE_TOWER_CENTER.z;
  const y0 = PAVE.plaza;

  // Walk capsule straight from sidewalk (z=4.6) into lobby center (z=16.5) along entrance x=cx -> ZERO blockage
  const enterProbe = new Vector3(cx, y0, 4.6);
  for (let stepZ = 5.0; stepZ <= 16.5; stepZ += 0.25) {
    enterProbe.set(cx, y0, stepZ);
    world.resolveCircle(enterProbe, 0.3, 1.78);
    assert(Math.abs(enterProbe.z - stepZ) < 0.05 && Math.abs(enterProbe.x - cx) < 0.05, `Blocked entering lobby at z=${stepZ}: (${enterProbe.x.toFixed(2)}, ${enterProbe.z.toFixed(2)})`);
  }

  // Solid perimeter walls block walking through wings, sides, back, and upper facade walls
  const wingProbe = new Vector3(cx - 5.5, y0, cz - hw + 0.1);
  world.resolveCircle(wingProbe, 0.3, 1.78);
  assert(wingProbe.z < cz - hw, `Left front wing failed to push capsule out (z=${wingProbe.z.toFixed(3)})`);

  const westProbe = new Vector3(cx - hw + 0.1, y0 + 12.0, cz);
  world.resolveCircle(westProbe, 0.3, 1.78);
  assert(westProbe.x < cx - hw, `West upper wall failed to push capsule out (x=${westProbe.x.toFixed(3)})`);

  // Upper floor doorway opening would NOT stay open above Ground floor
  const upperFrontDoorwayProbe = new Vector3(cx, y0 + SHOWCASE_FLOOR_H * 2, cz - hw + 0.1);
  world.resolveCircle(upperFrontDoorwayProbe, 0.3, 1.78);
  assert(upperFrontDoorwayProbe.z < cz - hw, `Upper floor front facade above doorway failed to block!`);

  // Verify all 3 props are strictly INSIDE lobby bounds & reception desk provides 1.10m crouch cover
  const ix0 = cx - hw + SHOWCASE_WALL_T;
  const ix1 = cx + hw - SHOWCASE_WALL_T;
  const iz0 = cz - hw + SHOWCASE_WALL_T;
  const iz1 = cz + hw - SHOWCASE_WALL_T;
  for (const [name, p] of Object.entries(LOBBY_PROP_PLACEMENTS)) {
    const px = cx + p.dx;
    const pz = cz + p.dz;
    assert(px > ix0 && px < ix1 && pz > iz0 && pz < iz1, `Prop ${name} outside lobby (${px.toFixed(2)}, ${pz.toFixed(2)})`);
  }
  const deskX = cx + LOBBY_PROP_PLACEMENTS.desk.dx;
  const deskZ = cz + LOBBY_PROP_PLACEMENTS.desk.dz;
  const lowShot = world.rayHit(deskX - 3.0, y0 + 0.85, deskZ, 1, 0, 0, 5.0);
  assert(lowShot > 0 && lowShot < 2.2, `Inside reception desk failed to block crouch shot (hit=${lowShot})`);
  const highShot = world.rayHit(deskX - 3.0, y0 + 1.45, deskZ, 1, 0, 0, 3.0);
  assert(highShot < 0, `Inside reception desk blocked standing over-cover shot (hit=${highShot})`);

  // 5) Full stairwell climb simulation: Lobby (y0) -> Floors 1..11 -> Floor 12 -> Roof Deck (y0 + SHOWCASE_ROOF_DECK_LOCAL_Y)
  const sx0 = cx + SHOWCASE_STAIR.dx0;
  const sx1 = cx + SHOWCASE_STAIR.dx1;
  const sz0 = cz + SHOWCASE_STAIR.dz0;
  const zf0 = sz0 + SHOWCASE_STAIR.near;
  const zf1 = zf0 + SHOWCASE_STAIR.run;
  const leftX = sx0 + SHOWCASE_STAIR.flightW * 0.5;
  const rightX = sx1 - SHOWCASE_STAIR.flightW * 0.5;

  let curY: number = y0;
  const walkStep = (wx: number, wz: number, expectedMinDelta = -0.05) => {
    const nextY = showcase.surfaceY(wx, wz, curY);
    assert(nextY !== null, `Missing walkable stair/floor surface at (${wx.toFixed(2)}, ${wz.toFixed(2)}, y=${curY.toFixed(2)})`);
    const dy = nextY - curY;
    assert(dy >= expectedMinDelta && dy <= 0.36, `Non-smooth stair height delta=${dy.toFixed(3)} at z=${wz.toFixed(2)}, curY=${curY.toFixed(2)}`);
    const pos = new Vector3(wx, nextY, wz);
    world.resolveCircle(pos, 0.3, 1.78);
    assert(Math.hypot(pos.x - wx, pos.z - wz) < 0.08, `Stair collision jammed capsule at (${wx.toFixed(2)}, ${wz.toFixed(2)}, y=${nextY.toFixed(2)}) -> (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})`);
    curY = nextY;
  };

  // Enter stairwell from lobby
  walkStep((sx0 + sx1) * 0.5, sz0 - 0.5, -0.01);
  walkStep((sx0 + sx1) * 0.5, sz0 + 0.5, -0.01);

  for (let k = 0; k <= SHOWCASE_FLOORS; k++) {
    // Move to left flight foot on near landing
    walkStep(leftX, zf0 - 0.3);
    // Climb Flight A (+Z)
    for (let s = 0; s <= 12; s++) walkStep(leftX, zf0 + (s / 12) * SHOWCASE_STAIR.run);
    // Cross back landing at zf1 + 0.5
    walkStep((leftX + rightX) * 0.5, zf1 + 0.5);
    walkStep(rightX, zf1 + 0.5);
    // Climb Flight B (-Z)
    for (let s = 0; s <= 12; s++) walkStep(rightX, zf1 - (s / 12) * SHOWCASE_STAIR.run);
    // Step onto next Near Landing
    walkStep(rightX, zf0 - 0.3);
  }

  // Exit rooftop booth (-Z) onto open roof deck
  const targetRoofY = y0 + SHOWCASE_ROOF_DECK_LOCAL_Y;
  assert(Math.abs(curY - targetRoofY) < 0.1, `Failed to reach exact roof deck height: got ${curY.toFixed(3)} vs ${targetRoofY.toFixed(3)}`);
  walkStep((sx0 + sx1) * 0.5, sz0 - 0.6, -0.05);
  walkStep(cx - 2.0, cz - 3.0, -0.05);
  assert(Math.abs(curY - targetRoofY) < 0.02, `Roof deck surface drifted: ${curY.toFixed(3)}`);

  // Verify upper-floor partition wall blocks solid section while open room doorway lets player enter cleanly
  const f3Y = y0 + SHOWCASE_FLOOR_H * 3;
  const partProbe = new Vector3(ix0 + 1.0, f3Y, sz0 - 2.13);
  world.resolveCircle(partProbe, 0.3, 1.78);
  assert(Math.abs(partProbe.z - (sz0 - 2.13)) > 0.25, `Upper floor partition failed to block capsule`);
  const f3RoomDoor = new Vector3(ix0 + 2.85, f3Y, sz0 - 2.13);
  world.resolveCircle(f3RoomDoor, 0.3, 1.78);
  assert(Math.abs(f3RoomDoor.z - (sz0 - 2.13)) < 0.02, `Upper floor doorway blocked player capsule`);
  assert(showcase.stepSurface(cx - 2.0, cz - 3.0, curY) === 'concrete', 'Expected concrete footsteps on roof deck');
  assert(showcase.stepSurface(cx, cz - 2.0, y0) === 'tile', 'Expected tile footsteps in lobby');
  assert(showcase.stepSurface(cx, cz - 2.0, y0 + SHOWCASE_FLOOR_H * 9) === 'wood', 'Expected wood footsteps on upper floor 9');

  // Verify zero phantom mid-air surface outside footprint
  for (const [ox, oz] of [
    [cx - hw - 0.6, cz],
    [cx + hw + 0.6, cz],
    [cx, cz - hw - 0.6],
    [cx, cz + hw + 0.6],
  ]) {
    assert(showcase.surfaceY(ox, oz, y0 + SHOWCASE_FLOOR_H * 4) === null, `Phantom mid-air surface outside tower at (${ox}, ${oz})`);
  }

  // Verify Shelters: indoors on floor 0 and floor 5, outdoors on roof deck
  assert(shelters.covers(cx, cz - 2.0, y0 + 1.0), 'Lobby should count as sheltered indoors');
  assert(shelters.covers(cx, cz - 2.0, y0 + SHOWCASE_FLOOR_H * 5 + 1.0), 'Floor 5 should count as sheltered indoors');
  assert(!shelters.covers(cx - 2.0, cz - 3.0, targetRoofY + 0.5), 'Open roof deck must count as outdoors');

  // Verify base height matches SHOWCASE_BASE_H accurately
  assert(Math.abs(SHOWCASE_BASE_H - 2 * SHOWCASE_FLOOR_H) < 1e-6, 'Base height constant mismatch');

  showcase.update(0.2);
  showcase.dispose();
  assert(world.boxCount === boxesBefore, `Showcase dispose leaked colliders: ${world.boxCount} vs ${boxesBefore}`);
  assert(containers.loadedCount === 0, 'Showcase dispose failed to remove containers');
  assert(!shelters.covers(cx, cz - 2.0, y0 + 1.0), 'Showcase dispose failed to remove shelter');

  console.log('[skyscraperTest] ALL CHECKS PASSED (enterable lobby + inside props + 12 floors + stairwell to roof + road alignment).');
  return 0;
}
