import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  SkinnedMesh,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadBody, loadCharacters, type BodyId } from '../characters/assets';
import { gearGeometry, loadGear } from '../characters/gear';
import { LENS_OPACITY, LENS_TINT } from '../characters/material';
import { CharacterRig } from '../characters/rig';
import type { ItemId } from '../data/items';
import { flashlightMesh } from '../items/flashlight';
import { grim } from '../style/palette';
import { weaponMesh } from '../weapons/buildWeapon';
import { gunSockets } from '../weapons/gunFrame';
import { HINTS } from '../weapons/gunHints';
import type { AmmoId, GunId } from '../weapons/guns';

export type GridSpan = readonly [number, number];

export interface RenderedIcon {
  id: ItemId;
  grid: GridSpan;
  dataUrl: string;
}

interface ViewSpec {
  /** Camera position direction from subject center (camera looks back toward origin). */
  camDir: [number, number, number];
  /** Model rotation in radians applied before framing. */
  rot?: [number, number, number];
  grid: GridSpan;
}

const SIZE = 640;
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const texLoader = new TextureLoader();

async function loadGlb(url: string): Promise<Record<string, BufferGeometry>> {
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.arrayBuffer();
  });
  const gl = await gltfLoader.parseAsync(buf, '');
  const out: Record<string, BufferGeometry> = {};
  gl.scene.traverse((o) => {
    if ((o as Mesh).isMesh) out[o.name || o.parent?.name || 'mesh'] = (o as Mesh).geometry;
  });
  return out;
}

async function loadTex(url: string, flipY = false): Promise<Texture> {
  const t = await texLoader.loadAsync(url);
  await (t.image as HTMLImageElement | undefined)?.decode?.().catch(() => {});
  t.colorSpace = SRGBColorSpace;
  t.flipY = flipY;
  return t;
}

/** Project every vertex (including posed SkinnedMesh vertices) onto camera U/V to compute exact tight bounds. */
function collectProjectedBounds(
  root: Group,
  right: Vector3,
  up: Vector3,
): { minU: number; maxU: number; minV: number; maxV: number; center: Vector3; maxSpan: number } {
  root.updateMatrixWorld(true);
  const v = new Vector3();
  const minW = new Vector3(Infinity, Infinity, Infinity);
  const maxW = new Vector3(-Infinity, -Infinity, -Infinity);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const isSkinned = (mesh as SkinnedMesh).isSkinnedMesh;
    const sk = mesh as SkinnedMesh;
    for (let i = 0; i < pos.count; i++) {
      if (isSkinned && typeof sk.getVertexPosition === 'function') {
        sk.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      } else {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      }
      minW.min(v);
      maxW.max(v);
      const u = v.dot(right);
      const vv = v.dot(up);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (vv < minV) minV = vv;
      if (vv > maxV) maxV = vv;
    }
  });

  const center = minW.add(maxW).multiplyScalar(0.5);
  const maxSpan = Math.max(maxU - minU, maxV - minV, 0.05);
  return { minU, maxU, minV, maxV, center, maxSpan };
}

class StudioRenderer {
  private readonly renderer: WebGLRenderer;

  constructor() {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(SIZE, SIZE);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
  }

  render(subject: Group, spec: ViewSpec): string {
    const holder = new Group();
    if (spec.rot) subject.rotation.set(...spec.rot);
    holder.add(subject);

    const viewFromOrigin = new Vector3(...spec.camDir).normalize();
    const forward = viewFromOrigin.clone().negate();
    const worldUp = new Vector3(0, 1, 0);
    if (Math.abs(forward.dot(worldUp)) > 0.99) worldUp.set(0, 0, -1);
    const right = new Vector3().crossVectors(forward, worldUp).normalize();
    const camUp = new Vector3().crossVectors(right, forward).normalize();

    const { minU, maxU, minV, maxV, center, maxSpan } = collectProjectedBounds(holder, right, camUp);
    const spanU = maxU - minU;
    const spanV = maxV - minV;
    const half = Math.max(spanU, spanV) * 0.5 * 1.06;

    const uMid = (minU + maxU) * 0.5;
    const vMid = (minV + maxV) * 0.5;
    const alongDir = center.dot(viewFromOrigin);
    const lookTarget = right.clone().multiplyScalar(uMid).addScaledVector(camUp, vMid).addScaledVector(viewFromOrigin, alongDir);

    const dist = Math.max(maxSpan * 4, 1.5);
    const camera = new OrthographicCamera(-half, half, half, -half, 0.005, dist * 4);
    camera.position.copy(lookTarget).addScaledVector(viewFromOrigin, dist);
    camera.up.copy(camUp);
    camera.lookAt(lookTarget);

    // Isolated Tarkov studio rig: zero fog, zero game scene lights.
    // Soft top-left key + crisp back-right rim carve edges cleanly on dark inventory slots.
    const scene = new Scene();
    const hemi = new HemisphereLight(0xdce2ee, 0x2c2926, 1.25);
    const key = new DirectionalLight(0xfff4e2, 2.75);
    key.position
      .copy(lookTarget)
      .addScaledVector(right, -1.35 * dist)
      .addScaledVector(camUp, 1.95 * dist)
      .addScaledVector(viewFromOrigin, 1.85 * dist);
    const rim = new DirectionalLight(0xd4e4ff, 1.95);
    rim.position
      .copy(lookTarget)
      .addScaledVector(right, 1.5 * dist)
      .addScaledVector(camUp, 1.35 * dist)
      .addScaledVector(viewFromOrigin, -1.75 * dist);

    scene.add(hemi, key, rim, holder);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

/** Procedural 3D pistol / extended magazine with curved heel & top brass cartridge (side view: -Z front, -Y down). */
function buildMagGroup(kind: 'g17' | 'm1911' | 'ext_g17'): Group {
  const g = new Group();
  const isSteel = kind === 'm1911';
  const len = kind === 'ext_g17' ? 0.24 : 0.145;
  const depth = isSteel ? 0.031 : 0.036;
  const thick = isSteel ? 0.014 : 0.022;
  const bodyColor = isSteel ? grim(0x4e5259) : grim(0x2d2f33);
  const bodyMat = new MeshStandardMaterial({ color: bodyColor, roughness: isSteel ? 0.4 : 0.7, metalness: isSteel ? 0.65 : 0.12 });
  const padMat = new MeshStandardMaterial({ color: grim(0x1f2023), roughness: 0.78, metalness: 0.06 });
  const brassMat = new MeshStandardMaterial({ color: 0xc49f4a, roughness: 0.34, metalness: 0.78 });
  const copperMat = new MeshStandardMaterial({ color: 0xb06338, roughness: 0.36, metalness: 0.72 });

  const tube = new Mesh(new BoxGeometry(thick, len, depth), bodyMat);
  tube.rotation.x = 0.22;
  g.add(tube);

  const plate = new Mesh(new BoxGeometry(thick + 0.004, 0.014, depth + 0.008), padMat);
  plate.position.set(0, -Math.cos(0.22) * (len * 0.5), Math.sin(0.22) * (len * 0.5));
  plate.rotation.x = 0.22;
  g.add(plate);

  const roundY = Math.cos(0.22) * (len * 0.5) + 0.004;
  const roundZ = -Math.sin(0.22) * (len * 0.5);
  const casing = new Mesh(new CylinderGeometry(0.0045, 0.0045, 0.018, 10).rotateX(Math.PI / 2), brassMat);
  casing.position.set(0, roundY, roundZ + 0.002);
  const bullet = new Mesh(new CylinderGeometry(0.002, 0.0045, 0.01, 10).rotateX(-Math.PI / 2), copperMat);
  bullet.position.set(0, roundY, roundZ - 0.011);
  g.add(casing, bullet);
  return g;
}

/** Procedural 3D open-top ammo carton with visible cartridges / shotgun shells (3/4 view). */
function buildAmmoBoxGroup(id: AmmoId): Group {
  const g = new Group();
  const configs: Record<
    Exclude<AmmoId, 'rocket_rpg'>,
    { boxColor: number; stripeColor: number; shellColor: number; tipColor: number; cols: number; rows: number; height: number; shotgun?: boolean }
  > = {
    ammo_9mm: { boxColor: 0x4d5440, stripeColor: 0xa63e30, shellColor: 0xbda04c, tipColor: 0xa86036, cols: 5, rows: 4, height: 0.026 },
    ammo_45: { boxColor: 0x64523c, stripeColor: 0xb88238, shellColor: 0xbda04c, tipColor: 0x96532f, cols: 5, rows: 3, height: 0.029 },
    ammo_12: { boxColor: 0x6b342e, stripeColor: 0x262628, shellColor: 0xb03028, tipColor: 0xc29e48, cols: 5, rows: 2, height: 0.048, shotgun: true },
    ammo_556: { boxColor: 0x524e3e, stripeColor: 0x507a3d, shellColor: 0xbc9b4e, tipColor: 0xa25b34, cols: 5, rows: 3, height: 0.045 },
    ammo_762: { boxColor: 0x4d503d, stripeColor: 0x9b3328, shellColor: 0x6e755d, tipColor: 0xa45b34, cols: 5, rows: 3, height: 0.048 },
    ammo_308: { boxColor: 0x40444a, stripeColor: 0xc89e42, shellColor: 0xc09f4e, tipColor: 0xac6138, cols: 5, rows: 2, height: 0.056 },
  };
  const cfg = configs[id as Exclude<AmmoId, 'rocket_rpg'>];
  const W = 0.095;
  const D = 0.068;
  const H = cfg.height;

  const boxMat = new MeshStandardMaterial({ color: grim(cfg.boxColor), roughness: 0.85, metalness: 0.05 });
  const stripeMat = new MeshStandardMaterial({ color: grim(cfg.stripeColor), roughness: 0.78, metalness: 0.05 });
  const innerMat = new MeshStandardMaterial({ color: 0x1e1d1a, roughness: 0.9, metalness: 0 });
  const shellMat = new MeshStandardMaterial({ color: cfg.shellColor, roughness: cfg.shotgun ? 0.55 : 0.36, metalness: cfg.shotgun ? 0.1 : 0.78 });
  const tipMat = new MeshStandardMaterial({ color: cfg.tipColor, roughness: 0.34, metalness: 0.8 });

  const base = new Mesh(new BoxGeometry(W, H * 0.72, D), boxMat);
  base.position.y = H * 0.36;
  const band = new Mesh(new BoxGeometry(W + 0.001, H * 0.22, D + 0.001), stripeMat);
  band.position.y = H * 0.3;
  const liner = new Mesh(new BoxGeometry(W * 0.92, 0.006, D * 0.9), innerMat);
  liner.position.y = H * 0.72;
  const lid = new Mesh(new BoxGeometry(W, 0.004, D * 0.72), boxMat);
  lid.position.set(0, H * 0.92, -D * 0.62);
  lid.rotation.x = -0.95;
  g.add(base, band, liner, lid);

  const pitchX = (W * 0.78) / Math.max(1, cfg.cols - 1);
  const pitchZ = (D * 0.66) / Math.max(1, cfg.rows - 1);
  const rad = cfg.shotgun ? 0.0072 : 0.0046;
  for (let ix = 0; ix < cfg.cols; ix++) {
    for (let iz = 0; iz < cfg.rows; iz++) {
      const px = -W * 0.39 + ix * pitchX;
      const pz = -D * 0.33 + iz * pitchZ;
      if (cfg.shotgun) {
        const hull = new Mesh(new CylinderGeometry(rad, rad, H * 0.44, 10), shellMat);
        hull.position.set(px, H * 0.84, pz);
        const rim = new Mesh(new CylinderGeometry(rad * 1.08, rad * 1.08, 0.007, 10), tipMat);
        rim.position.set(px, H * 0.65, pz);
        g.add(hull, rim);
      } else {
        const casing = new Mesh(new CylinderGeometry(rad, rad, H * 0.25, 8), shellMat);
        casing.position.set(px, H * 0.78, pz);
        const bullet = new Mesh(new CylinderGeometry(rad * 0.3, rad * 0.92, H * 0.22, 8), tipMat);
        bullet.position.set(px, H * 0.98, pz);
        g.add(casing, bullet);
      }
    }
  }
  return g;
}

/** Procedural baseball bat from player/held. */
function buildBatGroup(): Group {
  const g = new Group();
  const wood = new MeshStandardMaterial({ color: grim(0x6e5034), roughness: 0.72, metalness: 0.04 });
  const tape = new MeshStandardMaterial({ color: grim(0x1c1c1e), roughness: 0.85, metalness: 0.02 });
  const shaft = new CylinderGeometry(0.036, 0.017, 0.72, 12).translate(0, 0.36, 0);
  const knob = new CylinderGeometry(0.026, 0.026, 0.018, 12).translate(0, 0.005, 0);
  const wrap = new CylinderGeometry(0.019, 0.019, 0.2, 12).translate(0, 0.12, 0);
  g.add(new Mesh(shaft, wood), new Mesh(knob, wood), new Mesh(wrap, tape));
  g.rotation.x = -Math.PI / 2;
  const outer = new Group();
  outer.add(g);
  return outer;
}

async function renderAll(): Promise<RenderedIcon[]> {
  const status = document.getElementById('status')!;
  const preview = document.getElementById('preview')!;
  const studio = new StudioRenderer();
  const results: RenderedIcon[] = [];

  const pushResult = (id: ItemId, grid: GridSpan, dataUrl: string) => {
    results.push({ id, grid, dataUrl });
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.src = dataUrl;
    const lbl = document.createElement('span');
    lbl.textContent = `${id} (${grid[0]}×${grid[1]})`;
    card.append(img, lbl);
    preview.append(card);
  };

  // 1. Firearms (public/models/weapons/*.glb) — strict orthographic side view (+X camera -> muzzle -Z points RIGHT)
  const gunIds: { id: GunId; grid: GridSpan }[] = [
    { id: 'rifle_ak', grid: [4, 2] },
    { id: 'rifle_m4a1', grid: [4, 2] },
    { id: 'rifle_hunting', grid: [4, 2] },
    { id: 'shotgun_pump', grid: [4, 2] },
    { id: 'launcher_rpg', grid: [4, 2] },
    { id: 'pistol_g17', grid: [2, 1] },
    { id: 'pistol_m1911', grid: [2, 1] },
  ];
  for (const { id, grid } of gunIds) {
    status.textContent = `Рендер оружия: ${id}…`;
    const [geo, map] = await Promise.all([
      loadGlb(`/models/weapons/${id}.glb`),
      loadTex(`/models/weapons/${id}_1024.webp`, false),
    ]);
    const mat = new MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.18 });
    const grp = new Group();
    for (const g of Object.values(geo)) grp.add(new Mesh(g, mat));
    pushResult(id, grid, studio.render(grp, { camDir: [1, 0, 0], grid }));
  }

  // 2. Clean rifle magazines, RPG rocket & weapon attachments
  status.textContent = 'Рендер магазинов и модулей…';
  const [extAkGeo, extAkTex] = await Promise.all([
    loadGlb('/models/weapons/mod_ext_mag_ak.glb'),
    loadTex('/models/weapons/mod_ext_mag_ak_1024.webp', false),
  ]);
  const [extM4Geo, extM4Tex] = await Promise.all([
    loadGlb('/models/weapons/mod_ext_mag_m4.glb'),
    loadTex('/models/weapons/mod_ext_mag_m4_1024.webp', false),
  ]);

  // Standard 30-rd rifle magazines derived cleanly from closed magazine meshes (distinct scale & finish from 40-rd)
  {
    const g = new Group();
    const mat = new MeshStandardMaterial({ map: extAkTex, color: 0xb67b56, roughness: 0.56, metalness: 0.25 });
    for (const m of Object.values(extAkGeo)) {
      const mesh = new Mesh(m, mat);
      mesh.scale.set(1, 0.78, 1);
      g.add(mesh);
    }
    pushResult('mag_ak', [1, 2], studio.render(g, { camDir: [1, 0, 0], grid: [1, 2] }));
  }
  {
    const g = new Group();
    const mat = new MeshStandardMaterial({ map: extM4Tex, color: 0xc2c8d2, roughness: 0.48, metalness: 0.45 });
    for (const m of Object.values(extM4Geo)) {
      const mesh = new Mesh(m, mat);
      mesh.scale.set(1, 0.78, 1);
      g.add(mesh);
    }
    pushResult('mag_m4', [1, 2], studio.render(g, { camDir: [1, 0, 0], grid: [1, 2] }));
  }

  // 40-rd extended magazines + suppressor
  for (const modId of ['mod_suppressor', 'mod_ext_mag_m4', 'mod_ext_mag_ak'] as const) {
    const [geo, map] = await Promise.all([
      loadGlb(`/models/weapons/${modId}.glb`),
      loadTex(`/models/weapons/${modId}_1024.webp`, false),
    ]);
    const g = new Group();
    const mat = new MeshStandardMaterial({ map, roughness: 0.56, metalness: 0.24 });
    for (const m of Object.values(geo)) g.add(new Mesh(m, mat));
    const grid: GridSpan = modId === 'mod_suppressor' ? [2, 1] : [1, 2];
    pushResult(modId, grid, studio.render(g, { camDir: [1, 0, 0], grid }));
  }

  const [rpgGeo, rpgTex] = await Promise.all([
    loadGlb('/models/weapons/launcher_rpg.glb'),
    loadTex('/models/weapons/launcher_rpg_1024.webp', false),
  ]);
  if (rpgGeo.rocket) {
    const g = new Group();
    g.add(new Mesh(rpgGeo.rocket, new MeshStandardMaterial({ map: rpgTex, roughness: 0.62, metalness: 0.2 })));
    pushResult('rocket_rpg', [2, 1], studio.render(g, { camDir: [1, 0, 0], grid: [2, 1] }));
  }

  pushResult('mag_g17', [1, 2], studio.render(buildMagGroup('g17'), { camDir: [1, 0, 0], grid: [1, 2] }));
  pushResult('mag_m1911', [1, 2], studio.render(buildMagGroup('m1911'), { camDir: [1, 0, 0], grid: [1, 2] }));
  pushResult('mod_ext_mag_g17', [1, 2], studio.render(buildMagGroup('ext_g17'), { camDir: [1, 0, 0], grid: [1, 2] }));

  {
    const { mesh } = flashlightMesh();
    const g = new Group();
    g.add(mesh);
    pushResult('mod_flashlight', [2, 1], studio.render(g, { camDir: [1, 0, 0], grid: [2, 1] }));
  }

  void HINTS;
  void gunSockets;

  // 3. Melee weapons (strict side view, tilted 45° top-right cleanly)
  status.textContent = 'Рендер холодного оружия…';
  const meleeSpecs: { item: ItemId; wid?: 'tacticalKnife' | 'fireAxe' | 'crowbar' | 'hammer'; grid: GridSpan; rot: [number, number, number] }[] = [
    { item: 'knife', wid: 'tacticalKnife', grid: [1, 2], rot: [Math.PI / 4, 0, 0] },
    { item: 'hammer', wid: 'hammer', grid: [1, 2], rot: [Math.PI / 4, 0, 0] },
    { item: 'axe', wid: 'fireAxe', grid: [4, 2], rot: [Math.PI / 4, 0, 0] },
    { item: 'crowbar', wid: 'crowbar', grid: [4, 2], rot: [Math.PI / 4, 0, 0] },
    { item: 'bat', grid: [4, 2], rot: [Math.PI / 4, 0, 0] },
  ];
  for (const sp of meleeSpecs) {
    const g = new Group();
    g.add(sp.wid ? weaponMesh(sp.wid) : buildBatGroup());
    pushResult(sp.item, sp.grid, studio.render(g, { camDir: [1, 0, 0], rot: sp.rot, grid: sp.grid }));
  }

  // 4. Gear (public/models/gear/*.glb) — frontal / clean 3/4 view
  status.textContent = 'Рендер экипировки и снаряжения…';
  await loadCharacters(1024);
  await loadGear('male', ['goggles_tactical']);

  const gearSpecs: { item: ItemId; file: string; grid: GridSpan; rot: [number, number, number] }[] = [
    { item: 'helmetMilitary', file: 'helmet_military', grid: [1, 1], rot: [0.16, 0.52, 0] },
    { item: 'helmetSwat', file: 'helmet_swat', grid: [1, 1], rot: [0.16, 0.52, 0] },
    { item: 'helmetFire', file: 'helmet_firefighter', grid: [1, 1], rot: [0.16, 0.52, 0] },
    { item: 'helmetConstruction', file: 'helmet_construction', grid: [1, 1], rot: [0.16, 0.52, 0] },
    { item: 'vestMilitary', file: 'vest_military', grid: [2, 2], rot: [0.12, 0.28, 0] },
    { item: 'vestSwat', file: 'vest_swat', grid: [2, 2], rot: [0.12, 0.28, 0] },
    { item: 'backpackMilitary', file: 'backpack_military', grid: [2, 2], rot: [0.12, Math.PI - 0.52, 0] },
    { item: 'backpackSchool', file: 'backpack_school', grid: [2, 2], rot: [0.12, Math.PI - 0.52, 0] },
    { item: 'backpackHiking', file: 'backpack_hiking', grid: [2, 2], rot: [0.12, Math.PI - 0.52, 0] },
    { item: 'bagMedic', file: 'bag_medic', grid: [2, 2], rot: [0.18, 0.55, 0] },
    { item: 'toolboxMechanic', file: 'toolbox_mechanic', grid: [2, 2], rot: [0.24, 0.62, 0] },
    { item: 'balaclava', file: 'balaclava', grid: [1, 1], rot: [0.14, 0.45, 0] },
    { item: 'shemagh', file: 'shemagh', grid: [1, 1], rot: [0.16, 0.45, 0] },
    { item: 'maskHalf', file: 'mask_half', grid: [1, 1], rot: [0.16, 0.45, 0] },
  ];
  for (const sp of gearSpecs) {
    const [geo, map] = await Promise.all([
      loadGlb(`/models/gear/${sp.file}.glb`),
      loadTex(`/models/gear/${sp.file}_1024.webp`, false),
    ]);
    const mat = new MeshStandardMaterial({ map, roughness: 0.76, metalness: 0.08 });
    const g = new Group();
    for (const geom of Object.values(geo)) g.add(new Mesh(geom, mat));
    pushResult(sp.item, sp.grid, studio.render(g, { camDir: [0, 0, 1], rot: sp.rot, grid: sp.grid }));
  }

  // Goggles Tactical rendered via aligned fitted main + lens geometry so frame & dark lenses match 100%
  {
    const g = new Group();
    const map = await loadTex('/models/gear/goggles_tactical_1024.webp', false);
    const mainGeo = gearGeometry('male', 'goggles_tactical', 0, 'main', false);
    const lensGeo = gearGeometry('male', 'goggles_tactical', 0, 'lens', false);
    if (mainGeo) g.add(new Mesh(mainGeo, new MeshStandardMaterial({ map, roughness: 0.75, metalness: 0.08 })));
    if (lensGeo) {
      g.add(
        new Mesh(
          lensGeo,
          new MeshStandardMaterial({
            color: LENS_TINT.goggles_tactical ?? 0x1b1d1f,
            roughness: 0.25,
            metalness: 0.25,
            transparent: true,
            opacity: LENS_OPACITY,
          }),
        ),
      );
    }
    pushResult('gogglesTactical', [1, 1], studio.render(g, { camDir: [0, 0, 1], rot: [0.16, 0.5, 0], grid: [1, 1] }));
  }

  // 5. Ammo boxes (3/4 studio view)
  status.textContent = 'Рендер коробок патронов…';
  for (const ammoId of ['ammo_9mm', 'ammo_45', 'ammo_12', 'ammo_556', 'ammo_762', 'ammo_308'] as const) {
    const g = buildAmmoBoxGroup(ammoId);
    pushResult(ammoId, [1, 1], studio.render(g, { camDir: [0, 0, 1], rot: [0.42, -0.58, 0], grid: [1, 1] }));
  }

  // 6. Full class outfits via CharacterRig + idle pose (accurate Mixamo skeleton bind, zero distortion)
  status.textContent = 'Рендер комплектов формы…';
  const outfits: { item: ItemId; body: BodyId }[] = [
    { item: 'outfitMilitary', body: 'military_m' },
    { item: 'outfitSwat', body: 'swat_m' },
    { item: 'outfitPolice', body: 'police_m' },
    { item: 'outfitFirefighter', body: 'firefighter_m' },
    { item: 'outfitDoctor', body: 'doctor_m' },
    { item: 'outfitMechanic', body: 'mechanic_m' },
    { item: 'outfitBuilder', body: 'builder_m' },
  ];
  for (const { item, body } of outfits) {
    await loadBody(body);
    const rig = new CharacterRig(body, 0);
    rig.hold('idle', 0.15);
    // Replace shader material cleanly with textured standard look under studio light
    const origMat = rig.mesh.material as { map?: Texture | null };
    rig.mesh.material = new MeshStandardMaterial({ map: origMat.map ?? null, roughness: 0.8, metalness: 0.05 });
    pushResult(item, [2, 2], studio.render(rig.root, { camDir: [0, 0, 1], rot: [0.06, -0.35, 0], grid: [2, 2] }));
    rig.dispose();
  }

  status.textContent = `Готово: ${results.length} иконок отрендерено`;
  return results;
}

declare global {
  interface Window {
    __renderIcons?: () => Promise<RenderedIcon[]>;
  }
}

window.__renderIcons = renderAll;

if (!navigator.webdriver) {
  void renderAll().catch((err) => {
    const st = document.getElementById('status');
    if (st) st.textContent = `Ошибка: ${String(err)}`;
    console.error(err);
  });
}
void Color;
