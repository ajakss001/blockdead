import {
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  type Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildWeapon, weaponMesh } from '../weapons/buildWeapon';
import { WEAPON_IDS, WEAPONS, type WeaponId } from '../weapons/config';

/**
 * The "Оружие" tab of tools/zombie-viewer.html: the four procedural weapons (weapons/buildWeapon) — turn
 * them with the mouse, play the first-person animations on the model alone, triangle and draw-call counts.
 * Its own canvas over the zombie viewer's; the zombie tab is left as it is.
 */

type Anim = 'idle' | 'equip' | 'attack' | 'hit';
const ANIM_LEN: Record<Anim, number> = { idle: 0, equip: 0.45, attack: 0, hit: 0.25 };

const tabs = document.getElementById('tabs')!;
const zombieUi = document.getElementById('ui')!;
const panel = document.getElementById('weaponUi')!;
const refImg = document.getElementById('ref') as HTMLImageElement;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setClearColor(0xe4e4e2);
Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '5', display: 'none' });
document.body.append(renderer.domElement);

const scene = new Scene();
scene.add(new HemisphereLight(0xffffff, 0x8a8478, 1.6));
const sun = new DirectionalLight(0xffffff, 1.8);
sun.position.set(1.5, 3, 2);
scene.add(sun);
const grid = new GridHelper(2, 20, 0xb8b8b4, 0xcfcfcb);
grid.position.y = -0.3;
scene.add(grid);
const camera = new PerspectiveCamera(35, 1, 0.01, 20);

/** Turned by the mouse; the anim moves `rig` inside it. */
const turn = new Group();
const rig = new Group();
/** Holds the meshes, shifted so the turn is about their middle. */
const holder = new Group();
rig.add(holder);
turn.add(rig);
scene.add(turn);

let current: WeaponId | 'all' = 'fireAxe';
let anim: Anim = 'idle';
let animT = 0;
let yaw = -0.6;
let pitch = 0.25;
let spin = false;
const meshes: Mesh[] = [];

function show(id: WeaponId | 'all'): void {
  current = id;
  for (const m of meshes) holder.remove(m);
  meshes.length = 0;
  const ids = id === 'all' ? WEAPON_IDS : [id];
  ids.forEach((w, i) => {
    const m = weaponMesh(w);
    // Side view: the weapon along the screen (−Z → +X), side by side when all are shown.
    m.rotation.y = -Math.PI / 2;
    // Each one centred on its own length.
    if (id === 'all') m.position.set(WEAPONS[w].grip - WEAPONS[w].length / 2, 0.36 - i * 0.24, 0);
    holder.add(m);
    meshes.push(m);
  });
  frame();
  updateButtons();
  stats();
}

/** Camera distance to fit what is shown. */
function frame(): void {
  holder.position.set(0, 0, 0);
  holder.updateMatrixWorld(true);
  const box = new Box3();
  for (const m of meshes) {
    m.updateMatrix();
    box.union(new Box3().copy(m.geometry.boundingBox!).applyMatrix4(m.matrix));
  }
  const size = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  holder.position.set(-c.x, -c.y, -c.z);
  // Fill about two thirds of the view.
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  const aspect = innerWidth / innerHeight;
  camera.position.set(0, 0, 1.5 * Math.max(size.x / 2 / (tan * aspect), size.y / 2 / tan) + size.z);
  camera.lookAt(0, 0, 0);
}

function stats(): void {
  const lines: string[] = [];
  const ids = current === 'all' ? WEAPON_IDS : [current];
  for (const id of ids) {
    const b = buildWeapon(id);
    const box = b.geometry.boundingBox!;
    const len = box.max.z - box.min.z;
    lines.push(`${WEAPONS[id].name}`, `  треуг. ${b.triangles} + обводка ${b.outlineTriangles} = ${b.triangles + b.outlineTriangles}`, `  длина ${len.toFixed(3)} м`);
  }
  lines.push(`draw calls ${renderer.info.render.calls}`);
  (document.getElementById('wstats') as HTMLElement).textContent = lines.join('\n');
}

function updateButtons(): void {
  for (const b of panel.querySelectorAll<HTMLButtonElement>('button[data-w]')) b.classList.toggle('on', b.dataset.w === current);
  for (const b of panel.querySelectorAll<HTMLButtonElement>('button[data-a]')) b.classList.toggle('on', b.dataset.a === anim);
}

function button(parent: HTMLElement, label: string, data: Record<string, string>, onClick: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.dataset, data);
  b.onclick = onClick;
  parent.append(b);
}

const list = document.getElementById('wlist')!;
for (const id of WEAPON_IDS) button(list, WEAPONS[id].name, { w: id }, () => show(id));
button(list, 'Все', { w: 'all' }, () => show('all'));
const anims = document.getElementById('wanims')!;
const ANIM_NAMES: Record<Anim, string> = { idle: 'Idle', equip: 'Equip', attack: 'Attack', hit: 'Hit' };
for (const a of Object.keys(ANIM_NAMES) as Anim[])
  button(anims, ANIM_NAMES[a], { a }, () => {
    anim = a;
    animT = 0;
    updateButtons();
  });
(document.getElementById('wspin') as HTMLInputElement).onchange = (e) => (spin = (e.target as HTMLInputElement).checked);
(document.getElementById('wref') as HTMLInputElement).onchange = (e) => {
  refImg.src = '/refs/weapons.jpg';
  refImg.style.display = (e.target as HTMLInputElement).checked ? 'block' : 'none';
};

// Drag to turn.
let drag: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw += (e.clientX - drag.x) * 0.01;
  pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.01));
  drag = { x: e.clientX, y: e.clientY };
});

/**
 * The first-person animations on the model alone (the game drives the hands too: player/armRig):
 * idle — breathing; equip — up from below; attack — the chop down (the knife: a thrust); hit — the jolt back.
 */
function pose(dt: number): void {
  animT += dt;
  const t = animT;
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  const knife = current === 'tacticalKnife';
  const interval = current === 'all' ? 1 : WEAPONS[current].interval;
  switch (anim) {
    case 'idle':
      rig.position.y = Math.sin(t * 1.6) * 0.006;
      rig.rotation.z = Math.sin(t * 0.8) * 0.02;
      break;
    case 'equip': {
      const k = Math.min(1, t / ANIM_LEN.equip);
      const e = 1 - (1 - k) ** 3;
      rig.position.y = -0.45 * (1 - e);
      rig.rotation.z = -0.8 * (1 - e);
      if (t > ANIM_LEN.equip + 0.6) animT = 0;
      break;
    }
    case 'attack': {
      // Windup 40%, strike 15%, follow-through + recover the rest of the interval.
      const k = (t % (interval + 0.3)) / interval;
      if (knife) {
        const pull = k < 0.35 ? k / 0.35 : 0;
        const thrust = k < 0.35 ? 0 : k < 0.5 ? (k - 0.35) / 0.15 : Math.max(0, 1 - (k - 0.5) / 0.5);
        rig.position.x = -0.06 * pull + 0.18 * thrust;
      } else {
        const up = k < 0.4 ? Math.sin((k / 0.4) * (Math.PI / 2)) : k < 0.55 ? 1 - ((k - 0.4) / 0.15) * 1.5 : -0.5 * Math.max(0, 1 - (k - 0.55) / 0.45);
        rig.rotation.z = up * 1.1;
      }
      break;
    }
    case 'hit': {
      const k = Math.min(1, t / ANIM_LEN.hit);
      const j = Math.sin(k * Math.PI) * (1 - k);
      rig.position.x = -0.04 * j;
      rig.rotation.z = 0.25 * j;
      if (t > ANIM_LEN.hit + 0.5) animT = 0;
      break;
    }
  }
}

let active = false;
let last = performance.now();
function loop(now: number): void {
  requestAnimationFrame(loop);
  if (!active) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (spin) yaw += dt * 0.6;
  turn.rotation.set(pitch, yaw, 0, 'YXZ');
  pose(dt);
  fit();
  renderer.render(scene, camera);
}

/** Canvas to the window (also without animation frames: a hidden page gets none). */
function fit(): void {
  const w = innerWidth;
  const h = innerHeight;
  if (renderer.domElement.width === Math.floor(w * renderer.getPixelRatio())) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  frame();
}
requestAnimationFrame(loop);

function setTab(tab: string): void {
  active = tab === 'weapons';
  renderer.domElement.style.display = active ? 'block' : 'none';
  panel.style.display = active ? 'flex' : 'none';
  zombieUi.style.display = active ? 'none' : 'flex';
  if (!active) refImg.style.display = 'none';
  for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.tab === tab);
  if (active) {
    fit();
    renderer.render(scene, camera);
    stats();
  }
}
for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.onclick = () => setTab(b.dataset.tab!);
show('fireAxe');
if (new URLSearchParams(location.search).get('tab') === 'weapons') setTab('weapons');

/** Scripts: pick a weapon / an anim, shoot the canvas to .shots (dev server). */
(window as unknown as { __wv: object }).__wv = {
  show,
  setTab,
  view(y: number, p: number) {
    yaw = y;
    pitch = p;
  },
  anim(a: Anim, t = 0) {
    anim = a;
    animT = t;
  },
  async shot(name: string) {
    fit();
    turn.rotation.set(pitch, yaw, 0, 'YXZ');
    pose(0);
    renderer.render(scene, camera);
    stats();
    await fetch(`/__shot?name=${name}`, { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.9) });
  },
  bg(c: number) {
    renderer.setClearColor(new Color(c));
  },
};
