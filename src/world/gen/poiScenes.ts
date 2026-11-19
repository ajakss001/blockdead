import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { mulberry32 } from '../../core/random';
import type { ItemId } from '../../data/items';
import type { Surface } from '../../render/look/surfaces';
import { type ModelInfo, pickModel } from '../models';
import { CAR_PAINTS, modelLibrary, placeModel } from '../props/car';
import { fireTruck, jersey, sandbags, stripedBarrier, tent } from './chaos';
import { char, charTint } from './charred';
import * as F from './furniture';
import { Place } from './furniture';
import { groundDecal } from './highrise';
import { LIFE, spotHash } from './lifeKinds';
import { hash3 } from './noise';
import { type Builder, pick, type Rand } from './pieces';
import { aircraft } from './poiBig';
import { cart } from './poiBuild2';
import type { PoiKind } from './poi';
import { labBrokenCells } from './poiLab';
import { LOT, type Site } from './poiSite';
import type { SceneState } from './scenarios';

/*
 * The scenarios' templates (see scenarios.ts for the pools): what each one adds to its place, in the site's
 * local frame. No blood: the dead lie under sheets or in bags. Burnt things are the same pieces in charred
 * colours; the fire points of a scenario get flames (burning now) or a thin smoke (burnt out) on their own.
 * Every scenario draws its own random numbers from the site's seed: the chunks of a big place agree.
 */

interface Ctx {
  S: Site;
  p: Place;
  b: Builder;
  rand: Rand;
  state: SceneState;
  /** Decals laid so far (each a hair higher than the last: no two coplanar). */
  k: number;
}

type Build = (c: Ctx) => void;

/** Draw the site's scenarios: which, by its seed; called once the template is built. */
export function applyScenarios(S: Site, seed: number): void {
  S.picked.forEach(({ def, state }, k) => {
    const c: Ctx = { S, p: S.p, b: S.b, rand: mulberry32(hash3(seed ^ 0x9e37, S.s.i * 977 + k * 31 + 7, S.s.j * 613 + 3)), state, k: 0 };
    TEMPLATES[S.s.kind]?.[def.id]?.(c);
    for (const [lx, lz, w, y = 0] of def.fire ?? []) {
      const [x, z] = S.p.pt(lx, lz);
      const sd = spotHash(x, z, 91);
      // A big fire is a few tongues side by side, not one huge sheet.
      const n = state === 'burning' && w > 1.6 ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const a = sd * 6.28 + (k * Math.PI * 2) / 3;
        const d = n > 1 ? w * 0.35 : 0;
        S.b.life(state === 'burning' ? LIFE.fire : LIFE.smoke, x + Math.cos(a) * d, y, z + Math.sin(a) * d, 0, 1, n > 1 ? w * (k ? 0.5 : 0.65) : w, 0, (sd + k * 0.31) % 1);
      }
      decal(c, 'decalSoot', lx, lz, w * 3.2, 1.2);
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

const yawW = (c: Ctx, yaw: number) => yaw + (c.S.p.r * Math.PI) / 2;

/** A decal on the ground at a local point (y: the floor it lies on). */
function decal(c: Ctx, surface: Surface, lx: number, lz: number, size: number, stretch = 1, y = 0): void {
  const [x, z] = c.p.pt(lx, lz);
  groundDecal(c.b, surface, x, y + 0.016 + (c.k++ % 6) * 0.0025, z, size, c.rand, stretch);
}

/** A model of a group at a local point, nose (+X) along local yaw: tipped, lifted, charred; null if there is none. */
function mdl(c: Ctx, group: string, lx: number, lz: number, yaw: number, o: { roll?: number; pitch?: number; lift?: number | 'flip'; flipK?: number; charred?: boolean; collide?: boolean; paint?: number } = {}): ModelInfo | null {
  const m = pickModel(modelLibrary(), group, c.rand());
  if (!m) return null;
  const [x, z] = c.p.pt(lx, lz);
  if (!c.b.inClip(x, z)) return m;
  const wyaw = yawW(c, yaw);
  const lift = o.lift === 'flip' ? m.size[1] * (o.flipK ?? 0.96) : (o.lift ?? 0);
  const top = o.roll === Math.PI ? m.size[1] : o.roll ? Math.max(1.2, lift * 2) : lift + m.size[1];
  const mat = new Matrix4().compose(new Vector3(x, lift + 0.01, z), new Quaternion().setFromEuler(new Euler(o.roll ?? 0, wyaw, o.pitch ?? 0, 'YXZ')), new Vector3(1, 1, 1));
  placeModel(c.b.batch, m, mat, o.paint !== undefined ? new Color(o.paint) : null, o.charred ? charTint : undefined);
  if (o.collide !== false) c.b.colliders.addOrientedBox(x, z, m.size[0] / 2, m.size[2] / 2, wyaw, -0.5, top + 0.05);
  return m;
}

/** A sub-place turned by a free yaw (and tipped). */
const at = (c: Ctx, lx: number, lz: number, yaw = 0, pitch = 0, roll = 0, lift = 0, y = 0): Place => {
  const [x, z] = c.p.pt(lx, lz);
  return new Place(c.b, x, c.p.y + y, z, c.p.r).tipped(yaw, pitch, roll, lift);
};

/** A searchable stash of the survivors (3D supply crate), maybe with a note in it. */
function stash(c: Ctx, lx: number, lz: number, note?: ItemId, y = 0): void {
  const q = c.p.at(lx, lz);
  q.resetBounds();
  q.model('supplyCrate', c.rand, 0, y, 0, 0, 1, 0.78, 0.15, y === 0);
  c.S.container('campStash', lx, lz, note ? [note] : undefined, y);
}

/** A camp lantern: a warm glow (no light of its own). */
function lantern(c: Ctx, lx: number, y: number, lz: number): void {
  c.p.box(0x3a3a34, lx, y, lz, 0.14, 0.24, 0.14, 'metal');
  c.p.life(LIFE.beacon, lx, y + 0.14, lz, 0.55, 0.0001, spotHash(lx, lz, 3), 1);
}

/** A loudspeaker horn on a mount (a pole, a wall), facing local yaw, and the message from it. */
function horn(c: Ctx, lx: number, y: number, lz: number, yaw: number, kind: number = LIFE.speaker): void {
  const q = at(c, lx, lz, yaw);
  q.box(0x5a5e60, -0.12, y - 0.12, 0, 0.08, 0.24, 0.08, 'metal');
  q.rbox(0xb8bcb8, 0.1, y, 0, 0.32, 0.22, 0.22, 0, 0, 0, 'metal');
  q.rbox(0xb8bcb8, 0.32, y, 0, 0.14, 0.42, 0.42, 0, 0, 0, 'metal');
  c.p.life(kind, lx, y, lz, 1, 0, spotHash(lx, lz, 5));
}

/** Hand-written sign on cardboard, on a wall facing local +Z of its place (q) or freestanding on a post. */
function sign(c: Ctx, q: Place, surface: Surface, lx: number, cy: number, size: number): void {
  q.poster(0xffffff, lx, cy, size, size, (c.rand() - 0.5) * 0.12, surface);
}

/** Tape on two sides (seen from both), across a gap: from local (x0) to (x1) of a place along its X, in 1.6 m lengths. */
function tape(q: Place, x0: number, x1: number, y: number, roll = 0, surface: Surface = 'decalBiohazard'): void {
  const back = q.tipped(Math.PI);
  const n = roll ? 1 : Math.max(1, Math.round((x1 - x0) / 1.6));
  const seg = (x1 - x0) / n;
  for (let k = 0; k < n; k++) {
    const x = x0 + seg * (k + 0.5);
    q.poster(0xffffff, x, y, seg, 0.9, roll, surface);
    back.poster(0xffffff, -x, y, seg, 0.9, -roll, surface);
  }
}

/** A row of suitcases and bags dropped about. */
function luggage(c: Ctx, x0: number, z0: number, x1: number, z1: number, n: number): void {
  for (let k = 0; k < n; k++) F.suitcase(at(c, x0 + c.rand() * (x1 - x0), z0 + c.rand() * (z1 - z0), c.rand() * 6, 0, c.rand() < 0.4 ? Math.PI / 2 - 0.1 : 0, c.rand() < 0.4 ? 0.2 : 0), c.rand, c.rand() < 0.35);
}

/** A beacon (warning light): red (tag 0) / amber (1) / white tube (2); mode 5 blinking, 6 turning, 1–2 flickering. */
function beacon(c: Ctx, lx: number, y: number, lz: number, size: number, mode: number, tag: number, housing = true): void {
  if (housing) c.p.box(tag === 1 ? 0x8a6a2a : tag === 2 ? 0xb8bcc0 : 0x7a2a22, lx, y - 0.12, lz, 0.2, 0.24, 0.2, 'lamp');
  c.p.life(LIFE.beacon, lx, y, lz, size, mode, spotHash(lx, lz + y, 9), tag);
}

/** Barrel standing at a point (3D model only). */
function barrel(c: Ctx, lx: number, lz: number, y = 0): void {
  c.p.model('barrel', c.rand, lx, y, lz, c.rand() * 6, 1, 0.65, 0.4, true);
}

/** Helicopter wreck (3D model only). */
function heliWreck(c: Ctx, lx: number, lz: number, yaw: number, burnt: boolean, roll = Math.PI): void {
  mdl(c, 'heliMil', lx, lz, yaw, { roll, lift: roll === Math.PI ? 'flip' : 0.9, flipK: 0.78, charred: burnt }) ?? mdl(c, 'heli', lx, lz, yaw, { roll, lift: roll === Math.PI ? 'flip' : 0.9, flipK: 0.78, charred: burnt });
  decal(c, 'decalSkid', lx - 4, lz + 1, 3, 3.5);
}

/** Fire / foam / oil marks round a point. */
function marks(c: Ctx, surface: Surface, lx: number, lz: number, r: number, n: number, size: number): void {
  for (let k = 0; k < n; k++) {
    const a = c.rand() * 6.28;
    const d = c.rand() * r;
    decal(c, surface, lx + Math.cos(a) * d, lz + Math.sin(a) * d, size * (0.6 + c.rand() * 0.6), 1 + c.rand() * 0.6);
  }
}

// ── Templates ───────────────────────────────────────────────────────────────────

const TEMPLATES: Partial<Record<PoiKind, Record<string, Build>>> = {
  // ── Airport (local: runway z −48…−28, apron x −72…40 z −14…6, terminal x −48…−8 z 8…30) ─────────────
  airport: {
    heliFlip(c) {
      const burnt = !!c.state;
      heliWreck(c, 26, 22, 0.6, burnt);
    },
    linerFire(c) {
      const q = c.p.at(-50, -38, 1).tipped(0, 0, 0.05);
      aircraft(c.S, 'airliner', q, c.rand, c.state === 'burnt');
      // The gear gave way: soot along the runway.
      for (const [x, z, s] of [
        [-50, -38, 12],
        [-45, -44, 7],
        [-56, -32, 7],
        [-38, -40, 6],
      ] as const) decal(c, 'decalSoot', x, z, s, 1.4);
      // The foam the fire crew got down before it beat them.
      marks(c, 'decalFoam', -40, -34, 6, 4, 5);
    },
    terminalCrash(c) {
      const q = c.p.at(-38, 4.3, 0).tipped(0.12, 0.3, 0.14, 0.55);
      aircraft(c.S, 'lightplane', q, c.rand, !!c.state);
      // The facade scorched round it, broken glass on the floor.
      for (const x of [-41, -35]) c.p.at(x, 7.88, 2).poster(0xffffff, 0, 3.2, 1.4, 5, 0, 'decalSoot');
      decal(c, 'decalShards', -38, 10, 5, 1.6, 0.04);
      decal(c, 'decalShards', -38, 6, 4, 1.4);
    },
    slides(c) {
      luggage(c, -38, -2, -20, 6, 9);
    },
    luggage(c) {
      luggage(c, -20, -46, 20, -30, 12);
      luggage(c, 0, -12, 38, 4, 12);
    },
    fuelTruck(c) {
      marks(c, 'decalSheen', 18, -2, 6, 5, 4);
      decal(c, 'decalSkid', 10, -10, 3, 4);
    },
    fireCrew(c) {
      for (const [x, z, yaw] of [
        [34, -24, 0.4],
        [54, -22, 2.6],
      ] as const) {
        const [wx, wz] = c.p.pt(x, z);
        if (c.b.inClip(wx, wz)) fireTruck(c.b, wx, wz, yawW(c, yaw), c.rand);
        else c.rand();
      }
      marks(c, 'decalFoam', 44, -36, 9, 8, 6);
    },
    camp(c) {
      // The evacuation stash in the terminal's east end.
      stash(c, -9.6, 28.6, 'campNote1');
      stash(c, -18, 21.6, 'campNote3');
      lantern(c, -16, 0.76, 23.3);
      lantern(c, -12, 0.04, 26.5);
      sign(c, c.p.at(-14, 29.88, 2), 'decalEvacuate', 0, 1.7, 1.3);
      luggage(c, -24, 25.5, -9, 27, 5);
    },
    board(c) {
      // Departures board over the check-in, facing the hall: every line cancelled, blinking.
      c.p.box(0x0a0a0c, -36, 3.6, 21.6, 8.2, 1.9, 0.1, 'metal');
      for (const x of [-39, -33]) c.p.box(0x3a3c3e, x, 5.5, 21.6, 0.05, 1.0, 0.05, 'metal');
      for (let r = 0; r < 4; r++) {
        const cy = 3.88 + r * 0.44;
        const B = c.p.at(-36, 21.55 - r * 0.003, 2);
        B.poster(0xffffff, -2.2, cy, 1.6, 1.0, 0, 'decalCancelled');
        for (let k = 0; k < 4; k++) B.rbox(0xd8a030, 0.9 + k * 0.42, cy, 0.03, 0.3, 0.16, 0.01, 0, 0, 0, 'lamp');
        c.p.life(LIFE.beacon, -33.8, cy, 21.45, 0.7, 5, r * 0.37 + 0.1, 1);
      }
    },
    announce(c) {
      horn(c, -28, 5.9, 14, Math.PI / 2);
      horn(c, -12, 5.9, 26, -Math.PI / 2);
      horn(c, 12, 19.6, 16.2, Math.PI / 2);
    },
    crew(c) {
      F.suitcase(at(c, -31, 2, 1.2), c.rand, true);
    },
  },

  // ── Gas station (canopy z 7…17, pumps x ±3.5; shop x −14…2 z −14…−2; workshop x 6…18) ─────────────
  gas: {
    pumpsBlown(c) {
      for (const [x, z] of [
        [-3.5, 12],
        [3.5, 12],
      ] as const) decal(c, 'decalSoot', x, z, 6, 1.5);
      decal(c, 'decalShards', -9.5, -1, 4, 1.4);
    },
    canopyDown(c) {
      decal(c, 'decalSoot', 4, 12, 7, 1.3);
    },
    burntCars(c) {
      for (const [x, z, yaw] of [
        [-14, 10, 0.3],
        [-18, 15, 1.8],
        [13, 5, -0.4],
      ] as const) {
        mdl(c, 'wreck', x, z, yaw, { charred: true });
        decal(c, 'decalOil', x, z, 3, 1.4);
      }
    },
    queue(c) {
      // A queue for fuel from the road to the pumps.
      for (let k = 0; k < 4; k++) {
        const x = -22 + k * 5.8;
        const yaw = (c.rand() - 0.5) * 0.12;
        const paint = pick(c.rand, Object.values(CAR_PAINTS));
        c.S.car(x, 20, yaw, c.rand, 'car', paint);
        if (c.rand() < 0.5) F.suitcase(at(c, x + 1.2, 21.8, c.rand() * 6), c.rand, true);
      }
    },
    looted(c) {
      for (const [x, z] of [
        [-9.5, -1.2],
        [-9.5, -2.8],
      ] as const) decal(c, 'decalShards', x, z, 3, 1.6, z < -2 ? 0.04 : 0);
      F.boxes(at(c, -2.5, -9, 0.6, 0, Math.PI / 2 - 0.1, 0.2, 0.04), c.rand, 2);
    },
    noFuel(c) {
      const blown = c.S.scenes.has('pumpsBlown');
      sign(c, c.p.at(-12.5, -1.885, 0), 'decalNoFuel', 0, 1.6, 1.2);
      sign(c, c.p.at(1.2, -1.885, 0), 'decalNoFuel', 0, 1.0, 0.8);
      if (!blown) for (const x of [-3.5, 3.5]) sign(c, c.p.at(x, 12 + 1.8 + 0.226, 0), 'decalNoFuel', 0, 1.2, 0.5);
      // On a stand by the road, and taped to the price pylon.
      c.p.box(0x5a4a34, -6, 0, 22.5, 0.08, 1.0, 0.08, 'wood', true);
      c.p.box(0x9a8462, -6, 0.9, 22.5, 1.3, 1.0, 0.03, 'wood');
      sign(c, c.p.at(-6, 22.52, 0), 'decalNoFuel', 0, 1.4, 1.2);
      sign(c, c.p.at(20, 22.18, 0), 'decalNoFuel', 0, 1.6, 0.7);
    },
    camp(c) {
      F.barricade(c.p.at(-6.2, -1.2, 0), c.rand);
      stash(c, 0.9, -13.2, 'campNote2', 0.04);
      stash(c, -13, -4.4, 'campNote4', 0.04);
      lantern(c, -0.9, 0.04, -12.8);
    },
    sheen(c) {
      marks(c, 'decalSheen', 0, 12, 7, 6, 3.4);
      marks(c, 'decalOil', 0, 18, 8, 3, 2.4);
    },
  },

  // ── Police (building x −24…12 z −20…6, door (−2, 6); parking z 8…26; garage x 14…26) ─────────────
  police: {
    barricade(c) {
      sandbags(c.p, -5.2, 8.3, 3.2, c.rand);
      sandbags(c.p, 1.2, 8.3, 3.2, c.rand);
      jersey(c.p, -9, 11.5, 2.6);
      jersey(c.p, 5, 11.5, 2.6);
    },
    flipped(c) {
      const burnt = !!c.state;
      if (!mdl(c, 'police', 15, 14, 0.4, { roll: Math.PI, lift: 'flip', charred: burnt })) c.S.car(15, 14, 0.4, c.rand, 'police');
      if (!mdl(c, 'police', -11, 13, -0.3, { roll: Math.PI / 2, lift: 0.95 })) c.S.car(-11, 13, -0.3, c.rand, 'police');
      decal(c, 'decalShards', 15, 14, 4, 1.5);
      decal(c, 'decalSkid', 8, 16, 3, 4);
      decal(c, 'decalShards', -11, 13, 3.5, 1.5);
    },
    swat(c) {
      const yaw = 0.15;
      c.S.car(2, 15, yaw, c.rand, 'van', 0x1e2632);
    },
    sandbags(c) {
      sandbags(c.p, -18, 12, 3.2, c.rand);
      sandbags(c.p.at(-19.8, 13.4, 1), 0, 0, 2.4, c.rand);
      sandbags(c.p, 21, 10, 3.0, c.rand);
      sandbags(c.p.at(22.8, 11.4, 3), 0, 0, 2.4, c.rand);
    },
    cells(_c) {},
    lastStand(c) {
      F.desk(c.p.at(3.2, -3.1, 1), c.rand, true, true);
      F.filingCabinet(c.p.at(3.4, -4.3, 1), c.rand, true);
      F.desk(c.p.at(-6, 0, 0), c.rand, true, true);
    },
    radio(c) {
      c.p.life(LIFE.radio, -0.6, 1.3, 0.4, 1, 0, spotHash(c.S.s.i, c.S.s.j, 21));
    },
    files(_c) {},
  },

  // ── Hypermarket (x ±24 z −24…12, doors (±8, 12); gondolas z −12…0.5; checkouts z 8) ─────────────
  hyper: {
    cartWall(c) {
      for (let k = 0; k < 10; k++) cart(c.p, -11.2 + (k % 5) * 1.0 + c.rand() * 0.2, 12.8 + Math.floor(k / 5) * 0.95, Math.PI / 2 + (c.rand() - 0.5) * 0.5, k > 6 && c.rand() < 0.6);
      for (let k = 0; k < 3; k++) cart(c.p, -10.5 + k * 1.2, 13.3, (c.rand() - 0.5) * 0.6, true);
      c.p.solid(-8, 13.3, 5.5, 2.2, 1.1);
      for (let k = 0; k < 6; k++) cart(c.p, 18 - c.rand() * 6, 14 + c.rand() * 3, c.rand() * 6, true);
    },
    emptyShelves(_c) {},
    fallen(c) {
      for (const [x, z] of [
        [-4, -20.5],
        [10, -20],
      ] as const) {
        c.p.at(x, z).model('palletCrates', c.rand, 0, 0.04, 0, 0, 1, 0.82, 0.08, true);
      }
      decal(c, 'decalShards', -14, 5.5, 3.5, 1.4, 0.04);
    },
    carCrash(c) {
      // A car through the east entrance, half inside.
      const burnt = !!c.state;
      if (!(burnt && mdl(c, 'wreck', 8, 11.6, -Math.PI / 2, { charred: true }))) c.S.car(8, 11.6, -Math.PI / 2, c.rand, burnt ? 'wreck' : 'car');
      decal(c, 'decalShards', 8, 10.5, 4, 1.6, 0.04);
      decal(c, 'decalShards', 8, 15.5, 4, 1.6);
      cart(c.p, 5.5, 10, 0.8, true);
    },
    camp(c) {
      stash(c, -17.05, 0.2, 'campNote1', 0.04);
      stash(c, -12.15, -5.6, 'campNote3', 0.04);
      lantern(c, -11.6, 0.76, 3.4);
      lantern(c, -17.05, 0.04, -1.2);
    },
    flicker(c) {
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 3; j++) {
          const x = -18 + i * 9;
          const z = -8 + j * 7;
          c.p.box(0xc8ccd0, x, 6.75, z, 0.25, 0.08, 2.4, 'lamp');
          beacon(c, x, 6.65, z, 1.3, c.rand() < 0.5 ? 1 : 2, 2, false);
        }
      }
    },
    alarm(c) {
      c.p.box(0x8a2a20, 0, 5.6, 12.15, 0.4, 0.4, 0.1, 'metal');
      c.p.life(LIFE.bell, 0, 5.6, 12.3, 1, 0, spotHash(c.S.s.i, c.S.s.j, 23));
      beacon(c, -10.5, 3.5, 12.25, 0.9, 5, 1);
      beacon(c, 10.5, 3.5, 12.25, 0.9, 5, 1);
    },
  },

  // ── Mall (x ±24 z −22…10, 2 floors; atrium x −8…8 z −10…2; fountain (−3, −5); shops west; food court east) ──
  mall: {
    mannequins(_c) {},
    fountain(_c) {},
    escalators(c) {
      stripedBarrier(c.p.at(-0.8, -1.75, 1), 0, 0, 3.2, c.rand() < 0.4);
      F.suitcase(at(c, -1.4, -3.4, 1.0), c.rand, true);
    },
    shutters(c) {
      for (const [zc, low] of [
        [-16.7, 1.1],
        [-6, 0.04],
        [4.7, 1.3],
      ] as const) {
        const y0 = low;
        const h = 3 - y0;
        c.p.box(0x8a8c8a, -11.84, y0, zc, 0.05, h, 4.0, 'metal', true);
        for (let y = y0 + 0.12; y < 3; y += 0.16) c.p.box(0x6a6c6a, -11.8, y, zc, 0.02, 0.025, 3.98, 'metal');
        c.p.box(0x4a4c4a, -11.8, y0, zc, 0.08, 0.08, 4.0, 'metal');
      }
    },
    foodCourt(c) {
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          if (c.rand() < 0.25) continue;
          const x = 11.8 + col * 3.0 + (c.rand() - 0.5) * 0.3;
          const z = -2.0 + row * 3.2 + (c.rand() - 0.5) * 0.3;
          F.cafeTable(at(c, x, z, (c.rand() - 0.5) * 0.5, 0, 0, 0, 0.04), c.rand, true);
        }
      }
      decal(c, 'decalShards', 16, -4, 4, 1.4, 0.04);
    },
    music(c) {
      for (const [x, z] of [
        [0, -4],
        [16, -6],
        [-16, -6],
      ] as const) {
        c.p.cyl(0xd8d4cc, x, FH_MALL - 0.42, z, 0.22, 0.1, 'plaster');
        c.p.life(LIFE.music, x, FH_MALL - 0.6, z, 1, 0, spotHash(x, z, 25));
      }
    },
  },

  // ── Water plant (tanks (−11, −10) r7 and (11, −12) r6; pump house x 4…20 z 2…12; control x −20…−8 z 4…12) ──
  plant: {
    flooded(c) {
      // The pump house's floor under water (dark glass over it reads as still water), drips from the roof.
      c.p.box(0x1e2a2a, 12, 0.04, 7, 15.6, 0.32, 9.6, 'carGlass');
      for (let k = 0; k < 4; k++) {
        const [wx, wz] = c.p.pt(6 + c.rand() * 12, 3 + c.rand() * 7);
        c.b.life(LIFE.drip, wx, 4.95, wz, 0, 0, 0, 4.6, spotHash(wx, wz, 72));
      }
      decal(c, 'decalOil', 8, 13.5, 3, 2);
      decal(c, 'decalOil', 12, 13.2, 2.6, 1.6);
    },
    burst(c) {
      c.p.rbox(0x4a6a8a, 6.5, 0.9, -7, 0.5, 0.8, 0.8, 0, 0.3, 0.2, 'metal');
      c.p.at(6.4, -7, 1).life(LIFE.jet, 0, 0.9, 0, 1, 0, spotHash(c.S.s.i, c.S.s.j, 27));
      for (let k = 0; k < 3; k++) decal(c, 'decalOil', 9 + k * 2.5, -7 + (c.rand() - 0.5) * 2, 3.5, 1.8);
    },
    steam(c) {
      for (const [x, z] of [
        [8, 6],
        [16, 9],
      ] as const) {
        c.p.cyl(0x6a6a66, x, 5.5, z, 0.25, 0.6, 'metal');
        c.p.life(LIFE.steam, x, 5.85, z, 1, 0, spotHash(x, z, 28));
      }
      c.p.life(LIFE.steam, 0.6, 1.3, -3, 1, 0, spotHash(c.S.s.i, c.S.s.j, 29));
    },
    alarm(c) {
      beacon(c, 12, 4.3, 12.2, 1.1, 6, 0);
      c.p.life(LIFE.siren, 12, 4.6, 12.3, 1, 0, spotHash(c.S.s.i, c.S.s.j, 24));
      beacon(c, -14, 3.65, 8, 0.9, 5, 1);
    },
    evac(c) {
      sign(c, c.p.at(-17.5, 12.11, 0), 'decalEvacuate', 0, 1.6, 1.2);
      c.S.car(-10, 21, 0.2, c.rand, 'van');
    },
  },

  // ── Checkpoint (road z 32; tents (−14, 6), (−6, 6), (4, −4); tower (12, 20); truck (−14, 20), APC (16, 6)) ──
  checkpoint: {
    burningTank(c) {
      mdl(c, 'tank', -4, -16, 0.4, { charred: true }) ?? mdl(c, 'truck', -4, -16, 0.4, { charred: true });
      decal(c, 'decalSkid', -10, -12, 3, 4);
    },
    breached(c) {
      jersey(c.p, 16, 30.5, 2.2);
      jersey(c.p, 21, 33.5, 2.2);
      jersey(c.p, -0.5, 34.8, 2.2);
      sandbags(c.p, 6, 27, 3.0, c.rand);
      decal(c, 'decalSkid', 8, 31, 3, 6);
      decal(c, 'decalSkid', 0, 29, 3, 5);
      c.S.car(24, 30, 0.25, c.rand, 'wreck');
    },
    collapsed(_c) {},
    flares(c) {
      for (const [x, z] of [
        [-12, 28.4],
        [-6, 29.2],
        [2.5, 27.6],
        [10, 28.8],
        [-20, 25],
      ] as const) {
        c.p.cyl(0xb02a20, x, 0.06, z, 0.03, 0.25, 'rubber', Math.PI / 2);
        c.p.life(LIFE.beacon, x, 0.18, z, 0.7, 4, spotHash(x, z, 31), 0);
        c.p.life(LIFE.smoke, x, 0.25, z, 0, 0, spotHash(x, z, 32));
      }
    },
    searchlight(c) {
      c.p.box(0x4a5a3a, -21, 0, 15, 1.6, 1.0, 1.0, 'metal', true);
      c.p.box(0x2a2c2a, -21.6, 1.0, 15, 0.3, 0.3, 0.3, 'metal');
      c.p.box(0x5a5e60, -21, 0, 17, 0.15, 3.2, 0.15, 'metal', true);
      c.p.cyl(0x3a3c3e, -21, 3.4, 17, 0.35, 0.5, 'metal');
      c.p.life(LIFE.spin, -21, 3.45, 17, 1, 0, spotHash(c.S.s.i, c.S.s.j, 33), 1);
      c.p.life(LIFE.beacon, -21, 3.45, 17, 0.9, 0, spotHash(c.S.s.i, c.S.s.j, 34), 1);
      for (let k = 0; k < 3; k++) c.p.rbox(0x1a1a1a, -21 + k * 0.1, 0.03, 15.8 + k * 0.3, 0.6, 0.05, 0.05, 1.4, 0, 0, 'rubber');
    },
    megaphone(c) {
      horn(c, 12, 7.0, 21.5, Math.PI / 2);
      c.p.box(0x5a5e60, -10, 0, 26, 0.12, 4.2, 0.12, 'metal', true);
      horn(c, -10, 4.0, 26.1, Math.PI / 2);
    },
    crates(c) {
      for (let k = 0; k < 5; k++) {
        c.p.at(-22 + k * 1.4, -1 + (c.rand() - 0.5) * 1.5).model('supplyCrate', c.rand, 0, 0, 0, (c.rand() - 0.5) * 0.4, 1, 0.78, 0.15, true);
      }
    },
  },

  // ── Military base (lot ±58; hangar x 10…54 z −36…−12; garages x 8…52 z −56…−40; gate road x −4…4 z −6…L) ──
  base: {
    heliHangar(c) {
      heliWreck(c, 32, -21, -Math.PI / 2 + 0.2, !!c.state, 0.4);
      decal(c, 'decalOil', 34, -18, 3, 1.6, 0.04);
    },
    fuelDepot(c) {
      const burnt = !!c.state;
      for (const [x, z, r, h] of [
        [-8, 30, 2.2, 4],
        [-8, 38, 2.2, 4],
        [-8, 46, 2.0, 3.6],
      ] as const) {
        const k = burnt ? (z === 38 ? 0.9 : 0.55) : 0.3;
        c.p.cyl(char(0xb8bcb0, k), x, h / 2, z, r, h, 'metal');
        c.p.cyl(char(0x8a8e84, k), x, h + 0.05, z, r + 0.05, 0.1, 'metal');
        c.p.solid(x, z, r * 1.8, r * 1.8, h);
        for (let s = 0; s < 6; s++) c.p.box(0x5a5a5a, x + r + 0.05, s * 0.6, z, 0.4, 0.05, 0.05, 'metal');
      }
      for (const [x, z, w, d] of [
        [-11, 38, 0.4, 22],
        [-5, 38, 0.4, 22],
        [-8, 27.2, 6.4, 0.4],
        [-8, 48.8, 6.4, 0.4],
      ] as const) c.p.box(0x7a7a72, x, 0, z, w, 0.7, d, 'concrete', true);
      c.p.cyl(0x5a5e60, -4.6, 0.5, 38, 0.15, 18, 'metal', Math.PI / 2);
      marks(c, 'decalSheen', -8, 38, 6, 5, 3);
    },
    apcFlip(c) {
      const burnt = !!c.state;
      mdl(c, 'apc', -40, -2, 0.3, { roll: Math.PI, lift: 'flip', flipK: 0.74, charred: burnt });
      decal(c, 'decalSkid', -32, -3, 3, 5);
    },
    breach(c) {
      // A truck came through the west fence.
      if (!mdl(c, 'truck', -54.6, -4, 0.15)) c.S.car(-54.6, -4, 0.15, c.rand, 'truck', 0x4a4f36);
      decal(c, 'decalSkid', -48, -3.5, 3, 6);
    },
    siren(c) {
      c.p.box(0x6a6e6a, -22, 0, 4, 0.2, 6, 0.2, 'metal', true);
      horn(c, -22, 6.1, 4, 0, LIFE.siren);
      beacon(c, -22, 6.6, 4, 1.2, 6, 0);
    },
    radar(c) {
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) c.p.box(0x6a6e6a, 12 + dx, 0, 30 + dz, 0.15, 8, 0.15, 'metal', true);
      for (let y = 1.5; y < 8; y += 2) {
        c.p.box(0x6a6e6a, 12, y, 29, 2.1, 0.08, 0.08, 'metal');
        c.p.box(0x6a6e6a, 12, y, 31, 2.1, 0.08, 0.08, 'metal');
      }
      c.p.box(0x5a5e5a, 12, 8, 30, 2.6, 0.15, 2.6, 'metal');
      c.p.cyl(0x4a4e4a, 12, 8.4, 30, 0.2, 0.5, 'metal');
      c.p.life(LIFE.spin, 12, 8.7, 30, 3.2, 0, spotHash(c.S.s.i, c.S.s.j, 35), 0);
      beacon(c, 12, 10.2, 30, 0.6, 5, 0, false);
    },
    flags(_c) {},
  },

  // ── Lab (building x −20…20 z −22…8, door (0, 8); yard to the lot's edge, gate (0, LOT)) ─────────────
  lab: {
    glassBroken(c) {
      for (const cx of labBrokenCells(c.S.s)) {
        decal(c, 'decalShards', cx - 2.6, -15.2, 3.5, 1.5, 0.04);
        decal(c, 'decalShards', cx - 2.6, -17, 3, 1.4, 0.04);
      }
    },
    shower(c) {
      // The decontamination shower by the entrance, still running.
      const x = 8;
      const z = 11.5;
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) c.p.box(0xb8bcc0, x + dx, 0, z + dz, 0.08, 2.6, 0.08, 'metal', true);
      c.p.box(0xb8bcc0, x, 2.6, z, 2.1, 0.08, 2.1, 'metal');
      c.p.box(0x9aa8a8, x, 0.03, z, 1.9, 0.05, 1.9, 'metal');
      c.p.rbox(0xc8d0d0, x - 1, 1.5, z, 0.02, 1.9, 1.9, 0, 0, 0, 'rubber');
      c.p.cyl(0x8a8e92, x, 2.45, z, 0.2, 0.1, 'metal');
      for (let k = 0; k < 4; k++) {
        const [wx, wz] = c.p.pt(x + (c.rand() - 0.5) * 0.4, z + (c.rand() - 0.5) * 0.4);
        c.b.life(LIFE.drip, wx, 2.4, wz, 0, 0, 0, 2.35, spotHash(wx, wz, 73));
      }
      c.p.life(LIFE.steam, x, 2.3, z, 1, 0, spotHash(c.S.s.i, c.S.s.j, 36));
      decal(c, 'decalOil', x, z + 1.8, 2.6, 1.8);
    },
    burnBarrel(c) {
      barrel(c, -17, 11.5);
    },
    biotape(c) {
      // Across the door (an X), across the gate on posts, round the yard.
      const D = c.p.at(0, 8.14, 0);
      tape(D, -1.3, 1.3, 1.25, 0.6);
      tape(D, -1.3, 1.3, 1.25, -0.6);
      for (const [x0, x1, z] of [
        [-4.2, 4.2, LOT - 1.6],
        [-16, -8, 12],
      ] as const) {
        for (const x of [x0, x1]) c.p.box(0xd86a20, x, 0, z, 0.08, 1.1, 0.08, 'metal');
        tape(c.p.at(0, z, 0), x0, x1, 0.95, 0.02);
      }
    },
    quarantine(c) {
      const [ax, az] = c.p.pt(16, 21);
      if (c.b.inClip(ax, az)) tent(c.b, ax, az, yawW(c, 0), c.rand, 0xb0aca0);
      const [bx, bz] = c.p.pt(-16, 21.5);
      if (c.b.inClip(bx, bz)) tent(c.b, bx, bz, yawW(c, 0), c.rand, 0xb0aca0);
      for (let k = 0; k < 3; k++) barrel(c, 11 + k * 0.7, 23.6);
    },
  },
};

const FH_MALL = 5;

/** A scenario has its template (the test checks every pool entry). */
export function hasTemplate(kind: PoiKind, id: string): boolean {
  return !!TEMPLATES[kind]?.[id];
}
