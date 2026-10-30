import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Which model an instance shows. */
export const CRITTER = { crow: 0, rat: 1, cart: 2 } as const;
const CAP = 32;

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/**
 * Small moving things of the street — crows, rats, a shopping cart — in one InstancedMesh (one draw call):
 * the geometry holds all three models, each instance shows one (the others collapse to a point in the
 * vertex shader). Crows flap their wings and rats scurry in the shader too.
 */
export class Critters {
  readonly mesh: InstancedMesh;
  private readonly prop: InstancedBufferAttribute;
  private readonly uniforms = { uTime: { value: 0 } };
  private n = 0;

  constructor(scene: Scene) {
    const geo = model();
    this.prop = new InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    this.prop.setUsage(DynamicDrawUsage);
    geo.setAttribute('aProp', this.prop);
    const mat = new MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPart;\nattribute float aWing;\nattribute vec4 aProp;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
if (abs(aPart - aProp.x) > 0.5) transformed = vec3(0.0);
else {
  float fl = aProp.y;
  // Wings: spread and beating in flight, folded along the body at rest.
  if (aWing > 0.0) {
    transformed.x *= mix(0.4, 1.0, fl);
    transformed.y += aWing * sin(uTime * 24.0 + aProp.z) * 0.14 * fl;
  }
  // A rat's scurry: a quick bob.
  if (aPart > 0.5 && aPart < 1.5) transformed.y += abs(sin(uTime * 28.0 + aProp.z)) * 0.012 * fl;
}`,
        );
    };
    mat.customProgramCacheKey = () => 'critters';
    this.mesh = new InstancedMesh(geo, mat, CAP);
    this.mesh.name = 'critters';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.mesh);
  }

  /** Start a frame's list of critters. */
  begin(time: number): void {
    this.uniforms.uTime.value = time;
    this.n = 0;
  }

  /** One critter: which, where (feet), heading (yaw), nose up/down (pitch), wings / legs moving 0..1. */
  add(part: number, x: number, y: number, z: number, yaw: number, pitch: number, move: number, phase: number, scale = 1): void {
    if (this.n >= CAP) return;
    _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s.setScalar(scale));
    this.mesh.setMatrixAt(this.n, _m);
    this.prop.setXYZW(this.n, part, move, phase, 0);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    if (this.n === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.prop.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
  }
}

/** The three models in one geometry (forward = +Z, feet at y = 0), tagged by part and wing. */
function model(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const c = new Color();
  const box = (part: number, color: number, x: number, y: number, z: number, w: number, h: number, d: number, wing = 0, rx = 0) => {
    const g = new BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    c.set(color);
    const col = new Float32Array(n * 3);
    const wg = new Float32Array(n);
    const pos = g.getAttribute('position');
    for (let i = 0; i < n; i++) {
      col.set([c.r, c.g, c.b], i * 3);
      // Wing: how far from the body (0 at the root, 1 at the tip).
      wg[i] = wing ? Math.min(1, Math.abs(pos.getX(i)) / 0.3) : 0;
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('aPart', new Float32BufferAttribute(new Float32Array(n).fill(part), 1));
    g.setAttribute('aWing', new Float32BufferAttribute(wg, 1));
    parts.push(g);
  };
  // Crow.
  const CROW = 0x18181a;
  box(0, CROW, 0, 0.11, 0, 0.11, 0.1, 0.26);
  box(0, CROW, 0, 0.17, 0.15, 0.08, 0.08, 0.09);
  box(0, 0x2a2622, 0, 0.165, 0.215, 0.025, 0.025, 0.06);
  box(0, CROW, 0, 0.1, -0.18, 0.08, 0.015, 0.14, 0, -0.25);
  box(0, CROW, 0.16, 0.13, -0.01, 0.22, 0.012, 0.15, 1);
  box(0, CROW, -0.16, 0.13, -0.01, 0.22, 0.012, 0.15, 1);
  box(0, 0x3a3428, 0.03, 0.03, 0, 0.012, 0.06, 0.012);
  box(0, 0x3a3428, -0.03, 0.03, 0, 0.012, 0.06, 0.012);
  // Rat.
  const RAT = 0x463e36;
  box(1, RAT, 0, 0.04, 0, 0.07, 0.06, 0.17);
  box(1, RAT, 0, 0.045, 0.105, 0.05, 0.045, 0.06);
  box(1, 0x7a5e58, 0, 0.03, -0.17, 0.012, 0.012, 0.18);
  // Shopping cart: a wire basket on legs, a red handle, four small wheels.
  const WIRE = 0x8a8c8e;
  box(2, WIRE, 0, 0.45, 0, 0.55, 0.02, 0.85);
  box(2, WIRE, 0.27, 0.68, 0, 0.02, 0.45, 0.85);
  box(2, WIRE, -0.27, 0.68, 0, 0.02, 0.45, 0.85);
  box(2, WIRE, 0, 0.66, 0.42, 0.55, 0.42, 0.02);
  box(2, WIRE, 0, 0.7, -0.42, 0.55, 0.5, 0.02);
  box(2, 0x8a2a20, 0, 0.98, -0.52, 0.56, 0.04, 0.04);
  for (const [x, z] of [
    [0.22, 0.36],
    [-0.22, 0.36],
    [0.22, -0.36],
    [-0.22, -0.36],
  ] as const) {
    box(2, WIRE, x, 0.27, z, 0.025, 0.36, 0.025);
    box(2, 0x1a1a1a, x, 0.05, z, 0.03, 0.1, 0.1);
  }
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
}
