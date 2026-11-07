/**
 * The modelled zombie kinds as numbers only (no three.js): the simulation's speed, health, voice and hitbox,
 * the far crowd's colours, what their bodies hold. Speed and health are factors on the one-armed worker
 * (1.1 m/s following, 100 HP). The models themselves: src/zombies/types/*.ts.
 */
export const MODEL_KINDS = ['worker', 'medic', 'soldier', 'police', 'firefighter', 'office', 'grandma', 'jogger', 'chef', 'courier', 'builder', 'tourist', 'survivorM', 'survivorF'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export type BodyLoot = 'bodyZombie' | 'bodyMilitary' | 'bodyPolice' | 'bodyMedic' | 'bodyFire';

export interface KindStats {
  speed: number;
  hp: number;
  /** Height (m): the far crowd's body is scaled to it. */
  height: number;
  female?: boolean;
  /** How far the head is ahead of the feet (m, hunched): the head hitbox. */
  headFwd: number;
  /** Far crowd colours: skin, top, bottom. */
  colors: [number, number, number];
  oneArm?: boolean;
  loot: BodyLoot;
}

export const ZOMBIE_STATS: Record<ModelKind, KindStats> = {
  worker: { speed: 1, hp: 1, height: 1.86, headFwd: 0.25, colors: [0x909a87, 0xd5d2c1, 0x56739a], oneArm: true, loot: 'bodyZombie' },
  medic: { speed: 1.1, hp: 0.9, height: 1.68, female: true, headFwd: 0.1, colors: [0x8fa088, 0xe6e4dc, 0x2e8b84], loot: 'bodyMedic' },
  soldier: { speed: 0.9, hp: 1.8, height: 1.9, headFwd: 0.04, colors: [0x8c9a84, 0x5b6b3a, 0x5b6b3a], loot: 'bodyMilitary' },
  police: { speed: 0.95, hp: 1.3, height: 1.75, headFwd: 0.12, colors: [0x8c9a84, 0x232e45, 0x232e45], loot: 'bodyPolice' },
  firefighter: { speed: 0.8, hp: 2, height: 1.9, headFwd: 0.06, colors: [0x8c9a84, 0xb39a5a, 0xb39a5a], loot: 'bodyFire' },
  office: { speed: 1, hp: 0.8, height: 1.75, headFwd: 0.1, colors: [0x8c9a84, 0xe4e2d6, 0x5e6455], loot: 'bodyZombie' },
  grandma: { speed: 1.3, hp: 0.6, height: 1.5, female: true, headFwd: 0.2, colors: [0x8c9a84, 0xc98289, 0x8c9a84], loot: 'bodyZombie' },
  jogger: { speed: 1.6, hp: 0.7, height: 1.8, headFwd: 0.05, colors: [0x8c9a84, 0x2fb3a0, 0x2e9a8c], loot: 'bodyZombie' },
  chef: { speed: 0.7, hp: 1.6, height: 1.75, headFwd: 0.08, colors: [0x8c9a84, 0xe6e2d4, 0x8e918e], loot: 'bodyZombie' },
  courier: { speed: 1.4, hp: 0.8, height: 1.78, headFwd: 0.15, colors: [0x8c9a84, 0xe8c82e, 0x4a6a96], loot: 'bodyZombie' },
  builder: { speed: 0.9, hp: 1.5, height: 1.85, headFwd: 0.08, colors: [0x8c9a84, 0xf07a1e, 0x4e6a8e], loot: 'bodyZombie' },
  tourist: { speed: 1, hp: 1, height: 1.72, headFwd: 0.12, colors: [0x8c9a84, 0xe6dab0, 0xb5a66a], loot: 'bodyZombie' },
  // A dead player risen (types/survivor.ts): their tee and jeans.
  survivorM: { speed: 1.1, hp: 1, height: 1.78, headFwd: 0.1, colors: [0x8c9a84, 0xdcddd8, 0x8a8e88], loot: 'bodyZombie' },
  survivorF: { speed: 1.15, hp: 0.9, height: 1.66, female: true, headFwd: 0.08, colors: [0x8c9a84, 0xe2e2de, 0x9ca286], loot: 'bodyZombie' },
};

export const isModelKind = (k: string): k is ModelKind => k in ZOMBIE_STATS;
