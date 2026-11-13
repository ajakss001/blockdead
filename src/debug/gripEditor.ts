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
import { type Grip, type GunKey, GRIPS, gripsChanged, frameOf, quat, vec } from '../player/grips';
import { gunRigData, keyQ } from '../player/gunPose';
import { heldConfig, type HeldId } from '../player/held';
import { swingTime } from '../player/armRig';
import { BODY_IDS, type BodyId, bodyAsset, loadBody } from '../characters/assets';
import type { GunAction } from '../weapons/gunState';
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
 * sprint, reload, the bolt (a bolt rifle: the left hand on it, the gun while it is worked, the hand's pose there). «Сохранить» writes src/data/grips.json (no code), «Сбросить» goes back to the last save,
 * «Эталон» puts the reference hold (debug/gripReference.ts). Readout: the wrists against their limits, the
 * hand gap from its socket, how much of the screen a hand takes. «Анимации» plays the item's moves in real time
 * (a shot with its recoil, the bolt / pump, reloads, the sights, sprint, inspect, the butt, put away and drawn;
 * a hand weapon's swing) — one or all in a row, with the grips as edited. «Кадры»: any moment of a gun's move
 * (reload, a round, the butt, …) — the gun and the hands put there make a key of that move only (grips.json →
 * keys), faded in and out over its «плавность»; the rest of the move and the other poses stay as they were.
 */

type Tab = 'stance' | 'ads' | 'sprint' | 'reload' | 'bolt' | 'keys';
/** torch: the flashlight in the left hand beside a one-handed weapon (its own pose, grips.json → torch). */
type Target = 'gun' | 'R' | 'L' | 'torch';
const TAB_NAMES: Record<Tab, string> = { stance: 'Стойка', ads: 'Прицел', sprint: 'Бег', reload: 'Перезарядка', bolt: 'Затвор', keys: 'Кадры' };
const MELEE: (HeldId | 'fists')[] = ['axe', 'bat', 'crowbar', 'knife', 'hammer', 'fists'];
const ITEMS: string[] = [...GUN_IDS, ...MELEE];
const DEG = 180 / Math.PI;
/** The arms' costume (the game's sleeves and arm lengths): ?gripedit=<item>&body=<id>. */
const BODY_NAMES: Record<BodyId, string> = {
  male: 'Без костюма (м)',
  female: 'Без костюма (ж)',
  swat_m: 'Спецназ (SWAT)',
  military_m: 'Военный',
  police_m: 'Полицейский',
  firefighter_m: 'Пожарный',
  doctor_m: 'Врач',
  mechanic_m: 'Механик',
  builder_m: 'Строитель',
  juggernaut_m: 'Громила',
  patientZero_m: 'Пациент 0',
};

interface VmInternals {
  gunPose: { pos: Vector3; q: Quaternion; rightGrip: Vector3; rightQ: Quaternion; leftGrip: Vector3; leftQ: Quaternion };
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
.ge__line{position:relative;padding-top:12px;margin-bottom:6px}.ge__line input{width:100%;margin:0}
.ge__mark{position:absolute;top:0;width:9px;height:11px;margin-left:-4px;background:#8e8c82;clip-path:polygon(0 0,100% 0,50% 100%);cursor:pointer}.ge__mark.on{background:#c9a24a}
.ge__hint{font-size:12px;opacity:.75;margin-bottom:6px}
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
  let body: BodyId = 'male';
  /** The arms in a costume, at the game's size for it (a man 180 cm, a woman 170). */
  const setArms = async (b: BodyId): Promise<void> => {
    if (!(await loadBody(b))) return;
    body = b;
    vm.setBody(b, (b === 'female' ? 1.7 : 1.8) / bodyAsset(b).height);
  };
  vm.setBody('male', 1.8 / bodyAsset('male').height);
  const firstBody = new URLSearchParams(location.search).get('body') as BodyId | null;
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
  /** A gun with a bolt worked by hand between shots (the «Затвор» tab). */
  const boltGun = (x: string) => isGunId(x) && GUNS[x].action === 'bolt';
  const grip = (): Grip => (GRIPS[id] ??= {});

  // ── «Кадры»: a moment of a gun's move ──
  const ACT_NAMES: Partial<Record<GunAction, string>> = {
    reload: 'Перезарядка',
    reloadEmpty: 'Перезарядка с пустого',
    loadStart: 'Зарядка: начало',
    loadOne: 'Патрон',
    loadEnd: 'Зарядка: конец',
    cycle: 'Затвор / помпа',
    mode: 'Режим огня',
    inspect: 'Осмотр',
    bash: 'Удар прикладом',
    draw: 'Достать',
    holster: 'Убрать',
  };
  const DEF_TIME: Partial<Record<GunAction, number>> = { reload: 2, reloadEmpty: 2.5, loadStart: 0.4, loadOne: 0.5, loadEnd: 0.4, cycle: 0.6, mode: 0.3, inspect: 3, bash: 0.7, draw: 0.6, holster: 0.5 };
  /** The gun's moves that can be keyed. */
  const keyActions = (): GunAction[] => {
    if (!isGunId(id)) return [];
    const g = GUNS[id];
    const out: GunAction[] = g.feed === 'mag' ? ['reload', 'reloadEmpty'] : g.feed === 'rocket' ? ['reload'] : ['loadStart', 'loadOne', 'loadEnd'];
    if (g.action === 'bolt' || g.action === 'pump') out.push('cycle');
    if (g.modes.length > 1) out.push('mode');
    out.push('bash', 'inspect', 'draw', 'holster');
    return out;
  };
  const actTime = (a: GunAction): number => {
    const T = isGunId(id) ? (GUNS[id].times as unknown as Record<string, number | undefined>) : {};
    const t = T[a];
    return t && t > 0 ? t : (DEF_TIME[a] ?? 0.5);
  };
  let keyAct: GunAction = 'reload';
  let keyK = 0.5;
  /** The move's keys (grips.json), in time order. */
  const keyList = (): GunKey[] => grip().keys?.[keyAct] ?? [];
  /** The key at the moment (within 2% of the move), if any. */
  const keyAt = (): GunKey | undefined => keyList().find((x) => Math.abs(x.k - keyK) < 0.02);

  // ── The arms posed for the tab ──
  const frame = (): ViewmodelFrame => ({ lookX: 0, lookY: 0, stepPhase: 0, speed: tab === 'sprint' ? 5.5 : 0, sprinting: tab === 'sprint', flashlightOn: target === 'torch' });
  const settle = (n: number) => {
    const gv = vm.gunView;
    gv.ads = tab === 'ads';
    gv.wall = 0;
    gv.wallDist = 99;
    gv.chamber = true;
    if (isGunId(id) && tab === 'keys') {
      gv.action = keyAct;
      gv.duration = actTime(keyAct);
      gv.t = gv.duration * keyK;
      gv.chamber = keyAct !== 'reloadEmpty' && !(keyAct === 'reload' && GUNS[id].feed === 'rocket');
    } else if (isGunId(id) && tab === 'bolt') {
      // The hand on the bolt, before it pulls it back.
      gv.action = 'cycle';
      gv.duration = GUNS[id].times.cycle ?? 0.5;
      gv.t = gv.duration * 0.38;
    } else if (isGunId(id) && tab === 'reload') {
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

  // ── Playback: the item's moves in real time ──
  /** A move: the gun's action for `dur` s (or none), the sights / sprint held, a shot at its start, a swing. */
  interface Move {
    name: string;
    dur: number;
    action?: GunAction;
    ads?: boolean;
    sprint?: boolean;
    shot?: boolean;
    swing?: boolean;
  }
  const moves = (): Move[] => {
    if (!isGunId(id)) {
      const c = heldConfig(id as HeldId | 'fists');
      return [
        { name: 'Удар', dur: swingTime(c) / Math.max(0.1, vm.swingRate) + 0.25, swing: true },
        { name: 'Бег', dur: 1.6, sprint: true },
      ];
    }
    const g = GUNS[id];
    const T = g.times as unknown as Record<string, number | undefined>;
    const tm = (a: string, d: number) => (T[a] && T[a]! > 0 ? T[a]! : d);
    const work = g.action === 'bolt' || g.action === 'pump';
    const out: Move[] = [];
    const shot = (name: string, ads: boolean) => {
      out.push({ name, dur: 0.35, shot: true, ads });
      if (work) out.push({ name: `${name}: ${g.action === 'bolt' ? 'затвор' : 'помпа'}`, dur: tm('cycle', 0.6), action: 'cycle', ads });
    };
    out.push({ name: 'Прицел', dur: 1.2, ads: true });
    shot('Выстрел от бедра', false);
    shot('Выстрел в прицеле', true);
    if (g.feed === 'mag') {
      out.push({ name: 'Перезарядка', dur: tm('reload', 2), action: 'reload' });
      out.push({ name: 'Перезарядка с пустого', dur: tm('reloadEmpty', 2.5), action: 'reloadEmpty' });
    } else if (g.feed === 'rocket') out.push({ name: 'Перезарядка', dur: tm('reload', 3), action: 'reload' });
    else {
      out.push({ name: 'Зарядка: начало', dur: tm('loadStart', 0.4), action: 'loadStart' });
      out.push({ name: 'Патрон', dur: tm('loadOne', 0.5), action: 'loadOne' });
      out.push({ name: 'Патрон', dur: tm('loadOne', 0.5), action: 'loadOne' });
      out.push({ name: 'Зарядка: конец', dur: tm('loadEnd', 0.4), action: 'loadEnd' });
    }
    if (g.modes.length > 1) out.push({ name: 'Режим огня', dur: tm('mode', 0.3), action: 'mode' });
    out.push({ name: 'Осмотр', dur: tm('inspect', 3), action: 'inspect' });
    out.push({ name: 'Удар прикладом', dur: tm('bash', 0.7), action: 'bash' });
    out.push({ name: 'Бег', dur: 1.6, sprint: true });
    out.push({ name: 'Убрать', dur: tm('holster', 0.5), action: 'holster' });
    out.push({ name: 'Достать', dur: tm('draw', 0.6), action: 'draw' });
    return out;
  };
  let play: { list: Move[]; i: number; t: number; loop: boolean } | null = null;
  let playLast = performance.now();
  const playLabel = () => (play ? `▶ ${play.list[play.i].name}` : '');
  /** One frame of playback (real time); false when it is over. */
  const playStep = (): boolean => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - playLast) / 1000);
    playLast = now;
    if (!play) return false;
    let m = play.list[play.i];
    if (play.t >= m.dur) {
      play.i++;
      play.t = 0;
      if (play.i >= play.list.length) {
        if (!play.loop) {
          play = null;
          say('');
          return false;
        }
        play.i = 0;
      }
      m = play.list[play.i];
      say(playLabel());
    }
    const first = play.t === 0;
    const gv = vm.gunView;
    gv.ads = !!m.ads;
    gv.wall = 0;
    gv.wallDist = 99;
    gv.chamber = true;
    gv.action = m.action ?? 'idle';
    gv.duration = m.action ? m.dur : 1;
    gv.t = m.action ? Math.min(play.t, m.dur) : 0;
    if (first && m.shot && isGunId(id)) {
      const r = GUNS[id].recoil;
      vm.fire(r.up, r.side, r.back);
    }
    const f = frame();
    f.sprinting = !!m.sprint;
    f.speed = m.sprint ? 5.5 : 0;
    for (let k = 0; k < 2; k++) {
      vm.fixedUpdate(dt / 2, first && k === 0 && !!m.swing);
      vm.update(dt / 2, f);
    }
    play.t += dt;
    return true;
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
        if (tab === 'keys') return { at: vi.gunPose.pos.clone(), q: vi.gunPose.q.clone() };
        if (tab === 'stance') return { at: d.hipAt.clone(), q: d.hipQ.clone() };
        if (tab === 'sprint' || tab === 'reload') {
          const k = d.cls[tab];
          return { at: vec(k.at), q: keyQ(d, k, new Quaternion()) };
        }
        if (tab === 'bolt') return d.cls.cycle ? { at: vec(d.cls.cycle.at), q: keyQ(d, d.cls.cycle, new Quaternion()) } : { at: vi.gunPose.pos.clone(), q: vi.gunPose.q.clone() };
        return null;
      }
      const g = vi.gunPose;
      if (tab === 'keys') {
        // As posed at this moment (the keys in).
        if (target === 'R') return { at: g.rightGrip.clone(), q: g.rightQ.clone() };
        return { at: g.leftGrip.clone(), q: g.leftQ.clone() };
      }
      const h = target === 'R' ? d.main : tab === 'bolt' ? d.bolt : d.off;
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
    if (isGunId(id) && tab === 'keys') {
      // A key of this move at this moment (made if there is none).
      const all = (G.keys ??= {});
      const list = (all[keyAct] ??= []);
      let key = keyAt();
      if (!key) {
        key = { k: Math.round(keyK * 1000) / 1000 };
        list.push(key);
        list.sort((x, y) => x.k - y.k);
        keyK = key.k;
      }
      const g = vi.gunPose;
      if (target === 'gun') key.gun = f;
      else if (target === 'R') {
        // The gun follows the right hand: gun = hand × main⁻¹.
        const d = gunRigData(id);
        const q = proxy.quaternion.clone().multiply(d.main.q.clone().invert());
        key.gun = frameOf(proxy.position.clone().sub(d.main.at.clone().applyQuaternion(q)), q);
      } else {
        const inv = g.q.clone().invert();
        key.L = frameOf(proxy.position.clone().sub(g.pos).applyQuaternion(inv), inv.multiply(proxy.quaternion));
      }
    } else if (isGunId(id)) {
      if (target === 'gun') {
        if (tab === 'stance') G.stance = f;
        else if (tab === 'sprint') G.sprint = f;
        else if (tab === 'reload') G.reload = f;
        else if (tab === 'bolt') G.cycle = f;
      } else {
        // Into the gun frame: gun⁻¹ × hand.
        const g = vi.gunPose;
        const inv = g.q.clone().invert();
        const at = proxy.position.clone().sub(g.pos).applyQuaternion(inv);
        const q = inv.multiply(proxy.quaternion);
        G[target === 'R' ? 'main' : tab === 'bolt' ? 'bolt' : 'off'] = frameOf(at, q);
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

  /** «Кадры»: the move, the moment on its timeline, its keys. */
  function keysPanel(): void {
    const acts = keyActions();
    if (!acts.includes(keyAct)) keyAct = acts[0];
    const refresh = (n = 30) => {
      settle(n);
      placeProxy();
      updateOut();
    };
    const go = (k: number) => {
      keyK = Math.min(1, Math.max(0, k));
      // Onto a key close by, so it is edited exactly where it is.
      const near = keyList().find((x) => Math.abs(x.k - keyK) < 0.02);
      if (near) keyK = near.k;
      build();
      refresh();
    };
    const as = el<HTMLSelectElement>('select');
    for (const a of acts) {
      const n = grip().keys?.[a]?.length ?? 0;
      as.append(el('option', { value: a, textContent: `${ACT_NAMES[a] ?? a}${n ? ` · ключей ${n}` : ''}`, selected: a === keyAct }));
    }
    as.onchange = () => {
      keyAct = as.value as GunAction;
      keyK = keyList()[0]?.k ?? 0.5;
      build();
      refresh(60);
    };
    const dur = actTime(keyAct);
    const when = (k: number) => `${Math.round(k * 100)}% · ${(k * dur).toFixed(2)} с`;
    // The timeline: the moment and the keys on it (click a mark to go to it).
    const line = el('div', { className: 'ge__line' });
    const r = el<HTMLInputElement>('input', { type: 'range', min: '0', max: '1', step: '0.005', value: String(keyK) });
    const val = el('span', { textContent: when(keyK) });
    r.oninput = () => {
      keyK = Number(r.value);
      val.textContent = when(keyK);
      refresh(20);
    };
    r.onchange = () => go(Number(r.value));
    const list = keyList();
    for (const x of list) {
      const m = el('div', { className: `ge__mark${Math.abs(x.k - keyK) < 0.02 ? ' on' : ''}`, title: `${Math.round(x.k * 100)}%${x.gun ? ' оружие' : ''}${x.L ? ' левая' : ''}` });
      m.style.left = `calc(7px + (100% - 14px) * ${x.k})`;
      m.onclick = () => go(x.k);
      line.append(m);
    }
    line.append(r);
    const prev = el<HTMLButtonElement>('button', { textContent: '◀ ключ', disabled: !list.some((x) => x.k < keyK - 1e-4) });
    const next = el<HTMLButtonElement>('button', { textContent: 'ключ ▶', disabled: !list.some((x) => x.k > keyK + 1e-4) });
    prev.onclick = () => go([...list].reverse().find((x) => x.k < keyK - 1e-4)!.k);
    next.onclick = () => go(list.find((x) => x.k > keyK + 1e-4)!.k);
    const key = keyAt();
    const drop = () => {
      const all = grip().keys!;
      all[keyAct] = list.filter((x) => x !== key);
      if (!all[keyAct]!.length) delete all[keyAct];
      if (!Object.keys(all).length) delete grip().keys;
      gripsChanged();
      build();
      refresh();
      say('Ключ удалён (не сохранено)');
    };
    const del = el<HTMLButtonElement>('button', { textContent: 'Удалить ключ', disabled: !key });
    del.onclick = drop;
    const part = (p: 'gun' | 'L', name: string) => {
      const b = el<HTMLButtonElement>('button', { textContent: `без ${name}`, disabled: !key?.[p], title: `Ключ не трогает ${name}` });
      b.onclick = () => {
        delete key![p];
        if (!key!.gun && !key!.L) return drop();
        gripsChanged();
        build();
        refresh();
      };
      return b;
    };
    const playIt = el('button', { textContent: '▶ Проиграть' });
    playIt.onclick = () => {
      play = { list: [{ name: ACT_NAMES[keyAct] ?? keyAct, dur, action: keyAct }], i: 0, t: 0, loop: false };
      playLast = performance.now();
      say(playLabel());
    };
    const what = key ? [key.gun && 'оружие (с правой)', key.L && 'левая'].filter(Boolean).join(', ') || '—' : '';
    panel.append(
      el('h3', { textContent: 'Кадр движения' }),
      el('div', { className: 'ge__row' }, as, playIt),
      el('label', {}, 'момент ', val),
      line,
      el('div', { className: 'ge__row' }, prev, next, del),
      el('div', { className: 'ge__row' }, part('gun', 'оружия'), part('L', 'левой')),
      el('div', { className: 'ge__hint', textContent: key ? `Ключ ${Math.round(key.k * 100)}%: ${what}` : 'Здесь ключа нет: сдвиньте оружие или кисть — появится ключ этого момента (только этого движения)' }),
    );
    if (key) {
      const sp = el<HTMLInputElement>('input', { type: 'range', min: '0.02', max: '0.6', step: '0.01', value: String(key.span ?? 0.15) });
      const sv = el('span', { textContent: `${Math.round((key.span ?? 0.15) * 100)}%` });
      sp.oninput = () => {
        key.span = Number(sp.value);
        sv.textContent = `${Math.round(key.span * 100)}%`;
        gripsChanged();
      };
      panel.append(el('label', { title: 'Сколько движения до и после ключа он набирает и отпускает силу' }, 'плавность ', sp, sv));
    }
  }

  function build(): void {
    panel.replaceChildren();
    const gun = isGunId(id);
    const sel = el<HTMLSelectElement>('select');
    for (const x of ITEMS) sel.append(el('option', { value: x, textContent: isGunId(x) ? `${GUNS[x].name} (${x})` : x, selected: x === id }));
    sel.onchange = () => {
      id = sel.value;
      history.replaceState(null, '', `?gripedit=${id}${body === 'male' ? '' : `&body=${body}`}`);
      equip();
    };
    panel.append(el('h3', { textContent: 'Предмет' }), el('div', { className: 'ge__row' }, sel));
    // The costume: its sleeves and arm lengths (the grips are the gun's, the same in every costume).
    const bs = el<HTMLSelectElement>('select');
    for (const b of BODY_IDS) bs.append(el('option', { value: b, textContent: BODY_NAMES[b] ?? b, selected: b === body }));
    bs.onchange = () =>
      void setArms(bs.value as BodyId).then(() => {
        history.replaceState(null, '', `?gripedit=${id}${body === 'male' ? '' : `&body=${body}`}`);
        settle(60);
        placeProxy();
        updateOut();
      });
    panel.append(el('h3', { textContent: 'Костюм' }), el('div', { className: 'ge__row' }, bs));

    const tabs = el('div', { className: 'ge__row' });
    for (const t of Object.keys(TAB_NAMES) as Tab[]) {
      const b = el<HTMLButtonElement>('button', { textContent: TAB_NAMES[t], className: t === tab ? 'on' : '', disabled: (!gun && (t === 'ads' || t === 'reload' || t === 'keys')) || (t === 'bolt' && !boltGun(id)) });
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
    const names: Record<Target, string> = { gun: gun ? 'Оружие' : 'Предмет', R: 'Правая кисть', L: tab === 'bolt' ? 'Левая на затворе' : 'Левая кисть', torch: 'Фонарик' };
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
    if (gun && tab === 'keys') keysPanel();

    // Hand poses.
    const hp = el('div');
    for (const side of (tab === 'bolt' ? ['R', 'L', 'bolt'] : ['R', 'L']) as ('R' | 'L' | 'bolt')[]) {
      const s = el<HTMLSelectElement>('select');
      const L = grip().hands?.L ?? (gun ? 'grip_support' : heldConfig(id as HeldId | 'fists').twoHanded ? 'grip_fist' : 'relaxed');
      const cur = side === 'bolt' ? (grip().hands?.bolt ?? L) : side === 'L' ? L : (grip().hands?.R ?? (gun ? 'grip_trigger' : 'grip_fist'));
      for (const p of HAND_POSES) s.append(el('option', { value: p, textContent: p, selected: p === cur }));
      s.onchange = () => {
        const G = grip();
        G.hands = { ...G.hands, [side]: s.value as HandPose };
        gripsChanged();
        settle(2);
      };
      hp.append(el('label', {}, side === 'R' ? 'Правая' : side === 'L' ? 'Левая' : 'Левая на затворе', s));
    }
    panel.append(el('h3', { textContent: 'Поза кисти' }), hp);

    // Playback.
    const list = moves();
    const pick = el<HTMLSelectElement>('select');
    list.forEach((m, i) => pick.append(el('option', { value: String(i), textContent: m.name })));
    const one = el('button', { textContent: '▶ Играть' });
    const all = el('button', { textContent: 'Всё подряд' });
    const loop = el<HTMLInputElement>('input', { type: 'checkbox' });
    const stop = el('button', { textContent: '■ Стоп' });
    const start = (l: Move[]) => {
      play = { list: l, i: 0, t: 0, loop: loop.checked };
      playLast = performance.now();
      say(playLabel());
    };
    one.onclick = () => start([list[Number(pick.value)]]);
    all.onclick = () => start(list);
    stop.onclick = () => {
      play = null;
      say('');
    };
    panel.append(el('h3', { textContent: 'Анимации' }), el('div', { className: 'ge__row' }, pick, one), el('div', { className: 'ge__row' }, all, stop, el('label', {}, loop, 'по кругу')));

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
    tab = (!isGunId(id) && (tab === 'ads' || tab === 'reload' || tab === 'keys')) || (tab === 'bolt' && !boltGun(id)) ? 'stance' : tab;
    if (isGunId(id) && !keyActions().includes(keyAct)) keyAct = keyActions()[0];
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
  if (firstBody && (BODY_IDS as readonly string[]).includes(firstBody)) await setArms(firstBody);
  equip();
  const tick = () => {
    if (!playStep()) settle(1);
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
      /** One frame of the playing animation (scripts: frames at their own pace); false when over. */
      playStep,
      playing: () => playLabel(),
      set: (x: string, t: Tab, tg: Target = 'gun') => {
        id = x;
        tab = t;
        target = tg;
        equip();
        settle(120);
        render();
      },
      /** «Кадры»: go to a moment of a move. */
      moment: (a: GunAction, k: number) => {
        keyAct = a;
        keyK = k;
        build();
        settle(60);
        placeProxy();
      },
      /** Move the gizmo's thing by (x, y, z) m, as a drag would. */
      nudge: (x: number, y: number, z: number) => {
        proxy.position.add(new Vector3(x, y, z));
        writeBack();
        placeProxy();
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
