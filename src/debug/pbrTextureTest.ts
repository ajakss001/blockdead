import './domStub';
import { BoxGeometry, ShaderLib, type WebGLProgramParametersWithUniforms } from 'three';
import sharp from 'sharp';
import { StaticBatch } from '../render/StaticBatch';
import { PBR_LAYERS, pbrMappingForSurface, SURFACES, type Surface } from '../render/look/surfaces';
import { initWorldMaterials, surfaceTextureAnisotropy, worldMaterials } from '../render/look/worldMaterials';

type FsMod = { existsSync(p: string): boolean; statSync(p: string): { size: number } };
const proc = (globalThis as unknown as { process: { getBuiltinModule(m: string): unknown } }).process;
const fs = proc.getBuiltinModule('node:fs') as FsMod;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export async function main(): Promise<number> {
  // 1) Verify all 18 1024x1024 PBR textures exist and carry genuine relief & roughness variance
  for (const name of PBR_LAYERS) {
    for (const kind of ['albedo', 'normal', 'rough'] as const) {
      const p = `public/textures/pbr/${name}_${kind}.jpg`;
      assert(fs.existsSync(p), `Missing PBR map: ${p}`);
      assert(fs.statSync(p).size > 15_000, `Suspiciously small PBR map ${p}: ${fs.statSync(p).size} B`);
      const meta = await sharp(p).metadata();
      assert(meta.width === 1024 && meta.height === 1024, `Expected 1024x1024 in ${p}, got ${meta.width}x${meta.height}`);
      const stats = await sharp(p).stats();
      if (kind === 'normal') {
        assert(stats.channels[2].mean >= 170, `Invalid NormalGL Z mean in ${p}: ${stats.channels[2].mean.toFixed(1)}`);
        assert(stats.channels[0].stdev >= 4 && stats.channels[1].stdev >= 4, `Flat NormalGL relief in ${p}`);
      }
      if (kind === 'rough') {
        assert(stats.channels[0].stdev >= 5, `Flat Roughness map in ${p}: stdev=${stats.channels[0].stdev.toFixed(2)}`);
      }
    }
  }

  // 2) Verify anisotropy = 8 and GLSL shader patches (albedo, normalMap, roughnessMap, castCut)
  initWorldMaterials('standard', 8);
  assert(surfaceTextureAnisotropy() === 8, `Expected anisotropy 8, got ${surfaceTextureAnisotropy()}`);

  const mats = worldMaterials();
  for (const [label, mat, expectCut] of [
    ['cast', mats.cast, false],
    ['castCut', mats.castCut, true],
    ['flat', mats.flat, false],
  ] as const) {
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    } as unknown as WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, null as never);

    assert(shader.uniforms.uPbrAlbedo && shader.uniforms.uPbrNrmRough && shader.uniforms.uPbrReady, `${label}: missing PBR uniforms`);
    assert(shader.fragmentShader.includes('pbrTangentFrame'), `${label}: missing pbrTangentFrame helper`);
    assert(shader.fragmentShader.includes('texture(uPbrAlbedo, vec3(pbrUv, pbrLayer))'), `${label}: missing uPbrAlbedo sampling`);
    assert(shader.fragmentShader.includes('texture(uPbrNrmRough, vec3(pbrUv, pbrLayer))'), `${label}: missing uPbrNrmRough sampling`);
    assert(shader.fragmentShader.includes('roughnessFactor = pbrActive > 0.5'), `${label}: missing roughnessFactor override`);
    assert(shader.fragmentShader.includes('normal = normalize(pbrTangentFrame'), `${label}: missing NormalGL perturbation`);
    if (expectCut) {
      assert(shader.fragmentShader.includes('if (texel.a < 0.6)'), `${label}: castCut window discard missing`);
    }
  }

  // 3) Verify world-space metric UV scaling across short (4m) and long (24m) walls (no stretching!)
  const pbrSurfaces: Surface[] = ['plaster', 'wood', 'tile', 'concrete', 'asphalt', 'facadeBrick', 'facadeConcrete', 'facadeOffice'];
  for (const surf of pbrSurfaces) {
    assert(pbrMappingForSurface(surf) !== null, `Missing PBR mapping for surface ${surf}`);
    const spec = SURFACES[surf];
    const unitBox = new BoxGeometry(1, 1, 1);
    const batchShort = new StaticBatch();
    const batchLong = new StaticBatch();

    // Build 4m x 3m and 24m x 3m walls and compare UVs per meter
    const { Matrix4, Vector3, Quaternion } = await import('three');
    const q = new Quaternion();
    batchShort.add(unitBox, 0xffffff, new Matrix4().compose(new Vector3(2, 1.5, 0), q, new Vector3(4, 3, 0.3)), surf);
    batchLong.add(unitBox, 0xffffff, new Matrix4().compose(new Vector3(12, 1.5, 0), q, new Vector3(24, 3, 0.3)), surf);

    const bufShort = batchShort.buildBuffers()[0];
    const bufLong = batchLong.buildBuffers()[0];
    const frontFaceUvSpan = (uv: Float32Array, nrm: Int8Array) => {
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      const count = uv.length / 2;
      for (let i = 0; i < count; i++) {
        // Front wall (+Z face): aSurfUv = (x / tile, y / tileV)
        if (nrm[i * 3 + 2] < 100) continue;
        const u = uv[i * 2];
        const v = uv[i * 2 + 1];
        if (u < u0) u0 = u;
        if (u > u1) u1 = u;
        if (v < v0) v0 = v;
        if (v > v1) v1 = v;
      }
      return { du: u1 - u0, dv: v1 - v0 };
    };
    const s = frontFaceUvSpan(bufShort.surfUv, bufShort.normal);
    const l = frontFaceUvSpan(bufLong.surfUv, bufLong.normal);
    const expectedU4 = 4 / spec.tile;
    const expectedU24 = 24 / spec.tile;
    const expectedV = 3 / (spec.tileV ?? spec.tile);
    assert(Math.abs(s.du - expectedU4) < 1e-4, `${surf} 4m wall UV span mismatch: ${s.du} vs ${expectedU4}`);
    assert(Math.abs(l.du - expectedU24) < 1e-4, `${surf} 24m wall UV span mismatch: ${l.du} vs ${expectedU24}`);
    assert(Math.abs(l.du / s.du - 6) < 1e-4, `${surf} wall UV tiling stretched between 4m and 24m`);
    assert(Math.abs(s.dv - expectedV) < 1e-4 && Math.abs(l.dv - expectedV) < 1e-4, `${surf} height UV span mismatch`);
    unitBox.dispose();
  }

  console.log('[pbrTextureTest] ALL CHECKS PASSED (18x 1024x1024 PBR maps, NormalGL+Roughness shaders, anisotropy=8, world-space metric UVs).');
  return 0;
}
