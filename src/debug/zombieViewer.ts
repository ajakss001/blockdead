import { CircleGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BODY_IDS, type BodyId, type ClipId, loadCharacters } from '../characters/assets';
import { CharacterRig } from '../characters/rig';
import { grim } from '../style/palette';
import { look } from '../style/look';
import { ZOMBIE_TYPES } from '../zombies/types';
import { applyStage, onLook } from './viewerStage';

/**
 * The character models in the game's light and fog (/tools/zombie-viewer.html): a body (man, woman, SWAT)
 * as the player has it or as a zombie of any kind, any clip, front / side / back. `?sheet`: the preview
 * sheet — both bodies (and the SWAT officer) front, side, back, the face and the hands up close, idle /
 * walk / run, and two zombies — one canvas to save.
 */

const q = new URLSearchParams(location.search);
const CLIPS: ClipId[] = ['idle', 'walking', 'walking_female', 'running', 'crouched_walking', 'jump', 'zombie_idle', 'zombie_walk', 'zombie_running', 'zombie_attack', 'zombie_attack_2', 'zombie_scream'];
const sheet = q.has('sheet');

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(sheet ? 1 : Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);

function stage(scene: Scene): void {
  const hemi = new HemisphereLight();
  const sun = new DirectionalLight();
  sun.position.set(2, 4, 3);
  scene.add(hemi, sun);
  const ground = new Mesh(new CircleGeometry(1.2, 32).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: new Color(grim(0x5a574c)) }));
  scene.add(ground);
  const apply = () => applyStage({ scene, hemi, sun, renderer: sheet ? undefined : renderer, toy: { bg: 0xe4e4e2, hemi: [0xffffff, 0x8a8a80, 1.6], sun: [0xffffff, 1.8] }, fog: 0.02 });
  apply();
  onLook(apply);
}

function figure(body: BodyId, kind: string | null): CharacterRig {
  const t = kind ? ZOMBIE_TYPES[kind as keyof typeof ZOMBIE_TYPES] : null;
  const r = new CharacterRig(body, t ? 1 : 0, t ? { zombie: true, tint: [new Color().setHex(grim(t.tint)), new Color().setHex(grim(t.tint2))] } : {});
  if (t) r.root.scale.setScalar(t.scale);
  return r;
}

await loadCharacters(1024);
const ui = document.getElementById('ui');
const stats = document.getElementById('stats');

if (sheet) {
  if (ui) ui.style.display = 'none';
  for (const id of ['tabs', 'look']) document.getElementById(id)?.style.setProperty('display', 'none');
  const W = 200;
  const H = 300;
  type Cell = { label: string; clip: ClipId; t: number; cam: [Vector3, Vector3] };
  const full = (dir: [number, number]): [Vector3, Vector3] => [new Vector3(dir[0] * 4.6, 0.95, dir[1] * 4.6), new Vector3(0, 0.9, 0)];
  const cells = (walk: ClipId, zombie: boolean): Cell[] => [
    { label: 'спереди', clip: zombie ? 'zombie_idle' : 'idle', t: 0, cam: full([0, 1]) },
    { label: 'сбоку', clip: zombie ? 'zombie_idle' : 'idle', t: 0, cam: full([1, 0]) },
    { label: 'сзади', clip: zombie ? 'zombie_idle' : 'idle', t: 0, cam: full([0, -1]) },
    { label: 'лицо', clip: zombie ? 'zombie_idle' : 'idle', t: 0, cam: [new Vector3(0.12, 1.6, 0.75), new Vector3(0, 1.58, 0)] },
    { label: 'кисть', clip: zombie ? 'zombie_idle' : 'idle', t: 0, cam: [new Vector3(0.75, 0.9, 0.45), new Vector3(0.22, 0.85, 0.02)] },
    { label: zombie ? 'zombie_walk' : 'walk', clip: walk, t: 0.3, cam: full([0.7, 0.7]) },
    { label: zombie ? 'zombie_running' : 'run', clip: zombie ? 'zombie_running' : 'running', t: 0.2, cam: full([0.7, 0.7]) },
  ];
  const rows: { name: string; body: BodyId; kind: string | null; walk: ClipId }[] = [
    { name: 'Мужчина', body: 'male', kind: null, walk: 'walking' },
    { name: 'Женщина', body: 'female', kind: null, walk: 'walking_female' },
    { name: 'SWAT (Ch35)', body: 'swat', kind: null, walk: 'walking' },
    { name: 'Зомби (м)', body: 'male', kind: 'police', walk: 'zombie_walk' },
    { name: 'Зомби (ж)', body: 'female', kind: 'medic', walk: 'zombie_walk' },
  ];
  const cols = 7;
  renderer.setSize(W * cols, H * rows.length);
  renderer.setScissorTest(true);
  const cam = new PerspectiveCamera(24, W / H, 0.05, 50);
  const labels: string[] = [];
  rows.forEach((row, ri) => {
    const scene = new Scene();
    stage(scene);
    const r = figure(row.body, row.kind);
    scene.add(r.root);
    cells(row.walk, !!row.kind).forEach((c, ci) => {
      const fit = c.label === 'лицо' || c.label === 'кисть';
      cam.fov = fit ? 30 : 24;
      cam.updateProjectionMatrix();
      r.hold(c.clip, c.t);
      cam.position.copy(c.cam[0]);
      cam.lookAt(c.cam[1]);
      // Up close: at the head and the right hand as they are in this pose.
      if (fit) {
        const at = r.bone(c.label === 'лицо' ? 'Head' : 'RightHand').getWorldPosition(new Vector3());
        if (c.label === 'лицо') at.y += 0.07;
        cam.position.copy(at).add(c.label === 'лицо' ? new Vector3(0.12, 0.02, 0.62) : new Vector3(-0.45, 0.05, 0.35));
        cam.lookAt(at);
      }
      const y = (rows.length - 1 - ri) * H;
      renderer.setViewport(ci * W, y, W, H);
      renderer.setScissor(ci * W, y, W, H);
      renderer.render(scene, cam);
      labels.push(`${row.name}: ${c.label}`);
    });
  });
  const cap = document.createElement('div');
  cap.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;font:11px system-ui;color:#ddd';
  rows.forEach((row, ri) => {
    const d = document.createElement('div');
    d.textContent = row.name;
    d.style.cssText = `position:absolute;left:4px;top:${ri * H + 4}px;text-shadow:0 0 3px #000`;
    cap.append(d);
  });
  document.body.append(cap);
  (window as unknown as { __sheet: boolean }).__sheet = true;
} else {
  const scene = new Scene();
  stage(scene);
  const camera = new PerspectiveCamera(28, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.95, 0);
  const VIEWS: Record<string, [number, number, number]> = { front: [0, 1.0, 4.4], side: [4.4, 1.0, 0], back: [0, 1.0, -4.4], '34': [3.1, 1.0, 3.1] };
  const setView = (v: string) => {
    camera.position.set(...(VIEWS[v] ?? VIEWS.front));
    controls.update();
  };
  setView(q.get('view') ?? '34');
  let body: BodyId = (q.get('body') as BodyId) ?? 'male';
  let kind: string | null = q.get('kind');
  let clip: ClipId = (q.get('anim') as ClipId) ?? 'idle';
  let rig: CharacterRig | null = null;
  const rebuild = () => {
    if (rig) {
      scene.remove(rig.root);
      rig.dispose();
    }
    rig = figure(body, kind);
    scene.add(rig.root);
    rig.action(clip).play();
    if (stats) stats.textContent = `${body}${kind ? ` · зомби ${kind}` : ''} · ${(rig.rig.geometry.index!.count / 3) | 0} тр. · ${rig.bones.length} костей`;
  };
  const buttons = (el: HTMLElement | null, items: string[], on: (v: string) => void) => {
    if (!el) return;
    for (const it of items) {
      const b = document.createElement('button');
      b.textContent = it;
      b.onclick = () => on(it);
      el.append(b);
    }
  };
  const anims = document.getElementById('anims');
  const views = document.getElementById('views');
  buttons(views, [...BODY_IDS], (v) => ((body = v as BodyId), rebuild()));
  buttons(views, ['человек', ...Object.keys(ZOMBIE_TYPES)], (v) => ((kind = v === 'человек' ? null : v), rebuild()));
  buttons(views, Object.keys(VIEWS), setView);
  buttons(anims, CLIPS, (v) => ((clip = v as ClipId), rebuild()));
  rebuild();
  const timer = new Timer();
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();
  const frame = () => {
    timer.update();
    if (look.grim !== undefined) rig?.mixer.update(timer.getDelta());
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();
}
