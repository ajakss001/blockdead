import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import type { CollisionWorld } from './CollisionWorld';

export const WINDOW_OWNER_BASE = 5e15;
const MAX_PANES = 12288;

export interface WindowPaneSpot {
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
}

interface PaneEntry {
  owner: number;
  chunkKey: number;
  spot: WindowPaneSpot;
  /** 0 = intact, 1 = spiderweb cracked (penetrable & body-breakable), 2 = shattered (gone) */
  stage: 0 | 1 | 2;
}

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _m = new Matrix4();

/** Build realistic jagged glass fracture texture (angular impact hole, sharp splinters, no concentric cobweb rings). */
function buildFullPaneCrackCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  const S = 512;
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return null;
  const cx = S * 0.5;
  const cy = S * 0.5;
  g.clearRect(0, 0, S, S);

  const hash = (k: number) => {
    const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  const rays = 22;
  const angles: number[] = [];
  const holeR: number[] = [];
  const reaches: number[] = [];
  for (let i = 0; i < rays; i++) {
    const step = (Math.PI * 2) / rays;
    angles.push(i * step + (hash(i * 3.1 + 1) - 0.5) * step * 0.58);
    holeR.push(14 + hash(i * 7.7 + 2) * 18);
    reaches.push(S * (0.34 + hash(i * 11.3 + 3) * 0.16));
  }

  // Translucent jagged shard facets clustered near the central impact zone (~30% radius).
  for (let i = 0; i < rays; i++) {
    const j = (i + 1) % rays;
    const rOutA = holeR[i] + 38 + hash(i * 13.7 + 4) * (S * 0.18);
    const rOutB = holeR[j] + 38 + hash(j * 13.7 + 4) * (S * 0.18);
    const alpha = 0.14 + hash(i * 17.9 + 5) * 0.12;
    g.fillStyle = `rgba(195, 225, 238, ${alpha.toFixed(3)})`;
    g.beginPath();
    g.moveTo(cx + Math.cos(angles[i]) * holeR[i], cy + Math.sin(angles[i]) * holeR[i]);
    g.lineTo(cx + Math.cos(angles[i]) * rOutA, cy + Math.sin(angles[i]) * rOutA);
    g.lineTo(cx + Math.cos(angles[j]) * rOutB, cy + Math.sin(angles[j]) * rOutB);
    g.lineTo(cx + Math.cos(angles[j]) * holeR[j], cy + Math.sin(angles[j]) * holeR[j]);
    g.closePath();
    g.fill();
  }

  // Only 1-2 short broken angular cross-fractures between adjacent rays near the impact (no circular rings).
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  for (let i = 0; i < rays; i++) {
    const j = (i + 1) % rays;
    if (hash(i * 19.3 + 6) < 0.45) {
      const rA = holeR[i] + 28 + hash(i * 23.1) * 58;
      const rB = holeR[j] + 24 + hash(i * 29.7) * 62;
      const midA = (angles[i] + angles[j]) * 0.5 + (j === 0 ? Math.PI : 0);
      const rM = (rA + rB) * 0.5 + (hash(i * 31.3) - 0.5) * 14;
      const x1 = cx + Math.cos(angles[i]) * rA;
      const y1 = cy + Math.sin(angles[i]) * rA;
      const xm = cx + Math.cos(midA) * rM;
      const ym = cy + Math.sin(midA) * rM;
      const x2 = cx + Math.cos(angles[j]) * rB;
      const y2 = cy + Math.sin(angles[j]) * rB;
      g.strokeStyle = 'rgba(30, 45, 55, 0.34)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x1 + 1, y1 + 1);
      g.lineTo(xm + 1, ym + 1);
      g.lineTo(x2 + 1, y2 + 1);
      g.stroke();
      g.strokeStyle = 'rgba(232, 245, 255, 0.84)';
      g.lineWidth = 1.0;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(xm, ym);
      g.lineTo(x2, y2);
      g.stroke();
    }
  }

  // Sharp angular radial fracture lines + dark glass-edge bevel + forked secondary splinters.
  const drawJaggedRay = (pts: [number, number][], baseWidth: number) => {
    for (let s = 0; s < pts.length - 1; s++) {
      const w = Math.max(0.65, baseWidth * (1 - (s / pts.length) * 0.55));
      g.strokeStyle = 'rgba(30, 45, 55, 0.36)';
      g.lineWidth = w + 0.4;
      g.beginPath();
      g.moveTo(pts[s][0] + 1, pts[s][1] + 1);
      g.lineTo(pts[s + 1][0] + 1, pts[s + 1][1] + 1);
      g.stroke();

      g.strokeStyle = 'rgba(238, 248, 255, 0.92)';
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(pts[s][0], pts[s][1]);
      g.lineTo(pts[s + 1][0], pts[s + 1][1]);
      g.stroke();
    }
  };

  for (let i = 0; i < rays; i++) {
    const a0 = angles[i];
    const rStart = holeR[i];
    const rEnd = reaches[i];
    const segs = 5;
    const pts: [number, number][] = [[cx + Math.cos(a0) * rStart, cy + Math.sin(a0) * rStart]];
    let curA = a0;
    for (let seg = 1; seg <= segs; seg++) {
      const t = seg / segs;
      curA += (hash(i * 41.3 + seg * 7.1) - 0.5) * 0.22;
      const rad = rStart + (rEnd - rStart) * t;
      pts.push([cx + Math.cos(curA) * rad, cy + Math.sin(curA) * rad]);
    }
    drawJaggedRay(pts, i % 3 === 0 ? 1.8 : 1.25);

    // Forked secondary splinters splitting at sharp angles.
    if (hash(i * 53.7 + 9) < 0.65) {
      const anchor = pts[2];
      const fAng = curA + (hash(i * 61.1) < 0.5 ? 1 : -1) * (0.28 + hash(i * 67.3) * 0.30);
      const fLen = S * (0.10 + hash(i * 71.9) * 0.14);
      const midPt: [number, number] = [
        anchor[0] + Math.cos(fAng) * fLen * 0.52,
        anchor[1] + Math.sin(fAng) * fLen * 0.52,
      ];
      const endPt: [number, number] = [
        midPt[0] + Math.cos(fAng + (hash(i * 73.1) - 0.5) * 0.24) * fLen * 0.48,
        midPt[1] + Math.sin(fAng + (hash(i * 73.1) - 0.5) * 0.24) * fLen * 0.48,
      ];
      drawJaggedRay([anchor, midPt, endPt], 1.0);
    }

    // Extra dense hairline stress splinters close to the jagged central hole.
    if (hash(i * 79.3) < 0.7) {
      const sAng = angles[i] + (hash(i * 83.9) - 0.5) * 0.28;
      const sLen = holeR[i] + 24 + hash(i * 89.7) * 44;
      drawJaggedRay(
        [
          [cx + Math.cos(sAng) * holeR[i], cy + Math.sin(sAng) * holeR[i]],
          [cx + Math.cos(sAng + 0.08) * sLen, cy + Math.sin(sAng + 0.08) * sLen],
        ],
        0.85,
      );
    }
  }

  // Punch clean irregular transparent central impact hole and stroke crisp broken glass rim.
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.beginPath();
  for (let i = 0; i < rays; i++) {
    const x = cx + Math.cos(angles[i]) * holeR[i];
    const y = cy + Math.sin(angles[i]) * holeR[i];
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.restore();

  g.beginPath();
  for (let i = 0; i < rays; i++) {
    const x = cx + Math.cos(angles[i]) * holeR[i];
    const y = cy + Math.sin(angles[i]) * holeR[i];
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.strokeStyle = 'rgba(28, 42, 52, 0.55)';
  g.lineWidth = 2.6;
  g.stroke();
  g.strokeStyle = 'rgba(242, 250, 255, 0.96)';
  g.lineWidth = 1.4;
  g.stroke();

  return cv;
}

/**
 * Pooled instanced manager for destructible building window glass:
 * - Stage 0: intact translucent pane (bullets pass through with 8% attenuation and advance to Stage 1)
 * - Stage 1: full-pane spiderweb cracked glass (bullets pass through; body passage/jump or melee advances to Stage 2)
 * - Stage 2: completely removed (clean open window frame + collider removed)
 */
export class WindowPanes {
  private readonly byOwner = new Map<number, PaneEntry>();
  private readonly byChunk = new Map<number, number[]>();
  private nextId = 1;
  private dirty = false;

  private readonly geo = new BoxGeometry(1, 1, 1);
  private readonly intactMesh: InstancedMesh;
  private readonly crackedMesh: InstancedMesh;
  private readonly crackTex: CanvasTexture | null = null;
  private readonly intactMat: MeshStandardMaterial;
  private readonly crackedMat: MeshBasicMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
  ) {
    this.intactMat = new MeshStandardMaterial({
      color: 0x6a7a84,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      roughness: 0.12,
      metalness: 0.15,
      side: DoubleSide,
    });
    const cv = buildFullPaneCrackCanvas();
    if (cv) {
      this.crackTex = new CanvasTexture(cv);
    }
    this.crackedMat = new MeshBasicMaterial({
      map: this.crackTex,
      color: 0xeaf4fc,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      alphaTest: 0.02,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.intactMesh = new InstancedMesh(this.geo, this.intactMat, MAX_PANES);
    this.intactMesh.name = 'world:windowIntact';
    this.intactMesh.castShadow = false;
    this.intactMesh.receiveShadow = false;
    this.intactMesh.frustumCulled = false;
    this.intactMesh.count = 0;
    this.intactMesh.visible = false;

    this.crackedMesh = new InstancedMesh(this.geo, this.crackedMat, MAX_PANES);
    this.crackedMesh.name = 'world:windowCracked';
    this.crackedMesh.castShadow = false;
    this.crackedMesh.receiveShadow = false;
    this.crackedMesh.frustumCulled = false;
    this.crackedMesh.count = 0;
    this.crackedMesh.visible = false;

    this.scene.add(this.intactMesh, this.crackedMesh);
  }

  isWindowOwner(owner: number): boolean {
    return owner >= WINDOW_OWNER_BASE && this.byOwner.has(owner);
  }

  isCracked(owner: number): boolean {
    return this.byOwner.get(owner)?.stage === 1;
  }

  addChunk(chunkKey: number, spots: WindowPaneSpot[]): void {
    if (!spots || spots.length === 0) return;
    const owners: number[] = [];
    const prevOwner = this.world.owner;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const owner = WINDOW_OWNER_BASE + this.nextId++;
      owners.push(owner);
      this.byOwner.set(owner, { owner, chunkKey, spot: s, stage: 0 });
      this.world.owner = owner;
      this.world.addBox(s.cx - s.sx * 0.5, s.cz - s.sz * 0.5, s.cx + s.sx * 0.5, s.cz + s.sz * 0.5, s.cy - s.sy * 0.5, s.cy + s.sy * 0.5, true, false);
    }
    this.world.owner = prevOwner;
    this.byChunk.set(chunkKey, owners);
    this.dirty = true;
    this.sync();
  }

  removeChunk(chunkKey: number): void {
    const owners = this.byChunk.get(chunkKey);
    if (!owners) return;
    for (let i = 0; i < owners.length; i++) {
      const owner = owners[i];
      const entry = this.byOwner.get(owner);
      if (entry && entry.stage < 2) {
        this.world.removeOwner(owner);
      }
      this.byOwner.delete(owner);
    }
    this.byChunk.delete(chunkKey);
    this.dirty = true;
    this.sync();
  }

  /** Stage 0 -> Stage 1 on first bullet impact (remains cracked and passable/penetrable). */
  bulletHit(owner: number): { spot: WindowPaneSpot; newlyCracked: boolean; stage: 1 } | null {
    const entry = this.byOwner.get(owner);
    if (!entry || entry.stage >= 2) return null;
    const newlyCracked = entry.stage === 0;
    if (newlyCracked) {
      entry.stage = 1;
      this.dirty = true;
      this.sync();
    }
    return { spot: entry.spot, newlyCracked, stage: 1 };
  }

  /** Stage 0/1 -> Stage 2: completely removes pane visual & collider. */
  shatter(owner: number): WindowPaneSpot | null {
    const entry = this.byOwner.get(owner);
    if (!entry || entry.stage >= 2) return null;
    entry.stage = 2;
    this.world.removeOwner(owner);
    this.dirty = true;
    this.sync();
    return entry.spot;
  }

  /** Shatters any Stage 1 spiderweb-cracked panes touched by a moving body cylinder (player/bot). */
  shatterCrackedNear(x: number, y: number, z: number, radius: number, height = 1.75): WindowPaneSpot[] {
    const broken: WindowPaneSpot[] = [];
    for (const entry of this.byOwner.values()) {
      if (entry.stage !== 1) continue;
      const s = entry.spot;
      if (y + height < s.cy - s.sy * 0.5 || y > s.cy + s.sy * 0.5) continue;
      const hx = Math.max(0.16, s.sx * 0.5) + radius + 0.14;
      const hz = Math.max(0.16, s.sz * 0.5) + radius + 0.14;
      if (Math.abs(x - s.cx) <= hx && Math.abs(z - s.cz) <= hz) {
        entry.stage = 2;
        this.world.removeOwner(entry.owner);
        broken.push(s);
        this.dirty = true;
      }
    }
    if (broken.length > 0) this.sync();
    return broken;
  }

  private sync(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let i0 = 0;
    let i1 = 0;
    for (const entry of this.byOwner.values()) {
      if (entry.stage >= 2) continue;
      const s = entry.spot;
      // Cracked Stage 1 gets tiny 2mm depth thickness on thin panes so both sides render crisp web lines
      const sx = s.sx < 0.06 && entry.stage === 1 ? 0.025 : s.sx;
      const sz = s.sz < 0.06 && entry.stage === 1 ? 0.025 : s.sz;
      _m.compose(_p.set(s.cx, s.cy, s.cz), _q.identity(), _s.set(sx, s.sy, sz));
      if (entry.stage === 0) {
        if (i0 < MAX_PANES) this.intactMesh.setMatrixAt(i0++, _m);
      } else {
        if (i1 < MAX_PANES) this.crackedMesh.setMatrixAt(i1++, _m);
      }
    }
    this.intactMesh.count = i0;
    this.intactMesh.visible = i0 > 0;
    this.intactMesh.instanceMatrix.needsUpdate = true;

    this.crackedMesh.count = i1;
    this.crackedMesh.visible = i1 > 0;
    this.crackedMesh.instanceMatrix.needsUpdate = true;
  }

  prewarm(): () => void {
    const prev0 = this.intactMesh.count;
    const prev1 = this.crackedMesh.count;
    const prevV0 = this.intactMesh.visible;
    const prevV1 = this.crackedMesh.visible;
    _m.compose(_p.set(0, -500, 0), _q.identity(), _s.set(0.01, 0.01, 0.01));
    if (prev0 === 0) {
      this.intactMesh.setMatrixAt(0, _m);
      this.intactMesh.count = 1;
      this.intactMesh.instanceMatrix.needsUpdate = true;
    }
    if (prev1 === 0) {
      this.crackedMesh.setMatrixAt(0, _m);
      this.crackedMesh.count = 1;
      this.crackedMesh.instanceMatrix.needsUpdate = true;
    }
    this.intactMesh.visible = true;
    this.crackedMesh.visible = true;
    return () => {
      this.intactMesh.count = prev0;
      this.crackedMesh.count = prev1;
      this.intactMesh.visible = prevV0;
      this.crackedMesh.visible = prevV1;
    };
  }

  dispose(): void {
    this.geo.dispose();
    this.intactMat.dispose();
    this.crackedMat.dispose();
    this.crackTex?.dispose();
    this.intactMesh.removeFromParent();
    this.crackedMesh.removeFromParent();
  }
}
