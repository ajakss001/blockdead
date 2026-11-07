import {
  BufferAttribute,
  CircleGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Skeleton,
  SkinnedMesh,
  Timer,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { absoluteClip, CLIP_NAMES, type ClipName, strideOf, ZombieAnimator, zombieClips } from '../zombies/animations';
import { buildZombie, createZombie, setZombieOutline, type ZombieInstance, type ZombieType } from '../zombies/buildZombie';
import { look } from '../style/look';
import { grim } from '../style/palette';
import { boneIndex, createBones } from '../zombies/skeleton';
import { ZOMBIE_TYPES as GAME_TYPES } from '../zombies/types';
import { refSurvivor, survivorType } from '../zombies/types/survivor';
import { applyStage, onLook, setLook } from './viewerStage';

/**
 * tools/zombie-viewer.html (dev server): orbit camera, every procedural zombie type, every shared clip,
 * triangles and draw calls, GLB export. URL: ?type=worker&anim=Walk&view=front|side|back|34&t=0.4
 * (t freezes the clip at that time) &outline=1 &look=toy (the old look, see viewerStage) &shot=name (posts a frame to /__shot → .shots/name.jpg).
 * Gait check: «идёт по полу» — the floor (a 25 cm grid) moves under Walk / Run by the stride, as the game
 * times the steps by the ground covered, and heel and toe leave marks where they touch: a planted foot
 * leaves a dot, a skidding one a streak (the biggest skid is shown); «0.25x» slows it down.
 */
/** The zombie types and the living survivors (the player's figure, the reference bases). */
const ZOMBIE_TYPES: Record<string, ZombieType> = { ...GAME_TYPES, liveM: survivorType(refSurvivor('male'), 'liveM'), liveF: survivorType(refSurvivor('female'), 'liveF') };
ZOMBIE_TYPES.liveM.name = 'Выживший (игрок)';
ZOMBIE_TYPES.liveF.name = 'Выжившая (игрок)';
const q = new URLSearchParams(location.search);
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);
const scene = new Scene();
const hemi = new HemisphereLight();
const sun = new DirectionalLight();
sun.position.set(-2, 4, -3);
scene.add(hemi, sun);
const groundMat = new MeshLambertMaterial();
const ground = new Mesh(new CircleGeometry(1.2, 32).rotateX(-Math.PI / 2), groundMat);
scene.add(ground);
/** The game's light and fog («после») or the old bright studio («до»). */
function stage(): void {
  applyStage({ scene, hemi, sun, toy: { bg: 0xe4e4e2, hemi: [0xffffff, 0x8a8a80, 1.6], sun: [0xffffff, 1.8] } });
  groundMat.color = new Color(look.grim ? grim(0x5a574c) : 0xcfcfcb);
}
stage();
const camera = new PerspectiveCamera(28, 1, 0.05, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);

const VIEWS: Record<string, [number, number, number]> = { front: [0, 1.0, -4.4], side: [-4.4, 1.0, 0], back: [0, 1.0, 4.4], '34': [-3.1, 1.0, -3.1] };
function setView(v: string): void {
  const p = VIEWS[v] ?? VIEWS.front;
  camera.position.set(...p);
  controls.update();
}

const ref = document.getElementById('ref') as HTMLImageElement;
let zombie: ZombieInstance | null = null;
let anim: ZombieAnimator | null = null;
let clipName: ClipName | 'Rest' = (q.get('anim') as ClipName) ?? 'Idle';
const frozen = q.has('t') ? Number(q.get('t')) : null;

// ── Gait check: a moving floor and footprints ──
const floor = new Group();
scene.add(floor);
const grid = new GridHelper(12, 48, 0x8a8b80, 0x6a6b62);
grid.position.y = 0.001;
grid.visible = false;
scene.add(grid);
const PRINTS = 800;
const prints = new InstancedMesh(new CircleGeometry(0.01, 8).rotateX(-Math.PI / 2), new MeshBasicMaterial(), PRINTS);
prints.count = 0;
prints.frustumCulled = false;
floor.add(prints);
const PRINT_L = new Color(0xd8cf9a);
const PRINT_R = new Color(0x9fc4d0);
const PRINT_SCUFF = new Color(0x8a5a48);
let treadmill = false;
let rate = 1;
let walked = 0;
/**
 * Per heel / toe of each foot: where it touched down (floor frame), how far it has skidded since, and whether
 * the foot stood on it (a toe touching with the heel up is the limp's scuff: marked, not counted).
 */
const contact: ({ at: Vector3; last: Vector3; skid: number; stand: boolean } | null)[] = [null, null, null, null];
let maxSkid = 0;
const _pv = new Vector3();
const _pm = new Matrix4();

function clearPrints(): void {
  prints.count = 0;
  contact.fill(null);
  maxSkid = 0;
}

/** Move the floor by the ground the clip covered (as the game: the stride of this build), mark the soles. */
function gaitStep(clipBefore: number): void {
  const moving = treadmill && (clipName === 'Walk' || clipName === 'Run') && zombie && anim;
  grid.visible = !!moving;
  ground.visible = !moving;
  if (!moving) return;
  const a = anim!.actions[clipName as 'Walk' | 'Run'];
  const dur = a.getClip().duration;
  const d = zombie!.built.dims;
  const dt = (((a.time - clipBefore) % dur) + dur) % dur;
  walked += (dt / dur) * strideOf(clipName as 'Walk' | 'Run', d.hipJointY - d.ankleY);
  floor.position.z = walked;
  grid.position.z = walked % 0.25;
  zombie!.mesh.updateMatrixWorld(true);
  // Not while the clip fades in (a half-weighted step slides by itself).
  if (a.getEffectiveWeight() < 0.999) return void contact.fill(null);
  const sole = -d.ankleY;
  (['Foot_L', 'Foot_R'] as const).forEach((name, f) => {
    const m = zombie!.bones[boneIndex(name)].matrixWorld;
    // The back of the heel and the toe of the shoe (zombies/gait HEEL, TIP).
    [0.08 * d.k, -0.165 * d.k].forEach((z, e) => {
      const i = f * 2 + e;
      _pv.set(0, sole, z).applyMatrix4(m);
      const down = _pv.y < 0.005;
      _pv.set(_pv.x, 0.002, _pv.z - walked);
      const c = contact[i];
      if (!down) {
        contact[i] = null;
        return;
      }
      if (!c) contact[i] = { at: _pv.clone(), last: _pv.clone(), skid: 0, stand: e === 0 || !!contact[f * 2] };
      else {
        c.skid = Math.max(c.skid, Math.hypot(_pv.x - c.at.x, _pv.z - c.at.z));
        if (c.stand) maxSkid = Math.max(maxSkid, c.skid);
        if (c.last.distanceTo(_pv) < 0.004) return;
        c.last.copy(_pv);
      }
      const n = prints.count < PRINTS ? prints.count++ : Math.floor(Math.random() * PRINTS);
      prints.setMatrixAt(n, _pm.makeTranslation(_pv));
      prints.setColorAt(n, !contact[i]!.stand ? PRINT_SCUFF : f ? PRINT_R : PRINT_L);
      prints.instanceMatrix.needsUpdate = true;
      if (prints.instanceColor) prints.instanceColor.needsUpdate = true;
    });
  });
}

function load(type: ZombieType): void {
  if (zombie) scene.remove(zombie.mesh);
  zombie = createZombie(type);
  scene.add(zombie.mesh);
  ref.src = `/refs/zombie_${type.id}.jpg`;
  anim = new ZombieAnimator(zombie.mesh, type.animSpeed, buildZombie(type).dims);
  play(clipName);
}

function play(name: ClipName | 'Rest'): void {
  clipName = name;
  clearPrints();
  if (!anim) return;
  if (name === 'Rest') anim.mixer.stopAllAction();
  else anim.play(name, frozen === null ? 0.2 : 0);
  if (frozen !== null) anim.mixer.setTime(frozen);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#anims button')) b.classList.toggle('on', b.textContent === name);
}

// ── UI ──
const typeSel = document.getElementById('type') as HTMLSelectElement;
for (const t of Object.values(ZOMBIE_TYPES)) typeSel.add(new Option(t.name, t.id));
typeSel.value = q.get('type') ?? typeSel.value;
typeSel.onchange = () => load(ZOMBIE_TYPES[typeSel.value]);
const anims = document.getElementById('anims')!;
for (const n of ['Rest', ...CLIP_NAMES] as const) {
  const b = document.createElement('button');
  b.textContent = n;
  b.onclick = () => play(n);
  anims.appendChild(b);
}
const views = document.getElementById('views')!;
for (const v of Object.keys(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = v;
  b.onclick = () => setView(v);
  views.appendChild(b);
}
const outline = document.getElementById('outline') as HTMLInputElement;
outline.checked = q.get('outline') === '1';
outline.onchange = () => setZombieOutline(outline.checked);
setZombieOutline(outline.checked);
// «до/после»: the old look had the outline on.
onLook(() => {
  stage();
  outline.checked = !look.grim;
  setZombieOutline(outline.checked);
  load(ZOMBIE_TYPES[typeSel.value]);
});
const treadBox = document.getElementById('treadmill') as HTMLInputElement;
treadBox.checked = q.has('treadmill');
treadmill = treadBox.checked;
treadBox.onchange = () => {
  treadmill = treadBox.checked;
  clearPrints();
};
const slowBox = document.getElementById('slow') as HTMLInputElement;
slowBox.checked = q.has('slow');
rate = slowBox.checked ? 0.25 : 1;
slowBox.onchange = () => (rate = slowBox.checked ? 0.25 : 1);
(document.getElementById('showref') as HTMLInputElement).onchange = (e) => (ref.style.display = (e.target as HTMLInputElement).checked ? 'block' : 'none');
document.getElementById('export')!.onclick = () => exportGlb();
const stats = document.getElementById('stats')!;

/** GLB: the body without the outline hull, a standard material, the clips baked onto this type's rest pose. */
function exportGlb(): void {
  if (!zombie) return;
  const b = zombie.built;
  const g = b.geometry.clone();
  const idx = Array.from(g.index!.array).slice(0, b.triangles * 3);
  const verts = Math.max(...idx) + 1;
  g.setIndex(idx);
  for (const name of Object.keys(g.attributes)) {
    if (name === 'aGlow' || name === 'aOutline') g.deleteAttribute(name);
    else {
      const a = g.getAttribute(name) as BufferAttribute;
      g.setAttribute(name, new BufferAttribute(a.array.slice(0, verts * a.itemSize), a.itemSize, a.normalized));
    }
  }
  g.setDrawRange(0, Infinity);
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.name = b.type.id;
  const bones = createBones(b.dims);
  mesh.add(bones[0]);
  mesh.bind(new Skeleton(bones, b.inverses.map((m) => m.clone())));
  const clips = Object.values(zombieClips()).map((c) => absoluteClip(c, b.dims));
  new GLTFExporter().parse(
    mesh,
    (glb) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' }));
      a.download = `zombie_${b.type.id}.glb`;
      a.click();
    },
    (err) => console.error(err),
    { binary: true, animations: clips },
  );
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
setView(q.get('view') ?? 'front');
load(ZOMBIE_TYPES[typeSel.value]);

const timer = new Timer();
let shotDone = false;
function frame(): void {
  timer.update();
  const before = anim && (clipName === 'Walk' || clipName === 'Run') ? anim.actions[clipName].time : 0;
  if (frozen === null) anim?.update(Math.min(0.05, timer.getDelta()) * rate);
  else anim?.mixer.setTime(frozen);
  gaitStep(before);
  renderer.render(scene, camera);
  const r = renderer.info.render;
  const b = zombie?.built;
  stats.textContent = b
    ? `треугольники: ${b.triangles} (+${b.outlineTriangles} обводка)\nкадр: ${r.triangles} тр., ${r.calls} draw calls\nзомби: 1 draw call` +
      (grid.visible
        ? `\nшаг (цикл): ${strideOf(clipName as 'Walk' | 'Run', b.dims.hipJointY - b.dims.ankleY).toFixed(2)} м\nскольжение стопы: макс. ${(maxSkid * 100).toFixed(1)} см`
        : '')
    : '';
  const shot = q.get('shot');
  if (shot && !shotDone) {
    shotDone = true;
    void fetch(`/__shot?name=${encodeURIComponent(shot)}`, { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.9) });
  }
  requestAnimationFrame(frame);
}
frame();
/**
 * Debug / screenshots without a visible page (no animation frames then): a view from a side at a distance,
 * looking at a height, a clip frozen at t, rendered now and posted to /__shot.
 */
async function shot(name: string, view = 'front', dist = 4.4, y = 0.95, clip: ClipName | 'Rest' = 'Rest', t = 0): Promise<string> {
  aim(view, dist, y);
  if (anim) {
    anim.mixer.stopAllAction();
    if (clip !== 'Rest') {
      anim.actions[clip].reset().setEffectiveWeight(1).play();
      anim.mixer.setTime(t);
    } else anim.mixer.update(0);
  }
  renderer.render(scene, camera);
  await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.9) });
  return name;
}
function aim(view: string, dist: number, y: number): void {
  const p = VIEWS[view] ?? VIEWS.front;
  const len = Math.hypot(p[0], p[2]);
  controls.target.set(0, y, 0);
  camera.position.set((p[0] / len) * dist, y + 0.05, (p[2] / len) * dist);
  controls.update();
}
/** A shot of Walk or Run on the moving floor at phase u (0: the left heel strikes), after two cycles of prints. */
async function phaseShot(name: string, view: string, dist: number, y: number, clip: 'Walk' | 'Run', u: number): Promise<string> {
  aim(view, dist, y);
  if (!anim) return name;
  clipName = clip;
  clearPrints();
  anim.mixer.stopAllAction();
  const a = anim.actions[clip];
  a.reset().setEffectiveWeight(1).play();
  const dur = a.getClip().duration;
  const n = 240;
  for (let i = 1; i <= n; i++) {
    const before = a.time;
    a.time = ((dur * (2 + u) * i) / n) % dur;
    anim.mixer.update(0);
    gaitStep(before);
  }
  renderer.render(scene, camera);
  await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.9) });
  return name;
}
/** Run the clip `n` frames of `dt` s without animation frames (debug): the feet's worst skid since it began, cm. */
function step(n: number, dt = 1 / 60): number {
  for (let i = 0; i < n; i++) {
    const before = anim && (clipName === 'Walk' || clipName === 'Run') ? anim.actions[clipName].time : 0;
    anim?.update(dt * rate);
    gaitStep(before);
  }
  renderer.render(scene, camera);
  return Math.round(maxSkid * 1000) / 10;
}
/** Switch the type (debug): its triangles, body and outline. */
function pick(id: string): [number, number] {
  typeSel.value = id;
  load(ZOMBIE_TYPES[id]);
  return [zombie!.built.triangles, zombie!.built.outlineTriangles];
}
Object.assign(window, { __viewer: { play, step, setView, shot, phaseShot, pick, setLook, scene, renderer, camera, controls } });
