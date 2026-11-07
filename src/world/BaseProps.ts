import { BoxGeometry, type BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, TorusGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { grim, RUST, SOOT } from '../style/palette';
import type { Base, Placed, PlacedKind } from '../systems/Base';

/*
 * What the survivor built, drawn: one merged mesh per kind (Lambert, the grime in the vertex colours —
 * noise, darker low down), copies for every one standing. The flames of a burning fire are not here: the
 * scene hands the fire to the world's own flames, glow and crackle (WorldLife / Atmosphere).
 */

type Part = [BufferGeometry, number];

/** Colour every vertex: the part's colour, ±10% noise, darker towards the ground (dust and soot from below). */
function paint(parts: Part[], height: number): BufferGeometry {
  const out: BufferGeometry[] = [];
  for (const [g0, color] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.deleteAttribute('uv');
    const pos = g.getAttribute('position');
    // Vertex colours are linear: the palette is sRGB.
    const { r, g: gr, b } = new Color().setHex(grim(color));
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const n = Math.sin(pos.getX(i) * 37.1 + y * 19.7 + pos.getZ(i) * 23.3) * 43758.5;
      const k = (0.9 + (n - Math.floor(n)) * 0.2) * (0.72 + 0.28 * Math.min(1, y / height));
      cols[i * 3] = r * k;
      cols[i * 3 + 1] = gr * k;
      cols[i * 3 + 2] = b * k;
    }
    g.setAttribute('color', new Float32BufferAttribute(cols, 3));
    out.push(g);
  }
  return mergeGeometries(out)!;
}

const at = (g: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  g.rotateX(rx).rotateY(ry).rotateZ(rz);
  return g.translate(x, y, z);
};

const WOOD = 0x4e4436;
const WOOD_DARK = 0x3a3329;
const STONE = 0x5a5a54;
const PLASTIC = 0x3f4a44;
const TIN = 0x7a7a72;

/** A ring of stones, three crossed logs (charred where they meet). */
function fire(): BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push([at(new BoxGeometry(0.16, 0.11, 0.13), Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42, 0, -a + i * 0.4, 0.1 * (i % 3)), STONE]);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    parts.push([at(new CylinderGeometry(0.045, 0.055, 0.62, 6), Math.cos(a) * 0.12, 0.12, Math.sin(a) * 0.12, 0, -a, Math.PI / 2 - 0.45), WOOD]);
  }
  parts.push([at(new CylinderGeometry(0.28, 0.32, 0.03, 10), 0, 0.015, 0), SOOT]);
  return paint(parts, 0.3);
}

/** Burnt out: the stones round a flat heap of ash. */
function ashes(): BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push([at(new BoxGeometry(0.16, 0.11, 0.13), Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42, 0, -a + i * 0.4, 0.1 * (i % 3)), STONE]);
  }
  parts.push([at(new CylinderGeometry(0.3, 0.34, 0.05, 10), 0, 0.025, 0), 0x46443e]);
  parts.push([at(new CylinderGeometry(0.035, 0.04, 0.4, 5), 0.05, 0.06, 0, 0, 0.7, Math.PI / 2), SOOT]);
  return paint(parts, 0.3);
}

/** A plastic drum on a plank stand, a tarp funnel stretched over it on four sticks. */
function barrel(): BufferGeometry {
  const parts: Part[] = [];
  parts.push([at(new CylinderGeometry(0.3, 0.3, 0.86, 12), 0, 0.53, 0), PLASTIC]);
  for (const y of [0.25, 0.8]) parts.push([at(new TorusGeometry(0.3, 0.018, 4, 14), 0, y, 0, Math.PI / 2), 0x343d38]);
  parts.push([at(new BoxGeometry(0.72, 0.08, 0.72), 0, 0.04, 0), WOOD_DARK]);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) parts.push([at(new CylinderGeometry(0.02, 0.025, 1.25, 5), sx * 0.42, 0.62, sz * 0.42), WOOD]);
  // The tarp sagging into the drum: four slanted sheets.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push([at(new BoxGeometry(0.62, 0.012, 0.32), Math.cos(a) * 0.24, 1.14, Math.sin(a) * 0.24, 0, -a, 0.32), 0x4a5048]);
  }
  return paint(parts, 1.2);
}

/** A chest knocked together from planks, with a hasp and dark corner straps. */
function stash(): BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) parts.push([at(new BoxGeometry(0.92, 0.15, 0.54), 0, 0.08 + i * 0.155, 0), i % 2 ? WOOD : WOOD_DARK]);
  parts.push([at(new BoxGeometry(0.96, 0.06, 0.58), 0, 0.5, 0), WOOD]);
  for (const sx of [-1, 1]) parts.push([at(new BoxGeometry(0.04, 0.5, 0.58), sx * 0.44, 0.25, 0), WOOD_DARK]);
  parts.push([at(new BoxGeometry(0.08, 0.12, 0.02), 0, 0.42, 0.29), RUST]);
  for (const sx of [-1, 1]) parts.push([at(new BoxGeometry(0.05, 0.53, 0.02), sx * 0.3, 0.27, 0.29), 0x2f2c27]);
  return paint(parts, 0.55);
}

/** Two pegs, a line low between them, cans hanging off it. */
function trap(): BufferGeometry {
  const parts: Part[] = [];
  for (const sx of [-1, 1]) parts.push([at(new CylinderGeometry(0.02, 0.025, 0.36, 5), sx * 0.9, 0.18, 0), WOOD]);
  parts.push([at(new BoxGeometry(1.8, 0.008, 0.008), 0, 0.27, 0), 0x6a665a]);
  for (const x of [-0.45, -0.1, 0.3, 0.6]) parts.push([at(new CylinderGeometry(0.035, 0.035, 0.11, 8), x, 0.2, 0, 0, 0, 0.2), TIN]);
  return paint(parts, 0.35);
}

const BUILD: Record<PlacedKind | 'ashes', () => BufferGeometry> = { fire, ashes, barrel, stash, trap };

export class BaseProps {
  readonly group = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly geos = new Map<string, BufferGeometry>();
  private shown = -1;

  constructor(private readonly base: Base) {
    this.group.name = 'base';
  }

  /** Rebuilds the copies when something was built, burnt out or taken away. */
  update(): void {
    if (this.shown === this.base.version) return;
    this.shown = this.base.version;
    this.group.clear();
    for (const p of this.base.list) {
      const m = new Mesh(this.geo(look(p)), this.material);
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = p.yaw;
      this.group.add(m);
    }
  }

  private geo(k: PlacedKind | 'ashes'): BufferGeometry {
    let g = this.geos.get(k);
    if (!g) {
      g = BUILD[k]();
      this.geos.set(k, g);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose();
    this.material.dispose();
  }
}

function look(p: Placed): PlacedKind | 'ashes' {
  return p.kind === 'fire' && p.fuel <= 0 ? 'ashes' : p.kind;
}

