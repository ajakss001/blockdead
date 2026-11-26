import { Vector3 } from 'three';
import { type BodyShape, PART, type PartPose, Ragdoll, type StaticBox } from '../physics/ragdoll';
import type { Zombie } from '../systems/zombies';

/**
 * A dead zombie's ragdoll: it starts from the model's own pose and build (render/ZombieModels.deathStart),
 * pushed by the killing blow — the part nearest the hit (or the head) takes the impulse, away from the hitter.
 */
export function zombieRagdoll(
  z: Zombie,
  start: { parts: PartPose[]; shape: BodyShape; scale?: number },
  boxes: StaticBox[],
  groundY?: (x: number, z: number, y: number) => number,
): Ragdoll {
  const d = z.death!;
  const parts = start.parts;
  const at = d.point ?? parts[PART.chest].p;
  let part: number = PART.head;
  if (!d.head) {
    let best = Infinity;
    parts.forEach((pp, i) => {
      const dd = pp.p.distanceToSquared(at);
      if (dd < best) (best = dd), (part = i);
    });
  }
  const dir = new Vector3(z.pos.x - d.fromX, 0, z.pos.z - d.fromZ);
  if (dir.lengthSq() < 1e-6) dir.set(-Math.sin(z.yaw), 0, -Math.cos(z.yaw));
  dir.normalize();
  dir.y = -0.15;
  return new Ragdoll({
    parts,
    scale: start.scale ?? 1,
    velocity: new Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw)).multiplyScalar(d.speed),
    impulse: { part, at, dir, strength: (30 + Math.min(d.damage, 90) * 1.6) * (d.push ?? 1) },
    floorY: z.pos.y,
    groundY,
    boxes,
    shape: start.shape,
  });
}
