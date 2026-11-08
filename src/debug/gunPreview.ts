import { AmbientLight, DirectionalLight, Mesh, MeshBasicMaterial, OrthographicCamera, Scene, SphereGeometry, WebGLRenderer } from 'three';
import type { V3 } from '../weapons/gunFrame';
import { GunModel } from '../weapons/gunModel';
import { GUN_IDS, GUNS, type GunId, MOD_FITS, MOD_IDS } from '../weapons/guns';

/**
 * /tools/gun-preview.html: every firearm from its left side with its sockets marked (grip_main, grip_off,
 * muzzle, sights, magazine, eject, light, bolt, load), and again with every module that fits it.
 * ?fp=1 is the first-person sheet (debug/gunFpPreview).
 */
const W = 520;
const H = 260;
const COLORS: Record<string, number> = { main: 0xff3030, off: 0x30a0ff, muzzle: 0xffff00, sightF: 0x00ff80, sightR: 0x00ff80, mag: 0xff80ff, eject: 0xffa000, light: 0xffffff, bolt: 0x00ffff, load: 0x8080ff };
const r = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setPixelRatio(1);
r.setSize(W * 2, H * GUN_IDS.length);
document.body.appendChild(r.domElement);
r.setScissorTest(true);
const labels = document.createElement('div');
labels.style.cssText = 'position:absolute;left:0;top:0;color:#eee;font:12px monospace;pointer-events:none';
document.body.append(labels);
const models = GUN_IDS.map((id) => [new GunModel(id), new GunModel(id)] as const);
for (const [i, id] of GUN_IDS.entries()) models[i][1].setMods(MOD_IDS.filter((m) => MOD_FITS[m].includes(id)));
// Let the models load.
await new Promise((res) => setTimeout(res, 2500));
for (const [i, id] of GUN_IDS.entries()) {
  for (const k of [0, 1]) {
    const m = models[i][k];
    const s = new Scene();
    s.add(new AmbientLight(0xffffff, 1.6));
    const d = new DirectionalLight(0xffffff, 2.2);
    d.position.set(-2, 2, 1);
    s.add(d, m.root);
    if (k === 0) {
      const so = m.sockets as unknown as Record<string, V3 | { at: V3 }>;
      for (const [name, c] of Object.entries(COLORS)) {
        const v = so[name];
        const p = Array.isArray(v) ? v : v.at;
        const b = new Mesh(new SphereGeometry(GUNS[id as GunId].cls === 'pistol' ? 0.004 : 0.011, 10, 8), new MeshBasicMaterial({ color: c, depthTest: false }));
        b.position.set(...p);
        b.renderOrder = 2;
        s.add(b);
      }
    }
    const len = m.sockets.back - m.sockets.front + (k ? 0.2 : 0);
    const half = len * 0.62;
    const cam = new OrthographicCamera((-half * W) / H, (half * W) / H, half, -half, 0.01, 10);
    const cz = (m.sockets.back + m.sockets.front) / 2 - (k ? 0.1 : 0);
    cam.position.set(-3, 0, cz);
    cam.lookAt(0, 0, cz);
    const y = (GUN_IDS.length - 1 - i) * H;
    r.setViewport(k * W, y, W, H);
    r.setScissor(k * W, y, W, H);
    r.setClearColor(k ? 0x8e8f8a : 0x9fa09a);
    r.clear();
    r.render(s, cam);
  }
  const l = document.createElement('div');
  l.style.cssText = `position:absolute;left:4px;top:${i * H + 4}px`;
  l.textContent = `${GUNS[id].name}  (${id})`;
  labels.append(l);
}
const legend = document.createElement('div');
legend.style.cssText = `position:absolute;left:${W + 4}px;top:4px`;
legend.textContent = 'справа: со всеми подходящими модулями';
labels.append(legend);
(window as unknown as { __sheet: boolean }).__sheet = true;
