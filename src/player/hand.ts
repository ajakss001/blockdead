import { BoxGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A closed hand gripping a handle, in the hand's frame: the wrist at the origin, the hand reaching
 * along −Z, the back of the hand on the `side` (+1 right hand → +X). The handle runs through the
 * curled fingers along the hand's local +Y axis at (GRIP_X·side, ·, GRIP_Z).
 */
export const GRIP_X = -0.03;
export const GRIP_Z = -0.05;

/** Low-poly fist: palm, four fingers in three segments curled round the grip, a thumb over them. ~200 triangles. */
export function handGeometry(side: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, rotY = 0) => {
    const g = new BoxGeometry(sx, sy, sz);
    if (rotY) g.rotateY(rotY);
    parts.push(g.translate(side * x, y, z));
  };
  // Palm and back of the hand, tapering towards the wrist.
  box(0.03, 0.078, 0.06, 0.01, 0, -0.045);
  box(0.034, 0.064, 0.03, 0.008, -0.004, -0.008);
  // Fingers, index (top) to little finger (bottom): knuckle → round the far side of the grip → back.
  for (let i = 0; i < 4; i++) {
    const y = 0.029 - i * 0.0195;
    const h = i === 3 ? 0.015 : 0.0175;
    const shrink = i === 3 ? 0.85 : i === 0 ? 0.97 : 1;
    box(0.036 * shrink, h, 0.02, -0.012, y, -0.077 + i * 0.002);
    box(0.017, h, 0.036 * shrink, -0.05, y, -0.056);
    box(0.024 * shrink, h, 0.015, -0.036, y, -0.03);
  }
  // Thumb: from the heel of the palm, across the index and middle fingers.
  box(0.02, 0.022, 0.034, -0.012, 0.03, -0.02, 0.35 * side);
  box(0.03, 0.018, 0.018, -0.04, 0.036, -0.042, -0.25 * side);
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}
