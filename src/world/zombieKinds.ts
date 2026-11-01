import type { ModelKind } from '../zombies/stats';
import { sceneAt } from './gen/chaos';
import { CHUNK, DOWNTOWN_RADIUS, type WorldLayout, type Zone } from './gen/layout';
import type { PoiKind } from './gen/poi';
import { pickScenarios } from './gen/scenarios';

/**
 * Which modelled zombie (src/zombies) a dead one is, by where it walks: police at the station and the
 * police lines, soldiers at the base and the checkpoints, medics at the lab and the evacuation points,
 * cooks in a mall with a food court, firefighters where the fire crews came or something burns, joggers
 * and grandmas in the parks, office workers downtown, builders and workers out of town.
 */
type Mix = [ModelKind, number][];

const SITE: Record<PoiKind, Mix> = {
  police: [['police', 0.75], ['office', 0.15], ['courier', 0.1]],
  checkpoint: [['soldier', 0.8], ['police', 0.2]],
  base: [['soldier', 0.9], ['worker', 0.1]],
  lab: [['medic', 0.55], ['office', 0.35], ['soldier', 0.1]],
  mall: [['tourist', 0.25], ['office', 0.25], ['courier', 0.2], ['grandma', 0.15], ['jogger', 0.1], ['chef', 0.05]],
  hyper: [['courier', 0.3], ['grandma', 0.25], ['worker', 0.15], ['chef', 0.15], ['office', 0.15]],
  airport: [['tourist', 0.6], ['office', 0.25], ['soldier', 0.15]],
  gas: [['worker', 0.4], ['courier', 0.35], ['builder', 0.25]],
  plant: [['worker', 0.55], ['builder', 0.45]],
  park: [['jogger', 0.35], ['grandma', 0.35], ['tourist', 0.3]],
};

/** A place's scenario adds its own people. */
const SCENARIO: Record<string, Mix> = {
  foodCourt: [['chef', 0.6]],
  fireCrew: [['firefighter', 0.7]],
  swat: [['soldier', 0.4]],
};

const SCENE: Record<string, Mix> = {
  police: [['police', 0.8], ['office', 0.2]],
  cordon: [['police', 0.45], ['soldier', 0.45], ['medic', 0.1]],
  evacuation: [['medic', 0.45], ['firefighter', 0.3], ['soldier', 0.25]],
  heli: [['soldier', 0.6], ['medic', 0.4]],
};

const ZONE: Record<Zone, Mix> = {
  downtown: [['office', 0.3], ['courier', 0.2], ['tourist', 0.15], ['jogger', 0.1], ['police', 0.1], ['firefighter', 0.05], ['medic', 0.05], ['worker', 0.05]],
  town: [['courier', 0.15], ['office', 0.15], ['grandma', 0.12], ['jogger', 0.12], ['tourist', 0.1], ['builder', 0.1], ['worker', 0.1], ['chef', 0.06], ['police', 0.05], ['medic', 0.05]],
  suburb: [['grandma', 0.25], ['jogger', 0.2], ['builder', 0.15], ['worker', 0.15], ['courier', 0.15], ['tourist', 0.1]],
  forest: [['worker', 0.4], ['builder', 0.3], ['jogger', 0.15], ['tourist', 0.15]],
  field: [['worker', 0.4], ['builder', 0.3], ['jogger', 0.15], ['tourist', 0.15]],
};

function pickFrom(mix: Mix, pick: number): ModelKind {
  let sum = 0;
  for (const [, w] of mix) sum += w;
  let r = pick * sum;
  for (const [k, w] of mix) if ((r -= w) < 0) return k;
  return mix[mix.length - 1][0];
}

/** The kind for a zombie at (x, z) in `zone`; `pick` in [0, 1) chooses within the place's mix. */
export function zombieKindAt(layout: WorldLayout, zone: Zone, x: number, z: number, pick: number): ModelKind {
  const site = layout.poi(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  if (site) {
    const mix = SITE[site.kind].slice();
    const picked = pickScenarios(layout.seed, site);
    for (const p of picked) mix.push(...(SCENARIO[p.def.id] ?? []));
    // Something burning or burnt here: the fire brigade came.
    if (picked.some((p) => p.state)) mix.push(['firefighter', 0.12]);
    return pickFrom(mix, pick);
  }
  // At a crossing with a scene (a police line, an evacuation point…).
  const i = Math.round(x / CHUNK);
  const j = Math.round(z / CHUNK);
  if (Math.hypot(x - i * CHUNK, z - j * CHUNK) < 22) {
    const urban = layout.isUrban(i, j) || layout.isUrban(i - 1, j) || layout.isUrban(i, j - 1) || layout.isUrban(i - 1, j - 1);
    const scene = sceneAt(layout.seed, i, j, urban, Math.max(Math.abs(i), Math.abs(j)) <= DOWNTOWN_RADIUS + 1);
    if (scene) return pickFrom(SCENE[scene.kind], pick);
  }
  return pickFrom(ZONE[zone], pick);
}
