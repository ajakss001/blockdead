import { Group, Matrix4 } from 'three';
import { ZombieAnimator } from './animations';
import { buildZombie, type ZombieType } from './buildZombie';
import { BONES, createBones } from './skeleton';

/**
 * The looping clips of a type baked into skin matrices (bone × inverse rest, model frame), 18 × 16 floats per
 * frame: what a far zombie shows (render/ZombieModels) — no mixer, a copy per frame. Baked once per type.
 */
export const BAKE_FPS = 20;
export const SKIN_FLOATS = BONES.length * 16;
export type BakedClip = 'Idle' | 'Walk' | 'Run';

export interface Baked {
  clips: Record<BakedClip, { frames: number; data: Float32Array }>;
}

const cache = new Map<string, Baked>();

export function bakeType(type: ZombieType): Baked {
  const hit = cache.get(type.id);
  if (hit) return hit;
  const built = buildZombie(type);
  const root = new Group();
  const bones = createBones(built.dims);
  root.add(bones[0]);
  const anim = new ZombieAnimator(root, 1);
  const m = new Matrix4();
  const clips = {} as Baked['clips'];
  for (const name of ['Idle', 'Walk', 'Run'] as const) {
    const a = anim.actions[name];
    const dur = a.getClip().duration;
    const frames = Math.max(2, Math.round(dur * BAKE_FPS));
    const data = new Float32Array(frames * SKIN_FLOATS);
    anim.mixer.stopAllAction();
    a.reset().setEffectiveWeight(1).play();
    for (let f = 0; f < frames; f++) {
      a.time = (f / frames) * dur;
      anim.mixer.update(0);
      root.updateMatrixWorld(true);
      bones.forEach((b, i) => m.multiplyMatrices(b.matrixWorld, built.inverses[i]).toArray(data, f * SKIN_FLOATS + i * 16));
    }
    clips[name] = { frames, data };
  }
  anim.mixer.stopAllAction();
  const baked = { clips };
  cache.set(type.id, baked);
  return baked;
}
