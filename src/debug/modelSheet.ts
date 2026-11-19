import {
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadModelLibrary, type ModelInfo, modelGeometry, modelGlass } from '../world/models';

/**
 * Dev page /model-sheet.html: every prepared model (public/models) next to its source GLB
 * (assets/incoming), from behind-and-aside and from the front, on a ground plane. The result is drawn
 * as the game draws it — back faces culled, glass translucent — so a hole, a wheel out of its arch or a
 * missing pane shows. Saves the sheet to .shots/model-sheet.jpg (dev server endpoint).
 */
interface Cfg {
  src: string;
  node?: string;
  name: string;
  length?: number;
  flip?: boolean;
}

const CELL_W = 320;
const CELL_H = 200;
const LABEL = 16;
const PER_ROW = 2;

async function main(): Promise<void> {
  const { MODELS } = (await import(/* @vite-ignore */ `${'/tools/models.config.mjs'}`)) as { MODELS: Cfg[] };
  const lib = await loadModelLibrary('/models/');
  if (!lib) throw new Error('no model library');
  const atlas = await new TextureLoader().loadAsync('/models/atlas.jpg');
  atlas.colorSpace = SRGBColorSpace;
  const atlasImg = atlas.image as HTMLImageElement;
  const cols = Math.max(1, Math.round(atlasImg.width / lib.atlas));
  const atlasRows = Math.max(1, Math.round(atlasImg.height / lib.atlas));
  const rows = Math.ceil(MODELS.length / PER_ROW);
  const W = CELL_W * 4 * PER_ROW;
  const H = rows * (CELL_H + LABEL);
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setScissorTest(true);
  renderer.setClearColor(0x9aa0a4);
  document.body.append(renderer.domElement);
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x555048, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  const ground = new Mesh(new PlaneGeometry(60, 60), new MeshStandardMaterial({ color: 0x5a5c5e, roughness: 1, side: DoubleSide }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  scene.add(ground);
  const camera = new PerspectiveCamera(30, CELL_W / CELL_H, 0.05, 200);
  const loader = new GLTFLoader();
  const glbs = new Map<string, Object3D>();
  const labels: { x: number; y: number; text: string }[] = [];

  for (let k = 0; k < MODELS.length; k++) {
    const cfg = MODELS[k];
    const info = lib.byName.get(cfg.name);
    if (!info) continue;
    let root = glbs.get(cfg.src);
    if (!root) {
      root = (await loader.loadAsync(`/assets/incoming/${cfg.src}/model.glb`)).scene;
      root.updateMatrixWorld(true);
      glbs.set(cfg.src, root);
    }
    const source = normalizedSource(root, cfg);
    const result = prepared(lib, info, atlas, cols, atlasRows);
    const row = Math.floor(k / PER_ROW);
    const col0 = (k % PER_ROW) * 4;
    const size = new Vector3(...info.size);
    const views = [new Vector3(-1, 0.55, 0.85), new Vector3(1, 0.45, 0.85)];
    labels.push({ x: col0 * CELL_W, y: row * (CELL_H + LABEL), text: `${cfg.name}: ${info.indices / 3} tris (glass ${(info.glass ?? 0) / 3}) — source | result, rear | front` });
    for (let v = 0; v < 2; v++) {
      for (let s = 0; s < 2; s++) {
        const obj = s === 0 ? source : result;
        scene.add(obj);
        const radius = size.length() / 2;
        camera.position.copy(views[v]).normalize().multiplyScalar((radius / Math.sin((15 * Math.PI) / 180)) * 0.68).add(new Vector3(0, size.y / 2, 0));
        camera.lookAt(0, size.y * 0.42, 0);
        const x = (col0 + v * 2 + s) * CELL_W;
        const y = H - (row + 1) * (CELL_H + LABEL);
        renderer.setViewport(x, y, CELL_W, CELL_H);
        renderer.setScissor(x, y, CELL_W, CELL_H);
        renderer.render(scene, camera);
        scene.remove(obj);
      }
    }
  }
  // Labels into a 2D copy, then saved.
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!;
  g.drawImage(renderer.domElement, 0, 0);
  g.font = '12px system-ui, sans-serif';
  for (const l of labels) {
    g.fillStyle = '#202224';
    g.fillRect(l.x, l.y + CELL_H, CELL_W * 4, LABEL);
    g.fillStyle = '#e8e8e8';
    g.fillText(l.text, l.x + 4, l.y + CELL_H + 12);
  }
  g.fillStyle = '#202224';
  for (let c = 1; c < 4 * PER_ROW; c++) g.fillRect(c * CELL_W - (c % 4 === 0 ? 2 : 1), 0, c % 4 === 0 ? 4 : 1, H);
  await fetch('/__shot?name=model-sheet', { method: 'POST', body: out.toDataURL('image/jpeg', 0.88) });
  document.body.append(out);
  renderer.domElement.remove();
  (window as unknown as { __sheetDone: boolean }).__sheetDone = true;
}

/** The source as the prep tool sees it: its length along +X, real size, on the ground, centred. */
function normalizedSource(root: Object3D, cfg: Cfg): Group {
  let node: Object3D = root;
  if (cfg.node) node = root.getObjectByName(cfg.node) ?? root.getObjectByName(cfg.node.replace(/[^\w-]/g, '_')) ?? root;
  const copy = node.clone();
  copy.matrixAutoUpdate = false;
  copy.matrix.copy(node.matrixWorld);
  const turn = new Group();
  turn.add(copy);
  let box = new Box3().setFromObject(turn);
  if (box.max.z - box.min.z > box.max.x - box.min.x) turn.rotation.y = Math.PI / 2;
  if (cfg.flip) turn.rotation.y += Math.PI;
  turn.updateMatrixWorld(true);
  box = new Box3().setFromObject(turn);
  const s = cfg.length ? cfg.length / (box.max.x - box.min.x) : 1;
  const out = new Group();
  out.add(turn);
  turn.scale.setScalar(s);
  turn.position.set((-(box.min.x + box.max.x) / 2) * s, -box.min.y * s, (-(box.min.z + box.max.z) / 2) * s);
  return out;
}

/** The prepared model drawn like the game: back faces culled, its atlas layer, glass translucent. */
function prepared(lib: Parameters<typeof modelGeometry>[0], m: ModelInfo, atlas: Texture, cols: number, rows: number): Group {
  const map = atlas.clone();
  const col = m.layer % cols;
  const row = Math.floor(m.layer / cols);
  map.repeat.set(1 / cols, 1 / rows);
  map.offset.set(col / cols, (rows - 1 - row) / rows);
  map.needsUpdate = true;
  const g = new Group();
  g.add(new Mesh(modelGeometry(lib, m), new MeshStandardMaterial({ map, vertexColors: true, roughness: 0.75, metalness: 0.15 })));
  const glass = modelGlass(lib, m);
  if (glass) g.add(new Mesh(glass, new MeshStandardMaterial({ color: new Color(0x2a3036), transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide, roughness: 0.3 })));
  return g;
}

main().catch((e) => {
  document.body.textContent = String(e?.stack ?? e);
  console.error(e);
});
