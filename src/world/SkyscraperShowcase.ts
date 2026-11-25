/**
 * Modular GLB Skyscraper + Lobby Props Showcase near player spawn:
 * - Aligns base -> 4..6 randomly rotated mid_2f sections -> roof seamlessly on Y (min.y pivot, 18x18 m tower).
 * - Adds outer skyscraper BoxCollider + dim red blinking aviation beacon on the roof antenna tip.
 * - Scales & places reception desk (1.10 m), tripod turnstile (1.05 m), and elevator wall (2.50 m)
 *   with accurate BoxColliders on the open entrance forecourt facing the player spawn.
 */

import {
  Box3,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PointLight,
  type Scene,
  SphereGeometry,
  type Texture,
  Vector3,
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mulberry32 } from '../core/random';
import type { CollisionWorld } from './CollisionWorld';
import { PAVE } from './gen/layout';
import baseUrl from '../../assets/models/skyscraper_base.glb?url';
import midUrl from '../../assets/models/skyscraper_mid_2f.glb?url';
import roofUrl from '../../assets/models/skyscraper_roof.glb?url';
import elevatorUrl from '../../assets/models/elevator_wall_14k.glb?url';
import turnstileUrl from '../../assets/models/tripod_turnstile_14k.glb?url';
import deskUrl from '../../assets/models/reception_desk_14k.glb?url';

export const SHOWCASE_TOWER_CENTER = { x: 41, z: 17.5 } as const;
export const SHOWCASE_TOWER_WIDTH = 18;
export const SHOWCASE_OWNER = 4e15;

export const PROP_TARGET_HEIGHTS = {
  desk: 1.1,
  turnstile: 1.05,
  elevator: 2.5,
} as const;

export interface AssembledTower {
  group: Group;
  totalHeight: number;
  size: Vector3;
  beaconPos: Vector3;
}

/** Shifts direct children of a clean object so its XZ center is at 0 and its bottom rests at y = 0. */
export function normalizeModulePivot(obj: Object3D): Box3 {
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);

  const box = new Box3().setFromObject(obj);
  if (box.isEmpty()) return box;

  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  const minY = box.min.y;
  for (const child of obj.children) {
    child.position.x -= cx;
    child.position.y -= minY;
    child.position.z -= cz;
  }
  obj.updateMatrixWorld(true);
  return new Box3().setFromObject(obj);
}

/** Finds the highest antenna/spire tip in `root`'s coordinate space. */
function findHighestTip(root: Object3D): Vector3 {
  root.updateMatrixWorld(true);
  const invRoot = root.matrixWorld.clone().invert();
  const v = new Vector3();
  let maxY = -Infinity;
  const pts: Vector3[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.geometry) return;
    const pos = obj.geometry.getAttribute('position');
    if (!pos) return;
    const toLocal = obj.matrixWorld.clone().premultiply(invRoot);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toLocal);
      if (v.y > maxY) maxY = v.y;
      pts.push(v.clone());
    }
  });

  if (pts.length === 0 || !Number.isFinite(maxY)) return new Vector3(0, 0, 0);
  const threshold = maxY - 0.15;
  let sx = 0;
  let sz = 0;
  let cnt = 0;
  for (const p of pts) {
    if (p.y >= threshold) {
      sx += p.x;
      sz += p.z;
      cnt++;
    }
  }
  return cnt > 0 ? new Vector3(sx / cnt, maxY, sz / cnt) : new Vector3(0, maxY, 0);
}

/**
 * Assembles base -> N mid_2f sections (0/90/180/270 deg random rotation) -> roof with uniform
 * target footprint width (`18 x 18 m`) and zero vertical gaps.
 */
export function assembleSkyscraper(
  baseScene: Object3D,
  midScene: Object3D,
  roofScene: Object3D,
  opts: { width?: number; midCount?: number; seed?: number } = {},
): AssembledTower {
  const width = opts.width ?? SHOWCASE_TOWER_WIDTH;
  const midCount = Math.max(4, Math.min(6, opts.midCount ?? 5));
  const rand = mulberry32(opts.seed ?? 20261124);
  const group = new Group();
  group.name = 'SkyscraperShowcaseTower';

  let yCursor = 0;

  const placeModule = (src: Object3D, yawRad: number): Object3D => {
    const mod = src.clone(true);
    const rawBox = normalizeModulePivot(mod);
    const rawSize = rawBox.getSize(new Vector3());
    const sx = rawSize.x > 1e-4 ? width / rawSize.x : 1;
    const sz = rawSize.z > 1e-4 ? width / rawSize.z : 1;
    const sy = (sx + sz) * 0.5;
    mod.scale.set(sx, sy, sz);
    mod.rotation.y = yawRad;
    mod.position.set(0, yCursor, 0);
    group.add(mod);
    mod.updateMatrixWorld(true);
    const placedBox = new Box3().setFromObject(mod);
    yCursor = placedBox.max.y;
    return mod;
  };

  placeModule(baseScene, 0);

  for (let i = 0; i < midCount; i++) {
    const qTurn = Math.floor(rand() * 4);
    placeModule(midScene, qTurn * (Math.PI / 2));
  }

  placeModule(roofScene, 0);

  group.updateMatrixWorld(true);
  const fullBox = new Box3().setFromObject(group);
  const size = fullBox.getSize(new Vector3());
  const beaconPos = findHighestTip(group);

  return { group, totalHeight: size.y, size, beaconPos };
}

/** Normalizes a prop pivot onto y = 0 (centered X/Z) and uniformly scales it to `targetHeight` meters. */
export function fitLobbyProp(src: Object3D, targetHeight: number): { group: Group; size: Vector3 } {
  const wrap = new Group();
  const prop = src.clone(true);
  const rawBox = normalizeModulePivot(prop);
  const rawH = rawBox.max.y - rawBox.min.y;
  const scale = rawH > 1e-4 ? targetHeight / rawH : 1;
  prop.scale.setScalar(scale);
  wrap.add(prop);
  wrap.updateMatrixWorld(true);
  const finalBox = new Box3().setFromObject(wrap);
  return { group: wrap, size: finalBox.getSize(new Vector3()) };
}

export class SkyscraperShowcase {
  readonly root = new Group();
  private beaconMat: MeshBasicMaterial | null = null;
  private beaconLight: PointLight | null = null;
  private readonly geosToDispose: { dispose(): void }[] = [];
  private readonly matsToDispose: { dispose(): void }[] = [];
  private readonly texsToDispose: Texture[] = [];
  private blinkT = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly anisotropy = 4,
    loadAssets = true,
  ) {
    this.root.name = 'SkyscraperShowcaseRoot';
    this.scene.add(this.root);
    this.registerFallbackColliders();
    if (loadAssets && typeof fetch !== 'undefined') {
      void this.loadAll();
    }
  }

  /** Synchronously registers tower and forecourt prop colliders so spawn physics block immediately. */
  private registerFallbackColliders(): void {
    const y0 = PAVE.plaza;
    const hw = SHOWCASE_TOWER_WIDTH * 0.5;
    this.world.addOwned(
      SHOWCASE_OWNER,
      SHOWCASE_TOWER_CENTER.x - hw,
      SHOWCASE_TOWER_CENTER.z - hw,
      SHOWCASE_TOWER_CENTER.x + hw,
      SHOWCASE_TOWER_CENTER.z + hw,
      y0,
      y0 + 140,
    );
    // Reserve approximate prop footprints until async Box3 update arrives
    this.world.addOwned(SHOWCASE_OWNER, 31.65, 13.8, 32.0, 16.2, y0, y0 + PROP_TARGET_HEIGHTS.elevator);
    this.world.addOwned(SHOWCASE_OWNER, 27.95, 13.75, 30.45, 16.25, y0, y0 + PROP_TARGET_HEIGHTS.desk);
    this.world.addOwned(SHOWCASE_OWNER, 26.3, 11.45, 27.3, 12.15, y0, y0 + PROP_TARGET_HEIGHTS.turnstile);
  }

  private async loadAll(): Promise<void> {
    try {
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      const [base, mid, roof, elevator, turnstile, desk] = await Promise.all([
        loader.loadAsync(baseUrl),
        loader.loadAsync(midUrl),
        loader.loadAsync(roofUrl),
        loader.loadAsync(elevatorUrl),
        loader.loadAsync(turnstileUrl),
        loader.loadAsync(deskUrl),
      ]);
      if (this.disposed) return;

      const y0 = PAVE.plaza;
      const hw = SHOWCASE_TOWER_WIDTH * 0.5;
      this.world.removeOwner(SHOWCASE_OWNER);

      // 1) Assemble 18 x 18 m modular skyscraper (base -> 5 rotated mid_2f -> roof) at spawn vista
      const tower = assembleSkyscraper(base.scene, mid.scene, roof.scene, {
        width: SHOWCASE_TOWER_WIDTH,
        midCount: 5,
        seed: 20261124,
      });
      tower.group.position.set(SHOWCASE_TOWER_CENTER.x, y0, SHOWCASE_TOWER_CENTER.z);
      this.prepVisuals(tower.group);
      this.root.add(tower.group);

      this.world.addOwned(
        SHOWCASE_OWNER,
        SHOWCASE_TOWER_CENTER.x - hw,
        SHOWCASE_TOWER_CENTER.z - hw,
        SHOWCASE_TOWER_CENTER.x + hw,
        SHOWCASE_TOWER_CENTER.z + hw,
        y0,
        y0 + tower.totalHeight,
      );

      // Dim red blinking aviation warning light at antenna tip
      const beaconGeo = new SphereGeometry(0.18, 10, 8);
      const beaconMat = new MeshBasicMaterial({ color: 0xff2620 });
      const beaconMesh = new Mesh(beaconGeo, beaconMat);
      beaconMesh.position.copy(tower.beaconPos);
      beaconMesh.position.y += 0.14;
      tower.group.add(beaconMesh);
      const beaconLight = new PointLight(0xff261e, 1.4, 24, 2);
      beaconLight.position.copy(beaconMesh.position);
      tower.group.add(beaconLight);
      this.beaconMat = beaconMat;
      this.beaconLight = beaconLight;
      this.geosToDispose.push(beaconGeo);
      this.matsToDispose.push(beaconMat);

      // 2) Lobby props on open entrance forecourt in front of west tower wall (facing player at SPAWN)
      const westWallX = SHOWCASE_TOWER_CENTER.x - hw;
      const elevFitted = fitLobbyProp(elevator.scene, PROP_TARGET_HEIGHTS.elevator);
      // Elevator front faces +Z in raw asset -> -Math.PI/2 turns +Z toward -X (outward from west tower face)
      elevFitted.group.rotation.y = -Math.PI / 2;
      elevFitted.group.position.set(westWallX - elevFitted.size.z * 0.5 - 0.02, y0, 15.0);
      this.addPropWithCollider(elevFitted.group);

      const deskFitted = fitLobbyProp(desk.scene, PROP_TARGET_HEIGHTS.desk);
      deskFitted.group.rotation.y = -Math.PI / 2;
      deskFitted.group.position.set(westWallX - 2.8, y0, 15.0);
      this.addPropWithCollider(deskFitted.group);

      const turnFitted = fitLobbyProp(turnstile.scene, PROP_TARGET_HEIGHTS.turnstile);
      turnFitted.group.rotation.y = -Math.PI / 2;
      turnFitted.group.position.set(westWallX - 5.2, y0, 11.8);
      this.addPropWithCollider(turnFitted.group);
    } catch (err) {
      console.warn('SkyscraperShowcase load skipped:', err);
    }
  }

  private addPropWithCollider(prop: Group): void {
    this.prepVisuals(prop);
    this.root.add(prop);
    prop.updateMatrixWorld(true);
    const box = new Box3().setFromObject(prop);
    this.world.addOwned(
      SHOWCASE_OWNER,
      box.min.x,
      box.min.z,
      box.max.x,
      box.max.z,
      box.min.y,
      box.max.y,
    );
  }

  private prepVisuals(root: Object3D): void {
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.geometry) this.geosToDispose.push(obj.geometry);
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        this.matsToDispose.push(m);
        if (m instanceof MeshStandardMaterial) {
          for (const tex of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap]) {
            if (!tex) continue;
            tex.anisotropy = Math.min(4, this.anisotropy);
            this.texsToDispose.push(tex);
          }
        }
      }
    });
  }

  update(dt: number): void {
    if (!this.beaconMat || !this.beaconLight) return;
    this.blinkT = (this.blinkT + dt) % 1.5;
    const pulse = this.blinkT < 0.45 ? Math.sin((this.blinkT / 0.45) * Math.PI) : 0.08;
    const r = 0.25 + 0.75 * pulse;
    this.beaconMat.color.setRGB(r, 0.03 * pulse, 0.03 * pulse);
    this.beaconLight.intensity = 0.15 + 1.65 * pulse;
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    this.world.removeOwner(SHOWCASE_OWNER);
    for (const g of this.geosToDispose) g.dispose();
    for (const m of this.matsToDispose) m.dispose();
    for (const t of this.texsToDispose) t.dispose();
    this.geosToDispose.length = 0;
    this.matsToDispose.length = 0;
    this.texsToDispose.length = 0;
  }
}
