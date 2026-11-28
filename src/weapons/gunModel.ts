import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { grim } from '../style/palette';
import { gunSockets, type GunSockets, type V3 } from './gunFrame';
import { HINTS } from './gunHints';
import { type GunId, MODS, MOD_FITS, type ModId } from './guns';

/**
 * A firearm's model in the gun frame (weapons/gunFrame), with the parts that move on their own as children
 * pivoted at their sockets: `mag` (at the magazine socket; it drops out and goes back in), `slide` / `pump`
 * / `rocket` (they slide along the barrel), the modules on their sockets (suppressor at the muzzle, an
 * extended magazine in place of the magazine, the light under the barrel).
 *
 * The models come from public/models/weapons (tools/import-assets.mjs). A gun or a module with no model
 * there is a low-poly stand-in from the same hints — when the file arrives, it is used with no change of code.
 * The stand-in is drawn at once; the model replaces it when it has loaded.
 */

type Read = (file: string) => Promise<ArrayBuffer>;
let read: Read = (f) => fetch(`${import.meta.env?.BASE_URL ?? '/'}models/weapons/${f}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${f}: ${r.status}`))));
let texSize: 0 | 512 | 1024 = 1024;
let manifest: Record<string, { parts: string[] }> | null = null;
let manifestP: Promise<void> | null = null;
const files = new Map<string, Promise<Record<string, BufferGeometry> | null>>();
const textures = new Map<string, Texture>();
const loadedTextures = new Set<string>();
const texWaiters = new Map<string, Set<() => void>>();

/** Where the files come from (Node: none, the stand-ins) and the texture size (512 on low, 0: none). */
export function setGunSource(size: 0 | 512 | 1024, r?: Read | null): void {
  texSize = size;
  if (r === null) {
    manifest = {};
    manifestP = Promise.resolve();
  } else if (r) read = r;
}

function loadManifest(): Promise<void> {
  manifestP ??= read('weapons.json')
    .then((b) => {
      manifest = JSON.parse(new TextDecoder().decode(b));
    })
    .catch(() => {
      manifest = {};
    });
  return manifestP;
}

/** The parts' geometries of a model file, or null (none: the stand-in stays). */
function loadFile(id: string): Promise<Record<string, BufferGeometry> | null> {
  let p = files.get(id);
  if (!p) {
    p = loadManifest()
      .then(() => (manifest?.[id] ? read(`${id}.glb`) : null))
      .then(async (buf) => {
        if (!buf) return null;
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
        const out: Record<string, BufferGeometry> = {};
        gltf.scene.traverse((o) => {
          if ((o as Mesh).isMesh) out[o.name] = (o as Mesh).geometry;
        });
        return out;
      })
      .catch((e) => {
        console.warn('weapons', id, e);
        return null;
      });
    files.set(id, p);
  }
  return p;
}

function textureOf(id: string): Texture | null {
  if (!texSize || typeof document === 'undefined') return null;
  let t = textures.get(id);
  if (!t) {
    const finish = () => {
      loadedTextures.add(id);
      const waiters = texWaiters.get(id);
      if (waiters) {
        texWaiters.delete(id);
        for (const cb of waiters) cb();
      }
    };
    t = new TextureLoader().load(`${import.meta.env?.BASE_URL ?? '/'}models/weapons/${id}_${texSize}.webp`, finish, undefined, finish);
    t.colorSpace = SRGBColorSpace;
    t.flipY = false;
    textures.set(id, t);
  }
  return t;
}

function onTextureReady(id: string, cb: () => void): void {
  if (!texSize || typeof document === 'undefined' || loadedTextures.has(id)) return;
  let set = texWaiters.get(id);
  if (!set) texWaiters.set(id, (set = new Set()));
  set.add(cb);
}

// ── Stand-ins ──────────────────────────────────────────────────────────────────────────────────────

const STEEL = grim(0x3c3f42);
const POLY = grim(0x2a2b2c);
const WOOD = grim(0x5a3e2a);
const OLIVE = grim(0x4e5138);

const box = (w: number, h: number, d: number, at: V3) => new BoxGeometry(w, h, d).translate(at[0], at[1], at[2]);
/** A box along a line (a grip, a magazine), `w` wide, `d` deep. */
function along(a: V3, b: V3, w: number, d: number): BufferGeometry {
  const va = new Vector3(...a), vb = new Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new BoxGeometry(w, len, d);
  const dir = vb.clone().sub(va).normalize();
  g.rotateX(Math.atan2(dir.z, dir.y));
  const mid = va.add(vb).multiplyScalar(0.5);
  return g.translate(mid.x, mid.y, mid.z);
}

/** Low-poly body of a gun from its hints (sockets in the gun frame). */
function standIn(id: GunId, s: GunSockets): Record<string, { geo: BufferGeometry; color: number }[]> {
  const h = HINTS[id];
  const k = s.scale;
  const top = Math.max(s.sightR[1], s.sightF[1]);
  const bore = s.muzzle[1];
  const out: Record<string, { geo: BufferGeometry; color: number }[]> = { body: [] };
  const add = (part: string, geo: BufferGeometry, color: number) => (out[part] ??= []).push({ geo, color });
  const grip = h.grip.map((p) => [0, k * (p[1] - (h.grip[0][1] + (h.grip[1][1] - h.grip[0][1]) * h.main)), k * (p[0] - (h.grip[0][0] + (h.grip[1][0] - h.grip[0][0]) * h.main))] as V3);
  const pistol = id.startsWith('pistol');
  const w = pistol ? 0.028 : 0.04;
  // Receiver / frame from the rear sight to the front.
  const rz0 = pistol ? s.back : s.sightR[2] + 0.04;
  const rz1 = pistol ? s.front : Math.max(s.front * 0.45, s.muzzle[2] + 0.3);
  const rh = pistol ? (top - grip[1][1]) * 0.55 : 0.06;
  add('body', box(w, rh, rz0 - rz1, [0, grip[1][1] + rh / 2, (rz0 + rz1) / 2]), POLY);
  add('body', along(grip[0], grip[1], w * 0.95, 0.035), id === 'rifle_ak' || id === 'rifle_hunting' ? WOOD : POLY);
  if (pistol) {
    const sh = top - (grip[1][1] + rh);
    add('slide', box(w, sh, s.back - s.front, [0, top - sh / 2, (s.back + s.front) / 2]), STEEL);
  } else {
    // Barrel and stock.
    add('body', new CylinderGeometry(0.011, 0.011, rz1 - s.muzzle[2], 8).rotateX(Math.PI / 2).translate(0, bore, (rz1 + s.muzzle[2]) / 2), STEEL);
    if (id !== 'launcher_rpg') add('body', box(w * 0.9, 0.09, s.back - rz0, [0, bore - 0.03, (s.back + rz0) / 2]), id === 'rifle_ak' || id === 'rifle_hunting' ? WOOD : POLY);
    else add('body', new CylinderGeometry(0.035, 0.035, s.back - s.muzzle[2], 10).rotateX(Math.PI / 2).translate(0, bore, (s.back + s.muzzle[2]) / 2), OLIVE);
    add('body', box(0.006, 0.02, 0.006, [0, s.sightF[1] - 0.01, s.sightF[2]]), STEEL);
    add('body', box(0.02, 0.02, 0.01, [0, s.sightR[1] - 0.01, s.sightR[2]]), STEEL);
  }
  if (h.fore && id !== 'launcher_rpg') add(id === 'shotgun_pump' ? 'pump' : 'body', box(w * 1.1, 0.05, 0.2, [0, s.off.at[1], s.off.at[2]]), id === 'rifle_ak' || id === 'rifle_hunting' ? WOOD : POLY);
  if (h.foreGrip) add('body', along(s.off.at.map((v, i) => v - [0, 0.05, 0][i]) as V3, s.off.at.map((v, i) => v + [0, 0.04, 0][i]) as V3, 0.03, 0.03), POLY);
  if (id === 'launcher_rpg') add('rocket', new CylinderGeometry(0.0, 0.045, 0.35, 10).rotateX(-Math.PI / 2).translate(0, bore, s.muzzle[2] - 0.17), OLIVE);
  return out;
}

/** The magazine as a stand-in (pistols always: theirs is inside the grip), its top at the origin. */
function magStandIn(id: GunId, s: GunSockets, ext: boolean): BufferGeometry {
  const h = HINTS[id];
  if (h.magWell) {
    const len = (new Vector3(...s.mag).length() / (1 - h.main)) * (ext ? 1.4 : 0.97);
    return along([0, 0, 0], [s.magOut[0] * len, s.magOut[1] * len, s.magOut[2] * len], 0.022, 0.03);
  }
  const len = ext ? 0.26 : 0.19;
  return box(0.024, len, 0.07, [0, -len / 2, 0]);
}

function modStandIn(id: ModId): BufferGeometry {
  switch (id) {
    case 'mod_suppressor':
      return new CylinderGeometry(0.017, 0.017, 0.165, 10).rotateX(Math.PI / 2).translate(0, 0, -0.0825);
    case 'mod_flashlight':
      return new CylinderGeometry(0.014, 0.016, 0.11, 10).rotateX(Math.PI / 2).translate(0, -0.016, 0);
    default:
      return box(0.024, 0.25, 0.07, [0, -0.125, 0]);
  }
}

const matCache = new Map<string, Material>();
function material(key: string, color: number, map: Texture | null, emissive = 0): Material {
  let m = matCache.get(key);
  if (!m) {
    m = new MeshLambertMaterial({ color: map ? 0xffffff : color, map, emissive });
    matCache.set(key, m);
  }
  return m;
}

/** Shared cartridge builder: gleaming brass casing + pointed copper bullet along −Z (m). */
function makeCartridge(len: number, radius: number): Group {
  const g = new Group();
  const caseLen = len * 0.62;
  const tipLen = len - caseLen;
  const brass = material('ammo:brass', 0xe6be53, null, 0x3b2d0a);
  const copper = material('ammo:copper', 0xd4743b, null, 0x331608);
  const c = new Mesh(new CylinderGeometry(radius, radius * 1.04, caseLen, 8).rotateX(Math.PI / 2).translate(0, 0, tipLen * 0.5), brass);
  const t = new Mesh(new CylinderGeometry(radius * 0.18, radius * 0.96, tipLen, 8).rotateX(-Math.PI / 2).translate(0, 0, -caseLen * 0.5), copper);
  g.add(c, t);
  return g;
}

/** Clean, closed 3D magazine mesh for AK/M4A1 with hollow side witness window (no jagged GLB cut triangles). */
function buildCleanRifleMag(id: 'rifle_ak' | 'rifle_m4a1', roundsOut: Object3D[], ammoGroup: Group): { body: Group; follower: Mesh } {
  const g = new Group();
  const ak = id === 'rifle_ak';
  const bodyMat = material(ak ? 'mag:ak:body' : 'mag:m4:body', ak ? 0x2f2926 : 0x26282a, null);
  const darkMat = material('mag:core', 0x151618, null);
  const ribMat = material('mag:rib', 0x1e2022, null);
  const folMat = material('ammo:follower', 0xc96c2a, null, 0x241004);

  if (ak) {
    // Upper straight neck inside receiver + feed lips collar.
    g.add(new Mesh(box(0.025, 0.048, 0.064, [0, -0.014, 0]), bodyMat));
    // Mid witness-window frame: thin central spine + front & rear rails so brass rounds shine clearly in the cutout.
    const mid = new Group();
    mid.position.set(0, -0.038, -0.002);
    mid.rotation.x = 0.14;
    mid.add(new Mesh(box(0.008, 0.088, 0.054, [0, -0.044, 0]), darkMat));
    mid.add(new Mesh(box(0.025, 0.088, 0.017, [0, -0.044, -0.023]), bodyMat));
    mid.add(new Mesh(box(0.025, 0.088, 0.017, [0, -0.044, 0.023]), bodyMat));
    for (const ry of [-0.018, -0.044, -0.070]) mid.add(new Mesh(box(0.027, 0.006, 0.066, [0, ry, 0]), ribMat));
    g.add(mid);
    // Lower curved section + angled steel floorplate.
    const low = new Group();
    low.position.set(0, -0.123, -0.014);
    low.rotation.x = 0.28;
    low.add(new Mesh(box(0.025, 0.062, 0.064, [0, -0.031, 0]), bodyMat));
    low.add(new Mesh(box(0.029, 0.011, 0.070, [0, -0.064, 0]), ribMat));
    g.add(low);

    // 2 top 7.62x39 brass rounds in feed lips + 6 witness-window rounds along both flanks.
    for (let i = 0; i < 2; i++) {
      const r = makeCartridge(0.046, 0.0046);
      r.position.set(i === 0 ? 0.003 : -0.003, 0.003 - i * 0.0065, -0.004);
      ammoGroup.add(r);
      roundsOut.push(r);
    }
    for (let i = 0; i < 6; i++) {
      const r = makeCartridge(0.036, 0.0042);
      r.position.set(0, -0.052 - i * 0.0115, -0.004 - i * 0.0018);
      r.rotation.x = 0.14;
      r.scale.set(2.8, 1, 1); // spans cleanly across both -X and +X open window flanks
      ammoGroup.add(r);
      roundsOut.push(r);
    }
    const follower = new Mesh(box(0.019, 0.008, 0.046, [0, 0.001, 0]), folMat);
    ammoGroup.add(follower);
    return { body: g, follower };
  }

  // M4A1 STANAG/PMAG: upper magwell collar, middle witness window, lower body, flared baseplate.
  g.add(new Mesh(box(0.024, 0.044, 0.062, [0, -0.012, 0]), bodyMat));
  g.add(new Mesh(box(0.008, 0.088, 0.050, [0, -0.078, 0]), darkMat));
  g.add(new Mesh(box(0.024, 0.088, 0.017, [0, -0.078, -0.022]), bodyMat));
  g.add(new Mesh(box(0.024, 0.088, 0.017, [0, -0.078, 0.022]), bodyMat));
  for (const ry of [-0.048, -0.078, -0.108]) g.add(new Mesh(box(0.026, 0.005, 0.064, [0, ry, 0]), ribMat));
  g.add(new Mesh(box(0.024, 0.046, 0.062, [0, -0.145, 0]), bodyMat));
  g.add(new Mesh(box(0.028, 0.011, 0.068, [0, -0.171, 0]), ribMat));

  // 2 top 5.56x45 brass rounds in feed lips + 6 stacked witness rounds visible in window.
  for (let i = 0; i < 2; i++) {
    const r = makeCartridge(0.044, 0.0042);
    r.position.set(i === 0 ? 0.003 : -0.003, 0.003 - i * 0.006, -0.004);
    ammoGroup.add(r);
    roundsOut.push(r);
  }
  for (let i = 0; i < 6; i++) {
    const r = makeCartridge(0.034, 0.0039);
    r.position.set(0, -0.044 - i * 0.0125, 0);
    r.scale.set(2.7, 1, 1);
    ammoGroup.add(r);
    roundsOut.push(r);
  }
  const follower = new Mesh(box(0.018, 0.008, 0.044, [0, 0.001, 0]), folMat);
  ammoGroup.add(follower);
  return { body: g, follower };
}

/** Remove stray receiver boundary cut spikes dangling below the M4A1 magwell collar. */
function cleanMagwellSpikes(geo: BufferGeometry, mag: V3): BufferGeometry {
  const idx = geo.index;
  const pos = geo.getAttribute('position');
  if (!idx || !pos) return geo;
  const keep: number[] = [];
  const yCut = mag[1] - 0.004;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const minY = Math.min(pos.getY(a), pos.getY(b), pos.getY(c));
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    if (minY < yCut && Math.abs(cx) < 0.028 && Math.abs(cz - mag[2]) < 0.056) continue;
    keep.push(a, b, c);
  }
  if (keep.length === idx.count) return geo;
  const clean = geo.clone();
  clean.setIndex(keep);
  return clean;
}

const MAG_PART: Partial<Record<GunId, string>> = {
  pistol_g17: 'mag_pistol_g17',
  pistol_m1911: 'mag_pistol_m1911',
  rifle_ak: 'mag_ak',
  rifle_m4a1: 'mag_m4',
};

const RIFLE_BOLT_PART: Partial<Record<GunId, string>> = {
  rifle_ak: 'bolt_ak',
  rifle_m4a1: 'bolt_m4a1',
};

const _downY = new Vector3(0, -1, 0);
const _magOutDir = new Vector3();

/** Loads a standalone auxiliary weapon part mesh & texture (e.g. pistol mag, rifle bolt, 12g shell) when present. */
export async function loadWeaponPart(id: string): Promise<{ geo: BufferGeometry; map: Texture | null } | null> {
  const geos = await loadFile(id);
  const geo = geos?.body ?? (geos ? Object.values(geos)[0] : null);
  if (!geo) return null;
  return { geo, map: textureOf(id) };
}

/** Shared textured/colored material matching weapon parts. */
export function weaponPartMaterial(key: string, color: number, map: Texture | null): Material {
  return material(key, color, map);
}

/** A gun in the gun frame, its moving parts and modules; the model takes the stand-in's place when loaded. */
export class GunModel {
  readonly root = new Group();
  readonly sockets: GunSockets;
  /** Moving parts, pivoted at their sockets (mag at the magazine socket; the others at the origin). */
  readonly parts: Record<'body' | 'mag' | 'slide' | 'pump' | 'rocket', Group>;
  /** Visible gleaming cartridges inside the magazine (feed lips + side witness window). */
  readonly magAmmoGroup = new Group();
  /** Pivoted bolt/charging-handle subgroup under `parts.slide` for lift + reciprocation. */
  private readonly boltPivot = new Group();
  /** Internal breech cartridges visible when hunting rifle bolt is open. */
  private readonly breechGroup = new Group();
  private readonly magRounds: Object3D[] = [];
  private readonly breechRounds: Object3D[] = [];
  private magFollower: Mesh | null = null;
  private magCount = 99;
  private magCap = 99;
  private breechOpen = false;
  /** The module models on their sockets. */
  private readonly modMeshes = new Map<ModId, Object3D>();
  private mods: readonly ModId[] = [];
  /** The model's own magazine (hidden under an extended one). */
  private magOwn: Group = new Group();
  private magExt: Object3D | null = null;
  private meshyMagLoaded = false;
  private hasExtMag = false;
  private loaded = false;
  /** Called whenever an async GLB mesh, part, module, or texture finishes loading. */
  onChange: (() => void) | null = null;

  constructor(readonly id: GunId) {
    this.sockets = gunSockets(id);
    const mk = (name: string) => {
      const g = new Group();
      g.name = name;
      this.root.add(g);
      return g;
    };
    this.parts = { body: mk('body'), mag: mk('mag'), slide: mk('slide'), pump: mk('pump'), rocket: mk('rocket') };
    this.parts.mag.position.set(...this.sockets.mag);
    this.parts.mag.add(this.magOwn);
    this.magAmmoGroup.name = 'magAmmo';
    this.parts.mag.add(this.magAmmoGroup);
    this.boltPivot.name = 'boltPivot';
    const boltX = id === 'rifle_m4a1' ? 0 : id === 'rifle_hunting' ? 0.006 : id === 'rifle_ak' ? 0.012 : this.sockets.bolt[0];
    this.boltPivot.position.set(boltX, this.sockets.bolt[1], this.sockets.bolt[2]);
    this.parts.slide.add(this.boltPivot);
    this.fillStandIn();
    if (id === 'rifle_m4a1' || id === 'rifle_ak') {
      this.magOwn.clear();
      const built = buildCleanRifleMag(id, this.magRounds, this.magAmmoGroup);
      this.magOwn.add(built.body);
      this.magFollower = built.follower;
    } else if (id === 'pistol_g17' || id === 'pistol_m1911') {
      _magOutDir.set(...this.sockets.magOut).normalize();
      this.magAmmoGroup.quaternion.setFromUnitVectors(_downY, _magOutDir);
      // 2 top feed-lip rounds + 5 side witness window markers for pistols (kept subtle when Meshy GLB loads).
      for (let i = 0; i < 2; i++) {
        const r = makeCartridge(0.028, 0.0044);
        r.position.set(i === 0 ? 0.001 : -0.002, 0.002 - i * 0.0055, -0.002);
        this.magAmmoGroup.add(r);
        this.magRounds.push(r);
      }
      for (let i = 0; i < 5; i++) {
        const w = makeCartridge(0.022, 0.0036);
        w.position.set(0, -0.026 - i * 0.0135, 0);
        w.scale.set(2.55, 1, 1);
        this.magAmmoGroup.add(w);
        this.magRounds.push(w);
      }
      this.magFollower = new Mesh(box(0.016, 0.007, 0.024, [0, 0.001, 0]), material('ammo:follower', 0xc96c2a, null, 0x241004));
      this.magAmmoGroup.add(this.magFollower);
    }
    if (id === 'rifle_hunting') {
      this.breechGroup.name = 'breechAmmo';
      this.breechGroup.position.set(0, this.sockets.load[1] - 0.012, this.sockets.load[2]);
      this.breechGroup.visible = false;
      for (let i = 0; i < 5; i++) {
        const r = makeCartridge(0.056, 0.0048);
        r.position.set((i % 2 === 0 ? 0.0025 : -0.0025), -Math.floor(i / 2) * 0.006, 0);
        this.breechGroup.add(r);
        this.breechRounds.push(r);
      }
      this.parts.body.add(this.breechGroup);
    }
    this.setMagFill(99, 99);
    void loadFile(id).then((geo) => geo && this.fillModel(geo));
    const magPartId = MAG_PART[id];
    if (magPartId) {
      void loadWeaponPart(magPartId).then((part) => {
        if (!part) return;
        this.magOwn.clear();
        const matKey = `${magPartId}:${part.map ? 't' : 'c'}`;
        const fallbackCol = HINTS[id].magWell ? POLY : STEEL;
        const mesh = new Mesh(part.geo, material(matKey, fallbackCol, part.map));
        if (id === 'rifle_ak') mesh.position.y = 0.026;
        else if (id === 'rifle_m4a1') mesh.position.y = 0.024;
        if (HINTS[id].magWell) {
          _magOutDir.set(...this.sockets.magOut).normalize();
          mesh.quaternion.setFromUnitVectors(_downY, _magOutDir);
        }
        this.magOwn.add(mesh);
        this.meshyMagLoaded = true;
        this.refreshMagRounds();
        onTextureReady(magPartId, () => this.onChange?.());
        this.onChange?.();
      });
    }
    const boltPartId = RIFLE_BOLT_PART[id];
    if (boltPartId) {
      this.fillBoltFallback();
      void loadWeaponPart(boltPartId).then((part) => {
        if (!part) return;
        this.boltPivot.clear();
        this.boltPivot.add(new Mesh(part.geo, material(`${boltPartId}:${part.map ? 't' : 'c'}`, STEEL, part.map)));
        onTextureReady(boltPartId, () => this.onChange?.());
        this.onChange?.();
      });
    }
  }

  /** Number of currently visible round meshes inside the magazine. */
  get visibleMagRounds(): number {
    let n = 0;
    for (const r of this.magRounds) if (r.visible) n++;
    return n;
  }

  /** Number of currently visible rounds inside the hunting rifle's open breech. */
  get visibleBreechRounds(): number {
    if (!this.breechGroup.visible) return 0;
    let n = 0;
    for (const r of this.breechRounds) if (r.visible) n++;
    return n;
  }

  /** Whether the empty follower plate is currently visible at the top of the magazine. */
  get followerVisible(): boolean {
    return !!this.magFollower?.visible;
  }

  /** Update visible cartridges inside the magazine / internal hunting breech from live ammo count. */
  setMagFill(mag: number, capacity: number): void {
    this.magCount = Math.max(0, Math.round(mag));
    this.magCap = Math.max(1, capacity);
    this.refreshMagRounds();
    this.refreshBreech();
  }

  private refreshMagRounds(): void {
    const meshy = this.meshyMagLoaded || this.hasExtMag;
    if (this.magRounds.length > 0) {
      const top0 = this.magRounds[0];
      const top1 = this.magRounds[1];
      if (top0) {
        top0.visible = this.magCount >= 1;
        // Let the sculpted brass cartridge in Meshy GLBs show through cleanly while keeping a recessed anchor.
        top0.scale.setScalar(meshy ? 0.35 : 1);
        top0.position.y = meshy ? -0.008 : 0.003;
      }
      if (top1) top1.visible = !meshy && this.magCount >= 2;
      const winSlots = Math.max(0, this.magRounds.length - 2);
      const winCount = this.magCount <= 0 ? 0 : Math.ceil((Math.min(this.magCount, this.magCap) / this.magCap) * winSlots);
      for (let i = 0; i < winSlots; i++) this.magRounds[i + 2].visible = !meshy && i < winCount;
    }
    if (this.magFollower) {
      this.magFollower.visible = this.magCount === 0;
      this.magFollower.position.y = meshy ? -0.002 : 0.001;
    }
  }

  /** Show/hide internal .308 cartridges in the hunting rifle's open receiver port. */
  setBreechOpen(open: boolean): void {
    if (this.breechOpen === open) return;
    this.breechOpen = open;
    this.refreshBreech();
  }

  private refreshBreech(): void {
    if (!this.breechRounds.length) return;
    const show = Math.min(this.breechRounds.length, this.magCount);
    this.breechGroup.visible = this.breechOpen && show > 0;
    for (let i = 0; i < this.breechRounds.length; i++) this.breechRounds[i].visible = this.breechOpen && i < show;
  }

  /** Rotate the bolt handle upward (0 = closed, 1 = lifted 60 deg for bolt-action extraction/inspection). */
  setBoltLift(lift: number): void {
    this.boltPivot.rotation.z = lift * (Math.PI / 3);
  }

  /** Which modules show (only the ones that fit). */
  setMods(mods: readonly ModId[]): void {
    this.mods = mods.filter((m) => MOD_FITS[m].includes(this.id));
    for (const [id, m] of this.modMeshes) m.visible = this.mods.includes(id);
    for (const id of this.mods) if (!this.modMeshes.has(id)) this.addMod(id);
    const ext = this.mods.find((m) => MODS[m].slot === 'mag') ?? null;
    this.hasExtMag = !!ext;
    this.magOwn.visible = !ext;
    if (this.magExt) this.magExt.visible = !!ext;
    this.refreshMagRounds();
  }

  /** Where the muzzle ends now (the suppressor's front with one on), gun frame. */
  muzzle(out: Vector3): Vector3 {
    out.set(...this.sockets.muzzle);
    if (this.mods.includes('mod_suppressor')) out.z -= 0.165;
    return out;
  }

  private addMod(id: ModId): void {
    const holder = new Group();
    const s = this.sockets;
    if (MODS[id].slot === 'mag') this.parts.mag.add(holder);
    else this.root.add(holder);
    if (id === 'mod_suppressor') holder.position.set(...s.muzzle);
    else if (id === 'mod_flashlight') holder.position.set(...s.light);
    const fill = (geo: BufferGeometry, map: Texture | null, alignWell = false) => {
      holder.clear();
      const mesh = new Mesh(geo, material(`${id}:${map ? 't' : 'c'}`, id === 'mod_flashlight' ? STEEL : POLY, map));
      if (alignWell) {
        if (id === 'mod_ext_mag_ak') mesh.position.y = 0.026;
        else if (id === 'mod_ext_mag_m4') mesh.position.y = 0.024;
        if (id.startsWith('mod_ext_mag') && HINTS[this.id].magWell) {
          _magOutDir.set(...s.magOut).normalize();
          mesh.quaternion.setFromUnitVectors(_downY, _magOutDir);
        }
      }
      holder.add(mesh);
    };
    fill(id.startsWith('mod_ext_mag') ? magStandIn(this.id, s, true) : modStandIn(id), null, false);
    void loadFile(id).then((geo) => {
      if (!geo?.body) return;
      fill(geo.body, textureOf(id), true);
      onTextureReady(id, () => this.onChange?.());
      this.onChange?.();
    });
    this.modMeshes.set(id, holder);
    if (MODS[id].slot === 'mag') {
      this.magExt = holder;
      holder.visible = true;
      this.magOwn.visible = false;
    }
  }

  private fillStandIn(): void {
    const parts = standIn(this.id, this.sockets);
    for (const [name, list] of Object.entries(parts)) {
      const target = this.parts[name as keyof GunModel['parts']];
      for (const { geo, color } of list) target.add(new Mesh(geo, material(`c${color}`, color, null)));
    }
    if ((HINTS[this.id].mag || HINTS[this.id].magWell) && this.id !== 'rifle_m4a1' && this.id !== 'rifle_ak') {
      this.magOwn.add(new Mesh(magStandIn(this.id, this.sockets, false), material(`c${POLY}`, POLY, null)));
    }
  }

  private fillBoltFallback(): void {
    const boltMat = material(`c${STEEL}`, STEEL, null);
    if (this.id === 'rifle_ak') {
      this.boltPivot.add(new Mesh(box(0.012, 0.014, 0.07, [0, 0, 0]), boltMat));
      this.boltPivot.add(new Mesh(box(0.018, 0.008, 0.012, [0.012, 0, 0.018]), boltMat));
    } else if (this.id === 'rifle_m4a1') {
      this.boltPivot.add(new Mesh(box(0.036, 0.012, 0.065, [0, 0, 0]), boltMat));
    }
  }

  private fillModel(geo: Record<string, BufferGeometry>): void {
    if (this.loaded) return;
    this.loaded = true;
    const map = textureOf(this.id);
    const mat = material(`${this.id}:t`, STEEL, map);
    for (const name of ['body', 'slide', 'pump', 'rocket'] as const) this.parts[name].clear();
    this.parts.slide.add(this.boltPivot);
    if (this.id === 'rifle_hunting') this.parts.body.add(this.breechGroup);
    for (const [name, rawGeo] of Object.entries(geo)) {
      if (name === 'mag') {
        // Keep clean procedural rifle mags with brass witness windows on AK/M4A1 (avoid ragged GLB box-cut spikes).
        if (this.id === 'rifle_m4a1' || this.id === 'rifle_ak') continue;
        const m = new Mesh(rawGeo, mat);
        this.magOwn.clear();
        m.position.set(-this.sockets.mag[0], -this.sockets.mag[1], -this.sockets.mag[2]);
        this.magOwn.add(m);
      } else {
        const g = name === 'body' && this.id === 'rifle_m4a1' ? cleanMagwellSpikes(rawGeo, this.sockets.mag) : rawGeo;
        this.parts[name as 'body']?.add(new Mesh(g, mat));
      }
    }
    onTextureReady(this.id, () => this.onChange?.());
    this.onChange?.();
  }
}
