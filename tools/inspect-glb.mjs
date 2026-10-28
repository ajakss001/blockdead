// Dev: print the node tree of a GLB with world-space bounding boxes of mesh subtrees.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mat4, vec3 } from './mat.mjs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const maxDepth = Number(process.argv[3] ?? 4);
function bbox(node, m) {
  const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0 };
  const walk = (n, pm) => {
    const wm = mat4.mul(pm, n.getMatrix());
    const mesh = n.getMesh();
    if (mesh) for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      const idx = p.getIndices();
      out.tris += (idx ? idx.getCount() : pos.getCount()) / 3;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const w = vec3.tf(v, wm); for (let k = 0; k < 3; k++) { out.min[k] = Math.min(out.min[k], w[k]); out.max[k] = Math.max(out.max[k], w[k]); } }
    }
    for (const c of n.listChildren()) walk(c, wm);
  };
  walk(node, m);
  return out;
}
const f = (a) => a.map((v) => v.toFixed(2)).join(',');
const show = (n, pm, d) => {
  const b = bbox(n, pm);
  if (b.tris === 0) return;
  console.log(`${'  '.repeat(d)}${n.getName()}  tris ${Math.round(b.tris)}  size ${f(b.max.map((v, i) => v - b.min[i]))}  at ${f(b.min.map((v, i) => (v + b.max[i]) / 2))}`);
  if (d < maxDepth) { const wm = mat4.mul(pm, n.getMatrix()); for (const c of n.listChildren()) show(c, wm, d + 1); }
};
for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) show(n, mat4.id(), 0);
