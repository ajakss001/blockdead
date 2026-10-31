import { BufferGeometry, Color, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';
import { mulberry32 } from '../../core/random';
import { TILE, tileUv } from './atlas';

/** Plant kinds; each comes in a few variants built once at load (never per plant). */
export const SPECIES = ['maple', 'oak', 'elm', 'spruce', 'pine', 'dead', 'bushRound', 'bushSpread', 'hedge'] as const;
export type Species = (typeof SPECIES)[number];
export const VARIANTS: Record<Species, number> = { maple: 4, oak: 4, elm: 4, spruce: 4, pine: 4, dead: 4, bushRound: 3, bushSpread: 3, hedge: 3 };

export interface PlantModel {
  species: Species;
  variant: number;
  geometry: BufferGeometry;
  /** Size of the model at scale 1, m: height and the crown's half-width. */
  height: number;
  radius: number;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _n = new Vector3();
const _t = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Collects a plant's triangles: bark tubes and leaf cards in one geometry (one material, the atlas).
 * Per vertex: the atlas UV, a tint, wind weights (aWind: branch sway, leaf flutter, phase) and, for cards,
 * a random rank (aKeep) — far away the shader drops the cards ranked above the level of detail.
 */
class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  wind: number[] = [];
  keep: number[] = [];
  idx: number[] = [];
  private v = 0;

  private vert(p: Vector3, n: Vector3, u: number, v: number, c: Color, w: [number, number, number], k: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    this.wind.push(...w);
    this.keep.push(k);
    this.v++;
  }

  /** A tapering tube along a polyline (bark), `radial` sides; sway weights per point. */
  tube(pts: Vector3[], radii: number[], radial: number, sway: number[], phase: number, tint: Color): void {
    const [u0, v0, u1, v1] = tileUv(TILE.bark);
    const base = this.v;
    for (let i = 0; i < pts.length; i++) {
      const dir = _t.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
      const side = _a.crossVectors(dir, Math.abs(dir.y) < 0.95 ? UP : _b.set(1, 0, 0)).normalize();
      const fwd = _b.crossVectors(side, dir).normalize();
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        _n.copy(side).multiplyScalar(Math.cos(ang)).addScaledVector(fwd, Math.sin(ang));
        _c.copy(pts[i]).addScaledVector(_n, radii[i]);
        this.vert(_c, _n, u0 + (u1 - u0) * (k / radial), v0 + (v1 - v0) * ((i / (pts.length - 1)) * 0.9 + 0.05), tint, [sway[i], 0, phase], 0);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < radial; k++) {
        const a = base + i * (radial + 1) + k;
        const b = a + radial + 1;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  /**
   * A leaf card: its foot at `at` (where the sprig grows from), reaching along `up` for `h`, `w` wide
   * across `right`; lit with the given normal (spherical from the crown's middle, not the card's own).
   */
  card(at: Vector3, up: Vector3, right: Vector3, w: number, h: number, normal: Vector3, tile: number, sway: number, phase: number, keep: number, tint: Color): void {
    const [u0, v0, u1, v1] = tileUv(tile);
    const base = this.v;
    const r = _a.copy(right).multiplyScalar(w / 2);
    const u = _b.copy(up).multiplyScalar(h);
    const p = _c;
    const ww: [number, number, number] = [sway, 1, phase];
    this.vert(p.copy(at).sub(r), normal, u0, v0, tint, ww, keep);
    this.vert(p.copy(at).add(r), normal, u1, v0, tint, ww, keep);
    this.vert(p.copy(at).add(r).add(u), normal, u1, v1, tint, ww, keep);
    this.vert(p.copy(at).sub(r).add(u), normal, u0, v1, tint, ww, keep);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new Float32BufferAttribute(this.wind, 3));
    g.setAttribute('aKeep', new Float32BufferAttribute(this.keep, 1));
    g.setIndex(this.v > 65535 ? new Uint32BufferAttribute(this.idx, 1) : this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

type Rng = () => number;

/** A bent, tapering branch from `start` along `dir`: points along it (with a little wander). */
function limb(rng: Rng, start: Vector3, dir: Vector3, len: number, segs: number, gnarl: number): Vector3[] {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    d.x += (rng() - 0.5) * gnarl;
    d.z += (rng() - 0.5) * gnarl;
    d.y += (rng() - 0.5) * gnarl * 0.6;
    d.normalize();
    pts.push(pts[i].clone().addScaledVector(d, step));
  }
  return pts;
}

/** Point at t (0..1) along a polyline. */
function along(pts: Vector3[], t: number, out: Vector3): Vector3 {
  const f = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  return out.lerpVectors(pts[i], pts[i + 1], f - i);
}

/** A random unit vector perpendicular to `d`. */
function perp(rng: Rng, d: Vector3, out: Vector3): Vector3 {
  out.crossVectors(d, Math.abs(d.y) < 0.9 ? UP : _t.set(1, 0, 0)).normalize();
  return out.applyAxisAngle(d, rng() * Math.PI * 2);
}

interface Broad {
  trunkH: number;
  trunkR: number;
  crownR: number;
  /** Main branches; side shoots on each. */
  n1: number;
  n2: number;
  /** How steeply the main branches rise (radians above horizontal). */
  rise: number;
  leaf: number;
  leafSize: number;
  leaves: number;
  gnarl: number;
  bark: number;
  leafTint: number;
  dead?: boolean;
  broken?: boolean;
}

/** A broad-leaved tree (maple, oak, elm; or dead, or snapped). */
function broadleaf(rng: Rng, P: Broad): BufferGeometry {
  const m = new Mesher();
  const bark = new Color(P.bark);
  const lean = new Vector3((rng() - 0.5) * 0.15, 1, (rng() - 0.5) * 0.15).normalize();
  const totalH = P.broken ? P.trunkH * (0.7 + rng() * 0.4) : P.trunkH + P.crownR * 0.9;
  const trunk = limb(rng, new Vector3(0, -0.1, 0), lean, totalH, 6, P.gnarl * 0.4);
  const tr = trunk.map((_, i) => P.trunkR * (1 - (i / (trunk.length - 1)) * (P.broken ? 0.35 : 0.75)) * (i === 0 ? 1.25 : 1));
  m.tube(trunk, tr, 7, trunk.map((p) => Math.max(0, p.y / totalH) ** 2 * 0.15), rng() * 6, bark);
  const tips: { at: Vector3; dir: Vector3; level: number }[] = [];
  const n1 = P.broken ? 2 + Math.floor(rng() * 2) : P.n1;
  for (let k = 0; k < n1; k++) {
    const t = P.broken ? 0.55 + rng() * 0.4 : 0.42 + (k / n1) * 0.5 + rng() * 0.06;
    const startY = P.broken ? t * totalH : P.trunkH * 0.75 + t * (totalH - P.trunkH * 0.75) * 0.8;
    const start = along(trunk, Math.min(0.98, startY / totalH), new Vector3());
    const az = k * 2.399 + rng() * 0.4;
    const rise = P.rise * (0.7 + rng() * 0.6) + (startY / totalH) * 0.3;
    const dir = new Vector3(Math.cos(az) * Math.cos(rise), Math.sin(rise), Math.sin(az) * Math.cos(rise));
    const len = P.crownR * (P.broken ? 0.45 : 0.75 + rng() * 0.45) * (1 - t * 0.3);
    const pts = limb(rng, start, dir, len, 3, P.gnarl);
    const r0 = P.trunkR * (0.45 - t * 0.15);
    const ph = rng() * 6;
    m.tube(pts, pts.map((_, i) => r0 * (1 - (i / 3) * 0.7)), 5, pts.map((_, i) => 0.25 + (i / 3) * 0.45), ph, bark);
    tips.push({ at: pts[3], dir: dir.clone(), level: 1 });
    for (let s = 0; s < P.n2; s++) {
      const st = along(pts, 0.35 + rng() * 0.6, new Vector3());
      const d2 = dir.clone().add(perp(rng, dir, new Vector3()).multiplyScalar(0.8)).add(new Vector3(0, 0.25, 0)).normalize();
      const p2 = limb(rng, st, d2, len * (0.35 + rng() * 0.3), 2, P.gnarl);
      m.tube(p2, [r0 * 0.4, r0 * 0.25, r0 * 0.1], 3, [0.6, 0.8, 1], ph + rng(), bark);
      tips.push({ at: p2[2], dir: d2, level: 2 });
      tips.push({ at: p2[1], dir: d2, level: 2 });
    }
  }
  if (P.dead) {
    // Bare: a few twig sprays at the ends.
    for (const tip of tips) if (rng() < 0.5) m.card(tip.at, tip.dir, perp(rng, tip.dir, new Vector3()), 1.1, 1.2, _n.copy(tip.dir), TILE.twigs, 1, rng() * 6, rng(), new Color(1, 1, 1));
    return m.build();
  }
  // Leaf cards round the shoots, lit as one round crown.
  const centre = new Vector3();
  for (const t of tips) centre.add(t.at);
  centre.divideScalar(tips.length);
  const tint = new Color(P.leafTint);
  const per = Math.ceil(P.leaves / tips.length);
  for (const tip of tips) {
    for (let k = 0; k < per; k++) {
      const at = new Vector3(tip.at.x + (rng() - 0.5) * 1.1, tip.at.y + (rng() - 0.4) * 0.9, tip.at.z + (rng() - 0.5) * 1.1);
      const out = new Vector3().subVectors(at, centre);
      const up = out.clone().normalize().multiplyScalar(0.6).add(new Vector3((rng() - 0.5) * 1.4, 0.3 + rng() * 0.8, (rng() - 0.5) * 1.4)).normalize();
      const right = perp(rng, up, new Vector3());
      const normal = out.clone().setY(out.y + P.crownR * 0.35).normalize();
      const s = P.leafSize * (0.8 + rng() * 0.4);
      const c = tint.clone().multiplyScalar(0.85 + rng() * 0.3);
      m.card(at.addScaledVector(up, -s * 0.35), up, right, s, s, normal, P.leaf, 1, rng() * 6, rng(), c);
    }
  }
  return m.build();
}

/** A spruce (dense whorls of drooping fir sprays to the ground) or a pine (bare trunk, tufts on top). */
function conifer(rng: Rng, pine: boolean): BufferGeometry {
  const m = new Mesher();
  const H = pine ? 9 + rng() * 3 : 7 + rng() * 3;
  const R = pine ? 2.2 + rng() * 0.6 : 2.3 + rng() * 0.6;
  const bark = new Color(pine ? 0x8a5a3c : 0x6a5040);
  const trunk = limb(rng, new Vector3(0, -0.1, 0), new Vector3((rng() - 0.5) * 0.05, 1, (rng() - 0.5) * 0.05), H, 5, 0.03);
  m.tube(trunk, trunk.map((_, i) => 0.22 * (1 - (i / 5) * 0.9)), 6, trunk.map((p) => (p.y / H) ** 2 * 0.12), rng() * 6, bark);
  const tint = new Color(pine ? 0x8a9a70 : 0x6a7a5a);
  const y0 = pine ? H * 0.55 : 0.7;
  let az0 = rng() * 6;
  for (let y = y0; y < H * 0.97; y += pine ? 0.75 : 0.42) {
    const f = (y - y0) / (H - y0);
    const n = pine ? 4 : 5 + (rng() < 0.5 ? 1 : 0);
    az0 += 0.7;
    for (let k = 0; k < n; k++) {
      const az = az0 + (k / n) * Math.PI * 2 + (rng() - 0.5) * 0.3;
      const L = pine ? R * (0.55 + rng() * 0.45) * (1 - f * 0.6) : R * (1 - f) ** 0.95 + 0.3;
      const droop = pine ? 0.25 + rng() * 0.3 : -0.18 - (1 - f) * 0.2;
      const dir = new Vector3(Math.cos(az), droop, Math.sin(az)).normalize();
      const start = new Vector3(trunk[0].x, y, trunk[0].z);
      const pts = limb(rng, start, dir, L, 2, 0.15);
      const ph = rng() * 6;
      if (L > 0.9) m.tube(pts, [0.05, 0.03, 0.012], 3, [0.3, 0.6, 0.9], ph, bark);
      const normal = new Vector3(Math.cos(az), 0.6, Math.sin(az)).normalize();
      if (pine) {
        // Tufts at the end.
        for (let c = 0; c < 3; c++) {
          const up = dir.clone().add(new Vector3((rng() - 0.5) * 0.8, 0.4 + rng() * 0.5, (rng() - 0.5) * 0.8)).normalize();
          m.card(pts[2].clone().addScaledVector(up, -0.3), up, perp(rng, up, new Vector3()), 1.1, 1.1, normal, TILE.pine, 1, ph + c, rng(), tint.clone().multiplyScalar(0.85 + rng() * 0.3));
        }
      } else {
        // Sprays along the branch: one lying flat, one tilted across it.
        const cards = Math.max(1, Math.round(L / 1.0));
        for (let c = 0; c < cards; c++) {
          const at = along(pts, c / cards, new Vector3());
          const h = Math.min(1.5, L * 0.75 + 0.35);
          const flat = new Vector3(-dir.z, 0, dir.x).normalize();
          const col = tint.clone().multiplyScalar(0.8 + rng() * 0.3);
          m.card(at, dir, flat, h * 0.85, h, normal, TILE.fir, 1, ph + c, rng(), col);
          m.card(at, dir, flat.clone().applyAxisAngle(dir, 1.1).normalize(), h * 0.7, h * 0.9, normal, TILE.fir, 1, ph + c + 0.5, rng(), col);
        }
      }
    }
  }
  // The leader at the top.
  const top = trunk[trunk.length - 1];
  for (let c = 0; c < 2; c++) {
    const right = new Vector3(Math.cos(c * 1.57), 0, Math.sin(c * 1.57));
    m.card(top.clone().setY(top.y - 0.8), UP, right, 0.9, 1.6, UP, pine ? TILE.pine : TILE.fir, 0.8, rng() * 6, rng(), tint);
  }
  return m.build();
}

/** A bush: stems from the ground, a shell of leaf cards (round, low and spreading, or a hedge segment). */
function bush(rng: Rng, kind: 'round' | 'spread' | 'hedge'): BufferGeometry {
  const m = new Mesher();
  const bark = new Color(0x4a3a2c);
  const tint = new Color(kind === 'hedge' ? 0x8a9a6a : 0x9aa070);
  if (kind === 'hedge') {
    // 3 m long (local X), 1.0 deep, 1.4 high, overgrown: a ragged top, twigs sticking out.
    const L = 3;
    const D = 0.5;
    const Hh = 1.3 + rng() * 0.3;
    for (let k = 0; k < 110; k++) {
      const face = rng();
      const x = (rng() - 0.5) * L;
      let at: Vector3;
      let normal: Vector3;
      if (face < 0.4) {
        at = new Vector3(x, Hh * (0.85 + rng() * 0.3), (rng() - 0.5) * D * 2);
        normal = new Vector3((rng() - 0.5) * 0.4, 1, (rng() - 0.5) * 0.4).normalize();
      } else {
        const s = face < 0.7 ? 1 : -1;
        at = new Vector3(x, rng() * Hh, s * D * (0.85 + rng() * 0.3));
        normal = new Vector3(0, 0.4, s).normalize();
      }
      const up = normal.clone().add(new Vector3((rng() - 0.5) * 1.2, 0.4, (rng() - 0.5) * 1.2)).normalize();
      m.card(at.addScaledVector(up, -0.25), up, perp(rng, up, new Vector3()), 0.75, 0.75, normal, TILE.bush, 0.5, rng() * 6, rng(), tint.clone().multiplyScalar(0.8 + rng() * 0.35));
    }
    for (let k = 0; k < 9; k++) {
      const up = new Vector3((rng() - 0.5) * 0.6, 1, (rng() - 0.5) * 0.6).normalize();
      m.card(new Vector3((rng() - 0.5) * L, Hh * 0.9, (rng() - 0.5) * D), up, perp(rng, up, new Vector3()), 0.6, 0.9, UP, TILE.twigs, 1, rng() * 6, rng(), new Color(1, 1, 1));
    }
    return m.build();
  }
  const rx = kind === 'round' ? 0.85 + rng() * 0.2 : 1.4 + rng() * 0.3;
  const ry = kind === 'round' ? 0.65 + rng() * 0.15 : 0.42 + rng() * 0.1;
  const cy = ry * 0.95;
  const centre = new Vector3(0, cy, 0);
  for (let k = 0; k < 6; k++) {
    const a = rng() * 6.3;
    const pts = limb(rng, new Vector3(0, -0.05, 0), new Vector3(Math.cos(a) * 0.7, 1, Math.sin(a) * 0.7), ry * 1.2, 2, 0.4);
    m.tube(pts, [0.035, 0.022, 0.01], 3, [0, 0.3, 0.6], rng() * 6, bark);
  }
  const n = kind === 'round' ? 60 : 72;
  for (let k = 0; k < n; k++) {
    const u = rng() * Math.PI * 2;
    const v = Math.acos(1 - rng() * 1.7);
    const dir = new Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    const shell = 0.75 + rng() * 0.35;
    const at = new Vector3(dir.x * rx * shell, cy + dir.y * ry * shell, dir.z * rx * shell);
    const normal = new Vector3().subVectors(at, centre).normalize();
    const up = normal.clone().add(new Vector3(0, 0.6, 0)).add(new Vector3((rng() - 0.5), 0, (rng() - 0.5))).normalize();
    const s = 0.6 + rng() * 0.25;
    m.card(at.addScaledVector(up, -s * 0.4), up, perp(rng, up, new Vector3()), s, s, normal, TILE.bush, 0.6, rng() * 6, rng(), tint.clone().multiplyScalar(0.8 + rng() * 0.35));
  }
  return m.build();
}

const BROAD: Record<'maple' | 'oak' | 'elm', Omit<Broad, 'dead' | 'broken'>> = {
  maple: { trunkH: 2.6, trunkR: 0.2, crownR: 2.8, n1: 7, n2: 3, rise: 0.75, leaf: TILE.maple, leafSize: 1.6, leaves: 300, gnarl: 0.25, bark: 0x7a6a5c, leafTint: 0xa8b07a },
  oak: { trunkH: 2.2, trunkR: 0.28, crownR: 3.3, n1: 6, n2: 4, rise: 0.35, leaf: TILE.oak, leafSize: 1.7, leaves: 310, gnarl: 0.45, bark: 0x6a5a4c, leafTint: 0x96a46c },
  elm: { trunkH: 3.4, trunkR: 0.22, crownR: 3.0, n1: 7, n2: 3, rise: 1.05, leaf: TILE.elm, leafSize: 1.5, leaves: 300, gnarl: 0.2, bark: 0x6a625a, leafTint: 0xa0aa76 },
};

/** Every species × variant, deterministic. A few ms at load. */
export function buildModels(): PlantModel[] {
  const out: PlantModel[] = [];
  for (const species of SPECIES) {
    for (let v = 0; v < VARIANTS[species]; v++) {
      const rng = mulberry32(1000 + SPECIES.indexOf(species) * 97 + v * 13);
      let geometry: BufferGeometry;
      if (species === 'maple' || species === 'oak' || species === 'elm') {
        const P = BROAD[species];
        const k = 0.85 + rng() * 0.3;
        geometry = broadleaf(rng, { ...P, trunkH: P.trunkH * k, crownR: P.crownR * (0.85 + rng() * 0.3) });
      } else if (species === 'spruce' || species === 'pine') geometry = conifer(rng, species === 'pine');
      else if (species === 'dead') {
        const P = BROAD[v % 2 ? 'oak' : 'maple'];
        geometry = broadleaf(rng, { ...P, dead: true, broken: v >= 2, gnarl: P.gnarl + 0.2, bark: 0x6a645c });
      } else geometry = bush(rng, species === 'bushRound' ? 'round' : species === 'bushSpread' ? 'spread' : 'hedge');
      geometry.computeBoundingBox();
      const b = geometry.boundingBox!;
      out.push({ species, variant: v, geometry, height: b.max.y, radius: Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z) });
    }
  }
  return out;
}
