#!/usr/bin/env node
/**
 * Extracts all 40 3D models from C:\Users\pmoro\Downloads\newmodel.zip (Deflate64 via 7z.exe),
 * normalizes orientation (nose along -Z for vehicles/aircraft), centers XZ & sets Box3.min.y = 0
 * in vertex coordinates, splits Mi-8 rotors into animated sub-nodes, compresses textures (512/1024 JPEG)
 * & meshopt geometry, and emits public/models/world/*.glb + manifest.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ZIP_PATH = 'C:\\Users\\pmoro\\Downloads\\newmodel.zip';
const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const OUT_DIR = 'public/models/world';

const CATALOG = [
  // 1. Vehicles (15) — raw nose faces -X -> rotY = -PI/2 aligns nose to -Z
  { file: 'gaz_tigr_4x4_17k.glb', category: 'vehicle', length: 5.7, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'zsu_23_4_shilka_14k.glb', category: 'vehicle', length: 6.5, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'omon_swat_van_17k.glb', category: 'vehicle', length: 6.2, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'Police_Sedan_DPS_22k.glb', category: 'vehicle', length: 4.6, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'gazelle_ambulance_17k.glb', category: 'vehicle', length: 5.6, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'kamaz_fire_truck_20k.glb', category: 'vehicle', length: 8.2, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'emercom_pickup_17k.glb', category: 'vehicle', length: 5.3, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'Kamaz_6x6_25k.glb', category: 'vehicle', length: 7.8, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'paz_3205_bus_11000.glb', category: 'vehicle', length: 7.2, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'UAZ_Bukhanka_22k.glb', category: 'vehicle', length: 4.5, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'Luxury_SUV_Gelik_22k.glb', category: 'vehicle', length: 4.8, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'Sport_Sedan_22k.glb', category: 'vehicle', length: 4.6, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'Semi_Truck_Tractor_24.glb', category: 'vehicle', length: 7.0, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'Semi_Trailer_Cargo_20.glb', category: 'vehicle', length: 12.2, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'burned_car_wreck.glb', category: 'vehicle', length: 4.4, rotY: -Math.PI / 2, tex: 1024, sec: 512 },

  // 2. Aviation (3)
  { file: 'mi8_emercom_22k.glb', category: 'aviation', length: 18.2, rotY: -Math.PI / 2, tex: 1024, sec: 512, splitMi8: true },
  { file: 'mi8_wreck_remesh.glb', category: 'aviation', length: 15.5, rotY: -Math.PI / 2, tex: 1024, sec: 512 },
  { file: 'passenger_airliner_22.glb', category: 'aviation', length: 36.0, rotY: -Math.PI / 2, tex: 1024, sec: 512 },

  // 3. Signs & Street Infrastructure (10)
  { file: 'crosswalk_sign_1500.glb', category: 'sign', height: 2.6, rotY: 0, tex: 512, sec: 256 },
  { file: 'Sign_Bus_Stop_1500.glb', category: 'sign', height: 2.6, rotY: 0, tex: 512, sec: 256 },
  { file: 'Sign_Give_Way_1500.glb', category: 'sign', height: 2.5, rotY: 0, tex: 512, sec: 256 },
  { file: 'Sign_Main_Road_1500.glb', category: 'sign', height: 2.5, rotY: 0, tex: 512, sec: 256 },
  { file: 'Sign_No_Entry_1500.glb', category: 'sign', height: 2.5, rotY: 0, tex: 512, sec: 256 },
  { file: 'Sign_No_Stopping_1500.glb', category: 'sign', height: 2.5, rotY: 0, tex: 512, sec: 256 },
  { file: 'street_lamp_2000.glb', category: 'infra', height: 6.2, rotY: 0, tex: 512, sec: 256 },
  { file: 'traffic_light_2500.glb', category: 'infra', height: 5.5, rotY: 0, tex: 512, sec: 256 },
  { file: 'speed_bump_1000.glb', category: 'infra', width: 3.4, rotY: 0, tex: 512, sec: 256 },
  { file: 'Soviet_Bus_Stop_Shelt.glb', category: 'infra', width: 4.8, rotY: 0, tex: 1024, sec: 512 },

  // 4. Nature (3)
  { file: 'Dead_Autumn_Tree_6000.glb', category: 'nature', height: 9.5, rotY: 0, tex: 1024, sec: 512 },
  { file: 'Spruce_Pine_Tree_7000.glb', category: 'nature', height: 11.5, rotY: 0, tex: 1024, sec: 512 },
  { file: 'Urban_Bush_2500.glb', category: 'nature', height: 1.45, rotY: 0, tex: 512, sec: 256 },

  // 5. Post-Apoc, Camps & Fire Escape (9)
  { file: 'garbage_cluster_1500.glb', category: 'prop', width: 2.2, rotY: 0, tex: 512, sec: 256 },
  { file: 'Road_Debris_Cluster_2.glb', category: 'prop', width: 3.2, rotY: 0, tex: 512, sec: 256 },
  { file: 'Soviet_Dumpster_3000.glb', category: 'prop', width: 2.0, rotY: 0, tex: 512, sec: 256 },
  { file: 'abandoned_luggage_pil.glb', category: 'prop', width: 1.5, rotY: 0, tex: 512, sec: 256 },
  { file: 'checkpoint_barricade.glb', category: 'prop', width: 3.4, rotY: 0, tex: 512, sec: 256 },
  { file: 'quarantine_tent.glb', category: 'prop', width: 6.2, rotY: 0, tex: 1024, sec: 512 },
  { file: 'generator_light_tower.glb', category: 'prop', height: 4.2, rotY: 0, tex: 512, sec: 256 },
  { file: 'burn_barrel.glb', category: 'prop', height: 0.95, rotY: 0, tex: 512, sec: 256 },
  { file: 'fire_escape_smart_top.glb', category: 'structure', height: 3.2, rotY: 0, tex: 512, sec: 256 },
];

function applyYawY(v, yaw) {
  if (Math.abs(yaw) < 1e-6) return v;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function measureWorldMesh(doc) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const node of doc.getRoot().listNodes()) {
    const m = node.getMesh();
    if (!m) continue;
    const wm = node.getWorldMatrix();
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        const e = pos.getElement(i, [0, 0, 0]);
        const x = wm[0] * e[0] + wm[4] * e[1] + wm[8] * e[2] + wm[12];
        const y = wm[1] * e[0] + wm[5] * e[1] + wm[9] * e[2] + wm[13];
        const z = wm[2] * e[0] + wm[6] * e[1] + wm[10] * e[2] + wm[14];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ, sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ };
}

/** Bakes node transforms, rotates yawY, grounds minY=0, centers XZ, uniformly scales to target dimensions. */
function normalizeAndBakeGeometry(doc, entry) {
  const b0 = measureWorldMesh(doc);
  // Compute scale in target orientation
  const spanX = Math.abs(Math.sin(entry.rotY)) > 0.5 ? b0.sz : b0.sx;
  const spanZ = Math.abs(Math.sin(entry.rotY)) > 0.5 ? b0.sx : b0.sz;
  let scale = 1;
  if (entry.length) scale = entry.length / Math.max(1e-4, spanZ);
  else if (entry.width) scale = entry.width / Math.max(1e-4, spanX);
  else if (entry.height) scale = entry.height / Math.max(1e-4, b0.sy);

  // Transform every vertex into world space, rotate rotY, center XZ & shift minY = 0
  const root = doc.getRoot();
  const cX = (b0.minX + b0.maxX) * 0.5;
  const cZ = (b0.minZ + b0.maxZ) * 0.5;
  const rotC = applyYawY([0, 0, 0], entry.rotY);
  void rotC;

  for (const node of root.listNodes()) {
    const m = node.getMesh();
    if (!m) continue;
    const wm = node.getWorldMatrix();
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      const nrm = p.getAttribute('NORMAL');
      if (pos) {
        const out = new Float32Array(pos.getCount() * 3);
        for (let i = 0; i < pos.getCount(); i++) {
          const e = pos.getElement(i, [0, 0, 0]);
          const wx = wm[0] * e[0] + wm[4] * e[1] + wm[8] * e[2] + wm[12] - cX;
          const wy = wm[1] * e[0] + wm[5] * e[1] + wm[9] * e[2] + wm[13] - b0.minY;
          const wz = wm[2] * e[0] + wm[6] * e[1] + wm[10] * e[2] + wm[14] - cZ;
          const r = applyYawY([wx * scale, wy * scale, wz * scale], entry.rotY);
          out[i * 3] = r[0];
          out[i * 3 + 1] = r[1];
          out[i * 3 + 2] = r[2];
        }
        pos.setArray(out);
      }
      if (nrm) {
        const nOut = new Float32Array(nrm.getCount() * 3);
        for (let i = 0; i < nrm.getCount(); i++) {
          const e = nrm.getElement(i, [0, 0, 0]);
          const nx = wm[0] * e[0] + wm[4] * e[1] + wm[8] * e[2];
          const ny = wm[1] * e[0] + wm[5] * e[1] + wm[9] * e[2];
          const nz = wm[2] * e[0] + wm[6] * e[1] + wm[10] * e[2];
          const l = Math.hypot(nx, ny, nz) || 1;
          const r = applyYawY([nx / l, ny / l, nz / l], entry.rotY);
          nOut[i * 3] = r[0];
          nOut[i * 3 + 1] = r[1];
          nOut[i * 3 + 2] = r[2];
        }
        nrm.setArray(nOut);
      }
    }
    node.setTranslation([0, 0, 0]);
    node.setRotation([0, 0, 0, 1]);
    node.setScale([1, 1, 1]);
  }
}

/** Splits Mi-8 single mesh into fuselage + main_rotor (spinning Y) + tail_rotor (spinning X) child nodes. */
function splitMi8Rotors(doc) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const origNode = root.listNodes().find((n) => n.getMesh());
  const origMesh = origNode.getMesh();
  const prim = origMesh.listPrimitives()[0];
  const mat = prim.getMaterial();

  const pos = prim.getAttribute('POSITION');
  const nrm = prim.getAttribute('NORMAL');
  const uv = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices();
  const triCount = Math.floor((idx ? idx.getCount() : pos.getCount()) / 3);

  // Post-rotation & scaling coordinates: nose is -Z, tail is +Z!
  // Let's compute exact bounding box of Mi-8 (length = 18.2m along Z, minY = 0, center X/Z = 0)
  const b = measureWorldMesh(doc);
  const hullMidY = b.sy * 0.5;

  const bodyTris = [];
  const mainTris = [];
  const tailTris = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getScalar(t * 3) : t * 3;
    const i1 = idx ? idx.getScalar(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getScalar(t * 3 + 2) : t * 3 + 2;
    const a = pos.getElement(i0, [0, 0, 0]);
    const bv = pos.getElement(i1, [0, 0, 0]);
    const c = pos.getElement(i2, [0, 0, 0]);
    const mx = (a[0] + bv[0] + c[0]) / 3;
    const my = (a[1] + bv[1] + c[1]) / 3;
    const mz = (a[2] + bv[2] + c[2]) / 3;

    // Remember raw -X (nose) became -Z, raw +X (tail) became +Z, raw +Z became +X!
    // Tail rotor disk sits at +Z (> 6.8m from center), upper part of tail fin on +X side (> 0.55m) or above fin top
    const isTailRotor = mz > 6.8 && my > hullMidY + 0.65 && (mx > 0.55 || my > hullMidY + 1.32);
    // Main rotor spans wide X blades (|mx - 0.1| > 1.78) above fuselage roof or mast top above y > 4.22m in rotor zone (mz < 5.2)
    const isMainRotor =
      !isTailRotor &&
      mz < 5.2 &&
      (my > 4.22 || (my > 3.12 && (Math.abs(mx - 0.1) > 1.78 || mz < -4.9 || mz > 1.75)));

    if (isTailRotor) tailTris.push([i0, i1, i2]);
    else if (isMainRotor) mainTris.push([i0, i1, i2]);
    else bodyTris.push([i0, i1, i2]);
  }

  const buildSubPrimitive = (triList, name, recenterPivot) => {
    const remap = new Map();
    const nPos = [];
    const nNrm = [];
    const nUv = [];
    const nIdx = [];
    let pMin = [Infinity, Infinity, Infinity];
    let pMax = [-Infinity, -Infinity, -Infinity];

    for (const tri of triList) {
      for (const oldI of tri) {
        let newI = remap.get(oldI);
        if (newI === undefined) {
          newI = nPos.length / 3;
          remap.set(oldI, newI);
          const p = pos.getElement(oldI, [0, 0, 0]);
          nPos.push(p[0], p[1], p[2]);
          for (let a = 0; a < 3; a++) {
            pMin[a] = Math.min(pMin[a], p[a]);
            pMax[a] = Math.max(pMax[a], p[a]);
          }
          if (nrm) {
            const n = nrm.getElement(oldI, [0, 0, 0]);
            nNrm.push(n[0], n[1], n[2]);
          }
          if (uv) {
            const u = uv.getElement(oldI, [0, 0]);
            nUv.push(u[0], u[1]);
          }
        }
        nIdx.push(newI);
      }
    }

    const pivot = recenterPivot ? [(pMin[0] + pMax[0]) * 0.5, (pMin[1] + pMax[1]) * 0.5, (pMin[2] + pMax[2]) * 0.5] : [0, 0, 0];
    if (recenterPivot) {
      for (let i = 0; i < nPos.length; i += 3) {
        nPos[i] -= pivot[0];
        nPos[i + 1] -= pivot[1];
        nPos[i + 2] -= pivot[2];
      }
    }

    const subMesh = doc.createMesh(name);
    const subPrim = doc.createPrimitive().setMaterial(mat);
    subPrim.setAttribute('POSITION', doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(nPos)));
    if (nrm) subPrim.setAttribute('NORMAL', doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(nNrm)));
    if (uv) subPrim.setAttribute('TEXCOORD_0', doc.createAccessor().setType(Accessor.Type.VEC2).setArray(new Float32Array(nUv)));
    subPrim.setIndices(doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Uint16Array(nIdx)));
    subMesh.addPrimitive(subPrim);

    const node = doc.createNode(name).setMesh(subMesh).setTranslation(pivot);
    return node;
  };

  origNode.setMesh(null);
  const bodyNode = buildSubPrimitive(bodyTris, 'fuselage', false);
  const mainNode = buildSubPrimitive(mainTris, 'main_rotor', true);
  const tailNode = buildSubPrimitive(tailTris, 'tail_rotor', true);
  scene.addChild(bodyNode);
  bodyNode.addChild(mainNode);
  bodyNode.addChild(tailNode);
  origMesh.dispose();
  console.log(`  [Mi-8 split] fuselage=${bodyTris.length} tris, main_rotor=${mainTris.length} tris, tail_rotor=${tailTris.length} tris`);
}

async function compressTextures(doc, baseSize, secSize) {
  const matRoles = new Map();
  for (const mat of doc.getRoot().listMaterials()) {
    const bc = mat.getBaseColorTexture();
    const nm = mat.getNormalTexture();
    const mr = mat.getMetallicRoughnessTexture();
    if (bc) matRoles.set(bc, 'baseColor');
    if (nm) matRoles.set(nm, 'normal');
    if (mr) matRoles.set(mr, 'mr');
  }
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const role = matRoles.get(tex) || 'other';
    const targetDim = role === 'baseColor' ? baseSize : secSize;
    const q = role === 'normal' ? 82 : role === 'mr' ? 76 : 80;
    const meta = await sharp(img).metadata();
    let pipe = sharp(img);
    if ((meta.width ?? 4096) > targetDim || (meta.height ?? 4096) > targetDim) {
      pipe = pipe.resize(targetDim, targetDim, { fit: 'inside', withoutEnlargement: true });
    }
    const out = await pipe.jpeg({ quality: q, chromaSubsampling: role === 'normal' ? '4:4:4' : '4:2:0', mozjpeg: true }).toBuffer();
    tex.setImage(out);
    tex.setMimeType('image/jpeg');
  }
}

async function main() {
  if (!existsSync(ZIP_PATH)) throw new Error(`Missing zip: ${ZIP_PATH}`);
  if (!existsSync(SEVEN_ZIP)) throw new Error(`Missing 7z.exe: ${SEVEN_ZIP}`);

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  mkdirSync(OUT_DIR, { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), 'blockdead-newmodels-'));
  const manifest = [];
  let totalBytes = 0;

  try {
    console.log(`Extracting 40 models from ${ZIP_PATH}...`);
    execFileSync(SEVEN_ZIP, ['e', '-y', `-o${stage}`, ZIP_PATH], { stdio: 'inherit' });

    for (const entry of CATALOG) {
      const srcPath = join(stage, entry.file);
      if (!existsSync(srcPath)) throw new Error(`Missing in zip: ${entry.file}`);
      const doc = await io.read(srcPath);

      normalizeAndBakeGeometry(doc, entry);
      if (entry.splitMi8) splitMi8Rotors(doc);
      await compressTextures(doc, entry.tex, entry.sec);

      await doc.transform(
        dedup(),
        prune(),
        weld({ tolerance: 1e-4 }),
        quantize(),
        meshopt({ encoder: MeshoptEncoder, level: 'high' }),
      );

      const box = measureWorldMesh(doc);
      let tris = 0;
      for (const m of doc.getRoot().listMeshes()) {
        for (const p of m.listPrimitives()) {
          const i = p.getIndices();
          const v = p.getAttribute('POSITION');
          tris += Math.round((i ? i.getCount() : v.getCount()) / 3);
        }
      }

      const outPath = join(OUT_DIR, entry.file);
      await io.write(outPath, doc);
      const sz = statSync(outPath).size;
      totalBytes += sz;

      manifest.push({
        file: entry.file,
        category: entry.category,
        size: [+box.sx.toFixed(3), +box.sy.toFixed(3), +box.sz.toFixed(3)],
        minY: +box.minY.toFixed(4),
        tris,
        bytes: sz,
      });

      console.log(`${entry.file.padEnd(28)} ${(sz / 1048576).toFixed(2)} MB  tris=${String(tris).padEnd(6)} size=[${box.sx.toFixed(2)}, ${box.sy.toFixed(2)}, ${box.sz.toFixed(2)}]`);
    }

    writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify({ models: manifest }, null, 2));
    console.log(`\nOptimized ${manifest.length} GLBs -> total ${(totalBytes / 1048576).toFixed(2)} MB in ${OUT_DIR}`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

await main();
