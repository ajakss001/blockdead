import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SpotLight,
  Vector3,
  WebGLRenderer,
} from 'three';
import { FLASHLIGHT } from '../items/config';
import { beamMask, buildFlashlight, flashlightMesh, setLensGlow } from '../items/flashlight';
import { look } from '../style/look';
import { grim } from '../style/palette';
import { applyStage, onLook } from './viewerStage';

/**
 * The "Предметы" tab of tools/zombie-viewer.html: the flashlight (items/flashlight) in a dark, foggy room —
 * turn it with the mouse, switch it on and off, drag the charge to see the beam dim, yellow and flicker.
 */

const tabs = document.getElementById('tabs')!;
const zombieUi = document.getElementById('ui')!;
const panel = document.getElementById('itemUi')!;
const refImg = document.getElementById('ref') as HTMLImageElement;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '5', display: 'none' });
document.body.append(renderer.domElement);

const scene = new Scene();
// The game's light at dusk, so the beam shows and the model still reads («до»: the old cold moonlight).
const hemi = new HemisphereLight();
const moon = new DirectionalLight();
moon.position.set(-1, 2, 1.5);
scene.add(hemi, moon);
// A floor and a back wall for the beam to fall on.
const wallMat = new MeshLambertMaterial();
const floor = new Mesh(new PlaneGeometry(30, 30), wallMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.6;
const wall = new Mesh(new PlaneGeometry(30, 8), wallMat);
wall.position.set(0, 3, -4);
const postMat = new MeshLambertMaterial();
const post = new Mesh(new BoxGeometry(0.3, 2, 0.3), postMat);
post.position.set(0.5, 0.4, -3);
scene.add(floor, wall, post);
function stage(): void {
  applyStage({ scene, hemi, sun: moon, day: 0.3, fog: 0.09, toy: { bg: 0x0b0c0e, hemi: [0x8890a8, 0x8890a8, 0.3], sun: [0xb8c4dc, 0.8], fog: [2, 14] } });
  wallMat.color.set(look.grim ? grim(0x6c6a64) : 0x6c6a64);
  postMat.color.set(look.grim ? grim(0x4a4740) : 0x4a4740);
}
stage();
onLook(stage);

const camera = new PerspectiveCamera(40, 1, 0.01, 40);
camera.position.set(0.25, 0.12, 0.55);
camera.lookAt(0, 0, -0.1);

const turn = new Group();
scene.add(turn);
const { mesh, lens } = flashlightMesh();
turn.add(mesh);
// The beam from the lens, along −Z.
const L = FLASHLIGHT.light;
const spot = new SpotLight(L.color, 0, L.distance, L.angle, L.penumbra, L.decay);
spot.map = beamMask();
spot.position.set(0, 0, FLASHLIGHT.grip - FLASHLIGHT.length);
const target = new Object3D();
target.position.set(0, 0, -5);
spot.target = target;
turn.add(spot, target);

let on = true;
let charge = 1;
let yaw = 0.5;
let pitch = 0.15;
let dropT = 0;
let flickerT = 1;
const full = new Color(L.color);
const weak = new Color(L.weakColor);

const onBox = document.getElementById('ion') as HTMLInputElement;
const chargeIn = document.getElementById('icharge') as HTMLInputElement;
const chargeOut = document.getElementById('icharge-v')!;
onBox.onchange = () => (on = onBox.checked);
chargeIn.oninput = () => {
  charge = Number(chargeIn.value) / 100;
  chargeOut.textContent = `${chargeIn.value}%`;
};
(document.getElementById('iref') as HTMLInputElement).onchange = (e) => {
  refImg.src = '/refs/flashlight.jpg';
  refImg.style.display = (e.target as HTMLInputElement).checked ? 'block' : 'none';
};

let drag: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw += (e.clientX - drag.x) * 0.01;
  pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * 0.01));
  drag = { x: e.clientX, y: e.clientY };
});

/** The same rule as the game (player/Player.lightLevel): dim below 30%, drop-outs below 15%, dead at 0. */
function level(dt: number): number {
  if (!on || charge <= 0) return 0;
  const B = FLASHLIGHT.battery;
  let k = charge >= B.dim ? 1 : 0.3 + (0.7 * charge) / B.dim;
  if (charge < B.flicker) {
    flickerT -= dt;
    if (dropT > 0) {
      dropT -= dt;
      k *= 0.04;
    } else if (flickerT <= 0) {
      dropT = 0.1 + Math.random() * 0.4;
      flickerT = 0.5 + Math.random() * (0.6 + (6 * charge) / B.flicker);
    } else k *= 0.82 + 0.18 * Math.random();
  }
  return k;
}

function frame(dt: number): void {
  turn.rotation.set(pitch, yaw, 0, 'YXZ');
  const k = level(dt);
  spot.intensity = L.intensity * k;
  spot.color.copy(full).lerp(weak, charge < FLASHLIGHT.battery.dim ? 1 - charge / FLASHLIGHT.battery.dim : 0);
  setLensGlow(lens, k);
  fit();
  renderer.render(scene, camera);
  const b = buildFlashlight();
  (document.getElementById('istats') as HTMLElement).textContent =
    `Фонарик\n  треуг. ${b.triangles}\n  длина ${(b.geometry.boundingBox!.max.z - b.geometry.boundingBox!.min.z).toFixed(3)} м\n  свет ${(k * 100).toFixed(0)}%\ndraw calls ${renderer.info.render.calls}`;
}

function fit(): void {
  const w = innerWidth;
  const h = innerHeight;
  if (renderer.domElement.width === Math.floor(w * renderer.getPixelRatio())) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let active = false;
let last = performance.now();
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (active) frame(dt);
}
requestAnimationFrame(loop);

function setTab(tab: string): void {
  active = tab === 'items';
  renderer.domElement.style.display = active ? 'block' : 'none';
  panel.style.display = active ? 'flex' : 'none';
  if (active) {
    zombieUi.style.display = 'none';
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('button[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    frame(0);
  }
}
for (const b of tabs.querySelectorAll<HTMLButtonElement>('button[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab!));
if (new URLSearchParams(location.search).get('tab') === 'items') setTab('items');

/** Scripts: set the view, the switch and the charge, shoot the canvas to .shots (dev server). */
(window as unknown as { __iv: object }).__iv = {
  setTab,
  set(o: { on?: boolean; charge?: number; yaw?: number; pitch?: number; cam?: [number, number, number] }) {
    if (o.on !== undefined) on = onBox.checked = o.on;
    if (o.charge !== undefined) charge = o.charge;
    if (o.yaw !== undefined) yaw = o.yaw;
    if (o.pitch !== undefined) pitch = o.pitch;
    if (o.cam) {
      camera.position.set(...o.cam);
      camera.lookAt(new Vector3(0, 0, -0.1));
    }
  },
  async shot(name: string) {
    frame(1 / 60);
    await fetch(`/__shot?name=${name}`, { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.9) });
  },
};
