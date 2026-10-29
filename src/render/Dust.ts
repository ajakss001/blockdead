import { BufferAttribute, BufferGeometry, Points, PointsMaterial, type Vector3 } from 'three';

const N = 96;
const LIFE = 0.6;

/**
 * Puffs of dust where a blow lands (no blood — kid-friendly): grey specks that fly out, sink and vanish.
 * One Points object (one draw call) with a ring buffer of particles.
 */
export class Dust {
  readonly points: Points;
  private readonly pos = new Float32Array(N * 3);
  private readonly vel = new Float32Array(N * 3);
  private readonly age = new Float32Array(N).fill(LIFE);
  private next = 0;

  constructor() {
    this.pos.fill(-1000);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.points = new Points(g, new PointsMaterial({ color: 0x8c877c, size: 0.045, transparent: true, opacity: 0.75, depthWrite: false }));
    this.points.frustumCulled = false;
    this.points.name = 'dust';
  }

  burst(at: Vector3, count = 10, spread = 1): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % N;
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([(Math.random() - 0.5) * 1.6 * spread, Math.random() * 1.2 * spread, (Math.random() - 0.5) * 1.6 * spread], i * 3);
      this.age[i] = 0;
    }
  }

  update(dt: number): void {
    let live = false;
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= LIFE) continue;
      live = true;
      this.age[i] += dt;
      const o = i * 3;
      if (this.age[i] >= LIFE) {
        this.pos[o + 1] = -1000;
        continue;
      }
      this.vel[o + 1] -= 2.5 * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[o + a] *= 1 - 2.2 * dt;
        this.pos[o + a] += this.vel[o + a] * dt;
      }
    }
    if (live) (this.points.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}
