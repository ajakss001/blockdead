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
    t = new TextureLoader().load(`${import.meta.env?.BASE_URL ?? '/'}models/weapons/${id}_${texSize}.webp`);
    t.colorSpace = SRGBColorSpace;
    t.flipY = false;
    textures.set(id, t);
  }
  return t;
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
function material(key: string, color: number, map: Texture | null): Material {
  let m = matCache.get(key);
  if (!m) {
    m = new MeshLambertMaterial({ color: map ? 0xffffff : color, map });
    matCache.set(key, m);
  }
  return m;
}

/** A gun in the gun frame, its moving parts and modules; the model takes the stand-in's place when loaded. */
export class GunModel {
  readonly root = new Group();
  readonly sockets: GunSockets;
  /** Moving parts, pivoted at their sockets (mag at the magazine socket; the others at the origin). */
  readonly parts: Record<'body' | 'mag' | 'slide' | 'pump' | 'rocket', Group>;
  /** The module models on their sockets. */
  private readonly modMeshes = new Map<ModId, Object3D>();
  private mods: readonly ModId[] = [];
  /** The model's own magazine (hidden under an extended one). */
  private magOwn: Group = new Group();
  private magExt: Object3D | null = null;
  private loaded = false;

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
    this.fillStandIn();
    void loadFile(id).then((geo) => geo && this.fillModel(geo));
  }

  /** Which modules show (only the ones that fit). */
  setMods(mods: readonly ModId[]): void {
    this.mods = mods.filter((m) => MOD_FITS[m].includes(this.id));
    for (const [id, m] of this.modMeshes) m.visible = this.mods.includes(id);
    for (const id of this.mods) if (!this.modMeshes.has(id)) this.addMod(id);
    const ext = this.mods.find((m) => MODS[m].slot === 'mag') ?? null;
    this.magOwn.visible = !ext;
    if (this.magExt) this.magExt.visible = !!ext;
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
    const fill = (geo: BufferGeometry, map: Texture | null) => {
      holder.clear();
      holder.add(new Mesh(geo, material(`${id}:${map ? 't' : 'c'}`, id === 'mod_flashlight' ? STEEL : POLY, map)));
    };
    fill(id.startsWith('mod_ext_mag') ? magStandIn(this.id, s, true) : modStandIn(id), null);
    void loadFile(id).then((geo) => geo?.body && fill(geo.body, textureOf(id)));
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
    if (HINTS[this.id].mag || HINTS[this.id].magWell) {
      this.magOwn.add(new Mesh(magStandIn(this.id, this.sockets, false), material(`c${POLY}`, POLY, null)));
    }
  }

  private fillModel(geo: Record<string, BufferGeometry>): void {
    if (this.loaded) return;
    this.loaded = true;
    const map = textureOf(this.id);
    const mat = material(`${this.id}:t`, STEEL, map);
    for (const name of ['body', 'slide', 'pump', 'rocket'] as const) this.parts[name].clear();
    for (const [name, g] of Object.entries(geo)) {
      const m = new Mesh(g, mat);
      if (name === 'mag') {
        this.magOwn.clear();
        m.position.set(-this.sockets.mag[0], -this.sockets.mag[1], -this.sockets.mag[2]);
        this.magOwn.add(m);
      } else this.parts[name as 'body']?.add(m);
    }
  }
}
