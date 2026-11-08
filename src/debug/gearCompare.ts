import { Box3, Color, DirectionalLight, DoubleSide, FrontSide, HemisphereLight, Mesh, MeshLambertMaterial, type Object3D, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BODY_IDS, type BodyId, loadBody, loadCharacters } from '../characters/assets';
import { gearGeometry, gearTexture, loadGear, loadGearMeta } from '../characters/gear';
import type { GearId } from '../data/items';

/**
 * /tools/gear-compare.html: every gear piece next to its source model (assets/incoming/gear, dev only) in a
 * neutral studio light, front / side / back — the source, then the piece as the game draws it on a body (its
 * fitted geometry in the body's bind pose, its texture, one-sided like the game's material). The texture has to
 * match the source's, no hole, no dark triangle. ?body=swat_m (default male), ?only=vest_swat,helmet_swat.
 */
const QS = new URLSearchParams(location.search);
const W = Number(QS.get('w')) || 220;
const BODY = (QS.get('body') ?? 'male') as BodyId;
const VIEWS: [string, number][] = [
  ['спереди', 0],
  ['сбоку', Math.PI / 2],
  ['сзади', Math.PI],
];
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
await loadCharacters(1024);
await Promise.all(BODY_IDS.filter((b) => b === BODY).map((b) => loadBody(b)));
const meta = await loadGearMeta();
const ids = (QS.get('only')?.split(',') ?? Object.keys(meta!.gear)) as GearId[];
await loadGear(BODY, ids);

const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const neutral = (o: Object3D) =>
  o.traverse((m) => {
    const mesh = m as Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as MeshLambertMaterial;
    const map = src.map ?? null;
    if (map) map.colorSpace = SRGBColorSpace;
    mesh.material = new MeshLambertMaterial({ map, side: FrontSide });
  });

async function source(id: GearId): Promise<Object3D | null> {
  try {
    const g = await gltf.loadAsync(`/assets/incoming/gear/${id}.glb`);
    neutral(g.scene);
    return g.scene;
  } catch {
    return null;
  }
}
function built(id: GearId): Object3D | null {
  const geo = gearGeometry(BODY, id, 0);
  if (!geo) return null;
  const g = geo.clone();
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  const out = new Mesh(g, new MeshLambertMaterial({ map: gearTexture(id), side: meta!.gear[id].kind === 'mask' ? DoubleSide : FrontSide }));
  const lens = gearGeometry(BODY, id, 0, 'lens');
  if (lens) out.add(new Mesh(lens.clone(), new MeshLambertMaterial({ color: 0x202224, transparent: true, opacity: 0.85 })));
  return out;
}

const rows: { id: GearId; src: Object3D | null; game: Object3D | null }[] = [];
for (const id of ids) rows.push({ id, src: await source(id), game: built(id) });
const H = W;
renderer.setSize(W * 6, H * rows.length);
renderer.setScissorTest(true);
const scene = new Scene();
scene.background = new Color(0x8a8c88);
scene.add(new HemisphereLight(0xffffff, 0x9a9a94, 2.2));
const sun = new DirectionalLight(0xffffff, 1.4);
sun.position.set(1, 2, 3);
scene.add(sun);
const cam = new PerspectiveCamera(30, 1, 0.01, 20);
const label = (text: string, x: number, y: number) => {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = `position:absolute;left:${x + 4}px;top:${y + 2}px;color:#111;font:11px system-ui`;
  document.body.appendChild(d);
};
rows.forEach((r, ri) => {
  [r.src, r.game].forEach((obj, k) => {
    VIEWS.forEach(([name, a], vi) => {
      const ci = k * 3 + vi;
      label(`${ri === 0 || vi === 0 ? `${r.id} ` : ''}${k ? 'в игре' : 'исходник'} ${name}`, ci * W, ri * H);
      if (!obj) return;
      scene.add(obj);
      const box = new Box3().setFromObject(obj);
      const c = box.getCenter(new Vector3());
      const r0 = box.getSize(new Vector3()).length() / 2;
      const d = r0 / Math.sin((cam.fov * Math.PI) / 360);
      cam.position.set(c.x + Math.sin(a) * d, c.y + r0 * 0.15, c.z + Math.cos(a) * d);
      cam.lookAt(c);
      const y = (rows.length - 1 - ri) * H;
      renderer.setViewport(ci * W, y, W, H);
      renderer.setScissor(ci * W, y, W, H);
      renderer.render(scene, cam);
      scene.remove(obj);
    });
  });
});
document.body.style.position = 'relative';
renderer.domElement.style.display = 'block';
(window as unknown as { __sheet: boolean }).__sheet = true;
