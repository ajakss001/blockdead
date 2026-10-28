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

/** One elliptical cross-section of a loft: height, radii (x side-to-side, z front-to-back), z offset. */
export interface LoftRing {
  y: number;
  rx: number;
  rz: number;
  /** Shift of the section along Z (−Z = forward): calves bulge back, knees and bellies forward. */
  oz?: number;
}

/**
 * Smooth low-poly body part lofted through elliptical rings (bottom to top or top to bottom), with
 * closed ends. Used for legs, the pelvis and torsos: real silhouettes (knee, calf, hips) instead of
 * straight cylinders, at ~2·segments triangles per ring gap.
 */
export function ellipseLoft(rings: LoftRing[], segments = 10): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // UVs: around the ring (two texture tiles per turn) and along the height (~3 tiles per meter),
  // so cloth and skin textures read at a sensible scale.
  for (const r of rings) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r.rx, r.y, Math.sin(a) * r.rz + (r.oz ?? 0));
      uv.push((s / segments) * 2, r.y * 3);
    }
  }
  const up = rings[rings.length - 1].y > rings[0].y;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * segments + s;
      const b = i * segments + ((s + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      if (up) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  // End caps (fans round the ring centers).
  for (const [ri, flip] of [
    [0, up],
    [rings.length - 1, !up],
  ] as const) {
    const r = rings[ri];
    const center = pos.length / 3;
    pos.push(0, r.y, r.oz ?? 0);
    uv.push(0.5, r.y * 3);
    for (let s = 0; s < segments; s++) {
      const a = ri * segments + s;
      const b = ri * segments + ((s + 1) % segments);
      if (flip) idx.push(center, a, b);
      else idx.push(center, b, a);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
