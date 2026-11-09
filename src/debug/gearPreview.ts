import { CircleGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import { BODY_IDS, type ClipId, loadBody, loadCharacters } from '../characters/assets';
import { loadGear, loadGearMeta, wornGear } from '../characters/gear';
import { type ItemId, ITEMS } from '../data/items';
import { baseLook } from '../player/appearance';
import { CharacterFigure } from '../player/CharacterFigure';
import { grim } from '../style/palette';
import type { Worn } from '../systems/Inventory';
import { CLASSES } from '../data/classes';
import { applyStage } from './viewerStage';

/**
 * The gear previews (/tools/gear-preview.html, a sheet to save): the game's own figure (player/CharacterFigure)
 * in the game's light and fog — military and SWAT in full gear on a man and a woman, front / side / back at
 * ease, walking, running, crouched and at the top of an axe swing; the firefighter in his helmet, the medic
 * with the bag, the mechanic with the toolbox (in the free hand; on the hip with the axe).
 */

const QS = new URLSearchParams(location.search);
const W = Number(QS.get('w')) || 190;
const H = Math.round((W * 300) / 190);
const NONE: Worn = { outfit: null, head: null, face: null, mask: null, torso: null, vest: null, hands: null, legs: null, feet: null, back: null, bag: null };
/** ?classes=1: every class as the character editor dresses it (its uniform, the item it starts with in hand). */
const CLASS_MODE = new URLSearchParams(location.search).has('classes');
const ROWS_ALL: { name: string; sex: 'male' | 'female'; worn: Partial<Worn>; hand?: ItemId | null }[] = [
  { name: 'Военный (м)', sex: 'male', worn: { outfit: 'outfitMilitary', head: 'helmetMilitary', vest: 'vestMilitary', back: 'backpackMilitary' } },
  { name: 'Военный (ж)', sex: 'female', worn: { torso: 'militaryJacket', legs: 'militaryPants', feet: 'combatBoots', head: 'helmetMilitary', vest: 'vestMilitary', back: 'backpackMilitary' } },
  { name: 'SWAT (м)', sex: 'male', worn: { outfit: 'outfitSwat', head: 'helmetSwat', vest: 'vestSwat' } },
  { name: 'SWAT (ж)', sex: 'female', worn: { torso: 'swatShirt', legs: 'swatPants', head: 'helmetSwat', vest: 'vestSwat' } },
  { name: 'Пожарный', sex: 'male', worn: { outfit: 'outfitFirefighter', head: 'helmetFire' } },
  { name: 'Медик', sex: 'male', worn: { outfit: 'outfitDoctor', bag: 'bagMedic' } },
  { name: 'Механик', sex: 'male', worn: { outfit: 'outfitMechanic', bag: 'toolboxMechanic' } },
  { name: 'Школьный / туристический', sex: 'female', worn: { torso: 'hoodie', legs: 'jeans', back: 'backpackHiking', head: 'helmetConstruction' } },
];
const ONLY = QS.get('only')?.split(',');
/** close: a head-and-torso shot; head: this far (m) from the head itself, following it (faces, helmets). */
type Cell = { label: string; clip: ClipId; t: number; dir: [number, number]; swing?: boolean; close?: boolean; head?: number };
type Row = { name: string; sex: 'male' | 'female'; worn: Partial<Worn>; hand?: ItemId | null };
/** ?faces=1: every body's face up close (one face on every costume, the neck seam). */
const FACES = QS.has('faces');
/** ?helmets=1: the four helmets on a man and a woman, up close, at ease and moving. */
const HELMETS = QS.has('helmets');
/** ?kit=1: military and SWAT in full kit (helmet, face, vest) on a man and a woman. */
const KIT = QS.has('kit');
const FACE_ROWS: Row[] = [
  { name: 'char_male', sex: 'male', worn: {} },
  ...(['outfitSwat', 'outfitMilitary', 'outfitPolice', 'outfitFirefighter', 'outfitDoctor', 'outfitMechanic', 'outfitBuilder'] as ItemId[]).map((o) => ({ name: o.replace('outfit', ''), sex: 'male' as const, worn: { outfit: o } })),
];
const HELMET_ROWS: Row[] = (['helmetMilitary', 'helmetSwat', 'helmetFire', 'helmetConstruction'] as ItemId[]).flatMap((h) => [
  { name: `${h} (м)`, sex: 'male' as const, worn: { head: h } },
  { name: `${h} (ж)`, sex: 'female' as const, worn: { head: h } },
]);
const KIT_ROWS: Row[] = [
  { name: 'Военный (м)', sex: 'male', worn: { outfit: 'outfitMilitary', head: 'helmetMilitary', face: 'glassesBallistic', mask: 'shemagh', vest: 'vestMilitary' } as Partial<Worn> },
  { name: 'Военный (ж)', sex: 'female', worn: { torso: 'militaryJacket', legs: 'militaryPants', feet: 'combatBoots', head: 'helmetMilitary', face: 'glassesBallistic', mask: 'shemagh', vest: 'vestMilitary' } as Partial<Worn> },
  { name: 'SWAT (м)', sex: 'male', worn: { outfit: 'outfitSwat', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', vest: 'vestSwat' } as Partial<Worn> },
  { name: 'SWAT (ж)', sex: 'female', worn: { torso: 'swatShirt', legs: 'swatPants', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', vest: 'vestSwat' } as Partial<Worn> },
  { name: 'Полумаска (м)', sex: 'male', worn: { outfit: 'outfitBuilder', head: 'helmetConstruction', mask: 'maskHalf' } as Partial<Worn> },
];
const CLOSE_CELLS: Cell[] = [
  { label: 'лицо', clip: 'idle', t: 0, dir: [0, 1], head: 0.55 },
  { label: '3/4', clip: 'idle', t: 0, dir: [0.7, 0.71], head: 0.6 },
  { label: 'сбоку', clip: 'idle', t: 0, dir: [1, 0], head: 0.6 },
  { label: 'сзади', clip: 'idle', t: 0, dir: [-0.5, -0.87], head: 0.65 },
  { label: 'ходьба', clip: 'walking', t: 0.45, dir: [0.6, 0.8], head: 0.8 },
  { label: 'бег', clip: 'running', t: 0.3, dir: [-0.6, 0.8], head: 0.8 },
];
const CELLS_ALL: Cell[] = [
  { label: 'спереди', clip: 'idle', t: 0, dir: [0, 1] },
  { label: 'сбоку', clip: 'idle', t: 0, dir: [1, 0] },
  { label: 'сзади', clip: 'idle', t: 0, dir: [0, -1] },
  { label: 'ходьба', clip: 'walking', t: 0.3, dir: [0.7, 0.7] },
  { label: 'бег', clip: 'running', t: 0.2, dir: [-0.7, 0.7] },
  { label: 'присед', clip: 'crouched_walking', t: 0.4, dir: [0.7, 0.7] },
  { label: 'замах топором', clip: 'idle', t: 0, dir: [0.8, 0.6], swing: true },
];
const ROW_PICK = QS.get('row')?.split(',');
/** ?drop=mask,face: those slots taken off every row (to see a piece of a kit alone). */
const DROP: Partial<Worn> = Object.fromEntries((QS.get('drop')?.split(',') ?? []).map((k) => [k, null]));
const pick = (rows: Row[]) => (ROW_PICK ? rows.filter((r) => ROW_PICK.some((p) => r.name.includes(p))) : rows);
/** ?hold=axe,bat,rifle_m4a1: a man holding each of them at ease (the menu's hold), front / side / back / close. */
const HOLD = QS.get('hold')?.split(',') as ItemId[] | undefined;
/** ?wear=outfitMilitary,helmetMilitary,…: what the ?hold= man wears (each item to its own slot). */
const WEAR: Partial<Worn> = Object.fromEntries((QS.get('wear')?.split(',') ?? []).filter((w) => ITEMS[w as ItemId]?.wear).map((w) => [ITEMS[w as ItemId].wear!.slot, w]));
const HOLD_ROWS: Row[] = (HOLD ?? []).map((h) => ({ name: h, sex: 'male' as const, worn: WEAR, hand: h }));
const ROWS: Row[] = HOLD ? HOLD_ROWS : FACES ? pick(FACE_ROWS) : HELMETS ? pick(HELMET_ROWS) : KIT ? pick(KIT_ROWS) : CLASS_MODE ? CLASSES.filter((c) => !ONLY || ONLY.includes(c.id)).map((c) => ({ name: c.name, sex: 'male' as const, worn: { ...(c.uniform as Partial<Worn>), back: c.uniform.back ?? (c.uniform.bag ? null : 'backpackSchool') } as Partial<Worn>, hand: c.hand })) : ROWS_ALL;
const CELLS: Cell[] = FACES ? CLOSE_CELLS : HELMETS ? [...CLOSE_CELLS, { label: 'замах', clip: 'idle', t: 0, dir: [0.8, 0.6], swing: true, head: 0.9 }] : KIT
  ? [
      { label: 'спереди', clip: 'idle', t: 0, dir: [0, 1] },
      { label: 'сбоку', clip: 'idle', t: 0, dir: [1, 0] },
      { label: '3/4', clip: 'idle', t: 0, dir: [0.7, 0.71] },
      { label: 'лицо', clip: 'idle', t: 0, dir: [0, 1], head: 0.55 },
      { label: 'лицо 3/4', clip: 'idle', t: 0, dir: [0.7, 0.71], head: 0.6 },
      { label: 'лицо сбоку', clip: 'idle', t: 0, dir: [1, 0], head: 0.6 },
    ]
  : CLASS_MODE || HOLD
  ? [
      { label: 'спереди', clip: 'idle', t: 0, dir: [0, 1] },
      { label: 'сбоку', clip: 'idle', t: 0, dir: [1, 0] },
      { label: 'сзади', clip: 'idle', t: 0, dir: [0, -1] },
      { label: 'голова/торс', clip: 'idle', t: 0, dir: [0.5, 0.87], close: true },
      { label: 'торс сбоку', clip: 'idle', t: 0, dir: [-0.87, 0.5], close: true },
    ]
  : CELLS_ALL;

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
    const hand = 'hand' in row ? ((row.hand ?? null) as ItemId | null) : null;
    f.setOutfit({ ...NONE, ...row.worn, ...DROP }, c.swing ? ('axe' as ItemId) : hand);
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
    if (c.head) {
      f.root.updateMatrixWorld(true);
      const h = new Vector3().setFromMatrixPosition(f.skinned.bone('Head').matrixWorld).add(new Vector3(0, 0.07, 0));
      const hd = c.head * (KIT || HELMETS ? 2.4 : 1);
      cam.position.set(h.x + c.dir[0] * hd, h.y + 0.03, h.z + c.dir[1] * hd);
      cam.lookAt(h);
    } else {
      const d = c.close ? 2.1 : 4.6;
      cam.position.set(c.dir[0] * d, c.close ? 1.45 : 1.0, c.dir[1] * d);
      cam.lookAt(0, c.close ? 1.3 : 0.92, 0);
    }
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
