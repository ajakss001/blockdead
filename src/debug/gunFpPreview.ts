import { Color, Scene, WebGLRenderer } from 'three';
import { loadCharacters } from '../characters/assets';
import { Viewmodel } from '../player/Viewmodel';
import { GunModel } from '../weapons/gunModel';
import { GUN_IDS, GUNS, type GunId } from '../weapons/guns';
import { type AmmoSource, type GunAction, type GunInput, GunState, newInst } from '../weapons/gunState';

/**
 * /tools/gun-fp.html: every firearm in first-person hands — hip, in the sights (a cross marks the middle of
 * the screen: the front sight sits on it), sprint, mid-reload (the magazine in the left hand), inspect,
 * against a wall. ?gun=rifle_m4a1 one gun only; ?w=360 cell width.
 */
const q = new URLSearchParams(location.search);
const ids = (q.get('gun')?.split(',') as GunId[] | undefined) ?? GUN_IDS;
const W = Number(q.get('w')) || 360;
const H = Math.round((W * 9) / 16);
interface Shot {
  name: string;
  /** Frames to run, the input of each. */
  frames: number;
  inp?: (i: number) => Partial<GunInput>;
  ads?: boolean;
  sprint?: boolean;
  wall?: number;
  /** Stop when the action is this far in. */
  at?: [GunAction, number];
  empty?: boolean;
}
const SHOTS: Shot[] = [
  { name: 'бедро', frames: 40 },
  { name: 'прицел', frames: 40, ads: true },
  { name: 'бег', frames: 50, sprint: true },
  { name: 'перезарядка', frames: 400, inp: (i) => ({ reload: i === 0 }), at: ['reload', 0.4] },
  { name: 'с пустого: затвор', frames: 400, inp: (i) => ({ reload: i === 0 }), at: ['reloadEmpty', 0.84], empty: true },
  { name: 'осмотр', frames: 400, inp: (i) => ({ inspect: i === 0 }), at: ['inspect', 0.3] },
  { name: 'стена', frames: 40, wall: 1 },
];
const plenty = (): AmmoSource => ({ count: () => 999, take: (_id, n) => n, give: () => {}, spareMags: () => 9, takeMag: () => true });

const r = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setPixelRatio(1);
r.setSize(W * SHOTS.length, H * ids.length);
r.autoClear = false;
document.body.appendChild(r.domElement);
const labels = document.createElement('div');
labels.style.cssText = 'position:absolute;left:0;top:0;color:#eee;font:11px monospace;pointer-events:none';
document.body.append(labels);
await loadCharacters(1024);
// The gun files load once (cached), then every viewmodel's model replaces its stand-in at once.
for (const id of ids) new GunModel(id);
await new Promise((res) => setTimeout(res, 2500));
const bg = new Scene();
bg.background = new Color(0x5e6366);
r.setScissorTest(true);
for (const [row, id] of ids.entries()) {
  for (const [col, shot] of SHOTS.entries()) {
    const vm = new Viewmodel();
    vm.setBody('male', 1);
    vm.setAspect(16 / 9);
    vm.setDaylight(1);
    const g = GUNS[id];
    const inst = newInst(id, g.capacity + 1);
    const gs = new GunState(id, inst, plenty());
    vm.equip(id);
    const none: GunInput = { trigger: false, pulled: false, reload: false, mode: false, inspect: false, bash: false, canFire: true };
    const dt = 1 / 60;
    const step = (inp: Partial<GunInput>) => {
      gs.update(dt, { ...none, ...inp });
      const gv = vm.gunView;
      gv.action = gs.action;
      gv.t = gs.t;
      gv.duration = gs.duration;
      gv.open = gs.open;
      gv.chamber = inst.chamber;
      vm.fixedUpdate(dt, false);
      vm.update(dt, { lookX: 0, lookY: 0, stepPhase: 0, speed: shot.sprint ? 5 : 0, sprinting: !!shot.sprint, flashlightOn: false });
    };
    for (let i = 0; i < 120; i++) step({});
    vm.gunView.ads = !!shot.ads;
    vm.gunView.wall = shot.wall ?? 0;
    if (shot.empty && g.feed === 'mag') {
      inst.mag = 0;
      inst.chamber = false;
    }
    if (g.feed !== 'mag' && shot.at?.[0].startsWith('reload')) {
      inst.mag = 0;
      inst.chamber = false;
      shot.at = [g.feed === 'rocket' ? 'reload' : 'loadOne', 0.4];
    }
    for (let i = 0; i < shot.frames; i++) {
      step(shot.inp?.(i) ?? {});
      if (shot.at && gs.action === shot.at[0] && gs.t / gs.duration >= shot.at[1]) break;
    }
    // Let the models arrive (the stand-in is drawn until then).
    await new Promise((res) => setTimeout(res, 30));
    const x = col * W;
    const y = (ids.length - 1 - row) * H;
    r.setViewport(x, y, W, H);
    r.setScissor(x, y, W, H);
    r.clear();
    r.render(bg, vm.camera);
    r.clearDepth();
    r.render(vm.scene, vm.camera);
    const l = document.createElement('div');
    l.style.cssText = `position:absolute;left:${x + 4}px;top:${row * H + 3}px`;
    l.textContent = `${g.name} · ${shot.name}`;
    labels.append(l);
    if (shot.ads) {
      const c = document.createElement('div');
      c.style.cssText = `position:absolute;left:${x + W / 2 - 6}px;top:${row * H + H / 2}px;width:13px;height:1px;background:#f0f`;
      const c2 = document.createElement('div');
      c2.style.cssText = `position:absolute;left:${x + W / 2}px;top:${row * H + H / 2 - 6}px;width:1px;height:13px;background:#f0f`;
      labels.append(c, c2);
    }
  }
}
(window as unknown as { __sheet: boolean }).__sheet = true;
