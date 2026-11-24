/**
 * Tactical bot pathfinding (A* on a 0.45 m local grid through doors and stairs):
 * - Walls and intact window glass are strictly impassable for walking.
 * - Open doors and unlocked/unbarricaded closed doors are traversable portal nodes.
 * - Multi-storey goals route via building entrances and highrise stair cores.
 * - Anti-stuck blocked spots penalize jammed walls/corners so bots immediately reroute.
 */

import type { DoorNavSpot } from '../world/Doors';
import { type BuildingDesc, local as highriseLocal } from '../world/gen/highrise';

export interface NavBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  minY: number;
  maxY: number;
  glass?: boolean;
  door?: boolean;
  obb?: { cx: number; cz: number; hx: number; hz: number; c: number; s: number } | null;
}

export interface NavQuery {
  groundY: (x: number, z: number, y?: number) => number;
  rayHit: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, ignoreGlass?: boolean) => number;
  boxesNear: (x: number, z: number, r: number, out: NavBox[]) => void;
  doorsNear?: (x: number, y: number, z: number, r: number) => DoorNavSpot[];
  buildingsNear?: (x: number, z: number, r: number) => BuildingDesc[];
}

export interface NavWaypoint {
  x: number;
  y: number;
  z: number;
  isDoor?: boolean;
}

export interface BlockedSpot {
  x: number;
  z: number;
  ttl: number;
}

const CELL = 0.45;
const BOT_CLEAR_RAD = 0.21;
const BOT_BODY_LO = 0.42;
const BOT_BODY_HI = 1.72;
const MAX_STEP_RISE = 0.68;
const MAX_EXPAND = 1500;
const GRID_HALF_SPAN = 28;
const KEY_OFFSET = 65536;
const STRIDE = 131072;

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function overlapsBoxXZ(b: NavBox, x: number, z: number, radius: number): boolean {
  if (b.obb) {
    const o = b.obb;
    const wx = x - o.cx;
    const wz = z - o.cz;
    return Math.abs(wx * o.c - wz * o.s) <= o.hx + radius && Math.abs(wx * o.s + wz * o.c) <= o.hz + radius;
  }
  return x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ;
}

function segmentNearPoint(ax: number, az: number, bx: number, bz: number, px: number, pz: number, r: number): boolean {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  if (len2 < 1e-6) return (px - ax) ** 2 + (pz - az) ** 2 <= r * r;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2));
  const dx = px - (ax + vx * t);
  const dz = pz - (az + vz * t);
  return dx * dx + dz * dz <= r * r;
}

/**
 * True when a 0.64 m wide floor corridor from `a` to `b` has continuous footing and zero
 * blocking walls, closed doors, or intact window glass (`ignoreGlass = false`).
 */
export function hasWalkableLine(
  q: NavQuery,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  blockedSpots?: readonly BlockedSpot[],
): boolean {
  if (Math.abs(by - ay) > MAX_STEP_RISE) return false;
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.08) return true;

  if (blockedSpots) {
    for (let i = 0; i < blockedSpots.length; i++) {
      if (blockedSpots[i].ttl > 0 && segmentNearPoint(ax, az, bx, bz, blockedSpots[i].x, blockedSpots[i].z, 0.85)) {
        return false;
      }
    }
  }

  const nx = dx / dist;
  const nz = dz / dist;
  const px = -nz;
  const pz = nx;
  const dy = (by - ay) / dist;

  for (const side of [0, -0.32, 0.32] as const) {
    const ox = ax + px * side;
    const oz = az + pz * side;
    for (const h of [0.55, 1.25] as const) {
      const hit = q.rayHit(ox, ay + h, oz, nx, dy, nz, dist, false);
      if (hit >= 0 && hit < dist - 0.08) return false;
    }
  }

  const steps = Math.max(1, Math.min(8, Math.ceil(dist / 2.2)));
  let prevY = ay;
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const sy = q.groundY(ax + dx * t, az + dz * t, prevY);
    if (Math.abs(sy - prevY) > MAX_STEP_RISE) return false;
    prevY = sy;
  }
  return Math.abs(by - prevY) <= MAX_STEP_RISE;
}

function insideBuildingMargin(d: BuildingDesc, x: number, z: number, pad = 0.5): boolean {
  const L = highriseLocal(d);
  return x >= L.x0 - pad && x <= L.x1 + pad && z >= L.z0 - pad && z <= L.z1 + pad;
}

/**
 * If goal is on a different floor than start inside/near a highrise, pick the intermediate
 * building entrance (if outside) or stair-core target (if inside) on the bot's storey.
 */
function pickPortalGoal(
  q: NavQuery,
  start: { x: number; y: number; z: number },
  goal: { x: number; y: number; z: number },
  doors: readonly DoorNavSpot[],
): { x: number; y: number; z: number } {
  if (Math.abs(goal.y - start.y) <= 1.2 || !q.buildingsNear) return goal;
  const bs = q.buildingsNear(goal.x, goal.z, 20);
  if (bs.length === 0) return goal;

  for (const d of bs) {
    if (!insideBuildingMargin(d, goal.x, goal.z, 1.2)) continue;
    const L = highriseLocal(d);
    const startInside = insideBuildingMargin(d, start.x, start.z, -0.1);
    if (!startInside) {
      // Pick closest passable ground door near this building's footprint
      let bestDoor: DoorNavSpot | null = null;
      let bestD2 = Infinity;
      for (const dr of doors) {
        if (!dr.passable || !insideBuildingMargin(d, dr.x, dr.z, 1.8)) continue;
        const d2 = (dr.x - start.x) ** 2 + (dr.z - start.z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestDoor = dr;
        }
      }
      if (bestDoor) return { x: bestDoor.x, y: start.y, z: bestDoor.z };
      const ex = d.flip ? 2 * d.cx - L.doorX : L.doorX;
      const ez = d.flip ? L.z1 + 0.4 : L.z0 - 0.4;
      return { x: ex, y: start.y, z: ez };
    }
    // Inside building on another floor: walk to stair core center
    const lxMid = (L.cx0 + L.cx1) * 0.5;
    const lzMid = (L.cz0 + L.cz1) * 0.5;
    const wx = d.flip ? 2 * d.cx - lxMid : lxMid;
    const wz = d.flip ? 2 * d.cz - lzMid : lzMid;
    return { x: wx, y: q.groundY(wx, wz, start.y), z: wz };
  }
  return goal;
}

class MinHeap {
  private readonly heap: number[] = [];
  constructor(private readonly fScores: Map<number, number>) {}
  get size(): number {
    return this.heap.length;
  }
  push(k: number): void {
    this.heap.push(k);
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.fScores.get(this.heap[p]) ?? Infinity) <= (this.fScores.get(this.heap[i]) ?? Infinity)) break;
      const tmp = this.heap[p];
      this.heap[p] = this.heap[i];
      this.heap[i] = tmp;
      i = p;
    }
  }
  pop(): number {
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      const n = this.heap.length;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let sm = i;
        if (l < n && (this.fScores.get(this.heap[l]) ?? Infinity) < (this.fScores.get(this.heap[sm]) ?? Infinity)) sm = l;
        if (r < n && (this.fScores.get(this.heap[r]) ?? Infinity) < (this.fScores.get(this.heap[sm]) ?? Infinity)) sm = r;
        if (sm === i) break;
        const tmp = this.heap[i];
        this.heap[i] = this.heap[sm];
        this.heap[sm] = tmp;
        i = sm;
      }
    }
    return top;
  }
}

/**
 * Compute an obstacle-aware path from `start` to `goal` using local 0.45 m A*.
 * Routes around walls & window glass, passes through open/unlocked doors, handles
 * stairs smoothly, and avoids `blockedSpots` flagged by the anti-stuck watchdog.
 */
export function findBotPath(
  q: NavQuery,
  start: { x: number; y: number; z: number },
  goal: { x: number; y: number; z: number },
  blockedSpots: readonly BlockedSpot[] = [],
): NavWaypoint[] {
  const doors = q.doorsNear ? q.doorsNear((start.x + goal.x) * 0.5, start.y, (start.z + goal.z) * 0.5, 34) : [];
  const target = pickPortalGoal(q, start, goal, doors);

  if (
    Math.hypot(target.x - start.x, target.z - start.z) < 42 &&
    hasWalkableLine(q, start.x, start.y, start.z, target.x, target.y, target.z, blockedSpots)
  ) {
    return [{ x: target.x, y: target.y, z: target.z }];
  }

  const ix0 = Math.round(start.x / CELL);
  const iz0 = Math.round(start.z / CELL);
  const ixG = Math.round(target.x / CELL);
  const izG = Math.round(target.z / CELL);

  const midX = (start.x + target.x) * 0.5;
  const midZ = (start.z + target.z) * 0.5;
  const span = Math.min(GRID_HALF_SPAN, Math.max(12, Math.hypot(target.x - start.x, target.z - start.z) * 0.65 + 8));

  const boxes: NavBox[] = [];
  q.boxesNear(midX, midZ, span + 2, boxes);

  const cellKey = (ix: number, iz: number) => (ix + KEY_OFFSET) * STRIDE + (iz + KEY_OFFSET);
  const startKey = cellKey(ix0, iz0);
  const goalKey = cellKey(ixG, izG);

  const doorNearCell = (wx: number, wy: number, wz: number): DoorNavSpot | null => {
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (!d.passable || Math.abs(d.y - wy) > 1.8) continue;
      const rx = wx - d.x;
      const rz = wz - d.z;
      // Local doorway corridor (along leaf tangent ±0.46m, across normal ±0.68m)
      const along = Math.abs(rx * -d.nz + rz * d.nx);
      const across = Math.abs(rx * d.nx + rz * d.nz);
      if (along <= 0.46 && across <= 0.68) return d;
    }
    return null;
  };

  const evalCache = new Map<number, { passable: boolean; cost: number; y: number; door: DoorNavSpot | null }>();
  const evalCell = (ix: number, iz: number, refY: number): { passable: boolean; cost: number; y: number; door: DoorNavSpot | null } => {
    const k = cellKey(ix, iz);
    const cached = evalCache.get(k);
    if (cached) return cached;

    const wx = ix * CELL;
    const wz = iz * CELL;
    if (Math.abs(wx - midX) > span || Math.abs(wz - midZ) > span) {
      const res = { passable: false, cost: Infinity, y: refY, door: null };
      evalCache.set(k, res);
      return res;
    }

    const wy = q.groundY(wx, wz, refY);
    const dPortal = doorNearCell(wx, wy, wz);
    const yLo = wy + BOT_BODY_LO;
    const yHi = wy + BOT_BODY_HI;

    let blocked = false;
    let extraCost = dPortal ? (dPortal.open ? 0 : 1.1) : 0;

    if (k !== startKey) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.maxY <= yLo || b.minY >= yHi) continue;
        if (b.door && dPortal) continue;
        if (dPortal && overlapsBoxXZ(b, wx, wz, 0.14)) {
          // Only walls genuinely overlapping the doorway interior block it (ignore corner jamb grazing)
          blocked = true;
          break;
        }
        if (!dPortal && overlapsBoxXZ(b, wx, wz, BOT_CLEAR_RAD)) {
          blocked = true;
          break;
        }
      }
    }

    if (!blocked) {
      for (let i = 0; i < blockedSpots.length; i++) {
        const sp = blockedSpots[i];
        if (sp.ttl > 0 && (wx - sp.x) ** 2 + (wz - sp.z) ** 2 < 0.85 * 0.85) {
          extraCost += 28;
        }
      }
    }

    const res = { passable: !blocked, cost: extraCost, y: wy, door: dPortal };
    evalCache.set(k, res);
    return res;
  };

  evalCache.set(startKey, { passable: true, cost: 0, y: start.y, door: null });

  const gScore = new Map<number, number>([[startKey, 0]]);
  const fScore = new Map<number, number>([[startKey, Math.hypot(ixG - ix0, izG - iz0)]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap(fScore);
  open.push(startKey);

  let bestNode = startKey;
  let bestDistH = Math.hypot((ixG - ix0) * CELL, (izG - iz0) * CELL);
  let foundGoal = false;
  let expanded = 0;

  while (open.size > 0 && expanded < MAX_EXPAND) {
    const cur = open.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    expanded++;

    const cx = Math.floor(cur / STRIDE) - KEY_OFFSET;
    const cz = (cur % STRIDE) - KEY_OFFSET;
    const cInfo = evalCell(cx, cz, start.y);

    const remGoal = Math.hypot((ixG - cx) * CELL, (izG - cz) * CELL);
    if (cur !== startKey && remGoal < bestDistH) {
      bestDistH = remGoal;
      bestNode = cur;
    }
    if (cur === goalKey || remGoal <= CELL * 1.15) {
      bestNode = cur;
      foundGoal = true;
      break;
    }

    const curG = gScore.get(cur) ?? Infinity;
    for (let i = 0; i < DIRS.length; i++) {
      const [dx, dz, stepCost] = DIRS[i];
      const nx = cx + dx;
      const nz = cz + dz;
      const nk = cellKey(nx, nz);
      if (closed.has(nk)) continue;

      const nInfo = evalCell(nx, nz, cInfo.y);
      if (!nInfo.passable) continue;
      if (Math.abs(nInfo.y - cInfo.y) > MAX_STEP_RISE) continue;

      // Prevent corner clipping when stepping diagonally past a wall edge
      if (dx !== 0 && dz !== 0) {
        const c1 = evalCell(cx + dx, cz, cInfo.y);
        const c2 = evalCell(cx, cz + dz, cInfo.y);
        if (!c1.passable || !c2.passable) continue;
      }

      const candG = curG + stepCost + nInfo.cost;
      if (candG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, cur);
        gScore.set(nk, candG);
        const h = Math.hypot(ixG - nx, izG - nz);
        fScore.set(nk, candG + h * 1.08);
        open.push(nk);
      }
    }
  }

  if (bestNode === startKey) {
    return [{ x: target.x, y: target.y, z: target.z }];
  }

  // Reconstruct raw cell chain
  const raw: NavWaypoint[] = [];
  let trace: number | undefined = bestNode;
  while (trace !== undefined && trace !== startKey) {
    const tx = Math.floor(trace / STRIDE) - KEY_OFFSET;
    const tz = (trace % STRIDE) - KEY_OFFSET;
    const info = evalCell(tx, tz, start.y);
    if (info.door) {
      raw.push({ x: info.door.x, y: info.door.y, z: info.door.z, isDoor: true });
    } else {
      raw.push({ x: tx * CELL, y: info.y, z: tz * CELL });
    }
    trace = cameFrom.get(trace);
  }
  raw.reverse();

  // Deduplicate consecutive identical doorway waypoints
  const dedup: NavWaypoint[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const prev = dedup[dedup.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) < 0.2) continue;
    dedup.push(p);
  }
  if (foundGoal) {
    const tail = dedup[dedup.length - 1];
    if (!tail || Math.hypot(tail.x - target.x, tail.z - target.z) > 0.35) {
      dedup.push({ x: target.x, y: target.y, z: target.z });
    }
  }

  // Greedy line-of-walk smoothing (keeps doorway center waypoints exact so bots trigger doors squarely)
  if (dedup.length <= 2) return dedup;
  const smooth: NavWaypoint[] = [];
  let anchor: { x: number; y: number; z: number } = start;
  let i = 0;
  while (i < dedup.length) {
    if (dedup[i].isDoor) {
      smooth.push(dedup[i]);
      anchor = dedup[i];
      i++;
      continue;
    }
    let far = i;
    for (let j = dedup.length - 1; j > i; j--) {
      if (dedup[j].isDoor) continue;
      if (hasWalkableLine(q, anchor.x, anchor.y, anchor.z, dedup[j].x, dedup[j].y, dedup[j].z, blockedSpots)) {
        far = j;
        break;
      }
    }
    smooth.push(dedup[far]);
    anchor = dedup[far];
    i = far + 1;
  }
  return smooth;
}
