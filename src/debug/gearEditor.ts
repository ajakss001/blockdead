import { AxesHelper, DirectionalLight, Euler, HemisphereLight, Matrix4, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Quaternion, Scene, SkinnedMesh, SphereGeometry, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { BODY_IDS, type BodyId, bodyAsset, type ClipId, costumeBody, loadBody } from '../characters/assets';
import { coverBody, gearFitBone, gearFitChanged, gearGeometry, gearKind, gearMiddle, gearTexture, hideBits, loadGear, loadGearMeta } from '../characters/gear';
import { boneBind, GEAR_FIT, type PieceFit, type Region, REGION_NAMES, REGIONS, type V3 } from '../characters/gearFit';
import { characterMaterial, LENS_TINT } from '../characters/material';
import { CharacterRig } from '../characters/rig';
import { type GearId, ITEMS } from '../data/items';
import { inwardShare, posed, throughPiece } from './gearMeasure';
import { applyStage } from './viewerStage';

/**
 * The gear editor, ?gearedit=<gear|outfit|body> (dev): a body in the game's light (grim, overcast) wearing a
 * kit, an orbit view with front / side / back presets. A gizmo moves and turns the edited piece in its bone's
 * frame (Head, Spine2, Hips…), sliders scale it and push its surface out from the body; for glasses and
 * masks the nose bridge (the pivot) and the ears are points to drag, «Посадить по опорам» puts the glasses'
 * bridge and temples on them. Checkboxes: the body regions the piece hides. Body, pose and the rest of the
 * kit worn at once (helmet + glasses + mask + vest) to see overlaps. «Сохранить» writes src/data/gearFit.json
 * (characters/gearFit.ts: data, no code; the game applies it in characters/gear), «Сбросить» goes back to the
 * last save. Readout per piece worn: how much of the body comes through it (test:gear's rule) and the share of
 * its faces turned inside out.
 */

type Target = 'piece' | 'pivot' | 'earL' | 'earR';
const GEAR: GearId[] = ['helmet_military', 'helmet_swat', 'helmet_firefighter', 'helmet_construction', 'glasses_ballistic', 'goggles_tactical', 'balaclava', 'shemagh', 'mask_half', 'vest_military', 'vest_swat', 'backpack_military', 'backpack_school', 'backpack_hiking', 'bag_medic', 'toolbox_mechanic'];
const POSES: { clip: ClipId; name: string }[] = [
  { clip: 'idle', name: 'стоит' },
  { clip: 'walking', name: 'идёт' },
  { clip: 'running', name: 'бежит' },
  { clip: 'crouched_walking', name: 'присел' },
  { clip: 'zombie_walk', name: 'зомби' },
];
const BONES = ['', 'Head', 'Neck', 'Spine2', 'Spine1', 'Spine', 'Hips'];
const BODY_NAMES: Record<BodyId, string> = { male: 'мужчина', female: 'женщина', swat_m: 'SWAT', military_m: 'военный', police_m: 'полицейский', firefighter_m: 'пожарный', doctor_m: 'врач', mechanic_m: 'механик', builder_m: 'строитель', juggernaut_m: 'громила', patientZero_m: 'пациент 0' };
const DEG = 180 / Math.PI;
const FACE_KINDS = ['glasses', 'mask'];

const gearName = (g: GearId) => Object.values(ITEMS).find((i) => i.wear?.gear === g)?.name ?? g;

const CSS = `
body{margin:0;background:#2a2c2b;color:#d6d4ca;font:13px system-ui,sans-serif;overflow:hidden}
.ge{display:grid;grid-template-columns:1fr 330px;height:100vh}
.ge__view{position:relative;min-width:0}
.ge canvas{display:block;width:100%;height:100%}
.ge__label{position:absolute;left:6px;top:4px;font:11px monospace;color:#ddd;pointer-events:none}
.ge__presets{position:absolute;left:6px;bottom:6px;display:flex;gap:4px}
.ge__panel{padding:10px;overflow:auto;background:#222423;border-left:1px solid #444}
.ge__panel h3{margin:12px 0 6px;font-size:12px;text-transform:uppercase;color:#9a988e}
.ge__row{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;align-items:center}
.ge button,.ge select{background:#3a3c3a;color:#d6d4ca;border:1px solid #555;border-radius:3px;padding:4px 8px;font:inherit;cursor:pointer}
.ge button.on{background:#6b7a5a;border-color:#8a9a72}
.ge button:disabled{opacity:.35;cursor:default}
.ge label{display:flex;gap:6px;align-items:center}
.ge label.wide{width:100%}
.ge input[type=range]{flex:1}
.ge__out{font:11px/1.45 monospace;white-space:pre;color:#bdbbb0}
.ge__bad{color:#c08060}
.ge__msg{min-height:16px;color:#a8b890}
`;

export async function startGearEditor(first: string | null): Promise<void> {
  for (const k of ['game', 'ui', 'loading', 'rotate']) document.getElementById(k)?.remove();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'ge';
  root.innerHTML = `<div class="ge__view"><div class="ge__label">мышь: вращать, колесо: ближе, правая: сдвинуть · W двигать, E вращать</div><div class="ge__presets"></div></div><div class="ge__panel"></div>`;
  document.body.append(root);
  const view = root.querySelector<HTMLElement>('.ge__view')!;
  const presets = root.querySelector<HTMLElement>('.ge__presets')!;
  const panel = root.querySelector<HTMLElement>('.ge__panel')!;

  // ── What to open: a piece (on the man), an outfit (its costume, the helmet), a body ──
  let id: GearId = 'helmet_military';
  let body: BodyId = 'male';
  if (first && (GEAR as string[]).includes(first)) id = first as GearId;
  else if (first && first in ITEMS && ITEMS[first as keyof typeof ITEMS].wear?.costume) body = costumeBody(ITEMS[first as keyof typeof ITEMS].wear!.costume, 'male');
  else if (first && (BODY_IDS as readonly string[]).includes(first)) body = first as BodyId;
  const kit = new Set<GearId>([id]);
  let clip: ClipId = 'idle';
  let clipT = 0;
  let target: Target = 'piece';

  // ── Scene: the game's light and fog ──
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  view.prepend(renderer.domElement);
  const scene = new Scene();
  const hemi = new HemisphereLight();
  const sun = new DirectionalLight();
  sun.position.set(1.5, 3, 2);
  scene.add(hemi, sun);
  applyStage({ scene, hemi, sun, renderer, toy: { bg: 0x5e6366, hemi: [0x6e747a, 0x3a3830, 1.2], sun: [0xb8bcc0, 1] }, fog: 0.01 });
  const cam = new PerspectiveCamera(30, 1, 0.02, 30);
  const orbit = new OrbitControls(cam, renderer.domElement);
  orbit.target.set(0, 1.6, 0);
  cam.position.set(0, 1.65, 1.2);
  orbit.update();

  // ── The figure ──
  const hide = { value: 0 };
  let rig: CharacterRig | null = null;
  const meshes = new Map<string, SkinnedMesh>();
  const figure = new Object3D();
  scene.add(figure);

  const fitNow = (): PieceFit => ((GEAR_FIT[id] ??= {})[body] ??= {});
  const fitIfAny = (): PieceFit | undefined => GEAR_FIT[id]?.[body];
  const isFace = () => FACE_KINDS.includes(gearKind(id) ?? '');

  async function setBody(b: BodyId): Promise<void> {
    if (!(await loadBody(b))) {
      say(`Тело ${b} не загрузилось — осталось ${body}`);
      return;
    }
    body = b;
    await loadGear(b, [...kit]);
    coverBody(b);
    dropMeshes();
    if (rig) {
      figure.remove(rig.root);
      rig.dispose();
    }
    rig = new CharacterRig(b, 0, { cover: true, hide });
    figure.add(rig.root);
    dress();
    pose();
  }

  function dropMeshes(): void {
    for (const m of meshes.values()) {
      m.removeFromParent();
      (m.material as { dispose(): void }).dispose();
    }
    meshes.clear();
  }

  /** The kit on the body, built again from the fits (call after gearFitChanged). */
  function dress(retry = true): void {
    const r = rig!;
    dropMeshes();
    const missing: GearId[] = [];
    for (const g of kit) {
      const geo = gearGeometry(body, g, 0);
      if (!geo) {
        missing.push(g);
        continue;
      }
      const add = (key: string, m: SkinnedMesh) => {
        m.bind(r.mesh.skeleton, r.mesh.bindMatrix);
        m.frustumCulled = false;
        r.mesh.add(m);
        meshes.set(key, m);
      };
      add(g, new SkinnedMesh(geo, characterMaterial(bodyAsset(body), r.rig, { map: gearTexture(g), doubleSide: gearKind(g) === 'mask' })));
      const lg = gearGeometry(body, g, 0, 'lens');
      if (lg) {
        const l = new SkinnedMesh(lg, characterMaterial(bodyAsset(body), r.rig, { lens: LENS_TINT[g] ?? 0x1e1f1d }));
        l.renderOrder = 2;
        add(`${g}:lens`, l);
      }
    }
    // Nothing hidden under a piece that is not drawn, nor (while it is dragged) under the edited one.
    const shown = [...kit].filter((g) => !missing.includes(g) && !(dragging && g === id));
    hide.value = hideBits(shown);
    if (!missing.length) return;
    // Once more after loading (a later turn, never a loop: a file that does not load is reported).
    const b = body;
    if (retry) void loadGear(b, missing).then(() => setTimeout(() => body === b && (coverBody(b), dress(false), pose(), measureSoon()), 0));
    else say(`Не загрузилось на ${b}: ${missing.join(', ')}`);
  }

  function pose(): void {
    const r = rig!;
    const dur = r.action(clip).getClip().duration;
    r.hold(clip, clipT * dur);
    r.root.updateMatrixWorld(true);
  }

  /** The fits changed: the pieces built again, the readout redone. */
  function refit(): void {
    // While dragging: the pieces only (the cover once it is let go; meanwhile nothing hidden under the piece).
    gearFitChanged(!dragging);
    dress();
    pose();
    placeProxy();
    measureSoon();
    showValues();
  }

  // ── The gizmo: the piece's handle (its pivot in its bone's frame) or an anchor ──
  const proxy = new Object3D();
  proxy.add(new AxesHelper(0.08));
  scene.add(proxy);
  const gizmo = new TransformControls(cam, renderer.domElement);
  gizmo.setSpace('local');
  gizmo.setSize(0.7);
  gizmo.attach(proxy);
  scene.add(gizmo.getHelper());
  let dragging = false;
  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    dragging = !!e.value;
    if (!e.value) {
      writeBack();
      measureSoon();
    }
  });
  gizmo.addEventListener('objectChange', () => dragging && writeBack());
  // The anchors seen as small dots.
  const dots = new Map<Target, Mesh>();
  for (const [t, c] of [['pivot', 0x8a9a72], ['earL', 0x8a7a5a], ['earR', 0x8a7a5a]] as const) {
    const d = new Mesh(new SphereGeometry(0.006, 10, 8), new MeshBasicMaterial({ color: c, depthTest: false }));
    d.renderOrder = 5;
    dots.set(t, d);
    scene.add(d);
  }

  const bone = () => rig!.bone(gearFitBone(body, id));
  const bindOf = () => boneBind(bodyAsset(body).lod0, gearFitBone(body, id));
  const pivotBind = (): Vector3 => (fitIfAny()?.pivot ? new Vector3(...fitIfAny()!.pivot!) : gearMiddle(body, id).clone());
  /** Bind space → the bone's frame (local) and the posed world. */
  const toLocal = (p: Vector3) => p.clone().applyMatrix4(bindOf().clone().invert());
  const toWorld = (p: Vector3) => toLocal(p).applyMatrix4(bone().matrixWorld);
  const fromWorld = (p: Vector3) => p.clone().applyMatrix4(bone().matrixWorld.clone().invert()).applyMatrix4(bindOf());

  function anchor(t: Target): Vector3 | null {
    const f = fitIfAny();
    if (t === 'pivot') return pivotBind();
    const a = t === 'earL' ? f?.earL : t === 'earR' ? f?.earR : undefined;
    return a ? new Vector3(...a) : null;
  }

  function placeProxy(): void {
    if (dragging || !rig) return;
    rig.root.updateMatrixWorld(true);
    for (const [t, d] of dots) {
      const a = isFace() || t === 'pivot' ? anchor(t) : null;
      d.visible = !!a;
      if (a) d.position.copy(toWorld(a));
    }
    if (target === 'piece') {
      const f = fitIfAny();
      const local = new Matrix4().compose(toLocal(pivotBind()).add(new Vector3(...(f?.pos ?? [0, 0, 0]))), f?.rot ? new Quaternion(...f.rot) : new Quaternion(), new Vector3(1, 1, 1));
      new Matrix4().multiplyMatrices(bone().matrixWorld, local).decompose(proxy.position, proxy.quaternion, proxy.scale);
    } else {
      const a = anchor(target) ?? defaultAnchors()[target === 'earL' ? 'earL' : target === 'earR' ? 'earR' : 'pivot'];
      proxy.position.copy(toWorld(a));
      bone().getWorldQuaternion(proxy.quaternion);
      proxy.scale.set(1, 1, 1);
    }
    proxy.updateMatrixWorld(true);
  }

  function writeBack(): void {
    proxy.updateMatrixWorld(true);
    const f = fitNow();
    if (target === 'piece') {
      const local = new Matrix4().multiplyMatrices(bone().matrixWorld.clone().invert(), proxy.matrixWorld);
      const t = new Vector3(), q = new Quaternion(), s = new Vector3();
      local.decompose(t, q, s);
      f.pos = t.sub(toLocal(pivotBind())).toArray() as V3;
      f.rot = [q.x, q.y, q.z, q.w];
    } else if (target === 'pivot') {
      setPivot(fromWorld(proxy.position));
    } else {
      f[target] = fromWorld(proxy.position).toArray() as V3;
    }
    refit();
  }

  /** A new pivot without moving the piece: pos' = pos + (I − RS)(p − p') in the bone's frame. */
  function setPivot(p: Vector3): void {
    const f = fitNow();
    const pl = toLocal(pivotBind()), pl2 = toLocal(p);
    const d = pl.clone().sub(pl2);
    const rs = d.clone().applyQuaternion(f.rot ? new Quaternion(...f.rot) : new Quaternion()).multiplyScalar(f.scale ?? 1);
    f.pos = new Vector3(...(f.pos ?? [0, 0, 0])).add(d).sub(rs).toArray() as V3;
    f.pivot = p.toArray() as V3;
  }

  /** The body's nose bridge and ears guessed from its head (bind): a start for the anchors. */
  const guessed = new Map<BodyId, { pivot: Vector3; earL: Vector3; earR: Vector3 }>();
  function defaultAnchors(): { pivot: Vector3; earL: Vector3; earR: Vector3 } {
    let g = guessed.get(body);
    if (!g) guessed.set(body, (g = guessAnchors()));
    return { pivot: g.pivot.clone(), earL: g.earL.clone(), earR: g.earR.clone() };
  }
  function guessAnchors(): { pivot: Vector3; earL: Vector3; earR: Vector3 } {
    const a = bodyAsset(body).lod0;
    const P = a.geometry.getAttribute('position'), J = a.geometry.getAttribute('skinIndex'), W = a.geometry.getAttribute('skinWeight');
    const head = a.index.get('Head') ?? -1;
    const pts: Vector3[] = [];
    for (let i = 0; i < P.count; i++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (W.getComponent(i, k) > W.getComponent(i, best)) best = k;
      if (J.getComponent(i, best) === head) pts.push(new Vector3().fromBufferAttribute(P, i));
    }
    if (!pts.length) return { pivot: gearMiddle(body, id).clone(), earL: gearMiddle(body, id).clone(), earR: gearMiddle(body, id).clone() };
    const mid = pts.filter((p) => Math.abs(p.x) < 0.01);
    const tip = mid.reduce((b, p) => (p.z > b.z ? p : b), mid[0] ?? pts[0]);
    // The bridge: on the skin of the nose's ridge ~6.5 cm over its tip (low-poly heads have no clear sellion).
    const want = tip.y + 0.065;
    const ridge = mid.filter((p) => Math.abs(p.y - want) < 0.015 && p.z > tip.z - 0.05);
    const bridge = ridge.length ? ridge.reduce((b, p) => (Math.abs(p.y - want) - p.z < Math.abs(b.y - want) - b.z ? p : b)) : tip.clone().add(new Vector3(0, 0.065, -0.02));
    // The ears: the head's sides a little under the bridge, well behind it.
    const level = pts.filter((p) => Math.abs(p.y - (bridge.y - 0.015)) < 0.02 && p.z < bridge.z - 0.07);
    const earL = level.reduce((b, p) => (p.x > b.x ? p : b), level[0] ?? bridge);
    const earR = level.reduce((b, p) => (p.x < b.x ? p : b), level[0] ?? bridge);
    return { pivot: bridge.clone(), earL: earL.clone(), earR: earR.clone() };
  }

  /**
   * Glasses on the anchors: their bridge (the middle of the front, up top) on the nose bridge, their temples'
   * ends towards the ears, scaled to the ears' width (0.85–1.2).
   */
  function seat(): string {
    const f = fitNow();
    const d = defaultAnchors();
    const nose = new Vector3(...(f.pivot ?? d.pivot.toArray())), eL = new Vector3(...(f.earL ?? d.earL.toArray())), eR = new Vector3(...(f.earR ?? d.earR.toArray()));
    f.pivot = nose.toArray() as V3;
    f.earL = eL.toArray() as V3;
    f.earR = eR.toArray() as V3;
    const raw = gearGeometry(body, id, 0, 'main', true);
    if (!raw) return 'не загружено';
    const P = raw.getAttribute('position');
    const pts: Vector3[] = [];
    for (let i = 0; i < P.count; i++) pts.push(new Vector3().fromBufferAttribute(P, i));
    raw.dispose();
    const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) lo.min(p), hi.max(p);
    const cx = (lo.x + hi.x) / 2;
    const front = pts.filter((p) => Math.abs(p.x - cx) < 0.012 && p.z > (lo.z + hi.z) / 2);
    const back = pts.filter((p) => p.z < lo.z + 0.015);
    const mean = (l: Vector3[]) => l.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / Math.max(1, l.length));
    const tL = mean(back.filter((p) => p.x > cx)), tR = mean(back.filter((p) => p.x <= cx));
    if (!front.length || !back.length) return 'не нашёл переносицу или дужки';
    // The piece's bridge: the bottom of its nose notch (the lowest middle point of the front), its inner side.
    const notchY = Math.min(...front.map((p) => p.y));
    const notch = front.filter((p) => p.y < notchY + 0.006);
    const bridge = new Vector3(cx, notchY, Math.min(...notch.map((p) => p.z)));
    // Frames: x across (right → left ear), z forward (ears → nose), into the bone's frame.
    const L = (v: Vector3) => toLocal(v);
    const basis = (side: Vector3, fwd: Vector3) => {
      const x = side.clone().normalize();
      const z = fwd.clone().sub(x.clone().multiplyScalar(fwd.dot(x))).normalize();
      return new Matrix4().makeBasis(x, z.clone().cross(x), z);
    };
    const nL = L(nose), bL = L(bridge);
    const bodyB = basis(L(eL).sub(L(eR)), nL.clone().sub(L(eL).add(L(eR)).multiplyScalar(0.5)));
    const pieceB = basis(L(tL).sub(L(tR)), bL.clone().sub(L(tL).add(L(tR)).multiplyScalar(0.5)));
    const R = new Quaternion().setFromRotationMatrix(bodyB.multiply(pieceB.transpose()));
    const s = Math.min(1.12, Math.max(0.9, eL.distanceTo(eR) / Math.max(1e-3, tL.distanceTo(tR))));
    f.rot = [R.x, R.y, R.z, R.w];
    f.scale = s;
    f.pos = nL.clone().sub(bL).applyQuaternion(R).multiplyScalar(s).toArray() as V3;
    f.bone ??= 'Head';
    return `посажены: масштаб ${s.toFixed(2)}`;
  }

  // ── Readout ──
  const el = <T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): T => {
    const e = Object.assign(document.createElement(tag), props) as T;
    e.append(...kids);
    return e;
  };
  const msg = el('div', { className: 'ge__msg' });
  const out = el('div', { className: 'ge__out' });
  const values = el('div', { className: 'ge__out' });
  const say = (t: string) => (msg.textContent = t);
  let measureT = 0;
  function measureSoon(): void {
    clearTimeout(measureT);
    measureT = window.setTimeout(measure, 200);
  }
  function measure(): void {
    if (!rig) return;
    rig.root.updateMatrixWorld(true);
    const bp = posed(rig.mesh, rig.mesh.geometry);
    const bits = hideBits([...kit]);
    const rows: string[] = ['предмет              сквозь   вывернуто'];
    let bad = false;
    for (const g of kit) {
      const m = meshes.get(g);
      if (!m) continue;
      const th = throughPiece(gearKind(g) ?? '', bp, rig.mesh.geometry, posed(m), m.geometry, bits);
      const share = th.near ? th.out / th.near : 0;
      const inw = inwardShare(m.geometry);
      const over = share > 0.01 || inw > 0.05;
      bad ||= over;
      rows.push(`${g.padEnd(20)} ${th.near ? `${(share * 100).toFixed(1).padStart(5)}%` : '    —'} ${(inw * 100).toFixed(1).padStart(6)}%${over ? '  !' : ''}`);
    }
    rows.push('', 'норма: сквозь ≤ 1% вершин рядом, вывернуто ≤ 5% площади');
    out.textContent = rows.join('\n');
    out.classList.toggle('ge__bad', bad);
  }
  function showValues(): void {
    const f = fitIfAny();
    const p = new Vector3(...(f?.pos ?? [0, 0, 0])).multiplyScalar(100);
    const e = new Vector3().setFromEuler(new Euler().setFromQuaternion(new Quaternion(...(f?.rot ?? [0, 0, 0, 1])))).multiplyScalar(DEG);
    values.textContent = [
      `кость ${gearFitBone(body, id)}${f?.bone ? '' : ' (как подогнано)'}`,
      `сдвиг, см   ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
      `поворот, °  ${e.x.toFixed(1)} ${e.y.toFixed(1)} ${e.z.toFixed(1)}`,
      `масштаб ${(f?.scale ?? 1).toFixed(3)}   наружу ${(f?.push ?? 0).toFixed(2)} см`,
    ].join('\n');
  }

  // ── Panel ──
  let saved = structuredClone(GEAR_FIT);
  function build(): void {
    panel.replaceChildren();
    const sel = <T extends string>(items: [T, string][], cur: T, on: (v: T) => void) => {
      const s = el<HTMLSelectElement>('select');
      for (const [v, t] of items) s.append(el('option', { value: v, textContent: t, selected: v === cur }));
      s.onchange = () => on(s.value as T);
      return s;
    };
    panel.append(
      el('h3', { textContent: 'Предмет' }),
      el(
        'div',
        { className: 'ge__row' },
        sel(
          GEAR.map((g) => [g, `${gearName(g)} (${g})`]),
          id,
          (v) => {
            id = v;
            kit.add(id);
            target = 'piece';
            history.replaceState(null, '', `?gearedit=${id}`);
            void loadGear(body, [...kit]).then(() => (build(), refit(), aim('front')));
          },
        ),
      ),
      el('h3', { textContent: 'Тело и поза' }),
      el(
        'div',
        { className: 'ge__row' },
        sel(
          BODY_IDS.map((b) => [b, BODY_NAMES[b]]),
          body,
          (v) => void setBody(v).then(() => (build(), refit())),
        ),
        sel(
          POSES.map((p) => [p.clip, p.name]),
          clip,
          (v) => {
            clip = v;
            pose();
            placeProxy();
            measureSoon();
          },
        ),
      ),
      slider('кадр', 0, 1, 0.01, () => clipT, (v) => ((clipT = v), pose(), placeProxy(), measureSoon()), (v) => v.toFixed(2)),
    );

    // The rest of the kit worn at once.
    const kitRow = el('div', { className: 'ge__row' });
    for (const g of GEAR) {
      const c = el<HTMLInputElement>('input', { type: 'checkbox', checked: kit.has(g), disabled: g === id });
      c.onchange = () => {
        if (c.checked) kit.add(g);
        else kit.delete(g);
        void loadGear(body, [...kit]).then(() => (dress(), pose(), measureSoon()));
      };
      kitRow.append(el('label', {}, c, g));
    }
    panel.append(el('h3', { textContent: 'Надето вместе' }), kitRow);

    // What the gizmo moves.
    const tg = el('div', { className: 'ge__row' });
    const names: Record<Target, string> = { piece: 'Предмет', pivot: isFace() ? 'Переносица' : 'Центр', earL: 'Ухо Л', earR: 'Ухо П' };
    for (const t of (isFace() ? ['piece', 'pivot', 'earL', 'earR'] : ['piece', 'pivot']) as Target[]) {
      const b = el<HTMLButtonElement>('button', { textContent: names[t], className: t === target ? 'on' : '' });
      b.onclick = () => {
        target = t;
        gizmo.setMode(t === 'piece' ? gizmo.mode : 'translate');
        build();
        placeProxy();
      };
      tg.append(b);
    }
    const mv = el('button', { textContent: 'Двигать (W)', className: gizmo.mode === 'translate' ? 'on' : '' });
    const rt = el('button', { textContent: 'Вращать (E)', className: gizmo.mode === 'rotate' ? 'on' : '', disabled: target !== 'piece' });
    mv.onclick = () => (gizmo.setMode('translate'), build());
    rt.onclick = () => (gizmo.setMode('rotate'), build());
    panel.append(el('h3', { textContent: 'Что двигать (gizmo)' }), tg, el('div', { className: 'ge__row' }, mv, rt));

    panel.append(
      slider('масштаб', 0.8, 1.25, 0.005, () => fitIfAny()?.scale ?? 1, (v) => ((fitNow().scale = v), refit()), (v) => v.toFixed(3)),
      slider('наружу, см', -1, 2, 0.05, () => fitIfAny()?.push ?? 0, (v) => ((fitNow().push = v), refit()), (v) => v.toFixed(2)),
      el('div', { className: 'ge__row' }, 'кость', sel(BONES.map((b) => [b, b || 'как подогнано']), fitIfAny()?.bone ?? '', (v) => {
        const f = fitNow();
        // The offset kept where it is on screen: back to no offset in the new bone (a new frame).
        delete f.pos;
        delete f.rot;
        if (v) f.bone = v;
        else delete f.bone;
        refit();
        build();
      })),
      values,
    );
    if (isFace()) {
      const seatB = el('button', { textContent: 'Посадить по опорам' });
      seatB.onclick = () => {
        say(seat());
        refit();
      };
      const guess = el('button', { textContent: 'Опоры по голове' });
      guess.onclick = () => {
        const d = defaultAnchors();
        const f = fitNow();
        setPivot(d.pivot);
        f.earL = d.earL.toArray() as V3;
        f.earR = d.earR.toArray() as V3;
        refit();
        say('опоры: переносица и уши найдены по голове');
      };
      // Seating is the glasses' (bridge on the nose, temples to the ears); a mask only turns about the bridge.
      const glasses = gearKind(id) === 'glasses';
      panel.append(el('h3', { textContent: 'Опоры (переносица, уши)' }), el('div', { className: 'ge__row' }, guess, ...(glasses ? [seatB] : [])));
    }

    // Regions hidden under the piece.
    const reg = el('div', { className: 'ge__row' });
    for (const r of REGIONS) {
      const c = el<HTMLInputElement>('input', { type: 'checkbox', checked: !(fitIfAny()?.show ?? []).includes(r) });
      c.onchange = () => {
        const f = fitNow();
        const show = new Set<Region>(f.show ?? []);
        if (c.checked) show.delete(r);
        else show.add(r);
        if (show.size) f.show = REGIONS.filter((x) => show.has(x));
        else delete f.show;
        refit();
      };
      reg.append(el('label', {}, c, REGION_NAMES[r]));
    }
    panel.append(el('h3', { textContent: 'Скрывает тело под собой' }), reg);

    const save = el('button', { textContent: 'Сохранить' });
    const reset = el('button', { textContent: 'Сбросить' });
    const clear = el('button', { textContent: 'Без правки' });
    const all = el('button', { textContent: 'На все тела' });
    save.onclick = () => void doSave();
    reset.onclick = () => {
      for (const k of Object.keys(GEAR_FIT)) delete GEAR_FIT[k as GearId];
      Object.assign(GEAR_FIT, structuredClone(saved));
      build();
      refit();
      say('Сброшено к последнему сохранённому');
    };
    clear.onclick = () => {
      delete GEAR_FIT[id]?.[body];
      build();
      refit();
      say('Правка этого предмета на этом теле убрана (не сохранено)');
    };
    all.onclick = () => {
      const f = fitNow();
      for (const b of BODY_IDS) {
        if (b === body) continue;
        const o = ((GEAR_FIT[id] ??= {})[b] ??= {});
        for (const k of ['pos', 'rot', 'scale', 'push', 'bone', 'show'] as const) {
          if (f[k] === undefined) delete o[k];
          else (o as Record<string, unknown>)[k] = structuredClone(f[k]);
        }
      }
      say('Сдвиг, поворот, масштаб, кость и скрытие скопированы на все тела (опоры у каждого свои; не сохранено)');
    };
    panel.append(el('h3', { textContent: 'Файл src/data/gearFit.json' }), el('div', { className: 'ge__row' }, save, reset, clear, all), msg);
    panel.append(el('h3', { textContent: 'Проверка (поза на экране)' }), out);
    showValues();
  }

  function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) {
    const val = el('span', { textContent: fmt(get()) });
    const r = el<HTMLInputElement>('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) });
    r.oninput = () => {
      set(Number(r.value));
      val.textContent = fmt(Number(r.value));
    };
    return el('label', { className: 'wide' }, label, r, val);
  }

  /** The fits without empty entries (what is saved). */
  function pruned(): Record<string, Record<string, PieceFit>> {
    const o: Record<string, Record<string, PieceFit>> = {};
    for (const [g, per] of Object.entries(GEAR_FIT))
      for (const [b, f] of Object.entries(per ?? {})) {
        if (!f || !Object.keys(f).length) continue;
        (o[g] ??= {})[b] = f;
      }
    return o;
  }

  async function doSave(): Promise<void> {
    const res = await fetch('/__gearfit', { method: 'POST', body: JSON.stringify(pruned()) });
    if (res.ok) {
      saved = structuredClone(GEAR_FIT);
      say(`Сохранено ${new Date().toLocaleTimeString()}`);
    } else say(`Ошибка: ${await res.text()}`);
  }

  // ── Views ──
  function aim(where: 'front' | 'side' | 'back' | 'three' | 'whole'): void {
    if (!rig) return;
    rig.root.updateMatrixWorld(true);
    const at = where === 'whole' ? new Vector3(0, bodyAsset(body).height * 0.55, 0) : toWorld(gearMiddle(body, id));
    const kind = gearKind(id);
    const dist = where === 'whole' ? 4.2 : kind === 'helmet' || kind === 'glasses' || kind === 'mask' ? 0.9 : 1.8;
    const dir = { front: new Vector3(0, 0.1, 1), side: new Vector3(1, 0.1, 0), back: new Vector3(0, 0.1, -1), three: new Vector3(0.7, 0.25, 0.7), whole: new Vector3(0.3, 0.1, 1) }[where].normalize();
    orbit.target.copy(at);
    cam.position.copy(at).addScaledVector(dir, dist);
    orbit.update();
  }
  for (const [w, t] of [['front', 'Спереди'], ['side', 'Сбоку'], ['back', 'Сзади'], ['three', '3/4'], ['whole', 'Целиком']] as const) {
    const b = el('button', { textContent: t });
    b.onclick = () => aim(w);
    presets.append(b);
  }

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'w' || e.key === 'ц') (gizmo.setMode('translate'), build());
    if ((e.key === 'e' || e.key === 'у') && target === 'piece') (gizmo.setMode('rotate'), build());
  });

  function size(): void {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setSize(w, h, false);
    cam.aspect = w / Math.max(1, h);
    cam.updateProjectionMatrix();
  }
  addEventListener('resize', size);
  size();

  await loadGearMeta();
  await setBody(body);
  build();
  refit();
  aim('front');
  const tick = () => {
    // The next frame first: one failing frame must not stop the editor (it would look frozen).
    requestAnimationFrame(tick);
    placeProxy();
    renderer.render(scene, cam);
  };
  tick();

  // For scripts (screenshots, checks): the editor's state.
  Object.assign(window, {
    __gear: {
      GEAR_FIT,
      fit: fitNow,
      refit,
      measure: () => (measure(), out.textContent),
      set: async (g: GearId, b: BodyId = body, c: ClipId = clip, t = clipT) => {
        id = g;
        kit.add(g);
        clip = c;
        clipT = t;
        await setBody(b);
        build();
        refit();
        aim('front');
      },
      kit: (gs: GearId[]) => {
        kit.clear();
        for (const g of [id, ...gs]) kit.add(g);
        return loadGear(body, [...kit]).then(() => (build(), dress(), pose(), measure()));
      },
      aim,
      save: doSave,
      shot: async (name: string) => {
        renderer.render(scene, cam);
        await fetch(`/__shot?name=${name}`, { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.85) });
      },
    },
  });
}
