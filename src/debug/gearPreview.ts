import { CircleGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import { BODY_IDS, type ClipId, loadBody, loadCharacters } from '../characters/assets';
import { loadGear, loadGearMeta, wornGear } from '../characters/gear';
import type { ItemId } from '../data/items';
import { baseLook } from '../player/appearance';
import { CharacterFigure } from '../player/CharacterFigure';
import { grim } from '../style/palette';
import type { Worn } from '../systems/Inventory';
import { applyStage } from './viewerStage';

/**
 * The gear previews (/tools/gear-preview.html, a sheet to save): the game's own figure (player/CharacterFigure)
 * in the game's light and fog — military and SWAT in full gear on a man and a woman, front / side / back at
 * ease, walking, running, crouched and at the top of an axe swing; the firefighter in his helmet, the medic
 * with the bag, the mechanic with the toolbox (in the free hand; on the hip with the axe).
 */

const W = 190;
const H = 300;
const NONE: Worn = { outfit: null, head: null, torso: null, vest: null, hands: null, legs: null, feet: null, back: null, bag: null };
const ROWS: { name: string; sex: 'male' | 'female'; worn: Partial<Worn> }[] = [
  { name: 'Военный (м)', sex: 'male', worn: { outfit: 'outfitMilitary', head: 'helmetMilitary', vest: 'vestMilitary', back: 'backpackMilitary' } },
  { name: 'Военный (ж)', sex: 'female', worn: { torso: 'militaryJacket', legs: 'militaryPants', feet: 'combatBoots', head: 'helmetMilitary', vest: 'vestMilitary', back: 'backpackMilitary' } },
  { name: 'SWAT (м)', sex: 'male', worn: { outfit: 'outfitSwat', head: 'helmetSwat', vest: 'vestSwat' } },
  { name: 'SWAT (ж)', sex: 'female', worn: { torso: 'swatShirt', legs: 'swatPants', head: 'helmetSwat', vest: 'vestSwat' } },
  { name: 'Пожарный', sex: 'male', worn: { outfit: 'outfitFirefighter', head: 'helmetFire' } },
  { name: 'Медик', sex: 'male', worn: { outfit: 'outfitDoctor', bag: 'bagMedic' } },
  { name: 'Механик', sex: 'male', worn: { outfit: 'outfitMechanic', bag: 'toolboxMechanic' } },
  { name: 'Школьный / туристический', sex: 'female', worn: { torso: 'hoodie', legs: 'jeans', back: 'backpackHiking', head: 'helmetConstruction' } },
];
type Cell = { label: string; clip: ClipId; t: number; dir: [number, number]; swing?: boolean };
const CELLS: Cell[] = [
  { label: 'спереди', clip: 'idle', t: 0, dir: [0, 1] },
  { label: 'сбоку', clip: 'idle', t: 0, dir: [1, 0] },
  { label: 'сзади', clip: 'idle', t: 0, dir: [0, -1] },
  { label: 'ходьба', clip: 'walking', t: 0.3, dir: [0.7, 0.7] },
  { label: 'бег', clip: 'running', t: 0.2, dir: [-0.7, 0.7] },
  { label: 'присед', clip: 'crouched_walking', t: 0.4, dir: [0.7, 0.7] },
  { label: 'замах топором', clip: 'idle', t: 0, dir: [0.8, 0.6], swing: true },
];

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
await loadCharacters(1024);
await loadGearMeta();
await Promise.all(BODY_IDS.map((b) => loadBody(b)));
for (const b of BODY_IDS) await loadGear(b, ROWS.flatMap((r) => wornGear(r.worn)));
renderer.setSize(W * CELLS.length, H * ROWS.length);
renderer.setScissorTest(true);
const cam = new PerspectiveCamera(24, W / H, 0.05, 50);
const _q = new Quaternion();
for (const [ri, row] of ROWS.entries()) {
  const scene = new Scene();
  const hemi = new HemisphereLight();
  const sun = new DirectionalLight();
  sun.position.set(2, 4, 3);
  scene.add(hemi, sun, new Mesh(new CircleGeometry(1.2, 32).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: new Color(grim(0x5a574c)) })));
  applyStage({ scene, hemi, sun, toy: { bg: 0xe4e4e2, hemi: [0xffffff, 0x8a8a80, 1.6], sun: [0xffffff, 1.8] }, fog: 0.02 });
  const f = new CharacterFigure();
  f.setAppearance({ ...baseLook(row.sex), height: row.sex === 'male' ? 180 : 168 });
  scene.add(f.root);
  for (const [ci, c] of CELLS.entries()) {
    f.setOutfit({ ...NONE, ...row.worn }, c.swing ? ('axe' as ItemId) : null);
    f.setPose(row.sex === 'female' && c.clip === 'walking' ? 'walking_female' : c.clip, c.t);
    if (c.swing) {
      // The top of the windup: the right arm up and back over the shoulder, the body turned with it.
      const r = f.skinned;
      r.bone('Spine1').quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 1, 0), -0.35));
      r.bone('Spine2').quaternion.multiply(_q.setFromAxisAngle(new Vector3(1, 0, 0), -0.15));
      r.bone('RightArm').quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 0, 1), -1.9));
      r.bone('RightForeArm').quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 0, 1), -1.2));
      r.bone('LeftArm').quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 0, 1), 0.9));
      r.root.updateMatrixWorld(true);
    }
    const d = 4.6;
    cam.position.set(c.dir[0] * d, 1.0, c.dir[1] * d);
    cam.lookAt(0, 0.92, 0);
    const y = (ROWS.length - 1 - ri) * H;
    renderer.setViewport(ci * W, y, W, H);
    renderer.setScissor(ci * W, y, W, H);
    renderer.render(scene, cam);
  }
  f.dispose();
}
const cap = document.createElement('div');
cap.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;color:#ddd';
ROWS.forEach((row, ri) =>
  CELLS.forEach((c, ci) => {
    const d = document.createElement('div');
    d.textContent = ci ? c.label : `${row.name}: ${c.label}`;
    d.style.cssText = `position:absolute;left:${ci * W + 4}px;top:${ri * H + 4}px;text-shadow:0 0 3px #000`;
    cap.append(d);
  }),
);
document.body.append(cap);
(window as unknown as { __sheet: boolean }).__sheet = true;
