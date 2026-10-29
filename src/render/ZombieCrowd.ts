import {
  BoxGeometry,
  type BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Zombie } from '../systems/zombies';
import { characterMaterial } from './look/materials';

/**
 * All zombies in one draw call: an InstancedMesh of a low-poly body (~150 triangles). The shamble is
 * done in the vertex shader from two numbers per zombie (walk phase, how much it walks): legs and arms
 * swing about the hips and shoulders, the torso leans forward, the head lolls. Clothes and skin colors
 * per zombie from a muted palette. No blood (kid-friendly): torn, dirty clothes and grey skin only.
 */

// Part ids (vertex attribute aPart): what color, and which joint it hangs from.
const SKIN = 0;
const SHIRT = 1;
const PANTS = 2;
const SHOES = 3;
// Joints (aJoint): 0 torso/head, 1/2 left/right leg, 3/4 left/right arm, 5 head.
const HIP_Y = 0.9;
const SHOULDER_Y = 1.42;

const SHIRTS = [0x4a4d52, 0x4a503a, 0x7a7262, 0x37465a, 0x5a4434, 0x2c2f35, 0x6a5848, 0x3a4a3e, 0x6e3b32];
const PANTS_C = [0x263247, 0x1f2124, 0x5a5242, 0x332f2a, 0x34405a];
const SKINS = [0x7d8a76, 0x8a8c7c, 0x6f7d70, 0x938d7c];

function part(geo: BufferGeometry, color: number, joint: number): BufferGeometry {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('aPart', new Float32BufferAttribute(new Array(n).fill(color), 1));
  geo.setAttribute('aJoint', new Float32BufferAttribute(new Array(n).fill(joint), 1));
  return geo;
}

function bodyGeometry(): BufferGeometry {
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new BoxGeometry(sx, sy, sz).translate(x, y, z);
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const leg = s < 0 ? 1 : 2;
    parts.push(part(box(0.15, 0.8, 0.17, 0.1 * s, 0.5, 0), PANTS, leg));
    parts.push(part(box(0.14, 0.1, 0.26, 0.1 * s, 0.05, 0.04), SHOES, leg));
    const arm = s < 0 ? 3 : 4;
    parts.push(part(box(0.11, 0.34, 0.12, 0.25 * s, SHOULDER_Y - 0.17, 0), SHIRT, arm));
    parts.push(part(box(0.09, 0.3, 0.1, 0.25 * s, SHOULDER_Y - 0.49, 0.01), SKIN, arm));
    parts.push(part(box(0.09, 0.09, 0.07, 0.25 * s, SHOULDER_Y - 0.68, 0.02), SKIN, arm));
  }
  parts.push(part(box(0.38, 0.28, 0.22, 0, 1.03, 0), SHIRT, 0));
  parts.push(part(box(0.42, 0.28, 0.24, 0, 1.3, 0), SHIRT, 0));
  parts.push(part(box(0.1, 0.08, 0.1, 0, 1.48, 0.01), SKIN, 5));
  parts.push(part(box(0.2, 0.23, 0.22, 0, 1.63, 0.02), SKIN, 5));
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}

export class ZombieCrowd {
  readonly mesh: InstancedMesh;
  private readonly anim: InstancedBufferAttribute;
  private readonly cloth: InstancedBufferAttribute;
  private readonly pants: InstancedBufferAttribute;
  private readonly skin: InstancedBufferAttribute;
  private readonly time = { value: 0 };

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
          uniform float uTime; varying vec3 vTint;
          mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
          // The pose of a vertex: joint swing, then the whole upper body leaning from the hips.
          vec3 zpose(vec3 p, out mat3 r) {
            float ph = aAnim.x, g = aAnim.y, v = aAnim.z;
            float sw = sin(ph) * g;
            r = mat3(1.0);
            if (aJoint > 0.5 && aJoint < 2.5) {
              float a = (aJoint < 1.5 ? sw : -sw) * 0.45;
              r = rotX(a);
              p = r * (p - vec3(0.0, ${HIP_Y.toFixed(2)}, 0.0)) + vec3(0.0, ${HIP_Y.toFixed(2)}, 0.0);
              return p;
            }
            if (aJoint > 2.5 && aJoint < 4.5) {
              // Arms half raised forward, swinging a little against the legs, the left one hanging lower.
              float side = aJoint < 3.5 ? -1.0 : 1.0;
              float lift = -0.55 - 0.25 * v - (side < 0.0 ? 0.0 : 0.25) + 0.12 * sin(uTime * 1.3 + v * 6.0);
              float a = lift + (aJoint < 3.5 ? -sw : sw) * 0.18;
              r = rotX(a);
              vec3 sh = vec3(0.25 * side, ${SHOULDER_Y.toFixed(2)}, 0.0);
              p = r * (p - sh) + sh;
            }
            if (aJoint > 4.5) {
              // Head lolling to one side.
              mat3 h = rotZ(0.25 * (v - 0.5) + 0.06 * sin(uTime * 0.9 + v * 9.0)) * rotX(0.2);
              vec3 nk = vec3(0.0, 1.46, 0.0);
              p = h * (p - nk) + nk;
              r = h;
            }
            // Torso: leaning forward and rocking with the steps.
            mat3 t = rotZ(0.06 * sin(ph) * g) * rotX(0.22 + 0.08 * g);
            p = t * (p - vec3(0.0, ${HIP_Y.toFixed(2)}, 0.0)) + vec3(0.0, ${HIP_Y.toFixed(2)}, 0.0);
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
        .replace('#include <begin_vertex>', `vec3 transformed = zp;
          vTint = aPart < 0.5 ? aSkin : aPart < 1.5 ? aCloth : aPart < 2.5 ? aPants : vec3(0.12, 0.11, 0.1);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vTint, opacity );');
    };
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.name = 'zombies';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Instances from the simulation (nearest first is not needed: the sim keeps fewer than capacity). */
  update(list: readonly Zombie[], dt: number): void {
    this.time.value += dt;
    const n = Math.min(list.length, this.capacity);
    const m = _m;
    const a = this.anim.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const z = list[i];
      m.compose(z.pos, _q.setFromAxisAngle(_up, z.yaw), _one);
      this.mesh.setMatrixAt(i, m);
      a[i * 3] = z.phase;
      a[i * 3 + 1] = z.gait;
      a[i * 3 + 2] = (z.look % 97) / 97;
      if (this.ids[i] !== z.id) {
        this.ids[i] = z.id;
        const l = z.look;
        setColor(this.cloth, i, SHIRTS[l % SHIRTS.length], 0.75 + ((l >> 3) % 5) * 0.06);
        setColor(this.pants, i, PANTS_C[(l >> 2) % PANTS_C.length], 0.8 + ((l >> 5) % 4) * 0.05);
        setColor(this.skin, i, SKINS[(l >> 4) % SKINS.length], 1);
      }
    }
    this.mesh.count = n;
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
const _one = new Vector3(1, 1, 1);

function setColor(attr: InstancedBufferAttribute, i: number, hex: number, k: number): void {
  attr.setXYZ(i, (((hex >> 16) & 255) / 255) * k, (((hex >> 8) & 255) / 255) * k, ((hex & 255) / 255) * k);
}
