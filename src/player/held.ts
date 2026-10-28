import { BoxGeometry, type BufferGeometry, ConeGeometry, CylinderGeometry, Group, type Material, Mesh } from 'three';
import { bladeMaterial, characterMaterial } from '../render/look/materials';

/** Things that go in the hands: weapons and tools, plus the flashlight (left hand). */
export type HeldId = 'knife' | 'axe' | 'bat' | 'crowbar' | 'hammer' | 'torch';

/**
 * How an item is held. Every model is authored the same way: the handle runs along +Y from the
 * butt at y = 0, the blade / striking face points to −Z ("forward", away from the holder).
 */
export interface HeldConfig {
  /** Both hands on the handle (the flashlight goes to the head). */
  twoHanded: boolean;
  /** Distances from the butt along the handle: [main (right) hand, other (left) hand]. Two-handed: the right
   * hand is the upper one (about a third of the way down from the head), the left one at the butt. */
  grips: number[];
  /** One-handed: wrist flexion (rad) that tips the handle forward out of the fist. */
  wrist: number;
  /** Swing timing, seconds; the blow lands at the start of `strike`. */
  windup: number;
  strike: number;
  recover: number;
  /** How loud a swing is, 0..1. */
  noise: number;
}

export const HELD: Readonly<Record<HeldId, HeldConfig>> = {
  knife: { twoHanded: false, grips: [0.05], wrist: -1.15, windup: 0.13, strike: 0.09, recover: 0.26, noise: 0.2 },
  hammer: { twoHanded: false, grips: [0.07], wrist: -1.0, windup: 0.16, strike: 0.09, recover: 0.3, noise: 0.4 },
  axe: { twoHanded: true, grips: [0.52, 0.06], wrist: 0, windup: 0.34, strike: 0.13, recover: 0.42, noise: 0.5 },
  bat: { twoHanded: true, grips: [0.3, 0.06], wrist: 0, windup: 0.28, strike: 0.12, recover: 0.36, noise: 0.45 },
  crowbar: { twoHanded: true, grips: [0.36, 0.05], wrist: 0, windup: 0.3, strike: 0.12, recover: 0.38, noise: 0.5 },
  torch: { twoHanded: false, grips: [0.06], wrist: -1.5, windup: 0, strike: 0, recover: 0, noise: 0 },
};

/** Model of a held item in its grip frame (see HeldConfig). Geometries are collected for disposal. */
export function buildHeldModel(id: HeldId, geos: BufferGeometry[]): Group {
  const g = new Group();
  const add = (geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0) => {
    geos.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const shaft = (r0: number, r1: number, len: number, seg = 6) => new CylinderGeometry(r1, r0, len, seg).translate(0, len / 2, 0);
  const wood = characterMaterial('handle', 0x6e5034);
  const steel = characterMaterial('torch', 0x4a4e52);
  switch (id) {
    case 'knife': {
      add(new BoxGeometry(0.022, 0.1, 0.03), characterMaterial('handle', 0x3b2a1e), 0, 0.05, 0);
      add(new BoxGeometry(0.03, 0.012, 0.036), steel, 0, 0.105, 0);
      // Flat blade, edge forward (−Z), spine back.
      const blade = new BoxGeometry(0.005, 0.16, 0.032, 1, 2, 1);
      const pos = blade.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        // Taper to a point near the spine at the top: edge forward (−Z), spine back.
        const t = (pos.getY(i) + 0.08) / 0.16;
        pos.setZ(i, pos.getZ(i) * (1 - t * 0.85) + 0.012 * t);
      }
      blade.computeVertexNormals();
      add(blade, bladeMaterial(), 0, 0.19, 0);
      break;
    }
    case 'hammer':
      add(shaft(0.013, 0.012, 0.32), wood);
      add(new BoxGeometry(0.03, 0.032, 0.12), steel, 0, 0.31, -0.02);
      break;
    case 'axe': {
      // Fire axe: red shaft, steel head — the edge forward, the pick behind.
      add(shaft(0.017, 0.015, 0.78), characterMaterial('handle', 0x8a3a24));
      add(new BoxGeometry(0.02, 0.07, 0.07), steel, 0, 0.72, 0);
      const edge = new BoxGeometry(0.012, 0.16, 0.09);
      add(edge, bladeMaterial(), 0, 0.72, -0.075);
      const pick = new ConeGeometry(0.018, 0.12, 4).rotateX(Math.PI / 2);
      add(pick, steel, 0, 0.73, 0.09);
      break;
    }
    case 'bat':
      add(shaft(0.017, 0.036, 0.72, 8), wood);
      add(new CylinderGeometry(0.026, 0.026, 0.018, 8), wood, 0, 0.005, 0);
      // Grip tape.
      add(shaft(0.019, 0.019, 0.2, 8), characterMaterial('cuff', 0x1c1c1e), 0, 0.02, 0);
      break;
    case 'crowbar':
      add(shaft(0.011, 0.011, 0.6), characterMaterial('torch', 0x7a2a22));
      // Hooked claw at the top, bending forward.
      add(new CylinderGeometry(0.01, 0.009, 0.1, 6).rotateX(-1.0), characterMaterial('torch', 0x7a2a22), 0, 0.63, -0.04);
      // Flat chisel end at the butt.
      add(new BoxGeometry(0.012, 0.04, 0.026), characterMaterial('torch', 0x7a2a22), 0, -0.01, -0.006);
      break;
    case 'torch': {
      add(shaft(0.018, 0.018, 0.15, 8), characterMaterial('torch', 0x33363a));
      add(shaft(0.022, 0.028, 0.045, 8), characterMaterial('torch', 0x33363a), 0, 0.15, 0);
      break;
    }
  }
  return g;
}
