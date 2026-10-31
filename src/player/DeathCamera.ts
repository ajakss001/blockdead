import { Matrix4, Quaternion, Vector3 } from 'three';

/** What the death camera needs to know of the level round the body. */
export interface DeathSurroundings {
  /** Free distance from a point along a unit direction (walls, cars, trunks, crowns, ceilings), up to max. */
  free(o: Vector3, d: Vector3, max: number): number;
  /** The ceiling over the body when it lies indoors, else null. */
  ceiling: number | null;
  /** The floor it lies on. */
  floorY: number;
}

/** Seconds: out of the head, the end of the crane; when the screen goes black outdoors / at the latest indoors. */
const OUT = 1;
const CRANE = 8;
const FADE_OUTDOORS = 7;
const FADE_INDOORS = 6;
const FADE_LEN = 1.8;
/** Keep this far from anything (m): the near plane never cuts a wall. */
const MARGIN = 0.32;
/** The "sphere" swept from the body to the camera: a centre ray and four round it. */
const SPREAD = 0.22;
/** Highest elevation of the boom (rad): never straight down onto the body. */
const PHI_MAX = 1.3;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * After death the camera leaves the head: in the first second back and up to a third-person view of the
 * body, then a slow crane up with a little orbit, the body centred and getting smaller. The boom from the
 * body to the camera is a swept sphere (five rays) every frame — never into walls, ceilings, cars or trees;
 * where the wanted direction is blocked (a corridor, a crown overhead) a search ten times a second finds the
 * nearest open one and the boom turns there smoothly, shortening before it has to. Indoors it rises to the
 * ceiling and the screen fades; outdoors it goes high into the sky first. Pure: the scene gives it the level
 * and the body's position, it gives back a camera pose and the fade.
 */
export class DeathCamera {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  /** 0..1: black. */
  fade = 0;
  t = 0;
  private readonly eyeQ = new Quaternion();
  private readonly focus = new Vector3();
  /** The boom: its direction now, where it is turning to (and the room there), its length. */
  private readonly dir = new Vector3();
  private readonly aim = new Vector3();
  private aimRoom = Infinity;
  private dist: number;
  private searchT = 0;
  private capT = -1;
  private fadeAt: number;

  constructor(
    private readonly around: DeathSurroundings,
    eye: Vector3,
    eyeQ: Quaternion,
    /** The way the survivor looked (camera yaw): the boom starts behind it. */
    private readonly yaw: number,
    body: Vector3,
  ) {
    this.eyeQ.copy(eyeQ);
    this.position.copy(eye);
    this.quaternion.copy(eyeQ);
    this.focus.copy(body);
    const f = this.lifted(_f);
    this.dir.subVectors(eye, f);
    this.dist = Math.max(0.05, this.dir.length());
    this.dir.normalize();
    this.aim.copy(this.dir);
    this.fadeAt = around.ceiling !== null ? FADE_INDOORS : FADE_OUTDOORS;
  }

  get done(): boolean {
    return this.fade >= 1;
  }

  update(dt: number, body: Vector3): void {
    this.t += dt;
    const t = this.t;
    this.focus.lerp(body, 1 - Math.exp(-dt * 4));
    const f = this.lifted(_f);
    // Where the boom wants to be: elevation, length, a slow orbit.
    const u = smooth((t - OUT) / (CRANE - OUT));
    const indoors = this.around.ceiling !== null;
    const phi = 0.42 + (PHI_MAX - 0.1 - 0.42) * u;
    const len = 2.3 + ((indoors ? 6 : 26) - 2.3) * u;
    const theta = this.yaw + 0.75 * u;
    // The nearest open direction to it, ten times a second.
    this.searchT -= dt;
    if (this.searchT <= 0) {
      this.searchT = 0.1;
      this.search(f, theta, phi, len);
    }
    // The boom turns there smoothly (quicker while leaving the head).
    // (A long boom swings no faster than 5 m/s at its end.)
    const angle = this.dir.angleTo(this.aim);
    let k = 1 - Math.exp(-dt * (t < OUT ? 4 : 2));
    if (angle > 1e-4) k = Math.min(k, (5 * dt) / Math.max(0.5, this.dist) / angle);
    _q.setFromUnitVectors(this.dir, this.aim);
    _q.slerp(_q0, 1 - k);
    this.dir.applyQuaternion(_q).normalize();
    // Length: what is wanted, short of anything in the way now or where it is turning; never past the sweep.
    const now = this.sweep(f, this.dir, len + MARGIN) - MARGIN;
    let ahead = this.aimRoom;
    _q.setFromUnitVectors(this.dir, this.aim);
    for (const k of [0.3, 0.65]) {
      _d.copy(this.dir).applyQuaternion(_q2.slerpQuaternions(_q0, _q, k));
      ahead = Math.min(ahead, this.sweep(f, _d, len + MARGIN) - MARGIN);
    }
    const target = Math.max(0.05, Math.min(len, now, ahead));
    // Eased, never faster than a crane moves (in: 2.5 m/s or 60 % of the length a second; out: 4 m/s).
    const step = (target - this.dist) * (1 - Math.exp(-dt * (target < this.dist ? 5 : 1.6)));
    this.dist += Math.max(-Math.max(2.5, this.dist * 0.6) * dt, Math.min(4 * dt, step));
    this.dist = Math.max(0.05, this.dist);
    // The camera itself never goes into anything: it moves from where it was towards the boom's end only
    // as far as it is clear, and keeps a margin all round (it may lag behind, it never jumps).
    _w.copy(f).addScaledVector(this.dir, this.dist);
    _w.y = Math.max(_w.y, this.around.floorY + 0.25);
    this.moveTo(_w, dt);
    // Look: from where the eyes looked to the body.
    _look.lookAt(this.position, f, UP);
    _q.setFromRotationMatrix(_look);
    this.quaternion.copy(this.eyeQ).slerp(_q, smooth(t / (OUT * 0.9)));
    // Black: indoors a second after reaching the ceiling, outdoors high in the sky.
    if (indoors && this.capT < 0 && this.position.y > this.around.ceiling! - MARGIN - 0.3) this.capT = t;
    if (this.capT >= 0) this.fadeAt = Math.min(this.fadeAt, Math.max(OUT + 1.5, this.capT + 1));
    this.fade = smooth((t - this.fadeAt) / FADE_LEN);
  }

  private moveTo(want: Vector3, dt: number): void {
    const p = this.position;
    _d.subVectors(want, p);
    // Held back by something, it catches up smoothly (9 m/s at most), never in one jump.
    const len = Math.min(_d.length(), 9 * dt);
    if (len > 1e-6) {
      _d.normalize();
      const h = this.around.free(p, _d, len + MARGIN);
      p.addScaledVector(_d, Math.max(0, Math.min(len, h - MARGIN)));
    }
    for (const a of AXES) {
      const h = this.around.free(p, a, MARGIN);
      if (h < MARGIN) p.addScaledVector(a, -(MARGIN - h));
    }
    p.y = Math.max(p.y, this.around.floorY + 0.2);
  }

  /** The body, a little above the floor (rays start clear of it). */
  private lifted(out: Vector3): Vector3 {
    out.copy(this.focus);
    out.y = Math.max(out.y + 0.25, this.around.floorY + 0.45);
    return out;
  }

  /**
   * Around the wanted direction (turned further round, raised higher): the one with the most room for the
   * wanted length, preferring the least turn; then the room along it by the full sweep.
   */
  private search(f: Vector3, theta: number, phi: number, len: number): void {
    // Six metres of room is plenty: past that, the nearer to the wanted direction the better.
    const enough = Math.min(len, Math.max(6, this.dist + 1));
    const score = (d: Vector3, room: number, turn: number, lift: number) => Math.min(1, room / enough) - 0.1 * Math.abs(turn) - 0.12 * Math.abs(lift) + 0.06 * d.dot(this.aim);
    // A cheap look along each candidate, then the best few by the full sweep.
    let n = 0;
    for (const dt of TURNS) {
      for (const dp of LIFTS) {
        const p = Math.min(PHI_MAX, phi + dp);
        const c = CANDS[n++];
        c.d.set(Math.sin(theta + dt) * Math.cos(p), Math.sin(p), Math.cos(theta + dt) * Math.cos(p));
        c.turn = dt;
        c.lift = p - phi;
        c.score = score(c.d, this.around.free(f, c.d, enough + MARGIN) - MARGIN, dt, c.lift);
      }
    }
    CANDS.sort((x, y) => y.score - x.score);
    let best = -Infinity;
    for (let i = 0; i < 4; i++) {
      const c = CANDS[i];
      const sc = score(c.d, this.sweep(f, c.d, enough + MARGIN) - MARGIN, c.turn, c.lift);
      if (sc > best) {
        best = sc;
        _best.copy(c.d);
      }
    }
    this.aim.copy(_best);
    this.aimRoom = this.sweep(f, this.aim, len + MARGIN) - MARGIN;
  }

  /** The nearest hit of five rays: along the boom and round it (rays starting inside something are skipped). */
  private sweep(o: Vector3, d: Vector3, max: number): number {
    let best = this.around.free(o, d, max);
    _s1.crossVectors(d, Math.abs(d.y) > 0.9 ? X : UP).normalize();
    _s2.crossVectors(d, _s1).normalize();
    for (const [s, k] of SIDES) {
      const side = s === 1 ? _s1 : _s2;
      _o.copy(o).addScaledVector(side, SPREAD * k);
      _n.copy(side).multiplyScalar(k);
      if (this.around.free(o, _n, SPREAD) < SPREAD) continue;
      const h = this.around.free(_o, d, max);
      if (h > 0.15) best = Math.min(best, h);
    }
    return best;
  }
}

const TURNS = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, 2.5, -2.5, Math.PI];
const LIFTS = [-0.3, 0, 0.35, 0.8];
const CANDS = Array.from({ length: 12 * 4 }, () => ({ d: new Vector3(), turn: 0, lift: 0, score: 0 }));
const SIDES: [number, number][] = [
  [1, 1],
  [1, -1],
  [2, 1],
  [2, -1],
];
const UP = new Vector3(0, 1, 0);
/** Round the camera: the axes and the level diagonals (a box's corner slips between the axes). */
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1]].map(([x, y, z]) => new Vector3(x, y, z).normalize());
const X = new Vector3(1, 0, 0);
const _f = new Vector3();
const _w = new Vector3();
const _d = new Vector3();
const _best = new Vector3();
const _o = new Vector3();
const _n = new Vector3();
const _s1 = new Vector3();
const _s2 = new Vector3();
const _q = new Quaternion();
const _q0 = new Quaternion();
const _q2 = new Quaternion();
const _look = new Matrix4();

/**
 * The level as the death camera sees it: the colliders (walls, cars, furniture, trunks) by their ray test,
 * tree crowns as spheres (packed x, y, z, r), the ceiling over the body indoors.
 */
export function deathSurroundings(
  world: { rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number },
  floorY: number,
  ceiling: number | null,
  crowns: number[],
): DeathSurroundings {
  return {
    floorY,
    ceiling,
    free(o, d, max) {
      let best = max;
      const w = world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, max);
      if (w >= 0) best = w;
      if (ceiling !== null && d.y > 1e-4) best = Math.min(best, Math.max(0, (ceiling - o.y) / d.y));
      for (let i = 0; i < crowns.length; i += 4) {
        const ox = o.x - crowns[i];
        const oy = o.y - crowns[i + 1];
        const oz = o.z - crowns[i + 2];
        const r = crowns[i + 3];
        const cc = ox * ox + oy * oy + oz * oz - r * r;
        if (cc < 0) continue;
        const bb = ox * d.x + oy * d.y + oz * d.z;
        const disc = bb * bb - cc;
        if (bb >= 0 || disc < 0) continue;
        best = Math.min(best, -bb - Math.sqrt(disc));
      }
      return best;
    },
  };
}
