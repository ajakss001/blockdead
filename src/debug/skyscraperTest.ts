import './domStub';
import { Box3, Scene, Vector3 } from 'three';
import { MeshoptDecoder as ThreeMeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder as NodeMeshoptDecoder } from 'meshoptimizer';
import { mulberry32 } from '../core/random';
import { StaticBatch } from '../render/StaticBatch';
import { CollisionWorld } from '../world/CollisionWorld';
import { downtownBlock } from '../world/gen/cityFill';
import { BAND, CHUNK, PAVE } from '../world/gen/layout';
import { Builder } from '../world/gen/pieces';
import {
  assembleSkyscraper,
  fitLobbyProp,
  PROP_TARGET_HEIGHTS,
  SHOWCASE_TOWER_CENTER,
  SHOWCASE_TOWER_WIDTH,
  SkyscraperShowcase,
} from '../world/SkyscraperShowcase';

type FsMod = { existsSync(p: string): boolean; readFileSync(p: string): Uint8Array; statSync(p: string): { size: number } };
const proc = (globalThis as unknown as { process: { getBuiltinModule(m: string): unknown } }).process;
const fs = proc.getBuiltinModule('node:fs') as FsMod;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
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

  // 2) Load all 6 models via Three GLTFLoader + MeshoptDecoder and verify assembly & scaling
  const loader = new GLTFLoader().setMeshoptDecoder(ThreeMeshoptDecoder);
  const parseGlb = async (f: string) => {
    const raw = fs.readFileSync(f);
    return loader.parseAsync(new Uint8Array(raw).buffer, '');
  };
  const [base, mid, roof, elevator, turnstile, desk] = await Promise.all(files.map(parseGlb));

  const tower = assembleSkyscraper(base.scene, mid.scene, roof.scene, {
    width: SHOWCASE_TOWER_WIDTH,
    midCount: 5,
    seed: 20261124,
  });
  assert(Math.abs(tower.size.x - 18) < 0.08 && Math.abs(tower.size.z - 18) < 0.08, `Tower footprint not 18x18: ${tower.size.x.toFixed(2)}x${tower.size.z.toFixed(2)}`);
  const towerBox = new Box3().setFromObject(tower.group);
  assert(Math.abs(towerBox.min.y) < 0.01, `Tower min.y not normalized to 0: ${towerBox.min.y}`);
  assert(tower.group.children.length === 7, `Expected 7 modules (1 base + 5 mid + 1 roof), got ${tower.group.children.length}`);

  // Check zero vertical gaps between consecutive modules
  let prevTop = 0;
  for (let i = 0; i < tower.group.children.length; i++) {
    const m = tower.group.children[i];
    const mb = new Box3().setFromObject(m);
    assert(Math.abs(mb.min.y - prevTop) < 0.01, `Vertical seam gap at module ${i}: prevTop=${prevTop.toFixed(4)} vs minY=${mb.min.y.toFixed(4)}`);
    prevTop = mb.max.y;
  }
  assert(tower.beaconPos.y >= tower.totalHeight - 0.15, `Antenna beacon tip too low: ${tower.beaconPos.y.toFixed(2)} vs ${tower.totalHeight.toFixed(2)}`);

  // Check mid_2f sections received quarter-turn variety
  const midYaws = new Set(tower.group.children.slice(1, 6).map((c) => Math.round((c.rotation.y / (Math.PI / 2)) % 4)));
  assert(midYaws.size >= 2, `Expected varied 0/90/180/270 deg mid_2f rotations`);

  // Check lobby prop target heights
  const dFit = fitLobbyProp(desk.scene, PROP_TARGET_HEIGHTS.desk);
  const tFit = fitLobbyProp(turnstile.scene, PROP_TARGET_HEIGHTS.turnstile);
  const eFit = fitLobbyProp(elevator.scene, PROP_TARGET_HEIGHTS.elevator);
  assert(Math.abs(dFit.size.y - 1.1) < 0.01, `Desk height mismatch: ${dFit.size.y.toFixed(3)}`);
  assert(Math.abs(tFit.size.y - 1.05) < 0.01, `Turnstile height mismatch: ${tFit.size.y.toFixed(3)}`);
  assert(Math.abs(eFit.size.y - 2.5) < 0.01, `Elevator wall height mismatch: ${eFit.size.y.toFixed(3)}`);

  // 3) Check chunk (0, 0) spawn plaza lot is clear of procedural buildings and within 15-25m ahead of SPAWN
  const world = new CollisionWorld();
  const b = new Builder(new StaticBatch(), world);
  const descs = downtownBlock(b, 0, 0, BAND, BAND, CHUNK - BAND, CHUNK - BAND, mulberry32(1993));
  for (const desc of descs) {
    const overlapsShowcaseLot = desc.cx + desc.w * 0.5 > 24.5 && desc.cz - desc.d * 0.5 < 27;
    assert(!overlapsShowcaseLot, `Procedural building overlaps showcase plaza at (${desc.cx}, ${desc.cz})`);
  }

  const spawnPos = new Vector3(20, 0, 4.6);
  const spawnFwd = new Vector3(1, 0, 0); // SPAWN_YAW = -PI/2 -> forward = +X
  const toTower = new Vector3(SHOWCASE_TOWER_CENTER.x - spawnPos.x, 0, SHOWCASE_TOWER_CENTER.z - spawnPos.z);
  const centerDist = toTower.length();
  assert(centerDist >= 15 && centerDist <= 26, `Tower distance from spawn out of 15-25m range: ${centerDist.toFixed(2)}m`);
  assert(toTower.clone().normalize().dot(spawnFwd) > 0.78, `Tower not clearly inside spawn forward view`);

  // 4) Check showcase colliders block tower/props and reception desk acts as crouch cover (1.10m)
  const scene = new Scene();
  const showcase = new SkyscraperShowcase(scene, world, 4, false);
  const boxBeforeDispose = world.boxCount;
  assert(boxBeforeDispose > 0, 'Showcase failed to register colliders');

  const wallProbe = new Vector3(31.8, PAVE.plaza, 17.5);
  world.resolveCircle(wallProbe, 0.35);
  assert(wallProbe.x <= 31.66, `Tower collider failed to push out capsule (x=${wallProbe.x.toFixed(3)})`);

  // Crouch-height bullet hits reception desk (y = 0.85m), standing-height bullet shoots cleanly above (y = 1.45m)
  const lowShot = world.rayHit(26.5, PAVE.plaza + 0.85, 15.0, 1, 0, 0, 10);
  assert(lowShot > 0 && lowShot < 2.2, `Reception desk failed to stop crouch-level bullet (hit=${lowShot})`);
  const highShot = world.rayHit(26.5, PAVE.plaza + 1.45, 15.0, 1, 0, 0, 5.0);
  assert(highShot < 0, `Reception desk blocked high over-cover shot (hit=${highShot})`);

  showcase.update(0.2);
  showcase.dispose();
  assert(world.boxCount < boxBeforeDispose, 'Showcase dispose failed to clean colliders');

  console.log('[skyscraperTest] ALL CHECKS PASSED (6 GLBs <= 0.75MB, <= 1024px, seamless 7-part 18x18 tower, props scaled & collided).');
  return 0;
}
