import {
  BufferAttribute,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Skeleton,
  SkinnedMesh,
  Timer,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { absoluteClip, CLIP_NAMES, type ClipName, ZombieAnimator, zombieClips } from '../zombies/animations';
import { createZombie, setZombieOutline, type ZombieInstance, type ZombieType } from '../zombies/buildZombie';
import { createBones } from '../zombies/skeleton';
import { ZOMBIE_TYPES } from '../zombies/types';

/**
 * tools/zombie-viewer.html (dev server): orbit camera, every procedural zombie type, every shared clip,
 * triangles and draw calls, GLB export. URL: ?type=worker&anim=Walk&view=front|side|back|34&t=0.4
 * (t freezes the clip at that time) &outline=0 &shot=name (posts a frame to /__shot → .shots/name.jpg).
 */
const q = new URLSearchParams(location.search);
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0xe4e4e2);
scene.add(new HemisphereLight(0xffffff, 0x8a8a80, 1.6));
const sun = new DirectionalLight(0xffffff, 1.8);
sun.position.set(-2, 4, -3);
scene.add(sun);
const ground = new Mesh(new CircleGeometry(1.2, 32).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: 0xcfcfcb }));
scene.add(ground);
const camera = new PerspectiveCamera(28, 1, 0.05, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);

const VIEWS: Record<string, [number, number, number]> = { front: [0, 1.0, -4.4], side: [-4.4, 1.0, 0], back: [0, 1.0, 4.4], '34': [-3.1, 1.0, -3.1] };
function setView(v: string): void {
  const p = VIEWS[v] ?? VIEWS.front;
  camera.position.set(...p);
  controls.update();
}

let zombie: ZombieInstance | null = null;
let anim: ZombieAnimator | null = null;
let clipName: ClipName | 'Rest' = (q.get('anim') as ClipName) ?? 'Idle';
const frozen = q.has('t') ? Number(q.get('t')) : null;

function load(type: ZombieType): void {
  if (zombie) scene.remove(zombie.mesh);
  zombie = createZombie(type);
  scene.add(zombie.mesh);
  anim = new ZombieAnimator(zombie.mesh, type.animSpeed);
  play(clipName);
}

function play(name: ClipName | 'Rest'): void {
  clipName = name;
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
outline.checked = q.get('outline') !== '0';
outline.onchange = () => setZombieOutline(outline.checked);
setZombieOutline(outline.checked);
const ref = document.getElementById('ref') as HTMLImageElement;
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
  if (frozen === null) anim?.update(Math.min(0.05, timer.getDelta()));
  else anim?.mixer.setTime(frozen);
  renderer.render(scene, camera);
  const r = renderer.info.render;
  const b = zombie?.built;
  stats.textContent = b
    ? `треугольники: ${b.triangles} (+${b.outlineTriangles} обводка)\nкадр: ${r.triangles} тр., ${r.calls} draw calls\nзомби: 1 draw call`
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
  const p = VIEWS[view] ?? VIEWS.front;
  const len = Math.hypot(p[0], p[2]);
  controls.target.set(0, y, 0);
  camera.position.set((p[0] / len) * dist, y + 0.05, (p[2] / len) * dist);
  controls.update();
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
Object.assign(window, { __viewer: { play, setView, shot, scene, renderer, camera, controls } });
