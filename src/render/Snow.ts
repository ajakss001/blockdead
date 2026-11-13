import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, type Scene, ShaderMaterial, Vector2, Vector3 } from 'three';

const N = 1100;
const SIZE = 28;
const HEIGHT = 14;

/**
 * Snowfall: soft drifting flakes in a box round the camera, 1 draw call, GPU-animated.
 */
export class Snow {
  readonly mesh: Mesh;
  private readonly uniforms = {
    uCenter: { value: new Vector3() },
    uTime: { value: 0 },
    uWind: { value: new Vector2() },
    uSnow: { value: 0 },
  };

  constructor(scene: Scene) {
    const seed = new Float32Array(N * 4 * 3);
    const corner = new Float32Array(N * 4 * 2);
    const index = new Uint16Array(N * 6);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 4; k++) {
        seed.set(s, (i * 4 + k) * 3);
        corner.set([k % 2 ? 0.5 : -0.5, k < 2 ? -0.5 : 0.5], (i * 4 + k) * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(N * 4 * 3), 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 3));
    g.setAttribute('aCorner', new BufferAttribute(corner, 2));
    g.setIndex(new BufferAttribute(index, 1));
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(g, mat);
    this.mesh.name = 'snow';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(time: number, snow: number, camera: Vector3, windX: number, windZ: number, show: boolean): void {
    const n = Math.floor(N * snow);
    this.mesh.visible = show && n > 0;
    if (!this.mesh.visible) return;
    this.mesh.geometry.setDrawRange(0, n * 6);
    const u = this.uniforms;
    u.uCenter.value.copy(camera);
    u.uTime.value = time;
    u.uWind.value.set(windX, windZ);
    u.uSnow.value = snow;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

const VERT = /* glsl */ `
attribute vec3 aSeed;
attribute vec2 aCorner;
uniform vec3 uCenter;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
varying float vA;
const float SIZE = ${SIZE.toFixed(1)};
const float HEIGHT = ${HEIGHT.toFixed(1)};
void main() {
  float fall = 1.45 + aSeed.z * 0.95;
  float driftX = uTime * uWind.x * 0.35 + sin(uTime * 1.4 + aSeed.x * 31.0) * 0.55;
  float driftZ = uTime * uWind.y * 0.35 + cos(uTime * 1.2 + aSeed.y * 29.0) * 0.55;
  vec2 xz = uCenter.xz + mod(aSeed.xy * SIZE + vec2(driftX, driftZ) - uCenter.xz, SIZE) - SIZE * 0.5;
  float y = uCenter.y - 4.5 + mod(aSeed.z * HEIGHT - uTime * fall, HEIGHT);
  vec3 base = vec3(xz.x, y, xz.y);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float sz = 0.045 + aSeed.z * 0.032;
  vec3 p = base + (right * aCorner.x + up * aCorner.y) * sz;
  vUv = aCorner + 0.5;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vA = smoothstep(0.5, 1.8, -mv.z) * (1.0 - smoothstep(11.0, 17.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uSnow;
varying vec2 vUv;
varying float vA;
void main() {
  float d = length(vUv - 0.5);
  float alpha = smoothstep(0.5, 0.12, d) * vA * (0.45 + 0.4 * uSnow);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(0.92, 0.95, 1.0, alpha);
}`;
