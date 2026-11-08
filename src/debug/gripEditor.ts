import {
  AxesHelper,
  CameraHelper,
  Color,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  BoxGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { HAND_POSES, type HandPose } from '../characters/hands';
import { basisQuat } from '../player/armRig';
import { type Grip, GRIPS, gripsChanged, frameOf, quat, vec } from '../player/grips';
import { gunRigData, keyQ } from '../player/gunPose';
import { heldConfig, type HeldId } from '../player/held';
import { Viewmodel, type ViewmodelFrame } from '../player/Viewmodel';
import { GUN_IDS, GUNS, type GunId } from '../weapons/guns';
import { LIMITS } from './animCheck';
import { gunReference, meleeReference } from './gripReference';

/**
 * The grip editor, ?gripedit=<item> (dev): the item and the arms in first person on a neutral background
 * (left, a cross marks the middle of the screen) and from outside (right, orbit with the mouse). Gizmos
 * move and turn the gun in the camera's space and each hand on it; for hand weapons the gun gizmo is the
 * rest / sprint pose and the hands slide along the handle and turn about it (sliders); beside a one-handed
 * weapon «Фонарик» moves the flashlight in the left hand (lit, its rest / sprint pose: grips.json → torch). Tabs: stance, sights,
 * sprint, reload. «Сохранить» writes src/data/grips.json (no code), «Сбросить» goes back to the last save,
 * «Эталон» puts the reference hold (debug/gripReference.ts). Readout: the wrists against their limits, the
 * hand gap from its socket, how much of the screen a hand takes.
 */

type Tab = 'stance' | 'ads' | 'sprint' | 'reload';
/** torch: the flashlight in the left hand beside a one-handed weapon (its own pose, grips.json → torch). */
type Target = 'gun' | 'R' | 'L' | 'torch';
const TAB_NAMES: Record<Tab, string> = { stance: 'Стойка', ads: 'Прицел', sprint: 'Бег', reload: 'Перезарядка' };
const MELEE: (HeldId | 'fists')[] = ['axe', 'bat', 'crowbar', 'knife', 'hammer', 'fists'];
const ITEMS: string[] = [...GUN_IDS, ...MELEE];
const DEG = 180 / Math.PI;

interface VmInternals {
  gunPose: { pos: Vector3; q: Quaternion };
  armR: Object3D;
  armL: Object3D;
  handR: Object3D;
  handL: Object3D;
}

const CSS = `
body{margin:0;background:#2a2c2b;color:#d6d4ca;font:13px system-ui,sans-serif;overflow:hidden}
.ge{display:grid;grid-template-columns:1fr 300px;grid-template-rows:1fr;height:100vh}
.ge__views{position:relative;display:grid;grid-template-rows:auto 1fr;min-width:0}
.ge__fp{position:relative;aspect-ratio:16/9;width:100%;max-height:62vh;background:#5e6366}
.ge__tp{position:relative;min-height:0}
.ge canvas{display:block;width:100%;height:100%}
.ge__cross{position:absolute;left:50%;top:50%;width:15px;height:15px;margin:-7px 0 0 -7px;pointer-events:none}
.ge__cross:before,.ge__cross:after{content:'';position:absolute;background:#f0f}
.ge__cross:before{left:7px;top:0;width:1px;height:15px}.ge__cross:after{top:7px;left:0;height:1px;width:15px}
.ge__sixth{position:absolute;right:0;bottom:0;border:1px dashed #9a9;pointer-events:none;opacity:.5}
.ge__label{position:absolute;left:6px;top:4px;font:11px monospace;color:#ddd;pointer-events:none}
.ge__panel{padding:10px;overflow:auto;background:#222423;border-left:1px solid #444}
.ge__panel h3{margin:12px 0 6px;font-size:12px;text-transform:uppercase;color:#9a988e}
.ge__row{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;align-items:center}
.ge button,.ge select{background:#3a3c3a;color:#d6d4ca;border:1px solid #555;border-radius:3px;padding:4px 8px;font:inherit;cursor:pointer}
.ge button.on{background:#6b7a5a;border-color:#8a9a72}
.ge button:disabled{opacity:.35;cursor:default}
.ge label{display:flex;gap:6px;align-items:center;width:100%}
.ge input[type=range]{flex:1}
.ge__out{font:11px/1.45 monospace;white-space:pre;color:#bdbbb0}
.ge__bad{color:#c08060}
.ge__msg{min-height:16px;color:#a8b890}
`;

export async function startGripEditor(first: string | null): Promise<void> {
  document.getElementById('game')?.remove();
  document.getElementById('ui')?.remove();
  document.getElementById('loading')?.remove();
  document.getElementById('rotate')?.remove();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'ge';
  root.innerHTML = `
    <div class="ge__views">
      <div class="ge__fp"><div class="ge__cross"></div><div class="ge__sixth"></div><div class="ge__label">от первого лица</div></div>
      <div class="ge__tp"><div class="ge__label">от третьего лица (мышь: вращать, колесо: ближе)</div></div>
    </div>
    <div class="ge__panel"></div>`;
  document.body.append(root);
  const fpBox = root.querySelector<HTMLElement>('.ge__fp')!;
  const tpBox = root.querySelector<HTMLElement>('.ge__tp')!;
  const sixth = root.querySelector<HTMLElement>('.ge__sixth')!;
  const panel = root.querySelector<HTMLElement>('.ge__panel')!;

  // ── Views ──
  const r1 = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r1.autoClear = false;
  fpBox.prepend(r1.domElement);
  const r2 = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  tpBox.prepend(r2.domElement);
  const bg = new Scene();
  bg.background = new Color(0x5e6366);

  const vm = new Viewmodel();
  vm.setBody('male', 1);
  vm.setAspect(16 / 9);
  vm.setDaylight(1);
  const vi = vm as unknown as VmInternals;

  // The outside view: the arms' scene seen from an orbit camera, with a stand-in head and chest at the eye.
  const tpCam = new PerspectiveCamera(45, 1, 0.01, 20);
  tpCam.position.set(1.1, 0.35, 0.2);
  const orbit = new OrbitControls(tpCam, r2.domElement);
  orbit.target.set(0, -0.15, -0.3);
  orbit.update();
  const extra = new Group();
  const skin = new MeshLambertMaterial({ color: 0x6c6a62 });
  const head = new Mesh(new SphereGeometry(0.095, 16, 12), skin);
  head.position.set(0, 0.02, 0.06);
  const chest = new Mesh(new BoxGeometry(0.42, 0.5, 0.22), new MeshLambertMaterial({ color: 0x4a4c48 }));
  chest.position.set(0, -0.5, 0.06);
  const eyeCam = new PerspectiveCamera(60, 16 / 9, 0.02, 0.45);
  const eyeHelper = new CameraHelper(eyeCam);
  const grid = new GridHelper(2, 20, 0x777777, 0x555555);
  grid.position.y = -1.6;
  extra.add(head, chest, eyeHelper, grid, new HemisphereLight(0x6e747a, 0x3a3830, 1.2));
  vm.scene.add(extra);

  // Gizmo: drives a proxy object in the arms' (camera) space.
  const proxy = new Object3D();
  vm.scene.add(proxy);
  const gizmo = new TransformControls(tpCam, r2.domElement);
  gizmo.setSpace('local');
  gizmo.setSize(0.7);
  gizmo.attach(proxy);
  const gizmoFp = new TransformControls(vm.camera, r1.domElement);
  gizmoFp.setSpace('local');
  gizmoFp.setSize(0.6);
  gizmoFp.attach(proxy);
  const helpers = [gizmo.getHelper(), gizmoFp.getHelper()];
  for (const c of [gizmo, gizmoFp]) {
    c.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
      dragging = !!e.value;
      if (!e.value) {
        writeBack();
        render();
      }
    });
    c.addEventListener('objectChange', () => {
      if (dragging) writeBack();
    });
  }
  const axes = new AxesHelper(0.06);
  proxy.add(axes);

  // ── State ──
  let id: string = first && ITEMS.includes(first) ? first : 'rifle_m4a1';
  let tab: Tab = 'stance';
  let target: Target = 'gun';
  let dragging = false;
  let saved: Record<string, Grip> = structuredClone(GRIPS);
  const isGunId = (x: string): x is GunId => (GUN_IDS as readonly string[]).includes(x);
  const grip = (): Grip => (GRIPS[id] ??= {});

  // ── The arms posed for the tab ──
  const frame = (): ViewmodelFrame => ({ lookX: 0, lookY: 0, stepPhase: 0, speed: tab === 'sprint' ? 5.5 : 0, sprinting: tab === 'sprint', flashlightOn: target === 'torch' });
  const settle = (n: number) => {
    const gv = vm.gunView;
    gv.ads = tab === 'ads';
    gv.wall = 0;
    gv.wallDist = 99;
    gv.chamber = true;
    if (isGunId(id) && tab === 'reload') {
      const g = GUNS[id];
      gv.action = g.feed === 'mag' ? 'reload' : g.feed === 'rocket' ? 'reload' : 'loadOne';
      gv.duration = g.feed === 'mag' || g.feed === 'rocket' ? g.times.reload : 0.5;
      gv.t = gv.duration * (g.feed === 'rocket' ? 0.45 : 0.5);
      gv.chamber = g.feed !== 'rocket';
    } else {
      gv.action = 'idle';
      gv.t = 0;
      gv.duration = 1;
    }
    for (let i = 0; i < n; i++) {
      vm.fixedUpdate(1 / 60, false);
      vm.update(1 / 60, frame());
    }
  };

  /** The proxy where the edited thing is now. */
  const placeProxy = () => {
    if (dragging) return;
    const p = proxyFrame();
    proxy.visible = !!p;
    for (const h of helpers) h.visible = !!p;
    gizmo.enabled = gizmoFp.enabled = !!p;
    if (!p) return;
    proxy.position.copy(p.at);
    proxy.quaternion.copy(p.q);
    proxy.updateMatrixWorld(true);
  };

  function proxyFrame(): { at: Vector3; q: Quaternion } | null {
    if (isGunId(id)) {
      const d = gunRigData(id);
      if (target === 'gun') {
        if (tab === 'stance') return { at: d.hipAt.clone(), q: d.hipQ.clone() };
        if (tab === 'sprint' || tab === 'reload') {
          const k = d.cls[tab];
          return { at: vec(k.at), q: keyQ(d, k, new Quaternion()) };
        }
        return null;
      }
      const g = vi.gunPose;
      const h = target === 'R' ? d.main : d.off;
      return { at: h.at.clone().applyQuaternion(g.q).add(g.pos), q: g.q.clone().multiply(h.q) };
    }
    if ((target !== 'gun' && target !== 'torch') || (tab !== 'stance' && tab !== 'sprint')) return null;
    const k = heldConfig(target === 'torch' ? 'torch' : (id as HeldId | 'fists')).keys[tab === 'stance' ? 'idle' : 'sprint'];
    return { at: vec(k.at), q: basisQuat(vec(k.axis), vec(k.edge)) };
  }

  /** The proxy → the grips (and the rigs rebuilt from them). */
  function writeBack(): void {
    const G = grip();
    proxy.updateMatrixWorld(true);
    const f = frameOf(proxy.position, proxy.quaternion);
    if (isGunId(id)) {
      if (target === 'gun') {
        if (tab === 'stance') G.stance = f;
        else if (tab === 'sprint') G.sprint = f;
        else if (tab === 'reload') G.reload = f;
      } else {
        // Into the gun frame: gun⁻¹ × hand.
        const g = vi.gunPose;
        const inv = g.q.clone().invert();
        const at = proxy.position.clone().sub(g.pos).applyQuaternion(inv);
        const q = inv.multiply(proxy.quaternion);
        G[target === 'R' ? 'main' : 'off'] = frameOf(at, q);
      }
    } else if (target === 'gun' || target === 'torch') {
      const T = target === 'torch' ? (GRIPS.torch ??= {}) : G;
      if (tab === 'stance') T.stance = f;
      else if (tab === 'sprint') T.sprint = f;
    }
    gripsChanged();
    settle(2);
    updateOut();
  }

  // ── Panel ──
  const el = <T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): T => {
    const e = Object.assign(document.createElement(tag), props) as T;
    e.append(...kids);
    return e;
  };
  const msg = el('div', { className: 'ge__msg' });
  const out = el('div', { className: 'ge__out' });
  const say = (t: string) => {
    msg.textContent = t;
  };

  function build(): void {
    panel.replaceChildren();
    const gun = isGunId(id);
    const sel = el<HTMLSelectElement>('select');
    for (const x of ITEMS) sel.append(el('option', { value: x, textContent: isGunId(x) ? `${GUNS[x].name} (${x})` : x, selected: x === id }));
    sel.onchange = () => {
      id = sel.value;
      history.replaceState(null, '', `?gripedit=${id}`);
      equip();
    };
    panel.append(el('h3', { textContent: 'Предмет' }), el('div', { className: 'ge__row' }, sel));

    const tabs = el('div', { className: 'ge__row' });
    for (const t of Object.keys(TAB_NAMES) as Tab[]) {
      const b = el<HTMLButtonElement>('button', { textContent: TAB_NAMES[t], className: t === tab ? 'on' : '', disabled: !gun && (t === 'ads' || t === 'reload') });
      b.onclick = () => {
        tab = t;
        build();
        settle(90);
        placeProxy();
      };
      tabs.append(b);
    }
    panel.append(el('h3', { textContent: 'Поза' }), tabs);

    const tg = el('div', { className: 'ge__row' });
    const names: Record<Target, string> = { gun: gun ? 'Оружие' : 'Предмет', R: 'Правая кисть', L: 'Левая кисть', torch: 'Фонарик' };
    const oneHanded = !gun && !heldConfig(id as HeldId | 'fists').twoHanded;
    if (target === 'torch' && !oneHanded) target = 'gun';
    for (const t of (oneHanded ? ['gun', 'torch'] : ['gun', 'R', 'L']) as Target[]) {
      const b = el<HTMLButtonElement>('button', { textContent: names[t], className: t === target ? 'on' : '', disabled: (!gun && (t === 'R' || t === 'L')) || (t === 'L' && !gun && !heldConfig(id as HeldId | 'fists').twoHanded) });
      b.onclick = () => {
        const lit = (t === 'torch') !== (target === 'torch');
        target = t;
        build();
        // The flashlight comes up lit (or goes down) when it is picked (or left).
        if (lit) settle(60);
        placeProxy();
      };
      tg.append(b);
    }
    const mv = el('button', { textContent: 'Двигать (W)' });
    const rt = el('button', { textContent: 'Вращать (E)' });
    const mode = (m: 'translate' | 'rotate') => {
      gizmo.setMode(m);
      gizmoFp.setMode(m);
      mv.classList.toggle('on', m === 'translate');
      rt.classList.toggle('on', m === 'rotate');
    };
    mv.onclick = () => mode('translate');
    rt.onclick = () => mode('rotate');
    mode(gizmo.mode === 'rotate' ? 'rotate' : 'translate');
    panel.append(el('h3', { textContent: 'Что двигать (gizmo)' }), tg, el('div', { className: 'ge__row' }, mv, rt));

    // Hand poses.
    const hp = el('div');
    for (const side of ['R', 'L'] as const) {
      const s = el<HTMLSelectElement>('select');
      const cur = grip().hands?.[side] ?? (gun ? (side === 'R' ? 'grip_trigger' : 'grip_support') : side === 'R' || heldConfig(id as HeldId | 'fists').twoHanded ? 'grip_fist' : 'relaxed');
      for (const p of HAND_POSES) s.append(el('option', { value: p, textContent: p, selected: p === cur }));
      s.onchange = () => {
        const G = grip();
        G.hands = { ...G.hands, [side]: s.value as HandPose };
        gripsChanged();
        settle(2);
      };
      hp.append(el('label', {}, side === 'R' ? 'Правая' : 'Левая', s));
    }
    panel.append(el('h3', { textContent: 'Поза кисти' }), hp);

    // Sliders: the sights (guns), the hands on the handle (hand weapons).
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      const val = el('span', { textContent: get().toFixed(3) });
      const r = el<HTMLInputElement>('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) });
      r.oninput = () => {
        set(Number(r.value));
        val.textContent = Number(r.value).toFixed(3);
        gripsChanged();
        settle(2);
        placeProxy();
        updateOut();
      };
      return el('label', {}, label, r, val);
    };
    if (gun) {
      const d = gunRigData(id as GunId);
      panel.append(
        el('h3', { textContent: 'Прицел (мушка всегда в центре)' }),
        slider('от глаза, м', 0.05, 0.6, 0.005, () => grip().ads?.relief ?? d.cls.relief, (v) => (grip().ads = { ...grip().ads, relief: v })),
        slider('щека на прикладе (плечи вверх), м', -0.02, 0.08, 0.001, () => grip().ads?.drop ?? d.cls.adsDrop, (v) => (grip().ads = { ...grip().ads, drop: v })),
      );
    } else {
      const c = heldConfig(id as HeldId | 'fists');
      const sock = (k: 'socketR' | 'socketL', base: { along: number; roll: number }) => () => (grip()[k] ??= { along: base.along, roll: base.roll });
      const R = sock('socketR', c.main);
      panel.append(
        el('h3', { textContent: 'Кисти на рукояти' }),
        slider('правая: от торца, м', 0, 0.8, 0.005, () => R().along, (v) => (R().along = v)),
        slider('правая: поворот, °', -180, 180, 1, () => R().roll * DEG, (v) => (R().roll = v / DEG)),
      );
      if (c.off) {
        const L = sock('socketL', c.off);
        panel.append(
          slider('левая: от торца, м', 0, 0.8, 0.005, () => L().along, (v) => (L().along = v)),
          slider('левая: поворот, °', -180, 180, 1, () => L().roll * DEG, (v) => (L().roll = v / DEG)),
        );
      }
    }

    const save = el('button', { textContent: 'Сохранить' });
    const reset = el('button', { textContent: 'Сбросить' });
    const ref = el('button', { textContent: 'Эталон' });
    save.onclick = () => void doSave();
    reset.onclick = () => {
      for (const k of Object.keys(GRIPS)) delete GRIPS[k];
      Object.assign(GRIPS, structuredClone(saved));
      changed();
      say('Сброшено к последнему сохранённому');
    };
    ref.onclick = () => {
      GRIPS[id] = reference(id);
      changed();
      say('Эталон выставлен (не сохранён)');
    };
    panel.append(el('h3', { textContent: 'Файл src/data/grips.json' }), el('div', { className: 'ge__row' }, save, reset, ref), msg);
    panel.append(el('h3', { textContent: 'Проверка' }), out);
  }

  function changed(): void {
    gripsChanged();
    build();
    settle(60);
    placeProxy();
    updateOut();
  }

  async function doSave(): Promise<void> {
    const res = await fetch('/__grips', { method: 'POST', body: JSON.stringify(GRIPS) });
    if (res.ok) {
      saved = structuredClone(GRIPS);
      say(`Сохранено ${new Date().toLocaleTimeString()}`);
    } else say(`Ошибка: ${await res.text()}`);
  }

  function reference(x: string): Grip {
    if (!isGunId(x)) return meleeReference(x as HeldId | 'fists');
    const g = gunReference(x);
    const keep = { id, tab, target };
    GRIPS[x] = g;
    id = x;
    vm.equip(x);
    fitHand(x, 'main');
    fitHand(x, 'off');
    ({ id, tab, target } = keep);
    vm.equip(id as never);
    return g;
  }

  /**
   * The hand's turn on its socket that keeps the wrist in its limits with the elbow down (an elbow up
   * fills the view with the sleeve): a search over the turn about the grip axis and the tilt of the
   * handle across the palm, at the hip and in the sights.
   */
  function fitHand(x: GunId, which: 'main' | 'off'): void {
    const G = GRIPS[x];
    const base = quat(G[which]!.q);
    const k = which === 'main' ? 0 : 1;
    const turnQ = (d: number, t: number) => base.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), d)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), t));
    const score = (d: number, t: number) => {
      const q = turnQ(d, t);
      G[which] = { at: G[which]!.at, q: [q.x, q.y, q.z, q.w] };
      gripsChanged();
      let c = 0;
      for (const tb of ['stance', 'ads'] as Tab[]) {
        tab = tb;
        settle(tb === 'ads' ? 50 : 25);
        // The wrist stops at its limits: then the hand (and the gun on it) is off where the pose wants it.
        const m = miss(k);
        c += m.deg + m.gap * 1000;
        const p = k === 0 ? vm.rig.right.pose : vm.rig.left.pose;
        c += 3 * (Math.max(0, Math.abs(p.flex * DEG) - LIMITS.flex + 4) + Math.max(0, Math.abs(p.dev * DEG) - LIMITS.dev + 3) + Math.max(0, Math.abs(p.twist * DEG) - LIMITS.twist + 3));
        const e = (k === 0 ? vi.armR : vi.armL).position.y;
        c += Math.max(0, e + 0.22) * 400;
      }
      return c + (Math.abs(d) + Math.abs(t)) * 2;
    };
    let best = { d: 0, t: 0, c: score(0, 0) };
    for (let d = -90; d <= 90; d += 15)
      for (let t = -60; t <= 60; t += 15) {
        const c = score(d / DEG, t / DEG);
        if (c < best.c) best = { d: d / DEG, t: t / DEG, c };
      }
    for (const step of [7.5, 3]) {
      const c0 = best;
      for (const dd of [-step, 0, step])
        for (const dt of [-step, 0, step]) {
          const c = score(c0.d + dd / DEG, c0.t + dt / DEG);
          if (c < best.c) best = { d: c0.d + dd / DEG, t: c0.t + dt / DEG, c };
        }
    }
    const q = turnQ(best.d, best.t);
    G[which] = { at: G[which]!.at, q: [q.x, q.y, q.z, q.w] };
    gripsChanged();
    console.log(`fit ${x} ${which}: turn ${(best.d * DEG).toFixed(0)}°, tilt ${(best.t * DEG).toFixed(0)}°, cost ${best.c.toFixed(1)}`);
  }

  /** How far a hand is off its socket on the gun: the turn (deg) and the distance (m); the right hand carries the gun, so its miss is the gun's turn off its pose. */
  function miss(k: 0 | 1): { deg: number; gap: number } {
    const gm = vm.gunModel;
    if (!gm) return { deg: 0, gap: 0 };
    vm.scene.updateMatrixWorld(true);
    if (k === 0) {
      const want = vi.gunPose.q.clone();
      const root = vm.scene.getObjectByName('fp-arms')?.parent ?? vm.scene;
      void root;
      const have = gm.root.getWorldQuaternion(new Quaternion());
      // The rig's root (sway) is near identity in the editor.
      const pos = gm.root.getWorldPosition(new Vector3());
      return { deg: 2 * Math.acos(Math.min(1, Math.abs(want.dot(have)))) * DEG, gap: pos.distanceTo(vi.gunPose.pos) };
    }
    const sock = new Vector3();
    const q = new Quaternion();
    vm.gunSocket(1, sock, q);
    const h = vi.handL;
    const grip = new Vector3(0.03, 0, -0.05).applyMatrix4(h.matrixWorld);
    const hq = h.getWorldQuaternion(new Quaternion());
    return { deg: 2 * Math.acos(Math.min(1, Math.abs(q.dot(hq)))) * DEG, gap: grip.distanceTo(sock) };
  }

  // ── Readout: wrists, gaps, the hands' share of the screen ──
  const _a = new Vector3();
  const _b = new Vector3();
  function handShare(k: 0 | 1): number {
    // The hand's span on screen: the wrist to the knuckles and across the palm, projected.
    const h = k === 0 ? vi.handR : vi.handL;
    const pts = [
      [0, 0, 0],
      [0, 0, -0.11],
      [0.045, 0, -0.06],
      [-0.045, 0, -0.06],
      [0, 0.045, -0.06],
      [0, -0.045, -0.06],
    ].map(([x, y, z]) => _a.set(x, y, z).applyMatrix4(h.matrixWorld).project(vm.camera).clone());
    let x0 = 1, x1 = -1;
    for (const p of pts) {
      if (p.z > 1) return 1;
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
    }
    return Math.max(0, Math.min(1, x1) - Math.max(-1, x0)) / 2;
  }
  function updateOut(): void {
    const rows: string[] = [];
    const lim = (v: number, l: number) => `${(v * DEG).toFixed(0).padStart(4)}°${Math.abs(v * DEG) > l ? ' !' : '  '}`;
    let bad = false;
    for (const k of [0, 1] as const) {
      const p = k === 0 ? vm.rig.right.pose : vm.rig.left.pose;
      const share = handShare(k);
      const sock = new Vector3();
      const q = new Quaternion();
      let gap = 0;
      if (isGunId(id)) {
        vm.gunSocket(k, sock, q);
        const h = k === 0 ? vi.handR : vi.handL;
        _b.set(k === 0 ? -0.03 : 0.03, 0, -0.05).applyMatrix4(h.matrixWorld);
        gap = _b.distanceTo(sock);
      }
      const over = Math.abs(p.flex * DEG) > LIMITS.flex || Math.abs(p.dev * DEG) > LIMITS.dev || Math.abs(p.twist * DEG) > LIMITS.twist || gap > 0.01 || share > 1 / 6;
      bad ||= over;
      rows.push(
        `${k === 0 ? 'правая' : 'левая '}  сгиб ${lim(p.flex, LIMITS.flex)} вбок ${lim(p.dev, LIMITS.dev)} twist ${lim(p.twist, LIMITS.twist)}`,
        `        мимо ${miss(k).deg.toFixed(0)}°  зазор ${(gap * 100).toFixed(1)} см  экран ${(share * 100).toFixed(0)}% (≤ 17%)${share > 1 / 6 ? ' !' : ''}`,
      );
    }
    out.textContent = rows.join('\n');
    out.classList.toggle('ge__bad', bad);
  }

  function equip(): void {
    vm.equip(id as never);
    tab = !isGunId(id) && (tab === 'ads' || tab === 'reload') ? 'stance' : tab;
    if (!isGunId(id)) target = 'gun';
    build();
    settle(150);
    placeProxy();
    updateOut();
  }

  addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'ц') gizmo.setMode('translate'), gizmoFp.setMode('translate');
    if (e.key === 'e' || e.key === 'у') gizmo.setMode('rotate'), gizmoFp.setMode('rotate');
  });

  // ── Loop ──
  function size(): void {
    const w = fpBox.clientWidth;
    const h = fpBox.clientHeight;
    r1.setSize(w, h, false);
    r1.setPixelRatio(Math.min(2, devicePixelRatio));
    vm.setAspect(w / h);
    eyeCam.aspect = w / h;
    eyeCam.updateProjectionMatrix();
    eyeHelper.update();
    sixth.style.width = `${w / 6}px`;
    sixth.style.height = `${h / 6}px`;
    const w2 = tpBox.clientWidth;
    const h2 = tpBox.clientHeight;
    r2.setSize(w2, h2, false);
    r2.setPixelRatio(Math.min(2, devicePixelRatio));
    tpCam.aspect = w2 / Math.max(1, h2);
    tpCam.updateProjectionMatrix();
  }
  function render(): void {
    // The first-person pass: no helpers but the gizmo; the outside one: everything.
    extra.visible = false;
    helpers[0].visible = false;
    r1.clear();
    r1.render(bg, vm.camera);
    r1.clearDepth();
    r1.render(vm.scene, vm.camera);
    extra.visible = true;
    helpers[0].visible = proxy.visible;
    helpers[1].visible = false;
    r2.setClearColor(0x3b3e3f);
    r2.render(vm.scene, tpCam);
    helpers[1].visible = proxy.visible;
  }
  vm.scene.add(...helpers);
  addEventListener('resize', size);
  size();
  equip();
  const tick = () => {
    settle(1);
    placeProxy();
    if (dragging) updateOut();
    render();
    requestAnimationFrame(tick);
  };
  tick();
  setInterval(updateOut, 300);

  // For scripts (screenshots, setting every item to the reference): the editor's state.
  Object.assign(window, {
    __grip: {
      vm,
      GRIPS,
      set: (x: string, t: Tab, tg: Target = 'gun') => {
        id = x;
        tab = t;
        target = tg;
        equip();
        settle(120);
        render();
      },
      reference: (x: string) => {
        GRIPS[x] = reference(x);
        changed();
      },
      referenceAll: () => {
        for (const x of ITEMS) GRIPS[x] = reference(x);
        changed();
      },
      save: doSave,
      changed,
      out: () => out.textContent,
      share: () => [handShare(0), handShare(1)],
      render,
      /** The outside camera: where it is, what it looks at (the arms' space). */
      view: (pos: [number, number, number], at: [number, number, number]) => {
        tpCam.position.set(...pos);
        orbit.target.set(...at);
        orbit.update();
        render();
      },
      /** Both views to .shots/<name>-fp.jpg / -tp.jpg (dev server's /__shot). */
      shot: async (name: string) => {
        render();
        for (const [r, suf] of [[r1, 'fp'], [r2, 'tp']] as const)
          await fetch(`/__shot?name=${name}-${suf}`, { method: 'POST', body: r.domElement.toDataURL('image/jpeg', 0.85) });
      },
    },
  });
}
