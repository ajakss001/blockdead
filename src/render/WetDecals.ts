import { AddEquation, CustomBlending, DoubleSide, SrcColorFactor, ZeroFactor, DynamicDrawUsage, type Fog, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, type Scene, ShaderMaterial, Vector3 } from 'three';

const CAP = 220;
/** The last few instances are ripples, reused in turn. */
const RIPPLES = 24;
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);

/**
 * Water in the buildings, one InstancedMesh (one draw call): wet stains with a tide line on the ceiling
 * over a leak, the puddle under it, rings spreading where a drop lands or a foot steps in. Flat quads that
 * darken what is under them (multiply), so they read right in any light and vanish in the dark; a small
 * shader draws them (noise edges, no textures).
 */
export class WetDecals {
  readonly mesh: InstancedMesh;
  private readonly data: InstancedBufferAttribute;
  private readonly mat: ShaderMaterial;
  private fixed = 0;
  private ripple = 0;
  private time = 0;

  constructor(private readonly scene: Scene) {
    const quad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.data = new InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    this.data.setUsage(DynamicDrawUsage);
    quad.setAttribute('aWet', this.data);
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFog: { value: new Vector3(3, 50, 0) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: ZeroFactor,
      blendDst: SrcColorFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(quad, this.mat, CAP);
    this.mesh.name = 'wet';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.mesh);
  }

  /**
   * Leaks: [x, ceilingY, z, floorY, seed]… — a stain above, a puddle below each; pools: [x, y, z, size,
   * strength]… — puddles on their own (a broken hydrant, the rain), strength fading them in and out.
   */
  setLeaks(leaks: number[], pools: number[] = []): void {
    let n = 0;
    for (let i = 0; i + 4 < leaks.length && n + 2 <= CAP - RIPPLES; i += 5) {
      const seed = leaks[i + 4];
      const size = 0.9 + seed * 0.9;
      _m.compose(_p.set(leaks[i], leaks[i + 1] - 0.005, leaks[i + 2]), _q.setFromAxisAngle(_x, Math.PI), _s.set(size, 1, size * (0.8 + seed * 0.4)));
      this.mesh.setMatrixAt(n, _m);
      this.data.setXYZW(n++, 0, seed, 0, 1);
      const pool = 0.7 + seed * 0.8;
      _m.compose(_p.set(leaks[i], leaks[i + 3] + 0.006, leaks[i + 2]), _q.identity(), _s.set(pool, 1, pool * (0.7 + seed * 0.5)));
      this.mesh.setMatrixAt(n, _m);
      this.data.setXYZW(n++, 1, seed, 0, 1);
    }
    for (let i = 0; i + 4 < pools.length && n + 1 <= CAP - RIPPLES; i += 5) {
      const size = pools[i + 3];
      _m.compose(_p.set(pools[i], pools[i + 1] + 0.008, pools[i + 2]), _q.setFromAxisAngle(_y, size * 7.1), _s.set(size, 1, size * 0.75));
      this.mesh.setMatrixAt(n, _m);
      this.data.setXYZW(n++, 1, (size * 3.7) % 1, 0, pools[i + 4]);
    }
    this.fixed = n;
    // Ripples follow, idle until used.
    for (let k = 0; k < RIPPLES; k++) {
      _m.compose(_p.set(0, -1000, 0), _q.identity(), _s.set(1, 1, 1));
      this.mesh.setMatrixAt(n + k, _m);
      this.data.setXYZW(n + k, 2, 0, -100, 1);
    }
    this.mesh.count = n + RIPPLES;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.data.needsUpdate = true;
  }

  /** A ring spreading on the water at (x, y, z); `size` m across at its widest. */
  addRipple(x: number, y: number, z: number, size = 0.5): void {
    const i = this.fixed + this.ripple;
    this.ripple = (this.ripple + 1) % RIPPLES;
    _m.compose(_p.set(x, y + 0.009, z), _q.identity(), _s.set(size, 1, size));
    this.mesh.setMatrixAt(i, _m);
    this.data.setXYZW(i, 2, Math.random(), this.time, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.data.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    const fog = this.scene.fog as Fog | null;
    if (fog) this.mat.uniforms.uFog.value.set(fog.near, fog.far, 0);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

const VERT = /* glsl */ `
attribute vec4 aWet; // kind (0 stain, 1 puddle, 2 ripple), seed, start time, strength
varying vec2 vUv;
varying vec4 vWet;
varying float vDepth;
void main() {
  vUv = uv;
  vWet = aWet;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFog;
varying vec2 vUv;
varying vec4 vWet;
varying float vDepth;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 c = vUv - 0.5;
  float seed = vWet.y * 17.0;
  float r = length(c) * 2.0;
  // A ragged edge: the radius wobbles with noise round the rim.
  float edge = 0.78 + 0.22 * noise(normalize(c + 1e-4) * 2.5 + seed) + 0.08 * noise(c * 9.0 + seed);
  vec3 col;
  float a;
  if (vWet.x < 0.5) {
    // A ceiling stain: brownish damp, darker at the tide line, a second ring inside.
    float inside = smoothstep(edge, edge - 0.08, r);
    float tide = smoothstep(0.1, 0.0, abs(r - edge + 0.05)) + 0.6 * smoothstep(0.06, 0.0, abs(r - edge * 0.6));
    col = vec3(0.42, 0.33, 0.2);
    a = inside * (0.45 + 0.3 * noise(c * 6.0 + seed)) + tide * 0.5 * inside;
  } else if (vWet.x < 1.5) {
    // A puddle: dark, still water.
    float inside = smoothstep(edge, edge - 0.06, r);
    col = vec3(0.3, 0.32, 0.36);
    a = inside * 0.85;
  } else {
    // A ripple: a thin ring spreading out and fading over a second.
    float age = uTime - vWet.z;
    float rad = age * 1.3;
    float ring = smoothstep(0.07, 0.0, abs(r - rad)) * (1.0 - smoothstep(0.0, 1.0, age));
    col = vec3(0.45, 0.47, 0.5);
    a = ring * 0.6 * step(0.0, age);
  }
  float fog = smoothstep(uFog.x, uFog.y, vDepth);
  a *= (1.0 - fog) * vWet.w;
  if (a < 0.01) discard;
  // Multiply: white leaves the surface as it is, the colour darkens it.
  gl_FragColor = vec4(mix(vec3(1.0), col, clamp(a, 0.0, 1.0)), 1.0);
}`;
