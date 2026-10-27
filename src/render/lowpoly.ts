import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
} from 'three';

/** Default facet count for limbs: reads as "low-poly realism", not as boxes. */
const LIMB_SEGMENTS = 6;

/** Tapered limb hanging down from its pivot: spans y ∈ [-length, 0]. */
export function limbDown(rTop: number, rBottom: number, length: number, segments = LIMB_SEGMENTS): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, length, segments);
  g.translate(0, -length / 2, 0);
  return g;
}

/** Tapered limb pointing forward from its pivot: spans z ∈ [-length, 0]. */
export function limbForward(rBack: number, rFront: number, length: number, segments = LIMB_SEGMENTS): BufferGeometry {
  const g = new CylinderGeometry(rFront, rBack, length, segments);
  g.rotateX(-Math.PI / 2); // +Y (top, rFront) → -Z
  g.translate(0, 0, -length / 2);
  return g;
}

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
