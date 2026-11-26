import { Vector3 } from 'three';
import { mulberry32 } from '../core/random';
import { StaticBatch } from '../render/StaticBatch';
import { Containers } from '../systems/Containers';
import { CollisionWorld } from '../world/CollisionWorld';
import * as F from '../world/gen/furniture';
import { Builder } from '../world/gen/pieces';
import type { ModelLibrary } from '../world/models';
import { buildCar, setModelLibrary } from '../world/props/car';
import { GLB_WORLD_SPECS, type GlbModelId } from '../world/worldModels';

/**
 * npm run test:search — searching by the crosshair: only when the ray from the eye (2 m) hits a container's
 * fitted search zone and nothing stands in front. Every car model: roof and bonnet no, the trunk yes; a
 * suitcase: on it yes, 20 cm above it no; a fridge behind a wall: no; a wardrobe: on it yes.
 */
export async function main(): Promise<number> {
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };
  const fsName = 'node:fs';
  const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync(path: string, enc?: string): string & Uint8Array };
  const json = JSON.parse(readFileSync('public/models/models.json', 'utf8'));
  const bin = readFileSync('public/models/models.bin') as Uint8Array;
  const lib: ModelLibrary = { ...json, bin: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, byName: new Map(), byGroup: new Map(), cache: new Map() };
  for (const m of lib.models) {
    lib.byName.set(m.name, m);
    lib.byGroup.set(m.group, [...(lib.byGroup.get(m.group) ?? []), m]);
  }
  setModelLibrary(lib);

  /** What the crosshair finds from an eye looking at a point (the game's rule). */
  const aimAt = (world: CollisionWorld, containers: Containers, eye: Vector3, at: Vector3) => {
    const d = at.clone().sub(eye).normalize();
    return containers.targetRay(eye.x, eye.y, eye.z, d.x, d.y, d.z, 2, (t) => {
      const hit = world.rayHit(eye.x, eye.y, eye.z, d.x, d.y, d.z, t);
      return !(hit >= 0 && hit < t - 0.1);
    });
  };

  // Every world GLB vehicle model, one at a time, nose +X at the origin.
  let carsOk = 0;
  const cars = (Object.keys(GLB_WORLD_SPECS) as GlbModelId[]).filter((id) => GLB_WORLD_SPECS[id].category === 'vehicle');
  for (const id of cars) {
    const spec = GLB_WORLD_SPECS[id];
    const world = new CollisionWorld();
    const b = new Builder(new StaticBatch(), world);
    const spots: Parameters<typeof buildCar>[3] = [];
    buildCar(b.batch, world, { x: 0, z: 0, yaw: 0.3, paint: 0x808080, seed: 1, glbId: id }, spots);
    if (spots.length === 0) {
      console.log(`     ${id}: no trunk container`);
      continue;
    }
    const containers = new Containers(1);
    containers.addChunk(1, 'downtown', spots.map((s, k) => ({ ...s, id: k + 1 })));
    const fwd = new Vector3(Math.cos(0.3), 0, -Math.sin(0.3));
    const side = new Vector3(Math.sin(0.3), 0, Math.cos(0.3));
    const H = spec.size[1];
    const L = spec.size[2];
    const rear = -L * 0.5;
    const at = (x: number, y: number) => fwd.clone().multiplyScalar(x).add(new Vector3(0, y, 0));
    const roof = aimAt(world, containers, at(rear + L * 0.5, H + 0.85).add(side.clone().multiplyScalar(-1.0)), at(rear + L * 0.5, H - 0.02));
    const bonnet = aimAt(world, containers, at(rear + L + 1.1, Math.max(1.7, H * 0.72)), at(rear + L - 0.45, Math.min(1.6, H * 0.52)));
    const trunk = aimAt(world, containers, at(rear - 1.15, Math.min(1.6, Math.max(1.1, H * 0.72))), at(rear + 0.1, Math.min(1.0, H * 0.52)));
    if (!roof && !bonnet && trunk) carsOk++;
    else console.log(`     ${id}: roof ${!!roof}, bonnet ${!!bonnet}, trunk ${!!trunk}`);
  }
  check(carsOk === cars.length, `car models: roof and bonnet — no search, the trunk — search (${carsOk}/${cars.length})`);

  // A room: a suitcase on the floor, a wardrobe, and a fridge behind a wall.
  {
    const world = new CollisionWorld();
    const b = new Builder(new StaticBatch(), world);
    const rand = mulberry32(5);
    F.suitcase(new F.Place(b, 0, 0, 0, 0), rand);
    F.wardrobe(new F.Place(b, 3, 0, 0, 0), rand);
    // Wall at z = 1.5..1.65 across, the fridge just behind it.
    b.block(0xcccccc, -3, 0, 1.5, 9, 2.6, 0.15, 'plaster', true);
    F.fridge(new F.Place(b, 1.2, 0, 1.7, 0), rand);
    const containers = new Containers(1);
    containers.addChunk(1, 'downtown', b.containers.map((s, k) => ({ ...s, id: k + 1 })));
    const name = (r: ReturnType<typeof aimAt>) => r?.type ?? 'none';
    const suitcaseBox = b.containers.find((c) => c.type === 'suitcase')!.box!;
    const top = suitcaseBox[1] + suitcaseBox[4];
    const eye = new Vector3(0, 1.6, -1.2);
    check(name(aimAt(world, containers, eye, new Vector3(0, 0.35, 0.15))) === 'suitcase', 'on the suitcase — search');
    check(name(aimAt(world, containers, eye, new Vector3(0, top + 0.2, 0.15))) === 'none', `20 cm above the suitcase — nothing (its zone ends ${(top - 0.78).toFixed(2)} m over the handle)`);
    check(name(aimAt(world, containers, new Vector3(3, 1.6, -0.9), new Vector3(3, 1.0, 0.3))) === 'wardrobe', 'on the wardrobe — search');
    check(name(aimAt(world, containers, new Vector3(1.2, 1.6, 0.4), new Vector3(1.2, 1.0, 2.0))) === 'none', 'a fridge behind a wall — nothing');
    const fridge = b.containers.find((c) => c.type === 'fridge')!.box!;
    const wardrobe = b.containers.find((c) => c.type === 'wardrobe')!.box!;
    check(fridge[3] * 2 >= 0.65 && fridge[3] * 2 <= 1.05 && fridge[4] * 2 >= 1.75 && fridge[4] * 2 <= 2.25 && wardrobe[3] * 2 >= 1.05 && wardrobe[3] * 2 <= 1.35, `zones fit the objects (fridge ${(fridge[3] * 2).toFixed(2)}×${(fridge[4] * 2).toFixed(2)}×${(fridge[5] * 2).toFixed(2)} m, wardrobe ${(wardrobe[3] * 2).toFixed(2)} m wide)`);
  }
  console.log(fails.length ? `\ntest:search FAILED (${fails.length})` : '\ntest:search passed');
  return fails.length ? 1 : 0;
}
