import { InstancedBufferAttribute, InstancedMesh, Matrix4, type MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { type Zombie, ZombieSim } from '../systems/zombies';
import { characterMaterial } from './look/materials';
import { bodyGeometry, HIP_X, HIP_Y, NECK_Y, SHOULDER_X, SHOULDER_Y } from './zombieBody';

/**
 * All living zombies in one draw call: an InstancedMesh of a low-poly body (~170 triangles). The shamble is
 * done in the vertex shader from a few numbers per zombie (walk phase, how much it walks): legs and arms
 * swing about the hips and shoulders, the torso leans forward, the head lolls (zombieBody.aliveJoint is the
 * same on the CPU: a ragdoll starts from it). The dead are drawn by CorpseBatch from their ragdolls.
 * Clothes and skin colours per zombie from a muted palette. No blood (kid-friendly).
 */

const SHIRTS = [0x4a4d52, 0x4a503a, 0x7a7262, 0x37465a, 0x5a4434, 0x2c2f35, 0x6a5848, 0x3a4a3e, 0x6e3b32];
const PANTS_C = [0x263247, 0x1f2124, 0x5a5242, 0x332f2a, 0x34405a];
const SKINS = [0x7d8a76, 0x8a8c7c, 0x6f7d70, 0x938d7c];

const f = (n: number) => n.toFixed(3);

export class ZombieCrowd {
  readonly mesh: InstancedMesh;
  private readonly anim: InstancedBufferAttribute;
  private readonly cloth: InstancedBufferAttribute;
  private readonly pants: InstancedBufferAttribute;
  private readonly skin: InstancedBufferAttribute;
  private readonly time = { value: 0 };
  /** The shader's clock (a ragdoll starting from a zombie's pose needs it). */
  clock = 0;

  constructor(readonly capacity: number) {
    const geo = bodyGeometry();
    this.anim = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.cloth = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.pants = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.skin = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    geo.setAttribute('aAnim', this.anim);
    geo.setAttribute('aCloth', this.cloth);
    geo.setAttribute('aPants', this.pants);
    geo.setAttribute('aSkin', this.skin);
    // The same grungy cloth as the player's own clothes (white, tinted per part and zombie in the shader).
    const mat = characterMaterial('jacket', 0xdedede).clone();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aPart; attribute float aJoint; attribute vec3 aAnim;
          attribute vec3 aCloth; attribute vec3 aPants; attribute vec3 aSkin;
          uniform float uTime;
          varying vec3 vTint;
          mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
          // The pose of a vertex: a leg or an arm swinging (knee and elbow ride along), the upper body leaning.
          vec3 zpose(vec3 p, out mat3 r) {
            float ph = aAnim.x, g = max(0.0, aAnim.y), v = aAnim.z;
            float sw = sin(ph) * g;
            r = mat3(1.0);
            int jt = int(aJoint + 0.5);
            if (jt == 1 || jt == 2 || jt == 6 || jt == 7) {
              float s = (jt == 1 || jt == 6) ? -1.0 : 1.0;
              mat3 rh = rotX((jt == 1 || jt == 6 ? sw : -sw) * 0.45);
              vec3 hp = vec3(${f(HIP_X)} * s, ${f(HIP_Y)}, 0.0);
              r = rh;
              return rh * (p - hp) + hp;
            }
            if (jt == 3 || jt == 4 || jt == 8 || jt == 9) {
              // Arms half raised forward, swinging a little against the legs, the left one hanging lower.
              float s = (jt == 3 || jt == 8) ? -1.0 : 1.0;
              float lift = -0.55 - 0.25 * v - (s < 0.0 ? 0.0 : 0.25) + 0.12 * sin(uTime * 1.3 + v * 6.0);
              mat3 ra = rotX(lift + (jt == 3 || jt == 8 ? -sw : sw) * 0.18);
              vec3 sh = vec3(${f(SHOULDER_X)} * s, ${f(SHOULDER_Y)}, 0.0);
              p = ra * (p - sh) + sh;
              r = ra;
            }
            if (jt == 5) {
              // Head lolling to one side.
              mat3 hm = rotZ(0.25 * (v - 0.5) + 0.06 * sin(uTime * 0.9 + v * 9.0)) * rotX(0.2);
              vec3 nk = vec3(0.0, ${f(NECK_Y)}, 0.0);
              p = hm * (p - nk) + nk;
              r = hm;
            }
            // Torso: leaning forward and rocking with the steps.
            mat3 t = rotZ(0.06 * sin(ph) * g) * rotX(0.22 + 0.08 * g);
            p = t * (p - vec3(0.0, ${f(HIP_Y)}, 0.0)) + vec3(0.0, ${f(HIP_Y)}, 0.0);
            r = t * r;
            return p;
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `mat3 zr; vec3 zp = zpose(position, zr);
          vec3 objectNormal = zr * normal;
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
          #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = zp;
          vTint = aPart < 0.5 ? aSkin : aPart < 1.5 ? aCloth : aPart < 2.5 ? aPants : vec3(0.12, 0.11, 0.1);`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vTint, opacity );');
    };
    mat.customProgramCacheKey = () => 'zombies-jointed';
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.name = 'zombies';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Instances from the simulation (nearest first is not needed: the sim keeps fewer than capacity). */
  update(list: readonly Zombie[], dt: number): void {
    this.time.value += dt;
    this.clock = this.time.value;
    const m = _m;
    const a = this.anim.array as Float32Array;
    let i = 0;
    for (const z of list) {
      if (z.state === 'dead') continue;
      if (i >= this.capacity) break;
      // Kind (size, slimmer women), a shudder when hit.
      const s = ZombieSim.scale(z);
      _pos.copy(z.pos);
      _q.setFromAxisAngle(_up, z.yaw);
      if (z.shake > 0) _pos.x += (Math.random() - 0.5) * 0.06 * z.shake * 4, _pos.z += (Math.random() - 0.5) * 0.06 * z.shake * 4;
      if (z.state === 'stagger') _q.multiply(_qf.setFromAxisAngle(_xAxis, -0.25));
      m.compose(_pos, _q, _sc.set(s * (z.kind === 'woman' ? 0.9 : 1), s, s));
      this.mesh.setMatrixAt(i, m);
      a[i * 3] = z.phase;
      a[i * 3 + 1] = z.gait;
      a[i * 3 + 2] = (z.look % 97) / 97;
      if (this.ids[i] !== z.id) {
        this.ids[i] = z.id;
        const t = zombieTints(z, _tint);
        this.cloth.setXYZ(i, t[3], t[4], t[5]);
        this.pants.setXYZ(i, t[6], t[7], t[8]);
        this.skin.setXYZ(i, t[0], t[1], t[2]);
      }
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
    this.cloth.needsUpdate = true;
    this.pants.needsUpdate = true;
    this.skin.needsUpdate = true;
  }

  private readonly ids: number[] = [];

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _pos = new Vector3();
const _sc = new Vector3();
const _qf = new Quaternion();
const _xAxis = new Vector3(1, 0, 0);

const _tint = new Float32Array(9);

function setColor(out: Float32Array, at: number, hex: number, k: number): void {
  out[at] = (((hex >> 16) & 255) / 255) * k;
  out[at + 1] = (((hex >> 8) & 255) / 255) * k;
  out[at + 2] = ((hex & 255) / 255) * k;
}

/** A zombie's colours, skin / shirt / pants (rgb each): a dead survivor's own, else from the palette by look. */
export function zombieTints(z: Zombie, out = new Float32Array(9)): Float32Array {
  const l = z.look;
  if (z.twin) {
    setColor(out, 0, z.twin.colors[2], 0.8);
    setColor(out, 3, z.twin.colors[0], 0.85);
    setColor(out, 6, z.twin.colors[1], 0.85);
  } else if (z.uniform) {
    setColor(out, 0, SKINS[(l >> 4) % SKINS.length], 1);
    setColor(out, 3, z.uniform.shirt, 0.8 + ((l >> 3) % 4) * 0.05);
    setColor(out, 6, z.uniform.pants, 0.8 + ((l >> 5) % 4) * 0.05);
  } else {
    setColor(out, 0, SKINS[(l >> 4) % SKINS.length], 1);
    setColor(out, 3, SHIRTS[l % SHIRTS.length], 0.75 + ((l >> 3) % 5) * 0.06);
    setColor(out, 6, PANTS_C[(l >> 2) % PANTS_C.length], 0.8 + ((l >> 5) % 4) * 0.05);
  }
  return out;
}
