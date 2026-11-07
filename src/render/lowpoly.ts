import { BufferGeometry, Float32BufferAttribute } from 'three';

/** Gable roof prism, ridge along X, eaves at y = 0, ridge at y = height. */
export function gableRoof(width: number, depth: number, height: number): BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  const h = height;
  // prettier-ignore
  const p = [
    // front slope (+Z)
    -w, 0, d,   w, 0, d,   w, h, 0,
    -w, 0, d,   w, h, 0,  -w, h, 0,
    // back slope (-Z)
     w, 0, -d, -w, 0, -d, -w, h, 0,
     w, 0, -d, -w, h, 0,   w, h, 0,
    // gables
    -w, 0, -d, -w, 0, d,  -w, h, 0,
     w, 0, d,   w, 0, -d,  w, h, 0,
    // underside
    -w, 0, -d,  w, 0, -d,  w, 0, d,
    -w, 0, -d,  w, 0, d,  -w, 0, d,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
