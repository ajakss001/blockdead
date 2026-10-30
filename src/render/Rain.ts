import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, type Scene, ShaderMaterial, Vector2, Vector3 } from 'three';

const N = 900;
/** The box of rain round the camera: width (x, z) and height, m. */
const SIZE = 26;
const HEIGHT = 14;

/**
 * Rain: thin falling streaks in a box round the camera, one mesh (one draw call), no per-frame uploads —
 * the vertex shader moves every streak (fall, wind slant, wrap round the camera anchored to the world, so
 * they don't swim as you turn). How many are drawn follows the rain's strength.
 */
export class Rain {
  readonly mesh: Mesh;
  private readonly uniforms = {
    uCenter: { value: new Vector3() },
    uTime: { value: 0 },
    uWind: { value: new Vector2() },
    uRain: { value: 0 },
  };

  constructor(scene: Scene) {
    const seed = new Float32Array(N * 4 * 3);
    const corner = new Float32Array(N * 4 * 2);
    const index = new Uint16Array(N * 6);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 4; k++) {
        seed.set(s, (i * 4 + k) * 3);
        corner.set([k % 2 ? 0.5 : -0.5, k < 2 ? 0 : 1], (i * 4 + k) * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const g = new BufferGeometry();
    // Position is unused (the shader builds it) but three wants one.
    g.setAttribute('position', new BufferAttribute(new Float32Array(N * 4 * 3), 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 3));
    g.setAttribute('aCorner', new BufferAttribute(corner, 2));
    g.setIndex(new BufferAttribute(index, 1));
    const mat = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: DoubleSide });
    this.mesh = new Mesh(g, mat);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Strength 0..1 (0 hides it), where the camera is, the wind (m/s on x, z). */
  update(time: number, rain: number, camera: Vector3, windX: number, windZ: number, show: boolean): void {
    const n = Math.floor(N * rain);
    this.mesh.visible = show && n > 0;
    if (!this.mesh.visible) return;
    this.mesh.geometry.setDrawRange(0, n * 6);
    const u = this.uniforms;
    u.uCenter.value.copy(camera);
    u.uTime.value = time;
    u.uWind.value.set(windX, windZ);
    u.uRain.value = rain;
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
varying float vA;
const float SIZE = ${SIZE.toFixed(1)};
const float HEIGHT = ${HEIGHT.toFixed(1)};
void main() {
  vec2 xz = uCenter.xz + mod(aSeed.xy * SIZE - uCenter.xz, SIZE) - SIZE * 0.5;
  float fall = 9.0 + aSeed.z * 2.0;
  float y = uCenter.y - 5.0 + mod(aSeed.z * HEIGHT - uTime * fall, HEIGHT);
  vec3 base = vec3(xz.x, y, xz.y);
  vec3 dir = normalize(vec3(uWind.x, -fall, uWind.y));
  vec3 toCam = normalize(cameraPosition - base);
  vec3 across = normalize(cross(dir, toCam));
  vec3 p = base + across * aCorner.x * 0.03 - dir * aCorner.y * 0.7;
  vA = 1.0 - aCorner.y * 0.7;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  // Thinner far off, none right in the face.
  vA *= smoothstep(0.4, 1.5, -mv.z) * (1.0 - smoothstep(10.0, 16.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uRain;
varying float vA;
void main() {
  gl_FragColor = vec4(0.72, 0.76, 0.82, 0.6 * vA * (0.5 + 0.5 * uRain));
}`;
