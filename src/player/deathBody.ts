import { Vector3 } from 'three';
import { type BodyShape, FIGURE_SHAPE, PART, Ragdoll, type StaticBox, standingPoses } from '../physics/ragdoll';

/**
 * The player's body as it dies: standing where they stood, facing where they looked (yaw: the camera's,
 * looking along −Z turned by it), moving as they moved — thrown away from the zombie that killed them,
 * a little sideways and on the chest or the head at random, so no two falls are alike. No killer (a fall,
 * hunger, the infection): it just gives way. `shape`: the body's build (the survivor model's, from its
 * skeleton; the old figure's by default).
 */
export function playerRagdoll(feet: Vector3, yaw: number, scale: number, velocity: Vector3, killer: Vector3 | null, boxes: StaticBox[], rnd = Math.random, shape: BodyShape = FIGURE_SHAPE): Ragdoll {
  const parts = standingPoses(shape, feet, yaw + Math.PI, scale);
  const dir = new Vector3();
  if (killer) dir.set(feet.x - killer.x, 0, feet.z - killer.z);
  if (dir.lengthSq() < 1e-6) dir.set(Math.sin(yaw), 0, Math.cos(yaw));
  dir.normalize();
  const side = (rnd() - 0.5) * 1.1;
  dir.set(dir.x + dir.z * side, -0.1, dir.z - dir.x * side).normalize();
  const part = rnd() < 0.35 ? PART.head : PART.chest;
  const at = parts[part].p.clone().add(new Vector3((rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.1));
  return new Ragdoll({
    parts,
    scale,
    shape,
    velocity,
    impulse: { part, at, dir, strength: killer ? 55 + rnd() * 30 : 10 + rnd() * 15 },
    floorY: feet.y,
    boxes,
  });
}
