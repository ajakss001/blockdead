import { AmbientLight, Box3, DirectionalLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { gearPiece, loadGearPiece } from '../characters/gear';
import type { GearId } from '../data/items';

/**
 * Inventory icons of the gear: a render of the model itself (three-quarters from the front, the game's
 * overcast light, transparent), once per piece on a small renderer of its own, kept as a data URL.
 */

const SIZE = 96;
const cache = new Map<GearId, string>();
const waiting = new Map<GearId, HTMLImageElement[]>();
let renderer: WebGLRenderer | null = null;

function render(g: GearId): string | null {
  const p = gearPiece(g);
  if (!p) return null;
  renderer ??= new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.add(new AmbientLight(0xb8bcc0, 1.3));
  const sun = new DirectionalLight(0xb8bcc0, 1.6);
  sun.position.set(-1, 2, 2);
  scene.add(sun);
  const mat = new MeshLambertMaterial({ map: p.texture });
  const mesh = new Mesh(p.geometry, mat);
  // Packs and boxes face +Z with their outer side; the figure's back is towards the camera there.
  if (g.startsWith('backpack')) mesh.rotation.y = Math.PI;
  scene.add(mesh);
  const box = new Box3().setFromObject(mesh);
  const c = box.getCenter(new Vector3());
  const r = box.getSize(new Vector3()).length() / 2;
  const cam = new PerspectiveCamera(30, 1, 0.01, 20);
  cam.position.copy(c).add(new Vector3(-0.55, 0.45, 1).normalize().multiplyScalar(r / Math.sin((15 * Math.PI) / 180)));
  cam.lookAt(c);
  renderer.render(scene, cam);
  mat.dispose();
  return renderer.domElement.toDataURL();
}

/** Sets the image's icon now if it has been rendered, else as soon as the model is in. */
export function gearIcon(g: GearId, img: HTMLImageElement): void {
  const url = cache.get(g) ?? render(g);
  if (url) {
    cache.set(g, url);
    img.src = url;
    return;
  }
  let list = waiting.get(g);
  if (!list) {
    waiting.set(g, (list = []));
    void loadGearPiece(g).then(() => {
      const u = render(g);
      if (!u) return;
      cache.set(g, u);
      for (const i of waiting.get(g) ?? []) i.src = u;
      waiting.delete(g);
    });
  }
  list.push(img);
}
