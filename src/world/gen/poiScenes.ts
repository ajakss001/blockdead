import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { mulberry32 } from '../../core/random';
import type { ItemId } from '../../data/items';
import type { Surface } from '../../render/look/surfaces';
import { type ModelInfo, pickModel } from '../models';
import { CAR_PAINTS, modelLibrary, placeModel } from '../props/car';
import { body, type Dress, fireTruck, jersey, sandbags, stripedBarrier, tent } from './chaos';
import { char, charTint } from './charred';
import * as F from './furniture';
import { Place } from './furniture';
import { groundDecal } from './highrise';
import { LIFE, spotHash } from './lifeKinds';
import { hash3 } from './noise';
import { type Builder, pick, type Rand } from './pieces';
import { aircraft, airliner, lightPlane } from './poiBig';
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
  if (o.collide !== false) c.b.colliders.addOrientedBox(x, z, m.size[0] / 2, m.size[2] / 2, wyaw, -0.5, top + 0.3);
  return m;
}

/** A body at a local point: under a sheet or in a bag, always. */
function corpse(c: Ctx, lx: number, lz: number, yaw: number, dress: Dress): void {
  const [x, z] = c.p.pt(lx, lz);
  body(c.b, x, z, yawW(c, yaw), c.rand, dress, 'covered');
}

/** A sub-place turned by a free yaw (and tipped). */
const at = (c: Ctx, lx: number, lz: number, yaw = 0, pitch = 0, roll = 0, lift = 0, y = 0): Place => {
  const [x, z] = c.p.pt(lx, lz);
  return new Place(c.b, x, c.p.y + y, z, c.p.r).tipped(yaw, pitch, roll, lift);
};

/** A panel (a door, a flap) hinged at (hx, hz) of a place, swung out along (dx, dz). */
function panel(q: Place, color: number, hx: number, hz: number, dx: number, dz: number, len: number, cy: number, h: number, surface: Surface = 'carPaint'): void {
  const n = Math.hypot(dx, dz);
  q.rbox(color, hx + (dx / n) * len * 0.5, cy, hz + (dz / n) * len * 0.5, len, h, 0.05, Math.atan2(-dz, dx), 0, 0, surface);
}

/** A searchable stash of the survivors (crates and a tarp), maybe with a note in it. */
function stash(c: Ctx, lx: number, lz: number, note?: ItemId, y = 0): void {
  const q = c.p.at(lx, lz);
  q.box(0x5a4e3a, 0, y, 0, 0.9, 0.5, 0.6, 'wood');
  q.box(0x4e5a44, 0.05, y + 0.5, 0, 0.7, 0.35, 0.5, 'wood');
  q.rbox(0x3a4a5a, 0, y + 0.88, 0, 1.0, 0.03, 0.75, 0.2, 0, 0.05, 'rubber');
  c.S.container('campStash', lx, lz, note ? [note] : undefined, y);
}

/** A folding camp bed along local yaw, a blanket on it. */
function cot(c: Ctx, lx: number, lz: number, yaw: number, y = 0): void {
  const q = at(c, lx, lz, yaw, 0, 0, 0, y);
  q.box(0x4a4e3e, 0, 0.36, 0, 1.9, 0.05, 0.7, 'rubber');
  for (const sx of [-0.85, 0.85]) for (const sz of [-0.3, 0.3]) q.box(0x6a6a62, sx, 0, sz, 0.04, 0.36, 0.04, 'metal');
  q.rbox(pick(c.rand, [0x6a3a2a, 0x3a4a6a, 0x5a5a4a, 0x7a6a4a]), -0.2 + c.rand() * 0.3, 0.44, 0, 1.0, 0.06, 0.74, c.rand() * 0.3 - 0.15, 0, 0, 'rubber');
  c.S.solid(lx, lz, 1.2, 1.2, y, y + 0.45);
}

/** A small dome tent (survivors' camp), the flap toward local yaw. */
function domeTent(c: Ctx, lx: number, lz: number, yaw: number, color: number): void {
  const q = at(c, lx, lz, yaw);
  q.rbox(color, 0, 0.62, -0.55, 2.2, 0.05, 1.35, 0, 0.9, 0, 'rubber');
  q.rbox(color, 0, 0.62, 0.55, 2.2, 0.05, 1.35, 0, -0.9, 0, 'rubber');
  q.box(color, -1.08, 0, 0, 0.04, 1.15, 1.8, 'rubber');
  q.rbox(color, 1.2, 0.55, 0.45, 0.04, 1.1, 0.9, 0.7, 0, 0, 'rubber');
  q.box(0x2a2c2a, 0.3, 0.01, 0, 1.6, 0.05, 1.5, 'rubber');
  c.p.solid(lx, lz, 1.8, 1.8, 1.2);
}

/** A trestle table with water bottles and cans on it. */
function waterTable(c: Ctx, lx: number, lz: number, yaw: number): void {
  const q = at(c, lx, lz, yaw);
  q.box(0xb8b4a8, 0, 0.72, 0, 1.8, 0.04, 0.75, 'plaster');
  for (const sx of [-0.8, 0.8]) q.box(0x5a5a5a, sx, 0, 0, 0.05, 0.72, 0.6, 'metal');
  for (let k = 0; k < 8; k++) q.cyl(k % 3 ? 0x4a7aa8 : 0x6a9ac8, -0.75 + (k % 4) * 0.3 + c.rand() * 0.05, 0.91, -0.15 + Math.floor(k / 4) * 0.3, 0.045, 0.3, 'glass');
  for (let k = 0; k < 3; k++) q.cyl(0x8a8a86, 0.55 + k * 0.12, 0.815, 0.2 - k * 0.18, 0.04, 0.1, 'metal');
  c.p.solid(lx, lz, 1.6, 1.6, 0.8);
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

/** Debris: n bits of a colour over a local rectangle. */
function debris(c: Ctx, colors: number[], x0: number, z0: number, x1: number, z1: number, n: number, surface: Surface = 'metal', y = 0): void {
  for (let k = 0; k < n; k++) {
    const q = at(c, x0 + c.rand() * (x1 - x0), z0 + c.rand() * (z1 - z0), c.rand() * 6, 0, c.rand() * 0.3, 0, y);
    q.box(pick(c.rand, colors), 0, 0.01, 0, 0.15 + c.rand() * 0.9, 0.04 + c.rand() * 0.08, 0.1 + c.rand() * 0.5, surface);
  }
}

/** Papers strewn on a floor. */
function strewn(c: Ctx, x0: number, z0: number, x1: number, z1: number, n: number, y = 0.04, dark = false): void {
  for (let k = 0; k < n; k++) c.p.sheet(dark ? pick(c.rand, [0x2a2622, 0x4a4238, 0x8a7a5a]) : pick(c.rand, [0xd8d4c8, 0xe0dcc8, 0xc8c4b0]), x0 + c.rand() * (x1 - x0), y + k * 0.0004, z0 + c.rand() * (z1 - z0), 0.21, 0.3, c.rand() * 6);
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

/** Barrel standing at a point. */
function barrel(c: Ctx, lx: number, lz: number, color: number, y = 0): void {
  c.p.cyl(color, lx, y + 0.45, lz, 0.3, 0.9, 'metal');
  c.p.cyl(char(color, 0.4), lx, y + 0.9, lz, 0.31, 0.04, 'metal');
  c.p.solid(lx, lz, 0.6, 0.6, 0.9);
}

/** A mannequin (pale, faceless): standing on its stand, or knocked over. */
function mannequin(c: Ctx, lx: number, lz: number, yaw: number, fallen: boolean, y = 0): void {
  const skin = pick(c.rand, [0xd8d4cc, 0xc8c4bc, 0xe0dcd4]);
  const q = fallen ? at(c, lx, lz, yaw, 0, Math.PI / 2 - 0.05, 0.25, y) : at(c, lx, lz, yaw, 0, 0, 0, y);
  const top = pick(c.rand, [0x6a2a2a, 0x2a3a5a, 0x5a5a5a, 0xc8c0b0, 0x3a4a3a, skin]);
  if (!fallen) q.cyl(0x3a3a3a, 0, 0.02, 0, 0.22, 0.04, 'metal');
  q.box(0x6a6a6a, 0, 0.04, 0, 0.04, 0.12, 0.04, 'metal');
  for (const s of [-0.1, 0.1]) q.box(skin, s, 0.12, 0, 0.11, 0.82, 0.12, 'plaster');
  q.box(top, 0, 0.94, 0, 0.4, 0.62, 0.22, 'rubber');
  for (const s of [-1, 1]) q.rbox(top === skin ? skin : top, s * 0.25, 1.22, 0.02, 0.09, 0.6, 0.1, 0, 0.1, s * 0.12, 'rubber');
  q.box(skin, 0, 1.56, 0, 0.08, 0.1, 0.08, 'plaster');
  q.blob(skin, 0, 1.74, 0, 0.11, 0.14, 0.12, 'plaster');
  if (!fallen) c.S.solid(lx, lz, 0.45, 0.45, y, y + 1.8);
}

/** A tanker truck (placeholder): cab and a long tank, on its side if asked; local Z is its length. */
function tanker(c: Ctx, lx: number, lz: number, yaw: number, over: boolean, burnt: boolean): void {
  const q = over ? at(c, lx, lz, yaw, 0, 1.5, 1.25) : at(c, lx, lz, yaw);
  const k = burnt ? 0.85 : 0;
  const body = char(0xd8d4c8, k);
  q.box(char(0x2a2a2a, k), 0, 0.5, 0, 2.2, 0.3, 9.6, 'metal');
  q.box(char(0xb8a030, k), 0, 0.8, 3.6, 2.4, 2.0, 2.2, 'carPaint');
  q.box(0x14181a, 0, 1.9, 4.71, 2.1, 0.7, 0.02, 'carGlass');
  q.cyl(body, 0, 1.95, -1.2, 1.15, 6.6, 'metal', Math.PI / 2);
  q.box(char(0xa03a2a, k), 0, 1.0, -1.2, 2.32, 0.18, 6.6, 'metal');
  for (const z of [3.6, -0.4, -2.8]) for (const s of [-1, 1]) q.cyl(0x1a1a1a, s * 1.05, 0.5, z, 0.5, 0.35, 'rubber', Math.PI / 2);
  const [x, z] = c.p.pt(lx, lz);
  if (c.b.inClip(x, z)) c.b.colliders.addOrientedBox(x, z, over ? 1.4 : 1.2, 4.8, yawW(c, yaw), -0.5, 2.6);
}

/** A baggage tug pulling a train of carts, suitcases on them; local +X ahead. */
function baggageTrain(c: Ctx, lx: number, lz: number, yaw: number, n: number): void {
  const q = at(c, lx, lz, yaw);
  q.box(0xc8a030, 0, 0.3, 0, 2.2, 0.7, 1.2, 'carPaint');
  q.box(0x2a2c2e, -0.5, 1.0, 0, 0.5, 0.5, 0.5, 'rubber');
  q.box(0x5a5a5a, 0.3, 1.0, 0, 0.05, 0.9, 1.1, 'metal');
  for (const sx of [-0.7, 0.7]) for (const sz of [-0.55, 0.55]) q.cyl(0x1a1a1a, sx, 0.25, sz, 0.25, 0.2, 'rubber', Math.PI / 2);
  for (let k = 0; k < n; k++) {
    const x = -2.6 - k * 2.9;
    const turn = (c.rand() - 0.5) * 0.25 * (k + 1);
    const cq = q;
    cq.rbox(0x6a6e72, x, 0.48, 0, 2.4, 0.06, 1.3, turn, 0, 0, 'metal');
    for (const s of [-1, 1]) cq.rbox(0x5a5e62, x, 0.75, s * 0.62, 2.4, 0.5, 0.04, turn, 0, 0, 'metal');
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.55, 0.55]) cq.cyl(0x1a1a1a, x + sx, 0.2, sz, 0.2, 0.15, 'rubber', Math.PI / 2);
    for (let b = 0; b < 3; b++) if (c.rand() < 0.7) cq.rbox(pick(c.rand, [0x2a3440, 0x5a2a2a, 0x3a3a34, 0x6a5a3a, 0x2a4a3a]), x - 0.8 + b * 0.8, 0.72, (c.rand() - 0.5) * 0.4, 0.7, 0.45, 0.5, turn + (c.rand() - 0.5) * 0.4, 0, 0, 'rubber');
  }
  const [x, z] = c.p.pt(lx, lz);
  if (c.b.inClip(x, z)) c.b.colliders.addOrientedBox(x, z, 1.2, 0.7, yawW(c, yaw), -0.5, 1.4);
}

/** An inflatable escape slide from a door sill (local hx, sill y, hz) down to the ground along +X (s = −1: −X). */
function slide(c: Ctx, hx: number, sill: number, hz: number, s: 1 | -1): void {
  const run = sill * 1.75;
  const len = Math.hypot(run, sill);
  const a = Math.atan2(sill, run);
  const cx = hx + (s * run) / 2;
  const yel = 0xd8b030;
  c.p.rbox(yel, cx, sill / 2 + 0.15, hz, len, 0.3, 1.5, 0, 0, -s * a, 'rubber');
  for (const sz of [-0.75, 0.75]) c.p.rbox(0xc8a028, cx, sill / 2 + 0.42, hz + sz, len, 0.35, 0.3, 0, 0, -s * a, 'rubber');
  c.p.rbox(yel, hx + s * (run + 0.8), 0.2, hz, 1.8, 0.4, 1.9, 0, 0, 0, 'rubber');
  c.p.solid(hx + s * (run + 0.8), hz, 1.8, 1.9, 0.4);
}

/** A helicopter on its back, its rotor snapped off (the blades flung away); model if installed. */
function heliWreck(c: Ctx, lx: number, lz: number, yaw: number, burnt: boolean, roll = Math.PI): void {
  const m = mdl(c, 'heliMil', lx, lz, yaw, { roll, lift: roll === Math.PI ? 'flip' : 0.9, flipK: 0.78, charred: burnt }) ?? mdl(c, 'heli', lx, lz, yaw, { roll, lift: roll === Math.PI ? 'flip' : 0.9, flipK: 0.78, charred: burnt });
  if (!m) {
    const q = at(c, lx, lz, yaw, 0, roll, roll === Math.PI ? 2.2 : 1.3);
    const k = burnt ? 0.85 : 0;
    q.box(char(0x4e5438, k), 0, -1.0, 0, 5.0, 2.0, 2.2, 'carPaint');
    q.box(0x14181a, 2.5, -0.4, 0, 0.05, 1.1, 1.9, 'carGlass');
    q.box(char(0x4e5438, k), -5.2, -0.3, 0, 6.0, 0.5, 0.5, 'carPaint');
    const [x, z] = c.p.pt(lx, lz);
    if (c.b.inClip(x, z)) c.b.colliders.addOrientedBox(x, z, 3, 1.3, yawW(c, yaw), -0.5, 2.6);
  }
  // The rotor blades: one stuck in the ground, two thrown off.
  for (let k = 0; k < 3; k++) {
    const d = 6 + c.rand() * 6;
    const a = c.rand() * 6.28;
    const q = at(c, lx + Math.cos(a) * d, lz + Math.sin(a) * d, c.rand() * 6, 0, k === 0 ? 0.35 : 0.03, 0);
    q.box(char(0x2a2a2a, burnt ? 0.6 : 0), 0, 0.02, 0, 5 + c.rand() * 2, 0.06, 0.4, 'metal');
  }
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
      debris(c, [0x4e5438, 0x2a2a2a, 0x5a5e60], 18, 16, 34, 30, 10);
      corpse(c, 21, 27, 1.2, 'military');
    },
    linerFire(c) {
      const q = c.p.at(-50, -38, 1).tipped(0, 0, 0.05);
      if (!aircraft(c.S, 'airliner', q, c.rand, c.state === 'burnt')) airliner(c.S, q, char(0x8a2a2a, c.state === 'burnt' ? 0.85 : 0.3));
      // The gear gave way: one wing on the runway, debris and soot along it.
      for (const [x, z, s] of [
        [-50, -38, 12],
        [-45, -44, 7],
        [-56, -32, 7],
        [-38, -40, 6],
      ] as const) decal(c, 'decalSoot', x, z, s, 1.4);
      debris(c, [0x8a8e92, 0x3a3c3e, 0xd8d8d2], -66, -48, -32, -28, 16);
      // The foam the fire crew got down before it beat them.
      marks(c, 'decalFoam', -40, -34, 6, 4, 5);
      corpse(c, -40, -27, 0.4, 'fire');
      corpse(c, -42, -26, 0.2, 'civilian');
    },
    terminalCrash(c) {
      const q = c.p.at(-38, 4.3, 0).tipped(0.12, 0.3, 0.14, 0.55);
      if (!aircraft(c.S, 'lightplane', q, c.rand, !!c.state)) lightPlane(c.S, q, char(0xb8b0a0, c.state ? 0.85 : 0));
      // The facade broken round it, the hall full of glass and bits.
      for (const x of [-41, -35]) c.p.at(x, 7.88, 2).poster(0xffffff, 0, 3.2, 1.4, 5, 0, 'decalSoot');
      decal(c, 'decalShards', -38, 10, 5, 1.6, 0.04);
      decal(c, 'decalShards', -38, 6, 4, 1.4);
      debris(c, [0x8a8e92, 0xb8b0a0, 0x3a3c3e, 0x5a6a74], -44, 8.5, -32, 14, 14, 'metal', 0.04);
      for (let k = 0; k < 4; k++) c.p.rbox(0x5a6a74, -41 + k * 2, 0.08, 9 + c.rand() * 3, 1.2, 0.03, 0.8, c.rand() * 6, 0, 0, 'windowGlass');
    },
    slides(c) {
      // The gate airliner (nose +Z at x −28): both front doors and one rear door out.
      slide(c, -30.1, 3.2, 2.5, -1);
      slide(c, -25.9, 3.2, 2.5, 1);
      slide(c, -25.9, 3.4, -21, 1);
      luggage(c, -38, -2, -20, 6, 9);
      corpse(c, -20, 4, 0.3, 'civilian');
    },
    luggage(c) {
      luggage(c, -20, -46, 20, -30, 12);
      luggage(c, 0, -12, 38, 4, 12);
      baggageTrain(c, 8, -7, 0.3, 3);
      baggageTrain(c, 30, 1, -0.5, 2);
      for (let k = 0; k < 2; k++) c.p.rbox(0x6a6e72, 15 + k * 9, 0.6, -2 + k * 5, 2.4, 0.06, 1.3, c.rand() * 6, 0, Math.PI / 2 - 0.2, 'metal');
    },
    fuelTruck(c) {
      tanker(c, 20, -6, 0.5, true, !!c.state);
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
      for (let k = 0; k < 5; k++) c.p.rbox(0x8a7a5a, 38 + k * 1.6, 0.04, -30 - k * 1.1, 1.8, 0.08, 0.08, 0.6 + (c.rand() - 0.5) * 0.6, 0, 0, 'rubber');
      corpse(c, 46, -27, 2.1, 'fire');
      for (let k = 0; k < 6; k++) c.p.cone(0xd86a20, 30 + k * 4, 0.35, -26 + (k % 2) * 2, 0.22, 0.7, 'lamp');
    },
    camp(c) {
      // The evacuation camp in the terminal's east end: cots, tents, water, the stash and the notes.
      for (let k = 0; k < 6; k++) cot(c, -22.5 + k * 2.2, 28, Math.PI / 2 + (c.rand() - 0.5) * 0.2);
      domeTent(c, -21, 23, 0.3, 0x3a5a7a);
      domeTent(c, -11, 23.5, 2.8, 0x6a4a2a);
      waterTable(c, -16, 23, 0);
      stash(c, -9.6, 28.6, 'campNote1');
      stash(c, -18, 21.6, 'campNote3');
      lantern(c, -16, 0.76, 23.3);
      lantern(c, -12, 0.04, 26.5);
      sign(c, c.p.at(-14, 29.88, 2), 'decalEvacuate', 0, 1.7, 1.3);
      strewn(c, -24, 21.5, -9, 29.5, 10);
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
      // The crew came out with the passengers: a galley cart, a pilot's case, a sheet by the stairs.
      const q = at(c, -32, 0, 0.4);
      q.box(0xb8bcc0, 0, 0.05, 0, 0.4, 1.0, 0.8, 'metal');
      F.suitcase(at(c, -31, 2, 1.2), c.rand, true);
      corpse(c, -34, -1, 2.0, 'civilian');
    },
  },

  // ── Gas station (canopy z 7…17, pumps x ±3.5; shop x −14…2 z −14…−2; workshop x 6…18) ─────────────
  gas: {
    pumpsBlown(c) {
      debris(c, [char(0xd8d4c8), char(0xa03a2a), 0x2a2a2a], -9, 6, 9, 19, 18);
      for (const [x, z] of [
        [-3.5, 12],
        [3.5, 12],
      ] as const) decal(c, 'decalSoot', x, z, 6, 1.5);
      decal(c, 'decalShards', -9.5, -1, 4, 1.4);
    },
    canopyDown(c) {
      debris(c, [char(0xe0dcd0), char(0xa03a2a)], 2, 6, 10, 18, 10);
      decal(c, 'decalSoot', 4, 12, 7, 1.3);
    },
    burntCars(c) {
      for (const [x, z, yaw] of [
        [-14, 10, 0.3],
        [-18, 15, 1.8],
        [13, 5, -0.4],
      ] as const) {
        if (!mdl(c, 'wreck', x, z, yaw, { charred: true })) {
          const q = at(c, x, z, yaw);
          q.box(char(0x5a4a3a, 0.9), 0, 0.35, 0, 4.4, 0.75, 1.8, 'metal');
          q.box(char(0x5a4a3a, 0.9), -0.2, 1.1, 0, 2.2, 0.5, 1.6, 'metal');
          const [wx, wz] = c.p.pt(x, z);
          if (c.b.inClip(wx, wz)) c.b.colliders.addOrientedBox(wx, wz, 2.2, 0.9, yawW(c, yaw), -0.5, 1.6);
        }
        decal(c, 'decalOil', x, z, 3, 1.4);
      }
    },
    queue(c) {
      // A queue for fuel from the road to the pumps: doors open, people gone.
      for (let k = 0; k < 4; k++) {
        const x = -22 + k * 5.8;
        const yaw = (c.rand() - 0.5) * 0.12;
        const paint = pick(c.rand, Object.values(CAR_PAINTS));
        c.S.car(x, 20, yaw, c.rand, 'car', paint);
        const q = at(c, x, 20, yaw);
        if (c.rand() < 0.8) panel(q, paint, 0.85, 0.92, -Math.cos(1.0), Math.sin(1.0), 1.1, 0.85, 0.9);
        if (c.rand() < 0.4) panel(q, paint, 0.85, -0.92, -Math.cos(1.1), -Math.sin(1.1), 1.1, 0.85, 0.9);
        if (c.rand() < 0.5) F.suitcase(at(c, x + 1.2, 21.8, c.rand() * 6), c.rand, true);
      }
      strewn(c, -24, 18, 0, 24, 6, 0.035);
    },
    looted(c) {
      for (const [x, z] of [
        [-9.5, -1.2],
        [-9.5, -2.8],
      ] as const) decal(c, 'decalShards', x, z, 3, 1.6, z < -2 ? 0.04 : 0);
      for (let k = 0; k < 5; k++) decal(c, 'decalLitter', -13 + c.rand() * 14, -13 + c.rand() * 10, 2.2, 1, 0.04);
      debris(c, [0x9a8462, 0x7a6a50, 0xa03a2a, 0x3a6a9a], -13.5, -13.5, 1.5, -2.5, 16, 'wood', 0.04);
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
      // Survivors held the shop: the windows boarded, a barricade by the door, beds and the stash inside.
      for (const [x, w] of [
        [-9.5, 5],
        [-0.8, 3],
      ] as const) for (let k = 0; k < 4; k++) c.p.rbox(pick(c.rand, [0x8a6a44, 0x7a5a3a, 0x6a5a40]), x, 0.9 + k * 0.5, -1.75, w + 0.4, 0.22, 0.04, 0, 0, (c.rand() - 0.5) * 0.15, 'wood');
      F.barricade(c.p.at(-6.2, -1.2, 0), c.rand);
      for (let k = 0; k < 3; k++) c.p.box(pick(c.rand, [0x6a5a4a, 0x4a5a6a, 0x5a4a5a]), -2 + k * 1.1, 0.04, -10.5, 0.9, 0.15, 1.9, 'rubber');
      stash(c, 0.9, -13.2, 'campNote2', 0.04);
      stash(c, -13, -4.4, 'campNote4', 0.04);
      lantern(c, -0.9, 0.04, -12.8);
      waterTable(c, -2.5, -7.4, 0);
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
      for (const x of [-18, -12, 8]) for (let k = 0; k < 3; k++) c.p.rbox(pick(c.rand, [0x8a6a44, 0x7a5a3a]), x, 1.2 + k * 0.5, 6.15, 3.4, 0.22, 0.04, 0, 0, (c.rand() - 0.5) * 0.2, 'wood');
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
      const q = at(c, 2, 15, yaw);
      panel(q, 0x1e2632, -2.5, 0.95, -0.55, 0.84, 0.95, 1.1, 1.5);
      panel(q, 0x1e2632, -2.5, -0.95, -0.55, -0.84, 0.95, 1.1, 1.5);
      panel(q, 0x1e2632, 1.0, 0.95, -0.4, 0.9, 1.0, 0.9, 1.0);
      corpse(c, -1.5, 17.5, 0.6, 'swat');
      at(c, -0.5, 16.5, 0.8, 0, Math.PI / 2 - 0.05).box(0x2a3038, 0, 0.0, 0, 0.6, 1.0, 0.06, 'metal');
      for (let k = 0; k < 3; k++) c.p.cone(0xd86a20, -3 + k * 2.2, 0.35, 18.5, 0.22, 0.7, 'lamp');
    },
    sandbags(c) {
      sandbags(c.p, -18, 12, 3.2, c.rand);
      sandbags(c.p.at(-19.8, 13.4, 1), 0, 0, 2.4, c.rand);
      sandbags(c.p, 21, 10, 3.0, c.rand);
      sandbags(c.p.at(22.8, 11.4, 3), 0, 0, 2.4, c.rand);
    },
    cells(c) {
      corpse(c, -13.5, -15, 0.2, 'civilian');
      c.p.rbox(0x7a7a6a, -20, 0.3, -12, 1.9, 0.1, 0.75, 0.6, 0, 0.5, 'rubber');
      strewn(c, -24, -20, -8, -6, 8);
      for (let k = 0; k < 3; k++) decal(c, 'decalLitter', -22 + k * 5.3, -13, 2, 1, 0.04);
    },
    lastStand(c) {
      // Their last line in the corridor, desks and cabinets on their sides; the way round it left open.
      at(c, 3.2, -3.1, Math.PI / 2, 0, Math.PI / 2 - 0.05, 0.4).box(0x8a7a64, 0, 0, 0, 1.4, 0.75, 0.75, 'wood');
      at(c, 3.4, -4.3, Math.PI / 2 + 0.2).box(0x6a6e72, 0, 0, 0, 0.5, 1.3, 0.5, 'metal');
      at(c, 2.6, -2.6, 0.4, Math.PI / 2 - 0.1, 0, 0.3).box(0x6a6e72, 0, 0, 0, 0.5, 1.3, 0.5, 'metal');
      c.p.solid(3.2, -3.6, 0.9, 2.8, 1.2);
      at(c, -6, 0, 0.3, 0, Math.PI / 2 - 0.05, 0.4).box(0x8a7a64, 0, 0, 0, 1.4, 0.75, 0.75, 'wood');
      corpse(c, 6, -3.8, 0.1, 'police');
      strewn(c, 2, -6, 11, -2, 8);
      F.notes(c.p.at(9, -2.1, 2), c.rand, 2);
    },
    radio(c) {
      c.p.box(0x2a2c2e, -0.6, 1.15, 0.4, 0.4, 0.22, 0.3, 'metal');
      c.p.box(0x1a1a1a, -0.45, 1.37, 0.45, 0.02, 0.3, 0.02, 'metal');
      c.p.life(LIFE.radio, -0.6, 1.3, 0.4, 1, 0, spotHash(c.S.s.i, c.S.s.j, 21));
      strewn(c, -4, -1, 0, 1.5, 4, 1.16);
    },
    files(c) {
      strewn(c, -24, -2, -8, 6, 22);
      strewn(c, -24, -6, 12, -2, 10);
      for (let k = 0; k < 4; k++) at(c, -22 + k * 4, 1.5 + c.rand() * 2, c.rand() * 6).box(0xb8a070, 0, 0.04, 0, 0.35, 0.08, 0.25, 'plaster');
      F.notes(c.p.at(-14, -1.89, 0), c.rand, 3);
      F.notes(c.p.at(-20, -1.89, 0), c.rand, 2);
    },
  },

  // ── Hypermarket (x ±24 z −24…12, doors (±8, 12); gondolas z −12…0.5; checkouts z 8) ─────────────
  hyper: {
    cartWall(c) {
      for (let k = 0; k < 10; k++) cart(c.p, -11.2 + (k % 5) * 1.0 + c.rand() * 0.2, 12.8 + Math.floor(k / 5) * 0.95, Math.PI / 2 + (c.rand() - 0.5) * 0.5, k > 6 && c.rand() < 0.6);
      for (let k = 0; k < 3; k++) cart(c.p, -10.5 + k * 1.2, 13.3, (c.rand() - 0.5) * 0.6, true);
      c.p.solid(-8, 13.3, 5.5, 2.2, 1.1);
      for (let k = 0; k < 6; k++) cart(c.p, 18 - c.rand() * 6, 14 + c.rand() * 3, c.rand() * 6, true);
    },
    emptyShelves(c) {
      for (let k = 0; k < 7; k++) decal(c, 'decalLitter', -20 + c.rand() * 40, -11 + c.rand() * 16, 2.4, 1, 0.04);
      debris(c, [0x9a8462, 0x7a6a50, 0xd8d4c8, 0x8a2a20, 0x3a6a9a, 0xc8a030], -21, -11.5, 21, 6, 40, 'wood', 0.04);
      strewn(c, -20, -11, 20, 6, 12);
    },
    fallen(c) {
      for (const [x, z] of [
        [-4, -20.5],
        [10, -20],
      ] as const) {
        c.p.box(0x8a6a44, x, 0.04, z, 1.2, 0.14, 1.0, 'wood');
        for (let k = 0; k < 5; k++) at(c, x + (c.rand() - 0.5) * 3, z + (c.rand() - 0.5) * 2.5, c.rand() * 6, 0, c.rand() < 0.5 ? 0.25 : 0, 0, 0.04).box(pick(c.rand, [0x9a8462, 0x7a6a50]), 0, 0, 0, 1.1, 0.4, 0.9, 'wood');
      }
      // A display case knocked over by the checkouts, its glass all over the floor.
      const q = at(c, -14, 5, 0.3, 0, Math.PI / 2 - 0.04, 0.4, 0.04);
      q.box(0x8a8c8e, 0, 0, 0, 1.6, 0.8, 0.8, 'metal');
      q.box(0x6a7a84, 0, 0.8, 0, 1.55, 0.04, 0.75, 'windowGlass');
      decal(c, 'decalShards', -14, 5.5, 3.5, 1.4, 0.04);
    },
    carCrash(c) {
      // A car through the east entrance, half inside.
      const burnt = !!c.state;
      if (!(burnt && mdl(c, 'wreck', 8, 11.6, -Math.PI / 2, { charred: true }))) c.S.car(8, 11.6, -Math.PI / 2, c.rand, burnt ? 'wreck' : 'car');
      decal(c, 'decalShards', 8, 10.5, 4, 1.6, 0.04);
      decal(c, 'decalShards', 8, 15.5, 4, 1.6);
      debris(c, [0x9a948a, 0x8a8c8e, 0x6a7a84], 5, 9, 11, 16, 12);
      c.p.rbox(0x8a8c8e, 9.8, 1.5, 12.3, 0.12, 3.0, 0.12, 0, 0, 0.35, 'metal');
      cart(c.p, 5.5, 10, 0.8, true);
    },
    camp(c) {
      // Tents between the rows, cots in the front aisle; water, a stove, the stash.
      domeTent(c, -17.05, -2.5, Math.PI / 2, 0x3a5a7a);
      domeTent(c, -12.15, -3.2, -Math.PI / 2, 0x6a4a2a);
      cot(c, -7.25, -2.5, Math.PI / 2);
      cot(c, -7.25, -9.5, Math.PI / 2);
      for (let k = 0; k < 3; k++) cot(c, -20 + k * 2.2, 4.5, Math.PI / 2);
      waterTable(c, -11, 3.5, 0);
      stash(c, -17.05, 0.2, 'campNote1', 0.04);
      stash(c, -12.15, -5.6, 'campNote3', 0.04);
      c.p.box(0x3a3a3a, -9, 0.04, 5, 0.5, 0.35, 0.5, 'metal');
      c.p.cyl(0x6a6a66, -9, 0.5, 5, 0.18, 0.2, 'metal');
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
    mannequins(c) {
      for (const zc of [-16.7, -6, 4.7]) {
        for (let k = 0; k < 3; k++) mannequin(c, -13.6 - c.rand() * 2.5, zc - 1.6 + k * 1.6, Math.PI / 2 + (c.rand() - 0.5) * 0.8, c.rand() < 0.2, 0.04);
      }
      mannequin(c, -6.5, -8.5, 0.6, false, 0.04);
      mannequin(c, 5.5, -1.5, 2.4, true, 0.04);
      for (let k = 0; k < 3; k++) mannequin(c, -20 + k * 3.5, -14, c.rand() * 6, c.rand() < 0.3, 5);
    },
    fountain(c) {
      const q = c.p.at(-3, -5);
      for (let k = 0; k < 10; k++) q.sheet(pick(c.rand, [0xd8d4c8, 0x8a7a5a, 0x5a5a5a, 0x3a6a9a]), (c.rand() - 0.5) * 3, 0.52 + k * 0.0005, (c.rand() - 0.5) * 3, 0.25 + c.rand() * 0.3, 0.2 + c.rand() * 0.3, c.rand() * 6);
      for (let k = 0; k < 5; k++) at(c, -3 + (c.rand() - 0.5) * 2.4, -5 + (c.rand() - 0.5) * 2.4, c.rand() * 6, 0, c.rand() * 0.4, 0, 0.52).box(pick(c.rand, [0x9a8462, 0x7a6a50, 0x2a2a2a]), 0, 0, 0, 0.3 + c.rand() * 0.3, 0.2 + c.rand() * 0.2, 0.25 + c.rand() * 0.2, 'wood');
      for (let k = 0; k < 6; k++) c.p.cyl(pick(c.rand, [0x3a7a4a, 0x6a9ac8, 0x8a5a2a]), -3 + (c.rand() - 0.5) * 3, 0.56, -5 + (c.rand() - 0.5) * 3, 0.04, 0.12, 'glass', Math.PI / 2);
      strewn(c, -8, -10, 2, 0, 10);
    },
    escalators(c) {
      stripedBarrier(c.p.at(-0.8, -1.75, 1), 0, 0, 3.2, c.rand() < 0.4);
      for (let k = 0; k < 4; k++) at(c, 1 + k * 1.1, -2.6 + (k % 2) * 1.7, c.rand() * 6, 0, 0, 0, 0.3 + k * 0.85).box(pick(c.rand, [0x2a3440, 0x5a2a2a, 0x3a3a34]), 0, 0, 0, 0.4, 0.3, 0.3, 'rubber');
      corpse(c, -2, 0.6, 0.2, 'civilian');
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
      for (let k = 0; k < 7; k++) F.cafeTable(at(c, 11 + c.rand() * 9, -3 + c.rand() * 6, c.rand() * 6, 0, 0, 0, 0.04), c.rand, true);
      for (let k = 0; k < 8; k++) c.p.rbox(pick(c.rand, [0x8a2a20, 0x3a6a3a, 0xc8a030]), 11 + c.rand() * 9, 0.06, -15 + c.rand() * 18, 0.45, 0.02, 0.32, c.rand() * 6, 0, 0, 'plaster');
      at(c, 21.5, -2, -Math.PI / 2, 0, Math.PI / 2 - 0.05, 0.05, 0.04).box(0x2a2a2a, 0, 0, 0, 2.4, 1.0, 0.06, 'plaster');
      decal(c, 'decalShards', 16, -4, 4, 1.4, 0.04);
      for (let k = 0; k < 4; k++) decal(c, 'decalLitter', 11 + c.rand() * 9, -15 + c.rand() * 18, 2.2, 1, 0.04);
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
      debris(c, [0x4a6a8a, 0x3a3a3a], 6, -10, 12, -4, 6);
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
      corpse(c, -11, 14.5, 0.3, 'civilian');
      corpse(c, -13.5, 15.5, 1.9, 'civilian');
      c.p.blob(0xc8a030, -9.5, 0.12, 14.8, 0.16, 0.12, 0.16, 'rubber');
      sign(c, c.p.at(-17.5, 12.11, 0), 'decalEvacuate', 0, 1.6, 1.2);
      c.S.car(-10, 21, 0.2, c.rand, 'van');
      strewn(c, -16, 13, -6, 18, 6, 0.035);
    },
  },

  // ── Checkpoint (road z 32; tents (−14, 6), (−6, 6), (4, −4); tower (12, 20); truck (−14, 20), APC (16, 6)) ──
  checkpoint: {
    burningTank(c) {
      if (!mdl(c, 'tank', -4, -16, 0.4, { charred: true }) && !mdl(c, 'truck', -4, -16, 0.4, { charred: true })) {
        const q = at(c, -4, -16, 0.4);
        q.box(char(0x4a4e38), 0, 0.05, 0, 6.6, 1.3, 3.2, 'metal');
        q.box(char(0x4a4e38), -0.3, 1.35, 0, 3.0, 0.6, 2.0, 'metal');
        const [wx, wz] = c.p.pt(-4, -16);
        if (c.b.inClip(wx, wz)) c.b.colliders.addOrientedBox(wx, wz, 3.3, 1.6, yawW(c, 0.4), -0.5, 2.2);
      }
      debris(c, [char(0x4a4e38), 0x2a2a2a], -12, -22, 4, -10, 12);
      decal(c, 'decalSkid', -10, -12, 3, 4);
    },
    breached(c) {
      // Something heavy came through: the blocks shoved aside, the arm snapped, bags burst.
      for (const [x, z, yaw] of [
        [16, 30.5, 0.6],
        [21, 33.5, -0.4],
        [-0.5, 34.8, 1.2],
      ] as const) {
        at(c, x, z, yaw).box(0x9a968a, 0, 0, 0, 2.2, 0.85, 0.6, 'concrete');
        c.p.solid(x, z, 1.6, 1.6, 0.85);
      }
      at(c, 2.2, 27.8, 0.5, 0, 0.1).box(0xb02a20, 0, 0, 0, 3.4, 0.1, 0.1, 'metal');
      for (let k = 0; k < 8; k++) at(c, 4 + c.rand() * 6, 25 + c.rand() * 4, c.rand() * 6).box(0x8a7a5a, 0, 0, 0, 0.58, 0.2, 0.34, 'rubber');
      decal(c, 'decalSkid', 8, 31, 3, 6);
      decal(c, 'decalSkid', 0, 29, 3, 5);
      c.S.car(24, 30, 0.25, c.rand, 'wreck');
    },
    collapsed(c) {
      for (const [x, z, yaw] of [
        [-18, -12, 0.3],
        [14, -16, -0.5],
      ] as const) {
        const q = at(c, x, z, yaw);
        q.rbox(0x4a4f36, -0.6, 0.35, 0, 4.4, 0.06, 6.2, 0, 0, 0.12, 'rubber');
        q.rbox(0x4a4f36, 1.4, 0.2, 0.3, 2.2, 0.06, 5.8, 0.1, 0, -0.08, 'rubber');
        q.rbox(0x5a4a34, -1.6, 0.9, -2.6, 0.08, 2.2, 0.08, 0, 0.6, 0.3, 'wood');
        for (let k = 0; k < 3; k++) q.box(0x4a5a3a, -1 + k * 1.1, 0, 3.4, 1.0, 0.5, 0.7, 'wood');
        c.p.solid(x, z, 4, 4, 0.5);
      }
      corpse(c, -14, -8, 0.8, 'military');
    },
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
        const q = at(c, -22 + k * 1.4, -1 + (c.rand() - 0.5) * 1.5, (c.rand() - 0.5) * 0.4);
        q.box(0x4a5a3a, 0, 0, 0, 1.6, 0.06, 0.6, 'wood');
        for (const s of [-1, 1]) q.box(0x4a5a3a, 0, 0.06, s * 0.27, 1.6, 0.36, 0.06, 'wood');
        for (const s of [-1, 1]) q.box(0x4a5a3a, s * 0.77, 0.06, 0, 0.06, 0.36, 0.48, 'wood');
        if (c.rand() < 0.6) q.rbox(0x4a5a3a, 0.2, 0.2, 0.7, 1.6, 0.05, 0.6, 0.3, 0, 0, 'wood');
        c.p.solid(-22 + k * 1.4, -1, 1.4, 0.6, 0.4);
      }
      strewn(c, -24, -3, -15, 2, 4, 0.035);
    },
  },

  // ── Military base (lot ±58; hangar x 10…54 z −36…−12; garages x 8…52 z −56…−40; gate road x −4…4 z −6…L) ──
  base: {
    heliHangar(c) {
      heliWreck(c, 32, -21, -Math.PI / 2 + 0.2, !!c.state, 0.4);
      debris(c, [0x4e5438, 0x2a2a2a, 0x5a6a74], 26, -32, 38, -14, 14, 'metal', 0.04);
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
      if (!mdl(c, 'apc', -40, -2, 0.3, { roll: Math.PI, lift: 'flip', flipK: 0.74, charred: burnt })) {
        const q = at(c, -40, -2, 0.3, 0, Math.PI, 2.2);
        q.box(char(0x4e5438, burnt ? 0.85 : 0), 0, 0, 0, 7, 2.2, 2.8, 'metal');
        const [wx, wz] = c.p.pt(-40, -2);
        if (c.b.inClip(wx, wz)) c.b.colliders.addOrientedBox(wx, wz, 3.5, 1.4, yawW(c, 0.3), -0.5, 2.4);
      }
      decal(c, 'decalSkid', -32, -3, 3, 5);
      debris(c, [0x4e5438, 0x2a2a2a], -46, -6, -34, 2, 10);
    },
    breach(c) {
      // A truck came through the west fence (the template leaves the gap); the mesh lies flattened under it.
      if (!mdl(c, 'truck', -54.6, -4, 0.15)) c.S.car(-54.6, -4, 0.15, c.rand, 'truck', 0x4a4f36);
      for (let k = 0; k < 3; k++) c.p.rbox(0x8a8e8a, -57.6 + k * 0.2, 0.05, -6.5 + k * 3, 0.04, 0.1, 3, 0.3 * (k - 1), 0, Math.PI / 2 - 0.1, 'metal');
      c.p.rbox(0x5a5e5a, -57.2, 0.2, -1, 0.1, 0.1, 2.6, 0.5, 0, Math.PI / 2 - 0.2, 'metal');
      decal(c, 'decalSkid', -48, -3.5, 3, 6);
      for (let k = 0; k < 3; k++) corpse(c, -48 + k * 3, 4 + c.rand() * 3, c.rand() * 6, 'military');
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
    flags(c) {
      // What is left of the flag, the strips torn by the wind; and on the gate posts.
      for (let k = 0; k < 4; k++) c.p.rbox(pick(c.rand, [0x4a5a3a, 0x3a4a2e, 0x5a6a44]), -31.4 + k * 0.05, 8.6 - k * 0.22, 0.02 * k, 0.6 + c.rand() * 0.8, 0.18, 0.02, 0, 0, -0.1 - c.rand() * 0.3, 'rubber');
      for (const x of [-6.5, 6.5]) {
        c.p.box(0x6a6e6a, x, 0, 56, 0.12, 4.5, 0.12, 'metal', true);
        for (let k = 0; k < 3; k++) c.p.rbox(pick(c.rand, [0x8a2a20, 0x3a4a6a, 0xc8c4b8]), x + 0.4, 4.2 - k * 0.2, 56, 0.5 + c.rand() * 0.6, 0.16, 0.02, 0, 0, -0.2 - c.rand() * 0.4, 'rubber');
      }
    },
  },

  // ── Lab (building x −20…20 z −22…8, door (0, 8); yard to the lot's edge, gate (0, LOT)) ─────────────
  lab: {
    glassBroken(c) {
      for (const cx of labBrokenCells(c.S.s)) {
        decal(c, 'decalShards', cx - 2.6, -15.2, 3.5, 1.5, 0.04);
        decal(c, 'decalShards', cx - 2.6, -17, 3, 1.4, 0.04);
        for (let k = 0; k < 6; k++) c.p.rbox(0x6a7a84, cx - 4.5 + c.rand() * 4, 0.06, -16.8 + c.rand() * 2.6, 0.2 + c.rand() * 0.5, 0.02, 0.15 + c.rand() * 0.4, c.rand() * 6, 0, 0, 'windowGlass');
      }
      corpse(c, -5.5, -19.5, 0.4, 'medic');
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
      barrel(c, -17, 11.5, 0x3a3e40);
      strewn(c, -19.5, 9.5, -14.5, 13.5, 12, 0.035, true);
      for (let k = 0; k < 3; k++) at(c, -15 + k * 0.7, 12.8, c.rand()).box(0xb8a070, 0, 0, 0, 0.45, 0.3, 0.35, 'plaster');
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
      for (let k = 0; k < 4; k++) corpse(c, -2 + k * 1.1, 21, Math.PI / 2, 'medic');
      for (let k = 0; k < 3; k++) barrel(c, 11 + k * 0.7, 23.6, 0xc8a030);
    },
  },
};

const FH_MALL = 5;

/** A scenario has its template (the test checks every pool entry). */
export function hasTemplate(kind: PoiKind, id: string): boolean {
  return !!TEMPLATES[kind]?.[id];
}
